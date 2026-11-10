import hashlib
import json
import re
import threading
from datetime import UTC, datetime, timedelta
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

import pytest
from cryptography.exceptions import InvalidTag
from werkzeug.datastructures import FileStorage

from app import create_app, fileshare
from app.fileshare import (
	FileShareError,
	FileShareRecord,
	_b64decode,
	_b64encode,
	_decrypt_bytes,
	_derive_key,
	_encrypt_bytes,
	_evict_oldest_records,
	_parse_stem,
	_parse_timestamp,
	_record_paths,
	_sanitize_original_filename,
	_sweep,
	acquire_transfer_slot,
	build_label,
	cleanup_expired_records,
	decrypt_record_payload,
	delete_records,
	get_all_records_for_password,
	get_record_for_password,
	get_storage_status,
	save_upload,
)


def _file(filename='sample.txt', content=b'hello', content_type='text/plain') -> FileStorage:
	return FileStorage(stream=BytesIO(content), filename=filename, content_type=content_type)


def _record(salt_b64='', nonce_b64='', size_bytes=10) -> FileShareRecord:
	return FileShareRecord(
		label='label',
		occurrence_index=1,
		original_filename='test.txt',
		size_bytes=size_bytes,
		mime_type='text/plain',
		uploaded_at='',
		expires_at='',
		salt_b64=salt_b64,
		nonce_b64=nonce_b64,
	)


# Crypto and parsing (no app needed unless noted)


def test_build_label_deterministic(app_ctx):
	label = build_label('secret-pass')
	assert label == build_label('secret-pass')
	assert len(label) == 64


def test_build_label_is_peppered_with_secret_key():
	with create_app(test_config={'SECRET_KEY': 'key-a'}).app_context():
		label_a = build_label('secret-pass')
	with create_app(test_config={'SECRET_KEY': 'key-b'}).app_context():
		label_b = build_label('secret-pass')
	assert label_a != label_b
	assert label_a != hashlib.sha256(b'secret-pass').hexdigest()


def test_b64_roundtrip():
	raw = b'binary-data-\x00\xff\xfe'
	encoded = _b64encode(raw)
	assert isinstance(encoded, str)
	assert _b64decode(encoded) == raw


def test_derive_key_length():
	assert len(_derive_key('password123', b'0123456789abcdef')) == 32


def test_encrypt_and_decrypt_roundtrip():
	data = b'Confidential payload text for testing.'
	ciphertext, salt_b64, nonce_b64 = _encrypt_bytes('my-secure-password', data)
	assert ciphertext != data
	record = _record(salt_b64, nonce_b64, len(data))
	assert _decrypt_bytes('my-secure-password', record, ciphertext) == data


def test_decrypt_with_wrong_password_fails():
	ciphertext, salt_b64, nonce_b64 = _encrypt_bytes('correct-password', b'Secret bytes')
	with pytest.raises(InvalidTag):
		_decrypt_bytes('wrong-password', _record(salt_b64, nonce_b64), ciphertext)


def test_decrypt_missing_salt_or_nonce_raises():
	with pytest.raises(FileShareError) as exc_info:
		_decrypt_bytes('password', _record(), b'some-ciphertext')
	assert exc_info.value.status_code == 500


@pytest.mark.parametrize(
	('raw', 'expected'),
	[
		('test.pdf', 'test.pdf'),
		('../../etc/passwd', 'etc_passwd'),
		('   ', 'download'),
		('///', 'download'),
		('café résumé.pdf', 'cafe_resume.pdf'),
		('report_日本.pdf', 'report_.pdf'),  # Partly ASCII names keep what survives.
	],
)
def test_sanitize_original_filename(raw, expected):
	assert _sanitize_original_filename(raw) == expected


def test_sanitize_original_filename_without_ascii_uses_stable_placeholder():
	japanese = _sanitize_original_filename('日本語.pdf')
	assert re.fullmatch(r'file-[0-9a-f]{8}\.pdf', japanese)
	assert japanese == _sanitize_original_filename('日本語.pdf')
	assert japanese != _sanitize_original_filename('中文.pdf')
	assert re.fullmatch(r'file-[0-9a-f]{8}\.txt', _sanitize_original_filename('файл.txt'))
	assert re.fullmatch(r'file-[0-9a-f]{8}', _sanitize_original_filename('файл'))


def test_parse_stem():
	assert _parse_stem('abc') == ('abc', 1)
	assert _parse_stem('abc__12') == ('abc', 12)
	assert _parse_stem('abc__x') is None
	assert _parse_stem('abc__') is None


@pytest.mark.parametrize('value', ['2026-10-01T12:00:00+00:00', '2026-10-01T12:00:00'])
def test_parse_timestamp_is_utc(value):
	# Naive timestamps are assumed to be UTC.
	assert _parse_timestamp(value).tzinfo == UTC


# Storage lifecycle


def test_save_upload_validation(app_ctx):
	with pytest.raises(FileShareError, match='Access key is required.'):
		save_upload(_file(), '   ')
	with pytest.raises(FileShareError, match='A file is required.'):
		save_upload(_file(''), 'key123')


def test_save_upload_and_decrypt_record_success(app_ctx):
	record = save_upload(_file(content=b'Secret data content'), 'password123')
	assert record.original_filename == 'sample.txt'
	assert record.size_bytes == len(b'Secret data content')
	assert record.occurrence_index == 1

	retrieved = get_record_for_password('password123')
	assert retrieved is not None
	assert retrieved.label == record.label
	assert decrypt_record_payload(retrieved, 'password123') == b'Secret data content'


def test_save_upload_wrong_password_decrypt_fails(app_ctx):
	record = save_upload(_file(content=b'Confidential'), 'correct-key')
	with pytest.raises(FileShareError) as exc_info:
		decrypt_record_payload(record, 'wrong-key')
	assert exc_info.value.status_code == 403


def test_save_upload_appends_under_same_key(app_ctx):
	rec1 = save_upload(_file('file1.txt', b'First'), 'shared-key')
	rec2 = save_upload(_file('file2.txt', b'Second'), 'shared-key')
	assert (rec1.occurrence_index, rec2.occurrence_index) == (1, 2)
	assert len(get_all_records_for_password('shared-key')) == 2


def test_empty_file_reports_zero_bytes(app_ctx):
	record = save_upload(_file('empty.txt', b''), 'empty-key')
	assert record.size_bytes == 0

	(listed,) = get_all_records_for_password('empty-key')
	assert listed.size_bytes == 0
	assert decrypt_record_payload(listed, 'empty-key') == b''


def test_save_upload_skips_index_claimed_concurrently(app_ctx):
	save_upload(_file('a.txt', b'A'), 'race-key')
	rec2 = save_upload(_file('b.txt', b'B'), 'race-key')

	# Simulate a racing upload: the first index scan is stale and misses index 2.
	real_indices = fileshare._existing_indices
	stale = iter([[1]])
	with patch.object(
		fileshare, '_existing_indices', lambda label: next(stale, None) or real_indices(label)
	):
		rec3 = save_upload(_file('c.txt', b'C'), 'race-key')

	assert rec3.occurrence_index == 3
	assert decrypt_record_payload(rec2, 'race-key') == b'B'
	assert decrypt_record_payload(rec3, 'race-key') == b'C'


def test_records_ordered_by_numeric_index(app_ctx):
	for i in range(11):
		save_upload(_file(f'{i}.txt', b'x'), 'many-key')
	indices = [r.occurrence_index for r in get_all_records_for_password('many-key')]
	assert indices == list(range(1, 12))


def test_delete_records_removes_only_given_indices(app_ctx):
	save_upload(_file('old.txt', b'1'), 'del-key')
	save_upload(_file('new.txt', b'2'), 'del-key')
	other = save_upload(_file('other.txt', b'3'), 'other-key')

	assert delete_records('del-key', [1, 5]) == 1  # Index 5 doesn't exist and is skipped.
	assert [r.original_filename for r in get_all_records_for_password('del-key')] == ['new.txt']
	assert get_all_records_for_password('other-key') == [other]


def test_delete_records_requires_key(app_ctx):
	with pytest.raises(FileShareError) as exc_info:
		delete_records('  ', [1])
	assert exc_info.value.status_code == 400


def test_cleanup_expired_records(app_ctx):
	save_upload(_file('expire_me.txt', b'Temporary'), 'temp-key')
	future = datetime.now(UTC) + timedelta(seconds=700)  # Retention is 600 s.
	assert cleanup_expired_records(now=future) == 1
	assert get_record_for_password('temp-key') is None


def test_cleanup_corrupted_records(app_ctx):
	root = Path(app_ctx.instance_path) / 'fileshare'
	root.mkdir(parents=True, exist_ok=True)
	corrupt_meta = root / 'corrupt_test.json'
	corrupt_meta.write_text('invalid json content')

	assert cleanup_expired_records() == 1
	assert not corrupt_meta.exists()


def test_cleanup_corrupted_record_removes_payload(app_ctx):
	record = save_upload(_file('doc.txt', b'payload bytes'), 'corrupt-key')
	meta_path, payload_path = _record_paths(record.label, record.occurrence_index)
	meta_path.write_text('invalid json content')

	cleanup_expired_records()
	assert not meta_path.exists()
	assert not payload_path.exists()
	assert get_storage_status()['usedBytes'] == 0


def test_cleanup_invalid_timestamp(app_ctx):
	record = save_upload(_file('bad_time.txt', b'data'), 'key-bad-time')
	meta_path, _ = _record_paths(record.label, record.occurrence_index)
	meta = json.loads(meta_path.read_text(encoding='utf-8'))
	meta['expires_at'] = 'not-a-valid-date'
	meta_path.write_text(json.dumps(meta), encoding='utf-8')

	assert cleanup_expired_records() == 1
	assert not meta_path.exists()


def test_storage_status(app_ctx):
	status = get_storage_status()
	assert (status['activeFileCount'], status['usedBytes']) == (0, 0)

	save_upload(_file('doc.txt', b'12345'), 'test-status-key')
	status = get_storage_status()
	assert status['activeFileCount'] == 1
	assert status['usedBytes'] > 0


def test_decrypt_record_payload_file_missing(app_ctx):
	record = save_upload(_file('doc.txt', b'12345'), 'test-key-missing')
	_, payload_path = _record_paths(record.label, record.occurrence_index)
	payload_path.unlink()

	with pytest.raises(FileShareError) as exc_info:
		decrypt_record_payload(record, 'test-key-missing')
	assert exc_info.value.status_code == 404


def test_evict_oldest_records(app_ctx):
	save_upload(_file('old.txt', b'old content'), 'key1')
	save_upload(_file('new.txt', b'new content'), 'key2')

	assert _evict_oldest_records(_sweep()[0], required_free_bytes=1) > 0
	assert get_record_for_password('key1') is None
	assert get_record_for_password('key2') is not None


def test_save_upload_oversized_file(app_ctx):
	with patch('app.fileshare.MAX_FILE_BYTES', 10), pytest.raises(FileShareError) as exc_info:
		save_upload(_file('large.txt', b'12345678901234567890'), 'key-large')
	assert exc_info.value.status_code == 413


def test_save_upload_not_enough_storage_503(app_ctx):
	with (
		patch('app.fileshare.MAX_TOTAL_STORAGE_BYTES', 5),
		pytest.raises(FileShareError) as exc_info,
	):
		save_upload(_file('file.txt', b'data'), 'key-no-space')
	assert exc_info.value.status_code == 503


def test_transfer_slot_release_is_idempotent():
	slots = threading.BoundedSemaphore(1)
	with patch('app.fileshare._transfer_slots', slots):
		release = acquire_transfer_slot()
		with pytest.raises(FileShareError) as exc_info:
			acquire_transfer_slot()
		assert exc_info.value.status_code == 503
		release()
		release()  # A second call must not over-release the BoundedSemaphore.
		acquire_transfer_slot()()

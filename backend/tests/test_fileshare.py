import hashlib
import os
import threading
import time
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
	_ciphertext_size,
	_clean_filename,
	_decrypt_chunks,
	_derive_key,
	_encrypt_chunks,
	_store,
	acquire_transfer_slot,
	build_label,
	get_all_records_for_password,
	get_record_for_password,
	get_storage_status,
	open_record_payload,
	save_upload,
	start_expiry_sweeper,
)

KEY = bytes(32)


def _file(filename='sample.txt', content=b'hello', content_type='text/plain') -> FileStorage:
	return FileStorage(stream=BytesIO(content), filename=filename, content_type=content_type)


def _read(record, password) -> bytes:
	chunks = open_record_payload(record, password)
	try:
		return b''.join(chunks)
	finally:
		chunks.close()


def _payload(record) -> Path:
	return _store().payload_path(record.id)


def _names(password) -> list[str]:
	return [r.original_filename for r in get_all_records_for_password(password)]


def _encrypt(plaintext: bytes) -> bytes:
	dest = BytesIO()
	_encrypt_chunks(KEY, BytesIO(plaintext), dest)
	return dest.getvalue()


def _decrypt(tmp_path: Path, ciphertext: bytes, key: bytes = KEY) -> bytes:
	path = tmp_path / 'payload'
	path.write_bytes(ciphertext)
	return b''.join(_decrypt_chunks(key, path))


@pytest.fixture
def tiny_chunks():
	"""4-byte chunks so multi-chunk cases stay small."""
	with patch('app.fileshare.CHUNK_BYTES', 4):
		yield 4


# Crypto (no app needed unless noted)


def test_build_label_deterministic(app_ctx):
	label = build_label('secret-pass')
	assert label == build_label('secret-pass')
	assert len(label) == 64


def test_build_label_is_peppered_with_secret_key(tmp_path):
	labels = []
	for secret in ('key-a', 'key-b'):
		app = create_app(test_config={'SECRET_KEY': secret}, instance_path=str(tmp_path))
		with app.app_context():
			labels.append(build_label('secret-pass'))
	assert labels[0] != labels[1]
	assert labels[0] != hashlib.sha256(b'secret-pass').hexdigest()


def test_derive_key_length():
	assert len(_derive_key('password123', b'0123456789abcdef')) == 32


@pytest.mark.parametrize('size', [0, 1, 3, 4, 5, 8, 9])
def test_chunked_roundtrip(tmp_path, tiny_chunks, size):
	data = os.urandom(size)
	ciphertext = _encrypt(data)
	assert len(ciphertext) == _ciphertext_size(size)
	assert _decrypt(tmp_path, ciphertext) == data


def _tag_chunks(ciphertext: bytes, chunk_bytes: int) -> list[bytes]:
	step = chunk_bytes + fileshare.TAG_BYTES
	return [ciphertext[i : i + step] for i in range(0, len(ciphertext), step)]


@pytest.mark.parametrize(
	'tamper',
	[
		pytest.param(lambda c: c[:-1], id='dropped last chunk'),
		pytest.param(lambda c: [*c, c[-1]], id='appended chunk'),
		pytest.param(lambda c: [c[1], c[0], c[2]], id='swapped chunks'),
		pytest.param(lambda c: [*c[:-1], c[-1][:-1]], id='truncated mid-chunk'),
	],
)
def test_tampered_payload_fails(tmp_path, tiny_chunks, tamper):
	chunks = _tag_chunks(_encrypt(b'abcdefghij'), tiny_chunks)
	assert len(chunks) == 3
	with pytest.raises(InvalidTag):
		_decrypt(tmp_path, b''.join(tamper(chunks)))


def test_decrypt_with_wrong_key_fails(tmp_path):
	with pytest.raises(InvalidTag):
		_decrypt(tmp_path, _encrypt(b'Secret bytes'), key=bytes([1]) * 32)


def test_corrupt_first_chunk_is_forbidden(app_ctx):
	record = save_upload(_file(content=b'payload'), 'key')
	path = _payload(record)
	data = path.read_bytes()
	# Flip a bit: overwriting with a fixed byte is a no-op whenever the byte already had that value.
	path.write_bytes(bytes([data[0] ^ 1]) + data[1:])

	with pytest.raises(FileShareError) as exc_info:
		open_record_payload(record, 'key')
	assert exc_info.value.status_code == 403


@pytest.mark.parametrize(
	('raw', 'expected'),
	[
		('test.pdf', 'test.pdf'),
		('../../etc/passwd', 'passwd'),
		('C:\\Users\\me\\report.pdf', 'report.pdf'),
		('   ', 'download'),
		('///', 'download'),
		('café résumé.pdf', 'café résumé.pdf'),
		('日本語.pdf', '日本語.pdf'),
		# Control characters and a right-to-left override that would show "exe.txt".
		('a\x00b\r\n\u202etxt.exe', 'abtxt.exe'),
	],
)
def test_clean_filename(raw, expected):
	assert _clean_filename(raw) == expected


def test_clean_filename_caps_bytes_but_keeps_the_extension():
	cleaned = _clean_filename('日' * 200 + '.pdf')
	assert cleaned.endswith('.pdf')
	assert len(cleaned.encode()) <= fileshare.MAX_FILENAME_BYTES
	# 3-byte characters: whole ones only, so the name still decodes.
	assert cleaned == '日' * 83 + '.pdf'
	assert len(_clean_filename('x.' + 'y' * 400).encode()) == fileshare.MAX_FILENAME_BYTES


# Storage lifecycle


def test_new_store_deletes_files_left_by_an_earlier_process(tmp_path):
	leftover = tmp_path / 'fileshare' / 'leftover'
	leftover.parent.mkdir()
	leftover.write_bytes(b'ciphertext')

	create_app(test_config={'SECRET_KEY': 'k'}, instance_path=str(tmp_path))
	assert list((tmp_path / 'fileshare').iterdir()) == []


def test_save_upload_validation(app_ctx):
	with pytest.raises(FileShareError, match='Access key is required.'):
		save_upload(_file(), '   ')
	with pytest.raises(FileShareError, match='A file is required.'):
		save_upload(_file(''), 'key123')


def test_save_upload_and_decrypt_record_success(app_ctx):
	record = save_upload(_file(content=b'Secret data content'), 'password123')
	assert record.original_filename == 'sample.txt'
	assert record.size_bytes == len(b'Secret data content')

	assert get_record_for_password('password123', record.id) == record
	assert get_record_for_password('other-key', record.id) is None
	assert _read(record, 'password123') == b'Secret data content'


def test_save_upload_streams_multiple_chunks(app_ctx, tiny_chunks):
	record = save_upload(_file(content=b'0123456789'), 'chunky')
	assert _payload(record).stat().st_size == _ciphertext_size(10) == record.stored_bytes
	assert _read(record, 'chunky') == b'0123456789'


def test_save_upload_wrong_password_decrypt_fails(app_ctx):
	record = save_upload(_file(content=b'Confidential'), 'correct-key')
	with pytest.raises(FileShareError) as exc_info:
		open_record_payload(record, 'wrong-key')
	assert exc_info.value.status_code == 403


def test_save_upload_appends_under_same_key_in_upload_order(app_ctx):
	first = save_upload(_file('file1.txt', b'First'), 'shared-key')
	second = save_upload(_file('file2.txt', b'Second'), 'shared-key')
	assert first.id != second.id
	assert get_all_records_for_password('shared-key') == [first, second]


def test_replace_deletes_only_the_keys_earlier_files(app_ctx):
	old = [save_upload(_file(name, b'old'), 'key') for name in ('a.txt', 'b.txt')]
	other = save_upload(_file('other.txt', b'x'), 'other-key')

	save_upload(_file('new.txt', b'new'), 'key', replace=True)
	assert _names('key') == ['new.txt']
	assert not any(_payload(record).exists() for record in old)
	assert get_all_records_for_password('other-key') == [other]


@pytest.mark.parametrize(
	('error', 'raised'),
	[(OSError('disk full'), FileShareError), (RuntimeError('bug'), RuntimeError)],
)
def test_failed_replace_keeps_the_earlier_files(app_ctx, error, raised):
	save_upload(_file('old.txt', b'old'), 'key')
	with (
		patch('app.fileshare._encrypt_chunks', side_effect=error),
		pytest.raises(raised),
	):
		save_upload(_file('new.txt', b'new'), 'key', replace=True)

	assert _names('key') == ['old.txt']
	# The half-written payload is gone too.
	assert len(list(_store().root.iterdir())) == 1


def test_empty_file_reports_zero_bytes(app_ctx):
	record = save_upload(_file('empty.txt', b''), 'empty-key')
	assert record.size_bytes == 0

	(listed,) = get_all_records_for_password('empty-key')
	assert listed.size_bytes == 0
	assert _read(listed, 'empty-key') == b''


def test_expired_files_are_deleted(app_ctx):
	record = save_upload(_file('expire_me.txt', b'Temporary'), 'temp-key')
	future = datetime.now(UTC) + timedelta(seconds=fileshare.RETENTION_SECONDS + 1)
	assert _store().sweep(now=future) == []
	assert get_record_for_password('temp-key', record.id) is None
	assert not _payload(record).exists()


def test_storage_status(app_ctx):
	status = get_storage_status()
	assert (status['activeFileCount'], status['usedBytes']) == (0, 0)

	record = save_upload(_file('doc.txt', b'12345'), 'test-status-key')
	status = get_storage_status()
	assert status['activeFileCount'] == 1
	assert status['usedBytes'] == record.stored_bytes


def test_open_record_payload_file_missing(app_ctx):
	record = save_upload(_file('doc.txt', b'12345'), 'test-key-missing')
	_payload(record).unlink()

	with pytest.raises(FileShareError) as exc_info:
		_read(record, 'test-key-missing')
	assert exc_info.value.status_code == 404


def test_byte_quota_evicts_the_oldest_files(app_ctx):
	# Room for two 5-byte files (21 bytes stored each), not three.
	with patch('app.fileshare.MAX_TOTAL_STORAGE_BYTES', 50):
		first = save_upload(_file('1.txt', b'12345'), 'key')
		save_upload(_file('2.txt', b'12345'), 'key')
		save_upload(_file('3.txt', b'12345'), 'key')
	assert _names('key') == ['2.txt', '3.txt']
	assert not _payload(first).exists()


def test_file_count_cap_evicts_the_oldest_files(app_ctx):
	with patch('app.fileshare.MAX_FILE_COUNT', 2):
		for name in ('1.txt', '2.txt', '3.txt'):
			save_upload(_file(name, b''), 'key')
	assert _names('key') == ['2.txt', '3.txt']
	assert len(list(_store().root.iterdir())) == 2


def test_save_upload_oversized_file(app_ctx):
	with patch('app.fileshare.MAX_FILE_BYTES', 10), pytest.raises(FileShareError) as exc_info:
		save_upload(_file('large.txt', b'12345678901234567890'), 'key-large')
	assert exc_info.value.status_code == 413


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


def test_expiry_sweeper_removes_expired_files_without_requests(app):
	with app.app_context(), patch('app.fileshare.RETENTION_SECONDS', 0):
		payload = _payload(save_upload(_file(), 'idle-key'))

	with patch('app.fileshare.SWEEP_INTERVAL_SECONDS', 0.01):
		stop = start_expiry_sweeper(app)
	try:
		deadline = time.monotonic() + 2
		while payload.exists() and time.monotonic() < deadline:
			time.sleep(0.01)
	finally:
		stop.set()
	assert not payload.exists()

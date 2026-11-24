import base64
import hashlib
import os
import threading
import time
from datetime import UTC, datetime, timedelta
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

import pytest
from werkzeug.datastructures import FileStorage

from app import create_app, fileshare
from app.fileshare import (
	FileShareError,
	_ciphertext_size,
	_plaintext_size,
	_store,
	acquire_transfer_slot,
	build_label,
	get_record_for_token,
	get_records_for_token,
	get_storage_status,
	open_record_payload,
	save_upload,
	start_expiry_sweeper,
)

SALT = 'S' * 22


def token(seed: str = 'key') -> str:
	"""A well-formed lookup token, as the browser derives one."""
	return base64.urlsafe_b64encode(hashlib.sha256(seed.encode()).digest()).rstrip(b'=').decode()


def encrypted_name(tag: str = 'n') -> str:
	return tag * 363


def ciphertext(plaintext_bytes: int = 5) -> bytes:
	"""Random bytes the size of an encrypted `plaintext_bytes` file; the server never decrypts."""
	return os.urandom(_ciphertext_size(plaintext_bytes))


def _file(content: bytes) -> FileStorage:
	return FileStorage(stream=BytesIO(content), filename='encrypted')


def _save(content=None, seed='key', name='n', replace=False, salt=SALT):
	content = ciphertext() if content is None else content
	return save_upload(_file(content), token(seed), salt, encrypted_name(name), replace=replace)


def _read(record) -> bytes:
	chunks = open_record_payload(record)
	try:
		return b''.join(chunks)
	finally:
		chunks.close()


def _payload(record) -> Path:
	return _store().payload_path(record.id)


def _names(seed='key') -> list[str]:
	return [r.encrypted_name[0] for r in get_records_for_token(token(seed))]


@pytest.fixture
def tiny_chunks():
	"""4-byte chunks so multi-chunk sizes stay small."""
	with patch('app.fileshare.CHUNK_BYTES', 4):
		yield 4


# Tokens and sizes


def test_build_label_deterministic(app_ctx):
	label = build_label(token())
	assert label == build_label(token())
	assert label != build_label(token('other'))
	assert len(label) == 64


def test_build_label_is_peppered_with_secret_key(tmp_path):
	labels = []
	for secret in ('key-a', 'key-b'):
		app = create_app(test_config={'SECRET_KEY': secret}, instance_path=str(tmp_path))
		with app.app_context():
			labels.append(build_label(token()))
	assert labels[0] != labels[1]


def test_build_label_ignores_the_unused_bits_of_the_last_character(app_ctx):
	assert build_label('A' * 43) == build_label('A' * 42 + 'B')


@pytest.mark.parametrize(
	'bad',
	['', 'mypassword', token()[:-1], token() + 'A', token()[:-1] + '+', ' ' + token()[1:]],
)
def test_malformed_tokens_are_rejected(app_ctx, bad):
	with pytest.raises(FileShareError, match='malformed access token') as exc_info:
		get_records_for_token(bad)
	assert exc_info.value.status_code == 400


def test_plaintext_size_inverts_ciphertext_size(tiny_chunks):
	valid = {_ciphertext_size(n): n for n in range(40)}
	for size in range(max(valid) + 1):
		assert _plaintext_size(size) == valid.get(size), size
	# Spot checks: an empty file is one bare tag, and an exact multiple adds no empty chunk.
	assert (_plaintext_size(0), _plaintext_size(16), _plaintext_size(20)) == (None, 0, 4)
	assert _plaintext_size(20 + 16) is None


# Storage lifecycle


def test_new_store_deletes_files_left_by_an_earlier_process(tmp_path):
	leftover = tmp_path / 'fileshare' / 'leftover'
	leftover.parent.mkdir()
	leftover.write_bytes(b'ciphertext')

	create_app(test_config={'SECRET_KEY': 'k'}, instance_path=str(tmp_path))
	assert list((tmp_path / 'fileshare').iterdir()) == []


def test_save_upload_validation(app_ctx):
	with pytest.raises(FileShareError, match='A file is required.'):
		save_upload(None, token(), SALT, encrypted_name())
	for salt, name in [('', encrypted_name()), (SALT + 'x', encrypted_name()), (SALT, 'n' * 10)]:
		with pytest.raises(FileShareError, match='malformed file salt or name'):
			save_upload(_file(ciphertext()), token(), salt, name)
	for size in (0, 5, 15):
		with pytest.raises(FileShareError, match='not a validly encrypted file'):
			_save(os.urandom(size))
	assert get_storage_status()['activeFileCount'] == 0


def test_save_upload_stores_the_ciphertext_as_sent(app_ctx):
	content = ciphertext(20)
	record = _save(content, salt='T' * 22)
	assert (record.size_bytes, record.stored_bytes) == (20, len(content))
	assert record.to_json()['salt'] == 'T' * 22
	assert record.to_json()['encryptedName'] == encrypted_name()
	assert 'label' not in record.to_json()

	assert get_record_for_token(token(), record.id) == record
	assert get_record_for_token(token('other'), record.id) is None
	assert _payload(record).read_bytes() == content
	assert _read(record) == content


def test_save_upload_stores_multiple_chunks(app_ctx, tiny_chunks):
	content = ciphertext(10)
	record = _save(content)
	assert record.size_bytes == 10
	assert _read(record) == content


def test_save_upload_appends_under_same_token_in_upload_order(app_ctx):
	first = _save(name='a')
	second = _save(name='b')
	assert first.id != second.id
	assert get_records_for_token(token()) == [first, second]


def test_replace_deletes_only_the_tokens_earlier_files(app_ctx):
	old = [_save(name=name) for name in 'ab']
	other = _save(seed='other')

	_save(name='c', replace=True)
	assert _names() == ['c']
	assert not any(_payload(record).exists() for record in old)
	assert get_records_for_token(token('other')) == [other]


@pytest.mark.parametrize(
	('error', 'raised'),
	[(OSError('disk full'), FileShareError), (RuntimeError('bug'), RuntimeError)],
)
def test_failed_replace_keeps_the_earlier_files(app_ctx, error, raised):
	_save(name='o')

	def fail_midway(source, path):
		path.write_bytes(b'partial')
		raise error

	with patch('app.fileshare._write_payload', side_effect=fail_midway), pytest.raises(raised):
		_save(name='n', replace=True)

	assert _names() == ['o']
	# The half-written payload is gone too.
	assert len(list(_store().root.iterdir())) == 1


def test_empty_file_reports_zero_bytes(app_ctx):
	record = _save(ciphertext(0))
	(listed,) = get_records_for_token(token())
	assert listed.size_bytes == record.size_bytes == 0
	assert listed.stored_bytes == 16


def test_expired_files_are_deleted(app_ctx):
	record = _save()
	future = datetime.now(UTC) + timedelta(seconds=fileshare.RETENTION_SECONDS + 1)
	assert _store().sweep(now=future) == []
	assert get_record_for_token(token(), record.id) is None
	assert not _payload(record).exists()


def test_storage_status(app_ctx):
	status = get_storage_status()
	assert (status['activeFileCount'], status['usedBytes']) == (0, 0)

	record = _save()
	status = get_storage_status()
	assert status['activeFileCount'] == 1
	assert status['usedBytes'] == record.stored_bytes


def test_open_record_payload_file_missing(app_ctx):
	record = _save()
	_payload(record).unlink()

	with pytest.raises(FileShareError) as exc_info:
		open_record_payload(record)
	assert exc_info.value.status_code == 404


def test_byte_quota_evicts_the_oldest_files(app_ctx):
	# Room for two 5-byte files (21 bytes stored each), not three.
	with patch('app.fileshare.MAX_TOTAL_STORAGE_BYTES', 50):
		first = _save(name='1')
		_save(name='2')
		_save(name='3')
	assert _names() == ['2', '3']
	assert not _payload(first).exists()


def test_file_count_cap_evicts_the_oldest_files(app_ctx):
	with patch('app.fileshare.MAX_FILE_COUNT', 2):
		for name in '123':
			_save(ciphertext(0), name=name)
	assert _names() == ['2', '3']
	assert len(list(_store().root.iterdir())) == 2


def test_save_upload_oversized_file(app_ctx):
	# The cap applies to the plaintext size, not the slightly larger ciphertext.
	with patch('app.fileshare.MAX_FILE_BYTES', 10):
		_save(ciphertext(10))
		with pytest.raises(FileShareError) as exc_info:
			_save(ciphertext(11))
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
		payload = _payload(_save())

	with patch('app.fileshare.SWEEP_INTERVAL_SECONDS', 0.01):
		stop = start_expiry_sweeper(app)
	try:
		deadline = time.monotonic() + 2
		while payload.exists() and time.monotonic() < deadline:
			time.sleep(0.01)
	finally:
		stop.set()
	assert not payload.exists()

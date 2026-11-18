"""Temporary encrypted file storage keyed by an access key.

The index of stored files lives in memory (one `FileShareStore` per app); each file's
AES-GCM ciphertext is `<instance>/fileshare/<id>`, in chunks. A file's label is an HMAC
of its access key, so the key itself is never kept. Nothing survives a restart: the
store deletes every payload when it's created, since without the index (which holds
each file's salt) they could never be found or decrypted again. That assumes one
process, as Waitress runs it; separate workers would delete each other's files.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import shutil
import threading
import unicodedata
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from itertools import chain
from pathlib import Path
from typing import BinaryIO

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
from flask import Flask, current_app
from werkzeug.datastructures import FileStorage
from werkzeug.wsgi import ClosingIterator

from .errors import ApiError

# Below Cloudflare's 100 MB request limit with room for multipart overhead.
MAX_FILE_BYTES = 80 * 1_000_000
MAX_TOTAL_STORAGE_BYTES = 1_000_000_000
# The byte quota alone allows ~60 million empty files (16 bytes each).
MAX_FILE_COUNT = 1_000
RETENTION_SECONDS = 10 * 60
# The usual filesystem limit, which also keeps Content-Disposition well under Nginx's 4 KB header buffer.
MAX_FILENAME_BYTES = 255
SALT_BYTES = 16
CHUNK_BYTES = 1024 * 1024
TAG_BYTES = 16
KDF_LENGTH = 32
KDF_N = 2**14
KDF_R = 8
KDF_P = 1
# Transfers stream in chunks, so CPU is the limit; staying under Waitress's 4 threads
# keeps one free for other requests.
MAX_CONCURRENT_TRANSFERS = 3
SWEEP_INTERVAL_SECONDS = 60

_transfer_slots = threading.BoundedSemaphore(MAX_CONCURRENT_TRANSFERS)


class FileShareError(ApiError):
	pass


@dataclass(frozen=True)
class FileShareRecord:
	id: str
	label: str
	original_filename: str
	size_bytes: int
	uploaded_at: datetime
	expires_at: datetime
	salt: bytes

	@property
	def stored_bytes(self) -> int:
		return _ciphertext_size(self.size_bytes)

	def to_json(self) -> dict:
		# The public fields only; the label and salt stay server-side.
		return {
			'id': self.id,
			'originalFilename': self.original_filename,
			'sizeBytes': self.size_bytes,
			'uploadedAt': self.uploaded_at.isoformat(),
			'expiresAt': self.expires_at.isoformat(),
		}


class FileShareStore:
	"""The index of stored files, oldest first, and the directory holding their payloads."""

	def __init__(self, root: Path):
		# Payloads left by an earlier process aren't in this (empty) index, so delete them.
		if root.exists():
			shutil.rmtree(root)
		root.mkdir(parents=True)
		self.root = root
		# Insertion order is upload order, which eviction relies on.
		self._records: dict[str, FileShareRecord] = {}
		self._lock = threading.Lock()

	def payload_path(self, file_id: str) -> Path:
		return self.root / file_id

	def _remove_locked(self, record: FileShareRecord) -> None:
		del self._records[record.id]
		# A download still streaming it keeps its open handle; the disk space frees when it closes.
		self.payload_path(record.id).unlink(missing_ok=True)

	def _remove_expired_locked(self, now: datetime) -> None:
		for record in [r for r in self._records.values() if r.expires_at <= now]:
			self._remove_locked(record)

	def sweep(self, now: datetime | None = None) -> list[FileShareRecord]:
		"""Delete expired files; returns the rest, oldest first."""
		with self._lock:
			self._remove_expired_locked(now or _now_utc())
			return list(self._records.values())

	def add(self, record: FileShareRecord, replace: bool) -> None:
		"""Index a stored payload. `replace` first drops the key's other files; then the
		oldest files go until the new one fits the byte and count quotas."""
		with self._lock:
			self._remove_expired_locked(_now_utc())
			if replace:
				for old in [r for r in self._records.values() if r.label == record.label]:
					self._remove_locked(old)
			# Uploads still writing aren't indexed yet, so the disk can briefly hold up to
			# MAX_CONCURRENT_TRANSFERS more files than this counts.
			used = sum(r.stored_bytes for r in self._records.values())
			while self._records and (
				used + record.stored_bytes > MAX_TOTAL_STORAGE_BYTES
				or len(self._records) >= MAX_FILE_COUNT
			):
				oldest = next(iter(self._records.values()))
				used -= oldest.stored_bytes
				self._remove_locked(oldest)
			self._records[record.id] = record


def init_app(app: Flask) -> None:
	app.extensions['fileshare'] = FileShareStore(Path(app.instance_path) / 'fileshare')


def _store() -> FileShareStore:
	return current_app.extensions['fileshare']


def build_label(password: str) -> str:
	# Keyed with SECRET_KEY (a pepper), so a leaked label can't be brute-forced
	# without also having the server secret.
	pepper = current_app.config['SECRET_KEY'].encode('utf-8')
	return hmac.new(pepper, password.encode('utf-8'), hashlib.sha256).hexdigest()


def acquire_transfer_slot() -> Callable[[], None]:
	"""Take one of MAX_CONCURRENT_TRANSFERS slots, or raise a 503 immediately if none is free.

	Returns a release function that is safe to call more than once.
	"""
	if not _transfer_slots.acquire(blocking=False):
		raise FileShareError('The file share is busy right now; try again in a moment.', 503)
	lock = threading.Lock()
	released = False

	def release() -> None:
		nonlocal released
		with lock:
			if released:
				return
			released = True
		_transfer_slots.release()

	return release


@contextmanager
def transfer_slot() -> Iterator[None]:
	release = acquire_transfer_slot()
	try:
		yield
	finally:
		release()


def _now_utc() -> datetime:
	return datetime.now(UTC)


def _derive_key(password: str, salt: bytes) -> bytes:
	kdf = Scrypt(salt=salt, length=KDF_LENGTH, n=KDF_N, r=KDF_R, p=KDF_P)
	return kdf.derive(password.encode('utf-8'))


def start_expiry_sweeper(app: Flask) -> threading.Event:
	"""Sweep expired files on a daemon thread so idle files don't linger; set the returned event to stop it."""
	stop = threading.Event()
	store: FileShareStore = app.extensions['fileshare']

	def run() -> None:
		while not stop.wait(SWEEP_INTERVAL_SECONDS):
			try:
				store.sweep()
			except Exception:
				# One bad pass must not end the thread for the life of the process.
				app.logger.exception('File share sweep failed')

	threading.Thread(target=run, name='fileshare-sweeper', daemon=True).start()
	return stop


def get_storage_status() -> dict[str, int | bool]:
	records = _store().sweep()
	return {
		'activeFileCount': len(records),
		'usedBytes': sum(record.stored_bytes for record in records),
		'maxFileBytes': MAX_FILE_BYTES,
		'maxTotalBytes': MAX_TOTAL_STORAGE_BYTES,
		'retentionSeconds': RETENTION_SECONDS,
	}


def get_all_records_for_password(password: str) -> list[FileShareRecord]:
	label = build_label(password)
	return [record for record in _store().sweep() if record.label == label]


def get_record_for_password(password: str, file_id: str) -> FileShareRecord | None:
	records = get_all_records_for_password(password)
	return next((r for r in records if r.id == file_id), None)


def _chunk_nonce(index: int, last: bool) -> bytes:
	# A counter suffices since each file's random salt gives it its own key. The
	# last-chunk flag makes truncated or extended payloads fail authentication.
	return index.to_bytes(11, 'big') + bytes([last])


def _read_chunks(source: BinaryIO, size: int) -> Iterator[tuple[bytes, bool]]:
	"""Fixed-size chunks flagged with whether each is last; an empty source yields one empty last chunk."""
	chunk = source.read(size)
	while True:
		next_chunk = source.read(size)
		yield chunk, not next_chunk
		if not next_chunk:
			return
		chunk = next_chunk


def _ciphertext_size(plaintext_size: int) -> int:
	chunk_count = max(1, (plaintext_size + CHUNK_BYTES - 1) // CHUNK_BYTES)
	return plaintext_size + chunk_count * TAG_BYTES


def _encrypt_chunks(key: bytes, source: BinaryIO, dest: BinaryIO) -> None:
	aead = AESGCM(key)
	dest.writelines(
		aead.encrypt(_chunk_nonce(index, last), chunk, None)
		for index, (chunk, last) in enumerate(_read_chunks(source, CHUNK_BYTES))
	)


def _decrypt_chunks(key: bytes, path: Path) -> Iterator[bytes]:
	aead = AESGCM(key)
	with path.open('rb') as handle:
		for index, (chunk, last) in enumerate(_read_chunks(handle, CHUNK_BYTES + TAG_BYTES)):
			yield aead.decrypt(_chunk_nonce(index, last), chunk, None)


def _clean_filename(filename: str) -> str:
	"""The uploaded name, kept only as metadata: Unicode stays, while directories and
	control characters go, and it's capped at MAX_FILENAME_BYTES of UTF-8."""
	name = filename.replace('\\', '/').rsplit('/', 1)[-1]
	# Category C includes bidi overrides, which can disguise a file's real extension.
	name = ''.join(c for c in name if unicodedata.category(c)[0] != 'C').strip()
	stem, ext = os.path.splitext(name)
	# Trim the stem, not the extension, so the file still opens with the right app.
	room = MAX_FILENAME_BYTES - len(ext.encode())
	if room <= 0:
		stem, ext, room = name, '', MAX_FILENAME_BYTES
	# 'ignore' drops a character cut in half by the byte limit.
	stem = stem.encode()[:room].decode('utf-8', 'ignore')
	return (stem + ext).strip() or 'download'


def save_upload(
	uploaded_file: FileStorage | None, password: str, replace: bool = False
) -> FileShareRecord:
	"""Encrypt and store a file under the key, evicting the oldest files if over quota.

	`replace` deletes the key's earlier files, but only once this one is stored, so a
	failed upload leaves them in place.
	"""
	if not password.strip():
		raise FileShareError('Access key is required.')
	if uploaded_file is None or not (uploaded_file.filename or '').strip():
		raise FileShareError('A file is required.')

	# Werkzeug has already spooled the upload to disk, so measure it without reading it.
	source = uploaded_file.stream
	size_bytes = source.seek(0, os.SEEK_END)
	source.seek(0)
	if size_bytes > MAX_FILE_BYTES:
		raise FileShareError(f'File exceeds the {MAX_FILE_BYTES // 1_000_000} MB limit.', 413)

	store = _store()
	file_id = secrets.token_hex(16)
	salt = os.urandom(SALT_BYTES)
	label = build_label(password)
	filename = _clean_filename(uploaded_file.filename)
	payload_path = store.payload_path(file_id)
	try:
		with payload_path.open('wb') as handle:
			_encrypt_chunks(_derive_key(password, salt), source, handle)
	except OSError as exc:
		payload_path.unlink(missing_ok=True)
		current_app.logger.exception('Failed to store fileshare upload')
		raise FileShareError('Failed to store upload.', 500) from exc
	except BaseException:
		payload_path.unlink(missing_ok=True)
		raise

	now = _now_utc()
	record = FileShareRecord(
		id=file_id,
		label=label,
		original_filename=filename,
		size_bytes=size_bytes,
		uploaded_at=now,
		expires_at=now + timedelta(seconds=RETENTION_SECONDS),
		salt=salt,
	)
	store.add(record, replace=replace)
	return record


def open_record_payload(record: FileShareRecord, password: str) -> Iterator[bytes]:
	"""The decrypted file as chunks, closing the payload when the iterator is closed.

	The first chunk is decrypted here so a missing or corrupt file still gets an error
	response; a later bad chunk can only end the stream early.
	"""
	# Catch the failed open rather than checking exists(): a sweep can delete it in between.
	try:
		chunks = _decrypt_chunks(
			_derive_key(password, record.salt), _store().payload_path(record.id)
		)
		first = next(chunks)
	except FileNotFoundError:
		raise FileShareError('The requested file is no longer available.', 404) from None
	except Exception as exc:
		raise FileShareError('Incorrect access key or corrupted file.', 403) from exc
	# chain() has no close(), so close the generator (and its file) explicitly.
	return ClosingIterator(chain([first], chunks), chunks.close)

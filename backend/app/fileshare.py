"""Temporary storage for files the browser has already encrypted.

The browser derives a lookup token from the access key and encrypts each file and its
name (`frontend/src/lib/fileshare/crypto.ts`), so this module only ever handles
ciphertext. The index of stored files lives in memory (one `FileShareStore` per app);
each file's ciphertext is `<instance>/fileshare/<id>`. A file's label is an HMAC of the
token, so the token itself is never kept. Nothing survives a restart: the store deletes
every payload when it's created, since without the index (which holds each file's salt
and encrypted name) they could never be found or decrypted again. That assumes one
process, as Waitress runs it; separate workers would delete each other's files.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import secrets
import shutil
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import BinaryIO

from flask import Flask, current_app
from werkzeug.datastructures import FileStorage
from werkzeug.wsgi import FileWrapper

from .errors import ApiError

# Below Cloudflare's 100 MB request limit with room for multipart overhead.
MAX_FILE_BYTES = 80 * 1_000_000
MAX_TOTAL_STORAGE_BYTES = 1_000_000_000
# The byte quota alone allows ~60 million empty files (16 bytes each).
MAX_FILE_COUNT = 1_000
RETENTION_SECONDS = 10 * 60
# The browser's format: AES-GCM over 1 MiB chunks, each with a 16-byte tag.
CHUNK_BYTES = 1024 * 1024
TAG_BYTES = 16
# Base64url without padding: a 32-byte token, a 16-byte salt, and a name padded to 256
# bytes plus its tag. The server never decodes the last two.
_TOKEN_PATTERN = re.compile(r'[A-Za-z0-9_-]{43}')
_SALT_PATTERN = re.compile(r'[A-Za-z0-9_-]{22}')
_ENCRYPTED_NAME_PATTERN = re.compile(r'[A-Za-z0-9_-]{363}')
# A transfer holds a Waitress thread while it streams; staying under Waitress's 4 threads
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
	salt: str
	encrypted_name: str
	size_bytes: int
	uploaded_at: datetime
	expires_at: datetime

	@property
	def stored_bytes(self) -> int:
		return _ciphertext_size(self.size_bytes)

	def to_json(self) -> dict:
		# Everything but the label, which would let anyone holding it skip the token.
		return {
			'id': self.id,
			'salt': self.salt,
			'encryptedName': self.encrypted_name,
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


def _parse_token(token: str) -> bytes:
	if not _TOKEN_PATTERN.fullmatch(token):
		# Also what a page loaded before browser encryption shipped would get.
		raise FileShareError('Missing or malformed access token; reload the page and try again.')
	return base64.urlsafe_b64decode(token + '=')


def build_label(token: str) -> str:
	# Over the decoded bytes, since a token's last character has two unused bits. Keyed with
	# SECRET_KEY, so the index alone can't be matched against tokens.
	pepper = current_app.config['SECRET_KEY'].encode('utf-8')
	return hmac.new(pepper, _parse_token(token), hashlib.sha256).hexdigest()


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


def get_records_for_token(token: str) -> list[FileShareRecord]:
	label = build_label(token)
	return [record for record in _store().sweep() if record.label == label]


def get_record_for_token(token: str, file_id: str) -> FileShareRecord | None:
	return next((r for r in get_records_for_token(token) if r.id == file_id), None)


def _ciphertext_size(plaintext_size: int) -> int:
	chunk_count = max(1, (plaintext_size + CHUNK_BYTES - 1) // CHUNK_BYTES)
	return plaintext_size + chunk_count * TAG_BYTES


def _plaintext_size(ciphertext_size: int) -> int | None:
	"""The inverse of `_ciphertext_size`, or None for a size the browser never produces."""
	full_chunks, rest = divmod(ciphertext_size, CHUNK_BYTES + TAG_BYTES)
	if rest == 0:
		chunk_count = full_chunks
	# A last chunk is at least a tag, and only an empty file's last chunk is just one.
	elif rest > TAG_BYTES or (rest == TAG_BYTES and full_chunks == 0):
		chunk_count = full_chunks + 1
	else:
		return None
	return ciphertext_size - chunk_count * TAG_BYTES if chunk_count else None


def _write_payload(source: BinaryIO, path: Path) -> None:
	with path.open('wb') as handle:
		shutil.copyfileobj(source, handle, CHUNK_BYTES)


def save_upload(
	uploaded_file: FileStorage | None,
	token: str,
	salt: str,
	encrypted_name: str,
	replace: bool = False,
) -> FileShareRecord:
	"""Store an encrypted file under the token, evicting the oldest files if over quota.

	`replace` deletes the token's earlier files, but only once this one is stored, so a
	failed upload leaves them in place.
	"""
	label = build_label(token)
	if uploaded_file is None:
		raise FileShareError('A file is required.')
	if not (_SALT_PATTERN.fullmatch(salt) and _ENCRYPTED_NAME_PATTERN.fullmatch(encrypted_name)):
		raise FileShareError('Missing or malformed file salt or name.')

	# Werkzeug has already spooled the upload to disk, so measure it without reading it.
	source = uploaded_file.stream
	stored_bytes = source.seek(0, os.SEEK_END)
	source.seek(0)
	size_bytes = _plaintext_size(stored_bytes)
	if size_bytes is None:
		raise FileShareError('The upload is not a validly encrypted file.')
	if size_bytes > MAX_FILE_BYTES:
		raise FileShareError(f'File exceeds the {MAX_FILE_BYTES // 1_000_000} MB limit.', 413)

	store = _store()
	file_id = secrets.token_hex(16)
	payload_path = store.payload_path(file_id)
	try:
		_write_payload(source, payload_path)
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
		salt=salt,
		encrypted_name=encrypted_name,
		size_bytes=size_bytes,
		uploaded_at=now,
		expires_at=now + timedelta(seconds=RETENTION_SECONDS),
	)
	store.add(record, replace=replace)
	return record


def open_record_payload(record: FileShareRecord) -> FileWrapper:
	"""The stored ciphertext as chunks, closing the payload when the iterator is closed."""
	# Open now, so a missing file still gets an error response. Catch the failed open rather
	# than checking exists(): a sweep can delete it in between.
	try:
		handle = _store().payload_path(record.id).open('rb')
	except FileNotFoundError:
		raise FileShareError('The requested file is no longer available.', 404) from None
	return FileWrapper(handle, CHUNK_BYTES)

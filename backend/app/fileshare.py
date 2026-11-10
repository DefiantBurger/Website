"""Temporary encrypted file storage keyed by an access key.

Each file is a pair in `<instance>/fileshare/`: `<label>.json` (metadata) and
`<label>.payload` (AES-GCM ciphertext). Further files under the same key use
`<label>__2`, `<label>__3`, ... The label is an HMAC of the access key, so the
key itself is never stored.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import threading
import unicodedata
from collections.abc import Callable, Iterable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
from flask import current_app
from werkzeug.datastructures import FileStorage
from werkzeug.utils import secure_filename

# Below Cloudflare's 100 MB request limit with room for multipart overhead.
MAX_FILE_BYTES = 80 * 1_000_000
MAX_TOTAL_STORAGE_BYTES = 1_000_000_000
RETENTION_SECONDS = 10 * 60
STORAGE_DIR_NAME = 'fileshare'
META_SUFFIX = '.json'
PAYLOAD_SUFFIX = '.payload'
SALT_BYTES = 16
NONCE_BYTES = 12
KDF_LENGTH = 32
KDF_N = 2**14
KDF_R = 8
KDF_P = 1
# Each transfer holds roughly 3x the file size in memory (plaintext + ciphertext +
# buffers), so this keeps two 80 MB transfers within the VM's 1 GB of RAM.
MAX_CONCURRENT_TRANSFERS = 2
MAX_INDEX_CLAIM_ATTEMPTS = 10

_transfer_slots = threading.BoundedSemaphore(MAX_CONCURRENT_TRANSFERS)


class FileShareError(RuntimeError):
	def __init__(self, message: str, status_code: int = 400):
		super().__init__(message)
		self.message = message
		self.status_code = status_code


@dataclass(frozen=True)
class FileShareRecord:
	label: str
	occurrence_index: int
	original_filename: str
	size_bytes: int
	mime_type: str
	uploaded_at: str
	expires_at: str
	salt_b64: str
	nonce_b64: str


def build_label(password: str) -> str:
	# Keyed with SECRET_KEY (a pepper) so labels on disk can't be brute-forced
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


def _storage_root() -> Path:
	root = Path(current_app.instance_path) / STORAGE_DIR_NAME
	root.mkdir(parents=True, exist_ok=True)
	return root


def _record_stem(label: str, occurrence_index: int) -> str:
	return label if occurrence_index == 1 else f'{label}__{occurrence_index}'


def _parse_stem(stem: str) -> tuple[str, int] | None:
	"""Inverse of `_record_stem`: `(label, occurrence_index)`, or None for a malformed name."""
	label, sep, suffix = stem.partition('__')
	if not sep:
		return label, 1
	if not (suffix.isascii() and suffix.isdigit()):
		return None
	return label, int(suffix)


def _record_paths(label: str, occurrence_index: int = 1) -> tuple[Path, Path]:
	base = _storage_root() / _record_stem(label, occurrence_index)
	return base.with_suffix(META_SUFFIX), base.with_suffix(PAYLOAD_SUFFIX)


def _existing_indices(label: str) -> list[int]:
	indices: set[int] = set()
	for path in _storage_root().glob(f'{label}*'):
		parsed = _parse_stem(path.name.split('.', 1)[0])
		if parsed is not None and parsed[0] == label:
			indices.add(parsed[1])
	return sorted(indices)


def _b64encode(raw: bytes) -> str:
	return base64.b64encode(raw).decode('ascii')


def _b64decode(value: str) -> bytes:
	return base64.b64decode(value.encode('ascii'))


def _parse_timestamp(value: str) -> datetime:
	parsed = datetime.fromisoformat(value)
	if parsed.tzinfo is None:
		return parsed.replace(tzinfo=UTC)
	return parsed.astimezone(UTC)


def _derive_key(password: str, salt: bytes) -> bytes:
	kdf = Scrypt(salt=salt, length=KDF_LENGTH, n=KDF_N, r=KDF_R, p=KDF_P)
	return kdf.derive(password.encode('utf-8'))


def _load_record(meta_path: Path) -> FileShareRecord | None:
	"""Read one record; None if it is unreadable or its payload is missing."""
	parsed = _parse_stem(meta_path.stem)
	if parsed is None:
		return None
	label, occurrence_index = parsed

	try:
		payload = json.loads(meta_path.read_text(encoding='utf-8'))
		# Required, not defaulted: falsy-chaining it once reported empty files as 16 bytes.
		size_bytes = int(payload['size_bytes'])
	except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError):
		return None
	if not meta_path.with_suffix(PAYLOAD_SUFFIX).exists():
		return None

	return FileShareRecord(
		label=label,
		occurrence_index=occurrence_index,
		original_filename=str(payload.get('original_filename') or 'download'),
		size_bytes=size_bytes,
		mime_type=str(payload.get('mime_type') or 'application/octet-stream'),
		uploaded_at=str(payload.get('uploaded_at') or ''),
		expires_at=str(payload.get('expires_at') or ''),
		salt_b64=str(payload.get('salt_b64') or ''),
		nonce_b64=str(payload.get('nonce_b64') or ''),
	)


def _unlink(*paths: Path) -> None:
	for path in paths:
		path.unlink(missing_ok=True)


def _remove_record(label: str, occurrence_index: int) -> None:
	_unlink(*_record_paths(label, occurrence_index))


def _payload_size(record: FileShareRecord) -> int:
	_, payload_path = _record_paths(record.label, record.occurrence_index)
	try:
		return payload_path.stat().st_size
	except OSError:
		return 0


def _is_expired(record: FileShareRecord, now: datetime) -> bool:
	try:
		return now >= _parse_timestamp(record.expires_at)
	except ValueError:
		return True


def _sweep(now: datetime | None = None) -> tuple[list[FileShareRecord], int]:
	"""Delete expired or unreadable records in one pass over the metadata.

	Returns the remaining records, ordered by label then index, and how many were deleted.
	"""
	current_time = now or _now_utc()
	active: list[FileShareRecord] = []
	deleted_count = 0

	for meta_path in _storage_root().glob(f'*{META_SUFFIX}'):
		record = _load_record(meta_path)
		if record is not None and not _is_expired(record, current_time):
			active.append(record)
			continue
		# Unlink by path so an unreadable record's payload doesn't linger outside the quota.
		_unlink(meta_path, meta_path.with_suffix(PAYLOAD_SUFFIX))
		deleted_count += 1

	active.sort(key=lambda record: (record.label, record.occurrence_index))
	return active, deleted_count


def cleanup_expired_records(now: datetime | None = None) -> int:
	"""Delete expired or unreadable records; returns how many were removed."""
	return _sweep(now)[1]


def get_storage_status() -> dict[str, int | bool]:
	records, _ = _sweep()
	return {
		'activeFileCount': len(records),
		'usedBytes': sum(_payload_size(record) for record in records),
		'maxFileBytes': MAX_FILE_BYTES,
		'maxTotalBytes': MAX_TOTAL_STORAGE_BYTES,
		'retentionSeconds': RETENTION_SECONDS,
	}


def get_all_records_for_password(password: str) -> list[FileShareRecord]:
	label = build_label(password)
	return [record for record in _sweep()[0] if record.label == label]


def get_record_for_password(
	password: str, occurrence_index: int | None = None
) -> FileShareRecord | None:
	"""Return the key's record at `occurrence_index`, or its first record when None."""
	records = get_all_records_for_password(password)
	if occurrence_index is None:
		return records[0] if records else None
	return next((r for r in records if r.occurrence_index == occurrence_index), None)


def _encrypt_bytes(password: str, plaintext: bytes) -> tuple[bytes, str, str]:
	salt = os.urandom(SALT_BYTES)
	nonce = os.urandom(NONCE_BYTES)
	key = _derive_key(password, salt)
	ciphertext = AESGCM(key).encrypt(nonce, plaintext, None)
	return ciphertext, _b64encode(salt), _b64encode(nonce)


def _decrypt_bytes(password: str, record: FileShareRecord, ciphertext: bytes) -> bytes:
	if not record.salt_b64 or not record.nonce_b64:
		raise FileShareError('Stored encryption metadata is missing.', 500)

	salt = _b64decode(record.salt_b64)
	nonce = _b64decode(record.nonce_b64)
	key = _derive_key(password, salt)
	return AESGCM(key).decrypt(nonce, ciphertext, None)


def _to_ascii(text: str) -> str:
	"""Strip accents deterministically (`café` -> `cafe`); characters with no ASCII form are dropped."""
	return unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode('ascii')


def _sanitize_original_filename(filename: str) -> str:
	clean_name = secure_filename(_to_ascii(filename)).strip()

	stem, ext = os.path.splitext(os.path.basename(filename.replace('\\', '/')))
	if not filename.isascii() and stem.strip() and not secure_filename(_to_ascii(stem)):
		# Nothing in the name survives ASCII conversion (e.g. `日本語.pdf`), so keep the
		# extension and use a placeholder stem that is stable for the same name.
		digest = hashlib.sha256(stem.encode('utf-8')).hexdigest()[:8]
		clean_ext = secure_filename(_to_ascii(ext.lstrip('.')))
		clean_name = f'file-{digest}.{clean_ext}' if clean_ext else f'file-{digest}'

	return clean_name or 'download'


def _evict_oldest_records(records: list[FileShareRecord], required_free_bytes: int) -> int:
	"""Delete `records` oldest-upload-first until at least `required_free_bytes` are freed; returns bytes freed."""
	if required_free_bytes <= 0:
		return 0

	try:
		ordered = sorted(records, key=lambda record: _parse_timestamp(record.uploaded_at))
	except ValueError:
		ordered = records

	freed_bytes = 0
	for record in ordered:
		if freed_bytes >= required_free_bytes:
			break
		freed_bytes += _payload_size(record)
		_remove_record(record.label, record.occurrence_index)

	return freed_bytes


def _write_new_payload(label: str, ciphertext: bytes) -> int:
	"""Store the payload at the label's next free index and return that index.

	Mode 'x' makes claiming an index atomic: if a concurrent upload under the same key
	took it first, move on to the next index instead of overwriting that file.
	"""
	for _ in range(MAX_INDEX_CLAIM_ATTEMPTS):
		occurrence_index = max(_existing_indices(label), default=0) + 1
		_, payload_path = _record_paths(label, occurrence_index)
		try:
			handle = payload_path.open('xb')
		except FileExistsError:
			continue
		try:
			with handle:
				handle.write(ciphertext)
		except BaseException:
			payload_path.unlink(missing_ok=True)
			raise
		return occurrence_index

	raise FileShareError('The file share is busy right now; try again in a moment.', 503)


def _write_text_atomically(path: Path, text: str) -> None:
	# Sweeps delete metadata they can't parse, so they must never see a half-written file.
	# The dot prefix keeps the temp file out of the `*.json` and `<label>*` globs.
	temp_path = path.with_name(f'.{path.name}.tmp')
	try:
		temp_path.write_text(text, encoding='utf-8')
		temp_path.replace(path)
	except BaseException:
		temp_path.unlink(missing_ok=True)
		raise


def save_upload(uploaded_file: FileStorage, password: str) -> FileShareRecord:
	"""Encrypt and store a file at the key's next occurrence index, evicting old files if over quota."""
	if not password.strip():
		raise FileShareError('Access key is required.')
	if uploaded_file.filename is None or not uploaded_file.filename.strip():
		raise FileShareError('A file is required.')

	plaintext = uploaded_file.read()
	if isinstance(plaintext, str):
		plaintext = plaintext.encode('utf-8')
	if plaintext is None:
		plaintext = b''
	if len(plaintext) > MAX_FILE_BYTES:
		raise FileShareError(f'File exceeds the {MAX_FILE_BYTES // 1_000_000} MB limit.', 413)

	ciphertext, salt_b64, nonce_b64 = _encrypt_bytes(password, plaintext)
	records, _ = _sweep()
	used_bytes = sum(_payload_size(record) for record in records)
	required_free_bytes = used_bytes + len(ciphertext) - MAX_TOTAL_STORAGE_BYTES
	if required_free_bytes >= 0:
		freed_bytes = _evict_oldest_records(records, required_free_bytes + 1)
		if freed_bytes <= required_free_bytes:
			raise FileShareError('Not enough storage available; try again later.', 503)

	label = build_label(password)
	now = _now_utc()
	record = FileShareRecord(
		label=label,
		occurrence_index=0,  # Set once the payload has claimed an index.
		original_filename=_sanitize_original_filename(uploaded_file.filename),
		size_bytes=len(plaintext),
		mime_type=uploaded_file.mimetype or 'application/octet-stream',
		uploaded_at=now.isoformat(),
		expires_at=(now + timedelta(seconds=RETENTION_SECONDS)).isoformat(),
		salt_b64=salt_b64,
		nonce_b64=nonce_b64,
	)
	metadata = {
		'original_filename': record.original_filename,
		'size_bytes': record.size_bytes,
		'mime_type': record.mime_type,
		'uploaded_at': record.uploaded_at,
		'expires_at': record.expires_at,
		'salt_b64': record.salt_b64,
		'nonce_b64': record.nonce_b64,
	}

	occurrence_index: int | None = None
	try:
		occurrence_index = _write_new_payload(label, ciphertext)
		meta_path, _ = _record_paths(label, occurrence_index)
		_write_text_atomically(meta_path, json.dumps(metadata, indent=2, sort_keys=True))
	except OSError as exc:
		if occurrence_index is not None:
			_remove_record(label, occurrence_index)
		current_app.logger.exception('Failed to store fileshare upload')
		raise FileShareError('Failed to store upload.', 500) from exc

	return replace(record, occurrence_index=occurrence_index)


def delete_records(password: str, occurrence_indices: Iterable[int]) -> int:
	"""Delete the key's files at the given indices (missing ones are skipped); returns how many were removed."""
	if not password.strip():
		raise FileShareError('Access key is required.')

	label = build_label(password)
	targets = set(_existing_indices(label)).intersection(occurrence_indices)
	for occurrence_index in targets:
		_remove_record(label, occurrence_index)
	return len(targets)


def decrypt_record_payload(record: FileShareRecord, password: str) -> bytes:
	_, payload_path = _record_paths(record.label, record.occurrence_index)
	if not payload_path.exists():
		raise FileShareError('The requested file is no longer available.', 404)

	ciphertext = payload_path.read_bytes()
	try:
		return _decrypt_bytes(password, record, ciphertext)
	except Exception as exc:
		raise FileShareError('Incorrect access key or corrupted file.', 403) from exc

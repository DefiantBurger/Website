from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import base64
import hashlib
import json
import os
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
from flask import current_app
from werkzeug.datastructures import FileStorage
from werkzeug.utils import secure_filename

MAX_FILE_BYTES = 100 * 1_000_000
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
	stored_filename: str
	size_bytes: int
	mime_type: str
	uploaded_at: str
	expires_at: str
	salt_b64: str
	nonce_b64: str


def build_label(password: str) -> str:
	return hashlib.sha256(password.encode('utf-8')).hexdigest()


def _now_utc() -> datetime:
	return datetime.now(timezone.utc)


def _storage_root() -> Path:
	root = Path(current_app.instance_path) / STORAGE_DIR_NAME
	root.mkdir(parents=True, exist_ok=True)
	return root


def _record_paths(label: str, occurrence_index: int = 1) -> tuple[Path, Path]:
	root = _storage_root()
	if occurrence_index == 1:
		return root / f'{label}{META_SUFFIX}', root / f'{label}{PAYLOAD_SUFFIX}'

	return (
		root / f'{label}__{occurrence_index}{META_SUFFIX}',
		root / f'{label}__{occurrence_index}{PAYLOAD_SUFFIX}',
	)


def _b64encode(raw: bytes) -> str:
	return base64.b64encode(raw).decode('ascii')


def _b64decode(value: str) -> bytes:
	return base64.b64decode(value.encode('ascii'))


def _parse_timestamp(value: str) -> datetime:
	parsed = datetime.fromisoformat(value)
	if parsed.tzinfo is None:
		return parsed.replace(tzinfo=timezone.utc)
	return parsed.astimezone(timezone.utc)


def _derive_key(password: str, salt: bytes) -> bytes:
	kdf = Scrypt(salt=salt, length=KDF_LENGTH, n=KDF_N, r=KDF_R, p=KDF_P)
	return kdf.derive(password.encode('utf-8'))


def _extract_occurrence_index(meta_path: Path, payload: dict) -> int:
	value = payload.get('occurrence_index')
	if value is not None:
		try:
			return int(value)
		except (TypeError, ValueError):
			return 1

	stem = meta_path.stem
	if '__' in stem:
		_, suffix = stem.rsplit('__', 1)
		try:
			return int(suffix)
		except ValueError:
			return 1

	return 1


def _load_record(meta_path: Path) -> FileShareRecord | None:
	try:
		payload = json.loads(meta_path.read_text(encoding='utf-8'))
	except (OSError, json.JSONDecodeError):
		return None

	label = str(payload.get('label') or meta_path.stem.split('__', 1)[0])
	occurrence_index = _extract_occurrence_index(meta_path, payload)
	_, payload_path = _record_paths(label, occurrence_index)
	if not payload_path.exists():
		return None

	try:
		size_bytes = int(payload.get('size_bytes') or payload.get('stored_size_bytes') or payload_path.stat().st_size)
	except (TypeError, ValueError, OSError):
		return None

	return FileShareRecord(
		label=label,
		occurrence_index=occurrence_index,
		original_filename=str(payload.get('original_filename') or 'download'),
		stored_filename=str(payload.get('stored_filename') or payload_path.name),
		size_bytes=size_bytes,
		mime_type=str(payload.get('mime_type') or 'application/octet-stream'),
		uploaded_at=str(payload.get('uploaded_at') or ''),
		expires_at=str(payload.get('expires_at') or ''),
		salt_b64=str(payload.get('salt_b64') or ''),
		nonce_b64=str(payload.get('nonce_b64') or ''),
	)


def _remove_record(label: str, occurrence_index: int | None = None) -> None:
	if occurrence_index is not None:
		paths = [_record_paths(label, occurrence_index)]
	else:
		paths = []
		for idx in range(1, 100):
			meta_path, payload_path = _record_paths(label, idx)
			if not meta_path.exists() and not payload_path.exists():
				break
			paths.append((meta_path, payload_path))

	for meta_path, payload_path in paths:
		for path in (meta_path, payload_path):
			try:
				path.unlink()
			except FileNotFoundError:
				continue


def cleanup_expired_records(now: datetime | None = None) -> int:
	root = _storage_root()
	current_time = now or _now_utc()
	deleted_count = 0

	for meta_path in root.glob(f'*{META_SUFFIX}'):
		record = _load_record(meta_path)
		if record is None:
			deleted_count += 1
			try:
				meta_path.unlink()
			except FileNotFoundError:
				pass
			continue

		try:
			expires_at = _parse_timestamp(record.expires_at)
		except ValueError:
			_remove_record(record.label, record.occurrence_index)
			deleted_count += 1
			continue

		if current_time >= expires_at:
			_remove_record(record.label, record.occurrence_index)
			deleted_count += 1

	return deleted_count


def iter_active_records() -> list[FileShareRecord]:
	cleanup_expired_records()
	root = _storage_root()
	records: list[FileShareRecord] = []

	for meta_path in sorted(root.glob(f'*{META_SUFFIX}')):
		record = _load_record(meta_path)
		if record is not None:
			records.append(record)

	return records


def get_storage_status() -> dict[str, int | bool]:
	records = iter_active_records()
	used_bytes = 0
	for record in records:
		_, payload_path = _record_paths(record.label, record.occurrence_index)
		try:
			used_bytes += payload_path.stat().st_size
		except OSError:
			continue

	return {
		'activeFileCount': len(records),
		'usedBytes': used_bytes,
		'maxFileBytes': MAX_FILE_BYTES,
		'maxTotalBytes': MAX_TOTAL_STORAGE_BYTES,
		'retentionSeconds': RETENTION_SECONDS,
		'uploadsPaused': used_bytes >= MAX_TOTAL_STORAGE_BYTES,
	}


def get_record_for_password(password: str, occurrence_index: int | None = None) -> FileShareRecord | None:
	label = build_label(password)
	cleanup_expired_records()

	if occurrence_index is not None:
		meta_path, _ = _record_paths(label, occurrence_index)
		return _load_record(meta_path)

	for idx in range(1, 100):
		meta_path, _ = _record_paths(label, idx)
		record = _load_record(meta_path)
		if record is not None:
			return record

	return None


def get_all_records_for_password(password: str) -> list[FileShareRecord]:
	label = build_label(password)
	cleanup_expired_records()
	records: list[FileShareRecord] = []

	for idx in range(1, 100):
		meta_path, _ = _record_paths(label, idx)
		record = _load_record(meta_path)
		if record is not None:
			records.append(record)

	return records


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


def _sanitize_original_filename(filename: str) -> str:
	clean_name = secure_filename(filename).strip()
	return clean_name or 'download'


def _evict_oldest_records(required_free_bytes: int) -> int:
	if required_free_bytes <= 0:
		return 0

	records = iter_active_records()
	try:
		sorted_records = sorted(records, key=lambda record: _parse_timestamp(record.uploaded_at))
	except ValueError:
		sorted_records = records

	freed_bytes = 0
	for record in sorted_records:
		if freed_bytes >= required_free_bytes:
			break

		_, payload_path = _record_paths(record.label, record.occurrence_index)
		try:
			freed_bytes += payload_path.stat().st_size
		except OSError:
			freed_bytes += int(record.size_bytes)
		_remove_record(record.label, record.occurrence_index)

	return freed_bytes


def save_upload(uploaded_file: FileStorage, password: str, clear_existing: bool = False) -> FileShareRecord:
	if not password.strip():
		raise FileShareError('Access key is required.')
	if uploaded_file.filename is None or not uploaded_file.filename.strip():
		raise FileShareError('A file is required.')

	cleanup_expired_records()
	label = build_label(password)

	if clear_existing:
		_remove_record(label)
		occurrence_index = 1
	else:
		occurrence_index = 1
		while True:
			meta_path, payload_path = _record_paths(label, occurrence_index)
			if not meta_path.exists() and not payload_path.exists():
				break
			occurrence_index += 1

	meta_path, payload_path = _record_paths(label, occurrence_index)
	plaintext = uploaded_file.read()
	if isinstance(plaintext, str):
		plaintext = plaintext.encode('utf-8')
	if plaintext is None:
		plaintext = b''
	if len(plaintext) > MAX_FILE_BYTES:
		raise FileShareError('File exceeds the 100 MB limit.', 413)

	ciphertext, salt_b64, nonce_b64 = _encrypt_bytes(password, plaintext)
	current_status = get_storage_status()
	required_free_bytes = (int(current_status['usedBytes']) + len(ciphertext)) - MAX_TOTAL_STORAGE_BYTES
	if required_free_bytes >= 0:
		_evict_oldest_records(required_free_bytes + 1)
		current_status = get_storage_status()
		if int(current_status['usedBytes']) + len(ciphertext) >= MAX_TOTAL_STORAGE_BYTES:
			raise FileShareError('Not enough storage available; try again later.', 503)

	now = _now_utc()
	original_filename = _sanitize_original_filename(uploaded_file.filename)
	metadata = {
		'label': label,
		'occurrence_index': occurrence_index,
		'original_filename': original_filename,
		'stored_filename': payload_path.name,
		'size_bytes': len(plaintext),
		'stored_size_bytes': len(ciphertext),
		'mime_type': uploaded_file.mimetype or 'application/octet-stream',
		'uploaded_at': now.isoformat(),
		'expires_at': (now + timedelta(seconds=RETENTION_SECONDS)).isoformat(),
		'salt_b64': salt_b64,
		'nonce_b64': nonce_b64,
	}

	try:
		payload_path.write_bytes(ciphertext)
		meta_path.write_text(json.dumps(metadata, indent=2, sort_keys=True), encoding='utf-8')
	except Exception as exc:
		_remove_record(label, occurrence_index)
		raise FileShareError(f'Failed to store upload: {exc}') from exc

	return FileShareRecord(
		label=label,
		occurrence_index=occurrence_index,
		original_filename=original_filename,
		stored_filename=payload_path.name,
		size_bytes=len(plaintext),
		mime_type=metadata['mime_type'],
		uploaded_at=metadata['uploaded_at'],
		expires_at=metadata['expires_at'],
		salt_b64=salt_b64,
		nonce_b64=nonce_b64,
	)


def decrypt_record_payload(record: FileShareRecord, password: str) -> bytes:
	_, payload_path = _record_paths(record.label, record.occurrence_index)
	if not payload_path.exists():
		raise FileShareError('The requested file is no longer available.', 404)

	ciphertext = payload_path.read_bytes()
	try:
		return _decrypt_bytes(password, record, ciphertext)
	except Exception as exc:
		raise FileShareError('Incorrect access key or corrupted file.', 403) from exc
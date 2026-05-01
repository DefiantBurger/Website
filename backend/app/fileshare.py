from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
import hashlib
import json
import os

from flask import current_app
from werkzeug.datastructures import FileStorage
from werkzeug.utils import secure_filename

MAX_FILE_BYTES = 50 * 1_000_000
MAX_TOTAL_STORAGE_BYTES = 1_000_000_000
RETENTION_SECONDS = 10 * 60
STORAGE_DIR_NAME = 'fileshare'
PAYLOAD_SUFFIX = '.payload'
META_SUFFIX = '.json'


class FileShareError(RuntimeError):
	def __init__(self, message: str, status_code: int = 400):
		super().__init__(message)
		self.message = message
		self.status_code = status_code


@dataclass(frozen=True)
class FileShareRecord:
	label: str
	original_filename: str
	stored_filename: str
	size_bytes: int
	mime_type: str
	uploaded_at: str
	expires_at: str


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
		meta = root / f'{label}{META_SUFFIX}'
		payload = root / f'{label}{PAYLOAD_SUFFIX}'
	else:
		meta = root / f'{label}__{occurrence_index}{META_SUFFIX}'
		payload = root / f'{label}__{occurrence_index}{PAYLOAD_SUFFIX}'
	return meta, payload


def _parse_timestamp(value: str) -> datetime:
	parsed = datetime.fromisoformat(value)
	if parsed.tzinfo is None:
		return parsed.replace(tzinfo=timezone.utc)
	return parsed.astimezone(timezone.utc)


def _record_from_metadata(meta_path: Path) -> FileShareRecord | None:
	try:
		payload = json.loads(meta_path.read_text(encoding='utf-8'))
	except (OSError, json.JSONDecodeError):
		return None

	label = str(payload.get('label') or meta_path.stem)
	_, payload_path = _record_paths(label)
	if not payload_path.exists():
		return None

	try:
		size_bytes = int(payload.get('size_bytes') or payload_path.stat().st_size)
	except (TypeError, ValueError, OSError):
		return None

	return FileShareRecord(
		label=label,
		original_filename=str(payload.get('original_filename') or 'download'),
		stored_filename=str(payload.get('stored_filename') or payload_path.name),
		size_bytes=size_bytes,
		mime_type=str(payload.get('mime_type') or 'application/octet-stream'),
		uploaded_at=str(payload.get('uploaded_at') or ''),
		expires_at=str(payload.get('expires_at') or ''),
	)


def _remove_record_files(label: str, occurrence_index: int | None = None) -> None:
	if occurrence_index is not None:
		meta_path, payload_path = _record_paths(label, occurrence_index)
		for path in (meta_path, payload_path):
			try:
				path.unlink()
			except FileNotFoundError:
				continue
	else:
		# Remove all occurrences for this label
		for idx in range(1, 100):
			meta_path, payload_path = _record_paths(label, idx)
			for path in (meta_path, payload_path):
				try:
					path.unlink()
				except FileNotFoundError:
					pass
			if not meta_path.exists() and not payload_path.exists():
				break


def _cleanup_record(label: str, occurrence_index: int | None = None) -> None:
	_remove_record_files(label, occurrence_index)


def cleanup_expired_records(now: datetime | None = None) -> int:
	root = _storage_root()
	current_time = now or _now_utc()
	deleted_count = 0

	for meta_path in root.glob(f'*{META_SUFFIX}'):
		record = _record_from_metadata(meta_path)
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
			_cleanup_record(record.label)
			deleted_count += 1
			continue

		if current_time >= expires_at:
			_cleanup_record(record.label)
			deleted_count += 1

	return deleted_count


def iter_active_records() -> list[FileShareRecord]:
	cleanup_expired_records()
	root = _storage_root()
	records: list[FileShareRecord] = []

	for meta_path in sorted(root.glob(f'*{META_SUFFIX}')):
		record = _record_from_metadata(meta_path)
		if record is None:
			continue
		records.append(record)

	return records


def get_storage_status() -> dict[str, int | bool]:
	records = iter_active_records()
	used_bytes = 0
	for record in records:
		_, payload_path = _record_paths(record.label)
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
		return _record_from_metadata(meta_path)
	
	# Return the first (most recently added if we iterate in order) active record for this label
	# Try default index first, then check for occurrence variants
	for idx in range(1, 100):  # Reasonable upper limit
		meta_path, _ = _record_paths(label, idx)
		record = _record_from_metadata(meta_path)
		if record is not None:
			return record
	
	return None


def get_all_records_for_password(password: str) -> list[FileShareRecord]:
	label = build_label(password)
	cleanup_expired_records()
	records: list[FileShareRecord] = []
	
	for idx in range(1, 100):  # Reasonable upper limit
		meta_path, _ = _record_paths(label, idx)
		record = _record_from_metadata(meta_path)
		if record is not None:
			records.append(record)
	
	return records


def _measure_upload_size(uploaded_file: FileStorage) -> int:
	if uploaded_file.content_length is not None:
		return int(uploaded_file.content_length)

	stream = uploaded_file.stream
	position = stream.tell()
	stream.seek(0, os.SEEK_END)
	size_bytes = stream.tell()
	stream.seek(position)
	return int(size_bytes)


def _sanitize_original_filename(filename: str) -> str:
	clean_name = secure_filename(filename).strip()
	return clean_name or 'download'


def _store_file(uploaded_file: FileStorage, payload_path: Path) -> None:
	uploaded_file.stream.seek(0)
	uploaded_file.save(payload_path)


def save_upload(uploaded_file: FileStorage, password: str, clear_existing: bool = False) -> FileShareRecord:
	if not password.strip():
		raise FileShareError('Password is required.')
	if uploaded_file.filename is None or not uploaded_file.filename.strip():
		raise FileShareError('A file is required.')

	cleanup_expired_records()
	label = build_label(password)
	
	if clear_existing:
		# Delete all existing files for this access key (first file in a batch)
		for idx in range(1, 100):
			test_meta, test_payload = _record_paths(label, idx)
			if test_meta.exists() or test_payload.exists():
				_cleanup_record(label, idx)
			else:
				break
		occurrence_index = 1
	else:
		# Find next available occurrence index (subsequent files in batch)
		occurrence_index = 1
		while True:
			meta_path, payload_path = _record_paths(label, occurrence_index)
			if not (meta_path.exists() and payload_path.exists()):
				break
			occurrence_index += 1

	meta_path, payload_path = _record_paths(label, occurrence_index)
	size_bytes = _measure_upload_size(uploaded_file)
	if size_bytes > MAX_FILE_BYTES:
		raise FileShareError('File exceeds the 50 MB limit.', 413)

	status = get_storage_status()
	if int(status['usedBytes']) + size_bytes >= MAX_TOTAL_STORAGE_BYTES:
		raise FileShareError('Uploads are paused until live storage drops below 1 GB.', 503)

	original_filename = _sanitize_original_filename(uploaded_file.filename)
	stored_filename = payload_path.name
	now = _now_utc()
	metadata = {
		'label': label,
		'occurrence_index': occurrence_index,
		'original_filename': original_filename,
		'stored_filename': stored_filename,
		'size_bytes': size_bytes,
		'mime_type': uploaded_file.mimetype or 'application/octet-stream',
		'uploaded_at': now.isoformat(),
		'expires_at': (now + timedelta(seconds=RETENTION_SECONDS)).isoformat(),
	}

	try:
		_store_file(uploaded_file, payload_path)
		meta_path.write_text(json.dumps(metadata, indent=2, sort_keys=True), encoding='utf-8')
	except Exception as exc:
		_cleanup_record(label)
		raise FileShareError(f'Failed to store upload: {exc}') from exc

	return FileShareRecord(
		label=label,
		original_filename=original_filename,
		stored_filename=stored_filename,
		size_bytes=size_bytes,
		mime_type=metadata['mime_type'],
		uploaded_at=metadata['uploaded_at'],
		expires_at=metadata['expires_at'],
	)


def resolve_download_path(record: FileShareRecord) -> Path:
	_, payload_path = _record_paths(record.label)
	if not payload_path.exists():
		raise FileShareError('The requested file is no longer available.', 404)
	return payload_path

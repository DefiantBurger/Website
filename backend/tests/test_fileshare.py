import json
import shutil
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from app import create_app
from app.fileshare import (
	MAX_FILE_BYTES,
	FileShareError,
	FileShareRecord,
	_b64decode,
	_b64encode,
	_decrypt_bytes,
	_derive_key,
	_encrypt_bytes,
	_evict_oldest_records,
	_extract_occurrence_index,
	_parse_timestamp,
	_record_paths,
	_remove_record,
	_sanitize_original_filename,
	build_label,
	cleanup_expired_records,
	decrypt_record_payload,
	get_all_records_for_password,
	get_record_for_password,
	get_storage_status,
	iter_active_records,
	save_upload,
)
from werkzeug.datastructures import FileStorage


class TestFileShareCrypto(unittest.TestCase):
	def test_build_label_deterministic(self):
		with create_app(test_config={"SECRET_KEY": "test-key"}).app_context():
			label1 = build_label("secret-pass")
			label2 = build_label("secret-pass")
		self.assertEqual(label1, label2)
		self.assertEqual(len(label1), 64)

	def test_build_label_is_peppered_with_secret_key(self):
		import hashlib
		with create_app(test_config={"SECRET_KEY": "key-a"}).app_context():
			label_a = build_label("secret-pass")
		with create_app(test_config={"SECRET_KEY": "key-b"}).app_context():
			label_b = build_label("secret-pass")
		self.assertNotEqual(label_a, label_b)
		self.assertNotEqual(label_a, hashlib.sha256(b"secret-pass").hexdigest())

	def test_b64_encode_decode(self):
		raw = b"binary-data-\x00\xff\xfe"
		encoded = _b64encode(raw)
		self.assertIsInstance(encoded, str)
		decoded = _b64decode(encoded)
		self.assertEqual(raw, decoded)

	def test_derive_key_length(self):
		key = _derive_key("password123", b"0123456789abcdef")
		self.assertEqual(len(key), 32)

	def test_encrypt_and_decrypt_roundtrip(self):
		password = "my-secure-password"
		data = b"Confidential payload text for testing."
		ciphertext, salt_b64, nonce_b64 = _encrypt_bytes(password, data)
		self.assertNotEqual(ciphertext, data)

		dummy_record = FileShareRecord(
			label="label",
			occurrence_index=1,
			original_filename="test.txt",
			stored_filename="test.payload",
			size_bytes=len(data),
			mime_type="text/plain",
			uploaded_at="",
			expires_at="",
			salt_b64=salt_b64,
			nonce_b64=nonce_b64,
		)
		plaintext = _decrypt_bytes(password, dummy_record, ciphertext)
		self.assertEqual(plaintext, data)

	def test_decrypt_with_wrong_password_fails(self):
		password = "correct-password"
		data = b"Secret bytes"
		ciphertext, salt_b64, nonce_b64 = _encrypt_bytes(password, data)

		dummy_record = FileShareRecord(
			label="label",
			occurrence_index=1,
			original_filename="test.txt",
			stored_filename="test.payload",
			size_bytes=len(data),
			mime_type="text/plain",
			uploaded_at="",
			expires_at="",
			salt_b64=salt_b64,
			nonce_b64=nonce_b64,
		)
		with self.assertRaises(Exception):
			_decrypt_bytes("wrong-password", dummy_record, ciphertext)

	def test_decrypt_missing_salt_or_nonce_raises(self):
		dummy_record = FileShareRecord(
			label="label",
			occurrence_index=1,
			original_filename="test.txt",
			stored_filename="test.payload",
			size_bytes=10,
			mime_type="text/plain",
			uploaded_at="",
			expires_at="",
			salt_b64="",
			nonce_b64="",
		)
		with self.assertRaises(FileShareError) as ctx:
			_decrypt_bytes("password", dummy_record, b"some-ciphertext")
		self.assertEqual(ctx.exception.status_code, 500)


class TestFileShareSanitizationAndParsing(unittest.TestCase):
	def test_sanitize_original_filename(self):
		self.assertEqual(_sanitize_original_filename("test.pdf"), "test.pdf")
		self.assertEqual(_sanitize_original_filename("../../etc/passwd"), "etc_passwd")
		self.assertEqual(_sanitize_original_filename("   "), "download")
		self.assertEqual(_sanitize_original_filename("///"), "download")

	def test_extract_occurrence_index(self):
		# From payload dict
		self.assertEqual(_extract_occurrence_index(Path("foo.json"), {"occurrence_index": 3}), 3)
		# From filename stem
		self.assertEqual(_extract_occurrence_index(Path("abc__4.json"), {}), 4)
		# Fallback
		self.assertEqual(_extract_occurrence_index(Path("abc.json"), {}), 1)

	def test_parse_timestamp(self):
		# ISO with Z
		dt = _parse_timestamp("2026-10-01T12:00:00+00:00")
		self.assertEqual(dt.tzinfo, timezone.utc)
		# ISO naive assumes UTC
		dt_naive = _parse_timestamp("2026-10-01T12:00:00")
		self.assertEqual(dt_naive.tzinfo, timezone.utc)


class TestFileShareStorageLifecycle(unittest.TestCase):
	def setUp(self):
		self.temp_dir = tempfile.mkdtemp(prefix="test_fileshare_")
		self.app = create_app(
			test_config={"SECRET_KEY": "test-key", "TESTING": True},
			instance_path=self.temp_dir,
		)
		self.app_context = self.app.app_context()
		self.app_context.push()

	def tearDown(self):
		self.app_context.pop()
		shutil.rmtree(self.temp_dir, ignore_errors=True)

	def _create_mock_file(self, filename: str, content: bytes, content_type: str = "text/plain") -> FileStorage:
		return FileStorage(
			stream=BytesIO(content),
			filename=filename,
			content_type=content_type,
		)

	def test_save_upload_validation(self):
		file_obj = self._create_mock_file("sample.txt", b"hello")

		# Missing password
		with self.assertRaises(FileShareError) as ctx:
			save_upload(file_obj, "   ")
		self.assertEqual(ctx.exception.message, "Access key is required.")

		# Missing filename
		no_name_file = self._create_mock_file("", b"hello")
		with self.assertRaises(FileShareError) as ctx:
			save_upload(no_name_file, "key123")
		self.assertEqual(ctx.exception.message, "A file is required.")

	def test_save_upload_and_decrypt_record_success(self):
		file_obj = self._create_mock_file("sample.txt", b"Secret data content")
		record = save_upload(file_obj, "password123")

		self.assertEqual(record.original_filename, "sample.txt")
		self.assertEqual(record.size_bytes, len(b"Secret data content"))
		self.assertEqual(record.occurrence_index, 1)

		# Retrieve record
		retrieved = get_record_for_password("password123")
		self.assertIsNotNone(retrieved)
		self.assertEqual(retrieved.label, record.label)

		# Decrypt payload
		decrypted = decrypt_record_payload(retrieved, "password123")
		self.assertEqual(decrypted, b"Secret data content")

	def test_save_upload_wrong_password_decrypt_fails(self):
		file_obj = self._create_mock_file("sample.txt", b"Confidential")
		record = save_upload(file_obj, "correct-key")

		with self.assertRaises(FileShareError) as ctx:
			decrypt_record_payload(record, "wrong-key")
		self.assertEqual(ctx.exception.status_code, 403)

	def test_save_upload_clear_existing(self):
		# Upload first file
		f1 = self._create_mock_file("file1.txt", b"First")
		save_upload(f1, "shared-key", clear_existing=False)

		# Upload second file with same key, without clear_existing
		f2 = self._create_mock_file("file2.txt", b"Second")
		rec2 = save_upload(f2, "shared-key", clear_existing=False)
		self.assertEqual(rec2.occurrence_index, 2)

		all_records = get_all_records_for_password("shared-key")
		self.assertEqual(len(all_records), 2)

		# Upload third file with clear_existing=True
		f3 = self._create_mock_file("file3.txt", b"Third")
		rec3 = save_upload(f3, "shared-key", clear_existing=True)
		self.assertEqual(rec3.occurrence_index, 1)

		all_records_after = get_all_records_for_password("shared-key")
		self.assertEqual(len(all_records_after), 1)
		self.assertEqual(all_records_after[0].original_filename, "file3.txt")

	def test_clear_existing_removes_records_after_gap(self):
		rec1 = save_upload(self._create_mock_file("one.txt", b"1"), "gap-key")
		save_upload(self._create_mock_file("two.txt", b"2"), "gap-key")
		for path in _record_paths(rec1.label, rec1.occurrence_index):
			path.unlink()

		save_upload(self._create_mock_file("new.txt", b"3"), "gap-key", clear_existing=True)

		names = [r.original_filename for r in get_all_records_for_password("gap-key")]
		self.assertEqual(names, ["new.txt"])

	def test_cleanup_expired_records(self):
		now = datetime.now(timezone.utc)
		file_obj = self._create_mock_file("expire_me.txt", b"Temporary")
		_ = save_upload(file_obj, "temp-key")

		# Advance time past expiration (RETENTION_SECONDS is 600s = 10 min)
		future = now + timedelta(seconds=700)
		deleted = cleanup_expired_records(now=future)
		self.assertGreaterEqual(deleted, 1)

		# Should no longer be available
		self.assertIsNone(get_record_for_password("temp-key"))

	def test_cleanup_corrupted_records(self):
		# Create an orphaned metadata file with malformed JSON
		root = Path(self.temp_dir) / "fileshare"
		root.mkdir(parents=True, exist_ok=True)
		corrupt_meta = root / "corrupt_test.json"
		corrupt_meta.write_text("invalid json content")

		# Cleanup should remove the corrupt file
		deleted = cleanup_expired_records()
		self.assertGreaterEqual(deleted, 1)
		self.assertFalse(corrupt_meta.exists())

	def test_storage_status(self):
		status = get_storage_status()
		self.assertEqual(status["activeFileCount"], 0)
		self.assertEqual(status["usedBytes"], 0)
		self.assertFalse(status["uploadsPaused"])

		f = self._create_mock_file("doc.txt", b"12345")
		save_upload(f, "test-status-key")

		status2 = get_storage_status()
		self.assertEqual(status2["activeFileCount"], 1)
		self.assertGreater(status2["usedBytes"], 0)

	def test_decrypt_record_payload_file_missing(self):
		f = self._create_mock_file("doc.txt", b"12345")
		record = save_upload(f, "test-key-missing")
		_, payload_path = _record_paths(record.label, record.occurrence_index)
		payload_path.unlink()

		with self.assertRaises(FileShareError) as ctx:
			decrypt_record_payload(record, "test-key-missing")
		self.assertEqual(ctx.exception.status_code, 404)

	def test_evict_oldest_records(self):
		f1 = self._create_mock_file("old.txt", b"old content")
		_ = save_upload(f1, "key1")
		f2 = self._create_mock_file("new.txt", b"new content")
		_ = save_upload(f2, "key2")

		# Evict records to free at least 1 byte
		freed = _evict_oldest_records(required_free_bytes=1)
		self.assertGreater(freed, 0)
		# Oldest (rec1) should have been removed
		self.assertIsNone(get_record_for_password("key1"))

	def test_save_upload_oversized_file(self):
		f = self._create_mock_file("large.txt", b"12345678901234567890")
		with patch("app.fileshare.MAX_FILE_BYTES", 10):
			with self.assertRaises(FileShareError) as ctx:
				save_upload(f, "key-large")
			self.assertEqual(ctx.exception.status_code, 413)

	def test_cleanup_invalid_timestamp(self):
		f = self._create_mock_file("bad_time.txt", b"data")
		rec = save_upload(f, "key-bad-time")
		meta_path, _ = _record_paths(rec.label, rec.occurrence_index)

		# Modify metadata with an invalid expires_at
		meta = json.loads(meta_path.read_text(encoding="utf-8"))
		meta["expires_at"] = "not-a-valid-date"
		meta_path.write_text(json.dumps(meta), encoding="utf-8")

		deleted = cleanup_expired_records()
		self.assertGreaterEqual(deleted, 1)
		self.assertFalse(meta_path.exists())

	def test_save_upload_not_enough_storage_503(self):
		f = self._create_mock_file("file.txt", b"data")
		# Set MAX_TOTAL_STORAGE_BYTES very small so it cannot fit
		with patch("app.fileshare.MAX_TOTAL_STORAGE_BYTES", 5):
			with self.assertRaises(FileShareError) as ctx:
				save_upload(f, "key-no-space")
			self.assertEqual(ctx.exception.status_code, 503)


if __name__ == "__main__":
	unittest.main()

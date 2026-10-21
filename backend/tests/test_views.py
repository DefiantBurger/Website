import json
import shutil
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from app import create_app


class TestViewsAPI(unittest.TestCase):
	def setUp(self):
		self.temp_dir = tempfile.mkdtemp(prefix="test_views_")
		self.app = create_app(
			test_config={"SECRET_KEY": "test-views-secret", "TESTING": True},
			instance_path=self.temp_dir,
		)
		self.client = self.app.test_client()

	def tearDown(self):
		shutil.rmtree(self.temp_dir, ignore_errors=True)

	def test_scheduler_course_data(self):
		res = self.client.get("/api/scheduler/course-data/")
		self.assertEqual(res.status_code, 200)
		self.assertTrue(res.is_json)
		data = res.get_json()
		self.assertIsInstance(data, (dict, list))

	def test_scheduler_default_schedule(self):
		res = self.client.get("/api/scheduler/default-schedule/")
		self.assertEqual(res.status_code, 200)
		self.assertTrue(res.is_json)
		data = res.get_json()
		self.assertIsInstance(data, (dict, list))

	def test_projects_list(self):
		res = self.client.get("/api/projects/")
		self.assertEqual(res.status_code, 200)
		self.assertTrue(res.is_json)
		projects = res.get_json()
		self.assertIsInstance(projects, list)
		self.assertGreater(len(projects), 0)

		# Ensure priority and markdown are excluded from list view
		for proj in projects:
			self.assertIn("slug", proj)
			self.assertIn("title", proj)
			self.assertNotIn("markdown", proj)
			self.assertNotIn("_priority", proj)
			self.assertNotIn("_sort_priority", proj)

	def test_project_detail_existing(self):
		# Fetch list to pick first available slug
		list_res = self.client.get("/api/projects/")
		projects = list_res.get_json()
		slug = projects[0]["slug"]

		res = self.client.get(f"/api/projects/{slug}/")
		self.assertEqual(res.status_code, 200)
		data = res.get_json()
		self.assertEqual(data["slug"], slug)
		self.assertIn("markdown", data)
		self.assertNotIn("_priority", data)

	def test_project_detail_not_found(self):
		res = self.client.get("/api/projects/completely-nonexistent-project-slug-12345/")
		self.assertEqual(res.status_code, 404)

	def test_about_you_request_context(self):
		headers = {
			"CF-IPCountry": "US",
			"CF-IPCity": "Dallas",
			"CF-Connecting-IP": "198.51.100.1",
			"User-Agent": "TestBrowser/1.0",
			"Accept-Language": "en-US,en;q=0.9",
			"Referer": "https://example.com/ref",
			"DNT": "1",
		}
		res = self.client.get("/api/about-you/request-context/", headers=headers)
		self.assertEqual(res.status_code, 200)
		data = res.get_json()

		self.assertEqual(data["network"]["clientIp"], "198.51.100.1")
		self.assertEqual(data["network"]["clientIpMasked"], "198.51.100.x")
		self.assertEqual(data["network"]["ipSource"], "CF-Connecting-IP")
		self.assertTrue(data["network"]["hasForwardedHeaders"])
		self.assertEqual(data["headers"]["userAgent"], "TestBrowser/1.0")
		self.assertEqual(data["headers"]["acceptLanguage"], "en-US,en;q=0.9")
		self.assertEqual(data["headers"]["referer"], "https://example.com/ref")
		self.assertEqual(data["headers"]["doNotTrack"], "1")
		self.assertTrue(data["geolocation"]["available"])
		self.assertEqual(data["geolocation"]["city"], "Dallas")

	def test_fileshare_status_endpoint(self):
		res = self.client.get("/api/fileshare/status/")
		self.assertEqual(res.status_code, 200)
		data = res.get_json()
		self.assertIn("activeFileCount", data)
		self.assertIn("maxFileBytes", data)
		self.assertIn("retentionSeconds", data)

	def test_fileshare_upload_and_download_flow(self):
		# 1. Missing file
		res = self.client.post("/api/fileshare/upload/", data={"password": "mypassword"})
		self.assertEqual(res.status_code, 400)
		self.assertIn("A file is required", res.get_json()["error"])

		# 2. Missing password
		res = self.client.post(
			"/api/fileshare/upload/",
			data={"file": (BytesIO(b"file content"), "test.txt"), "password": ""},
		)
		self.assertEqual(res.status_code, 400)
		self.assertIn("Access key is required", res.get_json()["error"])

		# 3. Successful upload
		res = self.client.post(
			"/api/fileshare/upload/",
			data={"file": (BytesIO(b"Hello secret fileshare!"), "hello.txt"), "password": "mypassword"},
			content_type="multipart/form-data",
		)
		self.assertEqual(res.status_code, 200)
		upload_data = res.get_json()
		self.assertEqual(upload_data["originalFilename"], "hello.txt")
		self.assertEqual(upload_data["sizeBytes"], len(b"Hello secret fileshare!"))
		self.assertIn("downloadEndpoint", upload_data)

		# 4. List files with wrong password -> 404
		list_res = self.client.post("/api/fileshare/list/", data={"password": "wrong-password"})
		self.assertEqual(list_res.status_code, 404)

		# 5. List files with correct password -> 200
		list_res = self.client.post("/api/fileshare/list/", data={"password": "mypassword"})
		self.assertEqual(list_res.status_code, 200)
		files = list_res.get_json()["files"]
		self.assertEqual(len(files), 1)
		self.assertEqual(files[0]["originalFilename"], "hello.txt")

		# 6. Access file with invalid occurrence index -> 400
		acc_bad_idx = self.client.post(
			"/api/fileshare/access/",
			data={"password": "mypassword", "occurrenceIndex": "abc"},
		)
		self.assertEqual(acc_bad_idx.status_code, 400)

		# 7. Access file with wrong password -> 404
		acc_wrong_pass = self.client.post(
			"/api/fileshare/access/",
			data={"password": "wrong-password", "occurrenceIndex": "1"},
		)
		self.assertEqual(acc_wrong_pass.status_code, 404)

		# 8. Access file with correct password -> 200 download
		acc_res = self.client.post(
			"/api/fileshare/access/",
			data={"password": "mypassword", "occurrenceIndex": "1"},
		)
		self.assertEqual(acc_res.status_code, 200)
		self.assertEqual(acc_res.data, b"Hello secret fileshare!")
		self.assertIn("attachment", acc_res.headers.get("Content-Disposition", ""))

	def test_static_files_endpoint(self):
		res = self.client.get("/static/json/course_data.json")
		self.assertEqual(res.status_code, 200)

	@patch("app.views.decrypt_record_payload")
	def test_fileshare_access_decryption_error(self, mock_decrypt):
		from app.fileshare import FileShareError

		mock_decrypt.side_effect = FileShareError("Incorrect access key or corrupted file.", 403)
		# Upload a dummy file first
		self.client.post(
			"/api/fileshare/upload/",
			data={"file": (BytesIO(b"abc"), "file.txt"), "password": "pass"},
			content_type="multipart/form-data",
		)
		res = self.client.post("/api/fileshare/access/", data={"password": "pass", "occurrenceIndex": "1"})
		self.assertEqual(res.status_code, 403)
		self.assertIn("error", res.get_json())

	def test_fileshare_download_ignores_uploaded_mime_type(self):
		self.client.post(
			"/api/fileshare/upload/",
			data={"file": (BytesIO(b"<script>alert(1)</script>"), "x.html", "text/html"), "password": "pass"},
			content_type="multipart/form-data",
		)
		res = self.client.post("/api/fileshare/access/", data={"password": "pass", "occurrenceIndex": "1"})
		self.assertEqual(res.status_code, 200)
		self.assertEqual(res.mimetype, "application/octet-stream")
		self.assertEqual(res.headers.get("X-Content-Type-Options"), "nosniff")

	def test_fileshare_busy_when_no_transfer_slots(self):
		import threading

		with patch("app.fileshare._transfer_slots", threading.Semaphore(0)):
			res = self.client.post(
				"/api/fileshare/upload/",
				data={"file": (BytesIO(b"abc"), "file.txt"), "password": "pass"},
				content_type="multipart/form-data",
			)
		self.assertEqual(res.status_code, 503)
		self.assertIn("busy", res.get_json()["error"])


if __name__ == "__main__":
	unittest.main()

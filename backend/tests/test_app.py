import os
import unittest
from unittest.mock import patch

from app import create_app


class TestAppFactory(unittest.TestCase):
	def test_create_app_without_secret_key_raises_error(self):
		with patch.dict(os.environ, {}, clear=True):
			with self.assertRaises(ValueError) as ctx:
				create_app()
			self.assertIn("SECRET_KEY environment variable is not set", str(ctx.exception))

	def test_create_app_with_env_secret_key(self):
		with patch.dict(os.environ, {"SECRET_KEY": "env-secret-key"}, clear=True):
			app = create_app()
			self.assertEqual(app.config["SECRET_KEY"], "env-secret-key")
			self.assertFalse(app.config.get("TESTING", False))

	def test_create_app_with_test_config(self):
		app = create_app(test_config={"SECRET_KEY": "config-secret-key", "TESTING": True})
		self.assertEqual(app.config["SECRET_KEY"], "config-secret-key")
		self.assertTrue(app.config["TESTING"])

	def test_create_app_custom_instance_path(self, tmp_path=None):
		import tempfile
		with tempfile.TemporaryDirectory() as tmp_dir:
			app = create_app(
				test_config={"SECRET_KEY": "dummy-key"},
				instance_path=tmp_dir,
			)
			self.assertEqual(app.instance_path, tmp_dir)


class TestAppErrorHandlersAndCORS(unittest.TestCase):
	def setUp(self):
		self.app = create_app(test_config={"SECRET_KEY": "test-key", "TESTING": True})
		self.client = self.app.test_client()

	def test_404_handler_returns_json(self):
		res = self.client.get("/nonexistent-route-xyz")
		self.assertEqual(res.status_code, 404)
		self.assertTrue(res.is_json)
		data = res.get_json()
		self.assertEqual(data, {"error": "Not Found"})

	def test_no_cors_headers_outside_development(self):
		with patch.dict(os.environ, {"FLASK_ENV": "production"}):
			client = create_app(test_config={"SECRET_KEY": "test-key", "TESTING": True}).test_client()
		res = client.get("/api/messageboard/status/", headers={"Origin": "https://example.com"})
		self.assertEqual(res.status_code, 200)
		self.assertIsNone(res.headers.get("Access-Control-Allow-Origin"))

	def test_cors_headers_in_development(self):
		with patch.dict(os.environ, {"FLASK_ENV": "development"}):
			client = create_app(test_config={"SECRET_KEY": "test-key", "TESTING": True}).test_client()
		res = client.get("/api/messageboard/status/", headers={"Origin": "https://example.com"})
		self.assertEqual(res.status_code, 200)
		self.assertIn(res.headers.get("Access-Control-Allow-Origin"), ["*", "https://example.com"])


if __name__ == "__main__":
	unittest.main()

from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

import pytest
from app import create_app
from app.messageboard import board_rate_limiter, board_store


@pytest.fixture
def temp_instance_dir():
	"""Create a temporary instance directory for isolated file storage during tests."""
	temp_dir = tempfile.mkdtemp(prefix="test_instance_")
	yield Path(temp_dir)
	shutil.rmtree(temp_dir, ignore_errors=True)


@pytest.fixture
def app(temp_instance_dir):
	"""Flask test application fixture isolated to temporary instance directory."""
	test_config = {
		"TESTING": True,
		"SECRET_KEY": "test-secret-key-for-unit-tests",
	}
	app = create_app(test_config=test_config, instance_path=str(temp_instance_dir))
	yield app


@pytest.fixture
def client(app):
	"""Flask test client fixture."""
	return app.test_client()


@pytest.fixture(autouse=True)
def clean_messageboard():
	"""Ensure messageboard in-memory store and rate limiter are reset for every test."""
	board_store.reset()
	board_rate_limiter.reset()
	yield
	board_store.reset()
	board_rate_limiter.reset()

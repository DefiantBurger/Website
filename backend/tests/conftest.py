import threading

import pytest

from app import create_app, fileshare
from app.messageboard import board_rate_limiter, board_store

TEST_SECRET_KEY = 'test-secret-key'


@pytest.fixture
def app(tmp_path):
	"""App whose file-share storage lives in a per-test temp directory."""
	return create_app(
		test_config={'TESTING': True, 'SECRET_KEY': TEST_SECRET_KEY},
		instance_path=str(tmp_path),
	)


@pytest.fixture
def client(app):
	return app.test_client()


@pytest.fixture
def app_ctx(app):
	"""For calling file-share functions directly; they read config and instance_path from current_app."""
	with app.app_context():
		yield app


@pytest.fixture(autouse=True)
def fresh_transfer_slots(monkeypatch):
	"""Downloads release their slot when the response closes, which the test client never does."""
	monkeypatch.setattr(
		fileshare, '_transfer_slots', threading.BoundedSemaphore(fileshare.MAX_CONCURRENT_TRANSFERS)
	)


@pytest.fixture(autouse=True)
def clean_messageboard():
	"""The board store and rate limiter are module-level singletons, so reset them around every test."""
	board_store.reset()
	board_rate_limiter.reset()
	yield
	board_store.reset()
	board_rate_limiter.reset()

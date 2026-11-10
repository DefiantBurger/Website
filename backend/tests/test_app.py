import pytest
from flask import request

from app import create_app


def test_create_app_without_secret_key_raises_error(monkeypatch):
	monkeypatch.delenv('SECRET_KEY', raising=False)
	with pytest.raises(ValueError, match='SECRET_KEY environment variable is not set'):
		create_app()


def test_create_app_with_env_secret_key(monkeypatch):
	monkeypatch.setenv('SECRET_KEY', 'env-secret-key')
	app = create_app()
	assert app.config['SECRET_KEY'] == 'env-secret-key'
	assert not app.config.get('TESTING', False)


def test_test_config_secret_key_wins_over_env(monkeypatch):
	monkeypatch.setenv('SECRET_KEY', 'env-secret-key')
	app = create_app(test_config={'SECRET_KEY': 'config-secret-key', 'TESTING': True})
	assert app.config['SECRET_KEY'] == 'config-secret-key'
	assert app.config['TESTING']


def test_create_app_custom_instance_path(app, tmp_path):
	assert app.instance_path == str(tmp_path)


def test_redirect_uses_forwarded_scheme(client):
	res = client.get('/api/health', headers={'X-Forwarded-Proto': 'https', 'Host': 'example.com'})
	assert res.status_code == 308
	assert res.headers['Location'] == 'https://example.com/api/health/'


def test_remote_addr_uses_forwarded_for(app, client):
	# ProxyFix runs as WSGI middleware, so check through a real request.
	captured = {}

	@app.get('/_test_remote_addr')
	def _remote_addr():
		captured['addr'] = request.remote_addr
		return ''

	client.get('/_test_remote_addr', headers={'X-Forwarded-For': '203.0.113.7'})
	assert captured['addr'] == '203.0.113.7'


def test_404_handler_returns_json(client):
	res = client.get('/nonexistent-route-xyz')
	assert res.status_code == 404
	assert res.get_json() == {'error': 'Not Found'}


@pytest.mark.parametrize(
	('flask_env', 'allowed_origins'),
	[('production', [None]), ('development', ['*', 'https://example.com'])],
)
def test_cors_only_in_development(monkeypatch, flask_env, allowed_origins):
	monkeypatch.setenv('FLASK_ENV', flask_env)
	client = create_app(test_config={'SECRET_KEY': 'test-key', 'TESTING': True}).test_client()
	res = client.get('/api/messageboard/status/', headers={'Origin': 'https://example.com'})
	assert res.status_code == 200
	assert res.headers.get('Access-Control-Allow-Origin') in allowed_origins

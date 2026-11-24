import re
from pathlib import Path

import pytest

from app import create_app
from app.fileshare import MAX_FILE_BYTES, _ciphertext_size


def test_create_app_without_secret_key_raises_error(monkeypatch):
	monkeypatch.delenv('SECRET_KEY', raising=False)
	with pytest.raises(ValueError, match='SECRET_KEY environment variable is not set'):
		create_app()


def test_create_app_with_env_secret_key(monkeypatch, tmp_path):
	monkeypatch.setenv('SECRET_KEY', 'env-secret-key')
	app = create_app(instance_path=str(tmp_path))
	assert app.config['SECRET_KEY'] == 'env-secret-key'
	assert not app.config.get('TESTING', False)


def test_test_config_secret_key_wins_over_env(monkeypatch, tmp_path):
	monkeypatch.setenv('SECRET_KEY', 'env-secret-key')
	app = create_app(
		test_config={'SECRET_KEY': 'config-secret-key', 'TESTING': True},
		instance_path=str(tmp_path),
	)
	assert app.config['SECRET_KEY'] == 'config-secret-key'
	assert app.config['TESTING']


def test_create_app_custom_instance_path(app, tmp_path):
	assert app.instance_path == str(tmp_path)


def test_404_handler_returns_json(client):
	res = client.get('/nonexistent-route-xyz')
	assert res.status_code == 404
	assert res.get_json() == {'error': 'Not Found'}


def test_oversized_body_returns_json_413(app, client):
	app.config['MAX_CONTENT_LENGTH'] = 10  # Stand-in for the real ~81 MB cap.
	res = client.post('/api/fileshare/upload/', data={'token': 'x' * 100})
	assert res.status_code == 413
	assert 'MB limit' in res.get_json()['error']


def test_405_returns_json(client):
	res = client.delete('/api/messageboard/messages/')
	assert res.status_code == 405
	assert res.get_json() == {'error': 'Method Not Allowed'}


def test_unhandled_exception_returns_json_500(app):
	app.config['PROPAGATE_EXCEPTIONS'] = False  # TESTING would otherwise re-raise it.

	def boom():
		raise RuntimeError('boom')

	app.add_url_rule('/api/boom/', view_func=boom)
	res = app.test_client().get('/api/boom/')
	assert res.status_code == 500
	assert res.get_json() == {'error': 'Internal Server Error'}


@pytest.mark.parametrize(
	('flask_env', 'allowed_origins'),
	[('production', [None]), ('development', ['*', 'https://example.com'])],
)
def test_cors_only_in_development(monkeypatch, tmp_path, flask_env, allowed_origins):
	monkeypatch.setenv('FLASK_ENV', flask_env)
	app = create_app(
		test_config={'SECRET_KEY': 'test-key', 'TESTING': True}, instance_path=str(tmp_path)
	)
	client = app.test_client()
	res = client.get('/api/messageboard/messages/', headers={'Origin': 'https://example.com'})
	assert res.status_code == 200
	assert res.headers.get('Access-Control-Allow-Origin') in allowed_origins


def test_flask_body_limit_fits_under_nginx_upload_limit(app):
	# Nginx's cap ships through Terraform and Flask's with each release, so this
	# guards against the two drifting apart instead of sharing one value.
	conf = (Path(__file__).parents[2] / 'infrastructure' / 'vm' / 'nginx.conf.tftpl').read_text()
	block = conf.split('location /api/fileshare/upload/', 1)[1].split('}', 1)[0]
	mebibytes = int(re.search(r'client_max_body_size (\d+)M;', block).group(1))
	largest_upload = _ciphertext_size(MAX_FILE_BYTES)
	assert largest_upload < app.config['MAX_CONTENT_LENGTH'] < mebibytes * 1024 * 1024

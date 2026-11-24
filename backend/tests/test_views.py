import threading
from io import BytesIO
from unittest.mock import patch

from test_fileshare import SALT, ciphertext, encrypted_name, token

from app.fileshare import FileShareError


def _upload(client, content=None, seed='key', name='n', mimetype=None, **fields):
	content = ciphertext() if content is None else content
	file = (
		(BytesIO(content), 'encrypted', mimetype) if mimetype else (BytesIO(content), 'encrypted')
	)
	form = {'token': token(seed), 'salt': SALT, 'encryptedName': encrypted_name(name)}
	return client.post(
		'/api/fileshare/upload/',
		data={'file': file, **form, **fields},
		content_type='multipart/form-data',
	)


def _access(client, file_id, seed='key', **kwargs):
	return client.post(
		'/api/fileshare/access/', data={'token': token(seed), 'id': file_id}, **kwargs
	)


def _list_names(client, seed='key'):
	res = client.post('/api/fileshare/list/', data={'token': token(seed)})
	return [f['encryptedName'][0] for f in res.get_json()['files']]


def test_health(client):
	res = client.get('/api/health/')
	assert res.status_code == 200
	assert res.get_json() == {'status': 'ok'}


def test_about_you_request_context(client):
	headers = {
		'CF-IPCountry': 'US',
		'CF-IPCity': 'Dallas',
		'User-Agent': 'TestBrowser/1.0',
		'Accept-Language': 'en-US,en;q=0.9',
		'Referer': 'https://example.com/ref',
		'DNT': '1',
	}
	# In production Waitress sets REMOTE_ADDR from Nginx's X-Forwarded-For.
	res = client.get(
		'/api/about-you/request-context/',
		headers=headers,
		environ_base={'REMOTE_ADDR': '198.51.100.1'},
	)
	assert res.status_code == 200
	data = res.get_json()

	assert data['network'] == {'clientIp': '198.51.100.1'}
	assert data['headers'] == {
		'userAgent': 'TestBrowser/1.0',
		'acceptLanguage': 'en-US,en;q=0.9',
		'referer': 'https://example.com/ref',
		'doNotTrack': '1',
	}
	assert data['geolocation']['available']
	assert data['geolocation']['city'] == 'Dallas'


def test_fileshare_status_endpoint(client):
	res = client.get('/api/fileshare/status/')
	assert res.status_code == 200
	data = res.get_json()
	assert data['activeFileCount'] == 0
	assert {'maxFileBytes', 'retentionSeconds'} <= set(data)


def test_fileshare_upload_and_download_flow(client):
	res = client.post('/api/fileshare/upload/', data={'token': token()})
	assert res.status_code == 400
	assert 'A file is required' in res.get_json()['error']

	# What a page loaded before browser encryption shipped would send.
	res = client.post('/api/fileshare/list/', data={'password': 'mypassword'})
	assert res.status_code == 400
	assert 'reload the page' in res.get_json()['error']

	content = ciphertext(23)
	res = _upload(client, content)
	assert res.status_code == 200
	uploaded = res.get_json()
	assert set(uploaded) == {'id', 'salt', 'encryptedName', 'sizeBytes', 'uploadedAt', 'expiresAt'}
	assert (uploaded['salt'], uploaded['encryptedName']) == (SALT, encrypted_name())
	assert uploaded['sizeBytes'] == 23

	res = client.post('/api/fileshare/list/', data={'token': token('wrong')})
	assert res.status_code == 404

	res = client.post('/api/fileshare/list/', data={'token': token()})
	assert res.status_code == 200
	assert res.get_json() == {'files': [uploaded]}

	assert _access(client, 'no-such-id').status_code == 404
	assert _access(client, uploaded['id'], 'wrong').status_code == 404

	res = _access(client, uploaded['id'])
	assert res.status_code == 200
	assert res.data == content
	assert res.headers['Content-Disposition'] == 'attachment'
	assert res.headers['Content-Length'] == str(len(content))
	assert res.headers['Cache-Control'] == 'no-store'


def test_fileshare_replace_flow(client):
	# What the UI does: the first file of a batch replaces the token's earlier files.
	_upload(client, name='o')
	_upload(client, name='a', replace='1')
	_upload(client, name='b')
	assert _list_names(client) == ['a', 'b']


def test_fileshare_download_ignores_uploaded_mime_type(client):
	file_id = _upload(client, mimetype='text/html').get_json()['id']
	res = _access(client, file_id)
	assert res.status_code == 200
	assert res.mimetype == 'application/octet-stream'
	assert res.headers.get('X-Content-Type-Options') == 'nosniff'


def test_fileshare_busy_when_no_transfer_slots(client):
	with patch('app.fileshare._transfer_slots', threading.Semaphore(0)):
		res = _upload(client)
	assert res.status_code == 503
	assert 'busy' in res.get_json()['error']


def test_fileshare_download_holds_slot_until_response_closes(client):
	file_id = _upload(client).get_json()['id']
	slots = threading.BoundedSemaphore(1)
	with patch('app.fileshare._transfer_slots', slots):
		# buffered=False leaves the response open, like a client still downloading.
		res = _access(client, file_id, buffered=False)
		assert res.status_code == 200
		assert not slots.acquire(blocking=False)

		assert len(b''.join(res.response)) == len(ciphertext())
		res.close()
		assert slots.acquire(blocking=False)
		slots.release()


def test_fileshare_download_error_releases_slot(client):
	file_id = _upload(client).get_json()['id']
	slots = threading.BoundedSemaphore(1)
	with (
		patch('app.fileshare._transfer_slots', slots),
		patch(
			'app.views.open_record_payload',
			side_effect=FileShareError('The requested file is no longer available.', 404),
		),
	):
		assert _access(client, file_id).status_code == 404
		assert slots.acquire(blocking=False)
		slots.release()

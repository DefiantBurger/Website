import threading
from io import BytesIO
from unittest.mock import patch

import pytest

from app.fileshare import FileShareError


def _upload(client, name='file.txt', content=b'abc', password='pass', mimetype=None):
	file = (BytesIO(content), name, mimetype) if mimetype else (BytesIO(content), name)
	return client.post(
		'/api/fileshare/upload/',
		data={'file': file, 'password': password},
		content_type='multipart/form-data',
	)


def _access(client, password='pass', index='1', **kwargs):
	return client.post(
		'/api/fileshare/access/',
		data={'password': password, 'occurrenceIndex': index},
		**kwargs,
	)


def test_health(client):
	res = client.get('/api/health/')
	assert res.status_code == 200
	assert res.get_json() == {'status': 'ok'}


@pytest.mark.parametrize('path', ['course-data', 'default-schedule'])
def test_scheduler_data(client, path):
	res = client.get(f'/api/scheduler/{path}/')
	assert res.status_code == 200
	assert isinstance(res.get_json(), (dict, list))


def test_static_folder_is_not_served(client):
	assert client.get('/static/json/course_data.json').status_code == 404


def test_about_you_request_context(client):
	headers = {
		'CF-IPCountry': 'US',
		'CF-IPCity': 'Dallas',
		'CF-Connecting-IP': '198.51.100.1',
		'User-Agent': 'TestBrowser/1.0',
		'Accept-Language': 'en-US,en;q=0.9',
		'Referer': 'https://example.com/ref',
		'DNT': '1',
	}
	res = client.get('/api/about-you/request-context/', headers=headers)
	assert res.status_code == 200
	data = res.get_json()

	assert data['network'] == {
		'clientIp': '198.51.100.1',
		'ipSource': 'CF-Connecting-IP',
		'hasForwardedHeaders': True,
	}
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
	res = client.post('/api/fileshare/upload/', data={'password': 'mypassword'})
	assert res.status_code == 400
	assert 'A file is required' in res.get_json()['error']

	res = _upload(client, password='')
	assert res.status_code == 400
	assert 'Access key is required' in res.get_json()['error']

	content = b'Hello secret fileshare!'
	res = _upload(client, 'hello.txt', content, password='mypassword')
	assert res.status_code == 200
	uploaded = res.get_json()
	assert set(uploaded) == {
		'occurrenceIndex',
		'originalFilename',
		'sizeBytes',
		'uploadedAt',
		'expiresAt',
	}
	assert uploaded['originalFilename'] == 'hello.txt'
	assert uploaded['sizeBytes'] == len(content)

	res = client.post('/api/fileshare/list/', data={'password': 'wrong-password'})
	assert res.status_code == 404

	res = client.post('/api/fileshare/list/', data={'password': 'mypassword'})
	assert res.status_code == 200
	assert res.get_json() == {'files': [uploaded]}

	assert _access(client, 'mypassword', 'abc').status_code == 400
	assert _access(client, 'wrong-password').status_code == 404

	res = _access(client, 'mypassword')
	assert res.status_code == 200
	assert res.data == content
	assert res.headers['Content-Disposition'] == 'attachment; filename=hello.txt'
	assert res.headers['Content-Length'] == str(len(content))
	assert res.headers['Cache-Control'] == 'no-store'


def test_fileshare_replace_batch_flow(client):
	# What the UI does: upload the new batch, then delete the old one.
	old = _upload(client, 'old.txt', b'old').get_json()
	new = [_upload(client, name, b'new').get_json() for name in ('a.txt', 'b.txt')]
	assert [r['occurrenceIndex'] for r in new] == [2, 3]

	res = client.post(
		'/api/fileshare/delete/',
		data={'password': 'pass', 'occurrenceIndices': str(old['occurrenceIndex'])},
	)
	assert res.status_code == 200
	assert res.get_json() == {'deletedCount': 1}

	files = client.post('/api/fileshare/list/', data={'password': 'pass'}).get_json()['files']
	assert [f['originalFilename'] for f in files] == ['a.txt', 'b.txt']


@pytest.mark.parametrize(
	'data', [{'password': 'pass', 'occurrenceIndices': '1,x'}, {'occurrenceIndices': '1'}]
)
def test_fileshare_delete_rejects_bad_input(client, data):
	res = client.post('/api/fileshare/delete/', data=data)
	assert res.status_code == 400
	assert 'error' in res.get_json()


def test_fileshare_access_decryption_error(client):
	_upload(client)
	with patch(
		'app.views.open_record_payload',
		side_effect=FileShareError('Incorrect access key or corrupted file.', 403),
	):
		res = _access(client)
	assert res.status_code == 403
	assert res.get_json() == {'error': 'Incorrect access key or corrupted file.'}


def test_fileshare_download_ignores_uploaded_mime_type(client):
	_upload(client, 'x.html', b'<script>alert(1)</script>', mimetype='text/html')
	res = _access(client)
	assert res.status_code == 200
	assert res.mimetype == 'application/octet-stream'
	assert res.headers.get('X-Content-Type-Options') == 'nosniff'


def test_fileshare_busy_when_no_transfer_slots(client):
	with patch('app.fileshare._transfer_slots', threading.Semaphore(0)):
		res = _upload(client)
	assert res.status_code == 503
	assert 'busy' in res.get_json()['error']


def test_fileshare_download_holds_slot_until_response_closes(client):
	_upload(client)
	slots = threading.BoundedSemaphore(1)
	with patch('app.fileshare._transfer_slots', slots):
		# buffered=False leaves the response open, like a client still downloading.
		res = _access(client, buffered=False)
		assert res.status_code == 200
		assert not slots.acquire(blocking=False)

		assert b''.join(res.response) == b'abc'
		res.close()
		assert slots.acquire(blocking=False)
		slots.release()


def test_fileshare_download_error_releases_slot(client):
	_upload(client)
	slots = threading.BoundedSemaphore(1)
	with (
		patch('app.fileshare._transfer_slots', slots),
		patch(
			'app.views.open_record_payload',
			side_effect=FileShareError('Incorrect access key or corrupted file.', 403),
		),
	):
		assert _access(client).status_code == 403
		assert slots.acquire(blocking=False)
		slots.release()

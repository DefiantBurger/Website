import pytest

from app.views import _cloudflare_geolocation, _resolve_client_ip


@pytest.mark.parametrize(
	('headers', 'expected'),
	[
		(
			{
				'CF-Connecting-IP': '203.0.113.1',
				'X-Forwarded-For': '203.0.113.2',
				'X-Real-IP': '203.0.113.3',
			},
			('203.0.113.1', 'CF-Connecting-IP'),
		),
		(
			{'X-Forwarded-For': '203.0.113.10', 'X-Real-IP': '203.0.113.30'},
			('127.0.0.1', 'remote_addr'),
		),
		({}, ('127.0.0.1', 'remote_addr')),
	],
)
def test_resolve_client_ip_precedence(app, headers, expected):
	with app.test_request_context('/', headers=headers, environ_base={'REMOTE_ADDR': '127.0.0.1'}):
		assert _resolve_client_ip() == expected


def test_geolocation_missing_headers_unavailable(app):
	with app.test_request_context('/'):
		result = _cloudflare_geolocation()
	assert not result['available']
	assert 'not present' in result['reason']


def test_geolocation_missing_headers_use_nyc_in_debug(app):
	app.debug = True
	with app.test_request_context('/'):
		result = _cloudflare_geolocation()
	assert result['available']
	assert result['provider'] == 'Development default'
	assert result['city'] == 'New York'


def test_geolocation_reads_visitor_location_headers(app):
	headers = {
		'CF-IPCountry': 'US',
		'CF-IPCity': 'New York',
		'CF-Region': 'New York',
		'CF-Postal-Code': '10001',
		'CF-Timezone': 'America/New_York',
		'CF-IPLatitude': '40.7128',
		'CF-IPLongitude': '-74.0060',
	}
	with app.test_request_context('/', headers=headers):
		result = _cloudflare_geolocation()
	assert result['available']
	assert result['provider'] == 'Cloudflare'
	assert result['country'] == 'US'
	assert result['city'] == 'New York'
	assert result['latitude'] == 40.7128
	assert result['longitude'] == -74.006


def test_geolocation_utf8_city_and_bad_coordinates(app):
	# WSGI exposes header bytes as latin-1; Cloudflare sends UTF-8.
	city_as_latin1 = 'São Paulo'.encode().decode('latin-1')
	headers = {'CF-IPCity': city_as_latin1, 'CF-IPLatitude': 'not-a-number'}
	with app.test_request_context('/', headers=headers):
		result = _cloudflare_geolocation()
	assert result['city'] == 'São Paulo'
	assert result['latitude'] is None

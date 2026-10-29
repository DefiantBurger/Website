import tempfile
import unittest
from pathlib import Path

from app import create_app
from app.views import (
	_cloudflare_geolocation,
	_mask_ip,
	_parse_project_markdown,
	_project_payload_from_file,
	_resolve_client_ip,
)


class TestIPHelpers(unittest.TestCase):
	def setUp(self):
		self.app = create_app(test_config={"SECRET_KEY": "test-key", "TESTING": True})

	def test_resolve_client_ip_cf_connecting_ip(self):
		with self.app.test_request_context(
			'/',
			headers={
				'CF-Connecting-IP': '203.0.113.1',
				'X-Forwarded-For': '203.0.113.2',
				'X-Real-IP': '203.0.113.3',
			},
			environ_base={'REMOTE_ADDR': '127.0.0.1'},
		):
			ip, source = _resolve_client_ip()
			self.assertEqual(ip, '203.0.113.1')
			self.assertEqual(source, 'CF-Connecting-IP')

	def test_resolve_client_ip_x_forwarded_for_multiple(self):
		with self.app.test_request_context(
			'/',
			headers={
				'X-Forwarded-For': '203.0.113.10, 198.51.100.20, 127.0.0.1',
				'X-Real-IP': '203.0.113.30',
			},
			environ_base={'REMOTE_ADDR': '127.0.0.1'},
		):
			ip, source = _resolve_client_ip()
			self.assertEqual(ip, '203.0.113.10')
			self.assertEqual(source, 'X-Forwarded-For')

	def test_resolve_client_ip_x_real_ip(self):
		with self.app.test_request_context(
			'/',
			headers={'X-Real-IP': '203.0.113.5'},
			environ_base={'REMOTE_ADDR': '127.0.0.1'},
		):
			ip, source = _resolve_client_ip()
			self.assertEqual(ip, '203.0.113.5')
			self.assertEqual(source, 'X-Real-IP')

	def test_resolve_client_ip_remote_addr_fallback(self):
		with self.app.test_request_context(
			'/',
			environ_base={'REMOTE_ADDR': '127.0.0.1'},
		):
			ip, source = _resolve_client_ip()
			self.assertEqual(ip, '127.0.0.1')
			self.assertEqual(source, 'remote_addr')

	def test_mask_ip_ipv4(self):
		self.assertEqual(_mask_ip('192.168.1.50'), '192.168.1.x')
		self.assertEqual(_mask_ip('8.8.8.8'), '8.8.8.x')

	def test_mask_ip_ipv6(self):
		masked = _mask_ip('2001:0db8:85a3:0000:0000:8a2e:0370:7334')
		self.assertEqual(masked, '2001:0db8:85a3:xxxx:xxxx:xxxx:xxxx:xxxx')

	def test_mask_ip_invalid_and_empty(self):
		self.assertEqual(_mask_ip(''), 'Unavailable')
		self.assertEqual(_mask_ip('not-an-ip'), 'Unavailable')
		self.assertEqual(_mask_ip('999.999.999.999'), 'Unavailable')

class TestCloudflareGeolocation(unittest.TestCase):
	def setUp(self):
		self.app = create_app(test_config={"SECRET_KEY": "test-key", "TESTING": True})

	def test_missing_headers_unavailable(self):
		with self.app.test_request_context('/'):
			result = _cloudflare_geolocation()
		self.assertFalse(result['available'])
		self.assertIn('not present', result['reason'])

	def test_missing_headers_use_nyc_in_debug(self):
		self.app.debug = True
		with self.app.test_request_context('/'):
			result = _cloudflare_geolocation()
		self.assertTrue(result['available'])
		self.assertEqual(result['provider'], 'Development default')
		self.assertEqual(result['city'], 'New York')

	def test_reads_visitor_location_headers(self):
		headers = {
			'CF-IPCountry': 'US',
			'CF-IPCity': 'New York',
			'CF-Region': 'New York',
			'CF-Postal-Code': '10001',
			'CF-Timezone': 'America/New_York',
			'CF-IPLatitude': '40.7128',
			'CF-IPLongitude': '-74.0060',
		}
		with self.app.test_request_context('/', headers=headers):
			result = _cloudflare_geolocation()
		self.assertTrue(result['available'])
		self.assertEqual(result['provider'], 'Cloudflare')
		self.assertEqual(result['country'], 'US')
		self.assertEqual(result['city'], 'New York')
		self.assertEqual(result['latitude'], 40.7128)
		self.assertEqual(result['longitude'], -74.006)

	def test_utf8_city_and_bad_coordinates(self):
		# WSGI exposes header bytes as latin-1; Cloudflare sends UTF-8.
		city_as_latin1 = 'São Paulo'.encode('utf-8').decode('latin-1')
		headers = {'CF-IPCity': city_as_latin1, 'CF-IPLatitude': 'not-a-number'}
		with self.app.test_request_context('/', headers=headers):
			result = _cloudflare_geolocation()
		self.assertEqual(result['city'], 'São Paulo')
		self.assertIsNone(result['latitude'])


class TestMarkdownParsing(unittest.TestCase):
	def test_parse_project_markdown_with_frontmatter(self):
		content = (
			"---\n"
			"title: My Awesome Project\n"
			"slug: awesome-project\n"
			"tags: [python, flask]\n"
			"priority: 10\n"
			"---\n"
			"# Heading\n\n"
			"Body paragraph here."
		)
		with tempfile.NamedTemporaryFile('w', suffix='.md', delete=False) as f:
			f.write(content)
			f_path = Path(f.name)

		try:
			meta, body = _parse_project_markdown(f_path)
			self.assertEqual(meta['title'], 'My Awesome Project')
			self.assertEqual(meta['slug'], 'awesome-project')
			self.assertEqual(meta['priority'], 10)
			self.assertEqual(meta['tags'], ['python', 'flask'])
			self.assertIn('# Heading', body)
			self.assertIn('Body paragraph here.', body)

			payload = _project_payload_from_file(f_path)
			self.assertEqual(payload['title'], 'My Awesome Project')
			self.assertEqual(payload['slug'], 'awesome-project')
			self.assertEqual(payload['_priority'], 10)
			self.assertEqual(payload['tags'], ['python', 'flask'])
			self.assertTrue(payload['published'])
		finally:
			f_path.unlink()

	def test_parse_project_markdown_without_frontmatter(self):
		content = "# Plain Markdown\n\nNo frontmatter here."
		with tempfile.NamedTemporaryFile('w', suffix='.md', delete=False) as f:
			f.write(content)
			f_path = Path(f.name)

		try:
			meta, body = _parse_project_markdown(f_path)
			self.assertEqual(meta, {})
			self.assertEqual(body, content)

			payload = _project_payload_from_file(f_path)
			self.assertEqual(payload['slug'], f_path.stem)
			self.assertEqual(payload['_priority'], 0)
			self.assertEqual(payload['tags'], [])
			self.assertTrue(payload['published'])
		finally:
			f_path.unlink()

	def test_parse_project_markdown_edge_cases(self):
		content = (
			"---\n"
			"slug: test-slug\n"
			"tags: not-a-list\n"
			"priority: invalid-number\n"
			"published: false\n"
			"---\n"
			"Content"
		)
		with tempfile.NamedTemporaryFile('w', suffix='.md', delete=False) as f:
			f.write(content)
			f_path = Path(f.name)

		try:
			payload = _project_payload_from_file(f_path)
			self.assertEqual(payload['slug'], 'test-slug')
			self.assertEqual(payload['tags'], [])
			self.assertEqual(payload['_priority'], 0)
			self.assertFalse(payload['published'])
		finally:
			f_path.unlink()


if __name__ == '__main__':
	unittest.main()

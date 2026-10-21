import json
import unittest

from app.messageboard import (
	MAX_MESSAGE_LENGTH,
	MessageBoardError,
	MessageBoardStore,
	RateLimiter,
	sanitize_message_text,
)


class TestMessageBoardAllowlistSanitization(unittest.TestCase):
	def test_valid_message_preserved(self):
		msg = "Hello, world! (Test: 123) /path?param=value~^_{}[]|*;"
		cleaned = sanitize_message_text(msg)
		self.assertEqual(cleaned, msg)

	def test_html_tags_and_entities_stripped(self):
		# <, >, &, ", ' should all be stripped by the allowlist
		raw = '<script>alert("hacked")</script> & \'test\''
		cleaned = sanitize_message_text(raw)
		self.assertNotIn('<', cleaned)
		self.assertNotIn('>', cleaned)
		self.assertNotIn('&', cleaned)
		self.assertNotIn('"', cleaned)
		self.assertNotIn("'", cleaned)
		self.assertEqual(cleaned, "scriptalert(hacked)/script  test")

	def test_control_characters_and_null_bytes_stripped(self):
		raw = "Hello\x00\x1b[31mWorld\x08!"
		cleaned = sanitize_message_text(raw)
		self.assertNotIn('\x00', cleaned)
		self.assertNotIn('\x1b', cleaned)
		self.assertNotIn('\x08', cleaned)
		self.assertEqual(cleaned, "Hello[31mWorld!")

	def test_whitespace_and_excessive_newlines(self):
		raw = "Line 1\r\n\n\n\n\nLine 2"
		cleaned = sanitize_message_text(raw)
		self.assertEqual(cleaned, "Line 1\n\nLine 2")

	def test_empty_or_whitespace_only_rejected(self):
		with self.assertRaises(MessageBoardError):
			sanitize_message_text("")
		with self.assertRaises(MessageBoardError):
			sanitize_message_text("   ")
		with self.assertRaises(MessageBoardError):
			sanitize_message_text("<<<>>>&&&\"\"\"'''")

	def test_length_limit(self):
		oversized = "a" * (MAX_MESSAGE_LENGTH + 1)
		with self.assertRaises(MessageBoardError) as ctx:
			sanitize_message_text(oversized)
		self.assertEqual(ctx.exception.status_code, 400)

	def test_non_string_rejected(self):
		with self.assertRaises(MessageBoardError):
			sanitize_message_text(None)
		with self.assertRaises(MessageBoardError):
			sanitize_message_text(12345)


class TestRateLimiter(unittest.TestCase):
	def test_rate_limiter_window(self):
		limiter = RateLimiter(window_seconds=10.0, max_requests=3)
		now = 1000.0

		self.assertTrue(limiter.check_and_record('192.168.1.1', now=now))
		self.assertTrue(limiter.check_and_record('192.168.1.1', now=now + 1.0))
		self.assertTrue(limiter.check_and_record('192.168.1.1', now=now + 2.0))
		# 4th request in window should fail
		self.assertFalse(limiter.check_and_record('192.168.1.1', now=now + 3.0))

		# Different IP allowed
		self.assertTrue(limiter.check_and_record('192.168.1.2', now=now + 3.0))

		# After window passes, original IP allowed again
		self.assertTrue(limiter.check_and_record('192.168.1.1', now=now + 11.0))


class TestMessageBoardStore(unittest.TestCase):
	def test_store_and_expiration(self):
		store = MessageBoardStore(ttl_seconds=30.0, max_messages=10)
		now = 1000.0

		msg1 = store.add_message('First message', '127.0.0.1', now=now)
		msg2 = store.add_message('Second message', '127.0.0.1', now=now + 5.0)

		active = store.get_active_messages(now=now + 10.0)
		self.assertEqual(len(active), 2)
		# Newest first
		self.assertEqual(active[0]['id'], msg2.id)
		self.assertEqual(active[1]['id'], msg1.id)

		# After 31 seconds from msg1, msg1 should be expired
		active_later = store.get_active_messages(now=now + 31.0)
		self.assertEqual(len(active_later), 1)
		self.assertEqual(active_later[0]['id'], msg2.id)

		# After 36 seconds from msg1, all expired
		active_empty = store.get_active_messages(now=now + 36.0)
		self.assertEqual(len(active_empty), 0)

	def test_capacity_eviction(self):
		store = MessageBoardStore(ttl_seconds=30.0, max_messages=2)
		now = 1000.0

		msg1 = store.add_message('Msg 1', '127.0.0.1', now=now)
		msg2 = store.add_message('Msg 2', '127.0.0.1', now=now + 1.0)
		msg3 = store.add_message('Msg 3', '127.0.0.1', now=now + 2.0)

		active = store.get_active_messages(now=now + 3.0)
		self.assertEqual(len(active), 2)
		ids = [m['id'] for m in active]
		self.assertNotIn(msg1.id, ids)
		self.assertIn(msg2.id, ids)
		self.assertIn(msg3.id, ids)

	def test_store_cleanup(self):
		store = MessageBoardStore(ttl_seconds=10.0, max_messages=10)
		store.add_message('Msg 1', '127.0.0.1', now=100.0)
		store.add_message('Msg 2', '127.0.0.1', now=105.0)

		# At time 106, 0 expired
		expired_count = store.cleanup(now=106.0)
		self.assertEqual(expired_count, 0)

		# At time 112, Msg 1 (expired at 110) purged
		expired_count = store.cleanup(now=112.0)
		self.assertEqual(expired_count, 1)


class TestMessageBoardAPI(unittest.TestCase):
	def setUp(self):
		import os
		from app import create_app
		from app.messageboard import board_rate_limiter, board_store

		os.environ['SECRET_KEY'] = 'test-secret-key'
		self.app = create_app()
		self.client = self.app.test_client()
		self.board_store = board_store
		self.board_rate_limiter = board_rate_limiter
		self.board_store.reset()
		self.board_rate_limiter.reset()

	def tearDown(self):
		self.board_store.reset()
		self.board_rate_limiter.reset()

	def test_get_messages_empty(self):
		res = self.client.get('/api/messageboard/messages/')
		self.assertEqual(res.status_code, 200)
		data = res.get_json()
		self.assertIn('messages', data)
		self.assertEqual(data['messages'], [])

	def test_post_and_get_message(self):
		res = self.client.post('/api/messageboard/messages/', json={'text': 'Test note 1'})
		self.assertEqual(res.status_code, 201)
		post_data = res.get_json()
		self.assertEqual(post_data['text'], 'Test note 1')
		self.assertIn('id', post_data)
		self.assertIn('createdAt', post_data)
		self.assertIn('expiresAt', post_data)

		# Check GET retrieves it
		get_res = self.client.get('/api/messageboard/messages/')
		self.assertEqual(get_res.status_code, 200)
		get_data = get_res.get_json()
		self.assertEqual(len(get_data['messages']), 1)
		self.assertEqual(get_data['messages'][0]['text'], 'Test note 1')

	def test_post_sanitization_removes_html(self):
		res = self.client.post(
			'/api/messageboard/messages/',
			json={'text': '<script>alert(1)</script> Hello!'},
		)
		self.assertEqual(res.status_code, 201)
		data = res.get_json()
		self.assertNotIn('<', data['text'])
		self.assertNotIn('>', data['text'])
		self.assertEqual(data['text'], 'scriptalert(1)/script Hello!')

	def test_post_empty_rejected(self):
		res = self.client.post('/api/messageboard/messages/', json={'text': '   '})
		self.assertEqual(res.status_code, 400)
		self.assertIn('error', res.get_json())

	def test_status_endpoint(self):
		res = self.client.get('/api/messageboard/status/')
		self.assertEqual(res.status_code, 200)
		data = res.get_json()
		self.assertIn('activeCount', data)
		self.assertIn('retentionSeconds', data)
		self.assertEqual(data['retentionSeconds'], 30)

	def test_post_via_form_data(self):
		res = self.client.post('/api/messageboard/messages/', data={'text': 'Form data message'})
		self.assertEqual(res.status_code, 201)
		self.assertEqual(res.get_json()['text'], 'Form data message')

	def test_post_rate_limit_exceeded(self):
		# Max allowed requests is 5 in a 10s window
		for i in range(5):
			res = self.client.post('/api/messageboard/messages/', json={'text': f'Message {i}'})
			self.assertEqual(res.status_code, 201)

		# 6th request from same IP should get 429
		blocked_res = self.client.post('/api/messageboard/messages/', json={'text': 'Too fast'})
		self.assertEqual(blocked_res.status_code, 429)
		self.assertIn('too quickly', blocked_res.get_json()['error'])

	def test_post_payload_oversized(self):
		# views.py checks request.content_length > 16384 -> 413
		oversized_text = 'x' * 17000
		res = self.client.post(
			'/api/messageboard/messages/',
			data=json.dumps({'text': oversized_text}),
			content_type='application/json',
		)
		self.assertEqual(res.status_code, 413)
		self.assertIn('maximum allowed size', res.get_json()['error'])


if __name__ == '__main__':
	unittest.main()

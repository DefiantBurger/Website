import json
from io import BytesIO

import pytest

from app.messageboard import (
	MAX_MESSAGE_LENGTH,
	MESSAGE_TTL_SECONDS,
	MessageBoardError,
	MessageBoardStore,
	RateLimiter,
	sanitize_message_text,
)

MESSAGES_URL = '/api/messageboard/messages/'


# Sanitization


@pytest.mark.parametrize(
	'msg',
	[
		'Hello, world! (Test: 123) /path?param=value~^_{}[]|*;',
		'don\'t & <b>won\'t</b> "quote" #tag 50% a+b me@example.com',
		'café ñ 你好 🎉 👨\u200d👩\u200d👧 🏴\U000e0067\U000e0062\U000e0065\U000e006e\U000e0067\U000e007f',
	],
)
def test_printable_text_preserved(msg):
	assert sanitize_message_text(msg) == msg


def test_control_and_invisible_characters_stripped():
	raw = 'Hello\x00\x1b[31mWorld\x08!\u200b\u202eevil\u2028\ue000'
	assert sanitize_message_text(raw) == 'Hello[31mWorld!evil'


def test_tabs_become_spaces_and_text_is_nfc_normalized():
	assert sanitize_message_text('a\tcafe\u0301') == 'a caf\u00e9'


def test_whitespace_and_excessive_newlines():
	assert sanitize_message_text('Line 1\r\n\n\n\n\nLine 2') == 'Line 1\n\nLine 2'


@pytest.mark.parametrize('raw', ['', '   ', '\u200b\u202e\x00', None, 12345])
def test_empty_invalid_or_non_string_rejected(raw):
	with pytest.raises(MessageBoardError):
		sanitize_message_text(raw)


def test_length_limit():
	with pytest.raises(MessageBoardError) as exc_info:
		sanitize_message_text('a' * (MAX_MESSAGE_LENGTH + 1))
	assert exc_info.value.status_code == 400


# Rate limiter and store


def test_rate_limiter_window():
	limiter = RateLimiter(window_seconds=10.0, max_requests=3)
	now = 1000.0

	assert limiter.check_and_record('192.168.1.1', now=now)
	assert limiter.check_and_record('192.168.1.1', now=now + 1.0)
	assert limiter.check_and_record('192.168.1.1', now=now + 2.0)
	assert not limiter.check_and_record('192.168.1.1', now=now + 3.0)
	assert limiter.check_and_record('192.168.1.2', now=now + 3.0)  # Limits are per IP.
	assert limiter.check_and_record('192.168.1.1', now=now + 11.0)  # Window has passed.


def _active_ids(store, now):
	return [m['id'] for m in store.snapshot(now=now)['messages']]


def test_store_and_expiration():
	store = MessageBoardStore(ttl_seconds=30.0, max_messages=10)
	now = 1000.0
	msg1 = store.add_message('First message', '127.0.0.1', now=now)
	msg2 = store.add_message('Second message', '127.0.0.1', now=now + 5.0)

	assert _active_ids(store, now + 10.0) == [msg2.id, msg1.id]
	assert _active_ids(store, now + 31.0) == [msg2.id]
	assert _active_ids(store, now + 36.0) == []


def test_snapshot_reports_server_time_and_limits():
	store = MessageBoardStore(ttl_seconds=30.0, max_messages=10)
	snapshot = store.snapshot(now=0.0)
	assert snapshot['serverTime'] == '1970-01-01T00:00:00+00:00'
	assert snapshot['retentionSeconds'] == 30
	assert snapshot['maxMessageLength'] == MAX_MESSAGE_LENGTH


def test_capacity_eviction():
	store = MessageBoardStore(ttl_seconds=30.0, max_messages=2)
	now = 1000.0
	store.add_message('Msg 1', '127.0.0.1', now=now)
	msg2 = store.add_message('Msg 2', '127.0.0.1', now=now + 1.0)
	msg3 = store.add_message('Msg 3', '127.0.0.1', now=now + 2.0)

	assert set(_active_ids(store, now + 3.0)) == {msg2.id, msg3.id}


# API


def test_get_messages_empty(client):
	res = client.get(MESSAGES_URL)
	assert res.status_code == 200
	data = res.get_json()
	assert data['messages'] == []
	assert data['retentionSeconds'] == MESSAGE_TTL_SECONDS
	assert data['maxMessageLength'] == MAX_MESSAGE_LENGTH


def test_post_and_get_message(client):
	res = client.post(MESSAGES_URL, json={'text': 'Test note 1'})
	assert res.status_code == 201
	posted = res.get_json()
	assert set(posted) == {'id', 'text', 'createdAt', 'expiresAt'}
	assert posted['text'] == 'Test note 1'

	res = client.get(MESSAGES_URL)
	assert res.status_code == 200
	assert res.get_json()['messages'] == [posted]


def test_post_is_sanitized_but_keeps_markup_as_text(client):
	# The frontend escapes on render, so markup is stored verbatim.
	res = client.post(MESSAGES_URL, json={'text': '<b>hi</b>\u202e\x00 Hello!'})
	assert res.status_code == 201
	assert res.get_json()['text'] == '<b>hi</b> Hello!'


def test_post_empty_rejected(client):
	res = client.post(MESSAGES_URL, json={'text': '   '})
	assert res.status_code == 400
	assert 'error' in res.get_json()


def test_post_via_form_data(client):
	res = client.post(MESSAGES_URL, data={'text': 'Form data message'})
	assert res.status_code == 201
	assert res.get_json()['text'] == 'Form data message'


def test_post_rate_limit_exceeded(client):
	for i in range(5):  # The limit is 5 posts per 10 s.
		assert client.post(MESSAGES_URL, json={'text': f'Message {i}'}).status_code == 201

	res = client.post(MESSAGES_URL, json={'text': 'Too fast'})
	assert res.status_code == 429
	assert 'too quickly' in res.get_json()['error']


def test_post_payload_oversized(client):
	res = client.post(
		MESSAGES_URL,
		data=json.dumps({'text': 'x' * 17000}),
		content_type='application/json',
	)
	assert res.status_code == 413
	assert 'maximum allowed size' in res.get_json()['error']


def test_post_payload_oversized_without_content_length(client):
	# Servers set wsgi.input_terminated for chunked bodies, which carry no usable Content-Length.
	res = client.post(
		MESSAGES_URL,
		input_stream=BytesIO(json.dumps({'text': 'x' * 17000}).encode()),
		content_type='application/json',
		headers={'Transfer-Encoding': 'chunked'},
		environ_overrides={'wsgi.input_terminated': True},
	)
	assert res.status_code == 413

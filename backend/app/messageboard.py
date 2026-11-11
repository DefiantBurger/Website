"""Ephemeral anonymous message board. All state is in process memory and resets on restart."""

from __future__ import annotations

import re
import threading
import time
import unicodedata
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from .errors import ApiError

MESSAGE_TTL_SECONDS = 60.0
MAX_MESSAGES_STORED = 200
MAX_MESSAGE_LENGTH = 280
RATE_LIMIT_WINDOW_SECONDS = 10.0
RATE_LIMIT_MAX_REQUESTS = 5

# Control, format (zero-width, bidi overrides), surrogate, private-use, unassigned,
# and line/paragraph-separator characters. Ordinary punctuation is safe because the
# frontend renders messages as text, never as HTML.
_DROPPED_CATEGORIES = frozenset({'Cc', 'Cf', 'Cs', 'Co', 'Cn', 'Zl', 'Zp'})
# Newline, plus the zero-width joiner and tag characters that emoji sequences
# (family, subdivision flags) depend on.
_KEPT_CHARS = frozenset({'\n', '\u200d'}) | {chr(c) for c in range(0xE0020, 0xE0080)}


class MessageBoardError(ApiError):
	pass


@dataclass(frozen=True)
class BoardMessageRecord:
	id: str
	text: str
	created_at: str
	expires_at: str
	expires_at_epoch: float

	def to_json(self) -> dict:
		return {
			'id': self.id,
			'text': self.text,
			'createdAt': self.created_at,
			'expiresAt': self.expires_at,
		}


def _now(now: float | None) -> float:
	# Tests pass `now` explicitly; production uses the wall clock.
	return time.time() if now is None else now


def _is_kept(char: str) -> bool:
	return char in _KEPT_CHARS or unicodedata.category(char) not in _DROPPED_CATEGORIES


def sanitize_message_text(raw_text: object) -> str:
	"""Drop invisible and control characters, collapse blank lines, and enforce the length limit."""
	if raw_text is None:
		raise MessageBoardError('Message text is required.', 400)

	if not isinstance(raw_text, str):
		raise MessageBoardError('Message text must be a string.', 400)

	normalized = raw_text.replace('\r\n', '\n').replace('\r', '\n').replace('\t', ' ')
	# NFC so the length limit counts "é" once whether it arrived composed or not.
	normalized = unicodedata.normalize('NFC', normalized)
	cleaned = ''.join(c for c in normalized if _is_kept(c)).strip()

	if not cleaned:
		raise MessageBoardError('Message cannot be empty.', 400)

	cleaned = re.sub(r'\n{3,}', '\n\n', cleaned)

	if len(cleaned) > MAX_MESSAGE_LENGTH:
		raise MessageBoardError(
			f'Message exceeds maximum length of {MAX_MESSAGE_LENGTH} characters.',
			400,
		)

	return cleaned


class RateLimiter:
	"""Thread-safe sliding-window limiter: at most `max_requests` per `window_seconds` per client IP."""

	def __init__(
		self,
		window_seconds: float = RATE_LIMIT_WINDOW_SECONDS,
		max_requests: int = RATE_LIMIT_MAX_REQUESTS,
	):
		self.window_seconds = window_seconds
		self.max_requests = max_requests
		self._requests: dict[str, list[float]] = {}
		self._lock = threading.Lock()

	def check_and_record(self, client_ip: str, now: float | None = None) -> bool:
		current_time = _now(now)
		key = (client_ip or 'unknown').strip()
		cutoff = current_time - self.window_seconds

		with self._lock:
			timestamps = self._requests.get(key, [])
			timestamps = [t for t in timestamps if t > cutoff]

			if len(timestamps) >= self.max_requests:
				self._requests[key] = timestamps
				return False

			timestamps.append(current_time)
			self._requests[key] = timestamps

			# Bound memory by dropping IPs with no recent requests once the map grows.
			if len(self._requests) > 500:
				self._requests = {k: v for k, v in self._requests.items() if v and v[-1] > cutoff}

			return True

	def reset(self) -> None:
		with self._lock:
			self._requests.clear()


class MessageBoardStore:
	"""Thread-safe list of messages that expire after `ttl_seconds`; the oldest is dropped beyond `max_messages`."""

	def __init__(
		self, ttl_seconds: float = MESSAGE_TTL_SECONDS, max_messages: int = MAX_MESSAGES_STORED
	):
		self.ttl_seconds = ttl_seconds
		self.max_messages = max_messages
		self._messages: list[BoardMessageRecord] = []
		self._lock = threading.Lock()

	def _purge_locked(self, now: float) -> None:
		"""Drop expired messages. Caller holds `_lock`."""
		self._messages = [msg for msg in self._messages if msg.expires_at_epoch > now]

	def add_message(
		self,
		raw_text: object,
		client_ip: str,
		now: float | None = None,
	) -> BoardMessageRecord:
		current_time = _now(now)
		text = sanitize_message_text(raw_text)

		with self._lock:
			self._purge_locked(current_time)

			# Enforce storage cap
			while len(self._messages) >= self.max_messages:
				self._messages.pop(0)

			created_dt = datetime.fromtimestamp(current_time, UTC)
			expires_dt = datetime.fromtimestamp(current_time + self.ttl_seconds, UTC)

			record = BoardMessageRecord(
				id=str(uuid.uuid4()),
				text=text,
				created_at=created_dt.isoformat(),
				expires_at=expires_dt.isoformat(),
				expires_at_epoch=current_time + self.ttl_seconds,
			)
			self._messages.append(record)
			return record

	def snapshot(self, now: float | None = None) -> dict:
		"""Active messages (newest first) plus the board's limits, as `GET /messages/` returns them."""
		current_time = _now(now)
		with self._lock:
			self._purge_locked(current_time)
			messages = [msg.to_json() for msg in reversed(self._messages)]

		return {
			'messages': messages,
			# Lets the client time expiry against the server's clock, not its own.
			'serverTime': datetime.fromtimestamp(current_time, UTC).isoformat(),
			'retentionSeconds': int(self.ttl_seconds),
			'maxMessageLength': MAX_MESSAGE_LENGTH,
		}

	def reset(self) -> None:
		with self._lock:
			self._messages.clear()


board_store = MessageBoardStore()
board_rate_limiter = RateLimiter()

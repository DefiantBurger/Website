"""Ephemeral anonymous message board. All state is in process memory and resets on restart."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import re
import threading
import time
import uuid

MESSAGE_TTL_SECONDS = 60.0
MAX_MESSAGES_STORED = 200
MAX_MESSAGE_LENGTH = 280
RATE_LIMIT_WINDOW_SECONDS = 10.0
RATE_LIMIT_MAX_REQUESTS = 5

# Allowlist: Alphanumeric, safe URL punctuation, and standard whitespace (spaces/newlines)
# Characters explicitly excluded: <, >, &, ", ', and all control characters/null bytes
_ALLOWED_CHARS_PATTERN = re.compile(r'[^a-zA-Z0-9\s,.\-!/()=?`*;:_{}\[\]\\|~^]')


class MessageBoardError(RuntimeError):
	def __init__(self, message: str, status_code: int = 400):
		super().__init__(message)
		self.message = message
		self.status_code = status_code


@dataclass(frozen=True)
class BoardMessageRecord:
	id: str
	text: str
	created_at: str
	expires_at: str
	created_at_epoch: float
	expires_at_epoch: float


def sanitize_message_text(raw_text: object) -> str:
	"""
	Sanitize user message using an explicit allowlist:
	- Only allows alphanumeric characters, URL-safe punctuation, and whitespace.
	- Strips any character not in the allowlist (excluding <, >, &, ", ', etc.).
	- Normalizes whitespace and collapses excessive newlines.
	- Enforces non-empty and maximum length constraints.
	"""
	if raw_text is None:
		raise MessageBoardError('Message text is required.', 400)

	if not isinstance(raw_text, str):
		raise MessageBoardError('Message text must be a string.', 400)

	# Replace carriage returns with standard newline
	normalized = raw_text.replace('\r\n', '\n').replace('\r', '\n')

	# Strip everything outside the strict allowlist
	cleaned = _ALLOWED_CHARS_PATTERN.sub('', normalized).strip()

	if not cleaned:
		raise MessageBoardError('Message cannot be empty or contain only invalid characters.', 400)

	# Collapse excessive blank lines
	cleaned = re.sub(r'\n{3,}', '\n\n', cleaned)

	if len(cleaned) > MAX_MESSAGE_LENGTH:
		raise MessageBoardError(
			f'Message exceeds maximum length of {MAX_MESSAGE_LENGTH} characters.',
			400,
		)

	return cleaned


class RateLimiter:
	"""Thread-safe sliding-window limiter: at most `max_requests` per `window_seconds` per client IP."""

	def __init__(self, window_seconds: float = RATE_LIMIT_WINDOW_SECONDS, max_requests: int = RATE_LIMIT_MAX_REQUESTS):
		self.window_seconds = window_seconds
		self.max_requests = max_requests
		self._requests: dict[str, list[float]] = {}
		self._lock = threading.Lock()

	def check_and_record(self, client_ip: str, now: float | None = None) -> bool:
		current_time = now if now is not None else time.time()
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

	def __init__(self, ttl_seconds: float = MESSAGE_TTL_SECONDS, max_messages: int = MAX_MESSAGES_STORED):
		self.ttl_seconds = ttl_seconds
		self.max_messages = max_messages
		self._messages: list[BoardMessageRecord] = []
		self._lock = threading.Lock()

	def cleanup(self, now: float | None = None) -> int:
		current_time = now if now is not None else time.time()
		with self._lock:
			initial_count = len(self._messages)
			self._messages = [msg for msg in self._messages if msg.expires_at_epoch > current_time]
			return initial_count - len(self._messages)

	def add_message(
		self,
		raw_text: object,
		client_ip: str,
		now: float | None = None,
	) -> BoardMessageRecord:
		current_time = now if now is not None else time.time()
		text = sanitize_message_text(raw_text)

		with self._lock:
			# Purge expired messages first
			self._messages = [msg for msg in self._messages if msg.expires_at_epoch > current_time]

			# Enforce storage cap
			while len(self._messages) >= self.max_messages:
				self._messages.pop(0)

			created_dt = datetime.fromtimestamp(current_time, timezone.utc)
			expires_dt = datetime.fromtimestamp(current_time + self.ttl_seconds, timezone.utc)

			record = BoardMessageRecord(
				id=str(uuid.uuid4()),
				text=text,
				created_at=created_dt.isoformat(),
				expires_at=expires_dt.isoformat(),
				created_at_epoch=current_time,
				expires_at_epoch=current_time + self.ttl_seconds,
			)
			self._messages.append(record)
			return record

	def get_active_messages(self, now: float | None = None) -> list[dict]:
		current_time = now if now is not None else time.time()
		with self._lock:
			self._messages = [msg for msg in self._messages if msg.expires_at_epoch > current_time]

			# Return list with newest messages first
			return [
				{
					'id': msg.id,
					'text': msg.text,
					'createdAt': msg.created_at,
					'expiresAt': msg.expires_at,
				}
				for msg in reversed(self._messages)
			]

	def get_status(self, now: float | None = None) -> dict:
		current_time = now if now is not None else time.time()
		with self._lock:
			self._messages = [msg for msg in self._messages if msg.expires_at_epoch > current_time]
			active_count = len(self._messages)

		return {
			'activeCount': active_count,
			'retentionSeconds': int(self.ttl_seconds),
			'maxMessageLength': MAX_MESSAGE_LENGTH,
			'maxMessages': self.max_messages,
		}

	def reset(self) -> None:
		with self._lock:
			self._messages.clear()


board_store = MessageBoardStore()
board_rate_limiter = RateLimiter()

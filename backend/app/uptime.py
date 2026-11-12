"""Rolling uptime for the site footer, computed from the public Better Stack status page.

The status page's index.json is undocumented but needs no API token, so nothing
secret lives on the VM. If its shape changes, the footer just hides the number.
"""

import json
import logging
import threading
import time
import urllib.request
from datetime import UTC, date, datetime, timedelta

STATUS_PAGE_JSON_URL = 'https://status.josephcicalese.com/index.json'
WINDOW_DAYS = 30
FETCH_TIMEOUT_SECONDS = 3
SUCCESS_TTL_SECONDS = 15 * 60
# Short, so a Better Stack outage doesn't pin a missing number for long.
FAILURE_TTL_SECONDS = 2 * 60
SECONDS_PER_DAY = 86_400

logger = logging.getLogger(__name__)


def _fetch_status_page() -> dict:
	request = urllib.request.Request(
		STATUS_PAGE_JSON_URL,
		headers={'Accept': 'application/json', 'User-Agent': 'josephcicalese.com-footer'},
	)
	with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT_SECONDS) as response:
		return json.load(response)


def compute_uptime(payload: dict, now: datetime) -> dict | None:
	"""`{percent, days}` over the last WINDOW_DAYS monitored days of the first monitor, or None."""
	resource = next(
		(
			item['attributes']
			for item in payload.get('included', [])
			if item.get('type') == 'status_page_resource'
			and item.get('attributes', {}).get('resource_type') == 'Monitor'
		),
		None,
	)
	if resource is None:
		return None

	# History days are in the status page's timezone, which is set to UTC.
	today = now.astimezone(UTC).date()
	window_start = today - timedelta(days=WINDOW_DAYS - 1)
	elapsed_today = (now - datetime.combine(today, datetime.min.time(), UTC)).total_seconds()

	monitored_seconds = 0.0
	downtime_seconds = 0.0
	days = 0
	for entry in resource.get('status_history', []):
		day = date.fromisoformat(entry['day'])
		if not window_start <= day <= today or entry['status'] == 'not_monitored':
			continue
		length = elapsed_today if day == today else SECONDS_PER_DAY
		monitored_seconds += length - float(entry.get('maintenance_duration') or 0)
		downtime_seconds += float(entry.get('downtime_duration') or 0)
		days += 1

	if monitored_seconds <= 0:
		return None
	percent = max(0.0, 100 * (1 - downtime_seconds / monitored_seconds))
	return {'percent': round(percent, 4), 'days': days}


class UptimeCache:
	"""Caches the computed uptime; only one request at a time ever waits on Better Stack."""

	def __init__(self, fetch=_fetch_status_page, clock=time.monotonic):
		self._fetch = fetch
		self._clock = clock
		self._refresh_lock = threading.Lock()
		self._value: dict | None = None
		self._expires_at = float('-inf')

	def get(self) -> dict | None:
		if self._clock() < self._expires_at:
			return self._value
		# Another thread is already refreshing; serve what we have rather than queue up.
		if not self._refresh_lock.acquire(blocking=False):
			return self._value
		try:
			if self._clock() >= self._expires_at:
				self._refresh()
			return self._value
		finally:
			self._refresh_lock.release()

	def _refresh(self) -> None:
		try:
			value = compute_uptime(self._fetch(), datetime.now(UTC))
		except Exception:
			logger.warning('Could not load uptime from the status page', exc_info=True)
			value = None
		if value is None:
			# Keep showing the last good number (if any), but retry soon.
			self._expires_at = self._clock() + FAILURE_TTL_SECONDS
		else:
			self._value = value
			self._expires_at = self._clock() + SUCCESS_TTL_SECONDS


uptime_cache = UptimeCache()

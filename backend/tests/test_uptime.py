from datetime import UTC, date, datetime, timedelta

import pytest

from app import uptime
from app.uptime import FAILURE_TTL_SECONDS, SUCCESS_TTL_SECONDS, UptimeCache, compute_uptime

NOW = datetime(2026, 11, 12, 12, 0, tzinfo=UTC)  # Half of "today" has elapsed.


def _day(offset: int, status='operational', downtime=0, maintenance=0) -> dict:
	"""History entry `offset` days before NOW's date."""
	return {
		'day': (date(2026, 11, 12) - timedelta(days=offset)).isoformat(),
		'status': status,
		'downtime_duration': downtime,
		'maintenance_duration': maintenance,
	}


def _payload(history: list[dict], resource_type='Monitor') -> dict:
	return {
		'data': {'type': 'status_page'},
		'included': [
			{'type': 'status_page_section', 'attributes': {'name': 'Services'}},
			{
				'type': 'status_page_resource',
				'attributes': {'resource_type': resource_type, 'status_history': history},
			},
		],
	}


class FakeClock:
	def __init__(self):
		self.now = 0.0

	def __call__(self):
		return self.now


def test_full_window_of_clean_days_is_100_percent():
	history = [_day(offset) for offset in range(90)]
	assert compute_uptime(_payload(history), NOW) == {'percent': 100.0, 'days': 30}


def test_only_last_30_days_count():
	history = [_day(40, status='downtime', downtime=86_400)] + [
		_day(offset) for offset in range(30)
	]
	assert compute_uptime(_payload(history), NOW) == {'percent': 100.0, 'days': 30}


def test_downtime_over_partial_window():
	# 2 full days + half of today = 216,000 monitored seconds.
	history = [
		_day(5, status='not_monitored'),
		_day(2, status='downtime', downtime=2_160),
		_day(1),
		_day(0),
	]
	assert compute_uptime(_payload(history), NOW) == {'percent': 99.0, 'days': 3}


def test_maintenance_is_excluded_from_monitored_time():
	history = [_day(1, downtime=864, maintenance=43_200), _day(0, downtime=432)]
	# (86,400 - 43,200) + 43,200 monitored; 1,296 down.
	assert compute_uptime(_payload(history), NOW) == {'percent': 98.5, 'days': 2}


@pytest.mark.parametrize(
	'payload',
	[
		{},
		_payload([]),
		_payload([_day(0, status='not_monitored')]),
		_payload([_day(0)], resource_type='Heartbeat'),
	],
)
def test_no_usable_data_returns_none(payload):
	assert compute_uptime(payload, NOW) is None


def test_cache_fetches_once_within_ttl():
	calls = []
	clock = FakeClock()
	cache = UptimeCache(fetch=lambda: calls.append(1) or _payload([_day(0)]), clock=clock)

	assert cache.get() == {'percent': 100.0, 'days': 1}
	clock.now = SUCCESS_TTL_SECONDS - 1
	cache.get()
	assert len(calls) == 1

	clock.now = SUCCESS_TTL_SECONDS
	cache.get()
	assert len(calls) == 2


def test_failure_keeps_last_good_value_and_retries_sooner():
	responses = [_payload([_day(0)]), OSError('down'), {'unexpected': 'shape'}]
	clock = FakeClock()

	def fetch():
		response = responses.pop(0)
		if isinstance(response, Exception):
			raise response
		return response

	cache = UptimeCache(fetch=fetch, clock=clock)
	good = cache.get()

	clock.now = SUCCESS_TTL_SECONDS
	assert cache.get() == good

	clock.now = SUCCESS_TTL_SECONDS + FAILURE_TTL_SECONDS
	assert cache.get() == good
	assert responses == []


def test_failure_before_any_success_returns_none():
	def fetch():
		raise OSError('down')

	assert UptimeCache(fetch=fetch, clock=FakeClock()).get() is None


def test_site_info_endpoint(client, monkeypatch):
	monkeypatch.setattr(uptime, 'uptime_cache', UptimeCache(fetch=lambda: _payload([_day(0)])))
	res = client.get('/api/site-info/')
	assert res.status_code == 200
	assert res.get_json() == {'uptime': {'percent': 100.0, 'days': 1}}
	assert res.headers['Cache-Control'] == 'public, max-age=300'


def test_site_info_endpoint_without_uptime(client, monkeypatch):
	def fetch():
		raise OSError('down')

	monkeypatch.setattr(uptime, 'uptime_cache', UptimeCache(fetch=fetch))
	assert client.get('/api/site-info/').get_json() == {'uptime': None}


def test_real_fetch_parses_json(monkeypatch):
	"""The urllib path itself, with the network replaced."""

	class FakeResponse:
		def __enter__(self):
			return self

		def __exit__(self, *exc):
			return False

		def read(self, *args):
			return b'{"included": []}'

	seen = {}

	def fake_urlopen(request, timeout):
		seen['url'] = request.full_url
		seen['timeout'] = timeout
		return FakeResponse()

	monkeypatch.setattr(uptime.urllib.request, 'urlopen', fake_urlopen)
	assert uptime._fetch_status_page() == {'included': []}
	assert seen == {'url': uptime.STATUS_PAGE_JSON_URL, 'timeout': uptime.FETCH_TIMEOUT_SECONDS}

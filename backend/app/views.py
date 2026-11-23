import unicodedata
from urllib.parse import quote

from flask import (
	Blueprint,
	Response,
	current_app,
	jsonify,
	request,
)
from werkzeug.exceptions import RequestEntityTooLarge
from werkzeug.http import dump_options_header

from . import uptime
from .errors import ApiError
from .fileshare import (
	acquire_transfer_slot,
	get_all_records_for_password,
	get_record_for_password,
	get_storage_status,
	open_record_payload,
	save_upload,
	transfer_slot,
)
from .messageboard import MAX_POST_BYTES, board_rate_limiter, board_store

views = Blueprint('views', __name__)


@views.errorhandler(ApiError)
def _api_error(exc: ApiError):
	return jsonify({'error': exc.message}), exc.status_code


# Stand-in location for the local dev server, which never sees Cloudflare headers.
_DEV_GEOLOCATION = {
	'available': True,
	'provider': 'Development default',
	'country': 'US',
	'region': 'New York',
	'city': 'New York',
	'postal': '10001',
	'timezone': 'America/New_York',
	'latitude': 40.7128,
	'longitude': -74.006,
}


def _cloudflare_header(name: str) -> str:
	# Cloudflare sends UTF-8 header values (e.g. city names), but WSGI decodes
	# headers as latin-1, so re-decode them.
	raw = request.headers.get(name, '').strip()
	try:
		return raw.encode('latin-1').decode('utf-8')
	except (UnicodeEncodeError, UnicodeDecodeError):
		return raw


def _parse_coordinate(raw: str) -> float | None:
	try:
		return float(raw)
	except ValueError:
		return None


def _attachment_header(filename: str) -> str:
	"""Content-Disposition for a download, built the way Werkzeug's send_file does: the
	name as `filename`, or for a non-ASCII name an ASCII fallback plus the real one in `filename*`."""
	if filename.isascii():
		return dump_options_header('attachment', {'filename': filename})
	fallback = unicodedata.normalize('NFKD', filename).encode('ascii', 'ignore').decode('ascii')
	encoded = quote(filename, safe='!#$&+-.^_`|~')
	return dump_options_header(
		'attachment', {'filename': fallback, 'filename*': f"UTF-8''{encoded}"}
	)


def _cloudflare_geolocation() -> dict:
	# Populated by Cloudflare's "Add visitor location headers" Managed Transform.
	country = _cloudflare_header('CF-IPCountry')
	city = _cloudflare_header('CF-IPCity')
	if not country and not city:
		if current_app.debug:
			return dict(_DEV_GEOLOCATION)
		return {
			'available': False,
			'reason': 'Cloudflare location headers were not present.',
		}

	return {
		'available': True,
		'provider': 'Cloudflare',
		'country': country,
		'region': _cloudflare_header('CF-Region'),
		'city': city,
		'postal': _cloudflare_header('CF-Postal-Code'),
		'timezone': _cloudflare_header('CF-Timezone'),
		'latitude': _parse_coordinate(_cloudflare_header('CF-IPLatitude')),
		'longitude': _parse_coordinate(_cloudflare_header('CF-IPLongitude')),
	}


@views.route('/api/health/', methods=['GET'])
def health():
	"""Liveness check used by the deploy script and the CI smoke test."""
	return jsonify({'status': 'ok'})


@views.route('/api/site-info/', methods=['GET'])
def site_info():
	"""Footer data. Kept apart from /api/health/ so deploy checks never depend on Better Stack."""
	response = jsonify({'uptime': uptime.uptime_cache.get()})
	response.headers['Cache-Control'] = 'public, max-age=300'
	return response


@views.route('/api/fileshare/status/', methods=['GET'])
def fileshare_status():
	return jsonify(get_storage_status())


@views.route('/api/fileshare/upload/', methods=['POST'])
def fileshare_upload():
	# Form fields: file, password, and replace=1 on a batch's first file, which then
	# replaces the key's earlier files once it's stored.
	password = request.form.get('password', '')
	replace = request.form.get('replace') == '1'
	with transfer_slot():
		record = save_upload(request.files.get('file'), password, replace=replace)

	return jsonify(record.to_json())


@views.route('/api/fileshare/access/', methods=['POST'])
def fileshare_access():
	# Form fields: password, id (which of the key's files, from the list or upload response).
	password = request.form.get('password', '')
	record = get_record_for_password(password, request.form.get('id', ''))
	if record is None:
		raise ApiError('No active file matched that password.', 404)

	# Decryption runs while the body is sent, so the slot is held until the response closes.
	release_slot = acquire_transfer_slot()
	try:
		chunks = open_record_payload(record, password)
	except BaseException:
		release_slot()
		raise

	# Never echo the uploader-supplied MIME type: serving e.g. text/html from this
	# origin would let an uploaded file run scripts if a browser rendered it.
	response = Response(
		chunks,
		mimetype='application/octet-stream',
		headers={
			'Content-Disposition': _attachment_header(record.original_filename),
			# Lets the client detect a stream cut short by a corrupt later chunk.
			'Content-Length': str(record.size_bytes),
			'Cache-Control': 'no-store',
			'X-Content-Type-Options': 'nosniff',
		},
	)
	response.call_on_close(release_slot)
	return response


@views.route('/api/fileshare/list/', methods=['POST'])
def fileshare_list():
	password = request.form.get('password', '')

	records = get_all_records_for_password(password)
	if not records:
		raise ApiError('No active files matched that access key.', 404)

	return jsonify({'files': [record.to_json() for record in records]})


@views.route('/api/about-you/request-context/', methods=['GET'])
def about_you_request_context():
	# Everything the server can see about this request, for the About You page.
	# In production Waitress has already set remote_addr from Nginx's X-Forwarded-For.
	return jsonify(
		{
			'network': {'clientIp': request.remote_addr or 'Unavailable'},
			'geolocation': _cloudflare_geolocation(),
			'headers': {
				'userAgent': request.headers.get('User-Agent', ''),
				'acceptLanguage': request.headers.get('Accept-Language', ''),
				'referer': request.headers.get('Referer', ''),
				'doNotTrack': request.headers.get('DNT', ''),
			},
		}
	)


@views.route('/api/messageboard/messages/', methods=['GET'])
def messageboard_messages():
	return jsonify(board_store.snapshot())


@views.route('/api/messageboard/messages/', methods=['POST'])
def messageboard_post_message():
	raw_ip = request.remote_addr or ''

	# Rate limit before validating so rejected posts still count toward the limit.
	if not board_rate_limiter.check_and_record(raw_ip):
		raise ApiError('You are posting too quickly. Please wait a few seconds.', 429)

	# Capped while reading, so an oversized body is never read in full. Werkzeug cuts a
	# chunked body off at the cap instead of rejecting it, so read one byte past it.
	request.max_content_length = MAX_POST_BYTES + 1
	try:
		too_large = len(request.get_data()) > MAX_POST_BYTES
	except RequestEntityTooLarge:  # Content-Length alone was over the cap.
		too_large = True
	if too_large:
		raise ApiError('Payload exceeds maximum allowed size.', 413)

	data = request.get_json(silent=True)
	text = data.get('text') if isinstance(data, dict) else None

	record = board_store.add_message(text, raw_ip)
	return jsonify(record.to_json()), 201

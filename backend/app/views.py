from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path

from flask import (
	Blueprint,
	current_app,
	jsonify,
	request,
	send_file,
	send_from_directory,
)
from werkzeug.wsgi import ClosingIterator

from .errors import ApiError
from .fileshare import (
	acquire_transfer_slot,
	decrypt_record_payload,
	delete_records,
	get_all_records_for_password,
	get_record_for_password,
	get_storage_status,
	save_upload,
	transfer_slot,
)
from .messageboard import board_rate_limiter, board_store

views = Blueprint('views', __name__)


@views.errorhandler(ApiError)
def _api_error(exc: ApiError):
	return jsonify({'error': exc.message}), exc.status_code


_JSON_DATA_DIR = Path(__file__).resolve().parent / 'static' / 'json'

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


def _resolve_client_ip() -> tuple[str, str]:
	"""Return (ip, header it came from). Headers are trusted because the origin is only reachable via Cloudflare."""
	cf_connecting_ip = request.headers.get('CF-Connecting-IP', '').strip()
	if cf_connecting_ip:
		return cf_connecting_ip, 'CF-Connecting-IP'

	x_forwarded_for = request.headers.get('X-Forwarded-For', '').strip()
	if x_forwarded_for:
		first_ip = x_forwarded_for.split(',')[0].strip()
		if first_ip:
			return first_ip, 'X-Forwarded-For'

	x_real_ip = request.headers.get('X-Real-IP', '').strip()
	if x_real_ip:
		return x_real_ip, 'X-Real-IP'

	return (request.remote_addr or '').strip(), 'remote_addr'


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


@views.route('/api/scheduler/course-data/', methods=['GET'])
def scheduler_course_data():
	return send_from_directory(_JSON_DATA_DIR, 'course_data.json')


@views.route('/api/scheduler/default-schedule/', methods=['GET'])
def scheduler_default_schedule():
	return send_from_directory(_JSON_DATA_DIR, 'my_courses.json')


@views.route('/api/fileshare/status/', methods=['GET'])
def fileshare_status():
	return jsonify(get_storage_status())


@views.route('/api/fileshare/upload/', methods=['POST'])
def fileshare_upload():
	# Form fields: file, password. Always appends; the client deletes the old batch afterwards.
	uploaded_file = request.files.get('file')
	password = request.form.get('password', '')

	if uploaded_file is None:
		return jsonify({'error': 'A file is required.'}), 400

	with transfer_slot():
		record = save_upload(uploaded_file, password)

	return jsonify(record.to_json())


@views.route('/api/fileshare/delete/', methods=['POST'])
def fileshare_delete():
	# Form fields: password, occurrenceIndices (comma-separated).
	password = request.form.get('password', '')
	try:
		occurrence_indices = [
			int(part)
			for part in request.form.get('occurrenceIndices', '').split(',')
			if part.strip()
		]
	except ValueError:
		return jsonify({'error': 'Invalid occurrence index.'}), 400

	return jsonify({'deletedCount': delete_records(password, occurrence_indices)})


@views.route('/api/fileshare/access/', methods=['POST'])
def fileshare_access():
	# Form fields: password, occurrenceIndex (which of the key's files; default 1).
	password = request.form.get('password', '')
	occurrence_index_str = request.form.get('occurrenceIndex', '1')

	try:
		occurrence_index = int(occurrence_index_str)
	except ValueError:
		return jsonify({'error': 'Invalid occurrence index.'}), 400

	record = get_record_for_password(password, occurrence_index)
	if record is None:
		return jsonify({'error': 'No active file matched that password.'}), 404

	release_slot = acquire_transfer_slot()

	# The plaintext stays in memory until the server finishes sending it, so the
	# slot is held until the response closes, not just through decryption.
	try:
		plaintext = decrypt_record_payload(record, password)
		# Never echo the uploader-supplied MIME type: serving e.g. text/html from this
		# origin would let an uploaded file run scripts if a browser rendered it.
		response = send_file(
			BytesIO(plaintext),
			as_attachment=True,
			download_name=record.original_filename,
			mimetype='application/octet-stream',
			max_age=0,
		)
	except BaseException:
		release_slot()
		raise

	response.headers['X-Content-Type-Options'] = 'nosniff'
	# send_file sets direct_passthrough, so the server gets the body iterable as-is and
	# never calls response.close(); call_on_close would never fire. Wrap the body instead.
	response.response = ClosingIterator(response.response, release_slot)
	return response


@views.route('/api/fileshare/list/', methods=['POST'])
def fileshare_list():
	password = request.form.get('password', '')

	records = get_all_records_for_password(password)
	if not records:
		return jsonify({'error': 'No active files matched that access key.'}), 404

	return jsonify({'files': [record.to_json() for record in records]})


@views.route('/api/about-you/request-context/', methods=['GET'])
def about_you_request_context():
	# Everything the server can see about this request, for the About You page.
	raw_ip, ip_source = _resolve_client_ip()
	geolocation = _cloudflare_geolocation()

	has_forwarded_headers = any(
		bool(request.headers.get(header_name, '').strip())
		for header_name in ['CF-Connecting-IP', 'X-Forwarded-For', 'X-Real-IP', 'Forwarded']
	)

	return jsonify(
		{
			'timestamp': datetime.now(UTC).isoformat(),
			'request': {
				'method': request.method,
				'path': request.path,
			},
			'network': {
				'clientIp': raw_ip or 'Unavailable',
				'ipSource': ip_source,
				'hasForwardedHeaders': has_forwarded_headers,
			},
			'geolocation': geolocation,
			'headers': {
				'userAgent': request.headers.get('User-Agent', ''),
				'acceptLanguage': request.headers.get('Accept-Language', ''),
				'referer': request.headers.get('Referer', ''),
				'doNotTrack': request.headers.get('DNT', ''),
			},
		}
	)


@views.route('/api/messageboard/status/', methods=['GET'])
def messageboard_status():
	return jsonify(board_store.get_status())


@views.route('/api/messageboard/messages/', methods=['GET'])
def messageboard_messages():
	messages = board_store.get_active_messages()
	return jsonify(
		{
			'messages': messages,
			'retentionSeconds': int(board_store.ttl_seconds),
		}
	)


@views.route('/api/messageboard/messages/', methods=['POST'])
def messageboard_post_message():
	raw_ip, _ = _resolve_client_ip()

	# Rate limit before validating so rejected posts still count toward the limit.
	if not board_rate_limiter.check_and_record(raw_ip):
		return jsonify({'error': 'You are posting too quickly. Please wait a few seconds.'}), 429

	# Measure the body itself: a chunked request has no Content-Length to check.
	if len(request.get_data()) > 16384:
		return jsonify({'error': 'Payload exceeds maximum allowed size.'}), 413

	data = request.get_json(silent=True)
	if data is None:
		data = request.form

	text = data.get('text') if hasattr(data, 'get') else None

	record = board_store.add_message(text, raw_ip)
	return jsonify(record.to_json()), 201

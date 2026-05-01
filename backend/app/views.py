from pathlib import Path
from datetime import datetime, timezone
from io import BytesIO
import ipaddress
import json
from urllib import error as urllib_error
from urllib import parse as urllib_parse
from urllib import request as urllib_request

import yaml

from flask import Blueprint, abort, jsonify, request, send_file, send_from_directory

from .fileshare import (
	FileShareError,
	cleanup_expired_records,
	decrypt_record_payload,
	get_record_for_password,
	get_all_records_for_password,
	get_storage_status,
	save_upload,
)

views = Blueprint('views', __name__)

_JSON_DATA_DIR = (
	Path(__file__).resolve().parent / 'static' / 'json'
)
_PROJECTS_CONTENT_DIR = Path(__file__).resolve().parent / 'content' / 'projects'


def _resolve_client_ip() -> tuple[str, str]:
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


def _mask_ip(raw_ip: str) -> str:
	if not raw_ip:
		return 'Unavailable'

	try:
		parsed = ipaddress.ip_address(raw_ip)
	except ValueError:
		return 'Unavailable'

	if isinstance(parsed, ipaddress.IPv4Address):
		parts = raw_ip.split('.')
		if len(parts) == 4:
			return f'{parts[0]}.{parts[1]}.{parts[2]}.x'
		return 'Unavailable'

	hextets = parsed.exploded.split(':')
	return f'{hextets[0]}:{hextets[1]}:{hextets[2]}:xxxx:xxxx:xxxx:xxxx:xxxx'


def _is_public_ip(raw_ip: str) -> bool:
	if not raw_ip:
		return False

	try:
		parsed = ipaddress.ip_address(raw_ip)
	except ValueError:
		return False

	return not (
		parsed.is_private
		or parsed.is_loopback
		or parsed.is_link_local
		or parsed.is_multicast
		or parsed.is_reserved
		or parsed.is_unspecified
	)


def _lookup_ip_geolocation(raw_ip: str) -> dict:
	if not _is_public_ip(raw_ip):
		return {
			'available': False,
			'reason': 'IP is not public or unavailable.',
		}

	url = f"https://ipapi.co/{urllib_parse.quote(raw_ip)}/json/"

	try:
		with urllib_request.urlopen(url, timeout=2.0) as response:
			payload = response.read().decode('utf-8')
			data = json.loads(payload)
	except (urllib_error.URLError, urllib_error.HTTPError, TimeoutError, json.JSONDecodeError):
		return {
			'available': False,
			'reason': 'Geolocation lookup failed.',
		}

	if isinstance(data, dict) and data.get('error'):
		return {
			'available': False,
			'reason': str(data.get('reason') or 'Geolocation provider returned an error.'),
		}

	return {
		'available': True,
		'provider': 'ipapi.co',
		'country': str(data.get('country_name') or ''),
		'region': str(data.get('region') or ''),
		'city': str(data.get('city') or ''),
		'postal': str(data.get('postal') or ''),
		'timezone': str(data.get('timezone') or ''),
		'latitude': data.get('latitude'),
		'longitude': data.get('longitude'),
		'asn': str(data.get('asn') or ''),
		'org': str(data.get('org') or ''),
	}


def _parse_project_markdown(file_path: Path) -> tuple[dict, str]:
	text = file_path.read_text(encoding='utf-8')

	if not text.startswith('---\n'):
		return {}, text

	parts = text.split('---\n', 2)
	if len(parts) < 3:
		return {}, text

	meta = yaml.safe_load(parts[1]) or {}
	body = parts[2].lstrip('\n')
	return meta, body


def _project_payload_from_file(file_path: Path) -> dict:
	meta, markdown = _parse_project_markdown(file_path)
	slug = str(meta.get('slug') or file_path.stem)

	tags = meta.get('tags') or []
	if not isinstance(tags, list):
		tags = []

	return {
		'slug': slug,
		'title': str(meta.get('title') or slug.replace('-', ' ').title()),
		'summary': str(meta.get('summary') or ''),
		'date': str(meta.get('date') or ''),
		'tags': [str(tag) for tag in tags],
		'repo': str(meta.get('repo') or ''),
		'demo': str(meta.get('demo') or ''),
		'published': bool(meta.get('published', True)),
		'markdown': markdown,
	}

@views.route('/static/<path:filename>')
def static_files(filename):
	return send_from_directory('static', filename)


@views.route('/api/scheduler/course-data/', methods=['GET'])
def scheduler_course_data():
	return send_from_directory(_JSON_DATA_DIR, 'course_data.json')


@views.route('/api/scheduler/default-schedule/', methods=['GET'])
def scheduler_default_schedule():
	return send_from_directory(_JSON_DATA_DIR, 'physics_courses.json')


@views.route('/api/projects/', methods=['GET'])
def projects_list():
	projects: list[dict] = []

	for file_path in sorted(_PROJECTS_CONTENT_DIR.glob('*.md')):
		project = _project_payload_from_file(file_path)
		if not project['published']:
			continue
		project.pop('markdown', None)
		projects.append(project)

	projects.sort(key=lambda item: item.get('date', ''), reverse=True)
	return jsonify(projects)


@views.route('/api/projects/<slug>/', methods=['GET'])
def project_detail(slug: str):
	for file_path in _PROJECTS_CONTENT_DIR.glob('*.md'):
		project = _project_payload_from_file(file_path)
		if not project['published']:
			continue
		if project['slug'] == slug:
			return jsonify(project)

	abort(404)


@views.route('/api/fileshare/status/', methods=['GET'])
def fileshare_status():
	cleanup_expired_records()
	return jsonify(get_storage_status())


@views.route('/api/fileshare/upload/', methods=['POST'])
def fileshare_upload():
	uploaded_file = request.files.get('file')
	password = request.form.get('password', '')
	clear_existing_str = request.form.get('clearExisting', 'false')
	clear_existing = clear_existing_str.lower() == 'true'

	if uploaded_file is None:
		return jsonify({'error': 'A file is required.'}), 400

	try:
		record = save_upload(uploaded_file, password, clear_existing=clear_existing)
	except FileShareError as exc:
		return jsonify({'error': exc.message}), exc.status_code

	return jsonify({
		'label': record.label,
		'originalFilename': record.original_filename,
		'sizeBytes': record.size_bytes,
		'uploadedAt': record.uploaded_at,
		'expiresAt': record.expires_at,
		'downloadEndpoint': '/api/fileshare/access/',
	})


@views.route('/api/fileshare/access/', methods=['POST'])
def fileshare_access():
	password = request.form.get('password', '')
	occurrence_index_str = request.form.get('occurrenceIndex', '1')
	
	try:
		occurrence_index = int(occurrence_index_str)
	except ValueError:
		return jsonify({'error': 'Invalid occurrence index.'}), 400
	
	record = get_record_for_password(password, occurrence_index)
	if record is None:
		return jsonify({'error': 'No active file matched that password.'}), 404

	try:
		plaintext = decrypt_record_payload(record, password)
	except FileShareError as exc:
		return jsonify({'error': exc.message}), exc.status_code

	return send_file(
		BytesIO(plaintext),
		as_attachment=True,
		download_name=record.original_filename,
		mimetype=record.mime_type,
		max_age=0,
	)


@views.route('/api/fileshare/list/', methods=['POST'])
def fileshare_list():
	password = request.form.get('password', '')
	
	records = get_all_records_for_password(password)
	if not records:
		return jsonify({'error': 'No active files matched that access key.'}), 404
	
	return jsonify({
		'files': [
			{
				'occurrenceIndex': idx,
				'originalFilename': record.original_filename,
				'sizeBytes': record.size_bytes,
				'uploadedAt': record.uploaded_at,
				'expiresAt': record.expires_at,
			}
			for idx, record in enumerate(records, start=1)
		],
	})


@views.route('/api/about-you/request-context/', methods=['GET'])
def about_you_request_context():
	raw_ip, ip_source = _resolve_client_ip()
	geolocation = _lookup_ip_geolocation(raw_ip)

	has_forwarded_headers = any(
		bool(request.headers.get(header_name, '').strip())
		for header_name in ['CF-Connecting-IP', 'X-Forwarded-For', 'X-Real-IP', 'Forwarded']
	)

	return jsonify({
		'timestamp': datetime.now(timezone.utc).isoformat(),
		'request': {
			'method': request.method,
			'path': request.path,
		},
		'network': {
			'clientIp': raw_ip or 'Unavailable',
			'clientIpMasked': _mask_ip(raw_ip),
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
	})
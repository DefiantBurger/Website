from pathlib import Path

import yaml

from flask import Blueprint, abort, jsonify, send_from_directory

views = Blueprint('views', __name__)

_SCHEDULER_DATA_DIR = (
	Path(__file__).resolve().parent / 'static' / 'json'
)
_PROJECTS_CONTENT_DIR = Path(__file__).resolve().parent / 'content' / 'projects'


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


@views.route('/api/scheduler/course-data', methods=['GET'])
def scheduler_course_data():
	return send_from_directory(_SCHEDULER_DATA_DIR, 'course_data.json')


@views.route('/api/scheduler/default-schedule', methods=['GET'])
def scheduler_default_schedule():
	return send_from_directory(_SCHEDULER_DATA_DIR, 'physics_courses.json')


@views.route('/api/projects', methods=['GET'])
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


@views.route('/api/projects/<slug>', methods=['GET'])
def project_detail(slug: str):
	for file_path in _PROJECTS_CONTENT_DIR.glob('*.md'):
		project = _project_payload_from_file(file_path)
		if not project['published']:
			continue
		if project['slug'] == slug:
			return jsonify(project)

	abort(404)
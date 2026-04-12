from pathlib import Path

from flask import Blueprint, send_from_directory

views = Blueprint('views', __name__)

_SCHEDULER_DATA_DIR = (
	Path(__file__).resolve().parent / 'static' / 'json'
)

@views.route('/static/<path:filename>')
def static_files(filename):
	return send_from_directory('static', filename)


@views.route('/api/scheduler/course-data', methods=['GET'])
def scheduler_course_data():
	return send_from_directory(_SCHEDULER_DATA_DIR, 'course_data.json')


@views.route('/api/scheduler/default-schedule', methods=['GET'])
def scheduler_default_schedule():
	return send_from_directory(_SCHEDULER_DATA_DIR, 'physics_courses.json')
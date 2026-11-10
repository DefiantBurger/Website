import os

from flask import Flask, current_app, jsonify, request
from flask_cors import CORS
from werkzeug.middleware.proxy_fix import ProxyFix

from .fileshare import MAX_FILE_BYTES


def create_app(test_config: dict | None = None, instance_path: str | None = None):
	"""Build the app. `test_config` overrides config (including SECRET_KEY); `instance_path` relocates file-share storage."""
	# static_folder=None: app/static/ holds scheduler data served only through /api/scheduler/.
	if instance_path is not None:
		app = Flask(__name__, instance_path=instance_path, static_folder=None)
	else:
		app = Flask(__name__, static_folder=None)

	# Production serves the frontend from the same origin, so CORS is only needed
	# for the Vite dev server, which runs on a different port.
	if os.getenv('FLASK_ENV') == 'development':
		CORS(app, resources={r'/api/*': {'origins': '*'}})

	secret_key = None
	if test_config and 'SECRET_KEY' in test_config:
		secret_key = test_config['SECRET_KEY']
	else:
		secret_key = os.getenv('SECRET_KEY')

	if secret_key is None:
		raise ValueError('SECRET_KEY environment variable is not set')
	app.config['SECRET_KEY'] = secret_key
	# Nginx is the only hop in front of the app and sets X-Forwarded-For (the
	# visitor's IP) and X-Forwarded-Proto, so redirects and remote_addr are correct.
	app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)
	# The file cap plus headroom for multipart overhead. Kept below nginx's 81M so
	# oversized uploads get this app's JSON 413, not nginx's HTML one.
	app.config['MAX_CONTENT_LENGTH'] = MAX_FILE_BYTES + 1024 * 1024

	if test_config:
		app.config.update(test_config)

	@app.errorhandler(404)
	def page_not_found(e):
		current_app.logger.warning(f'404 Not Found: {request.path!r} from {request.remote_addr}')
		return jsonify({'error': 'Not Found'}), 404

	with app.app_context():
		from .views import views

		app.register_blueprint(views, url_prefix='/')

	return app

import os

from flask import Flask, current_app, jsonify, request
from flask_cors import CORS


def create_app(test_config: dict | None = None, instance_path: str | None = None):
	if instance_path is not None:
		app = Flask(__name__, instance_path=instance_path)
	else:
		app = Flask(__name__)

	# Production serves the frontend from the same origin, so CORS is only needed
	# for the Vite dev server, which runs on a different port.
	if os.getenv("FLASK_ENV") == "development":
		CORS(app, resources={r"/api/*": {"origins": "*"}})

	secret_key = None
	if test_config and 'SECRET_KEY' in test_config:
		secret_key = test_config['SECRET_KEY']
	else:
		secret_key = os.getenv("SECRET_KEY")

	if secret_key is None:
		raise ValueError("SECRET_KEY environment variable is not set")
	app.config['SECRET_KEY'] = secret_key
	# Matches nginx's 100M upload limit, plus headroom for multipart form overhead.
	app.config['MAX_CONTENT_LENGTH'] = 101 * 1024 * 1024

	if test_config:
		app.config.update(test_config)

	@app.errorhandler(404)
	def page_not_found(e):
		current_app.logger.warning(f"404 Not Found: {request.path!r} from {request.remote_addr}")
		return jsonify({'error': 'Not Found'}), 404

	with app.app_context():
		from .views import views
		app.register_blueprint(views, url_prefix='/')

	return app
import os

from flask import Flask, render_template, current_app, request
from flask_cors import CORS


def create_app():
	app = Flask(__name__)
	CORS(app, resources={r"/api/*": {"origins": "*"}})

	if os.getenv("SECRET_KEY") is None:
		raise ValueError("SECRET_KEY environment variable is not set")
	app.config['SECRET_KEY'] = os.getenv("SECRET_KEY")

	@app.errorhandler(404)
	def page_not_found(e):
		current_app.logger.warning(f"404 Not Found: {request.path} from {request.remote_addr}")
		return render_template('404.html'), 404

	with app.app_context():
		from .views import views
		app.register_blueprint(views, url_prefix='/')

	return app
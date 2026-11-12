import logging
import os

from dotenv import load_dotenv
from flask import request
from waitress import serve

from app import create_app
from app.fileshare import start_expiry_sweeper

load_dotenv()

# Any value other than "development" or "production" starts no server.
env = os.getenv('FLASK_ENV', 'production')

# Production keeps runtime data outside the read-only release directory.
app = create_app(instance_path=os.getenv('PERSONALWEBSITE_INSTANCE_PATH'))

# Waitress writes no access log, so production logs each request itself. The dev
# server already prints one line per request, so this would only duplicate it.
if env == 'production':
	# Flask's logger inherits the root WARNING level, which would drop these lines.
	app.logger.setLevel(logging.INFO)

	@app.before_request
	def log_request_info():
		app.logger.info(
			f'Received {request.method} request for {request.path!r} from {request.remote_addr}'
		)


if __name__ == '__main__':
	port = int(os.getenv('PORT', '5000'))

	if env == 'development':
		app.run(port=port, debug=True)
	elif env == 'production':
		# Only here, not in create_app: tests and the dev reloader would start extra sweepers.
		start_expiry_sweeper(app)
		# Only nginx on the same VM should reach the app.
		serve(app, host='127.0.0.1', port=port)

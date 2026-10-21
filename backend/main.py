import os

from dotenv import load_dotenv
from flask import request
from waitress import serve

from app import create_app

load_dotenv()

# Production keeps runtime data outside the read-only release directory.
app = create_app(instance_path=os.getenv("PERSONALWEBSITE_INSTANCE_PATH"))

@app.before_request
def log_request_info():
	app.logger.info(f"Received {request.method} request for {request.path!r} from {request.remote_addr}")

if __name__ == "__main__":
	port = int(os.getenv("PORT", "5000"))
	# Any other FLASK_ENV value starts no server.
	env = os.getenv("FLASK_ENV", "production")

	if env == "development":
		app.run(port=port, debug=True)
	elif env == "production":
		# Only nginx on the same VM should reach the app.
		serve(app, host="127.0.0.1", port=port)
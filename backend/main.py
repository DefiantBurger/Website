import os

from dotenv import load_dotenv
from flask import request
from waitress import serve

from app import create_app

load_dotenv()

app = create_app()

@app.before_request
def log_request_info():
	app.logger.info(f"Received {request.method} request for {request.path} from {request.remote_addr}")

if __name__ == "__main__":
	port = int(os.getenv("PORT", 5000))
	env = os.getenv("FLASK_ENV", "production")

	if env == "development":
		app.run(port=port, debug=True)
	elif env == "production":
		serve(app, host="0.0.0.0", port=port)
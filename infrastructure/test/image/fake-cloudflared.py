# Stands in for cloudflared's metrics server: /ready answers 200 as if the tunnel were
# connected, or 503 while /etc/test/tunnel-down exists.
import http.server
import os


class Handler(http.server.BaseHTTPRequestHandler):
	def do_GET(self):
		down = os.path.exists('/etc/test/tunnel-down')
		self.send_response(503 if down or self.path != '/ready' else 200)
		self.end_headers()


http.server.HTTPServer(('127.0.0.1', 20241), Handler).serve_forever()

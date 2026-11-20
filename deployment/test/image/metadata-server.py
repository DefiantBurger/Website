# Stub of the GCE metadata server's guest attributes: logs each PUT as "<key> <value>"
# to /var/log/guest-attributes, which vm.test.sh reads.
import http.server

PREFIX = '/computeMetadata/v1/instance/guest-attributes/'


class Handler(http.server.BaseHTTPRequestHandler):
	def do_PUT(self):
		body = self.rfile.read(int(self.headers.get('Content-Length', 0))).decode()
		if self.headers.get('Metadata-Flavor') != 'Google' or not self.path.startswith(PREFIX):
			self.send_response(403)
		else:
			with open('/var/log/guest-attributes', 'a') as log:
				log.write(f'{self.path[len(PREFIX) :]} {body}\n')
			self.send_response(200)
		self.end_headers()


http.server.HTTPServer(('127.0.0.2', 80), Handler).serve_forever()

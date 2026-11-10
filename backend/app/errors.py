class ApiError(RuntimeError):
	"""A client-facing error; the views blueprint turns it into `{'error': message}` with `status_code`."""

	def __init__(self, message: str, status_code: int = 400):
		super().__init__(message)
		self.message = message
		self.status_code = status_code

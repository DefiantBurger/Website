# Backend Documentation

## Stack

- Flask
- Flask-CORS
- Waitress
- python-dotenv

Packaging and dependency metadata are in `backend/pyproject.toml`.

## Application Entry

`backend/main.py`:

- Loads `.env` values with `load_dotenv()`.
- Builds app via `create_app()`.
- Logs each request method/path/remote address through `@app.before_request`.
- Starts:
  - Flask dev server when `FLASK_ENV=development`.
  - Waitress server on `0.0.0.0:$PORT` in production.

## App Factory

`backend/app/__init__.py`:

- Creates Flask app.
- Configures CORS only for `/api/*` with `origins=*`.
- Requires `SECRET_KEY`; raises `ValueError` if missing.
- Registers `views` blueprint at `/`.
- Defines 404 handler rendering `404.html`.

## Routes

`backend/app/views.py` defines:

- `GET /api/scheduler/course-data`
  - returns `course_data.json` from `backend/app/static/json/`.
- `GET /api/scheduler/default-schedule`
  - returns `physics_courses.json` from `backend/app/static/json/`.
- `GET /static/<path:filename>`
  - sends static assets from backend static folder.

## Data Files Served

- `backend/app/static/json/course_data.json`
  - large course catalog map keyed by course code.
  - record fields include:
    - `title`
    - either `credits` or (`min_credits` + `max_credits`)
    - `prereqs` as list of OR-groups
    - `concurrent_prereqs` as list of OR-groups
- `backend/app/static/json/physics_courses.json`
  - seeded schedule object:
    - `semesters`: map of semester key to course entry list
    - supports optional credit suffix like `SOC 220[4]`

## API Contract Notes

- Responses are JSON files served from disk.
- Frontend enforces `Content-Type` containing `application/json`.
- Non-JSON responses trigger frontend parsing errors with diagnostic previews.

## Operational Notes

- Backend currently does not persist scheduler changes server-side.
- `MONGODB_URI` is injected by systemd template but not used in current code.
- The 404 handler references `404.html`, but no template currently exists in repository.

## Suggested Backend Improvements

1. Add a `templates/404.html` to avoid template errors on 404 handling.
2. Add simple health endpoint (`/api/health`) for infra checks.
3. Add tests for route status codes and JSON response headers.
4. Consider explicit API versioning if endpoints expand.

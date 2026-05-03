# Backend

Minimal developer guide for the backend Flask application.

Prerequisites

 - Python 3.11+
 - A virtual environment named `.venv` is recommended for local development

Quick start (recommended)

```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip setuptools wheel
python -m pip install .

export SECRET_KEY="change-me"
export FLASK_ENV=development
export PORT=5000
python main.py
```

Notes

- The project `pyproject.toml` is the canonical dependency manifest.
- The app expects `SECRET_KEY` to be set; startup will fail without it.

API

- Project list: `GET /api/projects/`
- Project detail: `GET /api/projects/:slug/`

For more, see the top-level `documentation/IMPLEMENTATION.md`.

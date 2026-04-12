# Local Development Guide

## Prerequisites

Install:

- Python 3.11+
- Node.js 22+
- pnpm (via Corepack recommended)

## Backend Setup

From `backend/`:

1. Create and activate a virtual environment.
2. Install the package.
3. Provide environment variables.
4. Run the app.

Example:

```bash
cd backend
python3.11 -m venv venv
source venv/bin/activate
python -m pip install --upgrade pip setuptools wheel
python -m pip install .

export SECRET_KEY="change-me"
export FLASK_ENV=development
export PORT=5000
python main.py
```

Notes:

- `SECRET_KEY` is required; the app raises an error if missing.
- In development, Flask runs with debug mode when `FLASK_ENV=development`.
- In production mode, app startup uses Waitress.

## Frontend Setup

From `frontend/`:

```bash
cd frontend
pnpm install
pnpm run dev
```

Optional backend target override:

```bash
export VITE_BACKEND_URL="http://localhost:5000"
pnpm run dev
```

## Recommended Local Run Sequence

1. Start backend on port 5000.
2. Start frontend dev server.
3. Open the frontend URL shown by Vite.
4. Test `/utilities/scheduler` first to validate API wiring.

## Build Commands

Frontend production bundle:

```bash
cd frontend
VITE_BACKEND_URL="https://your-domain" pnpm build
```

Backend install-only build path is package installation via `pip install .` from `backend/`.

## Configuration Summary

- Backend env vars:
  - `SECRET_KEY` (required)
  - `FLASK_ENV` (`development` or `production`)
  - `PORT` (defaults to 5000)
- Frontend env vars:
  - `VITE_BACKEND_URL` (defaults to `http://localhost:5000` in code)

## Quick Health Checks

Backend API checks:

```bash
curl http://localhost:5000/api/scheduler/default-schedule
curl http://localhost:5000/api/scheduler/course-data
```

Frontend type checks:

```bash
cd frontend
pnpm run check
```

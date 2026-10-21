# Backend

Flask API. `pyproject.toml` is the dependency manifest; `uv.lock` pins versions.

```bash
uv sync                                  # create .venv with app + dev dependencies
SECRET_KEY=dev FLASK_ENV=development uv run main.py
uv run pytest --cov=app                  # tests (also runnable with python -m unittest discover -s tests)
```

`SECRET_KEY` is required; startup fails without it. See [Implementation](../documentation/IMPLEMENTATION.md) for structure and the API reference.

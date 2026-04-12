# API Contracts and Examples

## Base URL

- Local: `http://localhost:5000`
- Production: `https://<your-domain>`

## Response Requirements

Frontend callers expect JSON endpoints to return a `Content-Type` that includes `application/json`.

## Scheduler Endpoints

### GET /api/scheduler/default-schedule

Purpose: returns seeded schedule data keyed by semester.

Example:

```bash
curl -s http://localhost:5000/api/scheduler/default-schedule | jq .
```

Sample response shape:

```json
{
  "semesters": {
    "precollege": ["MATH 221", "E C E 210"],
    "fall24": ["MATH 222", "CHEM 103"]
  }
}
```

### GET /api/scheduler/course-data

Purpose: returns catalog records keyed by course code.

Example:

```bash
curl -s http://localhost:5000/api/scheduler/course-data | jq .
```

Sample record shape:

```json
{
  "PHYS 211": {
    "title": "University Physics: Mechanics",
    "credits": 4,
    "prereqs": [["MATH 221"]],
    "concurrent_prereqs": []
  }
}
```

## Project Content Endpoints

### GET /api/projects

Purpose: list published project metadata for cards/index pages.

Example:

```bash
curl -s http://localhost:5000/api/projects | jq .
```

Sample response shape:

```json
[
  {
    "slug": "frontend-runtime-markdown",
    "title": "Frontend Runtime Markdown + Mermaid",
    "summary": "Project pages backed by Markdown content fetched at runtime, with GFM support and Mermaid diagrams.",
    "date": "2026-04-11",
    "tags": ["Svelte", "Flask", "Markdown", "Mermaid"],
    "repo": "https://github.com/DefiantBurger/Website",
    "demo": "",
    "published": true
  }
]
```

### GET /api/projects/:slug

Purpose: returns full project details, including markdown body.

Example:

```bash
curl -s http://localhost:5000/api/projects/frontend-runtime-markdown | jq .
```

Sample response shape:

```json
{
  "slug": "frontend-runtime-markdown",
  "title": "Frontend Runtime Markdown + Mermaid",
  "summary": "Project pages backed by Markdown content fetched at runtime, with GFM support and Mermaid diagrams.",
  "date": "2026-04-11",
  "tags": ["Svelte", "Flask", "Markdown", "Mermaid"],
  "repo": "https://github.com/DefiantBurger/Website",
  "demo": "",
  "published": true,
  "markdown": "## Why I built this\\n..."
}
```

## Error Expectations

1. Unknown project slug returns HTTP 404.
2. Non-JSON response bodies should be treated as client errors by frontend parsers.
3. Scheduler data/file failures should return non-2xx and surface as load errors in UI.

## Frontmatter Contract for Project Markdown

Each project markdown file should include:

```yaml
---
title: "Readable title"
slug: "url-slug"
summary: "Short card summary"
date: "YYYY-MM-DD"
tags: ["Tag1", "Tag2"]
repo: "https://..."
demo: "https://..."
published: true
---
```

If a field is missing, backend defaults are applied where possible.

## Verification Checklist

1. Run each endpoint curl command locally before publishing docs updates.
2. Confirm response content type includes JSON.
3. Confirm project list ordering by descending date.
4. Confirm unpublished markdown files are absent from list/detail responses.

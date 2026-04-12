---
title: "Frontend Runtime Markdown + Mermaid (Demo)"
slug: "frontend-runtime-markdown"
summary: "Project pages backed by Markdown content fetched at runtime, with GFM support and Mermaid diagrams."
date: "2026-04-11"
tags:
  - "Svelte"
  - "Flask"
  - "Markdown"
  - "Mermaid"
repo: "https://github.com/DefiantBurger/Website"
demo: ""
published: false
---

## Why I built this

I wanted to update project write-ups on my VM without rebuilding frontend assets.

That means content should live outside the Svelte build and be loaded dynamically at runtime.

## Architecture

- Markdown files are stored in the backend.
- The backend exposes a project list and a project detail endpoint.
- The frontend fetches Markdown and renders it in the browser.
- Mermaid diagrams are converted from code fences and rendered client-side.

## Data flow

```mermaid
flowchart TD
    A[Markdown File on VM] --> B[Flask API /api/projects/:slug]
    B --> C[Svelte fetch on route load]
    C --> D[Markdown to HTML pipeline]
    D --> E[Mermaid render pass]
    E --> F[Project page in browser]
```

## Notes

This setup keeps deploys simple for content updates:

1. Update a Markdown file.
2. Restart backend only if needed.
3. Refresh the page.

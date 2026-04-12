# Frontend Documentation

## Stack

- Svelte 5
- TypeScript
- Vite
- `page` (client-side routing)

Dependencies are defined in `frontend/package.json`.

## Entry and Mount

- `frontend/src/main.ts` mounts `App.svelte`.
- Global styles loaded from `frontend/src/app.css`.

## Routing

`frontend/src/lib/router.ts` configures routes with `page`:

- `/` -> Home
- `/projects` -> Projects
- `/about` -> About
- `/contact` -> Contact
- `/utilities` -> Utilities
- `/utilities/scheduler` and `/utilities/scheduler/` -> UtilityScheduler

Router state is exposed via stores:

- `currentPage`
- `currentRoute`

## App Shell

`frontend/src/App.svelte`:

- initializes router on mount,
- renders top nav and page container,
- switches to a wider layout for scheduler route.

## Navigation and Theming

`frontend/src/lib/components/Nav.svelte`:

- nav links call router navigation without full reload,
- active link states are route-aware,
- dark/light theme toggle writes to `localStorage` and applies `data-theme` on `<html>`.

## Pages

- `Home.svelte`
  - hero, quick links, and placeholder featured projects.
- `Projects.svelte`
  - placeholder project cards.
- `About.svelte`, `Contact.svelte`
  - placeholder content.
- `Utilities.svelte`
  - utility launcher page.
- `UtilityScheduler.svelte`
  - primary interactive feature.

## Scheduler Data Integration

`frontend/src/lib/scheduler/data.ts`:

- fetches both scheduler API resources in parallel,
- validates JSON content type,
- parses optional credit suffixes in course entries,
- expands course occurrences into unique instance IDs,
- builds prerequisites per course instance.

`frontend/src/lib/scheduler/logic.ts`:

- computes prerequisite graph edges and status:
  - `valid`
  - `invalid`
  - `concurrent`
- computes requirement progress ratio per course,
- optionally detangles course ordering using repeated barycenter sweeps.

`frontend/src/lib/scheduler/types.ts`:

- defines scheduler data contracts for catalog records, course instances, requirements, and graph edges.

## Styling Notes

Main styles are in `frontend/src/app.css` and component-scoped styles.

Current state includes:

- a custom terminal-inspired theme at the top of the file,
- a second leftover Svelte template style block later in the same file.

This duplicate style region should be cleaned up to prevent confusion and accidental overrides.

## Suggested Frontend Improvements

1. Replace placeholder page content with real profile/project data.
2. Add route-level 404 fallback in SPA router.
3. Consolidate `app.css` to a single coherent stylesheet.
4. Add component tests for scheduler interactions and import/export validation.

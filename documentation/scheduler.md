# Scheduler Utility Documentation

## Purpose

The scheduler utility provides interactive semester planning with prerequisite validation and dependency visualization.

Route:

- `/utilities/scheduler`

## Data Sources

Loaded from backend APIs:

- `GET /api/scheduler/default-schedule`
- `GET /api/scheduler/course-data`

Backend base URL is configured by `VITE_BACKEND_URL`; defaults to `http://localhost:5000`.

## Data Model

### Schedule File

```json
{
  "semesters": {
    "precollege": ["MATH 221", "E C E 210"],
    "fall24": ["MATH 222", "CHEM 103"]
  }
}
```

Course entries may optionally include explicit credits using bracket notation:

- `COURSE NAME[4]`

### Catalog Record

Each course record supports:

- fixed credits via `credits`, or variable credits via `min_credits` / `max_credits`,
- prereq requirement groups (`prereqs`) where each inner list is OR logic,
- concurrent prereq groups (`concurrent_prereqs`).

## Core Behavior

### Initialization

On mount, the page:

1. fetches schedule and catalog,
2. builds in-memory course instances with unique IDs,
3. computes prerequisite graph,
4. detangles semester ordering for readability,
5. calculates semester credit totals.

### Prerequisite Graph

Graph edges represent selected prerequisite relationships and carry status:

- `valid`: prereq semester occurs earlier,
- `invalid`: prereq semester occurs later (or same semester when not concurrent),
- `concurrent`: same semester and concurrent allowed.

Precollege requirements are treated as already satisfied and removed from expected requirement counts.

### Requirement Progress

For each course, progress is:

$$
\text{progress} = \frac{\text{satisfied requirement groups}}{\text{expected requirement groups}}
$$

Displayed as a progress bar on course cards and as percentage in selected course details.

### Drag-and-Drop

Users can:

- drag a card to another semester column,
- drop above another course to reorder,
- keep manual order deterministic (auto-detangle is not forced after drag drop).

### Add Course Flow

- Text input supports matching by code/title and compact code form.
- Datalist provides top suggestions.
- Added courses get incremented occurrence IDs (`COURSE__N`).
- Default credits come from catalog defaults.

### Remove / Move Controls

For selected course:

- move earlier/later one semester,
- remove course from schedule.

### Bulk Clear

"Clear All Courses" prompts for confirmation and empties all scheduled courses.

### Import / Export

- Export writes current in-memory schedule to `schedule-export.json`.
- Import validates file format and course/credit validity before replacing loaded schedule.
- Import rebuilds semester ordering and graph state.

## Visual Layer

- SVG lines are drawn between course cards.
- Invalid edges are emphasized.
- Selection highlights related edges and dims unrelated ones.
- Layout updates are batched via `requestAnimationFrame` queueing.

## Constraints and Validation

- malformed bracket credit syntax throws explicit errors,
- non-integer or out-of-range credits fail validation,
- unknown imported course codes fail import.

## Known Accuracy Caveat

The page text explicitly notes that seeded/default data may be incomplete or inaccurate.

## Suggested Enhancements

1. Persist custom schedules server-side for account-less local storage backup.
2. Add undo/redo stack for drag/add/remove operations.
3. Add keyboard-first controls for accessibility parity with drag-and-drop.
4. Add warnings for unusually high/low semester credit totals.
5. Add filter views by subject and dependency depth.

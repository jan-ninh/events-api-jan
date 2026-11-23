# Events API - independent backend implementation

A **local learning project** using Node.js, Express 5 and SQLite. This is a new backend implementation related to an earlier WBS Coding School team project, **not** a claim that the original team/WBS backend was written solely by Jan Ninh.

Project history and attribution: [docs/PROJECT_ORIGIN.md](docs/PROJECT_ORIGIN.md).

## Current milestone: event registration

- Relational SQLite schema: `organizers`, `events`, `participants`, `registrations`
- Foreign keys and a composite primary key to prevent duplicate event registrations
- Parameterized SQL queries with `JOIN`, `GROUP BY` and aggregations
- Express REST endpoints for creating organizers, events and participants; registering participants; and listing registrations
- Validation and meaningful HTTP errors (`400`, `404`, `409`)
- Local automated tests: **7 database tests and 1 HTTP integration test** (one HTTP test covers several request/error scenarios)

This version uses AI-assisted collaboration and local review. A commit in this repository records a change to this implementation, not authorship of the earlier team project.

## Run locally

Requirements: **Node.js 22.13+** and npm. `node:sqlite` may show an experimental-feature warning on Node 22.

```bash
npm ci
npm test
npm start
```

API: `http://localhost:3001`. SQLite data is stored at `data/events.sqlite` and excluded from Git.

## Routes

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/health` | Local liveness response |
| POST | `/api/organizers` | Create organizer |
| POST | `/api/events` | Create event |
| GET | `/api/events` | List events |
| GET | `/api/events/:id` | Get event |
| GET | `/api/events/stats` | Aggregate events by organizer |
| POST | `/api/participants` | Create participant |
| POST | `/api/events/:id/registrations` | Register participant |
| GET | `/api/events/:id/registrations` | List event registrations |

Example JSON request bodies, in order:

```json
{"name":"Example Organizer"}
```

`POST /api/organizers` returns an ID. Use it for:

```json
{"organizerId":1,"title":"Fullstack Meetup","location":"Bochum","startsAt":"2026-12-01T18:30:00Z"}
```

Create a participant with `POST /api/participants`:

```json
{"name":"Alex","email":"alex@example.com"}
```

Register with `POST /api/events/1/registrations`:

```json
{"participantId":1}
```

For local demonstrations these IDs assume a fresh database and successful prior requests. Repeating the same event/participant registration returns **409 Conflict**.

## Test coverage

Run `npm test`. The Node test runner executes database tests for foreign keys, relational joins, aggregation, validation, injection-safe parameterization, duplicate registrations and error mapping, plus an HTTP integration test covering a successful registration flow, listing and error cases.

A passing local test suite **does not mean the service is production-ready**.

## Security and limitations

**Local development only. Do not expose this API publicly yet.**

- There is **no authentication or authorization** for the write routes, including registrations. Anyone who can access the server could submit changes or register another participant by ID.
- The registration-list endpoint currently exposes participant names to any requester. E-mail addresses are excluded from this list, but access control is still required.
- Participant creation does not verify e-mail ownership.
- Database migrations, rate limits, robust privacy protections and production deployment hardening are not implemented.
- The new backend is **not yet connected to the forked team frontend**.

Suggested next steps: add authenticated identity and owner/organizer access rules, test access denial, define database migrations, then integrate the frontend. Keep original WBS/team provenance visible.

# Events API — independent Express/SQLite backend

Local backend implementation for an event-management application, developed
after a WBS Coding School team project. **This is original AI-assisted follow-up
work, not a claim of sole authorship of the old team backend.**
See [project provenance](docs/PROJECT_ORIGIN.md).

**Companion React frontend:** [jan-ninh/events-frontend](https://github.com/jan-ninh/events-frontend)
on branch [feature/own-backend-integration](https://github.com/jan-ninh/events-frontend/tree/feature/own-backend-integration).

## Demonstrated implementation

- Relational SQLite model for `organizers`, `events`, `participants`,
  `registrations`, participant-to-organizer ownership, credentials and sessions
- Foreign keys and composite registration key preventing duplicate signups
- Explicit parameterized SQL with `JOIN`, `GROUP BY`, `COUNT` and `SUM`
- Authenticated session-bound event creation and event registration
- scrypt password hashes and random hashed bearer sessions with expiry
- Event API supplies fields for the React team frontend: dates, descriptions,
  locations, optional coordinates and creation timestamps
- Schema adjustment for existing SQLite databases when the optional event fields
  are absent
- Database tests and HTTP integration tests, including session identity checks

**The client cannot choose another person's participant ID or organizer ID.**
The server uses the authenticated participant's identity and assigned organizer.

## Local development

Use Node.js 22.13+ with npm (on Node 22, `node:sqlite` can emit an
experimental-feature warning).

```bash
git clone -b feature/event-registration https://github.com/jan-ninh/events-api-jan.git
cd events-api-jan
npm ci
npm test
npm start
```

Local API: `http://127.0.0.1:3001`. Database: `data/events.sqlite` (ignored by Git).

In another terminal, use the frontend's integration branch and `npm run dev`.
Vite proxies `/api` to this server, avoiding cross-origin browser requests.

## Core routes

| Method | Endpoint | Access |
| --- | --- | --- |
| GET | `/health` | Local, unauthenticated |
| POST | `/api/auth/signup` | Local, unauthenticated |
| POST | `/api/auth/login` | Local, unauthenticated |
| GET | `/api/auth/profile` | Bearer session |
| GET | `/api/events` | Local, unauthenticated |
| GET | `/api/events/:id` | Local, unauthenticated |
| GET | `/api/events/stats` | Local, unauthenticated |
| POST | `/api/events` | Bearer session, own assigned organizer |
| POST | `/api/events/:id/registrations` | Bearer session, own participant identity |
| GET | `/api/events/:id/registrations` | Bearer session, own registration only |

To create an event, sign up first. Submit `POST /api/events` with a bearer token
and body such as:

```json
{"title":"Fullstack Meetup","location":"Bochum","description":"Testing the Events API","startsAt":"2026-12-01T18:00:00Z"}
```

The `organizerId` is derived from your authenticated account, not the body.

## Verification

Run `npm test`. Automated tests exercise relational integrity, constraints,
aggregation, login, session expiry, invalid credentials, authenticated registration,
ownership and event payload fields. The full frontend browser flow should additionally
be checked locally: signup, login, create event, view event, register, reload.

Passing tests means the covered scenarios worked, not that the service is
production-ready.

## Limits

**Local portfolio prototype only. Do not deploy publicly yet.** Open issues include
login/signup throttling, account recovery, email verification, server-side logout and
session revocation, production migration/versioning, retention policy, abuse
prevention, and detailed security/edge-case review. There is no public live API.

Original team frontend commits remain credited to their actual contributors.
The new backend's JavaScript/SQL code and its AI-assisted changes are separately
reviewable through Git commits and pull requests.

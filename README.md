# Events API - independent backend implementation

Local Node.js / Express / SQLite learning backend, developed as an independent extension of an earlier WBS Coding School team project. The original team/backend code is **not** claimed as personal authorship. See [project provenance](docs/PROJECT_ORIGIN.md).

## What this milestone demonstrates

- Relational schema for organizers, events, participants, registrations and session credentials
- Foreign keys and a composite primary key preventing duplicate event registrations
- Parameterized SQL (`JOIN`, `GROUP BY`, aggregates, lookup queries)
- Event REST endpoints with validation and mapped HTTP errors
- Minimal participant authentication using scrypt-hashed passwords and random, hashed, expiring bearer sessions
- **Event registration derives participant ID from the authenticated session, not from client input**
- Registration lookup is scoped to the authenticated participant
- Local database and HTTP integration tests (run `npm test`)

The session mechanism uses Node's built-in crypto; it is not a JWT/refresh-token implementation.

## Local development

Node.js 22.13+ required. On Node 22, `node:sqlite` can show an experimental feature warning.

```bash
npm ci
npm test
npm start
```

The HTTP service binds to **127.0.0.1:3001** by default and uses the gitignored SQLite file `data/events.sqlite`.

## Example flow

1. `POST /api/organizers` with `{"name":"Example Organizer"}`
2. `POST /api/events` with `{"organizerId":1,"title":"Fullstack Meetup","location":"Bochum","startsAt":"2026-12-01T18:30:00Z"}`
3. `POST /api/auth/signup` with `{"name":"Alex","email":"alex@example.com","password":"long-local-password-123"}`
4. `POST /api/auth/login` with `{"email":"alex@example.com","password":"long-local-password-123"}`
5. `POST /api/events/1/registrations` with `Authorization: Bearer <accessToken>` and `{}` as the JSON body
6. `GET /api/events/1/registrations` with the same bearer token: returns only the caller's registration

A repeated registration returns **409**. Missing/expired bearer session returns **401**. Unknown event returns **404**.

The older unauthenticated `POST /api/participants` route was removed. A client must now sign up to create a participant account.

## Routes

| Method | Endpoint | Access |
| --- | --- | --- |
| GET | `/health` | Public (localhost) |
| GET | `/api/events` and `/api/events/:id` | Public (localhost) |
| GET | `/api/events/stats` | Public (localhost) |
| POST | `/api/organizers` and `/api/events` | **Unprotected; local demo only** |
| POST | `/api/auth/signup` | Public (localhost) |
| POST | `/api/auth/login` | Public (localhost) |
| POST | `/api/events/:id/registrations` | Bearer participant session |
| GET | `/api/events/:id/registrations` | Bearer participant session, own registration only |

## Test and scope notes

`npm test` runs database and HTTP-level tests. It checks referential integrity, duplicate registrations, login, invalid passwords, expired/invalid sessions, and that a forged `participantId` in the request cannot override the authenticated identity.

**This is not production-ready. Do not deploy it publicly.** Missing pieces include authorization for organizer/event creation, login throttling, email verification, account recovery, logout/session revocation, schema migrations, deployment configuration, and further security/edge-case testing. Any Internet-facing deployment must use HTTPS and an explicit authorization design.

The code and Git history show a reviewed, AI-assisted development process. A commit is not by itself proof of exclusively human-written code.

## Next work

- Test the auth change locally, then review the open draft PR
- Add organizer authorization and login throttling before considering public access
- Integrate the forked WBS frontend only with clear provenance

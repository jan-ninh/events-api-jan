# Events API – independent backend implementation

An independent learning backend for an events app, built with **Node.js, Express 5 and SQLite**.

This repository is intended as an original backend extension to a previously developed WBS team project.
It does **not** present the old WBS backend code as a new personal implementation.
See [project origin](docs/PROJECT_ORIGIN.md).

## Features (initial milestone)

- Relational schema with `organizers` and `events`, including a foreign-key constraint
- Express REST endpoints for creating and reading organizers/events
- A new SQL aggregation endpoint: upcoming event counts per organizer
- Parameterized SQL queries, input validation, deterministic ordering
- Node built-in test runner with database tests

**Not production-ready:** authentication, authorization, migrations, rate limiting, and HTTP-level
integration tests are not yet implemented. Do not deploy publicly as a writable service.

## Requirements

Node.js **22.13+**, npm. `node:sqlite` is experimental on Node 22 and can emit a warning.

```bash
npm install
npm test
npm start
```

Starts at `http://localhost:3001`. The SQLite file is in `data/events.sqlite` and is gitignored.

## Try the endpoints

```bash
curl -X POST http://localhost:3001/api/organizers   -H "Content-Type: application/json"   -d '{"name":"Jan"}'

curl -X POST http://localhost:3001/api/events   -H "Content-Type: application/json"   -d '{"organizerId":1,"title":"Fullstack Meetup","location":"Bochum","startsAt":"2026-12-01T18:30:00Z"}'

curl http://localhost:3001/api/events
curl 'http://localhost:3001/api/events/stats?from=2026-11-23T00:00:00Z'
curl http://localhost:3001/health
```

## How this differs from the WBS starter

- Original schema design and implementation in this repo
- Explicitly parameterized SQL with `JOIN`, `GROUP BY`, `COUNT`, `SUM` and foreign-key checks
- Independent tests that can be run without production data
- An honest history of the original team project

## Next steps

1. Run and review every database test, then commit.
2. Add actual authentication/ownership checks before enabling writes on a public server.
3. Add HTTP-level integration tests and a migration strategy.
4. Integrate the team frontend through a separately maintained, attribution-preserving fork.

The point is verified engineering work, not generating a commit to imply authorship of old code.

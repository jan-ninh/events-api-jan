import { DatabaseSync } from "node:sqlite";
import { HttpError } from "./errors.js";
import {
  requiredString,
  positiveId,
  isoDate,
  eventListLimit,
} from "./validation.js";

export function openDatabase(filename = ":memory:") {
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS organizers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organizer_id INTEGER NOT NULL REFERENCES organizers(id),
      title TEXT NOT NULL CHECK (length(title) BETWEEN 3 AND 255),
      location TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );


CREATE TABLE IF NOT EXISTS participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS registrations (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  registered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (event_id, participant_id)
);


    CREATE INDEX IF NOT EXISTS idx_events_starts_at ON events(starts_at);
    CREATE INDEX IF NOT EXISTS idx_events_organizer_id ON events(organizer_id);
  `);
  return db;
}

export function createOrganizer(db, body) {
  const name = requiredString(body?.name, "name", 2, 80);
  try {
    const result = db
      .prepare("INSERT INTO organizers (name) VALUES (?)")
      .run(name);
    return { id: Number(result.lastInsertRowid), name };
  } catch (error) {
    if (
      error.code === "ERR_SQLITE_ERROR" &&
      /UNIQUE constraint failed/.test(error.message)
    ) {
      throw new HttpError(409, "Organizer already exists");
    }
    throw error;
  }
}

export function createEvent(db, body) {
  const organizerId = positiveId(body?.organizerId, "organizerId");
  const title = requiredString(body?.title, "title", 3, 255);
  const location = requiredString(body?.location, "location", 2, 255);
  const startsAt = isoDate(body?.startsAt);

  // Explicit existence check supplies a useful HTTP error instead of an opaque FK error.
  const organizer = db
    .prepare("SELECT id FROM organizers WHERE id = ?")
    .get(organizerId);
  if (!organizer) throw new HttpError(404, "Organizer not found");

  const result = db
    .prepare(
      `
    INSERT INTO events (organizer_id, title, location, starts_at)
    VALUES (?, ?, ?, ?)
  `,
    )
    .run(organizerId, title, location, startsAt);

  return getEvent(db, Number(result.lastInsertRowid));
}

export function getEvent(db, idValue) {
  const id = positiveId(idValue, "id");
  const row = db
    .prepare(
      `
    SELECT e.id, e.title, e.location, e.starts_at AS startsAt,
           o.id AS organizerId, o.name AS organizerName
    FROM events e
    JOIN organizers o ON o.id = e.organizer_id
    WHERE e.id = ?
  `,
    )
    .get(id);
  if (!row) throw new HttpError(404, "Event not found");
  return row;
}

export function listEvents(db, { from, limit } = {}) {
  const fromISO =
    from === undefined ? "0001-01-01T00:00:00.000Z" : isoDate(from, "from");
  const safeLimit = eventListLimit(limit);
  return db
    .prepare(
      `
    SELECT e.id, e.title, e.location, e.starts_at AS startsAt,
           o.id AS organizerId, o.name AS organizerName
    FROM events e
    JOIN organizers o ON o.id = e.organizer_id
    WHERE e.starts_at >= ?
    ORDER BY e.starts_at ASC, e.id ASC
    LIMIT ?
  `,
    )
    .all(fromISO, safeLimit);
}

export function organizerStats(db, { from } = {}) {
  const fromISO =
    from === undefined ? new Date().toISOString() : isoDate(from, "from");
  // Relational SQL query: JOIN + aggregation + grouping + deterministic ordering.
  // Parameter binding ensures user input is never interpolated into SQL source.
  return db
    .prepare(
      `
    SELECT o.id AS organizerId,
           o.name AS organizerName,
           COUNT(e.id) AS totalEvents,
           SUM(CASE WHEN e.starts_at >= ? THEN 1 ELSE 0 END) AS upcomingEvents
    FROM organizers o
    LEFT JOIN events e ON e.organizer_id = o.id
    GROUP BY o.id, o.name
    ORDER BY upcomingEvents DESC, organizerName ASC
  `,
    )
    .all(fromISO);
}

export function createParticipant(db, body) {
  const name = requiredString(body?.name, "name", 2, 80);
  const email = requiredString(body?.email, "email", 3, 254).toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "Invalid email address");
  }

  try {
    const result = db
      .prepare("INSERT INTO participants (name, email) VALUES (?, ?)")
      .run(name, email);

    return { id: Number(result.lastInsertRowid), name, email };
  } catch (error) {
    if (/UNIQUE constraint failed: participants\.email/.test(error.message)) {
      throw new HttpError(409, "Email already registered");
    }
    throw error;
  }
}

export function registerForEvent(db, eventIdValue, participantIdValue) {
  const eventId = positiveId(eventIdValue, "eventId");
  const participantId = positiveId(participantIdValue, "participantId");

  try {
    db.prepare(
      "INSERT INTO registrations (event_id, participant_id) VALUES (?, ?)",
    ).run(eventId, participantId);
  } catch (error) {
    if (/UNIQUE constraint failed: registrations\./.test(error.message)) {
      throw new HttpError(
        409,
        "Participant is already registered for this event",
      );
    }
    if (/FOREIGN KEY constraint failed/.test(error.message)) {
      throw new HttpError(404, "Event or participant not found");
    }
    throw error;
  }

  return db
    .prepare(
      `
    SELECT event_id AS eventId, participant_id AS participantId,
           registered_at AS registeredAt
    FROM registrations
    WHERE event_id = ? AND participant_id = ?
  `,
    )
    .get(eventId, participantId);
}

export function listEventRegistrations(db, eventIdValue) {
  const eventId = positiveId(eventIdValue, "eventId");

  // Prüft, ob das Event überhaupt existiert.
  getEvent(db, eventId);

  return db
    .prepare(
      `
    SELECT
      p.id AS participantId,
      p.name AS participantName,
      r.registered_at AS registeredAt
    FROM registrations r
    JOIN participants p
      ON p.id = r.participant_id
    WHERE r.event_id = ?
    ORDER BY r.registered_at ASC, p.id ASC
  `,
    )
    .all(eventId);
}

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
      image_theme TEXT NOT NULL DEFAULT 'community'
        CHECK (image_theme IN ('tech', 'workshop', 'gaming', 'outdoor', 'food', 'community')),
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


    CREATE TABLE IF NOT EXISTS participant_organizers (
      participant_id INTEGER PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
      organizer_id INTEGER NOT NULL UNIQUE REFERENCES organizers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS participant_credentials (
      participant_id INTEGER PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
      password_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_auth_sessions_participant_id
      ON auth_sessions(participant_id);

    CREATE INDEX IF NOT EXISTS idx_events_starts_at ON events(starts_at);
    CREATE INDEX IF NOT EXISTS idx_events_organizer_id ON events(organizer_id);
  `);
  // Previous local SQLite databases must gain optional UI fields, too.
  const columns = new Set(db.prepare("PRAGMA table_info(events)").all().map((x) => x.name));
  for (const [name, type] of [
    ["description", "TEXT"],
    ["latitude", "REAL"],
    ["longitude", "REAL"],
    ["image_theme", "TEXT NOT NULL DEFAULT 'community'"],
  ]) {
    if (!columns.has(name)) db.exec(`ALTER TABLE events ADD COLUMN ${name} ${type}`);
  }
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
  const description = body?.description == null ? null : requiredString(body.description, "description", 0, 5000);
  const imageTheme = body?.imageTheme ?? "community";
  if (!["tech", "workshop", "gaming", "outdoor", "food", "community"].includes(imageTheme)) {
    throw new HttpError(400, "Invalid image theme");
  }
  const coordinate = (value, label, min, max) => {
    if (value == null) return null;
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
      throw new HttpError(400, `${label} must be a number between ${min} and ${max}`);
    }
    return value;
  };
  const latitude = coordinate(body?.latitude, "latitude", -90, 90);
  const longitude = coordinate(body?.longitude, "longitude", -180, 180);

  // Explicit existence check supplies a useful HTTP error instead of an opaque FK error.
  const organizer = db
    .prepare("SELECT id FROM organizers WHERE id = ?")
    .get(organizerId);
  if (!organizer) throw new HttpError(404, "Organizer not found");

  const result = db
    .prepare(
      `
    INSERT INTO events (organizer_id, title, location, starts_at, description, latitude, longitude, image_theme)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(organizerId, title, location, startsAt, description, latitude, longitude, imageTheme);

  return getEvent(db, Number(result.lastInsertRowid));
}

export function getEvent(db, idValue) {
  const id = positiveId(idValue, "id");
  const row = db
    .prepare(
      `
    SELECT e.id, e.title, e.location, e.starts_at AS startsAt,
           e.starts_at AS date, e.created_at AS createdAt,
           e.description, e.latitude, e.longitude, e.image_theme AS imageTheme,
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
           e.starts_at AS date, e.created_at AS createdAt,
           e.description, e.latitude, e.longitude, e.image_theme AS imageTheme,
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

export function createEventForParticipant(db, participantIdValue, body) {
  const participantId = positiveId(participantIdValue, "participantId");
  const mapping = db.prepare(
    "SELECT organizer_id AS organizerId FROM participant_organizers WHERE participant_id = ?"
  ).get(participantId);
  if (!mapping) throw new HttpError(403, "No organizer assigned to this participant");
  // Never trust client-supplied organizerId.
  return createEvent(db, { ...body, organizerId: mapping.organizerId });
}

export function canManageEvent(db, eventIdValue, participantIdValue) {
  const eventId = positiveId(eventIdValue, "eventId");
  const participantId = positiveId(participantIdValue, "participantId");
  getEvent(db, eventId); // Retain 404 semantics for an unknown event.
  const owned = db.prepare(`
    SELECT 1 FROM events e
    JOIN participant_organizers po ON po.organizer_id = e.organizer_id
    WHERE e.id = ? AND po.participant_id = ?
  `).get(eventId, participantId);
  return Boolean(owned);
}

export function deleteEventForParticipant(db, eventIdValue, participantIdValue) {
  const eventId = positiveId(eventIdValue, "eventId");
  const participantId = positiveId(participantIdValue, "participantId");
  if (!canManageEvent(db, eventId, participantId)) {
    throw new HttpError(403, "Only the event owner can delete this event");
  }

  // Enforce ownership again in SQL, not only in the preceding check.
  // Registrations reference events with ON DELETE CASCADE.
  const result = db.prepare(`
    DELETE FROM events
    WHERE id = ? AND organizer_id = (
      SELECT organizer_id FROM participant_organizers WHERE participant_id = ?
    )
  `).run(eventId, participantId);
  if (result.changes !== 1) throw new HttpError(404, "Event not found");
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

export function listEventRegistrations(db, eventIdValue, participantIdValue) {
  const eventId = positiveId(eventIdValue, "eventId");
  const participantId = positiveId(participantIdValue, "participantId");

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
    WHERE r.event_id = ? AND r.participant_id = ?
    ORDER BY r.registered_at ASC, p.id ASC
  `,
    )
    .all(eventId, participantId);
}

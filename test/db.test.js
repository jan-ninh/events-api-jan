import test from "node:test";
import assert from "node:assert/strict";
import {
  openDatabase,
  createOrganizer,
  createEvent,
  getEvent,
  listEvents,
  organizerStats,
  createParticipant,
  registerForEvent,
} from "../src/db.js";

test("SQLite foreign keys are enabled", () => {
  const db = openDatabase();
  try {
    assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
    assert.throws(() =>
      db
        .prepare(
          "INSERT INTO events (organizer_id,title,location,starts_at) VALUES (999,'Test','Berlin','2026-12-01T10:00:00.000Z')",
        )
        .run(),
    );
  } finally {
    db.close();
  }
});

test("creates organizers and events with a real relational JOIN", () => {
  const db = openDatabase();
  try {
    const owner = createOrganizer(db, { name: "Jan" });
    const event = createEvent(db, {
      organizerId: owner.id,
      title: "TypeScript Meetup",
      location: "Bochum",
      startsAt: "2026-12-02T10:00:00Z",
    });
    assert.equal(getEvent(db, event.id).organizerName, "Jan");
    assert.equal(event.startsAt, "2026-12-02T10:00:00.000Z");
  } finally {
    db.close();
  }
});

test("aggregates upcoming events correctly including organizers with zero events", () => {
  const db = openDatabase();
  try {
    const jan = createOrganizer(db, { name: "Jan" });
    createOrganizer(db, { name: "Team" });
    createEvent(db, {
      organizerId: jan.id,
      title: "Past event",
      location: "Bochum",
      startsAt: "2026-01-01T12:00:00Z",
    });
    createEvent(db, {
      organizerId: jan.id,
      title: "Future event",
      location: "Düsseldorf",
      startsAt: "2026-12-01T12:00:00Z",
    });
    const stats = organizerStats(db, { from: "2026-11-23T00:00:00Z" });
    assert.deepEqual(
      stats.map((x) => [x.organizerName, x.totalEvents, x.upcomingEvents]),
      [
        ["Jan", 2, 1],
        ["Team", 0, 0],
      ],
    );
  } finally {
    db.close();
  }
});

test("rejects SQL injection values as data, does not execute them", () => {
  const db = openDatabase();
  try {
    const jan = createOrganizer(db, { name: "Jan" });
    createEvent(db, {
      organizerId: jan.id,
      title: "Safe event",
      location: "Bochum'; DROP TABLE events; --",
      startsAt: "2026-12-01T12:00:00Z",
    });
    assert.equal(listEvents(db, { limit: 5 }).length, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events").get().n, 1);
    assert.throws(
      () => listEvents(db, { limit: "1; DROP TABLE events" }),
      /limit/,
    );
  } finally {
    db.close();
  }
});

test("reports validation and missing foreign key errors", () => {
  const db = openDatabase();
  try {
    assert.throws(
      () =>
        createEvent(db, {
          organizerId: 12,
          title: "Some event",
          location: "Berlin",
          startsAt: "2026-12-02T10:00:00Z",
        }),
      /Organizer not found/,
    );
    const jan = createOrganizer(db, { name: "Jan" });
    assert.throws(() => createOrganizer(db, { name: "Jan" }), /already exists/);
    assert.throws(
      () =>
        createEvent(db, {
          organizerId: jan.id,
          title: "a",
          location: "Berlin",
          startsAt: "2026-12-02T10:00:00Z",
        }),
      /title/,
    );
    assert.throws(() => listEvents(db, { from: "nonsense" }), /ISO 8601/);
  } finally {
    db.close();
  }
});

test("registration links event and participant only once", () => {
  const db = openDatabase();

  try {
    const owner = createOrganizer(db, { name: "Organizer" });

    const event = createEvent(db, {
      organizerId: owner.id,
      title: "Meetup",
      location: "Bochum",
      startsAt: "2026-12-01T18:00:00Z",
    });

    const result = db
      .prepare("INSERT INTO participants (name, email) VALUES (?, ?)")
      .run("Alex", "alex@example.com");

    const participantId = Number(result.lastInsertRowid);

    const register = db.prepare(
      "INSERT INTO registrations (event_id, participant_id) VALUES (?, ?)",
    );

    register.run(event.id, participantId);

    // Eine zweite identische Anmeldung muss scheitern.
    assert.throws(
      () => register.run(event.id, participantId),
      /UNIQUE constraint failed/,
    );

    // Anmeldung für ein nicht existentes Event muss scheitern.
    assert.throws(
      () => register.run(999, participantId),
      /FOREIGN KEY constraint failed/,
    );

    const count = db
      .prepare("SELECT COUNT(*) AS total FROM registrations WHERE event_id = ?")
      .get(event.id);

    assert.equal(count.total, 1);
  } finally {
    db.close();
  }
});

test("registers a participant once and returns meaningful errors", () => {
  const db = openDatabase();

  try {
    const organizer = createOrganizer(db, { name: "Organizer" });

    const event = createEvent(db, {
      organizerId: organizer.id,
      title: "Meetup",
      location: "Bochum",
      startsAt: "2026-12-01T18:00:00Z",
    });

    const participant = createParticipant(db, {
      name: "Alex",
      email: "ALEX@example.com",
    });

    assert.equal(participant.email, "alex@example.com");

    const registration = registerForEvent(db, event.id, participant.id);

    assert.equal(registration.eventId, event.id);
    assert.equal(registration.participantId, participant.id);

    // Doppelte Anmeldung ergibt HTTP-Konfliktstatus.
    assert.throws(
      () => registerForEvent(db, event.id, participant.id),
      (error) => error.status === 409,
    );

    // Nicht vorhandenes Event ergibt 404.
    assert.throws(
      () => registerForEvent(db, 999, participant.id),
      (error) => error.status === 404,
    );

    // E-Mail darf nicht erneut vergeben werden.
    assert.throws(
      () =>
        createParticipant(db, {
          name: "Another",
          email: "alex@EXAMPLE.com",
        }),
      (error) => error.status === 409,
    );
  } finally {
    db.close();
  }
});

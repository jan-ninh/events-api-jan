import test from "node:test";
import assert from "node:assert/strict";
import {
  openDatabase, createOrganizer, createEvent, getEvent, listEvents, organizerStats,
} from "../src/db.js";

test("SQLite foreign keys are enabled", () => {
  const db = openDatabase();
  try {
    assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
    assert.throws(() =>
      db.prepare("INSERT INTO events (organizer_id,title,location,starts_at) VALUES (999,'Test','Berlin','2026-12-01T10:00:00.000Z')").run()
    );
  } finally { db.close(); }
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
  } finally { db.close(); }
});

test("aggregates upcoming events correctly including organizers with zero events", () => {
  const db = openDatabase();
  try {
    const jan = createOrganizer(db, { name: "Jan" });
    createOrganizer(db, { name: "Team" });
    createEvent(db, { organizerId: jan.id, title: "Past event", location: "Bochum", startsAt: "2026-01-01T12:00:00Z" });
    createEvent(db, { organizerId: jan.id, title: "Future event", location: "Düsseldorf", startsAt: "2026-12-01T12:00:00Z" });
    const stats = organizerStats(db, { from: "2026-11-23T00:00:00Z" });
    assert.deepEqual(stats.map(x => [x.organizerName, x.totalEvents, x.upcomingEvents]), [
      ["Jan", 2, 1], ["Team", 0, 0],
    ]);
  } finally { db.close(); }
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
    assert.throws(() => listEvents(db, { limit: "1; DROP TABLE events" }), /limit/);
  } finally { db.close(); }
});

test("reports validation and missing foreign key errors", () => {
  const db = openDatabase();
  try {
    assert.throws(
      () => createEvent(db, { organizerId: 12, title: "Some event", location: "Berlin", startsAt: "2026-12-02T10:00:00Z" }),
      /Organizer not found/,
    );
    const jan = createOrganizer(db, { name: "Jan" });
    assert.throws(() => createOrganizer(db, { name: "Jan" }), /already exists/);
    assert.throws(() => createEvent(db, {
      organizerId: jan.id, title: "a", location: "Berlin", startsAt: "2026-12-02T10:00:00Z",
    }), /title/);
    assert.throws(() => listEvents(db, { from: "nonsense" }), /ISO 8601/);
  } finally { db.close(); }
});

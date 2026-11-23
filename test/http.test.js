import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { openDatabase } from "../src/db.js";
import { createApp } from "../src/app.js";

test("HTTP: create participant, register for event, list and reject duplicates", async () => {
  const db = openDatabase();
  const server = createApp(db).listen(0, "127.0.0.1");

  try {
    if (!server.listening) await once(server, "listening");

    const origin = `http://127.0.0.1:${server.address().port}`;

    const request = async (method, path, body) => {
      const response = await fetch(origin + path, {
        method,
        headers:
          body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      return {
        status: response.status,
        data: await response.json(),
      };
    };

    // 1. Veranstalter erstellen
    const organizer = await request("POST", "/api/organizers", {
      name: "Organizer",
    });
    assert.equal(organizer.status, 201);

    // 2. Event erstellen
    const event = await request("POST", "/api/events", {
      organizerId: organizer.data.id,
      title: "Meetup",
      location: "Bochum",
      startsAt: "2026-12-01T18:00:00Z",
    });
    assert.equal(event.status, 201);

    // 3. Teilnehmer erstellen
    const participant = await request("POST", "/api/participants", {
      name: "Alex",
      email: "ALEX@example.com",
    });

    assert.equal(participant.status, 201);
    assert.equal(participant.data.email, "alex@example.com");

    // 4. Teilnehmer anmelden
    const route = `/api/events/${event.data.id}/registrations`;

    const registration = await request("POST", route, {
      participantId: participant.data.id,
    });

    assert.equal(registration.status, 201);
    assert.equal(registration.data.participantId, participant.data.id);

    // 5. Doppelte Anmeldung verhindern
    const repeat = await request("POST", route, {
      participantId: participant.data.id,
    });

    assert.equal(repeat.status, 409);

    // 6. Anmeldeliste prüfen
    const list = await request("GET", route);

    assert.equal(list.status, 200);
    assert.equal(list.data.results.length, 1);
    assert.equal(list.data.results[0].participantName, "Alex");

    // E-Mail wird nicht öffentlich ausgegeben
    assert.equal("email" in list.data.results[0], false);

    // 7. Nicht existentes Event
    const unknown = await request("POST", "/api/events/999/registrations", {
      participantId: participant.data.id,
    });
    assert.equal(unknown.status, 404);

    const missingList = await request("GET", "/api/events/999/registrations");
    assert.equal(missingList.status, 404);

    // 8. Ungültige Event-ID
    const malformedId = await request(
      "POST",
      "/api/events/oops/registrations",
      { participantId: participant.data.id },
    );
    assert.equal(malformedId.status, 400);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    db.close();
  }
});

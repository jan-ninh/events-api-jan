import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { openDatabase } from "../src/db.js";
import { createApp } from "../src/app.js";

async function withServer(fn) {
  const db = openDatabase();
  const server = createApp(db).listen(0, "127.0.0.1");
  try {
    if (!server.listening) await once(server, "listening");
    const origin = `http://127.0.0.1:${server.address().port}`;
    const request = async (method, path, body, token) => {
      const response = await fetch(origin + path, {
        method,
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, data: await response.json() };
    };
    await fn({ db, request });
  } finally {
    await new Promise((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
    db.close();
  }
}

test("HTTP: authenticated participant can register only own identity", async () => {
  await withServer(async ({ request }) => {
    const alice = await request("POST", "/api/auth/signup", {
      name: "Alice", email: "ALICE@example.com", password: "local-password-123",
    });
    assert.equal(alice.status, 201);
    assert.equal(alice.data.participant.email, "alice@example.com");
    assert.equal(typeof alice.data.accessToken, "string");

    const eventPayload = {
      organizerId: 99999, // forged owner must be ignored
      title: "Meetup", description: "Integration test event",
      location: "Bochum", latitude: 51.48, longitude: 7.22,
      startsAt: "2026-12-01T18:00:00Z",
    };
    assert.equal((await request("POST", "/api/events", eventPayload)).status, 401);
    assert.equal((await request("POST", "/api/organizers", { name: "Anyone" })).status, 404);

    const event = await request("POST", "/api/events", eventPayload, alice.data.accessToken);
    assert.equal(event.status, 201);
    assert.notEqual(event.data.organizerId, 99999);
    assert.equal(event.data.date, "2026-12-01T18:00:00.000Z");
    assert.equal(event.data.description, "Integration test event");
    assert.equal(event.data.latitude, 51.48);
    const route = `/api/events/${event.data.id}/registrations`;

    const listEvents = await request("GET", "/api/events");
    assert.equal(listEvents.status, 200);
    assert.equal(listEvents.data.results[0].title, "Meetup");
    const fetched = await request("GET", `/api/events/${event.data.id}`);
    assert.equal(fetched.data.longitude, 7.22);
    const profile = await request("GET", "/api/auth/profile", undefined, alice.data.accessToken);
    assert.equal(profile.status, 200);
    assert.equal(profile.data.email, "alice@example.com");

    assert.equal((await request("POST", route, { participantId: alice.data.participant.id })).status, 401);
    assert.equal((await request("GET", route)).status, 401);

    const registered = await request("POST", route,
      { participantId: 99999 }, alice.data.accessToken);
    assert.equal(registered.status, 201);
    assert.equal(registered.data.participantId, alice.data.participant.id);

    const duplicate = await request("POST", route, {}, alice.data.accessToken);
    assert.equal(duplicate.status, 409);

    const list = await request("GET", route, undefined, alice.data.accessToken);
    assert.equal(list.status, 200);
    assert.equal(list.data.results.length, 1);
    assert.equal(list.data.results[0].participantName, "Alice");
    assert.equal("email" in list.data.results[0], false);

    const bob = await request("POST", "/api/auth/signup", {
      name: "Bob", email: "bob@example.com", password: "another-password-456",
    });
    assert.equal(bob.status, 201);
    const bobList = await request("GET", route, undefined, bob.data.accessToken);
    assert.equal(bobList.status, 200);
    assert.deepEqual(bobList.data.results, []);

    const bobRegister = await request("POST", route,
      { participantId: alice.data.participant.id }, bob.data.accessToken);
    assert.equal(bobRegister.status, 201);
    assert.equal(bobRegister.data.participantId, bob.data.participant.id);

    const missing = await request("POST", "/api/events/999/registrations", {}, alice.data.accessToken);
    assert.equal(missing.status, 404);
    const malformed = await request("POST", "/api/events/oops/registrations", {}, alice.data.accessToken);
    assert.equal(malformed.status, 400);
  });
});

test("HTTP: login checks password, session expiry rejects bearer", async () => {
  await withServer(async ({ db, request }) => {
    const signup = await request("POST", "/api/auth/signup", {
      name: "Carol", email: "carol@example.com", password: "long-local-password",
    });
    assert.equal(signup.status, 201);

    const incorrect = await request("POST", "/api/auth/login", {
      email: "carol@example.com", password: "wrong",
    });
    assert.equal(incorrect.status, 401);

    const login = await request("POST", "/api/auth/login", {
      email: "CAROL@example.com", password: "long-local-password",
    });
    assert.equal(login.status, 200);
    assert.notEqual(login.data.accessToken, signup.data.accessToken);

    const tokenHash = db.prepare("SELECT token_hash FROM auth_sessions WHERE participant_id = ? ORDER BY expires_at DESC").all(signup.data.participant.id);
    assert.equal(tokenHash.length, 2);
    db.prepare("UPDATE auth_sessions SET expires_at = ?").run(Date.now() - 1);

    const expired = await request("GET", "/api/events/1/registrations", undefined, login.data.accessToken);
    assert.equal(expired.status, 401);

    const badToken = await request("GET", "/api/events/1/registrations", undefined, "invalid");
    assert.equal(badToken.status, 401);

    const tooShort = await request("POST", "/api/auth/signup", {
      name: "Short", email: "short@example.com", password: "123",
    });
    assert.equal(tooShort.status, 400);
  });
});

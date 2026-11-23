import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { openDatabase, canManageEvent, createParticipant, getEvent, listEvents } from "../src/db.js";
import { createApp } from "../src/app.js";
import { demoEvents, seedDemoEvents } from "../src/demoSeed.js";

test("Demo seed: exactly three protected showcase events and no duplicates", () => {
  const db = openDatabase();
  try {
    assert.equal(seedDemoEvents(db), 3);
    assert.equal(seedDemoEvents(db), 0);
    const entries = listEvents(db, { limit: 100 });
    assert.equal(entries.length, 3);
    assert.deepEqual(entries.map((e) => e.title), demoEvents.map((e) => e.title));
    assert.deepEqual(entries.map((e) => e.imageTheme), ["tech", "gaming", "workshop"]);
    assert.equal(getEvent(db, entries[0].id).description, demoEvents[0].description);

    const attendee = createParticipant(db, { name: "Visitor", email: "visitor@example.com" });
    assert.equal(canManageEvent(db, entries[0].id, attendee.id), false);
  } finally {
    db.close();
  }
});

test("Demo startup recreates all three events in a fresh ephemeral database", () => {
  const first = openDatabase(":memory:");
  try {
    seedDemoEvents(first);
    assert.equal(listEvents(first, { limit: 100 }).length, 3);
  } finally {
    first.close();
  }
  const second = openDatabase(":memory:");
  try {
    assert.equal(listEvents(second, { limit: 100 }).length, 0);
    seedDemoEvents(second);
    assert.equal(listEvents(second, { limit: 100 }).length, 3);
  } finally {
    second.close();
  }
});

test("Hosted API: CORS allows configured frontend and throttles excessive signup", async () => {
  const db = openDatabase();
  const frontendOrigin = "https://evendule-demo.example";
  const server = createApp(db, { frontendOrigin, demoMode: true }).listen(0, "127.0.0.1");
  try {
    if (!server.listening) await once(server, "listening");
    const url = "http://127.0.0.1:" + server.address().port;
    const allowed = await fetch(url + "/api/events", {
      headers: { Origin: frontendOrigin },
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("access-control-allow-origin"), frontendOrigin);
    const denied = await fetch(url + "/api/events", {
      headers: { Origin: "https://unrelated.example" },
    });
    assert.equal(denied.headers.get("access-control-allow-origin"), null);
    const preflight = await fetch(url + "/api/auth/signup", {
      method: "OPTIONS",
      headers: { Origin: frontendOrigin, "Access-Control-Request-Method": "POST" },
    });
    assert.equal(preflight.status, 204);
    assert.match(preflight.headers.get("access-control-allow-headers"), /Content-Type/);
    const forbiddenPreflight = await fetch(url + "/api/auth/signup", {
      method: "OPTIONS", headers: { Origin: "https://unrelated.example" },
    });
    assert.equal(forbiddenPreflight.status, 403);

    let lastResponse;
    for (let i = 0; i < 21; i += 1) {
      lastResponse = await fetch(url + "/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: frontendOrigin },
        body: JSON.stringify({ name: "Visitor", email: "demo@example.com", password: "short" }),
      });
    }
    assert.equal(lastResponse.status, 429);
    assert.ok(Number(lastResponse.headers.get("retry-after")) > 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { openDatabase } from "./db.js";
import { createApp } from "./app.js";
import { seedDemoEvents } from "./demoSeed.js";

// In demo mode, every cold start gets a clean in-memory database.
// Local development retains its existing file-backed SQLite database.
const demoMode = process.env.DEMO_MODE === "1";
const filename = demoMode ? ":memory:" : (process.env.DB_PATH || "./data/events.sqlite");
if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
const db = openDatabase(filename);
if (demoMode) console.log(`Seeded ${seedDemoEvents(db)} demo events`);

const port = Number(process.env.PORT || 3001);
const host = process.env.RENDER ? "0.0.0.0" : "127.0.0.1";
const server = createApp(db).listen(port, host, () => {
  console.log(`Events API listening on ${host}:${port}`);
});

function shutdown() {
  server.close(() => db.close());
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

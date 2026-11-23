import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { openDatabase } from "./db.js";
import { createApp } from "./app.js";

const filename = process.env.DB_PATH || "./data/events.sqlite";
mkdirSync(dirname(filename), { recursive: true });
const db = openDatabase(filename);
const port = Number(process.env.PORT || 3001);

const server = createApp(db).listen(port, () => {
  console.log(`Events API running at http://localhost:${port}`);
});

function shutdown() {
  server.close(() => db.close());
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

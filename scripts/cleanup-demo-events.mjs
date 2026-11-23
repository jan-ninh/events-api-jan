// Local-only portfolio cleanup. Run from backend root with npm start STOPPED.
// Retain exactly three curated events; preview, back up, and remove four old ones.
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync, statSync, constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

const keepTitles = new Set([
  "React & TypeScript Community Night",
  "Indie Game Dev & Play Night",
  "Creative Coding Workshop",
]);
const filename = resolve(process.env.DB_PATH || "./data/events.sqlite");
if (!existsSync(filename)) {
  throw new Error("Local database not found: " + filename);
}
if (existsSync(filename + "-wal") && statSync(filename + "-wal").size > 0) {
  throw new Error("Nonempty SQLite WAL detected. Stop the server cleanly first.");
}
try {
  const response = await fetch("http://127.0.0.1:3001/health", {
    signal: AbortSignal.timeout(1000),
  });
  if (response) throw new Error("BACKEND_RUNNING");
} catch (error) {
  if (error.message === "BACKEND_RUNNING") {
    throw new Error("Stop the backend on port 3001 with Ctrl+C first.");
  }
}
const list = (db) =>
  db.prepare("SELECT id, title, starts_at FROM events ORDER BY id").all();
function check(rows) {
  const keep = rows.filter((r) => keepTitles.has(r.title));
  const remove = rows.filter((r) => !keepTitles.has(r.title));
  if (rows.length !== 7 || keep.length !== 3 || remove.length !== 4 ||
      new Set(keep.map((r) => r.title)).size !== 3) {
    throw new Error(
      "Safety stop: expected 7 events with exactly the 3 curated titles. Found " +
      rows.length + " events, " + keep.length + " curated matches. No deletion."
    );
  }
  return { keep, remove };
}
let db = new DatabaseSync(filename);
let rows, selected;
try {
  rows = list(db);
  selected = check(rows);
} finally {
  db.close();
}
console.log("KEEP:");
for (const row of selected.keep) console.log("  #" + row.id + " " + row.title);
console.log("DELETE:");
for (const row of selected.remove) console.log("  #" + row.id + " " + row.title);
if (!process.stdin.isTTY) throw new Error("Interactive terminal required.");
const prompt = createInterface({ input: process.stdin, output: process.stdout });
let confirmation;
try {
  confirmation = await prompt.question(
    "Type DELETE 4 to create a backup and remove ONLY the four listed events: "
  );
} finally {
  prompt.close();
}
if (confirmation.trim() !== "DELETE 4") {
  console.log("Cancelled. No changes made.");
  process.exit(0);
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backup = join(dirname(filename), "events-before-cleanup-" + stamp + ".sqlite");
copyFileSync(filename, backup, constants.COPYFILE_EXCL);
console.log("Backup: " + backup);
db = new DatabaseSync(filename);
db.exec("PRAGMA foreign_keys = ON");
try {
  db.exec("BEGIN IMMEDIATE");
  if (JSON.stringify(list(db)) !== JSON.stringify(rows)) {
    throw new Error("Events changed since preview. No deletion.");
  }
  const statement = db.prepare("DELETE FROM events WHERE id = ? AND title = ?");
  for (const row of selected.remove) {
    if (statement.run(row.id, row.title).changes !== 1) {
      throw new Error("Delete mismatch for #" + row.id);
    }
  }
  const remaining = list(db);
  if (remaining.length !== 3 ||
      remaining.some((row) => !keepTitles.has(row.title))) {
    throw new Error("Unexpected result; deleting nothing.");
  }
  db.exec("COMMIT");
  console.log("Success: four old events removed; three curated events remain.");
  console.log("Restart the backend and refresh Evendule.");
} catch (error) {
  try { db.exec("ROLLBACK"); } catch {}
  console.error("Rolled back: " + error.message);
  console.error("Backup kept at: " + backup);
  process.exitCode = 1;
} finally {
  db.close();
}

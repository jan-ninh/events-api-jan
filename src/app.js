import express from "express";
import { HttpError } from "./errors.js";
import { createEvent, createOrganizer, getEvent, listEvents, organizerStats } from "./db.js";

export function createApp(db) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.post("/api/organizers", (req, res) => {
    res.status(201).json(createOrganizer(db, req.body));
  });

  app.get("/api/events/stats", (req, res) => {
    res.json({ results: organizerStats(db, { from: req.query.from }) });
  });

  app.get("/api/events", (req, res) => {
    res.json({ results: listEvents(db, { from: req.query.from, limit: req.query.limit }) });
  });

  app.get("/api/events/:id", (req, res) => {
    res.json(getEvent(db, req.params.id));
  });

  app.post("/api/events", (req, res) => {
    res.status(201).json(createEvent(db, req.body));
  });

  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message });
    }
    if (err?.type === "entity.parse.failed") {
      return res.status(400).json({ error: "Invalid JSON" });
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });
  return app;
}

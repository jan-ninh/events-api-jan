import express from "express";
import { HttpError } from "./errors.js";
import { signup, login, profile, requireParticipant } from "./auth.js";
import {
  createEventForParticipant,
  getEvent,
  listEvents,
  organizerStats,
  registerForEvent,
  listEventRegistrations,
} from "./db.js";

export function createApp(db) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.get("/api/events/stats", (req, res) => {
    res.json({ results: organizerStats(db, { from: req.query.from }) });
  });

  app.get("/api/events", (req, res) => {
    res.json({
      results: listEvents(db, { from: req.query.from, limit: req.query.limit }),
    });
  });

  // Only authenticated participants can register. Client-supplied participant IDs
  // are deliberately ignored: the session identifies the participant.
  app.post("/api/auth/signup", (req, res) => {
    res.status(201).json(signup(db, req.body));
  });

  app.post("/api/auth/login", (req, res) => {
    res.json(login(db, req.body));
  });

  app.get("/api/auth/profile", (req, res, next) => {
    requireParticipant(db, req, res, next);
  }, (req, res) => {
    res.json(profile(db, req.auth.participantId));
  });

  app.post("/api/events/:id/registrations", (req, res, next) => {
    requireParticipant(db, req, res, next);
  }, (req, res) => {
    const registration = registerForEvent(db, req.params.id, req.auth.participantId);
    res.status(201).json(registration);
  });

  app.get("/api/events/:id/registrations", (req, res, next) => {
    requireParticipant(db, req, res, next);
  }, (req, res) => {
    const results = listEventRegistrations(db, req.params.id, req.auth.participantId);
    res.json({ results });
  });

  app.get("/api/events/:id", (req, res) => {
    res.json(getEvent(db, req.params.id));
  });

  app.post("/api/events", (req, res, next) => {
    requireParticipant(db, req, res, next);
  }, (req, res) => {
    res.status(201).json(createEventForParticipant(db, req.auth.participantId, req.body));
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

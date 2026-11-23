import express from "express";
import { HttpError } from "./errors.js";
import { signup, login, profile, requireParticipant } from "./auth.js";
import {
  createEventForParticipant,
  canManageEvent,
  deleteEventForParticipant,
  getEvent,
  listEvents,
  organizerStats,
  registerForEvent,
  listEventRegistrations,
} from "./db.js";

export function createApp(db, {
  frontendOrigin = process.env.FRONTEND_ORIGIN,
  demoMode = process.env.DEMO_MODE === "1",
} = {}) {
  const app = express();
  app.disable("x-powered-by");
  if (demoMode) app.set("trust proxy", 1);
  app.use(express.json({ limit: "32kb" }));

  // The publicly hosted React site is the only allowed browser origin.
  // Browser preflight requests must be handled before authentication.
  app.use((req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "no-referrer");
    res.set("Cache-Control", "no-store");
    const origin = req.get("origin");
    if (frontendOrigin && origin === frontendOrigin) {
      res.set("Access-Control-Allow-Origin", frontendOrigin);
      res.set("Vary", "Origin");
      res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    }
    if (req.method === "OPTIONS") {
      return res.status(origin && frontendOrigin && origin !== frontendOrigin ? 403 : 204).end();
    }
    next();
  });

  // Lightweight per-IP protection for the public demo's account endpoints.
  // This is intentionally bounded and resets with the ephemeral demo server.
  const attempts = new Map();
  const authRateLimit = (req, res, next) => {
    if (!demoMode) return next();
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    let entry = attempts.get(key);
    if (entry && entry.until <= now) {
      attempts.delete(key);
      entry = null;
    }
    if (!entry) {
      if (attempts.size >= 1024) {
        return res.status(429).json({ error: "Demo is busy. Please try again later." });
      }
      entry = { count: 0, until: now + 15 * 60 * 1000 };
      attempts.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > 20) {
      res.set("Retry-After", String(Math.ceil((entry.until - now) / 1000)));
      return res.status(429).json({ error: "Too many authentication attempts. Please try again later." });
    }
    next();
  };

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
  app.post("/api/auth/signup", authRateLimit, (req, res) => {
    res.status(201).json(signup(db, req.body));
  });

  app.post("/api/auth/login", authRateLimit, (req, res) => {
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

  app.get("/api/events/:id/permissions", (req, res, next) => {
    requireParticipant(db, req, res, next);
  }, (req, res) => {
    res.json({ canDelete: canManageEvent(db, req.params.id, req.auth.participantId) });
  });

  app.delete("/api/events/:id", (req, res, next) => {
    requireParticipant(db, req, res, next);
  }, (req, res) => {
    deleteEventForParticipant(db, req.params.id, req.auth.participantId);
    res.status(204).end();
  });

  // Return a consistent JSON response for missing API routes.
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API endpoint not found" });
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

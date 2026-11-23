import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { HttpError } from "./errors.js";
import { createParticipant, createOrganizer } from "./db.js";

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function passwordHash(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

function verifyPassword(password, stored) {
  try {
    const [salt, hex] = stored.split(":");
    const expected = Buffer.from(hex, "hex");
    const actual = scryptSync(password, salt, 64);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function createSession(db, participantId) {
  const accessToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(accessToken).digest("hex");
  db.prepare(
    "INSERT INTO auth_sessions (token_hash, participant_id, expires_at) VALUES (?, ?, ?)"
  ).run(tokenHash, participantId, Date.now() + SESSION_TTL_MS);
  return accessToken;
}

export function signup(db, body) {
  const password = body?.password;
  if (typeof password !== "string" || password.length < 12 || password.length > 128) {
    throw new HttpError(400, "Password must have 12-128 characters");
  }

  db.exec("BEGIN");
  try {
    const participant = createParticipant(db, {
      name: body?.name,
      email: body?.email,
    });
    db.prepare(
      "INSERT INTO participant_credentials (participant_id, password_hash) VALUES (?, ?)"
    ).run(participant.id, passwordHash(password));
    const organizer = createOrganizer(db, { name: `Account ${participant.id} events` });
    db.prepare(
      "INSERT INTO participant_organizers (participant_id, organizer_id) VALUES (?, ?)"
    ).run(participant.id, organizer.id);
    const accessToken = createSession(db, participant.id);
    db.exec("COMMIT");
    return { tokenType: "Bearer", accessToken, participant };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function login(db, body) {
  if (typeof body?.email !== "string" || typeof body?.password !== "string") {
    throw new HttpError(400, "Email and password are required");
  }
  const row = db.prepare(`
    SELECT p.id, p.name, p.email, c.password_hash AS passwordHash
    FROM participants p
    JOIN participant_credentials c ON c.participant_id = p.id
    WHERE p.email = ?
  `).get(body.email.trim().toLowerCase());

  if (!row || !verifyPassword(body.password, row.passwordHash)) {
    throw new HttpError(401, "Invalid credentials");
  }
  return {
    tokenType: "Bearer",
    accessToken: createSession(db, row.id),
    participant: { id: row.id, name: row.name, email: row.email },
  };
}

export function profile(db, participantId) {
  const participant = db.prepare(
    "SELECT id, name, email FROM participants WHERE id = ?"
  ).get(participantId);
  if (!participant) throw new HttpError(404, "Participant not found");
  return participant;
}

export function requireParticipant(db, req, res, next) {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.get("authorization") || "");
  if (!match) return res.status(401).json({ error: "Authentication required" });

  const tokenHash = createHash("sha256").update(match[1]).digest("hex");
  const session = db.prepare(`
    SELECT participant_id AS participantId
    FROM auth_sessions
    WHERE token_hash = ? AND expires_at > ?
  `).get(tokenHash, Date.now());

  if (!session) return res.status(401).json({ error: "Session invalid or expired" });

  req.auth = { participantId: session.participantId };
  next();
}

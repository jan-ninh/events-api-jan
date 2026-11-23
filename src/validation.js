import { HttpError } from "./errors.js";

export function requiredString(value, label, min = 1, max = 255) {
  if (typeof value !== "string") {
    throw new HttpError(400, `${label} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new HttpError(400, `${label} must have ${min}-${max} characters`);
  }
  return trimmed;
}

export function positiveId(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new HttpError(400, `${label} must be a positive integer`);
  }
  return number;
}

export function isoDate(value, label = "startsAt") {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT/.test(value)) {
    throw new HttpError(400, `${label} must be an ISO 8601 date-time`);
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    throw new HttpError(400, `${label} must be a valid date-time`);
  }
  return new Date(timestamp).toISOString();
}

export function eventListLimit(value) {
  if (value === undefined) return 25;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > 100) {
    throw new HttpError(400, "limit must be an integer between 1 and 100");
  }
  return n;
}

/**
 * @file src/utils/logger.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Central Winston logger with request-scoped context and credential masking. An
 *   AsyncLocalStorage-backed format injects requestId/gaii into every log line; a masking format redacts
 *   sensitive fields (tokens, passwords, keys, cookies). JSON output in production, colorized pretty
 *   output in development.
 *
 * @structure
 *   - requestContext, currentRequestId(): re-exported from utils/request-context.ts
 *   - errorFields(err): re-exported from utils/error-fields.ts
 *   - errorsAsFields/contextFormat/maskSensitive: Winston formats for Error fields, context
 *     injection and field redaction
 *   - logger: the configured Winston logger (console transport, AIMEAT_LOG_LEVEL or LOG_LEVEL)
 *
 * @version-history
 *   2026-10-16 — An Error under any field is written as its name, message, stack and own fields, and
 *     its strings pass the credential redaction. The request context moved to utils/request-context.ts
 *     and errorFields() is in utils/error-fields.ts; both re-exported (QA audit E1-04, F5-07, S5-07,
 *     E1-06, F5-09).
 *   v1.3.0 — 2026-10-12 — RequestContext.setHeader: a service that accepts a deprecated form sets the
 *     Deprecation headers on the response it runs under (services/deprecation.ts, Core 2026-11 HTTP-07).
 *   v1.2.0 — 2026-10-09 — Credential masking is case-insensitive, recursive (bounded, cycle-safe) and
 *     scrubs key-shaped text in every string, through utils/redact-credentials.ts (secrets audit d1).
 *   v1.1.0 — 2026-09-08 — AIMEAT_LOG_LEVEL is honoured, LOG_LEVEL kept as the fallback.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import winston from 'winston';
import { redactCredentialField } from './redact-credentials.js';
import { requestContext } from './request-context.js';

// The context lives in its own leaf module (utils/request-context.ts) so the envelope reads it
// without importing the logger; re-exported here for the readers that always took it from this file.
export { requestContext, currentRequestId, type RequestContext } from './request-context.js';
export { errorFields } from './error-fields.js';

/** How many `cause` links of an Error are written. */
const MAX_CAUSE_DEPTH = 3;
/** How deep errorsAsFields looks into plain objects and arrays for an Error. */
const MAX_FIELD_DEPTH = 4;

function isPlainRecord(v: object): v is Record<string, unknown> {
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

/**
 * An Error as plain data: name, message, stack, its own enumerable fields (a Postgres error's code,
 * detail and constraint, a system error's errno and syscall) and its cause. JSON.stringify writes an
 * Error as `{}` because message and stack are not enumerable, so an Error passed as a log field lost
 * the reason (QA audit E1-04).
 */
function serializeError(err: Error, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = { name: err.name, message: err.message };
  if (err.stack) out.stack = err.stack;
  for (const [k, v] of Object.entries(err)) {
    if (k in out || typeof v === 'function') continue;
    out[k] = v instanceof Error ? (depth < MAX_CAUSE_DEPTH ? serializeError(v, depth + 1) : v.message) : v;
  }
  const cause = (err as { cause?: unknown }).cause;
  if (cause !== undefined && !('cause' in out)) {
    out.cause = cause instanceof Error
      ? (depth < MAX_CAUSE_DEPTH ? serializeError(cause, depth + 1) : cause.message)
      : String(cause);
  }
  return out;
}

/** A copy of `v` with every Error inside it (plain objects and arrays only) turned into plain data. */
function errorsToData(v: unknown, depth: number): unknown {
  if (v instanceof Error) return serializeError(v, 0);
  if (v === null || typeof v !== 'object' || depth >= MAX_FIELD_DEPTH) return v;
  if (Array.isArray(v)) return v.some((x) => x !== null && typeof x === 'object') ? v.map((x) => errorsToData(x, depth + 1)) : v;
  if (!isPlainRecord(v)) return v;
  let changed = false;
  const o: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) {
    o[k] = errorsToData(val, depth + 1);
    if (o[k] !== val) changed = true;
  }
  return changed ? o : v;
}

/**
 * An Error found under any field of a log entry becomes plain data before redaction, so its message
 * and stack reach the line and pass the credential redaction like every other string.
 */
const errorsAsFields = winston.format((info) => {
  for (const key of Object.keys(info)) {
    if (LOGGER_FIELDS.has(key)) continue;
    info[key] = errorsToData(info[key], 0);
  }
  return info;
});

/** Custom Winston format that injects request context from AsyncLocalStorage. */
const contextFormat = winston.format((info) => {
  const ctx = requestContext.getStore();
  if (ctx) {
    if (ctx.requestId) info.requestId = ctx.requestId;
    if (ctx.gaii) info.gaii = ctx.gaii;
  }
  return info;
});

/** Top-level fields winston itself sets; nothing a caller passes lands in them. */
const LOGGER_FIELDS = new Set(['level', 'timestamp', 'node_id', 'requestId', 'gaii']);

/**
 * SECURITY: mask credentials in every log entry. A field whose name is a credential's (any case,
 * any depth, `Authorization`, `headers.authorization`, `client_secret`) is masked, and every string
 * (the message, an `error: String(err)`, a stack) has key-shaped text replaced. The rules are
 * utils/redact-credentials.ts, the same ones the AI provider errors use. Until 2026-10-09 eight
 * exact lowercase names were masked at the top level only (secrets audit, 07-side-channels d1).
 * Nested objects are copied, so an object the caller still holds keeps its values.
 */
const maskSensitive = winston.format((info) => {
  for (const key of Object.keys(info)) {
    if (LOGGER_FIELDS.has(key)) continue;
    info[key] = redactCredentialField(key, info[key]);
  }
  return info;
});

export const logger = winston.createLogger({
  // AIMEAT_LOG_LEVEL is the name this project's own variables carry and the one every .env.test.*
  // has set since July; LOG_LEVEL was the only name read, so every E2E node logged at info while
  // its environment said error. Found 2026-09-08 by e2e-mail-connections. Both names work.
  level: process.env.AIMEAT_LOG_LEVEL ?? process.env.LOG_LEVEL ?? 'info',
  defaultMeta: { node_id: process.env.AIMEAT_NODE_ID || 'aimeat-local-001-dev' },
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    errorsAsFields(),
    contextFormat(),
    maskSensitive(),
    process.env.NODE_ENV === 'production'
      ? winston.format.json()
      : winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, node_id: _nid, ...meta }) => {
          const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          return `${timestamp} ${level}: ${message}${extra}`;
        }),
      ),
  ),
  transports: [new winston.transports.Console()],
});

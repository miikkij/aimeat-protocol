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
 *   - requestContext: AsyncLocalStorage<RequestContext> carrying requestId/gaii per request
 *   - contextFormat/maskSensitive: Winston formats for context injection and field redaction
 *   - logger: the configured Winston logger (console transport, AIMEAT_LOG_LEVEL or LOG_LEVEL)
 *
 * @version-history
 *   v1.2.0 — 2026-10-09 — Credential masking is case-insensitive, recursive (bounded, cycle-safe) and
 *     scrubs key-shaped text in every string, through utils/redact-credentials.ts (secrets audit d1).
 *   v1.1.0 — 2026-09-08 — AIMEAT_LOG_LEVEL is honoured, LOG_LEVEL kept as the fallback.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import winston from 'winston';
import { AsyncLocalStorage } from 'node:async_hooks';
import { redactCredentialField } from './redact-credentials.js';

export interface RequestContext {
  requestId?: string;
  gaii?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

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

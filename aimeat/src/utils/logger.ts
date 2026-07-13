/**
 * @file src/utils/logger.ts
 * @description Central Winston logger with request-scoped context and credential masking. An
 *   AsyncLocalStorage-backed format injects requestId/gaii into every log line; a masking format redacts
 *   sensitive fields (tokens, passwords, keys, cookies). JSON output in production, colorized pretty
 *   output in development.
 *
 * @structure
 *   - requestContext: AsyncLocalStorage<RequestContext> carrying requestId/gaii per request
 *   - contextFormat/maskSensitive: Winston formats for context injection and field redaction
 *   - logger: the configured Winston logger (console transport, LOG_LEVEL-driven)
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import winston from 'winston';
import { AsyncLocalStorage } from 'node:async_hooks';

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

/** SECURITY: Mask sensitive fields in log output to prevent credential leaks. */
const SENSITIVE_FIELDS = ['token', 'password', 'private_key', 'privateKey', 'secret', 'authorization', 'cookie', 'encryptionKey'];

const maskSensitive = winston.format((info) => {
  for (const field of SENSITIVE_FIELDS) {
    if (info[field] !== undefined) {
      info[field] = '***REDACTED***';
    }
  }
  return info;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
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

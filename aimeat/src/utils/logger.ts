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

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    contextFormat(),
    process.env.NODE_ENV === 'production'
      ? winston.format.json()
      : winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          return `${timestamp} ${level}: ${message}${extra}`;
        }),
      ),
  ),
  transports: [new winston.transports.Console()],
});

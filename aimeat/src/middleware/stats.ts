/**
 * @file src/middleware/stats.ts
 * @description Express middleware that feeds the StatsCollector — counts every request,
 *   its HTTP method, and (on response finish) its status code.
 *
 * @structure
 *   - statsMiddleware(stats): returns middleware incrementing requests_total, per-method, per-status counters
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { Request, Response, NextFunction } from 'express';
import type { StatsCollector } from '../services/stats.js';

export function statsMiddleware(stats: StatsCollector) {
  return (req: Request, res: Response, next: NextFunction) => {
    stats.increment('requests_total');
    stats.incrementMethod(req.method);
    res.on('finish', () => {
      stats.incrementStatus(res.statusCode);
    });
    next();
  };
}

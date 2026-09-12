/**
 * @file src/middleware/stats.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Express middleware that feeds the StatsCollector — counts every request,
 *   its HTTP method, and (on response finish) its status code.
 *
 *   THIS FILE WAS WRITTEN AND NEVER MOUNTED. From the day it was added until 2026-09-12 no
 *   `app.use` anywhere referenced it, so `requests_total` was 0 on every node that has ever run
 *   this code, and the Statistics page led on a card reading zero. Nothing failed, nothing logged,
 *   and a grep for the export name returned one hit: its own definition. A counter nobody writes
 *   looks exactly like a counter at rest, which is why the page now distinguishes the two.
 *
 *   IT MOUNTS BESIDE metricsMiddleware, in routes-loader.ts, and that is not incidental:
 *   `requests_total` here and `aimeat_http_requests_total` in GET /v1/metrics must mean the same
 *   thing, or an operator holding both surfaces gets two answers to one question. Move one and move
 *   the other. Unlike the Prometheus registry this one is not opt-in, because the Statistics page
 *   is always there.
 *
 * @structure
 *   - statsMiddleware(stats): returns middleware incrementing requests_total, per-method, per-status counters
 *
 * @version-history
 *   v1.1.0 — 2026-09-12 — Mounted for the first time (routes-loader.ts, beside the metrics one).
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

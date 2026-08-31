/**
 * @file src/middleware/metrics.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Express middleware that records per-request Prometheus metrics
 *   (HTTP request count and duration by method/route/status) into the shared
 *   Prometheus client registry on response finish.
 *
 * @structure
 *   - metricsMiddleware(registry): middleware factory reading the pre-registered
 *     aimeat_http_requests_total counter and aimeat_http_request_duration_ms histogram
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { Request, Response, NextFunction } from 'express';
import type { Registry, Counter, Histogram } from '@prometheus-io/client';

/**
 * Express middleware that records HTTP request count and duration
 * into the Prometheus registry created by createMetricsRegistry().
 */
export function metricsMiddleware(registry: Registry) {
  // `<string>` names the label type. Without it @prometheus-io/client reads these as metrics that
  // take no labels at all, and inc({ method, route, status }) below stops compiling.
  const requestCounter = registry.getSingleMetric('aimeat_http_requests_total') as Counter<string>;
  const durationHistogram = registry.getSingleMetric('aimeat_http_request_duration_ms') as Histogram<string>;

  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - start;
      const route = (req.route?.path as string) ?? 'unmatched';
      const method = req.method;
      const status = String(res.statusCode);

      if (requestCounter) {
        requestCounter.inc({ method, route, status });
      }
      if (durationHistogram) {
        durationHistogram.observe({ method, route }, duration);
      }
    });

    next();
  };
}

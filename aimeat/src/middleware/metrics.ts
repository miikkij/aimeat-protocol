/**
 * @file src/middleware/metrics.ts
 * @description Express middleware that records per-request Prometheus metrics
 *   (HTTP request count and duration by method/route/status) into the shared
 *   prom-client registry on response finish.
 *
 * @structure
 *   - metricsMiddleware(registry): middleware factory reading the pre-registered
 *     aimeat_http_requests_total counter and aimeat_http_request_duration_ms histogram
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { Request, Response, NextFunction } from 'express';
import type { Registry, Counter, Histogram } from 'prom-client';

/**
 * Express middleware that records HTTP request count and duration
 * into the Prometheus registry created by createMetricsRegistry().
 */
export function metricsMiddleware(registry: Registry) {
  const requestCounter = registry.getSingleMetric('aimeat_http_requests_total') as Counter;
  const durationHistogram = registry.getSingleMetric('aimeat_http_request_duration_ms') as Histogram;

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

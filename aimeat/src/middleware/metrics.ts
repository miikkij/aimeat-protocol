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
      const route = (req.route?.path as string) ?? req.path;
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

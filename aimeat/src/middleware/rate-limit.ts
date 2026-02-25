import type { Request, Response, NextFunction } from 'express';

interface RateBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateBucket>();

// Cleanup expired buckets every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt) buckets.delete(key);
  }
}, 60_000);

export function rateLimit(opts: { windowMs?: number; max?: number } = {}) {
  const windowMs = opts.windowMs ?? 60_000;
  const max = opts.max ?? 100;

  return (req: Request, res: Response, next: NextFunction) => {
    // Key by GAII if authenticated, otherwise by IP
    const key = req.auth?.sub ?? req.ip ?? 'unknown';
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count++;

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - bucket.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(bucket.resetAt / 1000));

    if (bucket.count > max) {
      res.status(429).json({
        ok: false,
        protocol: 'aimeat',
        version: 'v1',
        timestamp: new Date().toISOString(),
        error: {
          code: 'RATE_LIMITED',
          message: `Too many requests. Limit: ${max} per ${windowMs / 1000}s. Try again at ${new Date(bucket.resetAt).toISOString()}`,
        },
        hints: {
          next_actions: [
            { description: 'Wait and retry', method: 'GET', url: '/' },
          ],
        },
      });
      return;
    }

    next();
  };
}

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

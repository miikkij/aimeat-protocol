import { describe, it, expect, beforeEach } from 'vitest';
import { StatsCollector } from '../../src/services/stats.js';

describe('StatsCollector', () => {
  let stats: StatsCollector;

  beforeEach(() => {
    stats = new StatsCollector();
  });

  it('starts with zero counters', () => {
    const snap = stats.snapshot();
    expect(snap.requests_total).toBe(0);
    expect(snap.memory_writes).toBe(0);
  });

  it('increments named counters', () => {
    stats.increment('requests_total');
    stats.increment('requests_total');
    stats.increment('memory_writes');
    const snap = stats.snapshot();
    expect(snap.requests_total).toBe(2);
    expect(snap.memory_writes).toBe(1);
  });

  it('increments method counters', () => {
    stats.incrementMethod('GET');
    stats.incrementMethod('POST');
    stats.incrementMethod('GET');
    const snap = stats.snapshot();
    expect(snap.requests_by_method.GET).toBe(2);
    expect(snap.requests_by_method.POST).toBe(1);
  });

  it('increments status counters', () => {
    stats.incrementStatus(200);
    stats.incrementStatus(404);
    stats.incrementStatus(500);
    const snap = stats.snapshot();
    expect(snap.requests_by_status['2xx']).toBe(1);
    expect(snap.requests_by_status['4xx']).toBe(1);
    expect(snap.requests_by_status['5xx']).toBe(1);
  });

  it('records daily history', () => {
    stats.increment('requests_total');
    stats.increment('memory_writes');
    const snap = stats.snapshot();
    const today = new Date().toISOString().split('T')[0];
    expect(snap.daily_history).toBeDefined();
    expect(snap.daily_history[today]).toBeDefined();
    expect(snap.daily_history[today].requests_total).toBe(1);
  });

  it('reports uptime and started_at', () => {
    const snap = stats.snapshot();
    expect(snap.uptime_seconds).toBeGreaterThanOrEqual(0);
    expect(snap.started_at).toBeTruthy();
  });
});

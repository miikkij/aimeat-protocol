import { describe, it, expect, beforeEach } from 'vitest';
import { createMetricsRegistry } from '../../src/services/prometheus.js';
import type { AimeatConfig } from '../../src/config.js';

/** Minimal config stub — only nodeId is used by the registry. */
function stubConfig(overrides: Partial<AimeatConfig> = {}): AimeatConfig {
  return {
    nodeId: 'test-node-001',
    ...overrides,
  } as AimeatConfig;
}

describe('createMetricsRegistry', () => {
  let registry: ReturnType<typeof createMetricsRegistry>;

  beforeEach(() => {
    registry = createMetricsRegistry(stubConfig());
  });

  it('sets default node_id label from config', async () => {
    const output = await registry.metrics();
    // Default labels appear on every metric line
    expect(output).toContain('node_id="test-node-001"');
  });

  it('registers aimeat_http_requests_total counter', () => {
    const metric = registry.getSingleMetric('aimeat_http_requests_total');
    expect(metric).toBeDefined();
  });

  it('registers aimeat_http_request_duration_ms histogram', () => {
    const metric = registry.getSingleMetric('aimeat_http_request_duration_ms');
    expect(metric).toBeDefined();
  });

  it('registers aimeat_tunnel_connections_active gauge', () => {
    const metric = registry.getSingleMetric('aimeat_tunnel_connections_active');
    expect(metric).toBeDefined();
  });

  it('registers aimeat_mailbox_items_total gauge', () => {
    const metric = registry.getSingleMetric('aimeat_mailbox_items_total');
    expect(metric).toBeDefined();
  });

  it('registers aimeat_auth_failures_total counter', () => {
    const metric = registry.getSingleMetric('aimeat_auth_failures_total');
    expect(metric).toBeDefined();
  });

  it('includes Node.js process metrics', async () => {
    const output = await registry.metrics();
    // collectDefaultMetrics registers process_cpu_* and nodejs_* metrics
    expect(output).toMatch(/process_cpu|nodejs_/);
  });

  it('uses custom nodeId from config', async () => {
    const custom = createMetricsRegistry(stubConfig({ nodeId: 'my-custom-node' }));
    const output = await custom.metrics();
    expect(output).toContain('node_id="my-custom-node"');
  });
});

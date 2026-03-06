import { describe, it, expect, vi, beforeEach } from 'vitest';
import { corsMiddleware } from '../../src/middleware/cors.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';
import type { Request, Response } from 'express';

// Minimal config stub
function mockConfig(overrides: Partial<AimeatConfig> = {}): AimeatConfig {
  return {
    corsAllowedOrigins: ['*'],
    anonymousMode: false,
    nodeId: 'test-node',
    ...overrides,
  } as unknown as AimeatConfig;
}

function mockStorage(overrides: Partial<Storage> = {}): Storage {
  return {
    getGHIIByOwner: vi.fn().mockResolvedValue(null),
    getAgent: vi.fn().mockResolvedValue(null),
    getMemory: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as Storage;
}

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    method: 'GET',
    path: '/v1/health',
    auth: undefined,
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response & { _headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  return {
    _headers: headers,
    setHeader: vi.fn((name: string, value: string) => { headers[name] = value; }),
    status: vi.fn().mockReturnThis(),
    end: vi.fn(),
  } as unknown as Response & { _headers: Record<string, string> };
}

describe('corsMiddleware', () => {
  describe('Phase 1: Node-level', () => {
    it('allows requests without Origin header', async () => {
      const mw = corsMiddleware(mockConfig());
      const req = mockReq();
      const res = mockRes();
      const next = vi.fn();

      await mw(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.setHeader).not.toHaveBeenCalled();
    });

    it('sets CORS headers when origin matches wildcard', async () => {
      const mw = corsMiddleware(mockConfig());
      const req = mockReq({ headers: { origin: 'https://example.com' } });
      const res = mockRes();
      const next = vi.fn();

      await mw(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res._headers['Access-Control-Allow-Origin']).toBe('https://example.com');
      expect(res._headers['Access-Control-Allow-Credentials']).toBe('true');
    });

    it('allows matching specific origin', async () => {
      const config = mockConfig({ corsAllowedOrigins: ['https://app.example.com'] });
      const mw = corsMiddleware(config);
      const req = mockReq({ headers: { origin: 'https://app.example.com' } });
      const res = mockRes();
      const next = vi.fn();

      await mw(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res._headers['Access-Control-Allow-Origin']).toBe('https://app.example.com');
    });

    it('denies non-matching origin on preflight with 403', async () => {
      const config = mockConfig({ corsAllowedOrigins: ['https://allowed.com'] });
      const mw = corsMiddleware(config);
      const req = mockReq({ headers: { origin: 'https://evil.com' }, method: 'OPTIONS' });
      const res = mockRes();
      const next = vi.fn();

      await mw(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.end).toHaveBeenCalled();
    });

    it('omits CORS headers for non-matching non-preflight', async () => {
      const config = mockConfig({ corsAllowedOrigins: ['https://allowed.com'] });
      const mw = corsMiddleware(config);
      const req = mockReq({ headers: { origin: 'https://evil.com' }, method: 'GET' });
      const res = mockRes();
      const next = vi.fn();

      await mw(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res._headers['Access-Control-Allow-Origin']).toBeUndefined();
    });

    it('returns 204 with Max-Age on allowed preflight', async () => {
      const mw = corsMiddleware(mockConfig());
      const req = mockReq({ headers: { origin: 'https://example.com' }, method: 'OPTIONS' });
      const res = mockRes();
      const next = vi.fn();

      await mw(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res._headers['Access-Control-Max-Age']).toBe('3600');
    });
  });

  describe('Anonymous mode', () => {
    it('allows all origins when anonymous + no auth header', async () => {
      const config = mockConfig({ anonymousMode: true });
      const mw = corsMiddleware(config);
      const req = mockReq({ headers: { origin: 'https://anything.com' } });
      const res = mockRes();
      const next = vi.fn();

      await mw(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res._headers['Access-Control-Allow-Origin']).toBe('*');
    });
  });

  describe('Phase 2: GHII-level', () => {
    it('uses GHII allowedOrigins when set', async () => {
      const storage = mockStorage({
        getGHIIByOwner: vi.fn().mockResolvedValue({
          allowedOrigins: ['https://myapp.com'],
        }),
      });
      const config = mockConfig({ corsAllowedOrigins: ['*'] });
      const mw = corsMiddleware(config, () => storage);
      const req = mockReq({
        headers: { origin: 'https://myapp.com' },
        auth: { sub: 'agent#alice@node', owner: 'alice', roles: ['owner'], node: 'node', exp: 9999999999 },
      });
      const res = mockRes();
      const next = vi.fn();

      await mw(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res._headers['Access-Control-Allow-Origin']).toBe('https://myapp.com');
    });

    it('falls back to node default when GHII has no origins', async () => {
      const storage = mockStorage({
        getGHIIByOwner: vi.fn().mockResolvedValue({ allowedOrigins: undefined }),
      });
      const config = mockConfig({ corsAllowedOrigins: ['https://node-default.com'] });
      const mw = corsMiddleware(config, () => storage);
      const req = mockReq({
        headers: { origin: 'https://node-default.com' },
        auth: { sub: 'alice', owner: 'alice', roles: ['owner'], node: 'node', exp: 9999999999 },
      });
      const res = mockRes();
      const next = vi.fn();

      await mw(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res._headers['Access-Control-Allow-Origin']).toBe('https://node-default.com');
    });
  });

  describe('Phase 3: Agent-level', () => {
    it('uses agent allowedOrigins over GHII', async () => {
      const storage = mockStorage({
        getGHIIByOwner: vi.fn().mockResolvedValue({
          allowedOrigins: ['https://ghii-origin.com'],
        }),
        getAgent: vi.fn().mockResolvedValue({
          allowedOrigins: ['https://agent-origin.com'],
        }),
      });
      const config = mockConfig({ corsAllowedOrigins: ['*'] });
      const mw = corsMiddleware(config, () => storage);
      const req = mockReq({
        headers: { origin: 'https://agent-origin.com' },
        auth: { sub: 'bot#alice@node', owner: 'alice', roles: ['agent'], node: 'node', exp: 9999999999 },
      });
      const res = mockRes();
      const next = vi.fn();

      await mw(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res._headers['Access-Control-Allow-Origin']).toBe('https://agent-origin.com');
    });

    it('skips agent lookup when sub === owner', async () => {
      const storage = mockStorage({
        getGHIIByOwner: vi.fn().mockResolvedValue(null),
        getAgent: vi.fn(),
      });
      const config = mockConfig({ corsAllowedOrigins: ['*'] });
      const mw = corsMiddleware(config, () => storage);
      const req = mockReq({
        headers: { origin: 'https://example.com' },
        auth: { sub: 'alice', owner: 'alice', roles: ['owner'], node: 'node', exp: 9999999999 },
      });
      const res = mockRes();
      const next = vi.fn();

      await mw(req, res, next);

      expect(storage.getAgent).not.toHaveBeenCalled();
    });
  });

  describe('Phase 4: Memory-level', () => {
    it('uses memory allowedOrigins for /v1/memory/:key paths', async () => {
      const storage = mockStorage({
        getMemory: vi.fn().mockResolvedValue({
          allowedOrigins: ['https://memory-origin.com'],
        }),
        getAgent: vi.fn().mockResolvedValue(null),
        getGHIIByOwner: vi.fn().mockResolvedValue(null),
      });
      const config = mockConfig({ corsAllowedOrigins: ['*'] });
      const mw = corsMiddleware(config, () => storage);
      const req = mockReq({
        headers: { origin: 'https://memory-origin.com' },
        path: '/v1/memory/my.key',
        auth: { sub: 'bot#alice@node', owner: 'alice', roles: ['agent'], node: 'node', exp: 9999999999 },
      });
      const res = mockRes();
      const next = vi.fn();

      await mw(req, res, next);

      expect(storage.getMemory).toHaveBeenCalledWith('bot#alice@node', 'my.key');
      expect(res._headers['Access-Control-Allow-Origin']).toBe('https://memory-origin.com');
    });

    it('uses memory allowedOrigins for /v1/memory/cors/:key paths', async () => {
      const storage = mockStorage({
        getMemory: vi.fn().mockResolvedValue({
          allowedOrigins: ['https://cors-key.com'],
        }),
      });
      const config = mockConfig({ corsAllowedOrigins: ['*'] });
      const mw = corsMiddleware(config, () => storage);
      const req = mockReq({
        headers: { origin: 'https://cors-key.com' },
        path: '/v1/memory/cors/settings.theme',
        auth: { sub: 'bot#alice@node', owner: 'alice', roles: ['agent'], node: 'node', exp: 9999999999 },
      });
      const res = mockRes();
      const next = vi.fn();

      await mw(req, res, next);

      expect(storage.getMemory).toHaveBeenCalledWith('bot#alice@node', 'settings.theme');
    });

    it('does not extract memory key for /v1/memory/search', async () => {
      const storage = mockStorage();
      const config = mockConfig({ corsAllowedOrigins: ['*'] });
      const mw = corsMiddleware(config, () => storage);
      const req = mockReq({
        headers: { origin: 'https://example.com' },
        path: '/v1/memory/search',
        auth: { sub: 'bot#alice@node', owner: 'alice', roles: ['agent'], node: 'node', exp: 9999999999 },
      });
      const res = mockRes();
      const next = vi.fn();

      await mw(req, res, next);

      expect(storage.getMemory).not.toHaveBeenCalled();
    });

    it('full chain: memory > agent > ghii > node', async () => {
      // Set up all levels — memory should win
      const storage = mockStorage({
        getMemory: vi.fn().mockResolvedValue({
          allowedOrigins: ['https://most-specific.com'],
        }),
        getAgent: vi.fn().mockResolvedValue({
          allowedOrigins: ['https://agent-level.com'],
        }),
        getGHIIByOwner: vi.fn().mockResolvedValue({
          allowedOrigins: ['https://ghii-level.com'],
        }),
      });
      const config = mockConfig({ corsAllowedOrigins: ['https://node-level.com'] });
      const mw = corsMiddleware(config, () => storage);
      const req = mockReq({
        headers: { origin: 'https://most-specific.com' },
        path: '/v1/memory/my.key',
        auth: { sub: 'bot#alice@node', owner: 'alice', roles: ['agent'], node: 'node', exp: 9999999999 },
      });
      const res = mockRes();
      const next = vi.fn();

      await mw(req, res, next);

      expect(res._headers['Access-Control-Allow-Origin']).toBe('https://most-specific.com');
    });
  });
});

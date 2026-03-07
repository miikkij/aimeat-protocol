import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import type { AimeatConfig } from '../../config.js';
import { cookieConsentMiddleware, buildStandaloneSnippetJs } from '../cookie-consent.js';

/** Helper to create a minimal AimeatConfig with cookie consent fields */
function makeConfig(overrides: Partial<AimeatConfig> = {}): AimeatConfig {
  return {
    cookieConsentEnabled: false,
    cookieConsentCategories: ['necessary'],
    cookieConsentPolicyUrl: null,
    // Provide minimal defaults for other required fields so TS is happy
    port: 40050,
    baseUrl: 'http://localhost:40050',
    nodeId: 'test-node',
    nodeType: 'full',
    dbUrl: null,
    adminPassword: null,
    devMode: false,
    anonymousMode: false,
    jwtTtlSeconds: 3600,
    welcomeBonus: 100,
    dailyAllowance: 50,
    dailyAllowanceCap: 500,
    burnRate: 0.1,
    keyedBrowseEnabled: true,
    extendedFeaturesEnabled: true,
    maxRelayHops: 3,
    depeeringGracePeriodHours: 72,
    keyCacheRefreshMinutes: 5,
    memoryQuotaMb: 10,
    storageQuotaMb: 100,
    microMemoryQuotaKb: 500,
    memoryOverageMorselsPerMbMonth: 10,
    storageOverageMorselsPerGbMonth: 100,
    maxOperatorMintPerDay: 10000,
    boardPostBaseCost: 5,
    boardPostCostPerKb: 2,
    webhookMaxRetries: 5,
    workQueueMaxPending: 10,
    otkTtlMs: 300000,
    otkGraceMs: 60000,
    maxUrlLength: 8192,
    indexNowKey: null,
    extensionHooks: {
      pre_owner_registration: [],
      post_owner_registration: [],
      pre_agent_registration: [],
      post_agent_registration: [],
      owner_recovery: [],
      agent_rekey: [],
      pre_work_request: [],
      post_work_delivery: [],
      post_settlement: [],
      pre_board_post: [],
      pre_federation_peer: [],
    },
    federationRole: 'standalone',
    genesisUrl: null,
    consentEnabled: true,
    consentAuditRetentionDays: 365,
    consentMaxPerUser: 100,
    totpEnabled: false,
    totpIssuer: 'AIMEAT',
    totpPeriod: 30,
    totpWindow: 1,
    totpBackupCodeCount: 10,
    totpSecretEncryptionKey: null,
    totpMaxFailedAttempts: 5,
    totpLockoutSeconds: 300,
    personalNodesEnabled: false,
    personalNodeMaxSlots: 100,
    personalNodeMailboxQuotaMb: 50,
    personalNodeMailboxRetentionDays: 7,
    personalNodeHeartbeatIntervalMs: 30000,
    personalNodeOfflineThresholdMs: 300000,
    smtpHost: null,
    smtpPort: 587,
    smtpUser: null,
    smtpPass: null,
    smtpFrom: 'AIMEAT <noreply@localhost>',
    smtpSecure: false,
    emailConfirmationRequired: false,
    emailEnabled: false,
    matchNotificationIntervalHours: 24,
    matchNotificationEnabled: false,
    matchingEnabled: false,
    matchIntervalHours: 24,
    matchThreshold: 0.5,
    matchMaxSuggestions: 5,
    matchMaxDistanceKm: 100,
    matchCooldownDays: 7,
    marketplaceEnabled: false,
    marketplaceListingFeeMorsels: 2,
    marketplaceTransactionFeePercent: 5,
    marketplaceEscrowEnabled: false,
    pushEnabled: false,
    vapidPublicKey: null,
    vapidPrivateKey: null,
    vapidSubject: 'mailto:admin@aimeat.example.com',
    eudiwEnabled: false,
    eudiwClientId: 'aimeat-verifier-001',
    eudiwRedirectUri: '',
    ftnEnabled: false,
    ftnProviderUrl: 'https://tunnistautuminen.suomi.fi',
    vcIssuerDid: '',
    crossFederationEnabled: false,
    maxGenesisPeers: 10,
    genesisSyncIntervalHours: 6,
    rlGlobal: 300,
    rlAuth: 20,
    rlWork: 60,
    rlMemory: 120,
    rlBoards: 60,
    rlOwners: 300,
    rlGhii: 300,
    rlFlags: 300,
    rlAppeals: 300,
    rlAdminSetup: 300,
    rlFederation: 300,
    rlCatalogue: 300,
    rlAuthChallenge: 300,
    rateLimits: {
      global: { windowMs: 1000, max: 300 },
      auth: { windowMs: 1000, max: 20 },
      work: { windowMs: 1000, max: 60 },
      memory: { windowMs: 1000, max: 120 },
      boards: { windowMs: 1000, max: 60 },
      owners: { windowMs: 1000, max: 300 },
      ghii: { windowMs: 1000, max: 300 },
      flags: { windowMs: 1000, max: 300 },
      appeals: { windowMs: 1000, max: 300 },
      adminSetup: { windowMs: 1000, max: 300 },
      federation: { windowMs: 1000, max: 300 },
      catalogue: { windowMs: 1000, max: 300 },
      authChallenge: { windowMs: 1000, max: 300 },
      roleMultipliers: { operator: 10, owner: 2, agent: 1, anonymous: 0.5 },
    },
    ...overrides,
  } as AimeatConfig;
}

/** Helper to create mock Express req/res/next */
function createMocks() {
  const req = {} as Request;
  const headers = new Map<string, string | number | readonly string[]>();
  const res = {
    getHeader: (name: string) => headers.get(name.toLowerCase()),
    setHeader: (name: string, value: string) => { headers.set(name.toLowerCase(), value); return res; },
    send: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next, headers };
}

describe('cookieConsentMiddleware', () => {
  it('no-op when disabled — calls next() without modifying res.send', () => {
    const config = makeConfig({ cookieConsentEnabled: false });
    const middleware = cookieConsentMiddleware(config);
    const { req, res, next } = createMocks();

    const originalSend = res.send;
    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    // res.send should NOT have been replaced
    expect(res.send).toBe(originalSend);
  });

  it('injects snippet into HTML response before </body>', () => {
    const config = makeConfig({ cookieConsentEnabled: true });
    const middleware = cookieConsentMiddleware(config);
    const { req, res, next, headers } = createMocks();

    middleware(req, res, next);
    expect(next).toHaveBeenCalled();

    // Simulate Express setting Content-Type and calling send
    headers.set('content-type', 'text/html; charset=utf-8');
    const htmlBody = '<html><body><p>Hello</p></body></html>';

    // The overridden send should inject the snippet
    // We need to capture what the original send receives
    const originalSend = vi.fn().mockReturnThis();
    // Swap in a spy for the underlying send
    const wrappedSend = res.send;
    // The middleware replaced res.send with a wrapper that calls originalSend
    // Let's just call it and verify it modifies the body
    // Re-create to properly test the interception
    const req2 = {} as Request;
    const headers2 = new Map<string, string | number | readonly string[]>();
    let capturedBody: unknown;
    const res2 = {
      getHeader: (name: string) => headers2.get(name.toLowerCase()),
      send: vi.fn(function (this: Response, body?: unknown) {
        capturedBody = body;
        return this;
      }),
    } as unknown as Response;
    const next2 = vi.fn() as unknown as NextFunction;

    const middleware2 = cookieConsentMiddleware(config);
    middleware2(req2, res2, next2);

    headers2.set('content-type', 'text/html; charset=utf-8');
    res2.send(htmlBody);

    expect(typeof capturedBody).toBe('string');
    const result = capturedBody as string;
    expect(result).toContain('cookieconsent.css');
    expect(result).toContain('cookieconsent.umd.js');
    expect(result).toContain('CookieConsent.run(');
    expect(result).toContain('</body>');
    // Snippet should appear before </body>
    const snippetIndex = result.indexOf('CookieConsent.run(');
    const bodyCloseIndex = result.indexOf('</body>');
    expect(snippetIndex).toBeLessThan(bodyCloseIndex);
  });

  it('skips non-HTML responses (application/json)', () => {
    const config = makeConfig({ cookieConsentEnabled: true });
    const middleware = cookieConsentMiddleware(config);

    const req = {} as Request;
    const headers = new Map<string, string | number | readonly string[]>();
    let capturedBody: unknown;
    const res = {
      getHeader: (name: string) => headers.get(name.toLowerCase()),
      send: vi.fn(function (this: Response, body?: unknown) {
        capturedBody = body;
        return this;
      }),
    } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;

    middleware(req, res, next);
    headers.set('content-type', 'application/json');
    const jsonBody = '{"ok":true}';
    res.send(jsonBody);

    expect(capturedBody).toBe(jsonBody);
  });

  it('includes configured categories in the snippet', () => {
    const config = makeConfig({
      cookieConsentEnabled: true,
      cookieConsentCategories: ['necessary', 'analytics', 'marketing'],
    });
    const middleware = cookieConsentMiddleware(config);

    const req = {} as Request;
    const headers = new Map<string, string | number | readonly string[]>();
    let capturedBody: unknown;
    const res = {
      getHeader: (name: string) => headers.get(name.toLowerCase()),
      send: vi.fn(function (this: Response, body?: unknown) {
        capturedBody = body;
        return this;
      }),
    } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;

    middleware(req, res, next);
    headers.set('content-type', 'text/html');
    res.send('<html><body></body></html>');

    const result = capturedBody as string;
    expect(result).toContain('"analytics"');
    expect(result).toContain('"marketing"');
    expect(result).toContain('"necessary"');
  });

  it('includes policy URL when cookieConsentPolicyUrl is set', () => {
    const config = makeConfig({
      cookieConsentEnabled: true,
      cookieConsentPolicyUrl: 'https://example.com/privacy',
    });
    const middleware = cookieConsentMiddleware(config);

    const req = {} as Request;
    const headers = new Map<string, string | number | readonly string[]>();
    let capturedBody: unknown;
    const res = {
      getHeader: (name: string) => headers.get(name.toLowerCase()),
      send: vi.fn(function (this: Response, body?: unknown) {
        capturedBody = body;
        return this;
      }),
    } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;

    middleware(req, res, next);
    headers.set('content-type', 'text/html');
    res.send('<html><body></body></html>');

    const result = capturedBody as string;
    expect(result).toContain('https://example.com/privacy');
    expect(result).toContain('Privacy Policy');
  });

  it('omits footer link when cookieConsentPolicyUrl is null', () => {
    const config = makeConfig({
      cookieConsentEnabled: true,
      cookieConsentPolicyUrl: null,
    });
    const middleware = cookieConsentMiddleware(config);

    const req = {} as Request;
    const headers = new Map<string, string | number | readonly string[]>();
    let capturedBody: unknown;
    const res = {
      getHeader: (name: string) => headers.get(name.toLowerCase()),
      send: vi.fn(function (this: Response, body?: unknown) {
        capturedBody = body;
        return this;
      }),
    } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;

    middleware(req, res, next);
    headers.set('content-type', 'text/html');
    res.send('<html><body></body></html>');

    const result = capturedBody as string;
    expect(result).not.toContain('Privacy Policy');
    expect(result).not.toContain('footer');
  });

  it('passes HTML through unchanged when there is no </body> tag', () => {
    const config = makeConfig({ cookieConsentEnabled: true });
    const middleware = cookieConsentMiddleware(config);

    const req = {} as Request;
    const headers = new Map<string, string | number | readonly string[]>();
    let capturedBody: unknown;
    const res = {
      getHeader: (name: string) => headers.get(name.toLowerCase()),
      send: vi.fn(function (this: Response, body?: unknown) {
        capturedBody = body;
        return this;
      }),
    } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;

    middleware(req, res, next);
    headers.set('content-type', 'text/html');
    const htmlWithoutBody = '<html><head><title>No body tag</title></head></html>';
    res.send(htmlWithoutBody);

    // Body should pass through without any injection
    expect(capturedBody).toBe(htmlWithoutBody);
    expect(capturedBody).not.toContain('CookieConsent');
    expect(capturedBody).not.toContain('cookieconsent.css');
  });

  it('handles empty string body gracefully', () => {
    const config = makeConfig({ cookieConsentEnabled: true });
    const middleware = cookieConsentMiddleware(config);

    const req = {} as Request;
    const headers = new Map<string, string | number | readonly string[]>();
    let capturedBody: unknown;
    const res = {
      getHeader: (name: string) => headers.get(name.toLowerCase()),
      send: vi.fn(function (this: Response, body?: unknown) {
        capturedBody = body;
        return this;
      }),
    } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;

    middleware(req, res, next);
    headers.set('content-type', 'text/html');
    res.send('');

    // Empty body should pass through unchanged
    expect(capturedBody).toBe('');
  });

  it('passes non-string body through unchanged (e.g. Buffer)', () => {
    const config = makeConfig({ cookieConsentEnabled: true });
    const middleware = cookieConsentMiddleware(config);

    const req = {} as Request;
    const headers = new Map<string, string | number | readonly string[]>();
    let capturedBody: unknown;
    const res = {
      getHeader: (name: string) => headers.get(name.toLowerCase()),
      send: vi.fn(function (this: Response, body?: unknown) {
        capturedBody = body;
        return this;
      }),
    } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;

    middleware(req, res, next);
    headers.set('content-type', 'text/html');
    const buf = Buffer.from('<html><body></body></html>');
    res.send(buf);

    // Non-string body should pass through without modification
    expect(capturedBody).toBe(buf);
  });
});

/**
 * Extract the JSON config object from a CookieConsent.run(...) call inside a JS string.
 * Uses a balanced-brace counter since the config is a JSON object.
 */
function extractRunConfig(js: string): Record<string, unknown> {
  const marker = 'CookieConsent.run(';
  const start = js.indexOf(marker);
  if (start === -1) throw new Error('CookieConsent.run( not found');
  const jsonStart = start + marker.length;
  let depth = 0;
  let jsonEnd = -1;
  for (let i = jsonStart; i < js.length; i++) {
    if (js[i] === '{') depth++;
    else if (js[i] === '}') {
      depth--;
      if (depth === 0) { jsonEnd = i + 1; break; }
    }
  }
  if (jsonEnd === -1) throw new Error('Unbalanced braces in CookieConsent.run()');
  return JSON.parse(js.slice(jsonStart, jsonEnd));
}

describe('buildStandaloneSnippetJs', () => {
  it('returns a JS IIFE containing CookieConsent.run', () => {
    const config = makeConfig({
      cookieConsentEnabled: true,
      cookieConsentCategories: ['necessary', 'analytics'],
      cookieConsentPolicyUrl: 'https://example.com/privacy',
    });
    const js = buildStandaloneSnippetJs(config);

    expect(js).toMatch(/^\(function\(\)\{/);
    expect(js).toMatch(/\}\)\(\);$/);
    expect(js).toContain('CookieConsent.run(');
    expect(js).toContain('cookieconsent.css');
    expect(js).toContain('cookieconsent.umd.js');
    expect(js).toContain('"analytics"');
  });

  it('always includes necessary category as enabled + readOnly even if not in config categories', () => {
    const config = makeConfig({
      cookieConsentEnabled: true,
      cookieConsentCategories: ['analytics', 'marketing'],
    });
    const js = buildStandaloneSnippetJs(config);

    const runConfig = extractRunConfig(js) as { categories: Record<string, unknown> };

    // necessary must always be present with enabled: true, readOnly: true
    expect(runConfig.categories.necessary).toEqual({ enabled: true, readOnly: true });
    // Other categories should also be present
    expect(runConfig.categories.analytics).toBeDefined();
    expect(runConfig.categories.marketing).toBeDefined();
  });

  it('does not duplicate necessary when it is explicitly included in config categories', () => {
    const config = makeConfig({
      cookieConsentEnabled: true,
      cookieConsentCategories: ['necessary', 'analytics'],
    });
    const js = buildStandaloneSnippetJs(config);

    const runConfig = extractRunConfig(js) as { categories: Record<string, unknown> };

    // necessary must still be enabled + readOnly
    expect(runConfig.categories.necessary).toEqual({ enabled: true, readOnly: true });
    // Should have exactly 2 categories
    expect(Object.keys(runConfig.categories)).toHaveLength(2);
    expect(runConfig.categories.analytics).toBeDefined();
  });
});

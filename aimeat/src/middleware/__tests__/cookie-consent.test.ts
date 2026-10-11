/**
 * @file src/middleware/__tests__/cookie-consent.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Vitest unit tests for the cookie-consent middleware — verifies the consent banner
 *   snippet is injected into HTML responses before </body>, skipped for non-HTML/non-string bodies,
 *   and that categories/policy URL are reflected in the emitted CookieConsent.run() config.
 *
 * @structure
 *   - makeConfig / createMocks: helpers building a full AimeatConfig and mock Express req/res/next
 *   - cookieConsentMiddleware suite: injection, content-type gating, category + policy-url rendering, edge cases
 *   - buildStandaloneSnippetJs suite + extractRunConfig: asserts IIFE shape and always-on "necessary" category
 *
 * @version-history
 *   v1.1.0 — 2026-10-11 — The switch read per request, a page that already has the banner, the
 *     category list typed as text (one category per letter before the fix), the three languages, the
 *     named analytics services, cookies removed on a taken-back consent, and the start script.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import type { AimeatConfig } from '../../config.js';
import {
  cookieConsentMiddleware, buildStandaloneSnippetJs, consentCategories, buildCookieConsentRunConfig, cookieConsentSnippet,
} from '../cookie-consent.js';

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
  /** Send one HTML page through the middleware and answer what reached the client. */
  function sendHtml(middleware: ReturnType<typeof cookieConsentMiddleware>, html: string): string {
    const headers = new Map<string, string | number | readonly string[]>();
    let captured: unknown;
    const res = {
      getHeader: (name: string) => headers.get(name.toLowerCase()),
      send: vi.fn(function (this: Response, body?: unknown) { captured = body; return this; }),
    } as unknown as Response;
    middleware({} as Request, res, vi.fn() as unknown as NextFunction);
    headers.set('content-type', 'text/html; charset=utf-8');
    res.send(html);
    return captured as string;
  }

  it('leaves the page alone while the banner is off', () => {
    const config = makeConfig({ cookieConsentEnabled: false });
    const middleware = cookieConsentMiddleware(config);
    const { req, res, next } = createMocks();
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    const html = '<html><body><p>Hello</p></body></html>';
    expect(sendHtml(middleware, html)).toBe(html);
  });

  it('follows the switch on a running node: on in Config adds the banner, off removes it, with no restart', () => {
    // The middleware is built once at start. It used to read the switch then, so the banner an
    // operator switched on reached the apps and not the service's own pages until a restart.
    const config = makeConfig({ cookieConsentEnabled: false });
    const middleware = cookieConsentMiddleware(config);
    const html = '<html><body><p>Hello</p></body></html>';
    expect(sendHtml(middleware, html)).not.toContain('cookieconsent.umd.js');
    config.cookieConsentEnabled = true;
    expect(sendHtml(middleware, html)).toContain('cookieconsent.umd.js');
    config.cookieConsentCategories = ['necessary', 'analytics'];
    expect(sendHtml(middleware, html)).toContain('"analytics"');
    config.cookieConsentEnabled = false;
    expect(sendHtml(middleware, html)).toBe(html);
  });

  it('leaves a page that already carries the banner with one banner', () => {
    const middleware = cookieConsentMiddleware(makeConfig({ cookieConsentEnabled: true }));
    const html = '<html><head><script src="https://node.example/cookieconsent.umd.js"></script></head><body></body></html>';
    expect(sendHtml(middleware, html)).toBe(html);
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
    expect(result).toContain('Privacy policy');
    expect(result).toContain('Tietosuojaseloste');
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
    expect(result).not.toContain('Privacy policy');
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
 * Extract the JSON config object the start script holds (`var c={...};`) from a JS string.
 * Uses a balanced-brace counter since the config is a JSON object.
 */
function extractRunConfig(js: string): Record<string, unknown> {
  const marker = 'var c=';
  const start = js.indexOf(marker);
  if (start === -1) throw new Error('the run config (var c=) was not found');
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

describe('consentCategories', () => {
  it('reads the list the environment gives and the text an operator typed in Config', () => {
    expect(consentCategories({ cookieConsentCategories: ['necessary', 'analytics'] })).toEqual(['necessary', 'analytics']);
    // The Config page stored the typed text. Iterating it gave one category per letter.
    expect(consentCategories({ cookieConsentCategories: 'necessary, Analytics ,marketing' })).toEqual(['necessary', 'analytics', 'marketing']);
    expect(consentCategories({ cookieConsentCategories: ['analytics,marketing'] })).toEqual(['necessary', 'analytics', 'marketing']);
  });

  it('answers necessary alone for nothing, and drops what is not a word', () => {
    expect(consentCategories({})).toEqual(['necessary']);
    expect(consentCategories({ cookieConsentCategories: null })).toEqual(['necessary']);
    expect(consentCategories({ cookieConsentCategories: ['<script>', '', 'analytics', 'analytics', '__proto__'] })).toEqual(['necessary', 'analytics']);
  });

  it('a list typed as text gives whole categories in the banner, never letters', () => {
    const config = makeConfig({ cookieConsentEnabled: true, cookieConsentCategories: 'necessary,analytics,marketing' as unknown as string[] });
    const run = JSON.parse(buildCookieConsentRunConfig(config)) as { categories: Record<string, unknown> };
    expect(Object.keys(run.categories)).toEqual(['necessary', 'analytics', 'marketing']);
  });
});

describe('buildCookieConsentRunConfig', () => {
  type Run = {
    categories: Record<string, { autoClear?: { cookies: Array<{ name: string }>; reloadPage: boolean } }>;
    language: { translations: Record<string, { consentModal: Record<string, string>; preferencesModal: { sections: Array<{ title: string; description?: string; linkedCategory?: string }> } }> };
  };
  const config = makeConfig({ cookieConsentEnabled: true });

  it('carries the banner in English, Finnish and Spanish', () => {
    const run = JSON.parse(buildCookieConsentRunConfig(config)) as Run;
    expect(Object.keys(run.language.translations)).toEqual(['en', 'fi', 'es']);
    expect(run.language.translations.fi!.consentModal.title).toBe('Evästeet tällä sivulla');
    expect(run.language.translations.es!.consentModal.acceptNecessaryBtn).toBe('Solo las necesarias');
    expect(run.language.translations.en!.consentModal.description).toMatch(/asks before it uses any other/);
  });

  it('names the page owner\'s analytics, says that Clarity records the visit, and where the data goes', () => {
    const run = JSON.parse(buildCookieConsentRunConfig(config, { ensure: ['analytics'], services: { clarity: true, ga4: true } })) as Run;
    const en = run.language.translations.en!;
    expect(en.consentModal.description).toContain('Microsoft Clarity and Google Analytics');
    const analytics = en.preferencesModal.sections.find((s) => s.linkedCategory === 'analytics')!;
    expect(analytics.description).toContain('records how you use the page');
    expect(analytics.description).toContain('The data goes to Microsoft and Google.');
    const fi = run.language.translations.fi!.preferencesModal.sections.find((s) => s.linkedCategory === 'analytics')!;
    expect(fi.description).toContain('Tiedot menevät Microsoftille ja Googlelle.');
    // Google Analytics alone: nothing is said about a recording.
    const ga = JSON.parse(buildCookieConsentRunConfig(config, { ensure: ['analytics'], services: { clarity: false, ga4: true } })) as Run;
    const gaText = ga.language.translations.en!.preferencesModal.sections.find((s) => s.linkedCategory === 'analytics')!.description!;
    expect(gaText).toContain('Google Analytics');
    expect(gaText).not.toMatch(/Clarity|records/);
  });

  it('asks about analytics for a page that needs it even when the operator\'s list has only necessary', () => {
    const run = JSON.parse(buildCookieConsentRunConfig(config, { ensure: ['analytics'] })) as Run;
    expect(Object.keys(run.categories)).toEqual(['necessary', 'analytics']);
  });

  it('removes the analytics cookies and reloads when the visitor takes consent back', () => {
    const run = JSON.parse(buildCookieConsentRunConfig(config, { ensure: ['analytics'], clearOnRevoke: ['_clck', '_ga'] })) as Run;
    expect(run.categories.analytics!.autoClear).toEqual({ cookies: [{ name: '_clck' }, { name: '_ga' }], reloadPage: true });
  });

  it('cannot close the script element it sits in, whatever the policy address holds', () => {
    const json = buildCookieConsentRunConfig(makeConfig({ cookieConsentEnabled: true, cookieConsentPolicyUrl: 'https://example.com/"></script><script>alert(1)</script>' }));
    expect(json).not.toContain('<');
    const footer = (JSON.parse(json) as Run).language.translations.en!.consentModal.footer!;
    expect(footer).toContain('&lt;/script&gt;');
    expect(footer.match(/<a /g)).toHaveLength(1);
  });

  it('does not make a link of a policy value that is not a web address', () => {
    const run = JSON.parse(buildCookieConsentRunConfig(makeConfig({ cookieConsentEnabled: true, cookieConsentPolicyUrl: 'javascript:alert(1)' }))) as Run;
    expect(run.language.translations.en!.consentModal.footer).toBeUndefined();
  });
});

describe('cookieConsentSnippet', () => {
  it('starts the banner only when the page has a body, in the visitor\'s language', () => {
    const snippet = cookieConsentSnippet(makeConfig({ cookieConsentEnabled: true }), { assetBase: 'https://node.example/' });
    expect(snippet).toContain('<link rel="stylesheet" href="https://node.example/cookieconsent.css">');
    expect(snippet).toContain('<script src="https://node.example/cookieconsent.umd.js"></script>');
    expect(snippet).toContain('<script data-aimeat-cookie-banner>');
    // The library appends itself to document.body: started without one it throws.
    expect(snippet).toContain('if(!document.body){setTimeout(run,30);return;}');
    // Each category is opened when the choices dialog is built: closed, it read as an empty list.
    expect(snippet).toContain("window.addEventListener('cc:onModalReady'");
    expect(snippet).toContain("s[i].classList.add('is-expanded')");
    // The visitor's own choice and browser come before the page's lang attribute, which the serve
    // pass writes on an app and the service's own page fixes at "en".
    const order = ["localStorage.getItem('aimeat-lang')", 'a.push(navigator.language)', 'a.push(d.documentElement.lang)'].map((s) => snippet.indexOf(s));
    expect(order.every((n) => n > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(snippet.match(/<\/script>/g)).toHaveLength(2);
  });

  it('carries the page\'s CSP nonce on both scripts, and no nonce of a wrong shape', () => {
    // The service's own pages allow an inline script only with the nonce: without it the browser
    // blocked the start script and the banner never showed there.
    const withNonce = cookieConsentSnippet(makeConfig({ cookieConsentEnabled: true }), { nonce: '5307c0b73180473689d7b7e3a842d83e' });
    expect(withNonce).toContain('<script data-aimeat-cookie-banner nonce="5307c0b73180473689d7b7e3a842d83e">');
    expect(withNonce).toContain('<script src="/cookieconsent.umd.js" nonce="5307c0b73180473689d7b7e3a842d83e"></script>');
    expect(cookieConsentSnippet(makeConfig({ cookieConsentEnabled: true }), { nonce: '"><script>x' })).not.toContain('nonce=');
  });
});

describe('cookieConsentMiddleware and the page nonce', () => {
  it('gives the start script the nonce of the response it is added to', () => {
    const middleware = cookieConsentMiddleware(makeConfig({ cookieConsentEnabled: true }));
    const headers = new Map<string, string>();
    let captured = '';
    const res = {
      locals: { cspNonce: 'abcdef0123456789abcdef0123456789' },
      getHeader: (name: string) => headers.get(name.toLowerCase()),
      send: vi.fn(function (this: Response, body?: unknown) { captured = String(body); return this; }),
    } as unknown as Response;
    middleware({} as Request, res, vi.fn() as unknown as NextFunction);
    headers.set('content-type', 'text/html; charset=utf-8');
    res.send('<html><body><p>Hello</p></body></html>');
    expect(captured).toContain('<script data-aimeat-cookie-banner nonce="abcdef0123456789abcdef0123456789">');
  });
});

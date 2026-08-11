/**
 * @file test/unit/app-artifact-lint.test.ts
 * @description Unit tests for the publish-time artifact check (src/services/app-artifact-lint.ts).
 *
 *   THE APP THESE ARE WRITTEN FROM went live on aimeat.io on 2026-08-11 with three defects at once:
 *   it loaded /lib/aimeat-auth.js (404 — the path is /v1/libs/), it hardcoded its colours past the
 *   platform theme tokens, and it read agent-written data with no ownerScope so the owner saw an
 *   empty screen. Each is a case below, and each is asserted BY PITFALL ID rather than by wording,
 *   because the id is what an agent acts on.
 *
 *   THE OTHER HALF OF THE JOB IS SILENCE. A check that flags a correct app teaches people to ignore
 *   it, and the blocking half would then be worked around rather than fixed — so the clean-app case
 *   asserts zero findings of ANY severity, and each warning has its own "and not this one" case.
 *
 *   The asset probe is off in these tests (`appAssetProbe: false`): making a real loopback request
 *   belongs in the E2E suite, where there is a node listening. What is tested here is everything
 *   the check can decide from the bytes alone, plus the classification the probe depends on.
 * @usage cd aimeat && pnpm test -- app-artifact-lint
 * @version-history v1.0.0 — 2026-08-11 — initial.
 */
import { describe, it, expect } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import { lintAppArtifact } from '../../src/services/app-artifact-lint.js';

/** Only the fields the check reads. Cast rather than built: the rest of the config is irrelevant. */
const config = {
  baseUrl: 'https://aimeat.io',
  port: 40050,
  appAssetProbe: false,
} as unknown as AimeatConfig;

/** An app that does everything the build spec asks. The silence case. */
const CLEAN = `<!DOCTYPE html><html lang="en"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="aimeat-app" content="clean.html">
  <meta name="aimeat-scopes" content="memory:read memory:write">
  <meta name="aimeat-locales" content="en fi">
  <link rel="stylesheet" href="https://aimeat.io/lib/aimeat-theme.css">
  <style>.card{background:var(--color-base-200)}</style>
  </head><body>
  <script src="https://aimeat.io/v1/libs/aimeat-auth.js"></script>
  <script>
    AIMEAT.auth.mountLoginButton('#login', { onLogin: start });
    async function start() {
      const { items } = await AIMEAT.data.list({ prefix: 'clean.', ownerScope: true, meta: true });
      await AIMEAT.data.set('clean.seen', items.length);
    }
  </script></body></html>`;

const findings = async (html: string) => {
  const r = await lintAppArtifact(html, config);
  return { ids: [...r.blocking, ...r.warnings].map(f => f.pitfall), ...r };
};

describe('lintAppArtifact — silence on a correct app', () => {
  it('finds nothing at all in an app that follows the spec', async () => {
    const { blocking, warnings } = await lintAppArtifact(CLEAN, config);
    expect({ blocking, warnings }).toEqual({ blocking: [], warnings: [] });
  });
});

describe('lintAppArtifact — inline JavaScript that does not parse', () => {
  it('BLOCKS an app whose inline script has a syntax error', async () => {
    const html = CLEAN.replace('const { items }', 'const { items = =');
    const { blocking } = await lintAppArtifact(html, config);
    expect(blocking.map(f => f.pitfall)).toContain('inline-js-does-not-parse');
    expect(blocking[0]?.severity).toBe('critical');
    // The message has to say which block, or a 900-line app gives the reader nothing to open.
    expect(blocking[0]?.message).toMatch(/<script> #\d/);
    expect(blocking[0]?.url).toBe('/v1/appdev/pitfalls/inline-js-does-not-parse');
  });

  it('does NOT parse a JSON-LD or template block as JavaScript', async () => {
    const html = CLEAN.replace('</head>',
      '<script type="application/ld+json">{"@context":"x"}</script>'
      + '<script type="text/template"><div>{{ not js }}</div></script></head>');
    const { blocking } = await lintAppArtifact(html, config);
    expect(blocking).toEqual([]);
  });

  it('reads a block as ending at the first closing tag, exactly as a browser does', async () => {
    // The classic trap: a literal closing tag inside a string truncates the block mid-statement,
    // in the browser AND here. The remaining `"` opens a string that never closes.
    const html = CLEAN.replace('async function start()',
      'var trap = "</script>"; async function start()');
    const { blocking } = await lintAppArtifact(html, config);
    expect(blocking.map(f => f.pitfall)).toContain('inline-js-does-not-parse');
  });
});

describe('lintAppArtifact — asset URLs', () => {
  it('warns about an external host, and never fetches it', async () => {
    const html = CLEAN.replace('</head>', '<script src="https://cdn.jsdelivr.net/npm/x@1"></script></head>');
    const { ids } = await findings(html);
    expect(ids).toContain('cdn-libs-blocked');
  });

  it('warns about a relative path — a published app has no siblings', async () => {
    const html = CLEAN.replace('</head>', '<script src="./helpers.js"></script></head>');
    const { ids } = await findings(html);
    expect(ids).toContain('invented-lib-urls');
  });

  it('says nothing about node-relative paths when the probe is off', async () => {
    // Off means "no evidence", and no evidence must never read as a finding.
    const html = CLEAN.replace('</head>', '<script src="/lib/aimeat-auth.js"></script></head>');
    const { blocking, warnings } = await lintAppArtifact(html, config);
    expect({ blocking, warnings }).toEqual({ blocking: [], warnings: [] });
  });
});

describe('lintAppArtifact — hardcoded theme colours', () => {
  it('warns when the app paints its own light/dark past the platform tokens', async () => {
    const html = `<!DOCTYPE html><html><head>
      <meta name="aimeat-app" content="x.html"><meta name="aimeat-scopes" content="memory:read">
      <meta name="aimeat-locales" content="en">
      <style>
        :root{--bg:#ffffff;--fg:#111111;--card:#f5f5f5;--line:#e0e0e0;--accent:#2266cc}
        @media (prefers-color-scheme: dark){:root{--bg:#111111;--fg:#eeeeee}}
        body{background:#ffffff}
      </style></head><body><script>AIMEAT.data.set('k', 1);</script></body></html>`;
    const { ids } = await findings(html);
    expect(ids).toContain('hardcoded-theme-colors');
  });

  it('stays quiet when the app loads the platform theme', async () => {
    const { ids } = await findings(CLEAN);
    expect(ids).not.toContain('hardcoded-theme-colors');
  });
});

describe('lintAppArtifact — the head declarations', () => {
  it('names every missing meta in ONE finding', async () => {
    const html = CLEAN
      .replace('<meta name="aimeat-app" content="clean.html">', '')
      .replace('<meta name="aimeat-locales" content="en fi">', '');
    const { warnings } = await lintAppArtifact(html, config);
    const meta = warnings.filter(f => f.pitfall === 'app-meta-declarations');
    expect(meta).toHaveLength(1);
    expect(meta[0]?.message).toContain('aimeat-app');
    expect(meta[0]?.message).toContain('aimeat-locales');
    expect(meta[0]?.message).not.toContain('aimeat-scopes');
  });
});

describe('lintAppArtifact — reading data the agents wrote', () => {
  it('warns about a read-only app that names no namespace', async () => {
    const html = `<!DOCTYPE html><html><head>
      <meta name="aimeat-app" content="x.html"><meta name="aimeat-scopes" content="memory:read">
      <meta name="aimeat-locales" content="en">
      <link rel="stylesheet" href="/lib/aimeat-theme.css"></head><body><script>
      const { items } = await AIMEAT.data.list({ prefix: 'katsaus.' });
      const v = await AIMEAT.data.get(items[0].key);
      </script></body></html>`;
    const { ids } = await findings(html);
    expect(ids).toContain('namespace-rule');
  });

  it('stays quiet once a read says ownerScope', async () => {
    const { ids } = await findings(CLEAN);
    expect(ids).not.toContain('namespace-rule');
  });

  it('stays quiet for an app that writes its own data', async () => {
    const html = `<!DOCTYPE html><html><head>
      <meta name="aimeat-app" content="x.html"><meta name="aimeat-scopes" content="memory:read">
      <meta name="aimeat-locales" content="en">
      <link rel="stylesheet" href="/lib/aimeat-theme.css"></head><body><script>
      const notes = await AIMEAT.data.get('notes');
      await AIMEAT.data.set('notes', notes);
      </script></body></html>`;
    const { ids } = await findings(html);
    expect(ids).not.toContain('namespace-rule');
  });
});

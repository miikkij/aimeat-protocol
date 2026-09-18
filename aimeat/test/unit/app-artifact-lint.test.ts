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
 *   The asset probe is off in these tests (`appAssetProbe: false`) except in the one case that
 *   exists to watch where the probe goes: what is tested here is everything the check can decide
 *   from the bytes alone, plus the classification the probe depends on. That one case stands up a
 *   server on an ephemeral port and asserts the request arrived at it, because the claim being made
 *   is about a destination and nothing short of a listening socket proves it.
 * @usage cd aimeat && pnpm test -- app-artifact-lint
 * @version-history
 *   v1.6.0 — 2026-09-13 — The served-copy warning is replaced by the publish-time strip (the
 *     developer's decision): its two cases now assert the lint says nothing about serve marks, and
 *     failed against the warning before it was removed. The strip itself is proven in
 *     test/unit/app-serve-marks-strip.test.ts and test/unit/app-publish-served-copy.test.ts.
 *   v1.5.0 — 2026-09-13 — Five cases from appdev pitfall triage, each seen failing first: an
 *     aimeat-scopes word the node cannot grant is named (and a grantable list, spaced or
 *     comma-separated, stays quiet); an empty aimeat-scopes counts as none; a served copy made by
 *     the real applyServeMarks is told it is one, while an app that only names a mark from script is
 *     not; a skipped type="module" block says it was not parsed; the cdn-libs-blocked sentence no
 *     longer claims the app CSP allows this node only.
 *   v1.4.0 — 2026-09-06 — The probe's destination, asserted against a real listening server: an
 *     asset path of `/\host/x` reached `http://host/x` through `new URL(path, base)`, so an app's
 *     own bytes could aim the node's publish-time probe at a stranger (CodeQL alert 1612).
 *   v1.3.0 — 2026-09-05 — The register gate: an Atelier app with no `aimeat-register`, with the
 *     shell's REPLACE-ME placeholder, or with `custom:default` BLOCKS; a genre id or a named
 *     custom register is silent; a Classic app never hears about it. The ATELIER fixture names
 *     a register now, because without one it is the very app the gate refuses.
 *   v1.2.0 — 2026-08-27 — The track-mixing quartet (TARGET-074). The silence cases matter most
 *     here: a correct Atelier shell app and the suite's own CLEAN app must both stay quiet, or the
 *     first thing the new track teaches its builders is to ignore the gate.
 *   v1.1.0 — 2026-08-15 — The declared-but-unused trio. Two bugs of my own are recorded in these
 *     cases: the first version reused an existing pitfall id for a new defect (which broke three
 *     passing tests, correctly), and it detected the pill by an API name I guessed instead of the
 *     real `mountLoginButton` — so it flagged the suite's own CLEAN app.
 *   v1.0.0 — 2026-08-11 — initial.
 */
import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AimeatConfig } from '../../src/config.js';
import { lintAppArtifact } from '../../src/services/app-artifact-lint.js';
import { applyServeMarks } from '../../src/services/app-serve-marks.js';
import { moduleGoalAvailable } from '../../src/utils/inline-script-parse.js';

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
  const all = [...r.blocking, ...r.warnings];
  return { ids: all.map(f => f.pitfall), messages: all.map(f => f.message), ...r };
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
    const { ids, messages } = await findings(html);
    expect(ids).toContain('cdn-libs-blocked');
    // app-csp.ts allows https: scripts today; the finding used to claim the opposite (2026-09-13).
    expect(messages.join(' ')).not.toContain('allows this node only');
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

  // The probe is the one place a published app's bytes decide where this node sends a request, so
  // this case runs it for real against a listening server rather than reasoning about the URL. The
  // src below resolved to `http://evil.example/probe.js` under `new URL(path, base)`: one leading
  // slash, then a backslash, which a special scheme reads as the second slash of an authority.
  it('probes an asset path that names another host on THIS node, and never that host', async () => {
    const seen: string[] = [];
    const server = createServer((req, res) => { seen.push(req.url ?? ''); res.statusCode = 404; res.end(); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const probing = { ...config, port, appAssetProbe: true } as unknown as AimeatConfig;
    try {
      const html = CLEAN.replace('</head>', '<script src="/\\evil.example/probe.js"></script></head>');
      const { blocking } = await lintAppArtifact(html, probing);
      expect(seen).toContain('//evil.example/probe.js');
      expect(blocking.map(f => f.pitfall)).toContain('invented-lib-urls');
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
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

  // 2026-09-13, appdev pitfall declare-aimeat-scopes-or-get-the-silent-four. One word outside the
  // grantable vocabulary makes the silent bridge answer invalid_scope and the visible authorize
  // answer 400 for the WHOLE list, so nobody signs in, and the publish said nothing about it.
  it('names every aimeat-scopes word this node cannot grant, and no word it can', async () => {
    const html = CLEAN.replace('content="memory:read memory:write"', 'content="memory:read storage:delete organism:admin"');
    const { warnings } = await lintAppArtifact(html, config);
    const scopes = warnings.filter(f => f.pitfall === 'app-meta-declarations' && f.message.includes('cannot grant'));
    expect(scopes).toHaveLength(1);
    expect(scopes[0]?.severity).toBe('warn');
    expect(scopes[0]?.message).toContain('storage:delete');
    expect(scopes[0]?.message).toContain('organism:admin');
    expect(scopes[0]?.message).not.toContain('memory:read');
    expect(scopes[0]?.message).toContain('/v1/app-grants/scopes');
  });

  it('stays quiet about words the node can grant, whitespace- or comma-separated', async () => {
    for (const content of ['memory:read memory:write ai:use', 'memory:read,memory:write']) {
      const html = CLEAN.replace('content="memory:read memory:write"', `content="${content}"`);
      const { warnings } = await lintAppArtifact(html, config);
      expect(warnings, content).toEqual([]);
    }
  });

  it('warns when aimeat-app still holds the shell\'s placeholder, and the shipped shells otherwise pass this check', async () => {
    // The shells carry the two head lines since 2026-09-19: every cold-agent build published
    // twice, the second time only to add them after this same warning.
    const html = CLEAN.replace('content="clean.html"', 'content="REPLACE-WITH-YOUR-FILENAME.html"');
    const meta = (await lintAppArtifact(html, config)).warnings.filter(f => f.pitfall === 'app-meta-declarations');
    expect(meta).toHaveLength(1);
    expect(meta[0]?.message).toContain('placeholder');

    const { getAppTemplates } = await import('../../src/data/app-templates.js');
    for (const id of ['shell-pure-client', 'shell-cortex', 'shell-extension']) {
      const shell = getAppTemplates().find(t => t.id === id)!;
      const filled = shell.content.replace('REPLACE-WITH-YOUR-FILENAME.html', 'my-app.html');
      const about = (await lintAppArtifact(filled, config)).warnings.filter(f => f.pitfall === 'app-meta-declarations');
      expect(about, id).toEqual([]);
    }
  });

  it('reads an empty aimeat-scopes as declaring nothing, because the SDK does', async () => {
    const html = CLEAN.replace('content="memory:read memory:write"', 'content=" "');
    const { warnings } = await lintAppArtifact(html, config);
    const meta = warnings.filter(f => f.pitfall === 'app-meta-declarations');
    expect(meta).toHaveLength(1);
    expect(meta[0]?.message).toContain('aimeat-scopes');
  });
});

describe('lintAppArtifact — a served copy published as source', () => {
  // 2026-09-13, appdev pitfall served-app-html-contains-injected-badge. The node adds its marks on
  // the way OUT and skips any mark already present, so a republished served copy kept a badge the
  // owner may have switched off and an AI-disclosure block for a version that no longer existed.
  // The developer decided the same day: the publish takes the marks out before it lints, hashes and
  // stores (services/app-serve-marks-strip.ts) and names them in the response. The lint therefore
  // has nothing to say about them; the served-copy WARNING it carried earlier that day is gone.
  it('says nothing about the serve marks, which the publish removes before this check runs', async () => {
    const served = applyServeMarks(CLEAN, { badge: true, reviewedBy: 'Jane Reviewer', isDocument: true }).toString('utf-8');
    const { blocking, ids } = await findings(served);
    expect(blocking).toEqual([]);
    expect(ids).not.toContain('edit-published-app');
  });

  it('stays quiet when the app only names a mark from its own script', async () => {
    const html = CLEAN.replace('async function start()',
      'var b = document.getElementById("aimeat-app-badge"); var r = document.querySelector(\'meta[name="aimeat-reviewed-by"]\'); async function start()');
    const { warnings } = await lintAppArtifact(html, config);
    expect(warnings).toEqual([]);
  });
});

describe('lintAppArtifact — module scripts the parser cannot read', () => {
  // 2026-09-13, curated pitfall inline-js-does-not-parse. No production start path passes
  // --experimental-vm-modules, so a `type="module"` block was skipped with no finding and a broken
  // one published as clean.
  it('says so when a module block is not parsed, and refuses a broken one when it can parse modules', async () => {
    const html = CLEAN.replace('</body>', '<script type="module">const = ;</script></body>');
    const { blocking, warnings } = await lintAppArtifact(html, config);
    if (moduleGoalAvailable()) {
      expect(blocking.map(f => f.pitfall)).toContain('inline-js-does-not-parse');
    } else {
      expect(blocking).toEqual([]);
      const skipped = warnings.filter(f => f.pitfall === 'inline-js-does-not-parse');
      expect(skipped).toHaveLength(1);
      expect(skipped[0]?.severity).toBe('warn');
      expect(skipped[0]?.message).toMatch(/<script> #\d/);
      expect(skipped[0]?.message).toContain('not parsed');
    }
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

  // ── Declared and never used (2026-08-15) ─────────────────────────────────────────────────────
  //
  // One run published an app carrying all three at once: aimeat-auth.js with no pill, a locales
  // meta with nothing to switch, and daisyUI with no daisyUI class. None of them was reported,
  // because none was checked — and the two findings that WERE returned got fixed on the spot,
  // which is the whole argument for checking these.

  it('flags an auth library that is loaded and never mounted', async () => {
    const html = `<!DOCTYPE html><html><head>
      <meta name="aimeat-app" content="x.html"><meta name="aimeat-scopes" content="memory:read">
      <link rel="stylesheet" href="/lib/aimeat-theme.css">
      <script src="/v1/libs/aimeat-auth.js"></script></head><body><h1>Archive</h1></body></html>`;
    const { ids, messages } = await findings(html);
    expect(ids).toContain('app-declared-unused');
    expect(messages.join(' ')).toContain('never mounts the login pill');
  });

  it('stays quiet when the pill is actually mounted', async () => {
    const html = `<!DOCTYPE html><html><head>
      <meta name="aimeat-app" content="x.html"><meta name="aimeat-scopes" content="memory:read">
      <meta name="aimeat-locales" content="en fi">
      <link rel="stylesheet" href="/lib/aimeat-theme.css">
      <script src="/v1/libs/aimeat-auth.js"></script></head><body>
      <script>AIMEAT.auth.mountLoginButton('#pill', { onLogin: start });</script></body></html>`;
    const { messages } = await findings(html);
    expect(messages.join(' ')).not.toContain('never mounts the login pill');
    expect(messages.join(' ')).not.toContain('no way to change language');
  });

  it('flags languages declared with nothing that switches them', async () => {
    const html = `<!DOCTYPE html><html><head>
      <meta name="aimeat-app" content="x.html"><meta name="aimeat-scopes" content="memory:read">
      <meta name="aimeat-locales" content="en fi">
      <link rel="stylesheet" href="/lib/aimeat-theme.css"></head><body><h1>Arkisto</h1></body></html>`;
    const { messages } = await findings(html);
    expect(messages.join(' ')).toContain('no way to change language');
  });

  it('flags daisyUI linked and never used, and stays quiet when it is used', async () => {
    const head = `<meta name="aimeat-app" content="x.html"><meta name="aimeat-scopes" content="memory:read">
      <meta name="aimeat-locales" content="en"><link rel="stylesheet" href="/lib/aimeat-theme.css">
      <link rel="stylesheet" href="/lib/daisyui@5.css">`;
    // Asserted on the MESSAGE, not the id: all three checks share one pitfall id, and this fixture
    // also declares locales without a switcher, so the id is present either way.
    const unused = await findings(`<!DOCTYPE html><html><head>${head}</head><body><div>plain</div></body></html>`);
    expect(unused.messages.join(' ')).toContain('uses none of its classes');

    const used = await findings(`<!DOCTYPE html><html><head>${head}</head><body><button class="btn btn-primary">Go</button></body></html>`);
    expect(used.messages.join(' ')).not.toContain('uses none of its classes');
  });

  it('says nothing about any of the three for the clean app', async () => {
    const { ids } = await findings(CLEAN);
    expect(ids).not.toContain('app-declared-unused');
  });
});

describe('lintAppArtifact — the two tracks never mix', () => {
  /** A correct Atelier shell app in miniature: track declared, kit loaded, body filled by the kit. */
  const ATELIER = `<!DOCTYPE html><html lang="en"><head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="aimeat-app" content="ate.html">
    <meta name="aimeat-scopes" content="memory:read memory:write">
    <meta name="aimeat-track" content="atelier">
    <meta name="aimeat-register" content="genre-nightfloor">
    <meta name="aimeat-locales" content="en fi">
    <link rel="stylesheet" href="/lib/aimeat-atelier.css">
    </head><body>
    <script src="/v1/libs/aimeat-auth.js"></script>
    <script src="/v1/libs/aimeat-atelier.js"></script>
    <script>
      const a = AIMEAT.atelier.app({ title: 'Ate' });
      AIMEAT.auth.mountLoginButton('#login', { onLogin: start });
      async function start() { await AIMEAT.data.set('ate.seen', 1); }
    </script></body></html>`;

  describe('the register: an Atelier app names the look it committed to', () => {
    const REGISTER_LINE = '<meta name="aimeat-register" content="genre-nightfloor">';
    const withRegister = (value: string) => ATELIER.replace(REGISTER_LINE, `<meta name="aimeat-register" content="${value}">`);

    it('BLOCKS an Atelier app with no register line at all', async () => {
      const r = await findings(ATELIER.replace(REGISTER_LINE, ''));
      expect(r.blocking.map(f => f.pitfall)).toContain('atelier-register');
      const msg = r.blocking.find(f => f.pitfall === 'atelier-register')!.message;
      expect(msg).toContain('/v1/designbook?kind=genre');
      expect(msg).toContain('custom:<name>');
    });

    it('BLOCKS the shell\'s REPLACE-ME placeholder — the bare shell is a frame, not a page', async () => {
      const r = await findings(withRegister('REPLACE-ME: fork a genre from the Design Book (GET /v1/designbook?kind=genre) or name your own register'));
      expect(r.blocking.map(f => f.pitfall)).toContain('atelier-register');
    });

    it('BLOCKS custom:default and an empty custom: — a custom register is a name', async () => {
      for (const v of ['custom:default', 'custom:', 'custom: ', '']) {
        const r = await findings(withRegister(v));
        expect(r.blocking.map(f => f.pitfall), `value "${v}"`).toContain('atelier-register');
      }
    });

    it('BLOCKS the kit loaded with no track declared and no register — dropping the track line is not a way past', async () => {
      const r = await findings(ATELIER.replace('<meta name="aimeat-track" content="atelier">', '').replace(REGISTER_LINE, ''));
      expect(r.blocking.map(f => f.pitfall)).toContain('atelier-register');
    });

    it('is silent on a genre id, a Design Book part id and a named custom register', async () => {
      for (const v of ['genre-nightfloor', 'genre-receipt', 'layout-cover', 'custom:game', 'custom:night-ledger']) {
        const r = await findings(withRegister(v));
        expect(r.blocking, `value "${v}"`).toEqual([]);
      }
    });

    it('never asks a Classic app for a register', async () => {
      const r = await findings(CLEAN);
      expect(r.ids).not.toContain('atelier-register');
      const classic = CLEAN.replace('<meta name="aimeat-scopes"', '<meta name="aimeat-track" content="classic">\n<meta name="aimeat-scopes"');
      expect((await findings(classic)).ids).not.toContain('atelier-register');
    });
  });

  it('stays quiet on a correct Atelier app and on the clean Classic app', async () => {
    const ate = await findings(ATELIER);
    expect(ate.ids).not.toContain('track-mixing');
    const classic = await findings(CLEAN);
    expect(classic.ids).not.toContain('track-mixing');
  });

  it('knows the Atelier shell mounts the pill itself', async () => {
    // The shell mounts the login pill inside atelier.app(), so neither mount verb appears in the
    // app's bytes. The first AEB bench run flagged all three correct Atelier builds on this.
    const html = ATELIER.replace("AIMEAT.auth.mountLoginButton('#login', { onLogin: start });", '');
    const { ids } = await findings(html);
    expect(ids).not.toContain('app-declared-unused');

    // The same, with the namespace held in an alias — the fourth bench build wrote it this way.
    const aliased = html.replace('const a = AIMEAT.atelier.app({ title: \'Ate\' });',
      'var K = AIMEAT.atelier; const a = K.app({ title: \'Ate\' });');
    const alias = await findings(aliased);
    expect(alias.ids).not.toContain('app-declared-unused');
  });

  it('flags the Atelier kit loaded in an app that declares Classic', async () => {
    const html = ATELIER.replace('content="atelier"', 'content="classic"');
    const { ids, messages } = await findings(html);
    expect(ids).toContain('track-mixing');
    expect(messages.join(' ')).toContain('declares the Classic track');
  });

  it('flags an Atelier declaration with no kit behind it', async () => {
    const html = ATELIER
      .replace('<link rel="stylesheet" href="/lib/aimeat-atelier.css">', '')
      .replace('<script src="/v1/libs/aimeat-atelier.js"></script>', '')
      .replace('AIMEAT.atelier.app({ title: \'Ate\' })', '({})');
    const { messages } = await findings(html);
    expect(messages.join(' ')).toContain('never loads the Atelier kit');
  });

  it('flags daisyUI class markup in an Atelier app with no section escape, and stays quiet inside one', async () => {
    const soup = ATELIER.replace('</body>', '<div class="card"><button class="btn btn-primary">Go</button></div></body>');
    const flagged = await findings(soup);
    expect(flagged.messages.join(' ')).toContain('section escape');

    const escaped = soup.replace('const a = AIMEAT.atelier.app',
      'const s = AIMEAT.atelier.section({ title: \'Raw\' }); const a = AIMEAT.atelier.app');
    const quiet = await findings(escaped);
    expect(quiet.messages.join(' ')).not.toContain('section escape');
  });

  it('flags the kit loaded with no track declared', async () => {
    const html = ATELIER.replace('<meta name="aimeat-track" content="atelier">', '');
    const { messages } = await findings(html);
    expect(messages.join(' ')).toContain('declares no build track');
  });
});

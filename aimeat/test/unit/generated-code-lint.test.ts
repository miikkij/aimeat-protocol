/**
 * @file test/unit/generated-code-lint.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two publish checks for the faults of generated code
 *   (src/services/app/generated-code-lint.ts): a key in the page refuses, and values written into
 *   HTML with nothing escaped warns when the page reads outside data. Each is shown firing on the
 *   shape it is for and silent on the pages that are right.
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-publish-lint-checks-for-the-faults-of-generated-code).
 */
import { describe, expect, it } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import { htmlSinkFindings, secretFindings } from '../../src/services/app/generated-code-lint.js';
import { lintAppArtifact } from '../../src/services/app/artifact-lint.js';

const page = (script: string, body = '') => `<!DOCTYPE html><html><head><meta name="aimeat-app" content="x.html"></head><body>${body}<script>${script}</script></body></html>`;

/**
 * Each fixture key is put together at run time from a prefix and a made-up body, so the source never
 * holds a whole key: GitHub's push protection refused this file when it did (2026-11-26).
 */
const k = (prefix: string, body: string) => prefix + body;

describe('a key in the page source', () => {
  const KEYS: Record<string, string> = {
    'an OpenAI project key': k('sk-proj-', '4fQ9xT2LmZ7bW1cV8nR3kJ6h'),
    'an Anthropic key': k('sk-ant-', 'api03-Zq8vB2nM4xK7pL1wR9tY6uE3'),
    'an AWS access key id': k('AKIA', 'Z3Q7XK2LM9PVB4TW'),
    'a GitHub token': k('ghp_', '7Hk2Lm9Pq4Rs8Tv1Wx3Yz6Ab5Cd0EfGhJkLm'),
    'a Slack bot token': k('xoxb-', '2847361-9F2kLmQpRs7Tv'),
    'a Stripe secret key': k('sk_' + 'live_', '51Hq2Lm9Pq4Rs8Tv1Wx3Yz6Ab'),
    'a Stripe restricted key': k('rk_' + 'test_', '51Hq2Lm9Pq4Rs8Tv1Wx3Yz6'),
  };

  for (const [what, key] of Object.entries(KEYS)) {
    it(`refuses ${what}`, () => {
      const out = secretFindings(page(`const KEY = "${key}";`));
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ pitfall: 'key-in-page-source', severity: 'critical', url: '/v1/appdev/pitfalls/key-in-page-source' });
      expect(out[0].message).toContain(key.slice(0, 8));
      expect(out[0].message).not.toContain(key);
    });
  }

  it('refuses a PEM private key in the markup, and names its line', () => {
    const out = secretFindings('<html>\n<body>\n<pre>-----BEGIN RSA PRIVATE KEY-----\nMIIE…</pre></body></html>');
    expect(out).toHaveLength(1);
    expect(out[0].message).toContain('line 3');
  });

  it('passes a placeholder, a publishable key and a page with none', () => {
    expect(secretFindings(page('const KEY = "sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxx";'))).toEqual([]);
    expect(secretFindings(page(`const KEY = "${k('sk_' + 'live_', 'XXXXXXXXXXXXXXXXXXXXXXXX')}";`))).toEqual([]);
    expect(secretFindings(page(`Stripe("${k('pk_' + 'live_', '51Hq2Lm9Pq4Rs8Tv1Wx3Yz6Ab')}");`))).toEqual([]);
    expect(secretFindings(page('const a = "task-list-for-the-weekend-sprint";'))).toEqual([]);
  });

  it('refuses the publish: the artifact lint puts it in blocking', async () => {
    const config = { baseUrl: 'https://aimeat.io', port: 40050, appAssetProbe: false } as unknown as AimeatConfig;
    const r = await lintAppArtifact(page(`const KEY = "${k('sk-proj-', '4fQ9xT2LmZ7bW1cV8nR3kJ6h')}";`), config);
    expect(r.blocking.map(f => f.pitfall)).toContain('key-in-page-source');
  });
});

describe('values written into HTML with nothing escaped', () => {
  it('warns on a template literal from stored data into innerHTML', () => {
    const out = htmlSinkFindings(page('AIMEAT.data.get("n").then(n => { list.innerHTML = `<li>${n.title}</li>`; });'));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ pitfall: 'html-built-from-values', severity: 'warn' });
    expect(out[0].message).toContain('innerHTML');
  });

  it('warns on concatenation, insertAdjacentHTML, += and document.write, each read from outside', () => {
    expect(htmlSinkFindings(page('const q = new URLSearchParams(location.search); el.innerHTML = "<b>" + q.get("name") + "</b>";'))).toHaveLength(1);
    expect(htmlSinkFindings(page('fetch("/v1/x").then(r => r.json()).then(d => el.insertAdjacentHTML("beforeend", d.html));'))).toHaveLength(1);
    expect(htmlSinkFindings(page('out.innerHTML += `<p>${input.value}</p>`;'))).toHaveLength(1);
    expect(htmlSinkFindings(page('fetch("/v1/x").then(r => r.json()).then(d => document.write(d.body));'))).toHaveLength(1);
  });

  it('counts a replace over < or & as the page escaping, and skips a constant table in capitals', () => {
    const own = 'function h(s){ return String(s).replace(/[&<>"]/g, c => "&#" + c.charCodeAt(0) + ";"); }';
    expect(htmlSinkFindings(page(`${own} AIMEAT.data.get("n").then(n => { list.innerHTML = "<li>" + h(n.title) + "</li>"; });`))).toEqual([]);
    expect(htmlSinkFindings(page('AIMEAT.data.get("n").then(() => { help.innerHTML = SECTIONS.map(s => "<h2>" + s + "</h2>").join(""); });'))).toEqual([]);
  });

  it('stays silent on a field a library drew (out.svg), and warns on a field that came from a fetch (d.html)', () => {
    expect(htmlSinkFindings(page('fetch("/v1/x").then(() => mermaid.render("g", src)).then(out => { box.innerHTML = out.svg; });'))).toEqual([]);
    expect(htmlSinkFindings(page('fetch("/v1/x").then(r => r.json()).then(d => { box.innerHTML = d.html; });'))).toHaveLength(1);
  });

  it('reads a template literal that spans lines', () => {
    const out = htmlSinkFindings(page('AIMEAT.data.get("n").then(n => {\n  card.innerHTML = `\n    <h2>${n.title}</h2>\n  `;\n});'));
    expect(out).toHaveLength(1);
  });

  it('stays silent when the page escapes, writes fixed text, only reads the sink, or reads nothing outside', () => {
    expect(htmlSinkFindings(page('AIMEAT.data.get("n").then(n => { list.innerHTML = `<li>${AIMEAT.escapeHtml(n.title)}</li>`; });'))).toEqual([]);
    expect(htmlSinkFindings(page('const esc = s => s; AIMEAT.data.get("n").then(n => { list.innerHTML = `<li>${esc(n.title)}</li>`; });'))).toEqual([]);
    expect(htmlSinkFindings(page('AIMEAT.data.get("n").then(n => { list.innerHTML = ""; list.textContent = n.title; });'))).toEqual([]);
    expect(htmlSinkFindings(page('AIMEAT.data.get("n").then(n => { list.innerHTML = "<li>Empty</li>"; });'))).toEqual([]);
    expect(htmlSinkFindings(page('AIMEAT.data.get("n").then(() => { const old = list.innerHTML; if (list.innerHTML === "") return; });'))).toEqual([]);
    expect(htmlSinkFindings(page('const n = 3 * 4; out.innerHTML = `<b>${n}</b>`;'))).toEqual([]);
  });

  it('reads only inline scripts, not a script loaded from an address', () => {
    const html = '<html><body><script src="/v1/libs/x.js">el.innerHTML = `${input.value}`</script></body></html>';
    expect(htmlSinkFindings(html)).toEqual([]);
  });
});

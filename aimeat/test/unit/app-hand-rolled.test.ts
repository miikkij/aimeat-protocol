/**
 * @file test/unit/app-hand-rolled.test.ts
 * @description A publish says so when an app does by hand what a library of this node already
 *   does. The lint has long named a library that is LOADED and never used; nothing named the
 *   opposite, which is the expensive one: a builder that does not know the library exists writes
 *   its own speech loop, its own socket or its own storage, and the app works until the platform
 *   moves under it. The quiet cases are most of this file, because a warning on a correct app
 *   teaches people to stop reading hints.
 * @usage cd aimeat && pnpm vitest run test/unit/app-hand-rolled.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { handRolledFindings } from '../../src/services/app-hand-rolled.js';

const page = (libs: string[], script: string) => `<!DOCTYPE html><html><head></head><body>
${libs.map(l => `<script src="/v1/libs/${l}.js"></` + 'script>').join('\n')}
<script>${script}</` + 'script></body></html>';
const names = (html: string) => handRolledFindings(html).flatMap(f => (f.message.match(/`aimeat-[a-z]+`/g) ?? []));

describe('done by hand where the node has a library', () => {
  it('browser speech, with no voice library loaded', () => {
    const f = handRolledFindings(page(['aimeat-auth'], 'var r = new webkitSpeechRecognition(); speechSynthesis.speak(u);'));
    expect(f.map(x => x.pitfall)).toEqual(['hand-rolled']);
    expect(f[0].severity).toBe('warn');
    expect(f[0].message).toContain('`aimeat-voice`');
  });
  it('a recorder of its own', () => expect(names(page([], 'new MediaRecorder(stream)'))).toContain('`aimeat-voice`'));
  it('an audio graph of its own', () => expect(names(page([], 'var ctx = new AudioContext();'))).toContain('`aimeat-audio`'));
  it('memory over raw HTTP', () => expect(names(page(['aimeat-auth'], 'fetch("/v1/memory", { method: "POST" })'))).toContain('`aimeat-data`'));
  it('an AI call over raw HTTP', () => expect(names(page(['aimeat-auth'], 'fetch(base + "/v1/ai/complete", o)'))).toContain('`aimeat-ai`'));
  it('a live stream of its own', () => expect(names(page([], 'new EventSource("/v1/live?domains=x")'))).toContain('`aimeat-live`'));
  it('a language switch of its own', () => expect(handRolledFindings(page(['aimeat-auth'], 'btn.onclick = function () { AIMEAT.auth.setLang("fi"); }'))[0].message).toMatch(/sign-in bar/));
  it('several at once are ONE hint that lists them', () => {
    const f = handRolledFindings(page([], 'new AudioContext(); new MediaRecorder(s); fetch("/v1/memory")'));
    expect(f).toHaveLength(1);
    expect(names(page([], 'new AudioContext(); new MediaRecorder(s); fetch("/v1/memory")')).length).toBeGreaterThanOrEqual(3);
  });
});

describe('a chart drawn in code on a page that loads the kit', () => {
  const kitPage = (register: string, script: string) => `<!DOCTYPE html><html><head><meta name="aimeat-register" content="${register}" /></head><body>
<script src="/v1/libs/aimeat-atelier.js"></` + `script><script>${script}</` + 'script></body></html>';
  const SVG_BARS = 'var r = document.createElementNS("http://www.w3.org/2000/svg", "rect"); r.setAttribute("height", v); svg.appendChild(r);';

  it('is named with the kit\'s chart, on a look of its own', () => {
    const f = handRolledFindings(kitPage('custom:ledger', SVG_BARS));
    expect(f).toHaveLength(1);
    expect(f[0].message).toMatch(/AIMEAT\.atelier\.chart/);
  });
  it('a canvas chart counts too', () => {
    expect(handRolledFindings(kitPage('custom:ledger', 'var ctx = c.getContext("2d"); ctx.fillRect(x, y, w, h);'))[0].message).toMatch(/chart/);
  });
  it('is quiet when the page calls the kit\'s chart or gauge as well', () => {
    expect(handRolledFindings(kitPage('custom:ledger', SVG_BARS + ' a.chart(host, { kind: "bar" });'))).toEqual([]);
  });
  it('is quiet in a genre that draws in SVG itself: keeping the genre\'s drawing is the point of a fork', () => {
    expect(handRolledFindings(kitPage('genre-blueprint', SVG_BARS))).toEqual([]);
  });
  it('is quiet for bars made of plain elements, which is how the almanac genre draws its own', () => {
    expect(handRolledFindings(kitPage('genre-almanac', 'var i = document.createElement("i"); i.style.height = pct + "%"; bars.appendChild(i);'))).toEqual([]);
  });
  it('is quiet on a page without the kit: a Classic app has its own chart libraries', () => {
    expect(handRolledFindings(page([], SVG_BARS))).toEqual([]);
  });
});

describe('what stays quiet', () => {
  it('the same code with the library loaded: the library may need it, and so may the app', () => {
    expect(handRolledFindings(page(['aimeat-voice'], 'new webkitSpeechRecognition(); new MediaRecorder(s); new AudioContext();'))).toEqual([]);
    expect(handRolledFindings(page(['aimeat-audio'], 'new AudioContext()'))).toEqual([]);
    expect(handRolledFindings(page(['aimeat-data'], 'fetch("/v1/memory?prefix=x")'))).toEqual([]);
  });
  it('a game engine brings its own audio', () => expect(handRolledFindings(page(['aimeat-phaser'], 'new AudioContext()'))).toEqual([]));
  it('a draft kept in the browser: one or two keys is a preference, not a store', () => {
    expect(handRolledFindings(page(['aimeat-auth'], 'localStorage.setItem("a.draft", v); localStorage.getItem("a.draft");'))).toEqual([]);
  });
  it('the word in a comment or in the words the app shows', () => {
    expect(handRolledFindings(page([], '// we do not use AudioContext here\nvar label = "Uses SpeechRecognition? No.";'))).toEqual([]);
  });
  it('the kit brought into step with the platform language at start, which a live app does', () => {
    expect(handRolledFindings(page(['aimeat-auth', 'aimeat-atelier'], 'A.i18n.setLang(AIMEAT.auth.getLang());'))).toEqual([]);
  });
  it('a page with no script at all', () => expect(handRolledFindings('<html><body>hello</body></html>')).toEqual([]));
});

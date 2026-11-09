/**
 * @file scripts/perf/browser-measure.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A Playwright MCP snippet (browser_run_code_unsafe with `filename`) that loads the Home,
 *   the Memory page and the Data Wallet in the signed-in browser, one after another, and returns per
 *   page: first paint, largest paint, when the last loading line went away, when the page stopped
 *   changing, long tasks on the main thread, every request with its start, end and size, and a
 *   timeline of how many loading lines were on screen. The browser must already be signed in on the
 *   sandbox; the origin is read from the current page.
 *
 *   A "loading line" is any element a view draws while its data is on its way: the .spinner, the
 *   LoadingLine/Note kind="loading" mark, the figure strip's placeholder and aria-busy. "Settled" is
 *   the first moment after which the page's text did not change for 2 s.
 * @usage browser_run_code_unsafe { filename: "<absolute path to this file>" }
 * @version-history
 *   v1.0.0 — 2026-11-09 — Initial, for the performance measurement at real account size.
 */
async (page) => {
  const origin = new URL(page.url()).origin;
  const pages = [['home', '/v1/home'], ['memory', '/v1/profile?tab=memory'], ['dataWallet', '/v1/profile?tab=dataWallet']];
  const out = {};
  await page.addInitScript(() => {
    const w = window;
    w.__perf = { longtasks: [], lcp: 0, samples: [], live: [] };
    // Every live update the page acts on (lib/live-updates.js dispatches aimeat-live-update), so a
    // second wave of requests can be tied to the event that caused it.
    w.addEventListener('aimeat-live-update', (e) => {
      w.__perf.live.push([Math.round(performance.now()), JSON.stringify(e.detail ?? null).slice(0, 160)]);
    });
    // The SPA has no build step and loads a few hundred module files: the default buffer of 250
    // entries is full before the first API call.
    performance.setResourceTimingBufferSize(5000);
    try {
      new PerformanceObserver(l => { for (const e of l.getEntries()) w.__perf.longtasks.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true });
      new PerformanceObserver(l => { for (const e of l.getEntries()) w.__perf.lcp = Math.round(e.startTime); }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch { /* not supported */ }
    const SEL = '.spinner, [class*="loading"], [aria-busy="true"], [class*="skeleton"]';
    const t0 = performance.now();
    const tick = () => {
      const loaders = document.querySelectorAll(SEL).length;
      const text = document.body ? document.body.innerText.length : 0;
      const nodes = document.getElementsByTagName('*').length;
      w.__perf.samples.push([Math.round(performance.now()), loaders, text, nodes]);
      if (performance.now() - t0 < 30000) setTimeout(tick, 100);
    };
    setTimeout(tick, 0);
  });
  for (const [name, path] of pages) {
    const started = Date.now();
    await page.goto(origin + path, { waitUntil: 'load' });
    // Wait until no loading line is left and the text has not changed for 2 s, at most 30 s. A page
    // that shows only a spinner has stable text, so stable text alone is not "loaded".
    let last = '', stableSince = Date.now();
    while (Date.now() - started < 30000) {
      const now = await page.evaluate(() => `${document.querySelectorAll('.spinner, [class*="loading"], [aria-busy="true"]').length}:${document.body.innerText.length}`);
      if (now !== last) { last = now; stableSince = Date.now(); }
      // At least 6 s: the Home's lower blocks draw no loading line and start after the frame.
      if (now.startsWith('0:') && Date.now() - stableSince > 2000 && Date.now() - started > 6000) break;
      await page.waitForTimeout(200);
    }
    out[name] = await page.evaluate(() => {
      const p = window.__perf;
      const paint = Object.fromEntries(performance.getEntriesByType('paint').map(e => [e.name, Math.round(e.startTime)]));
      const nav = performance.getEntriesByType('navigation')[0];
      const res = performance.getEntriesByType('resource').map(r => ({
        url: r.name.replace(location.origin, ''), type: r.initiatorType,
        start: Math.round(r.startTime), end: Math.round(r.responseEnd), kb: +(r.transferSize / 1024).toFixed(1), decodedKb: +(r.decodedBodySize / 1024).toFixed(1),
      }));
      const s = p.samples;
      const lastLoader = s.filter(x => x[1] > 0).pop();
      let settled = 0; for (let i = s.length - 1; i > 0; i--) { if (s[i][2] !== s[i - 1][2]) { settled = s[i][0]; break; } }
      const api = res.filter(r => r.url.startsWith('/v1/') || r.url.startsWith('/changelog') || r.url === '/');
      const timeline = []; let prev = -1;
      for (const x of s) if (x[1] !== prev) { timeline.push([x[0], x[1]]); prev = x[1]; }
      return {
        fcp: paint['first-contentful-paint'] ?? null, lcp: p.lcp, domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
        lastLoadingLineGoneAt: lastLoader ? lastLoader[0] + 100 : 0, settledAt: settled, domNodes: s.length ? s[s.length - 1][3] : 0,
        longTasks: { count: p.longtasks.length, totalMs: p.longtasks.reduce((a, b) => a + b[1], 0), longest: Math.max(0, ...p.longtasks.map(x => x[1])) },
        requests: {
          total: res.length, api: api.length, modules: res.filter(r => /\.(m?js|css)(\?|$)/.test(r.url) && !r.url.startsWith('/v1/')).length,
          kb: +res.reduce((a, r) => a + r.kb, 0).toFixed(0), lastModuleEnd: Math.max(0, ...res.filter(r => /\.m?js(\?|$)/.test(r.url)).map(r => r.end)),
          firstApiStart: Math.min(...api.map(r => r.start)), lastApiEnd: Math.max(0, ...api.map(r => r.end)),
        },
        loadingTimeline: timeline.slice(0, 40),
        liveUpdates: p.live.slice(0, 20),
        apiRequests: api.filter(r => !/\/v1\/(events|libs|auth\/refresh|themes)/.test(r.url))
          .sort((a, b) => a.start - b.start).map(r => `${r.start}-${r.end} ${r.decodedKb}kB ${r.url.slice(0, 60)}`),
      };
    });
  }
  return out;
}

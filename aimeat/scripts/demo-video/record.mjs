/**
 * @file scripts/demo-video/record.mjs
 * @description Playwright-driven screen recorder for AIMEAT demo videos. Reads a
 *   declarative scene manifest (JSON) and drives a real browser against the running
 *   dev server (or any base URL), recording a vertical (9:16) webm. Injects a visible
 *   cursor, click ripples and synced on-screen captions so the raw recording is already
 *   presentable; compose.mjs then transcodes to mp4 and adds music/title cards.
 * @usage node scripts/demo-video/record.mjs scripts/demo-video/scenes.<name>.json
 * @structure loadManifest -> launch context(recordVideo) -> per-scene step runner
 *   (goto/click/type/scroll/caption/wait/hover) -> save webm to genimages/videos/<name>/
 * @version-history v0.1.0 - 2026-07-25 - initial demo-video harness (PoC)
 */
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync, existsSync, renameSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_AIMEAT = resolve(__dirname, '..', '..');            // aimeat/
const REPO_ROOT = resolve(REPO_AIMEAT, '..');                  // repo root
const OUT_ROOT = join(REPO_ROOT, 'genimages', 'videos');       // gitignored

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error('usage: node scripts/demo-video/record.mjs <scenes.json>');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(resolve(manifestPath), 'utf8'));
const name = manifest.name || 'demo';
const baseUrl = manifest.baseUrl || 'http://localhost:40050';
const vp = manifest.viewport || { width: 432, height: 768, deviceScaleFactor: 2.5 };
const outDir = join(OUT_ROOT, name);
mkdirSync(outDir, { recursive: true });
// Clean stale artifacts from previous runs so the rename picks the right file.
for (const f of readdirSync(outDir)) {
  if (/\.(webm|mp4)$/i.test(f) || /^_/.test(f)) { try { rmSync(join(outDir, f)); } catch { /* ignore */ } }
}

// Overlay: visible cursor, click ripple, synced caption bar. Injected before every page load.
// Functions are defined FIRST (unconditionally) so they exist even if the DOM is not ready
// yet at init-script time; ensure() lazily builds the style + nodes once document.body exists.
const OVERLAY = `(() => {
  if (window.__cap) return;
  var CSS = "#__dc{position:fixed;z-index:2147483647;width:24px;height:24px;margin:-12px 0 0 -12px;border-radius:50%;"
    + "background:rgba(232,86,74,.9);box-shadow:0 0 0 3px rgba(232,86,74,.3),0 2px 10px rgba(0,0,0,.5);"
    + "pointer-events:none;left:-80px;top:-80px;transition:left .18s ease-out,top .18s ease-out}"
    + "#__dc.clk{animation:__dcr .45s ease-out}"
    + "@keyframes __dcr{0%{box-shadow:0 0 0 3px rgba(232,86,74,.7)}100%{box-shadow:0 0 0 30px rgba(232,86,74,0)}}"
    + "#__cap{position:fixed;left:0;right:0;bottom:0;z-index:2147483646;padding:26px 32px 46px;box-sizing:border-box;"
    + "background:linear-gradient(to top,rgba(9,11,15,.94),rgba(9,11,15,.55) 60%,rgba(9,11,15,0));"
    + "color:#fff;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;pointer-events:none;"
    + "opacity:0;transform:translateY(14px);transition:opacity .35s,transform .35s}"
    + "#__cap.on{opacity:1;transform:none}"
    + "#__cap .t{font-size:33px;font-weight:750;line-height:1.16;letter-spacing:-.4px}"
    + "#__cap .s{font-size:21px;font-weight:400;opacity:.82;margin-top:7px;line-height:1.3}";
  function ensure(){
    if(!document.body) return null;
    if(!document.getElementById('__dcs')){var s=document.createElement('style');s.id='__dcs';s.textContent=CSS;document.body.appendChild(s);}
    var c=document.getElementById('__dc');
    if(!c){c=document.createElement('div');c.id='__dc';document.body.appendChild(c);}
    var p=document.getElementById('__cap');
    if(!p){p=document.createElement('div');p.id='__cap';p.innerHTML='<div class="t"></div><div class="s"></div>';document.body.appendChild(p);}
    return {c:c,p:p};
  }
  window.__mv=function(x,y){var e=ensure();if(e){e.c.style.left=x+'px';e.c.style.top=y+'px';}};
  window.__clk=function(){var e=ensure();if(e){e.c.classList.remove('clk');void e.c.offsetWidth;e.c.classList.add('clk');}};
  window.__cap=function(t,s){var e=ensure();if(e){e.p.querySelector('.t').textContent=t||'';e.p.querySelector('.s').textContent=s||'';e.p.classList.add('on');}};
  window.__capHide=function(){var e=ensure();if(e)e.p.classList.remove('on');};
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',ensure); else ensure();
})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function moveCursor(page, x, y) {
  // Animate the fake cursor (CSS transition) and sync the real mouse for hover states.
  await page.evaluate(([px, py]) => window.__mv(px, py), [x, y]);
  const steps = 12;
  await page.mouse.move(x, y, { steps });
  await sleep(220);
}

async function locate(page, step) {
  if (step.selector) return page.locator(step.selector).first();
  if (step.text) return page.getByText(step.text, { exact: !!step.exact }).first();
  if (step.role) return page.getByRole(step.role, { name: step.name }).first();
  throw new Error('step needs selector|text|role');
}

async function clickAt(page, loc) {
  // Fail fast (not the 30s default) if the target never appears — a taken username / changed
  // flow should not stack 30s waits into a multi-minute run.
  await loc.waitFor({ state: 'visible', timeout: 6000 });
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  const box = await loc.boundingBox();
  if (!box) { await loc.click({ timeout: 8000 }); return; }
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await moveCursor(page, x, y);
  await page.evaluate(() => window.__clk());
  await sleep(120);
  await loc.click({ timeout: 8000 });
}

async function runStep(page, step) {
  const t = step.type;
  if (t === 'goto') {
    await page.goto(baseUrl + step.path, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForLoadState('load').catch(() => {});
    await sleep(1800); // let the client-side SPA mount + render
    await page.addStyleTag({ content: '*{scroll-behavior:smooth !important;}' }).catch(() => {});
    return;
  }
  if (t === 'caption') { await page.evaluate(([a, b]) => window.__cap(a, b), [step.title || '', step.subtitle || '']); return; }
  if (t === 'captionHide') { await page.evaluate(() => window.__capHide()); return; }
  if (t === 'wait') { await sleep(step.ms || 1000); return; }
  if (t === 'waitFor') { await page.locator(step.selector).first().waitFor({ timeout: step.ms || 10000 }).catch(() => {}); return; }
  if (t === 'hover') { const l = await locate(page, step); const b = await l.boundingBox(); if (b) await moveCursor(page, b.x + b.width / 2, b.y + b.height / 2); return; }
  if (t === 'click') { await clickAt(page, await locate(page, step)); return; }
  if (t === 'type') {
    const l = await locate(page, step);
    await clickAt(page, l);
    await l.fill('');
    await l.pressSequentially(step.text || '', { delay: step.delayMs ?? 55 });
    return;
  }
  if (t === 'press') { await page.keyboard.press(step.key); return; }
  if (t === 'scroll') {
    if (step.selector) { await page.locator(step.selector).first().scrollIntoViewIfNeeded().catch(() => {}); }
    else { await page.evaluate((by) => window.scrollBy({ top: by, behavior: 'smooth' }), step.byPx ?? 400); }
    return;
  }
  if (t === 'eval') { await page.evaluate(step.code); return; }
  throw new Error('unknown step type: ' + t);
}

async function main() {
  console.log(`[record] ${name}  base=${baseUrl}  ${vp.width}x${vp.height}@${vp.deviceScaleFactor || 1}`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.deviceScaleFactor || 1,
    // Playwright records at CSS-pixel resolution, so the video MUST match the viewport;
    // compose.mjs upscales this to the final 1080x1920 (same 9:16 aspect, clean upscale).
    recordVideo: { dir: outDir, size: { width: vp.width, height: vp.height } },
    locale: manifest.locale || 'fi-FI',
  });
  await context.addInitScript(OVERLAY);
  const page = await context.newPage();

  // Optional programmatic login: seed the SPA session token before the scenes run.
  if (manifest.auth) {
    try {
      await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' });
      const res = await page.request.post(baseUrl + '/v1/auth/login', {
        data: { username: manifest.auth.username, password: manifest.auth.password },
      });
      const body = await res.json().catch(() => null);
      const jwt = body?.data?.token || body?.data?.jwt || body?.token;
      if (jwt) {
        await page.evaluate((j) => localStorage.setItem('aimeat_session', JSON.stringify({ jwt: j })), jwt);
        console.log('[record] seeded session token');
      } else {
        console.warn('[record] login returned no token; scenes must log in via UI');
      }
    } catch (e) { console.warn('[record] auth seed failed:', e.message); }
  }

  let i = 0;
  for (const scene of manifest.scenes) {
    console.log(`  scene ${++i}/${manifest.scenes.length}: ${scene.label || ''}`);
    for (const step of scene.steps) {
      try { await runStep(page, step); }
      catch (e) {
        console.warn(`    ! step ${step.type} failed @ ${page.url()}: ${e.message}`);
        await page.screenshot({ path: join(outDir, `_fail_s${i}_${step.type}.png`) }).catch(() => {});
      }
    }
  }
  await sleep(600);
  await context.close();   // flushes the video file
  await browser.close();

  // Rename the auto-named page@<hash>.webm to <name>.webm (pick the largest, ignore any stale <name>.webm).
  const webms = readdirSync(outDir)
    .filter((f) => f.endsWith('.webm') && f !== `${name}.webm`)
    .map((f) => ({ f, size: statSync(join(outDir, f)).size }))
    .sort((a, b) => b.size - a.size);
  const webm = webms[0]?.f;
  if (webm) {
    const dst = join(outDir, `${name}.webm`);
    if (existsSync(dst)) rmSync(dst);
    renameSync(join(outDir, webm), dst);
    console.log(`[record] saved ${dst} (${(webms[0].size / 1024 / 1024).toFixed(1)} MB)`);
  } else {
    console.error('[record] no webm produced');
    process.exit(2);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

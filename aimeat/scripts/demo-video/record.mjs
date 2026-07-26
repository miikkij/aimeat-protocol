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
import { waitUntil } from './wait.mjs';
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, readdirSync, rmSync, statSync } from 'node:fs';
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
  /* A step with only a note on it is a note. Manifests are read by people, and a line of
     reasoning between two actions should not have to pretend to be an action. */
  if (!t && step._) return;
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
  /* A build recording waits on things that genuinely take time: an AI call answering, a frame
     appearing, an app publishing. A fixed sleep either films a spinner or wastes half a minute,
     and a swallowed wait films the wrong state entirely — so this one throws. */
  if (t === 'waitUntil') {
    /* A soft wait is a grace period: give the thing a chance to arrive, carry on without it if it
       does not. Used where the app is allowed to decide (one window or two), never where the take
       depends on the result. */
    if (step.soft) {
      await waitUntil(page, step).catch((e) => console.log(`      · waited in vain: ${step.label || ''} (${e.message.split(':')[0]})`));
      return;
    }
    await waitUntil(page, step);
    return;
  }
  /* A model is not a fixture. The same request can come back complete or half done, and a script
     that assumes either one films the other. `when` runs its steps only if the page is in the
     state that needs them, so the take adapts instead of failing. */
  if (t === 'when') {
    let ok = false;
    try { ok = await page.evaluate(`(${step.code})()`); } catch (e) { ok = false; }
    console.log(`      when(${step.label || 'condition'}) -> ${ok ? 'yes' : 'no'}`);
    if (!ok) return;
    for (const s of step.then || []) await runStep(page, s);
    return;
  }
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
  if (t === 'eval') {
    const out = await page.evaluate(step.code);
    /* Whatever the page hands back goes into the run log. The first attempt at this printed to the
       BROWSER console, where nobody was looking; the board's own words ("Added", "nothing came
       back", "pick something first") are the fastest explanation of a stuck take there is. */
    if (out !== undefined && out !== null && out !== '') console.log(`      · ${String(out).slice(0, 160)}`);
    return;
  }
  /* Say what the board is saying, at any point in a scene. */
  if (t === 'report') {
    const out = await page.evaluate(`(${step.code})()`).catch((e) => 'could not read: ' + e.message);
    console.log(`      · ${step.label || 'state'}: ${String(out).slice(0, 200)}`);
    return;
  }
  /* Pan the board so the target sits in the middle of the window. The toolbar is fixed and eats
     any click that lands under it, which is how a take dies at minute nine; this also makes the
     move visible on camera instead of teleporting. */
  /* Drag a frame's corner. Setting width and height in the data would resize it too, and would
     look like the board twitched; a hand on the grip is what a person does and what reads. */
  if (t === 'dragBy') {
    const loc = page.locator(step.selector).first();
    await loc.waitFor({ state: 'visible', timeout: 8000 });
    const box = await loc.boundingBox();
    if (!box) throw new Error('dragBy: no box for ' + step.selector);
    const inset = step.inset ?? 7;
    const x = box.x + box.width - inset, y = box.y + box.height - inset;
    await moveCursor(page, x, y);
    await page.mouse.down();
    await page.evaluate(() => window.__clk());
    await page.mouse.move(x + (step.dx || 0), y + (step.dy || 0), { steps: step.steps || 24 });
    await sleep(200);
    await page.mouse.up();
    await sleep(step.ms || 700);
    return;
  }
  /* Pull back to see the whole thing grow, then come in again. A board that only ever shows one
     window at a time never shows that the windows belong together. */
  if (t === 'zoom') {
    await page.evaluate((to) => {
      const w = document.querySelector('.og-world');
      const m = new DOMMatrix(getComputedStyle(w).transform);
      const k = m.a || 1;
      /* keep the middle of what can be seen fixed, so the zoom feels like leaning back */
      let left = 0, right = window.innerWidth, top = 0;
      for (const p of ['#builder', '#insp']) {
        const el = document.querySelector(p);
        if (!el || getComputedStyle(el).display === 'none') continue;
        const r = el.getBoundingClientRect();
        if (r.width < 40) continue;
        if (r.left <= 1) left = Math.max(left, r.right); else right = Math.min(right, r.left);
      }
      const bar = document.querySelector('.og-bar');
      if (bar) top = bar.getBoundingClientRect().bottom;
      const px = (left + right) / 2, py = (top + window.innerHeight) / 2;
      const e2 = px - to * (px - m.e) / k;
      const f2 = py - to * (py - m.f) / k;
      w.style.transition = 'transform .8s ease-in-out';
      w.style.transform = `matrix(${to}, 0, 0, ${to}, ${e2}, ${f2})`;
    }, step.to || 0.6);
    await sleep(step.ms || 1200);
    return;
  }
  /* Windows land wherever there was room, which on a recording reads as a mess even though every
     one of them is correct. The runner knows every frame by name and can place it, so it does: a
     named layout in board coordinates, moved with a transition so the viewer sees them GLIDE into
     order rather than teleport. Anything not named in the plan is left alone. */
  if (t === 'arrange') {
    const placed = await page.evaluate((plan) => {
      const b = window.__origami.board();
      const nodeOf = (id) => document.querySelector(`[data-og-id="${id}"]`);
      const titleOf = (f) => {
        const n = nodeOf(f.id), el = n && n.querySelector('.og-frame-title');
        return ((el ? el.textContent : '') + ' ' + (f.spec.kind || '')).trim();
      };
      const used = new Set(); const done = [];
      for (const p of plan) {
        /* A name is a guess: two frames can both be a "frame-app", and the wrong one moved into the
           right place looks exactly like nothing happening. A probe is the frame itself. */
        let fr = null;
        if (p.probe) {
          const n0 = document.querySelector(`[data-probe="${p.probe}"]`);
          const holder = n0 && n0.closest('[data-og-id]');
          const id = holder && holder.getAttribute('data-og-id');
          fr = id ? b.frames.find((f) => f.id === id) : null;
        }
        const re = new RegExp(p.is || '$^', 'i');
        if (!fr) fr = b.frames.find((f) => !used.has(f.id) && re.test(titleOf(f)));
        if (!fr) continue;
        used.add(fr.id);
        const n = nodeOf(fr.id);
        if (n) n.style.transition = 'left .7s ease-in-out, top .7s ease-in-out, width .7s ease-in-out, height .7s ease-in-out';
        fr.x = p.x; fr.y = p.y;
        if (p.w) fr.w = p.w;
        if (p.h) fr.spec.h = p.h;
        if (n) {
          n.style.left = fr.x + 'px'; n.style.top = fr.y + 'px';
          if (p.w) n.style.width = p.w + 'px';
          if (p.h) { n.style.height = p.h + 'px'; n.classList.add('og-sized'); }
        }
        done.push(titleOf(fr).split(' ')[0] + '@' + p.x + ',' + p.y);
      }
      return { placed: done, missed: plan.length - done.length };
    }, step.plan || []);
    await sleep(900);
    await page.evaluate(() => {
      for (const n of document.querySelectorAll('[data-og-frame]')) n.style.transition = '';
      /* The ring is drawn from where the frames are, so it has to be asked for again after they move,
         or it stays around the places they used to be. */
      const O = window.__origami;
      if (O.drawAllRadars) { O.drawAllRadars(); O.paintMembership && O.paintMembership(); }
      window.dispatchEvent(new Event('resize'));
    });
    await page.evaluate(() => window.__origami.saveBoard(false)).catch(() => {});
    /* Moving the furniture without moving the camera films an empty room: the frames are exactly
       where they were put, and none of them is on screen. Follow the layout unless told not to. */
    if (step.fit !== false) {
      await page.locator('#btn-fit').click({ timeout: 5000 }).catch(() => {});
      await sleep(1100);
    }
    console.log('      · arranged ' + placed.placed.length + ' frame(s)' +
      (placed.missed ? ', ' + placed.missed + ' not on the board' : ''));
    return;
  }
  if (t === 'centerOn') {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error('centerOn: no ' + sel);
      const w = document.querySelector('.og-world');
      const m = new DOMMatrix(getComputedStyle(w).transform);
      const r = el.getBoundingClientRect();
      /* Centre of what can be SEEN, not of the window. The builder is a side panel over the left
         third, so centring on the window puts the thing being worked on half underneath it, which
         is exactly where a viewer cannot follow what is happening. */
      let left = 0, right = window.innerWidth, top = 0;
      for (const p of ['#builder', '#insp']) {
        const el2 = document.querySelector(p);
        if (!el2 || getComputedStyle(el2).display === 'none') continue;
        const pr = el2.getBoundingClientRect();
        if (pr.width < 40) continue;
        if (pr.left <= 1) left = Math.max(left, pr.right);
        else right = Math.min(right, pr.left);
      }
      const bar = document.querySelector('.og-bar');
      if (bar) top = bar.getBoundingClientRect().bottom;
      const dx = (left + right) / 2 - (r.left + r.width / 2);
      const dy = (top + window.innerHeight) / 2 - (r.top + r.height / 2);
      w.style.transition = 'transform .5s ease-out';
      w.style.transform = `matrix(${m.a}, 0, 0, ${m.d}, ${m.e + dx}, ${m.f + dy})`;
    }, step.selector);
    await sleep(step.ms || 900);
    return;
  }
  throw new Error('unknown step type: ' + t);
}

async function main() {
  console.log(`[record] ${name}  base=${baseUrl}  ${vp.width}x${vp.height}@${vp.deviceScaleFactor || 1}`);
  /* HEADED=1 puts the run on screen. A recording you cannot watch is a recording you can only
     debug afterwards, from a video that is written when the browser closes. */
  const browser = await chromium.launch({
    headless: !process.env.HEADED,
    /* Chrome offers to translate a Finnish-looking page and puts its own bar over the top right
       corner. On a headed run that bar is in the recording. */
    args: ['--disable-features=Translate,TranslateUI', '--lang=en-GB'],
  });
  const context = await browser.newContext({
    /* A saved browser state, exported from an already signed-in session. Beats seeding a token
       (which expires mid-run) and beats putting a password in a manifest, a command line or a
       shell history. The file holds a live session: keep it out of the repo and let it expire. */
    ...(manifest.storageStateFile ? { storageState: resolve(manifest.storageStateFile) } : {}),
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.deviceScaleFactor || 1,
    // Playwright records at CSS-pixel resolution, so the video MUST match the viewport;
    // compose.mjs upscales this to the final 1080x1920 (same 9:16 aspect, clean upscale).
    recordVideo: { dir: outDir, size: { width: vp.width, height: vp.height } },
    locale: manifest.locale || 'fi-FI',
  });
  await context.addInitScript(OVERLAY);
  const page = await context.newPage();

  /* A picture every few seconds, into its own folder, so a run can be watched while it happens.
     The video is only written when the browser closes, and a frame pulled out of a half-written
     webm lags minutes behind: useless for "what is it doing right now". */
  const shotDir = join(outDir, 'live');
  mkdirSync(shotDir, { recursive: true });
  for (const f of readdirSync(shotDir)) { try { rmSync(join(shotDir, f)); } catch { /* ignore */ } }
  let shotN = 0;
  const shots = setInterval(() => {
    const n = String(++shotN).padStart(4, '0');
    page.screenshot({ path: join(shotDir, `${n}.png`) }).catch(() => {});
  }, 5000);

  /* A token from the environment, so recording against production never needs a password in a
     manifest, in a shell history or in a log. Export it for the one run and let it expire. */
  if (manifest.auth && manifest.auth.tokenEnv) {
    const jwt = process.env[manifest.auth.tokenEnv];
    if (!jwt) throw new Error(`auth.tokenEnv ${manifest.auth.tokenEnv} is not set`);
    await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' });
    await page.evaluate((j) => localStorage.setItem('aimeat_session', JSON.stringify({ jwt: j })), jwt);
    console.log('[record] seeded session token from', manifest.auth.tokenEnv);
  } else if (manifest.auth) {
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

  /* When each step ran, measured from the moment recording started. compose.mjs uses this to play
     the doing at normal speed and squeeze the waiting: a uniform 6x makes typing unreadable and
     still leaves three minutes of a spinner in the cut. */
  const t0 = Date.now();
  const marks = [];

  let i = 0;
  for (const scene of manifest.scenes) {
    console.log(`  scene ${++i}/${manifest.scenes.length}: ${scene.label || ''}`);
    for (const step of scene.steps) {
      const from = Date.now() - t0;
      try { await runStep(page, step); }
      catch (e) {
        console.warn(`    ! step ${step.type} failed @ ${page.url()}: ${e.message}`);
        await page.screenshot({ path: join(outDir, `_fail_s${i}_${step.type}.png`) }).catch(() => {});
        /* Skipping a failed step is right for a scripted product tour, where the next scene can
           still stand on its own. It is wrong for a recording of one continuous build: every
           later step assumes the earlier one landed, so carrying on just films the failure. */
        if (manifest.strict) {
          await context.close().catch(() => {});
          await browser.close().catch(() => {});
          throw new Error(`strict: scene ${i} step "${step.type}" failed: ${e.message}`);
        }
      }
      marks.push({ scene: i, sceneLabel: scene.label || '', type: step.type,
        label: step.label || step._ || '', from, to: Date.now() - t0 });
    }
  }
  await sleep(600);
  clearInterval(shots);
  await context.close();   // flushes the video file
  await browser.close();
  writeFileSync(join(outDir, `${name}.marks.json`), JSON.stringify({ total: Date.now() - t0, marks }, null, 1));
  console.log(`[record] ${marks.length} marks over ${Math.round((Date.now() - t0) / 1000)}s`);

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

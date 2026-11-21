/**
 * @file _core/spend.js
 * @description Shared SDK-libs core — the spend guard every money-touching library uses. Two
 *   mechanisms: `once()` collapses repeated calls (a user hammering a button, two tabs, a stray
 *   re-render) into ONE request, optionally keeping the result for a settle window so a click
 *   right after completion returns the same task instead of commissioning a second one; and
 *   `confirmSpend()` shows a theme-aware modal that states what is about to be spent and on what,
 *   with a short arming delay so a double-click cannot travel through it. State lives on
 *   window.AIMEAT.__spend so aimeat-ai and aimeat-agents share one in-flight map and one
 *   "don't ask again" memory regardless of which bundle loaded first.
 * @structure state() · keyOf() · once/isBusy/forget · noteBudget/lastBudget · confirmSpend ·
 *   cancelledError() · the `spend` surface attached as AIMEAT.spend.
 * @usage import { once, keyOf, confirmSpend } from '../_core/spend.js';
 *   return once(keyOf(['ai', prompt]), run);          // one click = one call
 *   if (!await confirmSpend({ what: 'Summarise 200 rows' })) return;
 * @version-history
 *   v1.0.1 — 2026-11-21 — esc() is the shared escape (_core/escape.js).
 *   v1.0.0 — 2026-07-31 — Initial: in-flight/settle dedupe + the spend-confirm dialog, so an app
 *     cannot fire the same paid call five times from five clicks.
 */
import { namespace, attach } from './namespace.js';
import { escapeHtml } from './escape.js';

/** Milliseconds the confirm button stays disabled, so a double-click cannot reach it. */
const ARM_MS = 400;

/**
 * The cross-bundle spend state on window.AIMEAT.
 * @returns {{ inflight: Map<string, Promise<any>>, settled: Map<string, { v: any, t: number }>,
 *   remembered: Record<string, boolean>, budget: any }}
 */
function state() {
  const ns = namespace();
  if (!ns.__spend) {
    ns.__spend = { inflight: new Map(), settled: new Map(), remembered: {}, budget: null };
  }
  return ns.__spend;
}

/**
 * A stable short key from the parts that make two calls "the same call" (agent + description,
 * app + model + prompt). Plain FNV-1a — this is a dedupe key, not a security primitive.
 * @param {Array<string|number|undefined|null>} parts
 * @returns {string}
 */
export function keyOf(parts) {
  const s = parts.map((p) => (p == null ? '' : String(p))).join('\0');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return (parts[0] == null ? 'k' : String(parts[0])) + ':' + h.toString(36);
}

/**
 * Run `fn` at most once per key at a time. While a call with this key is in flight every further
 * call gets the SAME promise — no second request, no second confirm dialog. With `ttlMs` the
 * resolved value is also kept for that long, so a click just after the first one completed
 * returns the first result. Rejections are never cached: a failed call is retryable at once.
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} fn
 * @param {{ ttlMs?: number }} [opts]
 * @returns {Promise<T>}
 */
export function once(key, fn, opts) {
  const s = state();
  const ttl = (opts && opts.ttlMs) || 0;
  const running = s.inflight.get(key);
  if (running) return running;
  if (ttl > 0) {
    const done = s.settled.get(key);
    if (done && (Date.now() - done.t) < ttl) return Promise.resolve(done.v);
    if (done) s.settled.delete(key);
  }
  const p = Promise.resolve().then(fn).then(
    (v) => {
      s.inflight.delete(key);
      if (ttl > 0) s.settled.set(key, { v, t: Date.now() });
      return v;
    },
    (e) => { s.inflight.delete(key); throw e; },
  );
  s.inflight.set(key, p);
  return p;
}

/** True while a call with this key is in flight — for disabling the control that started it. */
export function isBusy(key) { return state().inflight.has(key); }

/** Drop a settled result so the next call runs for real (a deliberate "run it again"). */
export function forget(key) { state().settled.delete(key); }

/** Remember the budget block the node returned, so a later confirm can show what is left. */
export function noteBudget(b) { if (b) state().budget = b; }

/** The last budget block seen from an AI call, or null. */
export function lastBudget() { return state().budget; }

/** The error a cancelled confirm throws — apps branch on `.code === 'SPEND_CANCELLED'`. */
export function cancelledError(what) {
  const e = /** @type {Error & { code?: string }} */ (new Error((what || 'The action') + ' was cancelled'));
  e.code = 'SPEND_CANCELLED';
  return e;
}

// ── The confirm dialog ────────────────────────────────────────────────────────────────────────

function esc(s) { return escapeHtml(s); }

function lang() {
  try {
    const a = window.AIMEAT && window.AIMEAT.auth;
    const l = a && a.getLang && a.getLang();
    if (l === 'fi' || l === 'en') return l;
  } catch { /* auth not loaded */ }
  try { return (navigator.language || '').toLowerCase().startsWith('fi') ? 'fi' : 'en'; } catch { return 'en'; }
}

const STRINGS = {
  en: {
    title: 'Confirm', cost: 'This spends from your own account.',
    ok: 'Continue', cancel: 'Cancel', remember: "Don't ask again in this session",
    budget: 'AI budget today', left: 'left',
  },
  fi: {
    title: 'Vahvista', cost: 'Tämä kuluttaa omalta tililtäsi.',
    ok: 'Jatka', cancel: 'Peruuta', remember: 'Älä kysy uudelleen tässä istunnossa',
    budget: 'AI-budjetti tänään', left: 'jäljellä',
  },
};

function ensureStyles() {
  if (document.getElementById('aimeat-spend-css')) return;
  const st = document.createElement('style');
  st.id = 'aimeat-spend-css';
  st.textContent = [
    '.aim-spend::backdrop{background:rgba(9,11,16,.62)}',
    '.aim-spend{border:0;padding:0;background:transparent;max-width:min(440px,calc(100vw - 24px));',
      'max-height:calc(100dvh - 24px);overflow:visible}',
    '.aim-spend-box{box-sizing:border-box;max-height:calc(100dvh - 24px);overflow:auto;',
      'padding:20px 20px 16px;border-radius:14px;font-family:system-ui,-apple-system,Segoe UI,sans-serif;',
      'background:#fff;color:#12151c;border:1px solid #e2e5ea;box-shadow:0 18px 48px rgba(9,11,16,.28)}',
    '.aim-spend-box h3{margin:0 0 6px;font-size:17px;font-weight:700;letter-spacing:-.01em}',
    '.aim-spend-what{margin:0 0 10px;font-size:14.5px;line-height:1.45}',
    '.aim-spend-detail{margin:0 0 10px;font-size:13px;line-height:1.5;opacity:.78;white-space:pre-wrap}',
    '.aim-spend-meta{margin:0 0 14px;font-size:12.5px;line-height:1.6;opacity:.72}',
    '.aim-spend-meta b{font-weight:650;opacity:.95}',
    '.aim-spend-remember{display:flex;align-items:center;gap:7px;margin:0 0 14px;font-size:12.5px;opacity:.8;cursor:pointer}',
    // Sticky footer: on a short viewport the detail text scrolls inside the box, and both actions
    // stay reachable without scrolling to find them.
    '.aim-spend-btns{position:sticky;bottom:-16px;margin-bottom:-16px;padding:12px 0 16px;background:inherit;',
      'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}',
    '.aim-spend-btns button{font:inherit;font-size:14px;font-weight:600;padding:9px 16px;border-radius:9px;cursor:pointer;border:1px solid transparent}',
    '.aim-spend-cancel{background:transparent;color:inherit;border-color:#d3d7de}',
    '.aim-spend-cancel:hover{background:rgba(9,11,16,.05)}',
    '.aim-spend-ok{background:#E8564A;color:#fff}',
    '.aim-spend-ok:hover{background:#d54539}',
    '.aim-spend-ok[disabled]{opacity:.5;cursor:progress}',
    '@media (prefers-color-scheme:dark){',
      '.aim-spend-box{background:#161a21;color:#e8eaee;border-color:#2b313b;box-shadow:0 18px 48px rgba(0,0,0,.6)}',
      '.aim-spend-cancel{border-color:#39414d}',
      '.aim-spend-cancel:hover{background:rgba(255,255,255,.06)}',
    '}',
    ':root[data-theme="dark"] .aim-spend-box{background:#161a21;color:#e8eaee;border-color:#2b313b}',
    ':root[data-theme="dark"] .aim-spend-cancel{border-color:#39414d}',
    ':root[data-theme="light"] .aim-spend-box{background:#fff;color:#12151c;border-color:#e2e5ea}',
    ':root[data-theme="light"] .aim-spend-cancel{border-color:#d3d7de}',
    '@media (max-width:420px){.aim-spend-btns{flex-direction:column-reverse}.aim-spend-btns button{width:100%}}',
  ].join('');
  (document.head || document.documentElement).appendChild(st);
}

/**
 * Ask the user to confirm an action that costs them money. Resolves true (go ahead) or false
 * (cancelled) — it never throws, so the caller decides what a "no" means.
 *
 * @param {{ what?: string, detail?: string, estimate?: string, remaining?: string,
 *   okLabel?: string, cancelLabel?: string, remember?: string }} [opts]
 *   what      — one line naming the action ("Commission news-agent to summarise 200 rows")
 *   detail    — optional extra lines (the prompt, the row count, the agent's name)
 *   estimate  — what it is expected to cost, in the user's terms ("~$0.03", "1 agent run")
 *   remaining — what is left ("$0.71 of $1.00 today"); defaults to the last AI budget seen
 *   remember  — a key; when given, a "don't ask again in this session" checkbox is offered
 * @returns {Promise<boolean>}
 */
export function confirmSpend(opts) {
  const o = opts || {};
  const s = state();
  if (o.remember && s.remembered[o.remember]) return Promise.resolve(true);
  if (typeof document === 'undefined' || !document.body) return Promise.resolve(true);

  const t = STRINGS[lang()] || STRINGS.en;
  ensureStyles();

  let remaining = o.remaining;
  if (!remaining) {
    const b = s.budget;
    if (b && typeof b.remaining_usd === 'number' && typeof b.daily_budget_usd === 'number') {
      remaining = '$' + b.remaining_usd.toFixed(2) + ' / $' + b.daily_budget_usd.toFixed(2) + ' ' + t.left;
    }
  }

  const dlg = document.createElement('dialog');
  dlg.className = 'aim-spend';
  dlg.innerHTML = '<div class="aim-spend-box" role="document">'
    + '<h3>' + esc(t.title) + '</h3>'
    + '<p class="aim-spend-what">' + esc(o.what || t.cost) + '</p>'
    + (o.detail ? '<p class="aim-spend-detail">' + esc(o.detail) + '</p>' : '')
    + (o.estimate || remaining
      ? '<p class="aim-spend-meta">'
        + (o.estimate ? esc(t.cost) + ' <b>' + esc(o.estimate) + '</b>' : esc(t.cost))
        + (remaining ? '<br>' + esc(t.budget) + ': <b>' + esc(remaining) + '</b>' : '')
        + '</p>'
      : '')
    + (o.remember
      ? '<label class="aim-spend-remember"><input type="checkbox" class="aim-spend-rem">'
        + '<span>' + esc(t.remember) + '</span></label>'
      : '')
    + '<div class="aim-spend-btns">'
      + '<button type="button" class="aim-spend-cancel">' + esc(o.cancelLabel || t.cancel) + '</button>'
      + '<button type="button" class="aim-spend-ok" disabled>' + esc(o.okLabel || t.ok) + '</button>'
    + '</div></div>';
  document.body.appendChild(dlg);

  return new Promise((resolve) => {
    let settled = false;
    const rem = /** @type {HTMLInputElement|null} */ (dlg.querySelector('.aim-spend-rem'));
    const ok = /** @type {HTMLButtonElement} */ (dlg.querySelector('.aim-spend-ok'));
    const cancel = /** @type {HTMLButtonElement} */ (dlg.querySelector('.aim-spend-cancel'));

    function finish(answer) {
      if (settled) return;
      settled = true;
      if (answer && o.remember && rem && rem.checked) s.remembered[o.remember] = true;
      try { dlg.close(); } catch { /* not open */ }
      dlg.remove();
      resolve(answer);
    }
    cancel.addEventListener('click', () => finish(false));
    ok.addEventListener('click', () => finish(true));
    // Esc and the backdrop are a cancel, never a spend.
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(false); });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) finish(false); });

    try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); }
    // preventScroll + a reset: on a short viewport (1280x460) a plain focus() scrolls the box to
    // reveal the button and the title disappears off the top, which reads as a clipped dialog.
    try { cancel.focus({ preventScroll: true }); } catch { cancel.focus(); }
    const boxEl = dlg.querySelector('.aim-spend-box');
    if (boxEl) boxEl.scrollTop = 0;
    // Arm the spend button late: a double-click on the trigger cannot land on it.
    setTimeout(() => { ok.disabled = false; }, ARM_MS);
  });
}

/** The public AIMEAT.spend surface (attached by every money-touching lib; state is shared). */
export const spend = {
  confirm: confirmSpend,
  once,
  key: keyOf,
  isBusy,
  forget,
  budget: lastBudget,
  /** Clear every "don't ask again" answer — e.g. when the user signs out. */
  resetRemembered() { state().remembered = {}; },
};

/** Mount AIMEAT.spend. Idempotent across bundles: they all share window.AIMEAT.__spend. */
export function attachSpend() { attach('spend', spend); }

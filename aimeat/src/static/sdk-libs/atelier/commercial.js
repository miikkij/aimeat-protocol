/**
 * @file atelier/commercial.js
 * @description The commercial side of the kit (the wish of 2026-08-29): what the classic
 *   catalogue got as hand-written sections exists here as components an AI drops in, each
 *   carrying the facts it must show and the reason it exists — so a builder never has to work
 *   out how a legal page, a reviewer line, an audit trail or a feedback form is presented.
 *
 *   Eight members:
 *     legalLinks     the app's own pages with state, readiness and the reason each page exists
 *     readinessChip  "N legal pages still to write" — the owner's nudge, never a block
 *     legalPageFrame the frame a legal document renders into, with the who-answers footer
 *     auditTrail     the append-only trail from an organism row space, two-hand rule spoken
 *     recordEvent    the one call that appends an audit row in the canonical shape
 *     feedbackForm   the public intake form (topic / message / contact + honeypot)
 *     reviewerLine   "Reviewed by NAME" with what a named review lifts and what it never lifts
 *     marksSwitches  the owner's badge and install switches
 *
 *   WHAT FETCHES AND WHY. The kit's charter is "it renders; it does not fetch" — this module
 *   holds the charter's second named exception, the same class as the mosaic's: legalLinks and
 *   readinessChip make one sessionless GET of the app's OWN public legal surface
 *   (`/v1/apps/:owner/:filename/legal`), which is pre-contract information served without the
 *   app's access code, as public as the app itself. Everything session-bound rides the
 *   libraries the app already loaded and feature-detects them: auditTrail and recordEvent go
 *   through AIMEAT.rows, feedbackForm through AIMEAT.intake, marksSwitches through the session
 *   the shell handed the app. No credential is ever held here.
 *
 *   The words live in commercial-i18n.js in the kit's three languages; the reason-per-kind
 *   strings mirror services/app-legal.ts LEGAL_KIND_INFO, and a host overrides any of them
 *   under the `commercial.` i18n prefix. The readiness sentence is localised HERE (picked by
 *   whether the recommendation is the seller's set), because the node serves it in English —
 *   the loose end named on the Lakisivudemo note.
 * @structure legalLinks · readinessChip · legalPageFrame · auditTrail · recordEvent ·
 *   feedbackForm · reviewerLine · marksSwitches (helpers: apiBase / selfRef / ownerPart)
 * @usage
 *   AIMEAT.atelier.legalLinks({ target: host });
 *   AIMEAT.atelier.auditTrail({ target: host, org, ws, space: 'event' });
 * @version-history
 *   v0.38.0 — 2026-08-30 — Initial (the commercial side arrives in the kit).
 */
import { APEX_URL } from '../_core/config.js';
import { el, clear, resolve, enter } from './dom.js';
import { form } from './form.js';
import { emptyState, skeleton } from './state.js';
import { appRef } from './mosaic-layout.js';
import { tc } from './commercial-i18n.js';

const LAW_URL = 'https://eur-lex.europa.eu/eli/reg/2024/1689/oj#art_50';
const KINDS = ['terms', 'privacy', 'imprint', 'refunds', 'accessibility', 'cookies', 'support'];

/** The apex the legal surface lives on: the auth library's node when present, else the baked apex. */
function apiBase() {
  const ns = /** @type {any} */ (window).AIMEAT;
  if (ns && ns.auth && ns.auth.nodeUrl) return String(ns.auth.nodeUrl).replace(/\/+$/, '');
  return APEX_URL;
}

/** Whose app this page is: the spec first, then the ref the node injects into every served app. */
function selfRef(spec) {
  if (spec && spec.owner && spec.filename) return { owner: String(spec.owner), filename: String(spec.filename) };
  const ref = appRef();
  if (ref) return ref;
  const meta = document.querySelector('meta[name="aimeat-app"]');
  const filename = spec && spec.filename ? String(spec.filename) : (meta && meta.getAttribute('content')) || null;
  return filename && spec && spec.owner ? { owner: String(spec.owner), filename } : null;
}

/** The human owner behind a principal: `claude#alice@node` and `alice@node` both answer `alice`. */
function ownerPart(principal) {
  let s = String(principal || '');
  const hash = s.lastIndexOf('#');
  if (hash >= 0) s = s.slice(hash + 1);
  const at = s.indexOf('@');
  return at >= 0 ? s.slice(0, at) : s;
}

function legalPath(ref) {
  return apiBase() + '/v1/apps/' + encodeURIComponent(ref.owner) + '/' + encodeURIComponent(ref.filename) + '/legal';
}

async function fetchLegal(ref) {
  const res = await fetch(legalPath(ref), { headers: { Accept: 'application/json' } });
  const body = await res.json().catch(function () { return null; });
  if (!body || body.ok === false) throw new Error((body && body.error && body.error.message) || 'legal state unavailable');
  return body.data;
}

/** The seller's set is longer than the plain set; that is how the sentence is picked locally. */
function readinessSentence(readiness) {
  const sells = ((readiness && readiness.recommended) || []).length > 2;
  return tc(sells ? 'legal.readinessSells' : 'legal.readinessPlain');
}

/**
 * The app's own legal pages as a list: per kind its localised title, the reason the page
 * exists, its state (present with format and date, still-to-write, or not written) and the
 * link to the served page. Above the list, the readiness sentence and the missing count.
 * @param {{ target?: string|Element, owner?: string, filename?: string, title?: string,
 *   showWhy?: boolean }} [spec]
 * @returns {{ el: HTMLElement, reload: () => void, destroy: () => void }}
 */
export function legalLinks(spec) {
  const s = spec || {};
  const root = el('section', { class: 'ak-root ak-com ak-com-legal' });
  if (s.target) resolve(s.target).appendChild(root);
  const ref = selfRef(s);

  function render(data) {
    clear(root);
    root.appendChild(el('h3', { class: 'ak-com__title' }, s.title || tc('legal.title')));
    root.appendChild(el('p', { class: 'ak-com__intro' }, tc('legal.intro')));
    if (!data) {
      emptyState({ target: root, tone: 'quiet', title: tc('legal.loadFailed') });
      return;
    }
    const readiness = data.readiness || { recommended: [], missing: [] };
    const missing = readiness.missing || [];
    root.appendChild(el('p', { class: 'ak-com__aside' },
      readinessSentence(readiness) + ' '
      + (missing.length ? tc('legal.readinessMissing', { n: missing.length }) : tc('legal.readinessOk'))));
    const listEl = el('div', { class: 'ak-com-legal__rows' });
    for (const kind of KINDS) {
      const st = data.legal && data.legal[kind];
      let link = null;
      for (const l of data.links || []) if (l.kind === kind) link = l;
      const isMissing = missing.indexOf(kind) >= 0;
      const state = st
        ? el('span', { class: 'ak-com-state ak-com-state--on' },
            st.format + ' · ' + String(st.updatedAt || '').split('T')[0])
        : el('span', { class: 'ak-com-state' + (isMissing ? ' ak-com-state--missing' : '') },
            tc(isMissing ? 'legal.missing' : 'legal.none'));
      const head = el('div', { class: 'ak-com-legal__head' }, [
        el('span', { class: 'ak-com-legal__name' }, tc('kind.' + kind + '.title')),
        state,
        link ? el('a', {
          class: 'ak-com-legal__open', href: link.href, target: '_blank', rel: 'noopener noreferrer',
        }, tc('legal.open') + ' →') : null,
      ].filter(Boolean));
      const row = el('div', { class: 'ak-com-legal__row' + (isMissing ? ' is-missing' : '') }, [head]);
      if (s.showWhy !== false) row.appendChild(el('p', { class: 'ak-com-legal__why' }, tc('kind.' + kind + '.why')));
      listEl.appendChild(row);
    }
    root.appendChild(listEl);
    enter(root);
  }

  function reload() {
    clear(root);
    if (!ref) { render(null); return; }
    const wait = skeleton({ target: root, rows: 3 });
    fetchLegal(ref).then(function (data) { wait.destroy(); render(data); },
      function () { wait.destroy(); render(null); });
  }
  reload();
  return { el: root, reload, destroy() { if (root.parentNode) root.parentNode.removeChild(root); } };
}

/**
 * The owner's nudge: "N legal pages still to write", rendered only when something is missing
 * AND the given session belongs to the app's owner — a visitor is never nagged about pages
 * that are not theirs to write. Never a block; a click hands control to the app.
 * @param {{ target?: string|Element, owner?: string, filename?: string,
 *   session?: { ghii?: string, gaii?: string } | null, onPick?: () => void }} [spec]
 * @returns {{ el: HTMLElement, destroy: () => void }}
 */
export function readinessChip(spec) {
  const s = spec || {};
  const root = el('button', { type: 'button', class: 'ak-root ak-com-chip', hidden: true, on: {
    click: function () { if (s.onPick) s.onPick(); },
  } });
  if (s.target) resolve(s.target).appendChild(root);
  const ref = selfRef(s);
  const who = s.session ? ownerPart(s.session.ghii || s.session.gaii) : '';
  if (ref && who && who === ownerPart(ref.owner)) {
    fetchLegal(ref).then(function (data) {
      const n = ((data.readiness && data.readiness.missing) || []).length;
      if (!n) return;
      root.textContent = '■ ' + tc('chip.pages', { n });
      root.hidden = false;
      enter(root);
    }, function () { /* an unreadable state nags nobody */ });
  }
  return { el: root, destroy() { if (root.parentNode) root.parentNode.removeChild(root); } };
}

/**
 * The frame a legal document renders into when an app shows one in its own face rather than
 * linking to the node's rendering (link by default; frame on request — the brief's rule). The
 * caller passes content it already holds: `html` it trusts (its own authored page) or plain
 * `text` rendered as paragraphs. The frame contributes the crumb, the title, the
 * published-by line and the who-answers footer.
 * @param {{ target?: string|Element, kind?: string, title?: string, appName: string,
 *   publishedBy: string, updatedAt?: string, html?: string, text?: string }} spec
 * @returns {{ el: HTMLElement, destroy: () => void }}
 */
export function legalPageFrame(spec) {
  const title = spec.title || (spec.kind ? tc('kind.' + spec.kind + '.title') : '');
  const body = el('div', { class: 'ak-com-frame__body' });
  if (spec.html != null) body.innerHTML = spec.html;
  else for (const para of String(spec.text || '').split(/\n{2,}/)) {
    if (para.trim()) body.appendChild(el('p', {}, para.trim()));
  }
  const root = el('article', { class: 'ak-root ak-com ak-com-frame' }, [
    el('p', { class: 'ak-com-frame__crumb' }, spec.appName),
    el('h2', { class: 'ak-com-frame__title' }, title),
    el('p', { class: 'ak-com-frame__meta' }, tc('frame.updated', {
      who: spec.publishedBy, app: spec.appName,
      date: String(spec.updatedAt || '').split('T')[0] || '',
    })),
    body,
    el('footer', { class: 'ak-com-frame__footer' }, tc('frame.footer')),
  ]);
  if (spec.target) resolve(spec.target).appendChild(root);
  enter(root);
  return { el: root, destroy() { if (root.parentNode) root.parentNode.removeChild(root); } };
}

/**
 * The append-only trail from an organism row space, newest first: when, what, who. Needs
 * AIMEAT.rows on the page and the two hands open — the organism naming the app in the space,
 * the person approving organism:rows — and when the node refuses, ITS OWN sentence is shown
 * with the two-hand rule beside it, never swallowed.
 * @param {{ target?: string|Element, org: string, ws: string, space: string,
 *   where?: Record<string, string>, limit?: number, title?: string, hint?: string }} spec
 * @returns {{ el: HTMLElement, reload: () => void, destroy: () => void }}
 */
export function auditTrail(spec) {
  const root = el('section', { class: 'ak-root ak-com ak-com-audit' });
  if (spec.target) resolve(spec.target).appendChild(root);
  let shown = Math.max(1, Math.min(100, spec.limit || 12));

  function head() {
    clear(root);
    root.appendChild(el('h3', { class: 'ak-com__title' }, spec.title || tc('audit.title')));
    root.appendChild(el('p', { class: 'ak-com__intro' }, spec.hint || tc('audit.intro')));
  }

  function renderRows(rows) {
    head();
    if (!rows.length) {
      emptyState({ target: root, tone: 'quiet', title: tc('audit.empty') });
      return;
    }
    const ol = el('ol', { class: 'ak-com-audit__rows' });
    for (const r of rows.slice(0, shown)) {
      const b = r.body || {};
      ol.appendChild(el('li', { class: 'ak-com-audit__row' }, [
        el('span', { class: 'ak-com-audit__when' }, String(r.occurred_at || r.occurredAt || '').replace('T', ' ').slice(0, 16)),
        el('span', { class: 'ak-com-audit__what' },
          [b.kind, b.detail && typeof b.detail === 'string' ? b.detail : null].filter(Boolean).join(' · ') || '·'),
        el('span', { class: 'ak-com-audit__who' }, ownerPart(b.actor || '')),
      ]));
    }
    root.appendChild(ol);
    if (rows.length > shown) {
      root.appendChild(el('button', { type: 'button', class: 'ak-btn ak-btn--ghost', on: {
        click: function () { shown += 25; renderRows(rows); },
      } }, tc('audit.more', { n: rows.length - shown })));
    }
    enter(root);
  }

  function renderRefusal(err) {
    head();
    emptyState({ target: root, tone: 'quiet', title: String((err && err.message) || tc('audit.loadFailed')), hint: tc('audit.twoHands') });
  }

  function reload() {
    const ns = /** @type {any} */ (window).AIMEAT;
    if (!ns || !ns.rows) {
      head();
      emptyState({ target: root, tone: 'quiet', title: tc('audit.loadFailed'), hint: 'aimeat-rows.js' });
      return;
    }
    head();
    const wait = skeleton({ target: root, rows: 3 });
    ns.rows.read(spec.org, spec.ws, spec.space, { limit: 200, order: 'desc', where: spec.where })
      .then(function (out) { wait.destroy(); renderRows((out && out.rows) || []); },
        function (err) { wait.destroy(); renderRefusal(err); });
  }
  reload();
  return { el: root, reload, destroy() { if (root.parentNode) root.parentNode.removeChild(root); } };
}

/**
 * Append one audit row in the canonical shape the trail reads back: `{ app, kind, actor, at,
 * detail }`, with a stable rowId when re-sending the same event must not duplicate it. The
 * node's refusal (the two-hand 403) travels out as the thrown error, sentence intact.
 * @param {{ org: string, ws: string, space: string, app: string, kind: string, actor: string,
 *   detail?: any, rowId?: string, occurredAt?: string }} ev
 * @returns {Promise<any>}
 */
export function recordEvent(ev) {
  const ns = /** @type {any} */ (window).AIMEAT;
  if (!ns || !ns.rows) return Promise.reject(new Error('aimeat-rows.js is not loaded'));
  const at = ev.occurredAt || new Date().toISOString();
  return ns.rows.append(ev.org, ev.ws, ev.space,
    { app: ev.app, kind: ev.kind, actor: ev.actor, at, detail: ev.detail == null ? null : ev.detail },
    { rowId: ev.rowId, occurredAt: at });
}

/**
 * The public feedback form: topic, message, an optional way to reach the sender, and a
 * honeypot no person sees. Submits through AIMEAT.intake to the named Public Intake form,
 * signed in or not; the node's own refusal sentence is placed on the field it concerns.
 * @param {{ target?: string|Element, org: string, ws: string, formId: string, title?: string,
 *   hint?: string, fields?: { topic?: string, message?: string, contact?: string } }} spec
 * @returns {{ el: HTMLElement, destroy: () => void }}
 */
export function feedbackForm(spec) {
  const names = { topic: 'topic', message: 'message', contact: 'contact', ...(spec.fields || {}) };
  const root = el('section', { class: 'ak-root ak-com ak-com-feedback' });
  if (spec.target) resolve(spec.target).appendChild(root);
  root.appendChild(el('h3', { class: 'ak-com__title' }, spec.title || tc('feedback.title')));
  if (spec.hint) root.appendChild(el('p', { class: 'ak-com__intro' }, spec.hint));
  const done = el('p', { class: 'ak-com__aside', hidden: true }, tc('feedback.sent'));

  const f = form({
    target: root,
    submitLabel: tc('feedback.send'),
    fields: [
      { name: names.topic, label: tc('feedback.topic'), type: 'text', maxLength: 200 },
      { name: names.message, label: tc('feedback.message'), type: 'textarea', required: true, maxLength: 4000 },
      { name: names.contact, label: tc('feedback.contact'), type: 'text', maxLength: 200 },
    ],
    onSubmit(values) {
      const ns = /** @type {any} */ (window).AIMEAT;
      if (!ns || !ns.intake) throw { field: names.message, message: tc('feedback.failed') };
      if (!String(values[names.message] || '').trim()) throw { field: names.message, message: tc('feedback.messageRequired') };
      const hp = /** @type {HTMLInputElement|null} */ (root.querySelector('.ak-com-hp input'));
      const payload = { ...values };
      payload.company_url = hp ? hp.value : '';
      return ns.intake.submit(spec.org, spec.ws, spec.formId, payload).then(function () {
        f.setValues({ [names.topic]: '', [names.message]: '', [names.contact]: '' });
        done.hidden = false;
      }, function (err) {
        throw { field: names.message, message: String((err && err.message) || tc('feedback.failed')) };
      });
    },
  });
  // The honeypot: a field a person never sees or fills; a crawler that fills every input does.
  f.el.appendChild(el('div', { class: 'ak-com-hp', 'aria-hidden': 'true' }, [
    el('input', { type: 'text', name: 'company_url', tabindex: '-1', autocomplete: 'off' }),
  ]));
  root.appendChild(done);
  enter(root);
  return { el: root, destroy() { if (root.parentNode) root.parentNode.removeChild(root); } };
}

/**
 * "Reviewed by NAME, who answers for this app" — with what a named review lifts (the visible
 * AI-content label, Art. 50(4)) and what it never lifts (the you-are-talking-to-an-AI notice,
 * Art. 50(1)), and the law linked. The name defaults to the `aimeat-reviewed-by` meta the node
 * stamps on a served app whose owner declared a reviewer; with no name anywhere the line
 * renders nothing, because an unreviewed app must not look reviewed.
 * @param {{ target?: string|Element, name?: string, declaredAt?: string }} [spec]
 * @returns {{ el: HTMLElement, destroy: () => void }}
 */
export function reviewerLine(spec) {
  const s = spec || {};
  const meta = document.querySelector('meta[name="aimeat-reviewed-by"]');
  const name = s.name || (meta && meta.getAttribute('content')) || '';
  const root = el('aside', { class: 'ak-root ak-com ak-com-reviewer', hidden: !name });
  if (name) {
    root.appendChild(el('p', { class: 'ak-com-reviewer__line' }, tc('reviewer.line', { name })));
    root.appendChild(el('p', { class: 'ak-com-reviewer__lifts' }, [
      el('span', {}, tc('reviewer.lifts') + ' '),
      el('a', { href: LAW_URL, target: '_blank', rel: 'noopener noreferrer' }, tc('reviewer.law') + ' →'),
    ]));
  }
  if (s.target) resolve(s.target).appendChild(root);
  if (name) enter(root);
  return { el: root, destroy() { if (root.parentNode) root.parentNode.removeChild(root); } };
}

/**
 * The owner's two switches on the served app — the badge and the browser install offer — read
 * from the owner's own listing and written through the app's settings door (PATCH). Renders
 * nothing without a session, and tells a non-owner the switches are not theirs: the write
 * itself is refused by the node either way; this component just never pretends.
 * @param {{ target?: string|Element, filename?: string,
 *   session?: { ghii?: string, gaii?: string, fetch?: (path: string, opts?: any) => Promise<any> } | null,
 *   title?: string }} spec
 * @returns {{ el: HTMLElement, reload: () => void, destroy: () => void }}
 */
export function marksSwitches(spec) {
  const s = spec || {};
  const root = el('section', { class: 'ak-root ak-com ak-com-marks', hidden: true });
  if (s.target) resolve(s.target).appendChild(root);
  const ref = selfRef(s);
  const session = s.session || null;
  let marks = null;
  let busyNow = false;

  function sessionFetch(path, opts) {
    if (session && typeof session.fetch === 'function') return session.fetch(path, opts).then(function (r) {
      return r && typeof r.json === 'function' ? r.json() : r;
    });
    return Promise.reject(new Error('no session'));
  }

  function switchRow(key) {
    const on = marks[key] !== false;
    return el('div', { class: 'ak-com-marks__row' }, [
      el('span', { class: 'ak-com-marks__name' }, tc('marks.' + key)),
      el('span', { class: 'ak-com-marks__meaning' }, tc('marks.' + key + (on ? 'On' : 'Off'))),
      el('button', { type: 'button', class: 'ak-btn ak-btn--ghost', disabled: busyNow ? true : null, on: {
        click: function () {
          if (busyNow) return;
          busyNow = true; render();
          const next = {}; next[key] = !on;
          sessionFetch('/v1/apps/' + encodeURIComponent(ref.filename), {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ marks: next }),
          }).then(function (res) {
            busyNow = false;
            if (res && res.ok !== false && res.data && res.data.marks) {
              marks = { badge: res.data.marks.badge !== false, install: res.data.marks.install !== false };
            } else if (res && res.error) {
              marks[key] = on; // unchanged; the node refused
            }
            render();
          }, function () { busyNow = false; render(); });
        },
      } }, tc(on ? 'marks.turnOff' : 'marks.turnOn')),
    ]);
  }

  function render() {
    clear(root);
    root.appendChild(el('h3', { class: 'ak-com__title' }, s.title || tc('marks.title')));
    root.appendChild(el('div', {}, [switchRow('badge'), switchRow('install')]));
    root.appendChild(el('p', { class: 'ak-com__intro' }, tc('marks.ownerOnly')));
  }

  function reload() {
    if (!ref || !session) return;
    const who = ownerPart(session.ghii || session.gaii);
    if (!who || who !== ownerPart(ref.owner)) return;
    sessionFetch('/v1/apps?limit=200').then(function (res) {
      const apps = (res && res.data && res.data.apps) || [];
      for (const a of apps) {
        if (a.filename === ref.filename) {
          const m = (a.manifest && a.manifest.marks) || {};
          marks = { badge: m.badge !== false, install: m.install !== false };
          root.hidden = false;
          render();
          enter(root);
          return;
        }
      }
    }, function () { /* not the owner's listing — the section stays hidden */ });
  }
  reload();
  return { el: root, reload, destroy() { if (root.parentNode) root.parentNode.removeChild(root); } };
}

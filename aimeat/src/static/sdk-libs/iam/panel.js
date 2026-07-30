/**
 * @file iam/panel.js
 * @description MemberAdmin — the owner's panel, built as the UNION of the six that already exist on
 *   this node, because no single one of them was complete. Each section below is here because some
 *   app needed it and another app's owner was left without it:
 *
 *     mode switch with its meaning spelled out      — from LÄÄKE; NUOTTA had no mode at all
 *     approve by account name + role                — from both, with the keying help text corrected
 *     applicant queue, real requests or passive     — LÄÄKE has an explicit ask, NUOTTA a visitor log
 *     role changed in place                         — from NUOTTA; promotion and demotion are routine
 *     free-access column ("12 / 12 carried")        — from LÄÄKE; this is the answer to "did the
 *                                                     approval actually work", and NUOTTA ran the
 *                                                     same grant loop while showing nothing
 *     member since                                  — from LÄÄKE
 *     paying customers kept OUT of the queue        — from NUOTTA; a contract holder is not a
 *                                                     pending decision and should never look like one
 *     what a stranger gets                          — from NUOTTA
 *     app's own settings in the same panel          — because LÄÄKE already keeps one there, which
 *                                                     is where owners look for an app's admin
 *
 *   Free access is read generically from GET /v1/exchange/grants?app_id=, so any app that issues
 *   zero-priced grants on approval gets the column without writing it. Paying customers need the
 *   app's own offering ids, which the library cannot know, so that section renders only when the app
 *   supplies a provider — implemented where it can be generic, delegated where it honestly cannot.
 * @structure mountMemberAdmin(iam, target, opts) · mountJoinPanel(iam, target, opts)
 * @usage AIMEAT.iam.MemberAdmin({ target: '#members', appId: 'me/app.html', sections: [...] })
 * @version-history
 *   v1.0.0 — 2026-07-30 — Initial (TARGET-055 phase 1).
 */
import { el, injectPanelStyle, fmtDate } from './dom.js';
import { t, pickLang } from './i18n.js';

const MODES = ['open', 'members-only', 'invite-only'];

/**
 * @typedef {Object} PanelOpts
 * @property {string|Element} target
 * @property {string} [appId]      owner/file.html — enables the free-access column.
 * @property {string} [lang]
 * @property {Record<string,string>} [strings]  Wording overrides.
 * @property {Record<string,string>} [classMap] Neutral hook → the app's own classes.
 * @property {boolean} [styles]    false to inject no stylesheet.
 * @property {Array<{id:string,type:'toggle'|'text',label:string,help?:string,value?:any,onChange:Function}>} [sections]
 * @property {() => Promise<Array<{id:string,label?:string,spend?:string}>>} [payingCustomers]
 */

/**
 * Mount the owner panel. Re-renders itself after every action, and refuses to pretend: when the
 * caller is not an owner it says so instead of drawing an empty console.
 * @param {any} iam   The AIMEAT.iam surface.
 * @param {PanelOpts} opts
 * @returns {{ refresh: () => Promise<void>, destroy: () => void }}
 */
export function mountMemberAdmin(iam, opts) {
  const host = typeof opts.target === 'string' ? document.querySelector(opts.target) : opts.target;
  if (!host) throw new Error('aimeat-iam: MemberAdmin target not found');
  injectPanelStyle(opts.styles);
  const lang = pickLang(opts.lang);
  const S = (k, v) => t(lang, k, v, opts.strings);
  const cls = (hook) => hook + ((opts.classMap && opts.classMap[hook]) ? ' ' + opts.classMap[hook] : '');

  let grants = /** @type {Record<string, { carried: number, total: number, calls: number, units: number, unit: string }>} */ ({});
  let paying = /** @type {Array<{id:string,label?:string,spend?:string}>} */ ([]);

  async function loadGrants() {
    if (!opts.appId) return;
    try {
      const body = await iam.adminFetch('/v1/exchange/grants?app_id=' + encodeURIComponent(opts.appId));
      const rows = (body && body.grants) || [];
      /** @type {Record<string, { carried: number, total: number, calls: number, units: number, unit: string }>} */
      const byConsumer = {};
      for (const g of rows) {
        // The view names these consumer_gaii / state / carried_units; reading `consumer`/`status`
        // finds nothing and makes a working sync look like a broken one.
        const who = String(g.consumer_gaii || g.consumer || '').toLowerCase().split('@')[0].split('#').pop();
        if (!who) continue;
        byConsumer[who] = byConsumer[who] || { carried: 0, total: 0, calls: 0, units: 0, unit: '' };
        byConsumer[who].total += 1;
        if ((g.state || g.status) === 'active') byConsumer[who].carried += 1;
        // What carrying this person has actually COST, from the same answer. The provider is the one
        // paying for a guest list, so the number belongs beside the name rather than in a report.
        byConsumer[who].calls += (g.budget && g.budget.calls) || 0;
        byConsumer[who].units += g.carried_units || 0;
        if (!byConsumer[who].unit) byConsumer[who].unit = g.unit === 'money' ? (g.currency || 'EUR') : 'morsels';
      }
      grants = byConsumer;
    } catch {
      // A missing or refused grants surface is not a reason to hide the roster: the column simply
      // does not appear, which is the truthful rendering of "this app carries nobody".
      grants = {};
    }
  }

  async function loadPaying() {
    if (!opts.payingCustomers) return;
    try { paying = (await opts.payingCustomers()) || []; } catch { paying = []; }
  }

  /**
   * What this member has used, and what carrying them has cost. Rendered only when there is
   * something to say: a member who has not called yet should read as new, not as a zero.
   */
  function usageCell(id) {
    const key = String(id).toLowerCase().split('@')[0].split('#').pop();
    const g = grants[key];
    if (!g || !g.calls) return null;
    const cost = g.unit === 'morsels' ? `${g.units} ${g.unit}` : `${(g.units / 1000000).toFixed(2)} ${g.unit}`;
    return el('span', { cls: cls('aim-iam-muted'), text: S('usage', { n: g.calls, cost: cost }) });
  }

  function grantCell(id) {
    const key = String(id).toLowerCase().split('@')[0].split('#').pop();
    const g = grants[key];
    if (!g || !g.total) return null;
    const done = g.carried === g.total;
    return el('span', {
      cls: cls('aim-iam-badge') + (done ? '' : ' aim-iam-warn'),
      text: done ? S('carried', { n: g.carried, of: g.total }) : S('carriedWarn', { n: g.total - g.carried }),
    });
  }

  async function act(fn) {
    try { await fn(); } catch { /* surfaced by the re-render below */ }
    await render();
  }

  async function render() {
    host.textContent = '';
    const me = iam.me();
    const wrap = el('div', { cls: cls('aim-iam') });
    host.appendChild(wrap);

    if (!me || !me.isOwner) {
      wrap.appendChild(el('p', { cls: cls('aim-iam-empty'), text: S('notOwner') }));
      return;
    }

    const state = await iam.admin('state').catch(() => null);
    const roster = await iam.roster().catch(() => ({ ok: false, members: [] }));
    await loadGrants();
    await loadPaying();

    const roles = (state && state.roles) ? Object.keys(state.roles) : [];
    const defaultRole = (state && state.config && state.config.defaultRole) || null;

    // ── mode ──
    if (me.mode) {
      const next = MODES[(MODES.indexOf(me.mode) + 1) % MODES.length];
      wrap.appendChild(el('section', { cls: cls('aim-iam-sec') }, [
        el('h3', { cls: cls('aim-iam-h'), text: S('whoTitle') }),
        el('div', { cls: cls('aim-iam-form') }, [
          el('span', { cls: cls('aim-iam-muted'), text: S('modeLabel') }),
          el('span', { cls: cls('aim-iam-badge'), text: me.mode }),
          el('button', { cls: cls('aim-iam-btn'), text: S('modeSwitch'), attrs: { type: 'button' },
            on: { click: () => act(() => iam.admin('setMode', { set: next, subject: next })) } }),
        ]),
        el('p', { cls: cls('aim-iam-lead'),
          text: me.mode === 'open' ? S('modeMeaningOpen') : S('modeMeaningMembers') }),
      ]));
    }

    // ── approve ──
    const input = el('input', { attrs: { type: 'text', placeholder: S('approvePlaceholder'), 'aria-label': S('approveTitle') } });
    const roleSel = el('select', { attrs: { 'aria-label': S('colRole') } },
      roles.map((r) => el('option', { text: r, attrs: { value: r } })));
    wrap.appendChild(el('section', { cls: cls('aim-iam-sec') }, [
      el('h3', { cls: cls('aim-iam-h'), text: S('approveTitle') }),
      el('div', { cls: cls('aim-iam-form') }, [
        input,
        roles.length ? roleSel : null,
        el('button', { cls: cls('aim-iam-btn'), text: S('approveBtn'), attrs: { type: 'button' },
          on: { click: () => {
            const id = /** @type {HTMLInputElement} */ (input).value.trim();
            if (!id) return;
            const role = roles.length ? /** @type {HTMLSelectElement} */ (roleSel).value : undefined;
            return act(() => iam.admin('assign', role ? { ghii: id, role, owner: id } : { ghii: id, owner: id }));
          } } }),
      ]),
      el('p', { cls: cls('aim-iam-lead'), text: S('approveHelp') }),
    ]));

    // ── paying customers, kept out of the queue below ──
    if (opts.payingCustomers) {
      const body = [el('h3', { cls: cls('aim-iam-h'), text: S('payingTitle', { n: paying.length }) }),
        el('p', { cls: cls('aim-iam-lead'), text: S('payingLead') })];
      if (!paying.length) body.push(el('p', { cls: cls('aim-iam-empty'), text: S('payingNone') }));
      for (const c of paying) {
        body.push(el('div', { cls: cls('aim-iam-row') }, [
          el('span', { cls: cls('aim-iam-id'), text: c.label || c.id }),
          c.spend ? el('span', { cls: cls('aim-iam-muted'), text: c.spend }) : null,
        ]));
      }
      wrap.appendChild(el('section', { cls: cls('aim-iam-sec') }, body));
    }

    // ── who is waiting: real requests where the shape has them, the visitor log where it does not ──
    const payingIds = new Set(paying.map((p) => String(p.id).toLowerCase().split('@')[0]));
    const pending = collectPending(state).filter((p) => !payingIds.has(String(p.id).toLowerCase().split('@')[0]));
    const isPassive = !state || !state.requests;
    const qBody = [el('h3', { cls: cls('aim-iam-h'), text: isPassive ? S('seenTitle') : S('pendingTitle') })];
    if (!pending.length) {
      qBody.push(el('p', { cls: cls('aim-iam-empty'), text: isPassive ? S('seenNone') : S('pendingNone') }));
    }
    for (const p of pending) {
      qBody.push(el('div', { cls: cls('aim-iam-row') }, [
        el('span', { cls: cls('aim-iam-id'), text: p.id }),
        p.visits ? el('span', { cls: cls('aim-iam-muted'), text: S('visits', { n: p.visits, d: fmtDate(p.lastSeen) }) }) : null,
        el('button', { cls: cls('aim-iam-btn'), text: S('approveBtn'), attrs: { type: 'button' },
          on: { click: () => act(() => iam.admin('assign', { ghii: p.id, owner: p.id, role: roles[roles.length - 1] || undefined, note: p.note })) } }),
        isPassive ? null : el('button', { cls: cls('aim-iam-btn'), text: S('decline'), attrs: { type: 'button' },
          on: { click: () => act(() => iam.admin('decline', { owner: p.id, ghii: p.id })) } }),
        p.note ? el('span', { cls: cls('aim-iam-note'), text: p.note }) : null,
      ]));
    }
    wrap.appendChild(el('section', { cls: cls('aim-iam-sec') }, qBody));

    // ── the roster ──
    const mBody = [el('h3', { cls: cls('aim-iam-h'), text: S('membersTitle') + ': ' + roster.members.length })];
    if (!roster.members.length) mBody.push(el('p', { cls: cls('aim-iam-empty'), text: S('membersNone') }));
    for (const m of roster.members) {
      const sel = roles.length ? el('select', { attrs: { 'aria-label': S('colRole') } },
        roles.map((r) => el('option', { text: r, attrs: Object.assign({ value: r }, r === m.role ? { selected: 'selected' } : {}) }))) : null;
      if (sel) sel.addEventListener('change', () => act(() => iam.admin('assign',
        { ghii: m.id, owner: m.id, role: /** @type {HTMLSelectElement} */ (sel).value })));
      mBody.push(el('div', { cls: cls('aim-iam-row') }, [
        el('span', { cls: cls('aim-iam-id'), text: m.id }),
        // The select IS the role display when there is one. Showing a badge beside it repeats the
        // same word twice and, at 390px, costs a whole row per member for nothing.
        (!sel && m.role) ? el('span', { cls: cls('aim-iam-badge'), text: m.role }) : null,
        m.since ? el('span', { cls: cls('aim-iam-muted'), text: fmtDate(m.since) }) : null,
        grantCell(m.id),
        usageCell(m.id),
        sel,
        el('button', { cls: cls('aim-iam-btn'), text: S('remove'), attrs: { type: 'button' },
          on: { click: () => act(() => iam.admin('revoke', { ghii: m.id, owner: m.id })) } }),
      ]));
    }
    wrap.appendChild(el('section', { cls: cls('aim-iam-sec') }, mBody));

    // ── the app's own settings, in the panel owners already open ──
    if (opts.sections && opts.sections.length) {
      const sBody = [el('h3', { cls: cls('aim-iam-h'), text: S('settingsTitle') })];
      for (const s of opts.sections) {
        const ctrl = s.type === 'toggle'
          ? el('button', { cls: cls('aim-iam-btn'), text: s.value ? 'on' : 'off', attrs: { type: 'button' },
              on: { click: () => act(async () => { await s.onChange(!s.value); s.value = !s.value; }) } })
          : el('input', { attrs: { type: 'text', value: s.value == null ? '' : String(s.value) },
              on: { change: (e) => s.onChange(/** @type {HTMLInputElement} */ (e.target).value) } });
        sBody.push(el('div', { cls: cls('aim-iam-row') }, [
          el('span', { cls: cls('aim-iam-id'), text: s.label }),
          ctrl,
          s.help ? el('span', { cls: cls('aim-iam-note'), text: s.help }) : null,
        ]));
      }
      wrap.appendChild(el('section', { cls: cls('aim-iam-sec') }, sBody));
    }

    // ── what a stranger gets ──
    wrap.appendChild(el('section', { cls: cls('aim-iam-sec') }, [
      el('h3', { cls: cls('aim-iam-h'), text: S('strangerTitle') }),
      el('p', { cls: cls('aim-iam-lead'),
        text: defaultRole ? S('strangerRole', { role: defaultRole }) : S('strangerDeny') }),
    ]));
  }

  render();
  return { refresh: render, destroy: () => { host.textContent = ''; } };
}

/**
 * Normalise "who is waiting" across the shapes: an explicit request list, or a passive visitor log
 * keyed by identity. Both end up as one row type so the panel has a single code path.
 * @param {any} state
 * @returns {Array<{ id: string, note?: string, visits?: number, lastSeen?: string }>}
 */
function collectPending(state) {
  if (!state) return [];
  if (Array.isArray(state.requests)) {
    return state.requests.map((r) => ({ id: r.owner || r.gaii || r.id, note: r.note, lastSeen: r.at }));
  }
  const seen = state.seen || {};
  return Object.keys(seen).map((id) => ({ id, visits: seen[id].visits, lastSeen: seen[id].lastSeen }));
}

/**
 * The applicant's side. Where the extension has no request action this says the visit was already
 * recorded, rather than offering a button that sends nothing.
 * @param {any} iam
 * @param {{ target: string|Element, lang?: string, strings?: Record<string,string>, classMap?: Record<string,string>, styles?: boolean }} opts
 * @returns {{ destroy: () => void }}
 */
export function mountJoinPanel(iam, opts) {
  const host = typeof opts.target === 'string' ? document.querySelector(opts.target) : opts.target;
  if (!host) throw new Error('aimeat-iam: JoinPanel target not found');
  injectPanelStyle(opts.styles);
  const lang = pickLang(opts.lang);
  const S = (k, v) => t(lang, k, v, opts.strings);
  const cls = (hook) => hook + ((opts.classMap && opts.classMap[hook]) ? ' ' + opts.classMap[hook] : '');

  host.textContent = '';
  const out = el('p', { cls: cls('aim-iam-lead') });
  const note = el('input', { attrs: { type: 'text', placeholder: S('joinNote'), 'aria-label': S('joinNote') } });
  const btn = el('button', { cls: cls('aim-iam-btn'), text: S('joinBtn'), attrs: { type: 'button' } });
  btn.addEventListener('click', async () => {
    try {
      const r = await iam.request(/** @type {HTMLInputElement} */ (note).value.trim());
      out.textContent = r.alreadyMember ? S('joinAlready') : (r.passive ? S('joinPassive') : S('joinSent'));
    } catch { out.textContent = S('failed'); }
  });
  host.appendChild(el('section', { cls: cls('aim-iam') }, [
    el('h3', { cls: cls('aim-iam-h'), text: S('joinTitle') }),
    el('div', { cls: cls('aim-iam-form') }, [note, btn]),
    out,
  ]));
  return { destroy: () => { host.textContent = ''; } };
}

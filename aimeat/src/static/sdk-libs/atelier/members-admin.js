/**
 * @file atelier/members-admin.js
 * @description members(): the owner's member screen, and a manager's (a member whose role the plan
 *   lists in manageRoles). Drawn over AIMEAT.iam; fetches nothing itself.
 *
 *   One screen, groups as tabs: who asked for access, who opened the app with no role, the members,
 *   open email invitations, the history, the plan (owner only), paying customers and the app's own
 *   settings when the app supplies them. Adding somebody takes a name from the owner's address book
 *   (iam.people, the app's token needs contacts:read), an account name, or an email address: an
 *   address nobody holds yet becomes an invitation. Raising a member to a role with more power asks
 *   first and says what the role may do; lowering does not. A refused action shows the node's reason
 *   and keeps what was typed.
 *
 *   EXTENSION POINTS, so an app grows the screen instead of copying it: `columns(member)` adds the
 *   app's own facts to a row, `actions` adds the app's own buttons to a member row, `sections` puts
 *   the app's settings in a tab, `payingCustomers` lists contract holders apart from the queue,
 *   `groups` picks the tabs, `pageSize` pages long lists, `variant` picks the look.
 * @parts members root · title · intro · faces · tabs · search · failure · asked · seen · roster · invites · history · plan · settings · paying · row · who · meta · acts · add · suggest · stranger · more
 * @slots members columns(member) · actions[{ label, run(member), tone? }] · sections[{ id, type, label, help?, value, onChange }]
 * @variants members list · table · dense
 * @tokens members --ak-mem-width
 * @fork members Copying it out means calling AIMEAT.iam's admin(), roster(), invite(), invites(), audit(), people(), plan() and setPlan() yourself, and keeping the one-click role (suggestRole), the confirm on a raise and the refusal sentence.
 * @structure members(spec)
 * @usage
 *   AIMEAT.atelier.members({ target: '#members', app: 'me/club.html', roles: { member: ['use'], admin: ['use', 'manage'] } });
 *   AIMEAT.atelier.members({ target, app, roles, variant: 'table', columns: (m) => m.role === 'admin' ? 'keys' : '', actions: [{ label: 'Message', run: (m) => open(m) }] });
 * @version-history
 *   v0.61.0 — 2026-10-01 — Initial: the members screen moved here from members.js and rebuilt on
 *     Jouni's review: tabs, display names, add from the address book or by email with invitations,
 *     confirm on a raise, history, the plan, managers, extension points, list and table variants.
 */
import { el, clear, resolve, enter } from './dom.js';
import { tm } from './members-i18n.js';
import {
  wantsSample, sampleBadge, watch, ask, ready, refusal, day, power, roleSelect, person,
} from './members-shared.js';

// ── The sample ───────────────────────────────────────────────────────────────────────────────

const SAMPLE = {
  roles: { member: ['use'], admin: ['use', 'manage'] },
  requests: [{ owner: 'kim', displayName: 'Kim Laine', email: 'kim.laine@example.com', note: 'I run the bakery next door and order every week.', at: '2026-09-29T08:12:00Z' }],
  seen: { alex: { visits: 3, lastSeen: '2026-09-30T17:40:00Z', displayName: 'Alex Berg', email: null } },
  members: [
    { owner: 'jouni', displayName: 'Jouni Miikki', email: 'jouni.miikki@aimeat.io', role: 'admin', since: '2026-07-01T09:00:00Z' },
    { owner: 'robin', displayName: 'Robin Aho', email: 'robin.aho@example.com', role: 'member', since: '2026-08-12T10:00:00Z' },
  ],
  invites: [{ id: 'i1', emailShown: 'pia@example.com', role: 'member', at: '2026-09-30T09:00:00Z', expiresAt: '2026-10-30T09:00:00Z' }],
  audit: [
    { at: '2026-09-30T09:00:00Z', by: 'jouni', action: 'invite.sent', account: null, detail: { email: 'pia@example.com' }, to: 'member' },
    { at: '2026-08-12T10:00:00Z', by: 'jouni', action: 'member.approved', account: 'robin', to: 'member' },
  ],
  plan: { access: 'members-free', rosterVisibility: 'owner', manageRoles: ['admin'], seats: {}, terms: {}, roles: {} },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The owner's (or a manager's) member screen.
 * @param {{ target?: string|Element, app: string, roles?: string[]|Record<string, string[]>,
 *   approveRole?: string, title?: string, sample?: boolean, variant?: 'list'|'table'|'dense',
 *   groups?: string[], pageSize?: number, columns?: (m: any) => (string|Node|null),
 *   actions?: Array<{ label: string, run: (m: any) => any, tone?: string }>,
 *   sections?: Array<{ id: string, type: 'toggle'|'text', label: string, help?: string, value?: any, onChange: (v: any) => any }>,
 *   payingCustomers?: () => Promise<Array<{ id: string, label?: string, spend?: string }>> }} spec
 * @returns {{ el: HTMLElement, refresh: () => Promise<void>, destroy: () => void }}
 */
export function members(spec) {
  const sample = wantsSample(spec);
  const variant = spec.variant === 'table' ? 'table' : (spec.variant === 'dense' ? 'dense' : 'list');
  const root = el('section', { class: 'ak-root ak-mem ak-mem--' + variant, 'data-ak-part': 'root', 'data-ak-variant': variant });
  if (spec.target) resolve(spec.target).appendChild(root);
  const pageSize = Math.max(5, Math.min(500, spec.pageSize || 50));
  let tab = '';
  let failure = '';
  let notice = '';
  let typed = '';
  let query = '';
  let shown = pageSize;

  async function act(work, done) {
    failure = ''; notice = '';
    try {
      const r = await work();
      failure = refusal(r);
      if (!failure && done) notice = done(r) || '';
    } catch (e) {
      failure = refusal(e) || String(e);
    }
    await render();
  }

  function button(label, tone, run, disabled) {
    return el('button', { type: 'button', class: 'ak-btn ak-btn--' + tone, disabled: disabled ? true : null, on: { click: run } }, label);
  }

  /** The rows a group draws, filtered by the search field and cut to the page. */
  function visible(rows, text) {
    const q = query.trim().toLowerCase();
    const hit = q ? rows.filter(function (r) { return text(r).toLowerCase().indexOf(q) !== -1; }) : rows;
    return { rows: hit.slice(0, shown), more: hit.length - Math.min(hit.length, shown) };
  }

  function list(part, rows, none, more) {
    const host = el('div', { class: 'ak-mem__group', 'data-ak-part': part });
    if (!rows.length) host.appendChild(el('p', { class: 'ak-mem__none' }, none));
    else host.appendChild(el('ul', { class: 'ak-mem__rows' }, rows));
    if (more > 0) {
      host.appendChild(el('button', { type: 'button', class: 'ak-btn ak-btn--ghost ak-mem__more', 'data-ak-part': 'more', on: {
        click: function () { shown += pageSize; render(); },
      } }, tm('members.more', { n: more })));
    }
    return host;
  }

  function row(who, meta, acts, extra) {
    return el('li', { class: 'ak-mem__row', 'data-ak-part': 'row' }, [
      who,
      el('span', { class: 'ak-mem__meta', 'data-ak-part': 'meta' }, [meta || '', extra || null].filter(Boolean)),
      el('span', { class: 'ak-mem__acts', 'data-ak-part': 'acts' }, acts.filter(Boolean)),
    ]);
  }

  function columnsOf(m) {
    if (typeof spec.columns !== 'function') return null;
    const v = spec.columns(m);
    if (v == null || v === '') return null;
    return typeof v === 'string' ? el('span', { class: 'ak-mem__col' }, v) : v;
  }

  async function render() {
    clear(root);
    let iam = null;
    let st = SAMPLE;
    let me = { isOwner: true, canManage: true };
    let auditRows = SAMPLE.audit;
    let plan = SAMPLE.plan;
    root.appendChild(el('h3', { class: 'ak-mem__title', 'data-ak-part': 'title' },
      [spec.title || tm('members.title'), sample ? sampleBadge() : null].filter(Boolean)));
    root.appendChild(el('p', { class: 'ak-mem__intro', 'data-ak-part': 'intro' }, sample ? tm('sample.note') : tm('members.intro')));

    if (!sample) {
      iam = await ready(spec);
      if (!iam) { root.appendChild(el('p', { class: 'ak-mem__none' }, tm('members.noLib'))); return; }
      me = iam.me();
      if (!me || !(me.isOwner || me.canManage)) { root.appendChild(el('p', { class: 'ak-mem__none' }, tm('members.notOwner'))); return; }
      st = await iam.admin('state').catch(function () { return null; }) || { roles: {}, requests: [], seen: {}, members: [], invites: [] };
      if (!Array.isArray(st.members)) {
        // An extension that keeps its own roster answers it through roster(), one row shape for all.
        const r = await iam.roster().catch(function () { return { members: [] }; });
        st = Object.assign({}, st, { members: (r.members || []).map(function (m) { return { owner: m.id, role: m.role, since: m.since }; }) });
      }
    }

    const caps = st.roles || {};
    const roles = Object.keys(caps);
    const oneClick = sample ? 'member' : iam.suggestRole(st, spec.approveRole);
    const asked = (st.requests || []).map(function (q) { return { owner: q.owner || q.gaii || q.id, displayName: q.displayName, email: q.email, note: q.note, at: q.at }; });
    const seenMap = st.seen || {};
    const seen = Object.keys(seenMap).map(function (who) { return Object.assign({ owner: who }, seenMap[who] || {}); });
    const roster = (st.members || []).filter(function (m) { return m && m.role; });
    const invites = st.invites || [];
    const total = st.total || {};
    const groups = (spec.groups || ['asked', 'seen', 'members', 'invites', 'history', 'plan', 'paying', 'settings']).filter(function (g) {
      if (g === 'plan') return !!me.isOwner;
      if (g === 'paying') return typeof spec.payingCustomers === 'function';
      if (g === 'settings') return !!(spec.sections && spec.sections.length);
      return true;
    });
    const count = {
      asked: total.requests != null ? total.requests : asked.length,
      seen: total.seen != null ? total.seen : seen.length,
      members: total.members != null ? total.members : roster.length,
      invites: total.invites != null ? total.invites : invites.length,
    };
    if (!tab || groups.indexOf(tab) === -1) tab = count.asked ? 'asked' : (groups.indexOf('members') !== -1 ? 'members' : groups[0]);

    // The faces of the members, so the screen says who is in before anything is opened.
    if (roster.length) {
      const faces = roster.slice(0, 8).map(function (m) {
        const shownName = m.displayName || m.owner;
        return el('span', { class: 'ak-mem__face', title: shownName }, String(shownName).slice(0, 1).toUpperCase());
      });
      if (roster.length > 8) faces.push(el('span', { class: 'ak-mem__face ak-mem__face--more' }, '+' + (roster.length - 8)));
      root.appendChild(el('div', { class: 'ak-mem__faces', 'data-ak-part': 'faces', 'aria-label': tm('members.roster') + ': ' + count.members }, faces));
    }

    if (failure) root.appendChild(el('p', { class: 'ak-mem__failure', role: 'alert', 'data-ak-part': 'failure' }, tm('members.failed', { why: failure })));
    if (notice) root.appendChild(el('p', { class: 'ak-mem__notice', role: 'status' }, notice));

    // ── The tabs ──
    const tabs = el('div', { class: 'ak-mem__tabs', role: 'tablist', 'data-ak-part': 'tabs' }, groups.map(function (g) {
      const n = count[g];
      return el('button', {
        type: 'button', role: 'tab', class: 'ak-mem__tab' + (g === tab ? ' is-on' : ''), 'aria-selected': g === tab ? 'true' : 'false',
        on: { click: function () { tab = g; shown = pageSize; failure = ''; notice = ''; render(); } },
      }, tm('tab.' + g) + (typeof n === 'number' && n ? ' (' + n + ')' : ''));
    }));
    root.appendChild(tabs);

    const listTab = ['asked', 'seen', 'members', 'invites'].indexOf(tab) !== -1;
    if (listTab) {
      const search = /** @type {HTMLInputElement} */ (el('input', {
        type: 'search', class: 'ak-input ak-mem__search', placeholder: tm('members.search'), 'aria-label': tm('members.search'),
        value: query, 'data-ak-part': 'search',
      }));
      search.addEventListener('input', function () { query = search.value; shown = pageSize; drawBody(); });
      root.appendChild(search);
    }
    const body = el('div', { class: 'ak-mem__body' });
    root.appendChild(body);

    const noop = function () { /* the sample changes nothing */ };
    const assign = function (who, roleOf, note) {
      return sample ? noop : function () {
        act(function () { return iam.admin('assign', { ghii: who, owner: who, role: roleOf(), note: note }); });
      };
    };

    function changeRole(m, sel) {
      const next = sel.value;
      if (sample || next === m.role) return;
      const raising = power(caps, next) > power(caps, m.role);
      const go = function () { act(function () { return iam.admin('assign', { ghii: m.owner, owner: m.owner, role: next }); }); };
      if (!raising) { go(); return; }
      const may = caps[next] || [];
      ask({
        title: tm('members.raise', { who: m.displayName || m.owner, role: next }),
        text: may.indexOf('*') !== -1 ? tm('members.raiseAll') : tm('members.raiseText', { caps: may.join(', ') }),
        confirmLabel: tm('members.raiseYes'),
      }).then(function (yes) { if (yes) go(); else sel.value = m.role; });
    }

    function drawBody() {
      clear(body);
      if (tab === 'asked') {
        const v = visible(asked, function (q) { return q.owner + ' ' + (q.displayName || '') + ' ' + (q.email || '') + ' ' + (q.note || ''); });
        body.appendChild(list('asked', v.rows.map(function (q) {
          const sel = roles.length > 1 ? roleSelect(roles, oneClick, tm('members.role')) : null;
          if (sel) sel.disabled = sample;
          return row(person(q.owner, q.displayName, q.email), q.note || '', [
            sel,
            button(tm('members.approve'), 'primary', assign(q.owner, function () { return sel ? sel.value : oneClick; }, q.note), sample),
            button(tm('members.decline'), 'ghost', sample ? noop : function () {
              act(function () { return iam.admin('decline', { ghii: q.owner, owner: q.owner }); });
            }, sample),
          ]);
        }), tm('members.askedNone'), v.more));
      } else if (tab === 'seen') {
        const v = visible(seen, function (s) { return s.owner + ' ' + (s.displayName || '') + ' ' + (s.email || ''); });
        body.appendChild(list('seen', v.rows.map(function (s) {
          const sel = roles.length > 1 ? roleSelect(roles, oneClick, tm('members.role')) : null;
          if (sel) sel.disabled = sample;
          const visits = s.visits ? tm(s.visits === 1 ? 'members.visit1' : 'members.visits', { n: s.visits, d: day(s.lastSeen) }) : '';
          return row(person(s.owner, s.displayName, s.email), visits, [
            sel,
            button(tm('members.approve'), 'primary', assign(s.owner, function () { return sel ? sel.value : oneClick; }), sample),
            button(tm('members.dismiss'), 'ghost', sample ? noop : function () { act(function () { return iam.dismissGuest(s.owner); }); }, sample),
          ]);
        }), tm('members.seenNone'), v.more));
      } else if (tab === 'members') {
        body.appendChild(addPanel());
        const v = visible(roster, function (m) { return m.owner + ' ' + (m.displayName || '') + ' ' + (m.email || '') + ' ' + m.role; });
        const rows = v.rows.map(function (m) {
          const sel = roleSelect(roles.indexOf(m.role) === -1 ? roles.concat([m.role]) : roles, m.role, tm('members.role'));
          sel.disabled = sample;
          sel.addEventListener('change', function () { changeRole(m, sel); });
          const own = (spec.actions || []).map(function (a) {
            return button(a.label, a.tone || 'ghost', function () { Promise.resolve(a.run(m)).then(function () { render(); }); }, sample);
          });
          const since = m.since ? (variant === 'table' ? day(m.since) : tm('members.since', { d: day(m.since) })) : '';
          return row(person(m.owner, m.displayName, m.email), since, own.concat([
            sel,
            button(tm('members.remove'), 'ghost', sample ? noop : function () {
              ask({
                title: tm('members.confirmRemove', { who: m.displayName || m.owner }), text: tm('members.confirmRemoveText'),
                confirmLabel: tm('members.remove'), tone: 'danger',
              }).then(function (yes) {
                if (yes) act(function () { return iam.admin('revoke', { ghii: m.owner, owner: m.owner }); });
              });
            }, sample),
          ]), columnsOf(m));
        });
        body.appendChild(variant === 'table' ? table(v.rows, rows, v.more) : list('roster', rows, tm('members.rosterNone'), v.more));
      } else if (tab === 'invites') {
        body.appendChild(addPanel());
        const v = visible(invites, function (i) { return (i.emailShown || '') + ' ' + i.role; });
        body.appendChild(list('invites', v.rows.map(function (i) {
          return row(person(i.emailShown || '', null), tm('members.invited', { role: i.role, d: day(i.at), until: day(i.expiresAt) }), [
            button(tm('members.cancelInvite'), 'ghost', sample ? noop : function () {
              act(function () { return iam.cancelInvite(i.id); }, function () { return tm('members.inviteCancelled', { email: i.emailShown || '' }); });
            }, sample),
          ]);
        }), tm('members.invitesNone'), v.more));
      } else if (tab === 'history') {
        body.appendChild(el('p', { class: 'ak-mem__none' }, tm('members.loading')));
        (sample ? Promise.resolve(auditRows) : iam.audit({ limit: 100 })).then(function (rows) {
          clear(body);
          const list0 = Array.isArray(rows) ? rows : [];
          body.appendChild(list('history', list0.map(function (h) {
            return el('li', { class: 'ak-mem__row ak-mem__row--line', 'data-ak-part': 'row' }, [
              el('span', { class: 'ak-mem__when' }, day(h.at)),
              el('span', { class: 'ak-mem__meta' }, tm('history.' + h.action, {
                by: String(h.by || '').split('#').pop().split('@')[0], who: h.account || (h.detail && h.detail.email) || tm('history.noAddress'),
                from: h.from || '', to: h.to || '',
              })),
            ]);
          }), tm('members.historyNone'), 0));
        });
      } else if (tab === 'plan') {
        body.appendChild(el('p', { class: 'ak-mem__none' }, tm('members.loading')));
        (sample ? Promise.resolve(plan) : iam.plan()).then(function (p) {
          clear(body);
          body.appendChild(planForm(p && p.ok !== false ? p : null));
        });
      } else if (tab === 'paying') {
        body.appendChild(el('p', { class: 'ak-mem__none' }, tm('members.loading')));
        Promise.resolve(spec.payingCustomers ? spec.payingCustomers() : []).then(function (rows) {
          clear(body);
          body.appendChild(list('paying', (rows || []).map(function (c) {
            return row(person(c.label || c.id, null), c.spend || '', []);
          }), tm('members.payingNone'), 0));
        });
      } else if (tab === 'settings') {
        body.appendChild(settings());
      }
    }

    function table(models, rows, more) {
      const t = el('table', { class: 'ak-mem__table', 'data-ak-part': 'roster' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { scope: 'col' }, tm('members.colName')),
          el('th', { scope: 'col' }, tm('members.colSince')),
          el('th', { scope: 'col' }, tm('members.colActions')),
        ])]),
        el('tbody', {}, rows.map(function (r) {
          const cells = Array.prototype.slice.call(r.children);
          return el('tr', {}, cells.map(function (c) { return el('td', {}, [c]); }));
        })),
      ]);
      const host = el('div', { class: 'ak-mem__group ak-mem__table-wrap' }, [models.length ? t : el('p', { class: 'ak-mem__none' }, tm('members.rosterNone'))]);
      if (more > 0) {
        host.appendChild(el('button', { type: 'button', class: 'ak-btn ak-btn--ghost ak-mem__more', on: {
          click: function () { shown += pageSize; render(); },
        } }, tm('members.more', { n: more })));
      }
      return host;
    }

    // ── Adding somebody: the address book, an account name, or an email address ──
    function addPanel() {
      const input = /** @type {HTMLInputElement} */ (el('input', {
        type: 'text', class: 'ak-input ak-mem__name', placeholder: tm('members.addPlaceholder'),
        'aria-label': tm('members.addPlaceholder'), disabled: sample ? true : null, autocomplete: 'off',
      }));
      if (failure && typed) input.value = typed;
      const roleSel = roles.length > 1 ? roleSelect(roles, oneClick, tm('members.role')) : null;
      if (roleSel) roleSel.disabled = sample;
      const suggest = el('ul', { class: 'ak-mem__suggest', 'data-ak-part': 'suggest', hidden: true, role: 'listbox' });
      const go = button(tm('members.approve'), 'primary', sample ? noop : function () {
        const value = input.value.trim();
        typed = value;
        if (!value) return;
        const role = roleSel ? roleSel.value : oneClick;
        if (EMAIL_RE.test(value)) {
          act(function () { return iam.invite(value, role); }, function (r) {
            const d = r && r.data !== undefined ? r.data : r;
            if (d && d.invited) return tm('members.inviteSent', { email: value });
            if (d && d.found) return tm('members.addedFound', { who: d.found.displayName || d.found.account });
            return '';
          });
        } else {
          act(function () { return iam.admin('assign', { ghii: value, owner: value, role: role }); });
        }
      }, sample);
      if (EMAIL_RE.test(input.value.trim())) go.textContent = tm('members.invite');
      let timer = 0;
      input.addEventListener('input', function () {
        go.textContent = EMAIL_RE.test(input.value.trim()) ? tm('members.invite') : tm('members.approve');
        clearTimeout(timer);
        const q = input.value.trim();
        if (sample || q.length < 2 || EMAIL_RE.test(q)) { suggest.hidden = true; return; }
        timer = window.setTimeout(function () {
          iam.people(q).then(function (people) {
            clear(suggest);
            const found = Array.isArray(people) ? people.slice(0, 6) : [];
            suggest.hidden = !found.length;
            found.forEach(function (p) {
              suggest.appendChild(el('li', { role: 'option' }, [el('button', { type: 'button', class: 'ak-mem__pick', on: {
                click: function () {
                  input.value = p.account || p.email || '';
                  go.textContent = EMAIL_RE.test(input.value) ? tm('members.invite') : tm('members.approve');
                  suggest.hidden = true;
                  input.focus();
                },
              } }, [person(p.account || p.email || '', p.displayName), p.account ? null : el('span', { class: 'ak-mem__meta' }, tm('members.noAccount'))].filter(Boolean))]));
            });
          }, function () { suggest.hidden = true; });
        }, 250);
      });
      return el('div', { class: 'ak-mem__group', 'data-ak-part': 'add' }, [
        el('h4', { class: 'ak-mem__group-title' }, tm('members.add')),
        el('div', { class: 'ak-mem__add' }, [el('div', { class: 'ak-mem__field' }, [input, suggest]), roleSel, go].filter(Boolean)),
        el('p', { class: 'ak-mem__hint' }, tm('members.addHint')),
      ]);
    }

    // ── The plan: who gets in, how many, for how long, who manages ──
    function planForm(p) {
      const cur = p || { roles: {}, seats: {}, terms: {}, manageRoles: [], access: 'members-free', rosterVisibility: 'owner' };
      const opt = function (v) { return tm('plan.opt.' + v); };
      const access = roleSelect(['members-free', 'free', 'members-only'], cur.access === 'open' ? 'members-free' : (cur.access || 'members-free'), tm('plan.access'), opt);
      access.classList.add('ak-mem__plan-access');
      const vis = roleSelect(['owner', 'members'], cur.rosterVisibility || 'owner', tm('plan.visibility'), opt);
      const rows = roles.map(function (r) {
        const seats = /** @type {HTMLInputElement} */ (el('input', { type: 'number', min: '0', class: 'ak-input ak-mem__num', 'aria-label': tm('plan.seats') + ' ' + r,
          value: cur.seats && cur.seats[r] != null ? String(cur.seats[r]) : '', placeholder: tm('plan.noLimit') }));
        const days = /** @type {HTMLInputElement} */ (el('input', { type: 'number', min: '1', class: 'ak-input ak-mem__num', 'aria-label': tm('plan.days') + ' ' + r,
          value: cur.terms && cur.terms[r] && cur.terms[r].days ? String(cur.terms[r].days) : '', placeholder: tm('plan.noEnd') }));
        const mgr = /** @type {HTMLInputElement} */ (el('input', { type: 'checkbox', 'aria-label': tm('plan.manages') + ' ' + r,
          checked: (cur.manageRoles || []).indexOf(r) !== -1 ? true : null }));
        return { r: r, seats: seats, days: days, mgr: mgr, node: el('tr', {}, [
          el('th', { scope: 'row' }, r), el('td', {}, [seats]), el('td', {}, [days]), el('td', {}, [mgr]),
        ]) };
      });
      const save = button(tm('plan.save'), 'primary', sample ? noop : function () {
        const seats = {}; const terms = {}; const manageRoles = [];
        rows.forEach(function (x) {
          if (x.seats.value !== '') seats[x.r] = Number(x.seats.value);
          if (x.days.value !== '') terms[x.r] = { days: Number(x.days.value) };
          if (x.mgr.checked) manageRoles.push(x.r);
        });
        act(function () {
          return iam.setPlan({ roles: cur.roles || {}, access: access.value, rosterVisibility: vis.value, seats: seats, terms: terms, manageRoles: manageRoles });
        }, function () { return tm('plan.saved'); });
      }, sample);
      return el('div', { class: 'ak-mem__group ak-mem__plan', 'data-ak-part': 'plan' }, [
        el('label', { class: 'ak-mem__plan-row' }, [el('span', {}, tm('plan.access')), access]),
        el('p', { class: 'ak-mem__hint' }, tm('plan.accessHint')),
        el('label', { class: 'ak-mem__plan-row' }, [el('span', {}, tm('plan.visibility')), vis]),
        el('table', { class: 'ak-mem__table' }, [
          el('thead', {}, [el('tr', {}, [el('th', { scope: 'col' }, tm('members.role')), el('th', { scope: 'col' }, tm('plan.seats')),
            el('th', { scope: 'col' }, tm('plan.days')), el('th', { scope: 'col' }, tm('plan.manages'))])]),
          el('tbody', {}, rows.map(function (x) { return x.node; })),
        ]),
        save,
      ]);
    }

    function settings() {
      return el('div', { class: 'ak-mem__group', 'data-ak-part': 'settings' }, (spec.sections || []).map(function (s) {
        const ctrl = s.type === 'toggle'
          ? el('button', { type: 'button', class: 'ak-btn ak-btn--ghost', 'aria-pressed': s.value ? 'true' : 'false', on: {
            click: function () { act(async function () { await s.onChange(!s.value); s.value = !s.value; }); },
          } }, s.value ? tm('settings.on') : tm('settings.off'))
          : el('input', { type: 'text', class: 'ak-input', value: s.value == null ? '' : String(s.value), 'aria-label': s.label, on: {
            change: function (e) { act(function () { return s.onChange(/** @type {HTMLInputElement} */ (e.target).value); }); },
          } });
        return el('div', { class: 'ak-mem__row ak-mem__row--line' }, [
          el('span', { class: 'ak-mem__name' }, s.label), ctrl, s.help ? el('span', { class: 'ak-mem__meta' }, s.help) : null,
        ].filter(Boolean));
      }));
    }

    drawBody();
    root.appendChild(el('p', { class: 'ak-mem__stranger', 'data-ak-part': 'stranger' }, tm('members.stranger')));
  }

  const ready0 = render().then(function () { enter(root); });
  const stop = watch(function () { failure = ''; notice = ''; render(); }, root);
  return {
    el: root,
    refresh: function () { return ready0.then(render); },
    destroy: function () { stop(); if (root.parentNode) root.parentNode.removeChild(root); },
  };
}

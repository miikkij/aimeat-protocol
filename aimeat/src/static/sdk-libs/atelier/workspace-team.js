/**
 * @file atelier/workspace-team.js
 * @description workspaceTeam(): who may open one workspace of an organism (IAM plan Phase D block
 *   2). Three tabs: the access requests waiting for a decision (approve with a role, or decline),
 *   the people who hold a role (change it, or remove them), and an invite field that takes an
 *   account name (the role is granted at once) or an email address (an invitation into the
 *   organism with this role in this workspace). The workspace's creator is shown first, marked, and
 *   cannot be removed. A raise from viewer to contributor asks first; a lowering does not. A refused
 *   action shows the node's own sentence at the top and keeps what was typed.
 *
 *   WHAT FETCHES AND WHY. The kit renders; it does not fetch. Every read and write goes through
 *   AIMEAT.organism (access, decide, grant, revoke, inviteByEmail), feature-detected on the page;
 *   without it the block says what is missing.
 *
 *   THE SAMPLE STATE. `sample: true`, or an org or ws that is still a fill's <placeholder>, draws
 *   marked sample people and changes nothing.
 * @parts workspaceTeam root · title · intro · failure · notice · tabs · requests · people · invite · row · who · meta · acts · role · chip
 * @slots workspaceTeam columns(member) · actions[{ label, run(member), tone? }]
 * @variants workspaceTeam list · table
 * @tokens workspaceTeam --ak-mem-width
 * @fork workspaceTeam Copying it out means calling AIMEAT.organism's access(), decide(), grant(), revoke() and inviteByEmail() yourself, and keeping the creator unremovable, the confirm on a raise to contributor and the refusal sentence.
 * @structure workspaceTeam(spec) · roleSel · the sample
 * @usage
 *   AIMEAT.atelier.workspaceTeam({ target: '#team', org: orgId, ws: wsId });
 *   AIMEAT.atelier.workspaceTeam({ target, org, ws, variant: 'table', actions: [{ label: 'Message', run: (m) => open(m.account) }] });
 * @version-history
 *   v0.61.0 — 2026-10-01 — Initial (IAM plan Phase D block 2).
 */
import { el, clear, resolve, enter } from './dom.js';
import { tw } from './workspace-i18n.js';
import { isPlaceholder, sampleBadge, watch, ask, refusal, day, person } from './members-shared.js';

const SAMPLE = {
  members: [
    { account: 'robin', displayName: 'Robin Aho', role: 'creator', since: '2026-06-02T09:00:00Z' },
    { account: 'sam', displayName: 'Sam Koski', role: 'contributor', since: '2026-07-01T09:00:00Z' },
    { account: 'alex', displayName: 'Alex Berg', role: 'viewer', since: '2026-08-12T10:00:00Z' },
  ],
  requests: [
    { account: 'kim', displayName: 'Kim Laine', message: 'I keep the order book and would like to read the plans.', at: '2026-09-29T08:12:00Z', status: 'pending', role: null },
  ],
};

const ROLES = ['viewer', 'contributor'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The page's AIMEAT.organism when it carries the workspace-access methods, or null. */
function orgLib() {
  const ns = /** @type {any} */ (window).AIMEAT;
  const o = ns && ns.organism;
  return o && typeof o.access === 'function' && typeof o.grant === 'function' && typeof o.revoke === 'function'
    && typeof o.decide === 'function' ? o : null;
}

/** Whether a session is open on the page (AIMEAT.auth.getSession answers one). */
function signedIn() {
  const ns = /** @type {any} */ (window).AIMEAT;
  const auth = ns && ns.auth;
  if (!auth || typeof auth.getSession !== 'function') return false;
  try { return !!auth.getSession(); } catch { return false; }
}

/**
 * A role select with the roles' own words, set to `value`. A role outside viewer and contributor
 * is kept as an option, so the select never shows a role the person does not hold.
 * @param {string} value
 */
function roleSel(value) {
  const list = ROLES.indexOf(value) === -1 && value ? ROLES.concat([value]) : ROLES;
  const s = /** @type {HTMLSelectElement} */ (el('select', { class: 'ak-input ak-mem__role', 'aria-label': tw('team.role'), 'data-ak-part': 'role' },
    list.map(function (r) { return el('option', { value: r, selected: r === value ? true : null }, tw('role.' + r)); })));
  if (value) s.value = value;
  return s;
}

/**
 * The people of one workspace: requests, roles, removal and invitations.
 * @param {{ target?: string|Element, org: string, ws: string, title?: string, sample?: boolean,
 *   variant?: 'list'|'table', columns?: (m: any) => (string|Node|null),
 *   actions?: Array<{ label: string, run: (m: any) => any, tone?: string }> }} spec
 * @returns {{ el: HTMLElement, refresh: () => Promise<void>, destroy: () => void }}
 */
export function workspaceTeam(spec) {
  const sample = !!spec && (spec.sample === true || !spec.org || !spec.ws || isPlaceholder(spec.org) || isPlaceholder(spec.ws));
  const variant = spec.variant === 'table' ? 'table' : 'list';
  const root = el('section', { class: 'ak-root ak-mem ak-ws ak-ws--team ak-ws--' + variant, 'data-ak-part': 'root', 'data-ak-variant': variant });
  if (spec.target) resolve(spec.target).appendChild(root);
  let tab = '';
  let failure = '';
  let notice = '';
  let typed = '';
  let typedRole = 'viewer';
  const noop = function () { /* the sample changes nothing */ };

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

  function row(who, meta, acts, extra) {
    return el('li', { class: 'ak-mem__row', 'data-ak-part': 'row' }, [
      who,
      el('span', { class: 'ak-mem__meta', 'data-ak-part': 'meta' }, [meta || '', extra || null].filter(Boolean)),
      el('span', { class: 'ak-mem__acts', 'data-ak-part': 'acts' }, acts.filter(Boolean)),
    ]);
  }

  function list(part, rows, none) {
    return el('div', { class: 'ak-mem__group', 'data-ak-part': part },
      rows.length ? el('ul', { class: 'ak-mem__rows' }, rows) : el('p', { class: 'ak-mem__none' }, none));
  }

  function columnsOf(m) {
    if (typeof spec.columns !== 'function') return null;
    const v = spec.columns(m);
    if (v == null || v === '') return null;
    return typeof v === 'string' ? el('span', { class: 'ak-mem__col' }, v) : v;
  }

  function nameOf(m) { return m.displayName || m.account; }

  // A sign-in, a language change and an action can each start a draw while one waits on the read;
  // only the newest one draws, so the block never shows two lists.
  let drawing = 0;

  async function render() {
    const mine = ++drawing;
    clear(root);
    root.appendChild(el('h3', { class: 'ak-mem__title', 'data-ak-part': 'title' },
      [spec.title || tw('team.title'), sample ? sampleBadge() : null].filter(Boolean)));
    root.appendChild(el('p', { class: 'ak-mem__intro', 'data-ak-part': 'intro' }, sample ? tw('sample.note') : tw('team.intro')));

    const lib = sample ? null : orgLib();
    let data = SAMPLE;
    if (!sample) {
      if (!lib) { root.appendChild(el('p', { class: 'ak-mem__none' }, tw('noLib'))); return; }
      if (!signedIn()) { root.appendChild(el('p', { class: 'ak-mem__none' }, tw('team.signIn'))); return; }
      try {
        data = await lib.access(spec.org, spec.ws);
      } catch (e) {
        if (mine !== drawing) return;
        // Only the creator or an organism owner or admin may read the list: the node says so.
        root.appendChild(el('p', { class: 'ak-mem__failure', role: 'alert', 'data-ak-part': 'failure' }, tw('failed', { why: refusal(e) || String(e) })));
        return;
      }
      if (mine !== drawing) return;
    }
    const people =((data && data.members) || []).filter(function (m) { return m && m.account; }).slice()
      .sort(function (a, b) { return (a.role === 'creator' ? 0 : 1) - (b.role === 'creator' ? 0 : 1); });
    const requests = ((data && data.requests) || []).filter(function (r) { return r && r.account && (!r.status || r.status === 'pending'); });
    const count = { requests: requests.length, people: people.length };
    const tabs = ['requests', 'people', 'invite'];
    if (!tab) tab = count.requests ? 'requests' : 'people';

    if (failure) root.appendChild(el('p', { class: 'ak-mem__failure', role: 'alert', 'data-ak-part': 'failure' }, tw('failed', { why: failure })));
    if (notice) root.appendChild(el('p', { class: 'ak-mem__notice', role: 'status', 'data-ak-part': 'notice' }, notice));

    root.appendChild(el('div', { class: 'ak-mem__tabs', role: 'tablist', 'data-ak-part': 'tabs' }, tabs.map(function (g) {
      const n = count[g];
      return el('button', {
        type: 'button', role: 'tab', class: 'ak-mem__tab' + (g === tab ? ' is-on' : ''), 'aria-selected': g === tab ? 'true' : 'false',
        on: { click: function () { tab = g; render(); } },
      }, tw('tab.' + g) + (typeof n === 'number' && n ? ' (' + n + ')' : ''));
    })));

    function changeRole(m, sel) {
      const next = sel.value;
      if (sample || next === m.role) return;
      const go = function () {
        act(function () { return lib.grant(spec.org, spec.ws, m.account, next); },
          function () { return tw('team.granted', { who: nameOf(m), role: tw('role.' + next) }); });
      };
      if (!(next === 'contributor' && m.role === 'viewer')) { go(); return; }
      ask({ title: tw('team.raise', { who: nameOf(m) }), text: tw('team.raiseText'), confirmLabel: tw('team.raiseYes') })
        .then(function (yes) { if (yes) go(); else sel.value = m.role; });
    }

    function requestsTab() {
      return list('requests', requests.map(function (q) {
        const sel = roleSel('viewer');
        sel.disabled = sample;
        const meta = [q.message || '', q.at ? tw('team.asked', { d: day(q.at) }) : ''].filter(Boolean).join(' · ');
        return row(person(q.account, q.displayName), meta, [
          sel,
          button(tw('team.approve'), 'primary', sample ? noop : function () {
            const role = sel.value;
            act(function () { return lib.decide(spec.org, spec.ws, q.account, 'approve', role); },
              function () { return tw('team.granted', { who: nameOf(q), role: tw('role.' + role) }); });
          }, sample),
          button(tw('team.decline'), 'ghost', sample ? noop : function () {
            act(function () { return lib.decide(spec.org, spec.ws, q.account, 'decline'); },
              function () { return tw('team.declined', { who: nameOf(q) }); });
          }, sample),
        ]);
      }), tw('team.requestsNone'));
    }

    function peopleRows() {
      return people.map(function (m) {
        const since = m.since ? tw('team.since', { d: day(m.since) }) : '';
        const own = (spec.actions || []).map(function (a) {
          return button(a.label, a.tone || 'ghost', sample ? noop : function () {
            Promise.resolve(a.run(m)).then(function () { render(); });
          }, sample);
        });
        if (m.role === 'creator') {
          const chip = el('span', { class: 'ak-ws__chip', 'data-ak-part': 'chip', title: tw('team.creatorHint') }, tw('role.creator'));
          return row(person(m.account, m.displayName), since, own.concat([chip]), columnsOf(m));
        }
        const sel = roleSel(m.role || 'viewer');
        sel.disabled = sample;
        sel.addEventListener('change', function () { changeRole(m, sel); });
        return row(person(m.account, m.displayName), since, own.concat([
          sel,
          button(tw('team.remove'), 'ghost', sample ? noop : function () {
            ask({
              title: tw('team.confirmRemove', { who: nameOf(m) }), text: tw('team.confirmRemoveText'),
              confirmLabel: tw('team.remove'), tone: 'danger',
            }).then(function (yes) {
              if (yes) act(function () { return lib.revoke(spec.org, spec.ws, m.account); }, function () { return tw('team.removed', { who: nameOf(m) }); });
            });
          }, sample),
        ]), columnsOf(m));
      });
    }

    function peopleTab() {
      const rows = peopleRows();
      if (variant !== 'table' || !rows.length) return list('people', rows, tw('team.peopleNone'));
      return el('div', { class: 'ak-mem__group ak-mem__table-wrap', 'data-ak-part': 'people' }, [
        el('table', { class: 'ak-mem__table' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { scope: 'col' }, tw('team.colName')),
            el('th', { scope: 'col' }, tw('team.colSince')),
            el('th', { scope: 'col' }, tw('team.colActions')),
          ])]),
          el('tbody', {}, rows.map(function (r) {
            const cells = Array.prototype.slice.call(r.children);
            return el('tr', { 'data-ak-part': 'row' }, cells.map(function (c) { return el('td', {}, [c]); }));
          })),
        ]),
      ]);
    }

    function inviteTab() {
      const input = /** @type {HTMLInputElement} */ (el('input', {
        type: 'text', class: 'ak-input ak-mem__name', placeholder: tw('team.invitePlaceholder'),
        'aria-label': tw('team.invitePlaceholder'), disabled: sample ? true : null, autocomplete: 'off',
      }));
      if (typed) input.value = typed;
      const sel = roleSel(typedRole);
      sel.disabled = sample;
      const go = button(EMAIL_RE.test(typed) ? tw('team.invite') : tw('team.add'), 'primary', sample ? noop : function () {
        const value = input.value.trim();
        const role = sel.value;
        typed = value; typedRole = role;
        if (!value) return;
        if (EMAIL_RE.test(value)) {
          act(function () {
            if (typeof lib.inviteByEmail !== 'function') throw new Error(tw('noLib'));
            return lib.inviteByEmail(spec.org, value, { ws: spec.ws, role: role });
          }, function (r) {
            typed = '';
            return r && r.email_sent === false && r.accept_url
              ? tw('team.inviteLink', { url: r.accept_url })
              : tw('team.inviteSent', { email: value });
          });
        } else {
          act(function () { return lib.grant(spec.org, spec.ws, value, role); }, function () {
            typed = '';
            return tw('team.granted', { who: value, role: tw('role.' + role) });
          });
        }
      }, sample);
      input.addEventListener('input', function () {
        go.textContent = EMAIL_RE.test(input.value.trim()) ? tw('team.invite') : tw('team.add');
      });
      return el('div', { class: 'ak-mem__group', 'data-ak-part': 'invite' }, [
        el('div', { class: 'ak-mem__add' }, [el('div', { class: 'ak-mem__field' }, [input]), sel, go]),
        el('p', { class: 'ak-mem__hint' }, tw('team.inviteHint')),
      ]);
    }

    root.appendChild(el('div', { class: 'ak-mem__body' }, [
      tab === 'requests' ? requestsTab() : (tab === 'invite' ? inviteTab() : peopleTab()),
    ]));
  }

  function run() {
    return render().catch(function (e) {
      root.appendChild(el('p', { class: 'ak-mem__failure', role: 'alert' }, tw('failed', { why: refusal(e) || String(e) })));
    });
  }
  const ready0 = run().then(function () { enter(root); });
  const stop = watch(function () { failure = ''; notice = ''; run(); }, root);
  return {
    el: root,
    refresh: function () { return ready0.then(run); },
    destroy: function () { stop(); if (root.parentNode) root.parentNode.removeChild(root); },
  };
}

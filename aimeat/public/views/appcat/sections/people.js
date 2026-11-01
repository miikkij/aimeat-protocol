/**
 * @file public/views/appcat/sections/people.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The detail section "People registered without an account": the people who signed up to
 *   this app with their e-mail address (aimeat-parties, plan doc-mvwxcas3dom3, D4), with the same
 *   actions the app's own members panel (AIMEAT.iam.MemberAdmin) gives the owner (WP9d): the signup
 *   setting in plain words (the server's setting first: nobody registers, the operator approves, or
 *   the owner decides) with Open or Close and the role a newcomer gets; then each person with their
 *   address, the day they joined and were last seen, their state and role, a role change, Stop or Let
 *   in again, and Remove, which ends their sign-in and deletes what they kept in the app. A role that
 *   manages the roster is refused by the node, and the refusal is shown.
 *   Owner only, as the routes are: GET .../parties, PUT .../parties/registration, POST .../members
 *   with `party`, POST .../parties/{name}/stop and /resume, DELETE .../parties/{name}. The list reads
 *   again on the live event `app-parties` (the node sends it to the owner's streams), never on a timer.
 *   Made of the component kit: the section passes data and never a class.
 * @structure meta · PeopleSection({ d })
 * @usage const mod = await import('./sections/people.js'); html`<${mod.default} d=${d} />`
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (WP9d).
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { List, Row, Name, Desc, Cell, Doors, Panel } from '/components/List.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Mark, Marks } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Select } from '/components/Select.js';
import { Space } from '/components/Layout.js';
import { apiGet, apiPost, apiPut, apiDelete } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { x } from '/views/appcat/i18n.js';
import { dateText } from '/views/appcat/sections/app-write.js';
import { buildCtx } from '/views/appcat/sections/build-ctx.js';

const html = htm.bind(h);

export const meta = { id: 'people', title: 'detail.people', show: (d) => !!(d && d.isOwnPublished) };

/**
 * The roles a registered person may get: the plan's roles and every role in use on the roster, less
 * the ones that manage it. The node keeps no vocabulary of its own (the app does), so these are the
 * roles the node can see.
 */
function rolesOf(plan, parties, inUse) {
  const manage = new Set((plan && plan.manageRoles) || []);
  const names = new Set(['member', ...Object.keys((plan && plan.roles) || {}), ...inUse, ...parties.map((p) => p.role).filter(Boolean)]);
  return [...names].filter((r) => r !== 'owner' && !manage.has(r));
}

/** The signup setting in words: the server's setting first, then the app's own. */
function registrationLine(reg) {
  if (!reg || reg.node_setting === 'off' || reg.effective === 'off') return x('people.regOff');
  if (reg.open) return x('people.regOpen', { role: reg.role || 'member' });
  if (reg.state === 'requested') return x('people.regRequested');
  if (reg.state === 'refused') return x('people.regRefused');
  return x('people.regClosed');
}

export default function PeopleSection({ d }) {
  const b = buildCtx(d);
  const [read, setRead] = useState({ state: 'loading', parties: [], registration: null, plan: null, inUse: [] });
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState({ name: '', what: '' });
  const [role, setRole] = useState('');
  const [newRole, setNewRole] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.all([
      apiGet(`${b.path}/parties`),
      apiGet(`${b.path}/members/plan`).catch((err) => { swallowed('appcat: people plan', err); return null; }),
      apiGet(`${b.path}/members`).catch((err) => { swallowed('appcat: people roster roles', err); return null; }),
    ])
      .then(([res, plan, roster]) => {
        if (!active) return;
        const data = res?.data || {};
        const inUse = ((roster?.data?.members) || []).map((m) => m.role).filter(Boolean);
        setRead({ state: 'ready', parties: data.parties || [], registration: data.registration || null, plan: plan?.data?.plan || null, inUse });
      })
      .catch((err) => { swallowed('appcat: people', err); if (active) setRead((r) => ({ ...r, state: 'failed' })); });
    return () => { active = false; };
  }, [b.path, tick]);

  // The node tells the owner's page when somebody registers, is stopped or removed.
  useEffect(() => {
    const onLive = (e) => { const ds = e.detail?.domains; if (ds && !ds.has('app-parties') && !ds.has('apps')) return; setTick((n) => n + 1); };
    window.addEventListener('aimeat-live-update', onLive);
    return () => window.removeEventListener('aimeat-live-update', onLive);
  }, []);

  async function act(fn, done) {
    setBusy(true);
    try {
      await fn();
      b.ctx.showToast(done);
      setOpen({ name: '', what: '' });
      setTick((n) => n + 1);
    } catch (err) {
      swallowed('appcat: people write', err);
      b.ctx.showToast(x('people.failed', { why: err?.error?.message || err?.message || '' }), true);
    } finally { setBusy(false); }
  }

  if (read.state === 'loading') return html`<${Note} kind="loading">${x('people.loading')}<//>`;
  if (read.state === 'failed') return html`<${Note} kind="quiet" role="alert">${x('people.loadFailed')}<//>`;

  const reg = read.registration;
  const roles = rolesOf(read.plan, read.parties, read.inUse || []);
  const off = !reg || reg.node_setting === 'off' || reg.effective === 'off';
  const isOpen = !!(reg && (reg.open || reg.state === 'requested'));
  const roleOptions = roles.map((r) => [r, r]);
  const pick = newRole || (reg && reg.role) || roles[0] || 'member';
  const nameOf = (p) => p.display_name || p.name;

  return html`
    <${Note} kind="lead">${x('people.lead')}<//>
    <${Space} above="section">
      <${Note} kind="quiet">${registrationLine(reg)}<//>
      ${off ? null : html`
        <${Space} above="medium">
          <${Actions}>
            ${isOpen ? null : html`<${Select} fit ariaLabel=${x('people.newRole')} value=${pick} onChange=${setNewRole} options=${roleOptions} />`}
            <${Action} small disabled=${busy}
              onClick=${() => act(() => apiPut(`${b.path}/parties/registration`, isOpen ? { open: false } : { open: true, role: pick }), x('people.regSaved'))}>
              ${isOpen ? x('people.close') : x('people.open')}<//>
          <//>
        <//>
        ${reg && reg.effective === 'apps-ask' && !reg.open ? html`<${Note}>${x('people.regAsk')}<//>` : null}`}
    <//>
    <${Space} above="section">
      <${List} cols="name-desc-state-doors" empty=${x('people.none')}>
        ${read.parties.map((p) => {
          const stopped = p.status === 'stopped';
          const opened = open.name === p.name;
          return html`<${Row} key=${p.uid || p.name} open=${opened}>
            <${Name} meta=${p.email || ''}>${nameOf(p)}<//>
            <${Desc} sub=${p.last_seen_at ? x('people.seen', { d: dateText(p.last_seen_at) }) : null}>${x('people.joined', { d: dateText(p.verified_at || p.created_at) })}<//>
            <${Cell}>
              <${Marks}>
                ${p.status === 'pending' ? html`<${Mark} kind="status" tone="attention">${x('people.pending')}<//>`
                  : stopped ? html`<${Mark} kind="status" tone="off">${x('people.stopped')}<//>`
                  : html`<${Mark} kind="status" tone="fine">${x('people.active')}<//>`}
                ${p.role ? html`<${Mark}>${p.role}<//>` : null}
              <//>
            <//>
            <${Doors}>
              <${Action} small row soft disabled=${busy} onClick=${() => { setRole(p.role || roles[0] || 'member'); setOpen(opened && open.what === 'role' ? { name: '', what: '' } : { name: p.name, what: 'role' }); }}>${x('people.changeRole')}<//>
              <${Action} small row soft disabled=${busy}
                onClick=${() => act(() => apiPost(`${b.path}/parties/${encodeURIComponent(p.name)}/${stopped ? 'resume' : 'stop'}`, {}), x(stopped ? 'people.resumedToast' : 'people.stoppedToast', { name: nameOf(p) }))}>
                ${stopped ? x('people.resume') : x('people.stop')}<//>
              <${Action} small row disabled=${busy} onClick=${() => setOpen(opened && open.what === 'remove' ? { name: '', what: '' } : { name: p.name, what: 'remove' })}>${x('people.remove')}<//>
            <//>
            ${opened && open.what === 'role' ? html`<${Panel}>
              <${Actions}>
                <${Select} fit ariaLabel=${x('people.role')} value=${role} onChange=${setRole} options=${roleOptions} />
                <${Loud} control disabled=${busy || !role || role === p.role}
                  onClick=${() => act(() => apiPost(`${b.path}/members`, { party: p.party_ref, role }), x('people.roleToast', { name: nameOf(p), role }))}>${x('people.save')}<//>
                <${Action} small onClick=${() => setOpen({ name: '', what: '' })}>${x('people.keep')}<//>
              <//>
            <//>` : null}
            ${opened && open.what === 'remove' ? html`<${Panel}>
              <${Note} kind="quiet" role="alert">${x('people.removeConfirm', { name: nameOf(p) })}<//>
              <${Actions}>
                <${Loud} control danger disabled=${busy}
                  onClick=${() => act(() => apiDelete(`${b.path}/parties/${encodeURIComponent(p.name)}`), x('people.removedToast', { name: nameOf(p) }))}>${x('people.remove')}<//>
                <${Action} small onClick=${() => setOpen({ name: '', what: '' })}>${x('people.keep')}<//>
              <//>
            <//>` : null}
          <//>`;
        })}
      <//>
    <//>
    <${Note}>${x('people.personal')}<//>`;
}

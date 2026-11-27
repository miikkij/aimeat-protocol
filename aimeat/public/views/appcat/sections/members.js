/**
 * @file public/views/appcat/sections/members.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The detail section "Members": the people with an account who hold a role in this app,
 *   approved by the owner, invited, or who bought a membership
 *   (wish-sovelluksen-j-senyyden-voi-myyd-maksu-uusinta-ja-p-ttyminen-). For the owner it answers
 *   who is in, what each role gives, how far each person paid and whether it renews, and it holds the
 *   owner's controls: a role's price and period, a role change, a removal and an invitation by email.
 *
 *   WHAT A ROLE GIVES. The node knows what the member plan carries: the app's paid tools a role uses
 *   free, read from the plan's `roles` and named from the owner's own listings. What a role may do
 *   inside the app is the app's own vocabulary (AIMEAT.iam roles), which the node does not hold, so
 *   this section does not claim it.
 *
 *   Owner only, as the routes are: GET .../members and .../members/plan, PUT .../members/plan,
 *   POST .../members, DELETE .../members/{account}. The same answers reach an AI through
 *   aimeat_app_manage (members, member_plan_get, member_plan_set, member_set, member_remove).
 *   Reads again on the live event of the app (`apps`, `commerce`), never on a timer. Made of the
 *   component kit: the section passes data and never a class.
 * @structure meta · rolesOf · priceText · MembersSection({ d })
 * @usage const mod = await import('./sections/members.js'); html`<${mod.default} d=${d} />`
 * @version-history
 *   v1.0.0 — 2026-11-27 — Initial.
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { List, Row, Name, Desc, Cell, Doors, Panel } from '/components/List.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Mark, Marks } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Select } from '/components/Select.js';
import { TextField } from '/components/TextField.js';
import { Check } from '/components/Check.js';
import { Space } from '/components/Layout.js';
import { apiGet, apiPost, apiPut, apiDelete } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { money as fmtMoney } from '/js/format.js';
import { x } from '/views/appcat/i18n.js';
import { dateText } from '/views/appcat/sections/app-write.js';
import { buildCtx } from '/views/appcat/sections/build-ctx.js';

const html = htm.bind(h);

export const meta = { id: 'members', title: 'detail.members', show: (d) => !!(d && d.isOwnPublished) };

/** The roles the owner can give: the plan's roles, those sold, and every role in use, less the owner's own. */
function rolesOf(plan, members) {
  const names = new Set(['member', ...Object.keys(plan?.roles || {}), ...Object.keys(plan?.sale || {}), ...members.map((m) => m.role).filter(Boolean)]);
  return [...names].filter((r) => r && r !== 'owner');
}

/** A role's price in words, or "not sold". */
function priceText(sale, days) {
  if (!sale || typeof sale.amount !== 'number') return sale?.stripePrices?.length ? x('members.soldOnStripe') : x('members.notSold');
  const price = fmtMoney(sale.amount / 1_000_000, sale.currency);
  return x(sale.renews ? 'members.priceRenews' : 'members.priceOnce', { price, days: days || '?' });
}

/** "4.90" or "4,90" as micro-units, or null when it is not a price with at most two decimals. */
function microsOf(text) {
  const t = String(text || '').trim();
  if (!/^\d+([.,]\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t.replace(',', '.')) * 100) * 10_000;
}

export default function MembersSection({ d }) {
  const b = buildCtx(d);
  const [read, setRead] = useState({ state: 'loading', members: [], invites: [], plan: null, offers: {}, total: 0 });
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState({ id: '', what: '' });
  const [role, setRole] = useState('');
  const [form, setForm] = useState({ days: '', price: '', currency: 'EUR', renews: true, stripe: '' });
  const [invite, setInvite] = useState({ email: '', role: '' });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.all([
      apiGet(`${b.path}/members?limit=200`),
      apiGet(`${b.path}/members/plan`).catch((err) => { swallowed('appcat: members plan', err); return null; }),
      apiGet('/v1/exchange/offerings').catch((err) => { swallowed('appcat: members offerings', err); return null; }),
    ])
      .then(([roster, plan, offerings]) => {
        if (!active) return;
        const data = roster?.data || {};
        const offers = {};
        for (const o of (offerings?.data?.offerings || [])) offers[o.offeringId] = o.title || o.action || o.offeringId;
        setRead({ state: 'ready', members: data.members || [], invites: data.invites || [], plan: plan?.data?.plan || null, offers, total: Number(data.total?.members || 0) });
      })
      .catch((err) => { swallowed('appcat: members', err); if (active) setRead((r) => ({ ...r, state: 'failed' })); });
    return () => { active = false; };
  }, [b.path, tick]);

  // A purchase, a renewal or a refund changes the roster: the owner's page reads it again on the event.
  useEffect(() => {
    const onLive = (e) => { const ds = e.detail?.domains; if (ds && !ds.has('apps') && !ds.has('commerce')) return; setTick((n) => n + 1); };
    window.addEventListener('aimeat-live-update', onLive);
    return () => window.removeEventListener('aimeat-live-update', onLive);
  }, []);

  async function act(fn, done) {
    setBusy(true);
    try {
      const r = await fn();
      if (r?.ok === false) throw r;
      b.ctx.showToast(done);
      setOpen({ id: '', what: '' });
      setTick((n) => n + 1);
    } catch (err) {
      swallowed('appcat: members write', err);
      b.ctx.showToast(x('members.failed', { why: err?.error?.message || err?.response?.error?.message || err?.message || '' }), true);
    } finally { setBusy(false); }
  }

  if (read.state === 'loading') return html`<${Note} kind="loading">${x('members.loading')}<//>`;
  if (read.state === 'failed') return html`<${Note} kind="quiet" role="alert">${x('members.loadFailed')}<//>`;

  const plan = read.plan || { roles: {}, seats: {}, terms: {}, sale: {}, manageRoles: [], access: 'members-free', rosterVisibility: 'owner' };
  // The parties have their own section ("People registered without an account").
  const members = read.members.filter((m) => !String(m.owner || '').startsWith('party:'));
  const roles = rolesOf(plan, members);
  const roleOptions = roles.map((r) => [r, r]);
  const nameOf = (m) => m.displayName || m.owner;
  const gives = (r) => (plan.roles?.[r] || []).map((id) => read.offers[id] || id);

  /** Save one role's period and price, keeping the rest of the plan as it is. */
  function savePrice(r) {
    const amount = form.price.trim() ? microsOf(form.price) : null;
    if (form.price.trim() && amount === null) { b.ctx.showToast(x('members.priceBad'), true); return; }
    const days = Number(form.days) > 0 ? Math.floor(Number(form.days)) : undefined;
    const stripePrices = form.stripe.split(/[\s,]+/).filter(Boolean);
    const sale = { ...(plan.sale || {}) };
    if (amount || stripePrices.length) {
      sale[r] = { ...(amount ? { amount, currency: form.currency.trim().toUpperCase() || 'EUR' } : {}), renews: !!form.renews, stripePrices };
    } else delete sale[r];
    const terms = { ...(plan.terms || {}) };
    if (days) terms[r] = { ...(terms[r] || {}), days, ...(sale[r] ? { renewal: 'self-serve' } : {}) };
    else if (terms[r]) { const rest = { ...terms[r] }; delete rest.days; terms[r] = rest; }
    act(() => apiPut(`${b.path}/members/plan`, {
      roles: plan.roles || {}, seats: plan.seats || {}, terms, access: plan.access, rosterVisibility: plan.rosterVisibility,
      manageRoles: plan.manageRoles || [], sale,
    }), x('members.priceSaved', { role: r }));
  }

  return html`
    <${Note} kind="lead">${x('members.lead')}<//>
    <${Space} above="section">
      <${List} cols="name-desc-state-doors" empty=${x('members.noRoles')}>
        ${roles.map((r) => {
          const opened = open.id === `role:${r}` && open.what === 'price';
          const sale = plan.sale?.[r];
          const days = plan.terms?.[r]?.days;
          const free = gives(r);
          return html`<${Row} key=${`role-${r}`} open=${opened}>
            <${Name} meta=${days ? x('members.period', { days }) : x('members.noEnd')}>${r}<//>
            <${Desc} sub=${free.length ? x('members.gives', { tools: free.join(', ') }) : x('members.givesNothing')}>${priceText(sale, days)}<//>
            <${Cell}><${Marks}>${sale ? html`<${Mark} kind="status" tone="fine">${x('members.forSale')}<//>` : null}<//><//>
            <${Doors}>
              <${Action} small row soft disabled=${busy} onClick=${() => {
                setForm({ days: days ? String(days) : '', price: sale?.amount ? (sale.amount / 1_000_000).toFixed(2) : '', currency: sale?.currency || 'EUR', renews: sale ? sale.renews !== false : true, stripe: (sale?.stripePrices || []).join(', ') });
                setOpen(opened ? { id: '', what: '' } : { id: `role:${r}`, what: 'price' });
              }}>${x('members.setPrice')}<//>
            <//>
            ${opened ? html`<${Panel}>
              <${TextField} label=${x('members.days')} value=${form.days} onInput=${(v) => setForm((f) => ({ ...f, days: v }))} />
              <${TextField} label=${x('members.price')} value=${form.price} onInput=${(v) => setForm((f) => ({ ...f, price: v }))} />
              <${TextField} label=${x('members.currency')} value=${form.currency} onInput=${(v) => setForm((f) => ({ ...f, currency: v }))} />
              <${Check} checked=${form.renews} onChange=${(on) => setForm((f) => ({ ...f, renews: !!on }))}>${x('members.renews')}<//>
              <${TextField} label=${x('members.stripePrices')} value=${form.stripe} onInput=${(v) => setForm((f) => ({ ...f, stripe: v }))} />
              <${Note}>${x('members.priceHint')}<//>
              <${Actions}>
                <${Loud} control disabled=${busy} onClick=${() => savePrice(r)}>${x('members.save')}<//>
                <${Action} small onClick=${() => setOpen({ id: '', what: '' })}>${x('members.keep')}<//>
              <//>
            <//>` : null}
          <//>`;
        })}
      <//>
    <//>
    <${Space} above="section">
      <${List} cols="name-desc-state-doors" empty=${x('members.none')}>
        ${members.map((m) => {
          const opened = open.id === m.owner;
          const paid = m.paid && m.paid.until;
          const until = m.expiresAt ? dateText(m.expiresAt) : '';
          return html`<${Row} key=${m.owner} open=${opened}>
            <${Name} meta=${m.email || ''}>${nameOf(m)}<//>
            <${Desc} sub=${paid ? x(m.paid.renews ? 'members.paidRenews' : 'members.paidEnds', { d: dateText(m.paid.until) }) : until ? x('members.givenUntil', { d: until }) : x('members.givenNoEnd')}>${x('members.since', { d: dateText(m.since) })}<//>
            <${Cell}>
              <${Marks}>
                ${m.role ? html`<${Mark}>${m.role}<//>` : null}
                ${paid ? html`<${Mark} kind="status" tone=${m.paid.renews ? 'fine' : 'attention'}>${m.paid.via === 'stripe' ? x('members.paidStripe') : x('members.paid')}<//>` : null}
              <//>
            <//>
            <${Doors}>
              <${Action} small row soft disabled=${busy} onClick=${() => { setRole(m.role || roles[0] || 'member'); setOpen(opened && open.what === 'role' ? { id: '', what: '' } : { id: m.owner, what: 'role' }); }}>${x('members.changeRole')}<//>
              <${Action} small row disabled=${busy} onClick=${() => setOpen(opened && open.what === 'remove' ? { id: '', what: '' } : { id: m.owner, what: 'remove' })}>${x('members.remove')}<//>
            <//>
            ${opened && open.what === 'role' ? html`<${Panel}>
              <${Actions}>
                <${Select} fit ariaLabel=${x('members.role')} value=${role} onChange=${setRole} options=${roleOptions} />
                <${Loud} control disabled=${busy || !role || role === m.role}
                  onClick=${() => act(() => apiPost(`${b.path}/members`, { account: m.owner, role }), x('members.roleToast', { name: nameOf(m), role }))}>${x('members.save')}<//>
                <${Action} small onClick=${() => setOpen({ id: '', what: '' })}>${x('members.keep')}<//>
              <//>
            <//>` : null}
            ${opened && open.what === 'remove' ? html`<${Panel}>
              <${Note} kind="quiet" role="alert">${paid && m.paid.renews ? x('members.removePaidConfirm', { name: nameOf(m) }) : x('members.removeConfirm', { name: nameOf(m) })}<//>
              <${Actions}>
                <${Loud} control danger disabled=${busy}
                  onClick=${() => act(() => apiDelete(`${b.path}/members/${encodeURIComponent(m.owner)}`), x('members.removedToast', { name: nameOf(m) }))}>${x('members.remove')}<//>
                <${Action} small onClick=${() => setOpen({ id: '', what: '' })}>${x('members.keep')}<//>
              <//>
            <//>` : null}
          <//>`;
        })}
      <//>
      ${read.total > members.length ? html`<${Note} kind="quiet">${x('members.showing', { n: members.length, total: read.total })}<//>` : null}
    <//>
    <${Space} above="section">
      <${Actions}>
        <${TextField} label=${x('members.inviteEmail')} value=${invite.email} onInput=${(v) => setInvite((i) => ({ ...i, email: v }))} />
        <${Select} fit ariaLabel=${x('members.role')} value=${invite.role || roles[0] || 'member'} onChange=${(v) => setInvite((i) => ({ ...i, role: v }))} options=${roleOptions} />
        <${Action} small disabled=${busy || !invite.email.trim()}
          onClick=${() => act(() => apiPost(`${b.path}/members`, { email: invite.email.trim(), role: invite.role || roles[0] || 'member' }), x('members.invitedToast', { email: invite.email.trim() }))}>${x('members.invite')}<//>
      <//>
      ${read.invites.length ? html`<${Note} kind="quiet">${x('members.openInvites', { n: read.invites.length })}<//>` : null}
    <//>
    <${Note}>${x('members.joinPage', { url: `/v1/app-join?app=${b.app.owner}/${b.app.filename}` })}<//>`;
}

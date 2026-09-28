/**
 * @file public/views/profile/ai/roles-section.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The roles section of the AI page (wish-tekoalyn-roolit). A capability says what a model
 *   does; a role says what it is used for. The owner's roles, a row each (what it is for, which
 *   providers answer each capability, when it was last used); a role opens to its title, purpose, for
 *   each capability its providers and models in order, this-machine-only and a price ceiling. Below
 *   them the roles apps declare, a row each with what the app needs and the owner's binding: an app's
 *   role runs only once the owner binds it to one of their roles. Pure render over ctx.rl and ctx.pv
 *   (ai/use-roles.js, ai/use-providers.js), on the page's existing components.
 * @structure secRoles · roleRow · roleOpen · appRoleRow
 * @usage import { secRoles } from './ai/roles-section.js';
 * @version-history
 *   v1.1.0 — 2026-09-28 — The lifecycle and the fit: a role or a binding unused for 90 days is marked,
 *     an app no longer published is marked and its request can be dismissed, and a bound app role says
 *     where the owner's role does not meet its need (a missing capability, a model too small).
 *   v1.0.0 — 2026-09-28 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { PageSection } from '/components/PageSection.js';
import { Facts } from '/components/Facts.js';
import { List, Row, Name, Who, Desc, Doors, Panel } from '/components/List.js';
import { TextField } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { Check } from '/components/Check.js';
import { Mark, Marks, Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Hint } from '/components/Hint.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Row as Line, Stack } from '/components/Layout.js';
import { x, dateWord } from './frame.js';
import { CAPS } from './use-providers.js';
import { MAX_PLACES } from './use-roles.js';

const msg = (m) => (m ? html`<${Note} kind="message" error=${!!m.error}>${m.text}<//>` : null);
const BUILT_IN_TITLES = { reasoning: 'Reasoning', execution: 'Execution' };

/** A built-in role keeps its name and purpose in the reader's language until the owner renames it. */
export const roleTitle = (r) => (r.builtIn && BUILT_IN_TITLES[r.id] === r.title ? x('rl.builtinName.' + r.id) : r.title);
const rolePurpose = (r) => r.purpose || (r.builtIn ? x('rl.builtinPurpose.' + r.id) : '');

/** "Text: My OpenAI (gpt-5.4-mini) → OpenRouter · Makes images: …" */
function orderWords(role, titleOf) {
  return CAPS.filter((c) => role.capabilities?.[c]?.length)
    .map((c) => `${x('cap.' + c)}: ${role.capabilities[c].map((e) => `${titleOf(e.provider)}${e.model ? ` (${e.model})` : ''}`).join(' → ')}`)
    .join(' · ');
}

export function secRoles(ctx, num) {
  const rl = ctx.rl;
  const titleOf = (id) => ctx.pv.providers.find((p) => p.id === id)?.title || id;
  const count = rl.view ? x('rl.count', { n: rl.roles.length, waiting: rl.waiting }) : '';
  return html`
    <${PageSection} id="ai-roles" num=${num} title=${x('rl.title')} count=${count}>
      <${Note} kind="lead">${x('rl.lead')}<//>
      ${rl.error ? html`<${Note} kind="message" error>${rl.error}<//>` : null}
      ${!rl.view && !rl.error ? html`<${Note} kind="loading">${x('loading')}<//>` : null}
      ${rl.view ? html`
        <${List} cols="name-desc-who-doors" head=${[x('rl.colRole'), x('rl.colOrder'), x('rl.colUsed'), '']}>
          ${rl.roles.map((r) => roleRow(ctx, r, titleOf))}
          ${rl.openId === '__new' ? html`<${Row} key="__new" open=${true}><${Name}>${x('rl.newRole')}<//><${Desc}><//><${Who}><//><${Doors}><//>${roleOpen(ctx)}<//>` : null}
        <//>
        ${msg(rl.msg)}
        ${rl.openId !== '__new' ? html`<${Actions}><${Loud} control onClick=${() => rl.open('__new')}>${x('rl.add')}<//><//>` : null}
        <${Stack} above="section" gap="medium">
          <${Label} block>${x('rl.appsTitle')}<//>
          ${rl.apps.length ? html`
            <${List} cols="name-desc-who-doors" head=${[x('rl.colAppRole'), x('rl.colNeeds'), x('rl.colBinding'), '']}>
              ${rl.apps.flatMap((a) => a.roles.map((r) => appRoleRow(ctx, a, r)))}
            <//>` : html`<${Note} kind="quiet">${x('rl.noApps')}<//>`}
        <//>
        ${msg(rl.appMsg)}
        <${Hint}>${x('rl.hint')}<//>` : null}
    <//>`;
}

function roleRow(ctx, role, titleOf) {
  const rl = ctx.rl;
  const open = rl.openId === role.id;
  const meta = [role.id, role.builtIn ? x('rl.builtIn') : '', role.legacy ? x('rl.legacy') : '', role.stale ? x('rl.stale', { n: 90 }) : ''].filter(Boolean).join(' · ');
  const order = orderWords(role, titleOf);
  return html`
    <${Row} key=${role.id} open=${open} id=${'ai-role-' + role.id}>
      <${Name} meta=${meta}>${roleTitle(role)}<//>
      <${Desc} sub=${order || x('rl.noOrder')}>${rolePurpose(role)}<//>
      <${Who} sub=${role.local ? x('rl.localOnly') : ''}>${role.lastUsedAt ? x('rl.usedOn', { date: dateWord(role.lastUsedAt) }) : x('rl.neverUsed')}<//>
      <${Doors}><${Action} small row onClick=${() => rl.open(role.id)}>${open ? x('close') : x('change')}<//><//>
      ${open ? roleOpen(ctx, role) : null}
    <//>`;
}

function roleOpen(ctx, role) {
  const rl = ctx.rl;
  const d = rl.draft;
  if (!d) return null;
  const servers = (c) => ctx.pv.providers.filter((p) => p.capabilities?.[c]?.enabled);
  const capRow = (c) => {
    const list = d.caps[c] || [];
    const options = [['', x('rt.none')], ...servers(c).map((p) => [p.id, p.title])];
    const places = [...Array(Math.min(MAX_PLACES, list.length + 1)).keys()];
    return {
      key: 'cap-' + c, k: x('cap.' + c),
      v: html`${places.map((i) => html`
        <${Line} key=${c + i} wrap gap="small">
          ${i ? html`<${Note} inline>${x('rt.then')}<//>` : null}
          <${Select} fit ariaLabel=${x('rt.place', { cap: x('cap.' + c), n: i + 1 })} value=${list[i]?.provider || ''} onChange=${(v) => rl.setPlace(c, i, { provider: v })} options=${options} />
          ${list[i]?.provider ? html`<${TextField} value=${list[i].model} placeholder=${x('rl.modelDefault')} ariaLabel=${x('pv.modelFor', { cap: x('cap.' + c) })} onInput=${(v) => rl.setPlace(c, i, { model: v })} />` : null}
        <//>`)}`,
      sub: servers(c).length ? x('rl.orderHint') : x('rt.noServer'),
      actions: html`<${Action} small soft tone="danger" onClick=${() => rl.dropCapability(c)}>${x('rl.dropCap')}<//>`,
    };
  };
  const unused = CAPS.filter((c) => !d.caps[c]);
  const rows = [
    { k: x('pv.name'), v: html`<${TextField} box value=${d.title} ariaLabel=${x('pv.name')} onInput=${(v) => rl.setDraft({ title: v })} />`, sub: d.isNew ? x('rl.nameHint') : x('rl.idIs', { id: d.id }) },
    { k: x('rl.purpose'), v: html`<${TextField} box value=${d.purpose} placeholder=${x('rl.purposePlaceholder')} ariaLabel=${x('rl.purpose')} onInput=${(v) => rl.setDraft({ purpose: v })} />` },
    ...CAPS.filter((c) => d.caps[c]).map(capRow),
    unused.length ? { k: x('rl.addCap'), v: html`<${Select} fit ariaLabel=${x('rl.addCap')} value="" onChange=${(v) => rl.addCapability(v)} options=${[['', x('rl.pickCap')], ...unused.map((c) => [c, x('cap.' + c)])]} />`, sub: x('rl.addCapHint') } : null,
    { k: x('rl.local'), v: html`<${Check} inline checked=${d.local} onChange=${(v) => rl.setDraft({ local: v })}>${x('rl.localOn')}<//>` },
    { k: x('rt.cost'), v: html`<${TextField} type="number" size="short" min="0" step="0.01" value=${d.maxCost} placeholder=${x('rt.costNone')} ariaLabel=${x('rt.cost')} onInput=${(v) => rl.setDraft({ maxCost: v })} />`, sub: x('rl.costSub') },
  ];
  const doors = html`
    <${Loud} control disabled=${rl.busy === 'role'} onClick=${() => rl.save()}>${x('save')}<//>
    ${role && !role.builtIn ? html`<${Action} small soft tone="danger" onClick=${() => rl.remove(role)}>${x('rl.delete')}<//>` : null}
    <${Action} small soft onClick=${() => rl.open(role ? role.id : '__new')}>${x('cancel')}<//>`;
  return html`<${Panel} doors=${doors}><${Facts} rows=${rows} /><//>`;
}

/** Where the owner's role does not meet the app's need (services/ai/roles-fit.ts), in words. */
function fitWords(fit) {
  if (!fit) return '';
  return [
    fit.missing?.length ? x('rl.fitMissing', { caps: fit.missing.map((c) => x('cap.' + c).toLowerCase()).join(', ') }) : '',
    ...(fit.small || []).map((s) => x('rl.fitSmall', { model: s.model, n: s.context })),
  ].filter(Boolean).join(' · ');
}

function appRoleRow(ctx, a, r) {
  const rl = ctx.rl;
  const app = a.app;
  const pick = rl.bindDraft[r.binding] ?? r.boundTo ?? '';
  const params = r.params
    ? Object.entries(r.params).map(([k, v]) => `${x('param.' + k).toLowerCase()} ${k === 'reasoning' ? x('reasoning.' + v).toLowerCase() : v}`).join(', ')
    : '';
  const needs = [(r.capabilities || []).map((c) => x('cap.' + c)).join(' + '), r.local ? x('rl.localOnly') : '', r.context ? x('rl.context', { n: r.context }) : '', params ? x('rl.params', { params }) : ''].filter(Boolean).join(' · ');
  const bound = rl.roles.find((q) => q.id === r.boundTo);
  const state = r.boundTo
    ? x('rl.boundTo', { role: bound ? roleTitle(bound) : r.boundTo })
    : html`<${Marks}><${Mark} tone="coral">${x('rl.notBound')}<//><//>`;
  const options = [['', x('rl.pickRole')], ...rl.roles.map((q) => [q.id, roleTitle(q)])];
  const when = r.requestedAt && !r.boundTo ? x('rl.requested', { date: dateWord(r.requestedAt) }) : (r.lastUsedAt ? x('rl.usedOn', { date: dateWord(r.lastUsedAt) }) : '');
  const sub = [fitWords(r.fit), r.stale ? x('rl.stale', { n: 90 }) : '', when].filter(Boolean).join(' · ');
  return html`
    <${Row} key=${r.binding}>
      <${Name} meta=${a.gone ? `${app} · ${x('rl.appGone')}` : app} warn=${!!a.gone}>${r.name}<//>
      <${Desc} sub=${needs}>${r.purpose || ''}<//>
      <${Who} sub=${sub} warn=${!!r.fit}>${state}<//>
      <${Doors}>
        <${Line} wrap gap="small">
          ${a.gone ? null : html`
            <${Select} fit ariaLabel=${x('rl.bindTo', { name: r.name })} value=${pick} onChange=${(v) => rl.setBindDraft(r.binding, v)} options=${options} />
            <${Action} small row disabled=${rl.busy === 'bind' || !pick || pick === r.boundTo} onClick=${() => rl.bind(r.binding, pick)}>${x('rl.bind')}<//>`}
          ${r.boundTo ? html`<${Action} small soft tone="danger" onClick=${() => rl.bind(r.binding, '')}>${x('rl.unbind')}<//>`
            : (r.requestedAt || a.gone ? html`<${Action} small soft tone="danger" onClick=${() => rl.bind(r.binding, '', true)}>${x('rl.dismiss')}<//>` : null)}
        <//>
      <//>
    <//>`;
}

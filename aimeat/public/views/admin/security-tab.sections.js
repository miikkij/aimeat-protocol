/**
 * @file security-tab.sections.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The sections after 02 of the admin Security page, numbered by the page: the records
 *   the update at start left as they were (only while such an incident exists), what was refused and
 *   kept (one row per incident, the one loud action on the open one), who holds the keys (rows in
 *   words with a button to the page that acts), the security settings (read as sentences, each with a
 *   button to Settings), and the paste for the operator's own AI.
 * @structure HeldSection · IncidentsSection · AccountsSection · SettingsSection · AskAiSection · isHeldIncident
 * @version-history
 *   v2.4.0 — 2026-10-04 — The apps line says how to give apps addresses of their own on a node one
 *     person uses too, not only on a shared one.
 *   v2.3.0 — 2026-09-26 — A held name counts its app grants and access tokens, each on its own line,
 *     and says in one sentence that they do not work whatever the decision.
 *   v2.2.0 — 2026-09-26 — The incident the update at start opens has a section of its own (HeldSection),
 *     with its own heading and a lead for while a name is to decide and one for when every name is
 *     decided; its row says how many names are still to decide, or that every name is decided. Under
 *     it the names keep their columns on a phone (keepCols), each count stands on its own line with
 *     the kinds a name has none of left out, the cortexes and ecosystem apps are counted, a name with
 *     ecosystem apps says they can still act for the account until you decide, and the two buttons
 *     stand under the row, so the name keeps its column at every width. The marks are one short word.
 *     Section numbers come from the page.
 *   v2.1.0 — 2026-09-26 — The incident the update at start opens lists under its row each name to
 *     decide, with its counts, its holder and its two buttons ("It belongs to the current holder", "It
 *     was a previous holder's"), then the hook bindings that point at actions that no longer exist and
 *     the values left as they are. Resolve and Delete stand beside it only when no name is undecided.
 *   v2.0.0 — 2026-09-27 — Library components only: Section, the incidents a List with its own cut, the
 *     rows in words Readings with their door at the end, the paste in the SettingBox as a Code block
 *     with the copy an Action. The page writes no class.
 *   v1.2.0 — 2026-09-25 — The first row of section 05 says how apps are kept apart (audit A7-1): on
 *     their own addresses, in the isolated frame (with what to set to give them addresses), or on this
 *     server's address while one person has an account. A row may have no door, since that setting
 *     lives in the environment rather than on the Config page.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v1.1.0 — 2026-09-13 — Compose existing section headings from shared poster B1.
 *   v1.0.0 — 2026-09-05 — Initial (the Security page in the poster face).
 */
import { h } from 'preact';
import htm from 'htm';
import { t, tOr } from '/js/i18n.js';
import { date as fmtDate } from '/js/format.js';
import { num, dt, fmtBytes } from './shared.js';
import { getNodeUrl } from '/js/services/auth.js';
import { buildSecurityPrompt } from './security-tab.prompt.js';
import { Section } from '/components/Section.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Mark, Code } from '/components/Mark.js';
import { Readings } from '/components/Readings.js';
import { SettingBox } from '/components/Box.js';
import { List, Row, Name, Who, When, Cell, Doors } from '/components/List.js';

const html = htm.bind(h);
const S = (key, params) => t('admin.security.' + key, params);

/**
 * A row in words with a quiet door on the right (sections 04 and 05). No `door`, no button.
 * @param {string} key @param {{ title: any, why: any, door?: any, onClick?: () => any, last?: boolean }} row
 */
function doorRow(key, { title, why, door, onClick, last }) {
  return { key, name: title, why, end: door ? html`<${Action} small soft onClick=${onClick}>${door}<//>` : undefined, last };
}

/** The overview's `isolation` word, as the key of its sentence. */
const APPS_KEY = { 'app-origin': 'appOrigin', 'isolated-frame': 'isolatedFrame', 'shared-origin': 'sharedOrigin' };

/** How apps are kept apart here, and on a shared node without app addresses what to set. */
function appsLine(apps) {
  const key = APPS_KEY[apps.isolation] || 'sharedOrigin';
  const host = (apps.settings && apps.settings.AIMEAT_APP_HOST) || apps.app_origin?.host || '';
  const why = S('settings.apps.' + key + 'Why', { host, people: num(apps.people) });
  return {
    title: S('settings.apps.' + key),
    // Every app is meant to have an address of its own (2026-10-04): the fix stands wherever apps lack one.
    why: apps.isolation !== 'app-origin' ? why + ' ' + S('settings.apps.isolatedFrameFix', { host }) : why,
  };
}

/** A held name's holder: since when, and under which full address when it has one. */
function holderLine(n) {
  return n.holder_ghii
    ? S('incidents.held.holder', { date: fmtDate(n.holder_since), ghii: n.holder_ghii })
    : S('incidents.held.holderNoAddress', { date: fmtDate(n.holder_since) });
}

/** The moments a name's actions are bound to, a gate marked as one. */
const hookList = (bindings) => bindings.map(b => (b.gate ? S('incidents.held.gateWord', { hook: b.hook }) : b.hook)).join(', ');

/** The line under a held name: which hooks are bound to its actions, or which gate passes everything now. */
function boundNote(n) {
  if (!n.bindings.length) return undefined;
  const gates = n.bindings.filter(b => b.gate);
  if (n.status === 'previous' && gates.length) return gates.map(b => S('incidents.held.gateOpen', { hook: b.hook })).join(' ');
  return S('incidents.held.bound', { list: hookList(n.bindings) });
}

/** What a held name holds, one count per line, the kinds it has none of left out. */
function countLines(n) {
  return [
    ['countActions', n.actions], ['countWork', n.work], ['countOwn', n.own_lines], ['countNaming', n.naming_lines],
    ['countCortexes', n.cortexes], ['countApps', n.ecosystem_apps],
    ['countGrants', n.app_grants], ['countTokens', n.access_tokens],
  ].filter(([, v]) => (v || 0) > 0).map(([key, v]) => S('incidents.held.' + key, { n: num(v) }));
}

/**
 * The coral line under a held name: its ecosystem apps act for the account until you decide, its app
 * grants and access tokens do not work either way (while they are kept), and its hooks.
 */
function nameNote(n) {
  const apps = n.ecosystem_apps || 0;
  const acting = n.status === 'open' && apps > 0
    ? (apps === 1 ? S('incidents.held.appsActOne') : S('incidents.held.appsActMany', { n: num(apps) }))
    : '';
  const refused = n.status !== 'previous' && (n.app_grants || 0) + (n.access_tokens || 0) > 0 ? S('incidents.held.credentialsRefused') : '';
  return [acting, refused, boundNote(n)].filter(Boolean).join(' ') || undefined;
}

/** The mark of a held name: still to decide, or whose its records were. */
const nameMark = (n) => S(n.status === 'open' ? 'incidents.held.toDecide' : n.status === 'holder' ? 'incidents.held.decidedHolder' : 'incidents.held.decidedPrevious');

/**
 * Under an incident of section "Records older than the account": each name to decide, its counts one
 * per line, its holder, and its two buttons under it while it is open; then the hook bindings that
 * point at actions that no longer exist, and the values left as they are. The names keep the cut's
 * own columns on a phone. The buttons stand under the row (on a phone under the name), so the name
 * keeps its column at every width.
 */
function HeldNames({ i, onDecide }) {
  const names = i.names || [];
  const left = i.bindings_left || [];
  const untied = i.untied || [];
  const untiedItem = (u) => (u.lines === 1 ? S('incidents.held.untiedOne', { value: u.value }) : S('incidents.held.untiedMany', { value: u.value, lines: num(u.lines) }));
  return html`
    ${names.length ? html`
      <${List} under dense keepCols cols="state-name-who-doors" rows=${names} render=${(n) => {
        const open = n.status === 'open';
        return html`
        <${Row} key=${n.name} below=${open ? html`
          <${Actions} tight>
            <${Action} small onClick=${() => onDecide(i.id, n, 'holder')}>${S('incidents.held.decideHolder')}<//>
            <${Action} small tone="danger" onClick=${() => onDecide(i.id, n, 'previous')}>${S('incidents.held.decidePrevious')}<//>
          <//>` : undefined}>
          <${Cell} line><${Mark} kind="status" tone=${open ? 'danger' : 'fine'}>${nameMark(n)}<//><//>
          <${Name} desc=${countLines(n)} note=${nameNote(n)}>${n.name}<//>
          <${Who}>${holderLine(n)}<//>
          ${open ? null : html`<${Doors} />`}
        <//>`;
      }} />` : null}
    ${left.length ? html`<${Note} kind="quiet">${S('incidents.held.bindingsLeft', { list: left.map(b => `${b.hook} → ${b.ref}`).join(', ') })}${left.some(b => b.gate) ? ' ' + S('incidents.held.bindingsLeftGate') : ''}<//>` : null}
    ${untied.length ? html`<${Note} kind="quiet">${S('incidents.held.untied', { list: untied.map(untiedItem).join(', ') })}<//>` : null}`;
}

/** An incident whose names are decided one by one: the update at start opened it. */
export const isHeldIncident = (i) => Array.isArray(i.names);

const typeWord = (type) => tOr('admin.security.incidents.type.' + type, type);
const sourceWord = (source) => source ? tOr('admin.security.incidents.source.' + source, source) : '';
const whenLine = (i) => `${dt(i.createdAt)}${i.resolvedAt ? ' · ' + S('incidents.resolvedOn', { date: dt(i.resolvedAt) }) : ''}`;

/**
 * The section of the records the update at start left as they were, while such an incident exists:
 * its heading and its lead (one for while a name is to decide, one for when every name is decided),
 * then each incident in the incidents' own row, its names under it. It closes with its last name, so
 * neither Resolve nor Delete stands beside a name still to decide.
 */
export function HeldSection({ items, number, onResolve, onDelete, onDecide, switchPage }) {
  const anyOpen = items.some(i => i.status === 'open');
  return html`
    <${Section} id="adm-sec-names" num=${number} title=${S('incidents.held.title')}>
      <${Note} kind="lead">${S(anyOpen ? 'incidents.held.lead' : 'incidents.held.leadResolved')}<//>
      <${List} cols="state-name-who-when-doors" rows=${items} render=${(i) => {
        const names = i.names || [];
        const undecided = names.filter(n => n.status === 'open').length;
        const line = undecided ? S('incidents.held.rowOpen', { n: num(undecided), total: num(names.length) }) : names.length ? S('incidents.held.rowResolved') : undefined;
        return html`
        <${Row} key=${i.id} below=${html`<${HeldNames} i=${i} onDecide=${onDecide} />`}>
          <${Cell} line><${Mark} kind="status" tone=${i.status === 'open' ? 'danger' : 'fine'}>${S('incidents.status.' + (i.status === 'open' ? 'open' : 'resolved'))}<//><//>
          <${Name} after=${html` <${Code}>${i.code}<//>`} desc=${line}>${typeWord(i.type)}<//>
          <${Who}>${sourceWord(i.source)}<//>
          <${When}>${whenLine(i)}<//>
          <${Doors}>
            ${(i.bindings_left || []).length ? html`<${Action} small soft onClick=${() => switchPage('hooks')}>${t('dashboard.hooks')}<//>` : null}
            ${i.status === 'open' && !undecided ? html`<${Loud} control onClick=${() => onResolve(i.id)}>${S('resolve')}<//>` : null}
            ${!undecided ? html`<${Action} small tone="danger" onClick=${() => onDelete(i.id)}>${S('delete')}<//>` : null}
          <//>
        <//>`;
      }} />
    <//>`;
}

/** Section "Refused and kept": the incidents of refused uploads, whose bytes were kept when small enough. */
export function IncidentsSection({ items, number, onResolve, onDelete, onPayload }) {
  const open = items.filter(i => i.status === 'open').length;
  const lastResolved = items.map(i => i.resolvedAt).filter(Boolean).sort().pop();
  return html`
    <${Section} id="adm-sec-03" num=${number} title=${S('incidents.title')}>
      <${Note} kind="lead">${S('incidents.lead')}<//>
      ${items.length === 0 ? html`<${Note} kind="quiet">${S('incidents.none')}<//>` : null}
      ${items.length > 0 && open === 0 ? html`<${Note} kind="quiet">${lastResolved ? S('incidents.noneOpen', { date: fmtDate(lastResolved) }) : S('incidents.noneOpenPlain')}<//>` : null}
      ${items.length > 0 ? html`
        <${List} cols="state-name-who-when-doors" rows=${items} render=${(i) => html`
          <${Row} key=${i.id}>
            <${Cell} line><${Mark} kind="status" tone=${i.status === 'open' ? 'danger' : 'fine'}>${S('incidents.status.' + (i.status === 'open' ? 'open' : 'resolved'))}<//><//>
            <${Name} after=${html` <${Code}>${i.code}<//>`} desc=${i.detail || undefined}>${typeWord(i.type)}<//>
            <${Who} sub=${`${sourceWord(i.source)}${i.quarantine_key ? ' · ' + S('incidents.kept', { size: fmtBytes(i.size_bytes || 0) }) : ' · ' + S('incidents.notKept')}`}>${S('actor')} <b>${i.actor_name || i.actor || '?'}</b><//>
            <${When}>${whenLine(i)}<//>
            <${Doors}>
              ${i.quarantine_key ? html`<${Action} small onClick=${() => onPayload(i.id)}>${S('incidents.payload')}<//>` : null}
              ${i.status === 'open' ? html`<${Loud} control onClick=${() => onResolve(i.id)}>${S('resolve')}<//>` : null}
              <${Action} small tone="danger" onClick=${() => onDelete(i.id)}>${S('delete')}<//>
            <//>
          <//>`} />` : null}
    <//>`;
}

export function AccountsSection({ ov, number, switchPage }) {
  const a = ov.accounts;
  const deactivated = a.deactivated.length;
  const list = a.deactivated
    .map(d => `${d.name} (${d.since ? fmtDate(d.since) : '?'}${d.by ? ', ' + d.by : ''})`)
    .join(', ');
  return html`
    <${Section} id="adm-sec-04" num=${number} title=${S('accounts.title')}
      doors=${html`<${Action} small soft onClick=${() => switchPage('owners')}>${t('dashboard.owners')}<//>`}>
      <${Readings} rows=${[
        doorRow('operators', {
          title: a.operators.length === 1 ? S('accounts.operatorsOne') : S('accounts.operatorsMany', { n: num(a.operators.length) }),
          why: S('accounts.operatorsWhy', { names: a.operators.join(', ') }),
          door: t('dashboard.owners'), onClick: () => switchPage('owners'),
        }),
        doorRow('deactivated', {
          title: deactivated === 0 ? S('accounts.deactivatedNone') : deactivated === 1 ? S('accounts.deactivatedOne') : S('accounts.deactivatedMany', { n: num(deactivated) }),
          why: deactivated ? S('accounts.deactivatedWhy', { list }) : S('accounts.deactivatedNoneWhy'),
          door: deactivated ? S('accounts.reactivate') : t('dashboard.owners'), onClick: () => switchPage('owners'),
        }),
        doorRow('twostep', {
          title: S('accounts.twoStep', { n: num(a.two_step_on), total: num(a.owners_total) }),
          why: S('accounts.twoStepWhy'),
          door: t('dashboard.ghii'), onClick: () => switchPage('ghii'),
        }),
        doorRow('sso', {
          title: S(a.sso_enabled ? 'accounts.ssoOn' : 'accounts.ssoOff'),
          why: S(a.sso_enabled ? 'accounts.ssoOnWhy' : 'accounts.ssoOffWhy'),
          door: t('dashboard.ssoTab'), onClick: () => switchPage('sso'),
        }),
        doorRow('registration', {
          title: tOr('admin.security.accounts.registration.' + a.registration_mode, a.registration_mode),
          why: S('accounts.registrationWhy'),
          door: t('dashboard.config'), onClick: () => switchPage('config'), last: true,
        }),
      ]} />
    <//>`;
}

export function SettingsSection({ ov, number, switchPage }) {
  const s = ov.settings;
  const log = ov.now.log;
  const windowWord = (ms) => ms === 60000 ? S('settings.aMinute') : S('settings.perSeconds', { s: Math.round(ms / 1000) });
  const toConfig = () => switchPage('config');
  const apps = ov.apps ? appsLine(ov.apps) : null;
  return html`
    <${Section} id="adm-sec-05" num=${number} title=${S('settings.title')}
      doors=${html`<${Action} small soft onClick=${toConfig}>${t('dashboard.config')}<//>`}>
      <${Note} kind="lead">${S('settings.lead')}<//>
      <${Readings} rows=${[
        apps ? doorRow('apps', { title: apps.title, why: apps.why }) : null,
        doorRow('login', {
          title: S('settings.login', { max: num(s.login_rate_limit.max), window: windowWord(s.login_rate_limit.window_ms) }),
          why: S('settings.loginWhy'), door: S('settings.doors.security'), onClick: toConfig,
        }),
        doorRow('tarpit', {
          title: S(s.tarpit.enabled ? 'settings.tarpitOn' : 'settings.tarpitOff'),
          why: s.tarpit.enabled
            ? S('settings.tarpitWhy', { free: num(s.tarpit.free_failures), step: num(s.tarpit.step_ms / 1000), max: num(s.tarpit.max_delay_ms / 1000), block: num(s.tarpit.block_after), decay: num(Math.round(s.tarpit.window_ms / 60000)) })
            : S('settings.tarpitOffWhy'),
          door: S('settings.doors.security'), onClick: toConfig,
        }),
        doorRow('lockout', {
          title: S('settings.lockout', { attempts: num(s.password_lockout.attempts), minutes: num(s.password_lockout.minutes) }),
          why: S('settings.lockoutWhy'), door: S('settings.doors.security'), onClick: toConfig,
        }),
        doorRow('registration', {
          title: S('settings.registration', { max: num(s.registration_rate_limit.max), window: windowWord(s.registration_rate_limit.window_ms) }),
          why: S('settings.registrationWhy', { admin: num(s.admin_auth_rate_limit.max), window: windowWord(s.admin_auth_rate_limit.window_ms) }),
          door: S('settings.doors.security'), onClick: toConfig,
        }),
        doorRow('totp', {
          title: S(s.totp.enabled ? 'settings.totpOn' : 'settings.totpOff'),
          why: S('settings.totpWhy', { issuer: s.totp.issuer, codes: num(s.totp.backup_codes), failed: num(s.totp.max_failed), minutes: num(Math.round(s.totp.lockout_seconds / 60)) }),
          door: S('settings.doors.totp'), onClick: toConfig,
        }),
        doorRow('passkeys', {
          title: S(s.passkeys_enabled ? 'settings.passkeysOn' : 'settings.passkeysOff'),
          why: S('settings.passkeysWhy'), door: S('settings.doors.security'), onClick: toConfig,
        }),
        doorRow('cors', {
          title: S('settings.cors', { n: num(s.cors_origins) }),
          why: S('settings.corsWhy'), door: t('dashboard.cors'), onClick: () => switchPage('cors'),
        }),
        doorRow('federation', {
          title: tOr('admin.security.settings.federation.' + s.federation_auth_policy, s.federation_auth_policy),
          why: S('settings.federationWhy'), door: t('dashboard.federation'), onClick: () => switchPage('federation'),
        }),
        doorRow('body', {
          title: S('settings.body', { mb: num(s.body_limit_mb), large: num(s.body_limit_large_mb) }),
          why: S('settings.bodyWhy'), door: S('settings.doors.security'), onClick: toConfig,
        }),
        doorRow('log', {
          title: S(log.enabled ? 'settings.logOn' : 'settings.logOff'),
          why: log.enabled ? S('settings.logWhy', { path: log.path, bytes: fmtBytes(log.bytes), max: fmtBytes(log.max_bytes) }) : S('settings.logOffWhy'),
          door: S('settings.doors.security'), onClick: toConfig, last: true,
        }),
      ]} />
    <//>`;
}

export function AskAiSection({ number }) {
  const paste = buildSecurityPrompt({ url: getNodeUrl() });
  return html`
    <${Section} id="adm-sec-06" num=${number} title=${S('ai.title')}
      doors=${html`<${Action} small soft copy=${paste}>${S('ai.copy')}<//>`}>
      <${Note} kind="lead">${S('ai.lead')}<//>
      <${SettingBox} label=${S('ai.label')}>
        <${Code} block>${paste}<//>
      <//>
    <//>`;
}

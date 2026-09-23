/**
 * @file security-tab.sections.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Sections 03 to 06 of the admin Security page: what was refused and kept (one row per
 *   incident, the one ink slab on the open one), who holds the keys (rows in words with a door to
 *   the page that acts), what the doors are set to (the security settings read as sentences, each
 *   with a door to Settings), and the paste for the operator's own AI.
 * @structure IncidentsSection · AccountsSection · SettingsSection · AskAiSection
 * @version-history
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared component set: sections, list rows with their
 *     actions, chips, the shared copy action and the aside. No classes of its own, so the page's
 *     sheet (admin-security.css) could go.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v1.1.0 — 2026-09-13 — Compose existing section headings from shared poster B1.
 *   v1.0.0 — 2026-09-05 — Initial (the Security page in the poster face).
 */
import { h } from 'preact';
import htm from 'htm';
import { t, tOr } from '/js/i18n.js';
import { date as fmtDate } from '/js/format.js';
import { num, dt, fmtBytes } from './shared.js';
import { Section, Stack, ListRow, Chip, Action, CopyAction, Surface, Text } from '/components/poster-parts.js';
import { getNodeUrl } from '/js/services/auth.js';
import { buildSecurityPrompt } from './security-tab.prompt.js';

const html = htm.bind(h);
const S = (key, params) => t('admin.security.' + key, params);

/** A row in words with a quiet door on the right (sections 04 and 05). */
function DoorRow({ title, why, door, onClick }) {
  return html`<${ListRow} name=${title} detail=${why} detailKind="text"
    actions=${html`<${Action} onClick=${onClick}>${door}<//>`} />`;
}

export function IncidentsSection({ ov, onResolve, onDelete, onPayload }) {
  const { items, open } = ov.incidents;
  const lastResolved = items.map(i => i.resolvedAt).filter(Boolean).sort().pop();
  const typeWord = (type) => tOr('admin.security.incidents.type.' + type, type);
  const sourceWord = (source) => source ? tOr('admin.security.incidents.source.' + source, source) : '';
  return html`<${Section} id="adm-sec-03" title=${S('incidents.title')} count="03" description=${S('incidents.lead')}>
    ${items.length === 0 ? html`<${Text} tone="muted">${S('incidents.none')}<//>` : null}
    ${items.length > 0 && open === 0 ? html`<${Text} tone="muted">${lastResolved ? S('incidents.noneOpen', { date: fmtDate(lastResolved) }) : S('incidents.noneOpenPlain')}<//>` : null}
    ${items.map((i) => html`<${ListRow} key=${i.id} name=${typeWord(i.type)} detail=${i.code}
      value=${html`<${Chip} tone=${i.status === 'open' ? 'danger' : 'success'}>${S('incidents.status.' + (i.status === 'open' ? 'open' : 'resolved'))}<//>`}
      actions=${html`
        ${i.quarantine_key ? html`<${Action} onClick=${() => onPayload(i.id)}>${S('incidents.payload')}<//>` : null}
        ${i.status === 'open' ? html`<${Action} kind="primary" onClick=${() => onResolve(i.id)}>${S('resolve')}<//>` : null}
        <${Action} tone="danger" onClick=${() => onDelete(i.id)}>${S('delete')}<//>`}>
      <${Stack} density="compact">
        ${i.detail ? html`<${Text} tone="muted">${i.detail}<//>` : null}
        <${Text} kind="caption">${S('actor')} <strong>${i.actor_name || i.actor || '?'}</strong> · ${sourceWord(i.source)}${i.quarantine_key ? ' · ' + S('incidents.kept', { size: fmtBytes(i.size_bytes || 0) }) : ' · ' + S('incidents.notKept')}<//>
        <${Text} kind="mono" tone="muted">${dt(i.createdAt)}${i.resolvedAt ? ' · ' + S('incidents.resolvedOn', { date: dt(i.resolvedAt) }) : ''}<//>
      <//>
    <//>`)}
  <//>`;
}

export function AccountsSection({ ov, switchPage }) {
  const a = ov.accounts;
  const deactivated = a.deactivated.length;
  const list = a.deactivated
    .map(d => `${d.name} (${d.since ? fmtDate(d.since) : '?'}${d.by ? ', ' + d.by : ''})`)
    .join(', ');
  return html`<${Section} id="adm-sec-04" title=${S('accounts.title')} count="04"
    actions=${html`<${Action} onClick=${() => switchPage('owners')}>${t('dashboard.owners')}<//>`}>
    <${DoorRow}
      title=${a.operators.length === 1 ? S('accounts.operatorsOne') : S('accounts.operatorsMany', { n: num(a.operators.length) })}
      why=${S('accounts.operatorsWhy', { names: a.operators.join(', ') })}
      door=${t('dashboard.owners')} onClick=${() => switchPage('owners')} />
    <${DoorRow}
      title=${deactivated === 0 ? S('accounts.deactivatedNone') : deactivated === 1 ? S('accounts.deactivatedOne') : S('accounts.deactivatedMany', { n: num(deactivated) })}
      why=${deactivated ? S('accounts.deactivatedWhy', { list }) : S('accounts.deactivatedNoneWhy')}
      door=${deactivated ? S('accounts.reactivate') : t('dashboard.owners')} onClick=${() => switchPage('owners')} />
    <${DoorRow}
      title=${S('accounts.twoStep', { n: num(a.two_step_on), total: num(a.owners_total) })}
      why=${S('accounts.twoStepWhy')}
      door=${t('dashboard.ghii')} onClick=${() => switchPage('ghii')} />
    <${DoorRow}
      title=${S(a.sso_enabled ? 'accounts.ssoOn' : 'accounts.ssoOff')}
      why=${S(a.sso_enabled ? 'accounts.ssoOnWhy' : 'accounts.ssoOffWhy')}
      door=${t('dashboard.ssoTab')} onClick=${() => switchPage('sso')} />
    <${DoorRow}
      title=${tOr('admin.security.accounts.registration.' + a.registration_mode, a.registration_mode)}
      why=${S('accounts.registrationWhy')}
      door=${t('dashboard.config')} onClick=${() => switchPage('config')} />
  <//>`;
}

export function SettingsSection({ ov, switchPage }) {
  const s = ov.settings;
  const log = ov.now.log;
  const windowWord = (ms) => ms === 60000 ? S('settings.aMinute') : S('settings.perSeconds', { s: Math.round(ms / 1000) });
  const toConfig = () => switchPage('config');
  return html`<${Section} id="adm-sec-05" title=${S('settings.title')} count="05" description=${S('settings.lead')}
    actions=${html`<${Action} onClick=${toConfig}>${t('dashboard.config')}<//>`}>
    <${DoorRow}
      title=${S('settings.login', { max: num(s.login_rate_limit.max), window: windowWord(s.login_rate_limit.window_ms) })}
      why=${S('settings.loginWhy')} door=${S('settings.doors.security')} onClick=${toConfig} />
    <${DoorRow}
      title=${S(s.tarpit.enabled ? 'settings.tarpitOn' : 'settings.tarpitOff')}
      why=${s.tarpit.enabled
        ? S('settings.tarpitWhy', { free: num(s.tarpit.free_failures), step: num(s.tarpit.step_ms / 1000), max: num(s.tarpit.max_delay_ms / 1000), block: num(s.tarpit.block_after), decay: num(Math.round(s.tarpit.window_ms / 60000)) })
        : S('settings.tarpitOffWhy')}
      door=${S('settings.doors.security')} onClick=${toConfig} />
    <${DoorRow}
      title=${S('settings.lockout', { attempts: num(s.password_lockout.attempts), minutes: num(s.password_lockout.minutes) })}
      why=${S('settings.lockoutWhy')} door=${S('settings.doors.security')} onClick=${toConfig} />
    <${DoorRow}
      title=${S('settings.registration', { max: num(s.registration_rate_limit.max), window: windowWord(s.registration_rate_limit.window_ms) })}
      why=${S('settings.registrationWhy', { admin: num(s.admin_auth_rate_limit.max), window: windowWord(s.admin_auth_rate_limit.window_ms) })}
      door=${S('settings.doors.security')} onClick=${toConfig} />
    <${DoorRow}
      title=${S(s.totp.enabled ? 'settings.totpOn' : 'settings.totpOff')}
      why=${S('settings.totpWhy', { issuer: s.totp.issuer, codes: num(s.totp.backup_codes), failed: num(s.totp.max_failed), minutes: num(Math.round(s.totp.lockout_seconds / 60)) })}
      door=${S('settings.doors.totp')} onClick=${toConfig} />
    <${DoorRow}
      title=${S(s.passkeys_enabled ? 'settings.passkeysOn' : 'settings.passkeysOff')}
      why=${S('settings.passkeysWhy')} door=${S('settings.doors.security')} onClick=${toConfig} />
    <${DoorRow}
      title=${S('settings.cors', { n: num(s.cors_origins) })}
      why=${S('settings.corsWhy')} door=${t('dashboard.cors')} onClick=${() => switchPage('cors')} />
    <${DoorRow}
      title=${tOr('admin.security.settings.federation.' + s.federation_auth_policy, s.federation_auth_policy)}
      why=${S('settings.federationWhy')} door=${t('dashboard.federation')} onClick=${() => switchPage('federation')} />
    <${DoorRow}
      title=${S('settings.body', { mb: num(s.body_limit_mb), large: num(s.body_limit_large_mb) })}
      why=${S('settings.bodyWhy')} door=${S('settings.doors.security')} onClick=${toConfig} />
    <${DoorRow}
      title=${S(log.enabled ? 'settings.logOn' : 'settings.logOff')}
      why=${log.enabled ? S('settings.logWhy', { path: log.path, bytes: fmtBytes(log.bytes), max: fmtBytes(log.max_bytes) }) : S('settings.logOffWhy')}
      door=${S('settings.doors.security')} onClick=${toConfig} />
  <//>`;
}

export function AskAiSection() {
  const paste = buildSecurityPrompt({ url: getNodeUrl() });
  return html`<${Section} id="adm-sec-06" title=${S('ai.title')} count="06" description=${S('ai.lead')}
    actions=${html`<${CopyAction} text=${paste} label=${S('ai.copy')} />`}>
    <${Surface} kind="aside"><${Stack} density="compact">
      <${Text} kind="label">${S('ai.label')}<//>
      <${Text} lines>${paste}<//>
    <//><//>
  <//>`;
}

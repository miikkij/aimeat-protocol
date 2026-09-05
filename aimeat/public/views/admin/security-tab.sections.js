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
 *   v1.0.0 — 2026-09-05 — Initial (the Security page in the poster face).
 */
import { h } from 'preact';
import htm from 'htm';
import { t, tOr } from '/js/i18n.js';
import { num, dt, fmtBytes } from './shared.js';
import { CopyButton } from '/components/CopyButton.js';
import { getNodeUrl } from '/js/services/auth.js';
import { buildSecurityPrompt } from './security-tab.prompt.js';

const html = htm.bind(h);
const S = (key, params) => t('admin.security.' + key, params);

/** A row in words with a quiet door on the right (sections 04 and 05). */
function DoorRow({ title, why, door, onClick, last }) {
  return html`
    <div class="adm-mrow adm-mrow--two ${last ? 'adm-mrow--last' : ''}">
      <span><b>${title}</b><span class="adm-why">${why}</span></span>
      <button type="button" class="og-door og-door--quiet" onClick=${onClick}>${door}</button>
    </div>`;
}

export function IncidentsSection({ ov, onResolve, onDelete, onPayload }) {
  const { items, open } = ov.incidents;
  const lastResolved = items.map(i => i.resolvedAt).filter(Boolean).sort().pop();
  const typeWord = (type) => tOr('admin.security.incidents.type.' + type, type);
  const sourceWord = (source) => source ? tOr('admin.security.incidents.source.' + source, source) : '';
  return html`
    <section class="og-sec" id="adm-sec-03">
      <div class="og-sec-h"><h2>${S('incidents.title')}<small>03</small></h2></div>
      <p class="adm-sec-lead">${S('incidents.lead')}</p>
      ${items.length === 0 ? html`<div class="adm-sec-empty adm-sec-empty--last">${S('incidents.none')}</div>` : null}
      ${items.length > 0 && open === 0 ? html`<div class="adm-sec-empty">${lastResolved ? S('incidents.noneOpen', { date: new Date(lastResolved).toLocaleDateString() }) : S('incidents.noneOpenPlain')}</div>` : null}
      ${items.map((i, idx) => html`
        <div class="adm-sec-irow ${idx === items.length - 1 ? 'adm-sec-irow--last' : ''}" key=${i.id}>
          <span><span class="adm-badge ${i.status === 'open' ? 'adm-badge--danger' : 'adm-badge--success'}">${S('incidents.status.' + (i.status === 'open' ? 'open' : 'resolved'))}</span></span>
          <span><b>${typeWord(i.type)}</b> <span class="adm-sec-code">${i.code}</span><span class="adm-why">${i.detail || ''}</span></span>
          <span class="adm-sec-who">${S('actor')} <b>${i.actor_name || i.actor || '?'}</b><span class="adm-why">${sourceWord(i.source)}${i.quarantine_key ? ' · ' + S('incidents.kept', { size: fmtBytes(i.size_bytes || 0) }) : ' · ' + S('incidents.notKept')}</span></span>
          <span class="adm-sec-when">${dt(i.createdAt)}${i.resolvedAt ? ' · ' + S('incidents.resolvedOn', { date: dt(i.resolvedAt) }) : ''}</span>
          <span class="adm-sec-actions">
            ${i.quarantine_key ? html`<button type="button" class="adm-btn-action" onClick=${() => onPayload(i.id)}>${S('incidents.payload')}</button>` : null}
            ${i.status === 'open' ? html`<button type="button" class="adm-btn" onClick=${() => onResolve(i.id)}>${S('resolve')}</button>` : null}
            <button type="button" class="og-door og-door--danger" onClick=${() => onDelete(i.id)}>${S('delete')}</button>
          </span>
        </div>`)}
    </section>`;
}

export function AccountsSection({ ov, switchPage }) {
  const a = ov.accounts;
  const deactivated = a.deactivated.length;
  const list = a.deactivated
    .map(d => `${d.name} (${d.since ? new Date(d.since).toLocaleDateString() : '?'}${d.by ? ', ' + d.by : ''})`)
    .join(', ');
  return html`
    <section class="og-sec" id="adm-sec-04">
      <div class="og-sec-h"><h2>${S('accounts.title')}<small>04</small></h2>
        <div class="og-doors"><button type="button" class="og-door og-door--quiet" onClick=${() => switchPage('owners')}>${t('dashboard.owners')}</button></div></div>
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
        door=${t('dashboard.config')} onClick=${() => switchPage('config')} last=${true} />
    </section>`;
}

export function SettingsSection({ ov, switchPage }) {
  const s = ov.settings;
  const log = ov.now.log;
  const windowWord = (ms) => ms === 60000 ? S('settings.aMinute') : S('settings.perSeconds', { s: Math.round(ms / 1000) });
  const toConfig = () => switchPage('config');
  return html`
    <section class="og-sec" id="adm-sec-05">
      <div class="og-sec-h"><h2>${S('settings.title')}<small>05</small></h2>
        <div class="og-doors"><button type="button" class="og-door og-door--quiet" onClick=${toConfig}>${t('dashboard.config')}</button></div></div>
      <p class="adm-sec-lead">${S('settings.lead')}</p>
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
        door=${S('settings.doors.security')} onClick=${toConfig} last=${true} />
    </section>`;
}

export function AskAiSection() {
  const paste = buildSecurityPrompt({ url: getNodeUrl() });
  return html`
    <section class="og-sec" id="adm-sec-06">
      <div class="og-sec-h"><h2>${S('ai.title')}<small>06</small></h2>
        <div class="og-doors"><${CopyButton} text=${paste} label=${S('ai.copy')} className="og-door og-door--quiet" /></div></div>
      <p class="adm-sec-lead">${S('ai.lead')}</p>
      <div class="og-box">
        <span class="og-box-label">${S('ai.label')}</span>
        <div class="adm-sec-paste">${paste}</div>
      </div>
    </section>`;
}

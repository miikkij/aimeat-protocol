/**
 * @file security-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin Security page in the poster face (design canvas "AIMEAT Admin Security",
 *   direction A). One read, GET /v1/admin/security/overview, which the aimeat_admin_security_overview
 *   tool returns too, and six sections in the order an operator asks: what is happening at the door
 *   right now (every number with a sentence and a zone the server decided from this instance's own
 *   history), the numeral strip, who was turned away (grouped, then listed), what was refused and
 *   kept (with the one ink slab, Resolve), who holds the keys, what the doors are set to (read as
 *   sentences with a door to change them), and the paste for the operator's own AI.
 * @structure SecurityTab({ switchPage }) — load · alertLine · RightNow · Strip · the sections from
 *   security-tab.refusals.js and security-tab.sections.js · the actions (resolve, delete, payload)
 * @version-history
 *   v2.0.0 — 2026-09-05 — The poster face and the one read; the Statistics tab's three security
 *     counters become rows here with a sentence each; the emoji heading and the party-popper empty
 *     state go; every admin tab re-reads on a live update, this one included.
 *   v1.1.0 — 2026-08-17 — Refusal-log section: the tail of the auth refusal log as a table
 *     (who was turned away, at which door, from where, with what), plus top-doors/top-IPs
 *     summaries computed from the same rows.
 *   v1.0.0 — 2026-06-09 — Initial: incident list + resolve / delete / download-quarantine.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { useViewCSS } from '/components/useViewCSS.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { num, fmtUp, Badge, Spinner, useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { getSecurityOverview, resolveSecurityIncident, deleteSecurityIncident } from '/js/services/admin.js';
import { authHeaders } from '/js/services/auth.js';
import { RefusalsSection, ipText } from './security-tab.refusals.js';
import { IncidentsSection, AccountsSection, SettingsSection, AskAiSection } from './security-tab.sections.js';

const html = htm.bind(h);
const S = (key, params) => t('admin.security.' + key, params);

/** The sentence beside the status word: what needs a person, or that nothing does. */
export function alertLine(ov) {
  const parts = [];
  const open = ov.now.open_incidents.value;
  if (open === 1) parts.push(S('now.lineOpenOne'));
  else if (open > 1) parts.push(S('now.lineOpenMany', { n: num(open) }));
  const r = ov.refusals;
  if (r.walled_in_window > 0) {
    parts.push(r.walled_sources.length === 1
      ? S('now.lineWalledOne', { n: num(r.walled_in_window), source: ipText(r.walled_sources[0]) })
      : S('now.lineWalledMany', { n: num(r.walled_in_window), sources: num(r.walled_sources.length) }));
  }
  if (parts.length) return parts.join(' ');
  return ov.now.status === 'watch' ? S('now.lineWatch') : S('now.lineQuiet');
}

/** Section 01: the status word, its sentence, the log line, and the five headline numbers as rows. */
function RightNow({ ov, switchPage }) {
  const n = ov.now;
  const row = (key, zone, value, last) => html`
    <div class="adm-mrow ${last ? 'adm-mrow--last' : ''}">
      <span><b>${S('now.' + key)}</b><span class="adm-why">${S('now.' + key + 'Why')}</span></span>
      <span><${Badge} type=${zone} /></span>
      <span class="adm-mval">${value}</span>
    </div>`;
  const meanText = n.refusals.mean_per_day != null
    ? S('now.refusalsMean', { mean: num(n.refusals.mean_per_day), hours: num(Math.round(n.refusals.readable_hours || 0)) })
    : S('now.refusalsNoMean');
  const topText = n.sources.top_source && n.sources.top_share != null
    ? S('now.sourcesTop', { share: Math.round(n.sources.top_share * 100), source: ipText(n.sources.top_source) })
    : '';
  const wordClass = n.status === 'open' ? 'danger' : n.status === 'watch' ? 'watch' : '';
  const logLine = (n.log.enabled ? S('now.logOn', { mb: Math.round(n.log.max_bytes / 1048576) }) : S('now.logOff'))
    + (n.uptime_seconds != null ? ' · ' + S('now.restarted', { ago: fmtUp(n.uptime_seconds) }) : '');
  return html`
    <section class="og-sec og-sec--first" id="adm-sec-01">
      <div class="og-sec-h"><h2>${S('now.title')}<small>01</small></h2>
        <div class="og-doors"><button type="button" class="og-door og-door--quiet" onClick=${() => switchPage('metrics')}>${S('now.toMetrics')}</button></div></div>
      <div class="adm-ov-grid">
        <div>
          <div class="adm-ov-status ${wordClass}">${S('now.word.' + n.status)}</div>
          <p class="adm-alert-line">${alertLine(ov)}</p>
          <div class="adm-ov-up">${logLine}</div>
        </div>
        <div>
          ${row('refusals', n.refusals.zone, `${num(n.refusals.value)} · ${meanText}`)}
          ${row('sources', n.sources.zone, topText ? `${num(n.sources.value)} · ${topText}` : num(n.sources.value))}
          ${row('rateLimit', n.rate_limit_hits.zone, num(n.rate_limit_hits.value))}
          ${row('scope', n.scope_denials.zone, num(n.scope_denials.value))}
          ${row('open', n.open_incidents.zone, num(n.open_incidents.value), true)}
        </div>
      </div>
    </section>`;
}

/** The numeral strip: five cells, each a door to the section or the page that explains it. */
function Strip({ ov, switchPage }) {
  const n = ov.now, r = ov.refusals, a = ov.accounts, i = ov.incidents;
  const go = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const cell = (onClick, value, label, sub, hot) => html`
    <button type="button" onClick=${onClick}><b class=${hot ? 'og-coral-num' : ''}>${value}</b><span>${label}</span>${sub ? html`<small>${sub}</small>` : null}</button>`;
  return html`<div class="og-strip">
    ${cell(() => go('adm-sec-02'), num(n.refusals.value), S('strip.refusals'),
      n.refusals.mean_per_day != null ? S('strip.refusalsSub', { mean: num(n.refusals.mean_per_day) }) : S('strip.refusalsSubNoMean'))}
    ${cell(() => go('adm-sec-02'), num(n.sources.value), S('strip.sources'), r.by_source[0] ? S('strip.sourcesSub', { n: num(r.by_source[0].count) }) : '')}
    ${cell(() => go('adm-sec-03'), num(i.open), S('strip.open'), S('strip.openSub', { total: num(i.total), resolved: num(i.total - i.open) }), i.open > 0)}
    ${cell(() => switchPage('owners'), num(a.operators.length), S('strip.operators'),
      S('strip.operatorsSub', { total: num(a.owners_total), deactivated: num(a.deactivated.length) }))}
    ${cell(() => switchPage('ghii'), num(a.two_step_on), S('strip.twoStep'),
      S('strip.twoStepSub', { total: num(a.owners_total), rest: num(Math.max(0, a.owners_total - a.two_step_on)) }))}
  </div>`;
}

export default function SecurityTab(props) {
  const { switchPage } = props;
  useViewCSS('/css/views/admin-security.css');
  const [ov, setOv] = useState(null);
  const [failed, setFailed] = useState(false);
  const [toast, showErr, showOk, clearToast] = useToast();
  const { confirm, ConfirmUI } = useConfirm();

  const load = useCallback(async () => {
    try {
      const r = await getSecurityOverview();
      if (r?.data?.now) { setOv(r.data); setFailed(false); } else setFailed(true);
    } catch (e) { setFailed(true); showErr((e && e.message) || t('common.error')); }
  // showErr is re-created each render; listing it would re-create load every render (loop).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onLiveUpdate(['security', 'ghii', 'totp', 'config'], () => load()), [load]);

  const resolve = async (id) => {
    try { await resolveSecurityIncident(id); showOk(S('resolved')); load(); }
    catch (e) { showErr((e && e.message) || t('common.error')); }
  };
  const remove = (id) => confirm(
    S('deleteConfirm'),
    async () => { try { await deleteSecurityIncident(id); showOk(S('deleted')); load(); } catch (e) { showErr((e && e.message) || t('common.error')); } },
    { danger: true, title: S('title') },
  );
  const downloadQuarantine = async (id) => {
    try {
      const res = await fetch(`/v1/admin/security/incidents/${encodeURIComponent(id)}/quarantine`, { headers: authHeaders() });
      if (!res.ok) throw new Error(t('common.error'));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `quarantine-${id}.zip`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { showErr((e && e.message) || t('common.error')); }
  };

  if (!ov) {
    return html`<div class="og adm-sec">
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
      ${failed ? html`<div class="adm-sec-empty adm-sec-empty--last">${S('loadFailed')}</div>` : html`<${Spinner} />`}
    </div>`;
  }

  return html`
    <div class="og adm-sec">
      <${ConfirmUI} />${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
      <p class="adm-intro">${S('intro')}</p>
      <${RightNow} ov=${ov} switchPage=${switchPage} />
      <${Strip} ov=${ov} switchPage=${switchPage} />
      <${RefusalsSection} ov=${ov} switchPage=${switchPage} onError=${showErr} />
      <${IncidentsSection} ov=${ov} onResolve=${resolve} onDelete=${remove} onPayload=${downloadQuarantine} />
      <div class="adm-two">
        <${AccountsSection} ov=${ov} switchPage=${switchPage} />
        <${SettingsSection} ov=${ov} switchPage=${switchPage} />
      </div>
      <${AskAiSection} />
    </div>`;
}

/**
 * @file public/views/admin/agents-tab.record.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The record one row of the Agents list opens into (design canvas "AIMEAT Admin
 *   Agents", board "One agent opened"): whose the agent is, what it may do, where it may be called
 *   from, when it was connected, and the trust score with the breakdown behind it. The fields on
 *   the left come from the list the page already has; the trust panel and the description come from
 *   GET /v1/agents/:gaii, which recomputes the score and writes it back, and the panel says so.
 *
 * @structure
 *   - AgentRecord({ agent, detail, loading, onClose, onOwner, onOrigins }) — the whole record
 *   - Field: one label-and-value row, with an optional door at its end
 *
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial, with the Agents page in the poster face.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { kindOf, freshness, isAwake, daysSince, trustText } from './agents-tab.derive.js';

const A = (key, params) => t('dashboard.agentsTab.' + key, params);

/**
 * "16 Mar", or "16 Mar 2025" once it is not this year.
 *
 * `dt()` writes the whole stamp ("3/16/2026, 10:25:19 AM"), which is four times the width the
 * Last seen column has and says nothing a reader of this page needs at that precision.
 */
export function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const thisYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, thisYear
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "2 min", "5 h", "3 d", "16 Mar" — the same reading the list column uses. */
export function seenWords(iso, now) {
  const f = freshness(iso, now);
  if (f.kind === 'never') return A('seenNever');
  if (f.kind === 'minutes') return A('seenMinutes', { n: f.n });
  if (f.kind === 'hours') return A('seenHours', { n: f.n });
  if (f.kind === 'days') return A('seenDays', { n: f.n });
  return shortDate(iso);
}

/** One row of the record: what it is called, what it says, and sometimes a way on. */
function Field({ label, value, why, door, last }) {
  const body = door
    ? html`<span class="adm-ag-fval-row"><span>${value}${why && html`<small>${why}</small>`}</span>${door}</span>`
    : html`<span>${value}${why && html`<small>${why}</small>`}</span>`;
  return html`
    <div class="adm-ag-frow ${last ? 'adm-ag-frow--last' : ''}">
      <span class="adm-ag-flbl">${label}</span>
      <span class="adm-ag-fval">${body}</span>
    </div>`;
}

/** The scopes as chips, or the one chip that says the list carries none for this agent. */
function Scopes({ scopes }) {
  if (!scopes?.length) return html`<span class="adm-ag-scp"><span>${A('scopesNone')}</span></span>`;
  return html`<span class="adm-ag-scp">${scopes.map(s => html`<span>${s}</span>`)}</span>`;
}

/**
 * The trust panel. Everything in it is the reading taken the moment the record was opened, which
 * is what the sentence under it says: the route recomputes the score and stores it, so the number
 * the list showed a second ago and the number here can differ, and that difference is the point.
 */
function Trust({ agent, detail, loading }) {
  if (loading || !detail?.trust) {
    return html`<div class="adm-ag-trust">
      <span class="adm-ag-trust-h">${A('trustHead')}</span>
      <p>${A('reading')}</p>
    </div>`;
  }
  const tr = detail.trust;
  const before = agent.trust_score;
  const moved = typeof before === 'number' && before !== tr.score;
  return html`
    <div class="adm-ag-trust">
      <span class="adm-ag-trust-h">${A('trustHead')}</span>
      <div class="adm-ag-trust-n">${trustText(tr.score, getLocale())}<span>${A('trustOf100')}</span></div>
      <div class="adm-ag-trow">${A('trustDeliveries')}<span>${tr.total_deliveries ?? 0}</span></div>
      <div class="adm-ag-trow">${A('trustSuccess')}<span>${tr.total_deliveries
    ? (tr.success_rate * 100).toFixed(0) + '%'
    : A('trustNoWork')}</span></div>
      <div class="adm-ag-trow">${A('trustRatings')}<span>+${tr.positive_ratings ?? 0} / -${tr.negative_ratings ?? 0}</span></div>
      <div class="adm-ag-trow">${A('trustAge')}<span>${A('trustDays', { n: tr.age_days ?? 0 })}</span></div>
      <p>${moved ? A('trustMoved', { before: trustText(before, getLocale()) }) : A('trustSame')} ${A('trustCap')}</p>
    </div>`;
}

/**
 * One agent, opened in place under its row.
 * @param {{ agent: any, detail: any, loading: boolean, now: number,
 *           onClose: () => void, onOwner: () => void, onOrigins: () => void }} props
 */
export default function AgentRecord({ agent, detail, loading, now, onClose, onOwner, onOrigins }) {
  const kind = kindOf(agent.gaii);
  const origins = agent.allowed_origins;
  const federates = agent.federate === true;
  const age = daysSince(agent.created_at, now);
  const published = detail?.actions_published ?? 0;

  return html`
    <div class="adm-ag-rec">
      <div class="adm-ag-rec-h">
        <div>
          <h3>${agent.display_name || agent.gaii.split('#')[0]}</h3>
          <span class="adm-ag-rec-addr">${agent.gaii}</span>
          <div class="adm-ag-rec-chips">
            <span class=${isAwake(agent, now) ? 'is-live' : ''}>
              ${A('chipSeen', { when: seenWords(agent.last_seen, now) })}
            </span>
            <span>${A('kind' + kind.charAt(0).toUpperCase() + kind.slice(1))}</span>
            <span class=${federates ? '' : 'is-off'}>${federates ? A('fedOn') : A('fedOff')}</span>
          </div>
        </div>
        <button type="button" class="og-door og-door--quiet" onClick=${onClose}>${A('close')} ↩</button>
      </div>

      <div class="adm-ag-rec-grid">
        <div>
          ${detail?.description
    ? html`<p class="adm-ag-desc">${detail.description}</p>`
    : html`<p class="adm-ag-desc adm-ag-desc--none">${loading ? A('reading') : A('noDescription')}</p>`}

          <${Field} label=${A('fWhose')} value=${agent.owner} why=${A('fWhoseWhy')}
            door=${html`<button type="button" class="og-door og-door--quiet" onClick=${onOwner}>${A('fOpenPerson')}</button>`} />

          <${Field} label=${A('fMayDo')} value=${html`<${Scopes} scopes=${agent.default_scopes} />`}
            why=${agent.default_scopes?.length ? A('fMayDoWhy') : A('fMayDoNoneWhy')} />

          <${Field} label=${A('fCalledFrom')}
            value=${origins?.length ? origins.join(', ') : A('fAnywhere')}
            why=${origins?.length ? A('fOriginsWhy') : A('fAnywhereWhy')}
            door=${html`<button type="button" class="og-door og-door--quiet" onClick=${onOrigins}>${A('fToCors')}</button>`} />

          <${Field} label=${A('fConnected')} value=${shortDate(agent.created_at)}
            why=${age !== null ? A('fConnectedWhy', { n: Math.max(0, Math.floor(age)) }) : ''} />

          <${Field} label=${A('fPublished')} last=${true}
            value=${published ? A('fPublishedN', { n: published }) : A('fPublishedNone')}
            why=${A('fPublishedWhy')} />
        </div>

        <${Trust} agent=${agent} detail=${detail} loading=${loading} />
      </div>

      <div class="adm-ag-acts">
        <button type="button" class="adm-btn" onClick=${onOrigins}>${A('actOrigins')}</button>
        <p>${A('actOriginsWhy')}</p>
      </div>
    </div>`;
}

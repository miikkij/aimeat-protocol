/**
 * @file public/views/profile/calibrator/list.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The calibrations as a list in the poster face: the mast says what a calibration is
 *   and takes the name of a new one; each calibration is a row with its latest score, its judge
 *   and its runs; archived ones are folded away behind one door.
 * @structure renderList · listRow
 * @usage import { renderList } from './list.js';
 * @version-history
 *   v1.10.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.9.0 -- 2026-09-26 -- A score is the small stat number (.poster-stat-number--small), as the wallet's amounts, a unification: the look most tabs use.
 *   v1.8.0 -- 2026-09-25 -- A line that says a part is still loading is the quiet sentence with the Loading mark (a unification: the look most tabs use).
 *   v1.7.0 -- 2026-09-25 -- The calibrations are the Listing (css/components/listing.css), a unification: the look most tabs use.
 *   v1.6.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.5.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.4.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.3.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.2.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-09-04 — Initial (design canvas "AIMEAT Kalibraattori-sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { x, dateWord, judgeOf, crumb, pageLinks } from './frame.js';
import { Hint } from '/components/Hint.js';

const chip = (text, cls = '') => html`<span class=${`poster-chip ${cls}`}>${text}</span>`;

export function renderList(ctx) {
  const all = ctx.projects || [];
  const live = all.filter((p) => p.status !== 'archived');
  const archived = all.filter((p) => p.status === 'archived');
  const shown = ctx.showArchived ? all : live;
  const scored = live.filter((p) => p.latestAvgScore != null);
  return html`
    <div class="og og-cal og-cal-list">
      ${crumb()}
      <div class="og-mast">
        <div class="og-mast-words">
          <h1 class="og-title poster-page-title">${t('profile.calibrator.tabLabel')}<small>${x('titleSub')}</small></h1>
          <div class="poster-chips">
            ${ctx.projects ? chip(x('chipCalibrations', { n: live.length }), 'poster-chip--sun') : null}
            ${scored.length ? chip(x('chipScored', { n: scored.length })) : null}
            ${archived.length ? chip(x('chipArchived', { n: archived.length })) : null}
          </div>
          <p class="og-desc">${x('listDesc')}</p>
        </div>
        <div class="og-mast-actions">
          <div class="cal-new">
            <input class="og-input" type="text" value=${ctx.newName} placeholder=${x('newPlaceholder')} aria-label=${x('newName')} onInput=${(e) => ctx.setNewName(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && ctx.createProject()} />
            <button type="button" class="poster-slab poster-slab--control" disabled=${ctx.busy === 'create' || !ctx.newName.trim()} onClick=${() => ctx.createProject()}>${x('newCalibration')}</button>
          </div>
          <div class="og-doors">
            ${archived.length ? html`<button type="button" class="poster-action poster-action--more" onClick=${() => ctx.setShowArchived(!ctx.showArchived)}>${ctx.showArchived ? x('hideArchived') : x('showArchived', { n: archived.length })}</button>` : null}
          </div>
        </div>
      </div>
      <div class="og-grid">
        <div class="og-main">
          ${!ctx.projects ? html`<p class="poster-quiet cal-empty loading-mark">${x('loading')}</p>` : !shown.length ? html`<p class="poster-quiet cal-empty"><b>${x('emptyLead')}</b> ${x('emptyBody')}</p>` : html`
            <div class="listing listing--name-score-desc-doors">
              <div class="listing-row listing-row--head"><div class="poster-label">${x('colCalibration')}</div><div class="poster-label">${x('colScore')}</div><div class="poster-label">${x('colState')}</div><div class="poster-label"></div></div>
              ${shown.map((p) => listRow(ctx, p))}
            </div>`}
          <${Hint}>${x('listHint')}<//>
        </div>
        <nav class="og-rail" aria-label=${x('railTitle')}>
          <span class="og-rail-label">${x('pages')}</span>
          ${pageLinks()}
        </nav>
      </div>
    </div>`;
}

function listRow(ctx, p) {
  const judge = judgeOf(p, ctx.settings);
  const score = p.latestAvgScore != null ? Math.round(p.latestAvgScore) : null;
  const runs = Number(p.batchCount) || 0;
  const models = Number(p.modelCount) || 0;
  const state = !p.currentVersion
    ? x('stateNoPrompt')
    : [judge.modelId ? x('stateJudge', { name: judge.label }) : x('stateNoJudge'), x('stateCandidates', { n: models }), runs ? x('stateRuns', { n: runs }) : x('stateNoRuns')].join(' · ');
  return html`
    <div class=${`listing-row ${p.status === 'archived' ? 'is-archived' : ''}`} key=${p.projectId}>
      <div class="listing-name"><button type="button" class="og-tbl-name" onClick=${() => ctx.openProject(p.projectId)}>${p.name}</button><small>${p.currentVersion ? x('versionN', { n: p.currentVersion }) + ' · ' : ''}${dateWord(p.createdAt)}${p.status === 'archived' ? ' · ' + x('archived') : ''}</small></div>
      <div class="cal-sc">${score != null ? html`<b class=${`poster-stat-number poster-stat-number--small ${score >= 80 ? 'is-good' : score >= 50 ? 'is-mid' : 'is-low'}`}>${score} %</b><small>${x('scoreSub')}</small>` : html`<span class="is-dim">${runs ? x('noScoreYet') : x('noRunsYet')}</span>`}</div>
      <div class="listing-desc">${state}</div>
      <div class="listing-doors"><button type="button" class="poster-action poster-action--small poster-action--row" onClick=${() => ctx.openProject(p.projectId)}>${x('open')}</button></div>
    </div>`;
}

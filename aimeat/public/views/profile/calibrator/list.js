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
 *   v1.0.0 — 2026-09-04 — Initial (design canvas "AIMEAT Kalibraattori-sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { x, dateWord, judgeOf, crumb, pageLinks } from './frame.js';

const chip = (text, cls = '') => html`<span class=${`og-chip ${cls}`}>${text}</span>`;

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
          <h1 class="og-title">${t('profile.calibrator.tabLabel')}<small>${x('titleSub')}</small></h1>
          <div class="og-chips">
            ${ctx.projects ? chip(x('chipCalibrations', { n: live.length }), 'og-chip--sun') : null}
            ${scored.length ? chip(x('chipScored', { n: scored.length })) : null}
            ${archived.length ? chip(x('chipArchived', { n: archived.length }), 'og-chip--dim') : null}
          </div>
          <p class="og-desc">${x('listDesc')}</p>
        </div>
        <div class="og-mast-actions">
          <div class="cal-new">
            <input class="og-input" type="text" value=${ctx.newName} placeholder=${x('newPlaceholder')} aria-label=${x('newName')} onInput=${(e) => ctx.setNewName(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && ctx.createProject()} />
            <button type="button" class="og-slab" disabled=${ctx.busy === 'create' || !ctx.newName.trim()} onClick=${() => ctx.createProject()}>${x('newCalibration')}</button>
          </div>
          <div class="og-doors">
            ${archived.length ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.setShowArchived(!ctx.showArchived)}>${ctx.showArchived ? x('hideArchived') : x('showArchived', { n: archived.length })}</button>` : null}
          </div>
        </div>
      </div>
      <div class="og-grid">
        <div class="og-main">
          ${!ctx.projects ? html`<p class="cal-empty">${x('loading')}</p>` : !shown.length ? html`<p class="cal-empty"><b>${x('emptyLead')}</b> ${x('emptyBody')}</p>` : html`
            <div class="cal-rows">
              <div class="cal-row cal-row--head"><div>${x('colCalibration')}</div><div>${x('colScore')}</div><div>${x('colState')}</div><div></div></div>
              ${shown.map((p) => listRow(ctx, p))}
            </div>`}
          <p class="cal-hint">${x('listHint')}</p>
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
    <div class=${`cal-row ${p.status === 'archived' ? 'is-archived' : ''}`} key=${p.projectId}>
      <div class="cal-nm"><button type="button" class="og-tbl-name" onClick=${() => ctx.openProject(p.projectId)}>${p.name}</button><small>${p.currentVersion ? x('versionN', { n: p.currentVersion }) + ' · ' : ''}${dateWord(p.createdAt)}${p.status === 'archived' ? ' · ' + x('archived') : ''}</small></div>
      <div class="cal-sc">${score != null ? html`<b class=${score >= 80 ? 'is-good' : score >= 50 ? 'is-mid' : 'is-low'}>${score} %</b><small>${x('scoreSub')}</small>` : html`<span class="is-dim">${runs ? x('noScoreYet') : x('noRunsYet')}</span>`}</div>
      <div class="cal-w">${state}</div>
      <div class="cal-go"><button type="button" class="og-door" onClick=${() => ctx.openProject(p.projectId)}>${x('open')}</button></div>
    </div>`;
}

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
 *   2026-09-22 -- Composed from the shared set (Page, Rail, ListRow, Field, Chip): a calibration is a
 *     shared row; calibrator-poster.css is gone.
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-09-04 — Initial (design canvas "AIMEAT Kalibraattori-sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Page, Rail, Stack, ListRow, Field, Text, Chip, Action } from '/components/poster-parts.js';
import { x, dateWord, judgeOf, crumb, pageLinks } from './frame.js';

/** A score's tone: good from 80, middling from 50, low below. */
export const scoreTone = (score) => (score >= 80 ? 'success' : score >= 50 ? 'plain' : 'danger');

export function renderList(ctx) {
  const all = ctx.projects || [];
  const live = all.filter((p) => p.status !== 'archived');
  const archived = all.filter((p) => p.status === 'archived');
  const shown = ctx.showArchived ? all : live;
  const scored = live.filter((p) => p.latestAvgScore != null);
  const identity = html`<${Stack} density="compact"><${Text} tone="muted">${x('titleSub')}<//>
    <${Stack} direction="wrap" density="compact">
      ${ctx.projects ? html`<${Chip} tone="sun">${x('chipCalibrations', { n: live.length })}<//>` : null}
      ${scored.length ? html`<${Chip}>${x('chipScored', { n: scored.length })}<//>` : null}
      ${archived.length ? html`<${Chip} tone="muted">${x('chipArchived', { n: archived.length })}<//>` : null}
    <//><//>`;
  return html`<${Page} crumbs=${crumb()} title=${t('profile.calibrator.tabLabel')} identity=${identity}
    actions=${html`<${Stack} direction="wrap" align="end">
      <${Field} value=${ctx.newName} placeholder=${x('newPlaceholder')} ariaLabel=${x('newName')} onInput=${(e) => ctx.setNewName(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && ctx.createProject()} />
      <${Action} kind="primary" disabled=${ctx.busy === 'create' || !ctx.newName.trim()} onClick=${() => ctx.createProject()}>${x('newCalibration')}<//>
      ${archived.length ? html`<${Action} onClick=${() => ctx.setShowArchived(!ctx.showArchived)}>${ctx.showArchived ? x('hideArchived') : x('showArchived', { n: archived.length })}<//>` : null}
    <//>`}
    rail=${html`<${Rail} kind="index" label=${x('railTitle')}>${pageLinks()}<//>`}>
    <${Stack}>
      <${Text} tone="muted">${x('listDesc')}<//>
      ${!ctx.projects ? html`<${Text} tone="muted">${x('loading')}<//>` : !shown.length ? html`<${Text}><strong>${x('emptyLead')}</strong> ${x('emptyBody')}<//>` : html`
        <div>
          <${ListRow} density="compact" name=${html`<${Text} kind="label">${x('colCalibration')} · ${x('colState')}<//>`} value=${html`<${Text} kind="label">${x('colScore')}<//>`} />
          ${shown.map((p) => listRow(ctx, p))}
        </div>`}
      <${Text} kind="caption" tone="muted">${x('listHint')}<//>
    <//>
  <//>`;
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
    <${ListRow} key=${p.projectId} muted=${p.status === 'archived'} name=${p.name} onOpen=${() => ctx.openProject(p.projectId)}
      detail=${`${p.currentVersion ? x('versionN', { n: p.currentVersion }) + ' · ' : ''}${dateWord(p.createdAt)}${p.status === 'archived' ? ' · ' + x('archived') : ''}`}
      value=${score != null
        ? html`<${Stack} density="compact"><${Text} kind="number" size="small" tone=${scoreTone(score)}>${score} %<//><${Text} kind="caption" tone="muted">${x('scoreSub')}<//><//>`
        : html`<${Text} tone="muted">${runs ? x('noScoreYet') : x('noRunsYet')}<//>`}
      actions=${html`<${Action} onClick=${() => ctx.openProject(p.projectId)}>${x('open')}<//>`}>
      <${Text} kind="caption" tone="muted">${state}<//>
    <//>`;
}

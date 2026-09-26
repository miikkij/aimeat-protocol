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
 *   v2.0.0 -- 2026-09-26 -- The page passes data to the library's components and writes no class: the frame is SettingsPage (crumb, head, rail as data), the rows the List, the score the Figure, the new name the Text field with its Loud action, the lines the Note (component plan, page group G4).
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
import { SettingsPage } from '/components/SettingsPage.js';
import { List, Row, Name, Desc, Cell, Doors } from '/components/List.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Figure } from '/components/Figure.js';
import { TextField } from '/components/TextField.js';

/** A score's state colour: fine from 80 %, the plain colour from 50 %, coral under it. */
const scoreTone = (v) => (v >= 80 ? 'fine' : v >= 50 ? undefined : 'notice');

export function renderList(ctx) {
  const all = ctx.projects || [];
  const live = all.filter((p) => p.status !== 'archived');
  const archived = all.filter((p) => p.status === 'archived');
  const shown = ctx.showArchived ? all : live;
  const scored = live.filter((p) => p.latestAvgScore != null);
  const marks = [
    ctx.projects ? { label: x('chipCalibrations', { n: live.length }), tone: 'sun' } : null,
    scored.length ? { label: x('chipScored', { n: scored.length }) } : null,
    archived.length ? { label: x('chipArchived', { n: archived.length }) } : null,
  ];
  const actions = html`
    <${TextField} value=${ctx.newName} placeholder=${x('newPlaceholder')} ariaLabel=${x('newName')} onInput=${(v) => ctx.setNewName(v)} onEnter=${() => ctx.createProject()}
      actions=${html`<${Loud} control disabled=${ctx.busy === 'create' || !ctx.newName.trim()} onClick=${() => ctx.createProject()}>${x('newCalibration')}<//>`} />
    <${Actions}>
      ${archived.length ? html`<${Action} tone="more" onClick=${() => ctx.setShowArchived(!ctx.showArchived)}>${ctx.showArchived ? x('hideArchived') : x('showArchived', { n: archived.length })}<//>` : null}
    <//>`;
  return html`
    <${SettingsPage} crumb=${crumb()} title=${t('profile.calibrator.tabLabel')} sub=${x('titleSub')} marks=${marks} desc=${x('listDesc')}
      actions=${actions} railTitle=${x('railTitle')} pagesLabel=${x('pages')} pages=${pageLinks()}>
      <${List} cols="name-score-desc-doors" loading=${!ctx.projects ? x('loading') : false}
        head=${[x('colCalibration'), x('colScore'), x('colState'), '']}
        empty=${html`<${Note} kind="quiet"><b>${x('emptyLead')}</b> ${x('emptyBody')}<//>`}>
        ${shown.map((p) => listRow(ctx, p))}
      <//>
      <${Note}>${x('listHint')}<//>
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
    <${Row} key=${p.projectId} faded=${p.status === 'archived'}>
      <${Name} onOpen=${() => ctx.openProject(p.projectId)} meta=${html`${p.currentVersion ? x('versionN', { n: p.currentVersion }) + ' · ' : ''}${dateWord(p.createdAt)}${p.status === 'archived' ? ' · ' + x('archived') : ''}`}>${p.name}<//>
      ${score != null
        ? html`<${Cell}><${Figure} small tone=${scoreTone(score)} n=${`${score} %`} sub=${x('scoreSub')} /><//>`
        : html`<${Cell} dim>${runs ? x('noScoreYet') : x('noRunsYet')}<//>`}
      <${Desc}>${state}<//>
      <${Doors}><${Action} small row onClick=${() => ctx.openProject(p.projectId)}>${x('open')}<//><//>
    <//>`;
}

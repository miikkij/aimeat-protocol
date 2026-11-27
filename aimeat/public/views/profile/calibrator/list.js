/**
 * @file public/views/profile/calibrator/list.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The calibrations as a list in the poster face: the mast says in two sentences what a
 *   calibration gives and takes the name of a new one; the start (PageStart "calibrator": what it is
 *   for, the prompt for one's own AI, what happens next) and the title's question mark
 *   (concept.calibration) explain it (.claude/rules/page-guidance.md); each calibration is a row
 *   with its latest score, its judge and its runs; archived ones are folded away behind one door.
 * @structure renderList · listRow
 * @usage import { renderList } from './list.js';
 * @version-history
 *   v2.3.0 -- 2026-11-27 -- The new calibration's name field and its loud action stand in section 01
 *     under the rows, with a label (calpage.newNameLabel); in the head the field stood beside a pale
 *     disabled button.
 *   v2.2.0 -- 2026-11-27 -- Settings usability pass: the calibrations are section 01 (cal-list) beside
 *     the contents rail, with Show archived as the section's quiet action. A figure strip under the
 *     head says how many calibrations are in use, the mean of their latest scores, how many runs
 *     they hold and how many have not run yet (attention tone), all from the list the page already
 *     reads; it replaces the head's tags, which said the first two. New calibration stays the one loud
 *     action. Only the Calibrator page imports this file. Second pass, same day: the strip takes
 *     hideZeros, so an account with no calibration opens on the list's empty line; calibrations that
 *     have not run yet are listed first; the rail no longer names the page's one section (its page
 *     links stay); the comment that said the calibrator has no MCP tool is corrected.
 *   v2.1.0 -- 2026-11-08 -- The page explains itself the designed way (.claude/rules/page-guidance.md): PageStart "calibrator" (folded once there is a calibration) and the title's question mark concept.calibration, which now holds how a calibration works; the head's paragraph is two sentences.
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
import { Action, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Section } from '/components/Section.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Figure } from '/components/Figure.js';
import { TextField } from '/components/TextField.js';
import { PageStart } from '/components/PageStart.js';

/** A score's state colour: fine from 80 %, the plain colour from 50 %, coral under it. */
const scoreTone = (v) => (v >= 80 ? 'fine' : v >= 50 ? undefined : 'notice');

export function renderList(ctx) {
  const all = ctx.projects || [];
  const live = all.filter((p) => p.status !== 'archived');
  const archived = all.filter((p) => p.status === 'archived');
  const shown = ctx.showArchived ? all : live;
  const scored = live.filter((p) => p.latestAvgScore != null);
  // A new calibration's name is a field in the list's section, under the rows it joins; in the page's
  // head it stood beside a pale disabled button before a word was typed.
  const create = html`
    <${TextField} label=${x('newNameLabel')} value=${ctx.newName} placeholder=${x('newPlaceholder')} onInput=${(v) => ctx.setNewName(v)} onEnter=${() => ctx.createProject()}
      actions=${html`<${Loud} control disabled=${ctx.busy === 'create' || !ctx.newName.trim()} onClick=${() => ctx.createProject()}>${x('newCalibration')}<//>`} />`;
  // The start: folded once there is a calibration. Its first step is in the person's own AI, which
  // helps write the prompt and the target output; over MCP it also has the aimeat_calibrator tool
  // (src/tool-catalog/definitions/calibrator.ts) to read and change calibrations, but not to run models.
  const start = html`<${PageStart} id="calibrator" done=${ctx.projects ? all.length > 0 : null} />`;
  return html`
    <${SettingsPage} crumb=${crumb()} title=${t('profile.calibrator.tabLabel')} sub=${x('titleSub')} help="concept.calibration" desc=${x('listDesc')}
      start=${start} strip=${listStrip(ctx.projects, live, archived, scored)}
      railTitle=${x('railTitle')} pagesLabel=${x('pages')} pages=${pageLinks()}>
      <${Section} id="cal-list" num="01" title=${x('secList')} count=${ctx.projects ? shown.length : undefined} first
        doors=${archived.length ? html`<${Action} tone="more" onClick=${() => ctx.setShowArchived(!ctx.showArchived)}>${ctx.showArchived ? x('hideArchived') : x('showArchived', { n: archived.length })}<//>` : null}>
        <${List} cols="name-score-desc-doors" loading=${!ctx.projects ? x('loading') : false}
          head=${[x('colCalibration'), x('colScore'), x('colState'), '']}
          empty=${html`<${Note} kind="quiet"><b>${x('emptyLead')}</b> ${x('emptyBody')}<//>`}>
          ${firstNeeded(shown).map((p) => listRow(ctx, p))}
        <//>
        ${create}
        <${Note}>${x('listHint')}<//>
      <//>
    <//>`;
}

/**
 * The rows in the order a person acts on them: a calibration in use that has not run yet first (the
 * strip's attention figure), then the others in use, archived ones last. The sort is stable, so the
 * list's own order (newest first) holds within each group.
 */
function firstNeeded(rows) {
  const rank = (p) => (p.status === 'archived' ? 2 : Number(p.batchCount) > 0 ? 1 : 0);
  return rows.slice().sort((a, b) => rank(a) - rank(b));
}

/**
 * Where the calibrations stand, from the list already read (GET /v1/calibrator): how many are in use,
 * the mean of their latest scores, how many runs they hold, and how many have not run yet (the one
 * that needs the person, so it takes the attention tone). The head's tags said the first two before.
 */
function listStrip(projects, live, archived, scored) {
  if (!projects) return html`<${FigureStrip} loading=${4} />`;
  const mean = scored.length ? Math.round(scored.reduce((n, p) => n + p.latestAvgScore, 0) / scored.length) : null;
  const runs = live.reduce((n, p) => n + (Number(p.batchCount) || 0), 0);
  const notRun = live.filter((p) => !(Number(p.batchCount) > 0)).length;
  const noPrompt = live.filter((p) => !p.currentVersion).length;
  // hideZeros: with no calibration the strip is not drawn and the list's empty line says how to begin.
  return html`<${FigureStrip} wrap hideZeros items=${[
    { key: 'live', n: live.length, label: x('stripCalibrations'), sub: archived.length ? x('chipArchived', { n: archived.length }) : undefined },
    mean != null
      ? { key: 'score', n: `${mean} %`, label: x('stripScore'), sub: x('chipScored', { n: scored.length }) }
      : { key: 'score', n: '·', tone: 'dim', label: x('stripScore'), sub: x('stripNoRuns') },
    { key: 'runs', n: runs, label: x('stripRuns') },
    { key: 'notRun', n: notRun, tone: notRun ? 'notice' : undefined, label: x('stripNotRun'),
      sub: noPrompt ? x('stripNoPromptSub', { n: noPrompt }) : undefined },
  ]} />`;
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

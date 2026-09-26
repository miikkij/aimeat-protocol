/**
 * @file public/views/profile/calibrator/page.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One calibration in the poster face, result first: the mast names it and starts a
 *   run; the strip says the latest score and where it came from; then 01 the runs as rows with the
 *   chart, 02 the prompt and the target output with their versions, 03 the models (models.js), 04
 *   the four instruction prompts folded, 05 how your own AI calibrates. Pure render over the ctx
 *   bag the tab builds; the run rows are run.js.
 * @structure renderPage · mast · strip · secRuns · secPrompt · versionRow · secTemplates · secRoads
 * @usage import { renderPage } from './page.js';
 * @version-history
 *   v2.0.0 -- 2026-09-26 -- The page passes data to the library's components and writes no class: the frame is SettingsPage (crumb, head with its rename field, strip, rail as data), the sections Section (the four instruction prompts still fold), the runs and the versions the List, the editors Field and Text area with the count beside the label, the roads Roads, the lines Note (component plan, page group G4).
 *   v1.17.0 -- 2026-09-26 -- The ready-made request is the Code block (css/components/code-block.css), a unification: Jouni's decision "Code block".
 *   v1.16.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.15.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.14.0 -- 2026-09-25 -- A line that says what happened after an action is the Form message, a failure in its error tone (a unification: the look most tabs use).
 *   v1.13.0 -- 2026-09-25 -- The runs are the Listing (css/components/listing.css), a unification: the look most tabs use.
 *   v1.12.0 -- 2026-09-25 -- A framed box around one thing is the Object box (.poster-box; on a grey ground its copy tone), in the tone its look already was (Jouni's decision "Object box", a unification).
 *   v1.11.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.10.0 -- 2026-09-25 -- The line a form says after it acted is the Form message; a refusal is its error tone (UI consolidation phase 5, a unification).
 *   v1.9.0 -- 2026-09-25 -- A lead or a paragraph that opens or explains a section is the og-lead; a grey one that explains is the Hint (UI consolidation phase 5, a unification).
 *   v1.8.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.7.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.6.0 -- 2026-09-25 -- A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v1.5.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.4.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   v1.3.0 -- 2026-09-25 -- The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.2.0 -- 2026-09-13 -- Compose existing top rules from poster.css.
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-09-04 — Initial (design canvas "AIMEAT Kalibraattori-sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { SettingsPage } from '/components/SettingsPage.js';
import { Section } from '/components/Section.js';
import { Folds } from '/components/Folds.js';
import { railSection } from '/components/Rail.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Figure } from '/components/Figure.js';
import { List, Row, Cell, Doors } from '/components/List.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Field, Fields } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Roads, Road } from '/components/Roads.js';
import { Stack } from '/components/Layout.js';
import { x, dateWord, timeWord, isEmptyRun, runAverage, runsInOrder, judgeOf, candidatesOf, crumb, pageLinks } from './frame.js';
import { ScoreChart } from './chart.js';
import { runRow, emptiesRow } from './run.js';
import { secModels } from './models.js';

const msg = (m) => (m ? html`<${Note} kind="message" error=${!!m.error}>${m.text}<//>` : null);
const TEMPLATES = [
  { key: 'analysis', field: 'analysisPromptTemplate' },
  { key: 'reflection', field: 'reflectionPromptTemplate' },
  { key: 'selfReflection', field: 'selfReflectionPromptTemplate' },
  { key: 'synthesis', field: 'synthesisPromptTemplate' },
];
export const TEMPLATE_FIELDS = Object.fromEntries(TEMPLATES.map((tp) => [tp.key, tp.field]));

export function renderPage(ctx) {
  const p = ctx.project;
  const runs = runsInOrder(ctx.batches);
  const empties = (ctx.batches || []).filter(isEmptyRun);
  const latest = runs.length ? runs[runs.length - 1] : null;
  const sections = [
    { num: '01', id: 'cal-runs', label: x('secRuns'), count: runs.length ? x('railRuns', { n: runs.length }) : '0' },
    { num: '02', id: 'cal-prompt', label: x('secPrompt'), count: p.currentVersion ? 'v' + p.currentVersion : '' },
    { num: '03', id: 'cal-models', label: x('secModels'), count: x('railModels', { n: candidatesOf(p).length }) },
    { num: '04', id: 'cal-templates', label: x('secTemplates'), count: '4' },
    { num: '05', id: 'cal-roads', label: x('secRoads'), count: '' },
  ];
  const rail = {
    title: x('railTitle'),
    groups: [
      { label: x('railTitle'), items: sections.map(railSection) },
      { items: [{ back: true, key: 'back', label: x('allCalibrations'), onClick: () => ctx.back() }] },
      { label: x('pages'), rule: false, items: pageLinks() },
    ],
  };
  return html`
    <${SettingsPage} page crumb=${crumb(p.name)} ...${mast(ctx, runs, latest)} strip=${strip(ctx, runs, latest)} rail=${rail}
      after=${html`<${ctx.ConfirmUI} />`}>
      ${secRuns(ctx, runs, empties)}
      ${secPrompt(ctx)}
      ${secModels(ctx)}
      ${secTemplates(ctx)}
      ${secRoads(ctx)}
    <//>`;
}

/** The head's data: the name (or its rename field), the tags, the sentence, the run and the doors. */
function mast(ctx, runs, latest) {
  const p = ctx.project;
  const judge = judgeOf(p, ctx.settings);
  const cands = candidatesOf(p);
  const avg = latest ? runAverage(latest) : null;
  const canRun = !!p.currentVersion && cands.length > 0 && ctx.keyed && !ctx.anyRunning;
  const marks = [
    avg != null ? { label: x('chipLatest', { n: avg }), tone: 'sun' } : { label: p.currentVersion ? x('chipNoRuns') : x('chipNoPrompt'), tone: 'coral' },
    { label: x('chipCandidates', { n: cands.length }) },
    judge.modelId ? { label: x('chipJudge', { name: judge.label }) } : null,
    { label: x('chipRunsVersions', { runs: (ctx.batches || []).length, done: runs.length, v: p.currentVersion || 0 }) },
    p.status === 'archived' ? { label: x('archived') } : null,
  ];
  const edit = ctx.renaming ? html`
    <${TextField} value=${ctx.nameDraft} ariaLabel=${x('rename')} onInput=${(v) => ctx.setNameDraft(v)} onEnter=${() => ctx.saveName()} onEscape=${() => ctx.setRenaming(false)}
      actions=${html`
        <${Action} small disabled=${!ctx.nameDraft.trim() || ctx.busy === 'project'} onClick=${() => ctx.saveName()}>${x('save')}<//>
        <${Action} small soft onClick=${() => ctx.setRenaming(false)}>${x('cancel')}<//>`} />` : null;
  const desc = html`${x('projectDesc')}${avg != null && runs.length >= 2 ? ' ' + x('projectDescTrend', { from: runAverage(runs[0]) ?? 0, to: avg, n: runs.length }) : ''}${msg(ctx.projectMsg)}`;
  const actions = html`
    <${Loud} control disabled=${!canRun} onClick=${() => ctx.newRun()}>${ctx.anyRunning ? x('running') : x('newRun')}<//>
    ${!canRun && !ctx.anyRunning ? html`<${Note} kind="hint" slab inline>${!ctx.keyed ? x('needKey') : !p.currentVersion ? x('needPrompt') : !cands.length ? x('needCandidate') : ''}<//>` : null}
    <${Actions}>
      <${Action} small soft onClick=${() => ctx.setRenaming(true)}>${x('rename')}<//>
      <${Action} small soft disabled=${ctx.busy === 'project'} onClick=${() => ctx.setArchived(p.status !== 'archived')}>${p.status === 'archived' ? x('unarchive') : x('archive')}<//>
      <${Action} small soft tone="danger" disabled=${ctx.busy === 'project'} onClick=${() => ctx.deleteProject()}>${x('deleteCalibration')}<//>
    <//>`;
  return { title: p.name, sub: x('titleSubProject'), edit, marks, desc, actions };
}

function strip(ctx, runs, latest) {
  const p = ctx.project;
  const judge = judgeOf(p, ctx.settings);
  const cands = candidatesOf(p);
  const avg = latest ? runAverage(latest) : null;
  const first = runs.length >= 2 ? runAverage(runs[0]) : null;
  const cur = ctx.current;
  return html`<${FigureStrip} items=${[
    avg != null
      ? { key: 'latest', n: `${avg} %`, label: x('stripLatest'), sub: x('stripLatestSub', { date: dateWord(latest.createdAt), v: latest.promptVersion, n: (latest.scores || []).length }) }
      : { key: 'latest', n: '·', tone: 'dim', label: x('stripLatest'), sub: x('stripNoRuns') },
    first != null && avg != null
      ? { key: 'trend', n: `${first} % → ${avg} %`, label: x('stripTrend', { n: runs.length }), sub: x('stripTrendSub', { from: runs[0].promptVersion, to: latest.promptVersion }) }
      : { key: 'trend', n: '·', tone: 'dim', label: x('stripTrend', { n: runs.length }), sub: x('stripTrendNone') },
    { key: 'models', n: cands.length, label: x('stripCandidates'), sub: judge.modelId ? x('stripJudge', { name: judge.label }) : x('stripNoJudge') },
    cur
      ? { key: 'version', n: `v${cur.version}`, label: x('stripVersion'), sub: html`${dateWord(cur.createdAt)} · ${cur.changelog || ''}` }
      : { key: 'version', n: '·', tone: 'dim', label: x('stripVersion'), sub: x('stripNoVersion') },
  ]} />`;
}

/* ── 01 ───────────────────────────────────────────────────────────────────────────────────────── */

function secRuns(ctx, runs, empties) {
  const newest = runs.slice().reverse();
  return html`
    <${Section} id="cal-runs" num="01" title=${x('secRuns')} count=${runs.length ? x('secRunsSub', { n: runs.length, empty: empties.length }) : null} first=${true}>
      <${List} cols="name-score-desc-doors" head=${[x('colRun'), x('colScores'), x('colWhat'), '']}
        empty=${html`<${Note} kind="quiet"><b>${x('noRunsLead')}</b> ${x('noRunsBody')}<//>`}>
        ${newest.map((r) => runRow(ctx, r))}
        ${emptiesRow(ctx, empties)}
      <//>
      ${runs.filter((r) => runAverage(r) != null).length ? html`<${ScoreChart} runs=${runs} />` : null}
      <${Note}>${x('hintRuns')}<//>
    <//>`;
}

/* ── 02 ───────────────────────────────────────────────────────────────────────────────────────── */

function secPrompt(ctx) {
  const p = ctx.project;
  const viewing = ctx.viewing;
  const readOnly = !!viewing && viewing.version !== p.currentVersion;
  const versions = (ctx.versions || []).slice().reverse();
  return html`
    <${Section} id="cal-prompt" num="02" title=${x('secPrompt')} count=${p.currentVersion ? x('secPromptSub', { n: (ctx.versions || []).length }) : null}>
      <${List} cols="label-words-doors" empty=${html`<${Note} kind="quiet"><b>${x('noVersionLead')}</b> ${x('noVersionBody')}<//>`}>
        ${versions.map((v) => versionRow(ctx, v, viewing))}
      <//>
      ${readOnly ? html`<${Note} kind="message">${x('viewingOld', { n: viewing.version })} <${Action} tone="back" onClick=${() => ctx.backToCurrent()}>${x('backToCurrent')}<//><//>` : null}
      <${Fields} cols=${2}>
        <${Field} id="cal-prompt-text" label=${html`${x('prompt')}${viewing ? ` · v${viewing.version}` : ''}`} labelNote=${x('charsN', { n: (ctx.promptDraft || '').length })}>
          <${TextArea} id="cal-prompt-text" rows=${12} value=${ctx.promptDraft} disabled=${readOnly} placeholder=${x('promptPlaceholder')} ariaLabel=${x('prompt')} onInput=${(v) => ctx.setPromptDraft(v)} />
          <${Actions}><${Action} small soft copy=${ctx.promptDraft} disabled=${!ctx.promptDraft}>${x('copyPrompt')}<//><//>
        <//>
        <${Field} id="cal-target-text" label=${x('target')} labelNote=${x('charsN', { n: (ctx.targetDraft || '').length })}>
          <${TextArea} id="cal-target-text" rows=${12} value=${ctx.targetDraft} disabled=${readOnly} placeholder=${x('targetPlaceholder')} ariaLabel=${x('target')} onInput=${(v) => ctx.setTargetDraft(v)} />
          <${Actions}><${Action} small soft copy=${ctx.targetDraft} disabled=${!ctx.targetDraft}>${x('copyTarget')}<//><//>
        <//>
      <//>
      ${!readOnly ? html`
        <${Stack} above="large">
          <${TextField} value=${ctx.changelog} placeholder=${x('changelogPlaceholder')} ariaLabel=${x('changelog')} onInput=${(v) => ctx.setChangelog(v)}
            actions=${html`<${Loud} control disabled=${ctx.busy === 'version' || !ctx.promptDraft.trim() || !ctx.dirty} onClick=${() => ctx.saveVersion()}>${p.currentVersion ? x('saveVersion', { n: p.currentVersion + 1 }) : x('saveFirstVersion')}<//>`} />
          <${Note}>${p.currentVersion ? x('saveVersionHint') : x('saveFirstVersionHint')}<//>
        <//>` : null}
      ${msg(ctx.promptMsg)}
      <${Note}>${x('hintPrompt')}<//>
    <//>`;
}

function versionRow(ctx, v, viewing) {
  const p = ctx.project;
  const shown = viewing ? viewing.version === v.version : v.version === p.currentVersion;
  return html`
    <${Row} key=${v.version} selected=${shown}>
      <${Cell}><${Figure} small n=${`v${v.version}`} sub=${`${dateWord(v.createdAt)} ${timeWord(v.createdAt)}`} /><//>
      <${Cell}>${v.changelog || x('noChangelog')}${v.version === p.currentVersion ? html` <${Mark} tone="sun">${x('current')}<//>` : null}<//>
      <${Doors}>${shown
        ? html`<${Note} kind="meta" inline>${x('shown')}<//>`
        : html`<${Action} small row soft onClick=${() => ctx.viewVersion(v.version)}>${x('show')}<//>`}<//>
    <//>`;
}

/* ── 04 ───────────────────────────────────────────────────────────────────────────────────────── */

function secTemplates(ctx) {
  return html`
    <${Section} id="cal-templates" num="04" title=${x('secTemplates')} count=${null}>
      <${Note} kind="lead">${x('templatesIntro')}<//>
      <${Folds}>
        ${TEMPLATES.map((tp, i) => {
          const open = ctx.templatesOpen.has(tp.key);
          const draft = ctx.templateDrafts[tp.key] ?? '';
          const stored = ctx.project[tp.field] || '';
          return html`
            <${Section} fold key=${tp.key} id=${'cal-tpl-' + tp.key} num=${String(i + 1).padStart(2, '0')} title=${x('tpl.' + tp.key)} sub=${x('charsN', { n: stored.length })} open=${open} onToggle=${() => ctx.toggleTemplate(tp.key)}>
              <${Note} kind="lead">${x('tplWhat.' + tp.key)}<//>
              <${Note}>${x('tplSlots.' + tp.key)}<//>
              <${TextArea} rows=${14} value=${draft} ariaLabel=${x('tpl.' + tp.key)} onInput=${(v) => ctx.setTemplateDraft(tp.key, v)} />
              <${Actions}>
                <${Action} small disabled=${ctx.busy === 'template' || draft === stored || !draft.trim()} onClick=${() => ctx.saveTemplate(tp.key)}>${x('save')}<//>
                <${Action} small soft disabled=${ctx.busy === 'template'} onClick=${() => ctx.resetTemplate(tp.key)}>${x('resetTemplate')}<//>
                <${Action} small soft copy=${draft}>${x('copy')}<//>
              <//>
            <//>`;
        })}
      <//>
      ${msg(ctx.templateMsg)}
    <//>`;
}

/* ── 05 ───────────────────────────────────────────────────────────────────────────────────────── */

function secRoads(ctx) {
  const request = ctx.leadRequest();
  return html`
    <${Section} id="cal-roads" num="05" title=${x('secRoads')} count=${null}>
      <${Note} kind="lead">${x('roadsIntro')}<//>
      <${Roads}>
        <${Road} lead name=${x('roadLead')} text=${x('roadLeadBody', { name: ctx.project.name })} code=${request}
          doors=${html`<${Action} small copy=${request}>${x('copyRequest')}<//>`} />
        <${Road} name=${x('roadSteps')} text=${x('roadStepsBody')} />
      <//>
      <${Note}>${x('hintRoads')}<//>
    <//>`;
}

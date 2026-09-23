/**
 * @file public/views/profile/calibrator/page.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One calibration in the poster face, result first: the mast names it and starts a
 *   run; the strip says the latest score and where it came from; then 01 the runs as rows with the
 *   chart, 02 the prompt and the target output with their versions, 03 the models (models.js), 04
 *   the four instruction prompts folded, 05 how your own AI calibrates. Pure render over the ctx
 *   bag the tab builds; the run rows are run.js.
 * @structure renderPage · identity · strip · secRuns · secPrompt · versionRow · secTemplates · secRoads
 * @usage import { renderPage } from './page.js';
 * @version-history
 *   2026-09-22 -- Composed from the shared set (Page, Rail, Section, Fold, NumeralBand, ListRow, Field,
 *     Surface); the rename form sits in the masthead's identity line; calibrator-poster.css is gone.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   v1.2.0 -- 2026-09-13 -- Compose existing top rules from poster.css.
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-09-04 — Initial (design canvas "AIMEAT Kalibraattori-sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { Page, Rail, Section, Fold, Stack, Columns, NumeralBand, ListRow, Field, Surface, Text, Chip, Action, CopyAction } from '/components/poster-parts.js';
import { StatusLine } from '../ai/frame.js';
import { x, dateWord, timeWord, isEmptyRun, runAverage, runsInOrder, judgeOf, candidatesOf, crumb, pageLinks } from './frame.js';
import { ScoreChart } from './chart.js';
import { runRow, emptiesRow } from './run.js';
import { secModels } from './models.js';

export const msg = (m) => (m ? html`<${StatusLine} error=${m.error}>${m.text}<//>` : null);
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
  const cands = candidatesOf(p);
  const canRun = !!p.currentVersion && cands.length > 0 && ctx.keyed && !ctx.anyRunning;
  const rail = html`<${Rail} kind="index" title=${x('railTitle')} entries=${[
    { href: '#cal-runs', label: x('secRuns'), count: runs.length ? x('railRuns', { n: runs.length }) : '0' },
    { href: '#cal-prompt', label: x('secPrompt'), count: p.currentVersion ? 'v' + p.currentVersion : undefined },
    { href: '#cal-models', label: x('secModels'), count: x('railModels', { n: cands.length }) },
    { href: '#cal-templates', label: x('secTemplates'), count: '4' },
    { href: '#cal-roads', label: x('secRoads') },
  ]}><${Stack}>
    <${Action} onClick=${() => ctx.back()}>↩ ${x('allCalibrations')}<//>
    ${pageLinks()}
  <//><//>`;
  return html`<${Page} crumbs=${crumb(p.name, () => ctx.back())} title=${p.name} identity=${identity(ctx, runs, latest)}
    actions=${html`<${Stack} align="end" density="compact">
      <${Action} kind="primary" disabled=${!canRun} onClick=${() => ctx.newRun()}>${ctx.anyRunning ? x('running') : x('newRun')}<//>
      ${!canRun && !ctx.anyRunning ? html`<${Text} kind="caption" tone="muted">${!ctx.keyed ? x('needKey') : !p.currentVersion ? x('needPrompt') : !cands.length ? x('needCandidate') : ''}<//>` : null}
      <${Stack} direction="wrap" align="end">
        <${Action} onClick=${() => ctx.setRenaming(true)}>${x('rename')}<//>
        <${Action} disabled=${ctx.busy === 'project'} onClick=${() => ctx.setArchived(p.status !== 'archived')}>${p.status === 'archived' ? x('unarchive') : x('archive')}<//>
        <${Action} tone="danger" disabled=${ctx.busy === 'project'} onClick=${() => ctx.deleteProject()}>${x('deleteCalibration')}<//>
      <//>
    <//>`}
    rail=${rail}>
    <${Stack}>
      <${Text} tone="muted">${x('projectDesc')}${latest && runAverage(latest) != null && runs.length >= 2 ? ' ' + x('projectDescTrend', { from: runAverage(runs[0]) ?? 0, to: runAverage(latest), n: runs.length }) : ''}<//>
      ${msg(ctx.projectMsg)}
      ${strip(ctx, runs, latest)}
      ${secRuns(ctx, runs, empties)}
      ${secPrompt(ctx)}
      ${secModels(ctx)}
      ${secTemplates(ctx)}
      ${secRoads(ctx)}
    <//>
    <${ctx.ConfirmUI} />
  <//>`;
}

function identity(ctx, runs, latest) {
  const p = ctx.project;
  const judge = judgeOf(p, ctx.settings);
  const cands = candidatesOf(p);
  const avg = latest ? runAverage(latest) : null;
  return html`<${Stack} density="compact">
    ${ctx.renaming ? html`
      <${Stack} direction="wrap" align="end">
        <${Field} value=${ctx.nameDraft} ariaLabel=${x('rename')} autoFocus=${true} onInput=${(e) => ctx.setNameDraft(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') ctx.saveName(); if (e.key === 'Escape') ctx.setRenaming(false); }} />
        <${Action} disabled=${!ctx.nameDraft.trim() || ctx.busy === 'project'} onClick=${() => ctx.saveName()}>${x('save')}<//>
        <${Action} onClick=${() => ctx.setRenaming(false)}>${x('cancel')}<//>
      <//>` : html`<${Text} tone="muted">${x('titleSubProject')}<//>`}
    <${Stack} direction="wrap" density="compact">
      ${avg != null ? html`<${Chip} tone="sun">${x('chipLatest', { n: avg })}<//>` : html`<${Chip} tone="coral">${p.currentVersion ? x('chipNoRuns') : x('chipNoPrompt')}<//>`}
      <${Chip}>${x('chipCandidates', { n: cands.length })}<//>
      ${judge.modelId ? html`<${Chip}>${x('chipJudge', { name: judge.label })}<//>` : null}
      <${Chip} tone="muted">${x('chipRunsVersions', { runs: (ctx.batches || []).length, done: runs.length, v: p.currentVersion || 0 })}<//>
      ${p.status === 'archived' ? html`<${Chip} tone="muted">${x('archived')}<//>` : null}
    <//>
  <//>`;
}

function strip(ctx, runs, latest) {
  const p = ctx.project;
  const judge = judgeOf(p, ctx.settings);
  const cands = candidatesOf(p);
  const avg = latest ? runAverage(latest) : null;
  const first = runs.length >= 2 ? runAverage(runs[0]) : null;
  const cur = ctx.current;
  return html`<${NumeralBand} tone="plain" size="small" items=${[
    avg != null
      ? { id: 'latest', label: x('stripLatest'), value: `${avg} %`, note: x('stripLatestSub', { date: dateWord(latest.createdAt), v: latest.promptVersion, n: (latest.scores || []).length }) }
      : { id: 'latest', label: x('stripLatest'), value: '·', note: x('stripNoRuns') },
    first != null && avg != null
      ? { id: 'trend', label: x('stripTrend', { n: runs.length }), value: `${first} % → ${avg} %`, note: x('stripTrendSub', { from: runs[0].promptVersion, to: latest.promptVersion }) }
      : { id: 'trend', label: x('stripTrend', { n: runs.length }), value: '·', note: x('stripTrendNone') },
    { id: 'cands', label: x('stripCandidates'), value: cands.length, note: judge.modelId ? x('stripJudge', { name: judge.label }) : x('stripNoJudge') },
    cur
      ? { id: 'ver', label: x('stripVersion'), value: `v${cur.version}`, note: `${dateWord(cur.createdAt)} · ${cur.changelog || ''}` }
      : { id: 'ver', label: x('stripVersion'), value: '·', note: x('stripNoVersion') },
  ]} />`;
}

/* ── 01 ───────────────────────────────────────────────────────────────────────────────────────── */

function secRuns(ctx, runs, empties) {
  const newest = runs.slice().reverse();
  return html`
    <${Section} id="cal-runs" title=${x('secRuns')} count=${runs.length ? x('secRunsSub', { n: runs.length, empty: empties.length }) : null}>
      <${Stack}>
        ${!runs.length && !empties.length ? html`<${Text}><strong>${x('noRunsLead')}</strong> ${x('noRunsBody')}<//>` : html`
          <div>
            <${ListRow} density="compact" name=${html`<${Text} kind="label">${x('colRun')} · ${x('colWhat')}<//>`} value=${html`<${Text} kind="label">${x('colScores')}<//>`} />
            ${newest.map((r) => runRow(ctx, r))}
            ${emptiesRow(ctx, empties)}
          </div>`}
        ${runs.filter((r) => runAverage(r) != null).length ? html`<${ScoreChart} runs=${runs} />` : null}
        <${Text} kind="caption" tone="muted">${x('hintRuns')}<//>
      <//>
    <//>`;
}

/* ── 02 ───────────────────────────────────────────────────────────────────────────────────────── */

function secPrompt(ctx) {
  const p = ctx.project;
  const viewing = ctx.viewing;
  const readOnly = !!viewing && viewing.version !== p.currentVersion;
  const versions = (ctx.versions || []).slice().reverse();
  const editor = (label, value, placeholder, onInput, copyLabel) => html`<${Stack} density="compact">
    <${Field} type="textarea" rows=${12} label=${label} value=${value} disabled=${readOnly} placeholder=${placeholder} onInput=${onInput} />
    <div><${CopyAction} text=${value} label=${copyLabel} disabled=${!value} /></div>
  <//>`;
  return html`
    <${Section} id="cal-prompt" title=${x('secPrompt')} count=${p.currentVersion ? x('secPromptSub', { n: (ctx.versions || []).length }) : null}>
      <${Stack}>
        ${versions.length ? html`
          <${Surface} kind="plain" density="flush" height="scroll">${versions.map((v) => versionRow(ctx, v, viewing))}<//>` : html`<${Text}><strong>${x('noVersionLead')}</strong> ${x('noVersionBody')}<//>`}
        ${readOnly ? html`<${Stack} direction="wrap" align="center"><${Text} tone="coral">${x('viewingOld', { n: viewing.version })}<//><${Action} onClick=${() => ctx.backToCurrent()}>${x('backToCurrent')}<//><//>` : null}
        <${Columns} collapse="640">
          ${editor(`${x('prompt')}${viewing ? ` · v${viewing.version}` : ''} · ${x('charsN', { n: (ctx.promptDraft || '').length })}`, ctx.promptDraft, x('promptPlaceholder'), (e) => ctx.setPromptDraft(e.target.value), x('copyPrompt'))}
          ${editor(`${x('target')} · ${x('charsN', { n: (ctx.targetDraft || '').length })}`, ctx.targetDraft, x('targetPlaceholder'), (e) => ctx.setTargetDraft(e.target.value), x('copyTarget'))}
        <//>
        ${!readOnly ? html`
          <${Stack} direction="wrap" align="end">
            <${Field} value=${ctx.changelog} placeholder=${x('changelogPlaceholder')} ariaLabel=${x('changelog')} onInput=${(e) => ctx.setChangelog(e.target.value)} />
            <${Action} disabled=${ctx.busy === 'version' || !ctx.promptDraft.trim() || !ctx.dirty} onClick=${() => ctx.saveVersion()}>${p.currentVersion ? x('saveVersion', { n: p.currentVersion + 1 }) : x('saveFirstVersion')}<//>
          <//>
          <${Text} kind="caption" tone="muted">${p.currentVersion ? x('saveVersionHint') : x('saveFirstVersionHint')}<//>` : null}
        ${msg(ctx.promptMsg)}
        <${Text} kind="caption" tone="muted">${x('hintPrompt')}<//>
      <//>
    <//>`;
}

function versionRow(ctx, v, viewing) {
  const p = ctx.project;
  const shown = viewing ? viewing.version === v.version : v.version === p.currentVersion;
  return html`
    <${ListRow} key=${v.version} density="compact" selected=${shown} number=${`v${v.version}`}
      name=${v.changelog || x('noChangelog')} detail=${`${dateWord(v.createdAt)} ${timeWord(v.createdAt)}`}
      value=${v.version === p.currentVersion ? html`<${Chip} tone="sun">${x('current')}<//>` : undefined}
      actions=${shown ? html`<${Text} kind="caption">${x('shown')}<//>` : html`<${Action} onClick=${() => ctx.viewVersion(v.version)}>${x('show')}<//>`} />`;
}

/* ── 04 ───────────────────────────────────────────────────────────────────────────────────────── */

function secTemplates(ctx) {
  return html`
    <${Section} id="cal-templates" title=${x('secTemplates')} description=${x('templatesIntro')}>
      <${Stack}>
        <div>
          ${TEMPLATES.map((tp, i) => {
            const open = ctx.templatesOpen.has(tp.key);
            const draft = ctx.templateDrafts[tp.key] ?? '';
            const stored = ctx.project[tp.field] || '';
            return html`
              <${Fold} key=${tp.key} id=${'cal-tpl-' + tp.key} number=${String(i + 1).padStart(2, '0')} title=${x('tpl.' + tp.key)} sub=${x('charsN', { n: stored.length })} open=${open} onToggle=${() => ctx.toggleTemplate(tp.key)}>
                <${Text}>${x('tplWhat.' + tp.key)}<//>
                <${Text} kind="caption" tone="muted">${x('tplSlots.' + tp.key)}<//>
                <${Field} type="textarea" rows=${14} value=${draft} ariaLabel=${x('tpl.' + tp.key)} spellCheck=${false} onInput=${(e) => ctx.setTemplateDraft(tp.key, e.target.value)} />
                <${Stack} direction="wrap" align="center">
                  <${Action} disabled=${ctx.busy === 'template' || draft === stored || !draft.trim()} onClick=${() => ctx.saveTemplate(tp.key)}>${x('save')}<//>
                  <${Action} disabled=${ctx.busy === 'template'} onClick=${() => ctx.resetTemplate(tp.key)}>${x('resetTemplate')}<//>
                  <${CopyAction} text=${draft} label=${x('copy')} />
                <//>
              <//>`;
          })}
        </div>
        ${msg(ctx.templateMsg)}
      <//>
    <//>`;
}

/* ── 05 ───────────────────────────────────────────────────────────────────────────────────────── */

function secRoads(ctx) {
  const request = ctx.leadRequest();
  return html`
    <${Section} id="cal-roads" title=${x('secRoads')} description=${x('roadsIntro')}>
      <${Stack}>
        <${Columns} layout="leading" collapse="900" density="roomy">
          <${Surface} kind="box"><${Stack}>
            <${Text} kind="label">${x('roadLead')}<//>
            <${Text}>${x('roadLeadBody', { name: ctx.project.name })}<//>
            <${Surface} kind="code">${request}<//>
            <div><${CopyAction} text=${request} label=${x('copyRequest')} /></div>
          <//><//>
          <${Stack}>
            <${Text} kind="label">${x('roadSteps')}<//>
            <${Text}>${x('roadStepsBody')}<//>
          <//>
        <//>
        <${Text} kind="caption" tone="muted">${x('hintRoads')}<//>
      <//>
    <//>`;
}

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
 *   v1.0.0 — 2026-09-04 — Initial (design canvas "AIMEAT Kalibraattori-sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { CopyButton } from '/components/CopyButton.js';
import { Section, Fold, scrollTo } from '/views/profile/organisms/poster-parts.js';
import { x, dateWord, timeWord, isEmptyRun, runAverage, runsInOrder, judgeOf, candidatesOf, crumb, pageLinks } from './frame.js';
import { ScoreChart } from './chart.js';
import { runRow, emptiesRow } from './run.js';
import { secModels } from './models.js';

const chip = (text, cls = '') => html`<span class=${`og-chip ${cls}`}>${text}</span>`;
const msg = (m) => (m ? html`<small class=${`cal-msg ${m.error ? 'is-err' : ''}`}>${m.text}</small>` : null);
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
  const rail = [
    ['01', 'cal-runs', x('secRuns'), runs.length ? x('railRuns', { n: runs.length }) : '0'],
    ['02', 'cal-prompt', x('secPrompt'), p.currentVersion ? 'v' + p.currentVersion : ''],
    ['03', 'cal-models', x('secModels'), x('railModels', { n: candidatesOf(p).length })],
    ['04', 'cal-templates', x('secTemplates'), '4'],
    ['05', 'cal-roads', x('secRoads'), ''],
  ];
  return html`
    <div class="og og-cal og-page">
      ${crumb(p.name)}
      ${mast(ctx, runs, latest)}
      ${strip(ctx, runs, latest)}
      <div class="og-grid">
        <div class="og-main">
          ${secRuns(ctx, runs, empties)}
          ${secPrompt(ctx)}
          ${secModels(ctx)}
          ${secTemplates(ctx)}
          ${secRoads(ctx)}
        </div>
        <nav class="og-rail" aria-label=${x('railTitle')}>
          <span class="og-rail-label">${x('railTitle')}</span>
          ${rail.map(([n, id, label, count]) => html`<button type="button" class="og-rail-link" key=${id} onClick=${() => scrollTo(id)}><i>${n}</i>${label}<em>${count}</em></button>`)}
          <hr />
          <button type="button" class="og-rail-link" onClick=${() => ctx.back()}><i>←</i>${x('allCalibrations')}</button>
          <span class="og-rail-label">${x('pages')}</span>
          ${pageLinks()}
        </nav>
      </div>
      <${ctx.ConfirmUI} />
    </div>`;
}

function mast(ctx, runs, latest) {
  const p = ctx.project;
  const judge = judgeOf(p, ctx.settings);
  const cands = candidatesOf(p);
  const avg = latest ? runAverage(latest) : null;
  const canRun = !!p.currentVersion && cands.length > 0 && ctx.keyed && !ctx.anyRunning;
  const chips = [
    avg != null ? chip(x('chipLatest', { n: avg }), 'og-chip--sun') : chip(p.currentVersion ? x('chipNoRuns') : x('chipNoPrompt'), 'og-chip--coral'),
    chip(x('chipCandidates', { n: cands.length })),
    judge.modelId ? chip(x('chipJudge', { name: judge.label })) : null,
    chip(x('chipRunsVersions', { runs: (ctx.batches || []).length, done: runs.length, v: p.currentVersion || 0 }), 'og-chip--dim'),
    p.status === 'archived' ? chip(x('archived'), 'og-chip--dim') : null,
  ];
  return html`
    <div class="og-mast og-mast--page">
      <div class="og-mast-words">
        ${ctx.renaming ? html`
          <div class="cal-rename">
            <input class="og-input" type="text" value=${ctx.nameDraft} aria-label=${x('rename')} onInput=${(e) => ctx.setNameDraft(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') ctx.saveName(); if (e.key === 'Escape') ctx.setRenaming(false); }} />
            <button type="button" class="og-door" disabled=${!ctx.nameDraft.trim() || ctx.busy === 'project'} onClick=${() => ctx.saveName()}>${x('save')}</button>
            <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.setRenaming(false)}>${x('cancel')}</button>
          </div>` : html`<h1 class="og-title">${p.name}<small>${x('titleSubProject')}</small></h1>`}
        <div class="og-chips">${chips}</div>
        <p class="og-desc og-desc--page">${x('projectDesc')}${avg != null && runs.length >= 2 ? ' ' + x('projectDescTrend', { from: runAverage(runs[0]) ?? 0, to: avg, n: runs.length }) : ''}</p>
        ${msg(ctx.projectMsg)}
      </div>
      <div class="og-mast-actions">
        <button type="button" class="og-slab" disabled=${!canRun} onClick=${() => ctx.newRun()}>${ctx.anyRunning ? x('running') : x('newRun')}</button>
        ${!canRun && !ctx.anyRunning ? html`<small class="cal-slab-hint">${!ctx.keyed ? x('needKey') : !p.currentVersion ? x('needPrompt') : !cands.length ? x('needCandidate') : ''}</small>` : null}
        <div class="og-doors">
          <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.setRenaming(true)}>${x('rename')}</button>
          <button type="button" class="og-door og-door--quiet" disabled=${ctx.busy === 'project'} onClick=${() => ctx.setArchived(p.status !== 'archived')}>${p.status === 'archived' ? x('unarchive') : x('archive')}</button>
          <button type="button" class="og-door og-door--quiet og-door--danger" disabled=${ctx.busy === 'project'} onClick=${() => ctx.deleteProject()}>${x('deleteCalibration')}</button>
        </div>
      </div>
    </div>`;
}

function strip(ctx, runs, latest) {
  const p = ctx.project;
  const judge = judgeOf(p, ctx.settings);
  const cands = candidatesOf(p);
  const avg = latest ? runAverage(latest) : null;
  const first = runs.length >= 2 ? runAverage(runs[0]) : null;
  const cur = ctx.current;
  return html`
    <div class="og-strip">
      <div>${avg != null ? html`<b>${avg} %</b><span>${x('stripLatest')}</span><small>${x('stripLatestSub', { date: dateWord(latest.createdAt), v: latest.promptVersion, n: (latest.scores || []).length })}</small>` : html`<b class="is-dim">·</b><span>${x('stripLatest')}</span><small>${x('stripNoRuns')}</small>`}</div>
      <div>${first != null && avg != null ? html`<b>${first} % → ${avg} %</b><span>${x('stripTrend', { n: runs.length })}</span><small>${x('stripTrendSub', { from: runs[0].promptVersion, to: latest.promptVersion })}</small>` : html`<b class="is-dim">·</b><span>${x('stripTrend', { n: runs.length })}</span><small>${x('stripTrendNone')}</small>`}</div>
      <div><b>${cands.length}</b><span>${x('stripCandidates')}</span><small>${judge.modelId ? x('stripJudge', { name: judge.label }) : x('stripNoJudge')}</small></div>
      <div>${cur ? html`<b>v${cur.version}</b><span>${x('stripVersion')}</span><small>${dateWord(cur.createdAt)} · ${cur.changelog || ''}</small>` : html`<b class="is-dim">·</b><span>${x('stripVersion')}</span><small>${x('stripNoVersion')}</small>`}</div>
    </div>`;
}

/* ── 01 ───────────────────────────────────────────────────────────────────────────────────────── */

function secRuns(ctx, runs, empties) {
  const newest = runs.slice().reverse();
  return html`
    <${Section} id="cal-runs" num="01" title=${x('secRuns')} count=${runs.length ? x('secRunsSub', { n: runs.length, empty: empties.length }) : null} first=${true}>
      ${!runs.length && !empties.length ? html`<p class="cal-empty"><b>${x('noRunsLead')}</b> ${x('noRunsBody')}</p>` : html`
        <div class="cal-rows">
          <div class="cal-row cal-row--head"><div>${x('colRun')}</div><div>${x('colScores')}</div><div>${x('colWhat')}</div><div></div></div>
          ${newest.map((r) => runRow(ctx, r))}
          ${emptiesRow(ctx, empties)}
        </div>`}
      ${runs.filter((r) => runAverage(r) != null).length ? html`<${ScoreChart} runs=${runs} />` : null}
      <p class="cal-hint">${x('hintRuns')}</p>
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
      ${versions.length ? html`
        <div class="cal-vers">
          ${versions.map((v) => versionRow(ctx, v, viewing))}
        </div>` : html`<p class="cal-empty"><b>${x('noVersionLead')}</b> ${x('noVersionBody')}</p>`}
      ${readOnly ? html`<p class="cal-msg">${x('viewingOld', { n: viewing.version })} <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.backToCurrent()}>${x('backToCurrent')}</button></p>` : null}
      <div class="cal-editors">
        <div class="cal-field">
          <span class="og-label">${x('prompt')}${viewing ? ` · v${viewing.version}` : ''}<small>${x('charsN', { n: (ctx.promptDraft || '').length })}</small></span>
          <textarea class="og-textarea" rows="12" value=${ctx.promptDraft} disabled=${readOnly} placeholder=${x('promptPlaceholder')} aria-label=${x('prompt')} onInput=${(e) => ctx.setPromptDraft(e.target.value)}></textarea>
          <div class="og-doors"><${CopyButton} className="og-door og-door--quiet" text=${ctx.promptDraft} label=${x('copyPrompt')} disabled=${!ctx.promptDraft} /></div>
        </div>
        <div class="cal-field">
          <span class="og-label">${x('target')}<small>${x('charsN', { n: (ctx.targetDraft || '').length })}</small></span>
          <textarea class="og-textarea" rows="12" value=${ctx.targetDraft} disabled=${readOnly} placeholder=${x('targetPlaceholder')} aria-label=${x('target')} onInput=${(e) => ctx.setTargetDraft(e.target.value)}></textarea>
          <div class="og-doors"><${CopyButton} className="og-door og-door--quiet" text=${ctx.targetDraft} label=${x('copyTarget')} disabled=${!ctx.targetDraft} /></div>
        </div>
      </div>
      ${!readOnly ? html`
        <div class="cal-save">
          <input class="og-input" type="text" value=${ctx.changelog} placeholder=${x('changelogPlaceholder')} aria-label=${x('changelog')} onInput=${(e) => ctx.setChangelog(e.target.value)} />
          <button type="button" class="og-slab og-slab--sm" disabled=${ctx.busy === 'version' || !ctx.promptDraft.trim() || !ctx.dirty} onClick=${() => ctx.saveVersion()}>${p.currentVersion ? x('saveVersion', { n: p.currentVersion + 1 }) : x('saveFirstVersion')}</button>
        </div>
        <small class="cal-hint">${p.currentVersion ? x('saveVersionHint') : x('saveFirstVersionHint')}</small>` : null}
      ${msg(ctx.promptMsg)}
      <p class="cal-hint">${x('hintPrompt')}</p>
    <//>`;
}

function versionRow(ctx, v, viewing) {
  const p = ctx.project;
  const shown = viewing ? viewing.version === v.version : v.version === p.currentVersion;
  return html`
    <div class=${`cal-ver ${shown ? 'is-on' : ''}`} key=${v.version}>
      <div class="cal-ver-n">v${v.version}<small>${dateWord(v.createdAt)} ${timeWord(v.createdAt)}</small></div>
      <div class="cal-ver-w">${v.changelog || x('noChangelog')}${v.version === p.currentVersion ? html` <span class="og-chip og-chip--sun og-chip--xs">${x('current')}</span>` : null}</div>
      <div class="cal-ver-go">${shown ? html`<small>${x('shown')}</small>` : html`<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.viewVersion(v.version)}>${x('show')}</button>`}</div>
    </div>`;
}

/* ── 04 ───────────────────────────────────────────────────────────────────────────────────────── */

function secTemplates(ctx) {
  return html`
    <${Section} id="cal-templates" num="04" title=${x('secTemplates')} count=${null}>
      <p class="cal-para">${x('templatesIntro')}</p>
      <div class="og-folds">
        ${TEMPLATES.map((tp, i) => {
          const open = ctx.templatesOpen.has(tp.key);
          const draft = ctx.templateDrafts[tp.key] ?? '';
          const stored = ctx.project[tp.field] || '';
          return html`
            <${Fold} key=${tp.key} id=${'cal-tpl-' + tp.key} num=${String(i + 1).padStart(2, '0')} title=${x('tpl.' + tp.key)} sub=${x('charsN', { n: stored.length })} open=${open} onToggle=${() => ctx.toggleTemplate(tp.key)}>
              <p class="cal-para">${x('tplWhat.' + tp.key)}</p>
              <small class="cal-hint">${x('tplSlots.' + tp.key)}</small>
              <textarea class="og-textarea" rows="14" value=${draft} aria-label=${x('tpl.' + tp.key)} onInput=${(e) => ctx.setTemplateDraft(tp.key, e.target.value)}></textarea>
              <div class="og-doors">
                <button type="button" class="og-door" disabled=${ctx.busy === 'template' || draft === stored || !draft.trim()} onClick=${() => ctx.saveTemplate(tp.key)}>${x('save')}</button>
                <button type="button" class="og-door og-door--quiet" disabled=${ctx.busy === 'template'} onClick=${() => ctx.resetTemplate(tp.key)}>${x('resetTemplate')}</button>
                <${CopyButton} className="og-door og-door--quiet" text=${draft} label=${x('copy')} />
              </div>
            <//>`;
        })}
      </div>
      ${msg(ctx.templateMsg)}
    <//>`;
}

/* ── 05 ───────────────────────────────────────────────────────────────────────────────────────── */

function secRoads(ctx) {
  const request = ctx.leadRequest();
  return html`
    <${Section} id="cal-roads" num="05" title=${x('secRoads')} count=${null}>
      <p class="cal-para">${x('roadsIntro')}</p>
      <div class="cal-roads">
        <div class="cal-road is-lead">
          <span class="og-label">${x('roadLead')}</span>
          <p>${x('roadLeadBody', { name: ctx.project.name })}</p>
          <pre>${request}</pre>
          <div class="og-doors"><${CopyButton} className="og-door" text=${request} label=${x('copyRequest')} /></div>
        </div>
        <div class="cal-road">
          <span class="og-label">${x('roadSteps')}</span>
          <p>${x('roadStepsBody')}</p>
        </div>
      </div>
      <p class="cal-hint">${x('hintRoads')}</p>
    <//>`;
}

/**
 * @file notebook-card.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One inbox note's card + its full "organize" workflow, extracted from notebook-tab.js so
 *   each note manages its own state. Three flows over a single note:
 *     - Suggest (slice B): classify → editable single home → materialize as one document.
 *     - Enrich (Phase 1/2): AI plan → run steps (reason / librarian-assess / delegate to a fleet agent)
 *       → fold results + Sources into the note → file as one or split.
 *     - Distribute (Phase 3): split the (enriched) note into chunks, file each to its own home.
 *   Trust toggles (from the parent's notebook.settings) drive auto-detect-on-capture (the `autoEnrich`
 *   prop), auto-run-plan, and auto-distribute-on-file.
 * @structure NoteCard({ note, showToast, orgNames, settings, autoEnrich, onChanged, onOrgsChanged, onDelete })
 * @usage html`<${NoteCard} note=${note} showToast=${showToast} orgNames=${orgNames} settings=${settings}
 *                autoEnrich=${auto} onChanged=${loadInbox} onOrgsChanged=${loadOrgNames} onDelete=${handleDelete} />`
 * @version-history
 *   v1.1.1 — 2026-06-23 — Fix: Skip on an enrichment step was disabled whenever ANY step was running
 *     (so during an auto-run batch every Skip was dead). Skip is now only disabled for the step actually
 *     running; a live skip-ref lets an in-flight batch honor a mid-run skip.
 *   v1.1.0 — 2026-06-21 — Notes parked from an inbox message (Track a response → "put in notebook for
 *     later") show a banner + "Track a response" action that re-opens the shared modal seeded with the
 *     original message, so the reply still binds back to the sender; the note is removed once tracked.
 *   v1.0.0 — 2026-06-21 — Extracted from notebook-tab.js (suggest + enrich + distribute per note).
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Spinner } from './shared.js';
import { createMemory, deleteMemory } from '/js/services/memory.js';
import { classifyNote, materializeDocument, distributeNote, distributeChunks } from '/js/services/notebook.js';
import { TrackResponseModal } from './track-response-modal.js';
import { generatePlan, runStep, composeEnrichedMarkdown, buildCatalogue } from '/js/services/notebook-plan.js';
import * as offersService from '/js/services/offers.js';
import { Markdown } from '/components/Markdown.js';
import { OpenRouterSettings } from './openrouter-settings.js';
import { NEW, NB_STEPS, relTime, firstLine, noteText } from './notebook-helpers.js';
import { swallowed } from '/js/swallowed.js';

export default function NoteCard({ note, showToast, orgNames, settings, autoEnrich, onChanged, onOrgsChanged, onDelete }) {
  const [view, setView] = useState('peek');               // 'line' | 'peek' | 'full'

  // Suggest (classify → single home).
  const [sorting, setSorting] = useState(false);
  const [sortStep, setSortStep] = useState(0);
  const [sortError, setSortError] = useState(null);       // { message, code }
  const [suggest, setSuggest] = useState(null);           // { result, edit }
  const [materializing, setMaterializing] = useState(false);
  const stepTimer = useRef(null);
  const stopStepTimer = () => { if (stepTimer.current) { clearInterval(stepTimer.current); stepTimer.current = null; } };
  useEffect(() => stopStepTimer, []);

  // Enrich (plan → run steps).
  const [planning, setPlanning] = useState(false);
  const [enrich, setEnrich] = useState(null);             // { plan, enrichments[], runningStepId, doneStepIds[], skippedStepIds[], offersFeed, stepStatus }
  const [enrichError, setEnrichError] = useState(null);   // { message, code }
  const skippedRef = useRef(new Set());                   // live skip set so an auto-run batch honors a mid-run skip

  // Distribute (split → many homes).
  const [distributing, setDistributing] = useState(false);
  const [distrib, setDistrib] = useState(null);           // { chunks[], busy, filedCount }

  const baseText = () => noteText(note.value);

  // A note parked from an inbox message (Track a response → "put in notebook for later") carries its
  // source link + reply intent. Surface a banner + a "Track a response" action that re-opens the same
  // modal seeded with the original message — so the reply still binds back to the sender.
  const trackedIntent = note.value?.trackedResponseIntent;
  const trackSource = note.value?.source;
  const [trackOpen, setTrackOpen] = useState(false);
  const trackMsg = (trackedIntent?.owes && trackSource?.messageId)
    ? { id: trackSource.messageId, body: baseText(), conversationId: trackSource.conversationId }
    : null;
  const trackPeer = (trackSource?.peerGhii || '').split('@')[0].split('#').pop() || (trackSource?.peerGhii || '');

  // Trust mode: auto-detect intent on a just-captured note (parent flags exactly one card).
  const triggeredAuto = useRef(false);
  useEffect(() => {
    if (autoEnrich && !triggeredAuto.current && !enrich && !planning) {
      triggeredAuto.current = true;
      handleEnrich();
    }
    // One-shot auto-enrich when the parent flags this card, guarded by the triggeredAuto ref.
    // handleEnrich is recreated each render and enrich/planning change as the flow progresses;
    // depending on them would re-run this effect on every change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoEnrich]);

  const cycleView = () => setView(v => v === 'line' ? 'peek' : v === 'peek' ? 'full' : 'line');

  // ── Suggest: classify → suggestion → materialize ──

  function initEdit(result) {
    const s = result.suggestion || {};
    const cn = result.createNew || {};
    const organismId = s.organismId || NEW;
    const workspaceId = organismId === NEW ? NEW : (s.workspaceId || NEW);
    return {
      organismId,
      organismName: cn.organismName || '',
      workspaceId,
      workspaceName: cn.workspaceName || '',
      space: workspaceId === NEW ? '' : (s.space || ''),
      title: s.title || '',
      markdown: s.markdown || '',
    };
  }

  async function handleSuggest(overrideText) {
    setSuggest(null);
    setSortError(null);
    setSorting(true);
    setSortStep(0);
    stopStepTimer();
    stepTimer.current = setInterval(() => setSortStep(s => Math.min(s + 1, NB_STEPS.length - 1)), 2500);
    try {
      const fileText = (overrideText && overrideText.trim()) || baseText();
      const result = await classifyNote(fileText);
      if (!result) throw new Error(t('profile.error'));
      const edit = initEdit(result);
      if (overrideText && overrideText.trim()) edit.markdown = overrideText.trim();
      setSuggest({ result, edit });
    } catch (e) {
      setSortError({ message: e.message || t('profile.error'), code: e.code });
    } finally { stopStepTimer(); setSorting(false); }
  }

  const patchEdit = (patch) => setSuggest(s => s ? { ...s, edit: { ...s.edit, ...patch } } : s);

  function onOrganismChange(organismId) {
    if (organismId === NEW) { patchEdit({ organismId: NEW, workspaceId: NEW, space: '' }); return; }
    const org = suggest.result.context.organisms.find(o => o.id === organismId);
    const firstWs = org?.workspaces?.[0];
    patchEdit({ organismId, workspaceId: firstWs ? firstWs.id : NEW, space: firstWs?.documentSpaces?.[0]?.namespace || '' });
  }

  function onWorkspaceChange(workspaceId) {
    if (workspaceId === NEW) { patchEdit({ workspaceId: NEW, space: '' }); return; }
    const org = suggest.result.context.organisms.find(o => o.id === suggest.edit.organismId);
    const ws = org?.workspaces?.find(w => w.id === workspaceId);
    patchEdit({ workspaceId, space: ws?.documentSpaces?.[0]?.namespace || '' });
  }

  function applyAlternative(alt) {
    const org = suggest.result.context.organisms.find(o => o.id === alt.organismId);
    const ws = org?.workspaces?.find(w => w.id === alt.workspaceId);
    patchEdit({
      organismId: alt.organismId || NEW,
      workspaceId: alt.workspaceId || NEW,
      space: alt.space || ws?.documentSpaces?.[0]?.namespace || '',
    });
  }

  async function handleMaterialize() {
    if (!suggest) return;
    const e = suggest.edit;
    if (!e.title.trim()) { showToast(t('profile.notebook.titleRequired'), true); return; }
    if (e.organismId === NEW && !e.organismName.trim()) { showToast(t('profile.notebook.orgNameRequired'), true); return; }
    setMaterializing(true);
    try {
      await materializeDocument({
        organismId: e.organismId === NEW ? null : e.organismId,
        organismName: e.organismName,
        workspaceId: (e.organismId === NEW || e.workspaceId === NEW) ? null : e.workspaceId,
        workspaceName: e.workspaceName,
        space: (e.organismId === NEW || e.workspaceId === NEW || !e.space) ? null : e.space,
        title: e.title.trim(),
        markdown: e.markdown,
        sourceKey: note.key,
      });
      showToast(t('profile.notebook.materialized'));
      setSuggest(null);
      onChanged?.();
      onOrgsChanged?.();
    } catch (err) {
      showToast(err.message || t('profile.error'), true);
    } finally { setMaterializing(false); }
  }

  // ── Enrich: plan → run steps → fold into the note ──

  async function persistNote(value) {
    try { await createMemory(note.key, value, 'private'); } catch (err) { swallowed('notebook-card: persistNote', err); }
  }

  async function handleEnrich() {
    setEnrich(null);
    setEnrichError(null);
    setPlanning(true);
    try {
      let offersFeed = null, catalogue = [];
      try { offersFeed = await offersService.listOffers(); catalogue = buildCatalogue(offersFeed); } catch (err) { swallowed('notebook-card: handleEnrich', err); }
      const data = await generatePlan(baseText(), catalogue);
      const existing = Array.isArray(note.value?.enrichments) ? note.value.enrichments : [];
      const plan = data?.plan || { steps: [], summary: '', confidence: 0 };
      skippedRef.current = new Set();
      setEnrich({ plan, enrichments: existing, runningStepId: null, doneStepIds: existing.map(e => e.stepId), skippedStepIds: [], offersFeed, stepStatus: {} });
      setPlanning(false);
      if (settings?.autoRunPlan && plan.steps.length) {
        const handled = new Set(existing.map(e => e.stepId));
        await runStepsBatch({ priorEnrichments: existing, plan, offersFeed }, plan.steps, handled);
      }
    } catch (e) {
      setEnrichError({ message: e.message || t('profile.error'), code: e.code });
    } finally { setPlanning(false); }
  }

  /** Run one step, persist its result into the note, update enrich state; return the new enrichments. */
  async function executeStep(step, ctx) {
    const { priorEnrichments, plan, offersFeed } = ctx;
    setEnrich(s => s ? { ...s, runningStepId: step.id } : s);
    const onStatus = (id, status) => setEnrich(s => s ? { ...s, stepStatus: { ...(s.stepStatus || {}), [id]: status } } : s);
    const result = await runStep(step, { noteText: baseText(), priorEnrichments, offersFeed, onStatus });
    const enrichments = [...priorEnrichments.filter(e => e.stepId !== step.id), result];
    await persistNote({ ...(note.value || {}), text: baseText(), plan, enrichments });
    setEnrich(s => s ? { ...s, enrichments, runningStepId: null, doneStepIds: [...new Set([...(s.doneStepIds || []), step.id])] } : s);
    onChanged?.();
    return enrichments;
  }

  async function runStepsBatch(ctx, steps, handledIds) {
    let prior = ctx.priorEnrichments;
    for (const step of steps) {
      if (handledIds.has(step.id) || skippedRef.current.has(step.id)) continue;  // honor a mid-batch skip
      try {
        prior = await executeStep(step, { ...ctx, priorEnrichments: prior });
      } catch (e) {
        setEnrich(s => s ? { ...s, runningStepId: null } : s);
        showToast(e.message === 'TIMEOUT' ? t('profile.notebook.delegateTimeout') : (e.message || t('profile.error')), true);
        break;
      }
    }
  }

  async function runOneStep(step) {
    try { await executeStep(step, { priorEnrichments: enrich.enrichments, plan: enrich.plan, offersFeed: enrich.offersFeed }); }
    catch (e) {
      setEnrich(s => s ? { ...s, runningStepId: null } : s);
      showToast(e.message === 'TIMEOUT' ? t('profile.notebook.delegateTimeout') : (e.message || t('profile.error')), true);
    }
  }

  async function handleRunAll() {
    const handled = new Set([...(enrich.doneStepIds || []), ...(enrich.skippedStepIds || [])]);
    await runStepsBatch({ priorEnrichments: enrich.enrichments, plan: enrich.plan, offersFeed: enrich.offersFeed }, enrich.plan.steps, handled);
  }

  const handleSkipStep = (step) => {
    skippedRef.current.add(step.id);  // so an in-flight auto-run batch skips it when it gets there
    setEnrich(s => s ? { ...s, skippedStepIds: [...new Set([...s.skippedStepIds, step.id])] } : s);
  };

  // ── Distribute: split → file each chunk ──

  async function handleDistribute(overrideText) {
    setDistrib(null);
    setDistributing(true);
    try {
      const text = (overrideText && overrideText.trim()) || baseText();
      const data = await distributeNote(text);
      const chunks = (data?.chunks || []).map(c => ({ ...c, include: true }));
      if (!chunks.length) { showToast(t('profile.notebook.distributeNone'), true); return; }
      setEnrich(null);
      setDistrib({ chunks, busy: false, filedCount: 0 });
    } catch (e) {
      showToast(e.message || t('profile.error'), true);
    } finally { setDistributing(false); }
  }

  const toggleChunk = (i) => setDistrib(s => s ? { ...s, chunks: s.chunks.map((c, idx) => idx === i ? { ...c, include: !c.include } : c) } : s);

  async function handleDistributeCommit() {
    if (!distrib) return;
    const selected = distrib.chunks.filter(c => c.include);
    if (!selected.length) { showToast(t('profile.notebook.distributePickOne'), true); return; }
    setDistrib(s => ({ ...s, busy: true, filedCount: 0 }));
    try {
      let filed = 0;
      await distributeChunks(selected, note.key, (_i, status) => {
        if (status === 'done') { filed++; setDistrib(s => s ? { ...s, filedCount: filed } : s); }
      });
      showToast((t('profile.notebook.distributed') || 'Filed {n} documents').replace('{n}', String(selected.length)));
      setDistrib(null);
      onChanged?.();
      onOrgsChanged?.();
    } catch (e) {
      showToast(e.message || t('profile.error'), true);
      setDistrib(s => s ? { ...s, busy: false } : s);
    }
  }

  function handleFileEnriched() {
    const enriched = composeEnrichedMarkdown(baseText(), enrich.enrichments);
    if (settings?.autoDistribute) { handleDistribute(enriched); return; }
    setEnrich(null);
    handleSuggest(enriched);
  }

  const handleSplitEnriched = () => handleDistribute(composeEnrichedMarkdown(baseText(), enrich.enrichments));

  // ── Render helpers ──

  const orgLabelFor = (target) => {
    if (target.organismId) return orgNames[target.organismId] || target.organismName || target.organismId;
    if (target.createNew?.organismName || target.organismName) return `➕ ${target.createNew?.organismName || target.organismName}`;
    return t('profile.notebook.distributeDefaultHome');
  };

  const renderEnrichPanel = () => {
    const { plan, enrichments, runningStepId, doneStepIds, skippedStepIds, stepStatus = {} } = enrich;
    const steps = plan?.steps || [];
    const conf = typeof plan?.confidence === 'number' ? Math.round(plan.confidence * 100) : null;
    const allHandled = steps.every(s => doneStepIds.includes(s.id) || skippedStepIds.includes(s.id));
    const anyDone = enrichments.length > 0;
    const preview = composeEnrichedMarkdown(baseText(), enrichments);
    return html`
      <div class="pf-nb-enrich">
        <div class="text-meta-sm pf-nb-enrich-summary">${plan?.summary || ''}${conf !== null ? ` · ${conf}%` : ''}</div>
        ${steps.length === 0
          ? html`<div class="empty">${t('profile.notebook.planNoSteps')}</div>`
          : html`
            <ol class="pf-nb-plan-steps">
              ${steps.map(step => {
                const done = doneStepIds.includes(step.id);
                const skipped = skippedStepIds.includes(step.id);
                const running = runningStepId === step.id;
                return html`
                  <li key=${step.id} class="pf-nb-plan-step ${done ? 'done' : skipped ? 'skipped' : ''}">
                    <div class="pf-nb-plan-step-head">
                      <span class="badge ${step.kind === 'librarian_assess' ? 'badge-info' : step.kind === 'delegate' ? 'badge-success' : ''}">${t('profile.notebook.kind_' + step.kind)}</span>
                      <span class="pf-nb-plan-step-title">${step.title}</span>
                      ${step.kind === 'delegate' && step.agent && html`<span class="text-meta-sm">→ ${step.agent}</span>`}
                      ${done && html`<span class="pf-nb-plan-tag">✓</span>`}
                      ${skipped && html`<span class="pf-nb-plan-tag">${t('profile.notebook.skipped')}</span>`}
                    </div>
                    ${step.description && html`<div class="text-meta-sm">${step.description}</div>`}
                    ${step.rationale && html`<div class="text-meta-sm pf-nb-plan-why">${step.rationale}</div>`}
                    ${running && step.kind === 'delegate' && html`<div class="text-meta-sm pf-nb-plan-why">${t('profile.notebook.delegateWaiting').replace('{agent}', step.agent || '')}${stepStatus[step.id] ? ` (${escHtml(stepStatus[step.id])})` : ''}</div>`}
                    ${!done && !skipped && html`
                      <div class="pf-nb-plan-step-btns">
                        <button class="btn-primary btn-sm" disabled=${!!runningStepId} onClick=${() => runOneStep(step)}>${running ? '…' : t('profile.notebook.runStep')}</button>
                        <button class="btn-ghost btn-sm" disabled=${runningStepId === step.id} onClick=${() => handleSkipStep(step)}>${t('profile.notebook.skipStep')}</button>
                      </div>`}
                  </li>`;
              })}
            </ol>
            ${!allHandled && html`
              <button class="btn-outline btn-sm" disabled=${!!runningStepId} onClick=${handleRunAll}>
                ${runningStepId ? t('profile.notebook.running') : t('profile.notebook.runAll')}
              </button>`}
          `}
        ${anyDone && html`
          <div class="pf-nb-enrich-preview">
            <div class="pf-nb-suggest-label">${t('profile.notebook.enrichedPreview')}</div>
            <div class="pf-nb-enrich-preview-body"><${Markdown} text=${preview} /></div>
          </div>`}
        <div class="pf-nb-suggest-actions">
          <button class="btn-primary" disabled=${!!runningStepId} onClick=${handleFileEnriched}>${t('profile.notebook.fileEnriched')}</button>
          <button class="btn-outline btn-sm" disabled=${!!runningStepId} onClick=${handleSplitEnriched}>${t('profile.notebook.splitEnriched')}</button>
          <button class="btn-ghost btn-sm" onClick=${() => setEnrich(null)}>${t('profile.notebook.cancelBtn')}</button>
        </div>
      </div>
    `;
  };

  const renderDistributePanel = () => {
    const { chunks, busy, filedCount } = distrib;
    const selectedCount = chunks.filter(c => c.include).length;
    return html`
      <div class="pf-nb-enrich">
        <div class="text-meta-sm pf-nb-enrich-summary">${(t('profile.notebook.distributeIntro') || '{n} pieces').replace('{n}', String(chunks.length))}</div>
        <ol class="pf-nb-plan-steps">
          ${chunks.map((c, i) => html`
            <li key=${i} class="pf-nb-plan-step ${c.include ? '' : 'skipped'}">
              <div class="pf-nb-plan-step-head">
                <label class="pf-nb-chunk-pick">
                  <input type="checkbox" checked=${c.include} disabled=${busy} onChange=${() => toggleChunk(i)} />
                  <span class="pf-nb-plan-step-title">${c.title}</span>
                </label>
                <span class="badge badge-info">${orgLabelFor(c)}${c.workspaceName ? ` ▸ ${c.workspaceName}` : ''}</span>
              </div>
              <div class="pf-nb-enrich-preview-body pf-nb-chunk-body"><${Markdown} text=${c.markdown} /></div>
            </li>`)}
        </ol>
        <div class="pf-nb-suggest-actions">
          <button class="btn-primary" disabled=${busy || selectedCount === 0} onClick=${handleDistributeCommit}>
            ${busy ? `… ${filedCount}/${selectedCount}` : (t('profile.notebook.distributeCommit') || 'Distribute {n}').replace('{n}', String(selectedCount))}
          </button>
          <button class="btn-ghost btn-sm" disabled=${busy} onClick=${() => setDistrib(null)}>${t('profile.notebook.cancelBtn')}</button>
        </div>
      </div>
    `;
  };

  const renderSuggestPanel = () => {
    const { result, edit } = suggest;
    const orgs = result.context?.organisms || [];
    const org = orgs.find(o => o.id === edit.organismId);
    const workspaces = org?.workspaces || [];
    const ws = workspaces.find(w => w.id === edit.workspaceId);
    const docSpaces = ws?.documentSpaces || [];
    const conf = result.suggestion ? Math.round((result.suggestion.confidence || 0) * 100) : null;
    return html`
      <div class="pf-nb-suggest">
        ${result.suggestion?.reason && html`<div class="text-meta-sm pf-nb-suggest-reason">${escHtml(result.suggestion.reason)}${conf !== null ? ` · ${conf}%` : ''}</div>`}
        <label class="pf-nb-suggest-label">${t('profile.notebook.fieldOrganism')}</label>
        <select class="input-field" value=${edit.organismId} onChange=${e => onOrganismChange(e.target.value)}>
          ${orgs.map(o => html`<option key=${o.id} value=${o.id}>${escHtml(o.name)}</option>`)}
          <option value=${NEW}>➕ ${t('profile.notebook.newOrganism')}</option>
        </select>
        ${edit.organismId === NEW && html`
          <input type="text" class="input-field" placeholder=${t('profile.notebook.newOrgNamePlaceholder')}
            value=${edit.organismName} onInput=${e => patchEdit({ organismName: e.target.value })} />`}
        ${edit.organismId !== NEW && html`
          <label class="pf-nb-suggest-label">${t('profile.notebook.fieldWorkspace')}</label>
          <select class="input-field" value=${edit.workspaceId} onChange=${e => onWorkspaceChange(e.target.value)}>
            ${workspaces.map(w => html`<option key=${w.id} value=${w.id}>${escHtml(w.name)}</option>`)}
            <option value=${NEW}>➕ ${t('profile.notebook.newWorkspace')}</option>
          </select>`}
        ${(edit.organismId === NEW || edit.workspaceId === NEW) && html`
          <input type="text" class="input-field" placeholder=${t('profile.notebook.newWsNamePlaceholder')}
            value=${edit.workspaceName} onInput=${e => patchEdit({ workspaceName: e.target.value })} />`}
        ${edit.organismId !== NEW && edit.workspaceId !== NEW && docSpaces.length > 0 && html`
          <label class="pf-nb-suggest-label">${t('profile.notebook.fieldSpace')}</label>
          <select class="input-field" value=${edit.space} onChange=${e => patchEdit({ space: e.target.value })}>
            ${docSpaces.map(s => html`<option key=${s.namespace} value=${s.namespace}>${escHtml(s.name)}</option>`)}
          </select>`}
        ${result.alternatives?.length > 0 && html`
          <div class="pf-nb-suggest-alts">
            <span class="text-meta-sm">${t('profile.notebook.alternatives')}</span>
            ${result.alternatives.map((alt, i) => html`
              <button key=${i} class="btn-ghost btn-sm" onClick=${() => applyAlternative(alt)}>
                ${escHtml(alt.organismName || '?')}${alt.workspaceName ? ` ▸ ${escHtml(alt.workspaceName)}` : ''}
              </button>`)}
          </div>`}
        <label class="pf-nb-suggest-label">${t('profile.notebook.fieldTitle')}</label>
        <input type="text" class="input-field" value=${edit.title} onInput=${e => patchEdit({ title: e.target.value })} />
        <label class="pf-nb-suggest-label">${t('profile.notebook.fieldBody')}</label>
        <textarea class="input-field pf-nb-suggest-body" rows="6" value=${edit.markdown}
          onInput=${e => patchEdit({ markdown: e.target.value })}></textarea>
        <div class="pf-nb-suggest-actions">
          <button class="btn-primary" disabled=${materializing} onClick=${handleMaterialize}>${materializing ? '…' : t('profile.notebook.materializeBtn')}</button>
          <button class="btn-ghost btn-sm" onClick=${() => setSuggest(null)}>${t('profile.notebook.cancelBtn')}</button>
        </div>
      </div>
    `;
  };

  return html`
    <div class="pf-nb-note">
      ${trackMsg && html`
        <div class="inbox-track-banner">
          <span class="inbox-track-banner-ico">🔗</span>
          <span class="inbox-track-banner-txt">${(t('inbox.trackParkedBadge') || 'Owes a reply to {peer}').replace('{peer}', escHtml(trackPeer))}</span>
          <button class="btn-primary btn-sm" onClick=${() => setTrackOpen(true)}>${t('inbox.trackResponse')}</button>
        </div>`}
      <div class="pf-nb-note-text pf-nb-note-text--${view}">
        ${view === 'line'
          ? html`<span class="pf-nb-note-line">${escHtml(firstLine(baseText()))}</span>`
          : html`<${Markdown} text=${baseText()} />`}
      </div>
      <div class="pf-nb-note-foot">
        <div class="pf-nb-note-meta">
          <button class="btn-ghost btn-sm pf-nb-view-btn" title=${t('profile.notebook.toggleView')}
            onClick=${cycleView}>${view === 'full' ? '⌃' : '⌄'}</button>
          <span class="text-meta-sm">${relTime(note.updated_at || note.created_at)}</span>
        </div>
        <div class="pf-nb-note-btns">
          <button class="btn-outline btn-sm" disabled=${planning} onClick=${() => handleEnrich()}>
            ${planning ? t('profile.notebook.planning') : t('profile.notebook.enrichBtn')}
          </button>
          <button class="btn-primary btn-sm" disabled=${sorting} onClick=${() => handleSuggest()}>
            ${sorting ? t('profile.notebook.sorting') : t('profile.notebook.suggestBtn')}
          </button>
          <button class="btn-outline btn-sm" disabled=${distributing} onClick=${() => handleDistribute()}>
            ${distributing ? t('profile.notebook.splitting') : t('profile.notebook.splitBtn')}
          </button>
          <button class="btn-danger btn-sm" onClick=${() => onDelete(note.key)}>${t('profile.notebook.deleteBtn')}</button>
        </div>
      </div>

      ${sorting && html`
        <div class="pf-nb-suggest pf-nb-progress">
          <${Spinner} text=${t(NB_STEPS[sortStep])} />
          <ol class="pf-nb-steps">
            ${NB_STEPS.map((s, i) => html`
              <li key=${i} class="pf-nb-step ${i < sortStep ? 'done' : i === sortStep ? 'active' : ''}">
                ${i < sortStep ? '✓' : i === sortStep ? '→' : '·'} ${t(s)}
              </li>`)}
          </ol>
        </div>`}
      ${sortError && html`
        <div class="pf-nb-suggest pf-nb-progress">
          <div class="alert alert-warning"><span class="alert-msg">${t('profile.notebook.sortErrorTitle')}: ${escHtml(sortError.message)}</span></div>
          ${sortError.code === 'NO_OPENROUTER_KEY' && html`
            <div class="text-meta-sm">${t('profile.notebook.needKey')}</div>
            <${OpenRouterSettings} onSettingsChange=${() => {}} />`}
          <div class="pf-nb-suggest-actions">
            <button class="btn-primary btn-sm" onClick=${() => handleSuggest()}>${t('profile.notebook.tryAgain')}</button>
            <button class="btn-ghost btn-sm" onClick=${() => setSortError(null)}>${t('profile.notebook.dismiss')}</button>
          </div>
        </div>`}
      ${suggest && renderSuggestPanel()}

      ${planning && html`<div class="pf-nb-suggest pf-nb-progress"><${Spinner} text=${t('profile.notebook.planning')} /></div>`}
      ${enrichError && html`
        <div class="pf-nb-suggest pf-nb-progress">
          <div class="alert alert-warning"><span class="alert-msg">${t('profile.notebook.planErrorTitle')}: ${escHtml(enrichError.message)}</span></div>
          ${enrichError.code === 'NO_OPENROUTER_KEY' && html`
            <div class="text-meta-sm">${t('profile.notebook.needKey')}</div>
            <${OpenRouterSettings} onSettingsChange=${() => {}} />`}
          <div class="pf-nb-suggest-actions">
            <button class="btn-primary btn-sm" onClick=${() => handleEnrich()}>${t('profile.notebook.tryAgain')}</button>
            <button class="btn-ghost btn-sm" onClick=${() => setEnrichError(null)}>${t('profile.notebook.dismiss')}</button>
          </div>
        </div>`}
      ${enrich && !distrib && renderEnrichPanel()}

      ${distributing && html`<div class="pf-nb-suggest pf-nb-progress"><${Spinner} text=${t('profile.notebook.splitting')} /></div>`}
      ${distrib && renderDistributePanel()}

      ${trackOpen && trackMsg && html`<${TrackResponseModal} open=${true} msg=${trackMsg}
        defaultMode=${trackedIntent?.mode || 'approve'} allowPark=${false}
        onClose=${() => setTrackOpen(false)} showToast=${showToast}
        onDone=${() => { setTrackOpen(false); deleteMemory(note.key).catch(err => { swallowed('notebook-card: renderSuggestPanel', err); }).finally(() => onChanged?.()); }} />`}
    </div>
  `;
}

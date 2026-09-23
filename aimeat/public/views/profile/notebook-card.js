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
 *   2026-09-22 -- The set's newer props: done and skipped plan steps and unticked chunks are muted
 *     rows (a chunk is a row with its tick as the mark), the enriched preview and each chunk's body
 *     scroll inside a capped height, Delete is in the danger tone.
 *   2026-09-22 -- Composed from the shared set so notebook.css could go: a note is a roster row (its
 *     time, its actions, the note and its open flows in the body), the peek view is the shared clipped
 *     preview, each flow is a box of shared fields and actions, plan steps are rows with chips, the
 *     classify progress is timeline markers, an error is danger text. Only each flow's commit is a loud
 *     action. The emoji (link, plus) are gone, ▸ is a slash, and the view switch is an icon chevron;
 *     a chunk whose home the split will create shows its chip on the sun instead of a plus.
 *   2026-09-13 -- V2w: compose remaining profile section top rules from poster.css.
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
import { Stack, Field, ListRow, Chip, Action, Surface, Text } from '/components/poster-parts.js';

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

  // A home that does not exist yet (the split will create it) is the sun chip; an existing one is plain.
  const orgLabelFor = (target) => {
    if (target.organismId) return orgNames[target.organismId] || target.organismName || target.organismId;
    if (target.createNew?.organismName || target.organismName) return target.createNew?.organismName || target.organismName;
    return t('profile.notebook.distributeDefaultHome');
  };
  const orgIsNew = (target) => !target.organismId && !!(target.createNew?.organismName || target.organismName);

  // A step kind as a chip: the librarian plain, a delegation on the sun, reasoning quiet.
  const kindTone = (kind) => kind === 'delegate' ? 'sun' : kind === 'librarian_assess' ? 'plain' : 'muted';

  const renderEnrichPanel = () => {
    const { plan, enrichments, runningStepId, doneStepIds, skippedStepIds, stepStatus = {} } = enrich;
    const steps = plan?.steps || [];
    const conf = typeof plan?.confidence === 'number' ? Math.round(plan.confidence * 100) : null;
    const allHandled = steps.every(s => doneStepIds.includes(s.id) || skippedStepIds.includes(s.id));
    const anyDone = enrichments.length > 0;
    const preview = composeEnrichedMarkdown(baseText(), enrichments);
    return html`
      <${Surface} kind="box"><${Stack}>
        <${Text} tone="muted">${plan?.summary || ''}${conf !== null ? ` · ${conf}%` : ''}<//>
        ${steps.length === 0
          ? html`<${Text} tone="muted">${t('profile.notebook.planNoSteps')}<//>`
          : html`
            <${Stack} density="compact">
              ${steps.map(step => {
                const done = doneStepIds.includes(step.id);
                const skipped = skippedStepIds.includes(step.id);
                const running = runningStepId === step.id;
                return html`
                  <${ListRow} key=${step.id} name=${step.title} detailKind="text" muted=${done || skipped} detail=${step.description}
                    value=${html`<${Stack} direction="wrap" align="end" density="compact">
                      <${Chip} tone=${kindTone(step.kind)}>${t('profile.notebook.kind_' + step.kind)}<//>
                      ${done && html`<${Chip} tone="sun">✓<//>`}
                      ${skipped && html`<${Chip} tone="muted">${t('profile.notebook.skipped')}<//>`}
                    <//>`}
                    actions=${!done && !skipped && html`
                      <${Action} disabled=${!!runningStepId} onClick=${() => runOneStep(step)}>${running ? '…' : t('profile.notebook.runStep')}<//>
                      <${Action} kind="text" disabled=${runningStepId === step.id} onClick=${() => handleSkipStep(step)}>${t('profile.notebook.skipStep')}<//>`}>
                    ${(step.kind === 'delegate' && step.agent || step.rationale || (running && step.kind === 'delegate')) && html`<${Stack} density="compact">
                      ${step.kind === 'delegate' && step.agent && html`<${Text} kind="mono" tone="muted">→ ${step.agent}<//>`}
                      ${step.rationale && html`<${Text} kind="caption" tone="muted">${step.rationale}<//>`}
                      ${running && step.kind === 'delegate' && html`<${Text} kind="caption" tone="coral">${t('profile.notebook.delegateWaiting').replace('{agent}', step.agent || '')}${stepStatus[step.id] ? ` (${escHtml(stepStatus[step.id])})` : ''}<//>`}
                    <//>`}
                  <//>`;
              })}
            <//>
            ${!allHandled && html`<${Stack} direction="horizontal">
              <${Action} disabled=${!!runningStepId} onClick=${handleRunAll}>
                ${runningStepId ? t('profile.notebook.running') : t('profile.notebook.runAll')}
              <//>
            <//>`}
          `}
        ${anyDone && html`
          <${Text} kind="label">${t('profile.notebook.enrichedPreview')}<//>
          <${Surface} kind="plain" height="scroll"><${Markdown} text=${preview} /><//>`}
        <${Stack} direction="wrap" align="center">
          <${Action} kind="primary" disabled=${!!runningStepId} onClick=${handleFileEnriched}>${t('profile.notebook.fileEnriched')}<//>
          <${Action} disabled=${!!runningStepId} onClick=${handleSplitEnriched}>${t('profile.notebook.splitEnriched')}<//>
          <${Action} onClick=${() => setEnrich(null)}>${t('profile.notebook.cancelBtn')}<//>
        <//>
      <//><//>
    `;
  };

  const renderDistributePanel = () => {
    const { chunks, busy, filedCount } = distrib;
    const selectedCount = chunks.filter(c => c.include).length;
    return html`
      <${Surface} kind="box"><${Stack}>
        <${Text} tone="muted">${(t('profile.notebook.distributeIntro') || '{n} pieces').replace('{n}', String(chunks.length))}<//>
        ${chunks.map((c, i) => html`
          <${ListRow} key=${i} name=${c.title} muted=${!c.include}
            mark=${html`<${Field} type="checkbox" ariaLabel=${c.title} value=${c.include} disabled=${busy} onChange=${() => toggleChunk(i)} />`}
            value=${html`<${Chip} tone=${orgIsNew(c) ? 'sun' : 'plain'}>${orgLabelFor(c)}${c.workspaceName ? ` / ${c.workspaceName}` : ''}<//>`}>
            <${Surface} kind="plain" height="scroll"><${Markdown} text=${c.markdown} /><//>
          <//>`)}
        <${Stack} direction="wrap" align="center">
          <${Action} kind="primary" disabled=${busy || selectedCount === 0} onClick=${handleDistributeCommit}>
            ${busy ? `… ${filedCount}/${selectedCount}` : (t('profile.notebook.distributeCommit') || 'Distribute {n}').replace('{n}', String(selectedCount))}
          <//>
          <${Action} disabled=${busy} onClick=${() => setDistrib(null)}>${t('profile.notebook.cancelBtn')}<//>
        <//>
      <//><//>
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
      <${Surface} kind="box"><${Stack}>
        ${result.suggestion?.reason && html`<${Text} tone="muted">${escHtml(result.suggestion.reason)}${conf !== null ? ` · ${conf}%` : ''}<//>`}
        <${Field} type="select" label=${t('profile.notebook.fieldOrganism')} value=${edit.organismId} onChange=${e => onOrganismChange(e.target.value)}
          options=${[...orgs.map(o => ({ value: o.id, label: escHtml(o.name) })), { value: NEW, label: t('profile.notebook.newOrganism') }]} />
        ${edit.organismId === NEW && html`
          <${Field} placeholder=${t('profile.notebook.newOrgNamePlaceholder')}
            value=${edit.organismName} onInput=${e => patchEdit({ organismName: e.target.value })} />`}
        ${edit.organismId !== NEW && html`
          <${Field} type="select" label=${t('profile.notebook.fieldWorkspace')} value=${edit.workspaceId} onChange=${e => onWorkspaceChange(e.target.value)}
            options=${[...workspaces.map(w => ({ value: w.id, label: escHtml(w.name) })), { value: NEW, label: t('profile.notebook.newWorkspace') }]} />`}
        ${(edit.organismId === NEW || edit.workspaceId === NEW) && html`
          <${Field} placeholder=${t('profile.notebook.newWsNamePlaceholder')}
            value=${edit.workspaceName} onInput=${e => patchEdit({ workspaceName: e.target.value })} />`}
        ${edit.organismId !== NEW && edit.workspaceId !== NEW && docSpaces.length > 0 && html`
          <${Field} type="select" label=${t('profile.notebook.fieldSpace')} value=${edit.space} onChange=${e => patchEdit({ space: e.target.value })}
            options=${docSpaces.map(s => ({ value: s.namespace, label: escHtml(s.name) }))} />`}
        ${result.alternatives?.length > 0 && html`
          <${Stack} direction="wrap" align="center">
            <${Text} kind="label">${t('profile.notebook.alternatives')}<//>
            ${result.alternatives.map((alt, i) => html`
              <${Action} key=${i} kind="text" onClick=${() => applyAlternative(alt)}>
                ${escHtml(alt.organismName || '?')}${alt.workspaceName ? ` / ${escHtml(alt.workspaceName)}` : ''}
              <//>`)}
          <//>`}
        <${Field} label=${t('profile.notebook.fieldTitle')} value=${edit.title} onInput=${e => patchEdit({ title: e.target.value })} />
        <${Field} type="textarea" rows=${6} label=${t('profile.notebook.fieldBody')} value=${edit.markdown}
          onInput=${e => patchEdit({ markdown: e.target.value })} />
        <${Stack} direction="wrap" align="center">
          <${Action} kind="primary" disabled=${materializing} onClick=${handleMaterialize}>${materializing ? '…' : t('profile.notebook.materializeBtn')}<//>
          <${Action} onClick=${() => setSuggest(null)}>${t('profile.notebook.cancelBtn')}<//>
        <//>
      <//><//>
    `;
  };

  /** A failed classify or plan: the reason in the danger tone, the key setup when that is the cause, retry. */
  const renderError = (err, titleKey, retry, dismiss) => html`
    <${Surface} kind="box"><${Stack}>
      <${Text} tone="danger">${t(titleKey)}: ${escHtml(err.message)}<//>
      ${err.code === 'NO_OPENROUTER_KEY' && html`
        <${Text} kind="caption" tone="muted">${t('profile.notebook.needKey')}<//>
        <${OpenRouterSettings} onSettingsChange=${() => {}} />`}
      <${Stack} direction="wrap" align="center">
        <${Action} onClick=${retry}>${t('profile.notebook.tryAgain')}<//>
        <${Action} onClick=${dismiss}>${t('profile.notebook.dismiss')}<//>
      <//>
    <//><//>`;

  // The view switch is an icon: a chevron down opens the note further, up folds it back to one line.
  const chevron = html`<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
    <path d=${view === 'full' ? 'M5 12l5-5 5 5' : 'M5 8l5 5 5-5'} /></svg>`;

  // A note is a roster row: its time, its actions, and the note itself with its open flows in the body.
  // The peek view is the shared clipped preview; the full view is the whole Markdown.
  return html`
    <${ListRow} detail=${relTime(note.updated_at || note.created_at)}
      actions=${html`
        <${Action} kind="icon" label=${t('profile.notebook.toggleView')} title=${t('profile.notebook.toggleView')} onClick=${cycleView}>${chevron}<//>
        <${Action} disabled=${planning} onClick=${() => handleEnrich()}>
          ${planning ? t('profile.notebook.planning') : t('profile.notebook.enrichBtn')}
        <//>
        <${Action} disabled=${sorting} onClick=${() => handleSuggest()}>
          ${sorting ? t('profile.notebook.sorting') : t('profile.notebook.suggestBtn')}
        <//>
        <${Action} disabled=${distributing} onClick=${() => handleDistribute()}>
          ${distributing ? t('profile.notebook.splitting') : t('profile.notebook.splitBtn')}
        <//>
        <${Action} tone="danger" onClick=${() => onDelete(note.key)}>${t('profile.notebook.deleteBtn')}<//>`}>
      <${Stack}>
        ${trackMsg && html`
          <${Surface} kind="aside"><${Stack} direction="wrap" align="between">
            <${Text}>${(t('inbox.trackParkedBadge') || 'Owes a reply to {peer}').replace('{peer}', escHtml(trackPeer))}<//>
            <${Action} onClick=${() => setTrackOpen(true)}>${t('inbox.trackResponse')}<//>
          <//><//>`}
        ${view === 'line'
          ? html`<${Text}>${escHtml(firstLine(baseText()))}<//>`
          : view === 'peek'
            ? html`<${Surface} kind="preview" density="compact"><${Markdown} text=${baseText()} /><//>`
            : html`<${Markdown} text=${baseText()} />`}

        ${sorting && html`
          <${Surface} kind="box"><${Stack}>
            <${Spinner} text=${t(NB_STEPS[sortStep])} />
            <${Stack} density="compact">${NB_STEPS.map((s, i) => html`<${ListRow} key=${i} density="compact" name=${t(s)}
              marker=${i < sortStep ? 'success' : i === sortStep ? 'sun' : 'muted'} live=${i === sortStep} />`)}<//>
          <//><//>`}
        ${sortError && renderError(sortError, 'profile.notebook.sortErrorTitle', () => handleSuggest(), () => setSortError(null))}
        ${suggest && renderSuggestPanel()}

        ${planning && html`<${Surface} kind="box"><${Spinner} text=${t('profile.notebook.planning')} /><//>`}
        ${enrichError && renderError(enrichError, 'profile.notebook.planErrorTitle', () => handleEnrich(), () => setEnrichError(null))}
        ${enrich && !distrib && renderEnrichPanel()}

        ${distributing && html`<${Surface} kind="box"><${Spinner} text=${t('profile.notebook.splitting')} /><//>`}
        ${distrib && renderDistributePanel()}
      <//>

      ${trackOpen && trackMsg && html`<${TrackResponseModal} open=${true} msg=${trackMsg}
        defaultMode=${trackedIntent?.mode || 'approve'} allowPark=${false}
        onClose=${() => setTrackOpen(false)} showToast=${showToast}
        onDone=${() => { setTrackOpen(false); deleteMemory(note.key).catch(err => { swallowed('notebook-card: renderSuggestPanel', err); }).finally(() => onChanged?.()); }} />`}
    <//>
  `;
}

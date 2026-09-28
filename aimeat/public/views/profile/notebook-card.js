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
 *   2026-09-28 -- The action row wraps: at 390 px Delete ran 5 px past the page and was cut off.
 *   v1.17.1 -- 2026-09-28 -- No escHtml() on text preact renders: preact escapes text and attributes
 *     itself, so a note's first line, an organism or workspace name, the AI's reason or an error
 *     with a quote or an ampersand showed as &quot; / &amp;.
 *   v1.17.0 -- 2026-09-26 -- Every part is a component that takes data: the note is a List row, its
 *     text the Peek (line, peek under a fade, all; PeekToggle cycles them), its foot a Layout row of
 *     Action and Loud, each panel a section Card, the plan and the split pieces PlanSteps (PlanNote
 *     for the lines in italics), the sorting steps ProgressSteps, the forms Fields, Select,
 *     TextField and TextArea with FormActions, the error line the refusal Note, the parked-reply
 *     banner the small attention Note. The file writes no class. A step's kind tag is green again
 *     for a step that goes to an agent, as main's success badge drew it (Mark tone fine); main's
 *     info badge (a librarian step) drew as the plain tag in Settings and stays so (page group G4).
 *   2026-09-25 -- Filing into a workspace whose new document space waits for an approval says so and
 *     keeps the note (one note, or the chunks of a distributed one); nothing is filed in between.
 *   v1.16.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.15.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.14.0 -- 2026-09-25 -- The labels over a note's fields and over its preview are the row label (.poster-label) (Jouni's decision "Row label", a unification).
 *   v1.13.0 -- 2026-09-25 -- Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.13.0 -- 2026-09-25 -- Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v1.13.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.12.0 -- 2026-09-25 -- Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v1.12.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.11.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.10.0 -- 2026-09-25 -- A note that asks you to look or act is the Attention note (.poster-aside, its small cut; solid for an act that cannot be undone, the waiting tone while an agent onboards) (Jouni's decision "Attention note", a unification).
 *   v1.9.0 -- 2026-09-25 -- A framed box around one thing is the Object box (.poster-box; on a grey ground its copy tone), in the tone its look already was (Jouni's decision "Object box", a unification).
 *   v1.8.0 -- 2026-09-25 -- Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v1.7.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.6.0 -- 2026-09-25 -- Every time a thing happened wears .poster-time (Jouni's decision "Timestamp", a unification).
 *   v1.5.0 — 2026-09-25 — A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v1.4.0 — 2026-09-25 — A button that is a mark, not a word (a delete or close mark, a menu's dots,
 *     an arrow), is the library's small icon button, .poster-icon.poster-icon--small (Jouni's decision
 *     "Icon button").
 *   v1.3.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.2.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
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
import { Row as ListRow, Cell } from '/components/List.js';
import { Row, Stack, Split } from '/components/Layout.js';
import { Action, Loud } from '/components/Action.js';
import { Mark, Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Box } from '/components/Box.js';
import { Card } from '/components/Card.js';
import { Fields, FormActions } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { PlanSteps, PlanStep, PlanNote } from '/components/PlanSteps.js';
import { ProgressSteps } from '/components/ProgressSteps.js';
import { Peek, PeekToggle, nextPeek } from '/components/Peek.js';
import { createMemory, deleteMemory } from '/js/services/memory.js';
import { classifyNote, materializeDocument, distributeNote, distributeChunks } from '/js/services/notebook.js';
import { TrackResponseModal } from './track-response-modal.js';
import { generatePlan, runStep, composeEnrichedMarkdown, buildCatalogue } from '/js/services/notebook-plan.js';
import * as offersService from '/js/services/offers.js';
import { Markdown } from '/components/Markdown.js';
import { OpenRouterSettings } from './openrouter-settings.js';
import { NEW, NB_STEPS, relTime, firstLine, noteText } from './notebook-helpers.js';
import { swallowed } from '/js/swallowed.js';

/**
 * The tone of a plan step's kind tag, as main's badges drew them: a step that goes to an agent in the
 * success colour (badge-success); a librarian step was the info badge, which Settings drew as the
 * plain tag; a reasoning step the plain tag.
 */
const KIND_TONE = { librarian_assess: undefined, delegate: 'fine' };

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

  const cycleView = () => setView(nextPeek);

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
      const res = await materializeDocument({
        organismId: e.organismId === NEW ? null : e.organismId,
        organismName: e.organismName,
        workspaceId: (e.organismId === NEW || e.workspaceId === NEW) ? null : e.workspaceId,
        workspaceName: e.workspaceName,
        space: (e.organismId === NEW || e.workspaceId === NEW || !e.space) ? null : e.space,
        title: e.title.trim(),
        markdown: e.markdown,
        sourceKey: note.key,
      });
      // The workspace first needs a document space, and adding one waits for its creator or an
      // admin: nothing was filed and the note stays, so the suggestion stays open to file again.
      if (res?.pending) { showToast(t('profile.notebook.spacePending') || 'This workspace has no document space yet. Its creator and admins were asked to add one; file the note again once they approve.'); return; }
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
      const results = await distributeChunks(selected, note.key, (_i, status) => {
        if (status === 'done') { filed++; setDistrib(s => s ? { ...s, filedCount: filed } : s); }
      });
      const waiting = (results || []).filter(r => r?.pending).length;
      showToast(waiting
        ? (t('profile.notebook.distributedPending') || 'Filed: {n}. Waiting for an approval: {m}. The note stays.').replace('{n}', String(selected.length - waiting)).replace('{m}', String(waiting))
        : (t('profile.notebook.distributed') || 'Filed {n} documents').replace('{n}', String(selected.length)));
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
      <${Card} tone="section"><${Stack} gap="medium">
        <${PlanNote}>${plan?.summary || ''}${conf !== null ? ` · ${conf}%` : ''}<//>
        ${steps.length === 0
          ? html`<${Note} kind="quiet">${t('profile.notebook.planNoSteps')}<//>`
          : html`
            <${PlanSteps}>
              ${steps.map(step => {
                const done = doneStepIds.includes(step.id);
                const skipped = skippedStepIds.includes(step.id);
                const running = runningStepId === step.id;
                return html`
                  <${PlanStep} key=${step.id} state=${done ? 'done' : skipped ? 'skipped' : undefined}
                    before=${html`<${Mark} tone=${KIND_TONE[step.kind]}>${t('profile.notebook.kind_' + step.kind)}<//>`}
                    title=${step.title}
                    after=${html`
                      ${step.kind === 'delegate' && step.agent && html`<${Note} kind="meta" inline>→ ${step.agent}<//>`}
                      ${done && html`<${Mark} kind="status" tone="fine">✓<//>`}
                      ${skipped && html`<${Mark} kind="status" tone="off">${t('profile.notebook.skipped')}<//>`}`}
                    doors=${!done && !skipped && html`
                      <${Loud} control disabled=${!!runningStepId} onClick=${() => runOneStep(step)}>${running ? '…' : t('profile.notebook.runStep')}<//>
                      <${Action} small disabled=${runningStepId === step.id} onClick=${() => handleSkipStep(step)}>${t('profile.notebook.skipStep')}<//>`}>
                    ${step.description && html`<${Note} kind="meta">${step.description}<//>`}
                    ${step.rationale && html`<${PlanNote}>${step.rationale}<//>`}
                    ${running && step.kind === 'delegate' && html`<${PlanNote}>${t('profile.notebook.delegateWaiting').replace('{agent}', step.agent || '')}${stepStatus[step.id] ? ` (${stepStatus[step.id]})` : ''}<//>`}
                  <//>`;
              })}
            <//>
            ${!allHandled && html`
              <${Action} small disabled=${!!runningStepId} onClick=${handleRunAll}>
                ${runningStepId ? t('profile.notebook.running') : t('profile.notebook.runAll')}
              <//>`}
          `}
        ${anyDone && html`
          <${Split} above="none">
            <${Label} block>${t('profile.notebook.enrichedPreview')}<//>
            <${Box} tone="copy" scroll document><${Markdown} text=${preview} /><//>
          <//>`}
        <${FormActions}>
          <${Loud} control disabled=${!!runningStepId} onClick=${handleFileEnriched}>${t('profile.notebook.fileEnriched')}<//>
          <${Action} small disabled=${!!runningStepId} onClick=${handleSplitEnriched}>${t('profile.notebook.splitEnriched')}<//>
          <${Action} small onClick=${() => setEnrich(null)}>${t('profile.notebook.cancelBtn')}<//>
        <//>
      <//><//>
    `;
  };

  const renderDistributePanel = () => {
    const { chunks, busy, filedCount } = distrib;
    const selectedCount = chunks.filter(c => c.include).length;
    return html`
      <${Card} tone="section"><${Stack} gap="medium">
        <${PlanNote}>${(t('profile.notebook.distributeIntro') || '{n} pieces').replace('{n}', String(chunks.length))}<//>
        <${PlanSteps}>
          ${chunks.map((c, i) => html`
            <${PlanStep} key=${i} state=${c.include ? undefined : 'skipped'}
              pick=${{ checked: c.include, disabled: busy, onChange: () => toggleChunk(i) }}
              title=${c.title}
              after=${html`<${Mark}>${orgLabelFor(c)}${c.workspaceName ? ` ▸ ${c.workspaceName}` : ''}<//>`}>
              <${Box} tone="copy" scroll document><${Markdown} text=${c.markdown} /><//>
            <//>`)}
        <//>
        <${FormActions}>
          <${Loud} control disabled=${busy || selectedCount === 0} onClick=${handleDistributeCommit}>
            ${busy ? `… ${filedCount}/${selectedCount}` : (t('profile.notebook.distributeCommit') || 'Distribute {n}').replace('{n}', String(selectedCount))}
          <//>
          <${Action} small disabled=${busy} onClick=${() => setDistrib(null)}>${t('profile.notebook.cancelBtn')}<//>
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
      <${Card} tone="section"><${Stack} gap="medium">
        ${result.suggestion?.reason && html`<${PlanNote}>${result.suggestion.reason}${conf !== null ? ` · ${conf}%` : ''}<//>`}
        <${Fields}>
          <${Select} label=${t('profile.notebook.fieldOrganism')} value=${edit.organismId} onChange=${v => onOrganismChange(v)}
            options=${[...orgs.map(o => [o.id, o.name]), [NEW, `➕ ${t('profile.notebook.newOrganism')}`]]} />
          ${edit.organismId === NEW && html`
            <${TextField} placeholder=${t('profile.notebook.newOrgNamePlaceholder')}
              value=${edit.organismName} onInput=${v => patchEdit({ organismName: v })} />`}
          ${edit.organismId !== NEW && html`
            <${Select} label=${t('profile.notebook.fieldWorkspace')} value=${edit.workspaceId} onChange=${v => onWorkspaceChange(v)}
              options=${[...workspaces.map(w => [w.id, w.name]), [NEW, `➕ ${t('profile.notebook.newWorkspace')}`]]} />`}
          ${(edit.organismId === NEW || edit.workspaceId === NEW) && html`
            <${TextField} placeholder=${t('profile.notebook.newWsNamePlaceholder')}
              value=${edit.workspaceName} onInput=${v => patchEdit({ workspaceName: v })} />`}
          ${edit.organismId !== NEW && edit.workspaceId !== NEW && docSpaces.length > 0 && html`
            <${Select} label=${t('profile.notebook.fieldSpace')} value=${edit.space} onChange=${v => patchEdit({ space: v })}
              options=${docSpaces.map(s => [s.namespace, s.name])} />`}
          ${result.alternatives?.length > 0 && html`
            <${Row} wrap gap="small">
              <${Note} kind="meta" inline>${t('profile.notebook.alternatives')}<//>
              ${result.alternatives.map((alt, i) => html`
                <${Action} key=${i} small onClick=${() => applyAlternative(alt)}>
                  ${alt.organismName || '?'}${alt.workspaceName ? ` ▸ ${alt.workspaceName}` : ''}
                <//>`)}
            <//>`}
          <${TextField} label=${t('profile.notebook.fieldTitle')} value=${edit.title} onInput=${v => patchEdit({ title: v })} />
          <${TextArea} label=${t('profile.notebook.fieldBody')} rows=${6} value=${edit.markdown}
            onInput=${v => patchEdit({ markdown: v })} />
        <//>
        <${FormActions}>
          <${Loud} control disabled=${materializing} onClick=${handleMaterialize}>${materializing ? '…' : t('profile.notebook.materializeBtn')}<//>
          <${Action} small onClick=${() => setSuggest(null)}>${t('profile.notebook.cancelBtn')}<//>
        <//>
      <//><//>
    `;
  };

  // A panel that says the AI is at work: the loading line, and the steps under it while it sorts.
  const workingPanel = (words, steps) => html`
    <${Card} tone="section"><${Stack} gap="medium">
      <${Note} kind="loading">${words}<//>
      ${steps}
    <//><//>`;

  // A panel that says the AI refused: why, the key settings when the key is missing, try again.
  const errorPanel = (title, err, retry, dismiss) => html`
    <${Card} tone="section"><${Stack} gap="medium">
      <${Note} kind="message" error>${title}: ${err.message}<//>
      ${err.code === 'NO_OPENROUTER_KEY' && html`
        <${Note} kind="meta">${t('profile.notebook.needKey')}<//>
        <${OpenRouterSettings} onSettingsChange=${() => {}} />`}
      <${FormActions}>
        <${Action} small onClick=${retry}>${t('profile.notebook.tryAgain')}<//>
        <${Action} tone="text" onClick=${dismiss}>${t('profile.notebook.dismiss')}<//>
      <//>
    <//><//>`;

  return html`
    <${ListRow}><${Cell}><${Stack} gap="small">
      ${trackMsg && html`
        <${Note} kind="aside" size="small">
          <${Row} gap="medium" justify="between">
            <${Row} gap="medium"><span>🔗</span><span>${(t('inbox.trackParkedBadge') || 'Owes a reply to {peer}').replace('{peer}', trackPeer || '')}</span><//>
            <${Loud} control onClick=${() => setTrackOpen(true)}>${t('inbox.trackResponse')}<//>
          <//>
        <//>`}
      <${Peek} view=${view} line=${firstLine(baseText())}><${Markdown} text=${baseText()} /><//>
      <${Row} wrap gap="medium" justify="between">
        <${Row} gap="small">
          <${PeekToggle} view=${view} label=${t('profile.notebook.toggleView')} onToggle=${cycleView} />
          <${Mark} kind="time">${relTime(note.updated_at || note.created_at)}<//>
        <//>
        <${Row} wrap gap="small">
          <${Action} small disabled=${planning} onClick=${() => handleEnrich()}>
            ${planning ? t('profile.notebook.planning') : t('profile.notebook.enrichBtn')}
          <//>
          <${Loud} control disabled=${sorting} onClick=${() => handleSuggest()}>
            ${sorting ? t('profile.notebook.sorting') : t('profile.notebook.suggestBtn')}
          <//>
          <${Action} small disabled=${distributing} onClick=${() => handleDistribute()}>
            ${distributing ? t('profile.notebook.splitting') : t('profile.notebook.splitBtn')}
          <//>
          <${Action} small tone="danger" onClick=${() => onDelete(note.key)}>${t('profile.notebook.deleteBtn')}<//>
        <//>
      <//>

      ${sorting && workingPanel(t(NB_STEPS[sortStep]), html`<${ProgressSteps} steps=${NB_STEPS.map((s) => t(s))} at=${sortStep} />`)}
      ${sortError && errorPanel(t('profile.notebook.sortErrorTitle'), sortError, () => handleSuggest(), () => setSortError(null))}
      ${suggest && renderSuggestPanel()}

      ${planning && workingPanel(t('profile.notebook.planning'))}
      ${enrichError && errorPanel(t('profile.notebook.planErrorTitle'), enrichError, () => handleEnrich(), () => setEnrichError(null))}
      ${enrich && !distrib && renderEnrichPanel()}

      ${distributing && workingPanel(t('profile.notebook.splitting'))}
      ${distrib && renderDistributePanel()}

      ${trackOpen && trackMsg && html`<${TrackResponseModal} open=${true} msg=${trackMsg}
        defaultMode=${trackedIntent?.mode || 'approve'} allowPark=${false}
        onClose=${() => setTrackOpen(false)} showToast=${showToast}
        onDone=${() => { setTrackOpen(false); deleteMemory(note.key).catch(err => { swallowed('notebook-card: renderSuggestPanel', err); }).finally(() => onChanged?.()); }} />`}
    <//><//><//>
  `;
}

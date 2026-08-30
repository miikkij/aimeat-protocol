/**
 * @file workflows-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile › Workflows: the chains of agent jobs with a check on every step. Loads the
 *   workflows with their health and each one's last run, and the questions waiting for the person;
 *   holds the handlers the cover, a workflow's page, a run's page and the form call (check now,
 *   the confirmation and the run, answer, cancel, save, delete, the prompts, a pasted definition);
 *   renders the poster face (workflows/cover.js).
 * @structure WorkflowsTab (default) — state, loads, handlers, the ctx bag, render
 * @usage Registered in profile.js TABS as { id:'workflows', component: WorkflowsTab }.
 * @version-history
 *   v2.0.0 -- 2026-08-30 -- The poster face (design canvas "AIMEAT Työnkulkujen sivu", direction A).
 *     Check now answers on the page and starts nothing; Run opens a confirmation that says what will
 *     happen, how long, what it spends and where it starts, with a sandbox door; a question a run
 *     puts to the person is answerable on the cover and on the run; every state is a word; the
 *     form speaks; three prompts hand the work to the person's own AI. Every service call is the
 *     same API as before, plus preflight, pending inputs, answer and the prompts.
 *   v1.4.0 -- 2026-07-06 -- statusClass maps the agent-offline step state to a distinct amber badge.
 *   v1.3.0 -- 2026-07-05 -- Run view shows per-step fill progress.
 *   v1.2.0 -- 2026-06-22 -- List uses listWorkflows({include:'health'}).
 *   v1.0.0 -- 2026-06-13 -- Phase 9: list + blueprint + runs + run-now + health.
 */
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { onLiveUpdate } from '/lib/live-updates.js';
import { t } from '/js/i18n.js';
import { copyToClipboard } from '/js/utils.js';
import { useConfirm } from '/components/Modal.js';
import { listAgents } from '/js/services/agents.js';
import * as wf from '/js/services/workflows.js';
import { swallowed } from '/js/swallowed.js';
import { c, loc, observedWords } from './workflows/frame.js';
import { renderWorkflowsView } from './workflows/cover.js';
import { formOf, defOf, blankStep } from './workflows/form.js';

export default function WorkflowsTab({ showToast }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [items, setItems] = useState([]);          // [{ def, health, lastRun, waiting }]
  const [pending, setPending] = useState([]);      // questions waiting for the person
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState({ kind: 'cover' });
  const [detail, setDetail] = useState(null);      // { id, runs, checks, runCount, checkCount, blueprint, blueprintResolved }
  const [detailLoading, setDetailLoading] = useState(false);
  const [run, setRun] = useState(null);
  const [folds, setFolds] = useState({ how: false, settings: false, prompt: false, raw: false, end: false, llm: false });
  const [checks, setChecks] = useState({});        // id → { at, status, steps }
  const [checking, setChecking] = useState(null);
  const [checkNote, setCheckNote] = useState(null);
  const [confirmState, setConfirmState] = useState(null);   // { id, preflight }
  const [running, setRunning] = useState(false);
  const [answers, setAnswers] = useState({});
  const [answering, setAnswering] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [runsTab, setRunsTab] = useState('runs');
  const [showKeys, setShowKeys] = useState(false);
  const [road, setRoad] = useState('mcp');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState('');
  const [form, setForm] = useState(formOf(null));
  const [openStep, setOpenStep] = useState(-1);
  const [agents, setAgents] = useState([]);
  const [offersByAgent, setOffersByAgent] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveErrors, setSaveErrors] = useState([]);

  const itemById = useCallback((id) => items.find(i => i.def.id === id), [items]);
  const fail = (e, fallback) => showToast?.(e?.response?.error?.message || e?.error?.message || e?.message || fallback || t('profile.error'), true);

  const loadAll = useCallback(async ({ showSpinner = true } = {}) => {
    if (showSpinner) setLoading(true);
    try {
      const [res, pend] = await Promise.all([wf.listWorkflows({ include: 'health' }), wf.pendingInputs().catch(err => { swallowed('workflows-tab: pending', err); return null; })]);
      const defs = res?.data?.workflows || [];
      const inputs = pend?.data?.inputs || [];
      setPending(inputs);
      const withLast = await Promise.all(defs.map(async (w) => {
        const { health = null, ...def } = w;
        const last = await wf.listRuns(def.id, { limit: 1 }).catch(err => { swallowed('workflows-tab: last run', err); return null; });
        return { def, health, lastRun: last?.data?.runs?.[0] || null, waiting: inputs.some(p => p.workflowId === def.id) };
      }));
      setItems(withLast);
    } catch (err) { swallowed('workflows-tab', err); }
    finally { setLoading(false); }
  }, []);

  const loadDetail = useCallback(async (id) => {
    setDetailLoading(true);
    try {
      const [runsRes, checksRes, bp] = await Promise.all([
        wf.listRuns(id, { limit: 20 }),
        wf.listRuns(id, { checks: 'only', limit: 20 }).catch(err => { swallowed('workflows-tab: checks', err); return null; }),
        wf.getBlueprint(id).catch(err => { swallowed('workflows-tab: blueprint', err); return null; }),
      ]);
      setDetail({ id, runs: runsRes?.data?.runs || [], runCount: runsRes?.data?.count ?? 0, checks: checksRes?.data?.runs || [], checkCount: checksRes?.data?.count ?? 0, blueprint: bp?.data || null });
    } catch (err) { swallowed('workflows-tab: detail', err); }
    finally { setDetailLoading(false); }
  }, []);

  const loadRun = useCallback(async (id, runId) => {
    try { const r = await wf.getRun(id, runId); setRun(r?.data || null); }
    catch (err) { swallowed('workflows-tab: run', err); fail(err); }
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- fail reads showToast, a stable prop

  useEffect(() => { loadAll(); }, [loadAll]);
  const liveRef = useRef(null);
  liveRef.current = () => {
    loadAll({ showSpinner: false });
    if (view.kind === 'detail') loadDetail(view.id);
    if (view.kind === 'run') loadRun(view.id, view.runId);
  };
  useEffect(() => onLiveUpdate(['workflows'], () => liveRef.current()), []);

  const pickView = useCallback((v) => {
    setView(v);
    setFolds(f => ({ ...f, settings: false, prompt: false, raw: false }));
    setConfirmState(null);
    const box = document.querySelector('.page-content') || document.querySelector('.pf-content');
    if (box) box.scrollTo({ top: 0 });
    if (v.kind === 'detail') { setRunsTab('runs'); loadDetail(v.id); }
    if (v.kind === 'run') { setRun(null); loadRun(v.id, v.runId); }
    if (v.kind === 'edit' || v.kind === 'create') {
      const def = v.kind === 'edit' ? itemById(v.id)?.def : null;
      const f = v.prefill || formOf(def);
      if (v.kind === 'create' && !v.prefill) f.steps = [blankStep()];
      setForm(f); setSaveErrors([]); setOpenStep(f.steps.length === 1 && !f.steps[0].id ? 0 : -1);
      if (!agents.length) listAgents().then(r => setAgents(Array.isArray(r) ? r : (r?.data?.agents ?? r?.data ?? []))).catch(err => swallowed('workflows-tab: agents', err));
      f.steps.forEach(s => s.agent && loadOffers(s.agent));
    }
  }, [itemById, loadDetail, loadRun, agents.length]);   // eslint-disable-line react-hooks/exhaustive-deps -- loadOffers is declared below and stable in effect

  const setFold = (k, open) => setFolds(f => ({ ...f, [k]: open }));

  /* ── check now: reads memory, starts nothing ── */
  async function handleCheck(id) {
    setChecking(id);
    try {
      const r = await wf.runWorkflow(id, 'signals-only');
      if (r.ok === false) throw r;
      const d = r.data || {};
      setChecks(prev => ({ ...prev, [id]: { at: new Date().toISOString(), status: d.status, steps: d.steps || {} } }));
      if (view.kind === 'cover') {
        const def = itemById(id)?.def;
        const words = (def?.steps || []).map(s => `${loc(s.description) || s.id}: ${c((d.steps?.[s.id]?.state === 'green') ? 'step.green' : d.steps?.[s.id]?.state === 'input-red' ? 'step.inputRed' : 'step.outputRed').toLowerCase()}`);
        setCheckNote({ title: c('checkTitleFor', { name: loc(def?.title) || id }), text: words.join(' · ') });
      }
    } catch (e) { fail(e); }
    finally { setChecking(null); }
  }
  const dismissCheck = (id) => setChecks(prev => { const n = { ...prev }; delete n[id]; return n; });

  /* ── run: the confirmation first ── */
  async function openConfirm(id) {
    setConfirmState({ id, preflight: null });
    try {
      const r = await wf.preflight(id);
      if (r.ok === false) throw r;
      setConfirmState(s => (s?.id === id ? { id, preflight: r.data } : s));
    } catch (e) { fail(e); setConfirmState(null); }
  }
  const closeConfirm = () => setConfirmState(null);
  async function handleRun(id, sandbox) {
    setRunning(true);
    try {
      const r = await wf.runWorkflow(id, 'full', undefined, { sandbox });
      if (r.ok === false) throw r;
      showToast?.(t('profile.workflows.runStarted'));
      setConfirmState(null);
      const runId = r.data?.runId;
      if (runId) pickView({ kind: 'run', id, runId }); else loadDetail(id);
    } catch (e) { fail(e); }
    finally { setRunning(false); }
  }

  /* ── a question a run put to the person ── */
  const setAnswer = (key, a) => setAnswers(prev => ({ ...prev, [key]: a }));
  async function handleAnswer(p, a) {
    setAnswering(true);
    try {
      const body = { picks: a.picks, ...(a.other?.trim() ? { other: a.other.trim() } : {}) };
      const r = await wf.answerStep(p.workflowId, p.runId, p.stepId, body);
      if (r.ok === false) throw r;
      showToast?.(c('answered0'));
      setAnswers(prev => { const n = { ...prev }; delete n[`${p.runId}:${p.stepId}`]; return n; });
      await loadAll({ showSpinner: false });
      if (view.kind === 'run') loadRun(p.workflowId, p.runId);
    } catch (e) { fail(e); }
    finally { setAnswering(false); }
  }
  function handleCancel(id, runId) {
    confirm(c('cancelConfirm'), async () => {
      setCancelling(true);
      try { const r = await wf.cancelRun(id, runId); if (r.ok === false) throw r; showToast?.(t('profile.workflows.cancelled')); await loadAll({ showSpinner: false }); if (view.kind === 'run') loadRun(id, runId); if (view.kind === 'detail') loadDetail(id); }
      catch (e) { fail(e); }
      finally { setCancelling(false); }
    }, { danger: true });
  }

  /* ── the form ── */
  const loadOffers = useCallback((agentName) => {
    if (!agentName) return;
    setOffersByAgent(prev => {
      if (prev[agentName]) return prev;
      wf.getAgentOffers(agentName).then(r => {
        const offers = (r?.data?.offers || []).filter(o => o.success_signal && o.required_to_function && o.deliverable?.location);
        setOffersByAgent(p => ({ ...p, [agentName]: offers }));
      }).catch(err => { swallowed('workflows-tab: offers', err); setOffersByAgent(p => ({ ...p, [agentName]: [] })); });
      return prev;
    });
  }, []);
  const addStep = () => { setForm(f => ({ ...f, steps: [...f.steps, blankStep()] })); setOpenStep(form.steps.length); };
  const removeStep = (i) => { setForm(f => ({ ...f, steps: f.steps.filter((_, j) => j !== i) })); setOpenStep(-1); };
  async function handleSave() {
    setSaving(true); setSaveErrors([]);
    try {
      const id = form.id.trim();
      if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(id)) { setSaveErrors([c('idHint')]); return; }
      const r = await wf.putWorkflow(id, defOf(form));
      if (r.ok === false) throw r;
      showToast?.(t('profile.workflows.form.saved'));
      await loadAll({ showSpinner: false });
      pickView({ kind: 'detail', id });
    } catch (e) {
      const list = e?.response?.error?.details?.errors || e?.error?.details?.errors;
      setSaveErrors(Array.isArray(list) && list.length ? list : [e?.response?.error?.message || e?.error?.message || e?.message || t('profile.error')]);
    } finally { setSaving(false); }
  }
  function handleDelete(id) {
    confirm(c('deleteConfirm'), async () => {
      try { const r = await wf.deleteWorkflow(id); if (r.ok === false) throw r; showToast?.(c('deleted')); setView({ kind: 'cover' }); await loadAll({ showSpinner: false }); }
      catch (e) { fail(e); }
    }, { danger: true });
  }

  /* ── the prompts, and a definition pasted back ── */
  async function copyPrompt(kind, id) {
    try {
      const r = await wf.getPrompt(kind, id);
      if (r.ok === false) throw r;
      await copyToClipboard(r.data.prompt);
      showToast?.(c('promptCopied'));
    } catch (e) { fail(e); }
  }
  function handlePaste() {
    setPasteError('');
    try {
      const m = pasteText.match(/```(?:json)?\s*([\s\S]*?)```/);
      const obj = JSON.parse((m ? m[1] : pasteText).trim());
      const def = obj.definition || obj;
      const id = obj.id || def.id || '';
      if (!Array.isArray(def.steps) || !def.steps.length) throw new Error(c('pasteNoSteps'));
      const f = formOf({ ...def, id });
      setPasteOpen(false); setPasteText('');
      pickView({ kind: 'create', prefill: f });
    } catch (e) { setPasteError(c('pasteError', { why: e.message })); }
  }

  const ctx = {
    items, pending, loading, view, pickView, itemById, detail, detailLoading, run, folds, setFold,
    checks, checking, checkNote, setCheckNote, dismissCheck, handleCheck, confirm: confirmState, openConfirm, closeConfirm, handleRun, running,
    answers, setAnswer, answering, handleAnswer, handleCancel, cancelling, onlyProblems, setOnlyProblems, runsTab, setRunsTab, showKeys, setShowKeys,
    road, setRoad, pasteOpen, setPasteOpen, pasteText, setPasteText, pasteError, handlePaste, copyPrompt,
    form, setForm, openStep, setOpenStep, agents, offersByAgent, loadOffers, addStep, removeStep, handleSave, saving, saveErrors, handleDelete,
    observedWords, ConfirmUI,
  };
  return renderWorkflowsView(ctx);
}

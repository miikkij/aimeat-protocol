/**
 * @file calibrator-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab: the prompt calibrator in the poster face. A calibration takes one
 *   prompt and an example of the answer wanted, runs the prompt on several models, has one model
 *   as the judge compare each answer with the example checkpoint by checkpoint, and writes the
 *   next version of the prompt from the corrections chosen. This file holds the state and the
 *   handlers: the list and the one calibration open (its runs, versions, models and instruction
 *   prompts), a new run that is created and started in one move, the steps run here or brought
 *   back by hand, the next version from an option. The render is calibrator/list.js and
 *   calibrator/page.js; the steps themselves are calibrator/engine.js.
 * @structure CalibratorTab() — state + handlers → renderList(ctx) | renderPage(ctx)
 * @usage registered in profile.js TABS as id 'calibrator'
 * @version-history
 *   v3.0.0 — 2026-09-04 — The poster face (design canvas "AIMEAT Kalibraattori-sivu", direction A):
 *     result first, runs as rows, one run opened in place; the judge defaults to the AI page's
 *     reasoning model and the models are picked from the same catalogue; "New run" creates and
 *     starts; empty runs are one deletable row; every word through the locales.
 *   v2.2.0 — 2026-08-08 — Copy labels from the shared common.copy keys.
 *   v2.1.0 — 2026-07-16 — Detail mount folded into GET /v1/calibrator/:id/detail.
 *   v2.0.0 — 2026-03-29 — V2 redesign: batch-based 4-step flow.
 *   v1.0.0 — 2026-03-29 — Initial implementation.
 */
import { useState, useEffect, useCallback } from 'preact/hooks';
import { t } from '/js/i18n.js';
import { apiGet } from '/js/api.js';
import { useConfirm } from '/components/Modal.js';
import { swallowed } from '/js/swallowed.js';
import {
  listProjects, createProject, getProjectDetail, updateProject, deleteProject as deleteProjectApi,
  getVersion, createVersion, getBatch, createBatch, updateBatch, deleteBatch, getTemplateDefaults,
} from '/js/services/calibrator.js';
import { modelWords } from './ai/frame.js';
import { x, STEPS, isEmptyRun, judgeOf, stepsDone } from './calibrator/frame.js';
import { runAll, runStep1, runStep2, runStep3, runStep4, applyOption as applyOptionApi, composeApply, optionProposals, pasteInto } from './calibrator/engine.js';
import { renderList } from './calibrator/list.js';
import { renderPage, TEMPLATE_FIELDS } from './calibrator/page.js';

const STEP_RUNNERS = { generate: runStep1, analyze: runStep2, reflect: runStep3, synthesize: runStep4 };
const flashFor = (setter) => (text, error = false) => { setter({ text, error }); setTimeout(() => setter(null), 6000); };
const errText = (e, fallback) => e?.error?.message || e?.response?.error?.message || e?.message || (typeof e === 'string' ? e : '') || fallback || t('profile.error');

/** A full run record reduced to the summary shape the list endpoint returns. */
const summarize = (b) => ({
  batchId: b.batchId, createdAt: b.createdAt, promptVersion: b.promptVersion, status: b.status,
  modelCount: (b.models || []).length,
  scores: (b.models || []).map((m) => ({ modelId: m.modelId, modelLabel: m.modelLabel, overallScore: m.step2_analysis?.overallScore ?? null })),
});

export default function CalibratorTab({ showToast }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [settings, setSettings] = useState(null);
  const [models, setModels] = useState([]);
  const [projects, setProjects] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [newName, setNewName] = useState('');
  const [projectId, setProjectId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [details, setDetails] = useState({});
  const [versionRecords, setVersionRecords] = useState({});
  const [viewing, setViewing] = useState(null);
  const [promptDraft, setPromptDraft] = useState('');
  const [targetDraft, setTargetDraft] = useState('');
  const [changelog, setChangelog] = useState('');
  const [openRun, setOpenRun] = useState(null);
  const [openStep, setOpenStep] = useState(null);
  const [option, setOptionState] = useState({});
  const [running, setRunning] = useState({});
  const [progress, setProgress] = useState({});
  const [paste, setPaste] = useState(null);
  const [pasteText, setPasteText] = useState('');
  const [pick, setPickState] = useState(null);
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [templatesOpen, setTemplatesOpen] = useState(new Set());
  const [templateDrafts, setTemplateDrafts] = useState({});
  const [busy, setBusy] = useState(false);
  const [projectMsg, setProjectMsg] = useState(null);
  const [promptMsg, setPromptMsg] = useState(null);
  const [modelsMsg, setModelsMsg] = useState(null);
  const [templateMsg, setTemplateMsg] = useState(null);
  const [runMsg, setRunMsg] = useState(null);

  const toast = (m, isErr) => showToast?.(m, !!isErr);
  const keyed = !!(settings && (settings.hasApiKey || (settings.provider && settings.provider !== 'openrouter')));
  const project = detail?.project || null;
  const current = detail?.currentVersion || null;

  /* ── Reads ─────────────────────────────────────────────────────────────────────────────────── */

  const loadSettings = useCallback(async () => {
    try {
      const r = await apiGet('/v1/openrouter/settings');
      const s = r?.data || {};
      setSettings(s);
      if (s.hasApiKey || (s.provider && s.provider !== 'openrouter')) {
        const m = await apiGet('/v1/openrouter/models').catch((e) => { swallowed('calibrator: models', e); return null; });
        setModels(Array.isArray(m?.data?.models) ? m.data.models : []);
      }
    } catch (e) { swallowed('calibrator: settings', e); setSettings({}); }
  }, []);

  const loadList = useCallback(async () => {
    try { setProjects(await listProjects()); } catch (e) { swallowed('calibrator: list', e); setProjects([]); }
  }, []);

  /** The full record of every run that has started, so the rows can say what did not pass. */
  const loadRunDetails = useCallback(async (id, batches) => {
    const want = (batches || []).filter((b) => !isEmptyRun(b));
    const got = await Promise.all(want.map((b) => getBatch(id, b.batchId).catch((e) => { swallowed('calibrator: run', e); return null; })));
    setDetails((d) => { const next = { ...d }; for (const b of got) if (b) next[b.batchId] = b; return next; });
  }, []);

  const applyDrafts = (d) => {
    const cur = d?.currentVersion;
    setPromptDraft(cur?.prompt || '');
    setTargetDraft(cur?.targetOutput || '');
    setChangelog('');
    setViewing(null);
  };

  const loadProject = useCallback(async (id, { keepDrafts = false } = {}) => {
    const d = await getProjectDetail(id);
    if (!d?.project) { toast(x('notFound'), true); setProjectId(null); return; }
    setDetail(d);
    if (!keepDrafts) applyDrafts(d);
    if (d.currentVersion) setVersionRecords((v) => ({ ...v, [d.currentVersion.version]: d.currentVersion }));
    setTemplateDrafts((td) => { const next = { ...td }; for (const [key, field] of Object.entries(TEMPLATE_FIELDS)) if (next[key] === undefined) next[key] = d.project[field] || ''; return next; });
    loadRunDetails(id, d.batches);
  }, [loadRunDetails]);   // eslint-disable-line react-hooks/exhaustive-deps -- toast is a prop wrapper

  useEffect(() => { loadSettings(); loadList(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- mount-only

  useEffect(() => {
    const handler = () => { if (projectId) loadProject(projectId, { keepDrafts: true }); else loadList(); };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [projectId, loadProject, loadList]);

  /* ── The list ──────────────────────────────────────────────────────────────────────────────── */

  const openProject = async (id) => {
    setProjectId(id); setDetail(null); setDetails({}); setOpenRun(null); setOpenStep(null); setPaste(null); setPickState(null); setRenaming(false);
    setTemplatesOpen(new Set()); setTemplateDrafts({});
    try { await loadProject(id); } catch (e) { toast(errText(e), true); setProjectId(null); }
  };
  const back = () => { setProjectId(null); setDetail(null); loadList(); };
  const createProjectNow = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy('create');
    try { const p = await createProject(name); setNewName(''); await openProject(p.projectId); } catch (e) { toast(errText(e), true); }
    setBusy(false);
  };

  /* ── The calibration itself ────────────────────────────────────────────────────────────────── */

  const patchProject = async (updates, flash) => {
    setBusy('project');
    try {
      const p = await updateProject(projectId, updates);
      setDetail((d) => (d ? { ...d, project: p } : d));
      flash?.();
    } catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  const saveName = async () => { const name = nameDraft.trim(); if (!name) return; await patchProject({ name }, () => setRenaming(false)); };
  const setArchived = (archived) => patchProject({ status: archived ? 'archived' : 'active' }, () => flashFor(setProjectMsg)(archived ? x('archivedMsg') : x('unarchivedMsg')));
  const deleteProject = () => {
    confirm(x('confirmDeleteCalibration', { name: project?.name || '' }), async () => {
      try { await deleteProjectApi(projectId); toast(x('deletedCalibration')); back(); } catch (e) { toast(errText(e), true); }
    }, { danger: true });
  };

  /* ── Versions ──────────────────────────────────────────────────────────────────────────────── */

  const dirty = !current || promptDraft !== (current.prompt || '') || targetDraft !== (current.targetOutput || '');
  const saveVersion = async () => {
    if (!promptDraft.trim()) return;
    setBusy('version');
    const flash = flashFor(setPromptMsg);
    try {
      const v = await createVersion(projectId, { prompt: promptDraft.trim(), targetOutput: targetDraft.trim(), changelog: changelog.trim() || x('changelogUpdated') });
      await loadProject(projectId);
      flash(x('versionSaved', { n: v.version }));
    } catch (e) { flash(errText(e, x('saveFailed')), true); }
    setBusy(false);
  };
  const ensureVersion = async (n) => {
    if (versionRecords[n]) return versionRecords[n];
    const v = await getVersion(projectId, n);
    if (v) setVersionRecords((r) => ({ ...r, [n]: v }));
    return v;
  };
  const viewVersion = async (n) => {
    try {
      const v = await ensureVersion(n);
      if (!v) return;
      setViewing(v); setPromptDraft(v.prompt || ''); setTargetDraft(v.targetOutput || '');
    } catch (e) { toast(errText(e), true); }
  };
  const backToCurrent = () => applyDrafts(detail);

  /* ── Models ────────────────────────────────────────────────────────────────────────────────── */

  const setPick = (v) => { setPickState(v); setQuery(''); setShowAll(false); };
  const setJudge = async (model) => {
    setBusy('models');
    const flash = flashFor(setModelsMsg);
    try {
      const reasoningLlm = model ? { id: 'reasoning', provider: settings?.provider || 'openrouter', baseUrl: settings?.baseUrl || '', apiKeyRef: 'shared', modelId: model.id, label: modelWords(model, model.id) } : null;
      const p = await updateProject(projectId, { reasoningLlm });
      setDetail((d) => (d ? { ...d, project: p } : d));
      setPick(null);
      flash(model ? x('judgeSaved', { name: modelWords(model, model.id) }) : x('judgeCleared'));
    } catch (e) { flash(errText(e, x('saveFailed')), true); }
    setBusy(false);
  };
  const addCandidate = async (model) => {
    setBusy('models');
    const flash = flashFor(setModelsMsg);
    try {
      const row = { id: 'llm-' + Date.now().toString(36), label: modelWords(model, model.id), provider: settings?.provider || 'openrouter', baseUrl: settings?.baseUrl || '', modelId: model.id, apiKeyRef: 'shared' };
      const p = await updateProject(projectId, { candidateModels: [...(project?.candidateModels || []), row] });
      setDetail((d) => (d ? { ...d, project: p } : d));
      setPick(null);
      flash(x('candidateAdded', { name: row.label }));
    } catch (e) { flash(errText(e, x('saveFailed')), true); }
    setBusy(false);
  };
  const removeCandidate = async (id) => {
    setBusy('models');
    try {
      const p = await updateProject(projectId, { candidateModels: (project?.candidateModels || []).filter((m) => m.id !== id) });
      setDetail((d) => (d ? { ...d, project: p } : d));
    } catch (e) { toast(errText(e), true); }
    setBusy(false);
  };

  /* ── Instruction prompts ───────────────────────────────────────────────────────────────────── */

  const toggleTemplate = (key) => setTemplatesOpen((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const setTemplateDraft = (key, v) => setTemplateDrafts((d) => ({ ...d, [key]: v }));
  const saveTemplate = async (key) => {
    setBusy('template');
    const flash = flashFor(setTemplateMsg);
    try {
      const p = await updateProject(projectId, { [TEMPLATE_FIELDS[key]]: templateDrafts[key] });
      setDetail((d) => (d ? { ...d, project: p } : d));
      flash(x('templateSaved', { name: x('tpl.' + key) }));
    } catch (e) { flash(errText(e, x('saveFailed')), true); }
    setBusy(false);
  };
  const resetTemplate = async (key) => {
    try { const defaults = await getTemplateDefaults(); setTemplateDraft(key, defaults[TEMPLATE_FIELDS[key]] || ''); } catch (e) { toast(errText(e), true); }
  };

  /* ── Runs ──────────────────────────────────────────────────────────────────────────────────── */

  const engineFor = (batch) => ({
    projectId, project,
    version: versionRecords[batch?.promptVersion] || current || { prompt: '', targetOutput: '' },
    judge: judgeOf(project, settings),
    onProgress: (text) => setProgress((p) => ({ ...p, [batch.batchId]: text })),
    onBatch: (b) => setDetails((d) => ({ ...d, [b.batchId]: b })),
  });
  const refreshSummaries = async () => { try { await loadProject(projectId, { keepDrafts: true }); } catch (e) { swallowed('calibrator: refresh', e); } };

  const drive = async (batch, work) => {
    const id = batch.batchId;
    setRunning((r) => ({ ...r, [id]: true }));
    setRunMsg(null);
    try {
      await ensureVersion(batch.promptVersion);
      const result = await work(engineFor(batch));
      if (result) setDetails((d) => ({ ...d, [id]: result }));
    } catch (e) { setRunMsg({ id, text: errText(e), error: true }); toast(errText(e), true); }
    setRunning((r) => { const n = { ...r }; delete n[id]; return n; });
    setProgress((p) => { const n = { ...p }; delete n[id]; return n; });
    refreshSummaries();
  };

  const newRun = async () => {
    if (!project?.currentVersion) return;
    setBusy('runs');
    try {
      const batch = await createBatch(projectId, project.currentVersion);
      setDetail((d) => (d ? { ...d, batches: [summarize(batch), ...(d.batches || [])] } : d));
      setDetails((d) => ({ ...d, [batch.batchId]: batch }));
      setOpenRun(batch.batchId); setOpenStep(null);
      setBusy(false);
      await drive(batch, (ctx) => runAll(ctx, batch));
    } catch (e) { toast(errText(e), true); setBusy(false); }
  };
  const runStep = (batchId, step) => { const b = details[batchId]; if (b) drive(b, (ctx) => STEP_RUNNERS[step](ctx, b)); };
  const runRest = (batchId) => {
    const b = details[batchId];
    if (!b) return;
    const done = stepsDone(b);
    const rest = STEPS.slice(STEPS.findIndex((s) => !done[s]));
    drive(b, async (ctx) => { let cur = b; for (const s of rest) cur = await STEP_RUNNERS[s](ctx, cur); return cur; });
  };
  const toggleRun = async (id) => {
    const next = openRun === id ? null : id;
    setOpenRun(next); setOpenStep(null); setPaste(null);
    if (next) {
      const b = details[id] || (detail?.batches || []).find((s) => s.batchId === id);
      if (b) ensureVersion(b.promptVersion).catch((e) => swallowed('calibrator: version', e));
      if (!details[id]) { try { const full = await getBatch(projectId, id); if (full) setDetails((d) => ({ ...d, [id]: full })); } catch (e) { toast(errText(e), true); } }
    }
  };
  const setOption = (batchId, key) => setOptionState((o) => ({ ...o, [batchId]: key }));
  const applyText = (b, key) => composeApply((versionRecords[b.promptVersion] || current || {}).prompt || '', optionProposals(b.step4_synthesis, key));
  const applyOption = async (batchId, key) => {
    const b = details[batchId];
    if (!b) return;
    setBusy('apply:' + batchId);
    try {
      await ensureVersion(b.promptVersion);
      const v = await applyOptionApi(engineFor(b), b, key);
      await loadProject(projectId);
      setRunMsg({ id: batchId, text: x('versionFromOption', { n: v.version, option: key }) });
      toast(x('versionFromOption', { n: v.version, option: key }));
    } catch (e) { setRunMsg({ id: batchId, text: errText(e), error: true }); }
    setBusy(false);
  };
  const openPaste = (spec) => { setPaste(spec); setPasteText(''); };
  const savePaste = async () => {
    const b = paste && details[paste.batchId];
    if (!b || !pasteText.trim()) return;
    setBusy('paste');
    try {
      const patch = pasteInto(paste.step, b, paste.index, pasteText, paste.which);
      const saved = (await updateBatch(projectId, b.batchId, patch)) || { ...b, ...patch };
      setDetails((d) => ({ ...d, [b.batchId]: saved }));
      setPaste(null); setPasteText('');
      refreshSummaries();
    } catch (e) { toast(errText(e), true); }
    setBusy(false);
  };
  const deleteRun = (batchId) => {
    confirm(x('confirmDeleteRun'), async () => {
      setBusy('runs');
      try {
        await deleteBatch(projectId, batchId);
        setDetail((d) => (d ? { ...d, batches: (d.batches || []).filter((s) => s.batchId !== batchId) } : d));
        if (openRun === batchId) setOpenRun(null);
      } catch (e) { toast(errText(e), true); }
      setBusy(false);
    }, { danger: true });
  };
  const deleteEmpties = () => {
    const empties = (detail?.batches || []).filter(isEmptyRun);
    if (!empties.length) return;
    confirm(x('confirmDeleteEmpties', { n: empties.length }), async () => {
      setBusy('runs');
      try { for (const b of empties) await deleteBatch(projectId, b.batchId); await refreshSummaries(); } catch (e) { toast(errText(e), true); }
      setBusy(false);
    }, { danger: true });
  };

  const leadRequest = () => x('leadRequest', { name: project?.name || '', v: (project?.currentVersion || 0) + 1 });

  const ctx = {
    settings, models, keyed, isOpenRouter: (settings?.provider || 'openrouter') === 'openrouter', busy, ConfirmUI,
    projects, showArchived, newName, setShowArchived, setNewName, createProject: createProjectNow, openProject,
    project, dimensions: detail?.dimensions || [], versions: detail?.versions || [], current, batches: detail?.batches || [], details, versionRecords,
    viewing, promptDraft, targetDraft, changelog, dirty, setPromptDraft, setTargetDraft, setChangelog, saveVersion, viewVersion, backToCurrent,
    openRun, openStep, option, running, progress, anyRunning: Object.values(running).some(Boolean), paste, pasteText, runMsg,
    toggleRun, setOpenStep, runStep, runRest, newRun, setOption, applyOption, applyText, openPaste, setPasteText, savePaste, deleteRun, deleteEmpties, engineFor,
    pick, query, showAll, setPick, setQuery, setShowAll, setJudge, addCandidate, removeCandidate, modelsMsg,
    renaming, nameDraft, setRenaming: (v) => { setRenaming(v); if (v) setNameDraft(project?.name || ''); }, setNameDraft, saveName, setArchived, deleteProject, projectMsg,
    templatesOpen, templateDrafts, toggleTemplate, setTemplateDraft, saveTemplate, resetTemplate, templateMsg, promptMsg,
    leadRequest, back,
  };
  if (projectId && project) return renderPage(ctx);
  if (projectId) return renderList({ ...ctx, projects: null });
  return renderList(ctx);
}

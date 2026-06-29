/**
 * @file secretary/use-triggers.js
 * @description Triggers (Slice 3) — proactive follow-ups the Secretary binds to what it tracks. CRUD over
 *   `secretary.trigger.{id}` records (kind: time | recurring | completion | condition). The autonomous
 *   tick is the engine that evaluates + fires them (services/scheduler.ts + the pure helpers in
 *   services/secretary-tick.ts); this hook only manages the records the owner creates/pauses/deletes.
 * @structure useTriggers({ active, showToast }) -> { triggers, armed, form, openForm, createTrigger, togglePause, removeTrigger, ... }
 * @usage const trig = useTriggers({ active, showToast }); triggersCard({ ...trig, goals, routines })
 * @version-history
 *   v0.2.0 — 2026-06-28 — Bound actions: a trigger can BIND a workflow or a specialist to its fire
 *     (action.{kind,workflowId|specialistName,prompt}); loads /v1/workflows + buildAction() composes it.
 *   v0.1.0 — 2026-06-28 — Slice 3: trigger CRUD hook (create all 4 kinds, pause/resume, delete).
 */
import { useState, useEffect, useCallback, useMemo } from 'preact/hooks';
import { api, apiGet, apiPost, apiDelete } from '/js/api.js';
import { t } from '/js/i18n.js';
import { extractJson } from '/js/services/secretary-helpers.js';

const PREFIX = 'secretary.trigger.';
const CADENCE_MS = { daily: 86400000, weekly: 604800000, monthly: 2592000000 };
function genId() { return 'tr-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

/** Cheap gate (Slice 4): only bother the model when text smells recurring or deadline-y (FI + EN). */
const TRIG_HINTS = /(joka\s+(päivä|viikko|kuukausi|aamu|ilta|maanantai|tiistai|keskiviikko|torstai|perjantai)|viikoittain|päivittäin|kuukausittain|säännöllisesti|muistuta|deadline|määräaika|mennessä|ennen\s+\d|weekly|daily|monthly|every\s+(day|week|month|morning|monday|tuesday|wednesday|thursday|friday)|remind|by\s+\w+day|each\s+(day|week|month))/i;

const EMPTY_FORM = { kind: 'recurring', label: '', cadence: 'weekly', when: '', targetId: '', condType: 'memory_count', condPrefix: '', condValue: 5, condDays: 7, actionKind: 'remind', actionWorkflowId: '', actionSpecialistName: '', actionPrompt: '' };

/** Build the trigger's bound `action` from the form. 'remind' (default) → feed + action-item; 'workflow'
 *  → start the chosen workflow; 'specialist' → queue + run a task (the prompt) for the chosen specialist. */
function buildAction(form) {
  const summary = form.label.trim();
  if (form.actionKind === 'workflow' && form.actionWorkflowId) return { kind: 'workflow', summary, workflowId: form.actionWorkflowId };
  if (form.actionKind === 'specialist' && form.actionSpecialistName) return { kind: 'specialist', summary, specialistName: form.actionSpecialistName, prompt: (form.actionPrompt || '').trim() || summary };
  return { kind: 'remind', summary };
}

export function useTriggers({ active, showToast }) {
  const [triggers, setTriggers] = useState([]);
  const [workflows, setWorkflows] = useState([]); // saved workflows a trigger can bind to (run-on-fire)
  const [form, setForm] = useState(null); // null = closed
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    // Cache-bust: the tick fires/settles triggers server-side, so always read fresh.
    const r = await apiGet(`/v1/memory?prefix=${encodeURIComponent(PREFIX)}&_=${Date.now()}`).catch(() => null);
    const items = (r && r.data && r.data.items) || [];
    setTriggers(items.map((it) => it.value).filter((v) => v && v.id).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    apiGet('/v1/workflows').then((r) => setWorkflows((r && r.data && r.data.workflows) || [])).catch(() => {});
  }, []);
  useEffect(() => {
    const h = () => load();
    window.addEventListener('aimeat-live-update', h);
    return () => window.removeEventListener('aimeat-live-update', h);
  }, [load]);

  const writeTrigger = useCallback(async (tr) => {
    await apiPost('/v1/memory', { key: PREFIX + tr.id, value: tr, visibility: 'private', tags: ['secretary', 'trigger', tr.status || ''] });
  }, []);

  const openForm = useCallback(() => setForm({ ...EMPTY_FORM }), []);
  const closeForm = useCallback(() => setForm(null), []);
  const setField = useCallback((k, v) => setForm((f) => (f ? { ...f, [k]: v } : f)), []);

  const createTrigger = useCallback(async () => {
    if (!form || !form.label.trim()) return;
    const now = Date.now();
    const tr = {
      id: genId(), kind: form.kind, label: form.label.trim().slice(0, 200),
      contextId: (active && active.id) || '', status: 'armed', createdBy: 'owner',
      createdAt: new Date().toISOString(), action: buildAction(form),
    };
    if (form.kind === 'time') {
      if (!form.when) { showToast(t('secretary.trig.needWhen'), true); return; }
      tr.when = new Date(form.when).toISOString(); tr.nextFireAt = tr.when;
    } else if (form.kind === 'recurring') {
      tr.cadence = form.cadence; tr.nextFireAt = new Date(now + (CADENCE_MS[form.cadence] || CADENCE_MS.weekly)).toISOString();
    } else if (form.kind === 'completion') {
      if (!form.targetId) { showToast(t('secretary.trig.needTarget'), true); return; }
      tr.target = { type: 'item', id: form.targetId };
    } else if (form.kind === 'condition') {
      if (!form.condPrefix.trim()) { showToast(t('secretary.trig.needPrefix'), true); return; }
      tr.condition = { type: form.condType, prefix: form.condPrefix.trim(), op: '>=', value: Number(form.condValue) || 0, days: Number(form.condDays) || 7 };
    }
    setAdding(true);
    try {
      await writeTrigger(tr);
      showToast(t('secretary.trig.created'));
      setForm(null);
      await load();
    } catch (e) {
      showToast(`${t('secretary.trig.error')}: ${e.message}`, true);
    } finally {
      setAdding(false);
    }
  }, [form, active, writeTrigger, load, showToast]);

  const togglePause = useCallback(async (tr) => {
    await writeTrigger({ ...tr, status: tr.status === 'paused' ? 'armed' : 'paused' }).catch(() => {});
    await load();
  }, [writeTrigger, load]);

  /** Edit a trigger in place (label/cadence) — writes the memory record. Recomputes nextFireAt when a
   *  recurring trigger's cadence changes. Used by the calendar's inline editor + the triggers card. */
  const updateTrigger = useCallback(async (id, patch) => {
    const cur = triggers.find((x) => x.id === id);
    if (!cur) return;
    const next = { ...cur, ...patch };
    if (patch.label) { next.label = String(patch.label).slice(0, 200); next.action = { ...(next.action || {}), summary: next.label }; }
    if (patch.cadence && next.kind === 'recurring' && patch.cadence !== cur.cadence) {
      next.cadence = patch.cadence;
      next.nextFireAt = new Date(Date.now() + (CADENCE_MS[patch.cadence] || CADENCE_MS.weekly)).toISOString();
    }
    await writeTrigger(next).catch(() => {});
    await load();
  }, [triggers, writeTrigger, load]);

  const removeTrigger = useCallback(async (tr) => {
    await apiDelete(`/v1/memory/${encodeURIComponent(PREFIX + tr.id)}`).catch(() => {});
    await load();
  }, [load]);

  /** Arm a proposed trigger (Slice 4): status → armed, computing nextFireAt for recurring if unset. */
  const armTrigger = useCallback(async (tr) => {
    const now = Date.now();
    const armedTr = { ...tr, status: 'armed' };
    if (tr.kind === 'recurring' && !tr.nextFireAt) armedTr.nextFireAt = new Date(now + (CADENCE_MS[tr.cadence] || CADENCE_MS.weekly)).toISOString();
    await writeTrigger(armedTr).catch(() => {});
    await load();
  }, [writeTrigger, load]);

  /** Slice 4 auto-detect: if `text` clearly implies a recurring follow-up or a deadline, create a
   *  PROPOSED trigger the owner can Arm or Dismiss. Cheap keyword gate first, then one AI call. No-op
   *  when nothing clearly recurring/deadline is present, so it never nags. */
  const proposeTriggerFromText = useCallback(async (text) => {
    const s = String(text || '').trim();
    if (!s || !TRIG_HINTS.test(s)) return;
    if (triggers.some((tr) => tr.status === 'proposed' && tr.fromText === s)) return; // no duplicate proposal
    try {
      const sys = `You decide whether a note implies a recurring follow-up or a one-off deadline the Secretary should track. Return ONLY JSON: {"trigger": false} OR {"trigger": true, "kind": "recurring", "label": "short label", "cadence": "daily"|"weekly"|"monthly"} OR {"trigger": true, "kind": "time", "label": "short label", "when": "ISO datetime"}. Say true ONLY if there is a CLEAR recurrence or deadline. Write the label in the user's language.`;
      const r = await api('/v1/ai/complete', { method: 'POST', body: JSON.stringify({ prompt: s, systemPrompt: sys, app_id: 'secretary-trigger-detect' }), timeoutMs: 1_800_000, retries: 0 });
      let j = null;
      try { j = extractJson((r && r.data && r.data.content) || ''); } catch { /* ignore */ }
      if (!j || !j.trigger || !j.label) return;
      const tr = { id: genId(), kind: j.kind === 'time' ? 'time' : 'recurring', label: String(j.label).slice(0, 200), contextId: (active && active.id) || '', status: 'proposed', createdBy: 'secretary', fromText: s, createdAt: new Date().toISOString(), action: { kind: 'remind', summary: String(j.label).slice(0, 200) } };
      if (tr.kind === 'time' && j.when) { tr.when = new Date(j.when).toISOString(); tr.nextFireAt = tr.when; }
      else { tr.cadence = ['daily', 'weekly', 'monthly'].includes(j.cadence) ? j.cadence : 'weekly'; }
      await writeTrigger(tr);
      showToast(t('secretary.trig.proposed'));
      await load();
    } catch { /* best-effort — detection never blocks the user */ }
  }, [triggers, active, writeTrigger, load, showToast]);

  const armed = useMemo(() => triggers.filter((tr) => tr.status === 'armed'), [triggers]);
  const proposed = useMemo(() => triggers.filter((tr) => tr.status === 'proposed'), [triggers]);
  return { triggers, workflows, armed, proposed, form, openForm, closeForm, setField, createTrigger, adding, togglePause, updateTrigger, removeTrigger, armTrigger, proposeTriggerFromText };
}

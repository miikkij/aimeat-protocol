/**
 * @file secretary/use-quick-actions.js
 * @description B3 — dynamic quick actions. Manages a context's `quickActions[]` (stored on
 *   `secretary.config.contexts[i].quickActions[]`): brain-seeded shortcuts (added active at hire) plus
 *   secretary-PROPOSED ones the owner pins. The owner triggers a proposal ("Suggest shortcuts") — the
 *   Secretary suggests 2–3 prompt/compose shortcuts on the owner's key; nothing is pinned without owner
 *   approval (the Ask principle). SECURITY: a proposed action may only be 'prompt' (a canned chat message)
 *   or 'compose' (focus an input) — never a 'run' verb; enforced by sanitizeQuickActions (secretary-helpers),
 *   which mirrors the server helper asserted in e2e-secretary. Redesign: docs/internal/2026-06-25-secretary-view-redesign.md (B3).
 * @structure buildSuggestPrompt · useQuickActions({ active, config, persistConfig, owner, showToast })
 * @usage const qa = useQuickActions({...}); ... quickActionsManager(qa) + map qa.activeActions into the quick row
 * @version-history
 *   v0.1.0 — 2026-06-27 — B3: dynamic quick actions (brain-seeded + secretary-proposed via owner-approved pin).
 */
import { useState, useCallback, useMemo } from 'preact/hooks';
import { api } from '/js/api.js';
import { t } from '/js/i18n.js';
import { extractJson, sanitizeQuickActions } from '/js/services/secretary-helpers.js';

export function buildSuggestPrompt(owner, ctx) {
  const wsNames = (ctx.workspaces || []).map((w) => w.name).join(', ');
  const existing = (ctx.quickActions || []).map((a) => a.label).join(', ');
  return `You are ${owner || 'the user'}'s personal Secretary in the "${ctx.name}" context.
Purpose: ${ctx.brain && ctx.brain.purpose ? ctx.brain.purpose : ctx.name}.
Workspaces: ${wsNames || '(none)'}.

Propose 2–3 NEW one-tap shortcut buttons that would speed up this person's routine in THIS context. Output ONLY a JSON object inside a single code block, EXACTLY this shape:

\`\`\`json
{ "actions": [ { "label": "short button label (<= 4 words)", "kind": "prompt", "prompt": "a canned message to send to the Secretary" } ] }
\`\`\`

Each "kind" MUST be "prompt" (a canned message to send the Secretary) or "compose" (focus an input; "target" is one of "plan"|"find"|"note"). Do NOT propose anything that spends, sends, transacts, or acts on its own.${existing ? ` Avoid duplicating existing shortcuts: ${existing}.` : ''} Output ONLY the JSON object — no commentary.`;
}

export function useQuickActions({ active, config, persistConfig, owner, showToast }) {
  const [managing, setManaging] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editLabel, setEditLabel] = useState('');

  const actions = useMemo(() => (active && Array.isArray(active.quickActions)) ? active.quickActions : [], [active]);
  const activeActions = useMemo(() => actions.filter((a) => a.status === 'active'), [actions]);
  const proposed = useMemo(() => actions.filter((a) => a.status === 'proposed'), [actions]);

  const writeActions = useCallback(async (nextActions) => {
    if (!active) return;
    const next = { ...config, contexts: (config.contexts || []).map((c) => (c.id === active.id ? { ...c, quickActions: nextActions } : c)) };
    await persistConfig(next);
  }, [active, config, persistConfig]);

  const approve = useCallback((a) => writeActions(actions.map((x) => (x.id === a.id ? { ...x, status: 'active' } : x))), [actions, writeActions]);
  const dismiss = useCallback((a) => writeActions(actions.filter((x) => x.id !== a.id)), [actions, writeActions]);

  const startRename = useCallback((a) => { setEditingId(a.id); setEditLabel(a.label); }, []);
  const cancelRename = useCallback(() => { setEditingId(null); setEditLabel(''); }, []);
  const saveRename = useCallback((a) => {
    const label = editLabel.trim().slice(0, 40);
    if (!label) return;
    writeActions(actions.map((x) => (x.id === a.id ? { ...x, label } : x)));
    setEditingId(null); setEditLabel('');
  }, [editLabel, actions, writeActions]);

  /** Reorder one action up/down within the full list (-1 = up, +1 = down). */
  const move = useCallback((a, dir) => {
    const i = actions.findIndex((x) => x.id === a.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= actions.length) return;
    const nextActions = actions.slice();
    [nextActions[i], nextActions[j]] = [nextActions[j], nextActions[i]];
    writeActions(nextActions);
  }, [actions, writeActions]);

  /** Owner-triggered: the Secretary proposes 2–3 prompt/compose shortcuts (stored 'proposed' for the owner to pin). */
  const suggest = useCallback(async () => {
    if (!active || suggesting) return;
    setSuggesting(true);
    try {
      const r = await api('/v1/ai/complete', { method: 'POST', body: JSON.stringify({ prompt: buildSuggestPrompt(owner, active), app_id: 'secretary-quickaction' }), timeoutMs: 1_800_000, retries: 0 });
      const json = extractJson((r && r.data && r.data.content) || '');
      const fresh = sanitizeQuickActions(json && json.actions, 'secretary', 'proposed');
      if (fresh.length === 0) throw new Error(t('secretary.qa.suggestEmpty'));
      await writeActions([...actions, ...fresh]);
      showToast(t('secretary.qa.suggested', { n: fresh.length }));
    } catch (e) {
      showToast(`${t('secretary.qa.error')}: ${e.message}`, true);
    } finally {
      setSuggesting(false);
    }
  }, [active, suggesting, owner, actions, writeActions, showToast]);

  return {
    managing, toggleManage: () => setManaging((v) => !v),
    activeActions, proposed, suggesting, suggest,
    approve, dismiss, move,
    editingId, editLabel, setEditLabel, startRename, cancelRename, saveRename,
  };
}

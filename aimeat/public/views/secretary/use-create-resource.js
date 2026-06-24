/**
 * @file secretary/use-create-resource.js
 * @description P2-A — "create, don't just find". When the resource finder (aimeat_discover) returns ZERO
 *   results for a query, the Secretary offers to CREATE the missing piece instead of leaving the user at
 *   a dead end. This hook drafts a capability from the failed query (deterministic scaffold — no AI/cost),
 *   shows it for review (Draft band), and on the owner's approval creates it via POST /v1/capabilities
 *   (visibility: private). G2: `POST /v1/capabilities` needs `requireRole('owner')` AND passes
 *   `config.capabilityPublishing` — operators bypass the gate, but a normal owner on a node where
 *   publishing is `'disabled'` would be rejected. So the hook computes `canCreate` (operator OR
 *   publishing ≠ 'disabled', read from `GET /v1/capabilities` → `policy.publishing`) and the card
 *   degrades to a clear "disabled on this node" message instead of letting Approve throw. The created
 *   capability is discoverable under scope=own. See docs/plans/2026-06-24-secretary-p2-gap-prompt.md (G2).
 * @structure useCreateResource({ showToast }) -> { canCreate, draft, created, creating, startDraft, setField, approve, reset }
 * @usage const create = useCreateResource({ showToast }); createResourceCard({ ...create, query })
 * @version-history
 *   v0.2.0 — 2026-06-24 — G2: gate the affordance on whether the session can actually create a capability.
 *   v0.1.0 — 2026-06-24 — P2-A: draft → approve → scaffold a capability for an empty find.
 */
import { useState, useCallback, useEffect } from 'preact/hooks';
import { apiGet, apiPost } from '/js/api.js';
import { t } from '/js/i18n.js';

/** Deterministically scaffold a capability draft from a free-text need (no AI). */
function scaffold(query) {
  const name = String(query || '').trim().slice(0, 80) || 'New capability';
  return {
    name,
    summary: `${t('secretary.create.summaryPrefix')} ${name}`.slice(0, 200),
    whenToUse: `${t('secretary.create.whenPrefix')} ${name}`.slice(0, 200),
  };
}

export function useCreateResource({ showToast }) {
  const [draft, setDraft] = useState(null);     // { name, summary, whenToUse } | null
  const [created, setCreated] = useState(null); // the created capability record | null
  const [creating, setCreating] = useState(false);
  const [canCreate, setCanCreate] = useState(null); // null=unknown, true/false once resolved (G2)

  // G2: can this session actually create a (private) capability? Operators always can; otherwise it
  // depends on the node's publishing policy (only 'disabled' blocks private creation for a normal owner).
  useEffect(() => {
    let cancelled = false;
    const session = window.AIMEAT && window.AIMEAT.auth && window.AIMEAT.auth.getSession && window.AIMEAT.auth.getSession();
    if ((session && session.roles || []).includes('operator')) { setCanCreate(true); return; }
    apiGet('/v1/capabilities?per_page=1')
      .then((r) => {
        if (cancelled) return;
        const publishing = r && r.data && r.data.policy && r.data.policy.publishing;
        setCanCreate(!!publishing && publishing !== 'disabled');
      })
      .catch(() => { if (!cancelled) setCanCreate(false); });
    return () => { cancelled = true; };
  }, []);

  const startDraft = useCallback((query) => { setCreated(null); setDraft(scaffold(query)); }, []);
  const setField = useCallback((k, v) => setDraft((d) => (d ? { ...d, [k]: v } : d)), []);
  const reset = useCallback(() => { setDraft(null); setCreated(null); }, []);

  const approve = useCallback(async () => {
    if (!draft || !draft.name.trim()) return;
    setCreating(true);
    try {
      const r = await apiPost('/v1/capabilities', {
        name: draft.name.trim(),
        summary: draft.summary.trim(),
        whenToUse: draft.whenToUse.trim(),
        usage: draft.summary.trim(),
        visibility: 'private',
        callable: false,
        source: { type: 'manual', ref: 'secretary', version: '1.0.0' },
        tags: ['secretary'],
      });
      const cap = (r && r.data) || null;
      if (!cap || !cap.id) throw new Error(t('secretary.create.error'));
      setCreated(cap);
      setDraft(null);
      showToast(t('secretary.create.done'));
    } catch (e) {
      showToast(`${t('secretary.create.error')}: ${e.message}`, true);
    } finally {
      setCreating(false);
    }
  }, [draft, showToast]);

  return { canCreate, draft, created, creating, startDraft, setField, approve, reset };
}

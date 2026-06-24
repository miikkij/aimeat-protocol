/**
 * @file secretary/use-knowledge.js
 * @description P2-B / G3 — knowledge custodian. A Draft-band action for the Secretary to (P2-B) promote a
 *   refined note / decision into the user's shareable knowledge base — imported as a knowledge-package via
 *   POST /v1/knowledge/import (owner-callable); it lands in the graph + is discoverable via aimeat_discover.
 *   G3 adds curating the knowledge GRAPH: a Draft-band action to LINK two of the owner's packages via
 *   POST /v1/knowledge/:id/link (owner-callable — `requireRole('agent')` is satisfied by an owner session's
 *   role bypass, and the manifest is resolved under the owner's identity). Reading is open; both
 *   contributing and linking default to Draft (approve first). See
 *   docs/plans/2026-06-24-secretary-p2-gap-prompt.md (G3) + the P2-B fix prompt + §21.
 * @structure useKnowledge({ showToast }) -> { form, contribute, created, packages, linkForm, createLink, linkResult, reset }
 * @usage const knowledge = useKnowledge({ showToast }); knowledgeCard(knowledge)
 * @version-history
 *   v0.2.0 — 2026-06-24 — G3: knowledge graph curation — Draft-band link between two owned packages.
 *   v0.1.0 — 2026-06-24 — P2-B: draft → approve → import a knowledge package.
 */
import { useState, useEffect, useCallback } from 'preact/hooks';
import { apiGet, apiPost } from '/js/api.js';
import { t } from '/js/i18n.js';

/** Knowledge link relation vocabulary (mirrors src/routes/knowledge.ts validRelations). */
export const LINK_RELATIONS = ['related-to', 'extends', 'derived-from', 'contradicts', 'supersedes', 'references'];

const EMPTY_LINK = { open: false, sourceId: '', targetId: '', relation: 'related-to', description: '', saving: false };

export function useKnowledge({ showToast }) {
  const [form, setForm] = useState({ open: false, title: '', body: '', shareCatalog: false, saving: false });
  const [created, setCreated] = useState(null); // { package_id, name } | null
  const [packages, setPackages] = useState([]); // [{ id, name }] of the owner's knowledge packages
  const [linkForm, setLinkForm] = useState(EMPTY_LINK);
  const [linkResult, setLinkResult] = useState(null); // { sourceName, targetName, relation } | null

  // Load the owner's knowledge packages (manifests) so they can be linked (G3).
  const loadPackages = useCallback(async () => {
    const r = await apiGet(`/v1/memory?prefix=${encodeURIComponent('packages/')}&_=${Date.now()}`).catch(() => null);
    const items = (r && r.data && r.data.items) || [];
    const pkgs = items
      .filter((it) => typeof it.key === 'string' && it.key.endsWith('/manifest'))
      .map((it) => ({ id: it.key.split('/')[1], name: (it.value && it.value.name) || it.key.split('/')[1] }));
    setPackages(pkgs);
  }, []);

  useEffect(() => { loadPackages(); }, [loadPackages]);
  useEffect(() => {
    const handler = (e) => {
      const d = e.detail && e.detail.domains;
      if (!d || d.has('knowledge')) loadPackages();
    };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [loadPackages]);

  const reset = useCallback(() => { setCreated(null); setForm({ open: false, title: '', body: '', shareCatalog: false, saving: false }); }, []);

  const contribute = useCallback(async () => {
    const title = form.title.trim();
    const body = form.body.trim();
    if (!title || !body) return;
    setForm((f) => ({ ...f, saving: true }));
    try {
      const entryKey = 'note-' + Date.now().toString(36);
      const pkg = {
        name: title.slice(0, 200),
        content_type: 'document',
        synthesis: { level: 'assisted', description: t('secretary.knowledge.synthDesc') },
        entries: [{ key: entryKey, title: title.slice(0, 200), visibility: form.shareCatalog ? 'public' : 'owner', value: { title, body, via: 'secretary' } }],
      };
      const r = await apiPost('/v1/knowledge/import', { package: pkg, overrides: { catalog_listed: !!form.shareCatalog } });
      const pid = r && r.data && r.data.package_id;
      if (!pid) throw new Error(t('secretary.knowledge.error'));
      setCreated({ package_id: pid, name: title });
      setForm({ open: false, title: '', body: '', shareCatalog: false, saving: false });
      showToast(t('secretary.knowledge.done'));
      await loadPackages();
    } catch (e) {
      showToast(`${t('secretary.knowledge.error')}: ${e.message}`, true);
      setForm((f) => ({ ...f, saving: false }));
    }
  }, [form, loadPackages, showToast]);

  // G3 — Draft-band: create a link between two of the owner's packages, curating the knowledge graph.
  const createLink = useCallback(async () => {
    const { sourceId, targetId, relation, description } = linkForm;
    if (!sourceId || !targetId || sourceId === targetId || !description.trim()) return;
    setLinkForm((f) => ({ ...f, saving: true }));
    try {
      await apiPost(`/v1/knowledge/${encodeURIComponent(sourceId)}/link`, {
        target: `packages/${targetId}/manifest`,
        relation,
        description: description.trim(),
      });
      const sourceName = (packages.find((p) => p.id === sourceId) || {}).name || sourceId;
      const targetName = (packages.find((p) => p.id === targetId) || {}).name || targetId;
      setLinkResult({ sourceName, targetName, relation });
      setLinkForm(EMPTY_LINK);
      showToast(t('secretary.knowledge.linked'));
    } catch (e) {
      showToast(`${t('secretary.knowledge.linkError')}: ${e.message}`, true);
      setLinkForm((f) => ({ ...f, saving: false }));
    }
  }, [linkForm, packages, showToast]);

  return { form, setForm, created, contribute, reset, packages, linkForm, setLinkForm, createLink, linkResult, LINK_RELATIONS };
}

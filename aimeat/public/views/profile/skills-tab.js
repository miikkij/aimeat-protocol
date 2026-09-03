/**
 * @file skills-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab: the owner's shelf of expertise. Every SKILL.md pack the owner can load
 *   (their own, this server's library, their workspaces') from GET /v1/skills?include=links, each
 *   row saying whom it serves: the app it is bound to, the agents holding its ref, or nobody in
 *   particular. This file is the state and the handlers (open a skill, copy its ref, download the
 *   zip, change visibility in place, attach to or detach from an agent, edit, remove, publish);
 *   the render is skills/page.js and skills/rows.js. splitSkillMd is re-exported for the admin
 *   Skills tab and the workspace skills panel, which import it from here.
 * @structure SkillsTab() — state (library, apps, orgs, details, filters, editor, picker) + handlers → renderPage(ctx)
 * @usage registered in profile.js TABS as id 'skills'
 * @version-history
 *   v2.0.0 — 2026-09-03 — Poster face (design canvas "AIMEAT Taidot-sivu", direction A with the
 *     Kenelle column): three shelves with facets and search instead of three bare lists; the app
 *     and the agents a skill serves on every row; the opened row with the version-locked ref, the
 *     versions kept, visibility changed without a republish, attach to an agent, the SKILL.md
 *     folded; the request to ask your own AI for a skill beside the editor; the agent's rule.
 *   v1.0.0 -- 2026-07-05 -- Initial creation (Skills feature Phase 2b)
 */
import { useState, useEffect, useCallback } from 'preact/hooks';
import { t } from '/js/i18n.js';
import { useConfirm } from '/components/Modal.js';
import { getNodeUrl, getSession } from '/js/services/auth.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { swallowed } from '/js/swallowed.js';
import * as skillsService from '/js/services/skills.js';
import { listApps } from '/js/services/apps.js';
import { listAgents } from '/js/services/agents.js';
import { listOrganisms } from '/js/services/organisms.js';
import { renderPage } from './skills/page.js';
import { x, splitSkillMd, bindingFile } from './skills/frame.js';

export { splitSkillMd };

const SKILL_TEMPLATE = `---
name: my-skill
description: What this skill does and when an agent should use it.
---

# My skill

Write the expertise here. This markdown body is injected into an agent's prompt on activation.
`;

const emptyFilter = () => ({ who: '', vis: '', recent: false, replaced: false, builtin: false });
const emptyEditor = () => ({ open: false, editing: '', md: SKILL_TEMPLATE, visibility: 'owner', publishing: false });

export default function SkillsTab({ session, showToast }) {
  const sess = session || getSession();
  const ownerName = sess?.owner || '';
  const { confirm, ConfirmUI } = useConfirm();
  const [library, setLibrary] = useState(null);
  const [apps, setApps] = useState({});
  const [orgs, setOrgs] = useState({});
  const [agentCount, setAgentCount] = useState(null);
  const [details, setDetails] = useState({});
  const [fullText, setFullText] = useState({});
  const [expanded, setExpanded] = useState(null);
  const [picker, setPicker] = useState(null);
  const [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState({ own: emptyFilter(), node: emptyFilter(), ws: emptyFilter() });
  const [queries, setQueries] = useState({ own: '', node: '', ws: '' });
  const [shown, setShownState] = useState({ own: 20, node: 20, ws: 20 });
  const [editor, setEditorState] = useState(emptyEditor());

  const fail = (e, fallback) => showToast?.(e?.error?.message || e?.response?.error?.message || e?.message || fallback || t('profile.error'), true);

  const load = useCallback(async () => {
    try {
      setLibrary(await skillsService.getLibrary({ links: true }));
    } catch (e) { swallowed('skills: library', e); setLibrary({ node: [], user: [], workspace: [] }); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onLiveUpdate(['skills', 'agents'], load), [load]);

  // The names behind the Kenelle column: an app's title for its file name, an organism's name
  // for its id, and how many agents the owner has. Each is one read, and none blocks the list.
  useEffect(() => {
    listApps().then((list) => {
      const map = {};
      for (const a of list || []) map[a.filename] = a.title || a.manifest?.name || a.filename;
      setApps(map);
    }).catch((e) => swallowed('skills: apps', e));
    listAgents(ownerName).then((list) => setAgentCount((list || []).length)).catch((e) => swallowed('skills: agents', e));
    listOrganisms().then((list) => {
      const map = {};
      for (const o of list || []) map[o.id] = o.name;
      setOrgs(map);
    }).catch((e) => swallowed('skills: organisms', e));
  }, [ownerName]);

  const loadDetail = async (s) => {
    try {
      const d = await skillsService.getSkill(s.name, { scope: s.scope, owner: s.owner ?? undefined, organism: s.org, ws: s.ws });
      if (d) setDetails((m) => ({ ...m, [s.ref]: d }));
      return d;
    } catch (e) { swallowed('skills: detail', e); return null; }
  };
  const toggle = (s) => {
    if (expanded === s.ref) { setExpanded(null); setPicker(null); return; }
    setExpanded(s.ref); setPicker(null);
    if (!details[s.ref]) loadDetail(s);
  };
  const showFull = (s) => setFullText((m) => ({ ...m, [s.ref]: true }));

  /* ── Doors ───────────────────────────────────────────────────────────────────────────────── */
  const download = async (s) => {
    try {
      await skillsService.downloadSkillZip(s.name, { scope: s.scope, owner: s.owner ?? undefined, organism: s.org, ws: s.ws });
      showToast?.(x('zipToast'));
    } catch (e) { fail(e); }
  };
  const setVisibility = async (s, visibility) => {
    setBusy(true);
    try {
      const r = await skillsService.setSkillVisibility(s.name, s.scope, visibility);
      if (r && r.ok === false) { fail(r); return; }
      showToast?.(x('visibilityToast', { name: s.name }));
      load();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const openPicker = async (s) => {
    if (picker && picker.ref === s.ref) { setPicker(null); return; }
    try {
      const agents = (await listAgents(ownerName)) || [];
      const holding = new Set((s.linkedBy || []).map((l) => l.agent));
      setPicker({ ref: s.ref, agents: agents.map((a) => a.name).filter((n) => !holding.has(n)), selected: '', pin: false });
    } catch (e) { fail(e); }
  };
  const pickAgent = (selected) => setPicker((p) => (p ? { ...p, selected } : p));
  const pickPin = (pin) => setPicker((p) => (p ? { ...p, pin } : p));
  const link = async (s) => {
    if (!picker?.selected) return;
    setBusy(true);
    try {
      await skillsService.linkSkill(picker.selected, picker.pin ? `${s.ref}@${s.version}` : s.ref);
      showToast?.(x('attachedToast', { name: s.name, agent: picker.selected }));
      setPicker(null);
      load();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const unlink = async (s, agent, ref) => {
    setBusy(true);
    try {
      await skillsService.unlinkSkill(agent, ref);
      showToast?.(x('detachedToast', { name: s.name, agent }));
      load();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const remove = async (s) => {
    confirm(x('confirmRemove', { name: s.name }), async () => {
      try {
        await skillsService.deleteSkill(s.name, s.scope);
        if (expanded === s.ref) setExpanded(null);
        showToast?.(x('removedToast', { name: s.name }));
        load();
      } catch (e) { fail(e); }
    }, { title: x('remove'), danger: true });
  };

  /* ── The editor: a new skill, or one of the owner's own opened for editing ─────────────── */
  const setEditor = (patch) => setEditorState((e) => ({ ...e, ...patch }));
  const openEditor = () => setEditorState({ ...emptyEditor(), open: true });
  const closeEditor = () => setEditorState(emptyEditor());
  const edit = async (s) => {
    const d = details[s.ref] || await loadDetail(s);
    setEditorState({ open: true, editing: s.name, md: d?.fileContents?.['SKILL.md'] ?? SKILL_TEMPLATE, visibility: s.visibility === 'public' ? 'public' : s.visibility === 'members' ? 'members' : 'owner', publishing: false });
    document.getElementById('sk-new')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const publish = async () => {
    setEditor({ publishing: true });
    try {
      const skill = await skillsService.publishSkill({ skillMd: editor.md, visibility: editor.visibility });
      showToast?.(x('publishedToast', { name: skill?.name ?? '' }));
      setEditorState(emptyEditor());
      setDetails((m) => { const n = { ...m }; if (skill?.ref) delete n[skill.ref]; return n; });
      load();
    } catch (e) { fail(e); setEditor({ publishing: false }); }
  };

  const ctx = {
    nodeUrl: getNodeUrl(), ownerName, showToast, ConfirmUI,
    library, apps, orgs, agentCount, details, fullText, expanded, picker, busy, filters, queries, shown, editor,
    setFilter: (key, patch) => { setFilters((f) => ({ ...f, [key]: { ...f[key], ...patch } })); setShownState((s) => ({ ...s, [key]: 20 })); },
    setQuery: (key, q) => { setQueries((m) => ({ ...m, [key]: q })); setShownState((s) => ({ ...s, [key]: 20 })); },
    setShown: (key, n) => setShownState((s) => ({ ...s, [key]: n })),
    toggle, showFull, download, setVisibility, openPicker, pickAgent, pickPin, link, unlink, remove,
    setEditor, openEditor, closeEditor, edit, publish, bindingFile,
  };
  return renderPage(ctx);
}

/**
 * @file public/views/profile/agents/agent-groups-state.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Agents tab's custom groups as a hook: the owner's group definitions (memory
 *   `agents.groups`, read with getAgentGroupsStrict), the per-browser collapse state, the add, rename,
 *   remove and drag-to-assign edits, and their save. Every edit saves the WHOLE record, so an edit is
 *   refused with a toast while the stored groups have not loaded: built from an empty list it would
 *   erase every group the owner had (docs/pitfalls.md section 84).
 * @structure useAgentGroups({ session, showToast, confirm }) → { agentGroups, collapsedGroups,
 *   editingGroup, setEditingGroup, addGroup, renameGroup, removeGroup, toggleGroupCollapsed, groupDnd }
 * @version-history
 *   v1.0.0 — 2026-10-16 — Extracted from agents-tab.js (max-file-lines); the save is refused until the
 *     stored groups have loaded, and the load uses the strict read (QA audit F6-04).
 */
import { useState, useEffect, useRef } from 'preact/hooks';
import { t } from '/js/i18n.js';
import { getAgentGroupsStrict, saveAgentGroups } from '/js/services/agents.js';
import { swallowed } from '/js/swallowed.js';
import { UNGROUPED_ID, loadCollapsedGroups, saveCollapsedGroups } from './tab-helpers.js';

export function useAgentGroups({ session, showToast, confirm }) {
  // Custom groups: definitions are server-side (AIMEAT memory), the collapse
  // toggle is per-browser. editingGroup holds the id of the group being renamed.
  const [agentGroups, setAgentGroups] = useState([]);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState(() => loadCollapsedGroups(session?.owner));
  const [editingGroup, setEditingGroup] = useState(null);
  const draggedAgent = useRef(null);
  const [draggingAgentName, setDraggingAgentName] = useState(null);

  function loadGroups() {
    return getAgentGroupsStrict()
      .then(g => { setAgentGroups(Array.isArray(g) ? g : []); setGroupsLoaded(true); })
      .catch(err => { swallowed('agents-tab: groups', err); });
  }

  // Load the owner's saved group definitions once per session. Mutations below
  // update state optimistically and persist, so no need to re-fetch on the poll.
  useEffect(() => {
    if (!session) { setAgentGroups([]); setGroupsLoaded(false); return; }
    setCollapsedGroups(loadCollapsedGroups(session.owner));
    loadGroups();
  }, [session]);

  /** True (with a toast and a new load) while the stored groups have not loaded. */
  function refused() {
    if (groupsLoaded) return false;
    showToast(t('common.settingsNotLoaded'), true);
    loadGroups();
    return true;
  }
  function persistGroups(next) {
    if (refused()) return;
    setAgentGroups(next);
    saveAgentGroups(next).catch(e => showToast((e && e.message) || t('profile.agents.groups.saveError'), true));
  }
  function addGroup() {
    if (refused()) return;
    const id = 'grp-' + Date.now().toString(36);
    persistGroups([...agentGroups, { id, name: '', agents: [] }]);
    setEditingGroup(id); // open the new group in rename mode immediately
  }
  function renameGroup(id, name) {
    persistGroups(agentGroups.map(g => g.id === id ? { ...g, name } : g));
  }
  function removeGroup(id) {
    const grp = agentGroups.find(g => g.id === id);
    confirm(
      t('profile.agents.groups.confirmRemove').replace('{name}', grp?.name || '…'),
      () => persistGroups(agentGroups.filter(g => g.id !== id)),
    );
  }
  // Move an agent into targetId (a group id, or UNGROUPED_ID to remove it from
  // every group). An agent belongs to at most one group.
  function moveAgentToGroup(agentName, targetId) {
    if (!agentName) return;
    const cleaned = agentGroups.map(g => ({ ...g, agents: (g.agents || []).filter(n => n !== agentName) }));
    const next = targetId === UNGROUPED_ID
      ? cleaned
      : cleaned.map(g => g.id === targetId ? { ...g, agents: [...g.agents, agentName] } : g);
    persistGroups(next);
  }
  function toggleGroupCollapsed(id) {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      saveCollapsedGroups(session?.owner, next);
      return next;
    });
  }

  // Drag-to-assign for custom-group mode: drag an agent bar (grip handle) onto a
  // group header to file it there. Mirrors the document-space section pattern.
  const groupDnd = {
    draggingAgentName,
    onDragStart: (name, e) => {
      draggedAgent.current = name;
      setDraggingAgentName(name);
      if (e?.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', name); } catch (err) { swallowed('agents-tab: onDragStart', err); }
      }
    },
    onDragOver: (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; },
    onDropToGroup: (targetId) => { moveAgentToGroup(draggedAgent.current, targetId); draggedAgent.current = null; setDraggingAgentName(null); },
    onDragEnd: () => { draggedAgent.current = null; setDraggingAgentName(null); },
  };

  return { agentGroups, collapsedGroups, editingGroup, setEditingGroup, addGroup, renameGroup, removeGroup, toggleGroupCollapsed, groupDnd };
}

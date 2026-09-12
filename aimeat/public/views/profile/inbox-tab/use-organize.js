/**
 * @file public/views/profile/inbox-tab/use-organize.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The state behind organising the Messages list: which sections and groups this viewer
 *   has closed (remembered in this browser), selecting rows, archiving and restoring them, and the
 *   settings and rules the "List rules" page reads and saves. The decisions themselves live on the
 *   server (services/inbox-organize/), which composes the list; this hook asks for them and reloads.
 * @structure useInboxOrganize({ showToast, loadLists, pageOpen }) → org
 * @usage const org = useInboxOrganize({ showToast, loadLists, pageOpen: mode === 'organize' });
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial, with the Messages list's sections, rules and archive.
 */
import { useState, useEffect, useCallback } from 'preact/hooks';
import { t } from '/js/i18n.js';
import * as messages from '/js/services/messages.js';
import { swallowed } from '/js/swallowed.js';
import { rowIds } from './list-panel.js';

const COLLAPSED_KEY = 'aimeat.inbox.collapsed';

function readCollapsed() {
  try {
    const v = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch (err) {
    // Storage refused or a broken value: every section opens, which is the safe way to be wrong.
    swallowed('inbox organize: read collapsed', err);
    return {};
  }
}

export function useInboxOrganize({ showToast, loadLists, pageOpen }) {
  // key → true when closed. Only what the viewer changed is stored; everything else takes its default.
  const [collapsed, setCollapsed] = useState(readCollapsed);
  useEffect(() => {
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed)); } catch (err) { swallowed('inbox organize: write collapsed', err); }
  }, [collapsed]);
  const isCollapsed = useCallback((key, closedByDefault = false) => (key in collapsed ? !!collapsed[key] : closedByDefault), [collapsed]);
  const toggleCollapsed = useCallback((key, closedByDefault = false) => {
    setCollapsed(s => ({ ...s, [key]: !(key in s ? !!s[key] : closedByDefault) }));
  }, []);

  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const startSelecting = useCallback(() => { setSelected(new Set()); setSelecting(true); }, []);
  const endSelecting = useCallback(() => { setSelecting(false); setSelected(new Set()); }, []);
  /** Toggle a row, or a whole group: when every id is already picked they all come off, else all go on. */
  const toggleSelected = useCallback((ids) => {
    setSelected(s => {
      const next = new Set(s);
      const all = ids.every(id => next.has(id));
      for (const id of ids) { if (all) next.delete(id); else next.add(id); }
      return next;
    });
  }, []);

  const archive = useCallback(async (ids, restore = false, fromSelection = false) => {
    if (!ids?.length) return;
    try {
      await messages.archiveConversations(ids, restore);
      showToast?.(t(restore ? 'inbox.org.restoredToast' : 'inbox.org.archivedToast', { count: String(ids.length) }));
      if (fromSelection) endSelecting();
      loadLists();
    } catch (err) {
      swallowed('inbox organize: archive', err);
      showToast?.(err?.message || t('inbox.failed'), true);
    }
  }, [showToast, loadLists, endSelecting]);

  /** The thread head's "…" item for the open conversation, read off the list as it is now. */
  const menuItemFor = useCallback((activeConv, conversations) => {
    if (!activeConv?.conversationId) return null;
    const id = activeConv.conversationId;
    const row = conversations.find(c => rowIds(c).includes(id));
    const inArchive = (row?.conversationId === id ? row : row?.folded?.find(f => f.conversationId === id) || row)?.section === 'archive';
    return {
      label: t(inArchive ? 'inbox.org.restoreConv' : 'inbox.org.archiveConv'),
      onClick: () => archive([id], inArchive),
    };
  }, [archive]);

  // The "List rules" page: loaded when it opens, and again when the list changed somewhere else
  // (another tab, or the owner's AI saving a rule), which the server announces as a messages change.
  const [settings, setSettings] = useState(null);
  const loadSettings = useCallback(async () => {
    const s = await messages.getOrganize().catch(err => { swallowed('inbox organize: load settings', err); return null; });
    setSettings(s);
  }, []);
  useEffect(() => {
    if (!pageOpen) return undefined;
    loadSettings();
    const handler = (e) => { const d = e?.detail?.domains; if (!d || d.has('messages')) loadSettings(); };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [pageOpen, loadSettings]);

  const [saving, setSaving] = useState(false);
  const saveSettings = useCallback(async (patch) => {
    setSaving(true);
    try {
      const r = await messages.updateOrganize(patch);
      if (r?.data) setSettings(r.data);
      showToast?.(t('inbox.org.saved'));
      loadLists();
      return true;
    } catch (err) {
      swallowed('inbox organize: save settings', err);
      showToast?.(err?.message || t('inbox.failed'), true);
      return false;
    } finally {
      setSaving(false);
    }
  }, [showToast, loadLists]);

  return {
    isCollapsed, toggleCollapsed,
    selecting, selected, startSelecting, endSelecting, toggleSelected,
    archive, menuItemFor,
    settings, saving, saveSettings,
  };
}

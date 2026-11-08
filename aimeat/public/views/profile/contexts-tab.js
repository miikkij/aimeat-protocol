/**
 * @file public/views/profile/contexts-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab: Contexts (wish-oma-konteksti-muoto-syntyy-k-yt-ss-n-kym-pyynn-st). A
 *   context is something larger the person keeps working on with their own AI, one memory record
 *   under `context.<slug>` (built-in skill aimeat-context). The chat is where a context is born and
 *   shaped; this page shows what exists and holds the controls that need a screen: copy the sentence
 *   that goes on with one in chat, archive it or bring it back, choose who can read it, and delete
 *   it to the bin (with the way back while the bin keeps it). This file is the state and the
 *   handlers; the render is contexts/view.js, the words and calls contexts/frame.js.
 *
 *   EVERY WRITE IS THE WHOLE RECORD ON ITS VERSION. Archive and the readers' choice send the value
 *   and the version the page read (PUT /v1/memory/:key); a version an AI wrote meanwhile answers 409
 *   VERSION_CONFLICT, the page reads the list again and says so, and nothing the AI wrote is lost.
 *
 *   ADDRESS: `?context=<slug>` opens that context (a link an AI hands the person); the word is taken
 *   off the address once read, so a reload does not reopen it.
 *
 *   LIVE: the list is read again on the `memory` domain of the `aimeat-live-update` event, so a
 *   context the person's AI shapes in chat shows here without a reload. No timer.
 * @structure ContextsTab() — state + handlers → renderContextsView(ctx)
 * @usage registered in profile.js TABS as id 'contexts'.
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'preact/hooks';
import { useConfirm } from '/components/Modal.js';
import { getSession, getNodeId } from '/js/services/auth.js';
import { getOrganismsTab } from '/js/services/organisms.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { swallowed } from '/js/swallowed.js';
import { date } from '/js/format.js';
import { x, api, contextOf } from './contexts/frame.js';
import { renderContextsView } from './contexts/view.js';

/** The slug this tab was opened on (`?context=<slug>`), taken off the address after reading. */
function takeAddressWord() {
  const url = new URL(window.location.href);
  const slug = url.searchParams.get('context');
  if (slug !== null) { url.searchParams.delete('context'); history.replaceState(null, '', url); }
  return slug && /^[a-z0-9][a-z0-9._-]{0,120}$/i.test(slug) ? slug : null;
}

/** Newest shaped first; a context with no stamp at the end. */
const byShaped = (a, b) => String(b.shapedAt).localeCompare(String(a.shapedAt));

export default function ContextsTab({ session, showToast }) {
  const sess = session || getSession();
  const ownerGhii = sess?.ghii || (sess?.owner ? `${sess.owner}@${getNodeId()}` : '');
  const { confirm, ConfirmUI } = useConfirm();
  const toast = (msg, isError) => showToast?.(msg, isError);

  const [asked] = useState(takeAddressWord);
  const [items, setItems] = useState(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState(asked ? `context.${asked}` : null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleted, setDeleted] = useState(null);
  const [orgNames, setOrgNames] = useState({});
  const [viewsOpen, setViewsOpen] = useState({});

  const load = useCallback(async () => {
    try {
      const rows = await api.list();
      // Only the records kept under the person, as the index the AI reads on connecting lists them.
      const own = rows.filter((r) => !ownerGhii || !r.owner_gaii || r.owner_gaii === ownerGhii);
      setItems(own.map(contextOf).filter(Boolean));
      setFailed(false);
    } catch (e) { swallowed('contexts-tab: list', e); setFailed(true); }
  }, [ownerGhii]);

  useEffect(() => { load(); }, [load]);
  const liveRef = useRef(load);
  liveRef.current = load;
  useEffect(() => onLiveUpdate(['memory'], () => liveRef.current()), []);

  const active = useMemo(() => (items || []).filter((c) => !c.archivedAt).sort(byShaped), [items]);
  const archived = useMemo(() => (items || []).filter((c) => c.archivedAt).sort(byShaped), [items]);
  const current = useMemo(() => (items || []).find((c) => c.key === selected) || active[0] || archived[0] || null,
    [items, selected, active, archived]);

  // An organism's name for "that organism's members", read only when a context is shared with one.
  const needsOrgs = (items || []).some((c) => c.visibility.startsWith('organism:'));
  useEffect(() => {
    if (!needsOrgs) return;
    let live = true;
    getOrganismsTab().then((tab) => {
      if (live) setOrgNames(Object.fromEntries((tab?.mine || []).map((o) => [o.id, o.name])));
    });
    return () => { live = false; };
  }, [needsOrgs]);

  // A context opened from the address that sits in the archive opens the archive group too.
  useEffect(() => { if (current?.archivedAt && current.key === selected) setArchivedOpen(true); }, [current, selected]);

  const select = (key) => {
    setSelected(key);
    // On a narrow screen the context stands under the list: bring it into sight.
    if (window.matchMedia?.('(max-width: 1100px)').matches) {
      requestAnimationFrame(() => document.getElementById('ctx-detail')?.scrollIntoView({ block: 'start' }));
    }
  };

  /** The whole record written back on its version; a newer version reloads and says so. */
  const writeBack = async (c, body, said) => {
    setBusy(true);
    try {
      await api.write(c.key, { ...body, version: c.version });
      toast(said);
      await load();
    } catch (e) {
      if (e?.code === 'VERSION_CONFLICT') { toast(x('conflict'), true); await load(); }
      else toast(e?.message || x('failed'), true);
    } finally { setBusy(false); }
  };

  const archive = (c) => writeBack(c,
    { value: { ...c.value, lifecycle: { ...(c.value.lifecycle || {}), archivedAt: new Date().toISOString() } } },
    x('archived', { name: c.name }));
  const bringBack = (c) => {
    const lifecycle = { ...(c.value.lifecycle || {}) };
    delete lifecycle.archivedAt;
    return writeBack(c, { value: { ...c.value, lifecycle } }, x('broughtBack', { name: c.name }));
  };
  const setReaders = (c, visibility) => {
    if (visibility === c.visibility) return;
    writeBack(c, { value: c.value, visibility }, x('readersSaved', { name: c.name }));
  };

  const remove = (c) => confirm(x('deleteConfirm', { name: c.name }), async () => {
    setBusy(true);
    try {
      const out = await api.remove(c.key);
      setDeleted({ key: c.key, name: c.name, until: out?.restorable_until ? date(out.restorable_until) : '' });
      if (selected === c.key) setSelected(null);
      toast(x('deleted', { name: c.name }));
      await load();
    } catch (e) { toast(e?.message || x('failed'), true); }
    finally { setBusy(false); }
  }, { danger: true, title: x('delete'), confirmLabel: x('delete') });

  const restore = async () => {
    if (!deleted) return;
    setBusy(true);
    try {
      await api.restore(deleted.key);
      toast(x('restored', { name: deleted.name }));
      setSelected(deleted.key);
      setDeleted(null);
      await load();
    } catch (e) { toast(e?.message || x('failed'), true); }
    finally { setBusy(false); }
  };

  const ctx = {
    items, failed, reload: load, active, archived, current, select, busy, orgNames, ConfirmUI,
    archivedOpen, toggleArchived: () => setArchivedOpen((o) => !o),
    viewsOpen, setViewOpen: (id, view) => setViewsOpen((m) => ({ ...m, [id]: view })),
    deleted, restore, dismissDeleted: () => setDeleted(null),
    archive, bringBack, setReaders, remove,
    copied: () => toast(x('copiedToast')),
  };
  return renderContextsView(ctx);
}

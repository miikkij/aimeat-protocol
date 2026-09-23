/**
 * @file doc-solo.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Standalone single-document view, served at /v1/profile?doc=<org>:<ws>:<type>:<id>.
 *   Opened in its own window by the document "pop out" (⧉) button so several documents — from any
 *   document-space — can sit side by side, each independent (one window never closes another).
 *   Reuses DocumentView / DocumentEditor (view · edit · publish · Draft/Published compare) and shares
 *   the logged-in session via localStorage (same origin). Opens its own SSE connection so it
 *   live-updates on its own (profile.js, which normally bridges SSE, is not mounted here).
 * @structure DocSolo (default export)
 * @version-history
 *   2026-09-22 -- The window is the shared Page in its reading width and its toast the shared useToast;
 *     no class of its own, and it no longer loads profile.css (the document parts need only the set).
 *   2026-09-14 — The window's toast is the site's shared one (theme.css .toast).
 *   v1.0.0 — 2026-06-09 — Initial: pop-out document window.
 *   v1.0.1 — 2026-06-19 — Import DocumentView/DocumentEditor from their new home
 *     (./profile/organisms/document.js) after the organisms-tab module split.
 */
import { h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { getSession } from '/js/services/auth.js';
import { connect, disconnect, onUpdate, offUpdate } from '/lib/live-updates.js';
import { useToast } from '/components/Toast.js';
import { Page, Text } from '/components/poster-parts.js';
import * as orgService from '/js/services/organisms.js';
import { DocumentView, DocumentEditor } from './profile/organisms/document.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);

function parseDoc() {
  try {
    const parts = (new URLSearchParams(window.location.search).get('doc') || '').split(':');
    return { org: parts[0] || '', ws: parts[1] || '', type: parts[2] || '', id: parts.slice(3).join(':') };
  } catch { return { org: '', ws: '', type: '', id: '' }; }
}

export default function DocSolo() {
  const session = getSession();
  const { org, ws, type, id } = parseDoc();
  const [doc, setDoc] = useState(undefined);   // undefined=loading, null=not found, object=the page
  const [ot, setOt] = useState(null);
  const [mode, setMode] = useState('view');
  const [busy, setBusy] = useState(false);
  const { showToast: raiseToast, ToastContainer } = useToast();
  // The window's notes are informational, as they were: the shared toast in its info tone, 3 s.
  const showToast = useCallback((msg) => raiseToast(msg, 'info'), [raiseToast]);

  const load = useCallback(async () => {
    if (!session || !org || !ws || !type || !id) { setDoc(null); return; }
    try {
      const w = await orgService.getWorkspace(org, ws);
      if (!w) { setDoc(null); return; }
      const objectType = (w.manifest?.objectTypes || []).find(o => o.name === type);
      setOt(objectType || null);
      // Merge drafts over published, exactly like the workspace document index.
      const byId = new Map();
      for (const d of (w.objects?.[type] || [])) byId.set(d.id, { ...d, _draft: false, _published: true });
      for (const d of (w.drafts?.[type] || [])) { const pub = byId.get(d.id); byId.set(d.id, { ...d, _draft: true, _published: !!pub, _pub: pub || null }); }
      setDoc(byId.get(id) || null);
    } catch (err) { swallowed('doc-solo', err); setDoc(null); }
  }, [session, org, ws, type, id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (doc?.title || doc?.id) document.title = `${doc.title || doc.id} — AIMEAT`; }, [doc?.title, doc?.id]);

  // Standalone window — open our own SSE so the document live-updates independently.
  const loadRef = useRef(load); loadRef.current = load;
  useEffect(() => {
    if (!session) return;
    const notify = () => { window.dispatchEvent(new CustomEvent('aimeat-live-update')); loadRef.current(); };
    connect(() => getSession()?.jwt); onUpdate(notify);
    return () => { offUpdate(notify); disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- One SSE connection per session owner; session is re-read each render (fresh identity) so keying on it would reconnect every render; session?.owner is the stable signal.
  }, [session?.owner]);

  const save = useCallback(async (page) => {
    if (!ot) return;
    const docId = String(page.id || id || '').trim().replace(/[^a-zA-Z0-9_-]/g, '-');
    setBusy(true);
    try {
      const r = await orgService.writeDraft(org, ws, ot.namespace, docId, { id: docId, title: page.title, markdown: page.markdown });
      if (r?.ok === false) showToast(r?.error?.message || (t('organisms.docRejected') || 'Document rejected'));
      else { showToast(t('organisms.pageSaved') || 'Document saved'); await load(); setMode('view'); }
    } catch (e) { showToast((e && e.message) || 'Failed to save'); }
    finally { setBusy(false); }
  }, [ot, org, ws, id, load, showToast]);

  const publish = useCallback(async () => {
    if (!ot || !doc) return;
    setBusy(true);
    try { const r = await orgService.publishDraft(org, ws, ot.namespace, doc.id); showToast((t('organisms.published') || 'Published') + (r?.data?.version ? ` v${r.data.version}` : '')); await load(); }
    catch (e) { showToast((e && e.message) || 'Failed to publish'); }
    finally { setBusy(false); }
  }, [ot, doc, org, ws, load, showToast]);

  if (!session) return html`<${Page} width="reading"><${Text} tone="muted">${t('organisms.loginToView') || 'Sign in to view this document.'}<//><//>`;
  if (doc === undefined) return html`<${Page} width="reading"><${Text} tone="muted">${t('profile.loading') || 'Loading…'}<//><//>`;
  if (doc === null || !ot) return html`<${Page} width="reading"><${Text} tone="muted">${t('organisms.docNotFound2') || 'Document not found.'}<//><//>`;

  return html`
    <${Page} width="reading">
      ${mode === 'edit'
        ? html`<${DocumentEditor} key=${'ed-' + doc.id} orgId=${org} page=${doc} busy=${busy} onSave=${save} onCancel=${() => setMode('view')} />`
        : html`<${DocumentView} key=${'view-' + doc.id} page=${doc} busy=${busy} onEdit=${() => setMode('edit')} onPublish=${publish} onWikiLink=${() => { }} />`}
      <${ToastContainer} />
    <//>`;
}

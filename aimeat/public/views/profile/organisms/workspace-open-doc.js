/**
 * @file public/views/profile/organisms/workspace-open-doc.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Open one document or record of a workspace from elsewhere: the librarian's Open, the
 *   notebook, Discover and the Search everything dialog. A caller primes
 *   sessionStorage `aimeat.ws.{org}.{ws}.openDoc` = { namespace, id } or { key } (read once the
 *   workspace's manifest has loaded), or sends the window event `aimeat-open-doc` { orgId, wsId, key }
 *   (heard while the workspace is already open). With a whole memory key the space is the one whose
 *   namespace the key continues, so a namespace with a dot in it (shared.wish) resolves too, and the
 *   id is the next segment. Moved out of workspace.js (max-file-lines) when the key and the event
 *   were added.
 * @structure useWorkspaceOpenDoc({ ws, orgId, wsId, setTab, setActiveDoc, setExpandedRec })
 *   (a record space opens the record's row, as the overview does; a document space the page)
 * @usage useWorkspaceOpenDoc({ ws, orgId, wsId, setTab, setActiveDoc, setExpandedRec });
 * @version-history
 *   v1.0.0 — 2026-10-16 — Extracted from workspace.js; the request may carry the record's key, and the
 *     event opens it in a workspace that is already open (Jouni: the search went to the organism, not
 *     to the record).
 */
import { useEffect } from 'preact/hooks';
import { swallowed } from '/js/swallowed.js';

/**
 * @param {{ ws: any, orgId: string, wsId: string, setTab: (t: string) => void,
 *   setActiveDoc: (d: { type: string, mode: string, page: { id: string } }) => void,
 *   setExpandedRec?: (f: (s: Record<string, boolean>) => Record<string, boolean>) => void }} p
 */
export function useWorkspaceOpenDoc({ ws, orgId, wsId, setTab, setActiveDoc, setExpandedRec }) {
  const storeKey = 'aimeat.ws.' + orgId + '.' + wsId + '.openDoc';
  const open = (req) => {
    if (!ws?.manifest || !req) return false;
    const types = ws.manifest.objectTypes || [];
    let ot = null;
    let id = req.id;
    if (req.key) {
      ot = types.find((o) => o.namespace && req.key.startsWith(`organism.${orgId}.w.${wsId}.${o.namespace}.`));
      if (ot) id = req.key.slice(`organism.${orgId}.w.${wsId}.${ot.namespace}.`.length).split('.')[0];
    } else if (req.namespace) {
      ot = types.find((o) => o.namespace === req.namespace);
    }
    if (!ot || !id) return false;
    setTab('space:' + ot.name);
    // A record space opens the record's row with its fields; a document space opens the page.
    if (ot.mode === 'records' && setExpandedRec) setExpandedRec((s) => ({ ...s, [ot.name + ':' + id]: true }));
    else setActiveDoc({ type: ot.name, mode: 'view', page: { id } });
    return true;
  };
  const forget = () => { try { sessionStorage.removeItem(storeKey); } catch (err) { swallowed('workspace-open-doc: forget', err); } };

  // Primed before the workspace mounted: opened once the manifest has loaded, then forgotten.
  useEffect(() => {
    if (!ws?.manifest) return;
    let req = null;
    try { req = JSON.parse(sessionStorage.getItem(storeKey) || 'null'); } catch (err) { swallowed('workspace-open-doc: read', err); }
    if (!req) return;
    open(req);
    forget();
  }, [ws, storeKey]);   // eslint-disable-line react-hooks/exhaustive-deps -- open reads the same ws

  // Asked while this workspace is already open.
  useEffect(() => {
    const onDoc = (e) => {
      const d = e.detail || {};
      if (d.orgId !== orgId || d.wsId !== wsId) return;
      if (open(d)) forget();
    };
    window.addEventListener('aimeat-open-doc', onDoc);
    return () => window.removeEventListener('aimeat-open-doc', onDoc);
  });
}

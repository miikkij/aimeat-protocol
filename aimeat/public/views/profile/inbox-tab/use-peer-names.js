/**
 * @file public/views/profile/inbox-tab/use-peer-names.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The display names and agent avatars of everybody on the Messages page, resolved once
 *   per id and cached. Moved out of inbox-tab.js unchanged when that file reached its line limit.
 * @structure usePeerNames({ conversations, requests, activeConv, myAgents, extraIds })
 * @usage const { peerNamesRef, setPeerNames, setPeerAvatars, peerNames, peerDisplay, peerAvatar } = usePeerNames(...);
 * @version-history
 *   v1.0.0 — 2026-10-21 — Moved out of inbox-tab.js (a move); `extraIds` names the members of an open
 *     group and of group invitations, so they are resolved like any other peer.
 */
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { apiGet } from '/js/api.js';
import { peerLabel } from '/js/services/messages-ai-prompts.js';
import { swallowed } from '/js/swallowed.js';
import { ownerKeyOf } from './helpers.js';

export function usePeerNames({ conversations, requests, activeConv, myAgents, extraIds = [] }) {
  const [peerNames, setPeerNames] = useState({});         // id (GHII/GAII or owner@node) → resolved display name
  const peerNamesRef = useRef({});                        // dedup bookkeeping: an id present here was already looked up
  const [peerAvatars, setPeerAvatars] = useState({});     // agent GAII → its `avatar` from a profile read (agents only)

  // Peer display names (TARGET-031, part A): the conversation payload carries only ids, so resolve a
  // human-friendly name once per peer and cache it. Agents → GET /v1/agents/:gaii, humans (owner@node) →
  // GET /v1/ghii/:ghii (both public, both return display_name). Federated peers on another node aren't
  // in the local store → 404 → we keep the handle. Reserve each id synchronously so we fetch it once.
  const resolvePeerNames = useCallback((ids) => {
    const todo = [...new Set((ids || []).filter(Boolean))].filter(id => !(id in peerNamesRef.current) && !String(id).startsWith('group:'));
    if (!todo.length) return;
    todo.forEach(id => { peerNamesRef.current[id] = ''; });   // reserve (fallback = handle) so we look it up once
    Promise.all(todo.map(async (id) => {
      const path = String(id).includes('#') ? `/v1/agents/${encodeURIComponent(id)}` : `/v1/ghii/${encodeURIComponent(id)}`;
      const r = await apiGet(path).catch(err => { swallowed('inbox-tab: openConversation', err); return null; });
      const dn = String(r?.data?.display_name || '').trim();
      if (dn) peerNamesRef.current[id] = dn;
      return r?.data?.avatar ? [id, r.data.avatar] : null;
    })).then((found) => {
      setPeerNames({ ...peerNamesRef.current });
      const avatars = Object.fromEntries(found.filter(Boolean));
      if (Object.keys(avatars).length) setPeerAvatars(p => ({ ...p, ...avatars }));
    });
  }, []);
  // Resolve names for every peer currently on screen (conversation peers + their owners + requests + open thread).
  const extraKey = extraIds.join(',');
  useEffect(() => {
    const ids = [];
    // A folded row is filed under who opened it, and each copy under it is named by who it went to.
    for (const c of conversations) for (const r of [c, ...(c.folded || [])]) {
      if (r.peerGhii) { ids.push(r.peerGhii); ids.push(ownerKeyOf(r.peerGhii)); }
      if (c.fold) { ids.push(r.openedBy); ids.push(r.openedTo); }
    }
    for (const r of requests) if (r.contactId) ids.push(r.contactId);
    if (activeConv?.peerGhii) { ids.push(activeConv.peerGhii); ids.push(ownerKeyOf(activeConv.peerGhii)); }
    for (const p of activeConv?.participants || []) ids.push(p);
    resolvePeerNames([...ids, ...extraIds]);
    // `extraKey` is the stable join of extraIds, the intended trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, requests, activeConv, resolvePeerNames, extraKey]);
  // "Display name (handle)" for an id, falling back to the bare handle when we have no display name.
  const peerDisplay = (id) => peerLabel(id, peerNames[id]);
  // An agent peer's own avatar, or null (a person, or an agent without one): the owner's own agents
  // carry it in their list, another owner's agent in the profile read above.
  const peerAvatar = (id) => (String(id || '').includes('#') ? (peerAvatars[id] || myAgents.find(a => a.gaii === id)?.avatar || null) : null);

  return { peerNames, setPeerNames, peerNamesRef, setPeerAvatars, peerDisplay, peerAvatar };
}

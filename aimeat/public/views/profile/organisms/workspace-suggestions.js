/**
 * @file public/views/profile/organisms/workspace-suggestions.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The members' suggestions that wait in one workspace (a space, the sections), for the
 *   workspace cover's "Suggestions" row: read once when the workspace opens and again on the
 *   existing `organisms` live event, never on a timer, and decided on the row by whoever may
 *   (`can_decide`). The same suggestions reach the creator and the admins as a notification.
 * @structure useWorkspaceSuggestions(orgId, wsId, showToast)
 * @usage const { suggestions, decideSuggestion } = useWorkspaceSuggestions(orgId, wsId, showToast);
 * @version-history
 *   v1.0.0 -- 2026-11-27 -- Initial: the cover says how many suggestions wait and decides them in place.
 */
import { useState, useEffect, useCallback } from 'preact/hooks';
import { onLiveUpdate } from '/lib/live-updates.js';
import { t } from '/js/i18n.js';
import * as orgService from '/js/services/organisms.js';
import { swallowed } from '/js/swallowed.js';

export function useWorkspaceSuggestions(orgId, wsId, showToast) {
  const [suggestions, setSuggestions] = useState([]);
  const load = useCallback(() => orgService.listSuggestions(orgId, wsId, 'pending')
    .then(list => setSuggestions(Array.isArray(list) ? list : []))
    .catch(err => { swallowed('workspace-suggestions: load', err); }), [orgId, wsId]);
  useEffect(() => {
    load();
    let timer = null;
    const off = onLiveUpdate(['organisms'], () => { clearTimeout(timer); timer = setTimeout(load, 1500); });
    return () => { clearTimeout(timer); off(); };
  }, [load]);
  const decideSuggestion = useCallback(async (id, decision) => {
    try {
      await orgService.decideSuggestion(orgId, id, decision);
      showToast?.(decision === 'approve' ? t('organisms.approved') : t('organisms.ws.row.declined'));
      await load();
    } catch (e) { showToast?.((e && e.message) || t('organisms.ws.row.decideFailed')); }
  }, [orgId, load, showToast]);
  return { suggestions, decideSuggestion };
}

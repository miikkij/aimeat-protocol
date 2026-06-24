/**
 * @file secretary/use-access.js
 * @description P2-C — access gatekeeper. A surface for the Secretary to help the owner manage their OWN
 *   sharing groups + consent grants (Draft/Ask: the form IS the draft, an explicit Approve commits). It
 *   lists the owner's active consent grants (GET /v1/consent) and sharing groups (GET /v1/groups), can
 *   propose + create a new consent grant (POST /v1/consent) or sharing group (POST /v1/groups), and can
 *   revoke a grant (DELETE /v1/consent/:id). PERSONAL admin only — owner sessions bypass the
 *   `consent:manage` scope; this never touches org / Enterprise `consent:manage`. Re-fetches on the
 *   consent/groups live-update domains. See docs/plans/2026-06-24-secretary-p2-fix-prompt.md (P2-C) + §21.
 * @structure useAccess({ showToast }) -> { consents, groups, loading, grantForm, groupForm, ...handlers }
 * @usage const access = useAccess({ showToast }); accessCard(access)
 * @version-history v0.1.0 — 2026-06-24 — P2-C: list/grant/revoke consent + create sharing groups.
 */
import { useState, useEffect, useCallback } from 'preact/hooks';
import { apiGet, apiPost, apiDelete } from '/js/api.js';
import { t } from '/js/i18n.js';

const EMPTY_GRANT = { open: false, dataPattern: '', recipient: '', purpose: '', saving: false };
const EMPTY_GROUP = { open: false, name: '', saving: false };

export function useAccess({ showToast }) {
  const [consents, setConsents] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [grantForm, setGrantForm] = useState(EMPTY_GRANT);
  const [groupForm, setGroupForm] = useState(EMPTY_GROUP);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [c, g] = await Promise.all([
        apiGet(`/v1/consent?status=active&_=${Date.now()}`).catch(() => null),
        apiGet(`/v1/groups?_=${Date.now()}`).catch(() => null),
      ]);
      setConsents((c && c.data && c.data.consents) || []);
      setGroups((g && g.data && g.data.groups) || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const handler = (e) => {
      const d = e.detail && e.detail.domains;
      if (!d || d.has('consent') || d.has('groups')) refresh();
    };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [refresh]);

  const approveGrant = useCallback(async () => {
    const data_pattern = grantForm.dataPattern.trim();
    const recipient = grantForm.recipient.trim();
    const purpose = grantForm.purpose.trim();
    if (!data_pattern || !recipient || !purpose) return;
    setGrantForm((f) => ({ ...f, saving: true }));
    try {
      await apiPost('/v1/consent', { data_pattern, recipient, purpose, scope: 'private' });
      setGrantForm(EMPTY_GRANT);
      showToast(t('secretary.access.granted'));
      await refresh();
    } catch (e) {
      showToast(`${t('secretary.access.error')}: ${e.message}`, true);
      setGrantForm((f) => ({ ...f, saving: false }));
    }
  }, [grantForm, refresh, showToast]);

  const revokeGrant = useCallback(async (id) => {
    try {
      await apiDelete(`/v1/consent/${encodeURIComponent(id)}`);
      showToast(t('secretary.access.revoked'));
      await refresh();
    } catch (e) {
      showToast(`${t('secretary.access.error')}: ${e.message}`, true);
    }
  }, [refresh, showToast]);

  const createGroup = useCallback(async () => {
    const name = groupForm.name.trim();
    if (!name) return;
    setGroupForm((f) => ({ ...f, saving: true }));
    try {
      await apiPost('/v1/groups', { name });
      setGroupForm(EMPTY_GROUP);
      showToast(t('secretary.access.groupCreated'));
      await refresh();
    } catch (e) {
      showToast(`${t('secretary.access.error')}: ${e.message}`, true);
      setGroupForm((f) => ({ ...f, saving: false }));
    }
  }, [groupForm, refresh, showToast]);

  return { consents, groups, loading, grantForm, setGrantForm, approveGrant, revokeGrant, groupForm, setGroupForm, createGroup };
}

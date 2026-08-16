/**
 * @file views/profile/memory-tab/sharing.js
 * @description Key-space sharing for the Memory tab, as one hook. Extracted from memory-tab.js to
 *   satisfy max-file-lines; behaviour unchanged.
 *
 *   Sharing is not a visibility tier. A record keeps the visibility it has for everyone else
 *   (normally private) and a SHARE, held separately, lets a sharing group read a key PATTERN. That
 *   is why the row no longer offers "group" in its visibility menu and offers "share this key
 *   space" instead: picking a group from a visibility list shared exactly one record, which went
 *   stale the moment the next one was written.
 * @structure
 *   - useKeySpaceSharing({ groups, showToast }) — the share list, the row badge lookup, and the
 *     per-row share panel's state and submit
 * @usage
 *   const sharing = useKeySpaceSharing({ groups, showToast });
 *   // spread into the render ctx; call sharing.loadShares() when the tab (re)loads
 * @version-history
 *   v1.1.0 — 2026-08-16 — sharesCovering() and revokeCoveringShare(): the hook could create a share
 *     and had no way to end one, so a key shared from the Memory tab could not be unshared there.
 *   v1.0.0 — 2026-08-11 — Extracted from memory-tab.js (max-file-lines).
 */
import { useState, useCallback } from 'preact/hooks';
import { t } from '/js/i18n.js';
import { listOutgoing, createShare, revokeShare, suggestPattern, patternCoversKey } from '/js/services/shares.js';
import { swallowed } from '/js/swallowed.js';

export function useKeySpaceSharing({ groups, showToast }) {
  const [shares, setShares] = useState([]);
  const [sharePanelFor, setSharePanelFor] = useState(null);
  const [sharePattern, setSharePattern] = useState('');
  const [shareGroupId, setShareGroupId] = useState('');

  /**
   * Every share this owner holds, in ONE request rather than one per row. A listing of a thousand
   * keys still costs a single call, and a row can then say "shared" without asking anything: the
   * answer is a pattern match against a list already in hand.
   */
  const loadShares = useCallback(async () => {
    try {
      const resp = await listOutgoing();
      setShares(resp?.data?.shares || []);
    } catch (err) {
      swallowed('memory-tab: loadShares', err);
      setShares([]);
    }
  }, []);

  /** The groups that can already read this key, via any share whose pattern covers it. */
  const sharedWith = useCallback((key) => {
    const ids = new Set(shares.filter(s => patternCoversKey(s.key_pattern, key)).map(s => s.group_id));
    return groups.filter(g => ids.has(g.id));
  }, [shares, groups]);

  /**
   * The shares that reach this key, as records rather than names — the shape a person needs to take
   * one back. `sharedWith` answers "who can read this", which is enough to DISPLAY and not enough to
   * undo, and undoing was the half that was never built: this hook could create a share and had no
   * way to end one, so a key could be shared from here and only unshared somewhere else.
   */
  const sharesCovering = useCallback((key) => shares
    .filter(s => patternCoversKey(s.key_pattern, key))
    .map(s => ({ ...s, group: groups.find(g => g.id === s.group_id) || null })), [shares, groups]);

  /**
   * End one share. The pattern is what is revoked, not the key: a share is a rule over a keyspace,
   * so taking it back takes back every key it covered, and the confirmation says so rather than
   * letting a person believe they unshared one record.
   */
  const revokeCoveringShare = useCallback(async (share) => {
    try {
      await revokeShare(share.id);
      showToast(t('profile.memory.shRevoked').replace('{pattern}', share.key_pattern));
      await loadShares();
    } catch (e) {
      showToast(e.message || t('profile.access.shRevokeError'), true);
    }
  }, [showToast, loadShares]);

  const openSharePanel = useCallback((key) => {
    setSharePanelFor(key);
    setSharePattern(suggestPattern(key));
    setShareGroupId(groups[0]?.id || '');
  }, [groups]);

  const submitShare = useCallback(async () => {
    if (!shareGroupId || !sharePattern.trim()) return;
    try {
      await createShare(shareGroupId, { key_pattern: sharePattern.trim() });
      showToast(t('profile.access.shCreated'));
      setSharePanelFor(null);
      loadShares();
    } catch (e) {
      showToast(e.message || t('profile.access.shCreateError'), true);
    }
  }, [shareGroupId, sharePattern, showToast, loadShares]);

  return {
    loadShares, sharedWith, sharesCovering, revokeCoveringShare, submitShare, openSharePanel,
    sharePanelFor, setSharePanelFor, sharePattern, setSharePattern, shareGroupId, setShareGroupId,
  };
}

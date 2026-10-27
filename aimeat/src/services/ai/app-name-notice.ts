/**
 * @file src/services/ai/app-name-notice.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner is told, once, when an entry of their list of apps that may use AI lets in
 *   another author's app by its file name alone.
 *
 *   WHY. Since 2026-10-25 an app's call is checked under the app its grant names (`bob/notes.html`),
 *   and an entry saved under the name an app calls itself (`notes`) keeps holding for it, so lists
 *   written before then keep working (services/ai-app-id.ts entryNamesApp; the contract is
 *   test/unit/ai-app-id.test.ts). That entry also holds for any other author's app of the same file
 *   name that the owner granted AI use. The match stays, as decided, and is made visible: the first
 *   time an entry lets a given app in this way, the owner gets a notice that names the app and says
 *   how to name the one they meant (secaudit2026oct26, ai-app-id.ts:entryNamesApp:
 *   bare-allowlist-entry-matches-any-author). Nothing is refused and nothing waits for it.
 * @structure noticeBareNameMatch
 * @usage void noticeBareNameMatch(storage, ownerGhii, prefs, appId);
 * @version-history
 *   v1.0.0 -- 2026-10-27 -- Initial (secaudit2026oct26).
 */
import type { Storage } from '../../storage/interface.js';
import { bareNameOnlyEntry, canonicalAiAppId } from '../ai-app-id.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { notify } from '../notify.js';
import { logger } from '../../utils/logger.js';

/** The pairs (`<entry>\n<app>`) the owner was already told about. Node bookkeeping under `ai-usage.`. */
export const APP_NAME_NOTICES_KEY = 'ai-usage.app-name-notices';
/** The notice's type in the owner's notifications. */
export const APP_NAME_NOTICE_TYPE = 'ai_app_name_match';

const pairsOf = (v: unknown): string[] => {
  const pairs = (v as { pairs?: unknown } | null | undefined)?.pairs;
  return Array.isArray(pairs) ? pairs.filter((p): p is string => typeof p === 'string') : [];
};

/**
 * Tell the owner once that a bare entry of their AI list let another author's app in. Best effort:
 * never throws, so the call it watches is never failed by it.
 */
export async function noticeBareNameMatch(
  storage: Storage, ownerGhii: string, prefs: Record<string, unknown>, appId: string | undefined,
): Promise<void> {
  try {
    if (!appId || !Array.isArray(prefs.app_allowlist)) return;
    const entry = bareNameOnlyEntry(prefs.app_allowlist as unknown[], appId, ownerGhii);
    const app = canonicalAiAppId(appId, ownerGhii);
    if (!entry || !app) return;
    const pair = `${entry}\n${app}`;
    let fresh = false;
    await updateRecord(storage, ownerGhii, APP_NAME_NOTICES_KEY, (v) => ({ pairs: pairsOf(v) }), (cur) => {
      if (cur.pairs.includes(pair)) return UNCHANGED;
      fresh = true;
      return { pairs: [...cur.pairs, pair].slice(-200) };
    }, { tag: 'ai-usage', visibility: 'private' });
    if (!fresh) return;
    await notify(storage, ownerGhii, {
      type: APP_NAME_NOTICE_TYPE,
      title: `${app} used AI under your list entry "${entry}"`,
      body: `Your list of apps that may use AI names "${entry}". The app ${app} belongs to another author but has that file name, `
        + `so it may use AI too. If you meant a different app, write its full name (author/app) in the list in place of "${entry}".`,
      i18n: { key: APP_NAME_NOTICE_TYPE, vars: { app, entry } },
    });
  } catch (err) {
    logger.warn(`[ai] could not tell ${ownerGhii} about an allowlist name match: ${(err as Error).message}`);
  }
}

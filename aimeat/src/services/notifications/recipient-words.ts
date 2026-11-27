/**
 * @file src/services/notifications/recipient-words.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A notification's words in its RECIPIENT's language, decided when it is written: the
 *   recipient's own language (their account's locale), the title and body from the locale keys
 *   `notiftext.<key>.title` and `.body` with their `{name}` variables filled, and an organism named in
 *   them by its team name in that language. notify() stores these words, so the bell, the list and
 *   the web push say the same thing in the language the person reads, and a reader whose page is in
 *   another language still reads what was written for them.
 *
 *   A key with no text in any locale leaves the caller's own words, which stay the fallback.
 * @structure recipientLocale · fillNotifTemplate · notifWords
 * @usage const words = await notifWords(storage, recipientGhii, input.i18n, { title, body });
 * @version-history
 *   v1.1.0 — 2026-11-27 — fillNotifTemplate: a place with no value says nothing instead of keeping
 *     its braces.
 *   v1.0.0 — 2026-11-14 — Initial: notifications are written in the recipient's language
 *     (Jouni, 2026-11-14).
 */
import type { Storage } from '../../storage/interface.js';
import { createT, toLocale, type Locale } from '../../i18n.js';
import { localAccountName } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { readTeamRecord, teamDisplayName } from '../team/record.js';
import type { NotifText } from '../notify.js';

/** The language a person reads their notifications in: their account's locale, English without one. */
export async function recipientLocale(storage: Storage, recipientGhii: string): Promise<Locale> {
    try {
        const ghii = await storage.getGHIIByOwner(localAccountName(recipientGhii));
        return toLocale(ghii?.locale);
    } catch (err) {
        logger.warn('notify: the recipient\'s language was not read; English is used', { recipient: recipientGhii, error: String(err) });
        return 'en';
    }
}

/**
 * A notiftext template's `{name}` places filled from `vars`. A place with no value says nothing: a
 * stored notice never shows a brace, whatever variables its caller had when it was written.
 */
export function fillNotifTemplate(tpl: string, vars: Record<string, string | number> | undefined): string {
    return tpl.replace(/\{(\w+)\}/g, (_all, name: string) => (vars && name in vars ? String(vars[name]) : ''));
}

/**
 * The words a notification is stored with: the title and body in the recipient's language and the
 * variables it was filled from (an organism's name resolved to its team name in that language), or
 * the caller's own words when the key has no text.
 */
export async function notifWords(
    storage: Storage, recipientGhii: string, i18n: NotifText | undefined, fallback: { title: string; body: string },
): Promise<{ title: string; body: string; i18n?: NotifText; locale: Locale }> {
    const locale = await recipientLocale(storage, recipientGhii);
    if (!i18n) return { ...fallback, locale };
    const vars: Record<string, string | number> = { ...(i18n.vars ?? {}) };
    for (const [name, orgId] of Object.entries(i18n.orgVars ?? {})) {
        try {
            const organism = await storage.getOrganism(orgId);
            if (!organism) continue;
            vars[name] = teamDisplayName(await readTeamRecord(storage, orgId), locale, organism.name);
        } catch (err) {
            // The caller's own value for this variable, if it gave one, stays; the notification is still written.
            logger.warn('notify: an organism named in a notification was not read', { orgId, error: String(err) });
        }
    }
    const t = createT(locale);
    const titleKey = `notiftext.${i18n.key}.title`;
    const bodyKey = `notiftext.${i18n.key}.body`;
    const titleTpl = t(titleKey);
    const bodyTpl = t(bodyKey);
    return {
        title: titleTpl !== titleKey ? fillNotifTemplate(titleTpl, vars) : fallback.title,
        body: bodyTpl !== bodyKey ? fillNotifTemplate(bodyTpl, vars) : fallback.body,
        i18n: { key: i18n.key, vars },
        locale,
    };
}

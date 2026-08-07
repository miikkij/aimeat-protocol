/**
 * @file src/services/inactivity-nudge.ts
 * @description One friendly email to somebody nobody has seen for a fortnight, carrying a prompt
 *   they can run the moment they read it.
 *
 *   **It adds no storage.** "Last seen" is not a column here, because the node already records
 *   three timestamps that each mean a person was alive, and the largest of the three is the
 *   answer: a browser session refreshing, an AI connector calling, or a plain sign-in. A new
 *   `lastActiveAt` column would have to be back-filled and would still say nothing about the
 *   fortnight before it existed. The nightly job pays for the reads instead — nightly is exactly
 *   where that trade is cheap.
 *
 *   Deliberately: **an agent that has been working counts as the person being alive.** Emailing
 *   somebody "we have not seen you" while their AI has been writing to their account all week is
 *   the failure mode worth designing against, not the one worth optimising.
 *
 *   Consent is the switch that already exists. `settings.email_notifications` has been written by
 *   the profile for a long time and read by nothing — every email footer promised a control that
 *   governed nothing. This job honours it, and so does the older rescue pass.
 *
 *   **Off unless the operator turns it on** (`AIMEAT_INACTIVITY_NUDGE=true`). It is unsolicited
 *   mail to real people; the default cannot be "starts sending".
 * @structure
 *   - lastSeenAt(storage, ghii): the max of the three existing signals
 *   - runInactivityNudgeJob(config, storage, opts?): the nightly pass
 *   - nudgeEmailContent(config, locale, prompt): the copy, en + fi
 * @usage
 *   // Registered as core handler 'inactivity-nudge' in services/core-jobs.ts.
 *   await runInactivityNudgeJob(config, storage);
 * @version-history
 *   v1.0.0 — 2026-08-07 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { GHIIRecord } from '../storage/types/identity.js';
import { getActiveEmailService } from './email.js';
import { outboundEmailHtml } from './email-templates.js';
import { ONBOARDING_KEYS } from './onboarding-funnel.js';
import { buildWelcomeMatPrompt } from './welcome-mat-prompt.js';
import { logger } from '../utils/logger.js';

/** How long a silence has to last before it is worth a message. */
export const INACTIVITY_DAYS = 14;
/**
 * And how long before the same person may be nudged again. Without it a nightly job mails whoever
 * is still quiet every single night — the single most likely way this feature turns into spam.
 */
export const NUDGE_COOLDOWN_DAYS = 60;

/**
 * Accounts that went quiet BEFORE this shipped are left alone. Someone who drifted away months ago
 * getting "we have not seen you in a while" reads as a system that has been watching, not helping
 * — the same reasoning the onboarding rescue states for its own epoch.
 */
export const NUDGE_FEATURE_EPOCH = '2026-08-07T00:00:00Z';

const DAY_MS = 24 * 3600 * 1000;

/** Largest of a set of ISO timestamps, as epoch millis; 0 when none parse. */
function maxTime(...values: Array<string | null | undefined>): number {
    let best = 0;
    for (const v of values) {
        if (!v) continue;
        const t = Date.parse(v);
        if (Number.isFinite(t) && t > best) best = t;
    }
    return best;
}

/**
 * When this person was last demonstrably alive, from signals the node already keeps:
 *   - a browser session's `lastUsedAt`, bumped on every refresh-token rotation,
 *   - a chat instance's `lastSeen`, bumped on every MCP call their AI makes,
 *   - `lastLoginAt`, which alone is far too coarse: with a 30-day idle refresh window a daily user
 *     can carry a month-old value, so it is the floor rather than the answer.
 * Returns 0 when nothing is known, which the caller treats as "cannot tell" rather than "gone".
 */
export async function lastSeenAt(storage: Storage, g: GHIIRecord): Promise<number> {
    let best = maxTime(g.lastLoginAt, g.createdAt);
    try {
        const sessions = await storage.listActiveSessions(g.ownerName);
        best = Math.max(best, maxTime(...sessions.map(s => s.lastUsedAt)));
    } catch (err) {
        logger.warn('inactivity-nudge: session read failed', { owner: g.ownerName, error: String(err) });
    }
    try {
        const instances = await storage.listChatInstances({ ownerName: g.ownerName });
        best = Math.max(best, maxTime(...instances.map(i => i.lastSeen)));
    } catch (err) {
        logger.warn('inactivity-nudge: chat instance read failed', { owner: g.ownerName, error: String(err) });
    }
    return best;
}

/**
 * May the node send this person a non-transactional email?
 *
 * Reads `settings.email_notifications`, the key the profile's notification tab has been writing
 * all along.
 *
 * `defaultWhenAbsent` exists because the two callers genuinely differ, and getting it wrong is
 * visible to the user either way:
 *
 *   - The NUDGE passes **false**. The toggle in the profile renders unchecked when nothing is
 *     stored, so somebody who looks at it sees "off". Sending anyway would make the switch a lie
 *     in exactly the way this work set out to fix.
 *   - The onboarding RESCUE passes **true**, preserving what it does today. Flipping it would
 *     silently switch off a working feature for every account that has never opened the tab, which
 *     is not a change to make as a side effect.
 */
export async function mayEmailOwner(
    storage: Storage, ghii: string, defaultWhenAbsent = false,
): Promise<boolean> {
    try {
        const rec = await storage.getMemory(ghii, 'settings.email_notifications');
        if (!rec) return defaultWhenAbsent;
        const v = rec.value as { enabled?: boolean } | boolean | undefined;
        if (typeof v === 'boolean') return v;
        if (v && typeof v === 'object' && typeof v.enabled === 'boolean') return v.enabled;
        return defaultWhenAbsent;
    } catch (err) {
        // A read failure must not become a send: silence is recoverable, an unwanted email is not.
        logger.warn('inactivity-nudge: consent read failed', { ghii, error: String(err) });
        return false;
    }
}

interface NudgeCopy { subject: string; heading: string; paragraphs: string[]; closing: string }

/**
 * The words. Short, not disappointed in anyone, and the prompt is IN the message — the point is
 * that reading the email and doing the thing are the same action.
 */
export function nudgeEmailContent(config: AimeatConfig, locale: 'en' | 'fi', displayName: string): NudgeCopy {
    const url = config.baseUrl;
    if (locale === 'fi') {
        return {
            subject: 'Kotisi odottaa sinua',
            heading: `Hei ${displayName}`,
            paragraphs: [
                'Emme ole nähneet sinua vähään aikaan, eikä siinä ole mitään vikaa. Kotisi on yhä pystyssä ja kaikki mitä teit on tallessa.',
                'Jos haluat tehdä jotain pienen hetken aikana, alla on kehote jonka voit kopioida omaan tekoälykeskusteluusi sellaisenaan. Se päivittää tervetulomattosi eli sen sivun jonka muut näkevät sinusta.',
            ],
            closing: `Kotisi on osoitteessa ${url}/v1/home`,
        };
    }
    return {
        subject: 'Your home is still here',
        heading: `Hello ${displayName}`,
        paragraphs: [
            'We have not seen you in a while, and that is entirely fine. Your home is still up and everything you made is where you left it.',
            'If you have a few minutes, the prompt below can be copied straight into your own AI chat. It refreshes your welcome mat — the page other people see when they look you up.',
        ],
        closing: `Your home is at ${url}/v1/home`,
    };
}

/**
 * The nightly pass. One email per quiet account, at most once every cooldown.
 *
 * Order matters and is the same order the rescue uses, for the same reason: eligibility, then
 * CONSENT, then send, then marker. Writing the marker before the consent check would mean someone
 * who later turns notifications back on is never reached again.
 */
export async function runInactivityNudgeJob(
    config: AimeatConfig,
    storage: Storage,
    /** Test seam: freeze the clock and the epoch. Production callers pass nothing. */
    opts: { now?: number; epoch?: number } = {},
): Promise<{ sent: number; considered: number }> {
    if (!config.inactivityNudge) return { sent: 0, considered: 0 };
    const email = getActiveEmailService();
    if (!email || !email.enabled) return { sent: 0, considered: 0 };

    const now = opts.now ?? Date.now();
    const epoch = opts.epoch ?? Date.parse(NUDGE_FEATURE_EPOCH);
    const ghiis = await storage.listGHIIs();
    let sent = 0;
    let considered = 0;

    for (const g of ghiis) {
        // Verified email only: an unverified notificationEmail can be somebody else's address.
        if (!g.notificationEmail || g.verificationLevel < 1) continue;
        if (g.username.startsWith('uxtest-')) continue;   // measurement accounts stay out of this

        const seen = await lastSeenAt(storage, g);
        if (!seen) continue;                              // nothing known: not evidence of absence
        // Epoch compared on the SILENCE, not on account age: an old account that went quiet
        // yesterday is exactly who this is for; one that went quiet last spring is not.
        if (seen < epoch) continue;
        // Compare epoch millis, never formatted dates — core jobs run in server-local time and a
        // calendar-date comparison in a nightly job is how a pipeline goes quietly dead.
        if (now - seen < INACTIVITY_DAYS * DAY_MS) continue;
        considered++;

        const marker = await storage.getMemory(g.ghii, ONBOARDING_KEYS.inactivityNudge);
        const prev = (marker?.value as { sentAt?: string } | undefined)?.sentAt;
        const prevAt = prev ? Date.parse(prev) : 0;
        if (prevAt && now - prevAt < NUDGE_COOLDOWN_DAYS * DAY_MS) continue;

        if (!await mayEmailOwner(storage, g.ghii)) continue;

        const locale = g.locale === 'fi' ? 'fi' : 'en';
        const c = nudgeEmailContent(config, locale, g.displayName || g.username);
        const prompt = buildWelcomeMatPrompt(config, {
            lang: locale, variant: 'short', displayName: g.displayName || g.username,
        });
        const bodyHtml = c.paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join('')
            + `<pre style="white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.5;background:#f6f6f4;border:1px solid #e2e2de;border-radius:8px;padding:14px">${escapeHtml(prompt)}</pre>`
            + `<p>${escapeHtml(c.closing)}</p>`;
        const textBody = [...c.paragraphs, '', prompt, '', c.closing].join('\n');
        const { html, text } = outboundEmailHtml(c.heading, bodyHtml, textBody, locale);

        const ok = await email.sendRaw(g.notificationEmail, c.subject, html, text).catch(err => {
            logger.warn('inactivity-nudge: send failed', { owner: g.ownerName, error: String(err) });
            return false;
        });

        // Recorded even when delivery failed, and OVERWRITING the previous marker rather than
        // writing once: this is a repeatable event, and the cooldown is measured from the last
        // attempt. A bouncing address must not be retried nightly.
        const at = new Date(now).toISOString();
        const history = (marker?.value as { count?: number } | undefined)?.count ?? 0;
        await storage.setMemory({
            key: ONBOARDING_KEYS.inactivityNudge,
            ownerGaii: g.ghii,
            value: { sentAt: at, delivered: ok, count: history + 1, quietSince: new Date(seen).toISOString() },
            visibility: 'private',
            tags: ['onboarding-funnel'],
            ttlHours: null,
            version: 1,
            createdAt: marker?.createdAt ?? at,
            updatedAt: at,
        });
        if (ok) sent++;
    }

    // Core job successes are not written to the execution log — only errors are. Without this line
    // a nightly mailer leaves no trace of what it did.
    if (considered > 0) logger.info(`Inactivity nudge: ${sent} sent of ${considered} quiet account(s)`);
    return { sent, considered };
}

/** Minimal escaping for values interpolated into the email HTML. */
function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

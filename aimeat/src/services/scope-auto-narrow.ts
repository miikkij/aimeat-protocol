/**
 * @file src/services/scope-auto-narrow.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node narrows an agent holding `*` itself when its observation period ends, and
 *   tells the owner what it narrowed, instead of holding the agent's tasks.
 *
 *   WHY (Jouni, 2026-10-18: "tehdään niinkuin ehdotat"). Ruling C (2026-10-02) put a `*` agent on the
 *   task-start floor once OBSERVE_DAYS of its use were on record, so that "all permissions" never read
 *   as "nothing dangerous", and offered the owner a one-press narrowing as the way out. On aimeat.io
 *   on 2026-10-16..18 that held 14 scheduled agents at once, each task with its own bell notice
 *   ("Only you can start this one"), and the narrowing was done by hand in the end. The narrowing the
 *   owner was offered is the one the node now applies: the words the agent used (never one outside
 *   every wildcard, which `*` never gave) plus every word its record already names
 *   (services/scope-narrowing.ts narrowAgent). A word it needs later is refused once and asked for
 *   (services/permission-ask-notice.ts), which is the net under "without loss".
 *
 *   WHERE. At the point a start decision reads the agent: every caller that used to ask
 *   withWildcardFacts asks startFactsOf, so a task is decided on the narrowed agent. It then starts on
 *   its own when its setting says so; a used word on the floor (exchange:write, memory:purge) still
 *   holds it, as for any agent that holds that word by name.
 *
 *   WHEN THE NARROWING FAILS (a storage error, or a record that changed under it), the agent is
 *   handed to the start rules with `wildcardReady`, so `*` holds the task as before: the floor stays
 *   closed rather than open, and the failure is logged. The next task decision tries again.
 *
 *   ONCE. narrowAgent takes one agent at a time and reads it again when its turn comes; a second
 *   decision finds no `*` and is told NOT_WILDCARD, and only the call that narrowed tells the owner.
 *
 *   WHY A FILE OF ITS OWN. scope-use.ts is imported by the auth middleware and must not import
 *   scope-narrowing.ts, whose announcements reach the connector, which reaches the middleware back.
 * @structure AGENT_NARROWED_TYPE · startFactsOf() · agentNarrowedNotice() · tellOwnerNarrowed() ·
 *   mailOwnerNarrowed()
 * @usage
 *   const decision = decideTaskStart(await startFactsOf({ storage, config }, agent), { policy, todos });
 * @version-history
 *   2026-10-27 — The email's heading escapes its subject, which carries the agent's display name
 *     (secaudit2026oct26, wrapHtml unescaped-heading-agent-display-name).
 *   v1.0.0 — 2026-10-18 — Initial: the node narrows a ready `*` agent instead of holding its tasks.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentRecord } from '../storage/interface.js';
import { readScopeUse, wildcardStatus } from './scope-use.js';
import { narrowAgent, type NarrowOutcome } from './scope-narrowing.js';
import { notify, type NotifyInput } from './notify.js';
import { readNotificationSettings, appendMailLog } from './notification-settings.js';
import { getActiveEmailService } from './email.js';
import { wrapHtml } from './email-templates.js';
import { agentPageUrl, plainPermission } from './permission-ask.js';
import { createT, toLocale, type Locale } from '../i18n.js';
import { ownerGhiiOf } from '../utils/gaii.js';
import { escapeHtml as esc } from '../utils/html-escape.js';
import { logger } from '../utils/logger.js';

export const AGENT_NARROWED_TYPE = 'agent_narrowed';

export interface StartFactsDeps { storage: Storage; config: AimeatConfig }

type StartFacts<T> = (T & { wildcardReady?: boolean }) | null | undefined;

/** Does the agent's record hold `*` itself: the same question the usage record answers (`holds`). */
const holdsAll = (agent: Partial<Pick<AgentRecord, 'defaultScopes'>>) => wildcardStatus(agent, undefined).holds;

/**
 * The agent as the start rules read it. An agent that does not hold `*` comes back as it is. One that
 * does and whose record is ready is narrowed first, and comes back with its new permissions; when the
 * narrowing fails it comes back with `wildcardReady`, and `*` holds its tasks (fail closed).
 */
export async function startFactsOf<T extends Partial<Pick<AgentRecord, 'defaultScopes' | 'name' | 'gaii'>>>(
    deps: StartFactsDeps, agent: T | null | undefined,
): Promise<StartFacts<T>> {
    if (!agent || !agent.name || !agent.gaii || !holdsAll(agent)) return agent;
    const { storage } = deps;
    const gaii = agent.gaii;
    const ownerGhii = ownerGhiiOf(gaii);
    const asNow = (scopes: string[] | undefined) => ({ ...agent, defaultScopes: scopes ?? [] }) as StartFacts<T>;
    const held = { ...agent, wildcardReady: true } as StartFacts<T>;

    // A read that fails here fails the decision, as it did before this file: nothing has changed yet.
    const ready = wildcardStatus(agent, (await readScopeUse(storage, ownerGhii)).agents[agent.name]).ready;
    if (!ready) {
        // No record can also mean a narrowing has just finished: it changes the agent first and
        // removes the record after. The caller's copy may be older than that, so read the agent.
        const current = await storage.getAgent(gaii);
        if (current && !holdsAll(current)) return asNow(current.defaultScopes);
        return { ...agent, wildcardReady: false } as StartFacts<T>;
    }

    let out: NarrowOutcome;
    try {
        out = await narrowAgent(storage, ownerGhii, { gaii });
    } catch (err) {
        logger.warn('scope-auto-narrow: the narrowing failed; `*` holds this task for the owner', { gaii, error: String(err) });
        return held;
    }
    if (out.ok) {
        await tellOwnerNarrowed(deps, ownerGhii, out.agent);
        return asNow(out.agent.defaultScopes);
    }
    if (out.code === 'NOT_WILDCARD') {
        // Another decision, or the owner's own press, narrowed it a moment ago. That one told the owner.
        try {
            const current = await storage.getAgent(gaii);
            if (current) return asNow(current.defaultScopes);
        } catch (err) {
            logger.warn('scope-auto-narrow: the narrowed agent could not be read', { gaii, error: String(err) });
        }
    }
    logger.warn('scope-auto-narrow: the agent was not narrowed; `*` holds this task for the owner', { gaii, code: out.code, message: out.message });
    return held;
}

/** The permissions' areas in the owner's language, in a list that fits a sentence. */
function areaWords(scopes: readonly string[], locale: Locale): string {
    const t = createT(locale);
    const families: string[] = [];
    for (const s of scopes) {
        const f = s.split(':')[0];
        if (f && !families.includes(f)) families.push(f);
    }
    return families.map((f) => {
        const key = `appGrant.area.${f}`;
        const v = t(key);
        return v && v !== key ? v : f;
    }).join(', ');
}

/** One line per permission in plain words; a word without a sentence is named by its area. */
function permissionLines(scopes: readonly string[], locale: Locale): string[] {
    return [...new Set(scopes.map((w) => plainPermission(w, locale) ?? areaWords([w], locale)))];
}

/** The bell notice: what AIMEAT narrowed, to what, and the agent's page. The node's own, not the agent's. */
export function agentNarrowedNotice(agent: AgentRecord, baseUrl: string, locale: Locale): NotifyInput {
    const page = agentPageUrl(baseUrl, agent.name);
    const link = page.slice(page.indexOf('/v1/'));
    const name = agent.displayName || agent.name;
    const scopes = agent.defaultScopes ?? [];
    return {
        type: AGENT_NARROWED_TYPE,
        title: `AIMEAT narrowed the permissions of ${name}`,
        body: `AIMEAT narrowed the permissions of ${name} to the ones it used in two weeks: ${areaWords(scopes, 'en')}. `
            + 'If it later needs something else, you get a request and can allow it with one press.',
        link,
        i18n: { key: AGENT_NARROWED_TYPE, vars: { agent: name, what: areaWords(scopes, locale) } },
        actions: [{ id: 'open', label: "Open the agent's page", kind: 'navigate', link, i18n: { key: `${AGENT_NARROWED_TYPE}.open` } }],
    };
}

function agentNarrowedEmail(agent: AgentRecord, baseUrl: string, locale: Locale) {
    const t = createT(locale);
    const page = agentPageUrl(baseUrl, agent.name);
    const vars = { agent: agent.displayName || agent.name };
    const subject = t('agentNarrowed.email.subject', vars);
    const lead = t('agentNarrowed.email.lead', vars);
    const lines = permissionLines(agent.defaultScopes ?? [], locale);
    const button = t('agentNarrowed.email.button');
    const after = t('agentNarrowed.email.after');
    // The subject carries the agent's display name: text, never HTML, in the heading as in the body
    // (secaudit2026oct26).
    const html = wrapHtml(esc(subject), `
    <p>${esc(lead)}</p>
    <ul>${lines.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
    <p>${esc(after)}</p>
    <p style="text-align: center;"><a href="${esc(page)}" class="btn">${esc(button)}</a></p>
    <p class="url-fallback">${esc(page)}</p>
  `, locale);
    const text = [subject, '', lead, '', ...lines.map((s) => `- ${s}`), '', after, '', `${button}: ${page}`].join('\n');
    return { subject, html, text };
}

/**
 * Tell the owner once that the node narrowed `agent` (its record already holds the new list): the
 * bell before the task decision goes on, the email after it, so a slow mail server never delays a
 * task. Never throws: the narrowing already stands.
 */
export async function tellOwnerNarrowed(deps: StartFactsDeps, ownerGhii: string, agent: AgentRecord): Promise<void> {
    try {
        const ghii = await deps.storage.getGHII(ownerGhii);
        await notify(deps.storage, ownerGhii, agentNarrowedNotice(agent, deps.config.baseUrl, toLocale(ghii?.locale)));
    } catch (err) {
        logger.warn('scope-auto-narrow: the bell notice could not be written; the narrowing still stands', {
            owner: ownerGhii, agent: agent.gaii, error: String(err),
        });
    }
    void mailOwnerNarrowed(deps, ownerGhii, agent);
}

/**
 * The same news by email: only to a verified notification address, only while the Email page's
 * switch `email.agentNarrowed` is on, and logged in the mail log as `agent_narrowed`. Never throws.
 */
export async function mailOwnerNarrowed(deps: StartFactsDeps, ownerGhii: string, agent: AgentRecord): Promise<void> {
    try {
        const email = getActiveEmailService();
        if (!email?.enabled) return;
        const ghii = await deps.storage.getGHII(ownerGhii);
        if (!ghii?.notificationEmail || !ghii.emailVerifiedAt) return;
        const prefs = await readNotificationSettings(deps.storage, ownerGhii);
        if (prefs.email.agentNarrowed === false) return;
        const mail = agentNarrowedEmail(agent, deps.config.baseUrl, toLocale(ghii.locale));
        const sent = await email.sendRaw(ghii.notificationEmail, mail.subject, mail.html, mail.text);
        if (sent) await appendMailLog(deps.storage, ownerGhii, { kind: 'agent_narrowed', subject: mail.subject });
    } catch (err) {
        logger.warn('scope-auto-narrow: the email could not be sent; the narrowing still stands', {
            owner: ownerGhii, agent: agent.gaii, error: String(err),
        });
    }
}

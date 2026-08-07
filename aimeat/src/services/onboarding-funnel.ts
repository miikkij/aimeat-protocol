/**
 * @file src/services/onboarding-funnel.ts
 * @description The MCP onboarding funnel made observable (UX-remake v3, P3). The connector step
 *   happens inside the user's AI tool where this node cannot see it, so the node records the two
 *   ends it CAN see — the hello page being opened, and the first MCP session actually arriving —
 *   and runs one rescue: an account that is a day old with no MCP call yet gets a single email
 *   with the direct link and the tier checklist (the page itself names tier limits as the most
 *   common failure). Markers are memory records in the owner's GHII namespace (memory-contracts:
 *   extend the memory system, not the schema), so the funnel is queryable without a new table
 *   and visible to the owner in their own Memory tab.
 * @structure
 *   - FIRST_MCP_CALL_KEY / HELLO_PAGE_OPENED_KEY / ACTIVATED_KEY / MCP_RESCUE_SENT_KEY: marker keys
 *   - recordFirstMcpCall() / recordHelloPageOpened() / recordActivation(): write-once markers
 *   - readOnboardingFunnel(): the operator view's rows (activation, TTFV, rescue)
 *   - runMcpOnboardingRescueJob(): the scheduled rescue pass (core handler 'mcp-onboarding-rescue')
 * @usage
 *   import { recordFirstMcpCall } from '../services/onboarding-funnel.js';
 *   void recordFirstMcpCall(storage, config, owner, platform);   // fire-and-forget at MCP init
 * @version-history
 *   v1.1.0 — 2026-08-07 — Activation marker + readOnboardingFunnel(): the account's first durable
 *     own output (app / workspace / agent write) as ONE event with a kind, so an activation rate
 *     and TTFV are computable (05-mittaus.md).
 *   v1.0.0 — 2026-08-07 — Initial (UX-remake v3, block 1.6).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { getActiveEmailService } from './email.js';
import { outboundEmailHtml } from './email-templates.js';
import { logger } from '../utils/logger.js';

/** Written once, when the owner's first authenticated MCP session initializes. */
export const FIRST_MCP_CALL_KEY = 'onboarding.first_mcp_call';
/** Written once, when a signed-in owner first opens the Hello MCP guidance. */
export const HELLO_PAGE_OPENED_KEY = 'onboarding.hello_page_opened';
/** Written once, when the rescue email for a silent account has been sent (or attempted). */
export const MCP_RESCUE_SENT_KEY = 'onboarding.mcp_rescue_sent';
/**
 * The ACTIVATION marker (05-mittaus.md): the first time this account produced a durable thing of
 * its own — a published app, a published workspace item, or an agent's first write. One event with
 * a `kind` dimension rather than three, so one activation rate is comparable across the personas.
 * Written once; the value records which of the three came first and when.
 */
export const ACTIVATED_KEY = 'onboarding.activated';
export type ActivationKind = 'app' | 'workspace' | 'agent';

/**
 * Accounts created before this feature existed are never rescued — a months-old account
 * suddenly getting "you have not connected your AI yet" would read as a data leak, not help.
 */
export const RESCUE_FEATURE_EPOCH = '2026-08-07T00:00:00Z';
const RESCUE_MIN_AGE_MS = 24 * 3600 * 1000;      // give the user a real day first
const RESCUE_MAX_AGE_MS = 7 * 24 * 3600 * 1000;  // after a week, one more email will not save it

const ownerGhii = (config: AimeatConfig, owner: string): string => `${owner}@${config.nodeId}`;

/** Write a marker key once; returns false when it already existed. */
async function writeMarkerOnce(
    storage: Storage, ownerGaii: string, key: string, value: Record<string, unknown>,
): Promise<boolean> {
    const existing = await storage.getMemory(ownerGaii, key);
    if (existing) return false;
    const now = new Date().toISOString();
    await storage.setMemory({
        key,
        ownerGaii,
        value,
        visibility: 'private',
        tags: ['onboarding-funnel'],
        ttlHours: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
    });
    return true;
}

// In-process de-dupe so a busy owner costs one storage read per boot, not one per session.
const seenMcpOwners = new Set<string>();
const seenHelloOwners = new Set<string>();

/**
 * Record the owner's FIRST authenticated MCP session. Called from the MCP initialize path;
 * failures are logged, never thrown — funnel bookkeeping must not break a working connection.
 */
export async function recordFirstMcpCall(
    storage: Storage, config: AimeatConfig, owner: string, client?: string,
): Promise<void> {
    if (!owner || seenMcpOwners.has(owner)) return;
    seenMcpOwners.add(owner);
    try {
        await writeMarkerOnce(storage, ownerGhii(config, owner), FIRST_MCP_CALL_KEY, {
            at: new Date().toISOString(),
            ...(client ? { client } : {}),
        });
    } catch (err) {
        seenMcpOwners.delete(owner); // let a later session retry
        logger.warn('onboarding-funnel: first_mcp_call marker failed', { owner, error: String(err) });
    }
}

/** Record that a signed-in owner opened the Hello MCP guidance. Same never-throw contract. */
export async function recordHelloPageOpened(
    storage: Storage, config: AimeatConfig, owner: string,
): Promise<void> {
    if (!owner || seenHelloOwners.has(owner)) return;
    seenHelloOwners.add(owner);
    try {
        await writeMarkerOnce(storage, ownerGhii(config, owner), HELLO_PAGE_OPENED_KEY, {
            at: new Date().toISOString(),
        });
    } catch (err) {
        seenHelloOwners.delete(owner);
        logger.warn('onboarding-funnel: hello_page_opened marker failed', { owner, error: String(err) });
    }
}

// Same in-process de-dupe for activation: after the first write this owner costs nothing.
const seenActivatedOwners = new Set<string>();

/**
 * Record the account's ACTIVATION — its first durable own output. Fire-and-forget from whichever
 * path produced the thing (app publish, workspace publish, agent write); the marker is write-once,
 * so the first caller wins and later ones are a no-op. Never throws: an activation marker must
 * never be able to fail the publish it is measuring.
 */
export async function recordActivation(
    storage: Storage, config: AimeatConfig, owner: string, kind: ActivationKind,
): Promise<void> {
    if (!owner || seenActivatedOwners.has(owner)) return;
    seenActivatedOwners.add(owner);
    try {
        await writeMarkerOnce(storage, ownerGhii(config, owner), ACTIVATED_KEY, {
            at: new Date().toISOString(),
            kind,
        });
    } catch (err) {
        seenActivatedOwners.delete(owner);
        logger.warn('onboarding-funnel: activation marker failed', { owner, kind, error: String(err) });
    }
}

/** One account's funnel state, as the operator view reads it. */
export interface FunnelRow {
    owner: string;
    ghii: string;
    createdAt: string;
    locale: string;
    helloOpenedAt: string | null;
    firstMcpCallAt: string | null;
    mcpClient: string | null;
    activatedAt: string | null;
    activationKind: ActivationKind | null;
    /** Signup → activation, in minutes. Null until activated. */
    ttfvMinutes: number | null;
    rescueSentAt: string | null;
}

/**
 * The whole funnel as rows, newest account first — the operator surface (05-mittaus.md) and the
 * only place these markers are read together. Test accounts (uxtest-*) are excluded here rather
 * than at write time, so a re-run measures itself but never pollutes the operator's numbers.
 */
export async function readOnboardingFunnel(
    storage: Storage, opts: { since?: string; limit?: number } = {},
): Promise<FunnelRow[]> {
    const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
    const sinceMs = opts.since ? Date.parse(opts.since) : NaN;
    const ghiis = (await storage.listGHIIs())
        .filter(g => !g.username.startsWith('uxtest-'))
        .filter(g => (Number.isFinite(sinceMs) ? Date.parse(g.createdAt) >= sinceMs : true))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, limit);

    const rows: FunnelRow[] = [];
    for (const g of ghiis) {
        const [hello, mcp, activated, rescue] = await Promise.all([
            storage.getMemory(g.ghii, HELLO_PAGE_OPENED_KEY),
            storage.getMemory(g.ghii, FIRST_MCP_CALL_KEY),
            storage.getMemory(g.ghii, ACTIVATED_KEY),
            storage.getMemory(g.ghii, MCP_RESCUE_SENT_KEY),
        ]);
        const val = (r: unknown): Record<string, unknown> =>
            (r && typeof (r as { value?: unknown }).value === 'object' ? (r as { value: Record<string, unknown> }).value : {});
        const activatedAt = (val(activated).at as string) ?? null;
        const created = Date.parse(g.createdAt);
        const actMs = activatedAt ? Date.parse(activatedAt) : NaN;
        rows.push({
            owner: g.ownerName,
            ghii: g.ghii,
            createdAt: g.createdAt,
            locale: g.locale === 'fi' ? 'fi' : 'en',
            helloOpenedAt: (val(hello).at as string) ?? null,
            firstMcpCallAt: (val(mcp).at as string) ?? null,
            mcpClient: (val(mcp).client as string) ?? null,
            activatedAt,
            activationKind: (val(activated).kind as ActivationKind) ?? null,
            ttfvMinutes: (Number.isFinite(created) && Number.isFinite(actMs))
                ? Math.round((actMs - created) / 60000) : null,
            rescueSentAt: (val(rescue).at as string) ?? null,
        });
    }
    return rows;
}

function rescueEmailContent(config: AimeatConfig, locale: string): { subject: string; heading: string; paragraphs: string[]; checklist: string[]; closing: string } {
    const link = `${config.baseUrl}/v1/profile?tab=mcp`;
    if (locale === 'fi') {
        return {
            subject: 'Tekoälysi ei ole vielä kytketty AIMEAT-tiliisi',
            heading: 'Kytkös puuttuu vielä',
            paragraphs: [
                'Loit tilin, mutta yhtään tekoälyä ei ole vielä kytketty siihen. Kytkös on se hetki jolloin tästä tulee hyödyllinen: sen jälkeen käytät koko systeemiä siitä chatista jota jo käytät.',
                `Ohjattu polku on täällä, ja siinä on kolme askelta joista kolmas on nappi: ${link}`,
                'Yleisimmät kaatumiskohdat, tässä järjestyksessä:',
            ],
            checklist: [
                'Ilmainen Claude-tili riittää: siihen mahtuu tasan yksi oma konnektori, ja se on tarpeeksi.',
                'ChatGPT vaatii maksullisen tason (Plus tai ylempi) ja toimii vain selaimessa.',
                'Kytkennän jälkeen aloita UUSI keskustelu. Jo auki ollut chat ei saa työkaluja.',
            ],
            closing: 'Tämä on ainoa muistutus tästä. Jos et halua kytkeä tekoälyä, voit jättää viestin huomiotta.',
        };
    }
    return {
        subject: 'Your AI is not connected to your AIMEAT account yet',
        heading: 'The connection is still missing',
        paragraphs: [
            'You created an account, but no AI is connected to it yet. The connection is the moment this becomes useful: after it, you run the whole system from the chat you already use.',
            `The guided path is here, three steps and the third one is a button: ${link}`,
            'The most common failure points, in this order:',
        ],
        checklist: [
            'A free Claude account is enough: it holds exactly one custom connector, and that is all this needs.',
            'ChatGPT requires a paid tier (Plus or higher) and works only in the browser.',
            'After connecting, start a NEW conversation. A chat that was already open does not get the tools.',
        ],
        closing: 'This is the only reminder about this. If you do not want to connect an AI, you can ignore it.',
    };
}

/**
 * The rescue pass. For each account created after the feature epoch, older than a day and
 * younger than a week, with a VERIFIED email, no MCP session seen and no rescue sent: send one
 * email and mark it sent. Runs as core handler 'mcp-onboarding-rescue'.
 */
export async function runMcpOnboardingRescueJob(
    config: AimeatConfig,
    storage: Storage,
    /** Test seam: freeze the clock and the epoch. Production callers pass nothing. */
    opts: { now?: number; epoch?: number } = {},
): Promise<void> {
    const email = getActiveEmailService();
    if (!email || !email.enabled) return;

    const epoch = opts.epoch ?? Date.parse(RESCUE_FEATURE_EPOCH);
    const now = opts.now ?? Date.now();
    const ghiis = await storage.listGHIIs();
    let sent = 0;

    for (const g of ghiis) {
        // Verified email only: notificationEmail alone can be someone else's unverified address,
        // and mailing it would let a registration spam an arbitrary inbox.
        if (!g.notificationEmail || g.verificationLevel < 1) continue;
        if (g.username.startsWith('uxtest-')) continue; // measurement test accounts stay out of funnels
        const created = Date.parse(g.createdAt);
        if (!Number.isFinite(created) || created < epoch) continue;
        const age = now - created;
        if (age < RESCUE_MIN_AGE_MS || age > RESCUE_MAX_AGE_MS) continue;

        if (await storage.getMemory(g.ghii, MCP_RESCUE_SENT_KEY)) continue;
        if (await storage.getMemory(g.ghii, FIRST_MCP_CALL_KEY)) continue;

        const locale = g.locale === 'fi' ? 'fi' : 'en';
        const c = rescueEmailContent(config, locale);
        const bodyHtml = c.paragraphs.map(p => `<p>${p}</p>`).join('')
            + `<ul>${c.checklist.map(i => `<li>${i}</li>`).join('')}</ul>`
            + `<p>${c.closing}</p>`;
        const textBody = [...c.paragraphs, ...c.checklist.map(i => `- ${i}`), '', c.closing].join('\n');
        const { html, text } = outboundEmailHtml(c.heading, bodyHtml, textBody, locale);

        const ok = await email.sendRaw(g.notificationEmail, c.subject, html, text).catch(err => {
            logger.warn('onboarding-funnel: rescue email send failed', { owner: g.ownerName, error: String(err) });
            return false;
        });
        // Marked sent even on a failed attempt: this email must never become a retry loop
        // against an address that bounces.
        await writeMarkerOnce(storage, g.ghii, MCP_RESCUE_SENT_KEY, {
            at: new Date().toISOString(),
            delivered: ok,
        });
        if (ok) sent++;
    }

    if (sent > 0) logger.info(`MCP onboarding rescue: sent ${sent} email(s)`);
}

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
 *   - ONBOARDING_KEYS: every remake event key, in ONE place (05-mittaus.md) — nothing that writes
 *     a funnel marker spells a key literal of its own
 *   - recordFirstMcpCall() / recordHelloPageOpened() / recordActivation(): write-once markers
 *   - recordTrack() / recordTrackSwitch(): which path the account was created on, and how many
 *     times it flipped. The switch NEVER rewrites `track` — see the note on recordTrackSwitch.
 *   - recordOnboardingEvent(): the generic write-once marker every remake phase writes through
 *   - recordWelcomeMatPasted(): the ONE deliberately non-write-once marker (attempts accumulate)
 *   - readOnboardingFunnel(): the operator view's rows (activation, TTFV, rescue, remake events)
 *   - runMcpOnboardingRescueJob(): the scheduled rescue pass (core handler 'mcp-onboarding-rescue')
 * @usage
 *   import { recordFirstMcpCall } from '../services/onboarding-funnel.js';
 *   void recordFirstMcpCall(storage, config, owner, platform);   // fire-and-forget at MCP init
 * @version-history
 *   v1.2.0 — 2026-08-07 — REMAKE phase 0: onboarding.track (legacy|remake + switched) written at
 *     account creation, the six remake event keys + the agent-door pair collected into
 *     ONBOARDING_KEYS, generic write-once + attempts-accumulating writers, and readOnboardingFunnel
 *     rewritten onto ONE listMemoryForOwners query (was 4 getMemory per account) now that it reads
 *     eleven markers instead of four.
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
 * EVERY remake funnel key, in one place (05-mittaus.md). Nothing outside this module spells one of
 * these strings: a key typed twice is a marker that silently stops being counted the day one of
 * the two is edited, and a funnel that undercounts reads as a product that does not work.
 */
export const ONBOARDING_KEYS = {
    /** Which path the account was created on. Written ONCE at account creation. */
    track: 'onboarding.track',
    /** The welcome mat paste. The ONE non-write-once marker: attempts accumulate. */
    welcomeMatPasted: 'onboarding.welcome_mat_pasted',
    /** What the model claimed about itself, or what the person answered when asked. */
    aiModelDetected: 'onboarding.ai_model_detected',
    /** A = MCP-capable client, B = needs a better one first, agent = the front-page agent door. */
    branchTaken: 'onboarding.branch_taken',
    firstAgentConnected: 'onboarding.first_agent_connected',
    homeInitialized: 'onboarding.home_initialized',
    /** The FIRST of the four rooms entered. Later ones do not overwrite it. */
    roomEntered: 'onboarding.room_entered',
    /** Agent door (12-ai-rekisteroi.md): the POST landed and the mail went out. */
    inviteSentByAgent: 'onboarding.invite_sent_by_agent',
    inviteCompleted: 'onboarding.invite_completed',
    /** Durable mark on the account: an agent started this, with which model. */
    startedByAgent: 'onboarding.started_by_agent',
    agentDoorStarted: 'onboarding.agent_door_started',
    agentDoorResult: 'onboarding.agent_door_result',
} as const;

/** Which onboarding path an account was created on. Cohorts are meaningless without it. */
export type OnboardingTrack = 'legacy' | 'remake';
export type OnboardingBranch = 'A' | 'B' | 'agent';
export type OnboardingRoom = 'create' | 'organise' | 'monetise' | 'company';
/** K3: new accounts land on the remake; existing ones stay legacy until they switch themselves. */
export const DEFAULT_TRACK: OnboardingTrack = 'remake';

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

/**
 * Record which path this account was created on. Called from BOTH account-creation routes
 * (POST /v1/ghii and POST /v1/owners) so no door leaves an account without a track — an untracked
 * account is invisible to one half of the funnel and inflates neither, which is worse than either.
 * Write-once: re-registration in dev/test mode must not relabel an existing cohort.
 */
export async function recordTrack(
    storage: Storage, config: AimeatConfig, owner: string, track: OnboardingTrack = DEFAULT_TRACK,
): Promise<void> {
    if (!owner) return;
    try {
        await writeMarkerOnce(storage, ownerGhii(config, owner), ONBOARDING_KEYS.track, {
            track, at: new Date().toISOString(), switched: 0,
        });
    } catch (err) {
        logger.warn('onboarding-funnel: track marker failed', { owner, track, error: String(err) });
    }
}

/**
 * The switch between the new home and the old profile. Increments `switched` and leaves `track`
 * exactly as it was: rewriting it would move the account between cohorts every time the person
 * flipped, and a cohort whose membership changes under you measures nothing. The counter is
 * itself a result — remake-created accounts switching away is the signal the remake failed.
 */
export async function recordTrackSwitch(
    storage: Storage, config: AimeatConfig, owner: string,
): Promise<number> {
    if (!owner) return 0;
    const gaii = ownerGhii(config, owner);
    const existing = await storage.getMemory(gaii, ONBOARDING_KEYS.track);
    const prev = (existing?.value ?? {}) as { track?: OnboardingTrack; at?: string; switched?: number };
    const switched = (typeof prev.switched === 'number' ? prev.switched : 0) + 1;
    const now = new Date().toISOString();
    await storage.setMemory({
        key: ONBOARDING_KEYS.track,
        ownerGaii: gaii,
        // An account that somehow has no track yet is legacy by construction: it was created before
        // the marker existed. Guessing `remake` here would fabricate a cohort member.
        value: { track: prev.track ?? 'legacy', at: prev.at ?? now, switched },
        visibility: 'private',
        tags: ['onboarding-funnel'],
        ttlHours: null,
        version: existing ? existing.version + 1 : 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    });
    return switched;
}

/** Read an account's track (and switch count). Absent marker = an account older than the feature. */
export async function readTrack(
    storage: Storage, config: AimeatConfig, owner: string,
): Promise<{ track: OnboardingTrack; switched: number }> {
    const rec = await storage.getMemory(ownerGhii(config, owner), ONBOARDING_KEYS.track);
    const v = (rec?.value ?? {}) as { track?: OnboardingTrack; switched?: number };
    return { track: v.track === 'remake' ? 'remake' : 'legacy', switched: typeof v.switched === 'number' ? v.switched : 0 };
}

/**
 * The generic write-once remake marker. Every phase writes through this rather than reaching for
 * storage directly, so all of them share the same never-throw contract: funnel bookkeeping must
 * never be able to fail the thing it is measuring. Returns whether this call was the one that wrote.
 */
export async function recordOnboardingEvent(
    storage: Storage, config: AimeatConfig, owner: string,
    key: typeof ONBOARDING_KEYS[keyof typeof ONBOARDING_KEYS],
    value: Record<string, unknown>,
): Promise<boolean> {
    if (!owner) return false;
    try {
        return await writeMarkerOnce(storage, ownerGhii(config, owner), key, {
            at: new Date().toISOString(), ...value,
        });
    } catch (err) {
        logger.warn('onboarding-funnel: marker failed', { owner, key, error: String(err) });
        return false;
    }
}

/** What we know about the person's AI, and how we came to know it. */
export interface AiDetection {
    model: string | null;
    vendor: string | null;
    client: string | null;
    mcp: 'yes' | 'no' | 'unknown';
    /** 'meta' = read off the pasted page; 'asked' = the person answered. */
    source: 'meta' | 'asked';
    /** An app name that matched nothing — the list the alias map grows from. */
    unknownClient?: string | null;
    resolvedClient?: string | null;
    /**
     * The person's answer to the paid-tier question, when their app needs one. Kept because the
     * live "are they still blocked?" question has to be RECOMPUTED from what is known, and without
     * this the recomputation would re-ask a question they already answered.
     */
    hasPaidPlan?: boolean | null;
    /**
     * A FRESH welcome mat, which replaces the record outright rather than deferring to whatever
     * was there. See the ordering note on recordAiModelDetected.
     */
    supersedes?: boolean;
}

/**
 * Record what the person's AI is. One record, not an append log — but NOT plain write-once,
 * because the two sources are not equal evidence.
 *
 * A model's claim about its own app is unreliable by nature (04-mcp-kyvykkyys.md); the person's
 * own answer is not. So an `asked` reading replaces a `meta` one, and nothing replaces an `asked`
 * one. Under strict write-once the `source` field would be decoration: the page's guess would be
 * frozen in the funnel even after the person corrected it, and every later read would be of the
 * less reliable of the two answers we had.
 */
export async function recordAiModelDetected(
    storage: Storage, config: AimeatConfig, owner: string, detection: AiDetection,
): Promise<void> {
    if (!owner) return;
    const gaii = ownerGhii(config, owner);
    try {
        const existing = await storage.getMemory(gaii, ONBOARDING_KEYS.aiModelDetected);
        const prev = (existing?.value ?? null) as { source?: string } | null;
        // Ordering, weakest to strongest: a page's claim < the person's answer ABOUT that page <
        // a NEW page. A fresh mat supersedes everything, because it is a new artifact made in a
        // different app — this is the whole mechanism of branch B, where someone takes up an app
        // that can connect and pastes a new mat. Without it, the stale "no, I have no paid tier"
        // answer would outlive the app it was about and hold them on the branch-B screen forever.
        if (prev && !detection.supersedes && !(detection.source === 'asked' && prev.source !== 'asked')) return;
        const now = new Date().toISOString();
        await storage.setMemory({
            key: ONBOARDING_KEYS.aiModelDetected,
            ownerGaii: gaii,
            value: {
                model: detection.model, vendor: detection.vendor, client: detection.client,
                mcp: detection.mcp, source: detection.source, at: now,
                ...(detection.unknownClient ? { unknown_client: detection.unknownClient } : {}),
                ...(detection.resolvedClient ? { resolved_client: detection.resolvedClient } : {}),
                ...(typeof detection.hasPaidPlan === 'boolean' ? { has_paid_plan: detection.hasPaidPlan } : {}),
                // What the page said, kept when the person's answer supersedes it — the gap
                // between the two IS the measure of how much a model's self-report is worth.
                ...(prev ? { superseded: prev } : {}),
            },
            visibility: 'private',
            tags: ['onboarding-funnel'],
            ttlHours: null,
            version: existing ? existing.version + 1 : 1,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        });
    } catch (err) {
        logger.warn('onboarding-funnel: ai_model_detected marker failed', { owner, error: String(err) });
    }
}

/**
 * The welcome-mat paste — the one marker that is NOT write-once. `attempts` accumulates because
 * how many tries the mat took is the direct measure of the prompt's quality (03-welcome-mat.md),
 * and a write-once marker would report every account as a first-try success. `result` holds the
 * LATEST outcome, so ok-after-three-failures reads as ok with attempts=4.
 * There is no `skipped` value and no caller that could produce one: the mat cannot be skipped.
 */
export async function recordWelcomeMatPasted(
    storage: Storage, config: AimeatConfig, owner: string, result: 'ok' | 'failed',
): Promise<{ attempts: number }> {
    const gaii = ownerGhii(config, owner);
    const existing = await storage.getMemory(gaii, ONBOARDING_KEYS.welcomeMatPasted);
    const prev = (existing?.value ?? {}) as { attempts?: number };
    const attempts = (typeof prev.attempts === 'number' ? prev.attempts : 0) + 1;
    const now = new Date().toISOString();
    await storage.setMemory({
        key: ONBOARDING_KEYS.welcomeMatPasted,
        ownerGaii: gaii,
        // The mat's CONTENT never enters telemetry (05-mittaus.md): the page is the person's own.
        value: { result, attempts, at: now },
        visibility: 'private',
        tags: ['onboarding-funnel'],
        ttlHours: null,
        version: existing ? existing.version + 1 : 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    });
    return { attempts };
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
    // ── remake (05-mittaus.md) ──
    /** Which path the account was created on. `legacy` also covers pre-feature accounts. */
    track: OnboardingTrack;
    /** How many times the person flipped between the two. Never changes `track`. */
    switched: number;
    matResult: 'ok' | 'failed' | null;
    matAttempts: number;
    /** The model's own claim about itself — unreliable by nature, kept for exactly that reason. */
    aiModel: string | null;
    /** The deciding field: MCP is a property of the CLIENT APP, not the model. */
    aiClient: string | null;
    aiMcp: 'yes' | 'no' | 'unknown' | null;
    /** 'meta' = read off the page; 'asked' = the person answered. 'asked' is the trustworthy one. */
    aiSource: 'meta' | 'asked' | null;
    branch: OnboardingBranch | null;
    firstAgentConnectedAt: string | null;
    homeInitializedAt: string | null;
    /** The FIRST room entered — which of the four the person wanted, not where they ended up. */
    room: OnboardingRoom | null;
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
        // The shared anonymous-mode identity is the node's own, not a person who signed up. It has
        // no track marker, so once cohorts are split by track it renders as a phantom "1 legacy
        // account created this week" — a number an operator would try to explain.
        .filter(g => g.username !== 'anonymous')
        .filter(g => (Number.isFinite(sinceMs) ? Date.parse(g.createdAt) >= sinceMs : true))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, limit);

    // ONE query for every account's every onboarding.* marker. The per-account Promise.all this
    // replaces cost 4 round trips each; the remake reads eleven, which at 200 accounts would have
    // been 2200 lookups to render one operator table.
    const all = await storage.listMemoryForOwners(ghiis.map(g => g.ghii), { prefix: 'onboarding.' });
    const byGhii = new Map<string, Map<string, Record<string, unknown>>>();
    for (const m of all) {
        const forOwner = byGhii.get(m.ownerGaii) ?? new Map<string, Record<string, unknown>>();
        forOwner.set(m.key, (m.value && typeof m.value === 'object' ? m.value : {}) as Record<string, unknown>);
        byGhii.set(m.ownerGaii, forOwner);
    }

    const rows: FunnelRow[] = [];
    for (const g of ghiis) {
        const marks = byGhii.get(g.ghii) ?? new Map<string, Record<string, unknown>>();
        const val = (key: string): Record<string, unknown> => marks.get(key) ?? {};
        const str = (key: string, field: string): string | null => {
            const v = val(key)[field];
            return typeof v === 'string' ? v : null;
        };
        const activatedAt = str(ACTIVATED_KEY, 'at');
        const created = Date.parse(g.createdAt);
        const actMs = activatedAt ? Date.parse(activatedAt) : NaN;
        const track = val(ONBOARDING_KEYS.track);
        const mat = val(ONBOARDING_KEYS.welcomeMatPasted);
        rows.push({
            owner: g.ownerName,
            ghii: g.ghii,
            createdAt: g.createdAt,
            locale: g.locale === 'fi' ? 'fi' : 'en',
            helloOpenedAt: str(HELLO_PAGE_OPENED_KEY, 'at'),
            firstMcpCallAt: str(FIRST_MCP_CALL_KEY, 'at'),
            mcpClient: str(FIRST_MCP_CALL_KEY, 'client'),
            activatedAt,
            activationKind: (val(ACTIVATED_KEY).kind as ActivationKind) ?? null,
            ttfvMinutes: (Number.isFinite(created) && Number.isFinite(actMs))
                ? Math.round((actMs - created) / 60000) : null,
            rescueSentAt: str(MCP_RESCUE_SENT_KEY, 'at'),
            // An account with no track marker pre-dates the feature, so it is legacy by construction.
            track: track.track === 'remake' ? 'remake' : 'legacy',
            switched: typeof track.switched === 'number' ? track.switched : 0,
            matResult: mat.result === 'ok' ? 'ok' : mat.result === 'failed' ? 'failed' : null,
            matAttempts: typeof mat.attempts === 'number' ? mat.attempts : 0,
            aiModel: str(ONBOARDING_KEYS.aiModelDetected, 'model'),
            aiClient: str(ONBOARDING_KEYS.aiModelDetected, 'client'),
            aiMcp: (val(ONBOARDING_KEYS.aiModelDetected).mcp as FunnelRow['aiMcp']) ?? null,
            aiSource: (val(ONBOARDING_KEYS.aiModelDetected).source as FunnelRow['aiSource']) ?? null,
            branch: (val(ONBOARDING_KEYS.branchTaken).branch as OnboardingBranch) ?? null,
            firstAgentConnectedAt: str(ONBOARDING_KEYS.firstAgentConnected, 'at'),
            homeInitializedAt: str(ONBOARDING_KEYS.homeInitialized, 'at'),
            room: (val(ONBOARDING_KEYS.roomEntered).room as OnboardingRoom) ?? null,
        });
    }
    return rows;
}

/**
 * The return message (06-koti-feed-suostumus.md). ONE message, never a series: a second reminder
 * about the same thing is already spam, and an empty reminder teaches people to ignore the sender.
 *
 * `step` is where the person actually stopped, so the message continues from there instead of
 * restarting them. A remake account gets the home; a legacy one keeps the wording it had, because
 * its screens are the ones it will actually see.
 */
function rescueEmailContent(
    config: AimeatConfig, locale: string, step: 'welcome-mat' | 'better-app' | 'first-agent' | null,
): { subject: string; heading: string; paragraphs: string[]; checklist: string[]; closing: string } {
    const link = `${config.baseUrl}/v1/profile?tab=mcp`;

    // ── The remake path: continue from the step they stopped on, and link straight to it. ──
    if (step) {
        const home = `${config.baseUrl}/v1/home`;
        if (locale === 'fi') {
            const byStep: Record<string, { subject: string; heading: string; body: string }> = {
                'welcome-mat': {
                    subject: 'Kotisi odottaa tervetuloamattoa',
                    heading: 'Yksi asia kesken',
                    body: 'Aloitit kodin tekemisen mutta tervetuloamatto jäi tekemättä. Se on se yksi kehote jonka viet omaan tekoälychattiisi ja liität vastauksen takaisin. Sen jälkeen sinulla on oikea sivu omalla osoitteellaan.',
                },
                'better-app': {
                    subject: 'Kotisi odottaa sovellusta joka osaa avata yhteyden',
                    heading: 'Yksi asia kesken',
                    body: 'Tervetuloamattosi on valmis. Seuraava askel tarvitsee tekoälysovelluksen joka osaa avata yhteyden kotiisi — lista tarkistetuista sovelluksista odottaa sinua kotona.',
                },
                'first-agent': {
                    subject: 'Kotisi odottaa ensimmäistä agenttiasi',
                    heading: 'Yksi asia kesken',
                    body: 'Tervetuloamattosi on paikallaan. Jäljellä on enää yksi asia: kytke tekoälysi agentiksi kotiisi, niin se pääsee lukemaan ja kirjoittamaan asioita puolestasi.',
                },
            };
            const c = byStep[step];
            return {
                subject: c.subject,
                heading: c.heading,
                paragraphs: [c.body, `Jatka siitä mihin jäit: ${home}`],
                checklist: [],
                closing: 'Tämä on ainoa muistutus tästä.',
            };
        }
        const byStep: Record<string, { subject: string; heading: string; body: string }> = {
            'welcome-mat': {
                subject: 'Your home is waiting for its welcome mat',
                heading: 'One thing left',
                body: 'You started making a home and the welcome mat is still to do. It is one prompt you take to your own AI chat, and you paste the answer back. After that you have a real page with its own address.',
            },
            'better-app': {
                subject: 'Your home is waiting for an app that can connect',
                heading: 'One thing left',
                body: 'Your welcome mat is done. The next step needs an AI app that can open a connection to your home — the checked list is waiting for you there.',
            },
            'first-agent': {
                subject: 'Your home is waiting for your first agent',
                heading: 'One thing left',
                body: 'Your welcome mat is up. There is one thing left: connect your AI as an agent to your home, so it can read and write things for you.',
            },
        };
        const c = byStep[step];
        return {
            subject: c.subject,
            heading: c.heading,
            paragraphs: [c.body, `Carry on where you left off: ${home}`],
            checklist: [],
            closing: 'This is the only reminder about this.',
        };
    }

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
        // A remake account gets the message that continues its actual step; a legacy one keeps the
        // wording written for the screens it will actually see.
        const trackVal = (await storage.getMemory(g.ghii, ONBOARDING_KEYS.track))?.value as { track?: string } | undefined;
        let step: 'welcome-mat' | 'better-app' | 'first-agent' | null = null;
        if (trackVal?.track === 'remake') {
            const { readHomeState } = await import('./home-state.js');
            const st = await readHomeState(storage, config, g.ownerName);
            // An initialized home needs no reminder at all — skip it entirely.
            if (st.initialized) continue;
            step = st.step;
        }
        const c = rescueEmailContent(config, locale, step);
        const bodyHtml = c.paragraphs.map(p => `<p>${p}</p>`).join('')
            + (c.checklist.length ? `<ul>${c.checklist.map(i => `<li>${i}</li>`).join('')}</ul>` : '')
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

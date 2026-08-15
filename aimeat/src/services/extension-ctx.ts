/**
 * @file src/services/extension-ctx.ts
 * @description The ONE builder for the sandbox capability object. Every road into
 *   `executeExtensionAction` gets its `ExtensionCtx` from here, so the guards are part of the
 *   context rather than something each caller has to remember.
 *
 *   Why this file exists: the context used to be assembled by hand at four call sites, and each copy
 *   forgot something different. The REST door enforced the memory quota, the scheduler did not (the
 *   June H-5 fix landed on two of the three write paths). Three of four used safeFetch, the scheduler
 *   used a bare fetch, so a scheduled extension had no SSRF guard at all. The identical
 *   `emailPolicy === 'unrestricted'` branch was typed out three times. Five findings in the August
 *   2026 audit are one missing line in one of those copies, which is what a shared implementation
 *   with per-caller guards always produces eventually.
 *
 *   The split: the CORE (memory, fetch, log) is built here and always carries its guards. The
 *   OPTIONAL capabilities (files, notify, email, buy, wallet, consent, trust) are passed in, because
 *   what a road can offer genuinely differs — a scheduled run has no caller to notify, an MCP call
 *   has no HTTP response to write a paywall refusal into. A capability the caller cannot offer is
 *   simply absent, and the guest sees `undefined`, which is the contract ExtensionCtx already had.
 * @structure
 *   - ExtensionCtxDeps — what a caller must supply, and what it may
 *   - buildExtensionCtx() — the core with guards applied, merged with the optional parts
 *   - decodeBody() — the shared charset detection the three copies each had their own version of
 * @usage
 *   const ctx = buildExtensionCtx({ config, storage, extMemoryOwner, caller, extConfig, log, files });
 *   await executeExtensionAction(script, ctx, …);
 * @version-history
 *   v1.1.0 — 2026-08-11 — sandboxLimits(): the memory/timeout/API-call arithmetic, which both doors
 *     had written out themselves. The MCP copy used max(declared, cap), turning the node ceiling
 *     into a floor.
 *   v1.0.0 — 2026-08-10 — Initial (August 2026 audit step 4: one sandbox context, one set of guards).
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { ExtensionCtx } from './extension-runtime.js';
import type { EmailService } from './email.js';
import { enforceExtensionMemoryLimits } from './quota.js';
import { extensionCrossNotify, safeNotificationLink } from './extension-notify.js';
import { notify } from './notify.js';
import { safeFetch } from '../utils/url-validator.js';
import { parseGAII } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';

/** How long one guest-initiated outbound call may take. Same ceiling every copy used. */
const FETCH_TIMEOUT_MS = 30_000;

export interface ExtensionCtxDeps {
    config: AimeatConfig;
    storage: Storage;
    /** The namespace this extension's memory lives in: `ext:{name}` or `ext:{name}.{instanceId}`. */
    extMemoryOwner: string;
    /** Who invoked this action. A scheduled run passes the owner as its own caller. */
    caller: ExtensionCtx['caller'];
    /** The extension's manifest config, secrets already decrypted by the caller. */
    extConfig: Record<string, unknown>;
    /** Instance id + its config, when the action runs against a named instance. */
    instance?: ExtensionCtx['instance'];
    /** Prefix for the sandbox's log lines, so a scheduled run is distinguishable from a request. */
    logPrefix: string;

    // ── Optional capabilities: present only on the roads that can honestly offer them ──
    wallet?: ExtensionCtx['wallet'];
    files?: ExtensionCtx['files'];
    datapackage?: ExtensionCtx['datapackage'];
    buy?: ExtensionCtx['buy'];
    notify?: ExtensionCtx['notify'];
    email?: ExtensionCtx['email'];
}

/** Does the buffer contain a well-formed UTF-8 multibyte sequence? Used to overrule a charset label
 *  that says otherwise, which is what a CDN doing its own transcoding leaves behind. */
function looksLikeUtf8(buf: ArrayBuffer): boolean {
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length - 1; i++) {
        if (bytes[i] >= 0xC2 && bytes[i] <= 0xDF && (bytes[i + 1] & 0xC0) === 0x80) return true;
        if (bytes[i] >= 0xE0 && bytes[i] <= 0xEF && i + 2 < bytes.length &&
            (bytes[i + 1] & 0xC0) === 0x80 && (bytes[i + 2] & 0xC0) === 0x80) return true;
    }
    return false;
}

/**
 * Read a response body as text, honouring the charset from the header or the document prolog.
 * Extracted because each hand-built context carried its own copy and they had drifted: three had
 * the mislabelled-encoding guard below and the MCP one did not, so the same feed that reads
 * correctly over REST came back as mojibake through a tool call.
 *
 * TWO MODES, AND THE DEFAULT DOES NOT CHANGE. An extension reading a source feed wants the bytes it
 * can get: a document declaring an encoding nobody has heard of is that document's problem, not a
 * reason to fail the call, so the default falls back to UTF-8 with a warning. That is the right
 * choice for a reader and the WRONG one for a PRODUCER — a data package built from a body that was
 * decoded with a guessed codec is a version with mojibake in it, published at a permanent address,
 * hashed, and indistinguishable from a good one until somebody reads the rows. So `strictCharset`
 * makes an undecodable charset a thrown error, which on the unattended roads is a failed run that
 * leaves the previous version standing. An extension that produces packages opts in with
 * `config: { strictCharset: true }` in its manifest.
 */
async function decodeBody(
    resp: { arrayBuffer(): Promise<ArrayBuffer>; headers: Headers },
    strictCharset = false,
): Promise<string> {
    const buf = await resp.arrayBuffer();
    const ct = resp.headers.get('content-type') || '';
    let charset = (/charset=([^\s;]+)/i.exec(ct)?.[1] ?? '').toLowerCase();
    if (!charset) {
        const peek = new TextDecoder('ascii').decode(buf.slice(0, 512));
        const xml = /encoding=['"]([^'"]+)['"]/i.exec(peek)?.[1];
        const meta = /<meta[^>]+charset=["']?([^\s"';>]+)/i.exec(peek)?.[1];
        charset = (xml || meta || 'utf-8').toLowerCase();
    }
    // A document that declares latin-1 but carries valid UTF-8 bytes is mislabelled, not latin-1.
    if (charset !== 'utf-8' && charset !== 'utf8' && looksLikeUtf8(buf)) charset = 'utf-8';
    try {
        return new TextDecoder(charset === 'utf8' ? 'utf-8' : charset).decode(buf);
    } catch {
        if (strictCharset) {
            // A producer's road. Decoding with a codec we had to guess would publish a version whose
            // text is wrong, at a permanent address, with a content hash that makes it look
            // deliberate. Better a failed run: the package stays on its last good version and the
            // owner is told which charset nobody could read.
            throw new Error(
                `CHARSET_UNDECODABLE: the response declares charset "${charset}", which this node cannot decode. `
                + 'Refusing rather than guessing, because a guessed decode becomes a published version nobody can tell '
                + 'apart from a good one. Ask the source for UTF-8, or drop strictCharset if this feed is not a package source.');
        }
        // An unknown label is the document's problem, not a reason to fail the call: fall back to
        // utf-8 and let the extension see the bytes it can.
        logger.warn('extension ctx: unknown charset, decoding as utf-8', { charset });
        return new TextDecoder('utf-8').decode(buf);
    }
}

/**
 * The wallet a sandboxed script may spend from: the caller's own balance and nobody else's.
 *
 * Two guards, and the MCP copy had neither of them at full strength: a non-positive or non-finite
 * amount is refused (a negative one would MINT morsels rather than spend them), and a single call
 * cannot exceed `extensionMaxDebitPerCall`. The HTTP door capped the per-call debit and the MCP door
 * did not, so the same script spending through a tool call had no ceiling at all.
 *
 * hold, release and transfer are deliberately absent: an extension moves its caller's money forward,
 * never anyone else's, and never in a way that outlives the call.
 */
export function buildExtensionWallet(deps: {
    config: AimeatConfig;
    storage: Storage;
    /** Whose balance is spent. Always the caller, never the extension's installer. */
    callerGaii: string;
    extName: string;
    /** Appended to the tracking code, so an instance-scoped spend is attributable to its instance. */
    trackingScope?: string;
}): NonNullable<ExtensionCtx['wallet']> {
    const { config, storage, callerGaii, extName, trackingScope } = deps;
    const prefix = trackingScope ? `ext:${extName}:${trackingScope}` : `ext:${extName}`;
    return {
        consume: async (amount: number, reason: string) => {
            if (!Number.isFinite(amount) || amount <= 0) {
                throw new Error('INVALID_AMOUNT: consume amount must be a positive number');
            }
            if (amount > config.extensionMaxDebitPerCall) {
                throw new Error(`DEBIT_LIMIT: max ${config.extensionMaxDebitPerCall} morsels per call`);
            }
            const debited = await storage.debitBalance(callerGaii, amount);
            if (!debited) return { success: false, error: 'Insufficient balance' };
            await storage.addTransaction({
                id: `ext-tx-${randomUUID()}`,
                gaii: callerGaii,
                type: 'extension_consume',
                amount: -amount,
                trackingCode: `${prefix}:${reason}`,
                timestamp: new Date().toISOString(),
            });
            return { success: true };
        },
        getBalance: async () => {
            const parsed = parseGAII(callerGaii);
            if (!parsed) return 0;
            const ghii = await storage.getGHIIByOwner(parsed.owner);
            return ghii?.morselBalance ?? 0;
        },
    };
}

/**
 * The owner-facing notification capability: a record in the recipient's own `notifications.{owner}`
 * key, plus the header bell and web push. `opts.to` hands off to the cross-owner path, which has its
 * own consent check.
 *
 * The recipient differs by road and that difference is real: a request notifies its caller, a
 * scheduled run notifies whoever installed the extension, because there is nobody else present.
 */
export function buildExtensionNotify(deps: {
    storage: Storage;
    config: AimeatConfig;
    extName: string;
    /** Namespace the notification list is stored under. */
    recipientGaii: string;
    /** Bare owner name, used for the key suffix and the GHII the bell belongs to. */
    recipientOwner: string;
}): NonNullable<ExtensionCtx['notify']> {
    const { storage, config, extName, recipientGaii, recipientOwner } = deps;
    return async (message, opts?: { title?: string; priority?: string; channel?: string; to?: string; link?: string }) => {
        if (opts?.to) return extensionCrossNotify(storage, config, extName, opts.to, message, opts);

        const key = `notifications.${recipientOwner}`;
        const existing = await storage.getMemory(recipientGaii, key);
        const list = Array.isArray(existing?.value) ? (existing.value as unknown[]) : [];
        list.push({
            id: randomUUID(),
            message,
            title: opts?.title || extName,
            priority: opts?.priority || 'normal',
            channel: opts?.channel || 'extension',
            source: extName,
            read: false,
            createdAt: new Date().toISOString(),
        });
        const now = new Date().toISOString();
        await storage.setMemory({
            key, ownerGaii: recipientGaii, value: list.slice(-100),
            visibility: 'private', tags: ['notifications'], ttlHours: null,
            version: (existing?.version || 0) + 1,
            createdAt: existing?.createdAt || now, updatedAt: now,
        });

        // Surface it where the owner actually looks. safeNotificationLink keeps a guest-supplied
        // link on this node: the scheduler copy sidestepped that by ignoring opts.link entirely,
        // which was safe but meant a scheduled notification could not deep-link anywhere.
        const recipientGhii = recipientOwner.includes('@') ? recipientOwner : `${recipientOwner}@${config.nodeId}`;
        void notify(storage, recipientGhii, {
            type: 'extension', title: opts?.title || extName, body: message,
            link: safeNotificationLink(config, opts?.link, '/v1/profile?tab=extensions'),
        });
        return true;
    };
}

/**
 * The tiered email capability, which is the one place a sandboxed script can reach a stranger.
 * Three ways to be allowed, checked in this order:
 *   Tier 2 — the operator set `emailPolicy: 'unrestricted'` on this extension's config. Only the
 *            operator can write that, and manifest config strips `__` keys, so a guest cannot.
 *   Tier 0 — the recipient IS the owner's own verified notification address.
 *   Tier 1 — the owner granted an `extension_email` consent naming this extension.
 * Anything else is refused and logged. Written once here because it was written three times before,
 * and a rule about who may be emailed is not a thing to keep re-deriving.
 */
export function buildExtensionEmail(deps: {
    storage: Storage;
    config: AimeatConfig;
    extName: string;
    extConfig: Record<string, unknown> | undefined;
    /** Bare owner name whose consents and verified address decide the answer. */
    ownerName: string;
    emailService: EmailService | undefined;
}): NonNullable<ExtensionCtx['email']> {
    const { storage, config, extName, extConfig, ownerName, emailService } = deps;
    return async (to, subject, body) => {
        if (!emailService?.enabled) {
            logger.warn(`[ext:${extName}] Email not available (SMTP not configured)`);
            return false;
        }
        if (extConfig?.emailPolicy === 'unrestricted') {
            return emailService.sendNotification(to, subject, body);
        }
        const ownerGhii = ownerName.includes('@') ? ownerName : `${ownerName}@${config.nodeId}`;
        const ghiiRec = await storage.getGHII(ownerGhii);
        if (ghiiRec?.notificationEmail === to && ghiiRec.emailVerifiedAt) {
            return emailService.sendNotification(to, subject, body);
        }
        const consents = await storage.listConsents(ownerGhii, { status: 'active' });
        if (consents.some(c => c.purpose === 'extension_email' && c.dataPattern === `ext:${extName}`)) {
            return emailService.sendNotification(to, subject, body);
        }
        logger.warn(`[ext:${extName}] Email blocked: no authorization for recipient`);
        return false;
    };
}

/** An email capability for a road that genuinely cannot send one. Returns false rather than being
 *  absent, so a script that calls `ctx.email(…)` gets the answer it always got instead of a
 *  TypeError. MCP uses this. */
export function unavailableEmail(extName: string, reason: string): NonNullable<ExtensionCtx['email']> {
    return async () => {
        logger.warn(`[ext:${extName}] Email not available (${reason})`);
        return false;
    };
}

/**
 * How much memory, time and outbound calls one action may have. The declared numbers are a request,
 * the node's configured maxima are the answer, and the small floors keep a manifest that asks for
 * nothing from getting a sandbox too small to start in.
 *
 * The order of min and max is the whole point. The MCP door computed max(declared, cap), which turns
 * the node ceiling into a FLOOR: an extension declaring a 60-second timeout got 60 seconds, and every
 * extension got at least the node maximum memory and API budget. Written once here so the ceiling
 * stays a ceiling on every road into the sandbox.
 */
export function sandboxLimits(
    declared: { memoryMb: number; timeoutMs: number; maxApiCalls: number },
    config: AimeatConfig,
): { memoryMb: number; timeoutMs: number; maxApiCalls: number } {
    return {
        memoryMb: Math.min(Math.max(declared.memoryMb, 16), config.extensionMaxMemoryMb),
        timeoutMs: Math.min(Math.max(declared.timeoutMs, 1000), config.extensionTimeoutMs),
        maxApiCalls: Math.min(Math.max(declared.maxApiCalls, 10), config.extensionMaxApiCalls),
    };
}

/**
 * Build the sandbox context. The three capabilities in the core are the ones that carry a guard, and
 * they are built here precisely so no road can be given a context without them.
 */
export function buildExtensionCtx(deps: ExtensionCtxDeps): ExtensionCtx {
    const { config, storage, extMemoryOwner, logPrefix } = deps;

    const ctx: ExtensionCtx = {
        memory: {
            get: async (key) => {
                const record = await storage.getMemory(extMemoryOwner, key);
                return record ? record.value : null;
            },

            // GUARD (June H-5): the per-value size and per-key count limits. Enforcing this only in
            // the REST wrapper left the scheduler able to fill the database on a clock, repeatably,
            // which is why it belongs to the context and not to the caller.
            set: async (key, value, opts) => {
                await enforceExtensionMemoryLimits(config, storage, extMemoryOwner, key, value);
                const existing = await storage.getMemory(extMemoryOwner, key);
                const now = new Date().toISOString();
                await storage.setMemory({
                    key,
                    ownerGaii: extMemoryOwner,
                    value,
                    // Default 'public' is the historical contract every extension was written
                    // against; 'private' is opt-in for a key holding somebody's personal data.
                    visibility: opts?.visibility === 'private' ? 'private' : 'public',
                    tags: [],
                    ttlHours: null,
                    version: existing ? existing.version + 1 : 1,
                    createdAt: existing ? existing.createdAt : now,
                    updatedAt: now,
                });
            },

            search: async (prefix) => {
                const records = await storage.listMemory(extMemoryOwner, { prefix });
                return records.map(r => ({ key: r.key, value: r.value }));
            },

            delete: async (key) => storage.deleteMemory(extMemoryOwner, key),

            getPublic: async (namespace, key) => {
                let record = await storage.getMemory(namespace, key);
                // A bare owner name resolves through that owner's agents. One IN query rather than
                // one lookup per agent: the per-agent loop was the older shape and it is still in
                // the scheduler copy this builder replaces.
                if (!record && !namespace.includes('@') && !namespace.includes('#') && !namespace.startsWith('ext:')) {
                    const agents = await storage.getAgentsByOwner(namespace);
                    const rows = await storage.listMemoryForOwners(agents.map(a => a.gaii), { prefix: key });
                    const byGaii = new Map(rows.filter(r => r.key === key).map(r => [r.ownerGaii, r]));
                    for (const agent of agents) {
                        const r = byGaii.get(agent.gaii);
                        if (r) { record = r; break; }
                    }
                }
                // An ext: namespace is world-readable by design, so only 'public' leaves it.
                return (record && record.visibility === 'public') ? record.value : null;
            },
        },

        // GUARD (June H-3): safeFetch validates the URL and re-validates every redirect hop. A bare
        // fetch here is an SSRF hole with a script the owner installed on the other end of it, and
        // the scheduler copy had exactly that.
        fetch: async (url, opts) => {
            const resp = await safeFetch(url, {
                method: opts?.method || 'GET',
                headers: opts?.headers,
                body: opts?.body,
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            });
            // Opted in per extension, in its manifest config — so a feed reader keeps the forgiving
            // default and a package producer gets a failed run instead of a mojibake version.
            const text = await decodeBody(resp, deps.extConfig?.strictCharset === true);
            const headers: Record<string, string> = {};
            resp.headers.forEach((v, k) => { headers[k] = v; });
            return { status: resp.status, ok: resp.ok, text, headers };
        },

        caller: deps.caller,
        config: deps.extConfig,

        // A wallet is per-road: a request can spend the caller's balance, a scheduled run has
        // nobody's balance to spend, so it gets the empty object it always had.
        wallet: deps.wallet ?? {},

        // consent and trust were byte-identical in all four copies and have no per-road variance.
        consent: {
            check: async (gaii, scope) => {
                const consents = await storage.listConsents(gaii, { status: 'active' });
                return consents.some(c => c.purpose === scope);
            },
            require: async (gaii, scope) => {
                const consents = await storage.listConsents(gaii, { status: 'active' });
                if (!consents.some(c => c.purpose === scope)) {
                    throw new Error(`CONSENT_REQUIRED: ${scope}`);
                }
            },
        },
        trust: {
            getScore: async (gaii: string) => {
                const agent = await storage.getAgent(gaii);
                return agent?.trustScore ?? 0;
            },
        },

        log: {
            info: (msg, data) => logger.info(`${logPrefix} ${msg}`, data),
            warn: (msg, data) => logger.warn(`${logPrefix} ${msg}`, data),
            error: (msg, data) => logger.error(`${logPrefix} ${msg}`, data),
        },
    };

    // Optional capabilities: attached only when the caller can honestly provide them, so the guest
    // sees `undefined` rather than a function that fails at the far end.
    if (deps.instance) ctx.instance = deps.instance;
    if (deps.files) ctx.files = deps.files;
    if (deps.datapackage) ctx.datapackage = deps.datapackage;
    if (deps.buy) ctx.buy = deps.buy;
    if (deps.notify) ctx.notify = deps.notify;
    if (deps.email) ctx.email = deps.email;

    return ctx;
}

/**
 * @file src/services/extension-ctx-contract.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description THE CONTRACT a sandboxed extension script is written against: the `ctx` object it is
 *   handed, what a write reports back, the limits one run may have, and the hash helper the guest
 *   gets for free.
 *
 *   Its own file because extension-runtime.ts reached the 800-line ceiling. A pure extraction — the
 *   declarations are unchanged and extension-runtime.ts re-exports every one of them, so nothing
 *   that imports them had to move — and a coherent one: everything here describes what a SCRIPT
 *   sees, while what stayed behind is how the QuickJS runtime is built, guarded and torn down.
 * @structure MemoryWriteResult · ExtensionCtx · EXT_HASH_REFERENCE_JS · ExtensionLimits
 * @usage import type { ExtensionCtx } from './extension-runtime.js';  // unchanged
 * @version-history
 *   v1.0.0 — 2026-08-31 — Extracted from extension-runtime.ts (pure extraction; no behaviour change).
 */

/**
 * What a sandbox write reports back. `set` used to return nothing, which is why an extension could
 * not tell a landed write from a lost one — the whole reason every counter here was racy.
 */
export interface MemoryWriteResult {
    /** Did this write land? False only when an `ifVersion` guard refused it; nothing was written. */
    ok: boolean;
    /**
     * The version now on the record: the one just written when `ok`, the one that was really there
     * when a guard refused, and null when the key does not exist (a refused `ifVersion: 0` means it
     * does exist, so this is a number there).
     */
    version: number | null;
}

export interface ExtensionCtx {
    memory: {
        get(key: string): Promise<unknown | null>;
        /**
         * The value AND the version to swap against, or null when the key does not exist.
         *
         * The read half of compare-and-swap: `set(..., { ifVersion })` is unusable without it,
         * because a script has no other way to learn the version it is racing.
         */
        getVersioned(key: string): Promise<{ value: unknown; version: number } | null>;
        /** `visibility` defaults to 'public' — the historical behaviour every extension was written
         *  against. Pass 'private' for a key that holds anyone's personal data: an ext namespace is
         *  world-readable, so a membership list written the default way is served to strangers.
         *
         *  `ifVersion` makes the write a COMPARE-AND-SWAP: it lands only if the stored record is
         *  still at that version, and `0` means "only if this key does not exist yet". Omit it and
         *  the write is last-write-wins, exactly as before. Anything an extension COUNTS — stock, a
         *  reservation, a balance — needs the guard: without it two concurrent calls both read 1 and
         *  both write 0. */
        set(
            key: string,
            value: unknown,
            opts?: { visibility?: 'public' | 'private'; ifVersion?: number },
        ): Promise<MemoryWriteResult>;
        search(prefix: string, opts?: Record<string, unknown>): Promise<Array<{ key: string; value: unknown }>>;
        delete(key: string): Promise<boolean>;
        getPublic(namespace: string, key: string): Promise<unknown | null>;
    };
    wallet: {
        consume?(amount: number, reason: string): Promise<{ success: boolean; error?: string }>;
        getBalance?(): Promise<number>;
    };
    /**
     * Buy one call of ANOTHER owner's app-tool, on this extension's owner's account.
     *
     * The supply-chain leg: a user pays the app, the app pays its supplier, and the difference is the
     * app owner's margin. Billed to the extension's OWNER, never to whoever happens to be calling —
     * the caller has no relationship with the supplier and should not acquire one by using the app.
     * Requires a contract the owner already holds against that tool; without one it returns
     * `{ ok: false, code: 'NO_CONTRACT' }` rather than throwing, so the extension can degrade.
     */
    buy?(appRef: string, tool: string, input?: Record<string, unknown>): Promise<{
        ok: boolean; result?: unknown; code?: string; message?: string; charged?: number; correlation?: string;
    }>;
    /**
     * Start a BACKGROUND model call and get a handle back in milliseconds.
     *
     * A model call can take twenty or thirty minutes. The sandbox caps at 60 seconds and holds a
     * QuickJS runtime for the whole wait, so waiting here is the one thing an extension must not do.
     * `start()` queues the call, answers with an id, and — when `on_done` names one of this
     * extension's own actions — calls that action once the answer has landed at `result_key`. The
     * chain logic stays in this extension's code; there is no engine interpreting a graph.
     *
     * BILLED TO THE EXTENSION'S OWNER, never to whoever happens to be calling: the same rule, and
     * the same reason, as `ctx.buy` above. A road that does not know the extension record cannot
     * answer who pays, so on that road `ctx.ai` is simply absent.
     *
     * IT ANSWERS WITH A DECISION, NOT A THROW, so a full queue or a chain that has gone too deep is
     * something the extension can degrade around instead of dying on.
     */
    ai?: {
        start(opts: {
            prompt?: string;
            prompt_key?: string;
            input_keys?: string[];
            result_key: string;
            result_visibility?: 'private' | 'owner' | 'public';
            model?: string;
            system_prompt?: string;
            json?: boolean;
            on_done?: { extension: string; action: string };
        }): Promise<
            | { ok: true; job_id: string; queue_position: number }
            | { ok: false; code: string; message: string; retry_after_s?: number }
        >;
    };
    consent: {
        check?(gaii: string, scope: string): Promise<boolean>;
        require?(gaii: string, scope: string): Promise<void>;
    };
    trust: {
        getScore?(gaii: string): Promise<number>;
    };
    fetch(url: string, opts?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; ok: boolean; text: string; headers: Record<string, string> }>;
    /** Stored FILES, by reference. Optional the way notify/email are: a road that cannot offer it
     *  simply does not, and the guest sees undefined.
     *
     *  A SCHEDULED RUN NOW OFFERS IT. It used to be the road that could not — which is why "produce
     *  a file on a clock" did not exist on this node — and the reason was that the scheduler passed
     *  no `files`, not that a clock cannot own bytes. It writes into the INSTALLER's namespace, so
     *  `write()` returns `owner` alongside `gaii`: the caller the sandbox sees is not necessarily
     *  the namespace its bytes landed in, and a script handing the address on must not have to guess. */
    files?: {
        read(ref: string): Promise<{ base64: string; mime: string; size: number; key: string } | null>;
        write(key: string, base64: string, opts?: { mime?: string; visibility?: string }):
            Promise<{ key: string; gaii: string; owner: string; url: string; size: number }>;
    };
    /**
     * AIMEAT Data Packages, as a HOST capability — the answer to "a sandboxed extension cannot load
     * a shared library, and the deterministic producers live in extensions". The work (schema
     * inference, validation, the content hash, canonical CSV, the storage writes) happens on the
     * host; the browser binding and the MCP tools reach the same functions, so a package built here
     * is byte-identical to one built there.
     *
     * `publish` THROWS when the quality gate refuses. The scheduler and the workflow engine record a
     * normal return as a successful run, so a returned refusal would be a green run that published
     * nothing; `validate` is the non-throwing call for looking first.
     */
    datapackage?: {
        publish(input: unknown): Promise<unknown>;
        validate(resources: unknown): Promise<unknown>;
        inferSchema(rows: unknown): Promise<unknown>;
        open(ref: string): Promise<unknown>;
        rows(ref: string, resource: string, opts?: unknown): Promise<unknown>;
        fail(name: string, message: string): Promise<void>;
    };
    /**
     * Who invoked this action. `member` is their standing in the app this extension gates, resolved
     * by the NODE before the sandbox starts and handed in: a gate needs the role, the roster is
     * private, and reading it here means no lookup has to be opened to the sandbox. It is null when
     * the extension declares no app (`config.app`), when the caller is the app's owner (who is not a
     * member of their own app — `isAppOwner` says so), or when they simply are not one.
     */
    caller: {
      gaii: string; owner: string; roles: string[];
      member?: { role: string; level: number | null; since: string; note: string } | null;
      isAppOwner?: boolean;
    };
    config: Record<string, unknown>;
    /**
     * Which extension this is, and WHO IT BELONGS TO — resolved server-side from the record
     * (`ExtensionRecord.installedBy`), never from anything a caller sends.
     *
     * Without it a script cannot tell its owner from any other signed-in stranger, so an
     * owner-only action could not exist: the usual workaround is "whoever calls first claims it",
     * and on a per-owner extension that is a shop somebody else can take. Compare against
     * `caller.owner`, which is the account behind any principal form.
     */
    extension?: {
        name: string;
        /** Bare account name of the owner, matching `caller.owner`. */
        owner: string;
    };
    instance?: {
        id: string;
        config: Record<string, unknown>;
    };
    log: {
        info(msg: string, data?: Record<string, unknown>): void;
        warn(msg: string, data?: Record<string, unknown>): void;
        error(msg: string, data?: Record<string, unknown>): void;
    };
    /** Notify the caller's owner; with `to`, ANOTHER owner — delivered only when the target holds
     *  an active `extension_notify` consent for `ext:{name}` (see services/extension-notify.ts). */
    notify?(message: string, opts?: { title?: string; priority?: string; channel?: string; to?: string }): Promise<boolean>;
    email?(to: string, subject: string, body: string): Promise<boolean>;
    // NOTE: the guest ctx also exposes two PURE helpers that need no host call and are therefore
    // implemented inside buildSandboxScript rather than here:
    //   ctx.hash(s) -> 16 hex chars, FNV-1a 64-bit (see EXT_HASH_REFERENCE_JS)
    //   ctx.now()   -> the ISO timestamp captured when this action started (fixed for the run)
}

/**
 * The EXACT source of `ctx.hash`, exported so an app that must agree with an extension on a
 * derived value can run the identical function in the browser.
 *
 * Why this exists: the sandbox has no `crypto.subtle`, so an extension author reaches for a
 * hand-rolled hash while the browser side reaches for SHA-256, and the two silently disagree. That
 * is not hypothetical — it shipped: an app and its extension hashed the same spreadsheet inputs
 * differently, so every value the app computed looked stale to the server and would have been
 * recomputed and re-charged forever. One published function, usable verbatim on both sides.
 *
 * FNV-1a style, 64 bits as two 32-bit lanes. Not cryptographic: use it for cache keys, change
 * detection and content identity, never for signatures or secrets.
 */
export const EXT_HASH_REFERENCE_JS = `function aimeatHash(s) {
  s = String(s);
  var h1 = 0x811c9dc5, h2 = 0x01000193;
  for (var i = 0; i < s.length; i++) {
    var ch = s.charCodeAt(i);
    h1 = (h1 ^ ch) >>> 0; h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = (h2 ^ (ch + i)) >>> 0; h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return ('00000000' + h1.toString(16)).slice(-8) + ('00000000' + h2.toString(16)).slice(-8);
}`;

export interface ExtensionLimits {
    memoryMb: number;
    timeoutMs: number;
    maxApiCalls: number;
}

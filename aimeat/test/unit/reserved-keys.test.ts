/**
 * @file test/unit/reserved-keys.test.ts
 * @description The reserved-key write gate, asserted from both ends: the prefixes that must be on
 *   the list, and the principals the list must and must not refuse.
 *
 *   The list is easy to grow and easy to break, and both mistakes are invisible in a screenshot. Two
 *   keys became server-trusted after the list was written and stayed off it for weeks:
 *   `finance.accountants` decides whether one owner may read another owner's invoices, vouchers, VAT
 *   report, P&L and exports, and `commerce.psp` holds the payout address and Stripe secret that
 *   settlement believes. An app the owner granted `memory:write` writes into the owner's own
 *   namespace by design, so appending itself to either record was the whole attack.
 *
 *   The other end matters as much. Every prefix here costs a granted app a capability, and the gate
 *   has already been broken once in the opposite direction by treating an owner session as a
 *   delegated write, which locked the account holder out of their own record. So the owner, the
 *   agent writing in its own namespace, and the one agent the owner handed
 *   `memory:write-reserved` are asserted to still get through.
 * @structure
 *   - the list itself: the seven prefixes, and no accidental removal
 *   - isReservedServerKey: prefix matching, including the near-misses that must NOT match
 *   - appMayWriteKey: owner passes, app refused, delegated agent refused, reserved grant passes
 * @usage cd aimeat && pnpm exec vitest run test/unit/reserved-keys.test.ts
 * @version-history
 *   v1.x — 2026-09-25 — `packages.install-requests.` is the fifteenth: an install request the
 *     decision door performs as the owner.
 *   v1.x — 2026-09-25 — `notif.`, the first PREFIX only the node writes: a notification's buttons run
 *     with the owner's session, so no principal writes one, and its neighbours are untouched.
 *   v1.x — 2026-09-24 — `__redirect__`, the first key only the node writes: exact, and reserved.
 *   v1.x — 2026-09-19 — `decide.` is the fourteenth: the owner's TypeSafe key and scrubber policy.
 *   v1.x — 2026-09-13 — `messages.organize.` is the thirteenth: the owner's archive and rules for the
 *     Messages list, which decide what the server shows them.
 *   v1.x — 2026-08-30 — `notifications.` is the ninth: the owner's notification settings, which
 *     notify() acts on before it writes.
 *   v1.x — 2026-08-24 — `signals.` is the seventh: an unauthenticated public door reads
 *     `signals.stream.*` before it agrees to write into the owner's namespace.
 *   v1.x — 2026-08-16 — `chat.` is the sixth. A conversation is what the person said and what the
 *     agent did for them; an app-grant token able to append to one could put words in either
 *     mouth, including instructions the next turn would read as the person's own.
 *   v1.3.0 — 2026-08-31 — `ai.jobs.` joins the inventory. The list assertion went RED on the day the
 *     prefix was added, which is the assertion doing its job: this test exists so the set can only
 *     change on purpose.
 *   v1.0.0 — 2026-08-11 — Initial, with the August 2026 audit fix (H-6 finance., H-23 commerce.).
 */
import { describe, it, expect } from 'vitest';
import {
    RESERVED_OWNER_KEY_PREFIXES, isReservedServerKey, appMayWriteKey,
    SERVER_WRITTEN_KEYS, SERVER_WRITTEN_KEY_PREFIXES, isServerWrittenKey, serverWrittenKeyRefusal,
} from '../../src/utils/reserved-keys.js';

/** The two records the August 2026 audit found unprotected, by their real production key names. */
const ACCOUNTANTS_KEY = 'finance.accountants';
const PSP_KEY = 'commerce.psp';

describe('the list holds every prefix the server reads and acts on', () => {
    it('carries all fifteen, and a removal is a test failure rather than a silent regression', () => {
        // `messages.organize.` (2026-09-13): the owner's archive and rules for their Messages list.
        // The server composes the list with it, so an app that could write it could archive the
        // message warning the owner about that very app.
        // `audit.` (2026-08-29): the per-app audit log, which a granted app must not rewrite.
        // `notifications.` (2026-08-30): the owner's notification settings, which notify() acts on
        // to drop a muted sender before the write; an app that could write it could silence the
        // budget and security notifications about itself.
        // `agents.proposals.` (2026-09-02): a proposed AGENT waiting for the owner. The approve
        // route reads the scopes out of that record and creates a principal carrying them, and the
        // proposer's ceiling is checked when the proposal is written — so an app that could write
        // the key would skip the ceiling and have the owner mint whatever it asked for.
        // `ai.jobs.` (2026-08-31): a background AI job record is an INSTRUCTION the server reads
        // back — which model, whose key, what prompt, which key to write the answer to — so writing
        // one is asking this node to spend the owner's money. Same class as `ai-usage.`, one step
        // earlier in the same path.
        // `crews.llm.` (2026-09-09): which model an agent thinks with. A `model` choice carries the
        // provider block whole — `base_url`, the endpoint that agent's own runtime will call, and
        // `api_key_env`, the variable it reads a key from — so an app that could write one could
        // point every agent this owner has at an endpoint of its choosing. `crews.llm.catalog` lives in
        // the agent's own namespace since 2026-09-16; the prefix still keeps a forged one out of the
        // owner's.
        // `packages.install-requests.` (2026-09-25): an install an agent or an app could not do alone,
        // waiting for the owner. The decision door installs what the record names, as the owner.
        expect([...RESERVED_OWNER_KEY_PREFIXES].sort()).toEqual(
            ['agents.proposals.', 'ai-usage.', 'ai.jobs.', 'audit.', 'chat.', 'commerce.', 'crews.llm.', 'decide.', 'finance.', 'messages.organize.', 'notifications.', 'openrouter.', 'packages.install-requests.', 'profile.', 'signals.'],
        );
    });

    it('refuses a granted app and a delegated agent the install requests, and leaves the rest of `packages.` alone', () => {
        const key = 'packages.install-requests.6c1f2a90-0000-4000-8000-000000000001';
        expect(isReservedServerKey(key)).toBe(true);
        expect(appMayWriteKey(['app'], key)).toBe(false);
        expect(appMayWriteKey(['agent'], key, true)).toBe(false);
        expect(appMayWriteKey(['owner'], key)).toBe(true);
        expect(isReservedServerKey('packages.favourites')).toBe(false);
        expect(isReservedServerKey('packages.install-requestsx.1')).toBe(false);
    });

    it('refuses a granted app the decision key and the scrubber policy, and lets the owner write them', () => {
        for (const key of ['decide.apikey', 'decide.policy', 'decide.runs.1b2c']) {
            expect(appMayWriteKey(['app'], key)).toBe(false);
            expect(appMayWriteKey(['agent'], key, true)).toBe(false);
            expect(appMayWriteKey(['owner'], key)).toBe(true);
        }
        // A key that merely starts with the word is not the prefix.
        expect(appMayWriteKey(['app'], 'decider.notes')).toBe(true);
    });

    it('refuses a granted app the Messages list organisation, and leaves the rest of `messages.` alone', () => {
        expect(isReservedServerKey('messages.organize.settings')).toBe(true);
        expect(appMayWriteKey(['app'], 'messages.organize.settings')).toBe(false);
        expect(appMayWriteKey(['agent'], 'messages.organize.settings', true)).toBe(false);
        expect(appMayWriteKey(['owner'], 'messages.organize.settings')).toBe(true);
        expect(isReservedServerKey('messages.drafts')).toBe(false);
    });

    it('refuses a granted app the model choice, and leaves the DEFINITION keys alone', () => {
        expect(isReservedServerKey('crews.llm.default')).toBe(true);
        expect(isReservedServerKey('crews.llm.news-watcher')).toBe(true);
        expect(isReservedServerKey('crews.llm.catalog')).toBe(true);
        // A definition is checked by the runtime that will run it, and misdirectedCrewKey already
        // refuses one written into the wrong namespace, so these stay ordinary owner data.
        expect(isReservedServerKey('crews.registry.news-watcher')).toBe(false);
        expect(isReservedServerKey('crews.runtime.news-watcher')).toBe(false);
        expect(appMayWriteKey(['app'], 'crews.llm.news-watcher')).toBe(false);
        expect(appMayWriteKey(['app'], 'crews.registry.news-watcher')).toBe(true);
    });

    it('refuses a granted app the AI-job records, and leaves ordinary ai-shaped keys alone', () => {
        expect(isReservedServerKey('ai.jobs.7f3c')).toBe(true);
        expect(isReservedServerKey('ai.jobs.log.2026-08-31')).toBe(true);
        // The dot matters here as much as anywhere: an app's own `ai.summary` is user data.
        expect(isReservedServerKey('ai.summary')).toBe(false);
        expect(appMayWriteKey(['app'], 'ai.jobs.7f3c')).toBe(false);
        expect(appMayWriteKey(['owner'], 'ai.jobs.7f3c')).toBe(true);
    });

    it('every entry ends in a dot, so a prefix can never swallow a neighbouring namespace', () => {
        // Without the dot, 'profile' would also reserve 'profiles.*' and 'profile-notes.*', which
        // are ordinary user data and would start refusing an app that had always written them.
        for (const prefix of RESERVED_OWNER_KEY_PREFIXES) expect(prefix.endsWith('.')).toBe(true);
    });
});

describe('a key only the node writes', () => {
    it('is `__redirect__`, exactly, and it counts as reserved', () => {
        // The public agent profile forwards every visitor to the address this record names, and it
        // reads it in ANY namespace, an agent's and the owner's alike.
        expect([...SERVER_WRITTEN_KEYS]).toEqual(['__redirect__']);
        expect(isServerWrittenKey('__redirect__')).toBe(true);
        expect(isReservedServerKey('__redirect__')).toBe(true);
        // An address, not a prefix: the neighbours stay ordinary data.
        expect(isServerWrittenKey('__redirect__.old')).toBe(false);
        expect(isServerWrittenKey('redirect')).toBe(false);
        expect(isServerWrittenKey(undefined)).toBe(false);
    });

    it('is refused to an app as every reserved key is, and says which act writes it', () => {
        expect(appMayWriteKey(['app'], '__redirect__')).toBe(false);
        const refusal = serverWrittenKeyRefusal('__redirect__');
        expect(refusal.code).toBe('RESERVED_KEY');
        expect(refusal.message).toContain('__redirect__');
    });
});

describe('a notification is a record only the node writes', () => {
    // The owner's browser runs a notification's `api` button with the owner's own session, so the
    // writer of the record chooses the door the owner's next click calls. notify() is the one writer.
    it('`notif.` is a prefix of keys only the node writes, and every key under it is reserved', () => {
        expect([...SERVER_WRITTEN_KEY_PREFIXES]).toEqual(['notif.']);
        for (const key of ['notif.2026-09-25T10:00:00.000Z.1a2b3c4d', 'notif.x']) {
            expect(isServerWrittenKey(key), key).toBe(true);
            expect(isReservedServerKey(key), key).toBe(true);
            expect(appMayWriteKey(['app'], key), key).toBe(false);
            expect(appMayWriteKey(['agent'], key, true), key).toBe(false);
        }
    });

    it('its neighbours stay what they were', () => {
        // The owner's notification settings are reserved as the owner's to set, not the node's alone.
        expect(isServerWrittenKey('notifications.settings')).toBe(false);
        expect(isReservedServerKey('notifications.settings')).toBe(true);
        for (const key of ['notif', 'notify.me', 'my.notif.x', 'notifs.draft']) {
            expect(isServerWrittenKey(key), key).toBe(false);
        }
    });

    it('the refusal names the door that does send one', () => {
        const refusal = serverWrittenKeyRefusal('notif.x');
        expect(refusal.code).toBe('RESERVED_KEY');
        expect(refusal.message).toContain('notif.x');
        expect(refusal.message).toContain('POST /v1/notifications');
    });
});

describe('isReservedServerKey covers the keys the audit found and nothing beside them', () => {
    it.each([
        [ACCOUNTANTS_KEY, 'the cross-owner grant list for the whole finance area'],
        ['finance.clients', 'the accountant-side mirror of the same relationship'],
        [PSP_KEY, 'the payout address, the Stripe secret and the webhook secret'],
        ['commerce.order.abc123', 'a settled order the books read back as fact'],
        ['commerce.payable.xyz', 'what the provider owes a beneficiary'],
        ['openrouter.settings', 'the URL a decrypted AI key is posted to'],
        ['ai-usage.2026-08-11', 'the daily spend cap'],
        ['profile.alice.interests', 'the public directory entry'],
        ['chat.thread.abc123', 'a conversation an app could otherwise put words into'],
        ['chat.archive.2026-08', 'the same, after it was rolled into a month'],
    ])('%s is reserved (%s)', (key) => {
        expect(isReservedServerKey(key)).toBe(true);
    });

    it.each([
        'financenotes.q3',
        'commerceideas.draft',
        'my.finance.notes',
        'notes.about.commerce.psp',
        'apps.invoicer.tools',
    ])('%s is ordinary user data and stays writable', (key) => {
        expect(isReservedServerKey(key)).toBe(false);
    });
});

describe('appMayWriteKey refuses the principals that write into the owner namespace', () => {
    it('an app grant may not append itself to the accountant list', () => {
        // H-6. An app-grant token resolves to the owner GHII, so this write would have landed in the
        // record resolveFinanceOwner() consults before handing over another owner's books.
        expect(appMayWriteKey(['app'], ACCOUNTANTS_KEY)).toBe(false);
    });

    it('an app grant may not repoint the seller payout address', () => {
        // H-23. commerce/x402.ts and commerce/sellable-resolvers.ts read this as trusted fact.
        expect(appMayWriteKey(['app'], PSP_KEY)).toBe(false);
    });

    it('an app grant keeps writing everything else it always could', () => {
        expect(appMayWriteKey(['app'], 'notes.groceries')).toBe(true);
        expect(appMayWriteKey(['app'], 'apps.invoicer.state')).toBe(true);
    });

    it('an agent asking to write AS THE OWNER meets the same refusal', () => {
        // memory:write-as-owner reaches the identical namespace, which is why the guard cannot key
        // off the role alone.
        expect(appMayWriteKey(['agent'], PSP_KEY, true)).toBe(false);
        expect(appMayWriteKey(['agent'], ACCOUNTANTS_KEY, true)).toBe(false);
    });
});

describe('and lets through the principals whose keys these are', () => {
    it('the account holder writes their own finance and commerce records', () => {
        // The guard broke this once already: passing delegatedOwnerWrite for an owner session locked
        // the owner out of their own record. /v1/commerce/payout/* and /v1/finance/accountants are
        // owner routes, and this is the branch they depend on.
        expect(appMayWriteKey(['owner'], PSP_KEY)).toBe(true);
        expect(appMayWriteKey(['owner'], ACCOUNTANTS_KEY)).toBe(true);
    });

    it('an agent writing in its OWN namespace is untouched', () => {
        // No 'app' role and no delegation: the record lands under the agent GAII, which is not a
        // namespace the server reads for any of this.
        expect(appMayWriteKey(['agent'], PSP_KEY)).toBe(true);
    });

    it('the one agent granted memory:write-reserved may still administer the account', () => {
        expect(appMayWriteKey(['agent'], PSP_KEY, true, true)).toBe(true);
        expect(appMayWriteKey(['agent'], ACCOUNTANTS_KEY, true, true)).toBe(true);
    });

    it('an ecosystem session is not an owner session, whatever else its roles say', () => {
        // resolveIdentity keeps a GEAI in its own eco: namespace, and the owner branch must not be
        // the way back out of it.
        expect(appMayWriteKey(['owner', 'ecosystem'], PSP_KEY, true)).toBe(false);
        expect(appMayWriteKey(['owner', 'agent'], ACCOUNTANTS_KEY, true)).toBe(false);
    });
});

/**
 * @file test/unit/capability-write.test.ts
 * @description The one write path behind a capability, tested where both doors now meet it
 *   (August 2026 MCP audit, step 8). The REST routes and the aimeat_capabilities_* tools each used
 *   to create, update, delete and vouch for themselves, and the copies disagreed on four things:
 *
 *     - the operator's exemption from the node's publishing policy (HTTP only, and the default
 *       policy is 'disabled', so the operator's own agent was refused what the operator could do)
 *     - the review a PUBLIC capability waits for on a moderated node, applied at update by the tool
 *       door and by nothing else, so a PUT published straight past it
 *     - the operator's reach over another owner's capability (HTTP only)
 *     - the call-log entry every invocation leaves behind (HTTP only, so the log an owner reads to
 *       see who has been calling them was missing the agent traffic)
 *
 *   Those four are what this file pins, plus the source normalisation that turned a partial
 *   `{type:'manual'}` into a 500 before it was repaired on one door. None of them shows up in a
 *   green E2E run: the E2E suite drives the HTTP door, and three of the four drifted on the other.
 * @usage pnpm exec vitest run test/unit/capability-write.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-11 — Written with the extraction into services/capability-record.ts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    createCapability, updateCapability, deleteCapability, vouchCapability, recordCapabilityInvocation,
} from '../../src/services/capability-record.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { AimeatConfig } from '../../src/config.js';
import type { CapabilityRecord } from '../../src/storage/interface.js';

const NODE = 'aimeat-local-001-dev';
const OWNER = `alice@${NODE}`;
const STRANGER = `bob@${NODE}`;

function configWith(publishing: string, webhooks = 'disabled'): AimeatConfig {
    return {
        nodeId: NODE,
        capabilityPublishing: publishing,
        capabilityWebhooks: webhooks,
        capabilityWebhookDomainAllowlist: ['hooks.example.test'],
    } as unknown as AimeatConfig;
}

const owner = { gaii: OWNER, isOperator: false };
const operator = { gaii: OWNER, isOperator: true };

let storage: SqliteStorage;
beforeEach(() => { storage = new SqliteStorage(':memory:'); });

/** A capability that already exists, owned by OWNER, for the update and delete paths. */
async function seed(overrides: Partial<CapabilityRecord> = {}): Promise<CapabilityRecord> {
    const config = configWith('open');
    const created = await createCapability({ storage, config }, owner, {
        name: 'Seeded', summary: 'already here', visibility: overrides.visibility ?? 'private',
        status: 'active', callable: true,
    });
    if (!created.ok) throw new Error(`seed refused: ${created.code}`);
    if (Object.keys(overrides).length === 0) return created.value;
    const patched = await storage.updateCapability(created.value.id, overrides);
    return patched as CapabilityRecord;
}

describe('createCapability — the publishing policy, and who is exempt from it', () => {
    it('refuses a non-operator when publishing is disabled', async () => {
        const out = await createCapability({ storage, config: configWith('disabled') }, owner, {
            name: 'Nope', summary: 'should not exist',
        });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.code).toBe('PUBLISHING_DISABLED');
        expect(out.status).toBe(403);
    });

    it('lets the OPERATOR through on the same node', async () => {
        // The tool door checked the policy without this exemption, so on a default node
        // ('disabled') the operator's own agent could not create what the operator could.
        const out = await createCapability({ storage, config: configWith('disabled') }, operator, {
            name: 'Operator cap', summary: 'allowed',
        });
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.value.ownerGhii).toBe(OWNER);
        expect(out.value.status).toBe('draft');
    });

    it('refuses a PUBLIC capability under self_only, and allows a private one', async () => {
        const config = configWith('self_only');
        const pub = await createCapability({ storage, config }, owner, { name: 'P', summary: 's', visibility: 'public' });
        expect(pub.ok).toBe(false);
        if (!pub.ok) expect(pub.code).toBe('PUBLIC_DISABLED');

        const priv = await createCapability({ storage, config }, owner, { name: 'P', summary: 's', visibility: 'private' });
        expect(priv.ok).toBe(true);
    });

    it('sends a PUBLIC capability to review on a moderated node, whichever status was asked for', async () => {
        const config = configWith('moderated');
        const asked = await createCapability({ storage, config }, owner, {
            name: 'Wait', summary: 's', visibility: 'public', status: 'active',
        });
        expect(asked.ok).toBe(true);
        if (asked.ok) expect(asked.value.status).toBe('pending_review');

        const byOperator = await createCapability({ storage, config }, operator, {
            name: 'No queue', summary: 's', visibility: 'public', status: 'active',
        });
        expect(byOperator.ok).toBe(true);
        if (byOperator.ok) expect(byOperator.value.status).toBe('active');
    });

    it('defaults to draft, so nothing reaches the catalogue unasked', async () => {
        const out = await createCapability({ storage, config: configWith('open') }, owner, { name: 'D', summary: 's' });
        expect(out.ok).toBe(true);
        if (out.ok) expect(out.value.status).toBe('draft');
    });
});

describe('createCapability — the source, which used to reach the insert half-built', () => {
    it('normalises a partial {type:manual} instead of crashing on sourceRef NOT NULL', async () => {
        const out = await createCapability({ storage, config: configWith('open') }, owner, {
            name: 'Partial', summary: 's', source: { type: 'manual' },
        });
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.value.source).toEqual({ type: 'manual', ref: 'manual', version: '1.0.0' });
    });

    it('refuses an unknown type and a non-manual type with no ref', async () => {
        const config = configWith('open');
        const bad = await createCapability({ storage, config }, owner, { name: 'B', summary: 's', source: { type: 'nonsense' } });
        expect(bad.ok).toBe(false);
        if (!bad.ok) expect(bad.message).toContain('source.type must be one of');

        const noRef = await createCapability({ storage, config }, owner, { name: 'B', summary: 's', source: { type: 'cortex' } });
        expect(noRef.ok).toBe(false);
        if (!noRef.ok) expect(noRef.message).toContain("source.ref is required for source.type 'cortex'");
    });

    it('reports a duplicate id as a refusal rather than an exception', async () => {
        const config = configWith('open');
        const first = await createCapability({ storage, config }, owner, { id: 'dup-cap', name: 'A', summary: 's' });
        expect(first.ok).toBe(true);
        const second = await createCapability({ storage, config }, owner, { id: 'dup-cap', name: 'A', summary: 's' });
        expect(second.ok).toBe(false);
        if (!second.ok) {
            expect(second.code).toBe('CAPABILITY_EXISTS');
            expect(second.status).toBe(409);
        }
    });
});

describe('createCapability — the webhook allowlist', () => {
    it('refuses a webhook capability when webhooks are disabled', async () => {
        const out = await createCapability({ storage, config: configWith('open', 'disabled') }, owner, {
            name: 'Hook', summary: 's', source: { type: 'manual' }, webhookUrl: 'https://hooks.example.test/x',
        });
        expect(out.ok).toBe(false);
        if (!out.ok) expect(out.code).toBe('WEBHOOKS_DISABLED');
    });

    it('accepts a domain on the allowlist and refuses one that is not', async () => {
        const config = configWith('open', 'allowlist_only');
        const good = await createCapability({ storage, config }, owner, {
            name: 'Hook', summary: 's', source: { type: 'manual' }, webhookUrl: 'https://hooks.example.test/x',
        });
        expect(good.ok).toBe(true);

        const bad = await createCapability({ storage, config }, owner, {
            name: 'Hook', summary: 's', source: { type: 'manual' }, webhookUrl: 'https://elsewhere.test/x',
        });
        expect(bad.ok).toBe(false);
        if (!bad.ok) expect(bad.code).toBe('WEBHOOK_DOMAIN_NOT_ALLOWED');
    });
});

describe('updateCapability — the review a PUT used to walk past', () => {
    it('sends a public capability going ACTIVE to review on a moderated node', async () => {
        const cap = await seed({ visibility: 'public', status: 'draft' });
        const out = await updateCapability({ storage, config: configWith('moderated') }, owner, cap.id, { status: 'active' });
        expect(out.ok).toBe(true);
        if (out.ok) expect(out.value.status).toBe('pending_review');
    });

    it('leaves a retirement alone: only a request to go active waits for anyone', async () => {
        const cap = await seed({ visibility: 'public', status: 'active' });
        const out = await updateCapability({ storage, config: configWith('moderated') }, owner, cap.id, { status: 'disabled' });
        expect(out.ok).toBe(true);
        if (out.ok) expect(out.value.status).toBe('disabled');
    });

    it('exempts the operator from the same review', async () => {
        const cap = await seed({ visibility: 'public', status: 'draft' });
        const out = await updateCapability({ storage, config: configWith('moderated') }, operator, cap.id, { status: 'active' });
        expect(out.ok).toBe(true);
        if (out.ok) expect(out.value.status).toBe('active');
    });

    it('ignores id, ownerGhii and createdAt in the patch', async () => {
        const cap = await seed();
        const out = await updateCapability({ storage, config: configWith('open') }, owner, cap.id, {
            id: 'stolen', ownerGhii: STRANGER, createdAt: '1999-01-01T00:00:00.000Z', summary: 'new summary',
        });
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.value.id).toBe(cap.id);
        expect(out.value.ownerGhii).toBe(OWNER);
        expect(out.value.createdAt).toBe(cap.createdAt);
        expect(out.value.summary).toBe('new summary');
    });

    it('refuses a stranger and answers 404 for a capability that is not there', async () => {
        const cap = await seed();
        const stranger = await updateCapability({ storage, config: configWith('open') }, { gaii: STRANGER, isOperator: false }, cap.id, { summary: 'mine now' });
        expect(stranger.ok).toBe(false);
        if (!stranger.ok) expect(stranger.code).toBe('FORBIDDEN');

        const missing = await updateCapability({ storage, config: configWith('open') }, owner, 'no-such-cap', { summary: 'x' });
        expect(missing.ok).toBe(false);
        if (!missing.ok) expect(missing.status).toBe(404);
    });

    it('lets an operator act on another owner\'s capability, which the tool door could not', async () => {
        const cap = await seed();
        const out = await updateCapability({ storage, config: configWith('open') }, { gaii: STRANGER, isOperator: true }, cap.id, { summary: 'moderated' });
        expect(out.ok).toBe(true);
        if (out.ok) expect(out.value.summary).toBe('moderated');
    });
});

describe('deleteCapability and vouchCapability', () => {
    it('deletes a manual capability and refuses an aggregated one', async () => {
        const manual = await seed();
        const removed = await deleteCapability({ storage, config: configWith('open') }, owner, manual.id);
        expect(removed.ok).toBe(true);
        expect(await storage.getCapability(manual.id)).toBeNull();

        const aggregated = await seed({ source: { type: 'extension', ref: 'ext:weather:get', version: '1.0.0' } });
        const refused = await deleteCapability({ storage, config: configWith('open') }, owner, aggregated.id);
        expect(refused.ok).toBe(false);
        if (!refused.ok) expect(refused.code).toBe('CANNOT_DELETE');
    });

    it('refuses a vouch for your own capability and counts anybody else\'s', async () => {
        const cap = await seed();
        const own = await vouchCapability({ storage, config: configWith('open') }, owner, cap.id);
        expect(own.ok).toBe(false);
        if (!own.ok) expect(own.code).toBe('CANNOT_VOUCH_OWN');

        const other = await vouchCapability({ storage, config: configWith('open') }, { gaii: STRANGER, isOperator: false }, cap.id);
        expect(other.ok).toBe(true);
        if (other.ok) expect(other.value.vouchCount).toBe(1);
    });
});

describe('recordCapabilityInvocation — the log the tool door never wrote', () => {
    it('writes the counters AND one log line, with the owner\'s redaction applied', async () => {
        const cap = await seed({ redactedFields: ['secret'] });
        await recordCapabilityInvocation({ storage }, { ...cap, redactedFields: ['secret'] }, STRANGER,
            { q: 'hello', secret: 'do-not-store' }, { ok: true, durationMs: 40 });

        const after = await storage.getCapability(cap.id);
        expect(after!.stats.successCount).toBe(1);
        expect(after!.stats.totalInvocations).toBe(1);

        const { logs, total } = await storage.listCapabilityLogs(cap.id, {});
        expect(total).toBe(1);
        expect(logs[0].callerGhii).toBe(STRANGER);
        expect(logs[0].status).toBe('success');
        expect(logs[0].input).toEqual({ q: 'hello', secret: '[REDACTED]' });
    });

    it('keeps a failed input in full, because a redacted one cannot be debugged', async () => {
        const cap = await seed({ redactedFields: ['secret'] });
        await recordCapabilityInvocation({ storage }, { ...cap, redactedFields: ['secret'] }, STRANGER,
            { q: 'hello', secret: 'kept' }, { ok: false, message: 'Webhook URL not configured' });

        const after = await storage.getCapability(cap.id);
        expect(after!.stats.errorCount).toBe(1);
        expect(after!.stats.lastError).toBe('Webhook URL not configured');

        const { logs } = await storage.listCapabilityLogs(cap.id, { status: 'error' });
        expect(logs).toHaveLength(1);
        expect(logs[0].input).toEqual({ q: 'hello', secret: 'kept' });
        expect(logs[0].error).toBe('Webhook URL not configured');
    });

    it('hashes the whole input when the owner redacted everything', async () => {
        const cap = await seed({ redactedFields: ['*'] });
        await recordCapabilityInvocation({ storage }, { ...cap, redactedFields: ['*'] }, STRANGER,
            { q: 'hello' }, { ok: true, durationMs: 5 });

        const { logs } = await storage.listCapabilityLogs(cap.id, {});
        expect(logs[0].input._redacted).toBe(true);
        expect(typeof logs[0].input._hash).toBe('string');
        expect(logs[0].input.q).toBeUndefined();
    });
});

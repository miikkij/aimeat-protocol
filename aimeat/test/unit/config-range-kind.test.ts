/**
 * @file test/unit/config-range-kind.test.ts
 * @description A number setting's range is a recommendation or a limit, and rangeKindOf() reads
 *   which from what the row's own check accepts. The rows named here are the real schema's: the
 *   quotas an operator of a large node raises, the settings that refused a larger value until
 *   2026-10-11, and the ones that stay limits.
 * @usage pnpm test -- config-range-kind
 * @version-history
 *   v1.0.0 — 2026-10-11 — Initial (Jouni, 2026-10-11: a range is a recommended range).
 */
import { describe, it, expect } from 'vitest';
import { ALL_CONFIG_MAP } from '../../src/services/config-schema.js';
import { rangeKindOf, numericRangeOf } from '../../src/services/config-schema-validators.js';

const row = (path: string) => {
    const f = ALL_CONFIG_MAP[path];
    if (!f) throw new Error(`no config row ${path}`);
    return f;
};

describe('rangeKindOf', () => {
    it('says recommended for the quotas, and their checks accept ten million', () => {
        for (const path of ['quota.memory_mb', 'quota.storage_mb', 'quota.memory_max_keys_per_agent', 'quota.max_actions_per_agent', 'quota.max_apps_per_agent', 'rate_limits.global']) {
            expect(rangeKindOf(row(path)), path).toBe('recommended');
            expect(row(path).validate(10_000_000), path).toBe(true);
        }
    });

    it('says recommended for the fifteen settings that refused a larger value until 2026-10-11', () => {
        const lifted = [
            'apps.audit_keep_default', 'account_events.window', 'consent.max_per_user', 'federation.package_peer_cap',
            'extensions.timeout_ms', 'extensions.max_installed', 'extensions.max_per_owner',
            'cross_federation.max_genesis_peers', 'federation_sync.replication_queue_max', 'personal_nodes.max_slots',
            'push.max_subscriptions_per_node', 'cortex.max_installed', 'ai.job_max_queued',
            'ai.job_max_queued_per_owner', 'ai.chat_max_live_threads',
        ];
        for (const path of lifted) {
            const max = numericRangeOf(row(path))!.max;
            expect(rangeKindOf(row(path)), path).toBe('recommended');
            expect(row(path).validate(max * 1000), path).toBe(true);
        }
    });

    it('says limit where the check refuses a larger value, and for the four enforced ranges', () => {
        for (const path of ['node.port', 'morsel_policy.burn_rate', 'totp.window', 'ai.node_key_account_daily_usd',
            'morsel_policy.daily_allowance_cap', 'quota.min_trust_paid_actions', 'moderation.auto_hide_threshold', 'federation.max_relay_hops']) {
            expect(rangeKindOf(row(path)), path).toBe('limit');
        }
    });

    it('keeps the minimum on a recommended range', () => {
        expect(row('quota.memory_mb').validate(0)).toBe(false);
        expect(row('extensions.max_installed').validate(0)).toBe(false);
        expect(row('account_events.window').validate(9)).toBe(false);
    });

    it('is null for a row with no numeric range', () => {
        expect(rangeKindOf(row('node.id'))).toBeNull();
        expect(rangeKindOf(row('federation.relay_claim'))).toBeNull();
    });
});

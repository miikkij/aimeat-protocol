/**
 * @file connector-registry-keys-by-gaii.test.ts
 * @description Two owners on one connector are two identities, not one row that wins.
 *
 *   THE DEFECT THIS PINS. `AgentRegistry` keyed by the bare agent name while holding several
 *   identities, so `concierge#bob@node` silently replaced `concierge#alice@node`: no error, no
 *   warning, load order deciding which one a task reached. The basic-agents button gives every
 *   owner the same three names, so it happened the first time two people shared a daemon.
 *
 *   THE PROPERTY IS "BOTH SURVIVE AND STAY APART". Keying by GAII is how, but the test asserts the
 *   behaviour rather than the key: two entries, each resolvable, neither reachable from the other's
 *   identity, and a bare name that could mean either is REFUSED naming both — because picking one
 *   is the original defect moved up a layer.
 *
 *   AND A SINGLE-OWNER DAEMON IS UNCHANGED. That is the other half and the easier one to break:
 *   this must not become a feature that only two-owner installs get.
 *
 * @usage cd aimeat && pnpm exec vitest run test/unit/connector-registry-keys-by-gaii.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial, with the re-key.
 */
import { describe, it, expect } from 'vitest';
import { AgentRegistry, buildRegistry, displayName, type RegisteredAgent } from '../../src/cli/connect/agent-registry.js';
import { isGaii, gaiiFromToken, gaiiParts } from '../../src/cli/connect/agent-gaii.js';
import { AimeatClient } from '../../src/cli/connect/api-client.js';
import type { LoadedAgent } from '../../src/cli/connect/config.js';

const NODE = 'aimeat-local-001-dev';

function entry(agent: string, owner: string, extra: Partial<RegisteredAgent> = {}): RegisteredAgent {
    return {
        gaii: `${agent}#${owner}@${NODE}`,
        agent,
        owner,
        client: new AimeatClient('http://127.0.0.1:1', ''),
        config: { agent, owner, node_url: 'http://127.0.0.1:1' },
        ...extra,
    };
}

/** A bearer shaped like the node's: only the payload matters, nothing verifies it. */
function tokenWithSub(sub: unknown): string {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${b64({ alg: 'EdDSA' })}.${b64({ sub })}.${'sig'}`;
}

describe('two owners with the same agent name are two identities', () => {
    it('both load, and neither replaces the other', () => {
        const reg = new AgentRegistry();
        reg.add(entry('concierge', 'alice'));
        reg.add(entry('concierge', 'bob'));
        expect(reg.size()).toBe(2);
        expect(reg.list().map(a => a.gaii).sort()).toEqual([
            `concierge#alice@${NODE}`, `concierge#bob@${NODE}`,
        ]);
    });

    it('each resolves to its own identity, and never to the other', () => {
        const reg = new AgentRegistry();
        reg.add(entry('concierge', 'alice'));
        reg.add(entry('concierge', 'bob'));
        const a = reg.resolve(`concierge#alice@${NODE}`);
        const b = reg.resolve(`concierge#bob@${NODE}`);
        expect(a.owner).toBe('alice');
        expect(b.owner).toBe('bob');
        expect(a).not.toBe(b);
    });

    it('a bare name that could mean either is refused, and the refusal names both', () => {
        const reg = new AgentRegistry();
        reg.add(entry('concierge', 'alice'));
        reg.add(entry('concierge', 'bob'));
        let message = '';
        try { reg.resolve('concierge'); } catch (err) { message = (err as Error).message; }
        expect(message).toContain(`concierge#alice@${NODE}`);
        expect(message).toContain(`concierge#bob@${NODE}`);
        // Not a silent pick, and not a bare "not found" either.
        expect(message).toMatch(/more than one/i);
    });

    it('the same identity twice is refused rather than overwriting', () => {
        const reg = new AgentRegistry();
        reg.add(entry('concierge', 'alice'));
        expect(() => reg.add(entry('concierge', 'alice'))).toThrow(/already loaded/i);
        expect(reg.size()).toBe(1);
    });

    it('and buildRegistry carries on past a duplicate rather than losing the rest', () => {
        // One bad pair in the keychain must not stop the other agents being served.
        const loaded: LoadedAgent[] = [
            { agent: 'concierge', owner: 'alice', gaii: `concierge#alice@${NODE}`, token: '', config: { agent: 'concierge', owner: 'alice', node_url: 'http://127.0.0.1:1' } },
            { agent: 'concierge', owner: 'alice', gaii: `concierge#alice@${NODE}`, token: '', config: { agent: 'concierge', owner: 'alice', node_url: 'http://127.0.0.1:1' } },
            { agent: 'crew-forge', owner: 'bob', gaii: `crew-forge#bob@${NODE}`, token: '', config: { agent: 'crew-forge', owner: 'bob', node_url: 'http://127.0.0.1:1' } },
        ];
        const reg = buildRegistry(loaded);
        expect(reg.size()).toBe(2);
        expect(reg.resolve(`crew-forge#bob@${NODE}`).owner).toBe('bob');
    });
});

describe('a single-owner connector behaves exactly as it did', () => {
    it('one agent resolves with no identifier, and with its bare name', () => {
        const reg = new AgentRegistry();
        reg.add(entry('concierge', 'alice'));
        expect(reg.resolve().gaii).toBe(`concierge#alice@${NODE}`);
        expect(reg.resolve('concierge').gaii).toBe(`concierge#alice@${NODE}`);
        expect(reg.get('concierge')?.owner).toBe('alice');
    });

    it('several agents of ONE owner still resolve by their bare names', () => {
        // The ordinary multi-agent case, which is not the ambiguous one.
        const reg = new AgentRegistry();
        for (const n of ['concierge', 'crew-forge', 'workflow-manager']) reg.add(entry(n, 'alice'));
        expect(reg.resolve('crew-forge').agent).toBe('crew-forge');
        expect(reg.resolve('workflow-manager').owner).toBe('alice');
    });

    it('an unknown name still says what is available', () => {
        const reg = new AgentRegistry();
        reg.add(entry('concierge', 'alice'));
        reg.add(entry('crew-forge', 'alice'));
        expect(() => reg.resolve('nope')).toThrow(/not loaded/i);
        expect(() => reg.resolve('nope')).toThrow(/concierge/);
    });

    it('and an unknown FULL identity is told so as an identity', () => {
        const reg = new AgentRegistry();
        reg.add(entry('concierge', 'alice'));
        reg.add(entry('crew-forge', 'alice'));
        expect(() => reg.resolve(`concierge#carol@${NODE}`)).toThrow(new RegExp(`concierge#alice@${NODE}`));
    });

    it('primary still wins when several are loaded and nothing is named', () => {
        const reg = new AgentRegistry();
        reg.add(entry('concierge', 'alice'));
        reg.add(entry('crew-forge', 'alice', { config: { agent: 'crew-forge', owner: 'alice', node_url: 'http://127.0.0.1:1', primary: true } }));
        expect(reg.resolve().agent).toBe('crew-forge');
    });
});

describe('the identity comes from the credential, never from the filename', () => {
    it('reads the sub of a v1 bearer', () => {
        expect(gaiiFromToken(tokenWithSub(`concierge#alice@${NODE}`))).toBe(`concierge#alice@${NODE}`);
    });

    it('and answers null for anything it cannot place, rather than guessing', () => {
        expect(gaiiFromToken(tokenWithSub('alice'))).toBeNull();          // an owner, not a GAII
        expect(gaiiFromToken(tokenWithSub(undefined))).toBeNull();
        expect(gaiiFromToken('not-a-jwt')).toBeNull();
        expect(gaiiFromToken('a.b')).toBeNull();
        expect(gaiiFromToken(`${Buffer.from('{').toString('base64url')}.${Buffer.from('{').toString('base64url')}.s`)).toBeNull();
    });

    it('recognises a GAII and takes it apart for display', () => {
        expect(isGaii(`concierge#alice@${NODE}`)).toBe(true);
        expect(isGaii('concierge')).toBe(false);
        expect(isGaii('concierge@alice')).toBe(false);   // the keychain filename, deliberately not one
        expect(gaiiParts(`concierge#alice@${NODE}`)).toEqual({ agent: 'concierge', owner: 'alice', node: NODE });
        expect(gaiiParts('concierge')).toBeNull();
    });

    it('the human label stays human', () => {
        // A log line reading concierge@alice is better than a GAII; this is about map keys, not print.
        expect(displayName({ agent: 'concierge', owner: 'alice' })).toBe('concierge@alice');
    });
});

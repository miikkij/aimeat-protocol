/**
 * @file test/unit/security-profile.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How the node decides its security profile when AIMEAT_SECURITY_PROFILE is unset, what
 *   that profile sets by default, and which startup warnings a public node prints.
 *     - isPrivateHost: loopback, RFC 1918, link-local, IPv6 loopback and unique-local, and an
 *       unparseable address are private; a public name or address is not.
 *     - loadConfig: a public base URL gives the `public` profile, loopback egress off and app-origin
 *       isolation on; a private one gives `local` with the opposite defaults; a personal node is
 *       `local` on any URL; an explicit profile and explicit AIMEAT_ALLOW_PRIVATE_EGRESS /
 *       AIMEAT_APP_ORIGIN_ENABLED win over the derived value; an unknown profile value is ignored.
 *     - securityPostureWarnings: each of the six unsafe settings, the refused AI-label switch, the
 *       provenance switch and the refused fixed-base-URL override is named on a public node, and
 *       none of them on a local node.
 *
 *   WHY. A change that read a public node as local would turn loopback egress on, app-origin
 *   isolation off and every one of these warnings silent, and nothing tested it: no test called
 *   isPrivateHost, and the one test that loaded a profile always set it explicitly. Writing this
 *   test found that isPrivateHost never matched an IPv6 literal, because URL.hostname keeps the
 *   brackets (fixed in config-private-host.ts v1.0.1).
 * @usage cd aimeat && pnpm exec vitest run test/unit/security-profile.test.ts
 * @version-history
 *   2026-10-16 — The posture fixtures carry the four knobs W20 added to the public-node warnings
 *     (metrics access, extension install role, AI provider allowlist, default agent scopes).
 *   v1.0.0 — 2026-10-16 — Initial (QA audit F20-02).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/utils/logger.js', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { isPrivateHost } from '../../src/config-private-host.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { securityPostureWarnings } from '../../src/config-posture.js';

/** The variables the profile reads or writes; every case sets each of them, unset or not. */
const PROFILE_VARS = [
    'AIMEAT_BASE_URL', 'AIMEAT_SECURITY_PROFILE', 'AIMEAT_NODE_TYPE', 'AIMEAT_ALLOW_PRIVATE_EGRESS',
    'AIMEAT_APP_ORIGIN_ENABLED', 'AIMEAT_AI_PROVENANCE', 'AIMEAT_AI_LABEL_PUBLIC',
] as const;

function withEnv<T>(vars: Partial<Record<typeof PROFILE_VARS[number], string>>, fn: () => T): T {
    const saved = Object.fromEntries(PROFILE_VARS.map((k) => [k, process.env[k]]));
    for (const k of PROFILE_VARS) {
        const v = vars[k];
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    try { return fn(); } finally {
        for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
}

/** loadConfig with no config file, whatever sits in the working directory. */
const load = (vars: Partial<Record<typeof PROFILE_VARS[number], string>>) =>
    withEnv(vars, () => loadConfig({ configPath: 'test/.no-such-config-file.ini' }).config);

describe('isPrivateHost', () => {
    it.each([
        'http://localhost:40050', 'http://node.localhost', 'http://127.0.0.1', 'http://127.8.9.10:1',
        'http://10.0.0.5', 'http://192.168.1.20', 'http://172.16.0.1', 'http://172.31.255.255',
        'http://169.254.169.254', 'http://[::1]:40050', 'http://[::]', 'http://[fd12:3456::1]', 'http://[fc00::1]',
        'not a url', '',
    ])('%s is private', (url) => {
        expect(isPrivateHost(url)).toBe(true);
    });

    it.each([
        'https://aimeat.io', 'https://node.example.org', 'http://8.8.8.8', 'http://172.15.0.1', 'http://172.32.0.1',
        'http://11.0.0.1', 'http://[2001:db8::1]', 'https://localhost.example.com',
    ])('%s is public', (url) => {
        expect(isPrivateHost(url)).toBe(false);
    });
});

describe('the profile derived from the base URL', () => {
    it('a public base URL: profile public, loopback egress off, app-origin isolation on', () => {
        let envAfter: string | undefined;
        const c = withEnv({ AIMEAT_BASE_URL: 'https://node.example.org' }, () => {
            const cfg = loadConfig({ configPath: 'test/.no-such-config-file.ini' }).config;
            envAfter = process.env.AIMEAT_ALLOW_PRIVATE_EGRESS;
            return cfg;
        });
        expect(c.securityProfile).toBe('public');
        expect(c.allowPrivateEgress).toBe(false);
        expect(c.appOriginEnabled).toBe(true);
        // url-validator reads the variable at call time, so the profile's default is written back to it.
        expect(envAfter).toBe('false');
    });

    it('a private base URL: profile local, loopback egress on, app-origin isolation off', () => {
        for (const url of ['http://localhost:40050', 'http://192.168.1.20:40050', 'http://[::1]:40050']) {
            const c = load({ AIMEAT_BASE_URL: url });
            expect(c.securityProfile, url).toBe('local');
            expect(c.allowPrivateEgress, url).toBe(true);
            expect(c.appOriginEnabled, url).toBe(false);
        }
    });

    it('no base URL at all reads as the localhost default: local', () => {
        expect(load({}).securityProfile).toBe('local');
    });

    it('a personal node is local on a public URL', () => {
        expect(load({ AIMEAT_BASE_URL: 'https://me.example.org', AIMEAT_NODE_TYPE: 'personal' }).securityProfile).toBe('local');
    });

    it('an explicit profile wins over the URL in both directions; an unknown value is ignored', () => {
        expect(load({ AIMEAT_BASE_URL: 'http://localhost:40050', AIMEAT_SECURITY_PROFILE: 'public' }).securityProfile).toBe('public');
        expect(load({ AIMEAT_BASE_URL: 'https://node.example.org', AIMEAT_SECURITY_PROFILE: 'local' }).securityProfile).toBe('local');
        expect(load({ AIMEAT_BASE_URL: 'https://node.example.org', AIMEAT_SECURITY_PROFILE: 'strict' }).securityProfile).toBe('public');
    });

    it('explicit AIMEAT_ALLOW_PRIVATE_EGRESS and AIMEAT_APP_ORIGIN_ENABLED win over the profile', () => {
        const pub = load({ AIMEAT_BASE_URL: 'https://node.example.org', AIMEAT_ALLOW_PRIVATE_EGRESS: 'true', AIMEAT_APP_ORIGIN_ENABLED: 'false' });
        expect(pub.securityProfile).toBe('public');
        expect(pub.allowPrivateEgress).toBe(true);
        expect(pub.appOriginEnabled).toBe(false);
        const loc = load({ AIMEAT_BASE_URL: 'http://localhost:40050', AIMEAT_ALLOW_PRIVATE_EGRESS: 'false', AIMEAT_APP_ORIGIN_ENABLED: 'true' });
        expect(loc.allowPrivateEgress).toBe(false);
        expect(loc.appOriginEnabled).toBe(true);
    });
});

describe('securityPostureWarnings', () => {
    /** A config with every unsafe setting this check reports, on the given profile. */
    const unsafe = (securityProfile: 'local' | 'public'): AimeatConfig => ({
        securityProfile, baseUrl: securityProfile === 'public' ? 'https://node.example.org' : 'http://localhost:40050',
        anonymousMode: true, allowPrivateEgress: true, federationOpenJoin: true, encryptionKey: '',
        corsAllowedOrigins: ['*'], statsAccess: 'public', aiProvenance: false,
        aiFixedBaseUrlOverrides: 'openai=https://proxy.example.org', testMoneyHandler: false,
        metricsAccess: 'public', extInstallRole: 'owner', aiProviderAllowlist: [], defaultAgentScopes: ['*'],
    } as unknown as AimeatConfig);
    /** The same node with every one of those settings safe. */
    const safe = (): AimeatConfig => ({
        securityProfile: 'public', baseUrl: 'https://node.example.org',
        anonymousMode: false, allowPrivateEgress: false, federationOpenJoin: false, encryptionKey: 'k'.repeat(64),
        corsAllowedOrigins: ['https://node.example.org'], statsAccess: 'operator', aiProvenance: true,
        aiFixedBaseUrlOverrides: '', testMoneyHandler: false,
        metricsAccess: 'operator', extInstallRole: 'operator', aiProviderAllowlist: ['api.openai.com'], defaultAgentScopes: ['memory:read'],
    } as unknown as AimeatConfig);

    it('names each unsafe setting on a public node', () => {
        const w = withEnv({ AIMEAT_AI_LABEL_PUBLIC: 'off', AIMEAT_AI_PROVENANCE: 'false' }, () => securityPostureWarnings(unsafe('public')));
        const expected = [
            /^AIMEAT_ANONYMOUS=true/, /^AIMEAT_ALLOW_PRIVATE_EGRESS=true/, /^AIMEAT_FEDERATION_OPEN_JOIN=true/,
            /^AIMEAT_ENCRYPTION_KEY is unset/, /^AIMEAT_CORS_ALLOWED_ORIGINS=\*/, /^AIMEAT_STATS_ACCESS=public/,
            /^AIMEAT_AI_LABEL_PUBLIC=off was REFUSED/, /^AIMEAT_AI_PROVENANCE=false/, /^AIMEAT_AI_FIXED_BASEURL_OVERRIDES was REFUSED/,
            // The rest of the knob table (QA audit S10-05, F7d-05).
            /^AIMEAT_METRICS_ACCESS=public/, /^AIMEAT_EXT_INSTALL_ROLE=owner/, /^AIMEAT_AI_PROVIDER_ALLOWLIST is empty/, /^AIMEAT_DEFAULT_AGENT_SCOPES holds */,
        ];
        for (const re of expected) expect(w.some((line) => re.test(line)), `${re} in ${JSON.stringify(w)}`).toBe(true);
        expect(w).toHaveLength(expected.length);
    });

    it('says the provenance switch was refused when the node records provenance anyway', () => {
        const w = withEnv({ AIMEAT_AI_PROVENANCE: 'false' }, () => securityPostureWarnings({ ...safe(), aiProvenance: true } as AimeatConfig));
        expect(w).toHaveLength(1);
        expect(w[0]).toMatch(/^AIMEAT_AI_PROVENANCE=false was REFUSED/);
    });

    it('names nothing on a public node whose settings are all safe', () => {
        expect(withEnv({}, () => securityPostureWarnings(safe()))).toEqual([]);
    });

    it('names nothing on a local node, however unsafe its settings', () => {
        expect(withEnv({ AIMEAT_AI_LABEL_PUBLIC: 'off', AIMEAT_AI_PROVENANCE: 'false' }, () => securityPostureWarnings(unsafe('local')))).toEqual([]);
    });
});

/**
 * @file scripts/check-posture-defaults.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The gate for invariants 8 and 10 (docs/coding-guidelines/security-development-dna.md).
 *
 *   INVARIANT 10: a setting whose safe value differs between localhost and the public internet is
 *   posture configuration, and `.env.example` carries the safe public value. Three things are read
 *   for each knob of the DNA's posture table:
 *     - an UNCOMMENTED line in .env.example sets a value that is safe on a public node, because the
 *       file is what an operator copies;
 *     - a `(default: X)` the file states for the knob is the value the code resolves with nothing
 *       set, because an operator decides on that sentence;
 *     - a node on the public profile with nothing set either runs the safe value or says so at
 *       start-up (securityPostureWarnings in src/config-posture.ts), so an unsafe default is never
 *       silent.
 *   INVARIANT 8: the scopes an agent gets when nobody names any (SHIPPED_DEFAULT_AGENT_SCOPES) hold
 *   none of the powerful scopes the invariant keeps explicit (POWERFUL_AGENT_SCOPES). A delete that
 *   moves a record to the deleted-memory bin may be a default (`memory:delete`); a permanent purge
 *   and deleting an organism may not (`memory:purge`), and neither may ending an agent with its
 *   records (`agent:delete`).
 *
 *   Both invariants were held by review only until 2026-10-16, and the audit found the file and the
 *   code disagreeing in four places (QA audit S10-05). A finding listed in ALLOWED is not a
 *   clearance unless its sentence is an answer: an entry that starts DECISION OWED is a question
 *   for the developer, kept so the gate refuses the NEXT disagreement.
 * @structure POSTURE_KNOBS · envExampleFacts() · postureFindings() · resolvedPublicDefaults() · ALLOWED · main()
 * @usage
 *   cd aimeat && pnpm check:posture-defaults
 * @version-history
 *   2026-10-16 — The owed invariant 8 decision is answered: memory:delete stays in the default and
 *     leaves POWERFUL_AGENT_SCOPES, because every delete it opens goes to the bin; the ALLOWED entry
 *     for it is removed (ruled by the developer on 2026-10-16).
 *   2026-10-16 — Initial (QA audit S10-05, S10-09).
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { AimeatConfig } from '../src/config-types.js';

/** One row of the DNA posture table: the variable, how to read it off a config, and what is safe in public. */
export interface PostureKnob {
    env: string;
    read: (c: AimeatConfig) => string;
    safePublic: (value: string) => boolean;
}

/** Filled by main() and by the unit test, so this list does not import the config module itself. */
export function postureKnobs(powerful: readonly string[]): PostureKnob[] {
    const off = (v: string) => v === 'false';
    return [
        { env: 'AIMEAT_ANONYMOUS', read: c => String(c.anonymousMode), safePublic: off },
        { env: 'AIMEAT_ALLOW_PRIVATE_EGRESS', read: c => String(c.allowPrivateEgress), safePublic: off },
        { env: 'AIMEAT_FEDERATION_OPEN_JOIN', read: c => String(c.federationOpenJoin), safePublic: off },
        { env: 'AIMEAT_FEDERATION_AUTH_POLICY', read: c => c.federationAuthPolicy, safePublic: v => v !== 'all_peers' },
        { env: 'AIMEAT_CORS_ALLOWED_ORIGINS', read: c => c.corsAllowedOrigins.join(','), safePublic: v => !v.split(',').includes('*') },
        { env: 'AIMEAT_STATS_ACCESS', read: c => c.statsAccess, safePublic: v => v !== 'public' },
        { env: 'AIMEAT_METRICS_ACCESS', read: c => c.metricsAccess, safePublic: v => v !== 'public' },
        { env: 'AIMEAT_SETUP_ALLOWED_IPS', read: c => c.setupAllowedIps.join(','), safePublic: v => v.length > 0 },
        { env: 'AIMEAT_EXT_INSTALL_ROLE', read: c => c.extInstallRole, safePublic: v => v === 'operator' },
        { env: 'AIMEAT_AI_PROVIDER_ALLOWLIST', read: c => c.aiProviderAllowlist.join(','), safePublic: v => v.length > 0 },
        { env: 'AIMEAT_ADMIN_SETUP_OPEN_AFTER_FIRST_OPERATOR', read: c => String(c.adminSetupOpenAfterFirstOperator), safePublic: off },
        { env: 'AIMEAT_DEV_MODE', read: c => String(c.devMode), safePublic: off },
        { env: 'AIMEAT_TEST_MODE', read: c => String(c.testMode), safePublic: off },
        { env: 'AIMEAT_DEFAULT_AGENT_SCOPES', read: c => c.defaultAgentScopes.join(','), safePublic: v => !v.split(',').some(s => s === '*' || powerful.includes(s)) },
    ];
}

/** What .env.example says about one variable: an uncommented value, and a stated default. */
export interface EnvFact { uncommented?: string; statedDefault?: string }

export function envExampleFacts(text: string, names: readonly string[]): Map<string, EnvFact> {
    const facts = new Map<string, EnvFact>();
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        for (const name of names) {
            const set = new RegExp(`^${name}=("([^"]*)"|[^\\s#]*)`).exec(line);
            const fact = facts.get(name) ?? {};
            if (set) fact.uncommented = set[2] ?? set[1];
            if (new RegExp(`^#\\s*${name}=`).test(line) || set) {
                const d = /\(default:\s*([^;)\s,]+)/.exec(line);
                if (d) fact.statedDefault = d[1].replace(/^["']|["']$/g, '');
            }
            if (fact.uncommented !== undefined || fact.statedDefault !== undefined) facts.set(name, fact);
        }
    }
    return facts;
}

export interface PostureFinding { key: string; detail: string }

/**
 * The comparison. `publicConfig` is a config resolved on the public profile with nothing set;
 * `warnings` is what securityPostureWarnings says about it; `shippedScopes` is the default list.
 */
export function postureFindings(input: {
    knobs: PostureKnob[]; envExample: string; publicConfig: AimeatConfig; warnings: string[];
    shippedScopes: string; powerful: readonly string[];
}): PostureFinding[] {
    const out: PostureFinding[] = [];
    const facts = envExampleFacts(input.envExample, input.knobs.map(k => k.env));
    for (const knob of input.knobs) {
        const fact = facts.get(knob.env);
        const resolved = knob.read(input.publicConfig);
        if (fact?.uncommented !== undefined && !knob.safePublic(fact.uncommented)) {
            out.push({ key: `uncommented-unsafe:${knob.env}`, detail: `.env.example sets ${knob.env}=${fact.uncommented}, which is not safe on a public node, and an operator copies that file.` });
        }
        if (fact?.statedDefault !== undefined && fact.statedDefault !== resolved) {
            out.push({ key: `default-mismatch:${knob.env}`, detail: `.env.example says the default is ${fact.statedDefault}; with nothing set the code resolves ${resolved || '(empty)'}.` });
        }
        if (!knob.safePublic(resolved) && !input.warnings.some(w => w.includes(knob.env))) {
            out.push({ key: `unwarned:${knob.env}`, detail: `a public node with nothing set runs ${knob.env}=${resolved || '(empty)'}, which is not the safe public value, and the start-up self-check says nothing about it.` });
        }
    }
    for (const scope of input.shippedScopes.split(',').map(s => s.trim())) {
        if (input.powerful.includes(scope)) {
            out.push({ key: `inv8:${scope}`, detail: `the default agent scopes hold ${scope}, which invariant 8 keeps explicit and separately consented.` });
        }
    }
    return out;
}

/**
 * Each finding left today, with its sentence. DECISION OWED marks a question nobody has answered;
 * the gate fails on a finding that is not here, so the next disagreement cannot slip in beside these.
 */
export const ALLOWED: Record<string, string> = {
    'uncommented-unsafe:AIMEAT_STATS_ACCESS':
        'DECISION OWED (2026-10-16): .env.example ships AIMEAT_STATS_ACCESS=public uncommented, and the '
        + 'start-up self-check warns about exactly that on a public node. Either the example ships '
        + 'authenticated, or this sentence says why a copied example should publish the node statistics.',
    'unwarned:AIMEAT_SETUP_ALLOWED_IPS':
        'DECISION OWED (2026-10-16): the DNA table asks a public node to restrict the first-owner setup '
        + 'wizard to loopback, the code default is open, and no warning names it. Either the self-check '
        + 'reports it, or this sentence says what closes the wizard on a public node.',
};

/** A config resolved on the public profile with no AIMEAT_* variable and no config file. */
export async function resolvedPublicDefaults(): Promise<AimeatConfig> {
    const saved = { ...process.env };
    try {
        for (const k of Object.keys(process.env)) if (k.startsWith('AIMEAT_') || k === 'DATABASE_URL') delete process.env[k];
        process.env.AIMEAT_SECURITY_PROFILE = 'public';
        process.env.AIMEAT_BASE_URL = 'https://node.example';
        const { loadConfig } = await import('../src/config.js');
        return loadConfig({ configPath: join(tmpdir(), 'aimeat-posture-defaults-none.ini') }).config;
    } finally {
        for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
        Object.assign(process.env, saved);
    }
}

async function main(): Promise<void> {
    const aimeat = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
    const { SHIPPED_DEFAULT_AGENT_SCOPES } = await import('../src/config.js');
    const { securityPostureWarnings, POWERFUL_AGENT_SCOPES } = await import('../src/config-posture.js');
    const publicConfig = await resolvedPublicDefaults();
    const findings = postureFindings({
        knobs: postureKnobs(POWERFUL_AGENT_SCOPES),
        envExample: readFileSync(join(aimeat, '.env.example'), 'utf8'),
        publicConfig,
        warnings: securityPostureWarnings(publicConfig),
        shippedScopes: SHIPPED_DEFAULT_AGENT_SCOPES,
        powerful: POWERFUL_AGENT_SCOPES,
    });
    const fresh = findings.filter(f => ALLOWED[f.key] === undefined);
    const stale = Object.keys(ALLOWED).filter(k => !findings.some(f => f.key === k));
    const owed = findings.filter(f => ALLOWED[f.key]?.startsWith('DECISION OWED')).length;

    console.log('');
    console.log('  Posture defaults: .env.example, the code default and the self-check agree (invariants 8 and 10)');
    console.log('  ' + '─'.repeat(62));
    console.log(`  findings          ${String(findings.length).padStart(3)}`);
    console.log(`  decision owed     ${String(owed).padStart(3)}   listed in ALLOWED as a question`);
    console.log(`  NEW, not listed   ${String(fresh.length).padStart(3)}`);
    console.log('');
    for (const f of fresh) console.log(`    ${f.key}\n      ${f.detail}`);
    if (stale.length) {
        console.log('  Listed and now agreed, so remove from ALLOWED:');
        for (const k of stale) console.log(`    ${k}`);
    }
    if (fresh.length) {
        console.error(`\n✖ ${fresh.length} posture default(s) disagree. Make .env.example, the code default and the start-up self-check (src/config-posture.ts) agree, or add the finding to ALLOWED in this script with the sentence that decides it.`);
        process.exit(1);
    }
    console.log('  ✓ no new disagreement between .env.example, the code default and the self-check');
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await main();

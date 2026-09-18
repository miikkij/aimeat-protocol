/**
 * @file scripts/check-prompt-refs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Holds every text an agent or an AI chat reads about this node to what the node
 *   actually has: a tool it names is in the MCP catalogue, a route it names is declared, and it
 *   carries none of the phrases that describe something removed or reframed.
 *
 *   WHY. The instruction review of 2026-09-18 read about forty sources and found the same defect
 *   in most hand-written ones. Production's /llms-full.txt still documented the micro-memory
 *   routes three weeks after they were deleted (GET /v1/mm/help answered 404), called Boards
 *   deprecated after they were reinstated, and called morsels a currency. A managed prompt served
 *   as an MCP slash command registered agents with a header no code reads. A tier prompt listed
 *   three OAuth routes that never existed. Every structural check was green throughout, because
 *   none of them reads the prose. Three reviewers found most of it with one set difference each;
 *   this is that set difference, kept.
 *
 *   WHAT IT READS. SOURCES below: the public discovery texts, the MCP instructions and handbooks,
 *   the managed prompt seeds, the prompt builders, the built-in skills, the tool descriptions, the
 *   connect prompts, and the agent-builder documents. A source is read as text; nothing is
 *   imported and nothing is started, so this stays in the fast tier.
 *
 *   WHAT A ROUTE IS CHECKED AGAINST. openapi.yaml is the contract, and the express declarations
 *   under src/ are what answers. A route in a text but in neither is dead and fails. A route that
 *   answers in code and is missing from the contract is reported as a contract gap and fails too,
 *   because the backend rule puts the contract in the same commit as the route.
 * @structure SOURCES; BANNED; ALLOWED (answers, one reason each); collectTools(), collectRoutes(),
 *   normalise(); scan(); main()
 * @usage
 *   cd aimeat && pnpm check:prompt-refs            # exits 1 on any finding
 *   cd aimeat && pnpm check:prompt-refs --list     # the sources, and nothing runs
 * @version-history
 *   v1.0.0 -- 2026-09-18 -- Initial, from the instruction review of the same day.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { CLI_FALLBACK_TOOL_DEFINITIONS } from '../src/mcp/catalog/definitions.js';
import { MCP_SURFACES, type SurfaceRole } from '../src/mcp/catalog/surfaces.js';
import { MODEL_RECOMMENDATION, MODEL_REVIEW_MAX_AGE_DAYS, modelReviewAgeDays } from '../src/services/model-recommendation.js';

const here = dirname(fileURLToPath(import.meta.url));
const AIMEAT = join(here, '..');
const REPO = join(AIMEAT, '..');

/** Files and directories whose text reaches an agent. A directory is read recursively. */
const SOURCES: string[] = [
    'aimeat/public/llms-full-template.txt',
    'aimeat/public/llms-index-template.txt',
    'aimeat/public/robots.node.txt',
    'aimeat/src/routes/bootstrap.ts',
    'aimeat/src/data/getting-started.ts',
    'aimeat/src/data/bootstrap-endpoints.ts',
    'aimeat/src/routes/agent-docs.ts',
    'aimeat/src/routes/agent-conventions.ts',
    'aimeat/src/routes/wellknown.ts',
    'aimeat/src/services/auth-md.ts',
    'aimeat/src/services/first-steps.ts',
    'aimeat/src/services/hello-integration-prompt.ts',
    'aimeat/src/services/skills-by-situation.ts',
    'aimeat/src/services/markdown-negotiation.ts',
    'aimeat/src/mcp/instructions.ts',
    'aimeat/src/mcp/error-next-step.ts',
    'aimeat/src/services/handbooks',
    'aimeat/src/services/prompt-defaults',
    'aimeat/src/services/prompt-defaults.ts',
    'aimeat/src/services/build-app-prompt.ts',
    'aimeat/src/services/build-app-layers.ts',
    'aimeat/src/services/build-app-prompt-driven.ts',
    'aimeat/src/services/build-atelier-prompt.ts',
    'aimeat/src/services/build-extension-prompt.ts',
    'aimeat/src/services/build-cortex-prompt.ts',
    'aimeat/src/services/appdev-flow-prompt.ts',
    'aimeat/src/services/hello-mcp.ts',
    'aimeat/src/services/agent-connect-prompt.ts',
    'aimeat/src/services/agent-onboard-prompt.ts',
    'aimeat/src/services/welcome-mat-prompt.ts',
    'aimeat/src/services/draft-offer-prompt.ts',
    'aimeat/src/services/offerings-handbook.ts',
    'aimeat/src/services/ai-tool-setup.ts',
    'aimeat/src/services/skill-bundle',
    'aimeat/src/cli/connect/onboarding-prompt.ts',
    'aimeat/src/data/builtin-skills.ts',
    'aimeat/src/data/builtin-skills.conversation.ts',
    'aimeat/src/data/builtin-skills.hatchery.ts',
    'aimeat/src/data/builtin-skills.open-items.ts',
    'aimeat/src/data/builtin-skills.workstation.ts',
    'aimeat/src/data/builtin-skills.app-builder.ts',
    'aimeat/src/data/builtin-skills.app-builder-atelier.ts',
    'aimeat/src/data/builtin-skills-games.ts',
    'aimeat/src/data/builtin-skills-games.boot-assets.ts',
    'aimeat/src/data/builtin-skills-games.menus-audio.ts',
    'aimeat/src/data/builtin-skills-games.saves-controls.ts',
    'aimeat/src/data/builtin-skills-games.world.ts',
    'aimeat/src/mcp/catalog/definitions',
    'aimeat/public/views/profile/agents/connect-prompts.js',
    'aimeat/public/views/home/journey-prompts.js',
    'aimeat/public/views/landing-prompts.js',
    'docs/AIMEAT_Help_Prompt.md',
    'docs/building-an-aimeat-compatible-agent.md',
    'docs/building-an-aimeat-compatible-ecosystem-app.md',
    'python/aimeat-crewai/README.md',
];

/** A phrase that describes something this node removed or reframed. `unless` rescues a sentence. */
interface Banned { id: string; pattern: RegExp; unless?: RegExp; why: string }
const BANNED: Banned[] = [
    { id: 'micro-memory', pattern: /micro-?memory|\/v1\/mm\b/i, why: 'micro-memory was deleted on 2026-08-23; its routes answer 404' },
    { id: 'otk', pattern: /\bOTK\b|one-time key|Tier 0\.5|otk-or-jwt/, why: 'one-time keys and Tier 0.5 were deleted on 2026-08-23' },
    { id: 'connectivity-key', pattern: /connectivity[- ]key/i, unless: /DEPRECATED|deprecated|removed/, why: 'nothing generates connectivity keys; agents connect by device authorization' },
    { id: 'owner-key-header', pattern: /X-AIMEAT-Owner-Key|\bowner_key\b/, why: 'no code reads this header or returns this field; agent registration needs an owner JWT' },
    { id: 'boards-deprecated', pattern: /Boards?\b[^.\n]{0,80}\bDEPRECATED|DEPRECATED[^.\n]{0,80}\bBoards?\b/i, why: 'Boards were reinstated on 2026-08-30 and are current' },
    { id: 'morsel-as-money', pattern: /morsel[^.\n]{0,120}\b(currency|micro-currency|micro-transactions?|economy)\b|\b(currency|micro-currency|economy)\b[^.\n]{0,120}morsel/i, // `currency` as an SDK field or parameter (`{ amount, currency }`, `session.currency`) is the
    // commerce API's own name for morsel-or-money, and stays.
    unless: /\bnot (a |an )?(internal )?(currency|money)\b|not money|never morsels|never a currency|money-currency|pacing meter|\bcurrency\??\s*[:}\]]|\.currency\b|,\s*currency\b|currency\??\)\s*(\/\/|→|$)/i, why: 'a morsel is a pacer, not money: it buys nothing and is never called a currency or an economy' },
    { id: 'oauth-routes', pattern: /\/v1\/oauth\//, why: 'the OAuth routes are /v1/mcp/register, /v1/mcp/authorize and /v1/mcp/token' },
    // A recommended model written out by hand. `anthropic/claude-opus-5` as an EXAMPLE of a model
    // id (provenance, compliance) is a different thing and does not match: no "Opus 5", no "GPT-".
    { id: 'model-name-written-out', pattern: /\bOpus \d|\bGPT-\d|\bGemini \d/, why: 'a recommended model is named in one place, services/model-recommendation.ts; read MODEL_RECOMMENDATION instead of writing the name out' },
];

/**
 * Findings that are right as they stand. Each entry is an ANSWER: the sentence that says why.
 * Key: `<banned id or "tool" or "route">|<repo-relative file>|<the token or a fragment of the line>`.
 */
const ALLOWED: Record<string, string> = {
    'model-name-written-out|aimeat/src/data/builtin-skills.conversation.ts|Claude → Opus 5 or better': 'The skill aimeat-first-conversation is kept byte for byte equal to the copy on aimeat.io and a digest test holds that (e2e-skills 27b2b), so its text cannot read a constant. When the recommendation moves, change the skill on aimeat.io, regenerate this file and its digest.',
    'route|aimeat/src/data/bootstrap-endpoints.ts|/v1/profile': 'A page of the SPA, served by the static handler and not by a router declaration; the bootstrap lists it as where a person manages their data.',
    'contract-gap|aimeat/src/routes/bootstrap.ts|/v1/portal': 'A page a person opens in a browser. The contract describes the API, and an HTML page is not part of it.',
    'contract-gap|aimeat/src/services/markdown-negotiation.ts|/v1/portal': 'The same page, named in the landing markdown as where a person registers.',
};

interface Finding { file: string; line: number; kind: string; token: string; why: string }

function filesUnder(path: string): string[] {
    const abs = join(REPO, path);
    if (!existsSync(abs)) return [];
    if (statSync(abs).isFile()) return [abs];
    return readdirSync(abs).flatMap(name => filesUnder(join(path, name)))
        .filter(f => /\.(ts|js|mjs|md|txt)$/.test(f));
}

/** Every tool name the catalogue defines, plus the two the Python package registers locally. */
function collectTools(): Set<string> {
    const names = new Set(CLI_FALLBACK_TOOL_DEFINITIONS.map(d => d.name));
    for (const surface of Object.values(MCP_SURFACES)) for (const name of surface) names.add(name);
    names.add('aimeat_offers_check');
    names.add('aimeat_offers_publish');
    return names;
}

/** `/v1/a/:id/b`, `/v1/a/{id}/b`, `/v1/a/<id>/b` and `/v1/a/${x}/b` all become `/v1/a/{}/b`. */
function normalise(path: string): string {
    return path
        .replace(/[?#].*$/, '')
        .replace(/\$\{[^}]*\}/g, '{}')
        .replace(/:[A-Za-z_][A-Za-z0-9_]*\??/g, '{}')
        .replace(/\{[^}]*\}/g, '{}')
        .replace(/<[^>/]*>/g, '{}')
        .replace(/\[[^\]/]*\]/g, '{}')
        .replace(/\\.*$/, '')
        .replace(/\/(\.\.\.|\*)$/, '/FAMILY')
        .replace(/[.,;:)\]'"`*]+$/, '')
        .replace(/\/+$/, '')
        .replace(/\/FAMILY$/, '/{family}');
}

function collectRoutes(): { contract: Set<string>; code: Set<string> } {
    const spec = parseYaml(readFileSync(join(REPO, 'openapi.yaml'), 'utf8')) as { paths: Record<string, unknown> };
    const contract = new Set(Object.keys(spec.paths).map(normalise));
    const code = new Set<string>();
    const decl = /\.(?:get|post|put|patch|delete|all|use)\(\s*(?:\[\s*)?['"`](\/[^'"`]+)['"`]/g;
    for (const file of filesUnder('aimeat/src')) {
        if (!file.endsWith('.ts')) continue;
        const text = readFileSync(file, 'utf8');
        for (const m of text.matchAll(decl)) code.add(normalise(m[1]));
    }
    return { contract, code };
}

/** A path a text names is known when it is declared, or when it is a prefix family (`/v1/x/*`). */
function known(path: string, declared: Set<string>): boolean {
    if (declared.has(path)) return true;
    // `/v1/ghii/totp/*` and `/v1/ext/...` name a family: any declared route under the prefix.
    if (path.endsWith('/{family}')) {
        const prefix = path.slice(0, -'{family}'.length);
        return [...declared].some(d => d.startsWith(prefix));
    }
    const segs = path.split('/');
    for (const d of declared) {
        const ds = d.split('/');
        if (ds.length !== segs.length) continue;
        // The segment after /v1 names the resource and must match as written: a catch-all such as
        // `/v1/:anything` would otherwise make every two-segment path look declared.
        if (ds[2] !== segs[2]) continue;
        // A declared parameter takes any value a text writes there. The reverse does not hold: a
        // text's placeholder standing where the route has a literal names a different route.
        if (ds.every((s, i) => s === segs[i] || s === '{}')) return true;
    }
    return false;
}

const TOOL_TOKEN = /\baimeat_[a-z0-9]+(?:_[a-z0-9]+)*\b(?!_)/g;
/** Identifiers that share the prefix and are not tools. */
const NOT_A_TOOL = /^aimeat_(rt|ref|session|sid|csrf|token|jwt|theme|lang|locale|consent|device|app|node|id|key|db|test|e2e|dev|local|crewai|version|build|spec_token|remake|node_id|node_url|agent_gaii|runtime|identity_types|knowledge_package)$/;
const ROUTE_TOKEN = /\b(GET|POST|PUT|PATCH|DELETE)\s+(?:https?:\/\/[^\s/`'"]+|\$\{[^}]+\}|\{\{[^}]+\}\}|<[^>]+>)?(\/v1\/[^\s`'"<>|)]*)/g;
const URL_FIELD = /\burl:\s*['"`](\/v1\/[^'"`\s]*)['"`]/g;

function scan(tools: Set<string>, routes: { contract: Set<string>; code: Set<string> }): Finding[] {
    const findings: Finding[] = [];
    const seen = new Set<string>();
    const push = (f: Finding) => {
        const key = `${f.kind}|${f.file}|${f.token}`;
        if (seen.has(key)) return;
        seen.add(key);
        if (Object.keys(ALLOWED).some(a => a.startsWith(`${f.kind}|${f.file}|`) && f.token.includes(a.split('|')[2]))) return;
        findings.push(f);
    };
    for (const abs of SOURCES.flatMap(filesUnder)) {
        const file = relative(REPO, abs).replace(/\\/g, '/');
        const handbookRole = /src\/services\/handbooks\/([a-z]+)\.ts$/.exec(file)?.[1];
        const surface = handbookRole && handbookRole in MCP_SURFACES ? new Set(MCP_SURFACES[handbookRole as SurfaceRole]) : null;
        readFileSync(abs, 'utf8').split('\n').forEach((text, i) => {
            const line = i + 1;
            // A version-history line records what a file used to say; it is not what an agent reads.
            if (/^\s*\*\s+v?\d+\.\d+\.\d+\s+(--|—|-)/.test(text)) return;
            // Nor is a source comment: it explains the code to a developer and is never served.
            if (/\.(ts|js|mjs)$/.test(file) && /^\s*(\*|\/\/|\/\*)/.test(text)) return;
            for (const m of text.matchAll(TOOL_TOKEN)) {
                const name = m[0];
                if (NOT_A_TOOL.test(name)) continue;
                if (!tools.has(name)) push({ file, line, kind: 'tool', token: name, why: 'no such tool in the MCP catalogue' });
                else if (surface && !surface.has(name)) push({ file, line, kind: 'off-surface', token: name, why: `the ${handbookRole} handbook names a tool the ${handbookRole} surface does not carry` });
            }
            const paths = [...text.matchAll(ROUTE_TOKEN)].map(m => m[2]).concat([...text.matchAll(URL_FIELD)].map(m => m[1]));
            for (const raw of paths) {
                const path = normalise(raw);
                if (path === '/v1' || path.endsWith('/{}') && path.split('/').length <= 3) continue;
                const inContract = known(path, routes.contract);
                const inCode = known(path, routes.code);
                if (!inContract && !inCode) push({ file, line, kind: 'route', token: raw, why: 'declared neither in openapi.yaml nor in src/' });
                else if (!inContract) push({ file, line, kind: 'contract-gap', token: raw, why: 'answers in code, missing from openapi.yaml' });
            }
            for (const b of BANNED) {
                if (!b.pattern.test(text)) continue;
                if (b.unless?.test(text)) continue;
                push({ file, line, kind: b.id, token: text.trim().slice(0, 110), why: b.why });
            }
        });
    }
    return findings;
}

function main(): void {
    if (process.argv.includes('--list')) {
        for (const s of SOURCES) console.log(`${existsSync(join(REPO, s)) ? ' ' : '!'} ${s}`);
        return;
    }
    const missing = SOURCES.filter(s => !existsSync(join(REPO, s)));
    const findings = scan(collectTools(), collectRoutes());
    const byKind = new Map<string, Finding[]>();
    for (const f of findings) byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f]);
    for (const [kind, list] of byKind) {
        console.error(`\n✗ ${kind} (${list.length}): ${list[0].why}`);
        for (const f of list) console.error(`    ${f.file}:${f.line}  ${f.token}`);
    }
    for (const s of missing) console.error(`\n✗ source not found: ${s} (moved or deleted; update SOURCES)`);
    // The model recommendation and the vendors' menu paths go stale without anything breaking.
    const age = modelReviewAgeDays();
    if (age > MODEL_REVIEW_MAX_AGE_DAYS) {
        console.error(`\n✗ the model recommendation was last checked ${age} days ago (${MODEL_RECOMMENDATION.reviewedOn}; the limit is ${MODEL_REVIEW_MAX_AGE_DAYS}).`
            + '\n    Open the sources listed at the top of aimeat/src/services/ai-tool-setup.ts, confirm the model names and the menu paths,'
            + '\n    then move reviewedOn in aimeat/src/services/model-recommendation.ts. The skill aimeat-first-conversation names the same models and is changed on aimeat.io first.');
        process.exit(1);
    }
    if (findings.length || missing.length) {
        console.error(`\n${findings.length} finding(s) in agent-facing text. Fix the text, or add an ANSWER to ALLOWED with the reason it is right.`);
        process.exit(1);
    }
    console.log(`✓ agent-facing text names only tools and routes that exist (${SOURCES.length} sources)`);
}

main();

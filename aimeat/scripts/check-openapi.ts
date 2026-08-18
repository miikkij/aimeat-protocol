/**
 * @file check-openapi.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Pre-commit / CI guard for `openapi.yaml`. Rule 3 makes the spec the canonical API
 *   contract, but nothing verified it was still machine-readable — and it had quietly stopped being
 *   so in two different ways, both found live on main:
 *
 *     1. A DANGLING $ref (`#/components/schemas/SuccessEnvelope`; the schema is `AimeatEnvelope`)
 *        broke `pnpm generate:types` outright. Rule 3's OWN tool could not run.
 *     2. A PORTABILITY trap: `description: Whole document portion public? }` inside a flow mapping.
 *        The repo's `yaml` package and openapi-typescript both accept it, so nothing here complained
 *        — but PyYAML rejects it, and PyYAML is what most Python OpenAPI tooling is built on
 *        (openapi-spec-validator, prance, datamodel-code-generator). A consumer would have seen a
 *        syntax error instead of our API, and we would never have known.
 *
 *   So this checks three things, cheapest first, and each one exists because it already failed.
 * @structure
 *   - parse with the `yaml` package (genuine syntax errors)
 *   - resolve every internal `$ref` (the break that stopped codegen)
 *   - flag unquoted flow-mapping scalars containing `?` (accepted here, rejected by YAML 1.1 parsers)
 * @usage  pnpm check:openapi   (exits non-zero on a parse error, a dangling $ref, or a portability trap)
 * @version-history
 *   v1.0.0 — 2026-07-26 — Initial guard, after both failure modes were found live on main.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse as parseYaml, parseDocument, visit, isCollection } from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const SPEC = join(here, '..', '..', 'openapi.yaml');
const raw = readFileSync(SPEC, 'utf8');

// ── 1. Does it parse at all? ────────────────────────────────────────────────
let doc: unknown;
try {
    doc = parseYaml(raw, { strict: true });
} catch (err) {
    console.error('✗ openapi.yaml does not parse');
    console.error(`  ${(err as Error).message}`);
    process.exit(1);
}

// ── 2. Does every internal $ref resolve? ────────────────────────────────────

/** Resolve a `#/a/b/c` JSON pointer against the document. undefined when it dangles. */
function resolvePointer(root: unknown, ref: string): unknown {
    const parts = ref.slice(2).split('/').map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'));
    let node: unknown = root;
    for (const part of parts) {
        if (node === null || typeof node !== 'object') return undefined;
        node = (node as Record<string, unknown>)[part];
        if (node === undefined) return undefined;
    }
    return node;
}

const dangling: { path: string; ref: string }[] = [];
let refCount = 0;

function walk(node: unknown, path: string): void {
    if (Array.isArray(node)) {
        node.forEach((v, i) => walk(v, `${path}/${i}`));
        return;
    }
    if (node === null || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === '$ref' && typeof value === 'string') {
            // Only internal pointers are ours to guarantee; an external file/URL ref is the
            // codegen tool's business.
            if (value.startsWith('#/')) {
                refCount++;
                if (resolvePointer(doc, value) === undefined) dangling.push({ path, ref: value });
            }
            continue;
        }
        walk(value, `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`);
    }
}
walk(doc, '#');

// ── 3. Portability: plain scalars inside { } that YAML 1.1 parsers reject ───
// `?` is an indicator character. Inside a flow collection a PLAIN (unquoted) scalar containing one
// is accepted by the `yaml` package but rejected by PyYAML, so the spec parses here and fails for a
// Python consumer. Quoting the value fixes it and costs nothing.
//
// This walks the AST rather than the text: a line-based scan cannot tell a real flow mapping from a
// `{ … }` that is merely prose inside a block description, and this file is full of the latter (12
// false positives on the first attempt). Node type PLAIN + an ancestor collection with flow=true is
// the exact condition, and nothing else.
const portability: { line: number; text: string }[] = [];
const lineStarts: number[] = [0];
for (let i = 0; i < raw.length; i++) if (raw[i] === '\n') lineStarts.push(i + 1);
const lineOf = (offset: number): number => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
};

const cst = parseDocument(raw);
visit(cst, {
    Scalar(_key, node, path) {
        if (node.type !== 'PLAIN') return;
        const value = typeof node.value === 'string' ? node.value : '';
        if (!value.includes('?')) return;
        const inFlow = path.some(p => isCollection(p) && (p as { flow?: boolean }).flow === true);
        if (!inFlow) return;
        const line = node.range ? lineOf(node.range[0]) : 0;
        portability.push({ line, text: raw.split(/\r?\n/)[line - 1]?.trim() ?? value });
    },
});

// ── Report ──────────────────────────────────────────────────────────────────
let failed = false;

if (dangling.length) {
    failed = true;
    console.error(`✗ ${dangling.length} dangling $ref(s) — \`pnpm generate:types\` cannot run:`);
    for (const d of dangling) console.error(`  ${d.ref}\n    at ${d.path}`);
}

if (portability.length) {
    failed = true;
    console.error(`✗ ${portability.length} unquoted flow scalar(s) containing "?" — this file parses here but`);
    console.error('  fails in PyYAML-based OpenAPI tooling. Quote the value:');
    for (const p of portability) console.error(`  openapi.yaml:${p.line}  ${p.text.slice(0, 110)}`);
}

if (failed) process.exit(1);

const spec = doc as { paths?: Record<string, unknown>; components?: { schemas?: Record<string, unknown> } };
console.log(
    `✓ openapi.yaml parses, all ${refCount} internal $refs resolve, no flow-scalar portability traps `
    + `— ${Object.keys(spec.paths ?? {}).length} paths, ${Object.keys(spec.components?.schemas ?? {}).length} schemas.`,
);

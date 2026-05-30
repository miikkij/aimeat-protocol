/**
 * @file surface-weight.ts
 * @description F2 measurement instrument. Reports the *context cost* of the MCP tool surface —
 *   the tokens every client pays just to load the tool list (name + description + input schema)
 *   before any request runs. This is the concrete, deterministic metric that tool consolidation
 *   (Phase 5) and progressive disclosure (Phase 7) optimize, so it gives a real before/after number
 *   without needing a live LLM. The live task-success eval (eval-mcp/tasks.ts) is the complementary,
 *   developer-run measure of agent ergonomics.
 * @structure
 *   - estimateTokens() — rough chars/4 token estimate
 *   - main() — per-tool weight table + per-domain rollup + heaviest tools + duplication hints
 * @usage
 *   pnpm eval:mcp-surface           # human-readable report
 *   pnpm eval:mcp-surface -- --json # machine-readable
 * @version-history
 *   v1.0.0 -- 2026-05-30 -- MCP audit Phase 5 (F2): tool-surface context-cost report
 */
import { CLI_FALLBACK_TOOL_DEFINITIONS, type AimeatToolDefinition } from '../../src/mcp/catalog/definitions.js';
import { TOOL_ANNOTATIONS } from '../../src/mcp/annotations.js';
import { TOOL_SCOPES } from '../../src/mcp/catalog/scopes.js';

/** Rough token estimate (English ≈ 4 chars/token). Good enough for relative before/after comparison. */
function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

/** Serialised cost of one tool as it appears in a tools/list payload (name + description + input schema). */
function toolWeight(def: AimeatToolDefinition): { tokens: number; chars: number } {
    const title = TOOL_ANNOTATIONS[def.name]?.title ?? '';
    const inputJson = JSON.stringify(def.input ?? {});
    const blob = `${def.name}\n${title}\n${def.description}\n${inputJson}`;
    return { tokens: estimateTokens(blob), chars: blob.length };
}

function domainOf(name: string): string {
    // aimeat_<domain>_<action> → domain
    const parts = name.replace(/^aimeat_/, '').split('_');
    return parts[0] ?? 'other';
}

function main(): void {
    const defs = CLI_FALLBACK_TOOL_DEFINITIONS;
    const rows = defs.map(d => ({ name: d.name, domain: domainOf(d.name), gated: TOOL_SCOPES[d.name] ?? '', ...toolWeight(d) }))
        .sort((a, b) => b.tokens - a.tokens);

    const totalTokens = rows.reduce((s, r) => s + r.tokens, 0);
    const totalChars = rows.reduce((s, r) => s + r.chars, 0);

    // Per-domain rollup
    const byDomain = new Map<string, { count: number; tokens: number }>();
    for (const r of rows) {
        const e = byDomain.get(r.domain) ?? { count: 0, tokens: 0 };
        e.count++; e.tokens += r.tokens;
        byDomain.set(r.domain, e);
    }
    const domains = [...byDomain.entries()]
        .map(([domain, e]) => ({ domain, ...e }))
        .sort((a, b) => b.tokens - a.tokens);

    if (process.argv.includes('--json')) {
        console.log(JSON.stringify({ totalTools: defs.length, totalTokens, totalChars, domains, tools: rows }, null, 2));
        return;
    }

    console.log('# MCP Tool-Surface Weight (context cost of tools/list)\n');
    console.log(`Total tools:            ${defs.length}`);
    console.log(`Total approx tokens:    ~${totalTokens.toLocaleString()} (${totalChars.toLocaleString()} chars)`);
    console.log(`Avg tokens/tool:        ~${Math.round(totalTokens / defs.length)}`);
    console.log('\n## By domain (consolidation targets — domains with many tools cost the most)\n');
    console.log('domain'.padEnd(16) + 'tools'.padStart(6) + 'tokens'.padStart(10));
    for (const d of domains) console.log(d.domain.padEnd(16) + String(d.count).padStart(6) + `~${d.tokens}`.padStart(10));

    console.log('\n## 12 heaviest tools\n');
    console.log('tokens'.padStart(7) + '  ' + 'gate'.padEnd(16) + 'tool');
    for (const r of rows.slice(0, 12)) console.log(`~${r.tokens}`.padStart(7) + '  ' + (r.gated || '-').padEnd(16) + r.name);

    console.log('\n## Multi-tool domains (Phase 5 consolidation candidates)\n');
    for (const d of domains.filter(d => d.count >= 4)) {
        const names = rows.filter(r => r.domain === d.domain).map(r => r.name);
        console.log(`- ${d.domain} (${d.count} tools, ~${d.tokens} tok): ${names.join(', ')}`);
    }
    console.log('\nUse this number before/after a consolidation. Pair with eval-mcp/tasks.ts (live LLM) to confirm');
    console.log('agent task-success does not regress. See eval-mcp/README.md.');
}

main();

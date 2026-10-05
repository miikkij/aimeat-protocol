/**
 * @file test/unit/tool-route-scopes.test.ts
 * @description An MCP tool is offered for the scope words its REST route asks (secaudit 2026-10, C3).
 *   The node offers a tool only to an agent holding the words in TOOL_SCOPES (tool-catalog/scopes.ts);
 *   the route the same capability runs on asks its own words with requireScope. When the two lists
 *   differ, an agent is shown a tool it cannot use, or is refused on one surface what it is given on
 *   the other. The refinery run was listed on one word while its route asked four.
 *
 *   HOW IT PAIRS THEM. The connector's dispatch table (src/tool-dispatch/tool-call-defs-*.ts) says,
 *   per tool, which route it calls: the first `client.<verb>(path)` in the handler. The routes and
 *   their middleware are read from src/routes with the inventory's collectors. A tool whose path is
 *   built at run time, or whose route is not found, is not paired, and the pairing count is held so
 *   that the test cannot pass by pairing nothing.
 *
 *   KNOWN lists the pairs that differ today, each with why; a new difference fails, and so does an
 *   entry that no longer differs.
 * @usage pnpm test -- tool-route-scopes
 * @version-history
 *   v1.0.1 — 2026-10-05 — Two pairs the AI-model dispatch definitions hid behind a spread name are listed
 *     (secaudit 2026-10, M3).
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, C3).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { guardArraysIn, collectRestRoutes } from '../../scripts/inventory/entries.js';
import type { GuardCall } from '../../scripts/inventory/principals.js';
import { TOOL_SCOPES, toolScopeWords } from '../../src/tool-catalog/scopes.js';
import { scopeIsCovered } from '../../src/utils/scope-coverage.js';

const ROOT = path.resolve(__dirname, '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const parse = (file: string): ts.SourceFile => ts.createSourceFile(file, readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true);

interface Route { verb: string; pattern: RegExp; literals: number; id: string; words: string[] }

function routes(): Route[] {
  const sources = walk(path.join(ROOT, 'src', 'routes')).map(parse);
  const arrays = new Map<string, GuardCall[]>();
  for (const s of sources) for (const [k, v] of guardArraysIn(s)) arrays.set(k, v);
  return sources.flatMap((s) => collectRestRoutes(s, ROOT, arrays)).map((r) => {
    const [verb, p] = r.id.split(' ') as [string, string];
    const segs = p.split('/');
    return {
      verb, id: r.id,
      pattern: new RegExp(`^${segs.map((g) => (g.startsWith(':') ? '[^/]+' : g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/')}$`),
      literals: segs.filter((g) => g && !g.startsWith(':')).length,
      words: r.guards.filter((g) => g.name === 'requireScope').flatMap((g) => g.args),
    };
  });
}

/** The verb and path of the first `client.<verb>(…)` in each dispatch entry's handler. */
function toolCalls(): Map<string, { verb: string; path: string }> {
  const out = new Map<string, { verb: string; path: string }>();
  for (const file of walk(path.join(ROOT, 'src', 'tool-dispatch')).filter((f) => /tool-call-defs-/.test(f))) {
    const visit = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        const nameProp = node.properties.find((p): p is ts.PropertyAssignment =>
          ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'name' && ts.isStringLiteral(p.initializer));
        const handler = node.properties.find((p) => p.name && ts.isIdentifier(p.name) && p.name.text === 'handler');
        if (nameProp && handler) {
          let found: { verb: string; path: string } | undefined;
          const look = (n: ts.Node): void => {
            if (found) return;
            if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)
              && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === 'client'
              && ['get', 'post', 'put', 'patch', 'delete'].includes(n.expression.name.text) && n.arguments[0]) {
              const p = pathOf(n.arguments[0]);
              if (p) found = { verb: n.expression.name.text.toUpperCase(), path: p };
            }
            ts.forEachChild(n, look);
          };
          look(handler);
          if (found) out.set((nameProp.initializer as ts.StringLiteral).text, found);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(parse(file));
  }
  return out;
}

/** A literal path, or a template whose spans after a '/' are one segment each and whose other spans are a query. */
function pathOf(arg: ts.Expression): string | null {
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text.split('?')[0]!;
  if (!ts.isTemplateExpression(arg)) return null;
  let out = arg.head.text;
  for (const span of arg.templateSpans) {
    out += out.endsWith('/') ? 'X' : '';
    out += span.literal.text;
  }
  return out.split('?')[0]!;
}

function pairs(): { tool: string; route: string; tool_words: string[]; route_words: string[] }[] {
  const all = routes();
  const out: { tool: string; route: string; tool_words: string[]; route_words: string[] }[] = [];
  for (const [tool, call] of toolCalls()) {
    const matches = all.filter((r) => r.verb === call.verb && r.pattern.test(call.path)).sort((a, b) => b.literals - a.literals);
    const route = matches[0];
    if (!route) continue;
    out.push({ tool, route: route.id, tool_words: toolScopeWords(TOOL_SCOPES[tool]).sort(), route_words: [...new Set(route.words)].sort() });
  }
  return out;
}

/**
 * The pairs that differ today, seeded 2026-10-05. LOOKUP means the handler's first call reads
 * something before the call the tool is about, so the pairing is not the tool's route. UNREVIEWED
 * means the tool is offered without a word its route asks: on the node's own MCP the tool may call a
 * service that asks nothing, so the two surfaces disagree, and which side is right is a decision
 * nobody has made yet. Triage replaces UNREVIEWED with the answer, or fixes the entry and deletes it.
 */
const KNOWN: Record<string, string> = {
  aimeat_workspace_write: 'LOOKUP: reads the workspace to find the section before it writes.',
  aimeat_workspace_object_delete: 'LOOKUP: lists the memory keys of the object before it deletes them.',
  aimeat_offer_price_set: 'LOOKUP: reads the agent\'s offers before it sets the price.',
  aimeat_app_tools_publish: 'UNREVIEWED: the tool asks commerce:sell; the memory write it runs on asks memory:write.',
  aimeat_dm_send_as_owner: 'UNREVIEWED: the tool asks messages:send-as-owner; POST /v1/messages asks messages:send as well.',
  aimeat_operator_agent_configure: 'UNREVIEWED: the tool asks agent:permissions; PATCH /v1/agents/:name/mode asks agent:write.',
  aimeat_workspace_transfer: 'UNREVIEWED: the tool asks organism:write; the export it starts with asks organism:read.',
  aimeat_cortex_list: 'UNREVIEWED',
  aimeat_appdev_overview: 'UNREVIEWED',
  aimeat_appdev_pitfall_list: 'UNREVIEWED',
  aimeat_app_template_list: 'UNREVIEWED',
  aimeat_app_template_get: 'UNREVIEWED',
  aimeat_mail_send: 'UNREVIEWED: the tool asks connections:use; POST /v1/outbound/send asks outbound:send.',
  aimeat_datapackage_publish: 'UNREVIEWED: the route asks memory:write as well as storage:write.',
  aimeat_catalogue_directory: 'UNREVIEWED',
  aimeat_group_list: 'UNREVIEWED',
  aimeat_group_get: 'UNREVIEWED',
  aimeat_instance_status: 'UNREVIEWED',
  aimeat_organism_overview: 'UNREVIEWED',
  aimeat_organism_export: 'UNREVIEWED',
  aimeat_organism_search: 'UNREVIEWED',
  aimeat_workspace_comments: 'UNREVIEWED',
  aimeat_workspace_rows_delete: 'UNREVIEWED: the route asks organism:write as well as memory:purge.',
  aimeat_workspace_read: 'UNREVIEWED',
  aimeat_workspace_overview: 'UNREVIEWED',
  aimeat_workspace_publish: 'UNREVIEWED: the tool asks memory:write; the route asks organism:write.',
  aimeat_workspace_revert_to_draft: 'UNREVIEWED: the tool asks memory:write; the route asks organism:write.',
  aimeat_package_publish: 'UNREVIEWED: the tool asks app:write; the route asks packages:write.',
  aimeat_skill_list: 'UNREVIEWED',
  aimeat_workflow_pending_inputs: 'UNREVIEWED',
  // Visible since 2026-10-05, when the AI-model dispatch definitions wrote their names out (they had
  // spread them from the catalog, and the pairing reads a literal name; secaudit 2026-10, M3).
  aimeat_ai_policy_set: 'UNREVIEWED: the tool asks memory:write-reserved; the GET /v1/ai/policy it reads first asks ai:use.',
  aimeat_ai_routing_set: 'UNREVIEWED: the tool asks memory:write-reserved; the GET /v1/ai/routing it reads first asks ai:use.',
};

describe('an MCP tool asks the scope words of the route it runs on', () => {
  const all = pairs();

  it('pairs most dispatch entries with a route, so the check is not empty', () => {
    expect(all.length).toBeGreaterThan(150);
  });

  // The direction that shows an agent a tool it cannot use: the route asks a word the tool's entry
  // does not. The other direction (the tool asks more, or the route gates by role or inside its
  // handler) refuses on MCP what REST would refuse anyway, and is not this test's question.
  it('every word a route asks is asked by its tool, or the pair is listed with its reason', () => {
    const differ = all.filter((p) => p.route_words.some((w) => !scopeIsCovered(p.tool_words, w)));
    const fresh = differ.filter((p) => !(p.tool in KNOWN))
      .map((p) => `${p.tool} [${p.tool_words.join(', ')}] → ${p.route} [${p.route_words.join(', ')}]`);
    const stale = Object.keys(KNOWN).filter((t) => !differ.some((p) => p.tool === t));
    expect({ fresh, stale }).toEqual({ fresh: [], stale: [] });
  });
});

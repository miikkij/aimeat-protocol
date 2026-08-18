/**
 * @file appdev.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connector MCP registrations for the AppDev research KB + app-template + IAM tools —
 *   parity with the server MCP (src/mcp/appdev-overview.ts, appdev-pitfalls.ts, appdev-proofs.ts,
 *   app-template-proposals.ts, services/iam) so `aimeat connect serve --surface appdev|agent` exposes
 *   the same set locally. Thin REST proxies: dedicated /v1/appdev/* routes where they exist, and the
 *   generic POST /v1/memory (memory:write authz unchanged) for the report/propose/proof memory records
 *   the server MCP writes directly (the manifest side-index those tools also maintain is a server-only
 *   nicety the shell path skips). The proof attach reads before it writes, because that ledger is
 *   append-only. iam_define is pure-local computation (no node round-trip).
 * @structure registerAppdevTools() -- one mcp.tool() per appdev capability. The proof attach delegates
 *   to attachProofOverHttp() in tool-call-defs-apps.ts, which the shell path calls as well.
 * @usage registerAppdevTools(mcp, registry);
 * @version-history
 *   v1.1.0 -- 2026-08-11 -- proof_attach takes the node's own parameters (subject_type, verdict,
 *     evidence, test_set, tokens) and appends a ContributionProof to the ledger instead of setting a
 *     one-entry array in a shape the reader ignores. The append itself is shared with the shell door.
 *   v1.0.0 -- 2026-07-19 -- Initial: appdev_overview, pitfall report/list/delete, proof_attach,
 *     app_template propose/list/get/delete, iam_define — connector-surface coverage.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';
import { defineAppIam } from '../../../../services/iam/define-app-iam.js';
import type { LevelDef } from '../../../../services/iam/model.js';
import type { CommandDef } from '../../../../services/iam/app-commands.js';
import { attachProofOverHttp } from '../../tool-call-defs-apps.js';

const kebab = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export function registerAppdevTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();
  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });

  mcp.tool('aimeat_appdev_overview', descriptionFor('aimeat_appdev_overview'), {
    model: z.string().optional().describe('Indicative model filter for proofs + learned pitfalls.'),
    sections: z.string().optional().describe('Comma-separated section filter (apps,library_packs,templates,pitfalls,...).'),
  }, annotationsFor('aimeat_appdev_overview'), async ({ model, sections }) => {
    const params = new URLSearchParams();
    if (model) params.set('model', model);
    if (sections) params.set('sections', sections);
    const qs = params.toString();
    return out(await client.get(`/v1/appdev/overview${qs ? '?' + qs : ''}`));
  });

  mcp.tool('aimeat_appdev_pitfall_list', descriptionFor('aimeat_appdev_pitfall_list'), {
    include_shared: z.boolean().optional().describe('Also include other owners\' public-shared entries.'),
  }, annotationsFor('aimeat_appdev_pitfall_list'), async ({ include_shared }) => {
    return out(await client.get(`/v1/appdev/pitfalls/learned${include_shared ? '?include_shared=1' : ''}`));
  });

  mcp.tool('aimeat_appdev_pitfall_delete', descriptionFor('aimeat_appdev_pitfall_delete'), {
    category: z.string().describe('Kebab-case category.'),
    slug: z.string().describe('Kebab-case slug.'),
  }, annotationsFor('aimeat_appdev_pitfall_delete'), async ({ category, slug }) => {
    return out(await client.delete(`/v1/appdev/pitfalls/learned/${encodeURIComponent(category)}/${encodeURIComponent(slug)}`));
  });

  // Report/upsert a learned pitfall — the server MCP writes the knowledge record + manifest directly;
  // the connector writes the same owner memory record via POST /v1/memory (manifest side-index skipped).
  mcp.tool('aimeat_appdev_pitfall_report', descriptionFor('aimeat_appdev_pitfall_report'), {
    model: z.string().describe('YOUR OWN model id (self-identify; indicative).'),
    category: z.string().describe('Kebab-case category (auth, ext, cortex, ...).'),
    title: z.string().describe('Short imperative title.'),
    symptom: z.string().describe('What the builder observes.'),
    resolution: z.string().describe('What to do instead.'),
    slug: z.string().optional().describe('Stable kebab-case slug (derived from title when omitted).'),
    applies_to: z.array(z.string()).optional().describe('Areas this applies to.'),
    severity: z.enum(['info', 'warn', 'critical']).optional().describe('Default warn.'),
    status: z.enum(['active', 'outdated']).optional().describe('Default active.'),
    app_ref: z.string().optional().describe('Related app owner/filename.html.'),
    share: z.boolean().optional().describe('true = publish platform-wide (public).'),
  }, annotationsFor('aimeat_appdev_pitfall_report'), async ({ model, category, title, symptom, resolution, slug, applies_to, severity, status, app_ref, share }) => {
    const cat = kebab(category);
    const slg = kebab(slug ?? title);
    const appliesTo = (applies_to ?? []).map(a => a.toLowerCase());
    const value: Record<string, unknown> = {
      title, symptom, resolution, model: model.trim().toLowerCase(), category: cat, slug: slg,
      applies_to: appliesTo, severity: severity ?? 'warn', status: status ?? 'active', updated: new Date().toISOString(),
      ...(app_ref ? { app_ref } : {}),
    };
    return out(await client.post('/v1/memory', {
      key: `packages/appdev-pitfalls/${cat}/${slg}`,
      value,
      visibility: share === true ? 'public' : 'owner',
      tags: ['knowledge-entry', 'pitfall', `model:${model.trim().toLowerCase()}`, ...appliesTo.map(a => `applies:${a}`)],
    }));
  });

  // Attach a self-reported acceleration proof. The capability is services/contribution-proofs.ts and
  // has no REST route, so both connector doors run the same append over /v1/memory: attachProofOverHttp().
  mcp.tool('aimeat_appdev_proof_attach', descriptionFor('aimeat_appdev_proof_attach'), {
    subject_type: z.enum(['library_pack', 'app_template']).describe('library_pack = a COMMUNITY pack you own (your public cortex lib); app_template = one of your template proposals.'),
    subject_id: z.string().min(1).max(80).describe('The community pack id (cortex name) or template proposal id.'),
    model: z.string().min(1).max(64).describe('YOUR OWN model id (self-identify; indicative).'),
    verdict: z.enum(['pass', 'fail']).describe('Did the pack or template accelerate the run. Honest fails make your passes credible.'),
    evidence: z.string().min(3).max(500).describe('URL or node storage/memory ref pointing at the run evidence.'),
    test_set: z.string().max(120).optional().describe('Repeatable test-set identifier, when one was used.'),
    tokens: z.number().int().min(0).optional().describe('Output tokens the run consumed, when known.'),
  }, annotationsFor('aimeat_appdev_proof_attach'), async ({ subject_type, subject_id, model, verdict, evidence, test_set, tokens }) => {
    return out(await attachProofOverHttp(client, {
      subjectType: subject_type, subjectId: subject_id, model, verdict, evidence, testSet: test_set, tokens,
    }));
  });

  mcp.tool('aimeat_app_template_list', descriptionFor('aimeat_app_template_list'), {}, annotationsFor('aimeat_app_template_list'), async () => {
    return out(await client.get('/v1/appdev/templates'));
  });

  mcp.tool('aimeat_app_template_get', descriptionFor('aimeat_app_template_get'), {
    id: z.string().describe('Template id.'),
  }, annotationsFor('aimeat_app_template_get'), async ({ id }) => {
    return out(await client.get(`/v1/appdev/templates/${encodeURIComponent(id)}`));
  });

  mcp.tool('aimeat_app_template_delete', descriptionFor('aimeat_app_template_delete'), {
    id: z.string().describe('Template id.'),
  }, annotationsFor('aimeat_app_template_delete'), async ({ id }) => {
    return out(await client.delete(`/v1/appdev/templates/${encodeURIComponent(id)}`));
  });

  // Propose/upsert an app template — server MCP validates + writes template.catalog.{id}.manifest;
  // the connector writes that same owner memory record via POST /v1/memory.
  mcp.tool('aimeat_app_template_propose', descriptionFor('aimeat_app_template_propose'), {
    id: z.string().describe('Stable kebab-case template id (re-proposing updates it).'),
    title: z.string().describe('Template title.'),
    description: z.string().describe('What this template is for.'),
    owner: z.string().describe('Your own owner name (source app owner).'),
    filename: z.string().describe('The published app this template distills.'),
    tier: z.enum(['T1', 'T2', 'T3']).optional().describe('T1 pure client · T2 +cortex · T3 +extension.'),
    reuse_notes: z.string().describe('What generalizes — the parts a next build should keep.'),
    model: z.string().describe('YOUR OWN model id (self-identify; indicative).'),
    tags: z.array(z.string()).optional().describe('Optional tags.'),
    start_mode: z.enum(['fork', 'scaffold', 'either']).optional().describe('How the next build should start (default either).'),
  }, annotationsFor('aimeat_app_template_propose'), async ({ id, title, description, owner, filename, tier, reuse_notes, model, tags, start_mode }) => {
    const value = {
      id, title, description, derivedFrom: { owner, filename }, tier: tier ?? 'T1',
      reuseNotes: reuse_notes, model: model.trim().toLowerCase(), tags: tags ?? [], startMode: start_mode ?? 'either',
      updatedAt: new Date().toISOString(),
    };
    return out(await client.post('/v1/memory', { key: `template.catalog.${id}.manifest`, value, visibility: 'owner', tags: ['app-template'] }));
  });

  // iam_define is pure-local: validate + design an app IAM level/command schema (no node round-trip).
  mcp.tool('aimeat_iam_define', descriptionFor('aimeat_iam_define'), {
    app_id: z.string().optional().describe('Optional app id the schema is for.'),
    levels: z.array(z.record(z.string(), z.unknown())).describe('Level definitions.'),
    commands: z.array(z.record(z.string(), z.unknown())).describe('Command definitions.'),
  }, annotationsFor('aimeat_iam_define'), async ({ app_id, levels, commands }) => {
    const result = defineAppIam({ appId: app_id, levels: levels as unknown as LevelDef[], commands: commands as unknown as CommandDef[] });
    const isError = (result as { ok?: boolean }).ok === false;
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], ...(isError ? { isError: true } : {}) };
  });
}

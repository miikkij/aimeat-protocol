/**
 * @file crew-def-schemas.ts
 * @description Zod validation for the DECLARATIVE crew-def documents an app manifest may carry
 *   under `cortex.agents` (Agent-Bundled Apps, Slice 1). A crew-def is the crewaimeat crew_def
 *   JSON shape (agents/tasks/tool-names/llm-profile/skills) — DATA, never code. The node only
 *   VALIDATES it at app publish and routes a pointer (app_id) to the owner's own fleet; execution
 *   and tool/skill allow-listing are the fleet's job (crewaimeat forge_catalog). Shared contract:
 *   crewaimeat Internal workspace, plan doc "Agent-Bundled Apps — self-hosted (own-fleet)".
 * @structure
 *   - CrewDefSchema / CortexAgentsSchema — the document + the manifest carrier array
 *   - validateCortexAgents() — publish-gate helper returning readable errors (fail-loud)
 *   - slugifyAppId() / deployedAgentName() — the shared deployed-name derivation
 * @usage
 *   const check = validateCortexAgents(req.body.cortex?.agents);
 *   if (!check.ok) return res.status(400).json(error(..., check.errors.join('; ')));
 * @version-history
 *   v1.0.0 — 2026-07-16 — Initial creation (Agent-Bundled Apps Slice 1, node side)
 */
import { z } from 'zod';

/**
 * One crew member. `tools`/`skills` are NAMES resolved fleet-side against the vetted
 * forge_catalog / local skills dir — the node validates only shape + a safe charset.
 */
const CrewAgentSchema = z.object({
  role: z.string().min(1).max(256),
  goal: z.string().min(1).max(4000),
  backstory: z.string().max(8000).optional().default(''),
  tools: z.array(z.string().regex(/^[a-z0-9_-]{1,64}$/, 'tool names are lowercase alphanumeric with _ or -')).max(16).optional(),
  skills: z.array(z.string().min(1).max(128)).max(20).optional(),
  allow_delegation: z.boolean().optional(),
});

/** One crew task. `agent` references a CrewAgentSchema role; `context` references earlier task ids. */
const CrewTaskSchema = z.object({
  id: z.string().min(1).max(128).optional(),
  description: z.string().min(1).max(10_000),
  expected_output: z.string().min(1).max(4000),
  agent: z.string().min(1).max(256),
  context: z.array(z.string().min(1).max(128)).max(20).optional(),
  async: z.boolean().optional(),
});

/**
 * A self-contained declarative crew-def (crewaimeat crew_def.py shape). Unknown top-level
 * keys are passed through so crewaimeat can extend the schema without breaking older nodes;
 * every KNOWN field is validated strictly. `agent_name` is capped at 32 chars so the fleet's
 * deployed name (`<agent_name>-<slug(app_id)>`, ≤64) still fits the node's agent-name limit.
 */
export const CrewDefSchema = z.object({
  agent_name: z.string().regex(/^[a-z0-9][a-z0-9-]{2,31}$/,
    'agent_name must be 3-32 lowercase alphanumeric characters with hyphens'),
  readme_md: z.string().max(20000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  llm_profile: z.string().min(1).max(64).optional(),
  tags: z.array(z.string().min(1).max(64)).max(20).optional(),
  capabilities: z.record(z.string(), z.unknown()).optional(),
  offers: z.array(z.unknown()).max(20).optional(),
  skills: z.array(z.string().min(1).max(128)).max(20).optional(),
  agents: z.array(CrewAgentSchema).min(1).max(10),
  tasks: z.array(CrewTaskSchema).min(1).max(20),
  process: z.enum(['sequential', 'hierarchical']).optional(),
  signals: z.record(z.string(), z.unknown()).optional(),
}).passthrough().superRefine((doc, ctx) => {
  // At least one task must inject the runtime prompt, or the deployed agent drifts
  // (contract §1: build_domain MUST inject ctx.prompt).
  if (!doc.tasks.some(t => t.description.includes('{{ctx.prompt}}'))) {
    ctx.addIssue({
      code: 'custom',
      path: ['tasks'],
      message: 'at least one task description must inject {{ctx.prompt}}',
    });
  }
  // Referential integrity: every task.agent names a declared agent role; every
  // context entry references an EARLIER task's id (a DAG, no forward/unknown refs).
  const roles = new Set(doc.agents.map(a => a.role));
  const seenTaskIds = new Set<string>();
  doc.tasks.forEach((t, i) => {
    if (!roles.has(t.agent)) {
      ctx.addIssue({
        code: 'custom',
        path: ['tasks', i, 'agent'],
        message: `task references unknown agent role "${t.agent}"`,
      });
    }
    for (const ref of t.context ?? []) {
      if (!seenTaskIds.has(ref)) {
        ctx.addIssue({
          code: 'custom',
          path: ['tasks', i, 'context'],
          message: `context references "${ref}" which is not the id of an earlier task`,
        });
      }
    }
    if (t.id) seenTaskIds.add(t.id);
  });
});

export type CrewDef = z.infer<typeof CrewDefSchema>;

/** The manifest carrier: `cortex.agents` is a list of crew-defs with unique agent_names. */
export const CortexAgentsSchema = z.array(CrewDefSchema).max(5).superRefine((agents, ctx) => {
  const seen = new Set<string>();
  agents.forEach((a, i) => {
    if (seen.has(a.agent_name)) {
      ctx.addIssue({
        code: 'custom',
        path: [i, 'agent_name'],
        message: `duplicate agent_name "${a.agent_name}"`,
      });
    }
    seen.add(a.agent_name);
  });
});

/**
 * Publish-gate validation. Returns the parsed crew-defs on success, or every problem as a
 * readable `path: message` list on failure — the publish route surfaces these verbatim so a
 * malformed agents[] never reaches a fleet (fail-loud, contract §5).
 */
export function validateCortexAgents(agents: unknown):
  { ok: true; agents: CrewDef[] } | { ok: false; errors: string[] } {
  const parsed = CortexAgentsSchema.safeParse(agents);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(i => `cortex.agents${i.path.length ? '.' + i.path.join('.') : ''}: ${i.message}`),
    };
  }
  return { ok: true, agents: parsed.data };
}

/**
 * The shared slug rule (contract §3.4): lowercase, every run of chars outside [a-z0-9]
 * collapses to a single '-', trimmed. Both node and fleet derive the SAME deployed name
 * from it — change only in lockstep with crewaimeat's app_deploy.
 */
export function slugifyAppId(appId: string): string {
  return appId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * The fleet's deployed-agent name for a crew-def deployed from an app:
 * `<agent_name>-<slug(app_id)>`, truncated to the node's 64-char agent-name cap
 * (trailing hyphens trimmed after the cut).
 */
export function deployedAgentName(agentName: string, appId: string): string {
  return `${agentName}-${slugifyAppId(appId)}`.slice(0, 64).replace(/-+$/g, '');
}

/**
 * @file define-app-iam.ts
 * @description P5 slice 3: the "AI-accelerated app-permission design" core behind the MCP
 *   aimeat_iam_define tool. Validates a proposed app IAM design — a level schema (BBS ordinal levels →
 *   app capabilities) + a command manifest (commands → capability + mutation tier) — against the shared
 *   primitives, computes the level→command matrix (which levels may run which commands, and which need
 *   confirmation), and returns ready-to-apply aimeat-iam admin payloads (setRoles / setLevels /
 *   setCommands) so the agent applies the design to the sovereign extension via aimeat_extension_invoke.
 *   PURE + node-side: no storage, no extension invocation, no authz (the ext's admin already gates
 *   owner-only) — so the tool cannot itself change any app's live state; it designs + validates.
 * @structure
 *   - defineAppIam(input) → { ok, schema, matrix, apply } | { ok:false, error }
 * @usage const r = defineAppIam({ appId, levels, commands });
 * @version-history
 *   v1.0.0 — 2026-07-02 — IAM P5 slice 3: validate + level→command matrix + apply-payloads.
 */
import type { LevelSchema, LevelDef } from './model.js';
import { validateCommandManifest, deriveAppCommandDecision, type CommandDef } from './app-commands.js';
import { generateIamExtension, type GeneratedExtension } from './generate-extension.js';

export interface DefineAppIamInput {
  /** `owner/file.html` to also GENERATE the installable gate; a bare label only validates. */
  appId?: string;
  levels: LevelDef[];
  commands: CommandDef[];
  author?: string;
}

/**
 * Lenient app level-schema validation: non-empty; integer ordinals >= 0; unique ordinals + keys; string
 * capabilities; and a level 0 holding '*' (all) as the lockout guard. App capabilities are free strings
 * (unlike the fixed platform set), so only '*' at level 0 is required.
 */
function validateAppLevels(levels: unknown): { ok: true } | { ok: false; error: string } {
  if (!Array.isArray(levels) || levels.length === 0) return { ok: false, error: 'levels must be a non-empty array' };
  const ords = new Set<number>();
  const keys = new Set<string>();
  for (const l of levels as LevelDef[]) {
    if (typeof l?.level !== 'number' || !Number.isInteger(l.level) || l.level < 0) return { ok: false, error: 'each level needs an integer ordinal >= 0' };
    if (typeof l.key !== 'string' || !l.key.trim()) return { ok: false, error: 'each level needs a non-empty key' };
    if (typeof l.label !== 'string' || !l.label.trim()) return { ok: false, error: 'each level needs a non-empty label' };
    if (!Array.isArray(l.capabilities) || l.capabilities.some(c => typeof c !== 'string')) return { ok: false, error: 'capabilities must be strings' };
    if (ords.has(l.level)) return { ok: false, error: `duplicate level ordinal ${l.level}` };
    if (keys.has(l.key)) return { ok: false, error: `duplicate level key "${l.key}"` };
    ords.add(l.level); keys.add(l.key);
  }
  const zero = (levels as LevelDef[]).find(l => l.level === 0);
  if (!zero || !zero.capabilities.includes('*')) return { ok: false, error: "a level 0 holding '*' (all) is required to prevent lockout" };
  return { ok: true };
}

export type DefineAppIamResult =
  | { ok: false; error: string }
  | {
      ok: true;
      schema: LevelSchema;
      commands: CommandDef[];
      /** Per level key: the command ids it may run + those needing human confirmation. */
      matrix: Record<string, { canRun: string[]; needsConfirmation: string[] }>;
      /** Ready-to-apply aimeat-iam `admin` payloads — send each to the ext's admin action in order. */
      apply: Array<Record<string, unknown>>;
      /**
       * The INSTALLABLE gate, when an appId was given. This is the point of the tool: a design that
       * only returns payloads still leaves somebody forking a package and editing JavaScript, which
       * is how six gates on this node came to disagree. Install it with PUT /v1/extensions/{name}.
       */
      extension?: GeneratedExtension;
    };

/**
 * Validate an app IAM design + compute its level→command matrix + emit the admin payloads to apply it.
 * The app level schema is a LevelSchema with groupType 'app'; a level's `capabilities` map to iam.roles,
 * its `level` to iam.levels, and the manifest to iam.commands.
 */
export function defineAppIam(input: DefineAppIamInput): DefineAppIamResult {
  const lv = validateAppLevels(input?.levels);
  if (!lv.ok) return { ok: false, error: `levels: ${lv.error}` };
  const cm = validateCommandManifest({ appId: input.appId || 'app', commands: input?.commands });
  if (!cm.ok) return { ok: false, error: `commands: ${cm.error}` };

  const schema: LevelSchema = { groupType: 'app', name: `${input.appId || 'app'}-levels`, levels: input.levels };
  const iamRoles: Record<string, string[]> = {};
  const iamLevels: Record<string, number> = {};
  for (const l of input.levels) { iamRoles[l.key] = l.capabilities; iamLevels[l.key] = l.level; }

  const matrix: Record<string, { canRun: string[]; needsConfirmation: string[] }> = {};
  for (const l of input.levels) {
    const canRun: string[] = [];
    const needsConfirmation: string[] = [];
    for (const c of input.commands) {
      const d = deriveAppCommandDecision(l.level, schema, { appId: schema.name, commands: input.commands }, c.id);
      if (d.allowed) { canRun.push(c.id); if (d.needsConfirmation) needsConfirmation.push(c.id); }
    }
    matrix[l.key] = { canRun, needsConfirmation };
  }

  return {
    ok: true, schema, commands: input.commands, matrix,
    // Only when the design names the app it gates: without that the node cannot resolve a caller's
    // membership, and a generated gate would answer "no role" to everyone forever.
    ...(input.appId && input.appId.includes('/')
      ? { extension: generateIamExtension({ appId: input.appId, levels: input.levels, commands: input.commands, author: input.author }) }
      : {}),
    apply: [
      { op: 'setRoles', roles: iamRoles },
      { op: 'setLevels', levels: iamLevels },
      { op: 'setCommands', commands: input.commands },
    ],
  };
}

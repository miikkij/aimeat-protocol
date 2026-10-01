/**
 * @file define-app-iam.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description P5 slice 3: the "AI-accelerated app-permission design" core behind the MCP
 *   aimeat_iam_define tool. Validates a proposed app IAM design — a level schema (BBS ordinal levels →
 *   app capabilities) + a command manifest (commands → capability + mutation tier) — against the shared
 *   primitives, computes the level→command matrix (which levels may run which commands, and which need
 *   confirmation), and returns two ways to apply it: when the app id names an app (`owner/file`), an
 *   installable generated gate (`extension`, see generate-extension.ts); and always, admin payloads
 *   (setRoles / setLevels / setCommands) for an install of the aimeat-iam package, whose `admin`
 *   action takes them. PURE + node-side: no storage, no extension invocation, no authz, so the tool
 *   cannot itself change any app's live state; it designs + validates.
 * @structure
 *   - defineAppIam(input) → { ok, schema, commands, matrix, apply, extension? } | { ok:false, error }
 * @usage const r = defineAppIam({ appId, levels, commands, defaultRole, version, author, extName });
 * @version-history
 *   v1.1.0 — 2026-10-01 — The matrix and the setRoles payload read the ACCUMULATED ladder
 *     (accumulateCapabilities, the calculation the generated gate enforces), so a matrix no longer tells
 *     an agent that a level may not run a command the gate generated in the same answer allows. The
 *     generator inputs defaultRole, version, author and extName are validated here and reach the
 *     generated extension; the tool exposes them as default_role, version, author and ext_name.
 *     Audit 2026-10-01, defect B.
 *   v1.0.0 — 2026-07-02 — IAM P5 slice 3: validate + level→command matrix + apply-payloads.
 */
import type { LevelSchema, LevelDef } from './model.js';
import { validateCommandManifest, deriveAppCommandDecision, type CommandDef } from './app-commands.js';
import { generateIamExtension, accumulateCapabilities, type GeneratedExtension } from './generate-extension.js';
import { EXT_NAME_PATTERN } from '../extension-manifest.js';

export interface DefineAppIamInput {
  /** `owner/file.html` to also GENERATE the installable gate; a bare label only validates. */
  appId?: string;
  levels: LevelDef[];
  commands: CommandDef[];
  /** Manifest author of the generated gate. Defaults to `generated`. */
  author?: string;
  /** Level key a signed-in caller on no roster row holds in the generated gate. Omitted = nothing. */
  defaultRole?: string;
  /** Manifest version of the generated gate (x.y.z). Defaults to 1.0.0; pass the next one when regenerating. */
  version?: string;
  /** Extension name of the generated gate. Defaults to a slug of the app id plus `-iam`. */
  extName?: string;
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

/** A manifest version the generated YAML can carry as a plain scalar: x.y.z with an optional pre-release. */
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * The four generator inputs, checked before any text is rendered. Each one lands in the generated
 * manifest or script, so a value that is not what it claims to be would produce a gate that refuses
 * to install or, for default_role, one that opens the app wider than the design says.
 */
function validateGeneratorInputs(input: DefineAppIamInput, roles: Record<string, string[]>): string | null {
  if (input.defaultRole !== undefined) {
    if (typeof input.defaultRole !== 'string' || !Object.prototype.hasOwnProperty.call(roles, input.defaultRole)) {
      return `default_role "${String(input.defaultRole)}" is not one of the levels (${Object.keys(roles).join(', ')})`;
    }
    // Every signed-in caller holds the default role, so a default holding '*' makes every signed-in
    // stranger an administrator of the app.
    if (roles[input.defaultRole].includes('*')) {
      return `default_role "${input.defaultRole}" holds "*", which would give every signed-in caller full access; name a level that holds less`;
    }
  }
  if (input.version !== undefined && (typeof input.version !== 'string' || !VERSION_PATTERN.test(input.version))) {
    return 'version must be x.y.z (for example 1.2.0)';
  }
  if (input.extName !== undefined && (typeof input.extName !== 'string' || !EXT_NAME_PATTERN.test(input.extName))) {
    return 'ext_name must be lowercase letters, digits and hyphens, 3 to 128 characters, starting and ending with a letter or digit';
  }
  if (input.author !== undefined && (typeof input.author !== 'string' || !input.author.trim() || input.author.length > 100)) {
    return 'author must be a non-empty string of at most 100 characters';
  }
  return null;
}

export type DefineAppIamResult =
  | { ok: false; error: string }
  | {
      ok: true;
      schema: LevelSchema;
      commands: CommandDef[];
      /**
       * Per level key: the command ids it may run + those needing human confirmation. Computed on the
       * accumulated ladder (a level also holds every weaker level's capabilities), which is what the
       * generated gate enforces and what the setRoles payload stores.
       */
      matrix: Record<string, { canRun: string[]; needsConfirmation: string[] }>;
      /**
       * Payloads for the `admin` action of an aimeat-iam PACKAGE install, in order. The generated
       * gate below has no admin action and needs none: its vocabulary is baked into its scripts.
       */
      apply: Array<Record<string, unknown>>;
      /**
       * The INSTALLABLE gate, when an appId was given. This is the point of the tool: a design that
       * only returns payloads still leaves somebody forking a package and editing JavaScript, which
       * is how six gates on this node came to disagree. Install it with aimeat_extension_install
       * (or PUT /v1/extensions/{name}).
       */
      extension?: GeneratedExtension;
    };

/**
 * Validate an app IAM design + compute its level→command matrix + emit the admin payloads to apply it.
 * The app level schema is a LevelSchema with groupType 'app'; a level's accumulated capabilities map to
 * iam.roles, its `level` to iam.levels, and the manifest to iam.commands.
 */
export function defineAppIam(input: DefineAppIamInput): DefineAppIamResult {
  const lv = validateAppLevels(input?.levels);
  if (!lv.ok) return { ok: false, error: `levels: ${lv.error}` };
  const cm = validateCommandManifest({ appId: input.appId || 'app', commands: input?.commands });
  if (!cm.ok) return { ok: false, error: `commands: ${cm.error}` };

  // The ladder the gate enforces: each level holds its own capabilities plus every weaker level's.
  const iamRoles = accumulateCapabilities(input.levels);
  const generatorError = validateGeneratorInputs(input, iamRoles);
  if (generatorError) return { ok: false, error: generatorError };

  const schema: LevelSchema = { groupType: 'app', name: `${input.appId || 'app'}-levels`, levels: input.levels };
  const iamLevels: Record<string, number> = {};
  for (const l of input.levels) iamLevels[l.key] = l.level;

  // The matrix is decided on the accumulated schema, so it says what the generated gate and an
  // aimeat-iam install loaded with the setRoles payload below will both answer.
  const ladder: LevelSchema = { ...schema, levels: input.levels.map(l => ({ ...l, capabilities: iamRoles[l.key] })) };
  const matrix: Record<string, { canRun: string[]; needsConfirmation: string[] }> = {};
  for (const l of input.levels) {
    const canRun: string[] = [];
    const needsConfirmation: string[] = [];
    for (const c of input.commands) {
      const d = deriveAppCommandDecision(l.level, ladder, { appId: schema.name, commands: input.commands }, c.id);
      if (d.allowed) { canRun.push(c.id); if (d.needsConfirmation) needsConfirmation.push(c.id); }
    }
    matrix[l.key] = { canRun, needsConfirmation };
  }

  return {
    ok: true, schema, commands: input.commands, matrix,
    // Only when the design names the app it gates: without that the node cannot resolve a caller's
    // membership, and a generated gate would answer "no role" to everyone forever.
    ...(input.appId && input.appId.includes('/')
      ? {
          extension: generateIamExtension({
            appId: input.appId, levels: input.levels, commands: input.commands,
            author: input.author, defaultRole: input.defaultRole, version: input.version, extName: input.extName,
          }),
        }
      : {}),
    apply: [
      { op: 'setRoles', roles: iamRoles },
      { op: 'setLevels', levels: iamLevels },
      { op: 'setCommands', commands: input.commands },
    ],
  };
}

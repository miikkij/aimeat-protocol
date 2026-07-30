/**
 * @file generate-extension.ts
 * @description Turn a validated app IAM design into an INSTALLABLE extension — the piece that
 *   changes "fork aimeat-iam and edit the JavaScript" into "declare the spec, get a gate".
 *
 *   Six gates on this node were forks of one package, and every difference between them was
 *   hand-typed: one keyed roles to the acting identity, three shipped empty schemas, all of them
 *   wrote their roster into a world-readable namespace. None of those were decisions; they were
 *   copies that drifted. A generated gate cannot drift, because there is nothing to copy.
 *
 *   The generated extension holds ONLY the capability vocabulary, which is the half that is
 *   genuinely per-app. It keeps no roster and writes no memory at all: the caller's standing arrives
 *   as `ctx.caller.member`, resolved by the node before the sandbox starts. So there is nothing in it
 *   to leak, nothing to keep in step with a second copy of the truth, and a demotion reaches it on
 *   the next call rather than when someone remembers to sync.
 * @structure generateIamExtension(input) → { name, manifest, scripts }
 * @usage const ext = generateIamExtension({ appId, extName, levels, commands });
 * @version-history
 *   v1.0.0 — 2026-07-30 — Initial (TARGET-055 phase 3): the spec becomes the gate.
 */
import type { LevelDef } from './model.js';
import type { CommandDef } from './app-commands.js';

export interface GenerateIamExtensionInput {
  /** `owner/file.html` — the app whose roster the node resolves the caller against. */
  appId: string;
  /** Extension name to install as. Defaults to a slug of the app id plus `-iam`. */
  extName?: string;
  levels: LevelDef[];
  commands: CommandDef[];
  author?: string;
}

export interface GeneratedExtension {
  name: string;
  manifest: string;
  scripts: Record<string, string>;
}

/** A name the install route accepts: lowercase, hyphens, no dots. */
function slug(appId: string): string {
  return String(appId).toLowerCase().replace(/\.html?$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * The gate script. Baked constants rather than memory reads, because the vocabulary IS the spec and
 * a spec that can be edited in two places is a spec that disagrees with itself.
 */
function checkScript(levels: LevelDef[], commands: CommandDef[]): string {
  const roleCaps: Record<string, string[]> = {};
  const roleLevel: Record<string, number> = {};
  for (const l of levels) { roleCaps[l.key] = l.capabilities; roleLevel[l.key] = l.level; }
  return `// GENERATED from this app's IAM spec. Edit the spec and regenerate; hand edits are lost.
const CAPS = ${JSON.stringify(roleCaps)};
const LEVELS = ${JSON.stringify(roleLevel)};
const COMMANDS = ${JSON.stringify(commands)};

export default async function (ctx, input) {
  // The caller's standing arrives already resolved: the node reads the app's roster BEFORE this
  // sandbox starts. This extension keeps no roster of its own, so there is nothing here to leak and
  // nothing to keep in step — a removal is visible on the very next call.
  const caller = ctx.caller || {};
  const isOwner = !!caller.isAppOwner;
  const role = isOwner ? 'owner' : (caller.member ? caller.member.role : null);
  const caps = isOwner ? ['*'] : ((role && CAPS[role]) || []);
  const level = isOwner ? 0 : (role && Object.prototype.hasOwnProperty.call(LEVELS, role) ? LEVELS[role] : null);
  const has = function (cap) { return caps.indexOf('*') !== -1 || caps.indexOf(cap) !== -1; };
  const base = {
    role: role, level: level, caps: caps, isOwner: isOwner,
    // A role always resolves through the PERSON here, because that is how the node keeps the roster.
    via: isOwner ? 'owner' : (caller.member ? 'owner' : 'none'),
    since: caller.member ? caller.member.since : null,
  };

  if (input && input.command) {
    let cmd = null;
    for (let i = 0; i < COMMANDS.length; i++) { if (COMMANDS[i].id === input.command) { cmd = COMMANDS[i]; break; } }
    if (!cmd) return Object.assign({ allowed: false, error: 'unknown command', command: input.command }, base);
    return Object.assign({
      allowed: has(cmd.capability), command: cmd.id, capability: cmd.capability,
      tier: cmd.tier, needsConfirmation: cmd.tier === 'irreversible',
    }, base);
  }
  const permission = input && input.permission;
  if (!permission) return Object.assign({ allowed: false, error: 'permission or command required' }, base);
  return Object.assign({ allowed: has(permission), permission: permission }, base);
}`;
}

/** The discovery script: an agent asks what it may call before calling anything. */
function commandsScript(levels: LevelDef[], commands: CommandDef[]): string {
  const roleCaps: Record<string, string[]> = {};
  for (const l of levels) roleCaps[l.key] = l.capabilities;
  return `// GENERATED from this app's IAM spec. Edit the spec and regenerate; hand edits are lost.
const CAPS = ${JSON.stringify(roleCaps)};
const COMMANDS = ${JSON.stringify(commands)};

export default async function (ctx) {
  // What THIS caller may run, not a catalogue they have to filter themselves. An agent that has to
  // guess which of a list applies to it will guess wrong and be refused mid-task.
  const caller = ctx.caller || {};
  const isOwner = !!caller.isAppOwner;
  const role = isOwner ? 'owner' : (caller.member ? caller.member.role : null);
  const caps = isOwner ? ['*'] : ((role && CAPS[role]) || []);
  const has = function (cap) { return caps.indexOf('*') !== -1 || caps.indexOf(cap) !== -1; };
  return {
    role: role, caps: caps,
    commands: COMMANDS.map(function (c) {
      return { id: c.id, description: c.description, capability: c.capability, tier: c.tier,
               allowed: has(c.capability), needsConfirmation: c.tier === 'irreversible' };
    }),
  };
}`;
}

/**
 * Build the installable extension for one app's IAM design. The design is assumed already validated
 * by defineAppIam; this only renders it.
 */
export function generateIamExtension(input: GenerateIamExtensionInput): GeneratedExtension {
  const name = input.extName || `${slug(input.appId)}-iam`;
  const caps = [...new Set(input.levels.flatMap(l => l.capabilities).filter(c => c !== '*'))];
  const roleKeys = input.levels.map(l => l.key);
  const manifest = [
    'metadata:',
    `  name: ${name}`,
    '  version: 1.0.0',
    `  description: ${JSON.stringify(
      `Capability gate for ${input.appId}. Roles: ${roleKeys.join(', ')}. The NODE keeps who is a member; `
      + 'this keeps what each role may do, and reads the caller\'s role from ctx.caller.member. Generated from the app\'s IAM spec.',
    )}`,
    `  author: ${input.author || 'generated'}`,
    'config:',
    '  app:',
    '    type: string',
    `    default: ${input.appId}`,
    'required_apis:',
    '  - memory',
    'limits:',
    '  memory_mb: 32',
    '  timeout_ms: 5000',
    '  max_api_calls: 20',
    'actions:',
    '  - id: check',
    '    method: POST',
    '    path: /check',
    `    description: ${JSON.stringify(
      'Ask whether the caller may do something: { permission } for a raw capability, or { command } to '
      + 'resolve one of the manifest ids and learn its mutation tier. Any authenticated caller.',
    )}`,
    `    input: { type: object, properties: { permission: { type: string, enum: ${JSON.stringify(caps)} }, command: { type: string, enum: ${JSON.stringify(input.commands.map(c => c.id))} } } }`,
    '    output: { type: object, properties: { allowed: { type: boolean }, role: { type: string }, level: { type: number },'
      + ' caps: { type: array }, isOwner: { type: boolean }, via: { type: string }, since: { type: string },'
      + ' command: { type: string }, capability: { type: string }, tier: { type: string }, needsConfirmation: { type: boolean }, error: { type: string } } }',
    '    script: check.js',
    '  - id: commands',
    '    method: POST',
    '    path: /commands',
    `    description: ${JSON.stringify(
      'What THIS caller may run, with each command already marked allowed or not and flagged when a '
      + 'human should confirm it. Read this before calling anything.',
    )}`,
    '    input: { type: object, properties: {} }',
    '    output: { type: object, properties: { role: { type: string }, caps: { type: array }, commands: { type: array } } }',
    '    script: commands.js',
  ].join('\n');

  return {
    name,
    manifest,
    scripts: {
      'check.js': checkScript(input.levels, input.commands),
      'commands.js': commandsScript(input.levels, input.commands),
    },
  };
}

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
  /**
   * Manifest version to publish as. Defaults to 1.0.0, which is right for a NEW gate and wrong for a
   * regenerated one: NUOTTA's went 1.4.0 -> 1.0.0 and read in the extension list as a rollback.
   * Regenerating over a live gate should pass the next version.
   */
  version?: string;
  /**
   * What a signed-in caller who is on no roster row holds. Omitted means nothing, which is right for
   * a members-only app. An app with a public tier needs it: NUOTTA lets anyone read its guides and
   * only charges for the corpus, and a gate that cannot say that would have shut the front door on
   * every visitor the moment its roster moved to the node.
   */
  defaultRole?: string;
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
 * Capabilities ACCUMULATE down the ladder: a role holds its own plus everything every weaker role
 * holds. Levels are BBS ordinals — lower is more power — so "weaker" means a higher number.
 *
 * This is not a convenience. NUOTTA declared guest:['guides'] and member:[...everything else], and a
 * literal reading gave the paying member no access to the introduction and the scoring maths that a
 * passer-by could read. Nobody decided that; it fell out of listing each tier separately, which is
 * how anyone would write it. A tier that is above another and holds less is a bug every time, so the
 * generator resolves it once here rather than asking each app to remember.
 */
function accumulate(levels: LevelDef[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const role of levels) {
    if (role.capabilities.includes('*')) { out[role.key] = ['*']; continue; }
    const acc = new Set(role.capabilities);
    for (const weaker of levels) {
      if (weaker.level > role.level) for (const c of weaker.capabilities) if (c !== '*') acc.add(c);
    }
    out[role.key] = [...acc];
  }
  return out;
}

/**
 * The gate script. Baked constants rather than memory reads, because the vocabulary IS the spec and
 * a spec that can be edited in two places is a spec that disagrees with itself.
 */
function checkScript(levels: LevelDef[], commands: CommandDef[], defaultRole?: string): string {
  const roleCaps = accumulate(levels);
  const roleLevel: Record<string, number> = {};
  for (const l of levels) roleLevel[l.key] = l.level;
  return `// GENERATED from this app's IAM spec. Edit the spec and regenerate; hand edits are lost.
// CAPS is already ACCUMULATED: each role holds its own plus every weaker role's. A tier that sits
// above another and holds less of it is a bug, so the ladder is resolved once at generation.
const CAPS = ${JSON.stringify(roleCaps)};
const LEVELS = ${JSON.stringify(roleLevel)};
const COMMANDS = ${JSON.stringify(commands)};
// What somebody signed in but on no roster row holds. null is a members-only app.
const DEFAULT_ROLE = ${JSON.stringify(defaultRole ?? null)};

export default async function (ctx, input) {
  // The caller's standing arrives already resolved: the node reads the app's roster BEFORE this
  // sandbox starts. This extension keeps no roster of its own, so there is nothing here to leak and
  // nothing to keep in step — a removal is visible on the very next call.
  const caller = ctx.caller || {};
  const isOwner = !!caller.isAppOwner;
  // A signed-in stranger falls to DEFAULT_ROLE, so an app with a public tier keeps it. Anyone with
  // no principal at all falls to nothing, whatever the default says: a default is what a KNOWN
  // caller holds, and reading it as "and everybody else too" would open the app to the world.
  const member = caller.member || null;
  const signedIn = !!(caller.gaii || caller.owner);
  const role = isOwner ? 'owner' : (member ? member.role : (signedIn ? DEFAULT_ROLE : null));
  const caps = isOwner ? ['*'] : ((role && CAPS[role]) || []);
  const level = isOwner ? 0 : (role && Object.prototype.hasOwnProperty.call(LEVELS, role) ? LEVELS[role] : null);
  const has = function (cap) { return caps.indexOf('*') !== -1 || caps.indexOf(cap) !== -1; };
  const base = {
    role: role, level: level, caps: caps, isOwner: isOwner, member: !!member,
    // A role always resolves through the PERSON here, because that is how the node keeps the roster.
    via: isOwner ? 'owner' : (member ? 'owner' : (role ? 'default' : 'none')),
    since: member ? member.since : null,
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
function commandsScript(levels: LevelDef[], commands: CommandDef[], defaultRole?: string): string {
  const roleCaps = accumulate(levels);
  return `// GENERATED from this app's IAM spec. Edit the spec and regenerate; hand edits are lost.
const CAPS = ${JSON.stringify(roleCaps)};
const COMMANDS = ${JSON.stringify(commands)};
const DEFAULT_ROLE = ${JSON.stringify(defaultRole ?? null)};

export default async function (ctx) {
  // What THIS caller may run, not a catalogue they have to filter themselves. An agent that has to
  // guess which of a list applies to it will guess wrong and be refused mid-task.
  const caller = ctx.caller || {};
  const isOwner = !!caller.isAppOwner;
  const signedIn = !!(caller.gaii || caller.owner);
  const role = isOwner ? 'owner' : (caller.member ? caller.member.role : (signedIn ? DEFAULT_ROLE : null));
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
 * The vocabulary, answered by the gate rather than retyped by every client.
 *
 * Without this the owner's panel had no way to know which roles exist, so the app had to pass them
 * to the library by hand — and when NUOTTA did not, the role select rendered empty and Approve posted
 * no role at all, which the node refused with a 400. A gate that knows its own roles should say so.
 */
function rolesScript(levels: LevelDef[], commands: CommandDef[], defaultRole?: string): string {
  const roleCaps = accumulate(levels);
  const roleLevel: Record<string, number> = {};
  for (const l of levels) roleLevel[l.key] = l.level;
  const labels: Record<string, string> = {};
  for (const l of levels) labels[l.key] = l.label;
  return `// GENERATED from this app's IAM spec. Edit the spec and regenerate; hand edits are lost.
const CAPS = ${JSON.stringify(roleCaps)};
const LEVELS = ${JSON.stringify(roleLevel)};
const LABELS = ${JSON.stringify(labels)};
const COMMANDS = ${JSON.stringify(commands)};
const DEFAULT_ROLE = ${JSON.stringify(defaultRole ?? null)};

export default async function () {
  // No caller check: a capability VOCABULARY is not personal data, and a visitor deciding whether to
  // ask for access needs to see what the tiers are. Who holds which role is the node's roster, and
  // that stays private.
  const assignable = Object.keys(CAPS).filter(function (r) { return r !== DEFAULT_ROLE; });
  return {
    roles: CAPS, levels: LEVELS, labels: LABELS, defaultRole: DEFAULT_ROLE,
    // What an owner may hand OUT, which is not the same as what exists: approving somebody into the
    // role they already hold by default is an act with no effect.
    assignable: assignable,
    capabilities: Object.keys(CAPS).reduce(function (acc, r) {
      CAPS[r].forEach(function (c) { if (c !== '*' && acc.indexOf(c) === -1) acc.push(c); });
      return acc;
    }, []),
    commands: COMMANDS.map(function (c) {
      return { id: c.id, description: c.description, capability: c.capability, tier: c.tier };
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
  // Every capability the gate can be ASKED about, which is not the same as the ones a role lists.
  // NOSTE's commands name `adjust` and `configure` that only the wildcard role holds, so reading the
  // enum off the roles alone would have advertised a gate that cannot be asked about two of its own
  // commands — and an enum is the only thing an agent has to go on.
  const caps = [...new Set([
    ...input.levels.flatMap(l => l.capabilities),
    ...input.commands.map(c => c.capability),
  ].filter(c => c !== '*'))];
  const roleKeys = input.levels.map(l => l.key);
  const manifest = [
    'metadata:',
    `  name: ${name}`,
    `  version: ${input.version || '1.0.0'}`,
    `  description: ${JSON.stringify(
      `Capability gate for ${input.appId}. Roles: ${roleKeys.join(', ')}. `
      + (input.defaultRole
        ? `Anyone signed in who is on no roster row holds "${input.defaultRole}". `
        : 'Anyone signed in who is on no roster row holds nothing. ')
      + 'The NODE keeps who is a member; '
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
    '  - id: roles',
    '    method: POST',
    '    path: /roles',
    `    description: ${JSON.stringify(
      'The role vocabulary this gate enforces: every role with its capabilities, level and label, '
      + 'which of them an owner may hand out, and what a signed-in stranger holds. Read this to build '
      + 'an approval UI instead of hardcoding role names. Any signed-in caller: a vocabulary is not '
      + 'personal data, and who holds which role stays on the node roster. (This node authenticates '
      + 'every extension call, so that means "not owner-only", not "anonymous".)',
    )}`,
    '    input: { type: object, properties: {} }',
    '    output: { type: object, properties: { roles: { type: object }, levels: { type: object }, labels: { type: object },'
      + ' defaultRole: { type: string }, assignable: { type: array }, capabilities: { type: array }, commands: { type: array } } }',
    '    script: roles.js',
  ].join('\n');

  return {
    name,
    manifest,
    scripts: {
      'check.js': checkScript(input.levels, input.commands, input.defaultRole),
      'commands.js': commandsScript(input.levels, input.commands, input.defaultRole),
      'roles.js': rolesScript(input.levels, input.commands, input.defaultRole),
    },
  };
}

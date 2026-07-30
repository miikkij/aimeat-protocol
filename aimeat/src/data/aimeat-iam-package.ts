/**
 * @file aimeat-iam-package.ts
 * @description Installable package definition for "aimeat-iam" — an in-app role & permission
 *   (RBAC) system for an app OWNER to manage other users' rights. Delivered as a package
 *   (like digital-signage): installing it registers a per-instance copy of each component,
 *   scoped `aimeat-iam-{owner}-{shortId}-{componentId}`.
 *
 *   Components (lean):
 *     - extension `iam` — server-side enforcement + sovereign state (ext:{name} memory).
 *         actions: check {permission | command} → {allowed, role, level, tier?, needsConfirmation?}
 *                    (any authed caller — command mode resolves an app command's capability + mutation tier)
 *                  admin {op,…} → owner-only multiplexed
 *                    (claim/getState/setConfig/setRoles/setLevels/setCommands/assign/revoke)
 *     - app `iam-dashboard` — the owner's UI: role→permission matrix editor, user assignments,
 *         configurable default role, a "tell your AI" usage snippet, and a live permission tester.
 *
 *   Decisions: per-app package · memory-key storage owned by the extension · configurable
 *   default role · no relationship to app-grant scopes · server-side enforcement.
 *   See docs/internal/aimeat-iam-design.md.
 * @version-history
 *   v1.0.0 — 2026-06-26 — initial: extension (enforcement) + dashboard app.
 *   v1.1.0 — 2026-06-26 — dashboard v2: plain fetch+JWT (fix load), structured role editor,
 *     assignments list, "use in your app / tell your AI" snippet, help text, default-role select.
 *   v1.3.0 — 2026-07-30 — a role now resolves against the caller's OWNER, not the acting GAII, and
 *     the keying is a CONFIGURED axis (`iam.config.subject`: owner | gaii | both) rather than a
 *     constant. Before this, a member's own agent matched no row and silently fell to the default
 *     role, so an approved member lost every paid surface the moment they worked through an agent;
 *     three of the six iam-family extensions on this node exist only as forks that changed that one
 *     line. Resolution accepts all three key shapes (bare account name, owner@node, agent#owner@node)
 *     so an app with an existing roster does not have to migrate it. Also: administration is gated by
 *     CAPABILITY instead of comparing the caller's gaii to config.ownerGhii, which had refused the
 *     owner's OWN agent (and, where an agent did the first claim, locked out the human); the roster
 *     and config are written PRIVATE, because an ext: namespace is world-readable by default and the
 *     old writes served the membership list to anyone who asked; and both actions now return `via`
 *     so a verdict can be checked against its reason. New op setSubject. Backward-compatible:
 *     check{permission}/check{command} keep their shape and gain two fields. See TARGET-055.
 *   v1.2.1 — 2026-07-30 — action schemas were declared as `input_schema:`/`output_schema:`, but the
 *     extension manifest parser reads `input:`/`output:` (routes/extensions/manifest.ts), so BOTH
 *     schemas were dropped silently: every extension installed from this package advertised check
 *     and admin with no schema at all, which is why an agent could not discover the gate. Renamed to
 *     the keys the parser and build-extension-prompt.ts actually document. Same bug was in
 *     aimeat-marketplace-package.ts. Found while fixing nuotta-iam's keying (TARGET-055); the three
 *     forks with empty schemas inherited it from here.
 *   v1.2.0 — 2026-07-02 — IAM P5: align to the shared level/capability model. BBS ordinal LEVELS per
 *     role (iam.levels, lower = more power, seeded admin:0/editor:10/viewer:20) + a COMMAND MANIFEST
 *     (iam.commands: {id, description, capability, tier}) so agents call app commands gated by the level
 *     model, with a mutation tier (read|write|irreversible → needsConfirmation). check gains a
 *     { command } mode; admin gains setLevels + setCommands. Backward-compatible: check { permission }
 *     and iam.roles/assignments/config are unchanged; new keys default empty.
 */
import type { ExamplePackageDef } from './example-packages.js';

// ── Extension `iam` — server-side enforcement (V8 sandbox: export default async (ctx, input)) ──

/**
 * Resolution shared verbatim by check and admin. Two answers to "who is this caller" inside one
 * extension is how a gate starts disagreeing with the panel that configures it, so this text is
 * identical in both scripts.
 *
 * `subject` decides who a role is keyed to:
 *   owner (default) — a member's agents inherit the member's right; one revoke removes it from all.
 *   gaii            — every agent is enrolled on its own.
 *   both            — owner-keyed, plus an optional per-agent override row.
 *
 * A per-agent override is only an override when the key names an AGENT, i.e. it carries '#'. An
 * owner GHII row (owner@node) has no '#' and IS the person, so matching it in the override branch
 * would report the owner's own sign-in as an agent override and let a GHII row outrank the person.
 * Accepting all three historical key shapes is deliberate: an app that already has a roster does
 * not have to migrate it to become safe.
 */
const RESOLVE_FN = `
  function resolveRole(assignments, subject, caller, owner) {
    if (subject !== 'owner' && caller && caller.indexOf('#') !== -1
        && Object.prototype.hasOwnProperty.call(assignments, caller)) {
      return { role: assignments[caller], via: 'agent' };
    }
    if (subject === 'gaii') return { role: null, via: 'none' };
    if (owner) {
      if (Object.prototype.hasOwnProperty.call(assignments, owner)) return { role: assignments[owner], via: 'owner' };
      var keys = Object.keys(assignments);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (k.indexOf('#') === -1 && String(k).toLowerCase().split('@')[0] === owner) {
          return { role: assignments[k], via: 'owner' };
        }
      }
    }
    return { role: null, via: 'none' };
  }`;

const SCRIPT_CHECK = `export default async function (ctx, input) {
  const config = (await ctx.memory.get('iam.config')) || {};
  const roles = (await ctx.memory.get('iam.roles')) || {};
  const levels = (await ctx.memory.get('iam.levels')) || {};
  const commands = (await ctx.memory.get('iam.commands')) || [];
  const assignments = (await ctx.memory.get('iam.assignments')) || {};
  const caller = ctx.caller && ctx.caller.gaii;
  // ctx.caller.owner is the bare account name and is the SAME for the human and for every agent
  // they have connected; ctx.caller.gaii is the GHII for the human and the full GAII for an agent.
  const owner = (ctx.caller && ctx.caller.owner) ? String(ctx.caller.owner).toLowerCase() : null;
  const subject = config.subject || 'owner';
${RESOLVE_FN}
  const hit = resolveRole(assignments, subject, caller, owner);
  const role = hit.role || config.defaultRole || null;
  const perms = (role && roles[role]) || [];
  const level = (role && Object.prototype.hasOwnProperty.call(levels, role)) ? levels[role] : null;
  const has = function (cap) { return perms.indexOf('*') !== -1 || perms.indexOf(cap) !== -1; };
  // Command mode: check { command } — resolve the command's required capability + mutation tier so the
  // caller (a human GHII or an agent GAII, identically) knows whether it may run + when to confirm.
  if (input && input.command) {
    let cmd = null;
    for (let i = 0; i < commands.length; i++) { if (commands[i] && commands[i].id === input.command) { cmd = commands[i]; break; } }
    if (!cmd) return { allowed: false, error: 'unknown command', command: input.command, role: role, level: level, subject: subject, via: hit.via };
    return {
      allowed: has(cmd.capability), role: role, level: level, command: cmd.id, capability: cmd.capability,
      tier: cmd.tier || 'write', needsConfirmation: cmd.tier === 'irreversible',
      subject: subject, via: hit.via,
    };
  }
  // Permission mode (legacy — unchanged shape plus the two new fields): check { permission }.
  // \`via\` says WHY the role resolved ('owner' | 'agent' | 'none'). It is not decoration: an
  // allowed:true can be right for the wrong reason, and that is invisible without it.
  const permission = input && input.permission;
  if (!permission) return { allowed: false, error: 'permission or command required' };
  return { allowed: has(permission), role: role, permission: permission, level: level, subject: subject, via: hit.via };
}`;

const SCRIPT_ADMIN = `export default async function (ctx, input) {
  const caller = ctx.caller && ctx.caller.gaii;
  const owner = (ctx.caller && ctx.caller.owner) ? String(ctx.caller.owner).toLowerCase() : null;
  const op = input && input.op;
  let config = (await ctx.memory.get('iam.config')) || {};
  let roles = await ctx.memory.get('iam.roles');
  let assignments = (await ctx.memory.get('iam.assignments')) || {};
  // Who is a member is personal data about other people, and an extension namespace is
  // world-readable BY DEFAULT: a roster written the plain way is served to anyone who asks for the
  // key. The roster and the config carry PRIV; roles, levels and commands stay public because a
  // capability vocabulary is product configuration, not personal data.
  const PRIV = { visibility: 'private' };
  if (!roles) {
    roles = { admin: ['*'], editor: ['read', 'create', 'edit'], viewer: ['read'] };
    await ctx.memory.set('iam.roles', roles);
  }
  let levels = await ctx.memory.get('iam.levels');
  if (!levels) {
    levels = { admin: 0, editor: 10, viewer: 20 };  // BBS ordinal, lower = more power
    await ctx.memory.set('iam.levels', levels);
  }
  let commands = (await ctx.memory.get('iam.commands')) || [];
  const subject = config.subject || 'owner';
${RESOLVE_FN}
  // Administration is gated by CAPABILITY, not by an identity string match. Comparing the caller's
  // gaii against a stored ownerGhii refused the OWNER'S OWN agent, so the owner could not manage
  // members from an AI chat at all; and where an AGENT did the first claim, it locked out the human.
  // ctx.caller.owner cannot tell a human from their agents on its own, because it is the same bare
  // name for both: the human is the caller whose gaii carries no '#'. An agent the owner
  // deliberately narrowed simply does not hold '*', so the narrowing keeps working.
  const ownerBare = config.ownerGhii ? String(config.ownerGhii).toLowerCase().split('@')[0].split('#').pop() : null;
  const isHumanOwner = !!(ownerBare && owner && ownerBare === owner && caller && caller.indexOf('#') === -1);
  const myRole = resolveRole(assignments, subject, caller, owner).role;
  const myPerms = (myRole && roles[myRole]) || [];
  // Three ways in, and claim seeds no role, so the roster stays exactly what the owner put there:
  //   - the identity that claimed it (unchanged from before, so nobody loses access on upgrade),
  //   - the human owner, which is what the old identity match wrongly excluded when an AGENT claimed,
  //   - anyone whose resolved role holds '*', which is what lets the owner's own agent administer.
  const canAdmin = !config.ownerGhii || config.ownerGhii === caller || isHumanOwner || myPerms.indexOf('*') !== -1;
  if (op === 'claim') {
    if (!config.ownerGhii) {
      config.ownerGhii = caller;
      if (config.defaultRole === undefined) config.defaultRole = 'viewer';
      if (config.subject === undefined) config.subject = 'owner';
      await ctx.memory.set('iam.config', config, PRIV);
      return { ok: true, ownerGhii: config.ownerGhii, isOwner: true, subject: config.subject };
    }
    return { ok: true, ownerGhii: config.ownerGhii, isOwner: canAdmin, subject: config.subject || 'owner' };
  }
  if (op === 'getState') {
    if (!canAdmin) return { ok: true, ownerGhii: config.ownerGhii || null, isOwner: false, roles: roles, levels: levels, commands: commands, config: { defaultRole: config.defaultRole, subject: subject }, assignments: {}, subject: subject };
    return { ok: true, ownerGhii: config.ownerGhii || null, isOwner: true, config: config, roles: roles, levels: levels, commands: commands, assignments: assignments, subject: subject };
  }
  if (!canAdmin) return { ok: false, error: 'forbidden: owner only' };
  if (op === 'setSubject') {
    if (input.subject === 'owner' || input.subject === 'gaii' || input.subject === 'both') {
      config = Object.assign({}, config, { subject: input.subject });
      await ctx.memory.set('iam.config', config, PRIV);
    }
    return { ok: true, subject: config.subject || 'owner' };
  }
  if (op === 'setConfig') {
    config = Object.assign({}, config, input.config || {});
    await ctx.memory.set('iam.config', config, PRIV);
    return { ok: true, config: config };
  }
  if (op === 'setRoles') {
    if (input.roles && typeof input.roles === 'object') { roles = input.roles; await ctx.memory.set('iam.roles', roles); }
    return { ok: true, roles: roles };
  }
  if (op === 'setLevels') {
    if (input.levels && typeof input.levels === 'object') { levels = input.levels; await ctx.memory.set('iam.levels', levels); }
    return { ok: true, levels: levels };
  }
  if (op === 'setCommands') {
    if (Array.isArray(input.commands)) { commands = input.commands; await ctx.memory.set('iam.commands', commands); }
    return { ok: true, commands: commands };
  }
  if (op === 'assign') {
    if (input.ghii && input.role) { assignments[input.ghii] = input.role; await ctx.memory.set('iam.assignments', assignments, PRIV); }
    return { ok: true, assignments: assignments };
  }
  if (op === 'revoke') {
    if (input.ghii) { delete assignments[input.ghii]; await ctx.memory.set('iam.assignments', assignments, PRIV); }
    return { ok: true, assignments: assignments };
  }
  return { ok: false, error: 'unknown op' };
}`;

const EXTENSION_IAM = JSON.stringify({
  manifest: [
    'metadata:',
    '  name: iam',
    '  version: 1.2.0',
    '  description: In-app role & permission management with server-side enforcement. A role is keyed to the caller OWNER by default, so a member who works through an agent is covered by one entry and one revoke removes it from all of their agents; subject gaii or both change that. BBS levels + command manifest.',
    '  author: operator',
    'required_apis:',
    '  - memory',
    'actions:',
    '  - id: check',
    '    method: POST',
    '    path: /check',
    '    description: "Check whether the caller may do something — pass { permission } for a raw capability or { command } to resolve an app command (returns its mutation tier + needsConfirmation). Any authenticated user. The answer carries `via` (owner | agent | none) so the reason a role resolved is visible, not just the verdict."',
    '    input: { type: object, properties: { permission: { type: string }, command: { type: string } } }',
    '    output: { type: object, properties: { allowed: { type: boolean }, role: { type: string }, level: { type: number }, tier: { type: string }, needsConfirmation: { type: boolean }, subject: { type: string }, via: { type: string } } }',
    '    script: check.js',
    '  - id: admin',
    '    method: POST',
    '    path: /admin',
    '    description: "Role, assignment and config management, multiplexed by op (claim, getState, setConfig, setSubject, setRoles, setLevels, setCommands, assign, revoke). Gated by capability: the human owner always qualifies, and so does any caller whose resolved role holds *, which is what lets the owner manage members through their own agent."',
    '    input: { type: object, properties: { op: { type: string }, ghii: { type: string }, role: { type: string }, subject: { type: string }, roles: { type: object }, levels: { type: object }, config: { type: object }, commands: { type: array } }, required: [op] }',
    '    output: { type: object, properties: { ok: { type: boolean }, isOwner: { type: boolean }, ownerGhii: { type: string }, subject: { type: string }, assignments: { type: object }, roles: { type: object }, levels: { type: object }, commands: { type: array }, config: { type: object }, error: { type: string } } }',
    '    script: admin.js',
  ].join('\n'),
  scripts: {
    'check.js': SCRIPT_CHECK,
    'admin.js': SCRIPT_ADMIN,
  },
});

// ── App `iam-dashboard` v2 — owner UI (calls /v1/ext/iam/*, rewritten to scoped name on install) ──

const APP_DASHBOARD = `<!DOCTYPE html>
<!-- AIMEAT App Manifest
name: iam-dashboard
version: 1.1.0
description: Manage roles, permissions, and user assignments for your app (aimeat-iam).
entry: index.html
-->
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>IAM — Roles &amp; Permissions</title>
  <link href="/lib/daisyui@5.css" rel="stylesheet" type="text/css" />
  <link href="/lib/aimeat-daisyui-bridge.css" rel="stylesheet" type="text/css" />
  <script src="/lib/tailwindcss@4.js"></script>
</head>
<body class="bg-base-100 text-base-content min-h-screen">
  <nav class="navbar bg-base-200 px-4 shadow-sm sticky top-0 z-50">
    <div class="flex-1"><span class="text-lg font-bold">IAM — Roles &amp; Permissions</span></div>
    <div class="flex-none"><span id="login"></span></div>
  </nav>
  <main class="max-w-3xl mx-auto p-4 flex flex-col gap-4">
    <div id="status" class="alert">Loading…</div>

    <details class="collapse collapse-arrow bg-base-200">
      <summary class="collapse-title font-semibold">How this works</summary>
      <div class="collapse-content text-sm opacity-80 flex flex-col gap-1">
        <p>• A <b>role</b> is a named set of <b>permissions</b> (verbs your app cares about, e.g. <code>read</code>, <code>delete</code>). <code>*</code> means all.</p>
        <p>• You <b>assign</b> a role to each user by their GHII. Unassigned users fall back to the <b>default role</b> below (empty = denied).</p>
        <p>• Your app asks the server <em>“can this user do X?”</em> by calling <code>check</code>. Enforcement is <b>server-side</b> — the client UI can only hint, never bypass it.</p>
        <p>• Use the <b>“Use in your app”</b> box to copy a ready snippet (and an AI prompt) once your roles are set.</p>
      </div>
    </details>

    <section class="card bg-base-200 shadow"><div class="card-body">
      <h2 class="card-title">Default role</h2>
      <p class="text-sm opacity-70">What an unassigned user gets. Empty = no access (deny).</p>
      <div class="flex flex-wrap gap-2 items-center mt-2">
        <select id="defaultRole" class="select select-bordered select-sm"></select>
        <button id="saveDefault" class="btn btn-sm btn-primary">Save</button>
      </div>
    </div></section>

    <section class="card bg-base-200 shadow"><div class="card-body">
      <h2 class="card-title">Roles &amp; permissions</h2>
      <p class="text-sm opacity-70">Each role maps to a comma-separated permission list. Use <code>*</code> for all.</p>
      <div id="rolesEditor" class="flex flex-col gap-2 mt-2"></div>
      <div class="flex gap-2 mt-2">
        <button id="addRole" class="btn btn-sm btn-ghost">+ Add role</button>
        <button id="saveRoles" class="btn btn-sm btn-primary">Save roles</button>
      </div>
    </div></section>

    <section class="card bg-base-200 shadow"><div class="card-body">
      <h2 class="card-title">User assignments <span id="assignCount" class="badge badge-sm"></span></h2>
      <p class="text-sm opacity-70">Registered users and their level. Anyone not listed gets the default role.</p>
      <div class="flex flex-wrap gap-2 items-end mt-2">
        <input id="assignGhii" class="input input-bordered input-sm flex-1 min-w-48" placeholder="user GHII (e.g. bob@aimeat-local-001-dev)" />
        <select id="assignRole" class="select select-bordered select-sm"></select>
        <button id="assignBtn" class="btn btn-sm btn-primary">Assign</button>
      </div>
      <div id="assignments" class="mt-3 flex flex-col gap-1"></div>
    </div></section>

    <section class="card bg-base-200 shadow"><div class="card-body">
      <h2 class="card-title">Use in your app <span class="badge badge-sm badge-info">tell your AI</span></h2>
      <p class="text-sm opacity-70">Paste this into the AI building your app, or into your app's code, to enforce these roles.</p>
      <textarea id="aiSnippet" class="textarea textarea-bordered font-mono text-xs mt-2" rows="9" readonly></textarea>
      <button id="copySnippet" class="btn btn-sm mt-2 self-start">Copy</button>
    </div></section>

    <section class="card bg-base-200 shadow"><div class="card-body">
      <h2 class="card-title">Test a permission check</h2>
      <p class="text-sm opacity-70">Runs the server-side <code>check</code> as <em>you</em> (the current user). This is exactly what your app calls — and what "deny" looks like to it.</p>
      <div class="flex flex-wrap gap-2 items-center mt-2">
        <input id="checkPerm" class="input input-bordered input-sm" placeholder="permission (e.g. delete)" />
        <button id="checkBtn" class="btn btn-sm">Check</button>
        <span id="checkResult" class="badge"></span>
      </div>
      <p class="text-xs opacity-60 mt-2">A denied check returns <code>{ allowed: false }</code>. <b>Your app</b> decides what the user sees — hide the control, grey it out, or show "You don't have permission". aimeat-iam just gives the verdict.</p>
    </div></section>
  </main>

  <script src="/v1/libs/aimeat-auth.js"></script>
  <script>
    var EXT = '/v1/ext/iam';
    var session = null, state = null;
    function call(action, body) {
      return fetch(EXT + '/' + action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (session && session.jwt) },
        body: JSON.stringify(body || {})
      }).then(function (r) { return r.json(); });
    }
    function admin(op, extra) { return call('admin', Object.assign({ op: op }, extra || {})); }
    function setStatus(msg, cls) { var el = document.getElementById('status'); el.className = 'alert ' + (cls || ''); el.textContent = msg; }
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

    function roleOptions(sel, includeDeny) {
      var names = Object.keys((state && state.roles) || {});
      sel.innerHTML = '';
      if (includeDeny) sel.appendChild(new Option('(deny)', ''));
      names.forEach(function (n) { sel.appendChild(new Option(n, n)); });
    }
    function renderRolesEditor() {
      var host = document.getElementById('rolesEditor'); host.innerHTML = '';
      var roles = (state && state.roles) || {};
      Object.keys(roles).forEach(function (name) { host.appendChild(roleRow(name, (roles[name] || []).join(', '))); });
    }
    function roleRow(name, perms) {
      var row = el('div', 'flex gap-2 items-center');
      var n = el('input', 'input input-bordered input-sm w-32'); n.value = name; n.placeholder = 'role';
      var p = el('input', 'input input-bordered input-sm flex-1'); p.value = perms; p.placeholder = 'read, create, … or *';
      var rm = el('button', 'btn btn-xs btn-ghost', '✕');
      rm.onclick = function () { row.remove(); };
      row.dataset.row = '1'; row._name = n; row._perms = p;
      row.appendChild(n); row.appendChild(p); row.appendChild(rm);
      return row;
    }
    function collectRoles() {
      var out = {};
      document.querySelectorAll('#rolesEditor [data-row]').forEach(function (row) {
        var name = row._name.value.trim(); if (!name) return;
        out[name] = row._perms.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      });
      return out;
    }
    function renderAssignments() {
      var host = document.getElementById('assignments'); host.innerHTML = '';
      var a = (state && state.assignments) || {}; var keys = Object.keys(a);
      document.getElementById('assignCount').textContent = keys.length + ' assigned';
      if (!keys.length) { host.appendChild(el('div', 'opacity-60 text-sm', 'No assignments yet — everyone gets the default role.')); return; }
      keys.forEach(function (ghii) {
        var row = el('div', 'flex items-center gap-2 text-sm');
        row.appendChild(el('span', 'badge badge-info', a[ghii]));
        row.appendChild(el('span', 'flex-1 font-mono', ghii));
        var rm = el('button', 'btn btn-xs btn-ghost', 'Remove');
        rm.onclick = function () { admin('revoke', { ghii: ghii }).then(function (r) { state.assignments = r.data.assignments; renderAssignments(); }); };
        row.appendChild(rm); host.appendChild(row);
      });
    }
    function renderSnippet() {
      var base = location.origin + EXT;
      var roles = (state && state.roles) || {};
      var lines = Object.keys(roles).map(function (n) { return '  - ' + n + ': ' + (roles[n].indexOf('*') !== -1 ? 'everything' : roles[n].join(', ')); });
      var def = (state && state.config && state.config.defaultRole) || '(deny)';
      var t =
        'This app uses aimeat-iam for access control. Roles:\\n' + lines.join('\\n') + '\\n' +
        'Unassigned users get: ' + def + '\\n\\n' +
        'Before any privileged action, ask the server if the current user is allowed:\\n' +
        '  const r = await session.fetch("' + base + '/check", {\\n' +
        '    method: "POST", body: JSON.stringify({ permission: "delete" })\\n' +
        '  });\\n' +
        '  if (!r.data.allowed) return refuse(); // hide/disable/΄no permission΄\\n\\n' +
        'Enforce it SERVER-SIDE (in the action that mutates data), not just by hiding UI — the client check is only a hint.';
      document.getElementById('aiSnippet').value = t;
    }
    function render() {
      setStatus(state.isOwner ? 'You are the owner — manage roles below.' : 'You are not the owner of this IAM instance (read-only).', state.isOwner ? 'alert-success' : 'alert-warning');
      roleOptions(document.getElementById('defaultRole'), true);
      document.getElementById('defaultRole').value = (state.config && state.config.defaultRole) || '';
      roleOptions(document.getElementById('assignRole'), false);
      renderRolesEditor(); renderAssignments(); renderSnippet();
    }
    function refresh() { return admin('getState').then(function (r) { state = r.data; render(); }); }

    function boot(s) {
      session = s;
      admin('claim').then(refresh).catch(function (e) { setStatus('Error: ' + (e && e.message ? e.message : e), 'alert-error'); });
      document.getElementById('saveDefault').onclick = function () {
        admin('setConfig', { config: { defaultRole: document.getElementById('defaultRole').value } }).then(function (r) { state.config = r.data.config; setStatus('Default role saved.', 'alert-success'); });
      };
      document.getElementById('addRole').onclick = function () { document.getElementById('rolesEditor').appendChild(roleRow('', '')); };
      document.getElementById('saveRoles').onclick = function () {
        admin('setRoles', { roles: collectRoles() }).then(function (r) { state.roles = r.data.roles; render(); setStatus('Roles saved.', 'alert-success'); });
      };
      document.getElementById('assignBtn').onclick = function () {
        var ghii = document.getElementById('assignGhii').value.trim(); var role = document.getElementById('assignRole').value;
        if (!ghii || !role) return;
        admin('assign', { ghii: ghii, role: role }).then(function (r) { state.assignments = r.data.assignments; renderAssignments(); document.getElementById('assignGhii').value = ''; });
      };
      document.getElementById('checkBtn').onclick = function () {
        var perm = document.getElementById('checkPerm').value.trim(); if (!perm) return;
        call('check', { permission: perm }).then(function (r) {
          var d = r.data; var b = document.getElementById('checkResult');
          b.className = 'badge ' + (d.allowed ? 'badge-success' : 'badge-error');
          b.textContent = (d.allowed ? 'ALLOWED' : 'DENIED') + ' · role: ' + (d.role || '(none)');
        });
      };
      document.getElementById('copySnippet').onclick = function () {
        var ta = document.getElementById('aiSnippet'); ta.select();
        navigator.clipboard.writeText(ta.value).then(function () { setStatus('Snippet copied.', 'alert-success'); }, function () {});
      };
    }

    var booted = false;
    function tryBoot() { if (booted) return; var s = AIMEAT.auth.getSession && AIMEAT.auth.getSession(); if (s && s.jwt) { booted = true; boot(s); } }
    AIMEAT.auth.mountLoginButton('#login', { onLogin: function () { tryBoot(); }, onLogout: function () { booted = false; setStatus('Log in to manage roles.', 'alert-warning'); } });
    // Poll until a session is available — the app-origin grant/silent login resolves async and
    // may take a while (and does not reliably call onLogin), so don't time the poll out early.
    var _biv = setInterval(function () { tryBoot(); if (booted) clearInterval(_biv); }, 300);
    tryBoot();
  </script>
</body>
</html>`;

// ── Package definition ───────────────────────────────────────────────

export function aimeatIamPackage(): ExamplePackageDef {
  return {
    name: 'aimeat-iam',
    description: 'In-app role & permission management (RBAC). Define roles and a permission matrix, assign roles to users by GHII, and set a configurable default role — all enforced server-side by a sandboxed extension. The owner manages everything from the dashboard, which also hands the AI a ready snippet for wiring enforcement into the app.',
    category: 'security',
    tags: ['iam', 'rbac', 'roles', 'permissions', 'access-control', 'security'],
    visibility: 'public',
    components: [
      { id: 'extension-iam', type: 'extension', label: 'IAM Enforcement Extension', content: EXTENSION_IAM, dependencies: [] },
      { id: 'app-dashboard', type: 'app', label: 'IAM Dashboard', content: APP_DASHBOARD, dependencies: ['extension-iam'] },
    ],
    templateListing: {
      title: 'aimeat-iam — Roles & Permissions',
      description: 'Add per-app user management to any AIMEAT app. The owner defines roles, a permission matrix, and a configurable default role, and assigns roles to users by GHII. Permission checks are enforced server-side by a sandboxed extension — client UI can only hint, never bypass. The dashboard also generates a copy-paste snippet that tells your AI how to wire enforcement into the app. Distinct from app-grant scopes (this is in-app user↔app rights, not token scopes).',
      category: 'security',
      tags: ['iam', 'rbac', 'roles', 'permissions', 'access-control'],
    },
  };
}

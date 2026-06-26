/**
 * @file aimeat-iam-package.ts
 * @description Installable package definition for "aimeat-iam" — an in-app role & permission
 *   (RBAC) system for an app OWNER to manage other users' rights. Delivered as a package
 *   (like digital-signage): installing it registers a per-instance copy of each component,
 *   scoped `aimeat-iam-{owner}-{shortId}-{componentId}`.
 *
 *   Components (v1, lean):
 *     - extension `iam` — server-side enforcement + sovereign state (ext:{name} memory).
 *         actions: check {permission} → {allowed, role}  (any authed caller)
 *                  admin {op,…}       → owner-only multiplexed (claim/getState/setConfig/setRoles/assign/revoke)
 *     - app `iam-dashboard` — the owner's UI to define the role→permission matrix, assign
 *         roles to users (GHII), and set the configurable default role. Calls /v1/ext/iam/*
 *         (rewritten to the per-instance name at install).
 *
 *   Decisions: per-app package · memory-key storage owned by the extension · configurable
 *   default role (owner decides) · no relationship to app-grant scopes · server-side
 *   enforcement; cortex `can()` sugar deferred. See docs/internal/aimeat-iam-design.md.
 * @version-history
 *   v1.0.0 — 2026-06-26 — initial: extension (enforcement) + dashboard app.
 */
import type { ExamplePackageDef } from './example-packages.js';

// ── Extension `iam` — server-side enforcement (V8 sandbox: export default async (ctx, input)) ──

const SCRIPT_CHECK = `export default async function (ctx, input) {
  const permission = input && input.permission;
  if (!permission) return { allowed: false, error: 'permission required' };
  const config = (await ctx.memory.get('iam.config')) || {};
  const roles = (await ctx.memory.get('iam.roles')) || {};
  const assignments = (await ctx.memory.get('iam.assignments')) || {};
  const caller = ctx.caller && ctx.caller.gaii;
  const role = (caller && assignments[caller]) || config.defaultRole || null;
  const perms = (role && roles[role]) || [];
  const allowed = perms.indexOf('*') !== -1 || perms.indexOf(permission) !== -1;
  return { allowed: allowed, role: role, permission: permission };
}`;

const SCRIPT_ADMIN = `export default async function (ctx, input) {
  const caller = ctx.caller && ctx.caller.gaii;
  const op = input && input.op;
  let config = (await ctx.memory.get('iam.config')) || {};
  let roles = await ctx.memory.get('iam.roles');
  let assignments = (await ctx.memory.get('iam.assignments')) || {};
  if (!roles) {
    roles = { admin: ['*'], editor: ['read', 'create', 'edit'], viewer: ['read'] };
    await ctx.memory.set('iam.roles', roles);
  }
  if (op === 'claim') {
    if (!config.ownerGhii) {
      config.ownerGhii = caller;
      if (config.defaultRole === undefined) config.defaultRole = 'viewer';
      await ctx.memory.set('iam.config', config);
    }
    return { ok: true, ownerGhii: config.ownerGhii, isOwner: config.ownerGhii === caller };
  }
  const isOwner = !config.ownerGhii || config.ownerGhii === caller;
  if (op === 'getState') {
    return { ok: true, ownerGhii: config.ownerGhii || null, isOwner: isOwner, config: config, roles: roles, assignments: assignments };
  }
  if (!isOwner) return { ok: false, error: 'forbidden: owner only' };
  if (op === 'setConfig') {
    config = Object.assign({}, config, input.config || {});
    await ctx.memory.set('iam.config', config);
    return { ok: true, config: config };
  }
  if (op === 'setRoles') {
    if (input.roles && typeof input.roles === 'object') { roles = input.roles; await ctx.memory.set('iam.roles', roles); }
    return { ok: true, roles: roles };
  }
  if (op === 'assign') {
    if (input.ghii && input.role) { assignments[input.ghii] = input.role; await ctx.memory.set('iam.assignments', assignments); }
    return { ok: true, assignments: assignments };
  }
  if (op === 'revoke') {
    if (input.ghii) { delete assignments[input.ghii]; await ctx.memory.set('iam.assignments', assignments); }
    return { ok: true, assignments: assignments };
  }
  return { ok: false, error: 'unknown op' };
}`;

const EXTENSION_IAM = JSON.stringify({
  manifest: [
    'metadata:',
    '  name: iam',
    '  version: 1.0.0',
    '  description: In-app role & permission management with server-side enforcement.',
    '  author: operator',
    'required_apis:',
    '  - memory',
    'actions:',
    '  - id: check',
    '    method: POST',
    '    path: /check',
    '    description: Check whether the calling user has a permission. Any authenticated user.',
    '    input_schema: { type: object, properties: { permission: { type: string } }, required: [permission] }',
    '    output_schema: { type: object, properties: { allowed: { type: boolean }, role: { type: string } } }',
    '    script: check.js',
    '  - id: admin',
    '    method: POST',
    '    path: /admin',
    '    description: Owner-only role/assignment/config management (multiplexed by op).',
    '    input_schema: { type: object, properties: { op: { type: string } }, required: [op] }',
    '    output_schema: { type: object, properties: { ok: { type: boolean } } }',
    '    script: admin.js',
  ].join('\n'),
  scripts: {
    'check.js': SCRIPT_CHECK,
    'admin.js': SCRIPT_ADMIN,
  },
});

// ── App `iam-dashboard` — owner UI (calls /v1/ext/iam/*, rewritten on install) ──

const APP_DASHBOARD = `<!DOCTYPE html>
<!-- AIMEAT App Manifest
name: iam-dashboard
version: 1.0.0
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
  <nav class="navbar bg-base-200 px-4 shadow-sm">
    <div class="flex-1"><span class="text-lg font-bold">IAM — Roles &amp; Permissions</span></div>
    <div class="flex-none"><span id="login"></span></div>
  </nav>
  <main class="max-w-3xl mx-auto p-4 flex flex-col gap-4">
    <div id="status" class="alert">Loading…</div>

    <section class="card bg-base-200 shadow"><div class="card-body">
      <h2 class="card-title">Default role</h2>
      <p class="text-sm opacity-70">What an unassigned user gets. Empty = no access (deny).</p>
      <div class="flex gap-2 items-center mt-2">
        <input id="defaultRole" class="input input-bordered input-sm" placeholder="(deny)" />
        <button id="saveDefault" class="btn btn-sm btn-primary">Save</button>
      </div>
    </div></section>

    <section class="card bg-base-200 shadow"><div class="card-body">
      <h2 class="card-title">Roles &amp; permissions</h2>
      <p class="text-sm opacity-70">One role per line: <code>role: perm1, perm2</code> (use <code>*</code> for all).</p>
      <textarea id="rolesText" class="textarea textarea-bordered font-mono text-sm mt-2" rows="5"></textarea>
      <button id="saveRoles" class="btn btn-sm btn-primary mt-2 self-start">Save roles</button>
    </div></section>

    <section class="card bg-base-200 shadow"><div class="card-body">
      <h2 class="card-title">User assignments</h2>
      <div class="flex flex-wrap gap-2 items-end mt-2">
        <input id="assignGhii" class="input input-bordered input-sm flex-1 min-w-48" placeholder="user GHII (e.g. bob@node-id)" />
        <input id="assignRole" class="input input-bordered input-sm" placeholder="role" />
        <button id="assignBtn" class="btn btn-sm btn-primary">Assign</button>
      </div>
      <div id="assignments" class="mt-3 flex flex-col gap-1"></div>
    </div></section>

    <section class="card bg-base-200 shadow"><div class="card-body">
      <h2 class="card-title">Test a permission check</h2>
      <p class="text-sm opacity-70">Runs the server-side <code>check</code> as <em>you</em> (the current user).</p>
      <div class="flex gap-2 items-center mt-2">
        <input id="checkPerm" class="input input-bordered input-sm" placeholder="permission (e.g. delete)" />
        <button id="checkBtn" class="btn btn-sm">Check</button>
        <span id="checkResult" class="badge"></span>
      </div>
    </div></section>
  </main>

  <script src="/v1/libs/aimeat-auth.js"></script>
  <script>
    var EXT = '/v1/ext/iam';
    var session = null;
    function api(op, body) {
      var b = Object.assign({ op: op }, body || {});
      return session.fetch(EXT + '/admin', { method: 'POST', body: JSON.stringify(b) });
    }
    function setStatus(msg, cls) {
      var el = document.getElementById('status');
      el.className = 'alert ' + (cls || '');
      el.textContent = msg;
    }
    function rolesToText(roles) {
      return Object.keys(roles || {}).map(function (r) { return r + ': ' + (roles[r] || []).join(', '); }).join('\\n');
    }
    function textToRoles(t) {
      var out = {};
      (t || '').split('\\n').forEach(function (line) {
        var i = line.indexOf(':'); if (i < 0) return;
        var name = line.slice(0, i).trim(); if (!name) return;
        out[name] = line.slice(i + 1).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      });
      return out;
    }
    function renderAssignments(a) {
      var host = document.getElementById('assignments'); host.innerHTML = '';
      var keys = Object.keys(a || {});
      if (!keys.length) { host.innerHTML = '<div class="opacity-60 text-sm">No assignments yet.</div>'; return; }
      keys.forEach(function (ghii) {
        var row = document.createElement('div');
        row.className = 'flex items-center gap-2 text-sm';
        row.innerHTML = '<span class="badge badge-info">' + a[ghii] + '</span><span class="flex-1 font-mono">' + ghii + '</span>';
        var rm = document.createElement('button');
        rm.className = 'btn btn-xs btn-ghost'; rm.textContent = 'Remove';
        rm.onclick = function () { api('revoke', { ghii: ghii }).then(function (r) { renderAssignments(r.data.assignments); }); };
        row.appendChild(rm); host.appendChild(row);
      });
    }
    function refresh() {
      return api('getState').then(function (r) {
        var s = r.data;
        if (!s.isOwner) setStatus('You are viewing as a non-owner — management is disabled.', 'alert-warning');
        else setStatus('You are the owner of this IAM instance.', 'alert-success');
        document.getElementById('defaultRole').value = (s.config && s.config.defaultRole) || '';
        document.getElementById('rolesText').value = rolesToText(s.roles);
        renderAssignments(s.assignments);
      });
    }
    function boot(s) {
      session = s;
      api('claim').then(refresh).catch(function (e) { setStatus('Error: ' + (e && e.message ? e.message : e), 'alert-error'); });
      document.getElementById('saveDefault').onclick = function () {
        api('setConfig', { config: { defaultRole: document.getElementById('defaultRole').value.trim() } }).then(function () { setStatus('Default role saved.', 'alert-success'); });
      };
      document.getElementById('saveRoles').onclick = function () {
        api('setRoles', { roles: textToRoles(document.getElementById('rolesText').value) }).then(function (r) { document.getElementById('rolesText').value = rolesToText(r.data.roles); setStatus('Roles saved.', 'alert-success'); });
      };
      document.getElementById('assignBtn').onclick = function () {
        var ghii = document.getElementById('assignGhii').value.trim();
        var role = document.getElementById('assignRole').value.trim();
        if (!ghii || !role) return;
        api('assign', { ghii: ghii, role: role }).then(function (r) { renderAssignments(r.data.assignments); document.getElementById('assignGhii').value=''; document.getElementById('assignRole').value=''; });
      };
      document.getElementById('checkBtn').onclick = function () {
        var perm = document.getElementById('checkPerm').value.trim(); if (!perm) return;
        session.fetch(EXT + '/check', { method: 'POST', body: JSON.stringify({ permission: perm }) }).then(function (r) {
          var d = r.data; var el = document.getElementById('checkResult');
          el.className = 'badge ' + (d.allowed ? 'badge-success' : 'badge-error');
          el.textContent = (d.allowed ? 'ALLOWED' : 'DENIED') + ' · role: ' + (d.role || '(none)');
        });
      };
    }
    AIMEAT.auth.mountLoginButton('#login', {
      onLogin: function (s) { boot(s); },
      onLogout: function () { setStatus('Log in to manage roles.', 'alert-warning'); }
    });
  </script>
</body>
</html>`;

// ── Package definition ───────────────────────────────────────────────

export function aimeatIamPackage(): ExamplePackageDef {
  return {
    name: 'aimeat-iam',
    description: 'In-app role & permission management (RBAC). Define roles and a permission matrix, assign roles to users by GHII, and set a configurable default role — all enforced server-side by a sandboxed extension. The owner manages everything from the dashboard.',
    category: 'security',
    tags: ['iam', 'rbac', 'roles', 'permissions', 'access-control', 'security'],
    visibility: 'public',
    components: [
      { id: 'extension-iam', type: 'extension', label: 'IAM Enforcement Extension', content: EXTENSION_IAM, dependencies: [] },
      { id: 'app-dashboard', type: 'app', label: 'IAM Dashboard', content: APP_DASHBOARD, dependencies: ['extension-iam'] },
    ],
    templateListing: {
      title: 'aimeat-iam — Roles & Permissions',
      description: 'Add per-app user management to any AIMEAT app. The owner defines roles, a permission matrix, and a configurable default role, and assigns roles to users by GHII. Permission checks are enforced server-side by a sandboxed extension — client UI can only hint, never bypass. Distinct from app-grant scopes (this is in-app user↔app rights, not token scopes).',
      category: 'security',
      tags: ['iam', 'rbac', 'roles', 'permissions', 'access-control'],
    },
  };
}

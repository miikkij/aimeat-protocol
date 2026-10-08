/**
 * @file src/services/packages/install/package-capabilities.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a package will be able to do on the node that installs it, read from its
 *   components before anything registers: the summary a person approves (package sale design, T1).
 *
 *   Installing a package is running its author's code on your node and pointing your AI at its text.
 *   The summary names, per part:
 *   - an EXTENSION: its actions, whether its scripts call out to the internet, start AI jobs (billed
 *     to the installer), send email or take payments, the workspaces it reads or writes, the hosts it
 *     names as an AI provider, the secrets it asks for and the jobs it schedules;
 *   - an APP: the permissions it asks for when it opens (its `aimeat-scopes` meta tag, or the
 *     default every app asks for);
 *   - a CORTEX: its library files and the structure locks it sets;
 *   - a SKILL: its name, the instructions the installer's AI will read;
 *   - a MEMORY part: the keys it writes into the installer's memory.
 *
 *   `items` is the same summary as a flat list of plain strings, and `hash` the sha256 of that list
 *   sorted. An approval records the hash; an update whose items include one the approved list did not
 *   is a widening (widenedItems), which waits for the owner (package sale design, T7).
 * @structure PackageCapabilities · packageCapabilities() · widenedItems()
 * @usage
 *   const caps = packageCapabilities(pkg.components, config, owner);
 *   if (caps.carriesCode) ...   // an extension, app, cortex or skill part
 * @version-history
 *   v1.3.0 — 2026-10-08 — An extension's `workspace.rows` and `network.hosts` are capabilities
 *     (`extension:<c>:workspace-rows`, `extension:<c>:network-host:<host>`), shown at approval.
 *   v1.2.0 — 2026-10-05 — An extension's network, ai, email and payments come from
 *     capabilitiesOfRecord, the list the sandbox now enforces; the regex for `ctx.fetch(` and the like
 *     missed an aliased call, which the sandbox then ran (secaudit 2026-10, PKG-3). An app's scopes come from appScopesOf (protected-resource.ts), the reading
 *     every grant uses. The regex here read the whole page and preferred a name-first tag, so an app
 *     with two tags, or one past 64 KB, showed the owner one list and got another (secaudit 2026-10,
 *     PKG-4).
 *   v1.1.0 — 2026-10-02 — An app's carried tools are capabilities (`app:<c>:tool:<name>`): an update that adds one asks again.
 *   v1.0.0 — 2026-10-02 — Initial (package sale design, phase 2).
 */
import { createHash } from 'node:crypto';
import type { AimeatConfig } from '../../../config.js';
import type { PackageComponent } from '../../../storage/interface.js';
import { buildExtensionRecordFromManifest } from '../../extension-manifest.js';
import { WORKSPACE_DECLARATION_KEY } from '../../extension-workspace-declaration.js';
import { AI_PROVIDER_DECLARATION_KEY } from '../../extension-ai-provider-declaration.js';
import { SECRET_KEYS_FIELD } from '../../extension-secrets.js';
import { cortexComponentsOf } from '../compose/package-component-collisions.js';
import { memoryComponentEntries } from './package-memory-component.js';
import { skillComponentName } from './package-skill-component.js';
import { appScopesOf } from '../../protected-resource.js';
import { capabilitiesOfRecord } from '../../extension-capability-declaration.js';

export interface ExtensionCapabilities {
  component: string; name: string; actions: string[];
  network: boolean; ai: boolean; email: boolean; payments: boolean;
  /** `rows`: appends to the row spaces that name it, also on a schedule (manifest workspace.rows). */
  workspace?: { read: boolean; write: boolean; rows?: boolean };
  ai_provider_hosts?: string[];
  /** The only hostnames ctx.fetch may reach (manifest network.hosts). Absent: any public address. */
  network_hosts?: string[];
  secrets: string[];
  schedules: string[];
}

export interface PackageCapabilities {
  extensions: ExtensionCapabilities[];
  /** `tools`: the tools the app offers agents, as the package carries them (package-app-tools.ts). */
  apps: Array<{ component: string; name: string; scopes: string[]; declared: boolean; tools?: string[] }>;
  cortexes: Array<{ component: string; name: string; libs: number; schema_locks: string[] }>;
  skills: Array<{ component: string; name: string }>;
  memory: Array<{ component: string; keys: string[] }>;
  /** Parts that carry data the node reads but no code: csm, msm, translation. */
  other: Array<{ component: string; type: string }>;
}

export interface CapabilitySummary {
  capabilities: PackageCapabilities;
  /** The same summary as plain strings, sorted. */
  items: string[];
  /** sha256 of `items`, what an approval records. */
  hash: string;
  /** True when a part is code or instructions: an extension, an app, a cortex or a skill. */
  carriesCode: boolean;
}

function extensionCapabilities(comp: PackageComponent, config: AimeatConfig, owner: string): ExtensionCapabilities | null {
  let parsed: { manifest?: string; scripts?: Record<string, string> };
  try { parsed = JSON.parse(comp.content); }
  // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer here: the input is not of that shape
  catch { parsed = { manifest: comp.content }; }
  const built = buildExtensionRecordFromManifest(parsed.manifest ?? '', parsed.scripts ?? {}, config, owner, new Date().toISOString(), false);
  if (!built.ok) return null;
  const rec = built.record;
  // The list the sandbox enforces (services/extension-capability-declaration.ts), so the approval
  // shows exactly what the scripts will be allowed to do.
  const can = capabilitiesOfRecord(rec);
  const cfg = (rec.config ?? {}) as Record<string, unknown>;
  const ws = cfg[WORKSPACE_DECLARATION_KEY] as { read?: boolean; write?: boolean; rows?: boolean } | undefined;
  const ap = cfg[AI_PROVIDER_DECLARATION_KEY] as { hosts?: string[] } | undefined;
  const schedules = Array.isArray(cfg.__schedules) ? (cfg.__schedules as Array<Record<string, unknown>>) : [];
  return {
    component: comp.id,
    name: rec.name,
    actions: rec.actions.map(a => a.id).sort(),
    network: can.network,
    ai: can.ai,
    email: can.email,
    payments: can.payments,
    ...(ws && (ws.read || ws.write || ws.rows) ? { workspace: { read: !!ws.read, write: !!ws.write, rows: !!ws.rows } } : {}),
    ...(can.hosts ? { network_hosts: [...can.hosts] } : {}),
    ...(ap?.hosts?.length ? { ai_provider_hosts: [...ap.hosts].sort() } : {}),
    secrets: (Array.isArray(cfg[SECRET_KEYS_FIELD]) ? cfg[SECRET_KEYS_FIELD] as string[] : []).slice().sort(),
    schedules: schedules.map(s => `${String(s.action ?? s.action_id ?? s.id ?? '')}@${String(s.cron ?? '')}`).sort(),
  };
}

/** What the package's components will be able to do once installed. Reads only. */
export function packageCapabilities(components: PackageComponent[], config: AimeatConfig, owner: string): CapabilitySummary {
  const caps: PackageCapabilities = { extensions: [], apps: [], cortexes: [], skills: [], memory: [], other: [] };
  for (const comp of components) {
    switch (comp.type) {
      case 'extension': {
        const ext = extensionCapabilities(comp, config, owner);
        // A manifest the builder refuses is refused again at install, with its own reason.
        if (ext) caps.extensions.push(ext);
        else caps.extensions.push({ component: comp.id, name: comp.label, actions: [], network: false, ai: false, email: false, payments: false, secrets: [], schedules: [] });
        break;
      }
      case 'app': {
        const meta = comp.meta as { app?: { name?: string; tools?: Array<{ name?: unknown }> } } | undefined;
        const tools = (Array.isArray(meta?.app?.tools) ? meta.app.tools : []).map(t => String(t?.name ?? '')).filter(Boolean).sort();
        caps.apps.push({ component: comp.id, name: meta?.app?.name ?? comp.label, ...appScopesOf(comp.content), ...(tools.length ? { tools } : {}) });
        break;
      }
      case 'cortex': {
        const { libs, components: parts } = cortexComponentsOf(comp.content);
        caps.cortexes.push({
          component: comp.id, name: comp.label, libs: Object.keys(libs).length,
          schema_locks: parts.filter(p => p.type === 'schema' && typeof p.key_pattern === 'string').map(p => p.key_pattern as string).sort(),
        });
        break;
      }
      case 'skill':
        caps.skills.push({ component: comp.id, name: skillComponentName(comp.content) ?? comp.label });
        break;
      case 'memory': {
        let keys: string[];
        try { keys = memoryComponentEntries(comp.content, comp.id).map(e => e.key).filter((k): k is string => typeof k === 'string').sort(); }
        // eslint-disable-next-line aimeat/no-silent-catch -- a body the registrar cannot read is refused there, with its own reason
        catch { keys = []; }
        caps.memory.push({ component: comp.id, keys });
        break;
      }
      default:
        caps.other.push({ component: comp.id, type: comp.type });
    }
  }

  const items: string[] = [];
  for (const e of caps.extensions) {
    items.push(`extension:${e.component}`);
    for (const a of e.actions) items.push(`extension:${e.component}:action:${a}`);
    if (e.network) items.push(`extension:${e.component}:network`);
    if (e.ai) items.push(`extension:${e.component}:ai`);
    if (e.email) items.push(`extension:${e.component}:email`);
    if (e.payments) items.push(`extension:${e.component}:payments`);
    if (e.workspace?.read) items.push(`extension:${e.component}:workspace-read`);
    if (e.workspace?.write) items.push(`extension:${e.component}:workspace-write`);
    if (e.workspace?.rows) items.push(`extension:${e.component}:workspace-rows`);
    for (const h of e.network_hosts ?? []) items.push(`extension:${e.component}:network-host:${h}`);
    for (const h of e.ai_provider_hosts ?? []) items.push(`extension:${e.component}:ai-host:${h}`);
    for (const s of e.secrets) items.push(`extension:${e.component}:secret:${s}`);
    for (const s of e.schedules) items.push(`extension:${e.component}:schedule:${s}`);
  }
  for (const a of caps.apps) {
    items.push(`app:${a.component}`);
    for (const s of a.scopes) items.push(`app:${a.component}:scope:${s}`);
    // A tool an agent may call is a capability: an update that adds one asks the installer again.
    for (const t of a.tools ?? []) items.push(`app:${a.component}:tool:${t}`);
  }
  for (const c of caps.cortexes) { items.push(`cortex:${c.component}`); for (const k of c.schema_locks) items.push(`cortex:${c.component}:lock:${k}`); }
  for (const s of caps.skills) items.push(`skill:${s.name}`);
  for (const m of caps.memory) for (const k of m.keys) items.push(`memory:${k}`);
  items.sort();
  const hash = createHash('sha256').update(items.join('\n')).digest('hex');
  const carriesCode = caps.extensions.length + caps.apps.length + caps.cortexes.length + caps.skills.length > 0;
  return { capabilities: caps, items, hash, carriesCode };
}

/** The items of `next` that `approved` did not have: what an update would add. */
export function widenedItems(approved: string[], next: string[]): string[] {
  const had = new Set(approved);
  return next.filter(i => !had.has(i));
}

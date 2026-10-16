/**
 * @file public/js/services/organisms.records.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The organism's whole-record meta reads and writes: the workspace registry, the runtime
 *   config (publish gate), the per-item colour maps and the workspace's source pointers. Each of these
 *   writes REPLACES the record, so each read comes in two names.
 *
 *   The rule (docs/pitfalls.md section 84). `listWorkspaces`, `getConfig`, `getAllColors` and
 *   `getWorkspaceSources` forgive a failed read (answer [] or {}) and are for DRAWING only. The
 *   `…Strict` names throw. Every write in this file reads with the strict name immediately before it
 *   writes, through readForWrite, so a read that fails stops the write and nothing is replaced. A
 *   caller that writes one of these records reads it strictly, or uses a writer below.
 *
 * @structure
 *   - listWorkspaces / listWorkspacesStrict, saveWorkspaceRegistry: organism.{id}.meta.workspaces
 *   - getConfig / getConfigStrict, setPublishGate: organism.{id}.meta.config
 *   - getAllColors / getAllColorsStrict, saveColors, saveItemColor: …w.{ws}.meta.colors.{type}
 *   - getWorkspaceSources / getWorkspaceSourcesStrict, saveWorkspaceSources, addWorkspaceSources,
 *     removeWorkspaceSource: …w.{ws}.meta.sources
 * @usage Re-exported from organisms.js: import * as orgService from '/js/services/organisms.js';
 * @version-history
 *   v1.0.0 — 2026-10-16 — Extracted from organisms.js (max-file-lines) with a strict read beside each
 *     forgiving one, and the writes moved onto the strict reads: setPublishGate, saveItemColor,
 *     addWorkspaceSources and removeWorkspaceSource refuse to write after a failed read (QA audit F6-04).
 */
import { apiGet, apiPost } from '/js/api.js';
import { decodeEntities } from '/js/utils.js';
import { swallowed } from '/js/swallowed.js';
import { readForWrite } from '/js/load-state.js';
import { wsRoot } from './organisms.shared.js';

/** One memory record by exact key, read through the prefix list (no 404 noise). Throws on failure. */
async function readExact(key) {
  const resp = await apiGet(`/v1/memory?prefix=${encodeURIComponent(key)}`);
  return (resp?.data?.items || []).find(i => i.key === key) || null;
}

/* ── Workspace registry: one organism lists its workspaces at organism.{id}.meta.workspaces =
 *    { workspaces: [{ id, name, createdAt }] }. A workspace appears here even before it has a
 *    manifest (so a freshly-created, not-yet-generated workspace is openable). ── */

/** An organism's workspaces in registry order. Throws when the read fails: for a write. */
export async function listWorkspacesStrict(orgId) {
  const item = await readExact(`organism.${orgId}.meta.workspaces`);
  const list = Array.isArray(item?.value?.workspaces) ? item.value.workspaces : [];
  // Names are plain text; legacy import paths stored them HTML-escaped. Decode for display.
  return list.map(w => (w && w.name ? { ...w, name: decodeEntities(w.name) } : w));
}

/** An organism's workspaces, [] when the read fails. For drawing only, never for a write. */
export async function listWorkspaces(orgId) {
  try { return await listWorkspacesStrict(orgId); } catch (err) { swallowed('organisms: listWorkspaces', err); return []; }
}

/** Persist the workspace registry (a whole-record replace). Build `workspaces` from listWorkspacesStrict. */
export async function saveWorkspaceRegistry(orgId, workspaces) {
  return apiPost('/v1/memory', { key: `organism.${orgId}.meta.workspaces`, value: { workspaces }, visibility: 'private' });
}

/** The runtime config entry (publish gate toggle, etc.). Throws when the read fails: for a write. */
export async function getConfigStrict(orgId) {
  return (await readExact(`organism.${orgId}.meta.config`))?.value || {};
}

/** The runtime config entry, {} when the read fails. For drawing only. */
export async function getConfig(orgId) {
  try { return await getConfigStrict(orgId); } catch (err) { swallowed('organisms: getConfig', err); return {}; }
}

/** Toggle the publish-review gate in the org's config. The rest of the config is kept from a strict
 *  read made just before the write; a failed read throws and writes nothing. */
export async function setPublishGate(orgId, enabled, approverRole = 'owner') {
  const cfg = await readForWrite(() => getConfigStrict(orgId));
  const next = { ...cfg, gates: { ...(cfg.gates || {}), publish: { enabled: !!enabled, approverRole } } };
  return apiPost('/v1/memory', { key: `organism.${orgId}.meta.config`, value: next, visibility: 'private' });
}

/** The optional per-item color tags for every space → { typeName: { instanceId: colorKey } }, stored
 *  at …w.{wsId}.meta.colors.{typeName} = { colors: { id: key } }. Throws when the read fails. */
export async function getAllColorsStrict(orgId, wsId) {
  const out = {};
  const resp = await apiGet(`/v1/memory?prefix=${encodeURIComponent(`${wsRoot(orgId, wsId)}.meta.colors.`)}`);
  for (const it of (resp?.data?.items || [])) {
    const m = String(it.key || '').match(/\.meta\.colors\.(.+)$/);
    if (m) out[m[1]] = (it.value && typeof it.value.colors === 'object' && it.value.colors) || {};
  }
  return out;
}

/** The per-item color tags, {} when the read fails. For drawing only. */
export async function getAllColors(orgId, wsId) {
  try { return await getAllColorsStrict(orgId, wsId); } catch (err) { swallowed('organisms: getAllColors', err); return {}; }
}

/** Persist the per-item color map for one space (a whole-record replace). */
export async function saveColors(orgId, wsId, typeName, colors) {
  return apiPost('/v1/memory', { key: `${wsRoot(orgId, wsId)}.meta.colors.${typeName}`, value: { colors }, visibility: 'private' });
}

/** Set or clear one item's color: a strict read of the space's map, the one change, the write.
 *  Returns the space's new map. A failed read throws and writes nothing. */
export async function saveItemColor(orgId, wsId, typeName, id, color) {
  const all = await readForWrite(() => getAllColorsStrict(orgId, wsId));
  const m = { ...(all[typeName] || {}) };
  if (color) m[id] = color; else delete m[id];
  await saveColors(orgId, wsId, typeName, m);
  return m;
}

/* ── Sources: references the workspace draws on (memory / storage / knowledge). Pointers only —
 *  the referenced data is never copied or moved, it stays where it lives. Stored at
 *  …w.{ws}.meta.sources = { sources: [{ id, type, label, key?, ownerGaii?, packageId?, external }] }. */

/** The workspace's attached source references. Throws when the read fails: for a write. */
export async function getWorkspaceSourcesStrict(orgId, wsId) {
  const item = await readExact(`${wsRoot(orgId, wsId)}.meta.sources`);
  return Array.isArray(item?.value?.sources) ? item.value.sources : [];
}

/** The workspace's attached source references, [] when the read fails. For drawing only. */
export async function getWorkspaceSources(orgId, wsId) {
  try { return await getWorkspaceSourcesStrict(orgId, wsId); } catch (err) { swallowed('organisms: getWorkspaceSources', err); return []; }
}

/** Persist the workspace's source references (a whole-record replace). */
export async function saveWorkspaceSources(orgId, wsId, sources) {
  return apiPost('/v1/memory', { key: `${wsRoot(orgId, wsId)}.meta.sources`, value: { sources }, visibility: 'private' });
}

/** Add sources on top of a strict read; one whose `keyOf` is already there is skipped. Returns
 *  { sources, added } (the stored list and how many were new). A failed read throws and writes nothing. */
export async function addWorkspaceSources(orgId, wsId, additions, keyOf) {
  const existing = await readForWrite(() => getWorkspaceSourcesStrict(orgId, wsId));
  const have = new Set(existing.map(keyOf));
  const fresh = [];
  for (const s of additions) {
    const k = keyOf(s);
    if (have.has(k)) continue;
    have.add(k);
    fresh.push(s);
  }
  if (fresh.length === 0) return { sources: existing, added: 0 };
  const next = [...existing, ...fresh];
  const r = await saveWorkspaceSources(orgId, wsId, next);
  if (r?.ok === false) throw new Error(r.error?.message || 'Could not save the sources');
  return { sources: next, added: fresh.length };
}

/** Remove one source by id on top of a strict read. Returns the stored list. A failed read throws
 *  and writes nothing. */
export async function removeWorkspaceSource(orgId, wsId, id) {
  const existing = await readForWrite(() => getWorkspaceSourcesStrict(orgId, wsId));
  const next = existing.filter(s => s.id !== id);
  const r = await saveWorkspaceSources(orgId, wsId, next);
  if (r?.ok === false) throw new Error(r.error?.message || 'Could not save the sources');
  return next;
}

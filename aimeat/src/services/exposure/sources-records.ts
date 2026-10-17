/**
 * @file src/services/exposure/sources-records.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The exposure sources whose content is a memory record or a stored file: memory
 *   records, files, knowledge packages, skills and data packages (plan doc-mvcn6c7e4e5q, V6.1).
 *
 *   ONE THING, ONE KIND. Several kinds are stored as memory records or files: a skill is a manifest
 *   record under `skills.`, a knowledge package a manifest under `packages/<id>/`, an exchange
 *   offering a public record under `exchange.offering.`, a data package public files under `datapkg/`
 *   plus a catalogue manifest. Each of those is counted once, by the kind a person knows it as, and
 *   the memory and file sources leave it out, so the report says "a skill" and not "a skill and two
 *   memory records".
 *
 *   An agent's record is the person's own (CLAUDE.md, the owner sees what their agents hold), so the
 *   memory and file sources read the GHII, every agent's GAII and every ecosystem app's GEAI.
 *
 *   Each record and file item carries its content address (`content`), and the report passes it
 *   through the caller's classification reader before it lists the item (exposure-report.ts). The
 *   reads here load metadata only, except one knowledge manifest per exposed package, for its name.
 * @structure memorySource · fileSource · knowledgeSource · skillSource · datapackageSource
 * @usage import { memorySource } from './sources-records.js';
 * @version-history
 *   v1.0.0 — 2026-10-17 — Initial (plan doc-mvcn6c7e4e5q, V6.1).
 */
import type { MemoryMetaRow } from '../../storage/repositories/memory.repository.js';
import { listPackages as listDataPackages } from '../datapackage/store.js';
import { MANIFEST_KEY_RE } from '../skill-refs.js';
import { memoryTarget, fileTarget } from '../classification/labels.js';
import {
  type ExposureFound, type ExposureItem, type ExposureSource,
  levelOfVisibility, ownerIdentities, ownerMemoryMeta,
} from './exposure-types.js';

/** Memory keys another source counts, by the kind a person knows them as. */
const COUNTED_ELSEWHERE_PREFIXES = ['skills.', 'exchange.offering.', 'exchange.need.'];
/** Memory tags another source counts (the knowledge source). */
const KNOWLEDGE_TAGS = ['knowledge-package', 'knowledge-entry'];
/** File keys another source counts (the data package source). */
const DATAPACKAGE_FILE_PREFIX = 'datapkg/';

const KNOWLEDGE_MANIFEST_RE = /^packages\/([^/]+)\/manifest$/;
const KNOWLEDGE_ENTRY_RE = /^packages\/([^/]+)\/(.+)$/;

const enc = encodeURIComponent;
/** A storage key as a path: each segment encoded, the slashes kept. */
const keyPath = (key: string): string => key.split('/').map(enc).join('/');

/** Who holds a row, in words, when it is not the person's own identity. */
function heldBy(ownerGhii: string, holder: string): string {
  if (holder === ownerGhii) return '';
  const hash = holder.indexOf('#');
  return ` (stored by ${hash > 0 ? holder.slice(0, hash) : holder})`;
}

const isKnowledgeRow = (r: MemoryMetaRow): boolean => r.tags.some(t => KNOWLEDGE_TAGS.includes(t));

export const memorySource: ExposureSource = {
  kind: 'memory',
  async list(ctx, ownerName, ownerGhii) {
    const rows = await ownerMemoryMeta(ctx, ownerName, ownerGhii);
    const out: ExposureFound[] = [];
    for (const r of rows) {
      if (COUNTED_ELSEWHERE_PREFIXES.some(p => r.key.startsWith(p)) || isKnowledgeRow(r)) continue;
      const lv = levelOfVisibility(r.visibility);
      if (!lv) continue;
      out.push({
        kind: 'memory', content: memoryTarget(r.ownerGaii, r.key),
        id: r.ownerGaii === ownerGhii ? r.key : `${r.ownerGaii}:${r.key}`,
        title: `${r.key}${heldBy(ownerGhii, r.ownerGaii)}`,
        ...lv,
        ...(lv.level === 'public' ? { url: `${ctx.base}/v1/memory/${enc(r.ownerGaii)}/${enc(r.key)}` } : {}),
        how_to_close: `Make it private with aimeat_memory_write and visibility "private" (PATCH /v1/memory/${enc(r.key)} with {"patch":{},"visibility":"private"}), or remove it with aimeat_memory_delete (DELETE /v1/memory/${enc(r.key)}).`,
      });
    }
    return out;
  },
};

export const fileSource: ExposureSource = {
  kind: 'file',
  async list(ctx, ownerName, ownerGhii) {
    const ids = await ownerIdentities(ctx, ownerName, ownerGhii);
    const byOwner = await ctx.storage.listStorageFilesForOwners(ids.all);
    const out: ExposureFound[] = [];
    for (const [holder, files] of Object.entries(byOwner)) {
      for (const f of files) {
        if (f.key.startsWith(DATAPACKAGE_FILE_PREFIX)) continue;
        const lv = levelOfVisibility(f.visibility);
        if (!lv) continue;
        out.push({
          kind: 'file', content: fileTarget(holder, f.key, f.workspaceRef),
          id: holder === ownerGhii ? f.key : `${holder}:${f.key}`,
          title: `${f.key}${heldBy(ownerGhii, holder)}`,
          ...lv,
          ...(lv.level === 'public' ? { url: `${ctx.base}/v1/pub/${enc(holder)}/${keyPath(f.key)}` } : {}),
          how_to_close: `Make it private with PATCH /v1/storage/${keyPath(f.key)}/visibility and {"visibility":"private"}, or remove it with aimeat_storage_delete (DELETE /v1/storage/${keyPath(f.key)}).`,
        });
      }
    }
    return out;
  },
};

/** The knowledge-package ids that are a data package's catalogue entry: the data package source counts those. */
function dataPackageCatalogueIds(rows: MemoryMetaRow[]): Set<string> {
  const ids = new Set<string>();
  for (const r of rows) {
    const m = KNOWLEDGE_MANIFEST_RE.exec(r.key);
    if (m && r.tags.includes('data-package')) ids.add(m[1]);
  }
  return ids;
}

export const knowledgeSource: ExposureSource = {
  kind: 'knowledge',
  async list(ctx, ownerName, ownerGhii) {
    const rows = (await ownerMemoryMeta(ctx, ownerName, ownerGhii)).filter(isKnowledgeRow);
    const fromDataPackages = dataPackageCatalogueIds(rows);
    const out: ExposureFound[] = [];
    for (const r of rows) {
      const lv = levelOfVisibility(r.visibility);
      if (!lv) continue;
      const manifest = KNOWLEDGE_MANIFEST_RE.exec(r.key);
      const entry = manifest ? null : KNOWLEDGE_ENTRY_RE.exec(r.key);
      const pkgId = manifest?.[1] ?? entry?.[1];
      if (pkgId && fromDataPackages.has(pkgId)) continue;
      const content = memoryTarget(r.ownerGaii, r.key);
      if (manifest && r.tags.includes('knowledge-package')) {
        // The package's name is in the manifest's value; the meta row carries none. The item passes
        // the caller's classification reader in the report before the name is shown.
        const value = (await ctx.storage.getMemory(r.ownerGaii, r.key))?.value as { name?: unknown } | undefined;
        out.push({
          kind: 'knowledge', content, id: manifest[1],
          title: typeof value?.name === 'string' && value.name ? value.name : manifest[1],
          ...lv,
          ...(lv.level === 'public' ? { url: `${ctx.base}/v1/knowledge/${enc(manifest[1])}` } : {}),
          how_to_close: `Take the package out of the catalogue with PATCH /v1/knowledge/${enc(manifest[1])}/sharing and {"catalog_listed":false}; aimeat_memory_delete on ${r.key} removes it.`,
        });
        continue;
      }
      out.push({
        kind: 'knowledge', content, id: r.key, title: r.key, ...lv,
        how_to_close: entry
          ? `Make the entry private with PATCH /v1/knowledge/${enc(entry[1])}/entries/${enc(r.key)}/visibility and {"visibility":"private"}, or with aimeat_memory_write and visibility "private".`
          : 'Make the entry private with aimeat_memory_write and visibility "private", or remove it with aimeat_memory_delete.',
      });
    }
    return out;
  },
};

export const skillSource: ExposureSource = {
  kind: 'skill',
  async list(ctx, ownerName, ownerGhii) {
    // A person's own skills are the user-scope registry, kept under their GHII (services/skill-refs.ts).
    const rows = (await ownerMemoryMeta(ctx, ownerName, ownerGhii)).filter(r => r.ownerGaii === ownerGhii);
    const out: ExposureFound[] = [];
    for (const r of rows) {
      const m = MANIFEST_KEY_RE.exec(r.key);
      if (!m) continue;
      const lv = levelOfVisibility(r.visibility);
      if (!lv) continue;
      out.push({
        kind: 'skill', content: memoryTarget(r.ownerGaii, r.key), id: m[1], title: m[1], ...lv,
        url: `${ctx.base}/v1/skills/${enc(m[1])}?scope=user&owner=${enc(ownerName)}`,
        how_to_close: `Make it yours alone with aimeat_skill_update and visibility "owner" (PATCH /v1/skills/${enc(m[1])} with {"visibility":"owner"}).`,
      });
    }
    return out;
  },
};

export const datapackageSource: ExposureSource = {
  kind: 'datapackage',
  async list(ctx, _ownerName, ownerGhii) {
    // Every data package is public: its files have a permanent address that any program reads
    // without signing in (services/datapackage/store.ts).
    const pointers = await listDataPackages({ storage: ctx.storage, config: ctx.config }, ownerGhii);
    return pointers.map((p): ExposureItem => ({
      kind: 'datapackage', id: p.packageId, title: p.name, level: 'public', url: p.descriptorUrl,
      how_to_close: `A data package stays at its address once published; to take it away, remove its files under datapkg/${p.name}/ with aimeat_storage_delete (DELETE /v1/storage/datapkg/${enc(p.name)}/...) and its catalogue record with aimeat_memory_delete.`,
    }));
  },
};

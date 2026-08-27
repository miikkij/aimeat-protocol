/**
 * @file src/services/app-ui/service.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One app's mosaic layout as a memory record (TARGET-074) — the surface-layout
 *   service's discipline applied per app: WHOLE-VALUE REPLACE, automatic versioning through the
 *   memory history (undo is one call, so the set tool needs no undo machinery of its own), and
 *   validation before a single byte is written.
 *
 *   THE LAYOUT LIVES IN THE APP OWNER'S OWN NAMESPACE at `atelier.mosaic.<filename>`, visibility
 *   public — an app's arrangement is as public as the app, and the app page reads it without a
 *   session. Writing it is the owner's (and their agents'): every door resolves the caller to an
 *   owner and compares against the app's, and a mismatch is a 403 with the owner's name in it.
 *
 *   ONE CAPABILITY, ONE IMPLEMENTATION: the REST routes and the node MCP tools both call this
 *   class; the connector and CLI doors proxy the routes. Nothing validates or writes anywhere
 *   else.
 * @structure AppUiService — read() · write() · versions() · restore() · remove()
 * @usage
 *   const svc = new AppUiService(storage, config);
 *   const { layout } = await svc.read(app.ownerGaii, filename);
 * @version-history
 *   v1.0.0 — 2026-08-27 — Initial (TARGET-074 phase 2).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { resolveAppOwnerScope } from '../app-lifecycle.js';
import { provenanceForWrite, type DeclaredProvenance } from '../ai-provenance.js';
import { validateUiLayout, AppUiError, type AppUiLayout } from './validate.js';

/** Who wrote the layout and what they said about how it was made. Minted HERE, once, so every
 *  door (REST, node MCP, connector, CLI) carries the same provenance decision. */
export interface WriteProvenance {
  /** The resolved caller — GHII or GAII, never a raw sub. */
  principal: string;
  /** An existing record the caller asked to attach; checked against the caller's own account. */
  declaredId?: string;
  /** What the caller declared about how the layout was made. */
  declared?: DeclaredProvenance;
}

/** The record address, per app file. Stable: later writes and overlays key on it. */
export function mosaicKey(filename: string): string {
  return `atelier.mosaic.${filename}`;
}

export interface ReadResult {
  /** The stored layout, or null when the app has never stored one. */
  layout: AppUiLayout | null;
  version: number | null;
}

export interface WriteResult {
  version: number;
  /** The version the write replaced — undo restores it. Null on the first write. */
  replaced_version: number | null;
}

export class AppUiService {
  constructor(private storage: Storage, private config: AimeatConfig) {}

  /**
   * Resolve the CALLER to their owner's copy of one published app — the decision both MCP doors
   * lean on, here so it exists exactly once. An agent resolves to the owner it acts for; an app
   * that owner has not published answers with words, not a null.
   */
  async ownApp(callerGaii: string, filename: string): Promise<{ ownerGaii: string; ownerName: string }> {
    const scope = await resolveAppOwnerScope(this.storage, this.config, callerGaii);
    if (!scope) throw new AppUiError('BAD_IDENTITY', 'Failed to parse the caller identity.', 401);
    const app = await this.storage.getAppByOwnerName(scope.ownerName, filename);
    if (!app) {
      throw new AppUiError('NOT_FOUND',
        `No published app "${filename}" under your owner "${scope.ownerName}". A layout belongs to a published app — publish first, or check the filename with aimeat_app_list.`, 404);
    }
    return { ownerGaii: app.ownerGaii, ownerName: scope.ownerName };
  }

  /** The stored layout for one app, unvalidated on the way OUT (a stored layout was validated
   *  on the way in; an unreadable one answers as a worded 422, never a crash). */
  async read(ownerGaii: string, filename: string): Promise<ReadResult> {
    const record = await this.storage.getMemory(ownerGaii, mosaicKey(filename));
    if (!record) return { layout: null, version: null };
    try {
      const parsed = typeof record.value === 'string' ? JSON.parse(record.value) : record.value;
      return { layout: parsed as AppUiLayout, version: record.version };
    } catch {
      throw new AppUiError('LAYOUT_UNREADABLE',
        'The stored layout is not readable JSON. Write a fresh one — the write replaces it whole.', 422);
    }
  }

  /** Validate, then replace the whole layout. The previous value goes to the history. */
  async write(
    ownerGaii: string, filename: string, raw: unknown, provenance?: WriteProvenance,
  ): Promise<WriteResult> {
    const layout = validateUiLayout(raw);
    // A layout carries free text a person reads (titles, empty-state wording), so it is stamped
    // like any other write: declared if the caller said something, Mint-3 if it said nothing.
    // A declaredId is checked against the caller's own account — never attached raw.
    const aiProvenanceId = provenance ? await provenanceForWrite(this.storage, {
      principal: provenance.principal,
      content: JSON.stringify(layout),
      declaredId: provenance.declaredId,
      declared: provenance.declared,
      pipeline: 'app-ui.write',
      surface: { visibility: 'public', humanAudience: true },
      labelPolicy: this.config.aiLabelPublic,
      nodeId: this.config.nodeId,
      baseUrl: this.config.baseUrl,
      enabled: this.config.aiProvenance,
    }) : undefined;
    const key = mosaicKey(filename);
    const now = new Date().toISOString();
    const existing = await this.storage.getMemory(ownerGaii, key);
    await this.storage.setMemory({
      key,
      ownerGaii,
      value: JSON.stringify(layout),
      visibility: 'public',
      tags: ['atelier', 'mosaic'],
      ttlHours: null,
      version: existing ? existing.version + 1 : 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      // The previous value is archived on overwrite, which is where undo comes from.
      trackable: true,
      ...(aiProvenanceId ? { aiProvenanceId } : {}),
    });
    return { version: existing ? existing.version + 1 : 1, replaced_version: existing?.version ?? null };
  }

  /** The layout's history, newest first — what restore() picks from. */
  async versions(ownerGaii: string, filename: string, limit = 50): Promise<Array<{ version: number; recorded_at: string }>> {
    const rows = await this.storage.listMemoryHistory(ownerGaii, mosaicKey(filename), { limit: Math.min(limit, 200) });
    return rows.map((r) => ({ version: r.version, recorded_at: r.recordedAt }));
  }

  /** Bring one archived version back — RE-VALIDATED, because the registry may have moved on. */
  async restore(ownerGaii: string, filename: string, version: number, provenance?: WriteProvenance): Promise<WriteResult> {
    const rows = await this.storage.listMemoryHistory(ownerGaii, mosaicKey(filename), { limit: 200 });
    const hit = rows.find((r) => r.version === version);
    if (!hit) {
      throw new AppUiError('VERSION_NOT_FOUND', `No stored layout version ${version} for this app.`, 404);
    }
    let parsed: unknown;
    try {
      parsed = typeof hit.value === 'string' ? JSON.parse(hit.value) : hit.value;
    } catch {
      throw new AppUiError('VERSION_UNREADABLE', `Version ${version} is not readable JSON.`, 422);
    }
    return this.write(ownerGaii, filename, parsed, provenance);
  }

  /** Delete the stored layout; the app falls back to whatever its own code renders. */
  async remove(ownerGaii: string, filename: string): Promise<void> {
    await this.storage.deleteMemory(ownerGaii, mosaicKey(filename));
  }
}

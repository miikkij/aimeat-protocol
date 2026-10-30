/**
 * @file src/services/design-book/kit-defaults.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which style kit a new app starts from (wish-omat-tyylipohjat-yrityksen-ja-k-ytt-j-n-jaettavissa).
 *
 *   TWO DEFAULTS. A person chooses their own kit, and an organism's owners and admins choose the
 *   organism's. A build asks inForce() first: the organism's kit when it names an organism the
 *   builder is an active member of, else the person's own, else none. A DEFAULT, NEVER A RULE: the
 *   answer tells the builder to use it unless the person asks for something else.
 *
 *   One record per subject under the node's own system identity, stored private and outside the
 *   part prefix: `atelier.book.kitdefault.org.<organism>` and `atelier.book.kitdefault.owner.<account>`.
 *   No token can act as the system identity, so these doors are the only way to set one, and
 *   nothing but inForce() reads one.
 *
 *   A DEFAULT POINTS AT A KIT ITS READERS CAN READ. An organism's default is a kit for that organism
 *   or a published kit for the whole node, never one only its proposer reads. A kit that later
 *   narrows, retires or disappears is passed over by inForce(), which says so, and the next default
 *   in line answers.
 * @structure DesignBookKits — setDefault(caller, { organism?, kit }) · inForce(caller, organism?) · mine(caller)
 * @usage
 *   const kits = new DesignBookKits(storage, config);
 *   const out = await kits.inForce(callerGaii, organismId);
 * @version-history
 *   v1.0.0 — 2026-10-30 — Initial (wish-omat-tyylipohjat-yrityksen-ja-k-ytt-j-n-jaettavissa).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { localAccountName } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { resolveAppOwnerScope } from '../app-owner-scope.js';
import { systemGhiiFor } from '../compliance-register.js';
import { isOrganismOwner } from '../organism-ownership.js';
import { updateMemoryRecord } from '../record-cas.js';
import { DesignBookError } from './errors.js';
import { DesignBookService, type DesignBookPart, type PartSummaryRow } from './service.js';
import { isActiveMember, kitReach, kitSnippet, type KitBody } from './kit.js';

const DEFAULT_PREFIX = 'atelier.book.kitdefault.';

interface DefaultRecord { spec: 'aimeat.designbook.kitdefault/v1'; kit: string; set_by: string; set_at: string }

export interface KitInForce {
  kit: { id: string; title: string; summary: string; version: number; body: KitBody } | null;
  source: 'organism' | 'own' | null;
  organism?: string;
  apply?: ReturnType<typeof kitSnippet>;
  /** A default that no longer answers, and why: the next one in line answered instead. */
  passed_over?: Array<{ source: 'organism' | 'own'; kit: string; why: string }>;
  note: string;
}

export class DesignBookKits {
  private book: DesignBookService;
  constructor(private storage: Storage, private config: AimeatConfig) {
    this.book = new DesignBookService(storage, config);
  }

  private system(): string { return systemGhiiFor(this.config.nodeId); }

  /** The caller's owner GHII: an owner session is already one, an agent resolves to the owner it acts for. */
  private async ownerOf(caller: string): Promise<string> {
    const owner = caller.includes('#') ? (await resolveAppOwnerScope(this.storage, this.config, caller))?.ownerGhii : caller;
    if (!owner) throw new DesignBookError('BAD_IDENTITY', 'Failed to parse the caller identity.', 401);
    return owner;
  }

  private keyFor(subject: { organism?: string; owner?: string }): string {
    return subject.organism ? `${DEFAULT_PREFIX}org.${subject.organism}` : `${DEFAULT_PREFIX}owner.${subject.owner}`;
  }

  private async readDefault(key: string): Promise<string | null> {
    const rec = await this.storage.getMemory(this.system(), key);
    if (!rec) return null;
    try {
      const v = (typeof rec.value === 'string' ? JSON.parse(rec.value) : rec.value) as DefaultRecord;
      return typeof v?.kit === 'string' ? v.kit : null;
    } catch (err) {
      // An unreadable default answers as none, and the next one in line answers; say it in the log.
      logger.warn(`design-book kit default ${key} is unreadable: ${(err as Error).message}`);
      return null;
    }
  }

  /** May this owner choose the organism's default? Its owners and its admins may. */
  private async assertOrganismAdmin(organismId: string, ownerGhii: string): Promise<void> {
    const org = await this.storage.getOrganism(organismId);
    if (!org) throw new DesignBookError('NOT_FOUND', `No organism "${organismId}".`, 404);
    const name = localAccountName(ownerGhii);
    if (isOrganismOwner(org, name)) return;
    const m = await this.storage.getMembership(organismId, name);
    if (m && m.status === 'active' && (m.role === 'admin' || m.role === 'creator')) return;
    throw new DesignBookError('NOT_ALLOWED', 'An organism\'s default kit is chosen by its owners and admins.', 403);
  }

  /**
   * Choose the default kit, or clear it with kit null: the organism's when `organism` is named (its
   * owners and admins), else the caller's own.
   */
  async setDefault(caller: string, opts: { organism?: string; kit: string | null }): Promise<{ subject: 'organism' | 'own'; organism?: string; kit: string | null }> {
    const ownerGhii = await this.ownerOf(caller);
    if (opts.organism) await this.assertOrganismAdmin(opts.organism, ownerGhii);
    const key = this.keyFor(opts.organism ? { organism: opts.organism } : { owner: localAccountName(ownerGhii) });
    const subject = opts.organism ? 'organism' as const : 'own' as const;
    if (opts.kit === null) {
      await this.storage.deleteMemory(this.system(), key);
      return { subject, ...(opts.organism ? { organism: opts.organism } : {}), kit: null };
    }
    // Read as the caller: a kit they cannot read answers as one that does not exist.
    const { part } = await this.book.get(opts.kit, ownerGhii);
    if (part.kind !== 'kit') {
      throw new DesignBookError('NOT_A_KIT', `"${opts.kit}" is a ${part.kind} part, not a kit. Kits are listed with kind "kit".`, 422);
    }
    if (part.status !== 'published' && part.status !== 'aging') {
      throw new DesignBookError('NOT_PUBLISHED', `"${opts.kit}" is ${part.status}. A default is a kit everyone it serves can take.`, 409);
    }
    if (opts.organism) {
      const reach = kitReach(part);
      const body = part.body as unknown as KitBody;
      if (reach === 'own' || (reach === 'organism' && body.organism !== opts.organism)) {
        throw new DesignBookError('NOT_FOR_THIS_ORGANISM',
          `"${opts.kit}" is not readable by this organism's members. Propose it again with reach "organism" and "organism": "${opts.organism}", or choose a published kit for the whole node.`, 409);
      }
    }
    const value: DefaultRecord = { spec: 'aimeat.designbook.kitdefault/v1', kit: opts.kit, set_by: caller, set_at: new Date().toISOString() };
    await updateMemoryRecord(this.storage, this.system(), key, () => ({
      value: JSON.stringify(value), visibility: 'private', tags: ['designbook', 'kit-default'], ttlHours: null,
    }));
    return { subject, ...(opts.organism ? { organism: opts.organism } : {}), kit: opts.kit };
  }

  /** The kit a new app of this caller starts from: the organism's, else their own, else none. */
  async inForce(caller: string, organism?: string): Promise<KitInForce> {
    const ownerGhii = await this.ownerOf(caller);
    if (organism && !(await isActiveMember(this.storage, organism, ownerGhii))) {
      throw new DesignBookError('NOT_A_MEMBER', `You are not an active member of organism "${organism}", so its kit is not yours to build with.`, 403);
    }
    const passed: NonNullable<KitInForce['passed_over']> = [];
    const candidates: Array<{ source: 'organism' | 'own'; key: string }> = [
      ...(organism ? [{ source: 'organism' as const, key: this.keyFor({ organism }) }] : []),
      { source: 'own' as const, key: this.keyFor({ owner: localAccountName(ownerGhii) }) },
    ];
    for (const c of candidates) {
      const id = await this.readDefault(c.key);
      if (!id) continue;
      const found = await this.liveKit(id, ownerGhii);
      if (typeof found === 'string') { passed.push({ source: c.source, kit: id, why: found }); continue; }
      const body = found.part.body as unknown as KitBody;
      return {
        kit: { id, title: found.part.title, summary: found.part.summary, version: found.version, body },
        source: c.source, ...(organism ? { organism } : {}),
        apply: kitSnippet(body, found.part.title),
        ...(passed.length ? { passed_over: passed } : {}),
        note: c.source === 'organism'
          ? 'The organism chose this kit for its members\' new apps. Build in it unless the person asks for something else.'
          : 'The person chose this kit for their new apps. Build in it unless they ask for something else.',
      };
    }
    return {
      kit: null, source: null, ...(organism ? { organism } : {}), ...(passed.length ? { passed_over: passed } : {}),
      note: 'No kit applies. Pick a genre as usual. The person can choose a kit for their new apps (aimeat_designbook_kit_default), and the kits they can read are listed with aimeat_designbook_search { kind: "kit" }.',
    };
  }

  /** The kit, or why it no longer answers. */
  private async liveKit(id: string, ownerGhii: string): Promise<{ part: DesignBookPart; version: number } | string> {
    try {
      const { part, version } = await this.book.get(id, ownerGhii);
      if (part.kind !== 'kit') return 'it is no longer a kit';
      if (part.status !== 'published' && part.status !== 'aging') return `it is ${part.status}`;
      return { part, version };
    } catch (err) {
      if (err instanceof DesignBookError && err.status === 404) return 'it no longer exists, or you can no longer read it';
      throw err;
    }
  }

  /** The kits this caller can read: their own, their organisms', and the published ones. */
  async mine(caller: string): Promise<PartSummaryRow[]> {
    return this.book.list({ kind: 'kit', limit: 200 }, { reader: await this.ownerOf(caller) });
  }
}

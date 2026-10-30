/**
 * @file src/services/design-book/kit-defaults.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which style kit a new app starts from (wish-omat-tyylipohjat-yrityksen-ja-k-ytt-j-n-jaettavissa).
 *
 *   THREE DEFAULTS. A person chooses their own kit, an organism's owners and admins choose the
 *   organism's, and the node's operator chooses the node's. A build asks inForce() first: the
 *   organism's kit when it names an organism the builder is an active member of, else the person's
 *   own, else the node's, else none. A DEFAULT, NEVER A RULE: the answer tells the builder to use it
 *   unless the person asks for something else.
 *
 *   One record per subject under the node's own system identity, stored private and outside the
 *   part prefix: `atelier.book.kitdefault.org.<organism>`, `atelier.book.kitdefault.owner.<account>`
 *   and `atelier.book.kitdefault.node`. No token can act as the system identity, so these routes are
 *   the only way to set one, and nothing but inForce() and defaults() reads one.
 *
 *   A DEFAULT POINTS AT A KIT ITS READERS CAN READ. An organism's default is a kit for that organism
 *   or a published kit for the whole node, never one only its proposer reads; the node's default is a
 *   published kit for the whole node. A kit that later narrows, retires or disappears is passed over
 *   by inForce(), which says so, and the next default in line answers.
 * @structure DesignBookKits — setDefault(caller, isOperator, { organism? | node?, kit }) · inForce(caller, organism?) · defaults(caller, isOperator) · mine(caller)
 * @usage
 *   const kits = new DesignBookKits(storage, config);
 *   const out = await kits.inForce(callerGaii, organismId);
 * @version-history
 *   v1.1.0 — 2026-10-30 — The node's default, chosen by the operator and answered last; defaults()
 *     answers every default the caller can see or choose, for Settings › Apps and the admin Apps tab.
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

type DefaultSource = 'organism' | 'own' | 'node';

export interface KitInForce {
  kit: { id: string; title: string; summary: string; version: number; body: KitBody } | null;
  source: DefaultSource | null;
  organism?: string;
  apply?: ReturnType<typeof kitSnippet>;
  /** A default that no longer answers, and why: the next one in line answered instead. */
  passed_over?: Array<{ source: DefaultSource; kit: string; why: string }>;
  note: string;
}

/** One chosen default as defaults() shows it: the kit, or why it no longer answers. */
export interface KitDefaultEntry { kit: string; title?: string; preview_url?: string; unavailable?: string }

export interface KitDefaultsView {
  own: KitDefaultEntry | null;
  node: KitDefaultEntry | null;
  /** The organisms whose default this caller chooses: they are an owner or an admin of each. */
  organisms: Array<{ id: string; name: string; default: KitDefaultEntry | null }>;
  may_set_node: boolean;
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

  private keyFor(subject: { organism?: string; owner?: string; node?: true }): string {
    if (subject.node) return `${DEFAULT_PREFIX}node`;
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
   * Choose the default kit, or clear it with kit null: the node's when `node` is true (its operator),
   * the organism's when `organism` is named (its owners and admins), else the caller's own.
   */
  async setDefault(
    caller: string, isOperator: boolean, opts: { organism?: string; node?: boolean; kit: string | null },
  ): Promise<{ subject: DefaultSource; organism?: string; kit: string | null }> {
    const ownerGhii = await this.ownerOf(caller);
    if (opts.node && opts.organism) {
      throw new DesignBookError('INVALID_INPUT', 'Name the organism or the node, not both: one default is chosen at a time.', 400);
    }
    if (opts.node && !isOperator) {
      throw new DesignBookError('NOT_ALLOWED', 'The node\'s default kit is chosen by its operator.', 403);
    }
    if (opts.organism) await this.assertOrganismAdmin(opts.organism, ownerGhii);
    const key = this.keyFor(opts.node ? { node: true } : opts.organism ? { organism: opts.organism } : { owner: localAccountName(ownerGhii) });
    const subject: DefaultSource = opts.node ? 'node' : opts.organism ? 'organism' : 'own';
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
    if (opts.node && kitReach(part) !== 'node') {
      throw new DesignBookError('NOT_FOR_THE_NODE',
        `"${opts.kit}" is not a kit for the whole node, so not everyone here can read it. The node's default is a published kit with reach "node".`, 409);
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

  /** The kit a new app of this caller starts from: the organism's, else their own, else the node's, else none. */
  async inForce(caller: string, organism?: string): Promise<KitInForce> {
    const ownerGhii = await this.ownerOf(caller);
    if (organism && !(await isActiveMember(this.storage, organism, ownerGhii))) {
      throw new DesignBookError('NOT_A_MEMBER', `You are not an active member of organism "${organism}", so its kit is not yours to build with.`, 403);
    }
    const passed: NonNullable<KitInForce['passed_over']> = [];
    const candidates: Array<{ source: DefaultSource; key: string }> = [
      ...(organism ? [{ source: 'organism' as const, key: this.keyFor({ organism }) }] : []),
      { source: 'own' as const, key: this.keyFor({ owner: localAccountName(ownerGhii) }) },
      { source: 'node' as const, key: this.keyFor({ node: true }) },
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
          : c.source === 'own'
            ? 'The person chose this kit for their new apps. Build in it unless they ask for something else.'
            : 'The node\'s operator chose this kit for new apps on this node, and the person has not chosen one of their own. Build in it unless they ask for something else.',
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

  /**
   * Every default this caller can see or choose: their own, the node's, and the default of each
   * organism they are an owner or an admin of. A chosen kit that no longer answers is shown with why.
   */
  async defaults(caller: string, isOperator: boolean): Promise<KitDefaultsView> {
    const ownerGhii = await this.ownerOf(caller);
    const name = localAccountName(ownerGhii);
    const entry = async (key: string): Promise<KitDefaultEntry | null> => {
      const id = await this.readDefault(key);
      if (!id) return null;
      const found = await this.liveKit(id, ownerGhii);
      return typeof found === 'string' ? { kit: id, unavailable: found } : { kit: id, title: found.part.title };
    };
    const organisms: KitDefaultsView['organisms'] = [];
    for (const m of await this.storage.listMembershipsByGhii(name)) {
      if (m.status !== 'active') continue;
      const org = await this.storage.getOrganism(m.organismId);
      if (!org || org.archived) continue;
      if (!(m.role === 'admin' || m.role === 'creator' || isOrganismOwner(org, name))) continue;
      organisms.push({ id: org.id, name: org.name, default: await entry(this.keyFor({ organism: org.id })) });
    }
    return {
      own: await entry(this.keyFor({ owner: name })),
      node: await entry(this.keyFor({ node: true })),
      organisms,
      may_set_node: isOperator,
      note: 'A new app starts from the organism\'s kit when it is built for an organism that chose one, else from the person\'s own, else from the node\'s. It is a default, never a rule.',
    };
  }

  /** The kits this caller can read: their own, their organisms', and the published ones. */
  async mine(caller: string): Promise<PartSummaryRow[]> {
    return this.book.list({ kind: 'kit', limit: 200 }, { reader: await this.ownerOf(caller) });
  }
}

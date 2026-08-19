/**
 * @file src/services/home-playbooks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The PLAYBOOKS: named outcomes a person actually arrives wanting ("a shop where
 *   cards, coins and agents all pay"), each with the steps in plain words, live proof they can
 *   open, and the prompt that walks it.
 *
 *   WHY THIS IS NOT THE ROOMS AGAIN. The four rooms were abstract categories ("I want to make
 *   things") forced onto the top of an empty home, with no recipe and nothing to look at; they
 *   were removed on 2026-08-18 for exactly that. A playbook is the opposite in all three ways: it
 *   names the OUTCOME rather than a section of the product, it carries the steps and the prompt
 *   that produce it, and it points at something already running on this node that the person can
 *   click. It also lives below the status, folded, rather than in the hero. The room ids survive
 *   in home-rooms.ts only as the funnel's marker vocabulary.
 *
 *   NOTHING HERE PROMISES WHAT THIS NODE CANNOT DO. Each playbook states how its capability is
 *   checked (the same idea home-rooms.ts uses), and one that fails its check is not offered —
 *   selling a marketplace on a node with commerce switched off is the failure this prevents.
 *
 *   PROOF LINKS ARE DATA, NOT CODE. A playbook names CANDIDATE subdomains; the node's own mapping
 *   table decides. On aimeat.io `exchange` and `noste` resolve and become links; on a node that
 *   has neither, the playbook simply renders without proof. No AIMEAT node ever advertises another
 *   node's apps.
 *
 *   THE WORDS ARE NOT HERE. Titles, leads and steps are locale keys the client resolves
 *   (`home.playbooks.<id>.title` / `.lead` / `.step1`…), so the node never decides which language
 *   a person reads — the same contract the home feed already follows.
 * @structure PLAYBOOKS · PlaybookDef · openPlaybooks(storage, config)
 * @usage
 *   import { openPlaybooks } from '../services/home-playbooks.js';
 *   const playbooks = await openPlaybooks(storage, config);
 * @version-history
 *   v1.0.0 — 2026-08-19 — Initial: the four first playbooks (marketplace, connected accounts, own
 *     page, own instance), their capability checks, and proof resolved from this node's own
 *     subdomain mappings.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { buildOutboundProviders, listProviderMeta } from './connections/providers.js';

export interface PlaybookDef {
    /** Also the locale-key stem: home.playbooks.<id>.title / .lead / .step1… */
    id: string;
    /** The managed prompt that walks it. Operator-editable, versioned, localized. */
    prompt: string;
    /** How many step keys the client should read. Fewer keys than this is a locale bug, not a shape. */
    steps: number;
    /**
     * Whether this node can do it at all.
     *   'always'    — every node serves it.
     *   'commerce'  — the money layer is switched on here.
     *   'providers' — this node offers at least one account to attach. listProviderMeta already
     *                 answers that honestly: it drops what the master switch turns off and keeps the
     *                 OAuth providers a person can use with their OWN credentials, so an operator
     *                 who registered no client of their own does not silently remove the choice.
     */
    presence: 'always' | 'commerce' | 'providers';
    /**
     * Subdomains that would PROVE it if this node has them. Candidates, never URLs: the mapping
     * table answers, and an absent mapping costs the playbook nothing but its proof.
     */
    proof?: readonly string[];
}

/**
 * The playbooks, in the order they are offered. Money first because it is the one people arrive
 * asking for by name, and the instance last because it is the answer to "and what if I want all of
 * this on my own machine" rather than a first move.
 */
export const PLAYBOOKS: readonly PlaybookDef[] = [
    { id: 'marketplace', prompt: 'playbook-marketplace', steps: 4, presence: 'commerce', proof: ['exchange', 'noste'] },
    { id: 'accounts', prompt: 'playbook-accounts', steps: 4, presence: 'providers' },
    { id: 'page', prompt: 'playbook-page', steps: 4, presence: 'always' },
    { id: 'instance', prompt: 'playbook-instance', steps: 4, presence: 'always' },
];

/** One resolved proof link, or nothing when this node has no such mapping. */
async function proofLinks(
    storage: Storage, config: AimeatConfig, subs: readonly string[] | undefined,
): Promise<Array<{ name: string; url: string }>> {
    if (!subs?.length || !config.appHost) return [];
    const out: Array<{ name: string; url: string }> = [];
    for (const sub of subs) {
        try {
            const site = await storage.getSubdomainSite(sub);
            // A disabled mapping is not proof: it is a link into a page the operator turned off.
            if (site?.enabled) out.push({ name: sub, url: `https://${sub}.${config.appHost}` });
        } catch (err) {
            logger.warn('home-playbooks: proof lookup failed, offering the playbook without it', {
                subdomain: sub, error: String(err),
            });
        }
    }
    return out;
}

/**
 * The playbooks this node can actually deliver, each with its prompt, its step count and whatever
 * proof exists here.
 *
 * Never throws: a failed check drops that one playbook rather than taking down the home, and the
 * safe direction is not offering it — a recipe for something this node cannot do wastes the
 * person's afternoon before it disappoints them.
 */
export async function openPlaybooks(
    storage: Storage, config: AimeatConfig,
): Promise<Array<{ id: string; prompt: string; steps: number; proof: Array<{ name: string; url: string }> }>> {
    const out: Array<{ id: string; prompt: string; steps: number; proof: Array<{ name: string; url: string }> }> = [];
    for (const pb of PLAYBOOKS) {
        let present = false;
        try {
            if (pb.presence === 'always') {
                present = true;
            } else if (pb.presence === 'commerce') {
                present = !!config.commerceEnabled;
            } else if (pb.presence === 'providers') {
                present = listProviderMeta(buildOutboundProviders(config)).length > 0;
            }
        } catch (err) {
            logger.warn('home-playbooks: presence check failed, treating the playbook as unavailable', {
                playbook: pb.id, error: String(err),
            });
            present = false;
        }
        if (!present) continue;
        out.push({ id: pb.id, prompt: pb.prompt, steps: pb.steps, proof: await proofLinks(storage, config, pb.proof) });
    }
    return out;
}

/**
 * @file src/services/surface-layout/registry.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one place that knows which blocks exist, which of them this node can actually
 *   serve, and what each surface looks like when nobody has configured it.
 *
 *   A FAILED CHECK CLOSES THE DOOR QUIETLY. blocksForSurface() never throws: a block whose presence
 *   cannot be established is not offered, the same rule home-rooms.ts and home-playbooks.ts already
 *   follow. A front page that half-renders because one check raised is worse than one that omits a
 *   section, and an operator picking from a list of blocks this node cannot deliver would be sold
 *   something that then renders as nothing.
 *
 *   THE DEFAULTS ARE THE PAGES AS THEY SHIP. DEFAULT_LAYOUTS is not a suggestion or a starter kit:
 *   it is today's portal and today's home written out as blocks, so a node with no stored layout
 *   renders exactly what it renders now, and an operator pressing "start from the default" gets the
 *   real page to edit rather than a blank one. When a block is added to a surface it belongs in the
 *   default too, or shipping it hides it from every node that already saved a layout.
 *
 *   THE OPERATOR'S WORDS AND THE BLOCK'S WORDS ARE DIFFERENT KEYS. `localeStem` points at the
 *   content keys the component already reads (home.mail.unread, landing.wallTitle) and those are
 *   untouched. What the operator reads in the picker is `surface.blocks.<id>.label`, derived here,
 *   because an existing stem has no `.title` to borrow and inventing one under it would mean
 *   sixteen new keys under names that already mean something else.
 * @structure ALL_BLOCKS · blockById · blocksForSurface · operatorLabelKey · DEFAULT_LAYOUTS ·
 *   defaultLayout
 * @usage
 *   import { blocksForSurface, defaultLayout } from './registry.js';
 *   const offered = blocksForSurface('home', config);
 * @version-history
 *   v1.2.1 — 2026-08-28 — The default home puts the fleet line before the chat door: the door is
 *     the coral band of the poster home and closes the status group. Stored layouts are untouched.
 *   v1.2.0 — 2026-08-28 — The built-in portal is the showroom: six new blocks (showroom-hero,
 *     wall-intro, store, trust, rooms, close) and a new default order. Nothing was removed from the
 *     catalogue; the nine blocks the default no longer lists are still an operator's to add.
 *   v1.1.0 — 2026-08-27 — The chat door joins the built-in onboarding home, under the steps.
 *   v1.0.0 — 2026-08-26 — Initial: the two block sets joined, presence evaluated, and the default
 *     layouts for the three surfaces.
 */
import type { AimeatConfig } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { chatEnabled } from '../chat-session.js';
import { HOME_BLOCKS } from './blocks-home.js';
import { PORTAL_BLOCKS } from './blocks-portal.js';
import type { CapabilityName, SurfaceBlockDef } from './registry-types.js';
import type { SurfaceId, SurfaceLayout, SurfaceBlockInstance } from './types.js';

/**
 * The block every surface shares: whatever the registry does not cover, written by the operator or
 * their AI. It is markdown and never markup — see the service's write path for why.
 */
const COMMON_BLOCKS: readonly SurfaceBlockDef[] = [
    {
        id: 'common.band',
        surfaces: ['portal', 'home', 'home-onboarding'],
        presence: { kind: 'always' },
        localeStem: 'surface.band',
        liveDomains: [],
        props: {
            tone: {
                type: 'enum',
                values: ['plain', 'band'],
                default: 'band',
                description: 'Whether the group is framed with a heading and a rule, or just stacked.',
            },
            titleKey: {
                type: 'string',
                maxLength: 120,
                default: '',
                description: 'A named heading this node already has words for, in every language it speaks. Your own heading, if you set one, wins over it.',
            },
        },
        maxPerSurface: 6,
        container: true,
        summary: 'A group with a heading that holds other blocks, so a page reads as sections rather than a list.',
    },
    {
        id: 'common.freeform',
        surfaces: ['portal', 'home', 'home-onboarding'],
        presence: { kind: 'always' },
        localeStem: 'surface.freeform',
        liveDomains: ['site'],
        props: {
            tone: {
                type: 'enum',
                values: ['plain', 'card', 'band'],
                default: 'card',
                description: 'How the passage is framed on the page.',
            },
        },
        maxPerSurface: 12,
        // The summary is read by an operator picking a block and by an AI composing a page, so it
        // says what the thing IS rather than what it is not covered by.
        summary: 'A passage in your own words, written in Markdown, for anything the other parts do not say.',
    },
];

export const ALL_BLOCKS: readonly SurfaceBlockDef[] = [
    ...COMMON_BLOCKS,
    ...HOME_BLOCKS,
    ...PORTAL_BLOCKS,
];

const BY_ID = new Map(ALL_BLOCKS.map(b => [b.id, b]));

export function blockById(id: string): SurfaceBlockDef | undefined {
    return BY_ID.get(id);
}

/** The locale key an OPERATOR reads for this block, as opposed to the words the block itself shows. */
export function operatorLabelKey(id: string): string {
    return `surface.blocks.${id}.label`;
}

/** Named predicates, resolved against the real function rather than a config field that may not exist. */
const CAPABILITIES: Record<CapabilityName, (config: AimeatConfig) => boolean> = {
    chat: chatEnabled,
};

/** Whether this node serves the block at all. Never throws; an unanswerable check closes the door. */
export function blockIsPresent(def: SurfaceBlockDef, config: AimeatConfig): boolean {
    try {
        switch (def.presence.kind) {
            case 'always':
                return true;
            case 'config':
                return config[def.presence.configKey] === true;
            case 'capability':
                return CAPABILITIES[def.presence.capability](config) === true;
            case 'session':
                // Auth state is the browser's to know; the node offers the block and the renderer
                // decides. Declaring it here is what lets the admin picker say who will see it.
                return true;
            default:
                return false;
        }
    } catch (err) {
        // The door closes, because a block whose presence cannot be established must not be offered
        // to an operator who would then watch it render as nothing. But it closes AUDIBLY: a silent
        // false here is indistinguishable from "this node does not have that", and someone would
        // spend an afternoon looking for a block that a thrown predicate had quietly removed.
        logger.warn(`[surface-layout] presence check failed for ${def.id}, block withheld: ${(err as Error).message}`);
        return false;
    }
}

/** Which blocks this node can offer on this surface, in declaration order. */
export function blocksForSurface(surface: SurfaceId, config: AimeatConfig): SurfaceBlockDef[] {
    return ALL_BLOCKS.filter(b => b.surfaces.includes(surface) && blockIsPresent(b, config));
}

/** Shorthand for a default entry: one instance whose key is its id. */
function b(id: string, props?: SurfaceBlockInstance['props']): SurfaceBlockInstance {
    return props ? { id, key: id, props } : { id, key: id };
}

/**
 * Each surface as it ships today. The portal list is views/landing.js's own order; the home list is
 * views/home/index.js:263-295; the onboarding list is what that file renders while the account is
 * not yet initialized.
 */
export const DEFAULT_BLOCKS: Record<SurfaceId, SurfaceBlockInstance[]> = {
    // The showroom order (2026-08-28): the wish box and the three doors in one hero, the live
    // counters as its first evidence, the wall with its introduction, then the store (offered only
    // when this node has one), the safety list, the two rooms, and what shipped lately as the proof
    // under the "built with itself" claim. The blocks this replaced (the front door, the pitch line,
    // the folded builder, the connect invitation, the owner-or-tenant hero, the two prompts, today's
    // stats and the transparency line) stay in the catalogue for an operator to put back.
    portal: [
        b('portal.showroom-hero'),
        b('portal.totals'),
        b('portal.wall-intro'),
        b('portal.gallery'),
        b('portal.store'),
        b('portal.trust'),
        b('portal.rooms'),
        b('portal.changelog'),
        b('portal.close'),
    ],
    home: [
        b('home.nameplate'),
        // Directly under the nameplate, because on the days it appears at all it is the most
        // important thing on the page: nothing else here works over chat until it is done. On every
        // other day it renders nothing and the mat line moves up into its place.
        b('home.mcp-connect'),
        b('home.mat'),
        b('home.mailbox'),
        // The two status lines first and the door after them: on the poster home the door is the
        // coral band, and a band reads as the close of the "now" group, not as a line inside it.
        b('home.fleet'),
        b('home.chat-door'),
        b('home.things'),
        // The playbooks and the achievements strip share one titled band, exactly as they do today.
        // This is why the schema has a nesting level at all: a flat list cannot say "these two go
        // together under this heading", and the band is what makes the page read as sections.
        {
            id: 'common.band',
            key: 'band.setup',
            props: { tone: 'band', titleKey: 'home.playbooks.title' },
            children: [b('home.playbooks'), b('home.achievements')],
        },
        b('home.feed'),
        b('home.open-items'),
        b('home.install-cta'),
        b('home.trust'),
    ],
    'home-onboarding': [
        b('home.nameplate'),
        b('home.steps'),
        // Right under the steps, where the chat used to be the whole landing page for a new account.
        // Filtered out with the rest on a node that has no chat, so it never renders empty.
        b('home.chat-door'),
        b('home.install-cta'),
        b('home.feed'),
        b('home.trust'),
    ],
};

/**
 * The built-in layout for a surface, as THIS node can serve it.
 *
 * Filtered by presence rather than handed out whole, and the reason is not cosmetic: the built-in
 * home names the chat door, which a node with no chat cannot serve. Unfiltered, that node would
 * render a block with nothing behind it, and "start from the built-in layout" would be refused by
 * the validator for naming a block this node does not have — the built-in layout failing its own
 * write gate. It is filtered here, once, so the fallback and the starting point agree.
 *
 * Fresh object every call: callers hand it onward and edit it.
 */
export function defaultLayout(surface: SurfaceId, config: AimeatConfig): SurfaceLayout {
    const servable = (list: SurfaceBlockInstance[]): SurfaceBlockInstance[] => list
        .filter(x => { const def = blockById(x.id); return def ? blockIsPresent(def, config) : false; })
        .map(x => ({ ...x, ...(x.children ? { children: servable(x.children) } : {}) }));
    return {
        v: 1,
        surface,
        binding: { kind: 'node' },
        blocks: servable(DEFAULT_BLOCKS[surface]),
        meta: {
            // A time nobody set: the default has no edit history, and stamping "now" on it would
            // make every read look like a fresh change to anything watching updatedAt.
            updatedAt: '1970-01-01T00:00:00.000Z',
            updatedBy: 'node',
            source: 'default',
        },
    };
}

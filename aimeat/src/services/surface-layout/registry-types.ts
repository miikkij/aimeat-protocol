/**
 * @file src/services/surface-layout/registry-types.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a surface block declares about itself: which surfaces may host it, whether this
 *   node can serve it at all, which locale key carries its words, which live-update domains its data
 *   depends on, and what an operator may set on it.
 *
 *   THE PROP SCHEMA IS DATA, NOT A VALIDATOR LIBRARY. It is deliberately not zod, because this shape
 *   is serialised twice: into the admin form that draws the settings, and into the AI prompt that
 *   tells a chat what it may write. A runtime-only validator would leave both of those to be
 *   maintained by hand against a third source, which is the drift this registry exists to close.
 *   The validator reads the same declaration the form and the prompt do.
 *
 *   PRESENCE IS THE NODE'S ANSWER; EMPTINESS IS THE BROWSER'S. `presence` says whether this node
 *   serves the block at all — a marketplace block on a node with commerce switched off is not
 *   offered, the same rule home-playbooks.ts already follows. Whether a block that IS served has
 *   anything to say today is a question only the browser can answer, because only it has the data,
 *   and the existing home rule stands: a block with nothing to say renders nothing.
 *
 *   PRESENCE IS NOT A CAPABILITY SWITCH. An operator hiding the commerce block does not close
 *   /v1/commerce, and nothing here should ever read as though it did. Hiding is about a page.
 * @structure BlockPropDef · BlockPresence · SurfaceBlockDef
 * @usage
 *   import type { SurfaceBlockDef } from './registry-types.js';
 * @version-history
 *   v1.1.0 — 2026-08-28 — storeEnabled joins the boolean keys a block may gate on.
 *   v1.0.0 — 2026-08-26 — Initial.
 */
import type { SurfaceId } from './types.js';

/**
 * One setting an operator may give a block. `description` is written for two readers who never meet:
 * the operator looking at a form field, and the AI reading the generated prompt.
 */
export type BlockPropDef =
    | { type: 'string'; default?: string; maxLength?: number; description: string }
    | { type: 'number'; default?: number; min?: number; max?: number; description: string }
    | { type: 'boolean'; default?: boolean; description: string }
    | { type: 'enum'; values: readonly string[]; default?: string; description: string }
    | {
        type: 'string[]';
        /** When present, every entry must come from this set. */
        values?: readonly string[];
        default?: readonly string[];
        maxItems?: number;
        description: string;
    };

/**
 * Whether this node serves the block at all.
 *   'always'     — every node does.
 *   'config'     — a BOOLEAN FIELD on AimeatConfig says so (commerceEnabled, coOriginEnabled,
 *                  portfolioEnabled, siteEnabled). Only a real field: naming something that is not
 *                  one reads as undefined, which is falsy, and the block then silently never
 *                  appears on any node. `configKey` is typed against AimeatConfig for that reason.
 *   'capability' — a named predicate answers it, because the question is not one field. chatEnabled()
 *                  is the example: it lives in chat-session.ts and weighs several settings, and
 *                  writing `configKey: 'chatEnabled'` would have read a field that does not exist.
 *   'session'    — it only means anything in one auth state, e.g. a sign-up block for a logged-out
 *                  visitor. The surface already implies most of this; `when` covers the portal,
 *                  which anonymous and signed-in visitors both reach.
 */
export type BlockPresence =
    | { kind: 'always' }
    | { kind: 'config'; configKey: BooleanConfigKey }
    | { kind: 'capability'; capability: CapabilityName }
    | { kind: 'session'; when: 'anon' | 'owner' };

/** The boolean AimeatConfig fields a block may gate on. Extend deliberately. */
export type BooleanConfigKey =
    | 'commerceEnabled'
    | 'coOriginEnabled'
    | 'portfolioEnabled'
    | 'siteEnabled'
    | 'storeEnabled';

/** Named predicates a block may gate on, resolved in registry.ts against the real function. */
export type CapabilityName = 'chat';

export interface SurfaceBlockDef {
    /** '<surface-or-common>.<name>'. The browser's component map keys on this exact string. */
    id: string;
    /** Which surfaces may host it. A block listed on more than one is genuinely one component. */
    surfaces: readonly SurfaceId[];
    presence: BlockPresence;
    /**
     * Locale-key stem the BROWSER resolves: `<stem>.title` and whatever else the component reads.
     * The server ships this id and never a sentence, so the node never decides which language a
     * person reads — the same contract the home feed and the playbooks already follow.
     */
    localeStem: string;
    /**
     * Live-update domains this block's data depends on. Each block subscribes to its own through
     * onLiveUpdate(), which is what stops one event costing every fetch on the page. Empty means the
     * block has no server data to refresh.
     */
    liveDomains: readonly string[];
    props: Readonly<Record<string, BlockPropDef>>;
    /** How many instances one layout may carry. 1 for everything except the free-form block. */
    maxPerSurface: number;
    /** Whether this block holds other blocks. Only a band does, and only one level deep. */
    container?: true;
    /** One sentence, in plain words, for the operator's picker and the generated AI prompt. */
    summary: string;
}

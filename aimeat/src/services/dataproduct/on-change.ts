/**
 * @file src/services/dataproduct/on-change.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The data products that run when a source changes (`schedule: { on: 'change' }`; design
 *   canvas "Data ulos", board Vaihe4-Paivitys "Kun lähde muuttuu"; WP9c). A change the node already
 *   announces marks the product dirty, and one run follows: never sooner than CHANGE_QUIET_MS after
 *   the change, so a burst of writes is one run, and never sooner than CHANGE_MIN_GAP_MS after this
 *   product's previous change run. The run writes a version only when the rows changed, as every run
 *   does (./build.ts).
 *
 *   THE SIGNALS ARE THE NODE'S OWN, NOTHING POLLS:
 *     records      the live domain `workspace:<organism>/<ws>` (services/event-bus.ts emitWorkspaceChange),
 *                  which a written record, a draft, a publish and a delete in that workspace emit;
 *     app, memory  the `memoryWritten` event of a key under the app's prefix, or of the one key, by any
 *                  principal of the account that holds it;
 *     file         a stored or removed file (services/storage-file-hooks.ts addStorageFileListener);
 *     datapackage  the source package's `latest.json` pointer, which every published version writes.
 *   An extension action has no such signal; ./definition.ts refuses `on: 'change'` for it.
 *
 *   WHO RUNS IT is injected at boot (server-bootstrap/schedule-kinds.ts) as `runner`: the build lives in
 *   ./service.ts, which imports this file to register and forget products, so importing it back would
 *   close a cycle. The runner acts as the definition's maker, asked again at each run
 *   (./scheduled-job.ts runDataproductOnChange).
 *
 *   THE INDEX is in process memory: every definition that runs on a change, read once at boot across
 *   accounts (listMemoryKeysByPrefix) and kept current by define and delete (noteChangeWatch). A change
 *   seen while the node was down is not replayed; the next change after start runs the product.
 * @structure CHANGE_QUIET_MS · CHANGE_MIN_GAP_MS · installDataproductChangeRuns · noteChangeWatch ·
 *   nextChangeRunAt · triggersOf · ChangeTrigger
 * @usage installDataproductChangeRuns({ storage, config }, (ownerGhii, name) => runDataproductOnChange(storage, config, ownerGhii, name));
 * @version-history
 *   2026-11-04 — listMemoryKeysByPrefix called without a presence check: it is required on Storage
 *     (codebase analysis 2026-11-03, item D-e).
 *   v1.0.0 — 2026-11-01 — Initial (WP9c, plan doc-mvwxcas3dom3 D9.5).
 */
import type { SourceDeps } from './source-common.js';
import { onMemoryWrittenEvent, onChangeEvent, WORKSPACE_DOMAIN_PREFIX, type ChangeEvent, type MemoryWriteEvent } from '../event-bus.js';
import { addStorageFileListener } from '../storage-file-hooks.js';
import { latestKey } from '../datapackage/contract.js';
import { ownerGhiiOf, runAsNode } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { asDefinition, runsOnChange, DATAPRODUCT_KEY_PREFIX, type DataProductDefinition, type SourceSpec } from './definition.js';

/** The quiet time after a change before the run: a burst of writes is one run. */
export const CHANGE_QUIET_MS = 10_000;
/** The shortest time between two change runs of one product (WP9c: at most one every five minutes). */
export const CHANGE_MIN_GAP_MS = 5 * 60_000;

/** What a source change looks like to the node. */
export type ChangeTrigger =
    | { on: 'workspace'; organismId: string; ws: string }
    | { on: 'key'; ownerGhii: string; key: string }
    | { on: 'prefix'; ownerGhii: string; prefix: string }
    | { on: 'file'; ownerGhii: string; key: string };

type Runner = (ownerGhii: string, name: string) => Promise<void>;

interface Watch { ownerGhii: string; name: string; triggers: ChangeTrigger[] }
interface NodeState {
    nodeId: string;
    runner: Runner;
    watches: Map<string, Watch>;
    pending: Map<string, { timer: ReturnType<typeof setTimeout>; at: number }>;
    lastRun: Map<string, number>;
    running: Set<string>;
    again: Set<string>;
}

/** One state per node this process serves. */
const nodes = new Map<string, NodeState>();

const idOf = (ownerGhii: string, name: string): string => `${ownerGhii}\u0000${name}`;
const nodeOf = (ghii: string): string => ghii.slice(ghii.lastIndexOf('@') + 1);
const ghiiOf = (owner: string, nodeId: string): string => (owner.includes('@') ? owner : `${owner}@${nodeId}`);

/** A file reference as a file source names it: `<owner ghii>/<key>` or a bare key of the product's owner. */
function fileTarget(ref: string, ownerGhii: string): { ownerGhii: string; key: string } {
    const at = ref.indexOf('@');
    const slash = at >= 0 ? ref.indexOf('/', at) : -1;
    return slash > at && at >= 0 ? { ownerGhii: ownerGhiiOf(ref.slice(0, slash)), key: ref.slice(slash + 1) } : { ownerGhii, key: ref };
}

/** The changes that concern one source; none for a source whose change the node does not see. */
function triggersOfSource(s: SourceSpec, ownerGhii: string, nodeId: string): ChangeTrigger[] {
    switch (s.kind) {
        case 'records': return [{ on: 'workspace', organismId: s.organism_id!, ws: s.ws! }];
        case 'app': return [{ on: 'prefix', ownerGhii, prefix: s.key_prefix! }];
        case 'memory': return [{ on: 'key', ownerGhii: s.owner ? ghiiOf(s.owner, nodeId) : ownerGhii, key: s.key! }];
        case 'file': return [{ on: 'file', ...fileTarget(s.key!, ownerGhii) }];
        case 'datapackage': return [{ on: 'file', ownerGhii: s.owner ? ghiiOf(s.owner, nodeId) : ownerGhii, key: latestKey(s.name!) }];
        default: return [];
    }
}

/** Every change that concerns a definition. */
export function triggersOf(def: Pick<DataProductDefinition, 'sources'>, ownerGhii: string, nodeId: string): ChangeTrigger[] {
    return def.sources.flatMap(s => triggersOfSource(s, ownerGhii, nodeId));
}

/** Register a stored definition, or forget it (`def` null, or one that no longer runs on a change). */
export function noteChangeWatch(ownerGhii: string, name: string, def: DataProductDefinition | null): void {
    const state = nodes.get(nodeOf(ownerGhii));
    if (!state) return;
    const id = idOf(ownerGhii, name);
    if (!def || !runsOnChange(def)) {
        state.watches.delete(id);
        const p = state.pending.get(id);
        if (p) { clearTimeout(p.timer); state.pending.delete(id); }
        return;
    }
    state.watches.set(id, { ownerGhii, name, triggers: triggersOf(def, ownerGhii, state.nodeId) });
}

/** When the run after a seen change is due, or null when none waits. */
export function nextChangeRunAt(ownerGhii: string, name: string): string | null {
    const p = nodes.get(nodeOf(ownerGhii))?.pending.get(idOf(ownerGhii, name));
    return p ? new Date(p.at).toISOString() : null;
}

function markDirty(state: NodeState, id: string): void {
    if (state.running.has(id)) { state.again.add(id); return; }
    if (state.pending.has(id)) return;
    const last = state.lastRun.get(id);
    const wait = Math.max(CHANGE_QUIET_MS, last === undefined ? 0 : last + CHANGE_MIN_GAP_MS - Date.now());
    const timer = setTimeout(() => { void fire(state, id); }, wait);
    timer.unref?.();
    state.pending.set(id, { timer, at: Date.now() + wait });
}

async function fire(state: NodeState, id: string): Promise<void> {
    state.pending.delete(id);
    const w = state.watches.get(id);
    if (!w) return;
    state.running.add(id);
    state.lastRun.set(id, Date.now());
    try {
        await runAsNode(state.nodeId, () => state.runner(w.ownerGhii, w.name));
    } catch (err) {
        // The run records its own failure on the definition and on the package pointer (./service.ts).
        logger.warn('dataproduct: a run after a source change failed', { owner: w.ownerGhii, name: w.name, error: String((err as Error)?.message ?? err) });
    } finally {
        state.running.delete(id);
        if (state.again.delete(id)) markDirty(state, id);
    }
}

/** Mark every watched product one of whose triggers `hit` accepts. */
function markWhere(state: NodeState, hit: (t: ChangeTrigger) => boolean): void {
    for (const [id, w] of state.watches) if (w.triggers.some(hit)) markDirty(state, id);
}

function onMemoryWritten(state: NodeState, evt: MemoryWriteEvent): void {
    if (!state.watches.size || evt.key.startsWith(DATAPRODUCT_KEY_PREFIX)) return;
    const owner = ownerGhiiOf(evt.ownerGaii);
    markWhere(state, t => (t.on === 'key' && t.ownerGhii === owner && t.key === evt.key)
        || (t.on === 'prefix' && t.ownerGhii === owner && evt.key.startsWith(t.prefix)));
}

function onChange(state: NodeState, evt: ChangeEvent): void {
    if (!state.watches.size || !evt.domain.startsWith(WORKSPACE_DOMAIN_PREFIX)) return;
    const [organismId, ws] = evt.domain.slice(WORKSPACE_DOMAIN_PREFIX.length).split('/');
    markWhere(state, t => t.on === 'workspace' && t.organismId === organismId && t.ws === ws);
}

function onFile(state: NodeState, ownerGaii: string, key: string): void {
    if (!state.watches.size) return;
    const owner = ownerGhiiOf(ownerGaii);
    markWhere(state, t => t.on === 'file' && t.ownerGhii === owner && t.key === key);
}

/** Read every definition that runs on a change, across the accounts of this node. */
async function loadIndex(deps: SourceDeps, state: NodeState): Promise<void> {
    const keys = await deps.storage.listMemoryKeysByPrefix(DATAPRODUCT_KEY_PREFIX);
    for (const { ownerGaii, key } of keys) {
        if (!key.startsWith(DATAPRODUCT_KEY_PREFIX) || ownerGaii !== ownerGhiiOf(ownerGaii) || nodeOf(ownerGaii) !== state.nodeId) continue;
        const def = asDefinition((await deps.storage.getMemory(ownerGaii, key))?.value);
        if (def && runsOnChange(def)) noteChangeWatch(ownerGaii, def.name, def);
    }
}

/**
 * Listen for source changes on this node and run the products they concern. Called once per node at
 * boot; a second call for the same node only replaces the runner.
 */
export function installDataproductChangeRuns(deps: SourceDeps, runner: Runner): void {
    const nodeId = deps.config.nodeId;
    const existing = nodes.get(nodeId);
    if (existing) { existing.runner = runner; return; }
    const state: NodeState = { nodeId, runner, watches: new Map(), pending: new Map(), lastRun: new Map(), running: new Set(), again: new Set() };
    nodes.set(nodeId, state);
    onMemoryWrittenEvent(evt => onMemoryWritten(state, evt));
    onChangeEvent(evt => onChange(state, evt));
    addStorageFileListener((_deps, ownerGaii, key) => onFile(state, ownerGaii, key));
    void runAsNode(nodeId, () => loadIndex(deps, state)).catch((err: unknown) =>
        logger.warn('dataproduct: the products that run on a source change could not be read at start', { error: String((err as Error)?.message ?? err) }));
}

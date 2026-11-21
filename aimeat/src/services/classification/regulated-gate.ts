/**
 * @file src/services/classification/regulated-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The content reader's part of a regulated data domain (plan doc-mwnnp9xz9814, feature
 *   audit item 1.3): what a model outside this server gets of content whose register names a domain,
 *   by the domain's mode (data/compliance-domains.ts RegulatedAiMode; which content and which mode:
 *   compliance/regulated-ai.ts). reader.ts asks it after its own label decisions, for what those let
 *   through, so a refusal by the label is never turned into a pass here.
 *
 *   WHO IS OUTSIDE. In show() and leave(), an AI or anonymous reader that did not report a local model
 *   (external-ai.ts isOutside). In useForAi(), the model: anything but a `local:` model, whoever asked.
 *   A person on their own screen is never a model, so nothing here changes what a person reads.
 *
 *   PER MODE, for an outside model (block for every model):
 *     notify   passes, and a mark is written;
 *     protect  identifying details are replaced first (compliance/pseudonymise.ts) and the mark says
 *              how many of each kind; an AI call whose caller does not apply protect() (`redacts`) is
 *              refused, so no path sends it unprotected without saying so;
 *     local    held back from an outside model;
 *     block    held back from every model.
 *   A person's 'ai-send' exception in force for the item (Data Wallet) opens protect (the content goes
 *   unprotected) and local, and its use is recorded. It does not open block: the attempt is written as
 *   an `exception` mark that says so (Jouni, 2026-11-21: "poikkeus ei avaa estä-tilaa vaan se merkitään
 *   poikkeukselliseksi").
 *
 *   LONG LISTS. Marks of one scope, action and domain set past MARK_ROWS items are one audit row with
 *   their count, as the reader does for shown rows.
 * @structure RegulatedFact · RegulatedSource · setRegulatedSource() · REGULATED_LABEL · regulatedMarkPurpose() ·
 *   HELD · Covers · RegulatedRefusal · RegulatedUse · RegulatedGate · regulatedRefusalMessage() · regulatedGate()
 * @usage
 *   const gate = regulatedGate(deps, who, external);
 *   const out = await gate.show(items, targets, covers);       // HELD for what is held back
 *   const use = await gate.use(targets, { model, capability, redacts }, covers);
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (plan doc-mwnnp9xz9814, feature audit item 1.3).
 */
import type { Storage, ContentLabelTarget } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import type { ReaderKind } from './reader-kind.js';
import type { ClassificationAuditReaderKind } from '../../storage/types/classification-audit.js';
import { ownerOfScope } from './policy.js';
import { isLocalModelRef, type ExternalAiCheck } from './external-ai.js';
import { activeExceptionsFor, recordExceptionUse, type ClassificationException } from './exceptions.js';
import { recordClassificationAudit } from './audit.js';
import { protectValue, pseudonymKey, type Protected } from './pseudonymise.js';
import { logger } from '../../utils/logger.js';

/** What makes one piece of content regulated, and the mode that holds for it (compliance/regulated-ai.ts). */
export interface RegulatedFact {
  domains: string[];
  mode: 'notify' | 'protect' | 'local' | 'block';
  /** The registers that name its container. */
  registers: string[];
  /** The container a register named (its label address as targetId), the nearest first. */
  container: string;
}

/** Answers, for each target, what makes it regulated, or null. */
export type RegulatedSource = (deps: Deps, targets: ReadonlyArray<ContentLabelTarget | null>) => Promise<Array<RegulatedFact | null>>;

// process-local: the function that answers which content is regulated, set once at start by every process that serves reads.
let source: RegulatedSource | null = null;
// process-local: whether this process has said once that no source is set.
let saidMissing = false;

/**
 * Set where the regulated domains come from. The compliance family registers its index at start
 * (compliance/regulated-ai.ts registerRegulatedSource, called by server-bootstrap/process-buffers.ts),
 * so the classification family imports nothing of compliance.
 */
export function setRegulatedSource(fn: RegulatedSource | null): void {
  source = fn;
}

async function regulatedOf(deps: Deps, targets: ReadonlyArray<ContentLabelTarget | null>): Promise<Array<RegulatedFact | null>> {
  if (source) return source(deps, targets);
  if (!saidMissing) {
    saidMissing = true;
    logger.warn('classification: no source of regulated data domains is set in this process; their modes are not applied here');
  }
  return targets.map(() => null);
}

/** The label column of a mark: the domains, so the audit groups them apart from any label. */
export const REGULATED_LABEL = (f: Pick<RegulatedFact, 'domains'>): string => `domain:${f.domains.join('+')}`.slice(0, 120);

/** What a mark says: the domains and mode, then what happened. */
export function regulatedMarkPurpose(f: Pick<RegulatedFact, 'domains' | 'mode'>, what: string): string {
  return `regulated ${f.domains.join(', ')} (${f.mode}): ${what}`.slice(0, 500);
}

/** Write one mark; `count` stands for that many items of one scope and mode. Buffered by audit.ts. */
function recordRegulatedMark(
  target: ContentLabelTarget, fact: Pick<RegulatedFact, 'domains' | 'mode'>, reader: { principal: string; kind: ClassificationAuditReaderKind },
  action: 'regulated' | 'refused' | 'exception', what: string, ownerGaii: string | null, count = 1,
): void {
  recordClassificationAudit({
    scope: target.scope, ownerGaii, kind: target.kind, key: target.key, label: REGULATED_LABEL(fact),
    reader: reader.principal || 'anonymous', readerKind: reader.kind, action, purpose: regulatedMarkPurpose(fact, what), count,
  });
}

/** What show() answers for an item held back. */
export const HELD = Symbol('regulated-held');

/** Whether a person's exception still covers the item at this index (reader.ts stillCovers). */
export type Covers = (e: ClassificationException, index: number) => boolean;

interface Deps {
  storage: Storage;
  config: Pick<AimeatConfig, 'nodeId' | 'classificationMode'> & { regulatedAiModes?: readonly string[] };
}

interface Who { kind: ReaderKind | 'system'; principal: string }

/** One item of an AI call this gate refused, and why in words. */
export interface RegulatedRefusal { target: ContentLabelTarget; fact: RegulatedFact; why: 'block' | 'local' | 'protect' }

export interface RegulatedUse {
  refused: RegulatedRefusal[];
  /** Write the marks and the exception uses of an accepted call. Call once, after every check passed. */
  accept(): void;
  /** True when some item goes only protected; protect() changes nothing otherwise. */
  protects: boolean;
  /** The value of `target` as it may go to the model: protected under protect, unchanged otherwise. */
  protect<V>(target: ContentLabelTarget, value: V): V;
}

export interface RegulatedGate {
  show<T>(items: readonly T[], targets: ReadonlyArray<ContentLabelTarget | null>, covers: Covers): Promise<Array<T | typeof HELD>>;
  use(targets: ReadonlyArray<ContentLabelTarget | null>, use: { capability: string; model?: string; redacts?: boolean }, covers: Covers): Promise<RegulatedUse>;
  /** leave(): for each target, the reason it stays behind, or null. */
  leave(targets: ReadonlyArray<ContentLabelTarget | null>, covers: Covers): Promise<Array<string | null>>;
}

/** What a refused AI call says: which items, which domain, and what the person can do. */
export function regulatedRefusalMessage(refused: readonly RegulatedRefusal[]): string {
  const domains = [...new Set(refused.flatMap(r => r.fact.domains))].join(', ');
  const keys = `${refused.slice(0, 5).map(r => r.target.key).join(', ')}${refused.length > 5 ? ', …' : ''}`;
  const why = new Set(refused.map(r => r.why));
  return [
    `${refused.length} of the items for this AI call are in the regulated data domain ${domains}: ${keys}.`,
    ...(why.has('block') ? ['The setting of that domain keeps them from every AI model, and an exception does not open that. Leave them out.'] : []),
    ...(why.has('local') ? ['The setting of that domain lets only a model on this server (a local: model) read them. Leave them out, use a local: model, or ask the person who owns them for an exception in their Data Wallet.'] : []),
    ...(why.has('protect') ? ['The setting of that domain replaces identifying details before they go to a model outside this server, and this AI call cannot do that. Leave them out, use a local: model, or ask the person who owns them for an exception in their Data Wallet.'] : []),
  ].join(' ');
}

/** Marks of one group past this many items are one row with the count. */
const MARK_ROWS = 3;

const kindLabel = (who: Who): ClassificationAuditReaderKind => who.kind;

/** The 'ai-send' exceptions in force for these targets, one read per scope, by index. */
async function aiSendExceptions(deps: Deps, targets: ReadonlyArray<ContentLabelTarget | null>, wanted: readonly number[], covers: Covers): Promise<Map<number, ClassificationException>> {
  const out = new Map<number, ClassificationException>();
  const byScope = new Map<string, number[]>();
  for (const i of wanted) {
    const t = targets[i];
    if (t) byScope.set(t.scope, [...(byScope.get(t.scope) ?? []), i]);
  }
  await Promise.all([...byScope].map(async ([scope, idx]) => {
    const found = await activeExceptionsFor(deps, scope, idx.map(i => targets[i]!));
    for (const i of idx) {
      const t = targets[i]!;
      const e = (found.get(`${t.kind}\u0000${t.key}`) ?? []).find(x => x.action === 'ai-send' && covers(x, i));
      if (e) out.set(i, e);
    }
  }));
  return out;
}

interface Mark { target: ContentLabelTarget; fact: RegulatedFact; action: 'regulated' | 'refused' | 'exception'; what: string }

/** Write marks, a long group of one scope, action and domains as one row with its count. */
function writeMarks(who: Who, marks: readonly Mark[]): void {
  const groups = new Map<string, Mark[]>();
  for (const m of marks) {
    const g = `${m.target.scope}\u0000${m.action}\u0000${m.fact.domains.join('+')}\u0000${m.fact.mode}`;
    groups.set(g, [...(groups.get(g) ?? []), m]);
  }
  const reader = { principal: who.principal, kind: kindLabel(who) };
  for (const list of groups.values()) {
    if (list.length <= MARK_ROWS) {
      for (const m of list) recordRegulatedMark(m.target, m.fact, reader, m.action, m.what, ownerOfScope(m.target.scope));
      continue;
    }
    const m = list[0]!;
    recordRegulatedMark({ ...m.target, key: '*:regulated' }, m.fact, reader, m.action, `${list.length} items: ${m.what}`, ownerOfScope(m.target.scope), list.length);
  }
}

/** "email 2, phone 1", or "nothing to replace". */
const countsText = (c: Protected<unknown>['counts']): string => {
  const parts = Object.entries(c).map(([k, n]) => `${k} ${n}`);
  return parts.length ? parts.join(', ') : 'nothing to replace';
};

export function regulatedGate(deps: Deps, who: Who, external: ExternalAiCheck): RegulatedGate {
  const aiReader = who.kind === 'ai' || who.kind === 'anonymous';
  let key: Promise<Buffer> | null = null;
  const keyOf = () => (key ??= pseudonymKey(deps.storage, deps.config.nodeId));

  return {
    async show(items, targets, covers) {
      const out: Array<(typeof items)[number] | typeof HELD> = [...items];
      if (!aiReader) return out;
      const facts = await regulatedOf(deps, targets);
      if (!facts.some(Boolean)) return out;
      const outside = await external.isOutside();
      const ask = facts.map((f, i) => (f && (f.mode === 'block' || (outside && f.mode !== 'notify')) ? i : -1)).filter(i => i >= 0);
      const excepted = ask.length ? await aiSendExceptions(deps, targets, ask, covers) : new Map<number, ClassificationException>();
      const marks: Mark[] = [];
      for (let i = 0; i < items.length; i++) {
        const f = facts[i];
        const t = targets[i];
        if (!f || !t) continue;
        const e = excepted.get(i);
        if (f.mode === 'block') {
          out[i] = HELD;
          marks.push(e
            ? { target: t, fact: f, action: 'exception', what: `held back from an AI reader; exception ${e.id} is in force and does not open this mode, so the attempt is marked as exceptional` }
            : { target: t, fact: f, action: 'refused', what: 'held back from an AI reader' });
          continue;
        }
        if (!outside) continue;
        if (f.mode === 'notify') { marks.push({ target: t, fact: f, action: 'regulated', what: 'shown to an AI reader outside this server' }); continue; }
        if (e) {
          recordExceptionUse(e, who.principal || 'anonymous', kindLabel(who), 'ai:shown');
          marks.push({ target: t, fact: f, action: 'regulated', what: `shown ${f.mode === 'protect' ? 'unprotected ' : ''}to an AI reader outside this server by exception ${e.id}` });
          continue;
        }
        if (f.mode === 'local') {
          out[i] = HELD;
          marks.push({ target: t, fact: f, action: 'refused', what: 'held back from an AI reader outside this server' });
          continue;
        }
        const p = protectValue(items[i], await keyOf(), f.container);
        out[i] = p.value;
        marks.push({ target: t, fact: f, action: 'regulated', what: `shown to an AI reader outside this server, protected: ${countsText(p.counts)}` });
      }
      writeMarks(who, marks);
      return out;
    },

    async use(targets, use, covers) {
      const facts = await regulatedOf(deps, targets);
      const none: RegulatedUse = { refused: [], accept: () => {}, protects: false, protect: (_t, v) => v };
      if (!facts.some(Boolean)) return none;
      const outside = !isLocalModelRef(use.model);
      const model = use.model ? `the model ${use.model}` : 'a model outside this server';
      const ask = facts.map((f, i) => (f && (f.mode === 'block' || (outside && f.mode !== 'notify')) ? i : -1)).filter(i => i >= 0);
      const excepted = ask.length ? await aiSendExceptions(deps, targets, ask, covers) : new Map<number, ClassificationException>();
      const refused: RegulatedRefusal[] = [];
      const marks: Mark[] = [];
      /** The marks of what this call held back, written whether or not the caller goes on. */
      const held: Mark[] = [];
      const uses: ClassificationException[] = [];
      const protectAt = new Map<string, RegulatedFact>();
      for (let i = 0; i < targets.length; i++) {
        const f = facts[i];
        const t = targets[i];
        if (!f || !t) continue;
        const e = excepted.get(i);
        if (f.mode === 'block') {
          refused.push({ target: t, fact: f, why: 'block' });
          held.push(e
            ? { target: t, fact: f, action: 'exception', what: `refused for ${model}; exception ${e.id} is in force and does not open this mode, so the attempt is marked as exceptional` }
            : { target: t, fact: f, action: 'refused', what: `refused for ${model} (${use.capability})` });
          continue;
        }
        if (!outside) continue;
        if (f.mode === 'notify') { marks.push({ target: t, fact: f, action: 'regulated', what: `sent to ${model} (${use.capability})` }); continue; }
        if (e) {
          uses.push(e);
          marks.push({ target: t, fact: f, action: 'regulated', what: `sent ${f.mode === 'protect' ? 'unprotected ' : ''}to ${model} (${use.capability}) by exception ${e.id}` });
          continue;
        }
        if (f.mode === 'local' || !use.redacts) {
          refused.push({ target: t, fact: f, why: f.mode === 'local' ? 'local' : 'protect' });
          held.push({ target: t, fact: f, action: 'refused', what: f.mode === 'local'
            ? `refused for ${model} (${use.capability})`
            : `refused for ${model} (${use.capability}): this AI call cannot replace identifying details first` });
          continue;
        }
        protectAt.set(`${t.scope}\u0000${t.kind}\u0000${t.key}`, f);
      }
      // What was held back is written now, whether or not the caller goes on; the marks of what goes,
      // only when the call is accepted.
      writeMarks(who, held);
      const k = protectAt.size ? await keyOf() : null;
      return {
        refused,
        protects: protectAt.size > 0,
        accept() {
          for (const e of uses) recordExceptionUse(e, who.principal || 'anonymous', kindLabel(who), `ai:${use.capability}`);
          writeMarks(who, marks);
        },
        protect(target, value) {
          const f = protectAt.get(`${target.scope}\u0000${target.kind}\u0000${target.key}`);
          if (!f || !k) return value;
          const p = protectValue(value, k, f.container);
          writeMarks(who, [{ target, fact: f, action: 'regulated', what: `sent to ${model} (${use.capability}), protected: ${countsText(p.counts)}` }]);
          return p.value;
        },
      };
    },

    async leave(targets, covers) {
      const out: Array<string | null> = targets.map(() => null);
      if (!aiReader) return out;
      const facts = await regulatedOf(deps, targets);
      if (!facts.some(Boolean)) return out;
      const outside = await external.isOutside();
      const ask = facts.map((f, i) => (f && (f.mode === 'block' || (outside && f.mode === 'local')) ? i : -1)).filter(i => i >= 0);
      if (!ask.length) return out;
      const excepted = await aiSendExceptions(deps, targets, ask, covers);
      const marks: Mark[] = [];
      for (const i of ask) {
        const f = facts[i]!;
        const t = targets[i]!;
        const e = excepted.get(i);
        if (f.mode === 'local' && e) {
          recordExceptionUse(e, who.principal || 'anonymous', kindLabel(who), 'ai:leave');
          marks.push({ target: t, fact: f, action: 'regulated', what: `sent out by an AI reader outside this server by exception ${e.id}` });
          continue;
        }
        out[i] = f.mode === 'block'
          ? `in the regulated data domain ${f.domains.join(', ')}, which no AI model may read here. An exception does not open this.`
          : `in the regulated data domain ${f.domains.join(', ')}, which only a model on this server may read. The person can make an exception with a written reason in their Data Wallet.`;
        marks.push(f.mode === 'block' && e
          ? { target: t, fact: f, action: 'exception', what: `kept from leaving with an AI reader; exception ${e.id} is in force and does not open this mode, so the attempt is marked as exceptional` }
          : { target: t, fact: f, action: 'refused', what: 'kept from leaving with an AI reader' });
      }
      writeMarks(who, marks);
      return out;
    },
  };
}

/**
 * @file src/services/classification/reader.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description THE ONE CHECK COMPONENT of classification (TARGET-082, spec §13.2, decided by Jouni
 *   2026-09-29: "Tee yksi komponentti mitä käytetään useammassa kohtaa tarkistus mukaan lukien ettei
 *   synny duplikaatti patheja"). Every loader that hands stored content to a caller takes a reader
 *   made here instead of an identity string, so a loader cannot run without the check, and the
 *   check is written once.
 *
 *   A reader is the caller (who they are, whose data space they act in, whether they are a person or
 *   an AI) plus three operations, and no others:
 *     show(items)            a list, a search or a single read: what this reader may see;
 *     useForAi(targets)      content going to a model: refuses what a model may not read;
 *     leave(items, where)    an export, a share link or federation: what may leave the organism.
 *
 *   THE DECISIONS (V4, decided 2026-09-29). With the switch off, or off for the content's owner or
 *   organism, every operation passes and reads nothing. Where it is on:
 *   - show: a reader outside a label's audience does not see the item, person or AI. An AI does not
 *     see an item whose label hides it from AI; an item with a warning label is shown with
 *     `classificationWarning` on it and in `warnings`. The node's own work (system) sees everything.
 *     An anonymous reader is read as an AI (decided 2026-09-30): what a label hides from AI reads
 *     as absent to it, and the audience rule applies as to everyone. A person's 'ai-send' exception
 *     in force for an item shows it to an AI reader ("the AI cannot send what it cannot see",
 *     decided 2026-09-30), and each such showing is audited as the exception's use; the audience
 *     rule still applies, and an anonymous reader gets nothing from it.
 *   - useForAi: refuses the whole call (CLASSIFIED, naming the labels and the first keys) when any
 *     item is hidden from AI or outside its audience, whoever asked, because what reaches a model
 *     is decided by the content's label.
 *   - leave: an organism's item whose label may not leave the organism stays behind, wherever it
 *     was going (an export, a share link, another node, an outside service); a person's own content
 *     is theirs to send. What stayed behind is returned with the reason, which says the person can
 *     make an exception. Decided 2026-09-30: when an AI sends content out, what a label hides from AI
 *     stays behind too, the person's own included; a person's exception in force for the item lets
 *     it through ('leave' for anyone, 'ai-send' for an AI) and the use is audited; an app's credential
 *     keeps nothing behind, and what went out against a label is recorded as its exception.
 *   A refusal is always written to the audit log, and showing or using an item whose label keeps an
 *   audit trail is written too (audit.ts buffers it off the request path). One show() that reveals
 *   more than AUDIT_SHOWN_ITEMS items of one audited label writes ONE row for them, key `*:<label>`
 *   with their count, so a long list cannot fill the buffer; `used` stays one row per item.
 *
 *   COST (review of 2026-09-29). activePolicies() reads the node's policy once per call and each
 *   scope's own level once, and merges them itself (the switch and the policy used to be read twice
 *   per scope); the labels of each scope are read concurrently. The system reader's show() reads
 *   nothing, because it shows everything.
 *
 *   WARNINGS. warningsNote(reader) is what an AI-call answer spreads into itself, so the caller is
 *   told which warning-classified items it was given.
 * @structure ReaderAuth · EgressDestination · ContentReader · activePolicies() · decideAll() · exceptionsFor() ·
 *   readerFor() · readerForCaller() · readerForAgent() · systemReader() · warningsNote() ·
 *   CLASSIFIED_WARNING · EXCEPTION_HINT
 * @usage
 *   const reader = readerFor({ storage, config }, req.auth);
 *   const shown = await reader.show(records, r => memoryTarget(r.ownerGaii, r.key));
 *   res.json(success(nodeId, { answer, ...warningsNote(reader) }));
 * @version-history
 *   v2.5.1 — 2026-10-10 — useForAi() records an app's automatic 'ai-send' exception only after the
 *     refusal check passes, so a refused mixed call records none (secaudit 2026-10-10 I10).
 *   v2.5.0 — 2026-09-30 — An exception covers its item only while the item's label is no stricter
 *     than the label it was made for (stillCovers): a later raise lapses it (TARGET-082 second
 *     review, finding S2). useForAi(): an app's AI call takes content hidden from AI and records the
 *     act as an automatic 'ai-send' exception, as leave() does, instead of refusing it (the ruling
 *     of 2026-09-30 on apps).
 *   v2.4.0 — 2026-09-30 — show(): a person's 'ai-send' exception in force shows an item hidden from
 *     AI to an AI reader, and the use is audited ("tekoälyn täytyy nähdä kaikki" with the exception
 *     Jouni approved: the AI cannot send what it cannot see). exceptionsFor() is shared with leave().
 *   v2.3.0 — 2026-09-30 — Decided by Jouni 2026-09-30. leave(): an AI (or anonymous) reader leaves
 *     behind what a label hides from AI; a person's exception in force lets an item through and is
 *     audited as used; an app keeps everything and each act is an automatic exception; the reason
 *     names the Data Wallet exception (EXCEPTION_HINT).
 *   v2.2.0 — 2026-09-30 — An anonymous reader is the strictest kind: show() treats it as an AI, so
 *     content whose label hides it from AI does not reach it (decided by Jouni 2026-09-30). useForAi
 *     already refused hidden content and content outside its audience for every reader.
 *   v2.1.0 — 2026-09-29 — Review fixes: the node policy once per call, the system reader's show()
 *     reads nothing, labels per scope concurrently, a long shown list is one audit row per label,
 *     warningsNote(), and activePolicies() for the classifier and the write hook.
 *   v2.0.0 — 2026-09-29 — TARGET-082 V4: the decisions, the audience, the warnings and the audit.
 *   v1.0.0 — 2026-09-29 — TARGET-082 V1. Initial: the component and its pass-through.
 */
import type { Storage, ContentLabelTarget } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { resolveIdentity, callerPrincipal, localAccountName, localAccountOf, isForeignPrincipal } from '../../utils/gaii.js';
import { readerKindOf, type ReaderKind } from './reader-kind.js';
import { labelById, type ClassificationLabel, type ClassificationPolicy } from './defaults.js';
import { ownerOfScope, readLevel, readNodePolicy, scopeOrganism } from './policy.js';
import { mergePolicy, weakerFields, type PolicyLayer } from './levels.js';
import { ClassificationError, labelsFor, targetId } from './labels.js';
import { audienceCheck } from './audience.js';
import { recordClassificationAudit, type ClassificationAuditEvent } from './audit.js';
import { activeExceptionsFor, recordAutoException, recordExceptionUse, type ClassificationException } from './exceptions.js';

/** The credential fields a reader is made from. `req.auth` fits. */
export interface ReaderAuth {
  sub: string;
  owner: string;
  roles: string[];
  scopes?: string[];
  federated?: boolean;
  homeNode?: string;
  anonymous?: boolean;
  app_grant?: string;
  app?: string;
}

/** Where content goes when it leaves: an export file, a share link, another node. */
export type EgressDestination =
  | { kind: 'export'; organismId: string | null }
  | { kind: 'share'; organismId: string; ws: string }
  | { kind: 'federation'; peer: string }
  /** An outside service or person: a connected provider, an e-mail, an ecosystem app, a message. */
  | { kind: 'external'; to: string };

export interface ContentReader {
  /** human, ai or anonymous from the credential; system for the node's own work with no caller. */
  readonly kind: ReaderKind | 'system';
  /** The identity storage is keyed by (resolveIdentity). Empty for anonymous. */
  readonly identity: string;
  /** Who is making the request (callerPrincipal): an app is named apart from its owner. */
  readonly principal: string;
  /** The credential, for the existing access checks a loader still makes. Null for anonymous and system. */
  readonly auth: ReaderAuth | null;
  /** Items shown with a warning classification, collected for an answer that wants to say so. */
  readonly warnings: Array<{ key: string; label: string; name: string }>;
  show<T>(items: readonly T[], targetOf: (item: T) => ContentLabelTarget | null): Promise<T[]>;
  useForAi(targets: readonly ContentLabelTarget[], use: { capability: string; model?: string }): Promise<void>;
  leave<T>(items: readonly T[], targetOf: (item: T) => ContentLabelTarget | null, where: EgressDestination):
    Promise<{ kept: T[]; left: Array<{ item: T; label: string; reason: string }> }>;
}

interface ReaderDeps {
  storage: Storage;
  config: Pick<AimeatConfig, 'classificationMode' | 'nodeId'>;
}

/** What the reader decided about one target: nothing (classification off there), or its label. */
interface Decided {
  target: ContentLabelTarget;
  label: ClassificationLabel;
  /** The merged policy the label came from, for comparing it with an exception's label. */
  policy: ClassificationPolicy;
}

/**
 * The policy of each scope where classification is on; a scope where it is off is absent. The same
 * decision as policy.ts classificationActiveFor + policyFor, with each level read once: the node's
 * policy once for all scopes, and each scope's own level (the organism's, or the owner's for any
 * personal scope) once, as the switch in owner mode and as the layer of the merge. Off reads nothing.
 */
export async function activePolicies(deps: ReaderDeps, scopes: Iterable<string>): Promise<Map<string, ClassificationPolicy>> {
  const out = new Map<string, ClassificationPolicy>();
  const mode = deps.config.classificationMode;
  if (mode !== 'all' && mode !== 'owner') return out;
  const unique = [...new Set(scopes)];
  if (!unique.length) return out;
  const node = await readNodePolicy(deps.storage, deps.config.nodeId);
  await Promise.all(unique.map(async s => {
    const org = scopeOrganism(s);
    const layer = (await readLevel<PolicyLayer>(deps.storage, deps.config.nodeId, org ? 'organism' : 'owner', org ?? ownerOfScope(s) ?? s, node)).policy;
    if (mode === 'all' || layer?.enabled === true) out.set(s, mergePolicy(node, layer));
  }));
  return out;
}

/**
 * The label of each target where classification is on, in one pass: the policies once (see
 * activePolicies), the labels in one batch per kind and scope, the scopes concurrently. A row with
 * no label of its own takes its row space's (decided 2026-09-29), addressed as the row key without
 * the row id. Off reads nothing.
 */
async function decideAll(deps: ReaderDeps, targets: ReadonlyArray<ContentLabelTarget | null>): Promise<Array<Decided | null>> {
  if (deps.config.classificationMode === 'off') return targets.map(() => null);
  const policies = await activePolicies(deps, targets.filter((t): t is ContentLabelTarget => !!t).map(t => t.scope));
  const out: Array<Decided | null> = targets.map(() => null);
  const spaceOf = (t: ContentLabelTarget) => ({ ...t, key: t.key.split('/').slice(0, 2).join('/') });
  await Promise.all([...policies].map(async ([scope, policy]) => {
    const idx = targets.map((t, i) => (t && t.scope === scope ? i : -1)).filter(i => i >= 0);
    const own = await labelsFor(deps.storage, policy, idx.map(i => targets[i]!));
    const orphanRows = idx.filter(i => targets[i]!.kind === 'row' && !own.get(targetId(targets[i]!))?.row);
    const spaces = orphanRows.length ? await labelsFor(deps.storage, policy, orphanRows.map(i => spaceOf(targets[i]!))) : new Map();
    for (const i of idx) {
      const t = targets[i]!;
      const mine = own.get(targetId(t));
      const id = mine?.row ? mine.label : t.kind === 'row' ? (spaces.get(targetId(spaceOf(t)))?.label ?? policy.defaultLabel) : (mine?.label ?? policy.defaultLabel);
      const label = labelById(policy, id) ?? labelById(policy, policy.defaultLabel);
      if (label) out[i] = { target: t, label, policy };
    }
  }));
  return out;
}

/** An item's address in the map exceptionsFor() answers: scope, kind and key. */
const exceptionKey = (t: ContentLabelTarget) => `${t.scope}\u0000${t.kind}\u0000${t.key}`;

/**
 * An exception covers its item only while the item's label is no stricter than the label it was
 * made for: a later raise, by rank or by any field (weakerFields), lapses it, and so does a label
 * the policy no longer has. A person who raises an item's label is not overridden by an older
 * exception made for the weaker one (TARGET-082 second review, finding S2).
 */
function stillCovers(e: ClassificationException, d: Decided): boolean {
  if (!e.label || e.label === d.label.id) return true;
  const was = labelById(d.policy, e.label);
  if (!was) return false;
  return d.label.rank <= was.rank && weakerFields(was, d.label).length === 0;
}

/**
 * The person's exceptions in force for these decided items, by exceptionKey(), one list read per
 * scope, each kept only while it still covers the item's current label (stillCovers). No items
 * reads nothing.
 */
async function exceptionsFor(deps: ReaderDeps, decided: readonly Decided[]): Promise<Map<string, ClassificationException[]>> {
  const out = new Map<string, ClassificationException[]>();
  if (!decided.length) return out;
  const byScope = new Map<string, Array<{ kind: ContentLabelTarget['kind']; key: string }>>();
  const byKey = new Map<string, Decided>();
  for (const d of decided) {
    byScope.set(d.target.scope, [...(byScope.get(d.target.scope) ?? []), d.target]);
    byKey.set(exceptionKey(d.target), d);
  }
  await Promise.all([...byScope].map(async ([scope, targets]) => {
    for (const [id, list] of await activeExceptionsFor(deps, scope, targets)) {
      const key = `${scope}\u0000${id}`;
      const d = byKey.get(key);
      const live = d ? list.filter(e => stillCovers(e, d)) : list;
      if (live.length) out.set(key, live);
    }
  }));
  return out;
}

/** One show() that reveals more items than this of one audited label writes one row for them. */
const AUDIT_SHOWN_ITEMS = 3;

/** The owner an audit row belongs to: the person behind a personal scope, null for an organism. */
const auditOwnerOf = (scope: string): string | null => ownerOfScope(scope);

function makeReader(deps: ReaderDeps, who: Pick<ContentReader, 'kind' | 'identity' | 'principal' | 'auth'>): ContentReader {
  // The owner this reader acts for: an AI reads for its owner, a visitor from another node is its
  // home identity and no local account.
  const foreign = !!who.auth && isForeignPrincipal(who.auth);
  const ownerName = foreign ? null
    : who.auth ? (who.auth.owner.includes('@') ? localAccountOf(who.auth.owner) : who.auth.owner)
    : localAccountOf(who.identity);
  const owner = who.kind === 'anonymous' ? null
    : foreign ? who.auth!.owner
    : ownerName ? `${ownerName}@${deps.config.nodeId}` : null;
  const inside = audienceCheck(deps.storage, { owner, ownerName });
  const warnings: ContentReader['warnings'] = [];
  const audit = (d: Decided, action: ClassificationAuditEvent['action'], purpose?: string) => recordClassificationAudit({
    scope: d.target.scope, ownerGaii: auditOwnerOf(d.target.scope), kind: d.target.kind, key: d.target.key,
    label: d.label.id, reader: who.principal || 'anonymous', readerKind: who.kind, action, purpose: purpose ?? null,
  });
  /** The audited items one show() revealed: a few one row each, more one row per scope and label. */
  const auditShown = (shown: Decided[]) => {
    const groups = new Map<string, Decided[]>();
    for (const d of shown) {
      const g = `${d.target.scope}\u0000${d.target.kind}\u0000${d.label.id}`;
      groups.set(g, [...(groups.get(g) ?? []), d]);
    }
    for (const list of groups.values()) {
      if (list.length <= AUDIT_SHOWN_ITEMS) { for (const d of list) audit(d, 'shown'); continue; }
      const d = list[0]!;
      recordClassificationAudit({
        scope: d.target.scope, ownerGaii: auditOwnerOf(d.target.scope), kind: d.target.kind, key: `*:${d.label.id}`,
        label: d.label.id, reader: who.principal || 'anonymous', readerKind: who.kind, action: 'shown', purpose: null,
        count: list.length,
      });
    }
  };
  const warn = (d: Decided) => {
    if (!warnings.some(w => w.key === d.target.key)) warnings.push({ key: d.target.key, label: d.label.id, name: d.label.name.en });
  };

  return {
    ...who,
    warnings,

    async show(items, targetOf) {
      // The node's own work (a background run with no caller) is not a reader of content here, so
      // it reads nothing; what it sends to a model still passes useForAi.
      if (who.kind === 'system') return [...items];
      const decided = await decideAll(deps, items.map(targetOf));
      // "The AI cannot send what it cannot see" (decided 2026-09-30): a person's 'ai-send' exception
      // in force for an item hidden from AI shows it to an AI reader. Read only when such an item is here.
      const excepted = who.kind === 'ai'
        ? await exceptionsFor(deps, decided.filter((d): d is Decided => !!d && d.label.aiVisibility === 'hidden'))
        : new Map<string, ClassificationException[]>();
      const out: typeof items[number][] = [];
      const shown: Decided[] = [];
      for (let i = 0; i < items.length; i++) {
        const d = decided[i];
        if (!d) { out.push(items[i]); continue; }
        if (!(await inside(d.label.audience, d.target.scope))) { audit(d, 'refused', 'audience'); continue; }
        // An anonymous reader is read the strictest way, as an AI (decided 2026-09-30): nothing
        // tells who is behind it, so what the label hides from an AI does not reach it either.
        if (who.kind === 'ai' || who.kind === 'anonymous') {
          if (d.label.aiVisibility === 'hidden') {
            const aiSend = (excepted.get(exceptionKey(d.target)) ?? []).find(e => e.action === 'ai-send');
            if (!aiSend) { audit(d, 'refused', 'hidden from AI'); continue; }
            recordExceptionUse(aiSend, who.principal, who.kind, 'shown');
            out.push(items[i]);
            continue;
          }
          if (d.label.audit) shown.push(d);
          if (d.label.aiVisibility === 'warning') {
            warn(d);
            const item = items[i];
            out.push(item && typeof item === 'object' && !Array.isArray(item)
              ? { ...item, classificationWarning: { label: d.label.id, name: d.label.name.en, says: CLASSIFIED_WARNING } } as typeof item
              : item);
            continue;
          }
        }
        out.push(items[i]);
      }
      if (shown.length) auditShown(shown);
      return out;
    },

    async useForAi(targets, use) {
      const decided = await decideAll(deps, targets);
      const refused: Decided[] = [];
      // An app does what it is built for (decided 2026-09-30): content hidden from AI goes into the
      // app's AI call, and the act is recorded as an automatic exception, one per scope and label.
      const app = who.kind === 'human' && !!who.auth?.roles.includes('app');
      const appActs = new Map<string, { d: Decided; n: number }>();
      for (const d of decided) {
        if (!d) continue;
        const outside = who.kind !== 'system' && !(await inside(d.label.audience, d.target.scope));
        if (outside) { refused.push(d); continue; }
        if (d.label.aiVisibility === 'hidden') {
          if (!app) { refused.push(d); continue; }
          const g = `${d.target.scope}\u0000${d.label.id}`;
          appActs.set(g, { d: appActs.get(g)?.d ?? d, n: (appActs.get(g)?.n ?? 0) + 1 });
          continue;
        }
        if (d.label.aiVisibility === 'warning') warn(d);
      }
      const purpose = [use.capability, use.model].filter(Boolean).join(' ');
      if (refused.length) {
        for (const d of refused) audit(d, 'refused', purpose);
        const names = [...new Set(refused.map(d => d.label.name.en))].join(', ');
        throw new ClassificationError('CLASSIFIED', 403,
          `${refused.length} of the items for this AI call are classified ${names}, which no AI may read here: ${refused.slice(0, 5).map(d => d.target.key).join(', ')}${refused.length > 5 ? ', …' : ''}. Leave them out, or ask the person who owns them.`);
      }
      // Recorded only once the call is accepted: a refused call sends nothing to the AI, so it has
      // no automatic exception to record (secaudit 2026-10-10 I10).
      for (const { d, n } of appActs.values()) {
        const appId = who.auth?.app ?? who.principal;
        await recordAutoException(deps, {
          by: who.principal, app: who.auth?.app ?? null, scope: d.target.scope, target: { kind: d.target.kind, key: d.target.key },
          label: d.label.id, action: 'ai-send', destination: `ai:${purpose || 'call'}`, count: n,
          reason: `app ${appId} gave ${n === 1 ? 'an item' : `${n} items`} classified ${d.label.name.en}, which no AI may read, to an AI (${purpose || 'call'})`,
        });
      }
      for (const d of decided) if (d && d.label.audit) audit(d, 'used', purpose);
    },

    async leave(items, targetOf, where) {
      const decided = await decideAll(deps, items.map(targetOf));
      const destination = destinationOf(where);
      // What stays behind, per item: the organism rule, or (for an AI) a label that hides it from AI.
      const why: Array<'organism' | 'ai' | null> = decided.map(d => {
        if (!d) return null;
        // The rule is about leaving an ORGANISM, wherever the copy goes. A person's own content is
        // theirs to send: the default label (internal) may not leave an organism, and binding
        // personal content to it would stop every person's own public records at the border.
        if (!d.label.mayLeaveOrganism && scopeOrganism(d.target.scope)) return 'organism';
        // An AI sending content out (decided 2026-09-30): "jos ... tekoäly tekee päätöksen lähettää
        // tietoa jonnekin ulospäin muualle kuin itselleen niin sitten tämä sääntö on validi". What a
        // label hides from AI stays behind, the person's own content included. Anonymous as an AI.
        if ((who.kind === 'ai' || who.kind === 'anonymous') && d.label.aiVisibility === 'hidden') return 'ai';
        return null;
      });
      // An app does what it is built for: nothing stays behind, and the act is an exception.
      const app = who.kind === 'human' && !!who.auth?.roles.includes('app');
      // A person's exception in force lets an item through: 'leave' for any reader and destination,
      // 'ai-send' when the reader is an AI. Read only when something would stay behind.
      const active = app ? new Map<string, ClassificationException[]>()
        : await exceptionsFor(deps, decided.filter((d, i): d is Decided => !!d && !!why[i]));
      const kept: typeof items[number][] = [];
      const left: Array<{ item: typeof items[number]; label: string; reason: string }> = [];
      const appActs = new Map<string, { d: Decided; n: number }>();
      for (let i = 0; i < items.length; i++) {
        const d = decided[i];
        const rule = why[i];
        if (!d || !rule) { kept.push(items[i]); continue; }
        if (app) {
          const g = `${d.target.scope}\u0000${d.label.id}`;
          appActs.set(g, { d: appActs.get(g)?.d ?? d, n: (appActs.get(g)?.n ?? 0) + 1 });
          kept.push(items[i]);
          continue;
        }
        const matching = (active.get(exceptionKey(d.target)) ?? [])
          .find(e => e.action === 'leave' || (e.action === 'ai-send' && who.kind === 'ai'));
        if (matching) {
          recordExceptionUse(matching, who.principal || 'anonymous', who.kind, destination);
          kept.push(items[i]);
          continue;
        }
        audit(d, 'refused', where.kind);
        left.push({
          item: items[i], label: d.label.id,
          reason: rule === 'organism'
            ? `classified ${d.label.name.en}, which may not leave its organism. ${EXCEPTION_HINT}`
            : `classified ${d.label.name.en}, which no AI may send out. ${EXCEPTION_HINT}`,
        });
      }
      for (const { d, n } of appActs.values()) {
        const appId = who.auth?.app ?? who.principal;
        await recordAutoException(deps, {
          by: who.principal, app: who.auth?.app ?? null, scope: d.target.scope, target: { kind: d.target.kind, key: d.target.key },
          label: d.label.id, action: 'leave', destination, count: n,
          reason: `app ${appId} sent ${n === 1 ? 'an item' : `${n} items`} classified ${d.label.name.en} out (${destination})`,
        });
      }
      return { kept, left };
    },
  };
}

/** What a refusal to let content leave says the person can do about it. */
export const EXCEPTION_HINT = 'The person can make an exception with a written reason in their Data Wallet.';

/** A destination as the exceptions list and the audit name it. */
function destinationOf(where: EgressDestination): string {
  switch (where.kind) {
    case 'export': return where.organismId ? `export:${where.organismId}` : 'export';
    case 'share': return `share:${where.organismId}/${where.ws}`;
    case 'federation': return `federation:${where.peer}`;
    case 'external': return `external:${where.to}`;
  }
}

/** What the answer says about a warning-classified item an AI was shown. */
export const CLASSIFIED_WARNING = 'This content is classified. Use it only for the task you were given, and do not copy it anywhere else.';

/**
 * What an AI-call answer spreads into itself: the warning-classified items this reader was given,
 * with what that asks of the model, or nothing when there were none.
 *   res.json(success(nodeId, { ...answer, ...warningsNote(reader) }));
 */
export function warningsNote(reader: Pick<ContentReader, 'warnings'>): { classification_warnings?: Array<{ key: string; label: string; name: string; says: string }> } {
  if (!reader.warnings.length) return {};
  return { classification_warnings: reader.warnings.map(w => ({ ...w, says: CLASSIFIED_WARNING })) };
}

/** The reader behind a request. No credential is an anonymous reader. */
export function readerFor(deps: ReaderDeps, auth: ReaderAuth | null | undefined): ContentReader {
  const kind = readerKindOf(auth);
  if (!auth || kind === 'anonymous') return makeReader(deps, { kind: 'anonymous', identity: '', principal: '', auth: null });
  return makeReader(deps, {
    kind,
    identity: resolveIdentity(auth, deps.config.nodeId),
    principal: callerPrincipal(auth, deps.config.nodeId),
    auth,
  });
}

/** The reader behind an extension's caller (`ctx.caller`), which already carries its identity. */
export function readerForCaller(
  deps: ReaderDeps, caller: { gaii: string; owner: string; roles: string[]; scopes?: string[] },
): ContentReader {
  const kind = readerKindOf(caller);
  return makeReader(deps, {
    kind: kind === 'anonymous' ? 'ai' : kind,
    identity: caller.gaii,
    principal: caller.gaii,
    auth: { sub: caller.gaii, owner: caller.owner, roles: caller.roles, scopes: caller.scopes },
  });
}

/**
 * The reader behind a node MCP session. Every such session is an agent (mcp/index.ts refuses any
 * other credential), so its tools hold the agent's identity and the request's scopes, not a token.
 */
export function readerForAgent(deps: ReaderDeps, agentGaii: string, scopes: readonly string[] = []): ContentReader {
  const owner = localAccountName(agentGaii);
  return makeReader(deps, {
    kind: 'ai',
    identity: agentGaii,
    principal: agentGaii,
    auth: { sub: agentGaii, owner, roles: ['agent'], scopes: [...scopes] },
  });
}

/**
 * The node's own work with no caller: a scheduled job, a background run. It acts in `identity`'s
 * data space. Content it sends to a model still passes useForAi, because what reaches a model is
 * decided by the content's label, not by who asked.
 */
export function systemReader(deps: ReaderDeps, identity: string): ContentReader {
  return makeReader(deps, { kind: 'system', identity, principal: identity, auth: null });
}

/**
 * @file src/services/data-map/data-map-check.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Summarise a data map for a list, and say what is still missing from it.
 *
 *   THIS FILE NEVER INVENTS A MAP. The node's whole job here is to read what somebody wrote, fold it
 *   into one line, and name the holes. The previous version derived a map from the app's permission
 *   words when the app said nothing, which produced the same confident row on 114 apps — `kansi.*`,
 *   "you named it", "nobody has said why this is here" — sitting exactly where the answer belonged
 *   and reading like one. A missing map now says it is missing.
 *
 *   PURE. No storage, no clock: the caller passes `at`, so the same map always yields the same
 *   summary and a unit test can assert it.
 * @structure summariseMap · checkMap · statesInvites · statesRegisters · stampFor · FINDING_CODES
 * @usage import { summariseMap, checkMap } from './data-map-check.js';
 * @version-history
 *   v1.8.1 — 2026-11-01 — DATAMAP_FORM_CONTRADICTED does not fire for a static page whose rows are files
 *     somebody else writes (writtenByThePage; Varoituskartta, WP10e C3).
 *   v1.8.0 — 2026-11-01 — DATAMAP_REGISTERS_UNSTATED: an app whose party signup is open (checkMap's
 *     `registersParties`) and whose map has neither `registers-parties` nor a `registers` statement is a
 *     finding, after the invites one, and never a refusal (plan doc-mvwxcas3dom3, D4.4).
 *   v1.7.0 — 2026-11-01 — DATAMAP_ROW_BAD_PUBLISHABLE: a row's optional `publishable` that is not a
 *     boolean is a finding, after the agent one, and never a refusal (plan doc-mvwxcas3dom3, D9.1).
 *   v1.6.0 — 2026-10-28 — DATAMAP_AI_ACT_UNANSWERED: the map says the app uses AI and its `aiAct`
 *     answers none of the EU AI Act questions. Last in the order and never a refusal.
 *   v1.5.0 — 2026-10-28 — DATAMAP_ROW_BAD_DOMAIN (a row names a data domain the node does not know)
 *     and DATAMAP_PERSONAL_NO_DOMAIN (a personal row says no domain at all), last in the order and
 *     never a refusal. TaskGrid on orgnode.example kept colleagues' competence ratings and sent
 *     them to a model, and nothing on the node could tell that this was employment data.
 *   v1.4.0 — 2026-10-18 — DATAMAP_INVITES_UNSTATED: an app whose declared scopes cover
 *     organism:invite and whose map has neither the machinery word `invites-people` nor an `invites`
 *     statement is a finding, after DATAMAP_NO_ROWS, also beside DATAMAP_MISSING. checkMap and
 *     stampFor take the app's declared scopes; without them nothing is asked
 *     (wish-datakarttaan-ja-agentin-kuvaukseen-tieto-kutsuista-ja-tilien).
 *   v1.3.0 — 2026-10-11 — DATAMAP_ROW_BAD_AGENT: a row's optional `agent` that cannot be an agent's
 *     name is a finding, after the missing `why` and before the classification one, and never a
 *     refusal.
 *   v1.2.0 — 2026-09-29 — DATAMAP_ROW_BAD_CLASSIFICATION: a row's optional `classification` that
 *     cannot be a label id is a finding, last in the order, and never a refusal (TARGET-082 V5).
 *   v1.1.0 — 2026-08-26 — `organism-rows` gets its own words, and counts as being in an organism for
 *     the form contradiction — without that, an app whose only shared space is a row store would be
 *     accused of keeping the team's data in one person's memory.
 *   v1.0.0 — 2026-08-25 — Replaces data-map-derive.ts and data-map-lint.ts.
 */
import {
  DATA_MAP_SPEC, appDataMapKey,
  type DataMap, type DataMapRow, type DataMapStamp, type DataMapGap, type DataLocation,
} from './data-map-types.js';
import { isValidAgentName } from '../../utils/gaii.js';
import { complianceDomainById } from '../../data/compliance-domains.js';
import { scopeIsCovered } from '../../utils/scope-coverage.js';
import { appAiSignals } from '../compliance-app-signals.js';

/** Findings, worst first. The order is the order a reader should care. */
export const FINDING_CODES = [
  'DATAMAP_MISSING',
  'DATAMAP_NO_PURPOSE',
  'DATAMAP_NO_ARRANGEMENT',
  'DATAMAP_FORM_UNSTATED',
  'DATAMAP_FORM_CONTRADICTED',
  'DATAMAP_ROW_NO_WHY',
  'DATAMAP_NO_ROWS',
  'DATAMAP_INVITES_UNSTATED',
  'DATAMAP_REGISTERS_UNSTATED',
  'DATAMAP_ROW_BAD_AGENT',
  'DATAMAP_ROW_BAD_PUBLISHABLE',
  'DATAMAP_ROW_BAD_CLASSIFICATION',
  'DATAMAP_ROW_BAD_DOMAIN',
  'DATAMAP_PERSONAL_NO_DOMAIN',
  'DATAMAP_AI_ACT_UNANSWERED',
] as const;

/**
 * The map says the app uses AI: a model in its machinery, or something sent to an AI service. The
 * map's own words only; the register draft also reads the app's ai:use permission, which this pure
 * check does not see (compliance-app-signals.ts reads both).
 */
const mapUsesAi = (map: DataMap): boolean => appAiSignals(map, null).usesAi;

/** A row's `domains` entries this node does not know, or the whole field when it is not a list. */
const badDomains = (r: DataMapRow): string[] => {
  if (r.domains === undefined) return [];
  if (!Array.isArray(r.domains)) return [String(r.domains)];
  return r.domains.filter(d => typeof d !== 'string' || !complianceDomainById(d)).map(String);
};

/** A row that holds personal data and has not said which regulated domain it falls in. */
const personalWithoutDomain = (r: DataMapRow): boolean => r.personalData === 'yes' && r.domains === undefined;

/**
 * The shape of a classification label id. The same pattern services/classification/levels.ts holds
 * a level's id to, so a row can only name something that could be a label. It checks the SHAPE and
 * not whether the level exists: the owner or an organism may add a level after the map is written.
 */
const LABEL_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** True when a row's optional `classification` is present and cannot be a label id. */
const badClassification = (r: DataMapRow): boolean =>
  r.classification !== undefined && !(typeof r.classification === 'string' && LABEL_ID.test(r.classification));

/**
 * True when a row's optional `agent` is present and cannot be an agent's name (utils/gaii.ts holds
 * the grammar). It checks the SHAPE and not whether the agent exists: an agent can be removed after
 * the map is written, and the pages that read the tie say so then.
 */
const badAgent = (r: DataMapRow): boolean => r.agent !== undefined && !isValidAgentName(r.agent);

/** True when a row's optional `publishable` is present and is not true or false. */
const badPublishable = (r: DataMapRow): boolean => r.publishable !== undefined && typeof r.publishable !== 'boolean';

/** The scope that lets an app invite people into organisms, where an invitation can create an account. */
export const INVITE_SCOPE = 'organism:invite';

/**
 * True when the map says the app invites people: the machinery word `invites-people`, or an
 * `invites` statement that names at least one act or where it invites people to.
 */
export function statesInvites(map: DataMap): boolean {
  if (Array.isArray(map.machinery) && map.machinery.includes('invites-people')) return true;
  const inv = map.invites;
  if (!inv || typeof inv !== 'object') return false;
  const does = Array.isArray(inv.does) ? inv.does.filter(d => typeof d === 'string' && d.trim()) : [];
  return does.length > 0 || (typeof inv.into === 'string' && inv.into.trim().length > 0);
}

/** True when the map says the app registers people: `registers-parties`, or a `registers` statement that names who. */
export function statesRegisters(map: DataMap): boolean {
  if (Array.isArray(map.machinery) && map.machinery.includes('registers-parties')) return true;
  const r = map.registers;
  return !!r && typeof r === 'object' && typeof r.who === 'string' && r.who.trim().length > 0;
}

/**
 * The finding for an app that declares organism:invite and says nothing about it. Inviting people is
 * allowed, and a person who installs the app reads it here (Jouni, 2026-10-18). The scope is read
 * the way requireScope reads it, so `organism:*` and `*` count.
 */
function invitesFinding(map: DataMap | null, declaredScopes: readonly string[]): { code: FindingCode; message: string } | null {
  if (!scopeIsCovered(declaredScopes, INVITE_SCOPE)) return null;
  if (map && map.source !== 'none' && statesInvites(map)) return null;
  return {
    code: 'DATAMAP_INVITES_UNSTATED',
    message: `This app asks for ${INVITE_SCOPE}, so it can invite people into organisms, and an invitation `
      + 'can create a new account. The map does not say so. Add "invites-people" to `machinery`, or an '
      + '`invites` statement: { "does": ["sends-email-invitations", "mints-access-codes", "creates-accounts", '
      + '"grants-workspace-access", "manages-members"], "into": "which organisms" }.',
  };
}

export type FindingCode = typeof FINDING_CODES[number];

/** Where a row lives, in the words the surfaces use. One place, so two renderers cannot drift. */
const PLACE_WORDS: Record<DataLocation, string> = {
  nowhere: 'nowhere',
  'browser-only': 'the browser only',
  'owner-memory-private': 'your own memory',
  'owner-memory-public': 'your own memory, readable by anyone',
  'someone-elses-memory': "someone else's memory",
  'organism-workspace': 'an organism workspace',
  // The row store is a DIFFERENT answer from the workspace it sits in, and saying so is the point:
  // rows are appended rather than edited, keep no version history, and are charged to the organism
  // instead of to whichever member wrote them. A reader who sees only "an organism workspace" would
  // expect all three to be the other way round.
  'organism-rows': "an organism workspace's row store",
  'organism-shared': "an organism's shared area",
  'organism-meta': "an organism's registry",
  'extension-namespace': "an extension's own space",
  cortex: 'cortex',
  'file-storage': 'file storage',
  'app-published-record': "the app's own published record",
  'another-node': 'another node',
  'external-service': 'an outside service',
};

export const placeWords = (where: DataLocation): string => PLACE_WORDS[where] ?? String(where);

/**
 * One line for a list: where this app's data is.
 *
 * Built from the rows the author wrote, so it can only ever be as true as they are. An app with no
 * rows gets the sentence that says so rather than a blank.
 */
export function summariseMap(map: DataMap): string {
  if (map.source === 'none') return 'No data map yet.';
  if (map.held.length === 0 && map.elsewhere.length === 0) return 'Stores nothing.';

  // Group by place, biggest group first: "an organism workspace (9), your own memory (2)".
  const byPlace = new Map<DataLocation, number>();
  for (const row of map.held) byPlace.set(row.where, (byPlace.get(row.where) ?? 0) + 1);
  const places = [...byPlace.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([where, n]) => `${placeWords(where)} (${n})`);

  const parts = [places.join(', ')];
  if (map.machinery.length > 0) parts.push(`uses ${map.machinery.join(', ')}`);
  if (map.leaves.length === 1) parts.push('one thing leaves the house');
  else if (map.leaves.length > 1) parts.push(`${map.leaves.length} things leave the house`);
  return parts.join(' · ');
}

/** Rows the form implies but that are not there, and rows it forbids. */
function formContradiction(map: DataMap): string | null {
  const inWorkspace = map.held.some(r =>
    r.where === 'organism-workspace' || r.where === 'organism-rows'
    || r.where === 'organism-shared' || r.where === 'organism-meta');
  const sharedForm = map.form === 'group' || map.form === 'organism-workspace'
    || map.form === 'shared-with-named';

  if (map.form === 'one-person' && inWorkspace) {
    return 'This says it is a one-person app, and it writes into an organism, which more than one person reads.';
  }
  if (sharedForm && !inWorkspace && map.held.length > 0
      && map.held.every(r => r.where === 'owner-memory-private')) {
    return 'This says several people share it, and every row lands in one person\'s own memory, where only they can read it.';
  }
  if (map.form === 'static' && map.held.some(writtenByThePage)) {
    return 'This says it is a static page, and it lists rows it stores.';
  }
  return null;
}

/** The writers a static page cannot have: the page itself, for the person or from the screen. */
const PAGE_WRITERS: readonly string[] = ['person-in-the-ui', 'the-app-for-the-person'];

/**
 * Whether a row is the page's own storage. A static page may still READ files somebody else writes
 * (the owner's agent publishes public files and the page draws them, as Varoituskartta does), and such
 * a row names its writer: an agent, a schedule, a seed, or in the maker's own words. A row whose
 * writers are the page, or that names no writer at all, is one the page stores.
 */
export function writtenByThePage(row: Pick<DataMapRow, 'writers'>): boolean {
    const raw = (row as { writers?: unknown }).writers;
    const writers = (Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw])
        .map(w => String(w).trim()).filter(Boolean);
    return writers.length === 0 || writers.some(w => PAGE_WRITERS.includes(w));
}

export interface MapCheck {
  /** Every finding, worst first, in words a person can act on. */
  findings: { code: FindingCode; message: string }[];
  /** The worst one, which is what a stamp carries. */
  gap: DataMapGap | null;
}

/**
 * What is still missing from a map somebody wrote. Never blocks anything.
 *
 * `declaredScopes` are the words of the app's `<meta name="aimeat-scopes">` (parseAppScopes). They
 * decide only whether the map has to say that the app invites people; omitted, nothing is asked.
 */
export function checkMap(
  map: DataMap | null, at: string, declaredScopes: readonly string[] = [],
  /** The app's party signup is open (services/app-parties/): the map has to say whom it registers. */
  opts: { registersParties?: boolean } = {},
): MapCheck {
  const findings: { code: FindingCode; message: string }[] = [];
  const invites = invitesFinding(map, declaredScopes);
  const registers = opts.registersParties && !(map && map.source !== 'none' && statesRegisters(map)) ? {
    code: 'DATAMAP_REGISTERS_UNSTATED' as const,
    message: 'People without an account register to this app, and the map does not say so. Add "registers-parties" to '
      + '`machinery`, or a `registers` statement: { "who": "who registers", "keeps": ["e-mail address", "..."] }. '
      + 'The owner holds their addresses, and the records of processing list them.',
  } : null;

  if (!map || map.source === 'none') {
    findings.push({
      code: 'DATAMAP_MISSING',
      message: 'This app has no data map. Whoever builds or edits it next has to read the source to '
        + 'find out where its data goes, which is how data ends up wherever was easiest to reach.',
    });
    if (invites) findings.push(invites);
    if (registers) findings.push(registers);
    return { findings, gap: { code: 'DATAMAP_MISSING', message: findings[0].message, at } };
  }
  if (invites) findings.push(invites);
  if (registers) findings.push(registers);

  if (!map.what.trim() || !map.usedFor.trim()) {
    findings.push({
      code: 'DATAMAP_NO_PURPOSE',
      message: 'Nobody has said what this app is for. Without it the rows are a list of keys and '
        + 'there is no way to judge whether the data is in the right place.',
    });
  }
  if (!map.arrangement.trim()) {
    findings.push({
      code: 'DATAMAP_NO_ARRANGEMENT',
      message: 'Nobody has described how this app arranges its data.',
    });
  }
  if (map.form === 'unstated') {
    findings.push({
      code: 'DATAMAP_FORM_UNSTATED',
      message: 'Nobody has said whether this is a one-person app, a shared one, or a group one.',
    });
  }
  const contradiction = formContradiction(map);
  if (contradiction) {
    findings.push({ code: 'DATAMAP_FORM_CONTRADICTED', message: contradiction });
  }
  if (map.held.length === 0 && map.elsewhere.length === 0 && map.form !== 'static') {
    findings.push({
      code: 'DATAMAP_NO_ROWS',
      message: 'The map lists nothing. If the app really stores nothing, say so by declaring it static.',
    });
  }
  const noWhy = map.held.filter(r => !r.why.trim());
  if (noWhy.length > 0) {
    findings.push({
      code: 'DATAMAP_ROW_NO_WHY',
      message: `${noWhy.length} of ${map.held.length} rows do not say why the data is there rather `
        + 'than somewhere else. That sentence is read at the moment somebody is about to move it.',
    });
  }
  const badLabel = map.held.filter(badClassification);
  if (badLabel.length > 0) {
    findings.push({
      code: 'DATAMAP_ROW_BAD_CLASSIFICATION',
      message: `${badLabel.length} of ${map.held.length} rows name a classification that cannot be a `
        + 'label id: use 1 to 40 lowercase letters, digits and dashes, such as "luottamuksellinen", '
        + `or leave the field out. Rows: ${badLabel.map(r => r.what).join(', ')}.`,
    });
  }
  const badName = map.held.filter(badAgent);
  if (badName.length > 0) {
    findings.push({
      code: 'DATAMAP_ROW_BAD_AGENT',
      message: `${badName.length} of ${map.held.length} rows name an agent with something that cannot `
        + 'be an agent\'s name: use the local name of one of your own agents, such as "morning-news", '
        + `or leave the field out. Rows: ${badName.map(r => r.what).join(', ')}.`,
    });
  }
  const badMark = map.held.filter(badPublishable);
  if (badMark.length > 0) {
    findings.push({
      code: 'DATAMAP_ROW_BAD_PUBLISHABLE',
      message: `${badMark.length} of ${map.held.length} rows carry a "publishable" that is not true or false. `
        + 'true offers the family to a data product as material; leave the field out otherwise. '
        + `Rows: ${badMark.map(r => r.what).join(', ')}.`,
    });
  }
  const unknownDomain = map.held.filter(r => badDomains(r).length > 0);
  if (unknownDomain.length > 0) {
    findings.push({
      code: 'DATAMAP_ROW_BAD_DOMAIN',
      message: `${unknownDomain.length} of ${map.held.length} rows name a data domain this node does not know: `
        + `${[...new Set(unknownDomain.flatMap(badDomains))].join(', ')}. Use the ids GET /v1/compliance/catalog lists, `
        + `such as "employment" or "health", or [] for none of them. Rows: ${unknownDomain.map(r => r.what).join(', ')}.`,
    });
  }
  const noDomain = map.held.filter(personalWithoutDomain);
  if (noDomain.length > 0) {
    findings.push({
      code: 'DATAMAP_PERSONAL_NO_DOMAIN',
      message: `${noDomain.length} of ${map.held.length} rows hold personal data and do not say which regulated data `
        + 'domain it falls in. Add `domains` to each: "employment" for CVs, competence, staffing and HR, "health" for '
        + 'patient data, "children" for minors, or [] when none applies. The domain decides the classification floor, '
        + `whether an impact assessment is owed and the AI Act risk area. Rows: ${noDomain.map(r => r.what).join(', ')}.`,
    });
  }

  // The maker is the one who knows what an AI app does to people, so the maker answers the AI Act
  // questions, at build time, in the map they are already writing. Without it the node's
  // administrator has to ask, app by app (Jouni, 2026-10-28).
  if (mapUsesAi(map) && Object.keys(map.aiAct?.answers ?? {}).length === 0) {
    findings.push({
      code: 'DATAMAP_AI_ACT_UNANSWERED',
      message: 'This app uses AI, and the map does not answer the EU AI Act questions. You know what the app does, '
        + 'so answer them: aimeat_datamap_get lists them under `ai_act`. Add to the map `aiAct`: { "answers": '
        + '{ "<question id>": true | false | "<option value>" }, "notes": { "<question id>": "why, in one or two sentences" } }. '
        + 'The node\'s administrator approves the answers; a note is what an auditor reads beside the answer.',
    });
  }

  // Worst first, by the declared order.
  findings.sort((a, b) => FINDING_CODES.indexOf(a.code) - FINDING_CODES.indexOf(b.code));
  const worst = findings[0];
  return { findings, gap: worst ? { code: worst.code, message: worst.message, at } : null };
}

/** The stamp a list renders from, without reading the document. */
export function stampFor(map: DataMap | null, appId: string, at: string, declaredScopes: readonly string[] = []): DataMapStamp {
  const check = checkMap(map, at, declaredScopes);
  const rows = map?.held ?? [];
  return {
    spec: DATA_MAP_SPEC,
    form: map?.form ?? 'unstated',
    summary: map ? summariseMap(map) : 'No data map yet.',
    heldRows: rows.length,
    rowsWithoutWhy: rows.filter((r: DataMapRow) => !r.why.trim()).length,
    missing: !map || map.source === 'none',
    docKey: appDataMapKey(appId),
    at,
    ...(check.gap ? { gap: check.gap } : {}),
  };
}

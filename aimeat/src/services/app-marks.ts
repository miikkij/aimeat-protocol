/**
 * @file src/services/app-marks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An app owner's say over the chrome the node adds to their served app, and the one
 *   declaration that changes what the AI label says: a named person who reviewed the app.
 *
 *   THREE SWITCHES, ONE PLACE. The "publish your own app" badge and the browser install chip used
 *   to be permanent on every served app (utils/app-badge.ts said so on purpose, as a viral
 *   attribution). On 2026-08-29 Jouni made the product decision that both become the owner's
 *   choice, on by default. The third is not a switch but a declaration: the account holder, in
 *   person, names the natural person who has reviewed this app and answers for it. That is the
 *   Art. 50(4) exemption — "human review or editorial control" with somebody holding editorial
 *   responsibility — and it is an attributable legal act, so:
 *
 *     - only an OWNER PRINCIPAL may declare or withdraw it. An agent, an app grant or an
 *       ecosystem app acting in the owner's name is refused at the door (the owner name is not a
 *       principal; naming the principal is the check);
 *     - every declaration and withdrawal is appended to `authorshipLog` with the name, the GHII
 *       and the time, and the log is served to the owner so the history is auditable;
 *     - it lifts the VISIBLE content label only. The machine-readable provenance (the record, the
 *       ai-disclosure attribute, the JSON-LD) says exactly what it said before: synthesis may have
 *       happened. And it never touches the interactive notice: an app that talks to a person as an
 *       AI still says so (Art. 50(1)), whoever reviewed it.
 *
 *   Both PATCH /v1/apps/:filename and the MCP tool call the functions here, so the parsing, the
 *   refusal, the log and the note are written once. The serve paths read the three predicates at
 *   the bottom, so "absent means on" is decided in one line rather than at three call sites.
 * @structure
 *   - appBadgeOn / appInstallChipOn / appReviewedBy — what a manifest means for the served bytes
 *   - parseMarksInput / parseAuthorInput — the two request shapes, validated
 *   - applyOwnerMarksUpdate — the write, the log and the note (both doors)
 *   - ownerAppMarks — the agent-shaped entry: caller identity + filename, marks only
 *   - appMarksState — the state a listing or a response carries
 * @usage
 *   const out = await applyOwnerMarksUpdate(storage, { ownerGaii, filename },
 *     { marks: body.marks, author: body.author, actor: { ghii, ownerPrincipal } });
 * @version-history
 *   v1.0.0 — 2026-08-29 — Initial: badge and install switches, the named reviewer, the log.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type {
  AppManifest, AppMarks, AppAuthorship, AppAuthorshipLogEntry, AppSummaryRecord,
} from '../storage/types/apps.js';
import { AUTHORSHIP_LOG_MAX } from '../storage/types/apps.js';
import { resolveAppOwnerScope } from './app-lifecycle.js';
import { emitChange } from './event-bus.js';

export const AUTHOR_NAME_MAX = 120;

// ── What a manifest means for the served bytes ──────────────────────────────────────────────────

/** The attribution badge. Absent = on, which is what every app served before the switch got. */
export function appBadgeOn(m: AppManifest | undefined | null): boolean {
  return m?.marks?.badge !== false;
}

/** The browser "Install this app" chip on the app origin. Absent = on. */
export function appInstallChipOn(m: AppManifest | undefined | null): boolean {
  return m?.marks?.install !== false;
}

/** The declared reviewer's name, or undefined when nobody has declared. */
export function appReviewedBy(m: AppManifest | undefined | null): string | undefined {
  const name = m?.authorship?.name?.trim();
  return name || undefined;
}

// ── Request shapes ──────────────────────────────────────────────────────────────────────────────

const MARK_KEYS: ReadonlyArray<keyof AppMarks> = ['badge', 'install'];

/** `{ badge?: boolean, install?: boolean }`; anything else is refused by name. */
export function parseMarksInput(input: unknown): { marks: Partial<AppMarks> } | { error: string } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { error: 'marks must be an object of booleans (badge, install)' };
  }
  const marks: Partial<AppMarks> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!(MARK_KEYS as readonly string[]).includes(k)) return { error: `marks.${k} is not a mark (badge, install)` };
    if (typeof v !== 'boolean') return { error: `marks.${k} must be a boolean` };
    marks[k as keyof AppMarks] = v;
  }
  return { marks };
}

/**
 * The reviewer's name: a string of 1 to 120 printable characters declares, an empty string or
 * null withdraws. Line breaks and control characters are refused rather than stripped, because
 * the value is served verbatim inside a `<meta>` attribute and read by whoever audits it.
 */
export function parseAuthorInput(input: unknown): { name: string | null } | { error: string } {
  if (input === null) return { name: null };
  if (typeof input !== 'string') return { error: 'author must be a string (the reviewer\'s name) or null to withdraw' };
  const name = input.trim();
  if (!name) return { name: null };
  if (name.length > AUTHOR_NAME_MAX) return { error: `author must be at most ${AUTHOR_NAME_MAX} characters` };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return { error: 'author must be a single line without control characters' };
  return { name };
}

// ── State and notes ─────────────────────────────────────────────────────────────────────────────

export interface AppMarksState {
  marks: { badge: boolean; install: boolean };
  authorship: AppAuthorship | null;
  authorshipLog: AppAuthorshipLogEntry[];
}

export function appMarksState(app: Pick<AppSummaryRecord, 'manifest'>): AppMarksState {
  const m = app.manifest;
  return {
    marks: { badge: appBadgeOn(m), install: appInstallChipOn(m) },
    authorship: m?.authorship ?? null,
    authorshipLog: m?.authorshipLog ?? [],
  };
}

export interface MarksActor {
  /** The GHII the change is recorded under. */
  ghii: string;
  /** True only when the account holder is signed in as themselves — no agent, app or ecosystem role. */
  ownerPrincipal: boolean;
}

export interface MarksUpdateInput {
  marks?: unknown;
  author?: unknown;
  actor: MarksActor;
}

export type MarksUpdateResult =
  | { state: AppMarksState; note: string }
  | { error: string; status: 400 | 403 | 404 };

export const AUTHOR_NEEDS_OWNER_PRINCIPAL =
  'Naming the person who answers for this app is reserved to the account holder signed in as themselves. '
  + 'An agent, an app or an ecosystem app acting in their name cannot declare it — the declaration is a legal act by a person, and it is kept on the record under their name.';

/**
 * The write. Parses both shapes, refuses the declaration from anything but an owner principal,
 * appends the log entry, writes the manifest once, and says in one sentence per change what the
 * served app now does. Emits the catalogue change here so both doors announce it.
 */
export async function applyOwnerMarksUpdate(
  storage: Storage,
  target: { ownerGaii: string; filename: string },
  input: MarksUpdateInput,
): Promise<MarksUpdateResult> {
  const notes: string[] = [];
  const update: {
    marks?: Partial<AppMarks>; authorship?: AppAuthorship | null; authorshipLog?: AppAuthorshipLogEntry[];
  } = {};

  if (input.marks !== undefined) {
    const parsed = parseMarksInput(input.marks);
    if ('error' in parsed) return { error: parsed.error, status: 400 };
    update.marks = parsed.marks;
  }

  let author: string | null | undefined;
  if (input.author !== undefined) {
    // Refuse BEFORE the read, and before any write: the order is the check.
    if (!input.actor.ownerPrincipal) return { error: AUTHOR_NEEDS_OWNER_PRINCIPAL, status: 403 };
    const parsed = parseAuthorInput(input.author);
    if ('error' in parsed) return { error: parsed.error, status: 400 };
    author = parsed.name;
  }

  const app = await storage.getApp(target.ownerGaii, target.filename);
  if (!app) return { error: `App "${target.filename}" not found in your uploads`, status: 404 };
  const before = appMarksState(app);

  if (update.marks) {
    if (update.marks.badge !== undefined && update.marks.badge !== before.marks.badge) {
      notes.push(update.marks.badge
        ? 'The "publish your own app" badge is shown on this app again.'
        : 'The "publish your own app" badge is no longer shown on this app.');
    }
    if (update.marks.install !== undefined && update.marks.install !== before.marks.install) {
      notes.push(update.marks.install
        ? 'Visitors are offered to install this app in their browser again.'
        : 'Visitors are no longer offered to install this app.');
    }
  }

  if (author !== undefined) {
    const current = before.authorship?.name ?? null;
    const at = new Date().toISOString();
    if (author === null && current !== null) {
      update.authorship = null;
      update.authorshipLog = appendLog(before.authorshipLog, { at, by: input.actor.ghii, action: 'cleared', name: current });
      notes.push('The reviewer\'s name has been withdrawn. The AI-generated label follows the provenance record again, and the withdrawal is on the record.');
    } else if (author !== null && author !== current) {
      update.authorship = { name: author, declaredBy: input.actor.ghii, declaredAt: at };
      update.authorshipLog = appendLog(before.authorshipLog, { at, by: input.actor.ghii, action: 'declared', name: author });
      notes.push(`${author} now answers for this app as its reviewer. The name is served in the app's source, `
        + 'the visible AI-generated label comes off, and the machine-readable provenance stays as it was. '
        + 'This is on the record: every declaration and withdrawal is kept with the name and the time.');
    }
  }

  if (update.marks || update.authorship !== undefined) {
    await storage.updateAppMeta(target.ownerGaii, target.filename, update);
    // The catalogue card and the details view read these, so the views watching 'apps' have to
    // hear about it — emitted here so the MCP door announces it without restating it.
    emitChange('apps');
  }

  const after = await storage.getApp(target.ownerGaii, target.filename);
  if (!after) return { error: 'The app was not found after the update', status: 404 };
  if (!notes.length) notes.push('Nothing changed: the app already stood where you asked.');
  return { state: appMarksState(after), note: notes.join(' ') };
}

function appendLog(log: AppAuthorshipLogEntry[], entry: AppAuthorshipLogEntry): AppAuthorshipLogEntry[] {
  const next = [...log, entry];
  return next.length > AUTHORSHIP_LOG_MAX ? next.slice(next.length - AUTHORSHIP_LOG_MAX) : next;
}

/**
 * The same capability addressed the way an AGENT holds it: by the caller's own identity and an app
 * name. Marks only — an agent is never an owner principal, so the reviewer's name is not a field
 * here at all rather than a field that always refuses. Naming nothing reports where the app stands.
 */
export async function ownerAppMarks(
  storage: Storage,
  config: AimeatConfig,
  args: { callerGaii: string; filename: string; marks?: Record<string, unknown> },
): Promise<{ state: AppMarksState; note?: string } | { error: string }> {
  const scope = await resolveAppOwnerScope(storage, config, args.callerGaii);
  if (!scope) return { error: 'This connection is not acting for an owner, so it has no app catalogue to change.' };

  const app = await storage.getApp(scope.ownerGhii, args.filename);
  if (!app) return { error: `No app named "${args.filename}" in your catalogue.` };

  if (!args.marks || Object.keys(args.marks).length === 0) return { state: appMarksState(app) };

  const out = await applyOwnerMarksUpdate(storage, { ownerGaii: scope.ownerGhii, filename: args.filename },
    { marks: args.marks, actor: { ghii: scope.ownerGhii, ownerPrincipal: false } });
  if ('error' in out) return { error: out.error };
  return out;
}

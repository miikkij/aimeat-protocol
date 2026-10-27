/**
 * @file src/services/app-intake-forms.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The public intake forms an app submits to, as the app declares them and as its code
 *   calls them. A form is drawn on the app's page but its submit goes to the node
 *   (/v1/intake/:org/:ws/:formId, routes/organisms/intake.ts) and lands in an organism workspace, so
 *   nothing tied a form to an app until now. An app opened to the internet on a closed node opens the
 *   forms it declares with it (services/internet-opening/), so the declaration is read at every
 *   publish, from the bytes, and never carried forward:
 *
 *     <meta name="aimeat-intake" content="<org>/<ws>/<formId> <org>/<ws>/<formId>">
 *
 *   The publisher must manage every form it names (the workspace's creator or an organism admin, the
 *   rule routes/organisms/intake.ts applies to defining a form), so an app cannot open somebody
 *   else's form to the internet. A form the code calls with literal ids and the meta does not name is
 *   a warning, never a refusal: the publish says which form would stay closed.
 * @structure IntakeFormRef · parseDeclaredIntakeForms · scanCalledIntakeForms · intakeFormKey · checkDeclaredIntakeForms ·
 *   managedIntakeForms · undeclaredCalledForms · intakeDeclarationOf
 * @usage
 *   const declared = parseDeclaredIntakeForms(html);
 *   const refusal = await checkDeclaredIntakeForms(storage, ownerName, declared);
 * @version-history
 *   v1.1.0 — 2026-10-27 — managedIntakeForms: a fork into another account and a backup restore keep
 *     only the forms the new owner manages (secaudit2026oct26, forkApp/manifest-spread-carries-intake-forms
 *     and apps-backup-import.ts:restoredManifest:archive-intake-declaration-kept).
 *   v1.0.0 — 2026-10-25 — Initial (wish-corp-moodissa-julkaistu-app-ulosp-in-vahdittuna-ja-listattun).
 */
import type { Storage } from '../storage/interface.js';
import type { AppArtifactFinding } from './app-artifact-lint.js';
import { findWorkspaceEntry } from './invitations.js';
import { localAccountName } from '../utils/gaii.js';
import type { IntakeFormRef } from './internet-opening/opening-types.js';

export type { IntakeFormRef };

/** One id segment: what an organism id, a workspace id and a form id are made of. */
const SEGMENT = '[A-Za-z0-9][A-Za-z0-9_-]{0,79}';
const REF_RE = new RegExp(`^(${SEGMENT})/(${SEGMENT})/(${SEGMENT})$`);
/** The most forms one app may declare. */
export const MAX_INTAKE_FORMS = 20;

export function intakeFormKey(f: IntakeFormRef): string {
  return `${f.org}/${f.ws}/${f.formId}`;
}

function dedupe(forms: IntakeFormRef[]): IntakeFormRef[] {
  const seen = new Set<string>();
  return forms.filter(f => { const k = intakeFormKey(f); if (seen.has(k)) return false; seen.add(k); return true; });
}

/**
 * The forms the page's `aimeat-intake` meta names, in order, without duplicates. A token that is not
 * `org/ws/formId` is returned in `invalid` so the publish can name it.
 */
export function parseDeclaredIntakeForms(html: string): { forms: IntakeFormRef[]; invalid: string[] } {
  const head = html.slice(0, 65536);
  const forms: IntakeFormRef[] = [];
  const invalid: string[] = [];
  const metaRe = /<meta\b[^>]*name\s*=\s*["']aimeat-intake["'][^>]*>/gi;
  for (const tag of head.match(metaRe) ?? []) {
    const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? '';
    for (const token of content.split(/[\s,]+/).filter(Boolean)) {
      const m = REF_RE.exec(token);
      if (m) forms.push({ org: m[1], ws: m[2], formId: m[3] });
      else invalid.push(token.slice(0, 120));
    }
  }
  return { forms: dedupe(forms), invalid };
}

/**
 * The forms the code calls with three literal ids: `intake.submit|getForm('org','ws','form'...)`, the
 * conversation calls under `intake.thread.*`, and a literal `/v1/intake/<org>/<ws>/<form>` address.
 * A call built from variables is not seen, which is why this only ever warns.
 */
export function scanCalledIntakeForms(html: string): IntakeFormRef[] {
  const out: IntakeFormRef[] = [];
  const q = `['"\`]`;
  const call = new RegExp(`intake\\s*\\.\\s*(?:submit|getForm|thread\\s*\\.\\s*(?:start|send|read|forget))\\s*\\(\\s*${q}(${SEGMENT})${q}\\s*,\\s*${q}(${SEGMENT})${q}\\s*,\\s*${q}(${SEGMENT})${q}`, 'g');
  for (const m of html.matchAll(call)) out.push({ org: m[1], ws: m[2], formId: m[3] });
  const path = new RegExp(`/v1/intake/(${SEGMENT})/(${SEGMENT})/(${SEGMENT})(?![A-Za-z0-9_-])`, 'g');
  for (const m of html.matchAll(path)) if (m[1] !== 'forms') out.push({ org: m[1], ws: m[2], formId: m[3] });
  return dedupe(out);
}

/**
 * May this owner name these forms? Each must be a workspace of an organism the owner is an active
 * member of, which the owner created or where the owner is the organism's creator or an admin.
 * Answers null when every form passes, else the refusal sentence naming the first that fails.
 */
export async function checkDeclaredIntakeForms(storage: Storage, ownerName: string, forms: IntakeFormRef[]): Promise<string | null> {
  if (forms.length > MAX_INTAKE_FORMS) return `An app may name at most ${MAX_INTAKE_FORMS} intake forms in aimeat-intake; this one names ${forms.length}.`;
  for (const f of forms) {
    const name = intakeFormKey(f);
    const membership = await storage.getMembership(f.org, ownerName);
    if (!membership || membership.status !== 'active') {
      return `The intake form ${name} is in an organism this account is not an active member of, so this app cannot name it in aimeat-intake.`;
    }
    const entry = await findWorkspaceEntry(storage, f.org, f.ws);
    if (!entry) return `The intake form ${name} names a workspace that does not exist.`;
    const createdBy = entry.createdBy ?? localAccountName(entry.ownerGaii);
    if (createdBy !== ownerName && membership.role !== 'creator' && membership.role !== 'admin') {
      return `The intake form ${name} is managed by the workspace's creator or an organism admin, so this app cannot name it in aimeat-intake.`;
    }
  }
  return null;
}

/**
 * The forms of a declaration that arrived WITHOUT a publish (a fork of another account's app, a
 * restored backup) split into those `ownerName` manages, by the rule checkDeclaredIntakeForms applies,
 * and those it does not, with the sentence why. A publish checks the declaration it reads from the
 * bytes; these doors stored the list they were handed, so another owner's form reached the app and,
 * through an opening, the internet (secaudit2026oct26). A value that is not an org/ws/form id triple
 * is dropped too.
 */
export async function managedIntakeForms(
  storage: Storage, ownerName: string, forms: unknown,
): Promise<{ kept: IntakeFormRef[]; dropped: Array<{ form: string; why: string }> }> {
  const kept: IntakeFormRef[] = [];
  const dropped: Array<{ form: string; why: string }> = [];
  const list = Array.isArray(forms) ? forms : [];
  for (const raw of list) {
    const f = raw as Partial<IntakeFormRef> | null;
    const ref = f && typeof f.org === 'string' && typeof f.ws === 'string' && typeof f.formId === 'string'
      ? { org: f.org, ws: f.ws, formId: f.formId } : null;
    if (!ref || !REF_RE.test(intakeFormKey(ref))) {
      dropped.push({ form: JSON.stringify(raw).slice(0, 120), why: 'It is not org/workspace/formId.' });
      continue;
    }
    if (kept.length >= MAX_INTAKE_FORMS) {
      dropped.push({ form: intakeFormKey(ref), why: `An app may name at most ${MAX_INTAKE_FORMS} intake forms.` });
      continue;
    }
    const why = await checkDeclaredIntakeForms(storage, ownerName, [ref]);
    if (why) dropped.push({ form: intakeFormKey(ref), why });
    else kept.push(ref);
  }
  return { kept: dedupe(kept), dropped };
}

/** The forms the code calls that the declaration leaves out. */
export function undeclaredCalledForms(declared: IntakeFormRef[], called: IntakeFormRef[]): IntakeFormRef[] {
  const named = new Set(declared.map(intakeFormKey));
  return called.filter(f => !named.has(intakeFormKey(f)));
}

/** The appdev pitfall a publish names when the code calls a form the declaration leaves out. */
export const UNDECLARED_INTAKE_PITFALL = 'intake-form-undeclared';

/**
 * What one publish makes of an HTML app's forms: the refusal when the declaration cannot be used,
 * else the declared forms and one warning per form the code calls without declaring it.
 */
export async function intakeDeclarationOf(
  storage: Storage, ownerName: string, html: string,
): Promise<{ refusal: { status: number; code: string; message: string } } | { forms: IntakeFormRef[]; warnings: AppArtifactFinding[] }> {
  const { forms, invalid } = parseDeclaredIntakeForms(html);
  const refuse = (why: string) => ({ refusal: { status: 422, code: 'APP_INTAKE_INVALID', message: `The app's aimeat-intake declaration cannot be used: ${why}` } });
  if (invalid.length) return refuse(`"${invalid[0]}" is not org/workspace/formId.`);
  const why = await checkDeclaredIntakeForms(storage, ownerName, forms);
  if (why) return refuse(why);
  const warnings = undeclaredCalledForms(forms, scanCalledIntakeForms(html)).map(f => ({
    pitfall: UNDECLARED_INTAKE_PITFALL, severity: 'warn' as const,
    message: `The code submits to the intake form ${intakeFormKey(f)}, which the page's <meta name="aimeat-intake"> does not name. `
      + 'On a node that shows its content to signed-in accounts only, that form stays closed when the app is opened to the internet. Add it to the meta.',
    url: `/v1/appdev/pitfalls/${UNDECLARED_INTAKE_PITFALL}`,
  }));
  return { forms, warnings };
}

/**
 * @file src/services/extension/decision-mark.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `decision: person` mark on an extension action, as pure rules with no imports: the
 *   manifest validator (manifest.ts), the invoke sequence (invoke.ts), the unattended run
 *   (system-run.ts) and the app tool manifest write (services/app-tools/decision-binding.ts) read
 *   it here. What the mark does, and the approval it leads to, is person-decision.ts. Kept apart so the
 *   manifest validator closes no import cycle through the approval request store.
 * @structure PERSON_DECISION · PERSON_DECIDES · actionDecisionRefusal · isPersonDecision · waitsForPerson
 * @usage if (isPersonDecision(action) && waitsForPerson(caller.kind)) { ... }
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (incident mwqdmtk8, extension actions that are the person's decision).
 */

/** The one value of an action's `decision` field: the person who calls it makes the decision. */
export const PERSON_DECISION = 'person' as const;

/** The code of every refusal and wait this mark causes. */
export const PERSON_DECIDES = 'PERSON_DECIDES' as const;

/** The manifest check of an action's `decision` field: null when it is absent or `person`. */
export function actionDecisionRefusal(action: Record<string, unknown>): string | null {
  if (action.decision === undefined || action.decision === PERSON_DECISION) return null;
  return `Action "${String(action.id)}": decision must be "person" or left out, got ${JSON.stringify(action.decision)}. `
    + '`decision: person` says the action is the person\'s own decision: an agent\'s call waits for the person\'s approval.';
}

/** Does the manifest mark this action as the person's decision? */
export function isPersonDecision(action: { decision?: string } | undefined | null): boolean {
  return action?.decision === PERSON_DECISION;
}

/**
 * Does a call by this kind of caller wait for the person? An agent and an ecosystem app do. The
 * person in person, an app grant (the app's own control, used by the person in their browser), a
 * person registered to an app and a visitor are people and call it as before.
 */
export function waitsForPerson(kind: string): boolean {
  return kind === 'agent' || kind === 'ecosystem';
}

/** The refusal text for a run that may not make the decision at all (no person present, or a run inside a run). */
export function personDecidesText(extName: string, actionId: string, where: string, why: string): string {
  return `The action "${actionId}" of the extension ${extName} is the person's own decision (decision: person in its manifest), and ${why}. `
    + `The person makes it themselves at ${where}. An AI prepares a draft and reads the status; it does not make the decision.`;
}

/**
 * @file src/storage/erased-logs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an account erasure does to the node's logs that name the person, as one rule both
 *   storage providers run (sqlite and postgres-kysely: pseudonymiseSiteChangeLog in node-infra,
 *   eraseModerationParty in moderation). services/owner/erasure.ts calls both with the one pseudonym
 *   the erasure drew, the one the person's held app addresses take, so the log and the addresses name
 *   the same party.
 *
 *   THE SITE CHANGE LOG is the operator's record of what changed on the node, and it stays: a line
 *   names who made the change (`changedBy`, the bare account name, the GHII or an agent's GAII) and,
 *   in three summary forms, an account the change was about. The person's identities in `changedBy`
 *   and those three forms take the pseudonym; every other word of a line stays.
 *
 *   MODERATION. A flag on the person's own content (a memory target `<identity>::<key>`, or the agent
 *   itself) goes with its appeals: the content went with the account, and an active flag on the same
 *   address would hide what the next holder of the released name writes there. The person's own
 *   appeals go with the account too. A decision the person made as a reviewer stays, because it is the
 *   node's record of a moderation decision on someone else's content, and names the pseudonym.
 *   Flags the person raised are deleted by the per-identity cascade already (flaggedBy).
 *
 *   WHY THE NAME CANNOT STAY. A deleted username is released for reuse (decision 2026-08-10), so a
 *   line that kept it would read as the next holder's change, and a flag that kept it would act on the
 *   next holder's content.
 * @structure siteChangeLogNamings(name, pseudonym) · moderationTargets(identities)
 * @usage for (const { from, to } of siteChangeLogNamings(name, pseudonym)) … replace(summary, from, to)
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial: the erasure left the erased person's bare name in the site change
 *     log of their app deletes (feature audit 2026-11-19).
 */

/**
 * The summary forms that name an account in a site change log line, with what each becomes. A fork
 * names the source app's owner (services/app/lifecycle.ts forkApp: `(by <owner>)`); an operator's
 * delete names the operator and the app's owner (routes/apps/catalogue-admin.ts:
 * `Operator <name> deleted …` and `owned by "<owner>"`). Each form carries its delimiters, so a name
 * inside a longer word or a filename never matches.
 */
export function siteChangeLogNamings(name: string, pseudonym: string): Array<{ from: string; to: string }> {
    return [
        { from: `(by ${name})`, to: `(by ${pseudonym})` },
        { from: `owned by "${name}"`, to: `owned by "${pseudonym}"` },
        { from: `Operator ${name} deleted`, to: `Operator ${pseudonym} deleted` },
    ];
}

/**
 * The flag targets that are the person's own content: an agent of theirs (`targetId` is the GAII) and
 * any memory record under one of their identities (`<identity>::<key>`, services/moderation-flags.ts).
 * `prefixes` are matched with LIKE and are escaped for it.
 */
export function moderationTargets(identities: string[]): { exact: string[]; prefixes: string[] } {
    const escape = (s: string) => s.replace(/[\\%_]/g, m => `\\${m}`);
    return {
        exact: [...identities],
        prefixes: identities.map(id => `${escape(id)}::%`),
    };
}

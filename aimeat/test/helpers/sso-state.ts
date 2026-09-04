/**
 * @file test/helpers/sso-state.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Put the two SSO flags where a suite needs them before its first assertion, and say so
 *   plainly when that is not possible.
 *
 *   WHY THIS EXISTS. `sso.enabled` and `sso.connections_locked` are NODE config, not per-run
 *   fixtures: the suites that use them flip them and restore them at the end. A run that dies before
 *   its restore leaves them set, and on Postgres they survive, because config lives in SystemSetting
 *   rather than in a file the runner deletes.
 *
 *   Inheriting `connections_locked` is the worst version of that. Connection management answers 403
 *   SEALED_CONFIG, the first test that builds a connection fails, and every assertion after it fails
 *   for a reason none of them names — which reads as an unstable suite rather than as one sentence
 *   about leftover state. Both suites that touch these flags call this first.
 * @usage await requireCleanSsoState(BASE, op.ownerToken);
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial, shared by e2e-saml-login.ts and e2e-scim-users.ts.
 */

/** The flags, and the value a suite needs them at before it starts. */
const REQUIRED: ReadonlyArray<readonly [string, boolean]> = [
    // Cleared first: while this is on, the connection-management routes refuse everything, including
    // the create that the suites below open with.
    ['sso.connections_locked', false],
    // A suite that needs SSO on turns it on itself; every one of them can start from off.
    ['sso.enabled', false],
];

/**
 * @throws when a flag cannot be put back, naming the leftover state rather than letting it surface
 *   as unrelated assertion failures further down.
 */
export async function requireCleanSsoState(base: string, operatorToken: string): Promise<void> {
    for (const [path, value] of REQUIRED) {
        const res = await fetch(`${base}/v1/admin/config`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatorToken}` },
            body: JSON.stringify({ changes: [{ path, value }] }),
        });
        await res.body?.cancel();
        if (res.status !== 200) {
            throw new Error(
                `Could not put ${path} back to ${value} before starting (${res.status}). A previous run of `
                + `this suite died before restoring node config, and on Postgres that survives the runner's `
                + `cleanup. Nothing below would be measuring what it claims to.`,
            );
        }
    }
}

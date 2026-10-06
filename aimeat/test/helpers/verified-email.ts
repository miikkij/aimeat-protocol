/**
 * @file verified-email.ts
 * @description Mark a test account's email address verified, for the suites whose subject NEEDS an
 *   account with a verified address (sign-in by email, an app roster invitation, a contact found by
 *   email, outbound mail) and is not the verification itself.
 *
 *   WHY BEHIND THE SERVER'S BACK. These suites made such an account with an organism code key, which
 *   provisioned its address verified. Since 2026-10-06 a key makes the account with the address
 *   UNVERIFIED (secaudit 2026-10 follow-up, A1), and a verification code goes out by email only, which
 *   a suite on the runner's server cannot read (e2e-email-delivery reads one through its own fake
 *   SMTP server). So the address is marked verified in the server's own database, through the storage
 *   layer the server runs, the way e2e-app-visitors writes what no route may write. The verification
 *   flow itself is tested by e2e-email, e2e-email-delivery and e2e-login-attach-email.
 * @usage
 *   import { markEmailVerified } from './helpers/verified-email.js';
 *   await markEmailVerified('alice', 'alice@example.test');
 *   await markEmailVerified('alice', 'alice@example.test', { sqlitePath });   // a suite's own node
 * @version-history
 *   v1.0.0 — 2026-10-06 — Initial (secaudit 2026-10 follow-up, A1).
 */
import { createStorage, type StorageProvider } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';
import { emailHashOf } from '../../src/services/owner-provisioning.js';
import { promoteContactsForVerifiedEmail } from '../../src/services/contacts.js';
import { applyAppInvitesForVerifiedEmail } from '../../src/services/app-member-invites.js';
import { pinnedSqlitePath, serverDbUrl } from './server-db.js';

const handles = new Map<string, Promise<Storage>>();

/** One storage handle per database, opened on first use: the runner's server's, or a suite's own. */
function storageFor(sqlitePath?: string): Promise<Storage> {
    const key = sqlitePath ?? '(runner)';
    let h = handles.get(key);
    if (!h) {
        if (sqlitePath) {
            h = createStorage({ provider: 'sqlite', sqlitePath });
        } else {
            const provider = (process.env.AIMEAT_DB ?? 'memory') as StorageProvider;
            if (provider === 'memory') {
                throw new Error('markEmailVerified needs the server on sqlite or postgres-kysely: an in-memory database lives inside the server process.');
            }
            h = createStorage({ provider, sqlitePath: pinnedSqlitePath(), dbUrl: serverDbUrl() });
        }
        handles.set(key, h);
    }
    return h;
}

/** Mark `username`'s address verified, with what POST /v1/ghii/email/confirm sets off. */
export async function markEmailVerified(username: string, email: string, opts: { sqlitePath?: string; nodeId?: string } = {}): Promise<void> {
    const nodeId = opts.nodeId ?? process.env.E2E_NODE_ID ?? process.env.AIMEAT_NODE_ID ?? 'aimeat-local-001-dev';
    const clean = email.trim().toLowerCase();
    const ghii = `${username}@${nodeId}`;
    const storage = await storageFor(opts.sqlitePath);
    const updated = await storage.updateGHII(ghii, {
        emailHash: emailHashOf(clean),
        emailVerifiedAt: new Date().toISOString(),
        notificationEmail: clean,
        verificationLevel: 1,
        verificationMethod: 'email',
    });
    if (!updated) throw new Error(`markEmailVerified: no account ${ghii}`);
    // What a confirmed address sets off on the node (routes/ghii/recovery.ts, owner-provisioning.ts):
    // address-book entries naming it become this person, and app roster invitations to it apply.
    await promoteContactsForVerifiedEmail(storage, emailHashOf(clean), ghii);
    await applyAppInvitesForVerifiedEmail(storage, nodeId, emailHashOf(clean), ghii);
}

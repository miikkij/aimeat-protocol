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
 *
 *   seedEmailVerification() writes a pending verification with a code the suite knows, for a suite
 *   whose subject is what POST /v1/ghii/verify-email hands out (e2e-agent-token-revocation).
 * @version-history
 *   v1.2.0 — 2026-10-12 — storageFor() is exported, for seed-password.ts.
 *   v1.1.0 — 2026-10-12 — seedEmailVerification() (Core 2026-11 ID-10).
 *   v1.0.0 — 2026-10-06 — Initial (secaudit 2026-10 follow-up, A1).
 */
import { createHash, randomBytes } from 'node:crypto';
import { createStorage, type StorageProvider } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';
import { emailHashOf } from '../../src/services/owner-provisioning.js';
import { promoteContactsForVerifiedEmail } from '../../src/services/contacts.js';
import { applyAppInvitesForVerifiedEmail } from '../../src/services/app-member-invites.js';
import { pinnedSqlitePath, serverDbUrl } from './server-db.js';

const handles = new Map<string, Promise<Storage>>();

/** One storage handle per database, opened on first use: the runner's server's, or a suite's own. */
export function storageFor(sqlitePath?: string): Promise<Storage> {
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

/**
 * Write a pending registration verification for `username` with `code`, as POST /v1/ghii/register-web
 * writes one before it mails the code. Returns the verification id POST /v1/ghii/verify-email takes.
 */
export async function seedEmailVerification(username: string, email: string, code: string, opts: { sqlitePath?: string } = {}): Promise<string> {
    const storage = await storageFor(opts.sqlitePath);
    const id = randomBytes(16).toString('hex');
    await storage.createEmailVerification({
        id,
        ownerName: username,
        emailHash: emailHashOf(email.trim().toLowerCase()),
        code: createHash('sha256').update(code).digest('hex'),
        purpose: 'registration',
        status: 'pending',
        attempts: 0,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString(),
        verifiedAt: null,
    });
    return id;
}

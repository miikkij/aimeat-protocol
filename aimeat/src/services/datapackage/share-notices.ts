/**
 * @file src/services/datapackage/share-notices.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The mail an outside party gets when the data package shared with it changes under it
 *   (plan doc-mvwxcas3dom3, D6.2):
 *     - withdrawn: every party whose share was live when the owner withdrew the package;
 *     - superseded: every party whose live share PINS the version a new one replaced. A share that
 *       pins no version reads the newest one by itself, so a new version is no news to it, and a
 *       daily product would otherwise mail its readers every day.
 *   Only when the party has a contact that is an e-mail address and the node can send mail; otherwise
 *   nothing is sent and nothing is queued. Best-effort: a failed send is logged and the publish or the
 *   withdrawal it follows stands. The mail names the package and the owner, and nothing else of the
 *   owner's.
 * @structure EMAIL_RE · noticeSuperseded · noticeWithdrawn · mailParties
 * @usage void noticeSuperseded(deps, ownerGhii, name, previousHash, newHash);
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D6.2).
 */
import type { ConsentRecord, Storage } from '../../storage/interface.js';
import { bare } from './contract.js';
import { getActiveEmailService } from '../email.js';
import { localAccountName } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { isLiveShare, packageOfPattern, shareMetaOf } from '../parties/shares.js';
import { readParties } from '../parties/store.js';

/** The store this needs; ./store.ts imports this file, so its StoreDeps is not imported back. */
type StoreDeps = { storage: Storage };

/** A contact the node mails: one address, nothing around it. */
export const EMAIL_RE = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;

/** Mail the party of each share. Answers how many mails were sent. */
async function mailParties(
    deps: StoreDeps, ownerGhii: string, shares: ConsentRecord[], subject: string, body: (partyName: string) => string,
): Promise<number> {
    const mail = getActiveEmailService();
    if (!mail?.enabled || !shares.length) return 0;
    const parties = (await readParties(deps.storage, ownerGhii)).parties;
    let sent = 0;
    for (const share of shares) {
        const party = parties.find(p => p.uid === shareMetaOf(share).partyUid);
        const to = party?.contact?.trim();
        if (!party || !to || !EMAIL_RE.test(to)) continue;
        try {
            if (await mail.sendNotification(to, subject, body(party.displayName || party.name))) sent++;
        } catch (err) {
            logger.warn('datapackage share notice: a mail could not be sent', { owner: ownerGhii, party: party.name, error: String(err) });
        }
    }
    return sent;
}

/** Tell the parties whose live share pins `previousHash` that a new version replaced it. */
export async function noticeSuperseded(deps: StoreDeps, ownerGhii: string, name: string, previousHash: string, newHash: string): Promise<number> {
    const owner = localAccountName(ownerGhii);
    const consents = await deps.storage.listConsents(ownerGhii, { status: 'active' });
    const pinned = consents.filter(c => c.recipient.startsWith('party:') && packageOfPattern(c.dataPattern) === name && isLiveShare(c)
        && bare(shareMetaOf(c).pinnedVersion ?? '') === bare(previousHash));
    return mailParties(deps, ownerGhii, pinned, `A newer version of the data "${name}" is available`, who =>
        `Hello ${who},\n\n${owner} published a new version of the data package "${name}" (sha256:${bare(newHash).slice(0, 12)}). `
        + `Your access covers the earlier version sha256:${bare(previousHash).slice(0, 12)}, and that is what you keep reading. `
        + `Ask ${owner} to share the new version with you if you need it.\n`);
}

/** Tell the parties of the shares a withdrawal ended. `ended` is the shares as they were before. */
export async function noticeWithdrawn(deps: StoreDeps, ownerGhii: string, name: string, ended: ConsentRecord[]): Promise<number> {
    const owner = localAccountName(ownerGhii);
    return mailParties(deps, ownerGhii, ended, `The data "${name}" is no longer shared with you`, who =>
        `Hello ${who},\n\n${owner} withdrew the data package "${name}", and your access to it ended. `
        + 'New reads are refused. Copies you already have stay with you.\n');
}

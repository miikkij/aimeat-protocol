/**
 * @file src/services/extension-consent.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether a person's consent to an extension (`extension_notify`, `extension_email`,
 *   data_pattern `ext:<name>`) covers the extension installed under that name now.
 *
 *   WHY THE INSTALL TIME. Extension names are node-wide and reusable: an uninstall frees the name and
 *   the next install, by anyone, takes it. The consent names the extension the person chose, so it
 *   counts only when it was granted at or after the current extension's `installedAt`. A redeploy of
 *   the same extension (PUT /v1/extensions/:name, update:true, the upload upsert, the builtin
 *   seeder) keeps `installedAt`, so it keeps the consent; a new install after an uninstall does not
 *   inherit it (secaudit2026oct22, extension-uninstall:name-keyed-consents-survive-reinstall).
 *   An expired consent counts for nothing, whether or not the expiry sweep has run.
 * @structure ExtensionConsentPurpose · extensionConsentHolds()
 * @usage if (await extensionConsentHolds(storage, ownerGhii, 'extension_notify', extName)) { ... }
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial: the one check ctx.notify's cross-owner delivery and ctx.email's
 *     tier 1 ask (secaudit2026oct22).
 */
import type { Storage } from '../storage/interface.js';

/** The two consent purposes an extension asks a person for. */
export type ExtensionConsentPurpose = 'extension_notify' | 'extension_email';

/**
 * True when `ownerGhii` holds an active, unexpired consent of `purpose` naming `ext:<extName>` that
 * was granted at or after the install of the extension now holding that name. False when no
 * extension of that name is installed.
 */
export async function extensionConsentHolds(
  storage: Pick<Storage, 'listConsents' | 'getExtension'>,
  ownerGhii: string,
  purpose: ExtensionConsentPurpose,
  extName: string,
  now: Date = new Date(),
): Promise<boolean> {
  const ext = await storage.getExtension(extName);
  if (!ext) return false;
  const installedAt = Date.parse(ext.installedAt);
  const consents = await storage.listConsents(ownerGhii, { status: 'active' });
  return consents.some(c => c.purpose === purpose
    && c.dataPattern === `ext:${extName}`
    && (c.expires === null || !(Date.parse(c.expires) <= now.getTime()))
    && !(Date.parse(c.grantedAt) < installedAt));
}

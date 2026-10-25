/**
 * @file src/services/extension-read-authority.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whose reach an extension's UNATTENDED runs read files with, as one function the REST
 *   route and the MCP tool both call. A schedule, an @activate job and a workflow step have nobody
 *   present to ask, so the answer is a setting the account holder made in advance.
 *
 *   THE DEFAULT IS THE BEHAVIOUR EVERY NODE ALREADY HAS, and that is the whole shape of this
 *   feature. An extension with no setting reads with the owner's own reach, exactly as it did before
 *   this file existed, so no deploy and no migration can stop a working extension. An owner's agent
 *   acts for that owner, and `ext:write` is the owner's own grant of that reach (Jouni, 2026-10-20).
 *
 *   WHAT THE AUDIT FINDING BUYS, THEN, IS VISIBILITY AND A CHOICE, not a closed read. The finding
 *   (secaudit 2026-10, extension-system-run:files-read-as-owner-ghii) was that an agent holding only
 *   `ext:write` and `ext:invoke` could install an extension whose unattended action read the owner's
 *   private files and reported back, while the same agent is refused that read on every attended
 *   path, and that NOTHING told the owner it had happened. `describeReadAuthority` is what the
 *   extension's page and the MCP answer say out loud, and `setReadAuthority` is the one control.
 *
 *   ONLY THE ACCOUNT HOLDER IN PERSON WRITES IT. The callers put `requireOwnerPrincipal()` in front,
 *   and the gate is theirs rather than this function's, because a service cannot see a request. An
 *   agent able to set its own extension back to the owner's reach would make the setting theatre,
 *   which is the one thing it exists to prevent, so a new caller adds that gate or does not exist.
 *   `extension-upsert.ts` says why publishing new code leaves the setting alone.
 * @structure READ_AUTHORITIES · ReadAuthority · describeReadAuthority · readAuthorityPayload ·
 *   setReadAuthority
 * @usage
 *   const view = describeReadAuthority(ext);
 *   res.json(success(config.nodeId, readAuthorityPayload(name, view)));
 *   const out = await setReadAuthority({ storage }, ext, 'installer');
 * @version-history
 *   2026-10-25 — readAuthorityOf reads the name through services/component-address.ts, the caller's own
 *     first, as a managing read (owner namespaces wish, secaudit2026oct22).
 *   v1.0.0 — 2026-10-20 — Initial: the owner's per-extension choice of the unattended read authority
 *     (Jouni, 2026-10-20, on secaudit 2026-10 extension-system-run:files-read-as-owner-ghii).
 */
import type { Storage } from '../storage/interface.js';
import type { ExtensionRecord } from '../storage/interface.js';
import { isGEAI } from '../utils/gaii.js';
import { findExtension } from './component-address.js';

/** The two answers, as the API and the MCP tool take them. */
export const READ_AUTHORITIES = ['owner', 'installer'] as const;
export type ReadAuthority = (typeof READ_AUTHORITIES)[number];

export interface ReadAuthorityView {
  /** What is in force now. An absent setting reads as 'owner', so this is never undefined. */
  authority: ReadAuthority;
  /** True when the owner has never made this choice, so a page can say "not reviewed". */
  default: boolean;
  /**
   * The principal that last wrote the extension's code, when it is an agent or an ecosystem app.
   * Absent when the account holder wrote it in person, and absent on a record written before
   * 2026-10-20, which carries no principal at all.
   */
  installedByPrincipal?: string;
  /** 'self' · 'agent' · 'ecosystem' · 'unknown' (a record from before the field existed). */
  installedByKind: 'self' | 'agent' | 'ecosystem' | 'unknown';
  /**
   * One plain sentence for a person: what this extension may read when it runs on its own. The UI
   * has its own translated strings; this is for the MCP answer and the logs, where an AI is relaying
   * it to the person in their own language.
   */
  summary: string;
  /**
   * True when narrowing would change nothing: the account holder wrote the code themselves, or the
   * record predates the field. The page says so rather than offering a control that does nothing.
   */
  narrowingIsInert: boolean;
}

/**
 * What is in force, and what it means, with no request and no storage read. Pure, so the page, the
 * MCP answer and the tests all read the same sentence from the same record.
 */
export function describeReadAuthority(
  ext: Pick<ExtensionRecord, 'installedByPrincipal' | 'unattendedReadAuthority'>,
): ReadAuthorityView {
  const principal = (ext.installedByPrincipal ?? '').trim();
  const kind: ReadAuthorityView['installedByKind'] = principal === ''
    ? 'unknown'
    : !principal.includes('#') ? 'self' : isGEAI(principal) ? 'ecosystem' : 'agent';
  const authority: ReadAuthority = ext.unattendedReadAuthority === 'installer' ? 'installer' : 'owner';
  // Narrowing an extension the account holder wrote themselves narrows it to the account holder,
  // and a record with no principal has nothing to narrow to. Both read as the owner whatever the
  // setting says, so the setting is reported honestly rather than as a narrowing in force.
  const narrowingIsInert = kind === 'self' || kind === 'unknown';
  return {
    authority,
    default: ext.unattendedReadAuthority === undefined,
    ...(kind === 'agent' || kind === 'ecosystem' ? { installedByPrincipal: principal } : {}),
    installedByKind: kind,
    narrowingIsInert,
    summary: summaryOf(authority, kind, principal),
  };
}

function summaryOf(authority: ReadAuthority, kind: ReadAuthorityView['installedByKind'], principal: string): string {
  if (authority === 'installer' && (kind === 'agent' || kind === 'ecosystem')) {
    return `When this extension runs on its own, it reads only what ${principal} can read. Files you keep private stay out of its reach.`;
  }
  if (kind === 'agent' || kind === 'ecosystem') {
    return `When this extension runs on its own, it reads your files with your own reach, including private ones. ${principal} wrote its code. Set it to read as its installer to narrow that.`;
  }
  if (kind === 'self') {
    return 'You wrote this extension\'s code yourself, so it reads your files with your own reach whichever setting you choose.';
  }
  return 'This extension was installed before the node recorded who wrote its code, so it reads your files with your own reach. The next time its code is published, the principal is recorded and the setting takes effect.';
}

/**
 * Load the extension and read its setting in one call, so a tool surface does not reach into storage
 * to answer a question this service owns (`pnpm check:shared-impl`). Returns null when no extension
 * has that name; the caller still makes the ownership check, because only it knows its caller.
 */
export async function readAuthorityOf(
  deps: { storage: Storage },
  name: string,
  /** The caller's account: a bare name names their own extension of that name first (services/component-address.ts, 'manage'). */
  callerOwner?: string | null,
): Promise<{ ext: ExtensionRecord; view: ReadAuthorityView } | null> {
  const ext = await findExtension(deps.storage, name, callerOwner, 'manage');
  return ext ? { ext, view: describeReadAuthority(ext) } : null;
}

/**
 * The view in the wire spelling both surfaces answer with, so the REST route and the MCP tool cannot
 * drift into two vocabularies for one question. `changed_by` and `changed_at_url` are here rather
 * than at each caller because the answer's whole job, when an agent is the one reading it, is to send
 * the person to the one place they can act.
 */
export function readAuthorityPayload(name: string, view: ReadAuthorityView): Record<string, unknown> {
  return {
    name,
    authority: view.authority,
    is_default: view.default,
    installed_by_kind: view.installedByKind,
    ...(view.installedByPrincipal ? { installed_by_principal: view.installedByPrincipal } : {}),
    narrowing_is_inert: view.narrowingIsInert,
    summary: view.summary,
    changed_by: 'the account holder, signed in in person',
    changed_at_url: '/profile?tab=extensions',
  };
}

/**
 * Write the owner's choice. Returns the record as it now stands, or null when no extension has that
 * name — the caller has already checked that the extension is this owner's, and that it exists, so
 * null here means it was deleted between the two calls.
 *
 * 'owner' is stored as the explicit string rather than cleared to NULL, so the page can tell "the
 * owner looked at this and chose the default" from "nobody has looked". Both behave identically at
 * run time (services/extension-system-run.ts reads only 'installer').
 */
export async function setReadAuthority(
  deps: { storage: Storage },
  ext: Pick<ExtensionRecord, 'name'>,
  authority: ReadAuthority,
): Promise<ExtensionRecord | null> {
  return deps.storage.updateExtension(ext.name, { unattendedReadAuthority: authority });
}

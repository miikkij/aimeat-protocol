/**
 * @file src/services/classification/reader-kind.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who is reading, as classification asks it (TARGET-082, spec §13.3): a person on their
 *   own screen, or an AI. Decided from the credential, never from what the caller declares, because
 *   an AI that could say "I am a person" would read what it is not allowed to.
 *
 *   A person: the owner's own session, and an app grant, which is the person's own screen (an app's
 *   AI calls are checked where the content goes to the model, not here). A visitor from another node
 *   signed in as a person is a person too.
 *   An AI: an agent token (every MCP session is one), an ecosystem app, an unattended run (role
 *   operator on an extension's scheduled run, a workflow step, a scheduled or unattributed AI job),
 *   and any credential made from a personal access token (`via: 'pat'`), whatever its roles: a PAT
 *   is what a program or an AI client uses, and a person reads in their own session (decided
 *   2026-09-29). The auth middleware sets the mark when it resolves a PAT, and the exchange and the
 *   PAT-backed refresh write it into the JWT they mint, so a PAT issued before the mark existed is
 *   covered too.
 *   Anonymous: nobody signed in. It reads only what is public, and a label decides that separately.
 *
 *   KNOWN LIMIT (decided 2026-09-29, spec question 6): the owner's own session driven by an AI client
 *   over REST carries nothing that tells it apart from the person, so it reads as the person.
 * @structure ReaderKind · ReaderCredential · readerKindOf(auth)
 * @usage const kind = readerKindOf(req.auth);
 * @version-history
 *   v1.1.0 — 2026-09-29 — TARGET-082 V4. A credential marked `via: 'pat'` is an AI reader.
 *   v1.0.0 — 2026-09-29 — TARGET-082 V1. Initial.
 */

export type ReaderKind = 'human' | 'ai' | 'anonymous';

/** The credential fields this reads. `req.auth` and an extension's `ctx.caller` both fit. */
export interface ReaderCredential {
  roles?: readonly string[];
  anonymous?: boolean;
  /** How the credential was obtained. 'pat': from a personal access token (auth/jwt.ts `via`). */
  via?: string;
}

export function readerKindOf(auth: ReaderCredential | null | undefined): ReaderKind {
  if (!auth) return 'anonymous';
  if (auth.anonymous) return 'anonymous';
  // Before the roles: an owner-level PAT holds role owner, and it is still a program reading.
  if (auth.via === 'pat') return 'ai';
  const roles = auth.roles ?? [];
  // An operator signed in is ['owner', 'operator']; an unattended run is ['operator'] alone.
  if (roles.includes('agent') || roles.includes('ecosystem') || (roles.includes('operator') && !roles.includes('owner'))) return 'ai';
  if (roles.includes('owner') || roles.includes('app') || roles.includes('federated')) return 'human';
  // A credential with no role we recognise is read the stricter way.
  return 'ai';
}

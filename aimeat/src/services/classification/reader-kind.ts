/**
 * @file src/services/classification/reader-kind.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who is reading, as classification asks it (TARGET-082, spec §13.3): a person on their
 *   own screen, or an AI. Decided from the credential, never from what the caller declares, because
 *   an AI that could say "I am a person" would read what it is not allowed to.
 *
 *   A person: the owner's own session, an owner-level personal access token (and the JWT exchanged
 *   from one), and an app grant, which is the person's own screen. Where an app's
 *   content goes to a model (reader.useForAi), what is hidden from AI goes too and the act is
 *   recorded as an automatic exception (decided 2026-09-30: an app does what it is built for). A visitor from another node
 *   signed in as a person is a person too.
 *   An AI: an agent token (every MCP session is one), a personal access token narrower than owner
 *   level (it holds role agent, services/access-token.ts), an ecosystem app, an unattended run (role
 *   operator on an extension's scheduled run, a workflow step, a scheduled or unattributed AI job).
 *   The owner-level PAT answer is the one isOwnerInPerson (utils/gaii.ts) gives, so the two security
 *   decisions about one token agree (Jouni, 2026-11-04: an owner's PAT is the person). The `via: 'pat'`
 *   mark the auth middleware sets stays on the credential and grants nothing; this function no
 *   longer reads it.
 *   Anonymous: nobody signed in. It reads only what is public, and a label decides that separately.
 *
 *   KNOWN LIMIT (decided 2026-09-29, spec question 6): the owner's own session driven by an AI client
 *   over REST carries nothing that tells it apart from the person, so it reads as the person; an
 *   owner-level PAT given to an AI client reads as the person in the same way.
 * @structure ReaderKind · ReaderCredential · readerKindOf(auth)
 * @usage const kind = readerKindOf(req.auth);
 * @version-history
 *   v1.2.0 — 2026-11-04 — An owner-level PAT is the person, as isOwnerInPerson answers for it (Jouni,
 *     2026-11-04, "ihmiseksi"); a narrower PAT, an agent token and an app grant keep their answers
 *     (codebase analysis 2026-11-03, PAT ruling).
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
  // The `via: 'pat'` mark is not asked: an owner-level PAT is the person (Jouni, 2026-11-04), as
  // isOwnerInPerson (utils/gaii.ts) answers for it, and a narrower PAT holds role agent.
  const roles = auth.roles ?? [];
  // An operator signed in is ['owner', 'operator']; an unattended run is ['operator'] alone.
  if (roles.includes('agent') || roles.includes('ecosystem') || (roles.includes('operator') && !roles.includes('owner'))) return 'ai';
  if (roles.includes('owner') || roles.includes('app') || roles.includes('federated')) return 'human';
  // A credential with no role we recognise is read the stricter way.
  return 'ai';
}

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
 *
 *   The rule itself is readerOf in services/caller-facts.ts, beside the caller's other facts, and the
 *   CallerContext carries it as `reader`; this function is that answer for a credential that is not
 *   a CallerContext (an extension's `ctx.caller`, a config write's caller).
 * @structure ReaderKind · ReaderCredential · readerKindOf(auth)
 * @usage const kind = readerKindOf(req.auth);
 * @version-history
 *   v1.3.0 — 2026-11-04 — The rule moves to services/caller-facts.ts readerOf, unchanged; this reads it
 *     (codebase analysis 2026-11-03, item B1).
 *   v1.2.0 — 2026-11-04 — An owner-level PAT is the person, as isOwnerInPerson answers for it (Jouni,
 *     2026-11-04, "ihmiseksi"); a narrower PAT, an agent token and an app grant keep their answers
 *     (codebase analysis 2026-11-03, PAT ruling).
 *   v1.1.0 — 2026-09-29 — TARGET-082 V4. A credential marked `via: 'pat'` is an AI reader.
 *   v1.0.0 — 2026-09-29 — TARGET-082 V1. Initial.
 */

import { readerOf, type ReaderKind } from '../caller-facts.js';

export type { ReaderKind } from '../caller-facts.js';

/** The credential fields this reads. `req.auth` and an extension's `ctx.caller` both fit. */
export interface ReaderCredential {
  roles?: readonly string[];
  anonymous?: boolean;
  /** How the credential was obtained. 'pat': from a personal access token (auth/jwt.ts `via`). */
  via?: string;
}

/** The reader kind of a credential: services/caller-facts.ts readerOf. */
export function readerKindOf(auth: ReaderCredential | null | undefined): ReaderKind {
  return readerOf(auth);
}

/**
 * @file instructions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The MCP `instructions` string served in the initialize result — the short orientation
 *   a connecting agent reads before it has called anything. The tool surface runs to a few hundred
 *   descriptions, so an agent that arrives with no orientation has to infer the node's shape from
 *   tool names alone; this text names the entry point (aimeat_handbook_get) and the three grounds
 *   that carry most of the work. Kept deliberately short: every client loads it on every connect,
 *   and the full operating guide already lives in the per-surface handbooks.
 * @structure
 *   - SURFACE_INTROS — role -> one line naming what that v2 surface is for
 *   - instructionsFor(role, opts) — the served string for /v1/mcp ('all') or a /v2/mcp/:role surface
 * @usage
 *   import { instructionsFor } from './instructions.js';
 *   new McpServer({ name, version }, { capabilities, instructions: instructionsFor(role, { guidance }) });
 * @version-history
 *   v1.4.0 — 2026-09-20 — One sentence on the apps ground: an owner saying an app turned out well
 *     is recorded with aimeat_designbook_keep. Measured with the cold-agent task `keep-app`: in a
 *     NEW conversation 0 of 3 runs recorded it (each thanked the person and called nothing),
 *     because only the builder's skill said so and a new conversation had not loaded it. In the
 *     conversation that built the app it worked without this line.
 *   v1.3.0 — 2026-09-19 — One sentence after the three grounds names aimeat_discover as the way to
 *     find something whose place is not known, and says its three reaches: the person's own, what
 *     their organisms share with them, what is public. Until now only the tool's own description
 *     and the agent-surface handbook said it, and a connection to the full surface read neither.
 *     Measured before and after with the cold-agent task `find-shared`.
 *   v1.2.0 — 2026-09-18 — What an agent acts on comes first, inside the first 1 500 characters, and
 *     the long form follows. Several clients cut this string at about 2 kB; the cut fell inside
 *     the block on how to speak and removed "their own language", the order to work in when
 *     something stops, who answers support, and the owner's proactive guidance. Reordered, not
 *     rewritten: CORE is the short form of what DETAIL says, and DETAIL is the old text.
 *   v1.1.0 — 2026-08-22 — Optional proactive guidance appended when the owner keeps that setting on
 *     (services/proactive-mode.ts). Appended rather than woven in: the base text is what every
 *     agent needs, the guidance is a choice this account made, and a reader can see which is which.
 *   v1.0.0 — 2026-08-09 — Initial: the handshake carried no instructions field, so every agent met
 *     the surface cold. Positive framing per docs/coding-guidelines/prompt-writing.md.
 */
import type { SurfaceRole } from './catalog/surfaces.js';

/**
 * One line per v2 surface, naming what it is for. Wording tracks the purposes in
 * catalog/surfaces.ts so the surface describes itself the same way in both places.
 */
export const SURFACE_INTROS: Record<SurfaceRole, string> = {
    appdev: 'This surface is for building and publishing: apps, extensions and cortex packs.',
    agent: "This surface is the owner's own agent: their memory, tasks, messages, knowledge and discovery.",
    service: 'This surface is for offering a service: work, actions, wallet, capabilities and organisms.',
    admin: 'This surface is for governance: operator settings, flags, groups, consent and agent management.',
    commerce: 'This surface is for selling and getting paid: credentials, priced manifests, checkout and receipts.',
    primitives: 'This surface is a handful of tools, and everything else is data: search what this node can do with aimeat_discover (type="capability"), then run what you found with aimeat_invoke. It runs as you, so it can do what you can do and nothing more.',
    full: 'This surface carries everything the node offers, so nothing here is narrowed to one kind of work. If your work does have a shape — building apps, running the owner\'s own agent, offering a service, governing the node, selling — the surface named after it is smaller to hold and harder to misfire from. Start with aimeat_handbook_get either way.',
};

/** An owner's word about an app is what the Design Book grows from (services/design-book/reasons.ts). */
const KEEP_SENTENCE = ' When they say one turned out well, record it: aimeat_designbook_keep.';

/**
 * What an agent has to act on, in the first 1 500 characters. Several clients cut the instructions
 * at about 2 kB (measured on 2026-09-18: one stopped mid-word at character 2 052), and until then
 * the cut removed "speak their language", the order to work in when something stops, the line about
 * who answers support, and the owner's proactive guidance, all of which came after a long block on
 * how to speak. Nothing here is new: each sentence is the short form of something DETAIL says at
 * length, so a client that shows everything reads the point twice and one that cuts reads it once.
 */
const CORE = `You are connected to an AIMEAT node, the personal knowledge and action store of the person who authorised this connection. They own everything here, and your work lands under their identity in surfaces they can see.

Call aimeat_handbook_get first, with no arguments. It is this node's operating guide: it names the tools that matter for the job in front of you, and it lists this node's skills by the situation each one covers.

Three grounds carry most of the work:
- Memory holds the person's own knowledge. aimeat_memory_list takes a key prefix and an owner scope, aimeat_memory_search finds by content, and many features here live as a memory record under a key prefix plus a prompt that reads it.
- Apps are single-file web apps published on this node. aimeat_app_list gives each one a \`url\`, which is the address to hand the person when they want to open it.${KEEP_SENTENCE}
- Organisms and workspaces are how the person shares knowledge with others. Skills (aimeat_skill_list, aimeat_skill_get) are the operating guide for one named capability.

When you do not know where something is, or what the person can reach, aimeat_discover searches every kind of content in one call, one reach at a time: scope "own" is their own content, "shared" is what the organisms they belong to share with them, "public" is what anyone can read.

When something does not work, act on what the error says. When that does not get there, or a decision is a human's to make, send it to \`support@operators\` with aimeat_dm_send: it reaches the people who run this node in one thread they answer in. Say what you were doing and what happened instead.

Speak to the person in their own language and in their words: what you did and what happens next. Ids, keys, scopes and tool names belong in what you do, not in what you say, unless they ask.`;

const DETAIL = `More on asking the operators. \`support@operators\` gives you a conversation id to continue in. Asking is the expected move, not a last resort, and what you report is how this node gets better.

SPEAK TO THE PERSON, NOT ABOUT THE SYSTEM. They did not ask for a receipt, and most of them will
never learn our vocabulary. Say what you did and what happens next, in their words:

  not this  "Read user:alice/workshop-requests (v1.0.5), build spec spec-31169dc, T1 shell
             shell-pure-client, appdev pitfalls (ownerScope, login event, locales-meta). Workshop
             t_48be5aae is alive (heartbeat 18:25, 9/10 free)."
  this      "I read the instructions and checked the workshop is free. Starting now."

Ids, versions, keys, scopes and tool names belong in what you DO, not in what you SAY — unless the
person is technical and asks for them, and then give them gladly. One or two sentences is usually the
whole report.

Three habits make the difference:

- LEAD WITH WHAT THEY GET, not with what you read or checked. "Your app is open at <address> and it
  collects the new tools once a week" — the research that got you there is yours to do, not theirs
  to read.
- SAY WHAT HAPPENS NEXT INSTEAD OF WHAT YOU DID NOT FINISH. Be just as honest, and frame it forward:
  not "I did not manage to run the schedule or read the archive key", but "it is empty until Monday,
  when the first batch arrives". A list of things you could not do reads as a confession, and it
  worries somebody who has no way to judge whether it matters.
- OFFER THE DETAIL, do not wait to be asked. End with one line: "Happy to go through how this works
  in more detail if you want." Then a curious person can have all of it, and everyone else is spared
  it. Withholding is not the goal; defaulting to plain is.

When something stops, three things and in this order: what you already tried, the one thing only they
can decide, and something else you can try if they say no. Never hand somebody an error code and a
question. If it is our fault rather than theirs, say so plainly — the node reports its own faults to
its operators, so nobody needs to be asked to write a bug report.

Speak to the person in their own language, and reach for the handbook whenever a task is new to you.`;

/** What the handshake may add to the base text for this particular account. */
export interface InstructionsOptions {
    /**
     * The proactive-guidance text, when this owner keeps that setting on. Null or absent leaves the
     * instructions exactly as they were, with nothing hinting that a switch exists — an agent told
     * about a capability it does not have would go looking for it.
     */
    proactiveGuidance?: string | null;
    /**
     * The node that answers support here, when it is not this one.
     *
     * A managed instance makes its buyer the local operator, so `support@operators` reaches the
     * customer rather than the people who run the platform. The routing is server-side and the
     * ADDRESS does not change, so this exists only to stop an agent second-guessing where its report
     * went. Absent leaves the instructions byte for byte as they were.
     */
    supportAnsweredBy?: string | null;
}

/**
 * The instructions string for a surface. `all` is /v1/mcp (the full, frozen surface); a
 * SurfaceRole is one of the purpose-scoped /v2/mcp/:role surfaces and gets its purpose named
 * up front, since on those the agent is looking at an allowlist rather than everything.
 */
export function instructionsFor(role: SurfaceRole | 'all', opts: InstructionsOptions = {}): string {
    // In the order a cut hurts least. CORE is what an agent acts on. Who answers support is one
    // line and belongs next to the address it explains. The surface line and DETAIL are the long
    // form. The owner's proactive guidance comes last because it is the longest part by far and
    // aimeat_handbook_get carries it as well, so an agent that reads the handbook has it anyway.
    // The sentence about an app that turned out well names a tool, and only these surfaces carry it.
    const hasKeep = role === 'all' || role === 'full' || role === 'agent';
    const parts: string[] = [hasKeep ? CORE : CORE.replace(KEEP_SENTENCE, '')];

    // The address is unchanged and the agent does the same thing with it. What this adds is only
    // the answer to "did that actually go anywhere".
    const answeredBy = opts.supportAnsweredBy?.trim();
    if (answeredBy) {
        parts.push(`Support here is answered by ${answeredBy}, who run this node. Write to \`support@operators\` exactly as you would anywhere; it reaches them.`);
    }
    if (role !== 'all') parts.push(SURFACE_INTROS[role]);
    parts.push(DETAIL);

    const guidance = opts.proactiveGuidance?.trim();
    if (guidance) parts.push(guidance);
    return parts.join('\n\n');
}

/** Where a client that cuts the instructions is known to cut them. The tests hold CORE under it. */
export const INSTRUCTIONS_CUT_AT = 1900;

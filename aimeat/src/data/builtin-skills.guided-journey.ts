/**
 * @file src/data/builtin-skills.guided-journey.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `aimeat-guided-journey` built-in skill: how a person's own AI walks them along the
 *   path from "I have an AI" to "others use what I built", one stage per conversation, saying at
 *   each stage what they get (wish-ohjattu-k-ytt-j-polku-..., brief doc-mupor242l3cq, P1).
 *
 *   WHY A NODE SKILL. The path is the same on every node, and the AI that walks it is the person's
 *   own, connected over MCP. The handbook names this skill while the path is not walked
 *   (services/journey-state.ts journeyHandbookSection), so an AI that read only the handbook finds
 *   it. The stages and the record `journey.state` are defined in services/journey-state.ts; this
 *   text must agree with JOURNEY_STAGES, JOURNEY_ROADS and PROFILE_FIELDS there. The interview's
 *   questions are the same seven as the served welcome-mat prompt (services/welcome-mat-prompt.ts)
 *   and the home's profile task (public/views/home/journey-prompts.js TASKS.profile).
 * @structure GUIDED_JOURNEY_SKILL_ENTRY
 * @usage import { GUIDED_JOURNEY_SKILL_ENTRY } from './builtin-skills.guided-journey.js';
 * @version-history
 *   v2.0.0 — 2026-10-03 — Stage 1 is the person's profile: an interview of seven plain questions whose
 *     answers go into `journey.state`, made into a one-page business card with a schema.org Person
 *     block and a "For AIs" section, published as their welcome page. Later offers are chosen from
 *     the answers. The model names come from services/model-recommendation.ts (Jouni, 2026-10-03).
 *   v1.3.0 — 2026-10-01 — The screen-only list with its links (data/screen-only.ts), the feature map
 *     (tier "features"), the package sheet and its agent proposals, and the Experience Center layer
 *     for each stage (guided journey P3, P4, P6).
 *   v1.2.0 — 2026-10-01 — Stage 4 points at the aimeat-organisms skill and the starting shapes.
 *   v1.1.0 — 2026-10-01 — The first result offered first is a shared place, not a note: a person's
 *     chat app already remembers things (Jouni, 2026-10-01).
 *   v1.0.0 — 2026-10-01 — Initial.
 */
import { SCREEN_ONLY_MD } from './screen-only.js';
import { MODEL_RECOMMENDATION as M } from '../services/model-recommendation.js';

/** The shape of a BuiltinSkill, named here rather than imported so this file closes no import cycle
 *  with builtin-skills.ts, which imports it; the compiler checks the two agree where it is listed. */
type BuiltinSkillEntry = { name: string; skillMd: string; visibility?: 'members' | 'public' };

export const GUIDED_JOURNEY_SKILL_ENTRY: BuiltinSkillEntry = {
  name: 'aimeat-guided-journey',
  visibility: 'public',
  skillMd: `---
name: aimeat-guided-journey
description: How to walk a person along their path on an AIMEAT node, one stage per conversation. First their profile (a short interview made into a business card that people and AIs can read), then a good AI of their own, that AI connected, an organism where their work lives, apps, agents that work while they are away, and sharing. At each stage, say what they get and where it leads. Use when the handbook says the person has not walked the path, when they are new, when they ask what this place is for, what to do next or how something here works, and when a piece of work has just finished.
license: MIT
metadata:
  audience: agent
---

# Walking a person along their path

## Where the path ends

Say this in your own words, once, early, in the person's language:

> Your own AI does your work here. It remembers what you know, uses apps built for it, runs agents
> that keep working while you are away, and shares with the people you choose. You own all of it,
> and you come to the page only to approve, to pay, or to look.

Everything below is a step toward that sentence. When you offer a stage, say what changes for the
person when it is done, not what the feature is called.

## Read where they are first

The end of your handbook (\`aimeat_handbook_get\`) lists the seven stages as done, open or declined,
what the person said they want, and the answers from their profile interview. Their own words live
in one memory record, \`journey.state\`, in their own scope: read it with
\`aimeat_memory_read { key: "journey.state", owner_scope: true }\`.

The record holds these, all optional:

\`\`\`json
{ "want": "what they said they want to get done, in their words",
  "work": "what they do",
  "needs": "what they need to get done",
  "challenges": "what gets in their way",
  "repetitive": "the work they do again and again",
  "unclear": "what is unclear or complicated to them",
  "road": "subscription | free | prompt",
  "declined": [{ "stage": "organise", "at": "2026-10-01" }] }
\`\`\`

When they answer the interview, tell you what they want, or decline a stage, read the record, change
those fields, and write the whole record back with \`aimeat_memory_write { key: "journey.state",
owner_scope: true, visibility: "owner" }\`. Each field is one line in their words. Whether a stage is
done is never written: the node works it out from what the account holds, so it cannot drift.

## How to walk it

- **What they asked for comes first.** Do the thing. Offer a stage only when the work is finished,
  when they ask what is next, when they ask what this place is for, or when they are new here.
- **One stage per conversation.** Offer the next one that fits what they said. After the profile the
  order is theirs: a shop owner goes to apps, a team lead to an organism.
- **Choose from their answers.** The profile interview is what the next offers come from: a shared
  place for work they share with others, an app for a need, an agent for the work they repeat, a
  clear write-up for what is unclear.
- **Say it once.** If they say no or not now, write the stage into \`declined\` with today's date and
  do not offer it again. They can ask for it any time.
- **Do the stage with them.** A stage is finished when something exists that they can open: a link,
  a record, a member, an agent that ran. Hand over the address.
- **The page is for approving, paying and looking.** The list of what happens on the screen, with
  the links, is at the end of this skill. Everything else happens here, in the chat.
- **Offer from what exists.** Once you know what they need, \`aimeat_handbook_get { tier:
  "features" }\` lists what this node can do by area, and \`"features/<id>"\` is one area. Offer the
  one thing that fits; do not recite the list.
- **For a person who likes to read**, each stage below names its layer in the Experience Center
  (https://experience-center.apps.aimeat.io), a guided tour with a chat way and a copy-prompt way in
  every lesson. Mention it once per stage, only if they ask how something works.

## The stages

### 1. Their profile

What they get: a one-page business card at their own address, which people read gladly and other
people's AIs can read exactly, and which they can share. It is the first thing here that is theirs,
and its interview tells you what to offer next. A person who already has apps or a shared place but
no card is offered this too.

**The interview.** Ask these one at a time, in their language and in your own words. After each
answer, say back in one sentence what you heard, then ask the next one. Five answers are enough when
they want to be quick; never ask two at once.

1. What should I call you, and what do you do?
2. What does a normal week look like: what takes most of your time?
3. What are you trying to get done right now?
4. What gets in the way, or keeps slipping?
5. What do you do again and again that you would gladly hand to someone else?
6. What feels unclear or complicated to you at the moment?
7. What should other people, and their AIs, know about you: what you offer, what you look for, and
   how to reach you?

Show a short summary and let them correct it. Then write the record: \`work\` from 1 and 2, \`needs\`
and \`want\` from 3, \`challenges\` from 4, \`repetitive\` from 5, \`unclear\` from 6.

**The card.** One HTML document:

- a heading with their name, one line on what they do, a few short sections in their words, and how
  to reach them;
- in the head, a \`<script type="application/ld+json">\` block with a schema.org \`Person\`: \`name\`,
  \`jobTitle\`, \`description\`, \`knowsAbout\`, \`skills\`, and \`makesOffer\` or \`seeks\` where they fit;
- a short section headed "For AIs", in their language, that says in plain sentences who they are,
  what they offer, what they look for, and how an AI acting for someone else should contact them;
- only what they said and approved. Challenges, repeated work and unclear things stay in their
  record and off the page unless they ask for them on it;
- all styles in one \`<style>\` block, no images and no outside files, readable on a phone in light
  and dark mode. The page is served as it is on an isolated address; keep it under 512 KB.

Show it, change it until they approve, then publish it with \`aimeat_portfolio_publish { html,
enable: true }\` (more in the skill \`aimeat-welcome-pages\`); \`enable\` makes it public, so send it
only on their yes. Give them the address the tool returns, on its own line, and ask them to open it.
If the answer says \`served: false\`, they switched their page off earlier, and they switch it on
themselves on the Portfolio page.

Then say what they got and where it leads, in two sentences: they can send the link to anyone, and
any AI that reads it knows what they do; and the next step you offer comes from what they told you.

### 2. A good AI of their own

You are reading this, so they have one. What matters is how good it is. Three roads, and the person
says which is theirs (write it as \`road\`):

- **subscription**: a paid Claude, ChatGPT or Grok, or an AI coding tool, connected over MCP.
  The best results come from Claude ${M.claude} or a newer Claude model, and ChatGPT ${M.chatgpt}
  with thinking turned on.
- **free**: the free Claude plan with this node as a connector. It runs a lighter model that handles
  everyday work well: saving and finding, sharing, asking. Apps and long builds turn out noticeably
  better on Claude ${M.claude} or newer. The other free road is their own OpenRouter credit, about
  ten dollars, used on a strong reasoning model such as DeepSeek V4 Pro; it lasts a long time at
  those prices. Free models make many mistakes here, so do not recommend them.
- **prompt**: an AI that cannot connect (the Gemini app, Microsoft Copilot, the free ChatGPT). The
  home page gives them prompts to copy and a box to paste the answer back into; the profile
  interview is one of those prompts. They will not be reading this skill; if you meet such a person
  through someone else, point them to their home page.

### 3. That AI connected

Done if you can call this node. If they use a second AI, the connection steps are on the Connect
page, /v1/profile?tab=mcp . Experience Center: layer L0, Basics.

### 4. An organism, where their work lives between conversations

What they get: one place where they, the people they invite and all their AIs read and write the
same notes, documents and decisions, and nothing goes out without a person. They need one when more
than one person, or more than one AI, works on the same material. For their own notes they do not.

Load the skill \`aimeat-organisms\`: ask what it is for and who else will use it, propose a name and
a starting shape (own work, team, company, family, club, project), and on their yes create it in one
call, \`aimeat_organism_create { name, shape, lang }\`, which makes the workspaces too. Each workspace
starts with a readme that says what it is for and what is current. That readme is how the place ages
well: when something stops mattering, it says so there, or the material is archived. Experience
Center: layer L2, Organisms & workspaces.

### 5. Apps

What they get: ready tools for a job, which you can also use for them from the chat. Look at what
they have (\`aimeat_app_list\`) and what can be installed (\`aimeat_package_list\`, and a repository's
offer with \`aimeat_package_repository\`). Before installing, tell them what the package does, what
data it handles, whether it brings an agent, and what it needs from them: \`aimeat_package_get\`
returns all of that as its \`sheet\`, with the settings the install asks. The agents a package brings
wait as proposals among their open items after the install; nothing runs before they approve one.
Read an app's bound skills (\`aimeat_skill_list\` with \`binding\`) before you drive it. A small app of
their own is the skill \`aimeat-app-builder\`. Buying happens on the page. The stage is done when
they have used one app once. Experience Center: layer L4, Apps in depth.

### 6. Agents that work while they are away

What they get: work that continues without them in the conversation. The work they said they repeat
is the first candidate. First ask what the agent should do, because that decides what it is:

- answer when they ask: that is you, already;
- the same thing on a timetable: a schedule (skill \`aimeat-recurring-work\`);
- work on its own while they are away: a worker agent, on their own machine through the connector
  or on this node; say where it runs, which model it uses and who pays, in one sentence each;
- work for an app: the app's own agent, if it brings one.

Propose the agent (skill \`add-a-crew-agent\`, or \`aimeat_agent_propose\`); the person approves it and
its permissions on their page. The skill \`manage-my-agents\` has the picture of where agents run and
who pays. The stage is done when it has run one task on its own. Experience Center: layer L3,
Agents in depth.

### 7. Shared with someone

What they get: other people, and other people's AIs, use what they built. Send someone the card,
invite someone to the organism, publish a document or a knowledge package, or put a price on an
app's tool. Each of these is their decision; offer the one that fits what they built. Experience
Center: layer L5, Agents + apps together, and B6, EXCHANGE, for selling.

## Words

Use the person's words. A word from this system carries its meaning in the same sentence the first
time: "an organism, a shared place where you and the people you invite keep your work", never just
"an organism". Ids, keys and tool names stay in what you do, not in what you say.

${SCREEN_ONLY_MD}`,
};

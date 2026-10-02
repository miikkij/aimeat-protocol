/**
 * @file new-agent.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The handbook paragraph for a request for a new agent, written once and included by
 *   the agent, full and admin handbooks.
 *
 *   WHY. Measured 2026-10-02 on a freshly bought hosted node: the owner asked their concierge for
 *   "an agent that every morning gathers the CRM's open deals and tells me what to act on". After
 *   196 s it recommended an outside agent builder and three outside CRMs. The owner's own CRM, a
 *   workspace in their organism, went unmentioned, and no proposal was written, although the node
 *   creates, seeds, credentials and runs exactly such an agent from one approved proposal. No
 *   handbook said so: the tool was on the admin list only, and the two skills that describe it are
 *   found by an agent that thinks to look.
 *
 *   WHY ONE FILE. Three handbooks carry it. A paragraph copied three times is three paragraphs that
 *   start to disagree on the day one of them is corrected.
 * @structure NEW_AGENT_MD
 * @usage
 *   import { NEW_AGENT_MD } from './new-agent.js';
 * @version-history
 *   v1.0.1 — 2026-10-02 — The node adds memory:read and memory:write to a proposal itself.
 *   v1.0.0 — 2026-10-02 — Initial.
 */

export const NEW_AGENT_MD = `**When the person asks for a new agent.** "An agent that every morning…", "something that keeps
an eye on…", a helper for one job: this node makes it. Never point them to an outside agent builder,
tool or product for this; the node creates the agent, gives it its instructions, credentials it and
runs it on the person's own connector.
1. **Look at what they have.** \`aimeat_agents_list\`: an agent that already does this, or nearly,
   gets the work instead (a task, or a schedule of kind \`agent_task\`). \`aimeat_organism_list\` and
   \`aimeat_workspace_list\` (or \`aimeat_discover\` with scope "shared"): the organisms and workspaces
   the new agent will work on, such as their CRM, their notes or their customers. Read the one it
   will use, so you design for the data they keep and not for a product they do not have.
2. **Propose it.** \`aimeat_agent_propose\` with a name, a \`purpose\` that names their data ("reads
   the open deals in your Sales workspace each morning and lists what to act on"), the scopes the
   job needs (the node adds \`memory:read\` and \`memory:write\`, which a crew runtime reads its
   definition and writes its result with), and a \`crew_def\`. It creates nothing. Skill \`add-a-crew-agent\` has the
   definition's shape and how to check it.
3. **Tell them where to approve.** The answer carries \`approval_url\` and \`next_step\`: give them
   both, in their words. Their own press makes the agent. Work on a clock comes after that, as a
   schedule of kind \`agent_task\` for the new agent.`;

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
 *   v1.3.0 — 2026-10-14 — The ideas the home offers, for a person who does not yet know what to ask
 *     for: tier "home-ideas", the same list the home reads (services/home-ideas.ts). Additive.
 *   v1.2.0 — 2026-10-11 — Step 4, after the agent is made: its first run, where its work goes
 *     (aimeat_agent_workplace_set), and an app of its work (tier "build-app/agent/<name>",
 *     aimeat_app_agent_tie, aimeat_app_agent_untie).
 *   2026-10-11 — The word a person reads for a connector is "computer" (laptop, server, cloud, AIMEAT instance), never "machine" (Jouni, 2026-10-11).
 *   v1.1.0 — 2026-10-10 — Which machine: aimeat_connector_list and the proposal's `connector`.
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
   definition's shape and how to check it. When the person says which computer runs it, or has more
   than one connector, \`aimeat_connector_list\` names their computers: pass the one they mean as
   \`connector\`, and say its name to them, never its id.
3. **Tell them where to approve.** The answer carries \`approval_url\` and \`next_step\`: give them
   both, in their words. Their own press makes the agent. Work on a clock comes after that, as a
   schedule of kind \`agent_task\` for the new agent.
4. **After it is made.** The node gives the new agent its work once, so there is a first result to
   show. Its results stay in its own memory, which only the person reads; when they want a group to
   see them, \`aimeat_agent_workplace_set\` names one workspace, and each result it finishes from
   then on is shared with that workspace's members. When they want an app that shows the agent's
   work, read \`aimeat_handbook_get { tier: "build-app/agent/<name>" }\` (the agent, how to read its
   work, the structure of its latest result, and the data map row that ties the app to it) and
   then the build specification, tier "build-app". \`aimeat_app_agent_tie\` ties an app that
   already exists to an agent, and \`aimeat_app_agent_untie\` takes the tie away.

When the person does not yet know what agent or app to ask for, \`aimeat_handbook_get { tier: "home-ideas" }\`
gives the ideas their home page shows: agents made from one sentence and run for real, and apps
paired with the agent that works through them. Offer the two or three that fit what they do, in
their language, and start from the sentence they choose.`;

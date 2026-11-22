/**
 * @file src/services/builder/atelier-ai-path.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How the person's own AI uses an app built on the Atelier track: the build style the
 *   proposal recommends, the path the AI takes into the app (a bound skill and a direct write, or an
 *   app tool), and what the bound skill holds. Three texts: the core section every Atelier build
 *   reads (short, because part `libraries` is near MAX_PART_CHARS), the platform section `ai-path`
 *   it sends every AI-accelerated build to, and the platform section `app-tools`, read when the
 *   app needs a tool.
 *
 *   WHY. On aimeat.io on 2026-11-20, 40 of 245 apps in use had app tools, 51 a bound skill only and
 *   154 neither; about 37 of those 154 were work apps whose data an AI could have written. The
 *   Atelier text never named app tools, and it asked for a bound skill without saying what the skill
 *   holds, so builds made forms and stopped (wish-atelier-ohjaa-teko-lykiihdytykseen-skilli-suora-
 *   kirjoitus-ja; the rules come from that research, brief-vanhat-apit-tekoalyn-kaytettaviksi).
 * @structure ATELIER_AI_PATH_SECTION · AI_PATH_SECTION · APP_TOOLS_SECTION · AI_PATH_NONE_META
 * @usage body += ATELIER_AI_PATH_SECTION; atelierPlatformPiece('app-tools', …) answers APP_TOOLS_SECTION.
 * @version-history
 *   2026-11-21 — The bound skill writes each app tool call with its fields, and the publish names
 *     the fields a tool refuses (skill.toolFieldIssues). Additive.
 *   v1.0.0 — 2026-11-20 — Initial.
 */

/** The declaration of a page whose owner chose no AI part: a presentation (services/app/ai-path-step.ts reads it). */
export const AI_PATH_NONE_META = '<meta name="aimeat-ai-path" content="none">';

/** The core section: read by every Atelier build, right after "Data, in short". */
export const ATELIER_AI_PATH_SECTION = '## How the person\'s own AI uses the app\n'
  + 'The person works through their own AI; typing into the app by hand is an option they choose. In the proposal, recommend a build style: '
  + '**AI-accelerated** (the default), a **quick trial** (`proto`) or a **presentation** (`' + AI_PATH_NONE_META + '`). '
  + 'On AI-accelerated, read platform section `ai-path` (`build-app-atelier/ai-path`) before you design the records.\n\n';

/** The platform section `ai-path`: read on every AI-accelerated build, as the core section says. */
export const AI_PATH_SECTION = '## How the person\'s own AI uses the app: the build style and how the AI reaches the app\n'
  + 'This node is AI-first. The person does their work through their own AI, and typing into the app by hand is an option they choose, '
  + 'never the only way: an app is finished when their AI can do in it what they can do in it. The person decides which acts they keep for themselves.\n\n'
  + '**Recommend a build style in the proposal, and let the owner pick.** Ask no extra questions for it; recommend from what the app is for:\n'
  + '- **AI-accelerated**, the default for anything used for real work or by other people: the bound skill tells an AI how to read and write the app\'s data, '
  + 'the data map says where the data is stored, and the app gets app tools where the list below asks for them.\n'
  + '- **Quick trial**: the level `proto`, an idea the owner tries and shares with nobody. Nothing for AI.\n'
  + '- **Presentation**: a page that is shown and not changed afterwards, with no interaction (a story, a CV, a landing page). The agent face only; '
  + 'declare `' + AI_PATH_NONE_META + '` so the publish does not ask for more.\n\n'
  + '**How the AI reaches the app: take the cheapest way that works.**\n'
  + '1. **The person\'s own data grows** (records are added and changed): a bound skill that names the keys or the workspace spaces and the record shape. '
  + 'The AI writes with the tools it already has (`aimeat_memory_write`, `aimeat_workspace_write`, `aimeat_workspace_rows_append`); no extension is needed. '
  + 'Keep each record one thing a person opens as a unit, let the app derive totals and states itself, and re-read on the live event, so a write the AI made shows without a reload.\n'
  + '2. **The app enforces a rule** (a calculation, a limit, money or points, a validation, a permission, a law): an app tool backed by an extension action, '
  + 'and the space closed so nobody\'s AI bypasses the tool. Platform section `app-tools`.\n'
  + '3. **Several people or agents share the data:** tools that check the version and the rights.\n'
  + '4. **The app produces content** (levels, songs, scenes, worlds): tools to read the schema, validate, simulate and put.\n'
  + '5. **The app shows data someone else produces:** a read tool only when another person\'s AI needs that data.\n'
  + '6. **The app is only an experience** (an arcade game, a demo, a template): the agent face is enough. A game with shared rooms or with content a person makes is 3 or 4.\n\n'
  + 'People keep these for themselves unless they say otherwise: sending anything outward, paying, publishing, accepting a decision, and judging another person. '
  + 'The AI writes a proposal for these, and the person approves it in the app. The number of tools follows the verbs on the data, never the number of fields or screens.\n\n'
  + '**What the bound skill holds.** It is written for the person who OPERATES the app through their AI, not for the next builder: '
  + 'where each kind of data is stored (the keys with the app\'s prefix, or the workspace and its spaces, as the data map says); the record shape with a short example, '
  + 'and what the app derives itself and must not be written; the rules the app checks, so a direct write keeps them; which acts the person confirms and how the AI proposes them; '
  + 'the app tools, if any, and that they come before a direct write; and whether the open app shows a change without a reload. '
  + 'Write each app tool call in it with its fields, `tool_name { field, field: value }`: the publish checks those calls against the tool manifest and names in `skill.toolFieldIssues` every field a tool does not accept, so fix those before anyone follows the skill. '
  + 'Bind it with `metadata.binding: "app:<owner>/<filename>"` (`aimeat_skill_publish`). Test it once as its reader: with only the skill, add one record and change it, see the app show it, then remove the record.\n';

/** The platform section `app-tools`: read when rule 2, 3 or 4 of the core section applies. */
export const APP_TOOLS_SECTION = '## App tools: an action the person\'s AI or an agent calls\n'
  + 'An app tool is one named action of the app that an AI calls over MCP (`aimeat_app_tool_invoke`) and an agent calls from its tasks. '
  + 'It is the controlled path: the rule the app enforces runs on the server, and the AI cannot skip it. Use it when the app enforces a rule, when several people or agents share the data, '
  + 'or when the app produces content; for data that only grows, a bound skill and a direct write are enough.\n\n'
  + '**The action runs in an extension.** Reuse the app\'s extension when it has one (`aimeat_extension_list`); otherwise build one with skill `node:aimeat-extension-builder` (platform section `server-side`). '
  + 'Its `ctx.workspace`, `ctx.memory`, `ctx.files`, `ctx.ai` and `ctx.calendar` do the work, and `ctx.changed` tells the open pages to read again after a write, so the person sees what their AI did.\n\n'
  + '**The manifest names the tools.** `aimeat_app_tools_publish { app_id: "<filename>", tools: [{ name, description, inputSchema, outputSchema, action_id: "ext:<extension>:<action>" }] }`. '
  + 'It replaces the whole manifest, so read it first with `aimeat_app_tools_get`. A tool with no price is the owner\'s own: their AI and agents call it, '
  + 'and it shows on the app\'s WebMCP surface and its "Use with your AI" page. A price or a pacing amount offers it to other owners (the tool\'s own description says how).\n\n'
  + '**Close the space the tool guards.** Name the extension on every workspace space an agent may write only through the tool: `objectTypes[].extensions: ["<installer>/<extension name>"]`, '
  + 'and say in the space\'s `description` which tool writes it. The person in person and the app\'s own page still write directly. Skill `node:aimeat-agent-capability`, "What an app tool is", has the rest.\n\n'
  + '**A good tool set** has one status tool that answers the state and the next steps ("START HERE"); a dry run before a write, and a refusal that names what to change; '
  + 'confirmation before publishing or anything that cannot be undone; calls that can be repeated safely; a record of who decided, person or agent; and `expectedVersion` on shared records. '
  + 'Write each description for the AI that calls it: what it does, what it refuses, and what to call next.\n\n'
  + '**Check it** as its caller: `aimeat_app_tool_invoke` the status tool and one write, see the open app show the write without a reload, and name the tools in the bound skill.\n';

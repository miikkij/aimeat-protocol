/**
 * @file public/js/services/agent-draft-known.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the home's agent draft knows about the person: what each tool is for, which
 *   tools the person's own apps publish, and which workspaces the person has. It writes that as
 *   the text added to the draft prompt, and it reads the same things back out of a definition for
 *   the page that shows the agent before it is made.
 *
 *   WHY THE MODEL IS TOLD. A capability is built as an app, and the app gives it to an agent as a
 *   tool (Jouni, 2026-10-12). The draft prompt listed tool ids only, so an agent made from one
 *   sentence could not use the person's mail workspace or calendar app even when both existed.
 *
 *   AN ADDRESS, NEVER A NAME. The model writes a tool's sku and a workspace's id into the task
 *   description. Both are exact strings: the runtime finds the tool and the workspace by them, and
 *   the page finds them in the definition by them. A name is for the person to read; two
 *   workspaces can share one, and a name inside a sentence proves nothing. An id that is a plain
 *   word (a workspace id typed by hand, "notes") proves nothing either and is never read out of a
 *   definition: what the page shows is what the person approves, so a row that is missing is the
 *   safe mistake and a row that is wrong is not.
 *
 *   NAMES ARE OTHER PEOPLE'S TEXT. A workspace is named by whoever made it, in any organism the
 *   person belongs to, and the name goes into instructions a model follows. Every name is cut to
 *   one short line before it does (nameLine).
 *
 *   SIZES ARE PRODUCTION'S. Measured on aimeat.io on 2026-10-12, one account: 157 callable app
 *   tools whose descriptions total 43 049 characters, and 85 workspaces. A description is cut to
 *   its first sentence, and shorter the more tools there are.
 *
 *   No imports, so a unit test can run it (test/unit/agent-draft-known.test.ts).
 * @structure DEFAULT_TOOL_MENU · clipLine(text, max) · knownBlock(menu, known) · namedIn(crewDef, known) ·
 *   withNeededTools(crewDef, named, offered) · readOnlyTools(crewDef) · extraScopes(crewDef) ·
 *   RECORDS_FEATURE · BACKFILL_FEATURE · recordsBlock(known, features) · watchedPlace(when, known) · recordSpacesOf(crewDef) ·
 *   withRecordSpaces(crewDef, watch) · withSpaceNote(crewDef, watch) · llmChoiceOf(pick, llm) · withToolSkus(crewDef, known) ·
 *   joinsAgentList(organism)
 * @usage
 *   const prompt = base + knownBlock(menu, { apps, places }) + recordsBlock({ places }, features);
 *   const named = namedIn(draft.crewDef, { apps, places });
 *   const def = withRecordSpaces(draft.crewDef, { organism_id, workspace_id, spaces: ['shared.requests'] });
 * @version-history
 *   v1.7.0 — 2026-10-13 — joinsAgentList(): an agent that works on a workspace's records goes onto
 *     its organism's agent list only where the organism admits listed agents alone. In any other
 *     organism the list took the workspace away from it (seen on aimeat.io 2026-10-13).
 *     extraScopes(): an agent that calls an app tool is proposed with organism:read as well,
 *     because the tool's extension reads the app's workspace as the agent (same day, same run).
 *   v1.6.0 — 2026-10-13 — withToolSkus(): a tool address without its prefix, and the prompt's open
 *     form with the tool named beside it, become the tool's full address, per task.
 *   v1.5.0 — 2026-10-13 — llmChoiceOf(): the model choice the node stores, built from the pick on the
 *     new-agent page and the models the chosen computer reaches.
 *   v1.4.0 — 2026-10-13 — A browser on the agent's computer: browserBlock() (the prompt text, for a
 *     runtime that names the feature) and withBrowserSites() (a draft keeps the tool only with plain
 *     hostnames in `browser_domains`).
 *   v1.3.0 — 2026-10-12 — withSpaceNote(): every task of an agent that works on a workspace's
 *     records names the workspace's spaces and marks the watched ones, so a result is not written
 *     into the space it came from (seen in the production run of 2026-10-12). The prompt says the
 *     page does this, so the model names no space.
 *   v1.2.0 — 2026-10-12 — `backfill`: a watch can ask for the records that are already in its
 *     spaces, written per item of `record_spaces` and read back by recordSpacesOf (Jouni,
 *     2026-10-12: "haluan myös valinnan käsittele myös vanhat"). BACKFILL_FEATURE names the
 *     runtime feature the page offers it on.
 *   v1.1.0 — 2026-10-12 — An agent that works when a record is published in a workspace: the text
 *     the draft prompt gets for it (only for a runtime whose menu names the feature), the workspace
 *     a draft names, and the definition's `record_spaces` with "records" in `listen_for`. A
 *     definition that names such spaces asks organism:read
 *     (wish-sopimuspohjainen-agentti-kodista-luonnos-ehdottaa-sit-ja-koh).
 *   v1.0.1 — 2026-10-12 — extraScopes: a definition that calls an app tool asks ext:invoke, the
 *     word the extension action route checks and refuses without from node 4.0.0.
 *   v1.0.0 — 2026-10-12 — Initial (wish-kodin-agenttiluonnos-tuntee-ty-kalujen-kuvaukset-omistajan-s).
 */

/**
 * The tools a definition may use when no runtime could be asked, each with what it is for. The
 * first six have been in the crew runtime's registry since before 2026-09, `app_tools` since
 * 2026-08-31 and the two workspace tools since 2026-10-02 (crewaimeat crew_def.py TOOL_REGISTRY).
 * A connected runtime answers with its own list and its own words, and that answer is used instead.
 */
export const DEFAULT_TOOL_MENU = [
  { id: 'web', purpose: 'search the live web' },
  { id: 'article_fetch', purpose: 'fetch and read the article text behind a result address' },
  { id: 'memory', purpose: 'read and write the person\'s AIMEAT memory at exact keys' },
  { id: 'dm', purpose: 'read the messages sent to the agent and answer them' },
  { id: 'image', purpose: 'make an image from a text and get its address' },
  { id: 'schedule', purpose: 'create, list, change and delete schedules on the person\'s AIMEAT' },
  { id: 'app_tools', purpose: 'find and call the tools that apps on AIMEAT publish; the person\'s own apps\' tools cost nothing' },
  { id: 'workspace', purpose: 'read the person\'s organisms and workspaces: list them, read one workspace\'s index, then the records needed. Read-only' },
  { id: 'workspace_write', purpose: 'everything "workspace" reads, and create or update a record and append rows' },
];

/** The longest line a runtime's own tool description is given. Two of them run past 600 characters. */
const PURPOSE_MAX = 200;
/** The most app tools and workspaces listed. The node's read stops at 500 tools. */
const TOOLS_MAX = 400;
const PLACES_MAX = 300;

/** The longest name of an app, an organism or a workspace the prompt carries. */
const NAME_MAX = 80;

/** A registry name as a person reads it. The same rule as decodeEntities in /js/utils.js. */
function plain(s) {
  return String(s ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&amp;/g, '&');
}

/**
 * A name as one short line of the prompt. A workspace's and an organism's name is written by
 * whoever made it, in an organism the person is only a member of, so it is another person's text
 * inside the instructions a model follows. It is kept to one line of NAME_MAX characters, and its
 * square brackets become round ones, because the prompt writes the address in square brackets.
 */
function nameLine(s) {
  return clipLine(plain(s).replace(/\[/g, '(').replace(/\]/g, ')'), NAME_MAX);
}

/**
 * A text on one line, at most `max` characters: whole when it fits, else its first sentence, else
 * cut at a word with an ellipsis.
 */
export function clipLine(text, max) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const first = s.split(/(?<=[.!?])\s/)[0];
  if (first.length <= max) return first;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : cut).replace(/[,;:(]+$/, '') + '…';
}

/** How long one app tool's description may be, by how many tools there are to list. */
const describeUpTo = (count) => (count <= 60 ? 160 : count <= 160 ? 110 : 70);

/**
 * The text added after the draft prompt. `menu` is the tools a definition may use, each
 * { id, purpose }; `known` is { apps, places } as GET /v1/home/agents/choices?include=tools answers.
 * A kind the menu has no tool for is left out, because a definition could not reach it.
 */
export function knownBlock(menu, known) {
  const tools = Array.isArray(menu) ? menu.filter((m) => m && typeof m.id === 'string') : [];
  const has = (id) => tools.some((m) => m.id === id);
  const out = [];

  const described = tools.filter((m) => m.purpose);
  if (described.length) {
    out.push('', 'What each tool is for:', ...described.map((m) => `- ${m.id}: ${clipLine(m.purpose, PURPOSE_MAX)}`));
  }

  const apps = has('app_tools') ? (known?.apps ?? []).filter((a) => Array.isArray(a.tools) && a.tools.length > 0) : [];
  const total = apps.reduce((n, a) => n + a.tools.length, 0);
  if (total > 0) {
    const each = describeUpTo(total);
    out.push('', 'The person\'s own apps publish these tools. An agent calls one with the "app_tools" tool by its sku: the address in brackets after the app, with the tool\'s name in place of <tool>.');
    let listed = 0;
    for (const app of apps) {
      if (listed >= TOOLS_MAX) break;
      const first = String(app.tools[0].sku ?? '');
      out.push(`${nameLine(app.name)} [${first.slice(0, first.lastIndexOf(':') + 1)}<tool>]`);
      for (const tool of app.tools) {
        if (listed >= TOOLS_MAX) break;
        const what = clipLine(tool.description, each);
        out.push(what ? `- ${tool.name}: ${what}` : `- ${tool.name}`);
        listed++;
      }
    }
    if (total > listed) out.push(`And ${total - listed} more. The agent finds them itself with the "app_tools" tool.`);
  }

  const reads = has('workspace') || has('workspace_write');
  const places = reads ? (known?.places ?? []) : [];
  if (places.length > 0) {
    const how = has('workspace_write')
      ? 'An agent reads one with the "workspace" tool, and writes records or rows into one with "workspace_write". Both take the workspace id.'
      : 'An agent reads one with the "workspace" tool, which takes the workspace id.';
    out.push('', `The person's workspaces, each as organism / workspace [workspace id]. ${how}`);
    // An id two organisms share is told apart by the organism's id, which the tools take as well.
    const shared = (id) => places.filter((pl) => pl.workspace_id === id).length > 1;
    for (const pl of places.slice(0, PLACES_MAX)) {
      const address = shared(pl.workspace_id) ? `${pl.workspace_id} in organism ${pl.organism_id}` : pl.workspace_id;
      out.push(`- ${nameLine(pl.organism_name)} / ${nameLine(pl.workspace_name)} [${address}]`);
    }
    if (places.length > PLACES_MAX) out.push(`And ${places.length - PLACES_MAX} more. The agent lists them itself with the "workspace" tool.`);
  }

  if (total > 0 || places.length > 0) {
    out.push('', 'When the sentence is about something one of these apps or workspaces holds, build the agent on it. Give the agent that tool, and write the sku or the workspace id into the task description exactly as it is written here, beside the name a person reads. Choose "workspace_write" when the agent stores or changes something in the workspace, and "workspace" when it reads. An agent that uses "workspace_write" has reach "standard". Use web search for what is on the web, and these for what the person keeps here.');
  }
  // Each part opens with an empty line; one more newline ends the instructions' last line.
  return out.length ? '\n' + out.join('\n') : '';
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whether a token can be told from a word: it has a digit, a hyphen, an underscore, a colon or a
 * slash. A workspace id a person typed by hand can be a plain word ("notes"), and a sentence that
 * says "take notes" does not name that workspace. Such an id is never read out of a definition.
 */
const isAddress = (token) => /[0-9_:/-]/.test(String(token ?? ''));

/**
 * Whether `text` carries `token` as a whole address:
 * - nothing that could be part of a longer address stands before it (a letter, a digit, an
 *   underscore, a hyphen, a dot, and the slash and colon that join the parts of a sku, so an id
 *   that is also a part of a sku is not read out of the sku);
 * - no letter, digit, underscore or hyphen follows it, and no dot that continues into a name. A
 *   dot that ends the sentence is not part of the address.
 */
function mentions(text, token) {
  if (!token || !isAddress(token)) return false;
  return new RegExp(`(?<![A-Za-z0-9_/:.-])${escapeRe(token)}(?![A-Za-z0-9_-]|\\.[A-Za-z0-9])`).test(text);
}

/** Every string a value holds, at any depth. Keys are not text a model wrote. */
function stringsOf(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringsOf(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) stringsOf(v, out);
  return out;
}

/**
 * The person's apps and workspaces a definition names: an app by the sku of one of its tools, a
 * workspace by its id. An id that two of the person's organisms share counts only with the
 * organism's id in the definition too; an organism's name would match inside other words.
 * Returns { apps: [{ filename, name, tools }], places: [...] }, each a subset of `known`.
 */
export function namedIn(crewDef, known) {
  const none = { apps: [], places: [] };
  if (!crewDef || typeof crewDef !== 'object') return none;
  // The strings themselves, one per line. In JSON text a line break is written as the two
  // characters "\n", and the "n" would read as a letter standing before the address.
  const text = stringsOf(crewDef).join('\n');
  const apps = [];
  for (const app of known?.apps ?? []) {
    const tools = (app.tools ?? []).filter((x) => mentions(text, x.sku));
    if (tools.length > 0) apps.push({ filename: app.filename, name: app.name, tools });
  }
  const all = known?.places ?? [];
  const shared = (id) => all.filter((pl) => pl.workspace_id === id).length > 1;
  const places = all.filter((pl) => mentions(text, pl.workspace_id)
    && (!shared(pl.workspace_id) || mentions(text, pl.organism_id)));
  return { apps, places };
}

const SKU_PREFIX = 'app-tool:';
/** `text` with every whole occurrence of the address `token` replaced. `mentions` has the rule for "whole". */
const replaceAddress = (text, token, to) =>
  text.replace(new RegExp(`(?<![A-Za-z0-9_/:.-])${escapeRe(token)}(?![A-Za-z0-9_-]|\\.[A-Za-z0-9])`, 'g'), () => to);

/**
 * A definition whose tasks name the person's app tools by an address the runtime can call.
 *
 * The prompt gives one address per app with the tool's name left open
 * (`app-tool:<owner>/<file>:<tool>`) and asks the model to put the name in. Measured on 2026-10-13
 * with the model production drafts with, nine drafts from three home sentences on a prompt of
 * production size: three wrote the full address, two wrote it without the `app-tool:` prefix, and
 * four copied the open form as it stood and named the tools beside it ("[…:<tool>] … call
 * `new_messages`"). In the last two forms the page named no app before the person approved, and
 * the agent's instructions held an address nothing answers to.
 *
 * Both are repaired here from what the task itself says, per task, for the apps in `known`:
 * - an address without its prefix gets the prefix;
 * - the open form is replaced by the full addresses of that app's tools the same task names as
 *   whole words. A task that names none keeps the open form: the page then names no app for it,
 *   and a missing row is the safe mistake.
 * Nothing is added that the task does not name. Returns the same object when nothing changed.
 */
export function withToolSkus(crewDef, known) {
  if (!crewDef || typeof crewDef !== 'object' || !Array.isArray(crewDef.tasks)) return crewDef;
  const apps = (known?.apps ?? []).map((app) => ({
    tools: (app?.tools ?? []).filter((x) => typeof x?.name === 'string' && x.name && String(x?.sku ?? '').startsWith(SKU_PREFIX) && String(x.sku).endsWith(`:${x.name}`)),
  })).filter((app) => app.tools.length > 0);
  if (apps.length === 0) return crewDef;
  let changed = false;
  const tasks = crewDef.tasks.map((task) => {
    if (typeof task?.description !== 'string') return task;
    let text = task.description;
    for (const app of apps) {
      // "app-tool:<owner>/<file>:", the part every tool of the app shares.
      const stem = app.tools[0].sku.slice(0, app.tools[0].sku.length - app.tools[0].name.length);
      const open = `${stem}<tool>`;
      // The prefix first, on a tool's address and on the open form alike.
      for (const tool of app.tools) text = replaceAddress(text, tool.sku.slice(SKU_PREFIX.length), tool.sku);
      text = text.split(open.slice(SKU_PREFIX.length)).join(open).split(SKU_PREFIX + open).join(open);
      if (!text.includes(open)) continue;
      // The tools the task names beside the open form: as a whole word, outside any address.
      let beside = text.split(open).join(' ');
      for (const tool of app.tools) beside = replaceAddress(beside, tool.sku, ' ');
      const named = app.tools.filter((tool) => new RegExp(`(?<![A-Za-z0-9_/:.-])${escapeRe(tool.name)}(?![A-Za-z0-9_-])`).test(beside));
      if (named.length > 0) text = text.split(open).join(named.map((tool) => tool.sku).join(', '));
    }
    if (text === task.description) return task;
    changed = true;
    return { ...task, description: text };
  });
  return changed ? { ...crewDef, tasks } : crewDef;
}

const toolsOf = (member) => (Array.isArray(member?.tools) ? member.tools : []);
const anyMemberHas =(crewDef, ids) => (Array.isArray(crewDef?.agents) ? crewDef.agents : []).some((m) => toolsOf(m).some((x) => ids.includes(x)));

/**
 * A definition whose members can reach what it names. A member whose own text or whose task names
 * an app tool and who has no "app_tools", or names a workspace and has no workspace tool, would
 * read the address and have nothing to call it with; THAT member gets the tool. A task belongs to
 * the member its `agent` names, by name or by role, as the runtime resolves it. An address that no
 * member's text holds (it is somewhere else in the definition) goes to the first member when
 * nobody has the tool. `offered` is the set of tool ids the runtime resolves, and a tool outside it
 * is never added. Returns the same object when nothing is missing.
 */
export function withNeededTools(crewDef, named, offered) {
  const members = Array.isArray(crewDef?.agents) ? crewDef.agents : [];
  const skus = (named?.apps ?? []).flatMap((a) => (a.tools ?? []).map((x) => x.sku));
  const places = named?.places ?? [];
  if (members.length === 0 || (skus.length === 0 && places.length === 0)) return crewDef;
  const tasks = Array.isArray(crewDef.tasks) ? crewDef.tasks : [];
  const canCall = offered?.has('app_tools') && skus.length > 0;
  const canRead = offered?.has('workspace') && places.length > 0;
  const reads = (m) => toolsOf(m).some((x) => x === 'workspace' || x === 'workspace_write');

  let agents = members.map((m) => {
    const own = tasks.filter((x) => x?.agent && (x.agent === m.name || x.agent === m.role));
    const text = stringsOf([m.role, m.goal, m.backstory, own]).join('\n');
    const add = [];
    if (canCall && !toolsOf(m).includes('app_tools') && skus.some((s) => mentions(text, s))) add.push('app_tools');
    if (canRead && !reads(m) && places.some((pl) => mentions(text, pl.workspace_id))) add.push('workspace');
    return add.length ? { ...m, tools: [...toolsOf(m), ...add] } : m;
  });

  const rest = [];
  if (canCall && !agents.some((m) => toolsOf(m).includes('app_tools'))) rest.push('app_tools');
  if (canRead && !agents.some(reads)) rest.push('workspace');
  if (rest.length) agents = agents.map((m, i) => (i === 0 ? { ...m, tools: [...toolsOf(m), ...rest] } : m));

  return agents.some((m, i) => m !== members[i]) ? { ...crewDef, agents } : crewDef;
}

/**
 * A definition for an agent the person lets read only: each member's "workspace_write" becomes
 * "workspace". The node would refuse the write for the missing permission, and the task would fail
 * on it.
 */
export function readOnlyTools(crewDef) {
  if (!anyMemberHas(crewDef, ['workspace_write'])) return crewDef;
  return {
    ...crewDef,
    agents: crewDef.agents.map((m) => ({ ...m, tools: [...new Set(toolsOf(m).map((x) => (x === 'workspace_write' ? 'workspace' : x)))] })),
  };
}

/**
 * The permissions a definition's tools ask beyond the reach the person chose. Neither preset
 * carries them, and the page shows the result before the person approves.
 *
 * - Reading a workspace asks organism:read (the node's workspace tools check it since 2026-10-06).
 * - Calling an app tool asks ext:invoke. The tool runs an extension action, and the node calls
 *   that action with the caller's own token (services/capability-invoke.ts), so the agent is the
 *   one POST /v1/ext/:extName/:actionId checks. That route lets a caller without the word through
 *   with a Deprecation header before node 4.0.0 and refuses it from 4.0.0
 *   (auth/rest-scope-gate.ts). Without the word here, an agent that calls its owner's app tool
 *   stops working on the day the node becomes 4.0.0.
 * - Calling an app tool also asks organism:read. An app keeps its data in a workspace, and its
 *   tool's extension reads that workspace AS THE CALLER (`ctx.workspace`, the same check as the
 *   workspace tools), so the agent is the one the read is decided for. Seen on aimeat.io on
 *   2026-10-13: an agent of the "reads only" reach, built on one app tool, had every call
 *   answered "the workspace is not one you can read". The "reads and writes" reach carries the
 *   word already. What a tool WRITES into a workspace still needs that reach: the page cannot
 *   tell a tool that writes from one that reads.
 */
export function extraScopes(crewDef) {
  const callsAppTool = anyMemberHas(crewDef, ['app_tools']);
  return [
    ...(anyMemberHas(crewDef, ['workspace', 'workspace_write']) || recordSpacesOf(crewDef).length > 0 || callsAppTool ? ['organism:read'] : []),
    ...(callsAppTool ? ['ext:invoke'] : []),
  ];
}

/**
 * The name a runtime's menu carries in `features` when it subscribes the spaces a definition names
 * in `record_spaces` and makes a task of each record published there (GET /v1/agents/:name/crew/menu).
 * A runtime that does not name it ignores the field, so the kind is offered only when it is named.
 */
export const RECORDS_FEATURE = 'record_spaces';

/**
 * The name a runtime carries when a `record_spaces` item may say `backfill: true`: the agent then
 * also works on the records that were in the space before it started, ten tasks at a time.
 */
export const BACKFILL_FEATURE = 'record_backfill';

/** The most spaces one definition names; the crew runtime refuses a longer list. */
const RECORD_SPACES_MAX = 20;

/**
 * The text added to the draft prompt for an agent that works when a record is published in a
 * workspace. Empty unless the runtime names the feature and the person has a workspace: the model
 * is then not told about a kind the page could not offer.
 *
 * WHAT THE TASK CARRIES is the crew runtime's own text (crewaimeat, agreed 2026-10-12): it reads
 * the record and creates a task for the agent whose description holds the workspace, the organism,
 * the space, the record's id and the record as published.
 *
 * A TASK WITHOUT A RECORD is real: the node gives a new agent one task when it is approved, and
 * that run is what subscribes the spaces. A definition written for records only would invent a
 * record for it, so the prompt says what the agent does then.
 */
export function recordsBlock(known, features) {
  if (!Array.isArray(features) || !features.includes(RECORDS_FEATURE)) return '';
  if (!(known?.places ?? []).length) return '';
  return '\n\n' + [
    'One more kind of "when" is "records": the agent is given one task each time a record is published in a workspace. Choose it when the sentence says the agent acts on what arrives or is added in one of the workspaces listed above (a new request, a new order, a filled form). Write it as "when": { "kind": "records", "workspace": "the workspace id" }, add "organism": "the organism id" when the list above gives one for that workspace, and set "listen_for" to ["tasks", "records"]. The person chooses on the page which parts of the workspace the agent watches. When the agent is made, the page adds the workspace\'s spaces by name to each task and marks the ones the agent watches, so name no space yourself.',
    'For such a task {{ctx.prompt}} is the record itself: the workspace and its id, the organism id, the part of the workspace, the record\'s id, and the record as it was published.',
    'The agent is also given tasks with no record in them: one when it is made, and any the person writes by hand. Write the first task\'s description so that for a task with no record the agent says in one sentence what it does when a record arrives, and writes nothing.',
  ].join('\n');
}

/**
 * The workspace a draft's "when" names, as { organism_id, workspace_id }, or null. It is one of
 * the person's workspaces, found by its id; an id two of their organisms share counts only with
 * the organism's id beside it. `when` is the model's answer: { kind, workspace, organism }.
 */
export function watchedPlace(when, known) {
  if (when?.kind !== 'records' || typeof when.workspace !== 'string' || !when.workspace) return null;
  const same = (known?.places ?? []).filter((pl) => pl.workspace_id === when.workspace);
  const found = same.length === 1 && (!when.organism || when.organism === same[0].organism_id)
    ? same[0]
    : same.find((pl) => pl.organism_id === when.organism);
  return found ? { organism_id: found.organism_id, workspace_id: found.workspace_id } : null;
}

/**
 * The spaces a definition watches: the whole items of `record_spaces`, when the definition also
 * listens for records. Each is { organism_id, ws, space }, where `space` is the space's namespace,
 * with `backfill: true` when the item asks for the records that are already there.
 */
export function recordSpacesOf(crewDef) {
  const hears = crewDef?.listen_for;
  if (!Array.isArray(hears) || !hears.includes('records') || !Array.isArray(crewDef.record_spaces)) return [];
  const text = (v) => typeof v === 'string' && v.length > 0;
  return crewDef.record_spaces
    .filter((s) => s && typeof s === 'object' && text(s.organism_id) && text(s.ws) && text(s.space))
    .map((s) => ({ organism_id: s.organism_id, ws: s.ws, space: s.space, ...(s.backfill === true ? { backfill: true } : {}) }));
}

/** How a space note opens. A description that already holds it is not given a second one. */
const SPACES_NOTE = 'Spaces of the workspace';
/** The longest description of one space the note carries: its first sentence, cut to this. */
const SPACE_DESCRIPTION_MAX = 120;

/**
 * A definition whose every task names the spaces of the workspace it watches, and says which of
 * them the agent watches.
 *
 * WHY. The model that writes a draft knows the person's workspaces and not the spaces inside
 * them (85 workspaces with their spaces would not fit the prompt), so a draft says "save it in
 * the same workspace" and names no space. Seen on aimeat.io on 2026-10-12: such an agent wrote
 * its three answers into the space it watched, although the workspace had a space for answers.
 * The crew runtime makes no task of an agent's own write, so nothing looped; each such write
 * still starts a worker once, and requests and answers end in one list. The page knows the
 * spaces once the person has chosen the workspace, so it writes them where the agent reads them.
 *
 * `watch` is { workspace_id, workspace_name, spaces, all }: `spaces` the watched namespaces, `all`
 * the workspace's record spaces as { name, namespace, description }. A name and a description are
 * another person's text and go in as one line each; a description gives its first sentence.
 * Returns the same object when there is nothing to add or the note is already there.
 */
export function withSpaceNote(crewDef, watch) {
  const all = Array.isArray(watch?.all) ? watch.all.filter((s) => s && typeof s.name === 'string' && s.name) : [];
  const tasks = Array.isArray(crewDef?.tasks) ? crewDef.tasks : [];
  if (all.length === 0 || tasks.length === 0 || !watch?.workspace_id) return crewDef;
  if (tasks.every((x) => typeof x?.description === 'string' && x.description.includes(SPACES_NOTE))) return crewDef;
  const watched = new Set(Array.isArray(watch.spaces) ? watch.spaces : []);
  const lines = all.map((s) => {
    const what = clipLine(String(s.description ?? '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0], SPACE_DESCRIPTION_MAX);
    const named = what ? `- ${nameLine(s.name)}: ${what}` : `- ${nameLine(s.name)}`;
    return watched.has(s.namespace) ? `${named}${/[.!?…]$/.test(named) ? '' : '.'} You watch this space: its records are your work.` : named;
  });
  const note = [
    `${SPACES_NOTE} "${nameLine(watch.workspace_name || watch.workspace_id)}" (id ${watch.workspace_id}), by name:`,
    ...lines,
    'Write a result into a space you do not watch, and never over the record you were given. Only when no other space fits what you were asked to store, write it as a new record in a space you watch.',
  ].join('\n');
  return {
    ...crewDef,
    tasks: tasks.map((x) => (typeof x?.description === 'string' && !x.description.includes(SPACES_NOTE) ? { ...x, description: `${x.description}\n\n${note}` } : x)),
  };
}

/**
 * A definition that watches what the person chose, and nothing else.
 *
 * `watch` is { organism_id, workspace_id, spaces, backfill }, where `spaces` are namespaces of that
 * workspace's record spaces, and `backfill: true` asks the runtime to work on the records that are
 * already there as well: each item then carries `backfill: true`, which the runtime reads the
 * first time it looks at the space and never again. Without it the key is absent, and the agent
 * works on what is published after it has started.
 * With a watch, the definition names the spaces in `record_spaces` and listens
 * for "tasks" and "records": the runtime refuses the field without both, because a record reaches
 * the agent as a task it creates for itself. Without one (the person chose another "when", or no
 * space), the field and the "records" kind are taken out: a model may have written them, and the
 * runtime refuses "records" with no space named. Returns the same object when nothing changes.
 */
export function withRecordSpaces(crewDef, watch) {
  if (!crewDef || typeof crewDef !== 'object') return crewDef;
  const hears = Array.isArray(crewDef.listen_for) ? crewDef.listen_for : [];
  const spaces = [...new Set((Array.isArray(watch?.spaces) ? watch.spaces : []).map((s) => String(s ?? '').trim()).filter(Boolean))].slice(0, RECORD_SPACES_MAX);
  if (watch?.organism_id && watch?.workspace_id && spaces.length > 0) {
    return {
      ...crewDef,
      listen_for: [...new Set([...hears, 'tasks', 'records'])],
      record_spaces: spaces.map((space) => ({ organism_id: watch.organism_id, ws: watch.workspace_id, space, ...(watch.backfill === true ? { backfill: true } : {}) })),
    };
  }
  if (!('record_spaces' in crewDef) && !hears.includes('records')) return crewDef;
  const rest = Object.fromEntries(Object.entries(crewDef).filter(([key]) => key !== 'record_spaces'));
  const left = hears.filter((x) => x !== 'records');
  return { ...rest, listen_for: left.length ? left : ['tasks'] };
}

/**
 * The name a runtime's menu carries in `features` when a member may have the tool `browser` and
 * the definition names the hostnames it may open in `browser_domains` (crewaimeat, 2026-10-13).
 */
export const BROWSER_FEATURE = 'browser_domains';
const BROWSER_TOOL = 'browser';

/**
 * A hostname the page lets a draft name: lower case, at least two labels, no address, path, port
 * or wildcard, and not a name of the computer itself or of a private network. The node's proposal
 * check (src/services/crew-browser-domains.ts) and the runtime make the full refusals; this is the
 * subset that keeps a draft from being refused for a slip of the model.
 */
const PLAIN_HOST = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const PRIVATE_HOST = /(^localhost$|\.(localhost|local|internal|lan|home\.arpa|intranet|corp)$)/;

/**
 * The text added to the draft prompt for a browser on the agent's computer. Empty unless the
 * runtime names the feature and offers the tool, so a model is not told about a tool the agent
 * could not have.
 */
export function browserBlock(menu, features) {
  if (!Array.isArray(features) || !features.includes(BROWSER_FEATURE)) return '';
  if (!(menu ?? []).some((x) => (x?.id ?? x) === BROWSER_TOOL)) return '';
  return '\n\n' + [
    'A browser: give one agent the tool "browser" only when the person\'s sentence names a web site the agent must open and fill in or read as a person would. Then add to "crew_def", at its top level, "browser_domains": the hostnames of that site and of no other, each written out in lower case, with no address, no path and no wildcard, for example ["example.com", "www.example.com"]. The browser opens those hosts and no other.',
    'The browser never sends a form. It fills the fields and stops at the button that would send it. Say so in "does" and in the offer\'s "ask": the agent fills the form and stops, and the person checks it and sends it.',
    'When the sentence names no web site, give no agent the tool "browser": "web" and "article_fetch" read public pages without one.',
  ].join('\n');
}

/**
 * A definition whose browser use the node will take: a member with the tool `browser` keeps it
 * when the definition names at least one plain hostname, and `browser_domains` is then those
 * hostnames, lower-cased and each once. A definition that names none loses the tool, and a list
 * with no member that has the tool is taken out, because the proposal refuses both. A definition
 * with neither is returned as it came.
 */
export function withBrowserSites(crewDef) {
  if (!crewDef || typeof crewDef !== 'object') return crewDef;
  const agents = Array.isArray(crewDef.agents) ? crewDef.agents : [];
  const hasTool = agents.some((m) => Array.isArray(m?.tools) && m.tools.includes(BROWSER_TOOL));
  if (!hasTool && !('browser_domains' in crewDef)) return crewDef;
  const given = Array.isArray(crewDef.browser_domains) ? crewDef.browser_domains : [];
  const hosts = [...new Set(given.filter((h) => typeof h === 'string').map((h) => h.trim().toLowerCase()))]
    .filter((h) => PLAIN_HOST.test(h) && !PRIVATE_HOST.test(h)).slice(0, 20);
  const rest = Object.fromEntries(Object.entries(crewDef).filter(([key]) => key !== 'browser_domains'));
  if (hasTool && hosts.length > 0) return { ...rest, browser_domains: hosts };
  return {
    ...rest,
    agents: agents.map((m) => (Array.isArray(m?.tools) && m.tools.includes(BROWSER_TOOL)
      ? { ...m, tools: m.tools.filter((x) => x !== BROWSER_TOOL) } : m)),
  };
}

/**
 * Whether an agent that works on a workspace's records goes onto its organism's agent list
 * (`agentGaiis`). `organism` is the organism as GET /v1/organisms/:id answers it.
 *
 * The list means two different things (services/organism-agent-access.ts). In an organism that
 * admits only listed agents it is how a member's agent gets in, and a listed agent acts with its
 * owner's rights: the agent must be on it. In an organism that admits every member's agent (the
 * node leaves `agentAccess` out for it) a listed agent is an organism-level participant, which
 * reaches the organism's shared area and no workspace: the agent must NOT be on it. Measured on
 * aimeat.io on 2026-10-13: an agent the page had listed in such an organism read the meeting note
 * it was woken for, and every record it wrote into that workspace was refused (ACCESS_DENIED);
 * taken off the list, the same agent wrote them.
 *
 * An organism that could not be read counts as "no": a wrong yes stops the agent's work, and a
 * wrong no leaves a refusal whose message names the list and who can add the agent to it.
 */
export function joinsAgentList(organism) {
  return !!organism && typeof organism === 'object' && organism.agentAccess === 'listed';
}

/**
 * The model choice the node stores for a pick on a form: 'profile:<name>' or 'model:<label>' (the
 * values of the picker on the agent's own settings, crew-llm-picker.js), read against the models a
 * computer says it reaches (the `llm` of runtimeMenu()). A model's provider block travels whole, as
 * the computer built it, without the display label: rebuilding it here would be this page deciding
 * what a provider is. Null for no pick, and for a model the list does not have.
 */
export function llmChoiceOf(pick, llm) {
  const value = String(pick || '');
  if (value.startsWith('profile:')) return value.length > 8 ? { kind: 'profile', profile: value.slice(8) } : null;
  if (!value.startsWith('model:')) return null;
  const label = value.slice(6);
  const model = (llm?.models ?? []).find((m) => m?.label === label);
  if (!model) return null;
  const provider = { ...(model.provider && typeof model.provider === 'object' ? model.provider : model) };
  delete provider.label;
  return { kind: 'model', label, provider };
}

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
 *   withNeededTools(crewDef, named, offered) · readOnlyTools(crewDef) · extraScopes(crewDef)
 * @usage
 *   const prompt = base + knownBlock(menu, { apps, places });
 *   const named = namedIn(draft.crewDef, { apps, places });
 * @version-history
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

const toolsOf = (member) => (Array.isArray(member?.tools) ? member.tools : []);
const anyMemberHas = (crewDef, ids) => (Array.isArray(crewDef?.agents) ? crewDef.agents : []).some((m) => toolsOf(m).some((x) => ids.includes(x)));

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
 * The permissions a definition's tools ask beyond the reach the person chose. Reading a workspace
 * asks organism:read (the node's workspace tools check it since 2026-10-06), and the read-only
 * preset does not carry it.
 */
export function extraScopes(crewDef) {
  return anyMemberHas(crewDef, ['workspace', 'workspace_write']) ? ['organism:read'] : [];
}

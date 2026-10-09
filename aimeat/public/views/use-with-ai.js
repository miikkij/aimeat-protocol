/**
 * @file use-with-ai.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Use one app with your AI (/v1/use-with-ai/<owner>/<file>): what a person's own AI
 *   can use on a published app (its app tools and the skills that teach it) and three ways to put
 *   it to work: an AI that connects over MCP, an AI that cannot connect (a prompt that brings the
 *   app's skill into the chat), and a program that calls the REST API. The served app's round
 *   "Use with your AI" mark links here (utils/app-ai-use-badge.ts). Jouni, 2026-10-09: the tools
 *   and skills were findable only by a machine, so nobody knew they were there.
 *
 *   ONE SOURCE. Everything shown comes from the app's public WebMCP listing,
 *   GET /v1/apps/<owner>/<file>/webmcp, which needs no sign-in: the tools with their input fields
 *   and price, and `app_surface` with the app's name and its public bound skills. A skill's text
 *   comes from GET /v1/skills/<name>, which answers a public skill without sign-in. Nothing here is
 *   a second copy of what the node decides.
 *
 *   The page wears the showroom face of the connect story (build-story.css, the ld-sh-* parts);
 *   its own sheet, css/views/use-with-ai.css (uwa- prefix), lays out the lists and nothing more.
 * @structure parseAppPath · exampleInput · prompts · ToolRow · SkillRow · default export UseWithAi
 * @usage routed at /v1/use-with-ai/<owner>/<file> by spa.html; served by routes/portal.ts
 * @version-history
 *   v1.0.0 -- 2026-10-09 -- Initial (wish-ai-skill-and-ai-app-tool-badges-on-a-published-app-with-a-pa).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { showLoginModal, getSession } from '/js/services/auth.js';
import { swallowed } from '/js/swallowed.js';
import { PromptCard } from '/components/PromptCard.js';

const html = htm.bind(h);

// t() echoes the key when a translation is missing: fall back to readable English.
const tr = (key, fallback, vars) => {
  const v = t(key, vars);
  if (v && v !== key) return v;
  let s = fallback;
  for (const [k, val] of Object.entries(vars || {})) s = s.replaceAll(`{${k}}`, String(val));
  return s;
};

/** `/v1/use-with-ai/<owner>/<file>` → { owner, file }, or null. */
export function parseAppPath(pathname) {
  const m = /^\/v1\/use-with-ai\/([^/]+)\/([^/]+)\/?$/.exec(pathname || '');
  if (!m) return null;
  try { return { owner: decodeURIComponent(m[1]), file: decodeURIComponent(m[2]) }; }
  catch (err) { swallowed('use-with-ai: path', err); return null; }
}

/** A tool's required input fields with a placeholder per type, for the curl example. */
export function exampleInput(schema) {
  const props = (schema && schema.properties) || {};
  const required = Array.isArray(schema && schema.required) ? schema.required : Object.keys(props).slice(0, 2);
  const out = {};
  for (const name of required) {
    const type = props[name] && props[name].type;
    out[name] = type === 'number' || type === 'integer' ? 0
      : type === 'boolean' ? false
        : type === 'array' ? []
          : type === 'object' ? {} : '...';
  }
  return out;
}

/** Where a skill's text is read: `user:<owner>/<name>` or `node:<name>`. */
function skillUrl(ref) {
  const user = /^user:([^/]+)\/([^@]+)/.exec(ref || '');
  if (user) return `/v1/skills/${encodeURIComponent(user[2])}?scope=user&owner=${encodeURIComponent(user[1])}`;
  const node = /^node:([^@]+)/.exec(ref || '');
  return node ? `/v1/skills/${encodeURIComponent(node[1])}?scope=node` : null;
}

/** The three ready texts: one for an AI that connects, one for an AI that cannot, one for curl. */
function prompts({ name, owner, file, host, base, skills, tools, skillText }) {
  const mcp = [
    tr('useWithAi.mcpPrompt1', 'Use the app "{name}" by {owner} on {host}.', { name, owner, host }),
    ...skills.map((s) => tr('useWithAi.mcpPromptSkill', 'Load its skill with aimeat_skill_get, ref "{ref}", and follow it.', { ref: s.ref })),
    tools.length
      ? tr('useWithAi.mcpPromptTools', 'Read its tools with aimeat_app_tools_get (owner "{owner}", app_id "{file}"), then call the one that fits with aimeat_app_tool_invoke (owner "{owner}", app "{file}", tool, input).', { owner, file })
      : '',
    tr('useWithAi.mcpPromptAsk', 'Ask me before you call a priced tool.'),
  ].filter(Boolean).join('\n');

  const appUrl = `${base}/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(file)}?mode=inline`;
  const guide = skillText
    ? skillText
    : tools.map((tool) => `- ${tool.name}: ${tool.description || ''}`).join('\n');
  const chat = [
    tr('useWithAi.chatPrompt1', 'I use the app "{name}" at {url}. Below is its guide. Read it, then help me use the app step by step. Tell me what to press and what to type, and check my results when I paste them back.', { name, url: appUrl }),
    '',
    guide,
  ].join('\n');

  const listing = `${base}/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(file)}/webmcp`;
  const first = tools[0];
  const curl = [
    `curl ${listing}`,
    ...(first ? [
      '',
      `curl -X POST ${first.invoke && first.invoke.url} \\`,
      '  -H "Authorization: Bearer $AIMEAT_TOKEN" -H "Content-Type: application/json" \\',
      `  -d '${JSON.stringify(exampleInput(first.inputSchema))}'`,
    ] : []),
  ].join('\n');
  return { mcp, chat, curl };
}

function ToolRow({ tool }) {
  const priced = !!(tool.payment && tool.payment.required);
  return html`
    <li class="uwa-item">
      <span class="uwa-item-head">
        <code class="uwa-item-name">${tool.name}</code>
        <span class=${`poster-chip ${priced ? 'poster-chip--coral' : 'poster-chip--sun'}`}>
          ${priced ? tr('useWithAi.priced', 'priced') : tr('useWithAi.free', 'free')}
        </span>
      </span>
      ${tool.description ? html`<span class="uwa-item-text">${tool.description}</span>` : null}
    </li>`;
}

function SkillRow({ skill, text, onShow, open }) {
  return html`
    <li class="uwa-item">
      <span class="uwa-item-head">
        <code class="uwa-item-name">${skill.name}</code>
        <span class="poster-chip poster-chip--ink">${tr('useWithAi.skillChip', 'skill')}</span>
      </span>
      ${skill.description ? html`<span class="uwa-item-text">${skill.description}</span>` : null}
      <button type="button" class="poster-action poster-action--more" aria-expanded=${open ? 'true' : 'false'} onClick=${onShow}>
        ${open ? tr('useWithAi.hideSkill', 'Hide the skill text') : tr('useWithAi.showSkill', 'Read the skill text')}
      </button>
      ${open ? html`<pre class="poster-box poster-box--copy uwa-skill-text">${text == null ? '…' : text}</pre>` : null}
    </li>`;
}

export default function UseWithAi({ navigate }) {
  const where = parseAppPath(typeof window !== 'undefined' ? window.location.pathname : '');
  const [listing, setListing] = useState(null);
  const [failed, setFailed] = useState(false);
  const [texts, setTexts] = useState({});
  const [open, setOpen] = useState({});
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    try { setSignedIn(!!getSession()); } catch (err) { swallowed('use-with-ai: session', err); }
  }, []);

  useEffect(() => {
    if (!where) { setFailed(true); return; }
    fetch(`/v1/apps/${encodeURIComponent(where.owner)}/${encodeURIComponent(where.file)}/webmcp`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`listing ${r.status}`))))
      .then(setListing)
      .catch((err) => { swallowed('use-with-ai: listing', err); setFailed(true); });
  }, [where && where.owner, where && where.file]); // eslint-disable-line react-hooks/exhaustive-deps

  const skills = (listing && listing.app_surface && listing.app_surface.skills) || [];

  // The first skill's text goes into the chat prompt; any skill's text opens under its row.
  const readSkill = (ref) => {
    const url = skillUrl(ref);
    if (!url || texts[ref] !== undefined) return;
    setTexts((s) => ({ ...s, [ref]: null }));
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`skill ${r.status}`))))
      .then((b) => setTexts((s) => ({ ...s, [ref]: (b && b.data && b.data.skill && b.data.skill.fileContents && b.data.skill.fileContents['SKILL.md']) || '' })))
      .catch((err) => { swallowed('use-with-ai: skill', err); setTexts((s) => ({ ...s, [ref]: '' })); });
  };
  useEffect(() => { if (skills[0]) readSkill(skills[0].ref); }, [skills[0] && skills[0].ref]); // eslint-disable-line react-hooks/exhaustive-deps

  const signIn = (tab) => (e) => {
    e.preventDefault();
    const go = () => navigate('/v1/connect-your-ai');
    if (signedIn) { go(); return; }
    if (!showLoginModal({ tab, onLogin: go })) navigate('/v1/portal');
  };

  if (failed) {
    return html`
      <div class="ld bs uwa">
        <section class="bs-head uwa-head"><div class="bs-head-copy">
          <h1 class="bs-title"><span>${tr('useWithAi.missingTitle', 'Nothing to use here')}</span></h1>
          <p class="bs-lead">${tr('useWithAi.missing', 'This app is not public, or it has no app tools and no skills for an AI yet.')}</p>
          <a class="ld-sh-door showroom-door" href="/v1/appcat">${tr('useWithAi.toCatalog', 'See the public apps →')}</a>
        </div></section>
      </div>`;
  }
  if (!listing) return html`<div class="ld bs uwa"><p class="bs-lead uwa-wait">${tr('useWithAi.loading', 'Reading what this app offers…')}</p></div>`;

  const surface = listing.app_surface || {};
  const owner = where.owner;
  const file = where.file;
  const name = surface.name || file;
  const tools = listing.tools || [];
  const base = window.location.origin;
  const host = window.location.host;
  const p = prompts({ name, owner, file, host, base, skills, tools, skillText: skills[0] ? texts[skills[0].ref] : '' });
  const appUrl = `/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(file)}?mode=inline`;
  const toggle = (ref) => () => { setOpen((o) => ({ ...o, [ref]: !o[ref] })); readSkill(ref); };

  return html`
    <div class="ld bs uwa">
      <section class="bs-head uwa-head">
        <div class="bs-head-copy">
          <span class="ld-sh-kicker">${tr('useWithAi.kicker', 'For your own AI, your agent or your program')}</span>
          <h1 class="bs-title">
            <span>${tr('useWithAi.title1', 'Use {name}', { name })}</span>
            <span>${tr('useWithAi.title2', 'with your AI')}</span>
          </h1>
          <p class="bs-lead">${tools.length && skills.length
            ? tr('useWithAi.leadBoth', "Your AI can call this app's tools, and the app's skills teach your AI how to use it. Below you see what they are and how to connect.")
            : tools.length
              ? tr('useWithAi.leadTools', "Your AI can call this app's tools. Below you see what they are and how to connect.")
              : tr('useWithAi.leadSkills', "The app's skills teach your AI how to use it. Below you see what they are and how to connect.")}</p>
          <a class="ld-sh-door showroom-door" href=${appUrl} target="_blank" rel="noopener">${tr('useWithAi.openApp', 'Open the app →')}</a>
        </div>
      </section>

      <section class="bs-beat uwa-step poster-row--thing" id="uwa-what">
        <div class="bs-beat-copy">
          <h2 class="ld-sh-h2"><span>${tr('useWithAi.whatTitle1', 'What your AI')}</span><span class="ld-sh-accent">${tr('useWithAi.whatTitle2', 'can use here')}</span></h2>
          ${tools.length ? html`
            <h3 class="poster-label poster-label--block">${tr('useWithAi.toolsLabel', 'App tools: your AI calls these')}</h3>
            <ul class="uwa-list">${tools.map((tool) => html`<${ToolRow} key=${tool.name} tool=${tool} />`)}</ul>` : null}
          ${skills.length ? html`
            <h3 class="poster-label poster-label--block">${tr('useWithAi.skillsLabel', 'Skills: your AI reads these first')}</h3>
            <ul class="uwa-list">${skills.map((s) => html`<${SkillRow} key=${s.ref} skill=${s} text=${texts[s.ref]} open=${!!open[s.ref]} onShow=${toggle(s.ref)} />`)}</ul>` : null}
          <div class="ld-sh-box poster-aside">${tr('useWithAi.priceNote', 'A free tool needs only your sign-in. A priced tool runs only after you pay for it.')}</div>
        </div>
      </section>

      <section class="bs-beat uwa-step poster-row--thing" id="uwa-mcp">
        <div class="bs-beat-copy">
          <span class="bs-num">1</span>
          <h2 class="ld-sh-h2"><span>${tr('useWithAi.mcpTitle1', 'Your AI connects:')}</span><span class="ld-sh-accent">${tr('useWithAi.mcpTitle2', 'it does the work')}</span></h2>
          <p class="ld-sh-text">${tr('useWithAi.mcpText', 'Claude, ChatGPT on a paid plan, Claude Code, Cursor, VS Code and Codex connect over MCP. You need an account here: your AI connects to it, and you approve the connection once. Then paste the text below into your chat.')}</p>
          <div class="cs-door-actions">
            ${signedIn
              ? html`<a class="ld-sh-btn showroom-slab ld-sh-btn--hot showroom-slab--hot" href="/v1/connect-your-ai" onClick=${signIn('signin')}>${tr('useWithAi.connect', 'Connect your AI →')}</a>`
              : html`
                <a class="ld-sh-btn showroom-slab ld-sh-btn--hot showroom-slab--hot" href="/v1/portal" onClick=${signIn('register')}>${tr('useWithAi.create', 'Create your account →')}</a>
                <a class="ld-sh-door showroom-door" href="/v1/portal" onClick=${signIn('signin')}>${tr('useWithAi.signIn', 'I already have one, sign me in →')}</a>`}
          </div>
          <${PromptCard} label=${tr('useWithAi.mcpLabel', 'Paste this into your AI after it is connected')} prompt=${p.mcp}
            copyLabel=${tr('useWithAi.copy', 'Copy')} quiet=${true} />
        </div>
      </section>

      <section class="bs-beat uwa-step poster-row--thing" id="uwa-chat">
        <div class="bs-beat-copy">
          <span class="bs-num">2</span>
          <h2 class="ld-sh-h2"><span>${tr('useWithAi.chatTitle1', 'Your AI cannot connect:')}</span><span class="ld-sh-accent">${tr('useWithAi.chatTitle2', 'it guides you')}</span></h2>
          <p class="ld-sh-text">${tr('useWithAi.chatText', 'A chat AI without MCP, such as the free Gemini or Copilot, cannot call the app tools. It can still learn the app from this text and guide you while you use the app yourself. No account is needed for this.')}</p>
          <${PromptCard} label=${tr('useWithAi.chatLabel', 'Paste this into any chat AI')} prompt=${p.chat}
            copyLabel=${tr('useWithAi.copy', 'Copy')} quiet=${true} />
        </div>
      </section>

      <section class="bs-beat uwa-step poster-row--thing" id="uwa-rest">
        <div class="bs-beat-copy">
          <span class="bs-num">3</span>
          <h2 class="ld-sh-h2"><span>${tr('useWithAi.restTitle1', 'Your program:')}</span><span class="ld-sh-accent">${tr('useWithAi.restTitle2', 'plain HTTP calls')}</span></h2>
          <p class="ld-sh-text">${tr('useWithAi.restText', 'Anything that can send an HTTP request can use the app tools. The list of tools needs no sign-in. A call needs a token: make an access token on your Access page after you sign in, or let an agent get its own token through device sign-in.')}</p>
          <${PromptCard} label=${tr('useWithAi.restLabel', 'List the tools, then call one')} prompt=${p.curl}
            copyLabel=${tr('useWithAi.copy', 'Copy')} quiet=${true} />
          <p class="ld-sh-text uwa-links">
            <a class="showroom-door" href="/v1/profile?tab=access">${tr('useWithAi.tokens', 'Access tokens →')}</a>
            <a class="showroom-door" href="/v1/docs">${tr('useWithAi.docs', 'API documentation →')}</a>
          </p>
        </div>
      </section>
    </div>`;
}

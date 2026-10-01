/**
 * @file public/components/SetupGuide.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two surfaces built on the per-tool setup table (GET /v1/ai-tools): SetupGuide (how
 *   to attach this node to a given AI tool) and InstructionsDialog (the instruction block plus, for
 *   the tool the reader actually uses, the exact place to paste it). Both are tool-pickers rather
 *   than one generic set of steps, because the generic version is where people fall off; every tool
 *   carries a link to its vendor's own documentation. The guide draws its own classic look (Jouni's
 *   decision "MCP guide", the option classic): css/components/setup-guide.css (.setup-guide-*), with
 *   the library's parts inside it (Tabs, Action, Facts, the numbered list, the install row).
 *
 *   A page passes named options; it never writes a class:
 *   - `poster`: the tool picker is the library's tab row (the Settings pages and the home), otherwise
 *     the guide's own classic tool buttons (the design lab's specimen).
 *   - `asideInstall`: the one-click install row stands in the attention note's frame (the MCP page).
 *   - `facts`: the field table is the Facts (css/components/facts.css) instead of the classic rows.
 *   - `stepRows`: the steps are the numbered list's rows (IndexList) instead of the classic list.
 *   The tool the reader picks is remembered in this browser (localStorage aimeat.setup.tool).
 * @structure SetupGuide({ poster, asideInstall, facts, stepRows }) · InstructionsDialog({ open, onClose })
 * @usage html`<${SetupGuide} poster facts stepRows />` · html`<${InstructionsDialog} open=${o} onClose=${close} />`
 * @version-history
 *   v1.1.0 — 2026-10-01 — `claudeNote` replaces claude.ai's model line: the home's free road
 *     recommends Opus, which the free plan does not have (Jouni's decision).
 *   v1.0.1 — 2026-09-27 — Draws its own class names (every .ast-* → .setup-guide-*, .ast-tool-reco →
 *     .setup-guide-reco), its sheet css/components/setup-guide.css, moved unchanged out of
 *     hello-mcp.css; .ast-docs and .ast-step-rows go, as no sheet had a rule for them (a move, same
 *     look). The organism field's id is setup-guide-org.
 *   v1.0.0 — 2026-09-26 — Moved out of views/profile/ai-setup-guide.js (McpSetupGuide, v2.6.0, and
 *     InstructionsDialog) with its markup, so the page files write no class: the tool tabs, the copy
 *     doors and the field table are the library's Tabs, Action and Facts, and the class props
 *     (tabClass, activeClass, installClassName) became the named options `poster` and `asideInstall`
 *     (page group G1a). Its history continues here; the older lines are in that file.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Modal } from '/components/Modal.js';
import { Tabs } from '/components/Tabs.js';
import { Action } from '/components/Action.js';
import { Facts } from '/components/Facts.js';
import { McpInstallRow } from '/components/McpInstall.js';
import { IndexList, IndexStep } from '/components/NumberedIndex.js';
import { InstructionBlock } from '/components/InstructionBlock.js';
import { useAiTools } from '/views/profile/ai-tool-setup.js';
import { getOrganismsTab } from '/js/services/organisms.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

const LAST_TOOL_KEY = 'aimeat.setup.tool';
const rememberedTool = () => {
  // eslint-disable-next-line aimeat/no-silent-catch -- blocked storage means "no remembered choice", which is the same answer as an empty slot; the caller falls back to the first tool either way
  try { return localStorage.getItem(LAST_TOOL_KEY) || ''; } catch { return ''; }
};
const rememberTool = (id) => {
  // eslint-disable-next-line aimeat/no-silent-catch -- storage blocked only costs the remembered choice
  try { localStorage.setItem(LAST_TOOL_KEY, id); } catch { /* the choice just does not persist */ }
};

const pickTool = (tools, id) => tools.find(x => x.id === id) || tools[0];

/** The tool's name, with the small "recommended" word after the one a first-timer should take. */
const toolWords = (tool) => html`${tool.label}${tool.recommended
  ? html` <span class="setup-guide-reco">${tr('setup.recommendedBadge', 'recommended')}</span>` : null}`;

function ToolPicker({ tools, value, onPick, poster }) {
  if (poster) {
    return html`<div class="setup-guide-tools">
      <${Tabs} kind="view" value=${value} onSelect=${onPick}
        items=${tools.map(tool => ({ value: tool.id, key: tool.id, label: toolWords(tool) }))} />
    </div>`;
  }
  return html`
    <div class="setup-guide-tools" role="tablist">
      ${tools.map(tool => html`
        <button key=${tool.id} type="button" role="tab" aria-selected=${tool.id === value}
          class=${'setup-guide-tool' + (tool.id === value ? ' setup-guide-tool--active' : '')}
          onClick=${() => onPick(tool.id)}>${toolWords(tool)}</button>`)}
    </div>`;
}

/** One field's value: the text with its copy door, or "leave empty". */
function paramValue(v) {
  return v
    ? html`<code class="setup-guide-code">${v}</code> <${Action} small copy=${v} copiedLabel=${tr('common.copied', 'Copied')}>${tr('common.copy', 'Copy')}<//>`
    : html`<span class="setup-guide-param-empty">${tr('setup.leaveEmpty', 'leave empty')}</span>`;
}

/**
 * The parameter table: every field the tool's form asks for, and what to put in it. With `facts`
 * the pairs are the Facts: the field's name as the row label, the value on the right, its note as
 * the grey line under it.
 */
function Params({ params, facts = false }) {
  if (!params?.length) return null;
  if (facts) {
    return html`
      <div class="setup-guide-params">
        <div class="setup-guide-params-head">${tr('setup.paramsTitle', 'What to put in each field')}</div>
        <${Facts} rows=${params.map((prm, i) => ({ key: i, k: prm.label, v: paramValue(prm.value), sub: prm.note || undefined }))} />
      </div>`;
  }
  return html`
    <div class="setup-guide-params">
      <div class="setup-guide-params-head">${tr('setup.paramsTitle', 'What to put in each field')}</div>
      ${params.map((prm, i) => html`
        <div class="setup-guide-param" key=${i}>
          <div class="setup-guide-param-label">${prm.label}</div>
          <div class="setup-guide-param-value">${paramValue(prm.value)}</div>
          ${prm.note ? html`<div class="setup-guide-param-note">${prm.note}</div>` : null}
        </div>`)}
    </div>`;
}

/**
 * How to attach this node to one AI tool: the steps as things to click or type, every field value,
 * and the vendor's own page.
 * @param {{ poster?: boolean, asideInstall?: boolean, facts?: boolean, stepRows?: boolean,
 *   claudeNote?: string|null }} [props] claudeNote replaces claude.ai's model line, for a road on its free plan.
 */
export function SetupGuide({ poster = false, asideInstall = false, facts = false, stepRows = false, claudeNote = null } = {}) {
  const tools = useAiTools();
  const [toolId, setToolId] = useState(rememberedTool);
  const pick = (id) => { setToolId(id); rememberTool(id); };
  if (!tools) return html`<p class="setup-guide-note">${tr('setup.loadingTools', 'Reading the setup instructions from this node…')}</p>`;
  if (!tools.length) return html`<p class="setup-guide-note">${tr('setup.toolsFailed', 'Could not read the setup instructions just now. The connect page has the same steps.')}</p>`;
  const tool = pickTool(tools, toolId);
  const cmd = tool.mcp.command || null;

  return html`
    <div class="setup-guide">
      <p class="setup-guide-lead">${tr('setup.pickTool', 'Which AI tool are you connecting? The steps differ enough that the general version is not usable.')}</p>
      <${ToolPicker} tools=${tools} value=${tool.id} onPick=${pick} poster=${poster} />

      <!-- The short way in comes first, and removes none of the steps below it: a one-click link is
           blocked on a managed machine and does nothing where the client is not installed. -->
      <${McpInstallRow} tool=${tool} className=${asideInstall ? 'poster-aside' : ''} />

      ${tool.mcp.plans ? html`<p class="setup-guide-plans">${tool.mcp.plans}</p>` : null}
      ${tool.mcp.warn ? html`<p class="setup-guide-warn">${tool.mcp.warn}</p>` : null}

      ${stepRows
        ? html`<${IndexList} steps>${tool.mcp.steps.map((step, i) => html`<${IndexStep} key=${i}>${step}<//>`)}<//>`
        : html`<ol class="setup-guide-steps">
            ${tool.mcp.steps.map((step, i) => html`<li key=${i}>${step}</li>`)}
          </ol>`}

      ${cmd ? html`
        <div class="setup-guide-cmd">
          <pre class="setup-guide-cmd-text">${cmd}</pre>
          <${Action} small copy=${cmd} copiedLabel=${tr('common.copied', 'Copied')}>${tr('setup.copyCmd', 'Copy the command')}<//>
        </div>` : null}

      <${Params} params=${tool.mcp.params} facts=${facts} />

      ${/* The free Claude plan has no Opus, so a road for it says which model it does have. */''}
      ${(claudeNote && tool.id === 'claude-web') ? html`<p class="setup-guide-note">${claudeNote}</p>`
        : tool.mcp.note ? html`<p class="setup-guide-note">${tool.mcp.note}</p>` : null}

      <a class="poster-action poster-action--more" href=${tool.mcp.docs} target="_blank" rel="noopener">
        ${tr('setup.officialDocs', 'Official instructions from')} ${tool.label} →
      </a>
    </div>`;
}

/**
 * The instruction block plus where to paste it. Opened from the profile card, so it answers the
 * two questions that arrive together: what do I paste, and where does it go in MY tool.
 */
export function InstructionsDialog({ open, onClose }) {
  const tools = useAiTools();
  const [toolId, setToolId] = useState(rememberedTool);
  const [orgs, setOrgs] = useState(null);
  const [orgId, setOrgId] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    getOrganismsTab()
      .then(tab => {
        if (cancelled) return;
        const arr = (tab && tab.mine) || [];
        setOrgs(arr);
        setOrgId(prev => prev || (arr[0] ? arr[0].id : ''));
      })
      .catch(err => { swallowed('ai-setup-guide: organisms', err); if (!cancelled) setOrgs([]); });
    return () => { cancelled = true; };
  }, [open]);

  const pick = (id) => { setToolId(id); rememberTool(id); };
  const tool = tools && tools.length ? pickTool(tools, toolId) : null;

  return html`
    <${Modal} open=${open} onClose=${onClose} className="setup-guide-modal"
      title=${tr('setup.instrTitle', 'AI chat instructions')}>
      <p class="setup-guide-lead">${tr('setup.instrLead', 'Paste this into your AI’s instructions and every conversation starts already knowing your structure. You stop re-explaining it, the AI stops guessing where things go, your agents write into the same places so they can build on each other’s work, and the same context stops being re-sent as tokens in every chat.')}</p>

      ${orgs === null ? html`<p class="setup-guide-note">${tr('setup.loadingOrgs', 'Reading your organisms…')}</p>`
        : orgs.length === 0 ? html`<p class="setup-guide-note">${tr('setup.noOrgs', 'You have no organism yet, and the block is generated from one. Create it first: the Hello MCP step on the MCP tab has a ready prompt for it.')}</p>`
        : html`
          ${orgs.length > 1 ? html`
            <label class="setup-guide-label" for="setup-guide-org">${tr('setup.whichOrg', 'Which organism?')}</label>
            <select id="setup-guide-org" class="select-field setup-guide-select" value=${orgId} onChange=${(e) => setOrgId(e.target.value)}>
              ${orgs.map(o => html`<option value=${o.id} key=${o.id}>${o.name || o.id}</option>`)}
            </select>` : null}
          <${InstructionBlock} orgId=${orgId} />`}

      ${tool ? html`
        <div class="setup-guide-where">
          <div class="setup-guide-where-head">${tr('setup.whereTitle', 'Where it goes in your tool')}</div>
          <${ToolPicker} tools=${tools} value=${tool.id} onPick=${pick} poster />
          <p class="setup-guide-where-path">${tool.instructions.where}</p>
          ${tool.instructions.docs ? html`
            <a class="poster-action poster-action--more" href=${tool.instructions.docs} target="_blank" rel="noopener">
              ${tr('setup.officialDocs', 'Official instructions from')} ${tool.label} →
            </a>` : null}
        </div>` : null}
    <//>`;
}

export default SetupGuide;

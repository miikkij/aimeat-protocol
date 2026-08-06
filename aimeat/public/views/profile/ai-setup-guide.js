/**
 * @file ai-setup-guide.js
 * @description The two surfaces built on the per-tool setup table: McpSetupGuide (how to attach
 *   this node to a given AI tool) and InstructionsDialog (the instruction block plus, for the
 *   tool the reader actually uses, the exact place to paste it).
 *
 *   Both are tool-pickers rather than one generic set of steps, because the generic version is
 *   where people fall off: "add a custom connector" is not actionable if your tool calls it
 *   something else or keeps it behind a switch you have not turned on. Every tool carries a link
 *   to its vendor's own documentation, so a reader who does not believe the steps can check them
 *   rather than take our word.
 * @structure McpSetupGuide() · InstructionsDialog({ open, onClose })
 * @usage import { McpSetupGuide, InstructionsDialog } from '/views/profile/ai-setup-guide.js';
 * @version-history
 *   v2.0.0 — 2026-07-31 — Table fetched from GET /v1/ai-tools instead of an in-SPA copy, so
 *     the Experience Center reads the same one.
 *   v1.0.0 — 2026-07-31 — Initial.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t, getLocale } from '/js/i18n.js';
import { Modal } from '/components/Modal.js';
import { CopyButton } from '/components/CopyButton.js';
import { fetchAiTools } from '/views/profile/ai-tool-setup.js';
import { InstructionBlock } from '/views/profile/instruction-block.js';
import { getOrganismsTab } from '/js/services/organisms.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

const LAST_TOOL_KEY = 'aimeat.setup.tool';
const rememberedTool = () => {
  // eslint-disable-next-line aimeat/no-silent-catch -- blocked storage means "no remembered choice", which is the same answer as an empty slot; the caller falls back to the first tool either way
  try { return localStorage.getItem(LAST_TOOL_KEY) || ''; } catch { return ''; }
};

/**
 * The table, fetched once per language and shared by both surfaces. A module-level promise rather
 * than per-component state: the dialog and the Hello MCP panel can be on screen together, and the
 * table is the same answer for both.
 */
const cache = new Map();
function loadTools(lang) {
  if (!cache.has(lang)) cache.set(lang, fetchAiTools(lang).catch((err) => { swallowed('ai-setup-guide: tools', err); return []; }));
  return cache.get(lang);
}

/** Everything below renders nothing until the table arrives; there is no local copy to fall back to. */
function useTools() {
  const [tools, setTools] = useState(null);
  const [lang, setLang] = useState(getLocale());
  useEffect(() => {
    const onLang = () => setLang(getLocale());
    window.addEventListener('lang-change', onLang);
    return () => window.removeEventListener('lang-change', onLang);
  }, []);
  useEffect(() => {
    let cancelled = false;
    loadTools(lang).then(list => { if (!cancelled) setTools(list); });
    return () => { cancelled = true; };
  }, [lang]);
  return tools;
}

const pickTool = (tools, id) => tools.find(x => x.id === id) || tools[0];

function ToolPicker({ tools, value, onPick }) {
  return html`
    <div class="ast-tools" role="tablist">
      ${tools.map(tool => html`
        <button key=${tool.id} type="button" role="tab" aria-selected=${tool.id === value}
          class=${'ast-tool' + (tool.id === value ? ' ast-tool--active' : '')}
          onClick=${() => onPick(tool.id)}>${tool.label}${tool.recommended
            ? html` <span class="ast-tool-reco">${tr('setup.recommendedBadge', 'recommended')}</span>` : null}</button>`)}
    </div>`;
}

/** The parameter table: every field the tool's form asks for, and what to put in it. */
function Params({ params }) {
  if (!params?.length) return null;
  return html`
    <div class="ast-params">
      <div class="ast-params-head">${tr('setup.paramsTitle', 'What to put in each field')}</div>
      ${params.map((prm, i) => {
        const v = prm.value;
        return html`
          <div class="ast-param" key=${i}>
            <div class="ast-param-label">${prm.label}</div>
            <div class="ast-param-value">
              ${v
                ? html`<code class="ast-code">${v}</code><${CopyButton} text=${v} className="btn-ghost btn-sm"
                    label=${tr('setup.copy', 'Copy')} copiedLabel=${tr('setup.copied', 'Copied')} />`
                : html`<span class="ast-param-empty">${tr('setup.leaveEmpty', 'leave empty')}</span>`}
            </div>
            ${prm.note ? html`<div class="ast-param-note">${prm.note}</div>` : null}
          </div>`;
      })}
    </div>`;
}

/**
 * How to attach this node to one AI tool: the steps as things to click or type, every field value,
 * and the vendor's own page.
 */
export function McpSetupGuide() {
  const tools = useTools();
  const [toolId, setToolId] = useState(rememberedTool);
  const pick = (id) => {
    setToolId(id);
    // eslint-disable-next-line aimeat/no-silent-catch -- storage blocked only costs the remembered choice
    try { localStorage.setItem(LAST_TOOL_KEY, id); } catch { /* the choice just does not persist */ }
  };
  if (!tools) return html`<p class="ast-note">${tr('setup.loadingTools', 'Reading the setup instructions from this node…')}</p>`;
  if (!tools.length) return html`<p class="ast-note">${tr('setup.toolsFailed', 'Could not read the setup instructions just now. The connect page has the same steps.')}</p>`;
  const tool = pickTool(tools, toolId);
  const cmd = tool.mcp.command || null;

  return html`
    <div class="ast">
      <p class="ast-lead">${tr('setup.pickTool', 'Which AI tool are you connecting? The steps differ enough that the general version is not usable.')}</p>
      <${ToolPicker} tools=${tools} value=${tool.id} onPick=${pick} />

      ${tool.mcp.plans ? html`<p class="ast-plans">${tool.mcp.plans}</p>` : null}
      ${tool.mcp.warn ? html`<p class="ast-warn">${tool.mcp.warn}</p>` : null}

      <ol class="ast-steps">
        ${tool.mcp.steps.map((step, i) => html`<li key=${i}>${step}</li>`)}
      </ol>

      ${cmd ? html`
        <div class="ast-cmd">
          <pre class="ast-cmd-text">${cmd}</pre>
          <${CopyButton} text=${cmd} className="btn-primary btn-sm"
            label=${tr('setup.copyCmd', 'Copy the command')} copiedLabel=${tr('setup.copied', 'Copied')} />
        </div>` : null}

      <${Params} params=${tool.mcp.params} />

      ${tool.mcp.note ? html`<p class="ast-note">${tool.mcp.note}</p>` : null}

      <a class="ast-docs" href=${tool.mcp.docs} target="_blank" rel="noopener">
        ${tr('setup.officialDocs', 'Official instructions from')} ${tool.label} →
      </a>
    </div>`;
}

/**
 * The instruction block plus where to paste it. Opened from the profile card, so it answers the
 * two questions that arrive together: what do I paste, and where does it go in MY tool.
 */
export function InstructionsDialog({ open, onClose }) {
  const tools = useTools();
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

  const pick = (id) => {
    setToolId(id);
    // eslint-disable-next-line aimeat/no-silent-catch -- storage blocked only costs the remembered choice
    try { localStorage.setItem(LAST_TOOL_KEY, id); } catch { /* the choice just does not persist */ }
  };
  const tool = tools && tools.length ? pickTool(tools, toolId) : null;

  return html`
    <${Modal} open=${open} onClose=${onClose} className="ast-modal"
      title=${tr('setup.instrTitle', 'AI chat instructions')}>
      <p class="ast-lead">${tr('setup.instrLead', 'Paste this into your AI’s instructions and every conversation starts already knowing your structure. You stop re-explaining it, the AI stops guessing where things go, your agents write into the same places so they can build on each other’s work, and the same context stops being re-sent as tokens in every chat.')}</p>

      ${orgs === null ? html`<p class="ast-note">${tr('setup.loadingOrgs', 'Reading your organisms…')}</p>`
        : orgs.length === 0 ? html`<p class="ast-note">${tr('setup.noOrgs', 'You have no organism yet, and the block is generated from one. Create it first: the Hello MCP step on the MCP tab has a ready prompt for it.')}</p>`
        : html`
          ${orgs.length > 1 ? html`
            <label class="ast-label" for="ast-org">${tr('setup.whichOrg', 'Which organism?')}</label>
            <select id="ast-org" class="input-field ast-select" value=${orgId} onChange=${(e) => setOrgId(e.target.value)}>
              ${orgs.map(o => html`<option value=${o.id} key=${o.id}>${o.name || o.id}</option>`)}
            </select>` : null}
          <${InstructionBlock} orgId=${orgId} />`}

      ${tool ? html`
        <div class="ast-where">
          <div class="ast-where-head">${tr('setup.whereTitle', 'Where it goes in your tool')}</div>
          <${ToolPicker} tools=${tools} value=${tool.id} onPick=${pick} />
          <p class="ast-where-path">${tool.instructions.where}</p>
          ${tool.instructions.docs ? html`
            <a class="ast-docs" href=${tool.instructions.docs} target="_blank" rel="noopener">
              ${tr('setup.officialDocs', 'Official instructions from')} ${tool.label} →
            </a>` : null}
        </div>` : null}
    <//>`;
}

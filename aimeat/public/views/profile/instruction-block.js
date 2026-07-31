/**
 * @file instruction-block.js
 * @description The copyable instruction block for one organism, in the three formats people
 *   actually paste into: CLAUDE.md, AGENTS.md, and the AI chat's own instructions field. Each
 *   format says where it goes, because "copy this" without "put it here" is where these die.
 *
 *   The block is GENERATED from the organism's real structure on the server (its id, its actual
 *   workspaces and their spaces), never from a template. That is the difference between an AI
 *   that knows where things live and one that asks or guesses.
 *
 *   Reused by the Hello MCP panel (step 5 of onboarding) and by the button on every organism, so
 *   the wording and the generation path cannot diverge between the two.
 * @structure InstructionBlock({ orgId }) — format tabs + block + copy + placement line
 * @usage import { InstructionBlock } from '/views/profile/instruction-block.js';
 * @version-history
 *   v1.0.0 — 2026-07-31 — Initial.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t, getLocale } from '/js/i18n.js';
import { CopyButton } from '/components/CopyButton.js';
import { fetchInstructionBlock } from '/js/services/hello-mcp.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

const FORMATS = [
  { id: 'chat_instructions', labelKey: 'instrBlock.fmt.chat', labelFallback: 'AI chat instructions', place: 'chatInstructions' },
  { id: 'claude_md', labelKey: 'instrBlock.fmt.claude', labelFallback: 'CLAUDE.md', place: 'claudeMd' },
  { id: 'agents_md', labelKey: 'instrBlock.fmt.agents', labelFallback: 'AGENTS.md', place: 'agentsMd' },
];

/** @param {{ orgId: string }} props */
export function InstructionBlock({ orgId }) {
  const [data, setData] = useState(null);
  const [fmt, setFmt] = useState('chat_instructions');
  const [failed, setFailed] = useState(false);

  // The block is generated server-side in the caller's language, so a language switch has to
  // refetch it. Without this, switching the portal to English left a Finnish block on screen and
  // the placement lines around it in English.
  const [lang, setLang] = useState(getLocale());
  useEffect(() => {
    const onLang = () => setLang(getLocale());
    window.addEventListener('lang-change', onLang);
    return () => window.removeEventListener('lang-change', onLang);
  }, []);

  useEffect(() => {
    if (!orgId) { setData(null); return undefined; }
    let cancelled = false;
    setData(null); setFailed(false);
    fetchInstructionBlock(orgId)
      .then(d => { if (!cancelled) setData(d); })
      .catch(err => { swallowed('instruction-block: fetch', err); if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [orgId, lang]);

  if (failed) return html`<p class="ib-note">${tr('instrBlock.failed', 'Could not read this organism’s structure just now. Try again shortly.')}</p>`;
  if (!data) return html`<p class="ib-note">${tr('instrBlock.loading', 'Reading the structure…')}</p>`;

  const text = (data.blocks && data.blocks[fmt]) || '';
  const active = FORMATS.find(f => f.id === fmt) || FORMATS[0];
  const placement = (data.placement && data.placement[active.place]) || '';

  return html`
    <div class="ib">
      <div class="ib-tabs">
        ${FORMATS.map(f => html`
          <button key=${f.id} type="button"
            class=${'ib-tab' + (f.id === fmt ? ' ib-tab--active' : '')}
            onClick=${() => setFmt(f.id)}>${tr(f.labelKey, f.labelFallback)}</button>`)}
      </div>
      <p class="ib-place">${placement}</p>
      <pre class="ib-block">${text}</pre>
      <div class="ib-actions">
        <${CopyButton} text=${text} className="btn-primary"
          label=${tr('instrBlock.copy', 'Copy the block')}
          copiedLabel=${tr('instrBlock.copied', 'Copied')} />
        <span class="ib-meta">${tr('instrBlock.from', 'Generated from')} ${data.organism_name || data.organism_id}${
          Array.isArray(data.workspaces) && data.workspaces.length
            ? `, ${data.workspaces.length} ${tr('instrBlock.workspaces', 'workspaces')}` : ''}</span>
      </div>
    </div>`;
}

export default InstructionBlock;

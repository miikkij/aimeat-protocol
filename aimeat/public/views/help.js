/**
 * @file help.js
 * @description Help page — fetches the AI help prompt from /v1/help/prompt
 *   and displays it in a copyable text area so users can paste it to their AI chat.
 * @structure
 *   - HelpView — main Preact component (title, description, prompt area, copy button)
 * @usage import HelpView from '/views/help.js'
 * @version-history
 *   v1.0.0 — 2026-03-23 — Initial implementation
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { useViewCSS } from '/components/useViewCSS.js';

const html = htm.bind(h);

export default function HelpView() {
  useViewCSS('/css/views/help.css');

  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch('/v1/help/prompt')
      .then(r => {
        if (!r.ok) throw new Error(r.statusText);
        return r.text();
      })
      .then(text => { setPrompt(text); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const ta = document.createElement('textarea');
      ta.value = prompt;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return html`
    <div class="hlp-container">
      <div class="hlp-card">
        <h1 class="hlp-title">${t('help.title')}</h1>
        <p class="hlp-desc">${t('help.description')}</p>

        <div class="hlp-prompt-wrapper">
          ${loading && html`<div class="hlp-loading"><div class="spinner"></div></div>`}
          ${error && html`<p class="hlp-error">${t('help.loadError')}</p>`}
          ${!loading && !error && html`
            <pre class="hlp-prompt-text"><code>${prompt}</code></pre>
          `}
        </div>

        ${!loading && !error && html`
          <button class="${copied ? 'hlp-copy-btn hlp-copied' : 'hlp-copy-btn'}" onClick=${handleCopy}>
            ${copied ? t('help.copied') : t('help.copyBtn')}
          </button>
        `}
      </div>
    </div>
  `;
}

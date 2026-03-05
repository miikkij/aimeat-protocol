import { h } from 'preact';
import { useState, useCallback } from 'preact/hooks';
import htm from 'htm';
import { copyToClipboard } from '/js/utils.js';
const html = htm.bind(h);

/**
 * CopyButton — button with visual feedback after copying.
 * @param {{ text: string, label?: string, className?: string }} props
 */
export function CopyButton({ text, label = 'Copy', className = '' }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return html`
    <button class="btn-ghost ${className}" onClick=${handleCopy}>
      ${copied ? '✓ Copied' : label}
    </button>`;
}

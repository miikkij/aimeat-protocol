/**
 * @file CopyButton.js
 * @description Canonical clipboard button — copies `text` and shows a brief
 *   "copied" confirmation. Replaces the ~80 hand-rolled clipboard sites; the
 *   actual copy is delegated to /js/utils.js copyToClipboard.
 * @structure CopyButton({ text, label?, copiedLabel?, className?, title?, onCopied? })
 * @usage import { CopyButton } from '/components/CopyButton.js';
 *   html`<${CopyButton} text=${value} />`
 *   html`<${CopyButton} text=${value} label=${t('x.copyUrl')} onCopied=${() => showToast('Copied')} />`
 * @version-history
 *   v1.0.0 — 2026-03 — Initial copy button with copied-state feedback
 *   v1.1.0 — 2026-06-02 — i18n the labels (default t('common.copy') / t('common.copied')),
 *     add onCopied hook (for sites that also toast), title, and type="button" — for
 *     the #1 CopyButton adoption sweep.
 */
import { h } from 'preact';
import { useState, useCallback } from 'preact/hooks';
import htm from 'htm';
import { copyToClipboard } from '/js/utils.js';
import { t } from '/js/i18n.js';
const html = htm.bind(h);

/**
 * CopyButton — button with visual feedback after copying.
 * @param {{ text: string, label?: string, copiedLabel?: string, className?: string,
 *   title?: string, onCopied?: () => void }} props
 *   - label / copiedLabel default to i18n t('common.copy') / t('common.copied')
 *   - onCopied: optional callback after a successful copy (e.g. to also show a toast)
 */
export function CopyButton({ text, label, copiedLabel, className = '', title, onCopied }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await copyToClipboard(text);
    setCopied(true);
    if (onCopied) onCopied();
    setTimeout(() => setCopied(false), 2000);
  }, [text, onCopied]);

  return html`
    <button class="btn-ghost ${className}" type="button" title=${title} onClick=${handleCopy}>
      ${copied ? (copiedLabel || t('common.copied')) : (label || t('common.copy'))}
    </button>`;
}

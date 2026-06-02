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
 *     add onCopied hook (for sites that also toast), copiedLabel, title, type="button",
 *     and a `copied` class in the confirmed state (so bespoke classes like
 *     .dv-copy-btn.copied / .copy-btn.copied can style it) — for the #1 sweep.
 *   v1.1.1 — 2026-06-02 — Compute the button class as a single interpolated string
 *     (className-or-base + optional `copied` modifier) — cleaner than two attribute
 *     holes and avoids a trailing space. Browser-verified: copied→"…btn-sm copied",
 *     default→"btn-ghost". (A stale cached build had briefly masked the copied class
 *     during testing — htm itself handles multi-hole class attributes fine.)
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

  // Class as a single computed string: className replaces the btn-ghost base
  // (so callers can pass btn-primary/btn-outline/etc.), plus the `copied` modifier
  // when confirmed (bespoke styles like .hlp-copy-btn.copied hook onto it).
  const cls = `${className || 'btn-ghost'}${copied ? ' copied' : ''}`;

  return html`
    <button class=${cls} type="button" title=${title} onClick=${handleCopy}>
      ${copied ? (copiedLabel || t('common.copied')) : (label || t('common.copy'))}
    </button>`;
}

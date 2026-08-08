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
 *   v1.2.0 — 2026-08-08 — `disabled` prop, for the one-control sweep. The landing page's
 *     build-prompt button must stay dead until the prompt has loaded from the node
 *     (`disabled=${!prompt}`); without the prop that caller had to keep its own <button>
 *     and its own clipboard handler, which is exactly what the sweep removes. Nothing
 *     else needs it, so it defaults to false and adds no markup when unused.
 *   v1.3.0 — 2026-08-08 — `ariaLabel` + `copiedTitle`, for the same sweep. An ICON-ONLY copy
 *     control (the inbox message bubble's ⧉) has no readable text child, so its accessible
 *     name has to come from an aria-label, and its tooltip is the only place the copied state
 *     can be announced — the label itself is a glyph. Without these two props that button
 *     could not become a CopyButton without losing screen-reader meaning.
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
 *   title?: string, copiedTitle?: string, ariaLabel?: string, onCopied?: () => void,
 *   disabled?: boolean }} props
 *   - label / copiedLabel default to i18n t('common.copy') / t('common.copied')
 *   - onCopied: optional callback after a successful copy (e.g. to also show a toast)
 *   - disabled: for callers whose `text` is not ready yet (async-loaded prompts)
 *   - ariaLabel / copiedTitle: for icon-only buttons, whose glyph label carries no meaning
 */
export function CopyButton({ text, label, copiedLabel, className = '', title, copiedTitle,
  ariaLabel, onCopied, disabled = false }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await copyToClipboard(text);
    setCopied(true);
    if (onCopied) onCopied();
    setTimeout(() => setCopied(false), 2000);
  }, [text, onCopied]);

  // Class as a single computed string: className replaces the btn-ghost base
  // (so callers can pass btn-primary/btn-outline/etc.), plus the `copied` modifier
  // when confirmed — theme.css styles .btn-primary.copied / .btn-outline.copied /
  // .btn-ghost.copied, so the confirmation comes with the shared button, not per view.
  const cls = `${className || 'btn-ghost'}${copied ? ' copied' : ''}`;

  return html`
    <button class=${cls} type="button" title=${(copied && copiedTitle) || title}
      aria-label=${ariaLabel} disabled=${disabled} onClick=${handleCopy}>
      ${copied ? (copiedLabel || t('common.copied')) : (label || t('common.copy'))}
    </button>`;
}

/**
 * @file index.js
 * @description Barrel re-export for the canonical design-system primitives in
 *   /components. Prefer importing shared primitives from here (e.g.
 *   `import { Modal, ConfirmDialog, Markdown } from '/components/index.js'`)
 *   over deep-importing the individual component files.
 * @version-history
 *   v1.4.0 — 2026-06-02 — Component unification (#17): export Pagination + LoadMore
 *     (canonical prev/page/next control and centered load-more button).
 *   v1.3.0 — 2026-06-02 — Component unification (#16): export TagList — the
 *     canonical tag/chip row (with `+N` overflow) consolidating the per-view
 *     bespoke tag CSS clones.
 *   v1.2.0 — 2026-06-02 — Component unification (#11): export StatusDot — the
 *     canonical status-indicator dot consolidating the per-view bespoke dots.
 *   v1.1.0 — 2026-06-02 — Component unification (#28): export ConfirmDialog
 *     (from Modal.js) and Markdown + sanitizeHref (from Markdown.js), which
 *     were previously reachable only via deep import.
 */
export { Alert } from './Alert.js';
export { useToast } from './Toast.js';
export { Spinner } from './Spinner.js';
export { EmptyState } from './EmptyState.js';
export { ToggleSwitch } from './ToggleSwitch.js';
export { Modal, ConfirmDialog, useConfirm } from './Modal.js';
export { CopyButton } from './CopyButton.js';
export { FormField } from './FormField.js';
export { Card } from './Card.js';
export { StatusDot } from './StatusDot.js';
export { TagList } from './TagList.js';
export { Pagination, LoadMore } from './Pagination.js';
export { Markdown, sanitizeHref } from './Markdown.js';
export { useViewCSS } from './useViewCSS.js';

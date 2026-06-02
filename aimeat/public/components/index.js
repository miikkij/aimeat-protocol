/**
 * @file index.js
 * @description Barrel re-export for the canonical design-system primitives in
 *   /components. Prefer importing shared primitives from here (e.g.
 *   `import { Modal, ConfirmDialog, Markdown } from '/components/index.js'`)
 *   over deep-importing the individual component files.
 * @version-history
 *   v1.1.0 — 2026-06-02 — Component unification (#28): export ConfirmDialog
 *     (from Modal.js) and Markdown + sanitizeHref (from Markdown.js), which
 *     were previously reachable only via deep import.
 */
export { Alert } from './Alert.js';
export { useToast } from './Toast.js';
export { Spinner } from './Spinner.js';
export { Modal, ConfirmDialog, useConfirm } from './Modal.js';
export { CopyButton } from './CopyButton.js';
export { FormField } from './FormField.js';
export { Card } from './Card.js';
export { Markdown, sanitizeHref } from './Markdown.js';
export { useViewCSS } from './useViewCSS.js';

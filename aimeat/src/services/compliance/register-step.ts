/**
 * @file src/services/compliance/register-step.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The publish answer's `register` step: an app whose data map says it keeps personal
 *   data, and that has no register for it, is told the three calls that write one, at the moment the
 *   builder reads the answer (appdev pitfall data/personal-data-app-needs-register-and-privacy-notice).
 *   Until now the gap app-personal-data-without-register appeared only on the compliance pages, and
 *   the App Catalog told every reader of the app that it had no privacy notice.
 *
 *   The same reading as the gap (scope-gaps.ts appGaps): a register draft from the map, and no
 *   personal or pseudonymised register stored for the app. Best-effort: a read that fails answers
 *   null and is logged, because a publish that already happened must not fail on its advice.
 * @structure registerStep(deps, ownerName, app) → string | null
 * @usage const register = await registerStep({ storage, config }, ownerName, filename);
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (pitfall round A8).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { readDoc } from './docs.js';
import { appRegisterDraft } from './derived.js';
import { logger } from '../../utils/logger.js';

type Deps = { storage: Storage; config: AimeatConfig };

export async function registerStep(deps: Deps, ownerName: string, app: string): Promise<string | null> {
  try {
    const draft = await appRegisterDraft(deps.storage, `${ownerName}@${deps.config.nodeId}`, app);
    if (!draft.register) return null;
    const regs = await readDoc(deps.storage, deps.config.nodeId, 'registers', { kind: 'app', ownerName, app });
    if (regs.items.some(r => r.type === 'personal' || r.type === 'pseudonymised')) return null;
    const scope = `scope: "app", app: "${app}"`;
    return `The data map says this app keeps personal data, and it has no register (record of processing) yet. `
      + `1. aimeat_compliance_register_read { part: "registers_draft", ${scope} } drafts one from the map; nothing is stored. `
      + '2. Ask the owner what only they know: the purpose, the legal basis and how long the data is kept. Do not guess them. '
      + `3. aimeat_compliance_register_write { part: "registers", ${scope}, value: { items: [ … ] }, dry_run: true }, show it, then write it without dry_run. `
      + 'Give the app a privacy notice of its own, with the same retention as the map\'s keptFor. '
      + `aimeat_compliance_register_read { part: "gaps", ${scope} } then lists no app-personal-data-without-register. Not blocking.`;
  } catch (err) {
    logger.warn('compliance: the register step could not be read', { ownerName, app, error: String(err) });
    return null;
  }
}

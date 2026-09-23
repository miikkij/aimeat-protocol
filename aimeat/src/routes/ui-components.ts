/**
 * @file src/routes/ui-components.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The component catalogue of this node's own interface, over HTTP: each part's data
 *   shape, when to use it, its variants, one example data set, the theme tokens it reads and the
 *   pages that draw it. Public and read-only, because it describes code this node ships to every
 *   browser anyway; no account and no data of anybody's is involved.
 *
 *   The same service answers aimeat_ui_component_list and aimeat_ui_component_get, so the three
 *   doors say the same thing.
 * @structure uiComponentsRouter(config) — GET /v1/ui/components, GET /v1/ui/components/:id
 * @usage app.use(uiComponentsRouter(config));
 * @version-history
 *   v1.0.0 — 2026-09-23 — Initial (UI consolidation phase 1).
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import { success, error } from '../middleware/envelope.js';
import {
    getUiComponent, listUiComponents, UI_COMPONENT_KINDS, UI_COMPONENT_STATUSES,
} from '../services/ui-library/catalogue.js';
import type { UiEntryKind, UiEntryStatus } from '../services/ui-library/types.js';

export function uiComponentsRouter(config: AimeatConfig): Router {
    const router = Router();

    // GET /v1/ui/components — the catalogue, one row per part (public, read-only)
    router.get('/v1/ui/components', (req, res) => {
        const kind = typeof req.query.kind === 'string' ? req.query.kind : undefined;
        const status = typeof req.query.status === 'string' ? req.query.status : undefined;
        const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : undefined;
        if (kind && !UI_COMPONENT_KINDS.includes(kind as UiEntryKind)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `kind is one of: ${UI_COMPONENT_KINDS.join(', ')}.`));
            return;
        }
        if (status && !UI_COMPONENT_STATUSES.includes(status as UiEntryStatus)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `status is one of: ${UI_COMPONENT_STATUSES.join(', ')}.`));
            return;
        }
        const components = listUiComponents({ kind: kind as UiEntryKind | undefined, status: status as UiEntryStatus | undefined, q });
        res.json(success(config.nodeId, { components, total: components.length }));
    });

    // GET /v1/ui/components/:id — one part, whole (public, read-only)
    router.get('/v1/ui/components/:id', (req, res) => {
        const entry = getUiComponent(String(req.params.id));
        if (!entry) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `This node's interface has no part called "${String(req.params.id).slice(0, 80)}".`));
            return;
        }
        res.json(success(config.nodeId, entry));
    });

    return router;
}

/**
 * @file src/server-bootstrap/routes-loader-data.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The routers of the data package contract: publishing and reading packages, the data
 *   products that build them, and the OData feed. Moved out of routes-loader.ts by extraction
 *   (max-file-lines) when the data product routes joined; the one call there stands where the mounts
 *   stood, so what matches first is unchanged.
 * @structure mountDataRouters(app, config, storage)
 * @version-history
 *   v1.0.0 — 2026-11-01 — The data package and OData mounts moved from routes-loader.ts with their
 *     comments; dataProductsRouter mounted beside them (plan doc-mvwxcas3dom3, D9).
 */
import type express from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { dataPackagesRouter } from '../routes/datapackages.js';
import { dataProductsRouter } from '../routes/dataproducts.js';
import { odataRouter } from '../routes/odata.js';

export function mountDataRouters(app: express.Express, config: AimeatConfig, storage: Storage): void {
  // Data packages: the publish/validate/read door onto services/datapackage/. The CANONICAL
  // address of a package is the /v1/pub storage URL these routes hand back; this is where a
  // producer writes one and where "the newest version" gets resolved.
  app.use(dataPackagesRouter(config, storage));
  // Data products: the definitions that build a package version from records, app data, memory,
  // an extension, a file or another package (services/dataproduct/).
  app.use(dataProductsRouter(config, storage));
  // The OData v4 feed for a package. A core route because an extension cannot serve one: the
  // extension surface is POST-only behind auth, the sandbox never sees the query string, and the
  // answer is envelope-wrapped — OData needs GET, query options, XML metadata and a bare body.
  app.use(odataRouter(config, storage));
}

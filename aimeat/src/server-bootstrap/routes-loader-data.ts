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
 *   v1.4.0 — 2026-11-07 — receiveRouter and receiversRouter: receivers (services/receivers/).
 *   v1.3.0 — 2026-11-01 — dspRouter and dataspaceRouter: the Dataspace Protocol provider (plan D8).
 *   v1.2.0 — 2026-11-01 — exchangePartyBuyRouter: a buyer with no account buys a data package (plan D5.4).
 *   v1.1.0 — 2026-11-01 — partiesRouter: outside parties and named shares (plan doc-mvwxcas3dom3, D2, D3).
 *   v1.0.0 — 2026-11-01 — The data package and OData mounts moved from routes-loader.ts with their
 *     comments; dataProductsRouter mounted beside them (plan doc-mvwxcas3dom3, D9).
 */
import type express from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { dataPackagesRouter } from '../routes/datapackages.js';
import { dataProductsRouter } from '../routes/dataproducts.js';
import { odataRouter } from '../routes/odata.js';
import { partiesRouter } from '../routes/parties.js';
import { receiveRouter } from '../routes/receivers-receive.js';
import { receiversRouter } from '../routes/receivers.js';
import { exchangePartyBuyRouter } from '../routes/exchange-party-buy.js';
import { dspRouter } from '../routes/dsp/index.js';
import { dataspaceRouter } from '../routes/dataspace.js';

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
  // Outside parties and named shares: the owner's management, the party's own endpoints and token,
  // and the operator's stop (services/parties/).
  app.use(partiesRouter(config, storage));
  // A buyer with no account buys a data package on EXCHANGE and becomes an outside party (D5.4).
  app.use(exchangePartyBuyRouter(config, storage));
  // The Eclipse Dataspace Protocol provider (plan D8): the DSP endpoints a connector calls, which
  // answer 404 while AIMEAT_DATASPACE_ENABLED is off, and the owner's and the operator's reads.
  app.use(dspRouter(config, storage));
  app.use(dataspaceRouter(config, storage));
  // Receivers: the address and key an outside program writes into one place of an owner's data with
  // (/v1/receive), and the owner's and the operator's management (/v1/receivers, /v1/admin/receivers).
  app.use(receiveRouter(config, storage));
  app.use(receiversRouter(config, storage));
}

# Dataspace Protocol JSON Schemas (test fixtures)

The `*-schema.json` files under `catalog/`, `common/`, `negotiation/` and `transfer/` are copied
unchanged from the Eclipse Dataspace Protocol specification repository,
https://github.com/eclipse-dataspace-protocol-base/DataspaceProtocol, directory
`artifacts/src/main/resources/`, branch `main`, read on 2026-11-01 (spec release 2025-1, wire
namespace `https://w3id.org/dspace/2025/1/`).

Copyright (c) the Eclipse Dataspace Protocol contributors. Licensed under the Apache License,
Version 2.0; the licence text is `LICENSE` in this directory.

They are used only by `test/e2e-dsp.ts` and `test/unit/dataspace-*.test.ts` to validate the bodies
this node sends against the normative schemas. They are not served by the node and not part of the
published package.

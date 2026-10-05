/**
 * @file sdk-datapackage.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The registry entry of aimeat-datapackage.js (rows published as a versioned
 *   Frictionless Data Package). Its own file because library-packs/sdk.ts crossed the 800-line
 *   ceiling when aimeat-validate joined; a pure extraction, spread back in at the same place.
 * @structure DATAPACKAGE_PACKS
 * @usage Spread into SDK_PACKS by library-packs/sdk.ts.
 * @version-history
 *   v1.0.0 - 2026-10-05 - Moved out of library-packs/sdk.ts unchanged.
 */
import type { LibraryPack } from './types.js';

export const DATAPACKAGE_PACKS: LibraryPack[] = [
  {
    id: 'aimeat-datapackage',
    kind: 'sdk',
    category: 'core',
    title: 'Data packages',
    description: 'Publish a table as a Frictionless Data Package with AIMEAT provenance: schema inference, a row-and-column quality gate, an immutable content-hash version, and a permanent public CSV address that DuckDB, pandas and Excel read directly.',
    url: '/v1/libs/aimeat-datapackage.js',
    include: ['<script src="{{BASE_URL}}/v1/libs/aimeat-datapackage.js"></script>'],
    requires: ['aimeat-auth'],
    license: 'MIT',
    apiSurface: 'AIMEAT.datapackage',
    aiDoc: [
      'Turn rows into a PUBLISHED, versioned, machine-readable dataset. The library is a thin client:',
      'inference, validation, canonical CSV and the content hash all happen on the server, so a package',
      'built by an app, an extension and an agent is byte-identical. Do not write your own CSV or hash.',
      '',
      'THE SHAPE OF A PUBLISH:',
      "  const pkg = AIMEAT.datapackage.create({ name: 'laake-weekly', title: 'Medicines, weekly' });",
      "  pkg.addResource('rows', rows);                       // schema INFERRED unless you declare one",
      '  const check = await pkg.validate();                  // { ok, issues, schemas } — nothing stored',
      "  pkg.changes('Added the sentiment column');            // REQUIRED, see below",
      "  pkg.provenance({ sources: [{ url, title }], license: 'CC-BY-4.0', legalBasis: 'public register' });",
      '  const out = await pkg.publish();                     // { packageId, contentHash, descriptorUrl }',
      '',
      'FOUR THINGS THAT WILL SURPRISE YOU IF YOU SKIP THIS:',
      '1. `changes` IS REQUIRED and publish() refuses without it. Every version says what moved and why;',
      '   a version nobody explained is one a consumer cannot decide about.',
      '2. publish() THROWS when the quality gate refuses, with err.code === "QUALITY_GATE" and',
      '   err.issues = [{ resource, row, field, message }]. NOTHING was written and the package still',
      '   stands on its previous version. Render the coordinates — that is the point of validating.',
      '3. `unchanged: true` in the answer means these exact bytes were already published. No new version',
      '   was created. Say "no change", never "updated": a deterministic producer proving it is',
      '   deterministic is not an update.',
      '4. INFERENCE IS A PROPOSAL. Omitting `schema` records `schemaSource: "inferred"` in the',
      '   descriptor. Call inferSchema(rows), show the types to the person publishing, let them fix one,',
      '   and pass the corrected schema to addResource() — then it is "declared" and means something.',
      '',
      'READING ONE BACK: open("pkg:owner/name") for the newest, "pkg:owner/name@sha256:…" to pin a',
      'version that can never change under you. rows(ref, resource, { offset, limit, select }) is a',
      'window for a preview table. The Table Schema in the descriptor names every column and its type,',
      'so a consumer never has to be told the columns.',
      '',
      'ONE MEASURED GOTCHA WHEN YOU HAND THE CSV URL ON: a bare pandas.read_csv(url) re-sniffs the',
      "types and reads a zero-padded identifier like '001000' back as the number 1000, losing the",
      'padding and the join key. DuckDB keeps the same bytes as VARCHAR, so the two readers disagree.',
      'The Table Schema is the authority: pass dtype={col: "str"} for every string field, or use',
      'frictionless.Package(descriptorUrl), which reads the schema and needs no hint.',
      '',
      'THE ADDRESS IS THE PRODUCT, NOT THIS LIBRARY. Every answer carries descriptorUrl, and',
      'urlFor(opened, resource) gives the resource CSV URL. Both are permanent, need no session, and',
      'answer byte ranges. That URL is what you give to DuckDB (SELECT * FROM read_csv(\'…\')), pandas,',
      "Google Sheets IMPORTDATA, or a person. Do not build a download button that re-fetches rows",
      'through the API and re-serialises them — hand over the URL.',
      '',
      'exportAs(ref, resource, "csv") returns that permanent URL; "json" derives a blob in the browser.',
      'There is no XLSX: this node vendors no spreadsheet writer, and a CSV named .xlsx would be a lie.',
      '',
      'FOR EXCEL AND POWER BI, hand over the OData feed instead of a file — they connect natively and',
      'then refresh themselves, which a downloaded CSV never does:',
      '  /v1/odata/{owner}/{package}          service document (paste THIS into the connector)',
      '  /v1/odata/{owner}/{package}/$metadata   CSDL, projected from the same Table Schema',
      '  /v1/odata/{owner}/{package}/{resource}  $select $top $skip $filter $orderby $count',
      'Add ?version=sha256:… to pin a feed that can never change under the reader.',
    ].join('\n'),
    changelog: [
      { version: '1.0.0', date: '2026-08-15', summary: 'Initial: create/addResource/validate/publish plus open/rows/urlFor/exportAs, over /v1/datapackages.' },
    ],
    tierHint: 'T1',
    interviewTriggers: ['dataset', 'data package', 'csv', 'export', 'publish data', 'open data', 'datapaketti', 'avoin data', 'vie exceliin'],
    sizeEstimate: '~5KB',
    status: 'preview',
    modelTier: 'needs-doc',
    proofs: [],
    promptGroup: 'core',
    promptLine: '- aimeat-datapackage.js — publish rows as a versioned Frictionless Data Package with a permanent public CSV address (`AIMEAT.datapackage.create().addResource().publish()`). Quality gate reports row+column; `changes` is required. Requires aimeat-auth.',
  },
];

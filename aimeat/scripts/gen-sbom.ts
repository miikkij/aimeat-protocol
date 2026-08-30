/**
 * @file gen-sbom.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Writes a CycloneDX 1.6 software bill of materials for AIMEAT. This is the artefact
 *   a company's security or procurement team asks for before an internal deployment, and the one
 *   their scanner reads: name, version, licence and package URL for every component that ships.
 *
 *   WHY NOT AN OFF-THE-SHELF GENERATOR. The usual tools walk the npm tree and stop there, which
 *   would describe about two thirds of what this node actually serves. Twenty-four browser
 *   libraries live under public/lib/ as committed files with no package.json above them — DuckDB,
 *   Phaser, p5, PDF.js, the fonts — and Apache Arrow is not even a file of its own, it is bundled
 *   inside the DuckDB loader. A scanner that reads only the lockfile reports none of them, and the
 *   answer "our SBOM is clean" would be true and useless. Both halves come from
 *   scripts/lib/license-inventory.ts.
 *
 *   The GPL ffmpeg build is in the document too, marked `aimeat:distribution =
 *   operator-installed`, because a reviewer needs to see it and see why it is not ours to ship.
 * @structure componentOf() → one CycloneDX component; hashesFor() → the pinned sha256 of a fetched
 *   asset; main() → assemble, write, summarise
 * @usage
 *   pnpm sbom                       # writes sbom.cdx.json at the repo root
 *   pnpm sbom -- --out /tmp/x.json  # somewhere else
 * @version-history
 *   v1.0.0 — 2026-08-31 — Initial: npm production tree + the served browser libraries, CycloneDX 1.6.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AIMEAT_ROOT, LIB_DIR, REPO_ROOT, npmComponents, vendoredComponents, type Component,
} from './lib/license-inventory.js';

interface CycloneLicence { license?: { id: string }; expression?: string }
interface CycloneComponent {
  type: string;
  'bom-ref': string;
  name: string;
  version: string;
  purl?: string;
  licenses?: CycloneLicence[];
  externalReferences?: Array<{ type: string; url: string }>;
  hashes?: Array<{ alg: string; content: string }>;
  properties?: Array<{ name: string; value: string }>;
  description?: string;
}

/** A compound SPDX expression is an `expression`; a plain id is an `id`. Scanners read both. */
function licencesOf(spdx: string): CycloneLicence[] {
  if (/[()]|\bOR\b|\bAND\b/.test(spdx)) return [{ expression: spdx }];
  return [{ license: { id: spdx } }];
}

function purlOf(c: Component): string {
  if (c.purl) return c.purl;
  const version = c.version.split(',')[0].trim();
  if (c.origin === 'npm') return `pkg:npm/${c.name.replace('@', '%40')}@${version}`;
  return `pkg:generic/${c.id}@${encodeURIComponent(version)}`;
}

/**
 * externalReferences.url must be a URI, so a source offer written as a sentence ("the build
 * scripts at X and the sources at Y") cannot go there whole. Take the URLs it names; the sentence
 * itself is already in THIRD-PARTY-NOTICES.md, where a person rather than a scanner reads it.
 */
function urlsIn(text: string): string[] {
  return text.match(/https?:\/\/[^\s)]+/g) ?? [];
}

interface VendoredAsset { path: string; sha256?: string; distribute?: boolean }

/** The pinned sha256 of every fetched file this component owns, so a reviewer can verify bytes. */
function hashesFor(c: Component, assets: VendoredAsset[]): Array<{ alg: string; content: string; path: string }> {
  if (c.origin !== 'vendored') return [];
  const mine = assets.filter(a => (c.files ?? []).some(f => {
    const path = a.path.replace(/^lib\//, '');
    return f.endsWith('/**') ? path.startsWith(f.slice(0, -2)) : path === f;
  }));
  return mine
    .filter(a => a.sha256)
    .map(a => ({ alg: 'SHA-256', content: a.sha256 as string, path: a.path.replace(/^lib\//, '') }));
}

function componentOf(c: Component, assets: VendoredAsset[]): CycloneComponent {
  const refs: Array<{ type: string; url: string }> = [];
  if (c.homepage) refs.push({ type: 'website', url: c.homepage });
  for (const url of urlsIn(c.sourceOffer ?? '')) refs.push({ type: 'distribution', url });

  const properties = [
    { name: 'aimeat:origin', value: c.origin === 'npm' ? 'npm-dependency' : 'served-browser-library' },
    {
      name: 'aimeat:distribution',
      value: c.fetched === true ? 'operator-installed' : 'shipped-by-aimeat',
    },
  ];
  if (c.modified) properties.push({ name: 'aimeat:modified', value: 'true' });

  // A component made of several pinned files has several hashes, and `hashes` describes the
  // component as one artefact. One file, one hash there; more than one, they go in properties
  // where each is named by the file it belongs to.
  const hashes = hashesFor(c, assets);
  for (const h of hashes.length > 1 ? hashes : []) {
    properties.push({ name: `aimeat:sha256:${h.path}`, value: h.content });
  }

  return {
    type: 'library',
    'bom-ref': `${c.origin}:${c.id}@${c.version}`,
    name: c.name,
    version: c.version,
    purl: purlOf(c),
    licenses: licencesOf(c.spdx),
    ...(refs.length > 0 ? { externalReferences: refs } : {}),
    ...(hashes.length === 1 ? { hashes: [{ alg: hashes[0].alg, content: hashes[0].content }] } : {}),
    properties,
    ...(c.note ? { description: c.note } : {}),
  };
}

function outPath(): string {
  const at = process.argv.indexOf('--out');
  if (at !== -1 && process.argv[at + 1]) return process.argv[at + 1];
  return join(REPO_ROOT, 'sbom.cdx.json');
}

function main(): void {
  const pkg = JSON.parse(readFileSync(join(AIMEAT_ROOT, 'package.json'), 'utf-8')) as
    { name: string; version: string; description: string; license: string };
  const assets = (JSON.parse(readFileSync(join(LIB_DIR, 'vendored-assets.json'), 'utf-8')) as
    { assets?: VendoredAsset[] }).assets ?? [];

  const served = vendoredComponents().filter(c => c.id !== 'aimeat');
  const npm = npmComponents();
  const components = [...npm, ...served].map(c => componentOf(c, assets));

  const bom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: { components: [{ type: 'application', name: 'aimeat gen-sbom', version: pkg.version }] },
      component: {
        type: 'application',
        'bom-ref': `aimeat@${pkg.version}`,
        name: pkg.name,
        version: pkg.version,
        description: pkg.description,
        purl: `pkg:npm/${pkg.name}@${pkg.version}`,
        licenses: licencesOf(pkg.license),
        externalReferences: [
          { type: 'website', url: 'https://aimeat.io' },
          { type: 'vcs', url: 'https://github.com/miikkij/aimeat-protocol' },
        ],
      },
    },
    components,
  };

  const file = outPath();
  writeFileSync(file, JSON.stringify(bom, null, 2) + '\n', 'utf-8');
  const operatorInstalled = components.filter(
    c => c.properties?.some(p => p.name === 'aimeat:distribution' && p.value === 'operator-installed'),
  ).length;
  console.log(`✓ ${file}`);
  console.log(`  ${components.length} components: ${npm.length} npm dependencies, ${served.length} served browser libraries.`);
  console.log(`  ${operatorInstalled} marked operator-installed (AIMEAT does not distribute them).`);
}

main();

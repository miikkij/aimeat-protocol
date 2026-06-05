/**
 * @file gen-postgres-schema.mjs
 * @description Deterministically derives `prisma/schema.postgres.prisma` (the
 *   PostgreSQL relational schema) from the canonical MongoDB `prisma/schema.prisma`.
 *   The two schemas share identical models/fields; only the id strategy and the
 *   generator/datasource blocks differ. Run this whenever schema.prisma changes
 *   so the PostgreSQL backend stays in lockstep.
 * @structure Reads schema.prisma, swaps the generator+datasource header, applies
 *   three global token transforms, asserts no Mongo-isms remain, writes the output.
 * @usage node scripts/gen-postgres-schema.mjs   (from the aimeat/ directory)
 * @version-history
 *   v1.0.0 — 2026-06-05 — Initial generator for the PostgreSQL backend.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(root, 'prisma', 'schema.prisma');
const OUT = resolve(root, 'prisma', 'schema.postgres.prisma');

const HEADER = `// AIMEAT — PostgreSQL Prisma schema (GENERATED — do not edit by hand).
// Source of truth: prisma/schema.prisma (MongoDB). Regenerate with:
//   node scripts/gen-postgres-schema.mjs
// MIRROR NOTE: models & fields are identical to schema.prisma; only the id
// strategy (cuid() vs ObjectId) and the generator/datasource blocks differ.

generator client {
  provider = "prisma-client-js"
  output   = "../src/generated/prisma-postgres"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
`;

let src = readFileSync(SRC, 'utf8');

// 1) Drop the original leading comments + generator + datasource blocks; keep from
//    the first `model `/`enum ` declaration onward, then prepend the new header.
const bodyStart = src.search(/^\s*(model|enum|type) /m);
if (bodyStart < 0) throw new Error('Could not locate first model in schema.prisma');
let body = src.slice(bodyStart);

// 2) Global id/type transforms (safe — verified that @map("_id") and @db.ObjectId
//    only ever appear on @id fields, and @default(auto()) only on the 50 PK ids):
body = body
  .replace(/\s*@map\("_id"\)/g, '')        // drop the Mongo _id column mapping
  .replace(/\s*@db\.ObjectId/g, '')        // PostgreSQL has no ObjectId type
  .replace(/@default\(auto\(\)\)/g, '@default(cuid())'); // PK ids → cuid()

const out = HEADER + '\n' + body.replace(/\s*$/, '') + '\n';

// 3) Invariants — fail loudly if any Mongo-ism leaked through.
for (const [label, re] of [
  ['@map("_id")', /@map\("_id"\)/],
  ['@db.ObjectId', /@db\.ObjectId/],
  ['@default(auto())', /@default\(auto\(\)\)/],
  ['provider = "mongodb"', /provider\s*=\s*"mongodb"/],
]) {
  if (re.test(out)) throw new Error(`Transform left a Mongo-ism in the output: ${label}`);
}

writeFileSync(OUT, out);
const models = (out.match(/^model /gm) || []).length;
console.log(`Wrote ${OUT} (${models} models, ${out.split('\n').length} lines).`);

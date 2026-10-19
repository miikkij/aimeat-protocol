#!/usr/bin/env node
/**
 * @file windows-validate.cjs
 * @description Local addition, not upstream. Runs the upstream findings and coverage-ledger
 *   validators on Windows, where Node exposes no O_NOFOLLOW or O_NONBLOCK and the upstream CLI
 *   therefore refuses to open any file. The validation logic is the upstream module's own
 *   (`validateDocument`, `preflightJsonText`); only the file read differs: lstat refuses a
 *   symlink, a non-regular file and a file over the upstream byte limit, then the file is read
 *   once and its size checked again.
 * @usage
 *   node windows-validate.cjs findings <path-to-findings.json>
 *   node windows-validate.cjs ledger <path-to-coverage-ledger.json>
 * @version-history
 *   v1.0.0 2026-10-20 Initial (session cc-jouni-secaudit-oct).
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const findingsMod = require("./validate-findings.cjs");
const ledgerMod = require("./validate-coverage-ledger.cjs");

function readRegularFile(file, maxBytes) {
  const st = fs.lstatSync(file);
  if (st.isSymbolicLink()) throw new Error("input is a symbolic link");
  if (!st.isFile()) throw new Error("input is not a regular file");
  if (st.size > maxBytes) throw new Error(`input is ${st.size} bytes, over the ${maxBytes} byte limit`);
  const buf = fs.readFileSync(file);
  if (buf.length !== st.size) throw new Error("input changed while it was read");
  return new TextDecoder("utf-8", { fatal: true }).decode(buf);
}

function main(kind, file) {
  if (!["findings", "ledger"].includes(kind) || !file) {
    console.error("Usage: node windows-validate.cjs findings|ledger <path>");
    return 1;
  }
  const mod = kind === "findings" ? findingsMod : ledgerMod;
  const maxBytes = mod.LIMITS.inputBytes ?? mod.LIMITS.fileBytes ?? 16 * 1024 * 1024;
  let text;
  try {
    text = readRegularFile(file, maxBytes);
  } catch (error) {
    console.error(`Failed to read ${kind}: ${error.message}`);
    return 1;
  }
  try {
    ledgerMod.preflightJsonText(text);
  } catch (error) {
    console.error(`Failed to parse ${kind}: ${error.message}`);
    return 1;
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    console.error(`Failed to parse ${kind}: invalid JSON syntax`);
    return 1;
  }
  const errors = kind === "findings"
    ? findingsMod.validateDocument(data, JSON.parse(fs.readFileSync(path.join(__dirname, "report-schema.json"), "utf8")))
    : ledgerMod.validateDocument(data);
  const list = Array.from(errors);
  if (list.length > 0) {
    console.error(`${kind} validation failed (${list.length}):`);
    for (const e of list) console.error(`  - ${e}`);
    return 1;
  }
  console.log(`${kind} valid: ${path.basename(file)}`);
  return 0;
}

process.exit(main(process.argv[2], process.argv[3]));

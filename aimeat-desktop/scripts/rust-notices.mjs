/**
 * @file rust-notices.mjs
 * @description Generates Desktop licence notices from the locked Cargo dependency graph.
 * @version-history v1.0.0 - 2026-11-09 - Include the Rust libraries shipped by Desktop.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, posix, relative, resolve } from 'node:path';

const preferred = ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'BSD-2-Clause', 'ISC', '0BSD', 'MIT-0',
  'Unlicense', 'CC0-1.0', 'BSL-1.0', 'Zlib', 'Unicode-3.0', 'MPL-2.0', 'CDLA-Permissive-2.0',
  'Apache-2.0 WITH LLVM-exception'];
const score = names => names.reduce((sum, name) => sum + (preferred.includes(name) ? preferred.indexOf(name) : 10000), 0);
// SPDX's published standard texts, pinned to a reviewed immutable revision. These supplement
// a crate's explicit SPDX declaration only when its package/upstream omitted the full terms.
const SPDX_REVISION = '31846481de7ea17d92f2f46fad76abe58b2e9bb0';

/** Resolve SPDX alternatives without dropping AND obligations. Legacy Cargo '/' means OR. */
export function selectLicense(expression, available = null) {
  const normalized = String(expression ?? '').replaceAll('/', ' OR ');
  const tokens = normalized.match(/[()]|[A-Za-z0-9.+-]+/g) ?? [];
  if (tokens.join('') !== normalized.replaceAll(/\s/g, '')) throw new Error(`Unsupported licence: ${expression}`);
  let position = 0;
  const rank = names => score(names) + (available ? names.filter(name => !available(name)).length * 100 : 0);
  const atom = () => {
    if (tokens[position] === '(') {
      position++;
      const values = alternative();
      if (tokens[position++] !== ')') throw new Error(`Unsupported licence: ${expression}`);
      return values;
    }
    let name = tokens[position++];
    if (!name || ['AND', 'OR', 'WITH', ')'].includes(name)) throw new Error(`Unsupported licence: ${expression}`);
    if (tokens[position] === 'WITH') { position++; name += ` WITH ${tokens[position++]}`; }
    return [name];
  };
  const together = () => {
    let names = atom();
    while (tokens[position] === 'AND') { position++; names = [...names, ...atom()]; }
    return [...new Set(names)];
  };
  const alternative = () => {
    let names = together();
    while (tokens[position] === 'OR') {
      position++;
      const other = together();
      if (rank(other) < rank(names)) names = other;
    }
    return names;
  };
  const selected = alternative();
  if (position !== tokens.length || selected.some(name => !preferred.includes(name))) {
    throw new Error(`Unsupported licence: ${expression}`);
  }
  return selected;
}

function hasLicense(text, id) {
  text = text.replaceAll(/\s+/g, ' ');
  switch (id) {
    case 'MIT': return /Permission is hereby granted, free of charge/i.test(text);
    case 'Apache-2.0': return /Apache License/i.test(text) && /Version 2\.0/i.test(text);
    case 'Apache-2.0 WITH LLVM-exception': return hasLicense(text, 'Apache-2.0') && /LLVM Exceptions/i.test(text);
    case 'BSD-3-Clause': return /Redistribution and use in source and binary forms/i.test(text) && /Neither the name|names of (?:its|their) contributors/i.test(text);
    case 'BSD-2-Clause': return /Redistribution and use in source and binary forms/i.test(text);
    case 'ISC': return /Permission to use, copy, modify, and(?:\/or)? distribute/i.test(text);
    case '0BSD': return /Permission to use, copy, modify, and(?:\/or)? distribute/i.test(text);
    case 'MIT-0': return /MIT No Attribution|Permission is hereby granted, free of charge/i.test(text);
    case 'Unlicense': return /unencumbered software released into the public domain/i.test(text);
    case 'CC0-1.0': return /Creative Commons|CC0 1\.0/i.test(text);
    case 'BSL-1.0': return /Boost Software License/i.test(text);
    case 'Zlib': return /provided ['"]as-is['"]|zlib License/i.test(text);
    case 'Unicode-3.0': return /UNICODE LICENSE V3/i.test(text);
    case 'MPL-2.0': return /Mozilla Public License/i.test(text) && /2\.0/.test(text);
    case 'CDLA-Permissive-2.0': return /Community Data License Agreement[\s\S]{0,100}Permissive/i.test(text);
    default: return false;
  }
}

export function readCrateLicenseTexts(pkg) {
  const root = dirname(pkg.manifest_path);
  const files = [];
  const walk = (directory, prefix = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const relative = prefix + entry.name;
      if (entry.isDirectory() && /^licen[sc]es?$/i.test(entry.name)) walk(join(directory, entry.name), `${relative}/`);
      else if (entry.isFile() && (prefix || /^(licen[sc]e|copying|copyright|notice|unlicense)([-_.].*)?$/i.test(entry.name))) {
        const text = readFileSync(join(root, relative), 'utf8');
        if (text.includes('\0')) throw new Error(`${pkg.name}: licence file is not text: ${relative}`);
        files.push({ name: relative, text, source: `crate archive: ${relative}` });
      }
    }
  };
  walk(root);
  if (pkg.license_file) {
    const path = resolve(root, pkg.license_file);
    const inside = relative(root, path);
    if (inside === '..' || inside.startsWith('../') || inside.startsWith('..\\') || isAbsolute(inside)) {
      throw new Error(`${pkg.name}: licence file is outside its published crate`);
    }
    const name = inside.replaceAll('\\', '/');
    if (existsSync(path) && !files.some(file => file.name === name)) {
      if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error(`${pkg.name}: licence file is not a regular file`);
      files.push({ name, text: readFileSync(path, 'utf8'), source: `crate archive: ${name}` });
    }
  }
  return files;
}

const genericNames = ['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'COPYING', 'COPYRIGHT'];
function candidates(id) {
  const names = id.startsWith('Apache-2.0')
    ? ['LICENSE-APACHE', 'LICENSE_APACHE-2.0', 'LICENSE_APACHE', 'LICENSE-APACHE.txt', 'license-apache-2.0']
    : id === 'MIT' ? ['LICENSE-MIT', 'LICENSE_MIT', 'LICENSE-MIT.txt', 'license-mit']
      : [`LICENSE-${id}`, `LICENSE-${id}.txt`];
  return [...names, ...genericNames, `LICENSES/${id}.txt`, `LICENSES/${id}`];
}

/** Some published workspace members omit their repository-root licence files. Retrieve only
 * the immutable commit recorded inside that exact crate, and cache bytes by the pinned URL. */
async function upstreamTexts(pkg, selected, found, cacheDirectory) {
  const vcsPath = join(dirname(pkg.manifest_path), '.cargo_vcs_info.json');
  if (!existsSync(vcsPath)) return found;
  const vcs = JSON.parse(readFileSync(vcsPath, 'utf8'));
  const commit = vcs.git?.sha1;
  let repository;
  try { repository = new URL(pkg.repository); } catch { return found; }
  const match = /^\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/.*)?\/?$/.exec(repository.pathname);
  if (repository.protocol !== 'https:' || repository.hostname !== 'github.com' || !match || !/^[a-f0-9]{40}$/.test(commit ?? '')) return found;
  const directories = [''];
  let inRepo = vcs.path_in_vcs ?? '';
  if (inRepo.split('/').some(part => part === '..') || inRepo.startsWith('/')) throw new Error(`${pkg.name}: invalid upstream crate path`);
  while (inRepo && inRepo !== '.') { directories.push(inRepo); inRepo = posix.dirname(inRepo); }
  const load = async (directory, name) => {
    const relative = directory ? `${directory}/${name}` : name;
    const url = `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${commit}/${relative}`;
    const cache = join(cacheDirectory, createHash('sha256').update(url).digest('hex'));
    if (existsSync(cache)) return { name: relative, text: readFileSync(cache, 'utf8'), source: url };
    if (existsSync(`${cache}.missing`)) return null;
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: 'error' });
    if (response.status === 404) {
      mkdirSync(cacheDirectory, { recursive: true });
      writeFileSync(`${cache}.missing`, '404\n', 'utf8');
      return null;
    }
    if (!response.ok) throw new Error(`${pkg.name}: upstream licence request failed (${response.status}): ${url}`);
    const text = await response.text();
    if (text.length > 256 * 1024 || text.includes('\0')) throw new Error(`${pkg.name}: invalid upstream licence text: ${url}`);
    mkdirSync(cacheDirectory, { recursive: true });
    writeFileSync(cache, text, 'utf8');
    return { name: relative, text, source: url };
  };
  for (const id of selected) {
    if (found.some(file => hasLicense(file.text, id))) continue;
    outer: for (const directory of directories) {
      for (const name of candidates(id)) {
        const file = await load(directory, name);
        if (file && hasLicense(file.text, id)) { found.push(file); break outer; }
        if (file && /licen[sc]e|copyright|copying/i.test(name) && !found.some(existing => existing.text === file.text)) {
          found.push({ ...file, supplemental: true });
        }
      }
    }
  }
  // Retain supplemental upstream notices when the published crate omitted its licence texts.
  for (const name of ['NOTICE', 'NOTICE.txt']) {
    const file = await load('', name);
    if (file && !found.some(existing => existing.text === file.text)) found.push(file);
  }
  return found;
}

async function standardTerms(id, cacheDirectory) {
  const names = id === 'Apache-2.0 WITH LLVM-exception' ? ['Apache-2.0', 'LLVM-exception'] : [id];
  const sources = [];
  const texts = [];
  for (const name of names) {
    const url = `https://raw.githubusercontent.com/spdx/license-list-data/${SPDX_REVISION}/text/${name}.txt`;
    const cache = join(cacheDirectory, createHash('sha256').update(url).digest('hex'));
    let text;
    if (existsSync(cache)) text = readFileSync(cache, 'utf8');
    else {
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: 'error' });
      if (!response.ok) throw new Error(`Missing canonical SPDX terms for ${id}: HTTP ${response.status}`);
      text = await response.text();
      if (text.length > 256 * 1024 || text.includes('\0')) throw new Error(`Invalid canonical SPDX terms for ${id}`);
      mkdirSync(cacheDirectory, { recursive: true });
      writeFileSync(cache, text, 'utf8');
    }
    sources.push(url); texts.push(text);
  }
  return { name: `SPDX-${id}`, text: texts.join('\n\n'), source: `Standard terms referenced by the crate's SPDX declaration: ${sources.join(', ')}` };
}

export async function renderRustNotices(packages, loadTexts) {
  const locked = packages.filter(pkg => pkg.source?.startsWith('registry+')).sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
  const sections = new Array(locked.length);
  const errors = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(6, locked.length) }, async () => {
    while (next < locked.length) {
      const at = next++;
      const pkg = locked[at];
      try {
      const texts = await loadTexts(pkg, selectLicense(pkg.license));
      const selected = selectLicense(pkg.license, id => texts.some(file => hasLicense(file.text, id)));
      const missing = selected.filter(id => !texts.some(file => hasLicense(file.text, id)));
      if (missing.length) throw new Error(`${pkg.name} ${pkg.version}: missing full licence text for ${missing.join(' AND ')}. Cannot stage incomplete Rust notices.`);
      const included = texts.filter(file => selected.some(id => hasLicense(file.text, id)) || file.supplemental || /(?:^|\/)(?:NOTICE|COPYRIGHT)(?:[.-]|$)/i.test(file.name));
      const unique = [...new Map(included.map(file => [file.text.replaceAll('\r\n', '\n').trim(), file])).values()];
      const source = `https://crates.io/api/v1/crates/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}/download`;
      sections[at] = `## ${pkg.name} ${pkg.version}\n\nDeclared licence: ${pkg.license}\n\nSelected licence: ${selected.join(' AND ')}\n\nPublished crate authors: ${(pkg.authors ?? []).join(', ') || 'Not specified by the package'}\n\nUnmodified source archive: ${source}\n\n`
        + unique.map(file => `Licence text source: ${file.source}\n\n~~~~text\n${file.text.replaceAll('\r\n', '\n').trim()}\n~~~~\n`).join('\n');
      } catch (error) { errors.push(`${pkg.name} ${pkg.version}: ${error.message}`); }
    }
  }));
  if (errors.length) throw new Error(`Rust notices could not be completed:\n${errors.sort().join('\n')}`);
  return '# AIMEAT Desktop Rust dependency notices\n\n'
    + 'Generated from cargo metadata --locked and the exact published crate sources. This conservative inventory includes build dependencies and dependencies for other platforms; it does not assert that every listed package is linked on this machine.\n\n'
    + 'Each component is unmodified. Its source archive is linked below, including the source form of MPL-covered components. Licence alternatives are selected explicitly; Apache-2.0 is selected where the alternative is GPL.\n\n'
    + 'Upstream copyright and supplemental notices are retained when provided. If a published crate declares a standard SPDX licence but omits its full terms, the terms below are supplemented from the pinned SPDX licence list and labelled as such. Template placeholders in those standard terms are not asserted copyright holders.\n\n'
    + `Registry packages: ${locked.length}\n\n` + sections.join('\n');
}

export async function stageRustNotices(desktopRoot, outputDirectory) {
  const manifest = join(desktopRoot, 'src-tauri', 'Cargo.toml');
  const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--locked', '--format-version', '1', '--manifest-path', manifest], {
    cwd: desktopRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true,
  }));
  const cache = join(desktopRoot, 'src-tauri', 'target', 'rust-license-cache');
  const result = await renderRustNotices(metadata.packages, async pkg => {
    let files = readCrateLicenseTexts(pkg);
    const selected = selectLicense(pkg.license, id => files.some(file => hasLicense(file.text, id)));
    if (selected.every(id => files.some(file => hasLicense(file.text, id)))) return files;
    files = await upstreamTexts(pkg, selected, files, cache);
    for (const id of selected) {
      if (!files.some(file => hasLicense(file.text, id))) files.push(await standardTerms(id, cache));
    }
    return files;
  });
  const destination = join(outputDirectory, 'RUST-THIRD-PARTY-NOTICES.md');
  writeFileSync(destination, result, 'utf8');
  return destination;
}

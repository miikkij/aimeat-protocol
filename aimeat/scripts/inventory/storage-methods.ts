/**
 * @file scripts/inventory/storage-methods.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every method of the `Storage` composite, by repository, read from the source with the
 *   TypeScript parser: the repositories `Storage` extends in src/storage/interface.ts, each one's
 *   interface (following an `export type { X } from '../types/x.js'` re-export), and each method's
 *   name and parameter names. Shared by check-unbounded-lists.ts and check-storage-conformance.ts.
 * @structure StorageRepository · StorageMethod · storageRepositories(aimeatDir)
 * @usage
 *   const repos = storageRepositories(process.cwd());
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial (QA audit P7-10, P4-09).
 */
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface StorageMethod { name: string; params: string[] }
export interface StorageRepository { name: string; file: string; methods: StorageMethod[] }

function parse(file: string): ts.SourceFile {
    return ts.createSourceFile(file, readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/** The names `Storage` extends, mapped to the module each one is imported from. */
function composite(interfaceFile: string): Map<string, string> {
    const sf = parse(interfaceFile);
    const imports = new Map<string, string>();
    for (const st of sf.statements) {
        if (ts.isImportDeclaration(st) && st.importClause?.namedBindings && ts.isNamedImports(st.importClause.namedBindings)) {
            const from = (st.moduleSpecifier as ts.StringLiteral).text;
            for (const el of st.importClause.namedBindings.elements) imports.set(el.name.text, from);
        }
    }
    const out = new Map<string, string>();
    for (const st of sf.statements) {
        if (!ts.isInterfaceDeclaration(st) || st.name.text !== 'Storage') continue;
        for (const clause of st.heritageClauses ?? []) {
            for (const t of clause.types) {
                const name = t.expression.getText(sf);
                const from = imports.get(name);
                if (from) out.set(name, from);
            }
        }
    }
    return out;
}

/** The interface named `name` in `file`, following one `export type { name } from '…'` hop. */
function findInterface(file: string, name: string, hops = 0): { file: string; decl: ts.InterfaceDeclaration } | null {
    const sf = parse(file);
    for (const st of sf.statements) {
        if (ts.isInterfaceDeclaration(st) && st.name.text === name) return { file, decl: st };
    }
    if (hops > 2) return null;
    for (const st of sf.statements) {
        if (ts.isExportDeclaration(st) && st.moduleSpecifier && st.exportClause && ts.isNamedExports(st.exportClause)
            && st.exportClause.elements.some(e => e.name.text === name)) {
            const next = path.resolve(path.dirname(file), (st.moduleSpecifier as ts.StringLiteral).text.replace(/\.js$/, '.ts'));
            return findInterface(next, name, hops + 1);
        }
    }
    return null;
}

/** Every repository of the `Storage` composite with its methods, sorted by name. */
export function storageRepositories(aimeatDir: string): StorageRepository[] {
    const interfaceFile = path.join(aimeatDir, 'src', 'storage', 'interface.ts');
    const out: StorageRepository[] = [];
    for (const [name, from] of composite(interfaceFile)) {
        const file = path.resolve(path.dirname(interfaceFile), from.replace(/\.js$/, '.ts'));
        const found = findInterface(file, name);
        if (!found) throw new Error(`storage-methods: ${name} not found from ${from}`);
        const methods: StorageMethod[] = [];
        for (const m of found.decl.members) {
            const nameOf = m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name)) ? m.name.text : '';
            if (!nameOf) continue;
            if (ts.isMethodSignature(m)) methods.push({ name: nameOf, params: m.parameters.map(p => p.name.getText()) });
            else if (ts.isPropertySignature(m) && m.type && ts.isFunctionTypeNode(m.type)) {
                methods.push({ name: nameOf, params: m.type.parameters.map(p => p.name.getText()) });
            }
        }
        out.push({ name, file: path.relative(aimeatDir, found.file).replace(/\\/g, '/'), methods });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}

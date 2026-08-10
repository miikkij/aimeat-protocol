/**
 * @file audit-mcp-tools.ts
 * @description Audits MCP tool registrations in the public server MCP surface and
 *   the local connector MCP bridge. Produces a name-level parity report so drift
 *   between /v1/mcp and `aimeat connect serve` is visible during migration.
 * @structure
 *   - collectTools() -- extracts mcp.tool('name') calls from a source directory
 *   - printMarkdownReport() -- writes grouped parity report to stdout
 * @usage
 *   pnpm audit:mcp-tools
 *   pnpm audit:mcp-tools -- --json
 * @version-history
 *   v1.0.0 -- 2026-05-28 -- Initial MCP surface audit script
 *   v1.1.0 -- 2026-05-28 -- Include shared catalog CLI fallback coverage
 *   v1.2.0 -- 2026-05-28 -- Report catalog drift against MCP surfaces and CLI handlers
 *   v1.3.0 -- 2026-05-29 -- Add TOOL_ANNOTATIONS coverage check
 *   v1.4.0 -- 2026-07-19 -- Add --check gate mode (exit 1 on drift) for pre-commit + CI
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONNECT_CLI_TOOLS } from '../src/cli/connect/tool-call.js';
import { CLI_FALLBACK_TOOL_DEFINITIONS } from '../src/mcp/catalog/definitions.js';
import { TOOL_ANNOTATIONS } from '../src/mcp/annotations.js';
import { TOOL_SCOPES, SCOPE_EXEMPT_TOOLS } from '../src/mcp/catalog/scopes.js';

interface SurfaceConfig {
    id: 'server' | 'connector';
    label: string;
    directory: string;
}

interface ToolReference {
    surface: SurfaceConfig['id'];
    file: string;
    line: number;
    name: string;
}

interface AuditReport {
    generatedAt: string;
    surfaces: Record<SurfaceConfig['id'], ToolReference[]>;
    catalog: {
        all: string[];
        cliFallback: string[];
        cliFallbackWithoutServerMcp: string[];
        cliFallbackWithoutConnectorMcp: string[];
        cliFallbackWithoutHandler: string[];
        serverMcpWithoutCatalog: string[];
        connectorMcpWithoutCatalog: string[];
    };
    annotations: {
        all: string[];
        registeredWithoutAnnotation: string[];
        annotationWithoutRegistration: string[];
    };
    overlap: string[];
    serverOnly: string[];
    connectorOnly: string[];
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');

const surfaces: SurfaceConfig[] = [
    { id: 'server', label: 'Public server MCP (/v1/mcp)', directory: path.join(projectRoot, 'src', 'mcp') },
    { id: 'connector', label: 'Local connector MCP (aimeat connect serve)', directory: path.join(projectRoot, 'src', 'cli', 'connect', 'mcp', 'tools') },
];

async function listSourceFiles(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...await listSourceFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
            files.push(fullPath);
        }
    }

    return files.sort((first, second) => first.localeCompare(second));
}

function toWorkspacePath(filePath: string): string {
    return path.relative(projectRoot, filePath).split(path.sep).join('/');
}

function lineForOffset(source: string, offset: number): number {
    return source.slice(0, offset).split(/\r?\n/).length;
}

async function collectTools(surface: SurfaceConfig): Promise<ToolReference[]> {
    const files = await listSourceFiles(surface.directory);
    const tools: ToolReference[] = [];
    // Both SDK registration forms count. mcp.tool is the older positional one and most of the
    // surface uses it; mcp.registerTool takes a config object and is the ONLY form that carries
    // `_meta`, which a tool needs to name an MCP Apps page. Matching one form would have read a
    // tool that moved to the other as deleted, and reported drift against the catalog.
    const toolCallPattern = /\bmcp\.(?:register)?[Tt]ool\s*\(\s*['"`]([^'"`]+)['"`]/g;

    for (const file of files) {
        const source = await readFile(file, 'utf8');
        for (const match of source.matchAll(toolCallPattern)) {
            const name = match[1];
            if (!name) continue;
            tools.push({
                surface: surface.id,
                file: toWorkspacePath(file),
                line: lineForOffset(source, match.index ?? 0),
                name,
            });
        }
    }

    return tools.sort((first, second) => first.name.localeCompare(second.name) || first.file.localeCompare(second.file));
}

function uniqueToolNames(tools: ToolReference[]): string[] {
    return [...new Set(tools.map(tool => tool.name))].sort((first, second) => first.localeCompare(second));
}

function buildReport(serverTools: ToolReference[], connectorTools: ToolReference[]): AuditReport {
    const serverNames = uniqueToolNames(serverTools);
    const connectorNames = uniqueToolNames(connectorTools);
    const serverNameSet = new Set(serverNames);
    const connectorNameSet = new Set(connectorNames);
    const catalogNames = CLI_FALLBACK_TOOL_DEFINITIONS
        .map(definition => definition.name)
        .sort((first, second) => first.localeCompare(second));
    const catalogNameSet = new Set(catalogNames);
    const cliHandlerNames = new Set(CONNECT_CLI_TOOLS.map(tool => tool.name));
    const cliFallback = CLI_FALLBACK_TOOL_DEFINITIONS
        .filter(definition => definition.visibility.cliFallback)
        .map(definition => definition.name)
        .sort((first, second) => first.localeCompare(second));

    const annotationNames = Object.keys(TOOL_ANNOTATIONS)
        .sort((first, second) => first.localeCompare(second));
    const annotationNameSet = new Set(annotationNames);
    const registeredNames = [...new Set([...serverNames, ...connectorNames])]
        .sort((first, second) => first.localeCompare(second));
    const registeredNameSet = new Set(registeredNames);

    return {
        generatedAt: new Date().toISOString(),
        surfaces: { server: serverTools, connector: connectorTools },
        catalog: {
            all: catalogNames,
            cliFallback,
            cliFallbackWithoutServerMcp: cliFallback.filter(name => !serverNameSet.has(name)),
            cliFallbackWithoutConnectorMcp: cliFallback.filter(name => !connectorNameSet.has(name)),
            cliFallbackWithoutHandler: cliFallback.filter(name => !cliHandlerNames.has(name)),
            serverMcpWithoutCatalog: serverNames.filter(name => !catalogNameSet.has(name)),
            connectorMcpWithoutCatalog: connectorNames.filter(name => !catalogNameSet.has(name)),
        },
        annotations: {
            all: annotationNames,
            registeredWithoutAnnotation: registeredNames.filter(name => !annotationNameSet.has(name)),
            annotationWithoutRegistration: annotationNames.filter(name => !registeredNameSet.has(name)),
        },
        overlap: serverNames.filter(name => connectorNameSet.has(name)),
        serverOnly: serverNames.filter(name => !connectorNameSet.has(name)),
        connectorOnly: connectorNames.filter(name => !serverNameSet.has(name)),
    };
}

function groupByFile(tools: ToolReference[]): Map<string, ToolReference[]> {
    const grouped = new Map<string, ToolReference[]>();
    for (const tool of tools) {
        const existing = grouped.get(tool.file) ?? [];
        existing.push(tool);
        grouped.set(tool.file, existing);
    }
    return grouped;
}

function printNameList(title: string, names: string[]): void {
    console.log(`\n## ${title} (${names.length})`);
    if (names.length === 0) {
        console.log('\nNone.');
        return;
    }
    for (const name of names) console.log(`- ${name}`);
}

function printSurface(title: string, tools: ToolReference[]): void {
    console.log(`\n## ${title} (${uniqueToolNames(tools).length} unique tools)`);
    for (const [file, fileTools] of groupByFile(tools)) {
        console.log(`\n### ${file}`);
        for (const tool of fileTools) console.log(`- ${tool.name} (line ${tool.line})`);
    }
}

function printMarkdownReport(report: AuditReport): void {
    console.log('# MCP Tool Surface Audit');
    console.log(`\nGenerated: ${report.generatedAt}`);
    console.log(`\nPublic server MCP tools: ${uniqueToolNames(report.surfaces.server).length}`);
    console.log(`Local connector MCP tools: ${uniqueToolNames(report.surfaces.connector).length}`);
    console.log(`Shared names: ${report.overlap.length}`);
    console.log(`Server-only names: ${report.serverOnly.length}`);
    console.log(`Connector-only names: ${report.connectorOnly.length}`);
    console.log(`Shared catalog tools: ${report.catalog.all.length}`);
    console.log(`CLI fallback catalog tools: ${report.catalog.cliFallback.length}`);
    console.log(`CLI fallback names missing from public MCP: ${report.catalog.cliFallbackWithoutServerMcp.length}`);
    console.log(`CLI fallback names missing from connector MCP: ${report.catalog.cliFallbackWithoutConnectorMcp.length}`);
    console.log(`CLI fallback names missing CLI handlers: ${report.catalog.cliFallbackWithoutHandler.length}`);
    console.log(`Public MCP names missing from catalog: ${report.catalog.serverMcpWithoutCatalog.length}`);
    console.log(`Connector MCP names missing from catalog: ${report.catalog.connectorMcpWithoutCatalog.length}`);
    console.log(`Annotation entries: ${report.annotations.all.length}`);
    console.log(`Registered tools missing annotations: ${report.annotations.registeredWithoutAnnotation.length}`);
    console.log(`Annotation entries with no registered tool: ${report.annotations.annotationWithoutRegistration.length}`);

    printNameList('Server-Only Tool Names', report.serverOnly);
    printNameList('Connector-Only Tool Names', report.connectorOnly);
    printNameList('CLI Fallback Names Missing From Public MCP', report.catalog.cliFallbackWithoutServerMcp);
    printNameList('CLI Fallback Names Missing From Connector MCP', report.catalog.cliFallbackWithoutConnectorMcp);
    printNameList('CLI Fallback Names Missing CLI Handlers', report.catalog.cliFallbackWithoutHandler);
    printNameList('Public MCP Names Missing From Catalog', report.catalog.serverMcpWithoutCatalog);
    printNameList('Connector MCP Names Missing From Catalog', report.catalog.connectorMcpWithoutCatalog);

    console.log('\n## Annotation Coverage');
    printNameList('Registered Tools Missing Annotations', report.annotations.registeredWithoutAnnotation);
    printNameList('Annotation Entries With No Registered Tool', report.annotations.annotationWithoutRegistration);

    printNameList('Shared Tool Names', report.overlap);

    for (const surface of surfaces) {
        printSurface(surface.label, report.surfaces[surface.id]);
    }
}

const serverTools = await collectTools(surfaces[0]);
const connectorTools = await collectTools(surfaces[1]);
const report = buildReport(serverTools, connectorTools);

/**
 * Tools annotated as changing state that carry no TOOL_SCOPES entry and no written exemption.
 * These are the ones an agent reaches over MCP holding scopes that would refuse it over REST.
 */
function mutatingToolsWithoutScope(): string[] {
    return Object.entries(TOOL_ANNOTATIONS)
        .filter(([name, a]) => a.readOnlyHint === false && !TOOL_SCOPES[name] && !SCOPE_EXEMPT_TOOLS.has(name))
        .map(([name]) => name)
        .sort();
}

/** The same question for the tools that say they are irreversible. Strictly a subset, reported
 *  separately because "delete without a scope" deserves its own line in the failure. */
function destructiveToolsWithoutScope(): string[] {
    return Object.entries(TOOL_ANNOTATIONS)
        .filter(([name, a]) => a.destructiveHint === true && !TOOL_SCOPES[name] && !SCOPE_EXEMPT_TOOLS.has(name))
        .map(([name]) => name)
        .sort();
}

if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
} else if (process.argv.includes('--check')) {
    // Gate mode (pre-commit + CI): fail on any drift signal that must stay empty.
    // cliFallbackWithoutServerMcp is intentionally NOT gated — a handful of tools are
    // connector-only convenience with no server /v1/mcp surface (see surfaces.ts V2_EXCLUDED).
    const drift: Record<string, string[]> = {
        cliFallbackWithoutHandler: report.catalog.cliFallbackWithoutHandler,
        cliFallbackWithoutConnectorMcp: report.catalog.cliFallbackWithoutConnectorMcp,
        serverMcpWithoutCatalog: report.catalog.serverMcpWithoutCatalog,
        connectorMcpWithoutCatalog: report.catalog.connectorMcpWithoutCatalog,
        registeredWithoutAnnotation: report.annotations.registeredWithoutAnnotation,
        annotationWithoutRegistration: report.annotations.annotationWithoutRegistration,
        // Authorization drift (August 2026 audit, systemic pattern 2). The MCP surface is a SECOND
        // implementation of the REST surface, and its scope map was built by mirroring what REST did
        // at the time — so a REST gap was copied here automatically, and a later REST fix never
        // reached it. scopeAllowsTool() returns true for an unmapped tool, which makes a missing
        // entry a permission rather than an omission. A tool that changes state either names the
        // scope it needs or says in SCOPE_EXEMPT_TOOLS why it needs none.
        mutatingWithoutScope: mutatingToolsWithoutScope(),
        destructiveWithoutScope: destructiveToolsWithoutScope(),
    };
    const offenders = Object.entries(drift).filter(([, v]) => v.length > 0);
    if (offenders.length === 0) {
        console.log('[audit:mcp-tools] ✓ no MCP tool drift');
    } else {
        console.error('[audit:mcp-tools] ✗ MCP tool drift detected — wire the tools (surfaces + connector + CLI handler) or update the catalog/exclusions:');
        for (const [key, names] of offenders) console.error(`  ${key} (${names.length}): ${names.join(', ')}`);
        console.error('Run `pnpm audit:mcp-tools` for the full parity report.');
        process.exit(1);
    }
} else {
    printMarkdownReport(report);
}

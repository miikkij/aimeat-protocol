/**
 * @file src/tool-catalog/definitions/package-kinds.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The sentence each package tool ends with, which says which of the three packages it
 *   concerns and where the other two are.
 *
 *   WHY. The word "package" names three different things on the MCP surface: a knowledge package
 *   (refined knowledge kept as memory records under packages/<id>/, aimeat_knowledge_*), a component
 *   package (an installable bundle of apps, extensions and cortex libraries, aimeat_package_*) and a
 *   data package (a published table, aimeat_datapackage_*). An agent that searched for "knowledge
 *   package" was handed the install, compose and sellers tools and had to guess. One sentence per
 *   kind, written once here, appended at the END of each description, so the first sentence still
 *   says what the tool does and a search that ranks the first sentence higher is not moved.
 * @structure KNOWLEDGE_PACKAGE_KIND · COMPONENT_PACKAGE_KIND · DATA_PACKAGE_KIND
 * @usage
 *   description: 'Install a package …' + COMPONENT_PACKAGE_KIND,
 * @version-history
 *   v1.0.0 — 2026-11-25 — Initial (wish-knowledge-package-luonti-mcp-hen-ja-sana-package-yksiselitte).
 */

/** For aimeat_knowledge_* and the operator's aimeat_admin_knowledge. */
export const KNOWLEDGE_PACKAGE_KIND =
    ' A knowledge package is refined knowledge in memory; installable apps are component packages (aimeat_package_*), published tables are data packages (aimeat_datapackage_*).';

/** For aimeat_package_*: the installable bundles. */
export const COMPONENT_PACKAGE_KIND =
    ' This is a component package (installable apps, extensions, libraries); knowledge packages are aimeat_knowledge_*, data packages (published tables) aimeat_datapackage_*.';

/** For aimeat_datapackage_*: the published tables. */
export const DATA_PACKAGE_KIND =
    ' This is a data package (a published table); knowledge packages are aimeat_knowledge_*, component packages (installable apps) aimeat_package_*.';

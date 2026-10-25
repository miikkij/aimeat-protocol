-- 0116_subdomain_site_origin.sql
--
-- Who chose a subdomain label: 'operator' or 'publisher'.
--
-- One table holds two kinds of row. The operator maps a label through the operator routes (or the MCP
-- subdomain_set action), and that site is served on the apex namespace <label>.<apex>. A publish or the
-- first open of an app assigns the app a label of its own (routes/subdomains.ts ensureAppSubdomain), and
-- that label is meant for the app origin <label>.<appHost> only. Before this column the root route served
-- both kinds on the apex namespace, where the node's own pages and sign-in also answer, so a publisher's
-- script ran in a sibling of the node's own origin (secaudit2026oct22).
--
-- NULL marks a row written before this migration. This file changes no row: the once-only start step
-- services/subdomain-site-origin-keep.ts classifies a row only on positive evidence, and names the rows it
-- cannot classify on the Security page. A NULL row is served as before.
--
-- Mirrors safeAddColumn('subdomain_sites', 'origin', 'TEXT') in providers/sqlite/schema.ts.

ALTER TABLE "SubdomainSite" ADD COLUMN IF NOT EXISTS "origin" TEXT;

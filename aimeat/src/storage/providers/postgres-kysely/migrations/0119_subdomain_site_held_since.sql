-- 0119_subdomain_site_held_since.sql
--
-- When the app a per-app label served went away, so the label is held for that app's owner.
--
-- A label is an origin, and browser storage on that origin belongs to the visitors of the app it served.
-- Ordinary app deletion kept the row, but a package removal deleted it, and the next app with the same
-- file name, from any owner, got the label and could read what the first app's visitors left in that
-- origin's storage (secaudit2026oct22, app-label-recycled-after-delete). A removal now keeps the row with
-- this time set; the daily core job held-label-release (services/held-app-labels.ts) releases it after
-- apps.held_label_days, and one owner holds at most apps.held_labels_per_owner. The owner who publishes
-- the same app again gets the label back and the time is cleared.
--
-- ISO text, as the node writes it; NULL for a label whose app is there. This file changes no row: the
-- job sets the time on a row whose app is already gone the first time it sees one.
--
-- Mirrors safeAddColumn('subdomain_sites', 'heldSince', 'TEXT') in providers/sqlite/schema.ts.

ALTER TABLE "SubdomainSite" ADD COLUMN IF NOT EXISTS "heldSince" TEXT;

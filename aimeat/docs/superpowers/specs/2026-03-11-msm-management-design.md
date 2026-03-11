# MSM Management — Admin Dashboard CRUD

**Date:** 2026-03-11
**Status:** Approved

## Summary

Enhance the MSM admin tab from a read-only list/detail view to full CRUD management: create (YAML editor + template picker), edit (metadata-only), and delete (type-to-confirm).

## Frontend Design

### View States

The `msm-tab.js` component manages 4 view states via a `view` variable: `list`, `detail`, `create`, `edit`.

### List View (default)

- Header: "MSM Management" title + "Add MSM Integration" button (top right, next to Refresh)
- Table columns: Name, Category, Auth Type, Actions count, Registered By, Date, row actions
- Row actions: Edit (pencil) and Delete (trash) buttons per row
- Empty state: current "No MSM integrations registered" message
- Clicking a row name navigates to detail view

### Detail View (enhanced)

- Current read-only display (definition, endpoint, capabilities)
- Added: Edit and Delete buttons in header area
- Back button returns to list

### Create View

- Template picker: `<select>` dropdown listing templates from `GET /v1/msm/templates`; selecting one fetches YAML via `GET /v1/msm/templates/:type` and fills textarea
- YAML editor: `<textarea>` with monospace font, ~20 rows
- Federate toggle: checkbox "Share across federation"
- Buttons: "Register" (POST /v1/msm) and "Cancel" (back to list)
- Success: toast + navigate to list + reload
- Error: validation errors displayed inline below textarea

### Edit View

- Editable fields: Description (text input), Federate flag (checkbox)
- Read-only display: Name, category, auth type, actions count
- Buttons: "Save" (PUT /v1/admin/msm/:name) and "Cancel" (back to detail)

### Delete Confirmation

- Modal/overlay: "Type the MSM name `X` to confirm deletion"
- Text input must exactly match MSM name
- Delete button disabled until match
- Submits DELETE /v1/msm/:name
- Success: toast + navigate to list + reload

## Backend Design

### Existing Endpoints (no changes)

- `POST /v1/msm` — Create
- `GET /v1/msm` — List
- `GET /v1/msm/:name` — Detail
- `DELETE /v1/msm/:name` — Delete
- `GET /v1/msm/templates` — Template list
- `GET /v1/msm/templates/:type` — Template YAML

### New Endpoint

- `PUT /v1/admin/msm/:name` — Update metadata (description, federate). In `admin-features.ts`, operator auth. Calls `storage.updateMsm()`.

### Admin API Service Additions (`public/js/services/admin.js`)

- `createMsm(yaml, federate)` — POST /v1/msm with YAML body
- `updateMsm(name, updates)` — PUT /v1/admin/msm/:name
- `deleteMsm(name)` — DELETE /v1/msm/:name
- `getMsmTemplates()` — GET /v1/msm/templates
- `getMsmTemplate(type)` — GET /v1/msm/templates/:type

### i18n

New keys in both `en.json` and `fi.json` for: edit labels, delete confirmation, validation errors, success toasts.

## Approach

Single-file implementation in `msm-tab.js`, consistent with other admin tabs. All view states managed internally.

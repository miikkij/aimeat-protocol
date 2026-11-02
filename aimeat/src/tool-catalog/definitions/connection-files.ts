/**
 * @file connection-files.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A connected SharePoint or OneDrive from chat: browse it, read or keep one file, write a
 *   file, a folder or a list row. One slice of CLI_FALLBACK_TOOL_DEFINITIONS; re-assembled in order by
 *   definitions.ts.
 *
 *   THREE TOOLS, NOT ONE PER GRAPH CALL. Browsing (sites, libraries, folders, search, lists, what
 *   changed) is one tool with `what`, because they are one act to the person: finding the thing. A
 *   file's bytes are the second, and writing is the third, because each takes a different permission
 *   word and a person grants them separately.
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial (wish-sharepoint-liitin-tiedostot-luettaviksi-ja-kirjoitettaviksi-).
 */

import { z } from 'zod';
import { INPUT_LIMITS } from '../../models/input-limits.js';
import type { AimeatToolDefinition } from './types.js';
import { agentEverywhere } from './types.js';

export const connectionFileTools = [
    {
        name: 'aimeat_files_browse',
        description: "Find things in the person's connected SharePoint or OneDrive (a connection to provider microsoft-files or microsoft-files-write, from aimeat_connection_list; none yet: aimeat_connection_start with provider microsoft-files gives the sign-in address for the person). `what` says what to list: 'sites' (query: part of a site's name), 'site' (site_id, or hostname + path such as contoso.sharepoint.com and sites/Marketing), 'drives' (a site's document libraries; no site_id is the person's own OneDrive), 'children' (a folder: drive_id and item_id, no item_id is the library's top), 'item' (one file's details: name, size, webUrl, eTag, lastModifiedDateTime), 'search' (query in one library: drive_id, or site_id for its main library), 'changes' (what changed in a library since `token`; the first call without a token answers everything and an @odata.deltaLink whose token you keep, and a deleted file comes back with `deleted`), 'lists' and 'list_items' (a site's lists and their rows). Ids come from the answer before: sites give site ids, drives give drive ids, children and search give item ids. A long answer has @odata.nextLink; pass its $skiptoken as page_token. You see only what the person can see in SharePoint, or only the sites an administrator granted when the node asks for selected sites.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Find Things in SharePoint', readOnlyHint: true, openWorldHint: true },
        scope: 'connections:read-through',
        surfaces: ['agent'],
        input: {
            connection_id: { type: 'string', required: true, description: 'Which connected SharePoint or OneDrive, from aimeat_connection_list.' },
            what: { type: 'string', required: true, description: "What to list: sites, site, drives, children, item, search, changes, lists or list_items.", zod: z.enum(['sites', 'site', 'drives', 'children', 'item', 'search', 'changes', 'lists', 'list_items']) },
            query: { type: 'string', description: "With sites or search: what to look for." },
            site_id: { type: 'string', description: "A site's id, from sites. root is the tenant's main site." },
            hostname: { type: 'string', description: "With site: the SharePoint host, such as contoso.sharepoint.com." },
            path: { type: 'string', description: "With site and hostname: the site's path, such as sites/Marketing." },
            drive_id: { type: 'string', description: "A document library's id, from drives." },
            item_id: { type: 'string', description: "A file's or folder's id, from children or search." },
            list_id: { type: 'string', description: "A list's id, from lists." },
            token: { type: 'string', description: "With changes: the token from the last answer's @odata.deltaLink." },
            limit: { type: 'number', description: 'How many to answer at once (at most 200).' },
            page_token: { type: 'string', description: "The $skiptoken from the last answer's @odata.nextLink, for the next page." },
        },
    },
    {
        name: 'aimeat_files_get',
        description: "One file from the person's connected SharePoint or OneDrive. as 'text' answers the file as text: a Word document, a spreadsheet or a PDF is read by the node, plain text comes as it is, and anything else is refused with what it is. as 'store' keeps it as the person's private file on this node, up to the node's per-file limit, and answers its storage key; storing needs storage:write. Either way the answer says where it came from (source: its SharePoint address, eTag and when it last changed), so you can tell later whether a copy is stale by asking aimeat_files_browse for changes. The token is never sent to the download: the node fetches the file through the pre-authenticated address SharePoint gives.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Read or Keep a SharePoint File', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        scope: 'connections:read-through',
        surfaces: ['agent'],
        input: {
            connection_id: { type: 'string', required: true, description: 'Which connected SharePoint or OneDrive.' },
            drive_id: { type: 'string', required: true, description: "The file's library, from aimeat_files_browse." },
            item_id: { type: 'string', required: true, description: 'The file, from aimeat_files_browse.' },
            as: { type: 'string', required: true, description: "text: answer it as text. store: keep it as your private file and answer its key (needs storage:write).", zod: z.enum(['text', 'store']) },
            key: { type: 'string', description: 'With store: the storage key. Default sharepoint/<item id>/<file name>.' },
        },
    },
    {
        name: 'aimeat_files_write',
        description: "Write to the person's connected SharePoint or OneDrive. Needs a connection to provider microsoft-files-write (the writing permission, connected separately from reading) and the connections:use permission. `what`: 'upload' puts a new file into a folder (drive_id, parent_id or the library's top, filename, and the content as from_key, one of the person's stored files, or as text); conflict says what happens when the name is taken: rename (the default), replace or fail. 'replace' writes new content into an existing file (drive_id, item_id, from_key or text); pass the etag you read so a change somebody made in between is refused (CHANGED_SINCE_READ) rather than overwritten. 'folder' makes a folder (drive_id, parent_id, name). 'list_item' adds a row to a list (site_id, list_id, fields as {internal column name: value}); 'list_item_update' changes a row's fields (item_id is the row's number, etag optional). Nothing here deletes or shares. Say what you will write and where before you do it: it lands in a system other people use. A stored file marked as one that may not leave this node is refused (CLASSIFIED) and nothing is sent.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Write to SharePoint', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        scope: 'connections:use',
        surfaces: ['agent'],
        input: {
            connection_id: { type: 'string', required: true, description: 'Which connected SharePoint or OneDrive (writing permission).' },
            what: { type: 'string', required: true, description: 'What to write: upload, replace, folder, list_item or list_item_update.', zod: z.enum(['upload', 'replace', 'folder', 'list_item', 'list_item_update']) },
            drive_id: { type: 'string', description: "The library, from aimeat_files_browse." },
            parent_id: { type: 'string', description: "With upload or folder: the folder to write into. Leave it out for the library's top." },
            item_id: { type: 'string', description: "With replace: the file. With list_item_update: the row's number." },
            filename: { type: 'string', description: "With upload: the file's name there. Defaults to the stored file's name." },
            name: { type: 'string', description: "With folder: the folder's name." },
            from_key: { type: 'string', description: "With upload or replace: the content, as the key of one of the person's stored files." },
            text: { type: 'string', description: "With upload or replace: the content as text, instead of from_key." },
            mime_type: { type: 'string', description: "With text: its type, such as text/markdown. Default text/plain." },
            conflict: { type: 'string', description: "With upload or folder: rename (default), replace or fail.", zod: z.enum(['rename', 'replace', 'fail']) },
            etag: { type: 'string', description: "With replace or list_item_update: the eTag you read, so a change made in between is refused." },
            site_id: { type: 'string', description: "With list_item or list_item_update: the site." },
            list_id: { type: 'string', description: "With list_item or list_item_update: the list." },
            fields: { type: 'object', description: "With list_item or list_item_update: {internal column name: text, number, true or false}.", zod: z.record(z.string().max(INPUT_LIMITS.id), z.union([z.string(), z.number(), z.boolean(), z.null()])) },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];

/**
 * @file crew-dag.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The task-order picture in the Crew tab, under its old name: the picture itself is the
 *   component TaskGraph (components/TaskGraph.js). This module keeps the names the crew editor and
 *   the design lab import (TaskDag, layoutTasks).
 * @structure layoutTasks(tasks) → { nodes, edges, width, height } · TaskDag({ tasks, problemIds })
 * @version-history
 *   v1.1.0 -- 2026-09-26 -- The picture moved to components/TaskGraph.js with its markup; this module
 *     re-exports it under the old names (page group G1a).
 *   v1.0.0 -- 2026-08-28 -- Initial (JSON-agent Crew tab).
 */
export { TaskGraph as TaskDag, layoutTasks } from '/components/TaskGraph.js';

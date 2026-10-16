/**
 * @file src/services/config-setting-incidents.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Security page incidents for the settings the node did not accept at start.
 *
 *   WHY. A value the node does not accept (a misspelt access level, a number that is not a number)
 *   no longer stops the start: config-start-check.ts sets it aside and the node runs the setting's
 *   default, with one log line. A log line is read by whoever happens to look, so each such setting
 *   also becomes one incident on the Security page, where an operator sees it on REST
 *   (GET /v1/admin/security/incidents), over MCP (aimeat_admin_security_overview) and on the page,
 *   and resolves or deletes it there (Jouni, decision 2026-10-16; the node-always-boots ruling of
 *   2026-09-27 in .claude/rules/backend.md).
 *
 *   ONE OPEN INCIDENT PER SETTING. A start with the same value opens nothing new. A start with a
 *   different value the node still does not accept closes the old incident and opens one naming the
 *   new value. The first start on which the setting is accepted (or unset) closes its incident by
 *   itself. An incident the operator resolved while the value was still wrong opens again at the next
 *   start, because the node is still running on the default.
 *
 *   NEVER STOPS A START. Every storage call is best-effort: a failure is logged and the node starts.
 * @structure CONFIG_SETTING_INCIDENT_TYPE · settingIncidentDetail() · settleSettingIncidentsAtStart()
 * @usage await settleSettingIncidentsAtStart(storage, config, configSources.settingFallbacks);
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (Jouni, decision 2026-10-16).
 */
import type { AimeatConfig } from '../config.js';
import type { StartSettingFallback } from '../config-start-check.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { emitChange } from './event-bus.js';
import { listSecurityIncidents, recordSecurityIncident, resolveSecurityIncident, securityOwner } from './security-incident.js';

export const CONFIG_SETTING_INCIDENT_TYPE = 'config_setting';

/** What the operator reads on the incident: what is wrong, what the node does, and what to do. */
export function settingIncidentDetail(f: StartSettingFallback): string {
  return `${f.variable} is set to "${f.value}", which this setting does not take: it ${f.takes}. `
    + `The node started with the default, ${f.used === '' ? 'no value' : f.used}, and runs on it until the value is corrected. `
    + 'Correct the value in .env, the config file or the command line, or remove it to keep the default, and restart the node; '
    + 'this incident closes by itself at the first start with a value the node accepts. `aimeat validate` checks every setting without starting.';
}

/**
 * Open one incident for each setting in `fallbacks` that has no open incident for the same value, and
 * close the open incidents of settings the node accepts now. Never throws.
 */
export async function settleSettingIncidentsAtStart(
  storage: Storage, config: AimeatConfig, fallbacks: StartSettingFallback[],
): Promise<void> {
  try {
    const open = (await listSecurityIncidents(storage, config)).items
      .filter(i => i.type === CONFIG_SETTING_INCIDENT_TYPE && i.status === 'open' && i.setting);
    let changed = false;
    for (const incident of open) {
      const now = fallbacks.find(f => f.variable === incident.setting!.variable);
      if (now && now.value === incident.setting!.value) continue;
      await resolveSecurityIncident(storage, config, incident.id);
      changed = true;
      if (!now) logger.info(`[config] ${incident.setting!.variable} has a value the node accepts now; its Security page incident is closed.`);
    }
    for (const f of fallbacks) {
      if (open.some(i => i.setting!.variable === f.variable && i.setting!.value === f.value)) continue;
      const out = await recordSecurityIncident(storage, config, {
        type: CONFIG_SETTING_INCIDENT_TYPE,
        code: 'SETTING_NOT_ACCEPTED',
        actorGhii: securityOwner(config.nodeId),
        detail: settingIncidentDetail(f),
        source: 'start',
        setting: { variable: f.variable, value: f.value },
      });
      changed = changed || out.recorded;
    }
    if (changed) emitChange('security');
  } catch (err) {
    logger.warn('settleSettingIncidentsAtStart: the Security page entries for the settings are best-effort', { error: String(err) });
  }
}

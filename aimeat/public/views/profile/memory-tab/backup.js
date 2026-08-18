/**
 * @file views/profile/memory-tab/backup.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Export and import of a memory backup, as one hook. Extracted from memory-tab.js to
 *   satisfy max-file-lines; behaviour unchanged.
 * @structure
 *   - useMemoryBackup({ selectedAgent, showToast, confirm, loadMemories }) — handleExport,
 *     triggerImport, handleImportFile, and the import-mode + busy state the toolbar renders
 * @usage
 *   const backup = useMemoryBackup({ selectedAgent, showToast, confirm, loadMemories });
 *   // spread into the render ctx
 * @version-history
 *   v1.0.0 — 2026-08-11 — Extracted from memory-tab.js (max-file-lines). Pure move.
 */
import { useState, useRef, useCallback } from 'preact/hooks';
import { t } from '/js/i18n.js';
import * as memoryService from '/js/services/memory.js';

export function useMemoryBackup({ selectedAgent, showToast, confirm, loadMemories }) {
  const [importMode, setImportMode] = useState('skip');
  const [importing, setImporting] = useState(false);
  const importFileRef = useRef(null);

  const handleExport = useCallback(async (prefix) => {
    try {
      const data = await memoryService.exportMemory(selectedAgent || undefined, prefix || undefined);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `aimeat-memory-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast((t('profile.memory.exportDone') || 'Exported {n} entries').replace('{n}', String(data.count ?? (data.entries || []).length)));
    } catch (e) { showToast(e.message || t('profile.error'), true); }
  }, [selectedAgent, showToast]);

  const triggerImport = useCallback(() => { importFileRef.current?.click(); }, []);

  // Import a JSON backup; the user picks a conflict mode (skip/overwrite/rename) before it runs.
  const handleImportFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';   // allow re-picking the same file
    if (!file) return;
    let parsed;
    try {
      const text = await file.text();
      parsed = JSON.parse(text);
    } catch { showToast(t('profile.memory.importBadJson') || 'Not a valid JSON backup', true); return; }
    const entries = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.entries) ? parsed.entries : null);
    if (!entries || entries.length === 0) { showToast(t('profile.memory.importEmpty') || 'No entries found in file', true); return; }

    const modeLabel = (m) => t('profile.memory.importMode.' + m) || m;
    confirm(
      (t('profile.memory.importConfirm') || 'Import {n} entries? Existing keys are handled by mode: {mode}.')
        .replace('{n}', String(entries.length)).replace('{mode}', modeLabel(importMode)),
      async () => {
        setImporting(true);
        try {
          const resp = await memoryService.importMemory(entries, importMode, selectedAgent || undefined);
          if (resp.ok === false) { showToast(resp.error?.message || t('profile.error'), true); return; }
          const s = resp.data || {};
          showToast((t('profile.memory.importDone') || 'Imported: {c} new, {u} updated, {s} skipped')
            .replace('{c}', String(s.created || 0)).replace('{u}', String(s.updated || 0)).replace('{s}', String(s.skipped || 0))
            + ((s.failed && s.failed.length) ? ` · ${s.failed.length} ${t('profile.error') || 'failed'}` : ''),
            !!(s.failed && s.failed.length));
          loadMemories();
        } catch (err) { showToast(err.message || t('profile.error'), true); }
        finally { setImporting(false); }
      },
    );
  }, [importMode, selectedAgent, showToast, confirm, loadMemories]);

  return { handleExport, triggerImport, handleImportFile, importMode, setImportMode, importing, importFileRef };
}

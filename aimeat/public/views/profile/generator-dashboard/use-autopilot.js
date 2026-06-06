/**
 * @file use-autopilot.js
 * @description Thin client for the server-side generator autopilot. Starts the
 *   pipeline on the backend, polls for status, and updates the UI. The actual
 *   generation loop runs server-side — closing the browser tab doesn't kill it.
 *
 *   Architecture: Browser clicks "Run all" → POST /autopilot/start → polls GET /autopilot/status
 *   The server handles: spec gen → code gen → validate → register → probe → test
 *
 * @structure
 *   - useAutopilot(core, autopilotState, projectId, orSettings, session, testExec, showToast): custom hook
 *     Handler: handleRunAll (starts backend + polls), handleCancel (stops backend)
 * @usage
 *   import { useAutopilot } from './generator-dashboard/use-autopilot.js';
 * @version-history
 *   v1.0.0 — 2026-03-22 — Extracted from generator-tab.js ProjectDashboard
 *   v2.0.0 — 2026-04-01 — Rewritten: browser loop → server-side autopilot with polling
 */
import { apiPost, apiGet } from '/js/api.js';

/**
 * @param {Object} core — useDashboardCore return value
 * @param {Object} autopilotState — useAutopilotState return value
 * @param {string} projectId
 * @param {Object} orSettings — { hasApiKey, autoRetry, maxRetries }
 * @param {Object} session
 * @param {Object} testExec — useTestExecution return value
 * @param {Function} showToast
 */
export function useAutopilot(core, autopilotState, projectId, orSettings, session, testExec, showToast) {

  let pollInterval = null;
  let lastSeenResults = 0; // Track how many component results we've toasted

  /** Start the server-side autopilot and begin polling for status */
  async function handleRunAll() {
    if (!orSettings?.hasApiKey || autopilotState.running) return;

    try {
      // Start the backend autopilot — returns immediately, runs in background.
      // Pass the selected test scope ("Testauslaajuus") so the server can skip the test phase
      // when 'none' is chosen (spec + code + register still run for every component).
      const testScope = testExec?.testScopeRef?.current || testExec?.testScope || 'comprehensive';
      const resp = await apiPost(`/v1/generator/${projectId}/autopilot/start`, { testScope });
      if (!resp?.ok && !resp?.data?.started) {
        showToast?.('Failed to start autopilot: ' + (resp?.error?.message || 'Unknown error'), true);
        return;
      }

      autopilotState.start();
      showToast?.('Autopilot started — runs on server, safe to minimize browser');

      // Poll for status every 3 seconds
      pollInterval = setInterval(async () => {
        try {
          const statusResp = await apiGet(`/v1/generator/${projectId}/autopilot/status`);
          const status = statusResp?.data;
          if (!status) return;

          // Update UI state from server status
          if (status.currentComponent) {
            const progress = status.progress || {};
            const step = `${status.currentComponent} (${progress.completed || 0}/${progress.total || '?'})`;
            autopilotState.setStep(step);
          }

          // Show toast for each new component result
          const results = status.componentResults || [];
          if (results.length > lastSeenResults) {
            for (let i = lastSeenResults; i < results.length; i++) {
              const r = results[i];
              const isError = r.status === 'error' || r.status === 'validation_failed' || r.status === 'registration_failed';
              showToast?.(`${r.label}: ${r.status}${r.error ? ' — ' + r.error : ''}`, isError);
            }
            lastSeenResults = results.length;
          }

          // Refresh component list to show latest registrations
          await core.loadData();

          // Check if autopilot finished
          if (status.status !== 'running') {
            clearInterval(pollInterval);
            pollInterval = null;
            autopilotState.finish();

            const progress = status.progress || {};
            const msg = status.status === 'completed'
              ? `Autopilot complete: ${progress.completed} registered, ${progress.failed} failed, ${progress.skipped} skipped`
              : status.status === 'cancelled'
                ? 'Autopilot cancelled'
                : `Autopilot failed: ${status.status}`;
            showToast?.(msg, status.status === 'failed');

            // Refresh UI one final time
            await core.loadData();
          }
        } catch (pollErr) {
          // Network error or rate limit during poll — stop polling if repeated failures
          console.warn('[autopilot] Poll failed:', pollErr.message);
          if (pollErr.message?.includes('429') || pollErr.message?.includes('Too Many')) {
            clearInterval(pollInterval);
            pollInterval = null;
            autopilotState.finish();
            showToast?.('Polling stopped (rate limited). Autopilot may still be running on server — refresh to check.', true);
          }
        }
      }, 3000);

    } catch (e) {
      showToast?.('Failed to start autopilot: ' + e.message, true);
    }
  }

  /** Cancel the running autopilot on the server */
  async function handleCancel() {
    // Stop polling FIRST — prevents 429 storms if cancel API is slow or rate-limited
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    autopilotState.cancel();

    // Then tell the server to stop (best effort — server may already be stopped)
    try {
      await apiPost(`/v1/generator/${projectId}/autopilot/cancel`);
    } catch {
      // Ignore — polling is already stopped, UI is already in cancelled state
    }
  }

  // Override the cancel ref to use our cancel function
  // The autopilotState.cancelledRef is checked by the old code — but now the server handles cancellation
  // We just need to make the UI's cancel button call our handleCancel
  const originalCancel = autopilotState.cancel;
  autopilotState.cancel = handleCancel;

  return { handleRunAll };
}

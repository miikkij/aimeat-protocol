/**
 * @file use-autopilot-state.js
 * @description Shared autopilot primitives — running state, current step label,
 *   and cancellation ref. Consumed by both useAutopilot (generation pipeline) and
 *   useEditMode (batch edit operations) so they share a single "autopilot is active"
 *   indicator in the UI.
 *
 *   Part of the hook-per-domain architecture for ProjectDashboard. This hook is
 *   instantiated once in the dashboard shell and passed to useAutopilot and
 *   useEditMode as a parameter. It provides start/finish/cancel lifecycle methods
 *   so consumers don't manipulate the state directly.
 *
 *   Architecture: ProjectDashboard shell → useAutopilotState()
 *                   ├─ passed to useAutopilot(core, autopilotState, ...)
 *                   └─ passed to useEditMode(core, autopilotState, ...)
 *
 * @structure
 *   - useAutopilotState(): custom hook
 *     State: running, step (useState), cancelledRef (useRef)
 *     Methods: start(), finish(), cancel()
 * @usage
 *   import { useAutopilotState } from './generator-dashboard/use-autopilot-state.js';
 *   const autopilotState = useAutopilotState();
 * @version-history
 *   v1.0.0 — 2026-03-22 — Extracted from generator-tab.js ProjectDashboard
 */
import { useState, useRef } from 'preact/hooks';
import { cancelAiRequest } from '../generator-detail.js';
import { t } from '/js/i18n.js';

export function useAutopilotState() {
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState('');
  const cancelledRef = useRef(false);

  function start() {
    setRunning(true);
    cancelledRef.current = false;
  }

  function finish() {
    setRunning(false);
    setStep('');
  }

  function cancel() {
    cancelledRef.current = true;
    cancelAiRequest();
    setStep(t('profile.generator.openrouter.cancel') + '...');
  }

  return { running, step, setStep, cancelledRef, start, finish, cancel };
}

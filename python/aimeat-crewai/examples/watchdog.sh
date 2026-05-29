#!/usr/bin/env bash
# Watchdog supervisor for crew_daemon.py.
#
# Runs the daemon and restarts it on crash. If the daemon dies too fast
# too many times in a row, the watchdog gives up and exits non-zero --
# this prevents a runaway crash-loop (e.g. config error that fails
# instantly will be caught instead of pegging the CPU forever).
#
# Tunables (override via env):
#   AIMEAT_AGENT_NAME   default: demo-crew
#   CREW_SCRIPT         default: crew_daemon.py (relative to this file's dir)
#   MIN_UPTIME_SECS     default: 30  -- crashes faster than this count toward
#                                       the failure budget
#   MAX_FAST_CRASHES    default: 5   -- give up after this many fast crashes
#   PYTHON              default: python
#
# Stop with Ctrl+C; the watchdog forwards SIGTERM to the daemon.
set -u

AIMEAT_AGENT_NAME="${AIMEAT_AGENT_NAME:-demo-crew}"
CREW_SCRIPT="${CREW_SCRIPT:-$(dirname "$0")/crew_daemon.py}"
MIN_UPTIME_SECS="${MIN_UPTIME_SECS:-30}"
MAX_FAST_CRASHES="${MAX_FAST_CRASHES:-5}"
PYTHON="${PYTHON:-python}"

fast_crashes=0
total_runs=0

trap 'echo "[watchdog] received SIGTERM/SIGINT, killing daemon..."; kill -TERM "$pid" 2>/dev/null; exit 0' INT TERM

while true; do
  total_runs=$((total_runs + 1))
  echo "[watchdog] starting daemon (run #$total_runs, agent=$AIMEAT_AGENT_NAME)"
  start_ts=$(date +%s)

  AIMEAT_AGENT_NAME="$AIMEAT_AGENT_NAME" "$PYTHON" "$CREW_SCRIPT" &
  pid=$!
  wait "$pid"
  exit_code=$?

  end_ts=$(date +%s)
  uptime=$((end_ts - start_ts))

  echo "[watchdog] daemon exited code=$exit_code after ${uptime}s"

  # Clean shutdown: don't restart.
  if [ "$exit_code" = "0" ]; then
    echo "[watchdog] daemon exited cleanly, stopping watchdog"
    exit 0
  fi

  if [ "$uptime" -lt "$MIN_UPTIME_SECS" ]; then
    fast_crashes=$((fast_crashes + 1))
    echo "[watchdog] fast crash ($fast_crashes/$MAX_FAST_CRASHES)"
    if [ "$fast_crashes" -ge "$MAX_FAST_CRASHES" ]; then
      echo "[watchdog] too many fast crashes -- giving up (check the daemon's logs)"
      exit 1
    fi
  else
    # Reset the fast-crash counter on a long-lived run -- after a real
    # transient failure (network blip, rate-limit) the daemon should
    # recover and the watchdog should forget the prior fast crashes.
    fast_crashes=0
  fi

  # Backoff: 1s, 2s, 4s, ... capped at 30s.
  delay=$(( 1 << fast_crashes ))
  if [ "$delay" -gt 30 ]; then delay=30; fi
  echo "[watchdog] restarting in ${delay}s"
  sleep "$delay"
done

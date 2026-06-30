"""
Deterministic Hello Integration driver for the AIMEAT liaison.

Instead of letting the LLM guess tool names (and fabricate non-existent
``aimeat_onboarding_<stepId>`` tools), this drives onboarding from the node's
authoritative machine-readable contract. ``aimeat_onboarding_status`` returns,
per step, a ``howTo`` (``tool`` + ``args``), a flow-scoped ``step_guide`` map,
and a ``summary`` (``completable``, ``next_required_step`` ...). We call the tool
named in each pending REQUIRED step's ``howTo.tool`` and stop the moment
``summary.completable`` is true. The optional offers-ladder steps never block.

This removes the model from onboarding tool-selection entirely -- the biggest
robustness win for small / local models. It is import-light on purpose: it
operates on duck-typed tool objects (anything exposing ``.name`` and
``.run(**kwargs)``), so it is unit-testable with fakes and does not require
crewai at import time.

Typical use::

    from aimeat_crewai import liaison_tools, serve_params, run_hello_integration
    tools = liaison_tools(serve_params(agent_name="my-crew"))
    run_hello_integration(tools, agent_name="my-crew", logger=print)
"""
from __future__ import annotations

import json
import time
from typing import Any, Callable, Mapping, Sequence

# The five aimeat_onboarding_* tools are the ONLY onboarding-prefixed tools.
# Surfaced here so callers / tests can assert the frozen set; the node's
# STEP_HOWTO is the source of truth.
ONBOARDING_CONFIRM_TOOLS: tuple[str, ...] = (
    "aimeat_onboarding_status",
    "aimeat_onboarding_identify_platform",
    "aimeat_onboarding_confirm_skill_installed",
    "aimeat_onboarding_confirm_directives_read",
    "aimeat_onboarding_declare_services",
)


class OnboardingError(RuntimeError):
    """Raised when Hello Integration cannot be driven to completion deterministically."""


def _tool_by_name(tools: Sequence[Any], name: str) -> Any | None:
    for t in tools:
        if getattr(t, "name", None) == name:
            return t
    return None


def _call(tool: Any, args: Mapping[str, Any]) -> Any:
    """Invoke a CrewAI / duck-typed tool and parse its (usually JSON) result."""
    result = tool.run(**dict(args))
    if isinstance(result, (dict, list)):
        return result
    if isinstance(result, str):
        try:
            return json.loads(result)
        except ValueError:
            return {"_raw": result}
    return result


def _subst(value: Any, mapping: Mapping[str, Any]) -> Any:
    """Deep-substitute ``{placeholder}`` tokens in string values (returns a copy)."""
    if isinstance(value, str):
        out = value
        for k, v in mapping.items():
            out = out.replace("{" + k + "}", str(v))
        return out
    if isinstance(value, list):
        return [_subst(v, mapping) for v in value]
    if isinstance(value, dict):
        return {k: _subst(v, mapping) for k, v in value.items()}
    return value


def run_hello_integration(
    tools: Sequence[Any],
    *,
    agent_name: str,
    step_args: Mapping[str, Mapping[str, Any]] | None = None,
    max_rounds: int = 18,
    sleep_seconds: float = 0.0,
    logger: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    """
    Drive Hello Integration to completion using the node's ``howTo`` contract.

    Each round: call ``aimeat_onboarding_status``; if ``summary.completable`` is
    true, return. Otherwise take ``summary.next_required_step`` and call the tool
    named in its ``howTo.tool`` with ``howTo.args`` (``{test_task_id}`` filled from
    ``hints``; ``{name}`` is already substituted server-side). Passive steps
    (``howTo.tool is None``, e.g. ``configure_delivery``) need no call -- re-reading
    status keeps the agent's ``lastSeen`` fresh so the server auto-passes them.
    Only REQUIRED steps are driven, so the optional offers ladder is never
    triggered here (publish offers separately via ``offers_publish`` if desired).

    Args:
        tools: the liaison's tool objects (e.g. from :func:`liaison_tools` or a
            liaison agent's ``.tools``). Each must expose ``.name`` and
            ``.run(**kwargs)``.
        agent_name: the agent's bare name (used only for messages).
        step_args: optional per-stepId arg overrides; when given for a step it
            REPLACES that step's ``howTo.args`` (use to publish real capabilities
            / commands instead of the example templates the node ships).
        max_rounds: hard cap on status->act cycles (a stuck server cannot loop
            forever). Default comfortably exceeds the required-step count.
        sleep_seconds: optional pause between rounds (lets polling-based delivery
            register before re-checking).
        logger: optional callable for progress lines.

    Returns:
        the final status payload (``{onboarding, step_guide, summary, hints}``).

    Raises:
        OnboardingError: the status tool is missing, the contract names a tool
            this connector does not hold (node/connector out of sync), or
            completion is not reached within ``max_rounds``.
    """
    log = logger or (lambda _m: None)
    step_args = step_args or {}

    status_tool = _tool_by_name(tools, "aimeat_onboarding_status")
    if status_tool is None:
        raise OnboardingError(
            "aimeat_onboarding_status is not in the toolset -- cannot drive onboarding."
        )

    last: dict[str, Any] = {}
    for round_no in range(1, max_rounds + 1):
        status = _call(status_tool, {})
        if not isinstance(status, dict):
            raise OnboardingError(f"aimeat_onboarding_status returned a non-object: {status!r}")
        last = status

        summary = status.get("summary") or {}
        if summary.get("completable"):
            log(
                f"Hello Integration complete "
                f"({summary.get('required_passed')}/{summary.get('required_total')} required)."
            )
            return status

        next_id = summary.get("next_required_step")
        if not next_id:
            raise OnboardingError(
                f"Onboarding is not completable but reports no next_required_step "
                f"(round {round_no}). summary={summary}"
            )

        guide = status.get("step_guide") or {}
        how = guide.get(next_id) or {}
        tool_name = how.get("tool")

        if tool_name is None:
            # Passive step (e.g. configure_delivery): re-reading status refreshed
            # lastSeen; just loop. The max_rounds cap guards a server that never
            # auto-passes it.
            log(f"[{round_no}] {next_id}: passive ({how.get('passiveNote', 'auto')}); re-checking.")
            if sleep_seconds:
                time.sleep(sleep_seconds)
            continue

        tool = _tool_by_name(tools, tool_name)
        if tool is None:
            raise OnboardingError(
                f"Step '{next_id}' maps to tool '{tool_name}', which is not in this "
                f"connector's toolset. The node contract and connector are out of sync "
                f"(node schema wins -- update the connector)."
            )

        hints = status.get("hints") or {}
        mapping = {"test_task_id": hints.get("test_task_id", "")}
        override = step_args.get(next_id)
        args = dict(override) if override is not None else _subst(how.get("args") or {}, mapping)

        log(f"[{round_no}] {next_id} -> {tool_name}")
        try:
            _call(tool, args)
        except Exception as exc:  # noqa: BLE001 -- report; the next status read confirms real state
            log(f"[{round_no}] {next_id} -> {tool_name} raised: {exc}")
        if sleep_seconds:
            time.sleep(sleep_seconds)

    raise OnboardingError(
        f"Hello Integration not completed within {max_rounds} rounds. "
        f"Last summary={last.get('summary')}"
    )

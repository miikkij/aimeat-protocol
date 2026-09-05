"""
Deterministic Hello Integration driver (0.12.0+).

The node ships a machine-readable onboarding contract on ``aimeat_onboarding_status``:
per step, a ``howTo`` (``tool`` + ``args``), a flow-scoped ``step_guide`` map,
and a ``summary`` (``completable``, ``next_required_step`` ...). We call the tool
named in each pending REQUIRED step's ``howTo.tool`` and stop the moment
``summary.completable`` is true. No LLM is involved, so a run is repeatable and
its failures are the node's own words.

0.22.1: the driver READS the tool's answer. A tool returns a failure as a VALUE
(``{ok: false, error: {code, message}}`` from the connector's REST proxies,
``"CODE: message"`` text from the node's MCP tools), it does not raise; the
driver used to log the attempt before the call and nothing after it, so a step
that failed 15 times in a row left no trace of why, and the same call was made
again every round. Now every call logs its outcome with the node's message
verbatim, an identical call that fails with the same code twice ends the run
with that message in the OnboardingError, and a ``step_args`` override is
logged as such so a wrong override is visible as the cause it is.
"""
from __future__ import annotations

import json
import re
import time
from collections.abc import Callable, Mapping, Sequence
from typing import Any

# The frozen list of onboarding *confirm* tools. Every other step is completed by
# calling its mapped real tool (aimeat_message_send, aimeat_task_propose_todos ...),
# never an aimeat_onboarding_<stepId> tool -- those do not exist.
ONBOARDING_CONFIRM_TOOLS: tuple[str, ...] = (
    "aimeat_onboarding_status",
    "aimeat_onboarding_identify_platform",
    "aimeat_onboarding_confirm_skill_installed",
    "aimeat_onboarding_confirm_directives_read",
    "aimeat_onboarding_declare_services",
)


class OnboardingError(RuntimeError):
    """Raised when Hello Integration cannot be driven to completion deterministically.

    ``last_error`` carries the node's own message for the last failed call (or None), and
    ``last_step`` names the step it failed on, so a log line or a bug report has the cause and
    not only the symptom.
    """

    def __init__(self, message: str, *, last_error: str | None = None, last_step: str | None = None) -> None:
        super().__init__(message)
        self.last_error = last_error
        self.last_step = last_step


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


_ERROR_TEXT = re.compile(r"^\s*([A-Z][A-Z0-9_]{2,})\s*:\s*(.+)$", re.DOTALL)


def failure_of(result: Any) -> str | None:
    """The node's error text when ``result`` is a failure returned AS A VALUE, else None.

    Three shapes reach a driver: the connector's REST proxies answer with the AIMEAT envelope
    (``ok: false`` + ``error: {code, message}``); the node's MCP tools answer a refusal as text
    ``"CODE: message"`` (parsed here into ``{"_raw": ...}``); and a bare ``{code, message}`` object.
    Anything else is a result. The text is returned unchanged -- the node's message names both
    what went wrong and what would have been accepted, and rewording it is how a person ends up
    searching for a different error than the one in the log.
    """
    if isinstance(result, dict):
        if result.get("ok") is False or result.get("isError") is True:
            err = result.get("error")
            if isinstance(err, dict):
                code = err.get("code") or "ERROR"
                msg = err.get("message") or json.dumps(err)
                return f"{code}: {msg}"
            if isinstance(err, str):
                return err
            return result.get("message") or json.dumps(result)
        if "code" in result and "message" in result and "ok" not in result and len(result) <= 4:
            return f"{result['code']}: {result['message']}"
        raw = result.get("_raw")
        if isinstance(raw, str):
            m = _ERROR_TEXT.match(raw)
            if m:
                return raw.strip()
    return None


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


def _brief(args: Mapping[str, Any], limit: int = 160) -> str:
    """The call's arguments on one line, for a log that has to say WHAT was sent."""
    try:
        text = json.dumps(dict(args), ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        text = repr(dict(args))
    return text if len(text) <= limit else text[: limit - 1] + "…"


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

    A call's answer is read. A failure returned as a value is logged with the
    node's message verbatim (``[n] <step> -> <tool> FAILED: CODE: message``). The
    same call failing with the same code twice in a row ends the run at once with
    an :class:`OnboardingError` that carries that message: repeating it would be a
    loop, not a retry, and the node has already said what it wants.

    Args:
        tools: the liaison's tool objects (e.g. from :func:`liaison_tools` or a
            liaison agent's ``.tools``). Each must expose ``.name`` and
            ``.run(**kwargs)``.
        agent_name: the agent's bare name (used only for messages).
        step_args: optional per-stepId arg overrides; when given for a step it
            REPLACES that step's ``howTo.args`` (use to publish real capabilities
            / commands instead of the example templates the node ships). An
            override is logged as such, because an override that names the wrong
            task is indistinguishable from the node's own args otherwise.
        max_rounds: hard cap on status->act cycles (a stuck server cannot loop
            forever). Default comfortably exceeds the required-step count.
        sleep_seconds: optional pause between rounds (lets polling-based delivery
            register before re-checking).
        logger: optional callable for progress lines.

    Returns:
        the final status payload (``{onboarding, step_guide, summary, hints}``).

    Raises:
        OnboardingError: the status tool is missing, the contract names a tool
            this connector does not hold (node/connector out of sync), a step's
            call failed the same way twice, or completion is not reached within
            ``max_rounds``. ``last_error`` / ``last_step`` carry the cause.
    """
    log = logger or (lambda _m: None)
    step_args = step_args or {}

    status_tool = _tool_by_name(tools, "aimeat_onboarding_status")
    if status_tool is None:
        raise OnboardingError(
            "aimeat_onboarding_status is not in the toolset -- cannot drive onboarding."
        )

    last: dict[str, Any] = {}
    last_error: str | None = None
    last_step: str | None = None
    # (step, tool, args) -> the code the previous identical call failed with.
    failed_before: dict[str, str] = {}

    for round_no in range(1, max_rounds + 1):
        status = _call(status_tool, {})
        if not isinstance(status, dict):
            raise OnboardingError(f"aimeat_onboarding_status returned a non-object: {status!r}")
        status_failure = failure_of(status)
        if status_failure:
            raise OnboardingError(
                f"aimeat_onboarding_status failed: {status_failure}",
                last_error=status_failure, last_step="aimeat_onboarding_status",
            )
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
                f"(round {round_no}). summary={summary}",
                last_error=last_error, last_step=last_step,
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
                f"(node schema wins -- update the connector).",
                last_error=last_error, last_step=next_id,
            )

        hints = status.get("hints") or {}
        # Only a REAL id fills the placeholder; an absent hint leaves it in place so the check
        # below can see that the node has no task yet (an empty string would hide that).
        mapping = {"test_task_id": hints["test_task_id"]} if hints.get("test_task_id") else {}
        override = step_args.get(next_id)
        args = dict(override) if override is not None else _subst(how.get("args") or {}, mapping)
        source = "step_args override" if override is not None else "howTo.args"

        # The node substitutes {test_task_id} itself when the task exists; a placeholder still in
        # the args means the node has no task for this step yet, and no call can fill it.
        if override is None and "{test_task_id}" in json.dumps(args):
            log(f"[{round_no}] {next_id}: howTo.args still carry {{test_task_id}} and hints have no id -- the node has no test task yet; re-checking.")
            if sleep_seconds:
                time.sleep(sleep_seconds)
            continue

        key = json.dumps([next_id, tool_name, args], sort_keys=True, default=str)
        log(f"[{round_no}] {next_id} -> {tool_name} ({source}: {_brief(args)})")
        try:
            result = _call(tool, args)
        except Exception as exc:  # noqa: BLE001 -- report; the next status read confirms real state
            failure = f"{type(exc).__name__}: {exc}"
            log(f"[{round_no}] {next_id} -> {tool_name} raised: {failure}")
        else:
            failure = failure_of(result)
            if failure:
                log(f"[{round_no}] {next_id} -> {tool_name} FAILED: {failure}")
            else:
                log(f"[{round_no}] {next_id} -> {tool_name} ok")

        if failure:
            last_error, last_step = failure, next_id
            code = failure.split(":", 1)[0].strip()
            if failed_before.get(key) == code:
                raise OnboardingError(
                    f"Step '{next_id}' failed the same way twice ({tool_name} with {source}): {failure}",
                    last_error=failure, last_step=next_id,
                )
            failed_before[key] = code
        else:
            failed_before.pop(key, None)

        if sleep_seconds:
            time.sleep(sleep_seconds)

    raise OnboardingError(
        f"Hello Integration not completed within {max_rounds} rounds. "
        f"Last summary={last.get('summary')}"
        + (f". Last failure on '{last_step}': {last_error}" if last_error else ""),
        last_error=last_error, last_step=last_step,
    )

"""Regression for the 0.8.0 DM wake-consume bug.

The idle wait long-polls the wake queue (/local/dm/next for a dms agent), which CONSUMES the event off
the serve queue. In 0.8.0 `_wait_for_work` returned a bare bool and discarded the body, so for the
queue-only DM/record sources the single wake popped the event and the following drain found nothing —
on_dm never fired. 0.8.1 returns the consumed payload so the loop can hand the event to _handle_dm.
"""
from aimeat_crewai import daemon


class _Resp:
    def __init__(self, code, body=None):
        self.status_code = code
        self._body = body or {}

    def json(self):
        return self._body


class _Api:
    agent_name = "bot"

    def __init__(self, responses):
        self._responses = list(responses)

    def get(self, path, params=None, timeout=None):
        return self._responses.pop(0) if self._responses else _Resp(204)


def test_wait_for_work_returns_the_consumed_dm_event():
    # A 200 wake must return the payload `data` carrying the consumed dm.inbound event (not a bool),
    # so the caller can route it to _handle_dm instead of losing it.
    api = _Api([_Resp(200, {"data": {"event": {"id": "dm-1", "conversationId": "c1", "senderGhii": "x@n"}}})])
    out = daemon._wait_for_work(api, use_push=True, seconds=1.0, stop={"flag": False}, wake_path="/local/dm/next")
    assert isinstance(out, dict), f"expected the consumed payload dict, got {out!r}"
    assert out.get("event", {}).get("id") == "dm-1", f"event not carried through: {out!r}"


def test_wait_for_work_returns_none_on_timeout():
    # No event until the deadline -> None (the caller treats None as "no wake").
    api = _Api([_Resp(204)])
    out = daemon._wait_for_work(api, use_push=True, seconds=0.1, stop={"flag": False}, wake_path="/local/dm/next")
    assert out is None, f"expected None on timeout, got {out!r}"


def test_wait_for_work_task_wake_has_no_event_field():
    # A tasks wake returns {task, via} (no `event`), so the loop's `wake.get('event')` is falsy and it
    # does NOT misroute a task into _handle_dm — tasks keep their store-re-list path.
    api = _Api([_Resp(200, {"data": {"task": {"id": "t-1"}, "via": "deliver"}})])
    out = daemon._wait_for_work(api, use_push=True, seconds=1.0, stop={"flag": False}, wake_path="/local/tasks/next")
    assert isinstance(out, dict) and out.get("event") is None, f"task wake should carry no event: {out!r}"

"""The invoke listener (0.22.0): the node's server-initiated `invoke` reaches a crew through the serve
daemon's /local/invoke/next queue and the answer goes back on /local/invoke/<id>/result.

What is proved here, against a fake loopback: an invoke is collected and its handler's result posted
with ok=True; a raising handler answers ok=False HANDLER_ERROR with the message rather than nothing;
a (False, {...}) return refuses with the handler's own shape; a 404 from an older serve daemon ends
the loop as "unsupported" instead of spinning; and the stop flag ends it as "stopped".
"""
import threading
import time

from aimeat_crewai import daemon


class _Resp:
    def __init__(self, code, body=None):
        self.status_code = code
        self._body = body or {}

    def json(self):
        return self._body


class _Api:
    agent_name = "bot"
    # The real _Api carries both since 0.24.0: the NAME builds paths, the GAII routes.
    gaii = "bot"

    def __init__(self, gets):
        self._gets = list(gets)
        self.posts = []

    def get(self, path, params=None, timeout=None):
        assert path == "/local/invoke/next", path
        if self._gets:
            return self._gets.pop(0)
        return _Resp(204)

    def post(self, path, params=None, json=None, timeout=None):
        self.posts.append((path, json))
        return _Resp(200, {"ok": True})


def _invoke(id_, capability, input_):
    return _Resp(200, {"data": {"id": id_, "capability": capability, "input": input_, "caller": "alice@n", "timeout_ms": 30000}})


def _run(api, handler, stop_after=0.3):
    stop = {"flag": False}
    out = {}

    def _t():
        out["outcome"] = daemon.run_invoke_listener(api, handler, stop, wait_seconds=0.5)

    th = threading.Thread(target=_t)
    th.start()
    time.sleep(stop_after)
    stop["flag"] = True
    th.join(timeout=5)
    assert not th.is_alive(), "listener did not stop"
    return out.get("outcome")


def test_collects_an_invoke_and_posts_the_handlers_result():
    api = _Api([_invoke("i1", "crew.validate", {"doc": {"agent_name": "x"}})])
    seen = []

    def handler(capability, input_, invoke):
        seen.append((capability, input_, invoke["caller"]))
        return {"errors": []}

    assert _run(api, handler) == "stopped"
    assert seen == [("crew.validate", {"doc": {"agent_name": "x"}}, "alice@n")]
    assert api.posts == [("/local/invoke/i1/result", {"ok": True, "result": {"errors": []}})]


def test_a_raising_handler_answers_handler_error_not_silence():
    api = _Api([_invoke("i2", "crew.try", {"doc": {}, "prompt": "p"})])

    def handler(capability, input_, invoke):
        raise ValueError("no model configured")

    _run(api, handler)
    assert len(api.posts) == 1
    path, body = api.posts[0]
    assert path == "/local/invoke/i2/result"
    assert body["ok"] is False
    assert body["result"]["code"] == "HANDLER_ERROR"
    assert "no model configured" in body["result"]["message"]


def test_a_tuple_return_refuses_with_the_handlers_own_shape():
    api = _Api([_invoke("i3", "crew.try", {"doc": {}, "prompt": "p"})])

    def handler(capability, input_, invoke):
        return False, {"code": "INVALID", "message": "2 problems"}

    _run(api, handler)
    assert api.posts == [("/local/invoke/i3/result", {"ok": False, "result": {"code": "INVALID", "message": "2 problems"}})]


def test_an_older_serve_daemon_ends_the_loop_as_unsupported():
    api = _Api([_Resp(404)])
    outcome = _run(api, lambda c, i, inv: {}, stop_after=0.2)
    assert outcome == "unsupported"
    assert api.posts == []


def test_a_slow_handler_does_not_block_the_next_invoke():
    api = _Api([_invoke("slow", "crew.try", {}), _invoke("fast", "crew.validate", {})])
    order = []

    def handler(capability, input_, invoke):
        if invoke["id"] == "slow":
            time.sleep(0.4)
        order.append(invoke["id"])
        return {"ok": invoke["id"]}

    _run(api, handler, stop_after=0.8)
    assert order == ["fast", "slow"], order
    assert sorted(p[0] for p in api.posts) == ["/local/invoke/fast/result", "/local/invoke/slow/result"]

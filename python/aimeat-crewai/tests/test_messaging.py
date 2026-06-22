"""Tests for the interactive-message (federated AskUserQuestion) helpers."""
import pytest

from aimeat_crewai import build_question, ask, read_answers, answers_from_dm, AimeatMessagingError


class _Resp:
    def __init__(self, code=200, body=None):
        self.status_code = code
        self._body = body or {}
        self.text = ""

    def json(self):
        return self._body


class _FakeApi:
    """Records the last post; serves a canned response for get/post."""
    def __init__(self, post_resp=None, get_resp=None):
        self._post_resp = post_resp or _Resp(201, {"data": {"message": {"id": "m1", "conversationId": "c1"}}})
        self._get_resp = get_resp or _Resp(200, {"data": {"messages": []}})
        self.posted = None

    def post(self, path, json=None, **kw):
        self.posted = {"path": path, "json": json}
        return self._post_resp

    def get(self, path, **kw):
        self.got = path
        return self._get_resp


def test_build_question_normalises_option_forms():
    q = build_question(
        "auth", "Which auth?",
        [("oauth", "OAuth"), {"id": "pw", "label": "Password"}, "sso"],
        header="Auth", multi_select=True, allow_other=False, required=True,
    )
    assert q["id"] == "auth" and q["header"] == "Auth"
    assert q["multiSelect"] is True and q["allowOther"] is False and q["required"] is True
    assert q["options"] == [
        {"id": "oauth", "label": "OAuth"},
        {"id": "pw", "label": "Password"},
        {"id": "sso", "label": "sso"},
    ]


def test_build_question_requires_options():
    with pytest.raises(AimeatMessagingError):
        build_question("q", "no options", [])


def test_ask_builds_interactive_payload_and_returns_ids():
    api = _FakeApi()
    q = build_question("q1", "Pick one", [("a", "A"), ("b", "B")], required=True)
    out = ask(api, "alice@node", [q], body="intro", subject="Setup", submit_label="Go")
    assert out == {"message_id": "m1", "conversation_id": "c1"}
    sent = api.posted["json"]
    assert api.posted["path"] == "/v1/messages"
    assert sent["to"] == "alice@node" and sent["body"] == "intro" and sent["subject"] == "Setup"
    assert sent["interactive"]["role"] == "questions"
    assert sent["interactive"]["submitLabel"] == "Go"
    assert sent["interactive"]["questions"][0]["id"] == "q1"


def test_ask_requires_questions():
    with pytest.raises(AimeatMessagingError):
        ask(_FakeApi(), "alice@node", [])


def test_ask_raises_on_error_status():
    api = _FakeApi(post_resp=_Resp(400, {"error": {"message": "bad"}}))
    with pytest.raises(AimeatMessagingError):
        ask(api, "alice@node", [build_question("q", "p", ["a"])])


def test_read_answers_returns_latest_answers_newest_first():
    thread = _Resp(200, {"data": {"messages": [
        {"id": "q", "interactive": {"role": "questions", "questions": []}},
        {"id": "a1", "interactive": {"role": "answers", "answersFor": "q", "answers": {"q1": {"selected": ["a"], "other": None}}}},
        {"id": "a2", "interactive": {"role": "answers", "answersFor": "q", "answers": {"q1": {"selected": ["b"], "other": None}}}},
    ]}})
    api = _FakeApi(get_resp=thread)
    got = read_answers(api, "c1")
    assert got["message_id"] == "a2"  # newest wins
    assert got["answers"]["q1"]["selected"] == ["b"]
    assert got["answers_for"] == "q"


def test_read_answers_none_when_no_answer_yet():
    api = _FakeApi(get_resp=_Resp(200, {"data": {"messages": [
        {"id": "q", "interactive": {"role": "questions", "questions": []}},
    ]}}))
    assert read_answers(api, "c1") is None


def test_answers_from_dm_only_fetches_for_answer_wakes():
    api = _FakeApi(get_resp=_Resp(200, {"data": {"messages": [
        {"id": "a1", "interactive": {"role": "answers", "answersFor": "q", "answers": {"q1": {"selected": ["a"]}}}},
    ]}}))
    # A questions wake (or plain DM) must NOT trigger a thread fetch.
    assert answers_from_dm(api, {"interactive": "questions", "conversationId": "c1"}) is None
    assert answers_from_dm(api, {"conversationId": "c1"}) is None
    # An answers wake fetches the structured picks.
    got = answers_from_dm(api, {"interactive": "answers", "conversationId": "c1"})
    assert got is not None and got["answers"]["q1"]["selected"] == ["a"]

"""
Integration tests: the decide feature against a REAL AIMEAT node.

WHAT IS REAL HERE. A real node process with a real database, the real decide service, the real
scrubber, the real rule store, the real gate, the real decision register, and the package's own
public functions calling all of it over REST. Nothing on the node side is faked.

THE ONE STAND-IN IS TYPESAFE, and it has to be. A decision is a paid call to somebody else's model:
a suite that spent real money every time it ran would be a suite nobody runs, and pinning assertions
to a live model's answers would make them flaky for a reason that has nothing to do with this code.
So `JevStub` speaks Jev's wire shape on loopback and the node is pointed at it with
AIMEAT_DECIDE_BASE_URL. Every line of the node's path still runs -- the shape check, the data-map
rule, the budget, the scrubber, the cache, the key resolution, the record -- and the stub lets a
test say "the model was 97 % sure" and assert what the RULE then did with that.

Setting the answers is what makes the interesting cases testable at all: an outcome under the act
band, a gate that holds an action, a threshold that is missed. Against a live model those are
whatever it happens to think today.

WHAT THE STUB ALSO CATCHES, by being a server rather than a mock: what actually left the node.
`jev.requests` holds the real body, so a test can assert that only the fields the rule names were
sent, that the questions were the owner's, and that the key was the owner's rather than the agent's.
A mock inside the process could not see that, because by then it has already left.

Skipped unless `node` is on PATH and the repo's `aimeat/node_modules` is installed -- the node is
spawned from source via `node --import tsx src/index.ts`, and without its dependencies it exits
immediately with a message about tsx, which reads as a broken test rather than a missing setup.
"""
from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest
import requests

REPO_ROOT = Path(__file__).resolve().parents[3]
AIMEAT_DIR = REPO_ROOT / "aimeat"
NODE_ID = "aimeat-local-001-dev"
AGENT = "decidecrew"

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None
    or not (AIMEAT_DIR / "src" / "index.ts").is_file()
    or not (AIMEAT_DIR / "node_modules").is_dir(),
    reason="needs node on PATH, the aimeat-protocol checkout, and `pnpm install` in aimeat/",
)


# ── helpers ───────────────────────────────────────────────────────────────────────────────────


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _node_sign(priv: str, message: str) -> str:
    """Ed25519 via the node's own @noble/ed25519, so the tests need no Python crypto dependency."""
    code = (
        "import * as ed from '@noble/ed25519';"
        "const [priv, msg] = process.argv.slice(1);"
        "const sig = await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(priv, 'base64'));"
        "console.log(Buffer.from(sig).toString('base64'));"
    )
    out = subprocess.run(
        ["node", "--input-type=module", "-e", code, priv, message],
        cwd=AIMEAT_DIR, capture_output=True, text=True, timeout=90, check=True,
    )
    return out.stdout.strip()


def _auth_token(base: str, ident: str, priv: str, *, is_agent: bool) -> str:
    ts = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    msg = (ident + ts) if is_agent else (ident + NODE_ID + ts)
    key = "gaii" if is_agent else "owner"
    body = requests.post(
        f"{base}/v1/auth/token",
        json={key: ident, "timestamp": ts, "signature": _node_sign(priv, msg)},
        timeout=20,
    ).json()
    assert body.get("ok") is True, f"auth token failed: {body}"
    return body["data"]["token"]


class JevStub:
    """A loopback server speaking TypeSafe Jev's wire shape.

    `answers` steers what the model "decided"; `requests` keeps every body it received, which is how
    a test sees what actually left the node.
    """

    def __init__(self) -> None:
        self.port = _free_port()
        self.answers: dict = {}
        self.requests: list[dict] = []
        stub = self

        class _H(BaseHTTPRequestHandler):
            def log_message(self, *_a):
                pass  # the node's own log is noisy enough

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                stub.requests.append({"body": body, "auth": self.headers.get("Authorization")})
                out = {
                    "model": body.get("model", "jev-stub"),
                    # A question with no configured answer gets a middling yes/no, so a test only
                    # has to set the answers it actually cares about.
                    "answers": {
                        qid: stub.answers.get(qid, {"type": "noul", "noul": 0.5})
                        for qid in body.get("questions", {})
                    },
                    "usage": {"input_tokens": 100, "output_tokens": 0},
                    "request_id": f"stub-{len(stub.requests)}",
                }
                raw = json.dumps(out).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

        self.httpd = HTTPServer(("127.0.0.1", self.port), _H)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}/v1/systemone"

    def stop(self) -> None:
        self.httpd.shutdown()


class Live:
    """Everything a test needs to talk to the running node."""

    def __init__(self) -> None:
        self.base = ""
        self.owner = ""
        self.gaii = ""
        self.owner_headers: dict = {}
        self.agent_token = ""
        self.jev: JevStub | None = None
        self.proc: subprocess.Popen | None = None

    @property
    def kw(self) -> dict:
        """The keyword arguments every public function in `decide` takes."""
        return {"agent_name": AGENT, "node_url": self.base, "agent_token": self.agent_token}


RULE_QUESTIONS = {
    "safe": {"type": "noul", "instructions": "The message is safe to handle automatically."},
    "queue": {
        "type": "choice",
        "instructions": "Which queue does this belong in?",
        "criteria": {"billing": "About money", "bug": "Something is broken", "other": "Neither"},
    },
}


def _put_rule(live: Live, rule_id: str, title: str, decides: str, *, gate: bool) -> None:
    body = {
        "title": title, "decides": decides, "sends": ["subject", "body"],
        "questions": RULE_QUESTIONS,
        "thresholds": {"safe": 0.7},
        "bands": {"act": 0.9, "ask": 0.5},
        "use": "agent", "gate": gate,
        "sample": {"subject": "a subject", "body": "a body"},
    }
    r = requests.put(f"{live.base}/v1/ai/decide/rules/{rule_id}", headers=live.owner_headers, json=body, timeout=20)
    assert r.json().get("ok") is True, f"put rule {rule_id}: {r.text}"


@pytest.fixture(scope="module")
def live(tmp_path_factory: pytest.TempPathFactory):
    """One node, one owner, one agent and two rules, for the whole module."""
    e = Live()
    e.jev = JevStub()
    tmp = tmp_path_factory.mktemp("decide-live")
    port = _free_port()
    e.base = f"http://localhost:{port}"
    e.owner = f"decideowner{int(time.time())}"

    e.proc = subprocess.Popen(
        ["node", "--import", "tsx", "src/index.ts", "start",
         "--db", "sqlite", "--db-path", str(tmp / "node.db"), "--port", str(port)],
        cwd=AIMEAT_DIR,
        env={
            **os.environ,
            "AIMEAT_PORT": str(port), "AIMEAT_BASE_URL": e.base,
            "AIMEAT_DEFAULT_AGENT_SCOPES": "*",
            # The decision model is this test's own loopback stub, and loopback egress has to be
            # allowed for the node's SSRF guard to let it out at all.
            "AIMEAT_DECIDE_ENABLED": "true",
            "AIMEAT_DECIDE_BASE_URL": e.jev.url,
            "AIMEAT_ALLOW_PRIVATE_EGRESS": "true",
            # The owner's own key is stored encrypted, so the node needs a key to encrypt it with.
            "AIMEAT_ENCRYPTION_KEY": "0" * 64,
            # OFF: these tests ask the same question twice on purpose, and a cache hit would answer
            # the second one without the stub ever seeing it.
            "AIMEAT_DECIDE_CACHE_HOURS": "0",
            "AIMEAT_RL_GLOBAL": "100000", "AIMEAT_RL_AUTH": "10000",
            "AIMEAT_RL_WORK": "10000", "AIMEAT_RL_MEMORY": "10000",
            "AIMEAT_RL_OPENROUTER": "10000",
        },
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )

    try:
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            if e.proc.poll() is not None:
                pytest.fail(f"node exited early with code {e.proc.returncode}")
            try:
                with urllib.request.urlopen(f"{e.base}/v1/spec", timeout=2) as r:
                    if r.status == 200:
                        break
            except OSError:
                time.sleep(0.3)
        else:
            pytest.fail("node did not become ready within 120 s")

        r = requests.post(f"{e.base}/v1/owners", json={"name": e.owner, "public_key": "placeholder"}, timeout=20)
        assert r.status_code == 201, f"owner register: {r.status_code} {r.text}"
        owner_token = _auth_token(e.base, e.owner, r.json()["data"]["private_key"], is_agent=False)
        e.owner_headers = {"Authorization": f"Bearer {owner_token}"}

        r = requests.post(
            f"{e.base}/v1/agents", headers=e.owner_headers,
            json={"name": AGENT, "owner": e.owner, "capabilities": ["memory", "actions"], "scopes": ["*"]},
            timeout=20,
        )
        assert r.status_code == 201, f"agent register: {r.status_code} {r.text}"
        e.gaii = r.json()["data"]["agent"]["gaii"]
        e.agent_token = _auth_token(e.base, e.gaii, r.json()["data"]["private_key"], is_agent=True)

        # The owner brings their own key, which is the `own` key scope and needs no allowance.
        r = requests.put(f"{e.base}/v1/ai/decide/settings", headers=e.owner_headers,
                         json={"api_key": "stub-key-abc123"}, timeout=20)
        assert r.json().get("ok") is True, f"set decide key: {r.text}"

        _put_rule(e, "sort-a-message", "Sort an incoming message", "which queue it goes to", gate=False)
        # Its own gate default is ON, which is what makes the node hold an action for this agent
        # without anybody touching the per-agent switch.
        _put_rule(e, "send-a-reply", "Send a reply unread", "whether the reply is sent unread", gate=True)

        yield e
    finally:
        if e.jev:
            e.jev.stop()
        if e.proc and e.proc.poll() is None:
            e.proc.kill()
            e.proc.wait(timeout=20)


@pytest.fixture
def answers(live: Live):
    """Set the model's answers for one test, and leave nothing behind for the next."""
    def _set(**by_id):
        live.jev.answers = dict(by_id)
    yield _set
    live.jev.answers = {}


def _sure(p: float = 0.97, choice: str = "billing", confidence: float = 0.95) -> dict:
    return {
        "safe": {"type": "noul", "noul": p},
        "queue": {"type": "choice", "choice": choice, "confidence": confidence,
                  "probabilities": {"billing": confidence, "bug": 1 - confidence, "other": 0.0}},
    }


# ── what the owner allows ─────────────────────────────────────────────────────────────────────


def test_settings_says_the_model_is_available_and_names_this_agent(live: Live):
    from aimeat_crewai import settings

    s = settings(**live.kw)
    assert s["available"] is True, s.get("unavailable_reason")
    assert s["agent"]["name"] == AGENT
    assert len(s["setup_order"]) == 6, "the one order everything is set up in"


def test_the_agent_sees_the_rules_its_owner_wrote_for_agents(live: Live):
    from aimeat_crewai import rules

    got = {r["id"]: r for r in rules(**live.kw)}
    assert set(got) == {"sort-a-message", "send-a-reply"}
    assert got["sort-a-message"]["sends"] == ["subject", "body"]
    assert got["sort-a-message"]["decides"] == "which queue it goes to"


# ── tools minted from real rules ──────────────────────────────────────────────────────────────


def test_one_tool_is_minted_per_rule_with_the_owners_own_words(live: Live):
    from aimeat_crewai import decide_tools

    tools = {t.name: t for t in decide_tools(**live.kw)}
    assert set(tools) == {"decide_sort_a_message", "decide_send_a_reply"}
    tool = tools["decide_sort_a_message"]
    assert set(tool.args_schema.model_fields) == {"subject", "body"}, "the input IS the rule's sends"
    assert set(tool.args_schema.model_fields).isdisjoint({"questions", "thresholds", "bands"}), (
        "the owner's numbers must not be expressible by the agent"
    )
    assert "Sort an incoming message" in tool.description


def test_running_a_minted_tool_makes_a_real_recorded_decision(live: Live, answers):
    from aimeat_crewai import decide_tools
    from aimeat_crewai.decide import decision

    answers(**_sure())
    tool = next(t for t in decide_tools(**live.kw) if t.name == "decide_sort_a_message")
    out = json.loads(tool.run(subject="Invoice 4471", body="charged twice, please refund"))

    assert out["outcome"] == "act" and out["proceed"] is True
    assert out["answers"]["queue"]["value"] == "billing", "real option names come back, not scrubbed ones"

    row = decision(out["decision_id"], **live.kw)
    assert row["principal"] == live.gaii, "the decision is recorded against the agent that asked"
    assert row["rule"] == "sort-a-message"
    assert row["outcome"] == "act"
    assert row["record"]["thresholds"] == {"safe": 0.7}, "the owner's thresholds are on the record"
    assert isinstance(row["record"]["scrub"], dict), "the scrubber ran"


# ── the two refusals that make a rule a rule ──────────────────────────────────────────────────


def test_a_state_field_the_rule_does_not_name_is_refused(live: Live, answers):
    from aimeat_crewai.decide import DecideRefused, decide

    answers(**_sure())
    with pytest.raises(DecideRefused) as caught:
        decide({"subject": "s", "sender_email": "a@b.c"}, rule="sort-a-message", **live.kw)
    assert caught.value.code == "STATE_OUTSIDE_RULE"
    assert "sender_email" in caught.value.node_message


def test_questions_sent_beside_a_rule_are_refused_by_the_node(live: Live):
    # The package refuses this before it sends, so the check goes straight at the door to prove the
    # NODE refuses it too -- the guarantee has to hold for any caller, not just this client.
    body = {"state": {"subject": "s"}, "rule": "sort-a-message",
            "questions": {"x": {"type": "noul", "instructions": "anything"}}}
    r = requests.post(f"{live.base}/v1/ai/decide",
                      headers={"Authorization": f"Bearer {live.agent_token}"}, json=body, timeout=20).json()
    assert r["ok"] is False
    assert r["error"]["code"] == "RULE_FIXES_QUESTIONS"


# ── the gate ──────────────────────────────────────────────────────────────────────────────────


def test_with_the_gate_off_the_crew_acts_and_the_decision_is_still_recorded(live: Live, answers):
    from aimeat_crewai import gate

    answers(**_sure(p=0.75, choice="bug", confidence=0.60))
    v = gate("sort-a-message", {"subject": "s", "body": "b"}, on=False, **live.kw)
    assert v.proceed is True, "off by default, so a comparison run can run unguarded"
    assert v.band == "ask", "the band still fired and is still reported"
    assert v.decision_id


def test_the_local_gate_holds_the_action_and_says_nobody_was_told(live: Live, answers):
    from aimeat_crewai import gate

    answers(**_sure(p=0.75, choice="bug", confidence=0.60))
    v = gate("sort-a-message", {"subject": "s2", "body": "b2"}, on=True, **live.kw)
    assert v.proceed is False
    assert v.task is None
    # This package cannot raise the owner's item (/v1/open-items is owner-only), so it must not
    # imply that it did.
    assert "nothing was added to the owner's list" in v.report()
    assert v.decision_id in v.report()


def test_the_nodes_own_gate_holds_the_action_and_puts_it_on_the_owners_list(live: Live, answers):
    from aimeat_crewai import gate

    answers(**_sure(p=0.75, choice="bug", confidence=0.60))
    # `on=False`: the LOCAL gate is off, and the node's own gate must still be obeyed.
    v = gate("send-a-reply", {"subject": "s3", "body": "b3"}, on=False, **live.kw)
    assert v.proceed is False, "an agent may not act against a recorded proceed:false"
    assert v.node_gate_on is True
    assert v.task, "the node raised an open item"
    assert "owner's list" in v.report()

    items = requests.get(f"{live.base}/v1/open-items", headers=live.owner_headers, timeout=20).json()
    rows = items["data"]["items"]
    mine = [i for i in rows if (i.get("object") or {}).get("id") == v.decision_id]
    assert len(mine) == 1, "the held decision is really on the owner's list"
    assert AGENT in mine[0]["title"]
    assert "whether the reply is sent unread" in mine[0]["title"], "the owner reads what it decides"


def test_a_person_can_confirm_or_override_a_decision(live: Live, answers):
    from aimeat_crewai import gate
    from aimeat_crewai.decide import decision, review

    answers(**_sure(p=0.75, choice="bug", confidence=0.60))
    v = gate("send-a-reply", {"subject": "s4", "body": "b4"}, on=False, **live.kw)

    review(v.decision_id, "overridden", note="Sent it by hand.", **live.kw)
    rev = decision(v.decision_id, **live.kw)["record"]["review"]
    assert rev["outcome"] == "overridden"
    assert rev["note"] == "Sent it by hand."
    assert rev["by"].startswith(AGENT), "who gave the verdict is on the record"


# ── the numbers thresholds are tuned from ─────────────────────────────────────────────────────


def test_decision_stats_counts_what_really_happened(live: Live, answers):
    from aimeat_crewai import gate
    from aimeat_crewai.decide import decision_stats, review

    # This test makes its own history rather than leaning on the tests above, so it does not depend
    # on the order they ran in.
    answers(**_sure())
    before = {g["key"]: g for g in decision_stats(group_by="rule", **live.kw)}
    start = before.get("send-a-reply", {}).get("decisions", 0)
    start_stops = before.get("send-a-reply", {}).get("gateStops", 0)
    start_over = before.get("send-a-reply", {}).get("overridden", 0)

    answers(**_sure(p=0.75, choice="bug", confidence=0.60))
    v = gate("send-a-reply", {"subject": "s5", "body": "b5"}, on=False, **live.kw)
    review(v.decision_id, "overridden", **live.kw)

    after = {g["key"]: g for g in decision_stats(group_by="rule", **live.kw)}
    g = after["send-a-reply"]
    assert g["decisions"] == start + 1
    assert g["gateStops"] == start_stops + 1, "a gate stop is counted as one"
    assert g["overridden"] == start_over + 1
    assert set(g["outcomes"]) == {"act", "ask", "stop"}
    assert isinstance(g["costUsd"], (int, float))
    assert g["lastAt"]


def test_decision_stats_groups_by_principal_too(live: Live, answers):
    from aimeat_crewai.decide import decide, decision_stats

    answers(**_sure())
    decide({"subject": "s", "body": "b"}, rule="sort-a-message", **live.kw)
    groups = {g["key"]: g for g in decision_stats(group_by="principal", **live.kw)}
    assert live.gaii in groups, f"this agent should have its own row: {list(groups)}"
    assert groups[live.gaii]["decisions"] >= 1


def test_decision_stats_can_narrow_to_one_agents_share_of_one_rule(live: Live, answers):
    from aimeat_crewai.decide import decision_stats

    groups = decision_stats(group_by="rule", rule_id="sort-a-message", principal=live.gaii, **live.kw)
    assert [g["key"] for g in groups] == ["sort-a-message"]


# ── what actually left the node ───────────────────────────────────────────────────────────────


def test_only_the_fields_the_rule_names_ever_leave_the_node(live: Live, answers):
    from aimeat_crewai.decide import decide

    answers(**_sure())
    decide({"subject": "Invoice 4471", "body": "charged twice"}, rule="sort-a-message", **live.kw)

    sent = live.jev.requests[-1]
    assert set(sent["body"]["state"]) <= {"subject", "body"}
    assert set(sent["body"]["questions"]) == {"safe", "queue"}, "the owner's questions, not the caller's"
    assert sent["auth"] == "Bearer stub-key-abc123", "the owner's key paid, and the agent never held it"
    assert sent["body"]["model"] == "jev-1.13.0", "the pinned model id, not an alias"


def test_the_scrubber_removes_personal_data_before_it_leaves(live: Live, answers):
    # The rule's `sends` allows `body`, so this reaches the scrubber rather than being refused --
    # which is the point: the node cleans what it is allowed to receive.
    from aimeat_crewai.decide import decide

    answers(**_sure())
    d = decide(
        {"subject": "Refund", "body": "Write to anna.virtanen@example.com or call +358 40 1234567."},
        rule="sort-a-message", **live.kw,
    )
    leaving = json.dumps(live.jev.requests[-1]["body"]["state"])
    assert "anna.virtanen@example.com" not in leaving, "an e-mail address must not reach the provider"
    assert "+358 40 1234567" not in leaving, "nor a phone number"
    assert d.scrub["total"] >= 1, f"and the report says what was taken out: {d.scrub}"


# ── direct mode ───────────────────────────────────────────────────────────────────────────────


def test_direct_mode_bypasses_the_node_warns_once_and_keeps_its_own_log(live: Live, answers, tmp_path, capsys, monkeypatch):
    import importlib

    decide_mod = importlib.import_module("aimeat_crewai.decide")
    monkeypatch.setattr(decide_mod, "_direct_warned", False)
    monkeypatch.setenv("AIMEAT_DECIDE_DIRECT", "1")
    monkeypatch.setenv("AIMEAT_HOME", str(tmp_path))
    monkeypatch.setenv("AIMEAT_DECIDE_KEY_ENV", "TEST_TS_KEY")
    monkeypatch.setenv("TEST_TS_KEY", "a-key-on-this-machine")
    monkeypatch.setenv("AIMEAT_DECIDE_BASE_URL", live.jev.url)

    rule_doc = requests.get(f"{live.base}/v1/ai/decide/rules/sort-a-message",
                            headers=live.owner_headers, timeout=20).json()["data"]["rule"]
    answers(**_sure(p=0.99, confidence=0.98))
    d = decide_mod.decide({"subject": "x", "body": "y"}, rule="sort-a-message", direct_rule=rule_doc)

    assert d.direct is True and d.key_source == "direct"
    assert d.outcome == "act", "the bands are applied locally, by the same arithmetic"
    assert live.jev.requests[-1]["auth"] == "Bearer a-key-on-this-machine", "the machine's own key"

    printed = capsys.readouterr().out
    for loss in ("does NOT scrub", "NOT on the owner's register", "no daily cap", "NOT reused"):
        assert loss in printed, f"direct mode must say it loses this: {loss}"

    log = decide_mod.read_direct_log()
    assert len(log) == 1
    assert log[0]["scrubbed"] is False, "the log records that nothing was scrubbed"
    assert log[0]["answers"]["safe"]["value"] == 0.99


def test_a_direct_log_can_be_pushed_to_a_node_afterwards(live: Live, answers, tmp_path, monkeypatch):
    import importlib

    decide_mod = importlib.import_module("aimeat_crewai.decide")
    monkeypatch.setattr(decide_mod, "_direct_warned", False)
    monkeypatch.setenv("AIMEAT_HOME", str(tmp_path))
    monkeypatch.setenv("AIMEAT_DECIDE_KEY_ENV", "TEST_TS_KEY")
    monkeypatch.setenv("TEST_TS_KEY", "a-key-on-this-machine")
    monkeypatch.setenv("AIMEAT_DECIDE_BASE_URL", live.jev.url)
    monkeypatch.setenv("AIMEAT_DECIDE_DIRECT", "1")

    rule_doc = requests.get(f"{live.base}/v1/ai/decide/rules/sort-a-message",
                            headers=live.owner_headers, timeout=20).json()["data"]["rule"]
    answers(**_sure())
    decide_mod.decide({"subject": "x", "body": "y"}, rule="sort-a-message", direct_rule=rule_doc)

    monkeypatch.delenv("AIMEAT_DECIDE_DIRECT")
    out = decide_mod.push_direct_log(**live.kw)
    assert out["pushed"] == 1

    r = requests.get(f"{live.base}/v1/memory/agents.{AGENT}.decide.direct-log",
                     headers={"Authorization": f"Bearer {live.agent_token}"}, timeout=20).json()
    value = json.dumps(r["data"])
    assert "aimeat.decision-log/v1-direct" in value
    # It must NOT read as a row on the decision register: the owner's quality numbers would then
    # look as though the scrubber and the cap had been in force.
    assert "not on the decision register" in value


# ── the Crew tab's rows, when the crewaimeat runtime is present ───────────────────────────────


def test_crew_menu_lists_the_owners_rules(live: Live):
    """crewfive's `crew.menu` rows, against this node. Skipped where crewaimeat is not installed --
    it lives in the sibling repo, so this runs on a fleet machine and not in this repo's CI."""
    pytest.importorskip("crewaimeat", reason="crewaimeat (crewfive) is not on the path")
    from crewaimeat.crew_invoke import _decide_rule_rows

    old = (os.environ.get("AIMEAT_NODE_URL"), os.environ.get("AIMEAT_AGENT_TOKEN"))
    os.environ["AIMEAT_NODE_URL"] = live.base
    os.environ["AIMEAT_AGENT_TOKEN"] = live.agent_token
    try:
        rows = {r["id"]: r["purpose"] for r in _decide_rule_rows(AGENT)}
    finally:
        for name, value in zip(("AIMEAT_NODE_URL", "AIMEAT_AGENT_TOKEN"), old):
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    assert set(rows) == {"decide:sort-a-message", "decide:send-a-reply"}
    assert "Sort an incoming message" in rows["decide:sort-a-message"]
    assert "which queue it goes to" in rows["decide:sort-a-message"]


def test_the_menu_degrades_to_no_rule_rows_when_the_node_cannot_be_reached(capsys):
    """The menu's job is to let a person pick a tool, so an unreachable node must cost the decision
    rows and nothing else -- and must say so rather than going quiet."""
    pytest.importorskip("crewaimeat", reason="crewaimeat (crewfive) is not on the path")
    from crewaimeat.crew_invoke import _decide_rule_rows

    old = os.environ.get("AIMEAT_NODE_URL")
    os.environ["AIMEAT_NODE_URL"] = f"http://127.0.0.1:{_free_port()}"
    try:
        assert _decide_rule_rows(AGENT) == []
    finally:
        if old is None:
            os.environ.pop("AIMEAT_NODE_URL", None)
        else:
            os.environ["AIMEAT_NODE_URL"] = old
    assert "decision rules not listed" in capsys.readouterr().out

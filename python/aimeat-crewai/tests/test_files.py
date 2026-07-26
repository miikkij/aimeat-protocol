"""Tests for the file helpers -- getting a document to and from an agent.

The behaviours worth pinning are the ones that were wrong before this module existed: a bare key must
be read from the agent's OWN namespace while an owner-prefixed reference goes through the consent-gated
/v1/pub door, a refused read must say so rather than look empty, and bytes must never be routed through
the loopback (they are fetched from the presigned URL instead).
"""
import pytest

from aimeat_crewai import (
    AimeatFileError,
    attachments_of,
    delegate_file,
    file_handle,
    inbox_files,
    read_file,
    split_ref,
    task_files,
    upload_file,
)


class _Resp:
    def __init__(self, code=200, body=None, text=""):
        self.status_code = code
        self._body = body or {}
        self.text = text

    def json(self):
        return self._body


class _FakeApi:
    def __init__(self, get_resp=None, post_resp=None):
        self._get_resp = get_resp or _Resp(200, {"data": {}})
        self._post_resp = post_resp or _Resp(201, {"data": {}})
        self.got = None
        self.posted = None

    def get(self, path, **kw):
        self.got = path
        return self._get_resp

    def post(self, path, json=None, **kw):
        self.posted = {"path": path, "json": json}
        return self._post_resp


def _handle_resp(url="https://node.example/v1/download/tok", mime="application/pdf", size=12):
    return _Resp(200, {"data": {
        "ref": "alice@n1/invoices/x.pdf", "owner_gaii": "alice@n1", "key": "invoices/x.pdf",
        "mime_type": mime, "size": size, "download_url": url, "expires_in_seconds": 900,
    }})


def test_split_ref_only_treats_an_identity_as_an_owner():
    assert split_ref("alice@node-1/invoices/x.pdf") == ("alice@node-1", "invoices/x.pdf")
    assert split_ref("ext:prh/cache/x.json") == ("ext:prh", "cache/x.json")
    # A plain path must NOT be mistaken for owner + key.
    assert split_ref("invoices/2026/x.pdf") == ("", "invoices/2026/x.pdf")
    assert split_ref("x.pdf") == ("", "x.pdf")


def test_file_handle_routes_owner_refs_to_pub_and_bare_keys_to_storage():
    api = _FakeApi(get_resp=_handle_resp())
    file_handle(api, "alice@n1/invoices/x.pdf")
    assert api.got == "/v1/pub/alice%40n1/invoices/x.pdf?mode=handle"

    api2 = _FakeApi(get_resp=_handle_resp())
    file_handle(api2, "invoices/x.pdf")
    assert api2.got == "/v1/storage/invoices/x.pdf?mode=handle"


def test_file_handle_explains_a_refusal_and_a_miss():
    denied = _FakeApi(get_resp=_Resp(403, {}))
    with pytest.raises(AimeatFileError, match="visibility='owner'"):
        file_handle(denied, "alice@n1/invoices/x.pdf")

    # A bare key that misses gets the namespace hint; that mistake is the common one.
    missing = _FakeApi(get_resp=_Resp(404, {}))
    with pytest.raises(AimeatFileError, match="owner@node"):
        file_handle(missing, "invoices/x.pdf")


def test_read_file_fetches_the_presigned_url_not_the_loopback(monkeypatch):
    payload = b"%PDF-1.7\n\xff\xfe\x00\x80binary\n"
    calls = {}

    class _Streamed:
        status_code = 200

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def iter_content(self, _n):
            yield payload

    def fake_get(url, **kw):
        calls["url"] = url
        return _Streamed()

    monkeypatch.setattr("aimeat_crewai.files.requests.get", fake_get)
    api = _FakeApi(get_resp=_handle_resp(size=len(payload)))
    data, mime = read_file(api, "alice@n1/invoices/x.pdf")

    assert data == payload, "bytes must survive verbatim (a UTF-8 round trip would mangle them)"
    assert mime == "application/pdf"
    assert calls["url"] == "https://node.example/v1/download/tok"


def test_read_file_refuses_an_oversized_file_before_downloading(monkeypatch):
    def boom(*a, **kw):  # pragma: no cover - must not be reached
        raise AssertionError("download attempted despite the size cap")

    monkeypatch.setattr("aimeat_crewai.files.requests.get", boom)
    api = _FakeApi(get_resp=_handle_resp(size=10_000))
    with pytest.raises(AimeatFileError, match="limit"):
        read_file(api, "alice@n1/invoices/x.pdf", max_bytes=1_000)


def test_upload_file_defaults_to_owner_visibility():
    api = _FakeApi(post_resp=_Resp(201, {"data": {
        "key": "out/report.pdf", "owner_gaii": "crew#alice@n1", "visibility": "owner", "size": 3,
    }}))
    got = upload_file(api, "out/report.pdf", b"abc", mime="application/pdf")
    assert api.posted["json"]["visibility"] == "owner"
    assert got["ref"] == "crew#alice@n1/out/report.pdf"


def test_attachments_of_accepts_both_rest_and_mcp_shapes():
    rest = {"id": "m1", "conversationId": "c1", "attachments": [
        {"storageKey": "dm-out/x.pdf", "ownerGhii": "alice@n1", "mime": "application/pdf", "name": "x.pdf"},
    ]}
    mcp = {"id": "m2", "attachments": [
        {"ref": "alice@n1/dm-out/y.pdf", "storage_key": "dm-out/y.pdf", "owner_ghii": "alice@n1", "mime": "image/png"},
    ]}
    assert attachments_of(rest)[0]["ref"] == "alice@n1/dm-out/x.pdf"
    assert attachments_of(rest)[0]["message_id"] == "m1"
    assert attachments_of(mcp)[0]["ref"] == "alice@n1/dm-out/y.pdf"
    # An attachment with no key at all is skipped rather than yielding a broken reference.
    assert attachments_of({"attachments": [{"mime": "application/pdf"}]}) == []


def test_inbox_files_flattens_every_message():
    api = _FakeApi(get_resp=_Resp(200, {"data": {"messages": [
        {"id": "m1", "attachments": [{"storageKey": "a.pdf", "ownerGhii": "alice@n1", "mime": "application/pdf"}]},
        {"id": "m2", "attachments": []},
        {"id": "m3", "attachments": [{"ref": "alice@n1/b.pdf", "mime": "application/pdf"}]},
    ]}}))
    files = inbox_files(api)
    assert [f["ref"] for f in files] == ["alice@n1/a.pdf", "alice@n1/b.pdf"]


def test_task_files_keeps_the_access_verdict():
    task = {"resources": {"files": [
        {"ref": "alice@n1/a.pdf", "access": "granted", "download_url": "https://x/y"},
        {"ref": "alice@n1/b.pdf", "access": "denied", "reason": "consent_denied"},
        {"nope": True},
    ]}}
    files = task_files(task)
    assert len(files) == 2
    assert files[1]["access"] == "denied" and files[1]["reason"] == "consent_denied"


def test_delegate_file_sends_refs_as_task_resources():
    api = _FakeApi(post_resp=_Resp(201, {"data": {"task": {"id": "t1"}}}))
    task = delegate_file(api, "doc-crew", "Read it", ref="alice@n1/invoices/x.pdf")
    assert api.posted["path"] == "/v1/agents/doc-crew/tasks"
    assert api.posted["json"]["resources"]["files"] == [{"ref": "alice@n1/invoices/x.pdf"}]
    assert task["id"] == "t1"


def test_delegate_file_surfaces_a_refused_attachment():
    api = _FakeApi(post_resp=_Resp(403, {}, text='{"error":{"code":"FILE_ACCESS_DENIED"}}'))
    with pytest.raises(AimeatFileError, match="FILE_ACCESS_DENIED"):
        delegate_file(api, "doc-crew", "Read it", ref="bob@n1/secret.pdf")

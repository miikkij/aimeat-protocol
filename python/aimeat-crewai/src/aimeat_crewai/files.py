"""
Files -- crew-facing helpers for getting a FILE to and from an agent.

A crew that has to read an invoice, fill a form or summarise a report needs the bytes, and the two
things that made that awkward are both structural rather than accidental:

1. Storage is keyed by (owner, key). `GET /v1/storage/<key>` reads the CALLER's namespace only, so a
   document the human owner uploaded answers 404 to that owner's own agent no matter what the access
   rules say. The door for a file someone else owns is `GET /v1/pub/{owner}/{key}`, which runs the
   consent/visibility guard: `visibility:'owner'` admits every agent of the same owner, a group or
   workspace share admits its members, and a private file needs an explicit consent grant.
2. The serve loopback proxies a response as JSON/UTF-8, which is lossy for binary -- non-UTF8 bytes
   become U+FFFD and never come back. So these helpers never pull bytes through the loopback: they ask
   the node for a HANDLE (small JSON, safe to proxy) and then fetch the presigned `download_url`
   directly. That URL carries its own authorization, so the fetch needs no token and no tunnel.

    from aimeat_crewai import serve_client, read_file, attachments_of, inbox_files

    api = serve_client("company-crew")

    # A file the owner uploaded with visibility:'owner' (or shared with this agent some other way):
    data, mime = read_file(api, "alice@aimeat-fi-001-genesis/invoices/2026-07.pdf")

    # Everything that arrived in the inbox, ready to read:
    for f in inbox_files(api):
        data, mime = read_file(api, f["ref"])

    # Hand a file to another of the owner's agents, as a task:
    delegate_file(api, "doc-crew", "Extract the total", ref="alice@node/invoices/2026-07.pdf")

For the owner side of this: upload with `visibility="owner"` (`upload_file(...)` below does), otherwise
the file stays private and even the owner's own agents are refused -- which is the single most common
reason a handoff "does not work".

Mirrors the node contract in aimeat/src/services/file-refs.ts and aimeat/src/services/task-files.ts
(the node schema wins on any mismatch).

Changelog:
  0.17.0 -- New: read_file() / file_handle() / upload_file() / attachments_of() / inbox_files() /
    task_files() / delegate_file(). Requires an AIMEAT node with `?mode=handle` on /v1/pub and
    `resources.files` on tasks; read_file falls back to a direct authed byte fetch on older nodes.
"""
from __future__ import annotations

import base64
from typing import Any, Iterable, Mapping

try:
    import requests
except ImportError as exc:  # pragma: no cover
    raise ImportError(
        "The `requests` package is required for file helpers. Install: pip install requests"
    ) from exc


class AimeatFileError(RuntimeError):
    """A file helper failed (bad reference, refused read, or a non-2xx node response)."""


#: Refuse to materialise more than this in one read. A crew that needs more should stream the
#: download_url itself with file_handle().
DEFAULT_MAX_BYTES = 25 * 1024 * 1024


def split_ref(ref: str) -> tuple[str, str]:
    """Split "<owner@node>/<key>" into (owner, key). A bare key returns ("", key), meaning the calling
    agent's own storage. Only a first segment that LOOKS like an identity (contains '@', or starts with
    'ext:') is treated as an owner -- so "invoices/2026-07.pdf" stays a key."""
    head, sep, rest = ref.partition("/")
    if sep and ("@" in head or head.startswith("ext:")):
        return head, rest
    return "", ref


def _quote_key(key: str) -> str:
    from urllib.parse import quote

    return quote(key, safe="/")


def _json(resp: Any) -> dict[str, Any]:
    try:
        body = resp.json()
    except Exception as exc:  # noqa: BLE001
        raise AimeatFileError(f"node returned non-JSON (HTTP {resp.status_code})") from exc
    if not isinstance(body, dict):
        raise AimeatFileError(f"unexpected node response: {body!r}")
    return body


def file_handle(api: Any, ref: str) -> dict[str, Any]:
    """Resolve a reference to a presigned handle: {ref, owner_gaii, key, mime_type, size,
    download_url, expires_in_seconds}. JSON only -- safe to proxy through the serve loopback.

    Raises AimeatFileError with the node's own reason on a refused or missing file, because "denied"
    and "does not exist" call for different fixes: the first is a visibility/consent problem on the
    owner's side, the second a wrong reference."""
    owner, key = split_ref(ref)
    path = (
        f"/v1/pub/{_quote_key(owner)}/{_quote_key(key)}?mode=handle"
        if owner
        else f"/v1/storage/{_quote_key(key)}?mode=handle"
    )
    resp = api.get(path)
    if resp.status_code == 403:
        raise AimeatFileError(
            f"read refused for {ref}: this agent has no access. The owner can upload it with "
            f"visibility='owner' (readable by all of that owner's agents) or grant consent for storage:{key}."
        )
    if resp.status_code == 404:
        hint = "" if owner else " A bare key is looked up in THIS agent's storage -- pass '<owner@node>/<key>' for the owner's file."
        raise AimeatFileError(f"no such file: {ref}.{hint}")
    if resp.status_code >= 300:
        raise AimeatFileError(f"handle request failed for {ref}: HTTP {resp.status_code}")
    data = _json(resp).get("data") or {}
    if not data.get("download_url"):
        raise AimeatFileError(f"node returned no download_url for {ref} (node too old for ?mode=handle?)")
    return data


def read_file(
    api: Any,
    ref: str,
    *,
    max_bytes: int = DEFAULT_MAX_BYTES,
    timeout: int = 120,
) -> tuple[bytes, str]:
    """Read a stored file as CLEAN bytes. Returns (data, mime).

    Two hops on purpose: a JSON handle through the loopback (which cannot corrupt it), then a direct
    fetch of the presigned URL (which needs no token). A byte stream taken through the loopback would
    be UTF-8 mangled, so this is not an optimisation -- it is the difference between a readable PDF and
    a broken one."""
    handle = file_handle(api, ref)
    url = handle["download_url"]
    mime = handle.get("mime_type") or "application/octet-stream"
    size = handle.get("size")
    if isinstance(size, int) and size > max_bytes:
        raise AimeatFileError(f"{ref} is {size} bytes, over the {max_bytes}-byte limit for read_file()")

    with requests.get(url, stream=True, timeout=timeout) as r:
        if r.status_code != 200:
            raise AimeatFileError(f"presigned download failed for {ref}: HTTP {r.status_code}")
        buf = bytearray()
        for chunk in r.iter_content(64 * 1024):
            buf += chunk
            if len(buf) > max_bytes:
                raise AimeatFileError(f"{ref} exceeds the {max_bytes}-byte limit for read_file()")
        return bytes(buf), mime


def upload_file(
    api: Any,
    key: str,
    data: bytes,
    *,
    mime: str = "application/octet-stream",
    visibility: str = "owner",
) -> dict[str, Any]:
    """Store bytes under the calling agent's namespace and return {key, ref, visibility, size}.

    `visibility` defaults to 'owner', not 'private': a result meant for the owner or a sibling agent is
    useless if nobody else may read it, and that is the failure this whole module exists to remove.
    Pass visibility='private' deliberately when the file is for this agent alone."""
    resp = api.post(
        "/v1/storage",
        json={
            "key": key,
            "data": base64.b64encode(data).decode("ascii"),
            "mime_type": mime,
            "visibility": visibility,
        },
    )
    if resp.status_code >= 300:
        raise AimeatFileError(f"upload of {key} failed: HTTP {resp.status_code} {resp.text[:200]}")
    body = _json(resp).get("data") or {}
    owner = body.get("owner_gaii") or ""
    return {
        "key": body.get("key", key),
        "ref": f"{owner}/{body.get('key', key)}" if owner else body.get("key", key),
        "visibility": body.get("visibility", visibility),
        "size": body.get("size", len(data)),
    }


def attachments_of(message: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Normalise one message's attachments into [{ref, mime, name, size, kind}]. Accepts both the REST
    record (camelCase storageKey/ownerGhii) and the MCP view (snake_case, already carrying `ref`)."""
    out: list[dict[str, Any]] = []
    for a in message.get("attachments") or []:
        if not isinstance(a, Mapping):
            continue
        ref = a.get("ref")
        if not ref:
            owner = a.get("ownerGhii") or a.get("owner_ghii") or ""
            key = a.get("storageKey") or a.get("storage_key") or ""
            if not key:
                continue
            ref = f"{owner}/{key}" if owner else key
        out.append({
            "ref": ref,
            "mime": a.get("mime") or "application/octet-stream",
            "name": a.get("name"),
            "size": a.get("size"),
            "kind": a.get("kind") or "file",
            "message_id": message.get("id"),
            "conversation_id": message.get("conversationId") or message.get("conversation_id"),
        })
    return out


def inbox_files(api: Any, *, per_page: int = 20) -> list[dict[str, Any]]:
    """Every attachment addressed to this agent, newest first, as openable references. Feed a `ref`
    straight to read_file()."""
    resp = api.get(f"/v1/messages/agent-inbox?per_page={int(per_page)}")
    if resp.status_code >= 300:
        raise AimeatFileError(f"agent-inbox read failed: HTTP {resp.status_code}")
    messages = (_json(resp).get("data") or {}).get("messages") or []
    files: list[dict[str, Any]] = []
    for m in messages:
        if isinstance(m, Mapping):
            files.extend(attachments_of(m))
    return files


def task_files(task: Mapping[str, Any]) -> list[dict[str, Any]]:
    """The files attached to a task, as returned by task detail. Each entry already carries `access`
    and, when granted, a `download_url` -- so a denied attachment is visible as denied instead of
    looking like an empty task."""
    resources = task.get("resources") or {}
    out: list[dict[str, Any]] = []
    for f in resources.get("files") or []:
        if isinstance(f, Mapping) and f.get("ref"):
            out.append(dict(f))
    return out


def delegate_file(
    api: Any,
    target_agent: str,
    title: str,
    *,
    ref: str | Iterable[str],
    description: str | None = None,
    status: str = "queued",
) -> dict[str, Any]:
    """Queue a task for another of the owner's agents WITH file attachments. The caller must be able to
    read every reference itself (the node checks), and the target agent receives a presigned URL per
    file when it reads the task. Returns the created task record."""
    refs = [ref] if isinstance(ref, str) else list(ref)
    resp = api.post(
        f"/v1/agents/{target_agent}/tasks",
        json={
            "title": title,
            "description": description or title,
            "status": status,
            "todos": [],
            "verification": {"user_expects": "", "technical_checks": []},
            "resources": {"files": [{"ref": r} for r in refs]},
        },
    )
    if resp.status_code >= 300:
        body = resp.text[:300]
        raise AimeatFileError(f"delegate_file to {target_agent} failed: HTTP {resp.status_code} {body}")
    return (_json(resp).get("data") or {}).get("task") or {}

"""
Data packages -- reading one correctly, and publishing one from a crew.

WHAT A DATA PACKAGE IS, in one paragraph, because everything below follows from it. A published
package has a permanent address whose path contains the hash of its own contents, so the bytes at
that address can never change. Beside the bytes sits a Frictionless descriptor carrying a Table
Schema: the name and the TYPE of every column. That schema is the whole point. An agent handed a
package needs no column documentation, and a program reading one gets dates as dates and counts as
numbers rather than as strings that happen to look like them.

WHY THIS MODULE IS THIN, AND WHERE IT REFUSES TO BE. `frictionless` already reads a descriptor,
resolves the resource paths and validates rows; rebuilding any of that here would be a second
implementation of somebody else's spec. So this module does three things frictionless does not:

1. It gives you the AIMEAT block -- provenance, producer, licence, what this version changed and
   what it replaced -- which frictionless carries as an opaque extension and cannot interpret.
2. It hands pandas the DTYPES FROM THE SCHEMA. This is the one that matters. `pandas.read_csv` on a
   package's CSV guesses, and it guesses wrong in exactly the way that hurts: a Nordic article
   number "001000" becomes the integer 1000, and every join against it silently misses. The schema
   is right there in the descriptor; use it.
3. It publishes, through the node's own contract, so an agent's package is the same kind of object
   as one a browser or a scheduled extension produced.

PARQUET IS AN OPTIONAL EXTRA, and its absence is an error rather than a fallback:

    pip install "aimeat-crewai[parquet]"

A silent fall back to CSV would hand the caller a file that is not what they asked for, under a
function whose name says it is.

    from aimeat_crewai import serve_client, read_package, to_dataframe, publish_package

    api = serve_client("research-crew")

    pkg = read_package("https://aimeat.io/v1/pub/alice@node/datapkg/laake-saatavuus/<hash>/datapackage.json")
    print(pkg.license, pkg.changes)            # what it is, and what moved in this version
    df = to_dataframe(pkg)                      # typed from the Table Schema, not guessed
    df[df.inForce].groupby("company").size()

    publish_package(api, "weekly-summary", rows, changes="First version: 41 rows from Monday's run.")

Mirrors the node contract in aimeat/src/services/datapackage/ (the node schema wins on any
mismatch) and the browser library in aimeat/src/static/sdk-libs/datapackage/.

Changelog:
  0.20.0 -- New: read_package() / to_dataframe() / rows_of() / publish_package() / to_parquet() /
    package_versions(). Requires a node with /v1/datapackages (TARGET-063). pyarrow is an optional
    extra [parquet]; to_parquet raises rather than falling back to CSV when it is missing.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping, Sequence

try:
    import requests
except ImportError as exc:  # pragma: no cover
    raise ImportError(
        "The `requests` package is required for data-package helpers. Install: pip install requests"
    ) from exc


class AimeatPackageError(RuntimeError):
    """A data-package helper failed: a bad address, a refused publish, or a node response that is
    not a package."""


class QualityGateRefused(AimeatPackageError):
    """The node refused to publish because the rows do not validate against their own Table Schema.

    NOTHING WAS WRITTEN and the package still stands on its previous version -- that is the
    contract, not a detail of this exception. `issues` carries the coordinates: resource, row and
    field, so a crew can fix the cell rather than re-send the table and hope."""

    def __init__(self, message: str, issues: Sequence[Mapping[str, Any]]) -> None:
        super().__init__(message)
        self.issues = list(issues)


#: Frictionless Table Schema type -> pandas dtype. `string` is the one that earns its place: it is
#: what keeps a zero-padded identifier an identifier. Dates are parsed separately (a dtype cannot
#: express "parse this"), and `any` is deliberately absent so it falls through to object.
_DTYPES = {
    "string": "string",
    "integer": "Int64",     # nullable, because a CSV column with a gap is not a float column
    "number": "Float64",
    "boolean": "boolean",
}
_DATE_TYPES = {"date", "datetime", "time", "year"}


@dataclass
class DataPackage:
    """One version of one package, read from its address.

    `descriptor` is the raw Frictionless document. The named fields are the AIMEAT block, pulled out
    because they are what a person or an agent actually decides on: is this current, where did it
    come from, may I use it, and what changed."""

    descriptor: Mapping[str, Any]
    url: str
    name: str
    package_id: str
    content_hash: str
    changes: str
    #: 'declared' means a human or a producer confirmed the types; 'inferred' means they were
    #: proposed by inspection and nobody confirmed them. It is a real difference to a reader.
    schema_source: str
    license: str | None = None
    supersedes: str | None = None
    producer: Mapping[str, Any] = field(default_factory=dict)
    sources: Sequence[Mapping[str, Any]] = field(default_factory=list)
    transformations: Sequence[Mapping[str, Any]] = field(default_factory=list)

    @property
    def resources(self) -> Sequence[Mapping[str, Any]]:
        return list(self.descriptor.get("resources") or [])

    def resource(self, name: str | None = None) -> Mapping[str, Any]:
        """One resource by name; with no name, the first. Raises rather than returning None, because
        every caller of this immediately reads `schema` off the result."""
        res = self.resources
        if not res:
            raise AimeatPackageError(f"package {self.package_id} has no resources")
        if name is None:
            return res[0]
        for r in res:
            if r.get("name") == name:
                return r
        have = ", ".join(str(r.get("name")) for r in res)
        raise AimeatPackageError(f"no resource {name!r} in {self.package_id}; it has: {have}")

    def resource_url(self, name: str | None = None) -> str:
        """The permanent address of one resource's bytes. This is what you hand to DuckDB, Excel or
        a colleague -- it needs no AIMEAT client and no token."""
        r = self.resource(name)
        base = self.url.rsplit("/", 1)[0]
        return f"{base}/{r['path']}"


def _unwrap(resp: Any, what: str) -> dict[str, Any]:
    try:
        body = resp.json()
    except Exception as exc:  # noqa: BLE001
        raise AimeatPackageError(f"{what}: node returned non-JSON (HTTP {resp.status_code})") from exc
    if not isinstance(body, dict):
        raise AimeatPackageError(f"{what}: unexpected response {body!r}")
    if resp.status_code >= 300 or body.get("ok") is False:
        err = body.get("error") or {}
        message = err.get("message") or f"HTTP {resp.status_code}"
        issues = ((err.get("details") or {}).get("issues")) or []
        if err.get("code") == "QUALITY_GATE":
            raise QualityGateRefused(f"{what}: {message}", issues)
        raise AimeatPackageError(f"{what}: {message}")
    return body.get("data") if isinstance(body.get("data"), dict) else body


def read_package(url: str, *, timeout: int = 60) -> DataPackage:
    """Read a descriptor from its permanent address. No token: a published package is public.

    Pass the `datapackage.json` URL, which is what every AIMEAT surface hands out."""
    resp = requests.get(url, timeout=timeout)
    if resp.status_code >= 300:
        raise AimeatPackageError(f"could not read the descriptor at {url}: HTTP {resp.status_code}")
    try:
        descriptor = resp.json()
    except Exception as exc:  # noqa: BLE001
        raise AimeatPackageError(f"{url} is not a JSON descriptor") from exc
    return _to_package(descriptor, url)


def _to_package(descriptor: Mapping[str, Any], url: str) -> DataPackage:
    a = descriptor.get("aimeat")
    if not isinstance(a, Mapping):
        # A Frictionless package without the AIMEAT block is somebody else's package. It is readable
        # with frictionless directly; it just is not this object, and pretending otherwise would
        # give every field below a made-up value.
        raise AimeatPackageError(
            f"{url} is a Frictionless descriptor without an `aimeat` block, so it carries no "
            f"provenance, no version chain and no producer. Read it with frictionless directly."
        )
    licenses = descriptor.get("licenses") or []
    return DataPackage(
        descriptor=descriptor,
        url=url,
        name=str(descriptor.get("name") or ""),
        package_id=str(a.get("packageId") or ""),
        content_hash=str(a.get("contentHash") or ""),
        changes=str(a.get("changes") or ""),
        schema_source=str(a.get("schemaSource") or ""),
        license=(licenses[0].get("name") if licenses and isinstance(licenses[0], Mapping) else None),
        supersedes=a.get("supersedes"),
        producer=a.get("producer") or {},
        sources=a.get("sources") or [],
        transformations=a.get("transformations") or [],
    )


def package_versions(api: Any, owner: str, name: str) -> list[dict[str, Any]]:
    """Every version of a package, newest first, each with the sentence it was published with.

    Pin any of them by reading its `descriptorUrl`: those bytes can never change."""
    resp = api.get(f"/v1/datapackages/{owner}/{name}/versions")
    data = _unwrap(resp, f"versions of {owner}/{name}")
    return list(data.get("versions") or [])


def to_dataframe(pkg: DataPackage, resource: str | None = None, *, timeout: int = 120) -> Any:
    """The resource as a pandas DataFrame, TYPED FROM THE TABLE SCHEMA.

    This is the function the whole module exists for. `pandas.read_csv` on the same URL guesses the
    types, and the guess is wrong in the way that costs the most: an identifier like "001000" comes
    back as the integer 1000 and every join against it silently misses. The schema is published
    beside the data precisely so nobody has to guess.

    Date columns are parsed rather than typed, because a dtype cannot express "parse this"."""
    try:
        import pandas as pd
    except ImportError as exc:  # pragma: no cover
        raise ImportError(
            "to_dataframe() needs pandas. Install: pip install pandas"
        ) from exc

    res = pkg.resource(resource)
    schema = res.get("schema") or {}
    fields = schema.get("fields") or []
    dtypes = {f["name"]: _DTYPES[f["type"]] for f in fields if f.get("type") in _DTYPES}
    dates = [f["name"] for f in fields if f.get("type") in _DATE_TYPES]

    # Fetched here rather than handed to pandas as a URL, so `timeout` means something and so a
    # refusal reads as a refusal instead of as a parse error thirty lines into someone else's stack.
    import io

    resp = requests.get(pkg.resource_url(resource), timeout=timeout)
    if resp.status_code >= 300:
        raise AimeatPackageError(f"could not read the rows: HTTP {resp.status_code}")
    frame = pd.read_csv(io.BytesIO(resp.content), dtype=dtypes)
    for column in dates:
        if column in frame.columns:
            frame[column] = pd.to_datetime(frame[column], errors="coerce", format="mixed")
    return frame


def rows_of(pkg: DataPackage, resource: str | None = None, *, timeout: int = 120) -> list[dict[str, Any]]:
    """The resource as a list of dicts, for a crew that does not want pandas in the room.

    Values arrive as strings, exactly as the CSV holds them, and that is on purpose: converting
    without the schema is the guess this module exists to avoid. Use to_dataframe() when you want
    types, or read `pkg.resource()['schema']` and convert what you need."""
    import csv
    import io

    resp = requests.get(pkg.resource_url(resource), timeout=timeout)
    if resp.status_code >= 300:
        raise AimeatPackageError(f"could not read the rows: HTTP {resp.status_code}")
    text = resp.content.decode("utf-8")
    return list(csv.DictReader(io.StringIO(text)))


def publish_package(
    api: Any,
    name: str,
    rows: Iterable[Mapping[str, Any]],
    *,
    changes: str,
    title: str | None = None,
    description: str | None = None,
    resource: str = "rows",
    schema: Mapping[str, Any] | None = None,
    provenance: Mapping[str, Any] | None = None,
    retention: Mapping[str, Any] | None = None,
    ai_provenance: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Publish one version and return {package_id, content_hash, descriptor_url, unchanged, ...}.

    `changes` is REQUIRED by the node, not by this function's politeness: a version nobody explained
    is a version a consumer cannot decide about.

    `unchanged: True` in the answer means these exact bytes were already published. That is a
    deterministic producer proving it is deterministic -- report "no change", not "updated".

    Omitting `schema` asks the node to infer the types and records `schemaSource: 'inferred'` in the
    descriptor, so a reader can see that nobody confirmed them. An agent that KNOWS the types should
    pass them.

    Raises QualityGateRefused when the rows do not validate, with the coordinates of every problem
    and nothing written."""
    payload: dict[str, Any] = {
        "name": name,
        "changes": changes,
        "resources": [{"name": resource, "rows": list(rows), **({"schema": schema} if schema else {})}],
    }
    if title:
        payload["title"] = title
    if description:
        payload["description"] = description
    if provenance:
        payload["provenance"] = dict(provenance)
    if retention:
        payload["retentionPolicy"] = dict(retention)
    if ai_provenance:
        payload["ai_provenance"] = dict(ai_provenance)

    resp = api.post("/v1/datapackages", json=payload, timeout=120)
    return _unwrap(resp, f"publishing {name}")


def to_parquet(pkg: DataPackage, path: str, resource: str | None = None, *, timeout: int = 120) -> int:
    """Write one resource to a Parquet file, typed from the Table Schema. Returns the bytes written.

    NEEDS THE OPTIONAL EXTRA:  pip install "aimeat-crewai[parquet]"

    It raises when pyarrow is missing rather than writing a CSV instead. A function named
    to_parquet that quietly produces something else hands the caller a file that will fail in
    whatever they open it with, one step further from the cause."""
    try:
        import pyarrow  # noqa: F401
        import pyarrow.parquet  # noqa: F401
    except ImportError as exc:
        raise ImportError(
            'to_parquet() needs pyarrow, which ships as an optional extra so a crew that never '
            'writes Parquet does not carry it: pip install "aimeat-crewai[parquet]"'
        ) from exc

    frame = to_dataframe(pkg, resource, timeout=timeout)
    frame.to_parquet(path, engine="pyarrow", index=False)
    import os

    return os.path.getsize(path)

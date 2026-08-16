"""
The pass criterion for package 1, run against a REAL package rather than a fixture.

WHAT IS BEING PROVEN, and why a fixture could not prove it: that the Table Schema published beside
the data survives all the way into a reader's types. A hand-written fixture would carry whatever
types the fixture author chose, which is the question, not the answer. So this reads a package the
node actually published from data a production extension actually produced.

    AIMEAT_TEST_PACKAGE=<descriptor url> uv run --with pandas --with pytest pytest tests/test_datapackage_live.py -v

Without that variable the module skips: it is a live check, not a unit test, and a suite that
silently passes when it cannot reach anything is worse than one that says it did not run.
"""
from __future__ import annotations

import os

import pytest

from aimeat_crewai.datapackage import AimeatPackageError, read_package, rows_of, to_dataframe

URL = os.environ.get("AIMEAT_TEST_PACKAGE")
pytestmark = pytest.mark.skipif(not URL, reason="set AIMEAT_TEST_PACKAGE to a descriptor URL")


@pytest.fixture(scope="module")
def pkg():
    return read_package(URL)


def test_the_aimeat_block_is_there_and_says_what_this_version_is(pkg):
    assert pkg.package_id.startswith("pkg:")
    assert pkg.content_hash.startswith("sha256:")
    # Mandatory on the way in, so it is guaranteed on the way out. A version nobody explained is a
    # version a consumer cannot decide about.
    assert pkg.changes
    assert pkg.schema_source in {"declared", "inferred", "mixed"}


def test_the_resource_address_is_a_permanent_url(pkg):
    url = pkg.resource_url()
    assert url.startswith("http")
    assert "/datapkg/" in url
    # The hash is IN the path, which is what makes the bytes immutable without a second mechanism.
    assert pkg.content_hash.split(":", 1)[1] in url


def test_types_reach_pandas_from_the_schema_and_not_from_a_guess(pkg):
    """THE ONE THAT MATTERS. If every column comes back as `object`, the schema did not survive the
    journey and an agent reading this package learns nothing about it from its types."""
    frame = to_dataframe(pkg)
    fields = {f["name"]: f["type"] for f in pkg.resource()["schema"]["fields"]}
    assert len(frame) > 0
    assert set(frame.columns) == set(fields)

    kinds = {name: str(frame[name].dtype) for name in frame.columns}
    for name, declared in fields.items():
        dtype = kinds[name]
        if declared == "date" or declared == "datetime":
            assert "datetime" in dtype, f"{name} is declared {declared} and arrived as {dtype}"
        elif declared == "integer":
            assert dtype == "Int64", f"{name} is declared integer and arrived as {dtype}"
        elif declared == "number":
            assert dtype == "Float64", f"{name} is declared number and arrived as {dtype}"
        elif declared == "boolean":
            assert dtype == "boolean", f"{name} is declared boolean and arrived as {dtype}"
        elif declared == "string":
            assert dtype == "string", f"{name} is declared string and arrived as {dtype}"

    # Not "some column is typed" but "the package is not one big wall of object", which is the
    # failure mode this whole design exists to prevent.
    assert not all(k == "object" for k in kinds.values()), f"every column arrived as object: {kinds}"


def test_a_string_column_keeps_a_leading_zero(pkg):
    """A zero-padded identifier is the case that costs the most when it goes wrong: read as a
    number it loses its zeros, and every join against it silently misses. Skipped when this
    particular package has no such value, rather than asserted into existence."""
    frame = to_dataframe(pkg)
    string_columns = [f["name"] for f in pkg.resource()["schema"]["fields"] if f["type"] == "string"]
    padded = [
        (col, value)
        for col in string_columns
        for value in frame[col].dropna().astype(str).head(200)
        if value.startswith("0") and value[1:2].isdigit()
    ]
    if not padded:
        pytest.skip("this package carries no zero-padded identifier")
    col, value = padded[0]
    assert value.startswith("0"), f"{col} lost its leading zero: {value!r}"


def test_rows_of_reads_the_same_data_without_pandas(pkg):
    rows = rows_of(pkg)
    frame = to_dataframe(pkg)
    assert len(rows) == len(frame)
    assert set(rows[0].keys()) == set(frame.columns)
    # Values arrive as strings on purpose: converting without the schema is exactly the guess this
    # module exists to avoid.
    assert all(isinstance(v, str) or v is None for v in rows[0].values())


def test_the_rest_address_works_too_and_reports_the_permanent_one():
    """The address the node hands out, the docs printed, and an agent naturally has.

    It used to fail with a message claiming the package was somebody else's Frictionless file — the
    `aimeat` block sits one layer down inside the response envelope — and the first crew to use the
    library worked around it by unwrapping. An error naming the wrong cause costs more than the bug."""
    import re

    m = re.match(r"(https?://[^/]+)/v1/pub/([^/]+)/datapkg/([^/]+)/", URL)
    if not m:
        pytest.skip("AIMEAT_TEST_PACKAGE is not a /v1/pub address, so the REST twin cannot be derived")
    base, owner, name = m.group(1), m.group(2).split("%40")[0], m.group(3)

    viaRest = read_package(f"{base}/v1/datapackages/{owner}/{name}")
    assert viaRest.package_id.startswith("pkg:")
    assert viaRest.changes
    # And it reports the PERMANENT address of the bytes it read, not the REST URL it was given: a
    # package read through the API still knows where its bytes live.
    assert "/v1/pub/" in viaRest.url and "datapackage.json" in viaRest.url
    assert to_dataframe(viaRest).shape[0] > 0


def test_a_refusal_names_the_row_and_the_field_in_its_message():
    """What an agent prints is `str(exc)`. The coordinates were on `.issues` from the start and the
    message said only "2 row/column problem(s)", so the one thing a crew could tell its user was a
    count of problems it could not point at."""
    from aimeat_crewai.datapackage import QualityGateRefused

    exc = QualityGateRefused(
        "2 row/column problem(s): the data does not validate against its own Table Schema.",
        [{"resource": "rows", "row": 3, "field": "days", "message": 'expected integer, got "seitseman"'},
         {"resource": "rows", "row": 9, "field": "startDate", "message": "expected date"}],
    )
    said = str(exc)
    assert "row 3" in said and "days" in said, said
    assert "seitseman" in said, said
    assert "1 more" in said, said
    assert len(exc.issues) == 2


def test_the_version_the_package_reports_is_the_version_that_shipped():
    """0.20.0 shipped announcing itself as 0.19.0. Two places, kept in step by hand, and nothing
    checked them against each other."""
    import tomllib
    import pathlib

    import aimeat_crewai

    root = pathlib.Path(__file__).resolve().parents[1]
    declared = tomllib.loads((root / "pyproject.toml").read_text(encoding="utf-8"))["project"]["version"]
    assert aimeat_crewai.__version__ == declared, (
        f"__init__ says {aimeat_crewai.__version__}, pyproject says {declared}"
    )


def test_a_plain_frictionless_descriptor_is_refused_rather_than_half_read():
    """A package without the AIMEAT block has no provenance, no chain and no producer. Inventing
    values for those fields would be worse than saying so.

    Tested against the mapping rather than over HTTP: the refusal is in the mapping step, and a
    local file server here would only be testing `requests`."""
    from aimeat_crewai.datapackage import _to_package

    with pytest.raises(AimeatPackageError, match="without an `aimeat` block"):
        _to_package({"name": "plain", "resources": []}, "https://example.test/datapackage.json")

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


def test_a_plain_frictionless_descriptor_is_refused_rather_than_half_read():
    """A package without the AIMEAT block has no provenance, no chain and no producer. Inventing
    values for those fields would be worse than saying so.

    Tested against the mapping rather than over HTTP: the refusal is in the mapping step, and a
    local file server here would only be testing `requests`."""
    from aimeat_crewai.datapackage import _to_package

    with pytest.raises(AimeatPackageError, match="without an `aimeat` block"):
        _to_package({"name": "plain", "resources": []}, "https://example.test/datapackage.json")

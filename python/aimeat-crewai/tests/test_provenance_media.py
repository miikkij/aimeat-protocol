"""The ``ai_provenance`` block carries the medium the node's schema accepts (node 2026-10-08).

The node words a label by the record's medium: a speech clip declared without one read "This text
was written by AI". These tests hold :func:`declare` to the node's field names and enums.
"""

import pytest

from aimeat_crewai.provenance import Level, MediaKind, Method, ResemblesReal, declare


def test_media_fields_reach_the_block():
    block = declare(Level.AI_GENERATED, media_kind=MediaKind.AUDIO, media_type="audio/mpeg",
                    resembles_real=ResemblesReal.NO)
    assert block["media_kind"] == "audio"
    assert block["media_type"] == "audio/mpeg"
    assert block["resembles_real"] == "no"


def test_media_fields_are_left_out_when_not_given():
    block = declare(Level.AI_GENERATED)
    assert "media_kind" not in block and "media_type" not in block and "resembles_real" not in block


def test_transcribed_is_a_method():
    assert declare(Level.AI_GENERATED, method=Method.TRANSCRIBED)["method"] == "transcribed"


@pytest.mark.parametrize("field,value", [("media_kind", "picture"), ("resembles_real", "maybe")])
def test_an_unknown_value_is_refused(field, value):
    with pytest.raises(ValueError):
        declare(Level.AI_GENERATED, **{field: value})

"""Tests for cross-link token translation between outline and node-id form."""

import pytest

from talleyrand.features.research.ref_tokens import (
    DELETED_REF_TEXT,
    freeze_ref_tokens,
    outline_ref_tokens,
)

NODE_A = "11111111-1111-4111-8111-111111111111"
NODE_B = "22222222-2222-4222-8222-222222222222"

ID_BY_OUTLINE = {"1": NODE_A, "2.3": NODE_B}
OUTLINE_BY_ID = {NODE_A: "1", NODE_B: "2.3"}


def test_freeze_rewrites_every_resolvable_token():
    text = "See [[1]] and, for costs, [[2.3]]."
    assert freeze_ref_tokens(text, ID_BY_OUTLINE) == (
        f"See [[{NODE_A}]] and, for costs, [[{NODE_B}]]."
    )


def test_freeze_strips_brackets_off_invented_outlines():
    # An invented ref must not stay a token: as the tree grows, [[7]] could
    # otherwise start resolving to an arbitrary question.
    assert freeze_ref_tokens("see [[7]] there", ID_BY_OUTLINE) == "see 7 there"


def test_freeze_strict_raises_on_invented_outlines():
    with pytest.raises(ValueError, match=r"\[\[7\]\]"):
        freeze_ref_tokens("see [[7]]", ID_BY_OUTLINE, strict=True)


def test_outline_renders_id_tokens_against_the_current_tree():
    text = f"See [[{NODE_A}]] and [[{NODE_B}]]."
    assert outline_ref_tokens(text, OUTLINE_BY_ID) == "See [[1]] and [[2.3]]."


def test_outline_replaces_refs_to_deleted_questions_with_plain_text():
    text = f"See [[{NODE_A}]]."
    assert outline_ref_tokens(text, {}) == f"See {DELETED_REF_TEXT}."


def test_round_trip_survives_a_renumbering():
    # The point of the id form: freeze against one tree, render against
    # another where the outline numbers have shifted.
    frozen = freeze_ref_tokens("as covered in [[2.3]]", ID_BY_OUTLINE)
    assert outline_ref_tokens(frozen, {NODE_B: "1.3"}) == "as covered in [[1.3]]"


def test_plain_text_and_malformed_tokens_pass_through():
    for text in ("no tokens here", "[[not-a-ref]]", "[[1.2", "[[v1.2]]"):
        assert freeze_ref_tokens(text, ID_BY_OUTLINE) == text
        assert outline_ref_tokens(text, OUTLINE_BY_ID) == text


def test_code_regions_are_never_rewritten():
    # Double brackets in code are code — R's list indexing, not a reference.
    inline = "In R, use `x[[1]]` to unwrap; see [[1]] for why."
    assert freeze_ref_tokens(inline, ID_BY_OUTLINE) == (
        f"In R, use `x[[1]]` to unwrap; see [[{NODE_A}]] for why."
    )

    fenced = "As [[1]] shows:\n\n```r\nvalue <- results[[1]]\nprint(results[[7]])\n```\n\nDone."
    assert freeze_ref_tokens(fenced, ID_BY_OUTLINE) == (
        f"As [[{NODE_A}]] shows:\n\n```r\nvalue <- results[[1]]\nprint(results[[7]])\n```\n\nDone."
    )

    unterminated = "```\nx[[1]]"
    assert freeze_ref_tokens(unterminated, ID_BY_OUTLINE) == unterminated

    id_in_code = f"`[[{NODE_A}]]`"
    assert outline_ref_tokens(id_in_code, OUTLINE_BY_ID) == id_in_code

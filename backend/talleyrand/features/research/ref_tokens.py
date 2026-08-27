"""
Cross-link token translation.

Answers reference other questions with [[...]] tokens, in two coordinate
systems. The model reads and writes outline numbers ([[1.2]]) — meaningful
only against the tree snapshot it was shown, since deleting a question
renumbers everything after it. Stored answers carry node ids ([[<uuid>]]) —
stable across deletions and renumbering.

freeze_ref_tokens converts model output to the stored form when an answer is
persisted; outline_ref_tokens converts stored answers back when they are
serialized into an LLM prompt, against the tree the prompt describes.

Code regions are left untouched in both directions, mirroring the renderer
(rehypeQuestionRefs skips code/pre): double brackets there are code, not
references — e.g. R's `x[[1]]` indexing.
"""

import re
from collections.abc import Callable

OUTLINE_REF = re.compile(r"\[\[(\d+(?:\.\d+)*)\]\]")
NODE_ID_REF = re.compile(r"\[\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]\]")

DELETED_REF_TEXT = "(a deleted question)"

_CODE_REGION = re.compile(
    # fenced code block, to its closing fence or the end of the text
    r"^ {0,3}```.*?(?:^ {0,3}``` *$|\Z)"
    r"|^ {0,3}~~~.*?(?:^ {0,3}~~~ *$|\Z)"
    # inline code span with a matching backtick run
    r"|(?P<ticks>`+)[^`]+(?P=ticks)",
    re.DOTALL | re.MULTILINE,
)


def _sub_outside_code(
    pattern: re.Pattern[str], replace: Callable[[re.Match[str]], str], text: str
) -> str:
    parts: list[str] = []
    last = 0
    for region in _CODE_REGION.finditer(text):
        parts.append(pattern.sub(replace, text[last : region.start()]))
        parts.append(region[0])
        last = region.end()
    parts.append(pattern.sub(replace, text[last:]))
    return "".join(parts)


def freeze_ref_tokens(
    text: str, node_id_by_outline: dict[str, str], *, strict: bool = False
) -> str:
    """
    [[1.2]] -> [[<node id>]] against the tree the model was shown.

    An outline that resolves to no question is the model's invention; it loses
    its brackets so it can never start resolving as the tree grows. strict=True
    raises instead — for authored content, where it is an authoring error.
    """

    def replace(match: re.Match[str]) -> str:
        node_id = node_id_by_outline.get(match[1])
        if node_id is None:
            if strict:
                raise ValueError(f"[[{match[1]}]] resolves to no question")
            return match[1]
        return f"[[{node_id}]]"

    return _sub_outside_code(OUTLINE_REF, replace, text)


def outline_ref_tokens(text: str, outline_by_node_id: dict[str, str]) -> str:
    """[[<node id>]] -> [[1.2]] against the current tree; refs to questions
    that no longer exist become plain text."""

    def replace(match: re.Match[str]) -> str:
        outline = outline_by_node_id.get(match[1])
        return f"[[{outline}]]" if outline is not None else DELETED_REF_TEXT

    return _sub_outside_code(NODE_ID_REF, replace, text)

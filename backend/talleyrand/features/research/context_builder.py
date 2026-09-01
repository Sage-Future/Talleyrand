"""
Research context builder.

Serializes the whole case tree in a fixed structural order with stable
outline numbers. Answers are included only for questions the user has read; other
questions appear bare. By the creation invariant, all ancestors of the current
question are read, so the current path needs no special-casing.
"""

from dataclasses import dataclass, field

from talleyrand.features.graph.dtos import DocumentDTO, GraphNoId, NodeContentDTO
from talleyrand.features.research.ref_tokens import outline_ref_tokens


@dataclass
class QuestionTree:
    """Projection of graph nodes/edges onto a tree of chat questions."""

    root_ids: list[str] = field(default_factory=list)
    children: dict[str, list[str]] = field(default_factory=dict)
    parent: dict[str, str | None] = field(default_factory=dict)
    outline: dict[str, str] = field(default_factory=dict)  # node_id -> "1.2"
    dfs_order: list[str] = field(default_factory=list)


def build_question_tree(graph: GraphNoId) -> QuestionTree:
    """
    Project nodes/edges onto a tree: children ordered by creation order (index in
    the nodes array), first parent wins for legacy multi-parent nodes.
    """
    chat_ids = [str(node.id) for node in graph.nodes]
    chat_set = set(chat_ids)

    parent: dict[str, str | None] = dict.fromkeys(chat_ids)
    for edge in graph.edges:
        source, target = str(edge.source), str(edge.target)
        if (
            target in chat_set
            and source in chat_set
            and source != target
            and parent[target] is None
        ):
            parent[target] = source

    # Break parent cycles from legacy multi-edge graphs: walk each chain up;
    # on revisiting a node within the current chain, cut its parent link.
    resolved: set[str] = set()
    for node_id in chat_ids:
        chain: list[str] = []
        chain_set: set[str] = set()
        current: str | None = node_id
        while current is not None and current not in resolved:
            if current in chain_set:
                parent[current] = None
                break
            chain.append(current)
            chain_set.add(current)
            current = parent[current]
        resolved.update(chain)

    tree = QuestionTree(parent=parent, children={node_id: [] for node_id in chat_ids})
    for node_id in chat_ids:  # creation order => children ordered by creation
        parent_id = parent[node_id]
        if parent_id is None:
            tree.root_ids.append(node_id)
        else:
            tree.children[parent_id].append(node_id)

    def assign_outline(node_id: str, prefix: str) -> None:
        tree.outline[node_id] = prefix
        tree.dfs_order.append(node_id)
        for index, child_id in enumerate(tree.children[node_id], start=1):
            assign_outline(child_id, f"{prefix}.{index}")

    for index, root_id in enumerate(tree.root_ids, start=1):
        assign_outline(root_id, str(index))

    return tree


def ancestors_of(tree: QuestionTree, node_id: str) -> list[str]:
    """Ancestor ids from root down to the direct parent of the given node."""
    ancestors: list[str] = []
    current = tree.parent.get(node_id)
    while current is not None:
        ancestors.append(current)
        current = tree.parent.get(current)
    ancestors.reverse()
    return ancestors


@dataclass
class ResearchContext:
    """
    The research user prompt, split where its cache breakpoint goes.

    The brief and the case documents are byte-identical for every question in a
    case, so together they form the prefix a provider can cache and re-read
    instead of re-reading the whole case per question. The body — the tree, the
    read order, the current question — moves with every answer and every ask,
    and sits after the breakpoint.

    The documents are also the section that gives way when a case outgrows the
    model's context window: what the user asked, and what the case has already
    established, must reach the model whole.
    """

    brief: str
    documents: str
    body: str

    @property
    def case_prefix(self) -> str:
        """The part every question in this case shares."""
        return self.brief + self.documents

    @property
    def text(self) -> str:
        """The whole prompt, for callers that send it as one block."""
        return self.case_prefix + self.body


def _section(lines: list[str]) -> str:
    """A prompt section, carrying the blank line that separates it from the next."""
    return "\n".join(lines) + "\n\n" if lines else ""


def format_documents(
    documents: list[DocumentDTO], indent: str, label: str = "DOCUMENTS"
) -> list[str]:
    lines = [f"{indent}{label}:"]
    for doc in documents:
        if doc.type == "txt":
            lines.append(f"{indent}  - {doc.name}: {doc.content}")
        else:
            lines.append(f"{indent}  - {doc.name}.pdf: [PDF file attached]")
    return lines


def build_research_context(graph: GraphNoId, node_id: str | None) -> ResearchContext:
    """
    Build the full research user prompt. With a node_id the prompt ends with a
    CURRENT QUESTION block for that question; with None it is the case
    overview alone (brief, documents, tree, read order).
    """
    content_by_id = {str(content.id): content for content in graph.node_contents}
    tree = build_question_tree(graph)

    def refs(text: str) -> str:
        # Stored answers carry node-id ref tokens; the model reads outline
        # numbers, so render them against the tree this prompt describes.
        return outline_ref_tokens(text, tree.outline)

    if node_id is not None:
        if node_id not in content_by_id:
            raise ValueError(f"Node {node_id} not found in graph")
        if node_id not in tree.outline:
            raise ValueError(f"Node {node_id} is not a question node")

    read_ids = [str(event.node_id) for event in graph.read_history]
    read_set = set(read_ids)

    brief_lines: list[str] = []
    if graph.brief.strip():
        brief_lines.append(f"BRIEF:\n{graph.brief.strip()}")

    document_lines: list[str] = []
    if graph.case_documents:
        document_lines.extend(format_documents(graph.case_documents, "", label="CASE DOCUMENTS"))

    parts: list[str] = []

    parts.append("CASE TREE (fixed order; the user's case so far):")
    for tree_node_id in tree.dfs_order:
        content = content_by_id.get(tree_node_id)
        if content is None:
            continue
        outline = tree.outline[tree_node_id]
        parts.append(f"[{outline}] QUESTION: {content.query}")
        if content.parent_selected_text:
            parts.append(f'    ASKED ABOUT: "{refs(content.parent_selected_text)}"')
        if tree_node_id in read_set and content.response:
            parts.append(f"    ANSWER: {refs(content.response)}")
            if content.loved_at is not None:
                parts.append(
                    "    LOVED BY THE USER (they marked this whole answer as especially "
                    "useful — a strong positive signal of what they value)"
                )
            if content.highlights:
                parts.append(
                    "    HIGHLIGHTED BY THE USER (passages they marked as especially "
                    "important in this answer):"
                )
                parts.extend(
                    f'      - "{refs(highlight.text)}"' for highlight in content.highlights
                )
        if content.documents:
            parts.extend(format_documents(content.documents, "    "))
    parts.append("")

    read_outlines = [f"[{tree.outline[rid]}]" for rid in read_ids if rid in tree.outline]
    if read_outlines:
        parts.append(f"READ ORDER: {', '.join(read_outlines)}")
        parts.append("")

    if graph.declined_questions:
        parts.append(
            "DECLINED QUESTIONS (suggestions the user was offered and explicitly declined, "
            "with their reason when given — a signal of what they find uninteresting, "
            "already-known, or off-goal):"
        )
        for declined in graph.declined_questions:
            reason = f" [reason: {declined.reason}]" if declined.reason else ""
            parts.append(f"  - {declined.text}{reason}")
        parts.append("")

    if node_id is not None:
        current_content = content_by_id[node_id]
        parts.append(f"CURRENT QUESTION: [{tree.outline[node_id]}] {current_content.query}")
        if current_content.parent_selected_text:
            parts.append(
                "ASKED ABOUT (selection from the parent answer, "
                "with the text surrounding it there):"
            )
            if current_content.parent_selected_prefix:
                parts.append(
                    f'    CONTEXT BEFORE: "{refs(current_content.parent_selected_prefix)}"'
                )
            parts.append(f'    SELECTED TEXT: "{refs(current_content.parent_selected_text)}"')
            if current_content.parent_selected_suffix:
                parts.append(f'    CONTEXT AFTER: "{refs(current_content.parent_selected_suffix)}"')
        parts.append("")

    return ResearchContext(
        brief=_section(brief_lines),
        documents=_section(document_lines),
        body="\n".join(parts),
    )


def collect_research_pdf_documents(graph: GraphNoId, node_id: str) -> list[DocumentDTO]:
    """PDF attachments entering the request: current path's node docs + case docs."""
    content_by_id = {str(content.id): content for content in graph.node_contents}
    tree = build_question_tree(graph)

    path_ids = [*ancestors_of(tree, node_id), node_id] if node_id in tree.outline else [node_id]

    pdf_documents: list[DocumentDTO] = []
    seen_ids: set[str] = set()

    def add_pdfs(documents: list[DocumentDTO]) -> None:
        for doc in documents:
            if doc.type == "pdf" and doc.id not in seen_ids:
                pdf_documents.append(doc)
                seen_ids.add(doc.id)

    add_pdfs(graph.case_documents)
    for path_node_id in path_ids:
        content: NodeContentDTO | None = content_by_id.get(path_node_id)
        if content is not None:
            add_pdfs(content.documents)

    return pdf_documents

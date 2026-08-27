"""
The four shared demo cases behind the landing page.

Each landing demo links to a real, copyable case whose content continues the
demo: the kickstart demo (compute governance), the branch demo (moral
progress), the frontier demo (Big Five) and the suggestions demo (free will).
The landing page links them as /shared/<id>; visitors browse them read-only
and copy them to continue. Every question carries a generated answer, and
every unresolved question has pending suggestions waiting under it, so the
cases read as living research rather than empty scaffolding.

This module is the source of truth: the cases are re-seeded on every backend
startup (see seed.py), so edits here propagate on deploy. All ids and
timestamps are deterministic — reseeding never produces a different document.
"""

from datetime import UTC, datetime, timedelta
from uuid import NAMESPACE_URL, UUID, uuid5

from talleyrand.features.graph.dtos import (
    DeclinedQuestionDTO,
    EdgeDTO,
    GraphNoId,
    HighlightDTO,
    NodeContentDTO,
    NodeDTO,
    ResearchSuggestionDTO,
    TextSelectionDTO,
)
from talleyrand.features.graph.models import GraphDocument
from talleyrand.features.research.context_builder import build_question_tree
from talleyrand.features.research.ref_tokens import freeze_ref_tokens

# The demo cases' owner. Not a real account: Google OAuth can never mint this
# identity, so nobody can edit the cases through the app.
DEMO_USER_ID = "demo@talleyrand.internal"

# Reserved graph ids — the landing page links them as /shared/<id>.
COMPUTE_GOVERNANCE_ID = "demo-compute-governance"
MORAL_PROGRESS_ID = "demo-moral-progress"
BIG_FIVE_ID = "demo-big-five"
FREE_WILL_ID = "demo-free-will"

_NAMESPACE = uuid5(NAMESPACE_URL, "talleyrand/demo-cases")

# Answers in the demo cases carry the model the app would have used
_ANSWER_MODEL = "gpt-5.6-sol-medium"

# Length of the recorded context around a selection or highlight anchor
_CONTEXT_CHARS = 80


def _locate(response: str, phrase: str) -> tuple[int, int, str, str]:
    """
    Anchor a phrase in an answer: (start, end, prefix, suffix).

    Marker offsets index the rendered answer text, which equals the source
    string only while everything before the phrase is plain prose in the first
    paragraph — no markdown syntax, no cross-link tokens. Enforced here so a
    seeded marker can never silently land in the wrong place.
    """
    start = response.find(phrase)
    if start == -1 or response.find(phrase, start + 1) != -1:
        raise ValueError(f"anchored phrase must occur exactly once: {phrase!r}")
    before = response[:start]
    if any(token in before for token in ("\n", "**", "[[", "`", "#", "$")):
        raise ValueError(f"markup before anchored phrase would shift its offsets: {phrase!r}")
    if "[[" in phrase:
        # build() rewrites [[x.y]] tokens to node-id form after anchoring,
        # which would shift this phrase's end offset
        raise ValueError(f"anchored phrase must not contain a cross-link token: {phrase!r}")
    end = start + len(phrase)
    return (
        start,
        end,
        response[max(0, start - _CONTEXT_CHARS) : start],
        response[end : end + _CONTEXT_CHARS],
    )


class _CaseBuilder:
    """
    Assembles a GraphDocument from questions declared in creation order.

    Declaration order matters twice: it is the node array order, which fixes
    sibling order and therefore the [1.2]-style outline numbers, and it drives
    the strictly increasing timestamps.
    """

    def __init__(self, case_id: str, *, name: str, brief: str, started: datetime) -> None:
        self._case_id = case_id
        self._name = name
        self._brief = brief
        self._clock = started
        self._nodes: list[NodeDTO] = []
        self._edges: list[EdgeDTO] = []
        self._contents: dict[UUID, NodeContentDTO] = {}
        self._suggestions: list[ResearchSuggestionDTO] = []
        self._declined: list[DeclinedQuestionDTO] = []

    def _uuid(self, kind: str, key: str) -> UUID:
        return uuid5(_NAMESPACE, f"{self._case_id}/{kind}/{key}")

    def _tick(self) -> datetime:
        self._clock += timedelta(minutes=9)
        return self._clock

    def question(
        self,
        key: str,
        query: str,
        *,
        parent: UUID | None = None,
        answer: str = "",
        asked_about: str | None = None,
        resolved: bool = False,
    ) -> UUID:
        """Add a question node; `asked_about` selects a phrase of the parent's answer."""
        node_id = self._uuid("node", key)
        self._nodes.append(NodeDTO(id=node_id))
        if parent is not None:
            self._edges.append(EdgeDTO(id=self._uuid("edge", key), source=parent, target=node_id))

        parent_selection: tuple[int, int, str, str] | None = None
        if asked_about is not None:
            if parent is None:
                raise ValueError(f"asked_about requires a parent: {key!r}")
            parent_content = self._contents[parent]
            parent_selection = _locate(parent_content.response, asked_about)
            start, end, prefix, suffix = parent_selection
            parent_content.selections.append(
                TextSelectionDTO(
                    text=asked_about,
                    start_offset=start,
                    end_offset=end,
                    prefix=prefix,
                    suffix=suffix,
                    child_node_id=str(node_id),
                )
            )

        if resolved and not answer:
            raise ValueError(f"a question cannot be resolved without an answer: {key!r}")
        answered_at = self._tick() if answer else None
        self._contents[node_id] = NodeContentDTO(
            id=node_id,
            query=query,
            response=answer,
            selected_model=_ANSWER_MODEL,
            documents=[],
            answered_at=answered_at,
            resolved_at=self._tick() if resolved else None,
            parent_selected_text=asked_about,
            parent_selected_prefix=parent_selection[2] if parent_selection else None,
            parent_selected_suffix=parent_selection[3] if parent_selection else None,
            selection_suggestions=[],
            selections=[],
        )
        return node_id

    def suggest(self, key: str, parent: UUID, text: str, *, big_picture: bool = False) -> None:
        """Add a pending suggestion card under an answered question."""
        if not self._contents[parent].response:
            raise ValueError(f"suggestions hang under answered questions: {key!r}")
        self._suggestions.append(
            ResearchSuggestionDTO(
                id=str(self._uuid("suggestion", key)),
                parent_node_id=parent,
                text=text,
                big_picture=big_picture,
                created_at=self._tick(),
            )
        )

    def decline(self, text: str, reason: str, parent: UUID) -> None:
        """Record a suggestion the case's author declined, with the reason."""
        self._declined.append(
            DeclinedQuestionDTO(
                text=text,
                reason=reason,
                parent_node_id=parent,
                declined_at=self._tick(),
            )
        )

    def highlight(self, key: str, node: UUID, phrase: str) -> None:
        """Mark a passage of an answer as an insight (the lightbulb action)."""
        content = self._contents[node]
        start, end, prefix, suffix = _locate(content.response, phrase)
        content.highlights.append(
            HighlightDTO(
                id=str(self._uuid("highlight", key)),
                text=phrase,
                start_offset=start,
                end_offset=end,
                prefix=prefix,
                suffix=suffix,
                created_at=self._tick(),
            )
        )

    def build(self) -> tuple[str, GraphDocument]:
        # Answers are authored with outline-number refs ([[1.2]]) for
        # readability; the app stores node-id refs. Rewritten here, after all
        # declarations, because an answer may cite a question filed later in
        # creation order (e.g. a root the case opens with but answers last).
        # Safe for the anchors located earlier: _locate rejects any anchor
        # preceded by (or containing) a token.
        tree = build_question_tree(
            GraphNoId(nodes=self._nodes, edges=self._edges, node_contents=[])
        )
        node_id_by_outline = {outline: nid for nid, outline in tree.outline.items()}
        for content in self._contents.values():
            content.response = freeze_ref_tokens(content.response, node_id_by_outline, strict=True)
        return self._case_id, GraphDocument(
            name=self._name,
            user_id=DEMO_USER_ID,
            nodes=self._nodes,
            edges=self._edges,
            node_contents=list(self._contents.values()),
            brief=self._brief,
            case_documents=[],
            suggestions=self._suggestions,
            declined_questions=self._declined,
            read_history=[],
        )


def _compute_governance() -> tuple[str, GraphDocument]:
    """The kickstart demo's case: its drafted brief and questions, worked through."""
    case = _CaseBuilder(
        COMPUTE_GOVERNANCE_ID,
        name="Does compute governance work?",
        brief=(
            "Work out whether compute governance slows the development of dangerous AI "
            "capabilities or mostly relocates it. Main threads: what the controls restrict in "
            "practice, evasion and smuggling, domestic substitutes, and what success would "
            "even look like."
        ),
        started=datetime(2026, 6, 22, 14, 11, tzinfo=UTC),
    )
    restrict = case.question(
        "restrict",
        "What does compute governance actually restrict today, in practice?",
        answer=(
            "Three layers, with uneven teeth. First, export controls cap the AI chips China "
            "can buy: performance-and-interconnect thresholds that catch the flagship "
            "data-center GPUs and their near-equivalents. Second, chipmaking-equipment "
            "controls, coordinated with the Netherlands and Japan, block the EUV lithography "
            "(and some advanced DUV) needed to fabricate leading-edge chips domestically — "
            "the deeper cut, aimed at capacity rather than inventory. Third, a thinner "
            "regulatory shell around everything else: entity lists, end-user rules, and "
            "proposed know-your-customer duties for cloud providers renting compute across "
            "the border.\n\n"
            "What is not restricted matters just as much: model weights, algorithms, "
            "researchers, and most cross-border inference. The control surface is hardware "
            "acquisition, not capability itself — which is why what “working” would "
            "even mean is its own question, [[5]]."
        ),
    )
    slowdown = case.question(
        "slowdown",
        "How much have export controls slowed frontier training runs so far?",
        answer=(
            "Less than the headlines claim, in both directions. Chinese labs still train "
            "near-frontier models — the celebrated runs were done on legally bought, "
            "deliberately downgraded chips plus stockpiles amassed ahead of each tightening "
            "round. Estimates put the raw compute gap between the largest US and Chinese "
            "clusters at roughly an order of magnitude, and the gap binds less on whether a "
            "given model can be trained than on how many experiments a lab can afford — "
            "iteration speed, not possibility.\n\n"
            "Three effects are well documented: stockpiling surges before each rule change, a "
            "persistent grey-market premium on banned parts, and engineering talent diverted "
            "into efficiency research instead of brute scale. Whether that diversion is a "
            "cost to them or a gift is genuinely unclear. How the banned parts keep arriving "
            "anyway is the subject of [[3]]."
        ),
    )
    smuggling = case.question(
        "smuggling",
        "How easily can controlled chips be smuggled or substituted?",
        answer=(
            "Easier than the rules assume, harder than the cynics claim. Reporting and "
            "seizures point to smuggling in the tens of thousands of GPUs a year through "
            "shell buyers and transshipment hubs — real, but an order of magnitude short of "
            "a frontier cluster, and smuggled fleets are hard to concentrate, network, and "
            "service into one coherent training run.\n\n"
            "Substitution is the more serious leak. The domestic accelerator lines are a "
            "generation or two behind on the silicon and further behind on software and "
            "yield — but they exist at scale precisely because the controls made them "
            "existential. And the cleanest bypass isn't physical at all: renting the same "
            "compute through offshore cloud intermediaries, which is exactly the hole the "
            "proposed know-your-customer rules try to close. The thing to watch is "
            "cluster-scale concentration, not unit counts."
        ),
    )
    track_record = case.question(
        "track-record",
        "What is the track record of past technology controls, like nuclear or crypto?",
        answer=(
            "The record splits cleanly by what was controlled. Nuclear-style controls on "
            "physical, capital-intensive chokepoints with few suppliers worked passably: "
            "proliferation was slowed by years to decades, though the A.Q. Khan network "
            "showed how far one leak can metastasize. The 1990s crypto wars are the opposite "
            "pole: encryption was software, export controls collapsed against costless "
            "copying, and the main casualty was the credibility of the controllers. Cold-war "
            "machine-tool controls sit between — the Toshiba–Kongsberg affair proved that "
            "allied unity, not the rules' text, was the binding constraint.\n\n"
            "Compute today resembles the nuclear case: physical, concentrated in a handful "
            "of suppliers, with a lithography monopoly upstream. But the thing it ultimately "
            "guards — model capability — diffuses like crypto once trained. The controls buy "
            "time on hardware; they do not control the payoff."
        ),
    )
    success = case.question(
        "success-criteria",
        "What evidence would show the controls work — or just relocate the work?",
        answer=(
            "Separate three outcomes the debate keeps blurring: the global frontier slows "
            "(not the goal and not happening), the gap between US and Chinese frontier runs "
            "widens or holds (the actual mechanism), and the work relocates through "
            "loopholes (the failure mode).\n\n"
            "Falsifiable markers for each: where the largest disclosed training runs "
            "physically happen; the grey-market premium on controlled chips — a working "
            "control shows up as a persistent, rising premium; the estimated compute behind "
            "the best Chinese models trailing the US frontier by a stable or growing margin; "
            "and domestic-accelerator benchmarks, where rapid closing would mean the "
            "controls are breeding their own obsolescence — the substitution channel from "
            "[[3]]. The sharpest single test: if in two years the best Beijing-trained model "
            "runs at frontier scale on home-grown silicon, the work relocated; if it still "
            "runs on downgraded or smuggled parts at a fraction of scale, the controls are "
            "doing what they were designed to do."
        ),
    )
    case.suggest(
        "restrict-walkthrough",
        restrict,
        "Walk me through what actually happens when a Chinese lab tries to buy 10,000 "
        "high-end GPUs today.",
    )
    case.suggest(
        "restrict-enforcement",
        restrict,
        "Who enforces these rules day to day, and with how many people?",
    )
    case.suggest(
        "slowdown-estimates",
        slowdown,
        "What do estimates of China's frontier compute actually rest on?",
    )
    case.suggest(
        "slowdown-efficiency",
        slowdown,
        "Did the controls speed up China's efficiency research more than they slowed its scale?",
    )
    case.suggest(
        "smuggling-cluster",
        smuggling,
        "What would it take to run a frontier-scale cluster entirely on smuggled chips?",
    )
    case.suggest(
        "smuggling-kyc",
        smuggling,
        "How would cloud know-your-customer rules verify who is really renting the compute?",
    )
    case.suggest(
        "track-crypto",
        track_record,
        "What made the crypto wars unwinnable — and does any of it carry over to hardware?",
    )
    case.suggest(
        "track-goal",
        track_record,
        "Am I grading compute governance against stopping China, when its real job is buying "
        "time for safety work?",
        big_picture=True,
    )
    case.suggest(
        "success-premium",
        success,
        "What is the strongest published evidence on whether the smuggled-chip premium is "
        "rising or falling?",
    )
    case.suggest(
        "success-alternative",
        success,
        "If the controls visibly failed, what would replace them — and would it be worse?",
    )
    return case.build()


def _moral_progress() -> tuple[str, GraphDocument]:
    """The branch demo's case: follow-ups asked from a selected phrase of the root answer."""
    case = _CaseBuilder(
        MORAL_PROGRESS_ID,
        name="Is moral progress real?",
        brief=(
            "I keep reaching for “moral progress” in arguments and I'm no longer sure "
            "the phrase survives scrutiny. Work out whether any moral change counts as progress "
            "— improvement by a standard the losers could also accept — or whether it's all "
            "just change that the present approves of because the present wrote the syllabus. "
            "Abolition and the expanding moral circle are my test cases. Take the skeptical "
            "position seriously; I don't want reassurance."
        ),
        started=datetime(2026, 6, 25, 10, 42, tzinfo=UTC),
    )

    # A single plain paragraph: two follow-ups anchor to a phrase inside it.
    root = case.question(
        "root",
        "Is moral progress real, or just moral change?",
        answer=(
            "Abolition looks like progress from inside our own morality — but every era's "
            "morality approves of itself, so that alone proves little. The stronger case is "
            "that some moral changes track better reasoning, not just changed tastes: wider "
            "evidence, fewer factual mistakes, more consistency. If so, progress is real but "
            "rarer than we'd like. The test that matters is whether a change survives a "
            "standard the losers could also accept — fewer factual errors about who feels "
            "what, principles applied without special pleading. Slavery's defenses leaned on "
            "factual claims that collapsed under exactly that pressure, and the collapse of a "
            "factual claim is not a change of taste."
        ),
    )
    abolition = case.question(
        "abolition",
        "Did abolition happen for moral reasons or economic ones?",
        parent=root,
        answer=(
            "Both stories have evidence, but the cleanest fact cuts against pure economics. "
            "The old thesis that abolition arrived once slavery stopped paying hasn't survived "
            "the data: the British slave economy was near peak profitability when Britain "
            "abolished the trade in 1807. And enforcement wasn't cheap symbolism — suppressing "
            "the Atlantic trade cost Britain nearly 2% of national income a year for six "
            "decades, arguably the most expensive international moral effort on record. "
            "Economics shaped the timing and the coalitions; interests always do. But a purely "
            "economic story has to explain a great power taxing itself for two generations to "
            "police other nations' commerce, and it can't. The uncomfortable middle: moral "
            "arguments won partly because the winners could afford to lose — which is itself "
            "a finding about when moral change happens."
        ),
    )
    case.question(
        "circles",
        "Do moral circles only ever expand?",
        parent=root,
        answer=(
            "No — the ratchet is a myth. The early Roman empire tolerated a wide range of "
            "cults and peoples; late antiquity and the centuries after narrowed it. Europe's "
            "witch persecutions peaked not in the “Dark Ages” but in 1560–1630, deep "
            "into the age of print and universities. Weimar Germany extended civic inclusion "
            "further than most of its neighbors; what followed contracted the moral circle "
            "deliberately and catastrophically. Tolerance can contract for centuries before "
            "widening again. So expansion is a tendency with reversals, not a law — and any "
            "argument for moral progress has to work without assuming a ratchet. Settled "
            "enough for this case: circles breathe."
        ),
        resolved=True,
    )
    case.highlight(
        "abolition-cost",
        abolition,
        "cost Britain nearly 2% of national income a year for six decades",
    )
    winners = case.question(
        "winners-history",
        "How would we tell better reasoning apart from the winners writing history?",
        parent=root,
        asked_about="some moral changes track better reasoning, not just changed tastes",
        answer=(
            "One test: whether a change cost its “winners” anything. That's exactly "
            "the fact you flagged — Britain enforced abolition for decades at real cost "
            "[[1.1]] — and self-congratulating history rarely sends the victors a bill. A "
            "second test: whether independent traditions converge when exposed to the same "
            "arguments and evidence, the way separate legal systems keep rediscovering "
            "proportionality. Winners can write their own history, but they can't easily "
            "write everyone else's. Follow the sacrifices."
        ),
    )
    reversals = case.question(
        "reversals",
        "Are there moral changes that later reversed?",
        parent=root,
        asked_about="some moral changes track better reasoning, not just changed tastes",
        answer=(
            "You've already met one: [[1.2]] found tolerance contracting for centuries before "
            "widening again. Others are less comfortable: eugenics spent decades as the "
            "progressive, scientific position before collapsing; Prohibition was a moral "
            "triumph for its movement and then un-happened. Reversals rule out inevitability, "
            "not progress — a trend can survive noise. What they really break is complacency: "
            "if progress is real, it is maintained, not owed."
        ),
    )
    case.suggest(
        "root-incoherent",
        root,
        "What is the strongest philosophical case that “moral progress” is an incoherent idea?",
    )
    case.suggest(
        "root-future-verdict",
        root,
        "Which of my own era's practices would a moral historian from 2200 file under "
        "“obvious wrongs”?",
        big_picture=True,
    )
    case.suggest(
        "abolition-resistance",
        abolition,
        "How much did enslaved people's own resistance — Haiti above all — drive abolition?",
    )
    case.suggest(
        "abolition-britain-first",
        abolition,
        "Why did abolition win in Britain decades before the United States?",
    )
    case.suggest(
        "winners-today",
        winners,
        "Which present-day moral claims are passing the sacrifice test right now?",
    )
    case.suggest(
        "winners-economics",
        winners,
        "Do moral arguments ever win without an economic wind at their back?",
    )
    case.suggest(
        "reversals-correction",
        reversals,
        "What separates a moral reversal from a moral correction?",
    )
    case.suggest(
        "reversals-eugenics",
        reversals,
        "Was the collapse of eugenics moral learning, or just guilt by association with "
        "Nazi atrocities?",
    )
    return case.build()


def _big_five() -> tuple[str, GraphDocument]:
    """The frontier demo's case: the question tree about personality psychology."""
    case = _CaseBuilder(
        BIG_FIVE_ID,
        name="What personality tests actually predict",
        brief=(
            "I want the honest quantitative picture of personality psychology. The Big Five "
            "keeps being called “the scientific one” — what do its traits actually "
            "predict, how big are those effects really, and how much survives the replication "
            "crisis? I already assume the pop typologies are weak, so don't spend my time "
            "debunking horoscopes. Numbers over narratives."
        ),
        started=datetime(2026, 6, 29, 8, 27, tzinfo=UTC),
    )

    root = case.question(
        "root",
        "What do Big Five traits actually predict?",
        answer=(
            "Real outcomes, but modestly: conscientiousness predicts job and school "
            "performance, neuroticism predicts relationship strain. Almost nothing crosses "
            "r = .3.\n\n"
            "The specifics: conscientiousness correlates with job performance around "
            "r = .20–.27 across meta-analyses — the most useful single trait — and with grades "
            "about the same. Neuroticism predicts divorce, lower life satisfaction, and mood "
            "and anxiety problems at similar sizes. Extraversion buys self-reported happiness; "
            "openness buys taste more than outcomes; agreeableness mildly costs income. For "
            "calibration, these are the same sizes as plenty of medical effects we act on "
            "without hesitation. So the field's real question is whether “r = .3, "
            "tops” is an indictment of the instruments or a fact about how many causes "
            "any life outcome has — worth asking directly."
        ),
    )
    effect_size = case.question(
        "effect-size",
        "Is a correlation of .3 big or small?",
        parent=root,
        answer=(
            "Both. It explains “only 9% of variance”, yet it doubles some real-world "
            "odds. And it beats almost every other predictor psychology has.\n\n"
            "The variance framing misleads. With r = .30, moving from the bottom half to the "
            "top half of a trait shifts the odds of an above-median outcome from roughly 35% "
            "to 65% — a swing anyone would notice in hiring or in a marriage. The benchmark "
            "comparison most cited in the field puts it in perspective: ibuprofen on pain "
            "runs around r = .14, antihistamines on allergy symptoms around r = .11, and we "
            "happily consume both. By that yardstick .30 is large for social science. The "
            "honest caveat cuts the other way: small samples and flexible analysis inflated "
            "many published personality effects, so treat .30 as a ceiling, not a floor."
        ),
    )
    replication = case.question(
        "replication",
        "Why do effect sizes shrink on replication?",
        parent=effect_size,
        answer=(
            "Four mechanisms, in rough order of blame. Publication bias: journals printed "
            "positive results, so the literature's effect sizes were selected upward, and "
            "replications regress toward the truer mean. Flexible analysis: with enough "
            "outcome measures, covariates and stopping rules, a small sample yields a big "
            "effect somewhere — and the replication doesn't get to choose the flattering "
            "path. Winner's curse: the studies that clear the significance bar in a small "
            "sample are precisely the lucky overestimates. And genuine moderation — samples, "
            "eras and cultures differ — which explains less than researchers hoped.\n\n"
            "Personality psychology weathered this better than its neighbors: the trait–"
            "outcome correlations came from large, boring samples long before that was "
            "fashionable, which is why the .2–.3 range from [[1.1]] held while flashier "
            "effects halved. The lesson isn't “trust nothing” — it's “trust "
            "effects that were cheap to find in big samples.”"
        ),
    )
    stability = case.question(
        "stability",
        "Do traits change over a lifetime?",
        parent=root,
        answer=(
            "Both stability and change are real, at different zoom levels. Rank-order "
            "stability — whether you stay more conscientious than your peers — rises from "
            "about .3 in childhood to .6–.7 across multi-year spans in adulthood: high, but "
            "visibly below 1. Mean-level change is systematic: most people grow more "
            "conscientious and agreeable and less neurotic from 20 to 50 — the maturity "
            "principle — with the steepest moves in the twenties, when work and partnership "
            "roles arrive.\n\n"
            "Deliberate change is modest but real: intervention studies shift targeted "
            "traits, mostly neuroticism, by a quarter to half a standard deviation in months, "
            "and the shifts partly stick. So traits behave more like body weight than eye "
            "color: strongly self-similar year to year, movable with sustained effort, and "
            "drifting predictably with age."
        ),
    )
    case.question(
        "mbti",
        "Is Myers-Briggs any better?",
        parent=root,
        answer=(
            "No. Its types don't replicate — half of retakers get a different letter within "
            "weeks — while continuous traits stay stable. Settled, not worth more time.\n\n"
            "The core problem is the binning: scores on every MBTI dimension are roughly "
            "normally distributed, so there is no natural cliff between an E and an I — the "
            "type boundary slices the fattest part of the bell curve, which is why test-retest "
            "studies find around half of people switching at least one letter in as little as "
            "five weeks. What signal the dimensions do carry is mostly the Big Five wearing a "
            "costume — minus neuroticism, the trait with the most clinical relevance."
        ),
        resolved=True,
    )
    case.suggest(
        "root-facets",
        root,
        "Do narrow facets, rather than the broad five traits, do the real predictive work?",
    )
    case.suggest(
        "root-controls",
        root,
        "How much do these correlations shrink once intelligence and income are controlled for?",
    )
    case.suggest(
        "effect-individual",
        effect_size,
        "What does r = .3 license me to conclude about one person, rather than a group?",
    )
    case.suggest(
        "effect-destiny",
        effect_size,
        "Is my discomfort with small effects about statistics, or about wanting personality "
        "to be destiny?",
        big_picture=True,
    )
    case.suggest(
        "replication-casualties",
        replication,
        "Which famous personality findings actually failed to replicate?",
    )
    case.suggest(
        "replication-prereg",
        replication,
        "How do preregistered personality studies compare with the older literature?",
    )
    case.suggest(
        "stability-training",
        stability,
        "Can conscientiousness be deliberately trained, and what does the intervention "
        "evidence say?",
    )
    case.suggest(
        "stability-events",
        stability,
        "Do major life events — parenthood, unemployment, bereavement — leave lasting trait "
        "changes?",
    )
    return case.build()


def _free_will() -> tuple[str, GraphDocument]:
    """The suggestions demo's case: an answered question with its pending suggestions."""
    case = _CaseBuilder(
        FREE_WILL_ID,
        name="Does neuroscience disprove free will?",
        brief=(
            "Headlines keep claiming the brain “decides before you do.” I want to "
            "know whether the neuroscience actually shows that, and whether it would matter "
            "for free will if it did. I studied a little philosophy of mind years ago — skip "
            "the intro-course taxonomy of positions. What I care about: which arguments "
            "actually depend on experimental results, and which are philosophy wearing a lab "
            "coat."
        ),
        started=datetime(2026, 7, 2, 19, 53, tzinfo=UTC),
    )

    root = case.question(
        "root",
        "Does neuroscience disprove free will?",
        answer=(
            "The experiments are real; the headline is an overreach. Readiness-potential "
            "studies do find neural activity that precedes the reported moment of deciding, "
            "and decoding studies can guess an upcoming button press above chance several "
            "seconds early. But “above chance” has meant around 60% on a two-option "
            "choice, and the early activity reads at least as well as background noise "
            "drifting toward a threshold as it does a decision already made. More "
            "importantly, even a perfect prediction would not be news to anyone who already "
            "accepts that choices are implemented by brains: prediction from prior physical "
            "state is determinism restated with electrodes. The philosophical work is done by "
            "the deterministic premise, not by the data — the experiments at most illustrate "
            "it. So the argument leans on determinism itself; the brain-scan evidence adds "
            "less than it seems."
        ),
    )
    case.question(
        "quantum",
        "Does quantum randomness rescue free will?",
        parent=root,
        answer=(
            "No — it changes the problem without solving it. If quantum indeterminacy "
            "percolates up to neural firing at all (contested: the brain is warm, wet and "
            "noisy at scales that usually wash quantum effects out), what it buys is "
            "randomness, and a random swerve is no more “up to you” than a "
            "determined one. A decision that traces to an uncaused quantum event traces to "
            "nothing you control — the luck objection, still unanswered. Indeterminism "
            "matters only for the narrow claim “the future is open”; it does "
            "nothing for the claim “I am the author.” Whatever rescues free will, "
            "it won't be physics rolling dice."
        ),
        resolved=True,
    )
    case.suggest(
        "compatibilists",
        root,
        "What do compatibilists actually mean by a “free” choice?",
    )
    case.suggest(
        "libet",
        root,
        "Do the Libet experiments really show decisions happen before awareness?",
    )
    case.suggest(
        "reframe",
        root,
        "Am I asking an empirical question dressed up as a philosophical one?",
        big_picture=True,
    )
    case.decline(
        "What are the main philosophical positions on free will?",
        "know_this",
        root,
    )
    return case.build()


def build_demo_cases() -> list[tuple[str, GraphDocument]]:
    """All demo cases as (graph_id, document) pairs, built fresh on each call."""
    return [
        _compute_governance(),
        _moral_progress(),
        _big_five(),
        _free_will(),
    ]

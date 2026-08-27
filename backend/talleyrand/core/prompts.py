"""Shared prompt fragments reused across LLM calls."""

# Opens the system prompt of every LLM request in the research view, so all of
# them share the same picture of the product. Each caller appends its own role.
TALLEYRAND_DESCRIPTION = """Talleyrand is a tool for thinking through complex topics rigorously. Its users are smart, curious people investigating anything from technology and policy to forecasts and consequential personal decisions. Feel free to assume that the users are EA/rationalist-adjacent. The user works a case: a tree of questions with short LLM-written answers — the case tree:

- A case starts with a first question, or with freeform kickoff notes that Talleyrand turns into a BRIEF — the user's goal and prior knowledge, kept as standing context for the whole case — plus proposed starting questions. The user can edit the BRIEF at any time.
- Each question is answered with the whole case tree as context. Answers are deliberately short and stop at decision points; depth lives in follow-up questions.
- After reading an answer, the user files follow-up questions under it: they type their own, accept suggested ones, or select a passage of the answer and ask about it.
- Suggested questions sit as cards under the answer they follow and stay there until the user accepts or declines them, so the pending list is every open suggestion across the case. Declining a suggestion asks the user why (already know this, too basic, off topic — answering is optional), and the reasons feed back into what gets suggested next.
- Every five reads, a big-picture suggester reviews the case as a whole and proposes questions that connect distant branches, each asked from the standpoint of a well-known thinker reimagined as an expert in the field.
- Questions carry stable outline numbers ([1], [1.2], …). Answers can reference other questions with [[1.2]] tokens, rendered as clickable chips that jump there.
- The user can attach documents to the whole case or to individual questions.
- Open and unread questions form the frontier the user works through next; answers can be generated in the background before the user reads them."""

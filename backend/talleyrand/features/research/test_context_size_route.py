"""
Tests for the context-size endpoint behind the composer's meter.

The meter must show what the next question would actually send: counted on
the saved case by the model's own counter when it can be asked, and marked as
an estimate when it cannot.
"""

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from talleyrand.features.graph.dtos import GraphNoId, NodeContentDTO, NodeDTO
from talleyrand.features.research import context_size as context_size_module
from talleyrand.features.research.router import router
from talleyrand.infra.local_user import current_user
from talleyrand.models.user import User

GRAPH_ID = uuid4()
ROOT = uuid4()


def case() -> GraphNoId:
    return GraphNoId(
        nodes=[NodeDTO(id=ROOT)],
        edges=[],
        node_contents=[
            NodeContentDTO(
                id=ROOT,
                query="Does the deal hold?",
                response="It holds, narrowly.",
                selected_model="hermes-gpt-6-astra",
                documents=[],
                selection_suggestions=[],
                selections=[],
            )
        ],
        brief="Whether the deal holds.",
    )


@pytest.fixture
def client(monkeypatch) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[current_user] = lambda: User(id="1", email="u@example.com")
    monkeypatch.setattr(
        context_size_module.manager, "load_effective_graph", AsyncMock(return_value=case())
    )
    return TestClient(app)


def count(client: TestClient, model: str):
    return client.post(
        f"/research/{GRAPH_ID}/context-size",
        json={"model": model, "parentNodeId": str(ROOT), "draftQuery": "", "draftDocuments": []},
    )


def test_the_next_question_is_estimated_against_its_agents_input_limit(client):
    response = count(client, "hermes-gpt-6-astra")

    assert response.status_code == 200
    body = response.json()
    assert body["tokens"] > 0
    assert body["maxInputTokens"] == 150_000
    # The agent CLIs have no counter: tiktoken estimates, and the meter says so.
    assert body["estimated"] is True


def test_the_count_is_of_the_prompt_the_answer_would_send(client, monkeypatch):
    counter = AsyncMock(return_value=123_456)
    monkeypatch.setattr(context_size_module, "count_prompt_tokens", counter)

    response = count(client, "claude-code-fable-5-1")

    assert response.json() == {"tokens": 123_456, "maxInputTokens": 150_000, "estimated": True}
    window, _system, prompt = counter.call_args.args
    assert window.api_model == "claude-code"
    assert "CURRENT QUESTION: [1.1] " in prompt


def test_unknown_model_is_a_bad_request(client):
    assert count(client, "gpt-imaginary").status_code == 400


def test_missing_case_is_not_found(client, monkeypatch):
    monkeypatch.setattr(
        context_size_module.manager, "load_effective_graph", AsyncMock(return_value=None)
    )
    assert count(client, "hermes-gpt-6-astra").status_code == 404

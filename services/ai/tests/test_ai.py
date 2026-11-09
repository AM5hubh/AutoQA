import json
from pathlib import Path
from unittest.mock import AsyncMock
import httpx
from openai import AsyncOpenAI
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.models import Plan

FIXTURE = json.loads((Path(__file__).resolve().parents[3] / "tests/fixtures/plan.json").read_text())


def test_shared_contract():
    assert Plan.model_validate(FIXTURE).tests[0].id == "cart-count"


def test_rejects_executable_code():
    plan = json.loads(json.dumps(FIXTURE))
    plan["tests"][0]["steps"][0] = {"action": "evaluate", "code": "alert(1)"}
    with pytest.raises(ValueError):
        Plan.model_validate(plan)


@pytest.mark.parametrize("path", ["//evil.test", "/\\evil.test", "javascript:alert(1)"])
def test_forbidden_navigation(path):
    plan = json.loads(json.dumps(FIXTURE))
    plan["tests"][0]["steps"][0]["path"] = path
    with pytest.raises(ValueError):
        Plan.model_validate(plan)


def test_requires_assertion():
    plan = json.loads(json.dumps(FIXTURE))
    plan["tests"][0]["steps"].pop()
    with pytest.raises(ValueError):
        Plan.model_validate(plan)


def test_service_requires_token(monkeypatch):
    monkeypatch.setenv("AI_SERVICE_TOKEN", "test-token")
    assert TestClient(app).post("/plan", json={}).status_code == 401


def test_missing_key_is_explicit(monkeypatch):
    monkeypatch.setenv("AI_SERVICE_TOKEN", "test-token")
    monkeypatch.setenv("OPENAI_API_KEY", "must-not-use-openai-key")
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    assert TestClient(app).get("/health").json()["modelConfigured"] is False
    response = TestClient(app).post("/plan", headers={"Authorization": "Bearer test-token"}, json={"instructions": "Check the cart count", "observations": [{"url": "https://demo.test", "title": "Demo", "content": "cart", "truncated": False}]})
    assert response.status_code == 503


def test_analysis_rejects_fabricated_evidence(monkeypatch):
    monkeypatch.setenv("AI_SERVICE_TOKEN", "test-token")
    result = {"findings": [{"resultId": "r1", "category": "assertion", "explanation": "x", "evidenceIds": ["invented"], "investigation": "x", "uncertainty": "x"}]}
    monkeypatch.setattr("app.main.structured", AsyncMock(return_value=(result, {}, "test")))
    response = TestClient(app).post("/analyze", headers={"Authorization": "Bearer test-token"}, json={"results": [{"id": "r1", "steps": [{"id": "real"}]}]})
    assert response.status_code == 422


def test_payload_limit(monkeypatch):
    monkeypatch.setenv("AI_SERVICE_TOKEN", "test-token")
    response = TestClient(app).post("/plan", content="x" * 140000)
    assert response.status_code == 413


def groq_transport(monkeypatch, *, content, finish="stop", refusal=None, status=200):
    monkeypatch.setenv("AI_SERVICE_TOKEN", "test-token")
    monkeypatch.setenv("GROQ_API_KEY", "groq-test-key")
    monkeypatch.setenv("OPENAI_API_KEY", "must-not-use-openai-key")
    monkeypatch.delenv("GROQ_MODEL", raising=False)
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(status, json={
            "id": "chat-test", "object": "chat.completion", "created": 0,
            "model": "openai/gpt-oss-20b",
            "choices": [{"index": 0, "finish_reason": finish,
                         "message": {"role": "assistant", "content": content, "refusal": refusal}}],
            "usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150},
        } if status == 200 else {"error": {"message": "secret upstream error"}})

    monkeypatch.setattr("app.main.AsyncOpenAI", lambda **kwargs: AsyncOpenAI(
        **kwargs, http_client=httpx.AsyncClient(transport=httpx.MockTransport(respond)),
    ))
    return requests


@pytest.mark.parametrize("endpoint, payload, result", [
    ("plan", {"instructions": "Check the cart count", "observations": [
        {"url": "https://demo.test", "title": "Demo", "content": "cart", "truncated": False}
    ]}, FIXTURE),
    ("analyze", {"results": [{"id": "r1", "steps": [{"id": "step1"}]}]}, {"findings": [
        {"resultId": "r1", "category": "assertion", "explanation": "Count differed",
         "evidenceIds": ["step1"], "investigation": "Inspect the cart update", "uncertainty": "Cause unknown"}
    ]}),
])
def test_groq_uses_openai_sdk_and_validates_structured_outputs(monkeypatch, endpoint, payload, result):
    requests = groq_transport(monkeypatch, content=json.dumps(result))
    response = TestClient(app).post(f"/{endpoint}", headers={"Authorization": "Bearer test-token"}, json=payload)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["plan" if endpoint == "plan" else "analysis"] == result
    assert data["model"] == "openai/gpt-oss-20b"
    assert data["usage"] == {"input_tokens": 100, "output_tokens": 50, "total_tokens": 150}
    assert len(requests) == 1
    request = requests[0]
    assert str(request.url) == "https://api.groq.com/openai/v1/chat/completions"
    assert request.headers["authorization"] == "Bearer groq-test-key"
    body = json.loads(request.content)
    assert body["model"] == "openai/gpt-oss-20b"
    assert body["response_format"]["type"] == "json_schema"
    assert body["response_format"]["json_schema"]["strict"] is True
    assert body["messages"][0]["role"] == "system"
    assert json.loads(body["messages"][1]["content"]) == payload
    assert body["max_completion_tokens"] == 4096
    assert "tools" not in body


@pytest.mark.parametrize("override, expected", [
    ({"refusal": "Cannot help", "content": None}, 422),
    ({"finish": "length"}, 422),
    ({"finish": "content_filter"}, 422),
    ({"content": "not json"}, 422),
    ({"content": json.dumps({**FIXTURE, "tests": []})}, 422),
    ({"status": 429}, 429),
    ({"status": 401}, 502),
])
def test_groq_errors_fail_closed_without_retries(monkeypatch, override, expected):
    requests = groq_transport(monkeypatch, **{"content": json.dumps(FIXTURE), **override})
    response = TestClient(app).post("/plan", headers={"Authorization": "Bearer test-token"}, json={
        "instructions": "Check the cart count", "observations": [
            {"url": "https://demo.test", "title": "Demo", "content": "cart", "truncated": False}
        ],
    })
    assert response.status_code == expected, response.text
    assert "secret upstream error" not in response.text
    assert len(requests) == 1

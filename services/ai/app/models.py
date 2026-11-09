from typing import Literal, Union
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Role(StrictModel):
    kind: Literal["role"]
    role: Literal["button", "link", "textbox", "checkbox", "combobox", "heading", "alert", "status", "listitem"]
    name: str = Field(min_length=1, max_length=200)


class Label(StrictModel):
    kind: Literal["label"]
    value: str = Field(min_length=1, max_length=200)


class TestId(StrictModel):
    kind: Literal["testId"]
    value: str = Field(min_length=1, max_length=200)


Target = Union[Role, Label, TestId]


class Navigate(StrictModel):
    action: Literal["navigate"]
    path: str = Field(max_length=2000)

    @field_validator("path")
    @classmethod
    def local_path(cls, value):
        if not value.startswith("/") or value.startswith("//") or "\\" in value or any(ord(c) < 32 for c in value):
            raise ValueError("Use a same-origin relative path")
        return value


class Click(StrictModel):
    action: Literal["click"]
    target: Target


class Fill(StrictModel):
    action: Literal["fill"]
    target: Target
    value: str = Field(max_length=1000)


class Select(StrictModel):
    action: Literal["select"]
    target: Target
    value: str = Field(max_length=200)


class Check(StrictModel):
    action: Literal["check"]
    target: Target
    checked: bool


class AssertVisible(StrictModel):
    action: Literal["assertVisible"]
    target: Target


class AssertText(StrictModel):
    action: Literal["assertText"]
    target: Target
    expected: str = Field(min_length=1, max_length=1000)


class AssertURL(Navigate):
    action: Literal["assertURL"]


class Screenshot(StrictModel):
    action: Literal["screenshot"]


Step = Union[Navigate, Click, Fill, Select, Check, AssertVisible, AssertText, AssertURL, Screenshot]


class TestCase(StrictModel):
    id: str = Field(pattern=r"^[a-z0-9-]{1,64}$")
    title: str = Field(min_length=1, max_length=200)
    requirement: str = Field(min_length=1, max_length=1000)
    priority: Literal["low", "medium", "high"]
    preconditions: list[str] = Field(max_length=5)
    assumptions: list[str] = Field(max_length=5)
    steps: list[Step] = Field(min_length=2, max_length=15)

    @model_validator(mode="after")
    def executable(self):
        if self.steps[0].action != "navigate" or not any(s.action.startswith("assert") for s in self.steps):
            raise ValueError("Tests must start with navigation and contain an assertion")
        if any(len(s) > 500 for s in self.preconditions + self.assumptions):
            raise ValueError("Precondition or assumption too long")
        return self


class Plan(StrictModel):
    title: str = Field(min_length=1, max_length=200)
    tests: list[TestCase] = Field(min_length=1, max_length=5)
    limitations: list[str] = Field(max_length=10)

    @model_validator(mode="after")
    def unique_ids(self):
        if len({t.id for t in self.tests}) != len(self.tests):
            raise ValueError("Test IDs must be unique")
        if any(len(s) > 1000 for s in self.limitations):
            raise ValueError("Limitation too long")
        return self


class Observation(StrictModel):
    url: str = Field(max_length=2000)
    title: str = Field(max_length=1000)
    content: str = Field(max_length=20000)
    truncated: bool


class PlanRequest(StrictModel):
    instructions: str = Field(min_length=10, max_length=4000)
    observations: list[Observation] = Field(min_length=1, max_length=3)


class Finding(StrictModel):
    resultId: str
    category: Literal["assertion", "locator", "network", "timeout", "accessibility", "layout", "environment"]
    explanation: str = Field(max_length=1500)
    evidenceIds: list[str] = Field(max_length=10)
    investigation: str = Field(max_length=1500)
    uncertainty: str = Field(max_length=500)


class Analysis(StrictModel):
    findings: list[Finding] = Field(max_length=15)


class AnalysisRequest(StrictModel):
    results: list[dict] = Field(min_length=1, max_length=15)

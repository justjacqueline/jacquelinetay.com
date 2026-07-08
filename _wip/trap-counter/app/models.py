from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class Point(BaseModel):
    id: str
    x: float = Field(ge=0)
    y: float = Field(ge=0)
    source: Literal["predicted", "reviewed", "manual"] = "reviewed"
    confidence: float | None = None


class AnnotationPayload(BaseModel):
    points: list[Point] = Field(default_factory=list)
    uncertain: bool = False
    notes: str = ""


class BatchOut(BaseModel):
    id: int
    name: str
    created_at: str
    image_count: int = 0


class ImageOut(BaseModel):
    id: int
    batch_id: int
    filename: str
    preview_url: str
    width: int
    height: int
    status: str
    predicted_count: int
    reviewed_count: int | None
    uncertain: bool
    notes: str
    model_version: str
    points: list[Point]
    validated: bool = False
    image_number: int | None = None
    plate: int = 1
    metadata: dict[str, Any] = Field(default_factory=dict)


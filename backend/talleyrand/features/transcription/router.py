"""
Transcription API router.
"""

from typing import Annotated

from fastapi import APIRouter, Depends

from talleyrand.features.auth_jwt import router as auth_app
from talleyrand.features.graph.dependencies import get_openai_api_key
from talleyrand.features.rate_limit.service import per_user_rate_limit
from talleyrand.features.transcription.dtos import (
    TranscribeRequestDTO,
    TranscribeResponseDTO,
)
from talleyrand.features.transcription.service import transcribe

router = APIRouter(prefix="/transcription", tags=["transcription"])


@router.post(
    "/transcribe",
    response_model=TranscribeResponseDTO,
    dependencies=[
        Depends(auth_app.require_auth),
        Depends(per_user_rate_limit("transcribe", per_minute=20)),
    ],
)
async def transcribe_audio(
    request: TranscribeRequestDTO,
    openai_api_key: Annotated[str, Depends(get_openai_api_key)],
) -> TranscribeResponseDTO:
    """Transcribe a recorded audio clip into text for the kickstart notes."""
    return await transcribe(request, openai_api_key)

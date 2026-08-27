"""
Transcription: turns a recorded audio clip into text with OpenAI's speech-to-text
model. The kickstart modal uses it so users can dictate their kickoff notes
instead of typing them.
"""

import base64
import binascii

from fastapi import HTTPException
from openai import AsyncOpenAI, OpenAIError

from talleyrand.features.transcription.dtos import (
    TranscribeRequestDTO,
    TranscribeResponseDTO,
)

TRANSCRIBE_MODEL = "gpt-4o-transcribe"


def _extension_from_mime(mime_type: str) -> str:
    """Derive an audio file extension from a MIME type.

    OpenAI detects the audio format from the filename's extension, so we map
    "audio/webm;codecs=opus" -> "webm", "audio/mp4" -> "mp4", etc.
    """
    base = mime_type.split(";", 1)[0].strip()
    subtype = base.rsplit("/", 1)[-1].strip()
    if "/" not in base or not subtype:
        raise HTTPException(status_code=400, detail=f"Unrecognized audio MIME type: {mime_type!r}.")
    return subtype


async def transcribe(request: TranscribeRequestDTO, openai_api_key: str) -> TranscribeResponseDTO:
    """Transcribe a recorded audio clip into text."""
    try:
        audio_bytes = base64.b64decode(request.audio, validate=True)
    except binascii.Error as e:
        raise HTTPException(status_code=400, detail="Audio payload is not valid base64.") from e

    if not audio_bytes:
        raise HTTPException(status_code=400, detail="No audio was recorded.")

    extension = _extension_from_mime(request.mime_type)
    client = AsyncOpenAI(api_key=openai_api_key)
    try:
        transcription = await client.audio.transcriptions.create(
            model=TRANSCRIBE_MODEL,
            file=(f"audio.{extension}", audio_bytes, request.mime_type),
        )
    except OpenAIError as e:
        raise HTTPException(status_code=400, detail=f"Transcription failed: {e}") from e

    return TranscribeResponseDTO(text=transcription.text.strip())

"""
API level contracts (DTOs) for the transcription feature.
"""

from talleyrand.features.graph.dtos import BaseSchema


class TranscribeRequestDTO(BaseSchema):
    """Request body for transcribing a recorded audio clip."""

    # Base64-encoded audio bytes, without any data-URL prefix.
    audio: str
    # The clip's MIME type as reported by the browser's MediaRecorder, e.g.
    # "audio/webm;codecs=opus" or "audio/mp4". Used to label the file so the
    # transcription model can detect the audio format.
    mime_type: str


class TranscribeResponseDTO(BaseSchema):
    """Response body with the transcribed text."""

    text: str

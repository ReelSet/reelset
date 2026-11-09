class RenderError(Exception):
    """Carries one of the stable error codes the worker maps to retry decisions."""

    CODES = ("tts_unavailable", "ffmpeg_failed", "invalid_input", "too_large", "busy")

    def __init__(self, code: str, message: str):
        if code not in self.CODES:
            raise ValueError(f"unknown error code {code}")
        super().__init__(message)
        self.code = code
        self.message = message

    HTTP_STATUS = {
        "invalid_input": 400,
        "too_large": 422,
        "tts_unavailable": 502,
        "ffmpeg_failed": 500,
        "busy": 409,
    }

    @property
    def status(self) -> int:
        return self.HTTP_STATUS[self.code]

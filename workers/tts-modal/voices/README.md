# Narrator voices

Reference clips Chatterbox clones at startup. Admins pick one in /admin settings
(`tts_chatterbox_voice`, default `genz`); a switch only changes new renders, existing reels keep
their voice. To add a voice: drop `<name>.wav` here (5 to 30 s of clean speech), add `<name>` to
`CHATTERBOX_VOICES` in `packages/core/src/domain/chatterbox-voice.ts`, and deploy Modal, then
the render worker and web.

Qwen (`qwen_app.py`) clones only `genz`, from two fixed excerpts of `genz.wav` (0-6.95 s and 17.15-26.65 s) and their transcript in `GENZ_TRANSCRIPT`; editing `genz.wav` means updating both.

| File | Source |
| --- | --- |
| `genz.wav` | Gen Z female clip supplied by the owner (default) |
| `genz_clean.wav` | `genz.wav` through ffmpeg `highpass=f=60,afftdn=nr=18:nf=-50:tn=1`; Qwen loads it as voice `genz-clean` |
| `voice4.wav` | Chatterbox demo page, Voice Agents sample `numbers_random_woman.wav` |
| `af_heart.wav` | Kokoro `af_heart` (Apache-2.0) |

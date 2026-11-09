"""Deterministic generator for the reel's SFX and music beds. No samples, no downloads.

    python tools/gen_audio.py [--out audio]

Writes <out>/sfx/<name>.wav (48 kHz mono, 16-bit) and <out>/music/bed<N>.m4a (48 kHz stereo,
~58 s, loop-aligned to whole bars, normalised to about -26 LUFS integrated)."""

import argparse
import json
import os
import subprocess
import wave

import numpy as np

SR = 48000
SFX_PEAK = 0.45
BED_LUFS = -26.0
BED_BARS = 24
VARIANTS = [
    {"bpm": 96, "root": 57, "prog": [(0, "m9"), (-4, "maj7"), (-9, "maj7"), (-2, "m7")]},
    {"bpm": 100, "root": 55, "prog": [(0, "m7"), (-2, "maj7"), (-4, "maj7"), (-7, "m7")]},
    {"bpm": 104, "root": 62, "prog": [(0, "maj7"), (-5, "m7"), (-3, "m7"), (-7, "maj7")]},
    {"bpm": 108, "root": 60, "prog": [(0, "m7"), (-4, "maj7"), (-7, "m9"), (-5, "m7")]},
]
CHORDS = {"m7": [0, 3, 7, 10], "m9": [0, 3, 7, 14], "maj7": [0, 4, 7, 11]}


def t_axis(seconds: float) -> np.ndarray:
    return np.arange(int(seconds * SR)) / SR


def rng(name: str) -> np.random.Generator:
    return np.random.default_rng(sum(name.encode()) * 7919)


def sweep_filter(x: np.ndarray, f0: float, f1: float, width: float = 0.8) -> np.ndarray:
    """Band-pass whose centre glides f0 -> f1 (log), via overlap-add STFT masking."""
    n = 1024
    hop = n // 4
    win = np.hanning(n)
    pad = np.concatenate([np.zeros(n), x, np.zeros(n)])
    out = np.zeros_like(pad)
    freqs = np.fft.rfftfreq(n, 1 / SR)
    frames = (len(pad) - n) // hop
    for i in range(frames):
        pos = min(max((i * hop - n) / max(len(x), 1), 0.0), 1.0)
        centre = f0 * (f1 / f0) ** pos
        mask = np.exp(-0.5 * (np.log2(np.maximum(freqs, 1) / centre) / width) ** 2)
        spec = np.fft.rfft(pad[i * hop : i * hop + n] * win) * mask
        out[i * hop : i * hop + n] += np.fft.irfft(spec, n) * win
    return out[n : n + len(x)]


def lowpass(x: np.ndarray, cutoff: float) -> np.ndarray:
    spec = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(len(x), 1 / SR)
    spec *= 1 / (1 + (freqs / cutoff) ** 4)
    return np.fft.irfft(spec, len(x))


def fade(x: np.ndarray, ms_in: float = 3, ms_out: float = 12) -> np.ndarray:
    a, b = int(SR * ms_in / 1000), int(SR * ms_out / 1000)
    x = x.copy()
    x[:a] *= np.linspace(0, 1, a)
    x[-b:] *= np.linspace(1, 0, b)
    return x


def peak_norm(x: np.ndarray, peak: float = SFX_PEAK) -> np.ndarray:
    return x / max(np.abs(x).max(), 1e-9) * peak


def whoosh() -> np.ndarray:
    t = t_axis(0.5)
    noise = rng("whoosh").standard_normal(len(t))
    env = np.sin(np.pi * np.clip(t / 0.5, 0, 1)) ** 1.6
    return fade(peak_norm(sweep_filter(noise, 350, 4200) * env))


def swoosh() -> np.ndarray:
    t = t_axis(0.32)
    noise = rng("swoosh").standard_normal(len(t))
    env = np.sin(np.pi * np.clip(t / 0.32, 0, 1)) ** 1.2
    return fade(peak_norm(sweep_filter(noise, 3800, 500, 0.7) * env, 0.35))


def pop() -> np.ndarray:
    t = t_axis(0.16)
    freq = 220 + 520 * np.exp(-t * 38)
    tone = np.sin(2 * np.pi * np.cumsum(freq) / SR) * np.exp(-t * 26)
    return fade(peak_norm(tone), 1, 15)


def tick() -> np.ndarray:
    t = t_axis(0.06)
    click = np.sin(2 * np.pi * 2100 * t) * np.exp(-t * 110)
    grit = rng("tick").standard_normal(len(t)) * np.exp(-t * 260) * 0.35
    return fade(peak_norm(click + grit, 0.32), 1, 10)


def ding() -> np.ndarray:
    t = t_axis(1.1)
    partials = [(1319, 1.0, 5.0), (1976, 0.45, 7.0), (2637, 0.28, 9.5), (3951, 0.1, 14.0)]
    tone = sum(a * np.sin(2 * np.pi * f * t) * np.exp(-t * d) for f, a, d in partials)
    attack = np.minimum(t / 0.004, 1)
    return fade(peak_norm(tone * attack, 0.4), 1, 40)


def hit() -> np.ndarray:
    t = t_axis(0.45)
    freq = 42 + 95 * np.exp(-t * 22)
    thump = np.sin(2 * np.pi * np.cumsum(freq) / SR) * np.exp(-t * 9)
    air = lowpass(rng("hit").standard_normal(len(t)), 1800) * np.exp(-t * 40) * 0.5
    return fade(peak_norm(thump + air, 0.55), 1, 30)


def riser() -> np.ndarray:
    dur = 1.3
    t = t_axis(dur)
    noise = rng("riser").standard_normal(len(t))
    swell = (t / dur) ** 2.2
    body = sweep_filter(noise, 300, 7000, 1.0) * swell
    freq = 180 * 2 ** (t / dur * 3)
    tone = np.sin(2 * np.pi * np.cumsum(freq) / SR) * swell * 0.25
    return fade(peak_norm(body + tone, 0.4), 5, 25)


SFX = {
    "whoosh": whoosh,
    "pop": pop,
    "tick": tick,
    "ding": ding,
    "hit": hit,
    "riser": riser,
    "swoosh": swoosh,
}


def write_wav(path: str, x: np.ndarray) -> None:
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def midi_hz(n: float) -> float:
    return 440.0 * 2 ** ((n - 69) / 12)


def music_bed(variant: int) -> np.ndarray:
    """Stereo bed: warm pad chords, sub bass root, soft pulse and offbeat air. No melody."""
    cfg = VARIANTS[variant % len(VARIANTS)]
    spb = 60 / cfg["bpm"]
    bar = spb * 4
    total = bar * BED_BARS
    n = int(total * SR)
    gen = np.random.default_rng(1000 + variant)
    left, right = np.zeros(n + int(bar * SR)), np.zeros(n + int(bar * SR))

    def add(buf: np.ndarray, start: float, sig: np.ndarray) -> None:
        i = int(start * SR)
        buf[i : i + len(sig)] += sig[: len(buf) - i]

    for b in range(BED_BARS):
        offset, kind = cfg["prog"][b % 4]
        root = cfg["root"] + offset
        start = b * bar
        t = t_axis(bar * 1.15)
        env = np.minimum(t / 0.5, 1) * np.exp(-np.maximum(t - bar * 0.7, 0) * 2.2)
        for ch, buf in ((0, left), (1, right)):
            pad = np.zeros(len(t))
            for k, semis in enumerate(CHORDS[kind]):
                f = midi_hz(root + 12 + semis)
                for d in (-0.07, 0.07):
                    ph = gen.uniform(0, 6.28)
                    f2 = f * 2 ** (d * (1 if ch else -1) / 12)
                    saw = 2 * ((f2 * t + ph / 6.28) % 1) - 1
                    pad += saw * (0.5 if k else 0.7)
            add(buf, start, lowpass(pad, 1100) * env * 0.05)
        t2 = t_axis(bar)
        bass = np.sin(2 * np.pi * midi_hz(root - 12) * t2) * np.minimum(t2 / 0.05, 1)
        bass *= np.exp(-np.maximum(t2 - bar * 0.8, 0) * 6)
        add(left, start, bass * 0.22)
        add(right, start, bass * 0.22)
        for beat in range(4):
            bt = start + beat * spb
            tk = t_axis(0.18)
            kick = np.sin(2 * np.pi * np.cumsum(46 + 70 * np.exp(-tk * 30)) / SR) * np.exp(-tk * 14)
            add(left, bt, kick * (0.28 if beat % 2 == 0 else 0.12))
            add(right, bt, kick * (0.28 if beat % 2 == 0 else 0.12))
            th = t_axis(0.05)
            hat = np.diff(gen.standard_normal(len(th) + 1)) * np.exp(-th * 90)
            for off in (spb / 2,):
                add(left, bt + off, hat * 0.05)
                add(right, bt + off, hat * 0.04)
    tail_l, tail_r = left[n:], right[n:]
    left, right = left[:n], right[:n]
    left[: len(tail_l)] += tail_l[: n]
    right[: len(tail_r)] += tail_r[: n]
    stereo = np.stack([left, right], axis=1)
    return stereo / max(np.abs(stereo).max(), 1e-9) * 0.5


def measure_lufs(path: str) -> float:
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"],
        capture_output=True, text=True, check=True,
    )  # fmt: skip
    tail = proc.stderr.rsplit("Integrated loudness:", 1)[1]
    return float(tail.split("I:")[1].split("LUFS")[0])


def write_bed(path: str, x: np.ndarray, tmp_wav: str) -> None:
    with wave.open(tmp_wav, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())
    gain_db = BED_LUFS - measure_lufs(tmp_wav)
    subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", tmp_wav,
         "-af", f"volume={gain_db:.2f}dB", "-c:a", "aac", "-b:a", "64k", path],
        check=True,
    )  # fmt: skip
    os.remove(tmp_wav)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "audio"))
    args = ap.parse_args()
    os.makedirs(os.path.join(args.out, "sfx"), exist_ok=True)
    os.makedirs(os.path.join(args.out, "music"), exist_ok=True)
    for name, fn in SFX.items():
        write_wav(os.path.join(args.out, "sfx", f"{name}.wav"), fn())
    beds = []
    for v in range(len(VARIANTS)):
        path = os.path.join(args.out, "music", f"bed{v}.m4a")
        write_bed(path, music_bed(v), os.path.join(args.out, "music", f"bed{v}.tmp.wav"))
        beds.append({"file": f"bed{v}.m4a", "bpm": VARIANTS[v]["bpm"], "bars": BED_BARS})
    with open(os.path.join(args.out, "music", "index.json"), "w") as fh:
        json.dump(beds, fh, indent=2)
    print("audio generated", args.out)


if __name__ == "__main__":
    main()

import logging
import os
import socket
import threading
import time
from collections import deque

log = logging.getLogger("reel.hoststats")

SAMPLE_INTERVAL_SECONDS = 5
WINDOW_SECONDS = 60


def box_name() -> str:
    return os.environ.get("BOX_NAME") or socket.gethostname()


def read_cpu_times(proc: str = "/proc") -> tuple[int, int] | None:
    """Returns (busy, total) jiffies from the aggregate cpu line of /proc/stat."""
    try:
        with open(os.path.join(proc, "stat")) as fh:
            parts = fh.readline().split()
        values = [int(v) for v in parts[1:]]
    except (OSError, ValueError):
        return None
    if parts[:1] != ["cpu"] or len(values) < 4:
        return None
    idle = values[3] + (values[4] if len(values) > 4 else 0)
    total = sum(values[:8])
    return total - idle, total


def read_load1(proc: str = "/proc") -> float | None:
    try:
        with open(os.path.join(proc, "loadavg")) as fh:
            return float(fh.read().split()[0])
    except (OSError, ValueError, IndexError):
        return None


def read_memory_mb(proc: str = "/proc") -> tuple[int | None, int | None]:
    """Returns (memUsedMb, swapUsedMb)."""
    fields: dict = {}
    try:
        with open(os.path.join(proc, "meminfo")) as fh:
            for line in fh:
                key, _, rest = line.partition(":")
                bits = rest.split()
                if bits and bits[0].isdigit():
                    fields[key] = int(bits[0])
    except OSError:
        return None, None
    mem = None
    if "MemTotal" in fields and "MemAvailable" in fields:
        mem = (fields["MemTotal"] - fields["MemAvailable"]) // 1024
    swap = None
    if "SwapTotal" in fields and "SwapFree" in fields:
        swap = (fields["SwapTotal"] - fields["SwapFree"]) // 1024
    return mem, swap


class CpuSampler:
    """Host CPU busy percent averaged over the last WINDOW_SECONDS, sampled by a daemon thread."""

    def __init__(self, proc: str = "/proc", interval: float = SAMPLE_INTERVAL_SECONDS):
        self.proc = proc
        self.interval = interval
        self._samples: deque = deque(maxlen=WINDOW_SECONDS // max(1, int(interval)) + 1)
        self._lock = threading.Lock()

    def sample(self) -> None:
        times = read_cpu_times(self.proc)
        if times is None:
            return
        with self._lock:
            self._samples.append(times)

    def cpu_pct(self) -> float | None:
        with self._lock:
            if len(self._samples) < 2:
                return None
            (busy0, total0), (busy1, total1) = self._samples[0], self._samples[-1]
        if total1 <= total0:
            return None
        return round(100.0 * (busy1 - busy0) / (total1 - total0), 1)

    def start(self) -> None:
        def loop():
            while True:
                try:
                    self.sample()
                except Exception:
                    log.exception("cpu sample failed")
                time.sleep(self.interval)

        self.sample()
        threading.Thread(target=loop, name="cpu-sampler", daemon=True).start()


def snapshot(sampler: CpuSampler, proc: str = "/proc") -> dict:
    mem, swap = read_memory_mb(proc)
    return {
        "cpuPct": sampler.cpu_pct(),
        "load1": read_load1(proc),
        "memUsedMb": mem,
        "swapUsedMb": swap,
    }

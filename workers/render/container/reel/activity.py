import threading
import time


class Activity:
    """Counts in-flight requests and how long the server has been idle."""

    def __init__(self, clock=time.monotonic):
        self._clock = clock
        self._lock = threading.Lock()
        self._inflight = 0
        self._last_finished = clock()

    def start(self) -> None:
        with self._lock:
            self._inflight += 1

    def finish(self) -> None:
        with self._lock:
            self._inflight = max(0, self._inflight - 1)
            self._last_finished = self._clock()

    def snapshot(self) -> tuple[int, int]:
        with self._lock:
            idle = 0.0 if self._inflight else self._clock() - self._last_finished
            return self._inflight, int(idle)

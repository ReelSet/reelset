import logging
import os
import shutil
import tempfile
import threading
import time

from .errors import RenderError

log = logging.getLogger("reel.jobs")

JOB_TTL_SECONDS = 30 * 60


class JobStore:
    """At most max_running renders at once (default 1); finished jobs live until DELETE or TTL."""

    def __init__(self, root: str | None = None, max_running: int = 1):
        self.root = root or tempfile.mkdtemp(prefix="reel-jobs-")
        self.max_running = max(1, max_running)
        self._jobs: dict = {}
        self._lock = threading.Lock()

    def job_dir(self, job_id: str) -> str:
        return os.path.join(self.root, job_id)

    def begin(self, job_id: str) -> tuple:
        """Returns ('new', dir) or ('done', metadata). Raises busy when a render is running."""
        with self._lock:
            self._reap_locked()
            job = self._jobs.get(job_id)
            if job and job["state"] == "done":
                return "done", job["meta"]
            if job and job["state"] == "running":
                raise RenderError("busy", "this job is already rendering")
            running = sum(1 for j in self._jobs.values() if j["state"] == "running")
            if running >= self.max_running:
                raise RenderError("busy", "render capacity is full")
            directory = self.job_dir(job_id)
            shutil.rmtree(directory, ignore_errors=True)
            os.makedirs(directory)
            self._jobs[job_id] = {"state": "running", "meta": None, "at": time.monotonic()}
            return "new", directory

    def running(self) -> int:
        with self._lock:
            return sum(1 for j in self._jobs.values() if j["state"] == "running")

    def finish(self, job_id: str, meta: dict) -> None:
        with self._lock:
            self._jobs[job_id] = {"state": "done", "meta": meta, "at": time.monotonic()}

    def fail(self, job_id: str) -> None:
        self.delete(job_id)

    def file_path(self, job_id: str, name: str) -> str | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job or job["state"] != "done":
                return None
        path = os.path.join(self.job_dir(job_id), name)
        return path if os.path.isfile(path) else None

    def delete(self, job_id: str) -> None:
        with self._lock:
            self._jobs.pop(job_id, None)
        shutil.rmtree(self.job_dir(job_id), ignore_errors=True)

    def _reap_locked(self) -> None:
        now = time.monotonic()
        for job_id in [
            j for j, v in self._jobs.items() if v["state"] == "done" and now - v["at"] > JOB_TTL_SECONDS
        ]:
            log.info("reaping stale job=%s", job_id)
            self._jobs.pop(job_id, None)
            shutil.rmtree(self.job_dir(job_id), ignore_errors=True)

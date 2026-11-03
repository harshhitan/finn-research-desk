"""Run FINN's existing collection endpoint without an AI agent or Codex login."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import socket
import stat
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit

SITE = "https://finn-reliance-research-desk.anandharshitwork03.chatgpt.site"


def configured_origin():
    origin = os.environ.get("FINN_RESEARCH_SITE_URL", SITE)
    parsed = urlsplit(origin)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username
            or parsed.password or parsed.port or parsed.path or parsed.query
            or parsed.fragment):
        raise CollectorError("Configure a plain HTTPS FINN origin")
    return origin
RETRYABLE = {408, 429, 500, 502, 503, 504}
MAX_RESPONSE = 1024 * 1024


class CollectorError(Exception):
    """Contains only a controlled message, safe for service logs."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def load_config(path):
    metadata = path.stat()
    if os.name == "posix" and (
        stat.S_IMODE(metadata.st_mode) & 0o077 or metadata.st_uid != os.getuid()
    ):
        raise CollectorError("Configuration must be owned by the service user and private")
    config = json.loads(path.read_text())
    if config.get("url") != configured_origin():
        raise CollectorError("Unexpected FINN Site origin")
    token = config.get("serviceToken")
    if not isinstance(token, str) or len(token) < 32 or "\r" in token or "\n" in token:
        raise CollectorError("Missing or invalid service credential")
    return config


class Collector:
    def __init__(self, config, *, opener=None, sleep=time.sleep, clock=time.monotonic,
                 budget=900, max_calls=15):
        self.token = config["serviceToken"]
        self.site = configured_origin()
        if config.get("url") != self.site:
            raise CollectorError("Unexpected FINN Site origin")
        self.opener = opener or urllib.request.build_opener(NoRedirect())
        self.sleep = sleep
        self.clock = clock
        self.deadline = clock() + budget
        self.max_calls = max_calls

    def pause(self, seconds):
        if self.clock() + seconds >= self.deadline:
            raise CollectorError("Collection time budget exhausted; pending work is retained")
        self.sleep(seconds)

    def request(self, path, method="GET"):
        # Paths are selected by this program, never supplied by a remote response.
        if (path, method) not in {("jobs/run", "POST"), ("jobs/status", "GET")}:
            raise CollectorError("Unexpected collector operation")
        request = urllib.request.Request(
            self.site + "/api/portfolio/" + path + "?kind=collect",
            data=b"{}" if method == "POST" else None, method=method,
            headers={"OAI-Sites-Authorization": "Bearer " + self.token,
                     "X-Finn-Job-Token": self.token,
                     "Content-Type": "application/json", "Accept": "application/json"},
        )
        for attempt in range(3):
            remaining = self.deadline - self.clock()
            if remaining < 1:
                raise CollectorError("Collection time budget exhausted; pending work is retained")
            try:
                with self.opener.open(request, timeout=min(110, remaining)) as response:
                    body = response.read(MAX_RESPONSE + 1)
                    if len(body) > MAX_RESPONSE:
                        raise CollectorError("Collector response exceeded size limit")
                    try:
                        value = json.loads(body)
                    except (ValueError, UnicodeError):
                        raise CollectorError("Collector returned invalid JSON") from None
                    if not isinstance(value, dict):
                        raise CollectorError("Collector returned an invalid response")
                    return value
            except urllib.error.HTTPError as error:
                code = error.code
                error.close()
                if code not in RETRYABLE or attempt == 2:
                    raise CollectorError("Collector HTTP " + str(code)) from None
            except (urllib.error.URLError, TimeoutError, socket.timeout, ConnectionError):
                if attempt == 2:
                    raise CollectorError("Collector connection failed after three attempts") from None
            # Server-side job IDs and leases make retrying an uncertain POST safe.
            self.pause((2, 5)[attempt])
        raise CollectorError("Collector request did not complete")

    def status(self):
        value = self.request("jobs/status")
        if value.get("jobKind") != "collect":
            raise CollectorError("Collection-only backend is not deployed; refusing mixed processing")
        jobs, errors = value.get("jobs"), value.get("sourceErrors")
        if not isinstance(jobs, list) or not isinstance(errors, list):
            raise CollectorError("Collector status response is incomplete")
        counts = {}
        for job in jobs:
            if (not isinstance(job, dict) or job.get("status") not in
                    {"queued", "retry", "running", "done", "failed"} or
                    type(job.get("count")) is not int or job["count"] < 0):
                raise CollectorError("Collector job status is invalid")
            counts[job["status"]] = job["count"]
        for key in ("quotes", "filings"):
            if type(value.get(key)) is not int or value[key] < 0:
                raise CollectorError("Collector source counts are invalid")
        return {"quotes": value["quotes"], "filings": value["filings"],
                "jobs": counts, "sourceErrorCount": len(errors),
                "serverCheckedAt": value.get("checkedAt")}

    def run(self):
        # Verify backend support before any write, so an older deployment cannot
        # silently ignore the selector and run model-analysis jobs.
        self.status()
        processed, reason = 0, "call_limit"
        for _ in range(self.max_calls):
            value = self.request("jobs/run", "POST")
            count, pending, busy = value.get("processed"), value.get("remaining"), value.get("busy")
            if (value.get("jobKind") != "collect" or type(count) is not int or count < 0 or type(pending) is not int or
                    pending < 0 or type(busy) is not bool):
                raise CollectorError("Collector run response is incomplete")
            processed += count
            if pending == 0:
                reason = "queue_drained"
                break
            if busy:
                self.pause(5)
            elif count == 0:
                # Jobs with future retry dates must wait; do not spin or delete them.
                reason = "pending_retry"
                break
        summary = self.status()
        pending = sum(summary["jobs"].get(key, 0) for key in ("queued", "retry", "running"))
        state = "attention" if summary["sourceErrorCount"] else "deferred" if pending else "ok"
        return {"status": state, "reason": reason, "processed": processed, **summary}


def record(path, value):
    value = {"checkedAt": datetime.now(timezone.utc).isoformat(), **value}
    temporary = path.with_suffix(".tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as output:
        json.dump(value, output)
        output.write("\n")
    os.replace(temporary, path)
    print(json.dumps(value), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path("/home/azureuser/finn-personal/config.json"))
    parser.add_argument("--state", type=Path, default=Path("/var/lib/finn-collector/status.json"))
    parser.add_argument("--lock", type=Path, default=Path("/run/finn-collector/run.lock"))
    parser.add_argument("--status-only", action="store_true")
    args = parser.parse_args()
    if args.status_only:
        try:
            print(json.dumps(Collector(load_config(args.config)).status()))
            return 0
        except Exception as error:
            print(json.dumps({"status": "error", "error": str(error) if isinstance(error, CollectorError)
                              else "Status check failed: " + type(error).__name__}))
            return 1
    import fcntl  # Linux service only; the collector logic is testable elsewhere.
    with args.lock.open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({"status": "skipped", "reason": "already_running"}))
            return 0
        try:
            config = load_config(args.config)
            record(args.state, {"status": "running"})
            record(args.state, Collector(config).run())
            return 0
        except Exception as error:
            record(args.state, {"status": "error", "error": str(error) if isinstance(error, CollectorError)
                               else "Collection failed: " + type(error).__name__})
            return 1


if __name__ == "__main__":
    sys.exit(main())

"""Owner-only FINN worker. Codex credentials remain under the VM user's account.

No inbound socket is opened. Job credentials are read from a mode-0600 JSON file.
"""
import argparse
import json
import os
from pathlib import Path
import selectors
import subprocess
import sys
import time
import urllib.error
import urllib.request

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


class Codex:
    def __init__(self, executable, cwd):
        self.process = subprocess.Popen(
            [executable, "app-server", "-c", "features.shell_tool=false",
             "-c", "features.unified_exec=false", "-c", 'web_search="disabled"',
             "-c", "features.apps=false", "-c", "features.browser_use=false",
             "-c", "features.computer_use=false", "-c", "features.multi_agent=false"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            cwd=cwd, bufsize=0)
        self.selector = selectors.DefaultSelector()
        self.selector.register(self.process.stdout, selectors.EVENT_READ)
        self.pending = b""
        self.sequence = 0
        self.request("initialize", {"clientInfo": {"name": "finn_personal", "title": "FINN Personal", "version": "1.0.0"}})
        self.send({"method": "initialized", "params": {}})

    def send(self, value):
        self.process.stdin.write((json.dumps(value) + "\n").encode())
        self.process.stdin.flush()

    def read(self, timeout=180):
        deadline = time.monotonic() + timeout
        while b"\n" not in self.pending:
            if not self.selector.select(max(0, deadline - time.monotonic())):
                raise TimeoutError("Codex response timed out")
            chunk = os.read(self.process.stdout.fileno(), 65536)
            if not chunk:
                raise RuntimeError("Codex exited before completion")
            self.pending += chunk
            if len(self.pending) > 2_000_000:
                raise RuntimeError("Codex output exceeded the limit")
        line, self.pending = self.pending.split(b"\n", 1)
        return json.loads(line)

    def request(self, method, params):
        self.sequence += 1
        identifier = self.sequence
        self.send({"id": identifier, "method": method, "params": params})
        while True:
            message = self.read()
            if message.get("id") == identifier and "method" not in message:
                if "error" in message:
                    raise RuntimeError("Codex rejected " + method)
                return message["result"]
            self.reject_request(message)

    def reject_request(self, message):
        # FINN supplies all evidence and never executes model-requested tools,
        # approvals, network operations or authentication delegation.
        if "id" in message and "method" in message:
            self.send({"id": message["id"], "error": {"code": -32601, "message": "FINN analysis does not allow tools or approvals"}})

    def models(self):
        result = self.request("model/list", {"limit": 50, "includeHidden": False})
        return [{"model": item["model"], "isDefault": item.get("isDefault", False)} for item in result["data"]]

    def analyse(self, job):
        thread = self.request("thread/start", {
            "model": job["model"], "ephemeral": True, "sandbox": "read-only",
            "approvalPolicy": "untrusted", "cwd": str(Path.cwd()),
            "baseInstructions": job["instructions"],
        })
        self.request("turn/start", {
            "threadId": thread["thread"]["id"],
            "input": [{"type": "text", "text": json.dumps(job["input"])}],
            "sandboxPolicy": {"type": "readOnly", "access": {"type": "restricted", "includePlatformDefaults": True, "readableRoots": [str(Path.cwd())]}},
        })
        messages = []
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            event = self.read(max(1, deadline - time.monotonic()))
            self.reject_request(event)
            params = event.get("params", {})
            if event.get("method") == "item/completed":
                item = params.get("item", {})
                if item.get("type") == "agentMessage":
                    messages.append(item.get("text", ""))
                elif item.get("type") not in ("reasoning", "userMessage"):
                    raise RuntimeError("Codex attempted a tool operation")
            if event.get("method") == "turn/completed":
                if params.get("turn", {}).get("status") != "completed":
                    raise RuntimeError("Codex turn did not complete")
                raw = messages[-1] if messages else ""
                if raw.startswith("```json\n") and raw.endswith("\n```"):
                    raw = raw[8:-4]
                return json.loads(raw)
        raise TimeoutError("Codex analysis timed out")

    def close(self):
        self.selector.close()
        self.process.terminate()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()


def api(config, path, body):
    payload = json.dumps(body).encode()
    if len(payload) > 350000:
        raise ValueError("FINN request exceeded the size limit")
    request = urllib.request.Request(config["url"].rstrip("/") + "/api/portfolio/private-worker/" + path,
        data=payload, headers={"Content-Type": "application/json", "OAI-Sites-Authorization": "Bearer " + config["serviceToken"], "X-Finn-Job-Token": config["serviceToken"]}, method="POST")
    with urllib.request.build_opener(NoRedirect).open(request, timeout=90) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config")
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--codex", default="/home/azureuser/.local/bin/codex")
    args = parser.parse_args()
    if args.probe:
        codex = Codex(args.codex, os.getcwd())
        try:
            print(json.dumps({"models": codex.models()}))
        finally:
            codex.close()
        return
    config_path = Path(args.config)
    if config_path.stat().st_mode & 0o077:
        raise ValueError("Worker configuration must have mode 0600")
    config = json.loads(config_path.read_text())
    from urllib.parse import urlparse
    endpoint = urlparse(config["url"])
    if endpoint.scheme != "https" or endpoint.hostname != "finn-reliance-research-desk.cozyjay15.chatgpt.site" or endpoint.port or endpoint.username or endpoint.password or endpoint.path not in ("", "/") or endpoint.query or endpoint.fragment:
        raise ValueError("Worker configuration must target the selected private FINN Site")
    while True:
        job = None
        try:
            result = api(config, "claim", {})
            job = result.get("job")
            if job:
                codex = Codex(args.codex, os.getcwd())
                try:
                    value = codex.analyse(job)
                finally:
                    codex.close()
                api(config, "complete", {"id": job["id"], "lease": job["lease"], "analysis": value})
                print(json.dumps({"filingId": job["filingId"], "status": "completed"}), flush=True)
            elif args.once:
                print(json.dumps({"status": "idle"}), flush=True)
        except Exception as error:
            # Provider bodies/credentials never enter logs or Site error records.
            print(json.dumps({"status": "error", "errorType": type(error).__name__}), flush=True)
            if job:
                try:
                    api(config, "failed", {"id": job["id"], "lease": job["lease"]})
                except Exception:
                    pass
            if args.once:
                raise SystemExit(1)
        if args.once:
            return
        time.sleep(15)


if __name__ == "__main__":
    main()

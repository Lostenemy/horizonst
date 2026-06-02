#!/usr/bin/env python3
import json
import logging
import os
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = os.environ.get("OBSERVER_HOST", "0.0.0.0")
PORT = int(os.environ.get("OBSERVER_PORT", "4040"))
VMQ_ADMIN = os.environ.get("VMQ_ADMIN_BIN", "/vernemq/bin/vmq-admin")
VMQ_ADMIN_TIMEOUT_SECONDS = 5

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("vernemq-observer")


def log_vmq_admin_error(command, error_type, **fields):
  payload = {
    "level": "error",
    "event": "vmq_admin_error",
    "command": command,
    "error_type": error_type,
    **fields
  }
  logger.error(json.dumps(payload, sort_keys=True))


def run_vmq_admin(args):
  cmd = [VMQ_ADMIN] + args
  command = " ".join(cmd)
  try:
    result = subprocess.run(
      cmd,
      capture_output=True,
      text=True,
      timeout=VMQ_ADMIN_TIMEOUT_SECONDS
    )
  except subprocess.TimeoutExpired as error:
    stdout = (error.stdout or "").strip()
    stderr = (error.stderr or "").strip()
    log_vmq_admin_error(
      command,
      "timeout",
      timeout_seconds=VMQ_ADMIN_TIMEOUT_SECONDS,
      stdout=stdout,
      stderr=stderr
    )
    return {
      "ok": False,
      "command": command,
      "stdout": stdout,
      "stderr": stderr or f"vmq-admin timed out after {VMQ_ADMIN_TIMEOUT_SECONDS} seconds"
    }
  except OSError as error:
    log_vmq_admin_error(command, "os_error", error=str(error))
    return {
      "ok": False,
      "command": command,
      "stdout": "",
      "stderr": str(error)
    }

  stdout = result.stdout.strip()
  stderr = result.stderr.strip()
  if result.returncode != 0:
    log_vmq_admin_error(
      command,
      "non_zero_exit",
      returncode=result.returncode,
      stdout=stdout,
      stderr=stderr
    )

  return {
    "ok": result.returncode == 0,
    "command": command,
    "stdout": stdout,
    "stderr": stderr
  }


class Handler(BaseHTTPRequestHandler):
  def _send(self, payload, status=200):
    data = json.dumps(payload).encode("utf-8")
    self.send_response(status)
    self.send_header("Content-Type", "application/json")
    self.send_header("Content-Length", str(len(data)))
    self.end_headers()
    self.wfile.write(data)

  def do_GET(self):
    if self.path == "/health":
      cluster = run_vmq_admin(["cluster", "show"])
      if cluster["ok"]:
        return self._send({"status": "ok"})
      return self._send({"status": "error", "cluster": cluster}, status=503)
    if self.path == "/listeners":
      return self._send(run_vmq_admin(["listener", "show"]))
    if self.path == "/cluster":
      return self._send(run_vmq_admin(["cluster", "show"]))
    if self.path == "/metrics":
      return self._send(run_vmq_admin(["metrics", "show"]))
    if self.path == "/status":
      cluster = run_vmq_admin(["cluster", "show"])
      listeners = run_vmq_admin(["listener", "show"])
      return self._send({
        "ok": cluster["ok"] or listeners["ok"],
        "cluster": cluster,
        "listeners": listeners
      })
    self._send({"error": "not_found"}, status=404)


if __name__ == "__main__":
  server = ThreadingHTTPServer((HOST, PORT), Handler)
  print(f"vernemq-observer listening on {HOST}:{PORT}")
  server.serve_forever()

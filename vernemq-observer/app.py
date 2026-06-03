#!/usr/bin/env python3
import json
import logging
import os
import socket
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = os.environ.get("OBSERVER_HOST", "0.0.0.0")
PORT = int(os.environ.get("OBSERVER_PORT", "4040"))
VMQ_ADMIN = os.environ.get("VMQ_ADMIN_BIN", "/vernemq/bin/vmq-admin")
VMQ_ADMIN_TIMEOUT_SECONDS = int(os.environ.get("VMQ_ADMIN_TIMEOUT_SECONDS", "3"))
VMQ_ADMIN_ERL_FLAGS = os.environ.get("VMQ_ADMIN_ERL_FLAGS", "+S 1:1 +SDcpu 1 +SDio 1")
VERNEMQ_HOST = os.environ.get("VERNEMQ_HEALTH_HOST", "vernemq")
VERNEMQ_PORT = int(os.environ.get("VERNEMQ_HEALTH_PORT", "1883"))
VERNEMQ_TCP_TIMEOUT_SECONDS = float(os.environ.get("VERNEMQ_HEALTH_TIMEOUT_SECONDS", "1"))

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("vernemq-observer")


RESOURCE_ERROR_PATTERNS = (
  "Failed to create scheduler thread",
  "Failed to create dirty scheduler thread",
  "eagain",
  "error = 11",
  "Aborted (core dumped)"
)


def log_vmq_admin_error(command, error_type, **fields):
  payload = {
    "level": "error",
    "event": "vmq_admin_error",
    "command": command,
    "error_type": error_type,
    **fields
  }
  logger.error(json.dumps(payload, sort_keys=True))


def log_vmq_admin_resource_error(command, **fields):
  payload = {
    "level": "warning",
    "event": "vmq_admin_resource_error",
    "command": command,
    "message": "vmq-admin failed to allocate Erlang scheduler threads; health fallback can verify broker TCP reachability",
    **fields
  }
  logger.warning(json.dumps(payload, sort_keys=True))


def log_health_degraded(reason, **fields):
  payload = {
    "level": "warning",
    "event": "observer_health_degraded",
    "reason": reason,
    **fields
  }
  logger.warning(json.dumps(payload, sort_keys=True))


def vmq_admin_env():
  env = os.environ.copy()
  if VMQ_ADMIN_ERL_FLAGS:
    existing_flags = env.get("ERL_FLAGS", "").strip()
    env["ERL_FLAGS"] = f"{VMQ_ADMIN_ERL_FLAGS} {existing_flags}".strip()
  return env


def is_resource_error_text(text):
  lowered = text.lower()
  return any(pattern.lower() in lowered for pattern in RESOURCE_ERROR_PATTERNS)


def is_vmq_admin_resource_error(result):
  error_text = f"{result.get('stderr', '')}\n{result.get('stdout', '')}"
  return is_resource_error_text(error_text)


def check_vernemq_tcp():
  target = f"{VERNEMQ_HOST}:{VERNEMQ_PORT}"
  try:
    with socket.create_connection((VERNEMQ_HOST, VERNEMQ_PORT), timeout=VERNEMQ_TCP_TIMEOUT_SECONDS):
      return {
        "ok": True,
        "target": target,
        "check": "tcp_connect"
      }
  except OSError as error:
    return {
      "ok": False,
      "target": target,
      "check": "tcp_connect",
      "error": str(error)
    }


def run_vmq_admin(args):
  cmd = [VMQ_ADMIN] + args
  command = " ".join(cmd)
  try:
    result = subprocess.run(
      cmd,
      capture_output=True,
      text=True,
      timeout=VMQ_ADMIN_TIMEOUT_SECONDS,
      env=vmq_admin_env()
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
    if is_resource_error_text(f"{stderr}\n{stdout}"):
      log_vmq_admin_resource_error(
        command,
        returncode=result.returncode,
        stdout_present=bool(stdout),
        stderr_present=bool(stderr)
      )
    else:
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


def health_response():
  cluster = run_vmq_admin(["cluster", "show"])
  if cluster["ok"]:
    return {"status": "ok", "cluster": cluster}, 200

  if is_vmq_admin_resource_error(cluster):
    broker = check_vernemq_tcp()
    if broker["ok"]:
      log_health_degraded(
        "vmq_admin_resource_error",
        command=cluster["command"],
        broker=broker,
        stderr_present=bool(cluster["stderr"])
      )
      return {
        "status": "degraded",
        "ok": True,
        "reason": "vmq_admin_resource_error",
        "cluster": cluster,
        "broker": broker
      }, 200

    log_health_degraded(
      "vmq_admin_resource_error_and_broker_unreachable",
      command=cluster["command"],
      broker=broker,
      stderr_present=bool(cluster["stderr"])
    )
    return {
      "status": "error",
      "ok": False,
      "reason": "vmq_admin_resource_error_and_broker_unreachable",
      "cluster": cluster,
      "broker": broker
    }, 503

  return {"status": "error", "ok": False, "cluster": cluster}, 503


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
      payload, status = health_response()
      return self._send(payload, status=status)
    if self.path == "/listeners":
      return self._send(run_vmq_admin(["listener", "show"]))
    if self.path == "/cluster":
      return self._send(run_vmq_admin(["cluster", "show"]))
    if self.path == "/metrics":
      return self._send(run_vmq_admin(["metrics", "show"]))
    if self.path == "/status":
      cluster = run_vmq_admin(["cluster", "show"])
      listeners = run_vmq_admin(["listener", "show"])
      broker = check_vernemq_tcp() if is_vmq_admin_resource_error(cluster) and not listeners["ok"] else None
      return self._send({
        "ok": cluster["ok"] or listeners["ok"] or bool(broker and broker["ok"]),
        "status": "degraded" if broker and broker["ok"] else "ok" if cluster["ok"] or listeners["ok"] else "error",
        "cluster": cluster,
        "listeners": listeners,
        **({"broker": broker, "reason": "vmq_admin_resource_error"} if broker else {})
      })
    self._send({"error": "not_found"}, status=404)


if __name__ == "__main__":
  server = ThreadingHTTPServer((HOST, PORT), Handler)
  print(f"vernemq-observer listening on {HOST}:{PORT}")
  server.serve_forever()

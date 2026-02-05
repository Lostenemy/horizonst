#!/usr/bin/env python3
import json
import os
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer

HOST = os.environ.get("OBSERVER_HOST", "0.0.0.0")
PORT = int(os.environ.get("OBSERVER_PORT", "4040"))
VMQ_ADMIN = os.environ.get("VMQ_ADMIN_BIN", "/vernemq/bin/vmq-admin")


def run_vmq_admin(args):
  cmd = [VMQ_ADMIN] + args
  result = subprocess.run(cmd, capture_output=True, text=True)
  return {
    "ok": result.returncode == 0,
    "command": " ".join(cmd),
    "stdout": result.stdout.strip(),
    "stderr": result.stderr.strip()
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
      return self._send({"status": "ok"})
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
  server = HTTPServer((HOST, PORT), Handler)
  print(f"vernemq-observer listening on {HOST}:{PORT}")
  server.serve_forever()

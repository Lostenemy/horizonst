import os
from pathlib import Path
import re
import subprocess
import unittest
from unittest.mock import patch

import app


class VmqAdminTests(unittest.TestCase):
  def test_compose_enables_init_reaper_for_vernemq_observer(self):
    compose = (Path(__file__).resolve().parents[1] / "docker-compose.yml").read_text(encoding="utf-8")
    service = re.search(r"(?ms)^  vernemq_observer:\n(?P<body>.*?)(?=^  [a-zA-Z0-9_-]+:|^volumes:|\Z)", compose)

    self.assertIsNotNone(service, "vernemq_observer service must exist")
    self.assertRegex(service.group("body"), r"(?m)^    init: true\s*$")

  def test_run_vmq_admin_limits_erlang_schedulers(self):
    captured = {}

    def fake_run(cmd, **kwargs):
      captured["cmd"] = cmd
      captured["env"] = kwargs["env"]
      return subprocess.CompletedProcess(cmd, 0, stdout="ok\n", stderr="")

    with patch.dict(os.environ, {"ERL_FLAGS": "+sbwt none"}, clear=False), patch("app.subprocess.run", side_effect=fake_run):
      result = app.run_vmq_admin(["cluster", "show"])

    self.assertTrue(result["ok"])
    self.assertEqual(captured["cmd"], [app.VMQ_ADMIN, "cluster", "show"])
    self.assertIn("+S 1:1", captured["env"]["ERL_FLAGS"])
    self.assertIn("+SDcpu 1", captured["env"]["ERL_FLAGS"])
    self.assertIn("+SDio 1", captured["env"]["ERL_FLAGS"])
    self.assertIn("+sbwt none", captured["env"]["ERL_FLAGS"])

  def test_health_degrades_to_tcp_when_vmq_admin_hits_scheduler_limit(self):
    cluster = {
      "ok": False,
      "command": "/vernemq/bin/vmq-admin cluster show",
      "stdout": "",
      "stderr": "Failed to create scheduler thread 0, error = 11\nAborted (core dumped)"
    }
    broker = {"ok": True, "target": "vernemq:1883", "check": "tcp_connect"}

    with patch("app.run_vmq_admin", return_value=cluster), patch("app.check_vernemq_tcp", return_value=broker):
      payload, status = app.health_response()

    self.assertEqual(status, 200)
    self.assertEqual(payload["status"], "degraded")
    self.assertTrue(payload["ok"])
    self.assertEqual(payload["reason"], "vmq_admin_resource_error")

  def test_health_stays_unhealthy_when_vmq_admin_and_tcp_fail(self):
    cluster = {
      "ok": False,
      "command": "/vernemq/bin/vmq-admin cluster show",
      "stdout": "",
      "stderr": "Failed to create scheduler thread 0, error = 11"
    }
    broker = {"ok": False, "target": "vernemq:1883", "check": "tcp_connect", "error": "refused"}

    with patch("app.run_vmq_admin", return_value=cluster), patch("app.check_vernemq_tcp", return_value=broker):
      payload, status = app.health_response()

    self.assertEqual(status, 503)
    self.assertEqual(payload["status"], "error")
    self.assertFalse(payload["ok"])


if __name__ == "__main__":
  unittest.main()

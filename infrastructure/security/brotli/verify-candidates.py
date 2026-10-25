"""Offline configuration checks plus benign HTTP decoding in an owned internal network."""
import argparse
import json
import subprocess
import uuid
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("directory", type=Path)
parser.add_argument("--fixture-image", default="node:22.23.4-alpine3.23@sha256:6abbcf5dd6b231da109bcde1181db1d92bf78015ae1a9514d9807c1f857869db")
args = parser.parse_args()
manifest = json.loads((args.directory / "candidates.json").read_text())
results = []
network = fixture = None

def docker(*cmd):
    return subprocess.check_output(["docker", *cmd], text=True)

try:
    network = docker("network", "create", "--internal", "horizonst-brotli-" + uuid.uuid4().hex).strip()
    source = Path(__file__).with_name("verify-response.cjs").read_text()
    fixture = docker("run", "-d", "--network", network, "--network-alias", "brotli-fixture",
                     "--entrypoint", "node", args.fixture_image, "-e", source).strip()
    for item in manifest:
        candidate_image = json.loads(docker("image", "inspect", item["target"]))[0]
        candidate = candidate_image["Config"]
        preserved = None
        if item.get("parent"):
            original = json.loads(docker("image", "inspect", item["parent"]))[0]["Config"]
            for key in ["Env", "Entrypoint", "Cmd", "WorkingDir", "Volumes", "ExposedPorts", "StopSignal", "Healthcheck"]:
                if original.get(key) != candidate.get(key):
                    raise RuntimeError("wrapper configuration changed: " + item["label"] + "/" + key)
            if (original.get("User") or "0") != (candidate.get("User") or "0"):
                raise RuntimeError("wrapper user changed: " + item["label"])
            preserved = True
        command = 'p=$(find /usr/lib /lib -name "libbrotlidec.so.1*" -type f -print -quit 2>/dev/null); test -n "$p"; grep -aq BLOCK_SWITCH "$p"'
        docker("run", "--rm", "--network", "none", "--entrypoint", "sh", item["target"], "-ec", command)
        if item.get("client") == "node":
            code = """const z=require('node:zlib');
if(process.version!=='v22.23.4'||z.constants.BROTLI_DECODER_ERROR_FORMAT_BLOCK_SWITCH!==-17)process.exit(1);
fetch('http://brotli-fixture:8088').then(r=>r.text()).then(t=>{if(t!=='horizonst-brotli-validation')process.exit(2)}).catch(()=>process.exit(3))"""
            docker("run", "--rm", "--network", network, "--entrypoint", "node", item["target"], "-e", code)
        else:
            response = docker("run", "--rm", "--network", network, "--entrypoint", "curl",
                              item["target"], "--retry", "5", "--retry-connrefused", "--retry-delay", "1",
                              "--max-time", "10", "--compressed", "-fsS", "http://brotli-fixture:8088")
            if response != "horizonst-brotli-validation":
                raise RuntimeError("benign decode mismatch: " + item["label"])
        results.append({"label": item["label"], "image_id": candidate_image["Id"],
                        "config_preserved": preserved, "native_patch_marker": True, "benign_http_decode": True})
        print(item["label"] + ": PASS", flush=True)
    (args.directory / "candidate-validation.json").write_text(json.dumps(results, indent=2))
finally:
    # Only the fixture IDs acquired by this invocation are removed.
    if fixture:
        subprocess.run(["docker", "rm", "-f", fixture], check=True, stdout=subprocess.DEVNULL)
    if network:
        subprocess.run(["docker", "network", "rm", network], check=True, stdout=subprocess.DEVNULL)

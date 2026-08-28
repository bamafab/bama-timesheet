#!/usr/bin/env python3
"""
server.py — minimal HTTP wrapper around step_takeoff.parse_step so the Quote
Builder can POST a .step/.stp file and get {rows, summary} back.

DEPLOYMENT NOTE: the main API is a Node Azure Function App and cannot host
OpenCascade — this wrapper is designed to run anywhere Python + cadquery-ocp
fit (Azure Container App / App Service / a box in the workshop). Where it
lands is Mateusz's infrastructure call; QB points at it via
STEP_TAKEOFF_ENDPOINT in quote-builder.html.

Protocol (matches QB's readStepFile):
  POST /api/step-takeoff
  Content-Type: application/json
  { "filename": "part.step", "data_b64": "<base64 of the file>" }
  -> 200 {rows, summary}   (same shape as ifc-takeoff.js)
  -> 4xx/5xx {"error": "..."}

Optional shared-secret auth: set STEP_TAKEOFF_KEY in the environment and the
server requires a matching X-Api-Key header. Unset = open (LAN/dev only).

Run:  python3 takeoff/server.py [port]     (default 8087)
Stdlib only — no framework dependency.
"""

import base64
import json
import os
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from step_takeoff import parse_step

MAX_BODY = 200 * 1024 * 1024  # 200 MB of JSON — STEP files can be chunky
API_KEY = os.environ.get("STEP_TAKEOFF_KEY", "")


class Handler(BaseHTTPRequestHandler):
    server_version = "BamaStepTakeoff/1.0"

    def _send(self, code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        # CORS: QB runs on the Static Web App origin
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Api-Key")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):  # CORS preflight
        self._send(204, {})

    def do_POST(self):
        if self.path.rstrip("/") != "/api/step-takeoff":
            return self._send(404, {"error": "unknown endpoint"})
        if API_KEY and self.headers.get("X-Api-Key", "") != API_KEY:
            return self._send(401, {"error": "bad or missing X-Api-Key"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY:
                return self._send(413, {"error": "body missing or too large"})
            payload = json.loads(self.rfile.read(length))
            filename = str(payload.get("filename", "upload.step"))
            if not filename.lower().endswith((".step", ".stp")):
                return self._send(400, {"error": "not a .step/.stp file"})
            data = base64.b64decode(payload["data_b64"])
        except Exception as e:
            return self._send(400, {"error": f"bad request: {e}"})

        suffix = ".stp" if filename.lower().endswith(".stp") else ".step"
        tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
        try:
            tmp.write(data)
            tmp.close()
            result = parse_step(tmp.name)
            return self._send(200, result)
        except Exception as e:
            return self._send(422, {"error": str(e)})
        finally:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass

    def log_message(self, fmt, *args):  # quiet-ish, single line
        sys.stderr.write("step-takeoff %s - %s\n" % (self.address_string(), fmt % args))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8087
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"step-takeoff listening on :{port} (auth: {'X-Api-Key' if API_KEY else 'OPEN'})")
    httpd.serve_forever()


if __name__ == "__main__":
    main()

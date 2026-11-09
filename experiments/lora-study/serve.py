"""Local defense demo. One loaded model, serialized inference, loopback only."""
import argparse
import json
import sys
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from inference import FinalModel, ROOT, validate_input


def create_server(engine, port=8008):
    inference_lock = threading.Lock()
    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(10)

        def allowed(self):
            hosts = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
            origin = self.headers.get("Origin")
            return self.headers.get("Host") in hosts and (not origin or origin in {"http://" + h for h in hosts})

        def reply(self, status, value, html=False):
            body = value if html else json.dumps(value, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "text/html; charset=utf-8" if html else "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if not self.allowed():
                return self.reply(403, {"error": "Local origin required"})
            if self.path == "/":
                return self.reply(200, (ROOT / "demo.html").read_bytes(), html=True)
            if self.path in ("/health", "/model"):
                return self.reply(200, {"status": "ready", **engine.info()})
            return self.reply(404, {"error": "Not found"})

        def do_POST(self):
            if not self.allowed():
                return self.reply(403, {"error": "Local origin required"})
            if self.path != "/generate":
                return self.reply(404, {"error": "Not found"})
            if self.headers.get_content_type() != "application/json":
                return self.reply(415, {"error": "Use application/json"})
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 16384:
                    return self.reply(413, {"error": "Body must contain 1..16384 bytes"})
                self.connection.settimeout(10)
                value = validate_input(json.loads(self.rfile.read(size)))
                if not inference_lock.acquire(blocking=False):
                    return self.reply(503, {"error": "Model is busy; retry when the current request finishes"})
                try:
                    result = engine.predict(value)
                finally:
                    inference_lock.release()
                return self.reply(200 if result["accepted"] else 422, result)
            except (ValueError, UnicodeError) as exc:
                return self.reply(400, {"error": str(exc)})
            except Exception:
                traceback.print_exc(file=sys.stderr)
                return self.reply(500, {"error": "Inference failed; see local server log"})

    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8008)
    parser.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto")
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    engine = FinalModel(args.device, args.offline)
    server = create_server(engine, args.port)
    print(f"MenuMind final model ready: http://127.0.0.1:{server.server_port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

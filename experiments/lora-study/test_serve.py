import http.client
import json
import threading
import socket
import unittest
from serve import create_server
from inference import validate_input


class Engine:
    def info(self):
        return {"model_version": "test"}

    def predict(self, value):
        validate_input(value)
        return {"accepted": False, "description": None, "requires_human_review": True, "validation_errors": ["json_valid"]}


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.server = create_server(Engine(), 0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def call(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        conn.request(method, path, body, headers or {})
        response = conn.getresponse()
        payload = response.read()
        status = response.status
        conn.close()
        return status, payload

    def test_health_and_page(self):
        status, body = self.call("GET", "/health")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["model_version"], "test")
        self.assertIn(b"MenuMind", self.call("GET", "/")[1])
        self.assertEqual(self.call("GET", "/missing")[0], 404)

    def test_rejects_invalid_json_and_large_body(self):
        self.assertEqual(self.call("POST", "/generate", b"{", {"Content-Type": "application/json"})[0], 400)
        self.assertEqual(self.call("POST", "/generate", b"a" * 16385, {"Content-Type": "application/json"})[0], 413)
        self.assertEqual(self.call("POST", "/generate", b"{}", {"Content-Type": "text/plain"})[0], 415)

    def test_rejects_cross_origin_and_rebinding(self):
        self.assertEqual(self.call("POST", "/generate", b"{}", {"Content-Type": "application/json", "Origin": "https://example.com"})[0], 403)
        self.assertEqual(self.call("GET", "/health", headers={"Host": "evil.example"})[0], 403)

    def test_invalid_model_output_is_422(self):
        value = {"language": "ru", "recipe": {"name": "Рис", "ingredients": ["рис"], "method": "варка"}}
        status, body = self.call("POST", "/generate", json.dumps(value).encode(), {"Content-Type": "application/json"})
        self.assertEqual(status, 422)
        self.assertIsNone(json.loads(body)["description"])

    def test_idle_connection_does_not_block_health(self):
        idle = socket.create_connection(("127.0.0.1", self.server.server_port), timeout=1)
        import time
        time.sleep(0.05)
        try:
            self.assertEqual(self.call("GET", "/health")[0], 200)
        finally:
            idle.close()

    def test_busy_model_returns_503_while_health_remains_available(self):
        started = threading.Event()
        release = threading.Event()
        class BusyEngine(Engine):
            def predict(self, value):
                started.set()
                release.wait(5)
                return super().predict(value)
        server = create_server(BusyEngine(), 0)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        body = json.dumps({"language": "ru", "recipe": {"name": "Рис", "ingredients": ["рис"], "method": "варка"}})
        def call(path, method="GET"):
            conn = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
            try:
                conn.request(method, path, body if method == "POST" else None, {"Content-Type": "application/json"})
                response = conn.getresponse()
                response.read()
                return response.status
            finally:
                conn.close()
        first = threading.Thread(target=lambda: call("/generate", "POST"), daemon=True)
        first.start()
        try:
            self.assertTrue(started.wait(2))
            self.assertEqual(call("/health"), 200)
            self.assertEqual(call("/generate", "POST"), 503)
        finally:
            release.set()
            first.join()
            server.shutdown()
            server.server_close()
            worker.join()


if __name__ == "__main__":
    unittest.main()

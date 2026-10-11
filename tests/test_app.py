import json
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

import app


class FakeResponse:
    status_code = 200

    def json(self):
        return {
            "models": [
                {
                    "name": "test-model:latest",
                    "size": 1234,
                    "modified_at": "2026-01-01T00:00:00Z",
                    "details": {"parameter_size": "1B"},
                }
            ]
        }

    def raise_for_status(self):
        return None


class FakeStreamResponse(FakeResponse):
    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return None

    async def aiter_lines(self):
        yield json.dumps({"message": {"role": "assistant", "content": "Hello"}, "done": False})
        yield json.dumps({"message": {"role": "assistant", "content": " world"}, "done": True})


class FakeAsyncClient:
    def __init__(self, *_, **__):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return None

    async def get(self, _url):
        return FakeResponse()

    def stream(self, _method, _url, json=None):
        return FakeStreamResponse()


class AppTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app.app)

    def test_index_and_config(self):
        index = self.client.get("/")
        self.assertEqual(index.status_code, 200)
        self.assertIn("NSCC Ollama Desk", index.text)

        config = self.client.get("/api/config")
        self.assertEqual(config.status_code, 200)
        self.assertEqual(config.json()["max_upload_mb"], 25)

    def test_text_document_upload(self):
        response = self.client.post(
            "/api/files/document",
            files={"file": ("notes.txt", b"alpha beta gamma", "text/plain")},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["text"], "alpha beta gamma")

    def test_rejects_non_image_on_image_route(self):
        response = self.client.post(
            "/api/files/image",
            files={"file": ("notes.txt", b"alpha", "text/plain")},
        )
        self.assertEqual(response.status_code, 415)

    @patch("app.httpx.AsyncClient", FakeAsyncClient)
    def test_model_discovery_and_streaming_chat(self):
        models = self.client.get("/api/models")
        self.assertEqual(models.status_code, 200)
        self.assertEqual(models.json()["models"][0]["name"], "test-model:latest")

        response = self.client.post(
            "/api/chat",
            json={
                "model": "test-model:latest",
                "messages": [{"role": "user", "content": "Say hello"}],
            },
        )
        self.assertEqual(response.status_code, 200)
        events = [json.loads(line) for line in response.text.splitlines()]
        self.assertEqual("".join(event["message"]["content"] for event in events), "Hello world")


if __name__ == "__main__":
    unittest.main()

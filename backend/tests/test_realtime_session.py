import asyncio
import os
import unittest
from unittest.mock import patch

from main import AssistContext, RealtimeSessionRequest, create_realtime_session


class FakeResponse:
    is_error = False

    def json(self) -> dict[str, object]:
        return {"value": "ek_short_lived_test", "session": {"id": "sess_test"}}


class FakeHttpClient:
    async def __aenter__(self) -> "FakeHttpClient":
        return self

    async def __aexit__(self, *_args: object) -> None:
        return None

    async def post(self, url: str, *, headers: dict[str, str], json: dict[str, object]) -> FakeResponse:
        self.url = url
        self.headers = headers
        self.payload = json
        return FakeResponse()


class RealtimeSessionTests(unittest.IsolatedAsyncioTestCase):
    async def test_returns_only_ephemeral_secret_and_configures_asset_voice_session(self) -> None:
        fake_client = FakeHttpClient()
        context = AssistContext(
            assetId="HVAC-024",
            site="North Tower - Floor 4",
            issue="Cooling performance",
            description="Reduced airflow",
            severity="Medium",
        )
        with (
            patch.dict(os.environ, {"OPENAI_API_KEY": "server-only-key"}),
            patch("main.httpx.AsyncClient", return_value=fake_client),
        ):
            result = await create_realtime_session(RealtimeSessionRequest(context=context))

        self.assertEqual(result, {"clientSecret": "ek_short_lived_test", "sessionId": "sess_test"})
        self.assertEqual(fake_client.url, "https://api.openai.com/v1/realtime/client_secrets")
        self.assertEqual(fake_client.headers["Authorization"], "Bearer server-only-key")
        session = fake_client.payload["session"]
        self.assertEqual(session["type"], "realtime")
        self.assertEqual(session["output_modalities"], ["audio"])
        self.assertEqual(session["audio"]["input"]["turn_detection"]["type"], "semantic_vad")
        self.assertEqual(session["audio"]["output"]["voice"], "marin")
        self.assertIn("HVAC-024", session["instructions"])
        self.assertNotIn("server-only-key", str(result))


if __name__ == "__main__":
    unittest.main()

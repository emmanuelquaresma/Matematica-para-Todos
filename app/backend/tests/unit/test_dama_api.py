"""Testes ASGI sem servidor, Docker, httpx ou dependências adicionais."""
import asyncio
import json
import unittest

from fastapi import FastAPI
from routes import dama
from services.dama import RoomService


class ApiTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        dama.service = RoomService()
        self.app = FastAPI()
        self.app.include_router(dama.router)

    async def http(self, method, path, token=None):
        messages = []
        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}
        async def send(message):
            messages.append(message)
        headers = [(b"authorization", f"Bearer {token}".encode())] if token else []
        await self.app({"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
                        "method": method, "scheme": "http", "path": path, "raw_path": path.encode(),
                        "query_string": b"", "headers": headers, "server": ("test", 80),
                        "client": ("test", 1), "root_path": ""}, receive, send)
        body = b"".join(m.get("body", b"") for m in messages)
        return messages[0]["status"], json.loads(body)

    async def test_http_session_and_capacity(self):
        status, session = await self.http("POST", "/api/dama/rooms")
        self.assertEqual(status, 201)
        path = "/api/dama/rooms/" + session["room"]["room_id"]
        self.assertEqual((await self.http("GET", path))[0], 401)
        self.assertEqual((await self.http("GET", path, session["player_id"]))[0], 401)
        status, room = await self.http("GET", path, session["session_token"])
        self.assertEqual(status, 200)
        self.assertNotIn("session_token", str(room))
        self.assertEqual((await self.http("POST", path + "/join"))[0], 201)
        self.assertEqual((await self.http("POST", path + "/join"))[0], 409)
        status, left = await self.http("POST", path + "/leave", session["session_token"])
        self.assertEqual(status, 200)
        self.assertEqual(left["status"], "WAITING")
        self.assertIsNotNone(left["players"][0]["left_at"])
        self.assertEqual((await self.http("GET", path, session["session_token"]))[0], 401)
        self.assertEqual((await self.http("POST", "/api/dama/rooms"))[0], 201)
        self.assertEqual((await self.http("GET", "/api/dama/rooms/missing", session["session_token"]))[0], 404)

    async def socket(self, room_id, token):
        incoming, outgoing = asyncio.Queue(), asyncio.Queue()
        scope = {"type": "websocket", "asgi": {"version": "3.0"}, "scheme": "ws",
                 "path": f"/ws/dama/{room_id}", "query_string": b"", "headers": [],
                 "server": ("test", 80), "client": ("test", 1), "root_path": "", "subprotocols": []}
        task = asyncio.create_task(self.app(scope, incoming.get, outgoing.put))
        await incoming.put({"type": "websocket.connect"})
        self.assertEqual((await asyncio.wait_for(outgoing.get(), 1))["type"], "websocket.accept")
        await incoming.put({"type": "websocket.receive", "text": json.dumps({"type": "authenticate", "session_token": token})})
        return task, incoming, outgoing

    async def test_websocket_auth_disconnect_reconnect(self):
        session = dama.service.create()
        rid = session.room.room_id
        task, incoming, outgoing = await self.socket(rid, "invalid")
        self.assertEqual((await asyncio.wait_for(outgoing.get(), 1))["code"], 1008)
        await task
        for _ in range(2):
            task, incoming, outgoing = await self.socket(rid, session.session_token)
            state = json.loads((await asyncio.wait_for(outgoing.get(), 1))["text"])
            self.assertTrue(state["room"]["players"][0]["connected"])
            self.assertNotIn("session_token", str(state))
            await incoming.put({"type": "websocket.receive", "text": '{"type":"move"}'})
            self.assertEqual(json.loads((await asyncio.wait_for(outgoing.get(), 1))["text"])["type"], "move_rejected")
            await incoming.put({"type": "websocket.disconnect", "code": 1000})
            await asyncio.wait_for(task, 1)
            self.assertFalse(dama.service.get(rid).players[0].connected)
            self.assertEqual(dama.service.get(rid).current_player, 1)

    async def test_two_clients_move_broadcast_and_reconnect(self):
        white = dama.service.create()
        rid = white.room.room_id
        black = dama.service.join(rid)
        wt, wi, wo = await self.socket(rid, white.session_token)
        await asyncio.wait_for(wo.get(), 1)
        bt, bi, bo = await self.socket(rid, black.session_token)
        await asyncio.wait_for(wo.get(), 1)
        await asyncio.wait_for(bo.get(), 1)
        async def send(queue, payload):
            await queue.put({"type": "websocket.receive", "text": json.dumps(payload)})
        async def receive(queue):
            return json.loads((await asyncio.wait_for(queue.get(), 1))["text"])
        status, swapped = await self.http("POST", f"/api/dama/rooms/{rid}/swap-colors", black.session_token)
        self.assertEqual(status, 200)
        self.assertEqual([p["color"] for p in swapped["players"]], ["black", "white"])
        self.assertEqual(await receive(wo), await receive(bo))
        await self.http("POST", f"/api/dama/rooms/{rid}/swap-colors", white.session_token)
        await receive(wo)
        await receive(bo)
        status, started = await self.http("POST", f"/api/dama/rooms/{rid}/start", white.session_token)
        self.assertEqual(status, 200)
        self.assertEqual(started["status"], "IN_PROGRESS")
        await receive(wo)
        await receive(bo)
        move = {"type": "move", "from": {"row": 5, "col": 0}, "to": {"row": 4, "col": 1}}
        await send(bi, move)
        self.assertEqual((await receive(bo))["type"], "move_rejected")
        await send(wi, {**move, "color": "white"})
        self.assertEqual((await receive(wo))["type"], "move_rejected")
        await send(wi, move)
        a, b = await receive(wo), await receive(bo)
        self.assertEqual(a["type"], "state")
        self.assertEqual(a, b)
        self.assertEqual(a["room"]["board"][4][1]["player"], 1)
        self.assertEqual(a["room"]["current_player"], 2)
        self.assertIn("from", a["room"]["legal_moves"][0])
        await wi.put({"type": "websocket.disconnect", "code": 1000})
        await asyncio.wait_for(wt, 1)
        await receive(bo)
        wt, wi, wo = await self.socket(rid, white.session_token)
        restored = await receive(wo)
        await receive(bo)
        self.assertEqual(restored["room"]["board"], a["room"]["board"])
        self.assertEqual(restored["room"]["current_player"], 2)
        await wi.put({"type": "websocket.disconnect", "code": 1000})
        await asyncio.wait_for(wt, 1)
        await receive(bo)
        await bi.put({"type": "websocket.disconnect", "code": 1000})
        await asyncio.wait_for(bt, 1)

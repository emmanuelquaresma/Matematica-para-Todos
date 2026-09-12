import asyncio
import unittest

from services.dama import RoomError, RoomService


class Socket:
    def __init__(self, broken=False):
        self.messages = []
        self.broken = broken
        self.closed = False

    async def send_json(self, message):
        if self.broken:
            raise RuntimeError("desconectado")
        self.messages.append(message)

    async def close(self, code):
        self.closed = True


class RoomsTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.service = RoomService()
        self.white = self.service.create()
        self.room_id = self.white.room.room_id

    def test_initial_state_and_auth(self):
        room = self.white.room
        self.assertEqual(room.current_player, 1)
        self.assertEqual(room.status, "WAITING")
        self.assertEqual([len(row) for row in room.board], [8] * 8)
        for player in (1, 2):
            self.assertEqual(sum(p is not None and p.player == player for row in room.board for p in row), 12)
        self.assertNotIn(self.white.session_token, room.model_dump_json())
        self.assertEqual(room.players[0].color, "white")
        for token in (None, "wrong", self.white.player_id):
            with self.assertRaises(RoomError):
                self.service.authenticate(self.room_id, token)
        with self.assertRaises(RoomError):
            self.service.authenticate("missing", self.white.session_token)

    async def test_reconnect_multi_tab_and_leave(self):
        black = self.service.join(self.room_id)
        self.assertEqual(black.room.players[1].color, "black")
        self.assertNotEqual(black.session_token, self.white.session_token)
        with self.assertRaises(RoomError):
            self.service.join(self.room_id)
        a, b, c = Socket(), Socket(), Socket()
        self.service.connect(self.room_id, self.white.session_token, a)
        self.service.connect(self.room_id, self.white.session_token, b)
        self.service.connect(self.room_id, black.session_token, c)
        self.service.start(self.room_id, self.white.session_token)
        self.assertEqual(self.service.get(self.room_id).status, "IN_PROGRESS")
        before = self.service.snapshot(self.room_id).board
        self.service.disconnect(self.room_id, self.white.player_id, a)
        self.assertTrue(self.service.get(self.room_id).players[0].connected)
        self.service.disconnect(self.room_id, self.white.player_id, b)
        self.assertEqual(self.service.get(self.room_id).status, "PAUSED")
        self.service.connect(self.room_id, self.white.session_token, a)
        await self.service.broadcast(self.room_id)
        self.assertEqual(a.messages[-1]["room"]["status"], "IN_PROGRESS")
        self.assertNotIn("session_token", str(a.messages))
        await self.service.leave(self.room_id, self.white.session_token)
        self.assertTrue(a.closed)
        self.assertEqual(self.service.snapshot(self.room_id).board, before)
        self.assertEqual(len(self.service.get(self.room_id).players), 2)
        self.assertIsNotNone(self.service.get(self.room_id).players[0].left_at)
        with self.assertRaises(RoomError):
            self.service.connect(self.room_id, self.white.session_token, b)
        other = self.service.create()
        self.service.connect(other.room.room_id, other.session_token, b)
        self.assertTrue(self.service.get(other.room.room_id).players[0].connected)

    async def test_broken_socket_and_room_isolation(self):
        black = self.service.join(self.room_id)
        a, b = Socket(broken=True), Socket()
        self.service.connect(self.room_id, self.white.session_token, a)
        self.service.connect(self.room_id, black.session_token, b)
        self.service.start(self.room_id, self.white.session_token)
        await self.service.broadcast(self.room_id)
        self.assertEqual(b.messages[-1]["room"]["status"], "PAUSED")
        other = self.service.create()
        with self.assertRaises(RoomError):
            self.service.authenticate(other.room.room_id, self.white.session_token)
        self.assertFalse(other.room.players[0].connected)
        await self.service.leave(self.room_id, black.session_token)
        self.assertIn(self.room_id, self.service.rooms)


if __name__ == "__main__":
    unittest.main()

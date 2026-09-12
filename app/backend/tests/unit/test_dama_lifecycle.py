import copy
import unittest
from services.dama import RoomService, RoomError
from schemas.dama import MoveRequest
from services.dama_game import InvalidMove


class Socket:
    async def send_json(self, message): pass
    async def close(self, code): pass


class LifecycleTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.s = RoomService()
        self.a = self.s.create()
        self.rid = self.a.room.room_id
        self.b = self.s.join(self.rid)
        self.x, self.y = Socket(), Socket()
        self.s.connect(self.rid, self.a.session_token, self.x)
        self.s.connect(self.rid, self.b.session_token, self.y)

    async def test_ready_swap_start_and_pause(self):
        room = self.s.get(self.rid)
        self.assertEqual(room.status, 'READY')
        move = MoveRequest.model_validate({'type': 'move', 'from': {'row': 5, 'col': 0}, 'to': {'row': 4, 'col': 1}})
        with self.assertRaises(InvalidMove): self.s.move(self.rid, self.a.session_token, self.x, move)
        self.s.swap_colors(self.rid, self.b.session_token)
        self.assertEqual([p.color for p in room.players], ['black', 'white'])
        with self.assertRaises(RoomError): self.s.start(self.rid, self.b.session_token)
        self.s.start(self.rid, self.a.session_token)
        self.assertEqual(room.current_player, 1)
        with self.assertRaises(RoomError): self.s.start(self.rid, self.a.session_token)
        with self.assertRaises(RoomError): self.s.swap_colors(self.rid, self.a.session_token)
        self.s.move(self.rid, self.b.session_token, self.y, move)
        before = copy.deepcopy((room.board, room.current_player, room.captures, room.winner, room.forced_piece))
        self.s.disconnect(self.rid, self.b.player_id, self.y)
        self.assertEqual(room.status, 'PAUSED')
        self.assertFalse(room.players[1].left)
        with self.assertRaises(RoomError): self.s.swap_colors(self.rid, self.a.session_token)
        self.s.connect(self.rid, self.b.session_token, self.y)
        self.assertEqual(room.status, 'IN_PROGRESS')
        self.assertEqual((room.board, room.current_player, room.captures, room.winner, room.forced_piece), before)
        self.assertEqual(room.players[1].color, 'white')

    async def test_both_disconnect_not_abandoned_both_leave_abandoned(self):
        room = self.s.get(self.rid)
        self.s.disconnect(self.rid, self.a.player_id, self.x)
        self.s.disconnect(self.rid, self.b.player_id, self.y)
        self.assertEqual(room.status, 'READY')
        self.assertFalse(any(p.left for p in room.players))
        self.s.authenticate(self.rid, self.a.session_token)
        with self.assertRaises(RoomError): self.s.start(self.rid, self.a.session_token)
        await self.s.leave(self.rid, self.a.session_token)
        self.assertNotEqual(room.status, 'ABANDONED')
        self.s.authenticate(self.rid, self.b.session_token)
        with self.assertRaises(RoomError): self.s.authenticate(self.rid, self.a.session_token)
        await self.s.leave(self.rid, self.b.session_token)
        self.assertEqual(room.status, 'ABANDONED')
        with self.assertRaises(RoomError): self.s.join(self.rid)
        with self.assertRaises(RoomError): self.s.authenticate(self.rid, self.b.session_token)

    async def test_new_participation_replaces_only_departed_seat(self):
        room = self.s.get(self.rid)
        before = copy.deepcopy(room.board)
        self.s.disconnect(self.rid, self.a.player_id, self.x)
        with self.assertRaises(RoomError): self.s.join(self.rid)
        await self.s.leave(self.rid, self.a.session_token)
        self.assertTrue(room.players[0].left)
        c = self.s.join(self.rid)
        self.assertNotEqual(c.session_token, self.a.session_token)
        self.assertEqual(len(room.players), 2)
        self.assertEqual(c.room.players[0].color, 'white')
        self.assertEqual(room.board, before)
        self.assertEqual(room.creator_id, c.player_id)
        self.assertEqual(room.status, 'READY')

    async def test_start_requires_connected_players_and_colors_lock(self):
        room = self.s.get(self.rid)
        self.assertEqual([p.color for p in room.players], ['white', 'black'])
        self.s.disconnect(self.rid, self.b.player_id, self.y)
        with self.assertRaises(RoomError):
            self.s.start(self.rid, self.a.session_token)
        self.assertFalse(room.started)
        self.s.connect(self.rid, self.b.session_token, self.y)
        self.s.start(self.rid, self.a.session_token)
        for status in ['IN_PROGRESS', 'PAUSED', 'FINISHED', 'ABANDONED']:
            with self.subTest(status=status):
                room.status = status
                before = [p.color for p in room.players]
                with self.assertRaises(RoomError):
                    self.s.swap_colors(self.rid, self.a.session_token)
                self.assertEqual([p.color for p in room.players], before)

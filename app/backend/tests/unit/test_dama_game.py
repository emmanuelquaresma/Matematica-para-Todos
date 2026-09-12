import copy
import unittest

from models.dama import Room, RoomStatus
from schemas.dama import MoveRequest
from services.dama import RoomService
from services.dama_game import apply_move, legal_moves, InvalidMove


def pos(row, col):
    return {"row": row, "col": col}


def empty_room(*pieces):
    room = Room("test", status=RoomStatus.IN_PROGRESS, board=[[None] * 8 for _ in range(8)])
    for row, col, player, king in pieces:
        room.board[row][col] = {"player": player, "king": king}
    return room


class GameTest(unittest.TestCase):
    def assert_rejected(self, room, player, origin, destination):
        before = copy.deepcopy(room)
        with self.assertRaises(InvalidMove):
            apply_move(room, player, origin, destination)
        self.assertEqual(room, before)

    def test_initial_move_and_invalid_requests_are_atomic(self):
        room = Room("test", status=RoomStatus.IN_PROGRESS)
        self.assertEqual(len(legal_moves(room)), 7)
        self.assert_rejected(room, 2, pos(2, 1), pos(3, 0))
        self.assert_rejected(room, 1, pos(2, 1), pos(3, 0))
        self.assert_rejected(room, 1, pos(4, 1), pos(3, 0))
        self.assert_rejected(room, 1, pos(5, 0), pos(6, 1))
        self.assert_rejected(room, 1, pos(5, 0), pos(-1, 1))
        self.assert_rejected(room, 1, pos(True, 0), pos(4, 1))
        apply_move(room, 1, pos(5, 0), pos(4, 1))
        self.assertIsNone(room.board[5][0])
        self.assertEqual(room.board[4][1]["player"], 1)
        self.assertEqual(room.current_player, 2)
        for status in (RoomStatus.PAUSED, RoomStatus.WAITING, RoomStatus.FINISHED):
            room.status = status
            self.assert_rejected(room, 2, pos(2, 1), pos(3, 0))

    def test_mandatory_chained_capture_and_victory(self):
        room = empty_room((5, 0, 1, False), (5, 4, 1, False), (4, 1, 2, False), (2, 3, 2, False))
        self.assert_rejected(room, 1, pos(5, 4), pos(4, 5))
        apply_move(room, 1, pos(5, 0), pos(3, 2))
        self.assertEqual(room.current_player, 1)
        self.assertEqual(room.forced_piece, pos(3, 2))
        self.assertEqual(room.captures, {1: 1, 2: 0})
        self.assert_rejected(room, 1, pos(5, 4), pos(4, 5))
        self.assert_rejected(room, 1, pos(3, 2), pos(2, 1))
        apply_move(room, 1, pos(3, 2), pos(1, 4))
        self.assertIsNone(room.forced_piece)
        self.assertEqual(room.captures[1], 2)
        self.assertEqual(room.winner, 1)
        self.assertEqual(room.status, RoomStatus.FINISHED)
        self.assert_rejected(room, 2, pos(2, 3), pos(3, 4))

    def test_promotion_continues_backwards_as_local(self):
        room = empty_room((2, 1, 1, False), (1, 2, 2, False), (1, 4, 2, False))
        apply_move(room, 1, pos(2, 1), pos(0, 3))
        self.assertTrue(room.board[0][3]["king"])
        self.assertEqual(room.forced_piece, pos(0, 3))
        apply_move(room, 1, pos(0, 3), pos(2, 5))
        self.assertTrue(room.board[2][5]["king"])
        self.assertEqual(room.winner, 1)

    def test_black_promotion_and_blocked_opponent(self):
        room = empty_room((5, 0, 2, False), (6, 1, 1, False))
        room.current_player = 2
        apply_move(room, 2, pos(5, 0), pos(7, 2))
        self.assertTrue(room.board[7][2]["king"])
        self.assertEqual(room.winner, 2)
        room = empty_room((5, 0, 1, False), (7, 0, 2, False))
        apply_move(room, 1, pos(5, 0), pos(4, 1))
        self.assertEqual(room.winner, 1)

    def test_short_king_and_common_cannot_capture_backwards(self):
        room = empty_room((3, 2, 1, True), (0, 1, 2, False))
        self.assert_rejected(room, 1, pos(3, 2), pos(5, 4))
        apply_move(room, 1, pos(3, 2), pos(4, 3))
        room = empty_room((3, 2, 1, False), (4, 3, 2, False))
        self.assert_rejected(room, 1, pos(3, 2), pos(5, 4))

    def test_service_checks_socket_revision_and_authenticated_color(self):
        service = RoomService()
        white = service.create()
        rid = white.room.room_id
        black = service.join(rid)
        w, b = object(), object()
        service.connect(rid, white.session_token, w)
        service.connect(rid, black.session_token, b)
        service.start(rid, white.session_token)
        request = MoveRequest.model_validate({"type": "move", "from": pos(5, 0), "to": pos(4, 1), "revision": service.get(rid).revision})
        before = copy.deepcopy(service.get(rid))
        for token, socket in ((black.session_token, b), (white.session_token, b)):
            with self.assertRaises(InvalidMove):
                service.move(rid, token, socket, request)
            self.assertEqual(service.get(rid), before)
        service.move(rid, white.session_token, w, request)
        after = copy.deepcopy(service.get(rid))
        with self.assertRaises(InvalidMove):
            service.move(rid, white.session_token, w, request)
        self.assertEqual(service.get(rid), after)
        service.disconnect(rid, white.player_id, w)
        service.connect(rid, white.session_token, object())
        self.assertEqual(service.snapshot(rid).board[4][1].player, 1)
        self.assertEqual(service.snapshot(rid).current_player, 2)

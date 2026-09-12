"""Estado interno; tokens nunca devem aparecer nos snapshots públicos."""
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum


def now() -> datetime:
    return datetime.now(timezone.utc)


class RoomStatus(str, Enum):
    WAITING = "WAITING"
    READY = "READY"
    IN_PROGRESS = "IN_PROGRESS"
    PAUSED = "PAUSED"
    FINISHED = "FINISHED"
    ABANDONED = "ABANDONED"


def initial_board() -> list:
    return [
        [
            {"player": 2 if row < 3 else 1, "king": False}
            if (row + col) % 2 == 1 and (row < 3 or row >= 5) else None
            for col in range(8)
        ]
        for row in range(8)
    ]


@dataclass
class Player:
    player_id: str
    color: str
    session_token: str = field(repr=False)
    connected: bool = False
    last_seen: datetime = field(default_factory=now)
    left_at: datetime | None = None
    left: bool = False


@dataclass
class Room:
    room_id: str
    status: RoomStatus = RoomStatus.WAITING
    board: list = field(default_factory=initial_board)
    current_player: int = 1
    captures: dict[int, int] = field(default_factory=lambda: {1: 0, 2: 0})
    winner: int | None = None
    forced_piece: dict | None = None
    players: list[Player] = field(default_factory=list)
    created_at: datetime = field(default_factory=now)
    updated_at: datetime = field(default_factory=now)
    revision: int = 0
    creator_id: str | None = None
    started: bool = False

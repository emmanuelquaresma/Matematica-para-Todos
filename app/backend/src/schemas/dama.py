from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt

from models.dama import RoomStatus


class PieceView(BaseModel):
    player: Literal[1, 2]
    king: bool


class PlayerView(BaseModel):
    player_id: str
    color: Literal["white", "black"]
    connected: bool
    last_seen: datetime
    left_at: datetime | None = None
    left: bool = False


class Position(BaseModel):
    model_config = ConfigDict(extra="forbid")
    row: StrictInt = Field(ge=0, le=7)
    col: StrictInt = Field(ge=0, le=7)


class MoveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["move"]
    origin: Position = Field(alias="from")
    destination: Position = Field(alias="to")
    revision: StrictInt | None = Field(default=None, ge=0)


class MoveView(BaseModel):
    origin: Position = Field(alias="from")
    destination: Position = Field(alias="to")
    capture: Position | None


class RoomView(BaseModel):
    room_id: str
    status: RoomStatus
    board: list[list[PieceView | None]]
    current_player: Literal[1, 2]
    captures: dict[int, int]
    winner: Literal[1, 2] | None
    forced_piece: Position | None
    legal_moves: list[MoveView]
    players: list[PlayerView]
    created_at: datetime
    updated_at: datetime
    revision: int
    creator_id: str | None
    started: bool


class SessionView(BaseModel):
    player_id: str
    session_token: str
    room: RoomView

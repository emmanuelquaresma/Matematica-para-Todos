"""Uma instância por processo: executar com um único worker, sem persistência.

Operações de estado são síncronas (sem await) no event loop do FastAPI.
Leave encerra a sessão; desconexão temporária mantém o token. Não atribui derrota. Não há expiração automática.
ABANDONED encerra salas sem participantes vinculados; FINISHED indica vitória.
"""
import asyncio
import secrets
from uuid import uuid4

from models.dama import Player, Room, RoomStatus, now
from schemas.dama import PlayerView, RoomView, SessionView
from services.dama_game import apply_move, legal_moves, InvalidMove


class RoomError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


class RoomService:
    def __init__(self):
        self.rooms: dict[str, Room] = {}
        self.connections: dict[str, dict[str, set]] = {}
        self.broadcast_locks: dict[str, asyncio.Lock] = {}

    def get(self, room_id):
        if room_id not in self.rooms:
            raise RoomError(404, "Sala não encontrada")
        return self.rooms[room_id]

    def authenticate(self, room_id, token):
        room = self.get(room_id)
        if not isinstance(token, str) or not token or len(token) > 256:
            raise RoomError(401, "Sessão inválida")
        for player in room.players:
            if not player.left and secrets.compare_digest(player.session_token, token):
                return player
        raise RoomError(401, "Sessão inválida")

    def touch(self, room):
        room.updated_at = now()
        room.revision += 1
        linked = [p for p in room.players if not p.left]
        if len(room.players) == 2 and not linked:
            room.status = RoomStatus.ABANDONED
        elif room.status not in (RoomStatus.FINISHED, RoomStatus.ABANDONED):
            if room.started:
                room.status = (RoomStatus.IN_PROGRESS if len(linked) == 2 and all(p.connected for p in linked)
                               else RoomStatus.PAUSED)
            else:
                room.status = RoomStatus.READY if len(linked) == 2 else RoomStatus.WAITING

    def snapshot(self, room_id):
        room = self.get(room_id)
        return RoomView(
            room_id=room.room_id, status=room.status, board=room.board,
            current_player=room.current_player, created_at=room.created_at,
            captures=room.captures, winner=room.winner, forced_piece=room.forced_piece,
            legal_moves=legal_moves(room),
            updated_at=room.updated_at, revision=room.revision, creator_id=room.creator_id, started=room.started,
            players=[PlayerView(player_id=p.player_id, color=p.color,
                                connected=p.connected, last_seen=p.last_seen, left_at=p.left_at, left=p.left)
                     for p in room.players],
        )

    def join(self, room_id):
        room = self.get(room_id)
        linked = [p for p in room.players if not p.left]
        if len(linked) >= 2 or room.status in (RoomStatus.FINISHED, RoomStatus.ABANDONED):
            raise RoomError(409, "Sala indisponível para novos jogadores")
        color = "white" if not any(p.color == "white" for p in linked) else "black"
        player = Player(uuid4().hex, color, secrets.token_urlsafe(32))
        # Substitui somente a vaga liberada; tokens de desconectados continuam reservados.
        departed = next((p for p in room.players if p.left), None)
        if departed:
            room.players[room.players.index(departed)] = player
            if room.creator_id == departed.player_id:
                room.creator_id = player.player_id
        else:
            room.players.append(player)
        if room.creator_id is None:
            room.creator_id = player.player_id
        self.touch(room)
        return SessionView(player_id=player.player_id, session_token=player.session_token,
                           room=self.snapshot(room_id))

    def pregame(self, room_id, token):
        player = self.authenticate(room_id, token)
        room = self.get(room_id)
        if room.started or room.status != RoomStatus.READY or len(room.players) != 2 or any(p.left for p in room.players):
            raise RoomError(409, "A sala precisa de dois participantes e a partida não pode ter começado.")
        return room, player

    def swap_colors(self, room_id, token):
        room, _ = self.pregame(room_id, token)
        for player in room.players:
            player.color = "black" if player.color == "white" else "white"
        self.touch(room)
        return self.snapshot(room_id)

    def start(self, room_id, token):
        room, player = self.pregame(room_id, token)
        if player.player_id != room.creator_id:
            raise RoomError(403, "Somente o criador da sala pode começar a partida.")
        if not all(p.connected for p in room.players) or {p.color for p in room.players} != {"white", "black"}:
            raise RoomError(409, "Os dois jogadores precisam estar conectados e com cores definidas.")
        room.started = True
        room.current_player = 1  # 1 identifica as brancas, não a ordem de entrada.
        self.touch(room)
        return self.snapshot(room_id)

    def move(self, room_id, token, socket, request):
        player = self.authenticate(room_id, token)
        room = self.get(room_id)
        if socket not in self.connections[room_id].get(player.player_id, set()):
            raise InvalidMove("A conexão não está ativa nesta sala.")
        if request.revision is not None and request.revision != room.revision:
            raise InvalidMove("O estado da sala mudou. Escolha novamente a jogada.")
        apply_move(room, 1 if player.color == "white" else 2,
                   request.origin.model_dump(), request.destination.model_dump())
        player.last_seen = now()
        self.touch(room)

    def create(self):
        room = Room(uuid4().hex)
        self.rooms[room.room_id] = room
        self.connections[room.room_id] = {}
        self.broadcast_locks[room.room_id] = asyncio.Lock()
        return self.join(room.room_id)

    def connect(self, room_id, token, socket):
        player = self.authenticate(room_id, token)
        self.connections[room_id].setdefault(player.player_id, set()).add(socket)
        player.connected = True
        player.last_seen = now()
        self.touch(self.get(room_id))
        return player

    def disconnect(self, room_id, player_id, socket):
        sockets = self.connections[room_id].get(player_id, set())
        if socket not in sockets:
            return
        sockets.remove(socket)
        player = next(p for p in self.get(room_id).players if p.player_id == player_id)
        player.connected = bool(sockets)
        player.last_seen = now()
        self.touch(self.get(room_id))

    async def leave(self, room_id, token):
        player = self.authenticate(room_id, token)
        sockets = self.connections[room_id].pop(player.player_id, set())
        player.connected = False
        player.left = True
        player.left_at = now()
        player.last_seen = player.left_at
        self.touch(self.get(room_id))
        for socket in sockets:
            try:
                await asyncio.wait_for(socket.close(code=1000), timeout=2)
            except Exception:
                pass
        await self.broadcast(room_id, "player_left")
        return self.snapshot(room_id)

    async def broadcast(self, room_id, event="state"):
        # Serializa snapshots para evitar mensagens antigas após estados novos.
        async with self.broadcast_locks[room_id]:
            while True:
                targets = [(pid, socket) for pid, sockets in self.connections[room_id].items()
                           for socket in tuple(sockets)]
                message = {"type": event, "room": self.snapshot(room_id).model_dump(mode="json", by_alias=True)}
                async def send(socket):
                    await asyncio.wait_for(socket.send_json(message), timeout=2)
                results = await asyncio.gather(*(send(s) for _, s in targets), return_exceptions=True)
                failed = False
                for (pid, socket), result in zip(targets, results):
                    if isinstance(result, BaseException):
                        self.disconnect(room_id, pid, socket)
                        failed = True
                if not failed:
                    return
                event = "player_disconnected"

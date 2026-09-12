"""HTTP: Authorization: Bearer <session_token>.

WebSocket: primeira mensagem {"type":"authenticate","session_token":"..."}.
Não enviar token em URL. Após autenticação, mensagens room_state/player_* contêm
snapshot completo e revision. Move é validado pelo motor de regras no backend.
"""
import asyncio

from fastapi import APIRouter, Depends, HTTPException, Response, WebSocket, WebSocketDisconnect
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from pydantic import ValidationError

from schemas.dama import RoomView, SessionView, MoveRequest
from services.dama_game import InvalidMove
from services.dama import RoomError, RoomService

router = APIRouter()
service = RoomService()
bearer = HTTPBearer(auto_error=False)


async def session_token(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
    if credentials is None:
        raise HTTPException(401, "Token de sessão obrigatório")
    return credentials.credentials


def call(operation, *args):
    try:
        return operation(*args)
    except RoomError as error:
        raise HTTPException(error.status_code, error.detail) from error


def no_cache(response: Response):
    response.headers["Cache-Control"] = "no-store"


@router.post("/api/dama/rooms", response_model=SessionView, status_code=201)
async def create_room(response: Response):
    no_cache(response)
    return service.create()


@router.post("/api/dama/rooms/{room_id}/join", response_model=SessionView, status_code=201)
async def join_room(room_id: str, response: Response):
    no_cache(response)
    session = call(service.join, room_id)
    await service.broadcast(room_id, "player_joined")
    return session


@router.get("/api/dama/rooms/{room_id}", response_model=RoomView)
async def get_room(room_id: str, response: Response, token: str = Depends(session_token)):
    no_cache(response)
    call(service.authenticate, room_id, token)
    return service.snapshot(room_id)


@router.post("/api/dama/rooms/{room_id}/leave", response_model=RoomView)
async def leave_room(room_id: str, response: Response, token: str = Depends(session_token)):
    no_cache(response)
    call(service.authenticate, room_id, token)
    return await service.leave(room_id, token)


@router.post("/api/dama/rooms/{room_id}/swap-colors", response_model=RoomView)
async def swap_colors(room_id: str, response: Response, token: str = Depends(session_token)):
    no_cache(response)
    room = call(service.swap_colors, room_id, token)
    await service.broadcast(room_id)
    return room


@router.post("/api/dama/rooms/{room_id}/start", response_model=RoomView)
async def start_room(room_id: str, response: Response, token: str = Depends(session_token)):
    no_cache(response)
    room = call(service.start, room_id, token)
    await service.broadcast(room_id)
    return room


@router.websocket("/ws/dama/{room_id}")
async def room_socket(websocket: WebSocket, room_id: str):
    await websocket.accept()
    player = None
    try:
        auth = await asyncio.wait_for(websocket.receive_json(), timeout=10)
        if not isinstance(auth, dict) or auth.get("type") != "authenticate":
            await websocket.close(code=1008)
            return
        player = service.connect(room_id, auth.get("session_token"), websocket)
        await service.broadcast(room_id, "player_connected")
        while True:
            try:
                message = await websocket.receive_json()
            except (ValueError, KeyError):
                await websocket.send_json({"type": "error", "detail": "Envie uma mensagem JSON válida."})
                continue
            # Leave desconecta todas as abas; não aceitar uma conexão já retirada.
            if websocket not in service.connections[room_id].get(player.player_id, set()):
                return
            if isinstance(message, dict) and message.get("type") == "ping":
                await service.broadcast(room_id)
            elif isinstance(message, dict) and message.get("type") == "move":
                try:
                    move = MoveRequest.model_validate(message)
                    service.move(room_id, auth.get("session_token"), websocket, move)
                except (ValidationError, InvalidMove, RoomError) as error:
                    detail = "Formato de jogada inválido: informe origem e destino entre 0 e 7." if isinstance(error, ValidationError) else str(error)
                    await websocket.send_json({"type": "move_rejected", "detail": detail,
                                               "room": service.snapshot(room_id).model_dump(mode="json", by_alias=True)})
                else:
                    await service.broadcast(room_id, "state")
            else:
                await websocket.send_json({"type": "error", "detail": "Mensagem não suportada nesta fase"})
    except (RoomError, ValueError, asyncio.TimeoutError):
        await websocket.close(code=1008)
    except WebSocketDisconnect:
        pass
    finally:
        if player is not None:
            service.disconnect(room_id, player.player_id, websocket)
            await service.broadcast(room_id, "player_disconnected")

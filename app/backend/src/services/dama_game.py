"""Regras da variante local de dama.js, sem dependências de rede ou DOM.

Dama curta: peças comuns movem/capturam para frente; damas nos quatro sentidos.
Captura obrigatória, sem regra de maior captura. Promoção imediata permite continuar
capturando como dama no mesmo turno. Vitória por ausência de peças ou movimentos.
"""
from models.dama import RoomStatus


class InvalidMove(ValueError):
    pass


def inside(row, col):
    return 0 <= row < 8 and 0 <= col < 8


def piece_moves(board, row, col, captures_only=False):
    piece = board[row][col]
    if piece is None:
        return []
    directions = ((-1, -1), (-1, 1), (1, -1), (1, 1)) if piece["king"] else (
        (-1 if piece["player"] == 1 else 1, -1),
        (-1 if piece["player"] == 1 else 1, 1),
    )
    moves = []
    for dr, dc in directions:
        nr, nc = row + dr, col + dc
        if not inside(nr, nc):
            continue
        neighbour = board[nr][nc]
        capture = None
        if neighbour is None:
            if captures_only:
                continue
        elif neighbour["player"] != piece["player"]:
            capture = {"row": nr, "col": nc}
            nr, nc = nr + dr, nc + dc
            if not inside(nr, nc) or board[nr][nc] is not None:
                continue
        else:
            continue
        moves.append({"from": {"row": row, "col": col},
                      "to": {"row": nr, "col": nc}, "capture": capture})
    return moves


def player_moves(board, player):
    moves = [move for row in range(8) for col in range(8)
             if board[row][col] and board[row][col]["player"] == player
             for move in piece_moves(board, row, col)]
    captures = [move for move in moves if move["capture"] is not None]
    return captures or moves


def legal_moves(room):
    if room.status != RoomStatus.IN_PROGRESS or room.winner is not None:
        return []
    if room.forced_piece is not None:
        return piece_moves(room.board, **room.forced_piece, captures_only=True)
    return player_moves(room.board, room.current_player)


def apply_move(room, player_number, origin, destination):
    # Todas as rejeições ocorrem antes de qualquer mutação.
    if room.status != RoomStatus.IN_PROGRESS or room.winner is not None:
        raise InvalidMove("A partida não está em andamento.")
    if player_number != room.current_player:
        raise InvalidMove("Aguarde sua vez.")
    for pos in (origin, destination):
        if (not isinstance(pos, dict) or set(pos) != {"row", "col"}
                or any(type(pos[k]) is not int for k in ("row", "col"))
                or not inside(pos["row"], pos["col"])):
            raise InvalidMove("Coordenadas inválidas.")
    piece = room.board[origin["row"]][origin["col"]]
    if piece is None or piece["player"] != player_number:
        raise InvalidMove("Escolha uma peça da sua cor.")
    if room.forced_piece is not None and origin != room.forced_piece:
        raise InvalidMove("Continue capturando com a mesma peça.")
    move = next((m for m in legal_moves(room) if m["from"] == origin and m["to"] == destination), None)
    if move is None:
        raise InvalidMove("Destino inválido. Respeite os movimentos e as capturas obrigatórias.")
    room.board[destination["row"]][destination["col"]] = piece
    room.board[origin["row"]][origin["col"]] = None
    if move["capture"] is not None:
        captured = move["capture"]
        room.board[captured["row"]][captured["col"]] = None
        room.captures[player_number] += 1
    if (player_number == 1 and destination["row"] == 0) or (player_number == 2 and destination["row"] == 7):
        piece["king"] = True
    if move["capture"] is not None and piece_moves(room.board, **destination, captures_only=True):
        room.forced_piece = dict(destination)
        return
    room.forced_piece = None
    room.current_player = 3 - player_number
    if not player_moves(room.board, room.current_player):
        room.winner = player_number
        room.status = RoomStatus.FINISHED

(() => {
    "use strict";

    // Variante adotada: dama curta. Peças comuns e damas andam uma diagonal por vez;
    // a dama pode usar os quatro sentidos. Capturas pulam uma peça adjacente e são obrigatórias.
    const gameState = { board: [], currentPlayer: 1, selectedPiece: null, forcedPiece: null, winner: null, message: "", captures: { 1: 0, 2: 0 } };
    const boardElement = document.querySelector("#checkers-board");
    const messageElement = document.querySelector("#game-message");
    const turnElement = document.querySelector("#turn-indicator");
    const winnerCard = document.querySelector("#winner-card");
    const winnerMessage = document.querySelector("#winner-message");
    const counts = { 1: document.querySelector("#player-one-pieces"), 2: document.querySelector("#player-two-pieces") };
    const captureCounts = { 1: document.querySelector("#player-one-captures"), 2: document.querySelector("#player-two-captures") };
    const insideBoard = (row, col) => row >= 0 && row < 8 && col >= 0 && col < 8;
    const isPlayable = (row, col) => (row + col) % 2 === 1;
    const copyPosition = (row, col) => ({ row, col });
    const nomeDasPecas = (player) => player === 1 ? "peças brancas" : "peças pretas";

    function initializarPecas() {
        gameState.board = Array.from({ length: 8 }, () => Array(8).fill(null));
        for (let row = 0; row < 3; row += 1) for (let col = 0; col < 8; col += 1) if (isPlayable(row, col)) gameState.board[row][col] = { player: 2, king: false };
        for (let row = 5; row < 8; row += 1) for (let col = 0; col < 8; col += 1) if (isPlayable(row, col)) gameState.board[row][col] = { player: 1, king: false };
    }

    function directionsFor(piece) { return piece.king ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] : [[piece.player === 1 ? -1 : 1, -1], [piece.player === 1 ? -1 : 1, 1]]; }
    function obterMovimentosValidos(row, col, capturesOnly = false) {
        const piece = gameState.board[row][col];
        if (!piece) return [];
        const moves = [];
        directionsFor(piece).forEach(([rowStep, colStep]) => {
            const nextRow = row + rowStep; const nextCol = col + colStep;
            if (!insideBoard(nextRow, nextCol)) return;
            const neighbour = gameState.board[nextRow][nextCol];
            if (!neighbour && !capturesOnly) moves.push({ row: nextRow, col: nextCol, capture: null });
            if (neighbour && neighbour.player !== piece.player) {
                const landingRow = nextRow + rowStep; const landingCol = nextCol + colStep;
                if (insideBoard(landingRow, landingCol) && !gameState.board[landingRow][landingCol]) moves.push({ row: landingRow, col: landingCol, capture: copyPosition(nextRow, nextCol) });
            }
        });
        return moves;
    }
    function movimentosDoJogador(player, capturesOnly = false) {
        const moves = [];
        gameState.board.forEach((line, row) => line.forEach((piece, col) => { if (piece?.player === player) obterMovimentosValidos(row, col, capturesOnly).forEach((move) => moves.push({ from: copyPosition(row, col), ...move })); }));
        return moves;
    }
    function jogadorTemCaptura(player) { return movimentosDoJogador(player, true).length > 0; }
    function selecionarPeca(row, col) {
        const piece = gameState.board[row][col];
        if (!piece || piece.player !== gameState.currentPlayer || gameState.winner) return false;
        if (gameState.forcedPiece && (row !== gameState.forcedPiece.row || col !== gameState.forcedPiece.col)) return false;
        const moves = obterMovimentosValidos(row, col, jogadorTemCaptura(gameState.currentPlayer));
        if (!moves.length) return false;
        gameState.selectedPiece = copyPosition(row, col);
        gameState.message = "Peça selecionada. Escolha uma casa destacada.";
        return true;
    }
    function verificarPromocao(row, piece) { if ((piece.player === 1 && row === 0) || (piece.player === 2 && row === 7)) piece.king = true; }
    function executarCaptura(capture) { gameState.board[capture.row][capture.col] = null; gameState.captures[gameState.currentPlayer] += 1; }
    function alternarTurno() { gameState.currentPlayer = gameState.currentPlayer === 1 ? 2 : 1; gameState.selectedPiece = null; gameState.forcedPiece = null; gameState.message = `Vez das ${nomeDasPecas(gameState.currentPlayer)}.`; }
    function verificarFimDeJogo() {
        const pieces = contarPecas();
        if (pieces[gameState.currentPlayer] === 0 || movimentosDoJogador(gameState.currentPlayer).length === 0) {
            gameState.winner = gameState.currentPlayer === 1 ? 2 : 1;
            gameState.message = `As ${nomeDasPecas(gameState.winner)} venceram!`;
        }
    }
    function moverPeca(move) {
        const from = gameState.selectedPiece; const piece = gameState.board[from.row][from.col];
        gameState.board[move.row][move.col] = piece; gameState.board[from.row][from.col] = null;
        if (move.capture) executarCaptura(move.capture);
        verificarPromocao(move.row, piece);
        if (move.capture && obterMovimentosValidos(move.row, move.col, true).length) { gameState.selectedPiece = copyPosition(move.row, move.col); gameState.forcedPiece = copyPosition(move.row, move.col); gameState.message = "Capture novamente com a mesma peça."; }
        else { alternarTurno(); verificarFimDeJogo(); }
    }
    function onSquareClick(row, col) {
        if (gameState.winner) return;
        const selected = gameState.selectedPiece;
        if (selected) {
            const possibleMoves = obterMovimentosValidos(selected.row, selected.col, jogadorTemCaptura(gameState.currentPlayer));
            const move = possibleMoves.find((item) => item.row === row && item.col === col);
            if (move) { moverPeca(move); renderizar(); return; }
        }
        if (!selecionarPeca(row, col)) gameState.message = gameState.forcedPiece ? "Você precisa continuar a sequência de capturas." : "Escolha uma peça sua que tenha um movimento válido.";
        renderizar();
    }
    function contarPecas() { const total = { 1: 0, 2: 0 }; gameState.board.flat().forEach((piece) => { if (piece) total[piece.player] += 1; }); return total; }
    function criarTabuleiro() {
        boardElement.replaceChildren();
        const targets = gameState.selectedPiece ? obterMovimentosValidos(gameState.selectedPiece.row, gameState.selectedPiece.col, jogadorTemCaptura(gameState.currentPlayer)) : [];
        gameState.board.forEach((line, row) => line.forEach((piece, col) => {
            const square = document.createElement("button"); square.type = "button"; square.className = `square ${isPlayable(row, col) ? "square--dark" : "square--light"}`; square.setAttribute("role", "gridcell");
            const isTarget = targets.some((move) => move.row === row && move.col === col);
            if (isTarget) square.classList.add("square--target");
            square.setAttribute("aria-label", piece ? `Linha ${row + 1}, coluna ${col + 1}: ${piece.player === 1 ? "peça branca" : "peça preta"}${piece.king ? ", dama" : ""}` : `Linha ${row + 1}, coluna ${col + 1}${isTarget ? ", destino possível" : ""}`);
            if (piece) { const token = document.createElement("span"); token.className = `piece piece--${piece.player}${piece.king ? " piece--king" : ""}${gameState.selectedPiece?.row === row && gameState.selectedPiece?.col === col ? " piece--selected" : ""}`; token.setAttribute("aria-hidden", "true"); square.append(token); }
            square.addEventListener("click", () => onSquareClick(row, col)); boardElement.append(square);
        }));
    }
    function renderizar() {
        criarTabuleiro(); const pieces = contarPecas(); counts[1].textContent = pieces[1]; counts[2].textContent = pieces[2]; captureCounts[1].textContent = gameState.captures[1]; captureCounts[2].textContent = gameState.captures[2];
        turnElement.textContent = gameState.winner ? "Partida finalizada" : `Vez das ${nomeDasPecas(gameState.currentPlayer)}`; turnElement.classList.toggle("turn-indicator--two", gameState.currentPlayer === 2 && !gameState.winner); messageElement.textContent = gameState.message;
        winnerCard.hidden = !gameState.winner; if (gameState.winner) winnerMessage.textContent = `As ${nomeDasPecas(gameState.winner)} venceram!`;
    }
    function reiniciarPartida() { initializarPecas(); gameState.currentPlayer = 1; gameState.selectedPiece = null; gameState.forcedPiece = null; gameState.winner = null; gameState.message = "Vez das peças brancas."; gameState.captures = { 1: 0, 2: 0 }; renderizar(); }
    document.querySelector("#restart-game").addEventListener("click", reiniciarPartida); document.querySelector("#play-again").addEventListener("click", reiniciarPartida); reiniciarPartida();
})();

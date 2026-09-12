(() => {
    "use strict";

    const STORAGE_KEY = "matematica.dama.session.v1";
    const $ = (id) => document.getElementById(id);
    const panels = { choice: "mode-choice", entry: "online-entry", local: "local-game", online: "online-game" };
    const events = new Set(["state", "player_connected", "room_state", "player_joined", "player_left", "player_disconnected"]);
    let session = null;
    let mode = "choice";
    let socket = null;
    let retryTimer = null;
    let heartbeat = null;
    let generation = 0;
    let attempts = 0;
    let revision = -1;
    let busy = false;
    let suspended = false;
    let storageWarning = "";
    let currentRoom = null;
    let selected = null;
    let pendingMove = false;
    let onlineReady = false;
    let manualLeave = false;
    const samePosition = (a, b) => a && b && a.row === b.row && a.col === b.col;
    const myNumber = () => session?.color === "white" ? 1 : 2;
    const canPlay = () => onlineReady && !busy && !pendingMove && socket?.readyState === WebSocket.OPEN
        && currentRoom?.status === "IN_PROGRESS" && currentRoom.current_player === myNumber()
        && !currentRoom.winner;

    function message(text) { $("network-message").textContent = text; }
    function connection(text) { $("online-connection").textContent = text; }
    function show(next) {
        mode = next;
        Object.entries(panels).forEach(([name, id]) => { $(id).hidden = name !== next; });
    }
    function stop() {
        onlineReady = false;
        pendingMove = false;
        selected = null;
        generation += 1;
        clearTimeout(retryTimer);
        clearInterval(heartbeat);
        retryTimer = heartbeat = null;
        if (socket) {
            const old = socket;
            socket = null;
            old.onopen = old.onmessage = old.onclose = old.onerror = null;
            old.close();
        }
        connection("Desconectado");
        if (currentRoom && session) render(currentRoom);
    }
    function readSession() {
        try {
            const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
            if (!value) return null;
            if (!["room_id", "player_id", "session_token"].every((key) => typeof value[key] === "string" && value[key].length > 0 && value[key].length <= 256)
                || !["white", "black"].includes(value.color)) {
                localStorage.removeItem(STORAGE_KEY);
                message("A sessão salva é inválida. Crie ou entre em uma sala.");
                return null;
            }
            return value;
        } catch (_) {
            message("Não foi possível ler a sessão salva neste navegador.");
            return null;
        }
    }
    function clearSession() {
        session = null;
        storageWarning = "";
        try { localStorage.removeItem(STORAGE_KEY); }
        catch (_) { message("Não foi possível apagar a sessão salva. Verifique o armazenamento do navegador."); }
    }
    async function request(path, method = "GET", token = null) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
            const response = await fetch(path, {
                method, cache: "no-store", signal: controller.signal,
                headers: token ? { Authorization: `Bearer ${token}` } : {}
            });
            if (!response.ok) {
                const error = new Error(({ 403: "Somente o criador pode começar a partida.", 401: "Token inválido. Entre novamente em uma sala.",
                    404: "Sala inexistente. Ela pode ter sido perdida após reiniciar o servidor.",
                    409: path.endsWith("/join") ? "Sala cheia ou indisponível para novos jogadores." : "A sala não permite essa ação agora. Verifique os participantes e o início da partida." })[response.status]
                    || "Backend indisponível. Tente novamente.");
                error.status = response.status;
                throw error;
            }
            return await response.json();
        } catch (error) {
            if (error.status) throw error;
            throw new Error("Falha de conexão ou backend indisponível. Tente novamente.");
        } finally { clearTimeout(timeout); }
    }
    function render(room) {
        if (!session || room.room_id !== session.room_id || room.revision < revision) return;
        if (room.revision > revision) {
            selected = null;
            pendingMove = false;
        }
        revision = room.revision;
        currentRoom = room;
        const me = room.players.find((player) => player.player_id === session.player_id);
        if (me && !me.left && session.color !== me.color) {
            session.color = me.color;
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(session)); }
            catch (_) { storageWarning = "Não foi possível salvar a cor; ela será recuperada do servidor ao voltar."; }
        }
        const pregame = !room.started && room.status === "READY" && room.players.length === 2 && room.players.every((player) => !player.left);
        $("swap-colors").hidden = !pregame;
        $("start-online").hidden = !pregame || room.creator_id !== session.player_id;
        $("swap-colors").disabled = busy || !onlineReady;
        $("start-online").disabled = busy || !onlineReady || !room.players.every((player) => player.connected);
        if (!canPlay()) selected = null;
        else if (room.forced_piece) selected = room.forced_piece;
        $("online-code").textContent = room.room_id;
        $("online-color").textContent = session.color === "white" ? "Brancas" : "Pretas";
        const opponent = room.players.find((player) => player.player_id !== session.player_id);
        $("online-opponent").textContent = !opponent ? "Aguardando jogador" : opponent.left ? "Adversário saiu da sala" : opponent.connected ? "Conectado" : "Desconectado";
        $("online-turn").textContent = room.current_player === 1 ? "Brancas" : "Pretas";
        $("online-room-status").textContent = ({ WAITING: "Aguardando outro jogador...",
            READY: room.players.every((player) => player.connected) ? "Dois jogadores conectados" : "Dois participantes na sala. Aguardando conexão.",
            IN_PROGRESS: "Partida em andamento.", PAUSED: "Sala pausada. Aguardando reconexão.",
            FINISHED: "Partida finalizada.", ABANDONED: "Partida abandonada." })[room.status] || room.status;
        $("online-action").textContent = room.winner
            ? `As peças ${room.winner === 1 ? "brancas" : "pretas"} venceram!`
            : !onlineReady ? "Aguardando conexão com a sala"
            : pendingMove ? "Aguardando confirmação da jogada"
            : opponent?.left ? "Adversário saiu da sala. Aguardando nova participação."
            : room.status === "READY" ? (room.creator_id === session.player_id
                ? "Ajustem as cores e iniciem a partida quando estiverem prontos."
                : "Aguardando o criador iniciar a partida")
            : room.status !== "IN_PROGRESS" ? "Aguardando os dois jogadores se conectarem"
            : room.current_player !== myNumber() ? "Aguardando jogada do adversário"
            : room.forced_piece ? "Sua vez — continue capturando com a mesma peça" : "Sua vez";
        $("online-white-captures").textContent = room.captures?.[1] ?? 0;
        $("online-black-captures").textContent = room.captures?.[2] ?? 0;
        const moves = selected && canPlay() ? (room.legal_moves || []).filter((move) => samePosition(move.from, selected)) : [];
        const board = $("online-board");
        const fragment = document.createDocumentFragment();
        // Percorrer a ordem visual preserva foco e orientação das coroas.
        // Cliques, seleção e destinos continuam usando coordenadas lógicas do servidor.
        const inverted = session.color === "black";
        for (let visualRow = 0; visualRow < 8; visualRow += 1) {
          for (let visualCol = 0; visualCol < 8; visualCol += 1) {
            const r = inverted ? 7 - visualRow : visualRow;
            const c = inverted ? 7 - visualCol : visualCol;
            const piece = room.board[r][c];
            const square = document.createElement("button");
            square.type = "button";
            const target = moves.some((move) => move.to.row === r && move.to.col === c);
            square.className = `square square--${(r + c) % 2 ? "dark" : "light"}${target ? " square--target" : ""}`;
            square.disabled = !canPlay();
            square.setAttribute("aria-label", `Linha ${r + 1}, coluna ${c + 1}${piece ? (piece.player === 1 ? ", peça branca" : ", peça preta") : ", vazia"}${piece?.king ? ", dama" : ""}${target ? ", destino possível" : ""}`);
            square.setAttribute("aria-pressed", Boolean(samePosition(selected, { row: r, col: c })));
            square.addEventListener("click", () => onSquareClick(r, c));
            if (piece) {
                const token = document.createElement("span");
                token.className = `piece piece--${piece.player}${piece.king ? " piece--king" : ""}${samePosition(selected, { row: r, col: c }) ? " piece--selected" : ""}`;
                token.setAttribute("aria-hidden", "true");
                square.append(token);
            }
            fragment.append(square);
          }
        }
        board.replaceChildren(fragment);
    }
    function onSquareClick(row, col) {
        if (!canPlay()) return;
        const destination = { row, col };
        const moves = currentRoom.legal_moves || [];
        const move = selected && moves.find((item) => samePosition(item.from, selected) && samePosition(item.to, destination));
        if (move) {
            try {
                socket.send(JSON.stringify({ type: "move", from: move.from, to: move.to, revision: currentRoom.revision }));
                pendingMove = true;
                // O tabuleiro só muda ao receber um snapshot confirmado pelo servidor.
                render(currentRoom);
            } catch (_) {
                message("Não foi possível enviar a jogada. Reconectando...");
                stop();
                scheduleRetry();
            }
            return;
        }
        if (currentRoom.board[row][col]?.player === myNumber() && moves.some((item) => samePosition(item.from, destination))) {
            selected = destination;
            message("Escolha uma casa destacada.");
        } else {
            message(currentRoom.forced_piece ? "Continue a captura com a mesma peça." : "Escolha uma peça sua com movimentos válidos. Capturas são obrigatórias.");
        }
        render(currentRoom);
    }
    function scheduleRetry() {
        if (manualLeave || !session || mode !== "online" || suspended || busy || retryTimer) return;
        connection("Reconectando");
        const delay = Math.min(30000, 1000 * (2 ** Math.min(attempts++, 5)));
        retryTimer = setTimeout(() => { retryTimer = null; connect(); }, delay);
    }
    async function connect() {
        if (manualLeave || !session || mode !== "online" || suspended || busy) return;
        stop();
        const ticket = generation;
        const saved = session;
        connection("Reconectando");
        $("online-code").textContent = saved.room_id;
        $("online-color").textContent = saved.color === "white" ? "Brancas" : "Pretas";
        const current = () => ticket === generation && session === saved && mode === "online" && !suspended && !manualLeave;
        try {
            const room = await request(`/api/dama/rooms/${encodeURIComponent(saved.room_id)}`, "GET", saved.session_token);
            if (!current()) return;
            const player = room.players.find((item) => item.player_id === saved.player_id);
            if (!player || player.left) {
                const error = new Error("A identificação da sessão salva é inválida.");
                error.status = 401;
                throw error;
            }
            render(room);
            const url = new URL(`/ws/dama/${encodeURIComponent(saved.room_id)}`, window.location.href);
            url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
            const ws = new WebSocket(url);
            socket = ws;
            let lastReceived = Date.now();
            ws.onopen = () => {
                if (current()) ws.send(JSON.stringify({ type: "authenticate", session_token: saved.session_token }));
            };
            ws.onmessage = (event) => {
                if (!current()) return;
                try {
                    const data = JSON.parse(event.data);
                    lastReceived = Date.now();
                    if (events.has(data.type)) {
                        onlineReady = true;
                        render(data.room);
                        attempts = 0;
                        connection("Conectado");
                        message(storageWarning);
                    } else if (data.type === "move_rejected") {
                        pendingMove = false;
                        selected = null;
                        if (data.room) render(data.room);
                        message(data.detail || "Jogada inválida.");
                    } else if (data.type === "error") {
                        message(data.detail || "Não foi possível processar a mensagem da sala.");
                    }
                } catch (_) { message("Resposta inválida da sala. Tentando reconectar."); ws.close(); }
            };
            ws.onclose = (event) => {
                if (!current()) return;
                socket = null;
                onlineReady = false;
                pendingMove = false;
                if (currentRoom) render(currentRoom);
                clearInterval(heartbeat);
                heartbeat = null;
                connection("Desconectado");
                message(event.code === 1008 ? "Sessão recusada. Verificando acesso à sala..." : "Conexão interrompida. Tentando reconectar...");
                scheduleRetry();
            };
            ws.onerror = () => { if (current()) message("Falha de conexão com a sala."); };
            heartbeat = setInterval(() => {
                if (!current()) return;
                if (Date.now() - lastReceived > 35000) {
                    stop();
                    scheduleRetry();
                } else if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: "ping" }));
                }
            }, 10000);
        } catch (error) {
            if (!current()) return;
            message(error.message);
            if ([401, 404].includes(error.status)) {
                stop();
                clearSession();
                show("entry");
            } else scheduleRetry();
        }
    }
    function setBusy(value) {
        busy = value;
        ["create-room", "room-code", "leave-room", "retry-online", "online-local", "entry-back"].forEach((id) => { $(id).disabled = value; });
        $("join-room").querySelector("button").disabled = value;
    }
    async function pregameAction(action) {
        if (!session || busy || !onlineReady) return;
        const ticket = generation;
        const saved = session;
        setBusy(true);
        if (currentRoom) render(currentRoom);
        try {
            const room = await request(`/api/dama/rooms/${encodeURIComponent(saved.room_id)}/${action}`, "POST", saved.session_token);
            if (ticket === generation && session === saved) { render(room); message(""); }
        } catch (error) {
            if (ticket === generation && session === saved) message(error.message);
        } finally {
            setBusy(false);
            if (currentRoom && session) render(currentRoom);
        }
    }
    async function enter(roomId = null) {
        if (busy) return;
        if (session) { show("online"); connect(); return; }
        // Verifica acesso ao armazenamento antes de reservar uma vaga no servidor.
        try {
            localStorage.setItem(STORAGE_KEY, "null");
            localStorage.removeItem(STORAGE_KEY);
        } catch (_) { message("Habilite o armazenamento do navegador para poder retornar à sala."); return; }
        setBusy(true);
        message("Entrando na sala...");
        try {
            const path = roomId ? `/api/dama/rooms/${encodeURIComponent(roomId)}/join` : "/api/dama/rooms";
            const data = await request(path, "POST");
            const player = data.room.players.find((item) => item.player_id === data.player_id);
            manualLeave = false;
            session = { room_id: data.room.room_id, player_id: data.player_id, session_token: data.session_token, color: player.color };
            revision = -1;
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(session)); }
            catch (_) { storageWarning = "Sessão ativa, mas não foi possível salvá-la para retornar depois."; message(storageWarning); }
            show("online");
            render(data.room);
        } catch (error) { message(error.message); }
        finally { setBusy(false); }
        if (session) connect();
    }
    async function leave() {
        if (!session || busy || manualLeave) return;
        const saved = session;
        manualLeave = true;
        // Inicia a notificação, mas não condiciona a saída local à rede.
        const notification = request(`/api/dama/rooms/${encodeURIComponent(saved.room_id)}/leave`, "POST", saved.session_token);
        stop();
        const ticket = generation;
        session = null;
        currentRoom = null;
        selected = null;
        pendingMove = false;
        onlineReady = false;
        attempts = 0;
        revision = -1;
        storageWarning = "";
        let storageCleared = true;
        try {
            const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
            // Não apagar uma sessão diferente criada em outra aba.
            if (stored?.session_token === saved.session_token && stored?.room_id === saved.room_id) {
                localStorage.removeItem(STORAGE_KEY);
            }
        } catch (_) { storageCleared = false; }
        $("online-board").replaceChildren();
        ["online-code", "online-color", "online-turn", "online-room-status", "online-action"].forEach((id) => { $(id).textContent = ""; });
        $("online-opponent").textContent = "Aguardando jogador";
        $("online-white-captures").textContent = $("online-black-captures").textContent = "0";
        $("room-code").value = "";
        setBusy(false);
        show("choice");
        const warning = storageCleared ? "" : " Não foi possível limpar o armazenamento do navegador.";
        message("Você saiu da sala." + warning);
        try {
            await notification;
        } catch (error) {
            // Uma resposta atrasada da sala antiga não interfere na próxima partida.
            if (ticket === generation && !session && mode === "choice" && ![401, 404].includes(error.status)) {
                message("Você saiu neste navegador, mas não foi possível confirmar a saída no servidor." + warning);
            }
        }
    }
    $("choose-local").addEventListener("click", () => { stop(); show("local"); message(""); });
    $("choose-online").addEventListener("click", () => { show(session ? "online" : "entry"); message(""); if (session) connect(); });
    $("entry-back").addEventListener("click", () => { show("choice"); message(""); });
    $("local-back").addEventListener("click", () => show("choice"));
    $("online-local").addEventListener("click", () => { stop(); show("local"); message("Sua sala foi guardada. Volte a Jogar online para reconectar."); });
    $("create-room").addEventListener("click", () => enter());
    $("join-room").addEventListener("submit", (event) => {
        event.preventDefault();
        const code = $("room-code").value.trim();
        if (code) enter(code);
    });
    $("swap-colors").addEventListener("click", () => pregameAction("swap-colors"));
    $("start-online").addEventListener("click", () => pregameAction("start"));
    $("leave-room").addEventListener("click", leave);
    $("retry-online").addEventListener("click", connect);
    window.addEventListener("offline", () => { stop(); if (mode === "online") message("Sem conexão. Sua sessão continua salva."); });
    window.addEventListener("online", () => { if (mode === "online") connect(); });
    window.addEventListener("pagehide", () => { suspended = true; stop(); });
    window.addEventListener("pageshow", () => { if (suspended) { suspended = false; if (mode === "online") connect(); } });
    window.addEventListener("storage", (event) => {
        if (event.key !== STORAGE_KEY && event.key !== null) return;
        const stored = readSession();
        // Atualizar apenas a cor em outra aba não deve derrubar uma conexão válida.
        if (session && stored && session.room_id === stored.room_id && session.player_id === stored.player_id && session.session_token === stored.session_token) return;
        stop();
        session = stored;
        if (session) manualLeave = false;
        currentRoom = null;
        revision = -1;
        if (mode === "online") { show(session ? "online" : "choice"); if (session) connect(); }
    });
    session = readSession();
    if (session) { show("online"); connect(); }
})();

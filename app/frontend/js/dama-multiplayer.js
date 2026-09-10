(() => {
    "use strict";

    const STORAGE_KEY = "matematica.dama.session.v1";
    const $ = (id) => document.getElementById(id);
    const panels = { choice: "mode-choice", entry: "online-entry", local: "local-game", online: "online-game" };
    const events = new Set(["room_state", "player_joined", "player_left", "player_disconnected"]);
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

    function message(text) { $("network-message").textContent = text; }
    function connection(text) { $("online-connection").textContent = text; }
    function show(next) {
        mode = next;
        Object.entries(panels).forEach(([name, id]) => { $(id).hidden = name !== next; });
    }
    function stop() {
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
                const error = new Error(({ 401: "Token inválido. Entre novamente em uma sala.",
                    404: "Sala inexistente. Ela pode ter sido perdida após reiniciar o servidor.",
                    409: "Sala cheia ou indisponível para novos jogadores." })[response.status]
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
        revision = room.revision;
        $("online-code").textContent = room.room_id;
        $("online-color").textContent = session.color === "white" ? "Brancas" : "Pretas";
        const opponent = room.players.find((player) => player.player_id !== session.player_id);
        $("online-opponent").textContent = !opponent ? "Aguardando jogador" : opponent.connected ? "Conectado" : "Desconectado";
        $("online-turn").textContent = room.current_player === 1 ? "Brancas" : "Pretas";
        $("online-room-status").textContent = ({ WAITING: "Aguardando outro jogador...",
            IN_PROGRESS: "Os dois jogadores estão conectados.", PAUSED: "Sala pausada. Aguardando reconexão.",
            FINISHED: "Partida finalizada.", ABANDONED: "Partida abandonada." })[room.status] || room.status;
        const board = $("online-board");
        const fragment = document.createDocumentFragment();
        room.board.forEach((row, r) => row.forEach((piece, c) => {
            const square = document.createElement("div");
            square.className = `square square--${(r + c) % 2 ? "dark" : "light"}`;
            if (piece) {
                const token = document.createElement("span");
                token.className = `piece piece--${piece.player}${piece.king ? " piece--king" : ""}`;
                square.append(token);
            }
            fragment.append(square);
        }));
        board.replaceChildren(fragment);
    }
    function scheduleRetry() {
        if (!session || mode !== "online" || suspended || busy || retryTimer) return;
        connection("Reconectando");
        const delay = Math.min(30000, 1000 * (2 ** Math.min(attempts++, 5)));
        retryTimer = setTimeout(() => { retryTimer = null; connect(); }, delay);
    }
    async function connect() {
        if (!session || mode !== "online" || suspended || busy) return;
        stop();
        const ticket = generation;
        const saved = session;
        connection("Reconectando");
        $("online-code").textContent = saved.room_id;
        $("online-color").textContent = saved.color === "white" ? "Brancas" : "Pretas";
        const current = () => ticket === generation && session === saved && mode === "online" && !suspended;
        try {
            const room = await request(`/api/dama/rooms/${encodeURIComponent(saved.room_id)}`, "GET", saved.session_token);
            if (!current()) return;
            const player = room.players.find((item) => item.player_id === saved.player_id);
            if (!player || player.color !== saved.color) {
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
                        render(data.room);
                        attempts = 0;
                        connection("Conectado");
                        message(storageWarning);
                    } else if (data.type === "error") {
                        message(data.detail || "Não foi possível processar a mensagem da sala.");
                    }
                } catch (_) { message("Resposta inválida da sala. Tentando reconectar."); ws.close(); }
            };
            ws.onclose = (event) => {
                if (!current()) return;
                socket = null;
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
        if (!session || busy) return;
        const saved = session;
        setBusy(true);
        stop();
        try {
            await request(`/api/dama/rooms/${encodeURIComponent(saved.room_id)}/leave`, "POST", saved.session_token);
            clearSession();
            show("choice");
            message("Você saiu da sala.");
        } catch (error) {
            if ([401, 404].includes(error.status)) { clearSession(); show("choice"); }
            message(error.message);
        } finally { setBusy(false); }
        if (session) scheduleRetry();
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
    $("leave-room").addEventListener("click", leave);
    $("retry-online").addEventListener("click", connect);
    window.addEventListener("offline", () => { stop(); if (mode === "online") message("Sem conexão. Sua sessão continua salva."); });
    window.addEventListener("online", () => { if (mode === "online") connect(); });
    window.addEventListener("pagehide", () => { suspended = true; stop(); });
    window.addEventListener("pageshow", () => { if (suspended) { suspended = false; if (mode === "online") connect(); } });
    window.addEventListener("storage", (event) => {
        if (event.key !== STORAGE_KEY && event.key !== null) return;
        stop();
        session = readSession();
        revision = -1;
        if (mode === "online") { show(session ? "online" : "choice"); if (session) connect(); }
    });
    session = readSession();
    if (session) { show("online"); connect(); }
})();

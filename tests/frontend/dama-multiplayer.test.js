/* Teste sem bibliotecas. Executar runDamaMultiplayerTests(source) em um runtime JS. */
async function runDamaMultiplayerTests(source) {
    class TestURL {
        constructor(path) { this.path = path; this.protocol = "https:"; }
        toString() { return `${this.protocol}//example.test${this.path}`; }
    }
    const assert = (ok, label) => { if (!ok) throw new Error(label); };
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    const room = {
        room_id: "room-test", revision: 1, current_player: 1, status: "WAITING",
        players: [{ player_id: "white-id", color: "white", connected: false }],
        board: Array.from({ length: 8 }, () => Array(8).fill(null))
    };
    const saved = { room_id: room.room_id, player_id: "white-id", color: "white", session_token: "private-token" };
    function browser(initial = null) {
        const elements = new Map(), listeners = {}, sockets = [], requests = [], timers = new Map();
        let counter = 0;
        const storage = new Map(initial ? [["matematica.dama.session.v1", JSON.stringify(initial)]] : []);
        const responses = [];
        function element() {
            return { hidden: false, disabled: false, textContent: "", value: "", children: [], handlers: {},
                setAttribute(name, value) { this[name] = value; },
                addEventListener(name, callback) { this.handlers[name] = callback; },
                append(child) { this.children.push(child); },
                replaceChildren(child) { this.children = child ? child.children : []; },
                querySelector() { return this.button || (this.button = element()); }
            };
        }
        const document = {
            getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
            createElement: element, createDocumentFragment: element
        };
        class WebSocket {
            static OPEN = 1;
            constructor(url) { this.url = String(url); this.readyState = 0; this.sent = []; sockets.push(this); }
            send(data) { this.sent.push(JSON.parse(data)); }
            close() { this.closed = true; this.readyState = 3; }
        }
        const window = { location: { href: "https://example.test/static/dama.html", protocol: "https:" },
            addEventListener(name, callback) { listeners[name] = callback; } };
        const localStorage = { getItem: (key) => storage.get(key) || null,
            setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) };
        const fetch = async (path, options) => {
            requests.push({ path, options });
            const response = await responses.shift();
            if (!response) throw new Error("offline");
            return { ok: response.status < 400, status: response.status, json: async () => response.data };
        };
        const setTimer = (callback, delay) => { const id = ++counter; timers.set(id, { callback, delay }); return id; };
        const clearTimer = (id) => timers.delete(id);
        const launch = () => new Function("document", "window", "localStorage", "WebSocket", "fetch", "URL", "AbortController", "setTimeout", "clearTimeout", "setInterval", "clearInterval", source)(
            document, window, localStorage, WebSocket, fetch, TestURL, class { abort() {} }, setTimer, clearTimer, setTimer, clearTimer);
        return { elements, listeners, sockets, requests, storage, responses, timers, launch,
            get: document.getElementById, click: (id) => document.getElementById(id).handlers.click() };
    }
    const app = browser();
    app.launch();
    app.click("choose-local");
    assert(app.requests.length === 0 && !app.get("local-game").hidden, "local não usa backend");
    app.click("local-back"); app.click("choose-online");
    app.responses.push({ status: 201, data: { room, player_id: saved.player_id, session_token: saved.session_token } }, { status: 200, data: room });
    await app.click("create-room"); await flush();
    assert(app.sockets.length === 1, "uma conexão após criar");
    assert(JSON.parse([...app.storage.values()][0]).color === "white", "sessão branca salva");
    let ws = app.sockets[0]; ws.readyState = 1; ws.onopen();
    assert(ws.url.startsWith("wss:") && !ws.url.includes(saved.session_token), "token fora da URL");
    assert(ws.sent[0].session_token === saved.session_token, "autenticação");
    ws.onmessage({ data: JSON.stringify({ type: "room_state", room }) });
    assert(app.get("online-connection").textContent === "Conectado", "estado autenticado");
    assert(app.get("online-board").children.length === 64, "64 casas online");
    ws.onclose({ code: 1006 });
    assert(app.get("online-connection").textContent === "Reconectando", "retry automático");
    assert(app.storage.size === 1, "queda preserva token");
    app.responses.push({ status: 200, data: room });
    const retry = [...app.timers.values()].find((timer) => timer.delay === 1000);
    retry.callback(); await flush();
    assert(app.sockets.length === 2, "nova conexão após queda");
    app.responses.push({ status: 200, data: room });
    await app.click("leave-room");
    assert(app.storage.size === 0 && !app.get("mode-choice").hidden, "saída limpa sessão");
    assert(app.requests.at(-1).path.endsWith("/leave"), "saída chama API");

    // A resposta antiga pode chegar depois de uma nova sala já estar conectada.
    const leaving = browser(saved);
    leaving.responses.push({ status: 200, data: room }); leaving.launch(); await flush();
    leaving.storage.set("game-preferences", "preserve");
    const oldSocket = leaving.sockets[0];
    const lateClose = oldSocket.onclose;
    let finishLeave;
    leaving.responses.push(new Promise((resolve) => { finishLeave = resolve; }));
    const leavePromise = leaving.click("leave-room");
    assert(!leaving.get("mode-choice").hidden && leaving.get("online-game").hidden, "retorna sem aguardar rede");
    assert(leaving.get("online-board").children.length === 0, "limpa tabuleiro online");
    assert(leaving.storage.get("game-preferences") === "preserve" && leaving.storage.size === 1, "preserva configurações gerais");
    assert(oldSocket.closed, "fecha WebSocket");
    lateClose({ code: 1006 }); leaving.listeners.online();
    assert(![...leaving.timers.values()].some((timer) => timer.delay === 1000), "saída não reconecta");
    const newRoom = { ...room, room_id: "new-room", revision: 0 };
    leaving.click("choose-online");
    assert(!leaving.get("online-entry").hidden, "permite criar ou entrar novamente");
    leaving.responses.push({ status: 201, data: { room: newRoom, player_id: saved.player_id, session_token: "new-token" } }, { status: 200, data: newRoom });
    await leaving.click("create-room"); await flush();
    assert(leaving.sockets.length === 2, "nova sala conecta sem recarregar");
    finishLeave({ status: 503 }); await leavePromise;
    assert(leaving.get("online-code").textContent === "new-room", "resposta antiga não altera nova sala");
    assert(JSON.parse(leaving.storage.get("matematica.dama.session.v1")).session_token === "new-token", "mantém nova sessão");
    const failedLeave = browser(saved);
    failedLeave.responses.push({ status: 200, data: room }); failedLeave.launch(); await flush();
    failedLeave.responses.push({ status: 503 }); await failedLeave.click("leave-room");
    assert(failedLeave.storage.size === 0 && !failedLeave.get("mode-choice").hidden, "falha HTTP não prende usuário");

    const restored = browser(saved);
    restored.responses.push({ status: 200, data: room }); restored.launch(); await flush();
    assert(restored.sockets.length === 1 && restored.requests[0].options.method === "GET", "reabre com GET, não join");
    restored.listeners.pagehide();
    assert(restored.storage.size === 1 && restored.requests.length === 1, "fechar aba não chama leave");

    const invalid = browser(saved);
    invalid.responses.push({ status: 401 }); invalid.launch(); await flush();
    assert(invalid.storage.size === 0 && invalid.sockets.length === 0, "token inválido encerra retry");
    assert(invalid.get("network-message").textContent.includes("Token inválido"), "erro inline");

    const black = browser(); black.launch(); black.click("choose-online"); black.get("room-code").value = room.room_id;
    const joined = { ...room, players: [...room.players, { player_id: "black-id", color: "black", connected: false }] };
    black.responses.push({ status: 201, data: { room: joined, player_id: "black-id", session_token: "black-token" } }, { status: 200, data: joined });
    black.get("join-room").handlers.submit({ preventDefault() {} }); await flush();
    assert(black.requests[0].path.endsWith("/join"), "entrada via join");
    assert(JSON.parse([...black.storage.values()][0]).color === "black", "pretas identificadas");
    for (const status of [404, 409, 503]) {
        const failure = browser(); failure.launch(); failure.click("choose-online");
        failure.responses.push({ status }); await failure.click("create-room");
        assert(failure.sockets.length === 0 && failure.storage.size === 0, `erro ${status} não salva sessão`);
        assert(failure.get("network-message").textContent.length > 0, `erro ${status} visível`);
    }
    const slow = browser(saved);
    slow.responses.push({ status: 200, data: room }, { status: 200, data: room });
    slow.launch(); slow.click("retry-online"); await flush();
    assert(slow.sockets.length === 1, "GET antigo não abre conexão duplicada");
    const playing = browser(saved);
    const active = JSON.parse(JSON.stringify(room));
    active.status = "IN_PROGRESS";
    active.board[5][0] = { player: 1, king: false };
    active.board[2][1] = { player: 2, king: false };
    active.captures = { 1: 0, 2: 0 };
    active.legal_moves = [{ from: { row: 5, col: 0 }, to: { row: 4, col: 1 }, capture: null }];
    playing.responses.push({ status: 200, data: active }); playing.launch(); await flush();
    const live = playing.sockets[0]; live.readyState = 1; live.onopen();
    live.onmessage({ data: JSON.stringify({ type: "player_connected", room: active }) });
    assert(playing.get("online-action").textContent === "Sua vez", "turno pessoal");
    playing.get("online-board").children[17].handlers.click();
    assert(!playing.get("online-board").children.some((s) => s.className.includes("target")), "não seleciona adversário");
    playing.get("online-board").children[40].handlers.click();
    assert(playing.get("online-board").children[33].className.includes("square--target"), "destinos do servidor");
    playing.get("online-board").children[33].handlers.click();
    assert(live.sent.at(-1).type === "move" && live.sent.at(-1).from.row === 5, "envia origem e destino");
    assert(playing.get("online-board").children[40].children.length === 1, "não move antes da confirmação");
    const sentCount = live.sent.length;
    playing.get("online-board").children[33].handlers.click();
    assert(live.sent.length === sentCount, "bloqueia envio duplicado pendente");
    live.onmessage({ data: JSON.stringify({ type: "move_rejected", detail: "Estado mudou", room: active }) });
    assert(playing.get("network-message").textContent === "Estado mudou", "rejeição inline");
    playing.get("online-board").children[40].handlers.click();
    playing.get("online-board").children[33].handlers.click();
    const confirmed = JSON.parse(JSON.stringify(active));
    confirmed.revision = 2; confirmed.current_player = 2;
    confirmed.board[4][1] = confirmed.board[5][0]; confirmed.board[5][0] = null;
    live.onmessage({ data: JSON.stringify({ type: "state", room: confirmed }) });
    assert(playing.get("online-board").children[40].children.length === 0, "origem limpa após confirmação");
    assert(playing.get("online-board").children[33].children.length === 1, "destino confirmado");
    assert(playing.get("online-action").textContent === "Aguardando jogada do adversário", "turno do adversário");
    live.onmessage({ data: JSON.stringify({ type: "state", room: active }) });
    assert(playing.get("online-board").children[33].children.length === 1, "ignora snapshot antigo");
    const forced = JSON.parse(JSON.stringify(active));
    forced.revision = 3; forced.forced_piece = { row: 5, col: 0 };
    live.onmessage({ data: JSON.stringify({ type: "state", room: forced }) });
    assert(playing.get("online-board").children[33].className.includes("target"), "captura forçada seleciona destinos");
    const finished = { ...forced, revision: 4, status: "FINISHED", winner: 1, legal_moves: [] };
    live.onmessage({ data: JSON.stringify({ type: "state", room: finished }) });
    assert(playing.get("online-board").children.every((s) => s.disabled), "vitória bloqueia tabuleiro");
    assert(playing.get("online-action").textContent.includes("brancas venceram"), "vitória visível");
    const lobby = browser(saved);
    const ready = { ...active, status: "READY", started: false, creator_id: saved.player_id,
        players: [{ player_id: saved.player_id, color: "white", connected: true, left: false },
                  { player_id: "guest", color: "black", connected: true, left: false }] };
    lobby.responses.push({ status: 200, data: ready }); lobby.launch(); await flush();
    const lobbySocket = lobby.sockets[0]; lobbySocket.readyState = 1; lobbySocket.onopen();
    lobbySocket.onmessage({ data: JSON.stringify({ type: "state", room: ready }) });
    assert(!lobby.get("swap-colors").hidden && !lobby.get("start-online").hidden, "controles pré-jogo");
    assert(lobby.get("online-board").children.every((cell) => cell.disabled), "READY bloqueia jogadas");
    assert(lobby.get("online-board").children[40].children[0].className.includes("piece--1"), "brancas embaixo na orientação branca");
    const swapped = { ...ready, revision: 2, players: ready.players.map((p) => ({ ...p, color: p.color === "white" ? "black" : "white" })) };
    lobby.responses.push({ status: 200, data: swapped }); await lobby.click("swap-colors");
    assert(lobby.get("online-color").textContent === "Pretas", "cor confirmada pelo backend");
    assert(lobby.get("online-board").children[46].children[0].className.includes("piece--2"), "pretas embaixo imediatamente após troca");
    assert(lobby.get("online-board").children[23].children[0].className.includes("piece--1"), "brancas em cima após troca");
    const countBeforeStorage = lobby.sockets.length;
    lobby.listeners.storage({ key: "matematica.dama.session.v1" }); await flush();
    assert(lobby.sockets.length === countBeforeStorage && !lobbySocket.closed, "cor salva não derruba socket");
    const started = { ...swapped, revision: 3, started: true, status: "IN_PROGRESS" };
    lobby.responses.push({ status: 200, data: started }); await lobby.click("start-online");
    assert(lobby.get("swap-colors").hidden && lobby.get("start-online").hidden, "cores bloqueadas após início");
    const rejoin = browser(saved);
    rejoin.responses.push({ status: 200, data: swapped }); rejoin.launch(); await flush();
    assert(rejoin.sockets.length === 1 && rejoin.get("online-color").textContent === "Pretas", "retorno aceita cor atualizada");
    assert(rejoin.get("online-board").children[46].children[0].className.includes("piece--2"), "reconexão preserva orientação preta");
    const blackTurn = { ...started, revision: 4, current_player: 2,
        legal_moves: [{ from: { row: 2, col: 1 }, to: { row: 3, col: 0 }, capture: null }] };
    lobbySocket.onmessage({ data: JSON.stringify({ type: "state", room: blackTurn }) });
    lobby.get("online-board").children[46].handlers.click();
    assert(lobby.get("online-board").children[39].className.includes("target"), "destino invertido visualmente");
    assert(lobby.get("online-board").children[46]["aria-label"].includes("Linha 3, coluna 2"), "rótulo mantém coordenada lógica");
    lobby.get("online-board").children[39].handlers.click();
    const blackMove = lobbySocket.sent.at(-1);
    assert(blackMove.from.row === 2 && blackMove.from.col === 1 && blackMove.to.row === 3 && blackMove.to.col === 0, "clique invertido envia coordenadas lógicas");
    const guest = { ...ready, revision: 5, creator_id: "guest" };
    lobbySocket.onmessage({ data: JSON.stringify({ type: "state", room: guest }) });
    assert(lobby.get("start-online").hidden && lobby.get("online-action").textContent === "Aguardando o criador iniciar a partida", "segundo participante aguarda criador");
    return "Fluxos de sessão e jogadas autoritativas, rejeição, turno, captura forçada, vitória e snapshots antigos: OK";
}

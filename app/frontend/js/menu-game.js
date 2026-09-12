(() => {
    const $ = (id) => document.getElementById(id);
    const questionElement = $("game-question"), answerInput = $("game-answer");
    const form = $("game-form"), confirm = form.querySelector("button[type='submit']");
    const start = $("game-start"), feedback = $("game-feedback");
    const BEST_KEY = "mathChallengeBestTime", TARGET = 10;
    let answer = 0, correct = 0, errors = 0, streak = 0, bestStreak = 0;
    let active = false, answered = true, startedAt = 0, elapsed = 0, ticker, next;
    let best = null;
    try {
        const saved = Number(localStorage.getItem(BEST_KEY));
        if (Number.isFinite(saved) && saved > 0) best = saved;
    } catch (_) { /* O desafio continua disponível sem armazenamento. */ }
    const format = (ms) => {
        const seconds = Math.floor(ms / 1000);
        return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    };
    const update = () => {
        $("game-time").textContent = format(elapsed);
        $("game-correct").textContent = `${correct} / ${TARGET}`;
        $("game-errors").textContent = errors;
        $("game-record").textContent = best === null ? "—" : format(best);
        $("game-score").textContent = correct * 10;
        $("game-streak").textContent = streak;
        $("game-best-streak").textContent = bestStreak;
    };
    const lock = (value) => { answerInput.disabled = value; confirm.disabled = value; };
    const randomInteger = (minimum, maximum) => Math.floor(Math.random() * (maximum - minimum + 1)) + minimum;
    const createQuestion = () => {
        if (!active) return;
        const operation = randomInteger(0, 3);
        let firstNumber;
        let secondNumber;
        let symbol;

        if (operation === 0) {
            firstNumber = randomInteger(1, 30);
            secondNumber = randomInteger(1, 30);
            answer = firstNumber + secondNumber;
            symbol = "+";
        } else if (operation === 1) {
            secondNumber = randomInteger(1, 20);
            answer = randomInteger(1, 30);
            firstNumber = answer + secondNumber;
            symbol = "−";
        } else if (operation === 2) {
            firstNumber = randomInteger(2, 12);
            secondNumber = randomInteger(2, 12);
            answer = firstNumber * secondNumber;
            symbol = "×";
        } else {
            secondNumber = randomInteger(2, 12);
            answer = randomInteger(2, 12);
            firstNumber = secondNumber * answer;
            symbol = "÷";
        }

        questionElement.textContent = `${firstNumber} ${symbol} ${secondNumber} = ?`;
        answerInput.value = "";
        answered = false;
        lock(false);
        feedback.textContent = "";
        answerInput.focus();
    };
    start.addEventListener("click", () => {
        clearTimeout(next); clearInterval(ticker);
        correct = errors = streak = bestStreak = elapsed = 0;
        active = true; startedAt = performance.now();
        start.hidden = true;
        update(); createQuestion();
        ticker = setInterval(() => { elapsed = performance.now() - startedAt; update(); }, 250);
    });
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!active || answered) return;
        if (answerInput.value.trim() === "" || !Number.isFinite(Number(answerInput.value))) {
            feedback.textContent = "Digite uma resposta para confirmar.";
            return;
        }
        // Uma pergunta é encerrada na primeira tentativa, inclusive após erro.
        answered = true; lock(true);
        const hit = Number(answerInput.value) === answer;
        if (hit) { correct++; streak++; bestStreak = Math.max(bestStreak, streak); }
        else { errors++; streak = 0; }
        elapsed = performance.now() - startedAt;
        feedback.className = `game-feedback game-feedback--${hit ? "correct" : "wrong"}`;
        feedback.textContent = hit ? "Muito bem! +10 pontos" : `Quase! A resposta correta era ${answer}.`;
        if (correct === TARGET) {
            active = false; clearInterval(ticker);
            const record = best === null || elapsed < best;
            let storageMessage = "";
            if (record) {
                best = elapsed;
                try { localStorage.setItem(BEST_KEY, String(best)); }
                catch (_) { storageMessage = " Não foi possível salvar o recorde neste navegador."; }
            }
            feedback.textContent = `Desafio concluído!${record ? " Novo recorde!" : ""} Tempo: ${format(elapsed)}. Erros: ${errors}.${storageMessage}`;
            start.textContent = "Jogar novamente"; start.hidden = false; start.focus();
        } else {
            next = setTimeout(createQuestion, hit ? 900 : 1600);
        }
        update();
    });
    lock(true); update();
})();

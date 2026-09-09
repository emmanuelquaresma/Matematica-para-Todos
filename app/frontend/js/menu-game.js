(() => {
    const questionElement = document.querySelector("#game-question");
    const answerInput = document.querySelector("#game-answer");
    const form = document.querySelector("#game-form");
    const newQuestionButton = document.querySelector("#new-question");
    const feedbackElement = document.querySelector("#game-feedback");
    const scoreElement = document.querySelector("#game-score");
    const correctElement = document.querySelector("#game-correct");
    const streakElement = document.querySelector("#game-streak");
    const bestStreakElement = document.querySelector("#game-best-streak");

    let answer = 0;
    let score = 0;
    let correctAnswers = 0;
    let streak = 0;
    let bestStreak = 0;
    let nextQuestionTimer;

    const randomInteger = (minimum, maximum) =>
        Math.floor(Math.random() * (maximum - minimum + 1)) + minimum;

    const createQuestion = () => {
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
        answerInput.disabled = false;
        form.querySelector("button[type='submit']").disabled = false;
        feedbackElement.textContent = "";
        feedbackElement.className = "game-feedback";
        answerInput.focus();
    };

    const updateStats = () => {
        scoreElement.textContent = score;
        correctElement.textContent = correctAnswers;
        streakElement.textContent = streak;
        bestStreakElement.textContent = bestStreak;
    };

    form.addEventListener("submit", (event) => {
        event.preventDefault();
        const userAnswer = Number(answerInput.value);

        if (answerInput.value.trim() === "") {
            feedbackElement.textContent = "Digite uma resposta para confirmar.";
            feedbackElement.className = "game-feedback game-feedback--wrong";
            answerInput.focus();
            return;
        }

        if (userAnswer === answer) {
            score += 10;
            correctAnswers += 1;
            streak += 1;
            bestStreak = Math.max(bestStreak, streak);
            feedbackElement.textContent = "Muito bem! +10 pontos";
            feedbackElement.className = "game-feedback game-feedback--correct";
            updateStats();
            answerInput.disabled = true;
            form.querySelector("button[type='submit']").disabled = true;
            nextQuestionTimer = window.setTimeout(createQuestion, 900);
            return;
        }

        streak = 0;
        feedbackElement.textContent = `Quase! A resposta correta era ${answer}.`;
        feedbackElement.className = "game-feedback game-feedback--wrong";
        updateStats();
        answerInput.select();
    });

    newQuestionButton.addEventListener("click", () => {
        window.clearTimeout(nextQuestionTimer);
        createQuestion();
    });

    createQuestion();
})();

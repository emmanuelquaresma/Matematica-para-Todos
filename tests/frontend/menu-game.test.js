function runMenuGameTests(source) {
    const nodes = new Map(), storage = new Map(), timers = new Map();
    let now = 0, id = 0;
    const get = (key) => {
        if (!nodes.has(key)) nodes.set(key, { textContent: '', value: '', hidden: false,
            addEventListener(type, fn) { this[type] = fn; }, focus() {},
            querySelector() { return get('confirm'); } });
        return nodes.get(key);
    };
    const timer = (fn) => { timers.set(++id, fn); return id; };
    const assert = (value, message) => { if (!value) throw Error(message); };
    new Function('document', 'localStorage', 'performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', source)(
        { getElementById: get }, { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v) },
        { now: () => now }, timer, k => timers.delete(k), timer, k => timers.delete(k));
    const submit = (value) => { get('game-answer').value = String(value); get('game-form').submit({ preventDefault() {} }); };
    const answer = () => {
        const [a, op, b] = get('game-question').textContent.split(' ');
        return op === '+' ? +a + +b : op === '−' ? a-b : op === '×' ? a*b : a/b;
    };
    assert(timers.size === 0 && get('game-answer').disabled, 'não inicia ao carregar');
    get('game-start').click(); now = 5000;
    submit(answer()+1); submit(answer());
    assert(get('game-errors').textContent === 1 && get('game-correct').textContent === '0 / 10', 'erro não permite ganhar acerto');
    for (const fn of [...timers.values()]) fn();
    for (let i=0;i<10;i++) {
        now += 2000; submit(answer()); submit(answer());
        if(i<9) for(const fn of [...timers.values()]) fn();
    }
    assert(get('game-correct').textContent === '10 / 10' && get('game-answer').disabled, 'dez acertos encerram');
    assert(storage.get('mathChallengeBestTime') === '25000', 'salva tempo completo');
    now += 10000;
    assert(get('game-time').textContent === '00:25', 'cronômetro parado');
    get('game-start').click();
    assert(get('game-correct').textContent === '0 / 10' && get('game-errors').textContent === 0, 'reinício limpa rodada');
    for(let i=0;i<10;i++) { now += 1000; submit(answer()); if(i<9) for(const fn of [...timers.values()]) fn(); }
    assert(storage.get('mathChallengeBestTime') === '10000', 'melhor tempo substitui recorde');
    return 'Cronômetro, tentativa única, 10 acertos, reinício e recorde: OK';
}

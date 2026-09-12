(() => {
    const root = document.querySelector('.activity-carousel');
    if (!root) return;
    const track = root.querySelector('.subject-grid');
    const cards = [...track.querySelectorAll('.subject-card')];
    const prev = document.getElementById('carousel-prev');
    const next = document.getElementById('carousel-next');
    const dots = root.querySelector('.carousel-dots');
    const status = document.getElementById('carousel-status');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let active = 0;
    let frame = 0;
    let drag = null;
    let dragged = false;
    const buttons = cards.map((card, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'carousel-dot';
        button.setAttribute('aria-label', `Mostrar ${card.querySelector('h2').textContent}`);
        button.setAttribute('aria-controls', 'activity-track');
        button.addEventListener('click', () => go(index));
        dots.append(button);
        card.draggable = false;
        return button;
    });
    function mark(index) {
        active = index;
        cards.forEach((card, i) => card.classList.toggle('is-active', i === active));
        buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === active)));
        prev.disabled = active === 0;
        next.disabled = active === cards.length - 1;
        status.textContent = `${active + 1} de ${cards.length}: ${cards[active].querySelector('h2').textContent}`;
    }
    function go(index, instant = false) {
        const i = Math.max(0, Math.min(cards.length - 1, index));
        // offsetWidth independe da escala visual aplicada ao card.
        const left = cards[i].offsetLeft + cards[i].offsetWidth / 2 - track.clientWidth / 2;
        mark(i);
        track.scrollTo({ left, behavior: instant || reducedMotion.matches ? 'instant' : 'smooth' });
    }
    function sync() {
        frame = 0;
        const center = track.scrollLeft + track.clientWidth / 2;
        let closest = 0;
        cards.forEach((card, i) => {
            if (Math.abs(card.offsetLeft + card.offsetWidth / 2 - center) < Math.abs(cards[closest].offsetLeft + cards[closest].offsetWidth / 2 - center)) closest = i;
        });
        if (closest !== active) mark(closest);
    }
    track.addEventListener('scroll', () => { if (!frame) frame = requestAnimationFrame(sync); }, { passive: true });
    prev.addEventListener('click', () => go(active - 1));
    next.addEventListener('click', () => go(active + 1));
    track.addEventListener('keydown', (event) => {
        const targets = { ArrowLeft: active - 1, ArrowRight: active + 1, Home: 0, End: cards.length - 1 };
        if (!(event.key in targets)) return;
        event.preventDefault();
        const index = Math.max(0, Math.min(cards.length - 1, targets[event.key]));
        cards[index].focus({ preventScroll: true });
        go(index);
    });
    track.addEventListener('focusin', (event) => {
        const index = cards.indexOf(event.target.closest('.subject-card'));
        if (index >= 0 && !drag) go(index);
    });
    // Touch usa a rolagem nativa; o mouse recebe arraste sem seguir o link ao soltar.
    track.addEventListener('pointerdown', (event) => {
        if (event.pointerType !== 'mouse' || event.button !== 0) return;
        dragged = false;
        drag = { id: event.pointerId, x: event.clientX, scroll: track.scrollLeft };
    });
    track.addEventListener('pointermove', (event) => {
        if (!drag) return;
        const distance = event.clientX - drag.x;
        if (Math.abs(distance) > 6) {
            dragged = true;
            track.classList.add('is-dragging');
            track.setPointerCapture(drag.id);
        }
        if (dragged) { event.preventDefault(); track.scrollLeft = drag.scroll - distance; }
    });
    function endDrag() {
        if (!drag) return;
        if (track.hasPointerCapture(drag.id)) track.releasePointerCapture(drag.id);
        drag = null;
        track.classList.remove('is-dragging');
        if (dragged) { sync(); go(active); }
    }
    track.addEventListener('pointerup', endDrag);
    track.addEventListener('pointercancel', endDrag);
    track.addEventListener('click', (event) => {
        if (dragged) { event.preventDefault(); event.stopPropagation(); dragged = false; }
    }, true);
    const practice = document.getElementById('desafio');
    function followHash() {
        if (window.location.hash === '#desafio') {
            practice.open = true;
            requestAnimationFrame(() => practice.scrollIntoView({ block: 'start', behavior: reducedMotion.matches ? 'instant' : 'smooth' }));
        } else if (window.location.hash === '#jogos') {
            go(cards.findIndex((card) => card.id === 'jogos'), true);
        }
    }
    cards.forEach((card) => {
        if (card.getAttribute('href') === '#desafio') card.addEventListener('click', () => { practice.open = true; });
    });
    window.addEventListener('hashchange', followHash);
    new ResizeObserver(() => go(active, true)).observe(track);
    root.querySelector('.carousel-controls').hidden = false;
    mark(0);
    followHash();
})();

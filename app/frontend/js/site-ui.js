(() => {
    const header = document.querySelector('.site-header');
    if (!header) return;
    const toggle = header.querySelector('.site-toggle');
    header.classList.add('is-enhanced');
    toggle.hidden = false;
    const close = () => {
        header.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'Abrir menu de navegação');
    };
    toggle.addEventListener('click', () => {
        const open = header.classList.toggle('is-open');
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', open ? 'Fechar menu de navegação' : 'Abrir menu de navegação');
    });
    header.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && header.classList.contains('is-open')) { close(); toggle.focus(); }
    });
    header.querySelectorAll('.site-nav a').forEach((link) => {
        link.addEventListener('click', close);
        const path = window.location.pathname;
        if ((link.getAttribute('href') === '/' && path === '/') ||
            (link.textContent === 'Jogos' && path.endsWith('/dama.html')) ||
            (link.textContent === 'Atividades' && (path === '/menu' || /grau\.html$/.test(path)))) {
            link.setAttribute('aria-current', 'page');
        }
    });
})();

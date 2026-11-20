/*
  Hub
  1) Parallax suave do céu e dos prédios ao mover o mouse (só com mouse).
  2) Saudação conforme o horário, com o primeiro nome do usuário logado.
  3) Vistas: ao escolher um grupo (Demonstrações contábeis, Controle de ativos), o próprio hub troca título, texto e cartões,
     sem mudar de página. A vista fica no endereço (hub.html#demonstracoes), então o botão Voltar e os links funcionam.
  4) Ao seguir para outra página (módulo, Sair), o trem parte para a direita e a página some em seguida.
     "Sair" (data-logout) encerra a sessão no Supabase antes de voltar ao login.
     Trocar de vista dentro do hub não dispara essa saída.
  Com "reduzir movimento" ativado no sistema, parallax e transição não rodam.
*/

(() => {
  const reduzMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const raiz = document.documentElement;

  /* ---------- Saudação ---------- */
  const saudar = () => {
    const el = document.getElementById('saudacao');
    if (!el) return;
    const h = new Date().getHours();
    const nome = (window.Sessao && Sessao.primeiroNome()) || '';
    const periodo = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
    el.textContent = nome ? `${periodo}, ${nome}!` : `${periodo}!`;
  };

  /* ---------- Vistas ---------- */
  const conteudo = document.getElementById('vista');
  const vistas = { raiz: { html: conteudo.innerHTML, titulo: document.title } };
  document.querySelectorAll('template[id^="vista-"]').forEach((molde) => {
    vistas[molde.id.slice(6)] = { html: molde.innerHTML, titulo: molde.dataset.titulo };
  });
  let atual = 'raiz', alvo = 'raiz', senha = 0;

  const vistaDoHash = () => (location.hash.slice(1) in vistas ? location.hash.slice(1) : 'raiz');

  function desenhar(nome) {
    conteudo.innerHTML = vistas[nome].html;
    document.title = vistas[nome].titulo;
    atual = nome;
    saudar();
    const titulo = conteudo.querySelector('h1');
    if (titulo) { titulo.tabIndex = -1; titulo.focus({ preventScroll: true }); }
  }

  function ir(nome, historico = true) {
    if (nome === alvo) return;
    alvo = nome;
    if (historico) history.pushState({ vista: nome }, '', nome === 'raiz' ? location.pathname + location.search : '#' + nome);
    if (reduzMovimento) { desenhar(nome); return; }
    const minha = ++senha;
    conteudo.classList.add('trocando');
    setTimeout(() => {
      if (minha !== senha) return;
      desenhar(nome);
      conteudo.classList.remove('trocando');
    }, 220);
  }

  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[data-vista]');
    const comModificador = e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
    if (!link || e.defaultPrevented || e.button !== 0 || comModificador) return;
    e.preventDefault();
    ir(link.dataset.vista);
  });
  window.addEventListener('popstate', () => ir(vistaDoHash(), false));

  saudar();
  if (window.Sessao) Sessao.pronta.then(saudar);   // o nome chega quando o login é confirmado
  if (vistaDoHash() !== 'raiz') { alvo = vistaDoHash(); desenhar(alvo); }

  /* ---------- Parallax ---------- */
  if (!reduzMovimento && window.matchMedia('(hover: hover)').matches) {
    let alvoX = 0, alvoY = 0, x = 0, y = 0, rodando = false;

    const passo = () => {
      x += (alvoX - x) * 0.08;
      y += (alvoY - y) * 0.08;
      raiz.style.setProperty('--mx', x.toFixed(3));
      raiz.style.setProperty('--my', y.toFixed(3));

      if (Math.abs(alvoX - x) > 0.001 || Math.abs(alvoY - y) > 0.001) {
        requestAnimationFrame(passo);
      } else {
        rodando = false;
      }
    };

    window.addEventListener('pointermove', (e) => {
      alvoX = (e.clientX / window.innerWidth) * 2 - 1;
      alvoY = (e.clientY / window.innerHeight) * 2 - 1;
      if (!rodando) {
        rodando = true;
        requestAnimationFrame(passo);
      }
    }, { passive: true });
  }

  /* ---------- Transição ao sair: o trem parte e a página some ---------- */
  let saindo = false;

  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[data-sai]');
    const comModificador = e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
    if (!link || e.defaultPrevented || e.button !== 0 || comModificador) return;

    e.preventDefault();
    if (saindo) return;
    saindo = true;

    // "Sair" encerra a sessão no Supabase (fazerLogout, em usuario.js); os demais apenas navegam
    const seguir = () => {
      if (link.hasAttribute('data-logout') && typeof fazerLogout === 'function') fazerLogout();
      else window.location.href = link.href;
    };

    if (reduzMovimento) { seguir(); return; }

    document.body.classList.add('partindo');
    setTimeout(() => document.body.classList.add('saindo'), 300);
    setTimeout(seguir, 580);
  });

  // Ao voltar pelo botão do navegador, a página não pode ficar apagada nem com o trem fora da tela
  window.addEventListener('pageshow', () => {
    saindo = false;
    document.body.classList.remove('saindo', 'partindo');
  });
})();

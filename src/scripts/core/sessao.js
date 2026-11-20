// PORTÃO DE SESSÃO
// Carregado SEM defer, logo no <head> de toda página protegida (antes de qualquer outro script).
// 1) Esconde a página até o main.js confirmar a sessão, para quem não está logado não ver o conteúdo.
// 2) Cria Sessao.pronta: uma promessa que resolve com o usuário logado. Os serviços de dados
//    esperam por ela antes de consultar o Supabase.

(() => {
  const raiz = document.documentElement;
  raiz.classList.add('auth-pendente');

  const estilo = document.createElement('style');
  // As animações de entrada ficam pausadas enquanto a página está escondida e começam ao aparecer
  estilo.textContent = 'html.auth-pendente body { visibility: hidden; }' +
    'html.auth-pendente body, html.auth-pendente body * { animation-play-state: paused !important; }';
  document.head.appendChild(estilo);

  let resolver;
  const pronta = new Promise(r => { resolver = r; });

  // Raiz do site = três pastas acima deste arquivo (src/scripts/core/). Assim os endereços funcionam
  // em qualquer servidor: Vercel, Live Server (aberto na raiz do projeto ou em public/) ou python -m http.server.
  const BASE = new URL('../../../', document.currentScript.src);

  // Rotas curtas do vercel.json (mantenha iguais). Só valem no site publicado: localmente
  // (Live Server, http.server) as páginas continuam com o endereço completo.
  const ROTAS_CURTAS = {
    'pages/hub/hub': '/hub',
    'pages/controladoria/tarefas/tarefas': '/tarefas',
    'pages/controladoria/equipe/equipe': '/equipe',
    'pages/controladoria/ferias/ferias': '/ferias',
    'pages/controladoria/automacoes/automacoes': '/automacoes',
    'pages/demonstracoes/bp/bp': '/bp',
    'pages/demonstracoes/dr/dr': '/dr',
    'pages/demonstracoes/dmpl/dmpl': '/dmpl',
    'pages/demonstracoes/dfc/dfc': '/dfc',
    'pages/controles/composicao/composicao': '/composicao',
    'pages/controles/analitico/analitico': '/analitico',
    'pages/controles/peps/peps': '/peps',
    'pages/controles/ordens/ordens_inv': '/ordens'
  };
  const LOCAL = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

  // No site publicado, todo link interno para uma página com rota curta abre pela rota curta
  if (!LOCAL) {
    const encurtar = evento => {
      const a = evento.target.closest && evento.target.closest('a[href]');
      if (!a) return;
      const destino = new URL(a.getAttribute('href'), document.baseURI);
      if (destino.origin !== location.origin) return;
      const curta = ROTAS_CURTAS[destino.pathname.replace(/^\//, '').replace(/\.html$/, '')];
      if (curta) a.href = curta + destino.search + destino.hash;
    };
    document.addEventListener('click', encurtar, true);      // antes dos outros cliques da página
    document.addEventListener('auxclick', encurtar, true);   // clique do meio (nova aba)
  }

  window.Sessao = {
    BASE: BASE.href,
    URL_LOGIN: new URL('index.html', BASE).href,
    URL_HUB: LOCAL ? new URL('pages/hub/hub.html', BASE).href : location.origin + '/hub',
    usuario: null,
    pronta,

    // Chamado pelo main.js quando a sessão é válida
    confirmar(user) {
      this.usuario = user;
      raiz.classList.remove('auth-pendente');
      resolver(user);
    },

    nome() {
      const u = this.usuario;
      if (!u) return '';
      return u.user_metadata?.full_name || u.user_metadata?.name || u.email || '';
    },

    primeiroNome() {
      const nome = this.nome();
      return nome.includes('@') ? nome.split('@')[0] : nome.split(' ')[0];
    }
  };
})();

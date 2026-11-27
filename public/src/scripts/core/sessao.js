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
    'pages/controladoria/painel/painel': '/painel',
    'pages/configuracao/configuracao': '/configuracao',
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

  // Endereço curto de uma URL interna (só no site publicado); devolve a própria URL se não houver rota curta
  function enderecoCurto(url) {
    if (LOCAL) return url;
    const destino = new URL(url, document.baseURI);
    if (destino.origin !== location.origin) return url;
    const curta = ROTAS_CURTAS[destino.pathname.replace(/^\//, '').replace(/\.html$/, '')];
    return curta ? location.origin + curta + destino.search + destino.hash : url;
  }

  if (!LOCAL) {
    // Página aberta pelo endereço longo (ex.: retorno do login): a barra passa para a rota curta, sem recarregar e
    // mantendo #/parâmetros. Só com o <base> da publicação, que mantém os caminhos relativos funcionando.
    if (document.querySelector('base[href]')) {
      const curta = enderecoCurto(location.href);
      if (curta !== location.href) history.replaceState(history.state, '', curta);
    }

    // Links internos com rota curta passam a apontar para ela já na página (vale para passar o mouse, copiar o
    // endereço e abrir em nova aba), inclusive os criados depois por script (vistas do hub, barra da controladoria)
    const encurtar = a => {
      const atual = a.getAttribute('href');
      if (!atual || atual[0] === '#' || /^(mailto:|tel:|javascript:)/i.test(atual)) return;
      const curta = enderecoCurto(atual);
      if (curta !== atual && curta !== new URL(atual, document.baseURI).href) a.setAttribute('href', curta);
    };
    const encurtarEm = raiz => {
      if (raiz.nodeType !== 1) return;
      if (raiz.matches('a[href]')) encurtar(raiz);
      raiz.querySelectorAll('a[href]').forEach(encurtar);
    };
    document.addEventListener('DOMContentLoaded', () => {
      encurtarEm(document.body);
      new MutationObserver(mudancas => mudancas.forEach(m => {
        if (m.type === 'attributes') encurtar(m.target);
        else m.addedNodes.forEach(encurtarEm);
      })).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
    });
    // Garantia extra no clique (links que mudem de destino na hora)
    const noClique = evento => { const a = evento.target.closest && evento.target.closest('a[href]'); if (a) encurtar(a); };
    document.addEventListener('click', noClique, true);
    document.addEventListener('auxclick', noClique, true);
  }

  window.Sessao = {
    BASE: BASE.href,
    enderecoCurto,
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

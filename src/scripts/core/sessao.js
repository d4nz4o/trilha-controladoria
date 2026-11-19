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

  window.Sessao = {
    BASE: BASE.href,
    URL_LOGIN: new URL('index.html', BASE).href,
    URL_HUB: new URL('pages/hub/hub.html', BASE).href,
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

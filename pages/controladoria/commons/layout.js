// TOPBAR COMPARTILHADA + NAVEGAÇÃO RÁPIDA ENTRE PÁGINAS
// Para criar uma nova aba: adicione uma linha em PAGINAS e crie a página.

// Pasta da controladoria, calculada a partir deste arquivo (funciona em qualquer servidor)
const PASTA = new URL('../', document.currentScript.src).href.replace(/\/$/, '');
const URL_HUB = new URL('../../hub/hub.html', document.currentScript.src).href;   // logo leva ao início do hub
const URL_LOGO = new URL('../../../assets/images/logo-trilha.png', document.currentScript.src).href;

const PAGINAS = [
  { id: 'kanban',     rotulo: 'Tarefas',    url: PASTA + '/tarefas/tarefas.html',    acao: '+ Tarefa',
    recursos: ['../commons/popup.css', 'kanban.css', 'modal-tarefa.css', 'nova-tarefa.css', 'kanban.js', 'kanban-dnd.js', 'tarefa-modal.js', 'tarefa-interacoes.js', 'tarefa-tags.js', 'nova-tarefa.js'].map(a => `${PASTA}/tarefas/${a}`) },
  { id: 'equipe',     rotulo: 'Equipe',     url: PASTA + '/equipe/equipe.html',     acao: '+ Membro',
    recursos: [`${PASTA}/equipe/equipe.css`, `${PASTA}/equipe/equipe.js`] },
  { id: 'ferias',     rotulo: 'Férias',     url: PASTA + '/ferias/ferias.html',     acao: '+ Férias',
    recursos: [`${PASTA}/commons/popup.css`, `${PASTA}/ferias/ferias.css`, `${PASTA}/ferias/ferias.js`, `${PASTA}/ferias/nova-ferias.js`] },
  { id: 'automacoes', rotulo: 'Automações', url: PASTA + '/automacoes/automacoes.html', acao: '+ Robô',
    recursos: [`${PASTA}/automacoes/automacoes.css`, `${PASTA}/automacoes/automacoes.js`] },
];

// Mesmo padrão da barra das Demonstrações: logo | abas | ação, busca e perfil
function renderizarTopbar() {
  const el = document.getElementById('topbar');
  if (!el) return;
  const atual = PAGINAS.find(p => p.id === ABA_ATUAL_ID) || PAGINAS[0];

  el.innerHTML = `
    <div class="barra-topo-inner">
      <div class="barra-esquerda">
        <a class="marca-logo" href="${URL_HUB}" aria-label="Trilha Participações, início">
          <img src="${URL_LOGO}" alt="Trilha Participações" width="182" height="68">
        </a>
      </div>

      <nav class="abas" aria-label="Controladoria">
        ${PAGINAS.map(p => p.id === atual.id
          ? `<a aria-current="page">${p.rotulo}</a>`
          : `<a href="${p.url}">${p.rotulo}</a>`).join('')}
      </nav>

      <div class="barra-direita">
        <button type="button" id="btn-acao-contextual" class="btn-action-highlight" onclick="executarAcaoAba()">${atual.acao}</button>
        <input type="search" id="campoBusca" class="search-input" placeholder="Buscar…" aria-label="Buscar" oninput="filtrarBusca(this.value)">
        <div class="user-profile-container" id="userProfileContainer">
          <div class="user-profile-avatar" id="userProfileAvatar" onclick="alternarMenuUsuario(event)"><span id="userAvatarText">?</span></div>
          <div class="user-dropdown-menu" id="userDropdownMenu">
            <div class="dropdown-header">
              <strong id="dropdownUserName">Usuário</strong>
              <span id="dropdownUserEmail">email@triviatrens.com.br</span>
            </div>
            <div class="dropdown-divider"></div>
            <button class="dropdown-item btn-logout" onclick="fazerLogout()">Desconectar</button>
          </div>
        </div>
      </div>
    </div>`;
}

function executarAcaoAba() {
  if (abaAtual === 'kanban') abrirModalNovaTarefa();
  else if (abaAtual === 'ferias') abrirModalNovasFerias();
  else if (abaAtual === 'equipe') alert('Em breve: cadastro de novos membros da equipe.');
  else if (abaAtual === 'automacoes') alert('Em breve: cadastro de novas automações.');
}

// Pré-carrega as outras abas para a troca ser quase instantânea
function prepararNavegacao() {
  const outras = PAGINAS.filter(p => p.id !== ABA_ATUAL_ID);

  // Chrome/Edge: pré-renderiza a página ao passar o mouse sobre a aba
  if (window.HTMLScriptElement && HTMLScriptElement.supports && HTMLScriptElement.supports('speculationrules')) {
    const s = document.createElement('script');
    s.type = 'speculationrules';
    s.textContent = JSON.stringify({ prerender: [{ urls: outras.map(p => p.url), eagerness: 'moderate' }] });
    document.head.appendChild(s);
  }

  // Todos os navegadores: baixa em segundo plano o CSS/JS das outras abas (e o HTML, se não houver prerender)
  const baixar = () => {
    const prerender = document.querySelector('script[type="speculationrules"]');
    outras.forEach(p => {
      const urls = prerender ? p.recursos : [p.url, ...p.recursos];
      urls.forEach(u => { const l = document.createElement('link'); l.rel = 'prefetch'; l.href = u; document.head.appendChild(l); });
    });
  };
  (window.requestIdleCallback || (f => setTimeout(f, 800)))(baixar);

  // Antes de trocar de aba, grava o que ainda estiver pendente (ex.: card arrastado)
  document.addEventListener('click', async e => {
    const a = e.target.closest('.barra-topo a[href]');
    if (!a || typeof flushPendentes !== 'function') return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    if (Object.keys(pendentesSupabase).length === 0) return;
    e.preventDefault();
    await flushPendentes();
    window.location.href = a.href;
  });
}

renderizarTopbar();
prepararNavegacao();

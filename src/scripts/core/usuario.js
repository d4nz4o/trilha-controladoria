// PERFIL DO USUÁRIO (avatar + menu) & LOGOUT
// Toda barra superior (.barra-topo-inner) ganha o avatar no canto direito; a controladoria monta o dela
// com htmlPerfilUsuario() (commons/layout.js). Estilo: src/styles/perfil-usuario.css. Nome, e-mail e foto: main.js.

function htmlPerfilUsuario() {
  return `
    <div class="user-profile-container" id="userProfileContainer">
      <div class="user-profile-avatar" id="userProfileAvatar" role="button" tabindex="0" aria-label="Menu do usuário"
           aria-haspopup="true" onclick="alternarMenuUsuario(event)"
           onkeydown="if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); alternarMenuUsuario(event); }">
        <span id="userAvatarText">?</span>
      </div>
      <div class="user-dropdown-menu" id="userDropdownMenu">
        <div class="dropdown-header">
          <strong id="dropdownUserName">Usuário</strong>
          <span id="dropdownUserEmail"></span>
        </div>
        <div class="dropdown-divider"></div>
        <button type="button" class="dropdown-item btn-logout" onclick="fazerLogout()">Desconectar</button>
      </div>
    </div>`;
}

(() => {
  // Estilo comum do perfil (uma vez por página)
  const css = new URL('../../styles/perfil-usuario.css', document.currentScript.src).href;
  if (![...document.querySelectorAll('link[rel="stylesheet"]')].some(l => l.href === css)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = css;
    document.head.appendChild(link);
  }
  // Barras estáticas (demonstrações, controles): insere o avatar se ainda não houver
  const barra = document.querySelector('.barra-topo-inner');
  if (barra && !document.getElementById('userProfileContainer')) {
    const lugar = document.createElement('div');
    lugar.className = 'barra-perfil';
    lugar.innerHTML = htmlPerfilUsuario();
    barra.appendChild(lugar);
  }
})();

function alternarMenuUsuario(event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById('userDropdownMenu');
  if (menu) {
    menu.classList.toggle('active');
  }
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') document.getElementById('userDropdownMenu')?.classList.remove('active');
});

document.addEventListener('click', (event) => {
  const container = document.getElementById('userProfileContainer');
  const menu = document.getElementById('userDropdownMenu');
  if (container && menu && !container.contains(event.target)) {
    menu.classList.remove('active');
  }
});

async function fazerLogout() {
  if (sbClient) {
    // scope "local": desconecta só este navegador, sem derrubar o usuário em outros aparelhos
    await sbClient.auth.signOut({ scope: 'local' });
  }
  Cache.limparTudo();
  window.location.href = Sessao.URL_LOGIN;
}

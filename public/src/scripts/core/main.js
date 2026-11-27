// INICIALIZAÇÃO: valida a sessão, libera a página (Sessao.confirmar), preenche o perfil e chama iniciarPagina()

// Pergunta ao banco a situação do usuário (supabase/11_acesso_somente_cadastrados.sql):
// 'liberado' | 'sem_cadastro' | 'inativo' | 'dominio'. Conferida a CADA página aberta (sem guardar no navegador),
// para quem perder o acesso não continuar navegando. Se a verificação falhar por outro motivo (rede), não bloqueia:
// o banco continua protegendo os dados.
async function situacaoDoAcesso() {
  let { data, error } = await sbClient.rpc('situacao_acesso');
  if (error) {
    // Banco ainda sem a função nova: usa a regra antiga (verdadeiro/falso)
    const antiga = await sbClient.rpc('usuario_corporativo');
    if (antiga.error) return 'liberado';
    data = antiga.data === false ? 'inativo' : 'liberado';
  }
  return data || 'liberado';
}

/* ---------- Permissões por grupo de acesso (supabase/18_aplicar_grupos.sql) ----------
   Uma chamada por página (minhas_permissoes) traz a situação do acesso e o nível do grupo em cada recurso.
   - Página de um recurso que o grupo não vê: volta ao hub com um aviso.
   - Elementos com data-recurso="a b" só aparecem para quem vê algum desses recursos;
     data-editar="a b", só para quem edita algum deles (vale também para o que for desenhado depois).
   - Sem o script 18 no banco (recursos = null), tudo fica liberado, como antes.
   A proteção de verdade está nas regras do banco; aqui é a experiência na tela. */
const Permissoes = {
  recursos: null,
  grupo: null,
  todasEmpresas: true,   // empresa da pessoa é holding (vê todas); sem o script 19, todas
  empresas: null,        // códigos das empresas visíveis (null = todas)
  veEmpresa(codigo) { return this.todasEmpresas || !this.empresas || this.empresas.map(String).includes(String(codigo)); },
  nivel(r) { return this.recursos ? (this.recursos[r] || 'nao_ver') : 'editar'; },
  podeVer(r) { return ['ver', 'editar'].includes(this.nivel(r)); },
  podeEditar(r) { return this.nivel(r) === 'editar'; },
  algumVer(lista) { return String(lista).split(/\s+/).filter(Boolean).some(r => this.podeVer(r)); },
  algumEditar(lista) { return String(lista).split(/\s+/).filter(Boolean).some(r => this.podeEditar(r)); },
  // Formulário só para leitura para quem não edita o recurso (campos visíveis, sem alteração). Devolve true se travou.
  travar(el, recurso) {
    if (!el) return false;
    const travar = !this.podeEditar(recurso);
    el.classList.toggle('somente-leitura', travar);
    el.querySelectorAll('input, select, textarea').forEach(c => {
      if (travar) { if (!c.disabled) { c.disabled = true; c.dataset.travadoPermissao = '1'; } }
      else if (c.dataset.travadoPermissao) { c.disabled = false; delete c.dataset.travadoPermissao; }
    });
    return travar;
  },
};
window.Permissoes = Permissoes;

// Recurso exigido por página (caminho real da página; nas rotas curtas, vem do <base>)
const RECURSOS_DA_PAGINA = [
  [/\/pages\/demonstracoes\//, 'demonstracoes', 'Demonstrações'],
  [/\/pages\/controles\//, 'controle_ativos', 'Controle de ativos'],
  [/\/pages\/controladoria\/(tarefas|painel)\//, 'tarefas', 'Tarefas e painel'],
  [/\/pages\/controladoria\/(ferias|equipe)\//, 'ferias_equipe', 'Férias e equipe'],
  [/\/pages\/controladoria\/automacoes\//, 'automacoes', 'Automações'],
  [/\/pages\/configuracao\//, 'cad_colaboradores cad_empresas grupos_acesso', 'Configurações'],
];

async function carregarPermissoes() {
  const { data, error } = await sbClient.rpc('minhas_permissoes');
  if (error || !data) return { situacao: await situacaoDoAcesso(), recursos: null, grupo: null };   // banco sem o script 18
  return data;
}

function aplicarPermissoes(raiz) {
  if (!raiz || !raiz.querySelectorAll) return;
  // data-todas-empresas: só para quem vê todas as empresas (ex.: visão Consolidada)
  const marcar = el => {
    const ver = el.dataset.recurso ? Permissoes.algumVer(el.dataset.recurso) : true;
    const editar = el.dataset.editar ? Permissoes.algumEditar(el.dataset.editar) : true;
    const empresas = el.dataset.todasEmpresas !== undefined ? Permissoes.todasEmpresas : true;
    el.classList.toggle('sem-permissao', !(ver && editar && empresas));
  };
  const seletor = '[data-recurso],[data-editar],[data-todas-empresas]';
  if (raiz.matches && raiz.matches(seletor)) marcar(raiz);
  raiz.querySelectorAll(seletor).forEach(marcar);
}

function avisoPermissao(texto) {
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.textContent = texto;
  el.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:3000;padding:10px 18px;' +
    'border-radius:10px;background:#15385e;color:#fff;font:500 .86rem/1.4 Inter,system-ui,sans-serif;' +
    'box-shadow:0 10px 28px -8px rgba(21,56,94,.45);max-width:90vw;text-align:center';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

// Situação -> código de erro mostrado na tela de login
const ERRO_DA_SITUACAO = { sem_cadastro: 'acesso_nao_liberado', inativo: 'acesso_inativo', dominio: 'dominio_invalido' };

// Encerra a sessão e volta ao login com o aviso da situação. Usada aqui e pela fonte de dados,
// quando o banco recusa os dados de uma página já aberta.
async function bloquearAcesso(situacao) {
  try { await sbClient.auth.signOut(); } catch (e) { /* segue para o login mesmo assim */ }
  Cache.limparTudo();
  window.location.href = Sessao.URL_LOGIN + "?erro=" + (ERRO_DA_SITUACAO[situacao] || 'acesso_nao_liberado');
}

document.addEventListener("DOMContentLoaded", async () => {
  if (typeof sbClient === 'undefined' || !sbClient) { window.location.href = Sessao.URL_LOGIN; return; }

  // getSession lê a sessão guardada no navegador (não faz chamada de rede)
  const { data: { session }, error } = await sbClient.auth.getSession();
  if (error || !session) { window.location.href = Sessao.URL_LOGIN; return; }

  const user = session.user;
  const email = user?.email || "";

  if (!emailCorporativo(email)) {
    await sbClient.auth.signOut();
    Cache.limparTudo();
    window.location.href = Sessao.URL_LOGIN + "?erro=dominio_invalido";
    return;
  }

  // Só entra quem tem cadastro ATIVO em colaboradores; e cada página confere o grupo de acesso.
  // Tudo numa chamada ao banco, a cada página aberta.
  const permissoes = await carregarPermissoes();
  if (permissoes.situacao !== 'liberado') { await bloquearAcesso(permissoes.situacao); return; }
  Permissoes.recursos = permissoes.recursos;
  Permissoes.grupo = permissoes.grupo;
  Permissoes.todasEmpresas = permissoes.todas_empresas ?? true;
  Permissoes.empresas = permissoes.empresas ?? null;

  const caminho = new URL(document.baseURI).pathname;
  const exigido = RECURSOS_DA_PAGINA.find(([padrao]) => padrao.test(caminho));
  if (exigido && !Permissoes.algumVer(exigido[1])) {
    window.location.replace(Sessao.URL_HUB + '?sem_acesso=' + encodeURIComponent(exigido[2]));
    return;
  }
  const estilo = document.createElement('style');
  estilo.textContent = '.sem-permissao{display:none!important}' +
    // Formulários travados: o que for desenhado depois de abrir também fica sem clique
    '.somente-leitura :is(input,select,textarea,button):not(.btn-close-modal):not(.modal-close-btn):not([data-sempre-ativo])' +
    '{pointer-events:none!important;opacity:.6}';
  document.head.appendChild(estilo);
  aplicarPermissoes(document);
  new MutationObserver(mudancas => mudancas.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) aplicarPermissoes(n); })))
    .observe(document.body, { childList: true, subtree: true });

  lembrarEmailLogin(email);   // sugerido ao provedor no próximo login
  Sessao.confirmar(user);

  const avatarUrl = user?.user_metadata?.avatar_url || user?.user_metadata?.picture;
  const nomeUsuario = user?.user_metadata?.full_name || user?.user_metadata?.name || email;
  const nameElem = document.getElementById('dropdownUserName');
  const emailElem = document.getElementById('dropdownUserEmail');
  const avatarElem = document.getElementById('userProfileAvatar');

  if (nameElem) nameElem.innerText = nomeUsuario;
  if (emailElem) emailElem.innerText = email;
  if (avatarElem) {
    avatarElem.title = `${nomeUsuario} (${email})`;
    if (avatarUrl) {
      avatarElem.innerHTML = `<img src="${avatarUrl}" alt="" referrerpolicy="no-referrer">`;
    } else {
      avatarElem.innerHTML = `<span>${nomeUsuario.charAt(0).toUpperCase()}</span>`;
    }
  }

  // Avisos do hub: voltou de uma área sem acesso, ou o grupo ainda não libera nada
  const semAcesso = new URLSearchParams(location.search).get('sem_acesso');
  if (semAcesso) {
    avisoPermissao(`Seu grupo de acesso não libera "${semAcesso}". Fale com a Controladoria se precisar.`);
    history.replaceState(history.state, '', location.pathname + location.hash);
  } else if (Permissoes.recursos && /\/hub/.test(caminho) && !Object.values(Permissoes.recursos).some(n => n !== 'nao_ver')) {
    avisoPermissao('Seu grupo de acesso ainda não libera nenhuma área do portal. Fale com a Controladoria.');
  }

  if (typeof iniciarPagina === "function") iniciarPagina(user);
});

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

  // Só entra quem tem cadastro ATIVO em colaboradores (a mesma regra vale no banco). Verificado a cada página.
  const situacao = await situacaoDoAcesso();
  if (situacao !== 'liberado') { await bloquearAcesso(situacao); return; }

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

  if (typeof iniciarPagina === "function") iniciarPagina(user);
});

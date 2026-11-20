// INICIALIZAÇÃO: valida a sessão, libera a página (Sessao.confirmar), preenche o perfil e chama iniciarPagina()

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

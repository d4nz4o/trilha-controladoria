// CACHE + CARGA DE DADOS (stale-while-revalidate)
// Mostra na hora o que já foi baixado nesta sessão e atualiza em segundo plano.

const Cache = {
  ler(k) { try { return JSON.parse(sessionStorage.getItem('trilha:' + k)); } catch { return null; } },
  gravar(k, v) { try { sessionStorage.setItem('trilha:' + k, JSON.stringify(v)); } catch {} },
  limpar(k) { try { sessionStorage.removeItem('trilha:' + k); } catch {} },
  limparTudo() {
    try { Object.keys(sessionStorage).filter(k => k.startsWith('trilha:')).forEach(k => sessionStorage.removeItem(k)); } catch {}
  }
};

async function swr(chave, consulta, aoDados) {
  const emCache = Cache.ler(chave);
  if (emCache) aoDados(emCache);
  try {
    const { data, error } = await consulta();
    if (error) { console.error(`Erro ao carregar ${chave}:`, error.message); return; }
    const novo = data || [];
    if (JSON.stringify(novo) !== JSON.stringify(emCache)) {
      Cache.gravar(chave, novo);
      aoDados(novo);
    }
  } catch (err) {
    console.error(`Falha de rede ao carregar ${chave}:`, err);
  }
}

// Colaboradores são usados nas páginas Equipe e Férias
// Colaboradores com o nome da equipe (equipes.nome_equipe). Se o banco ainda não tiver a tabela de equipes
// (supabase/10_equipes_e_situacao.sql), carrega só os colaboradores.
async function carregarColaboradoresDados(aoAtualizar) {
  if (!sbClient) return;
  await swr('colaboradores',
    async () => {
      const comEquipe = await sbClient.from('colaboradores').select('*, equipes(nome_equipe)').order('nome_colab', { ascending: true });
      return comEquipe.error ? sbClient.from('colaboradores').select('*').order('nome_colab', { ascending: true }) : comEquipe;
    },
    d => { listaColaboradores = d; if (aoAtualizar) aoAtualizar(); });
}

// Só os ativos (esta_ativo = false sai das listas de escolha; o cadastro continua no histórico)
function colaboradoresAtivos() {
  return (typeof listaColaboradores === 'undefined' ? [] : listaColaboradores).filter(c => c.esta_ativo !== false);
}

// Colaborador (tabela colaboradores) do usuário logado: pelo id_auth; se não houver, pelo e-mail.
// Usado como autor de comentários, anexos, histórico e criador de tarefas.
function identificarColaboradorLogado() {
  const u = window.Sessao && Sessao.usuario;
  if (!u || typeof listaColaboradores === 'undefined' || !listaColaboradores.length) return null;
  const email = (u.email || '').toLowerCase();
  colaboradorLogado = listaColaboradores.find(c => c.id_auth && c.id_auth === u.id)
    || listaColaboradores.find(c => (c.email_colab || '').toLowerCase() === email)
    || null;
  return colaboradorLogado;
}

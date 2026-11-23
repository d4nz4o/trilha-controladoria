/*
  FONTE DE DADOS DO PORTAL
  Carregado SEM defer no <head> (depois do sessao.js), para já existir quando os scripts das páginas rodarem.

  Demonstrações (BP e DR): lidas do Supabase (tabelas em supabase/03 e 04_*.sql), só por usuários logados.
  As linhas são devolvidas no formato de planilha que as páginas esperam: a primeira linha é o cabeçalho
  e os valores vêm como texto ("1234,56", "aaaa-mm-dd"), como nos CSVs de origem em /dados.

  Controle de ativos: ativos.json e peps.json (formato próprio), no bucket privado "dados" do Supabase Storage
  (supabase/02_storage_dados.sql), só para usuários logados com e-mail corporativo. Não ficam no site.
*/

(() => {
  const POR_PAGINA = 1000;   // a API do Supabase devolve no máximo 1000 linhas por consulta
  const BUCKET = 'dados';

  // colunas: [coluna no Supabase, cabeçalho devolvido, tipo, extrator opcional]
  //   extrator: lê valores de tabelas ligadas (ex.: nome do colaborador em colaboradores(nome_colab))
  //   tipo: 'texto' | 'numero' (vira "1234,56") | 'data' (vira "aaaa-mm-dd") | 'datahora' (vira "dd/mm/aaaa hh:mm:ss")
  const TABELAS = {
    balancetes: {
      tabela: 'balancetes',
      ordenarPor: 'id_balancete',
      colunas: [
        ['id_empresa', 'Empresa', 'texto'],
        ['periodo_balancete', 'Período', 'data'],
        ['numero_conta', 'Conta contábil', 'texto'],
        ['montante_balancete', 'Montante', 'numero'],
      ],
    },
    // Plano de contas único, com a classificação de cada conta (pela ligação com classificacoes)
    classificacao: {
      tabela: 'contas_contabeis',
      ordenarPor: 'id_conta',
      colunas: [
        ['numero_conta', 'Conta contábil', 'texto'],
        ['desc_conta', 'Descrição conta', 'texto'],
        ['classificacoes(nivel1,nivel2,nivel3)', 'Classificação Nv1', 'texto', reg => reg.classificacoes && reg.classificacoes.nivel1],
        ['classificacoes(nivel1,nivel2,nivel3)', 'Classificação Nv2', 'texto', reg => reg.classificacoes && reg.classificacoes.nivel2],
        ['classificacoes(nivel1,nivel2,nivel3)', 'Classificação Nv3', 'texto', reg => reg.classificacoes && reg.classificacoes.nivel3],
        ['id_empresa_contraparte', 'contraparte', 'texto'],
      ],
    },
    empresas: {
      tabela: 'empresas',
      ordenarPor: 'id_empresa',
      colunas: [
        ['id_empresa', 'Empresa', 'texto'],
        ['nome_empresa', 'Nome', 'texto'],
        ['metodo_consolidacao', 'metodo_consolidacao', 'texto'],
        ['percentual_participacao', 'percentual_participacao', 'numero'],
        ['classificacao_empresa', 'classificacao', 'numero'],
      ],
    },
    // Linhas das demonstrações e ordem de exibição
    hierarquia: {
      tabela: 'classificacoes',
      ordenarPor: 'id_classificacao',
      colunas: [
        ['nivel1', 'Classificação Nv1', 'texto'],
        ['nivel2', 'Classificação Nv2', 'texto'],
        ['nivel3', 'Classificação Nv3', 'texto'],
        ['ordem_nivel1', 'Ordem Nv1', 'numero'],
        ['ordem_nivel2', 'Ordem Nv2', 'numero'],
        ['ordem_nivel3', 'Ordem Nv3', 'numero'],
      ],
    },
    // Comentários da revisão analítica (BP e DR). Autor = colaborador; o nome vem de colaboradores.
    comentarios: {
      tabela: 'revisoes_comentarios',
      ordenarPor: 'criado_em',
      colunas: [
        ['id_empresa', 'Empresa', 'texto'],
        ['mes_atual', 'Mês atual', 'data'],
        ['nivel1', 'Classificação Nv1', 'texto'],
        ['nivel2', 'Classificação Nv2', 'texto'],
        ['nivel3', 'Classificação Nv3', 'texto'],
        ['mensagem', 'Comentário', 'texto'],
        ['id_comentario', 'Id comentário', 'numero'],
        ['id_colab', 'Id colaborador', 'numero'],
        ['colaboradores(nome_colab)', 'Autor', 'texto', reg => reg.colaboradores && reg.colaboradores.nome_colab],
        ['criado_em', 'Data/hora', 'datahora'],
      ],
    },
  };

  // Controle de ativos: caminho de cada arquivo no bucket privado "dados"
  const ARQUIVOS = {
    ativos: 'controles/ativos.json',
    peps: 'controles/peps.json',
  };

  /* ---------- Auxiliares ---------- */

  function definicao(mapa, nome) {
    const f = mapa[nome];
    if (!f) throw new Error(`Fonte de dados desconhecida: "${nome}".`);
    return f;
  }

  // Espera o login ser confirmado (main.js) e devolve o cliente do Supabase
  async function cliente() {
    await window.Sessao.pronta;
    if (typeof sbClient === 'undefined' || !sbClient) throw new Error('Supabase indisponível.');
    return sbClient;
  }

  const FORMATO_BRASILIA = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });

  function converter(valor, tipo) {
    if (valor === null || valor === undefined) return '';
    if (tipo === 'numero') return Number(valor).toLocaleString('pt-BR', { useGrouping: false, maximumFractionDigits: 10 });
    if (tipo === 'data') return String(valor).slice(0, 10);
    if (tipo === 'datahora') {
      // Sempre no horário de Brasília, qualquer que seja o fuso do computador
      const d = new Date(valor);
      if (isNaN(d)) return String(valor);
      const p = Object.fromEntries(FORMATO_BRASILIA.formatToParts(d).map(x => [x.type, x.value]));
      return `${p.day}/${p.month}/${p.year} ${p.hour === '24' ? '00' : p.hour}:${p.minute}:${p.second}`;
    }
    return String(valor);
  }

  // Lê a tabela inteira em páginas de 1000 linhas: a 1ª informa o total; as demais vêm em paralelo
  async function lerDaTabela(f) {
    const sb = await cliente();
    const selecao = [...new Set(f.colunas.map(c => c[0]))].join(',');   // a mesma ligação pode servir a várias colunas
    const pagina = (inicio, contar) => sb.from(f.tabela)
      .select(selecao, contar ? { count: 'exact' } : undefined)
      .order(f.ordenarPor, { ascending: true })
      .range(inicio, inicio + POR_PAGINA - 1);

    const primeira = await pagina(0, true);
    if (primeira.error) throw new Error(`Tabela ${f.tabela}: ${primeira.error.message}`);
    const total = primeira.count ?? (primeira.data || []).length;
    const inicios = [];
    for (let inicio = POR_PAGINA; inicio < total; inicio += POR_PAGINA) inicios.push(inicio);
    const demais = await Promise.all(inicios.map(inicio => pagina(inicio, false)));
    const falha = demais.find(r => r.error);
    if (falha) throw new Error(`Tabela ${f.tabela}: ${falha.error.message}`);

    if (total === 0) await explicarTabelaVazia(sb, f);

    const linhas = [f.colunas.map(c => c[1])];
    [primeira, ...demais].forEach(r => (r.data || []).forEach(reg =>
      linhas.push(f.colunas.map(([col, , tipo, extrator]) => converter(extrator ? extrator(reg) : reg[col], tipo)))));
    return linhas;
  }

  /*
    Tabela sem linhas: pode estar realmente vazia ou a regra de acesso (RLS) pode ter escondido as linhas
    (o Supabase não dá erro nesse caso). Pergunta ao banco se o usuário passa na regra para explicar a causa.
  */
  async function explicarTabelaVazia(sb, f) {
    const email = (window.Sessao && Sessao.usuario && Sessao.usuario.email) || '';
    const { data: liberado, error } = await sb.rpc('usuario_corporativo');
    if (error) {
      throw new Error(`A tabela ${f.tabela} veio vazia e não foi possível verificar a regra de acesso ` +
                      `(função usuario_corporativo: ${error.message}). Confira se o supabase/01_acesso.sql foi executado.`);
    }
    if (liberado === false) {
      // Usuário barrado pelo banco (sem cadastro, inativo…): volta ao login com o aviso da situação
      if (typeof bloquearAcesso === 'function') {
        const { data: situacao } = await sb.rpc('situacao_acesso');
        await bloquearAcesso(situacao || 'sem_cadastro');
        await new Promise(() => {});   // a página está sendo trocada; não segue com a carga
      }
      throw new Error(`O acesso do usuário ${email} não foi liberado (cadastro em colaboradores ausente ou inativo).`);
    }
    throw new Error(`A tabela ${f.tabela} está vazia no Supabase (o usuário ${email} tem acesso). ` +
                    `Confira se a importação foi feita nesse projeto e nessa tabela.`);
  }

  async function baixarArquivo(caminho) {
    const sb = await cliente();
    const { data, error } = await sb.storage.from(BUCKET).download(caminho);
    if (error) throw new Error(`Arquivo ${BUCKET}/${caminho} no Supabase Storage: ${error.message || 'não encontrado'}`);
    return data.text();
  }


  /* ---------- Colaborador do usuário logado ---------- */

  // Mesmo critério das regras do banco (função id_colab_usuario: por id_auth ou e-mail).
  // Devolve { id_colab, nome_colab } ou null se o usuário não estiver em colaboradores.
  let promessaColaborador = null;

  async function buscarColaborador() {
    const sb = await cliente();
    const { data: id, error } = await sb.rpc('id_colab_usuario');
    if (error) throw new Error(error.message);
    if (id === null || id === undefined) return null;
    const r = await sb.from('colaboradores').select('id_colab, nome_colab').eq('id_colab', id).maybeSingle();
    if (r.error) throw new Error(r.error.message);
    return r.data || null;
  }

  /* ---------- API pública ---------- */

  window.FonteDados = {
    // Nome da tabela no Supabase (para mensagens)
    rotulo(nome) { return `tabela ${definicao(TABELAS, nome).tabela}`; },

    // Demonstrações: devolve [cabeçalho, ...linhas]
    lerTabela(nome) { return lerDaTabela(definicao(TABELAS, nome)); },

    // Controle de ativos
    async lerJSON(nome) { return JSON.parse(await baixarArquivo(definicao(ARQUIVOS, nome))); },

    colaboradorLogado() {
      promessaColaborador = promessaColaborador || buscarColaborador().catch(erro => { promessaColaborador = null; throw erro; });
      return promessaColaborador;
    },

    // Altera os registros em que todas as colunas de "onde" batem. Sem linha alterada = sem permissão (RLS)
    async atualizar(nome, onde, valores) {
      const f = definicao(TABELAS, nome);
      const sb = await cliente();
      let consulta = sb.from(f.tabela).update(valores);
      Object.entries(onde).forEach(([coluna, valor]) => { consulta = consulta.eq(coluna, valor); });
      const { data, error } = await consulta.select();
      if (error) throw new Error(`Não foi possível alterar em ${f.tabela}: ${error.message}`);
      if (!data || !data.length) throw new Error('A alteração não foi permitida (apenas o autor pode editar o próprio comentário).');
      return data;
    },

    // Apaga os registros em que todas as colunas de "onde" batem. Sem linha apagada = sem permissão (RLS)
    async excluir(nome, onde) {
      const f = definicao(TABELAS, nome);
      const sb = await cliente();
      let consulta = sb.from(f.tabela).delete();
      Object.entries(onde).forEach(([coluna, valor]) => { consulta = consulta.eq(coluna, valor); });
      const { data, error } = await consulta.select();
      if (error) throw new Error(`Não foi possível excluir em ${f.tabela}: ${error.message}`);
      if (!data || !data.length) throw new Error('A exclusão não foi permitida (apenas o autor pode excluir o próprio comentário).');
      return data;
    },

    async inserir(nome, registro) {
      const f = definicao(TABELAS, nome);
      const sb = await cliente();
      const { error } = await sb.from(f.tabela).insert(registro);
      if (error) throw new Error(`Não foi possível gravar em ${f.tabela}: ${error.message}`);
    },
  };
})();

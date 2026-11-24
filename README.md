# Portal da Controladoria · Trilha Participações

Site estático (Vercel) com login e dados no Supabase. A raiz publicada é `public/` (`outputDirectory` no `vercel.json`).
Os caminhos são **relativos**, então o portal funciona em qualquer servidor: Vercel, Live Server ou `python -m http.server`.
As URLs curtas do `vercel.json` (`/hub`, `/bp`, `/tarefas`…) são **reescritas**: a barra mostra a rota curta. Na publicação,
o passo de build `scripts/vercel-rotas-curtas.mjs` (`buildCommand`) põe em cada página um `<base>` com o endereço real,
para os caminhos relativos funcionarem a partir da rota curta; no site publicado, os links internos abrem pela rota curta
(`ROTAS_CURTAS` em `src/scripts/core/sessao.js`, que deve ficar igual ao `vercel.json`). Localmente nada disso é usado.

```
public/                          tudo o que é publicado no site
├─ index.html                    login (Google / Microsoft, só e-mails corporativos do grupo)
├─ assets/                       logos e favicon
├─ src/styles/perfil-usuario.css   estilo do avatar e do menu do usuário (todas as barras)
├─ src/scripts/
│  ├─ core/                      usado por TODAS as páginas protegidas
│  │  ├─ sessao.js               esconde a página até o login ser confirmado; expõe Sessao (usuário, nome)
│  │  ├─ supabase.js             conexão (sbClient) e domínios aceitos
│  │  ├─ main.js                 valida sessão e domínio, libera a página, chama iniciarPagina(user)
│  │  ├─ inatividade.js          desliga após 2 h sem uso (aviso 60 s antes), sincronizado entre abas
│  │  ├─ usuario.js              avatar e menu do usuário em toda barra superior, fazerLogout()
│  │  └─ dados.js                cache da sessão (Cache, swr) e colaborador logado
│  └─ services/
│     └─ fonte-dados.js          leitura do Supabase (tabelas das demonstrações e arquivos do controle de ativos no Storage)
└─ pages/
   ├─ hub/                       hub (vistas: demonstrações, controle de ativos, controladoria)
   ├─ controladoria/             tarefas, equipe, férias, automações (tabelas próprias no Supabase)
   ├─ demonstracoes/             BP, DR (DMPL e DFC ainda em construção)
   │  ├─ commons.css · commons.js   tabela por níveis, visões, eliminações, contas, revisão analítica
   │  ├─ indicadores.js          coluna de indicadores (visão por empresa)
   │  └─ exportar.js             botão "Exportar planilha"
   └─ controles/                 Composição geral, Analítico, PEPs, Ordens de investimento (módulos ES)

dados/                           NÃO publicada nem enviada ao GitHub: demonstracoes/ (fontes das cargas do Supabase)
                                 e controles/ (cópias de ativos.json e peps.json, que ficam no Storage)
supabase/                        SQL do banco, na ordem dos números
scripts/                         extrair_balancetes_xlsx.py · preparar_dados_supabase.py
```

Planejado: `public/commons/` (base visual compartilhada entre os módulos).

## Regras de uso

- Use caminhos relativos (nada começando com `/`). Toda página protegida carrega no `<head>`, nesta ordem: `sessao.js` e
  `fonte-dados.js` **sem** `defer`, depois a biblioteca do Supabase, `supabase.js`, `dados.js`, `usuario.js`,
  `inatividade.js` e `main.js` **com** `defer`. Copie o bloco de qualquer página de `demonstracoes/` ou `controles/`.
- Cada página carrega o `commons.css`/`commons.js` do seu módulo. Nada importa de outro módulo, exceto
  `src/scripts/core` e `src/scripts/services`, que são globais.
- `demonstracoes/` e `controladoria/` usam scripts clássicos; `controles/` usa módulos ES, que leem por `window.FonteDados`.
- Página nova da controladoria: adicione uma linha em `PAGINAS` (`controladoria/commons/layout.js`) e crie a página.

## Demonstrações: dados no Supabase

| Tabela | Conteúdo | Ligações |
|---|---|---|
| `empresas` | `id_empresa` (= código SAP), `nome_empresa`, `metodo_consolidacao` (integral · proporcional · fora), `percentual_participacao`, `classificacao_empresa` (ordem lado a lado) | — |
| `classificacoes` | linhas do BP/DR: `nivel1..3` e `ordem_nivel1..3` | — |
| `contas_contabeis` | plano de contas único: `numero_conta`, `desc_conta` | `id_classificacao` → `classificacoes` (vazio = sem classificação); `id_empresa_contraparte` → `empresas` (saldo com empresa do grupo, eliminado no consolidado) |
| `balancetes` | saldos acumulados: `periodo_balancete` (último dia do mês), `montante_balancete` | `id_empresa` → `empresas`; `numero_conta` → `contas_contabeis` |
| `revisoes_comentarios` | revisão analítica: `nivel1..3`, `mensagem`, `criado_em` | `id_empresa` → `empresas`; `id_colab` → `colaboradores` |

Só usuários logados com e-mail corporativo leem (RLS). O `supabase/06_acesso_todas_tabelas.sql` aplica a mesma exigência
a **todas** as tabelas do banco (regra restritiva "somente e-mail corporativo") e dá acesso completo às tabelas da
controladoria; rode-o de novo sempre que criar uma tabela nova. Nas regras, a função é sempre chamada como
`(select public.usuario_corporativo())`, para rodar uma vez por consulta e não uma vez por linha — sem isso, o
carregamento das demonstrações leva ~20 s (bancos criados antes desta versão: rode `supabase/07_regras_rapidas.sql`). O banco recusa saldo de empresa ou conta não cadastrada, o mesmo
mês importado duas vezes, conta classificada numa linha inexistente e comentário em nome de outra pessoa.
O autor dos comentários é o colaborador logado (tabela `colaboradores`, por `id_auth` ou e-mail); quem não está
cadastrado não comenta. Cada autor pode editar o texto (lápis) e excluir (lixeira, com confirmação) os próprios
comentários; regras em `supabase/08_editar_comentarios.sql` e `supabase/09_excluir_comentarios.sql`.

### Visões

- **Por empresa:** três meses até o selecionado, com as variações e a coluna de indicadores.
- **Consolidada (contábil):** controladas (`integral`) com 100% das linhas; a parte dos outros sócios aparece em
  "Participação de não controladores" (BP) e "Atribuível a não controladores" (DR). `fora` (ex.: VDMG) só aparece por
  empresa; `proporcional` (controle conjunto) entra pela participação.
- **Eliminações** (BP e DR): contas com contraparte, quando as duas empresas estão no consolidado.
- No BP, o resultado do ano entra no PL ("Resultado do período") e a linha de conferência mostra ✓ quando fecha.

### Rotina mensal

1. **Extrair os balancetes** dos `EMPRESA_BP_DRE_MM_AAAA.xlsx` do mês (e dos relatórios comparativos do SAP, como os da
   TIC), todos numa pasta, **um arquivo por empresa**:
   `python scripts/extrair_balancetes_xlsx.py PASTA 2026 --integrar`
   O script confere se cada mês fecha, avisa contas sem classificação e atualiza `dados/demonstracoes/balancetes.csv`.
   O código SAP de cada arquivo fica em `CODIGOS`, no início do script.
2. **Contas novas:** inclua em `dados/demonstracoes/classificacao.csv` e cadastre em `contas_contabeis` pelo painel do
   Supabase (com `id_classificacao` e, se for saldo com empresa do grupo, `id_empresa_contraparte`).
3. **Gerar a carga do mês:** `python scripts/preparar_dados_supabase.py --a-partir 2026-11`
   (gera `scripts/saida/balancetes_a_partir_2026-11.csv` e confere as ligações antes).
4. **Importar** no Supabase (Table Editor › `balancetes` › Import data from CSV). Para reprocessar meses já carregados,
   apague-os antes: `delete from public.balancetes where periodo_balancete >= '2026-11-01';`

Sem `--a-partir`, o script de preparação gera a carga completa de todas as tabelas (usada só na primeira carga;
depois dela, rode `supabase/05_apos_importacao.sql`).

### Controle de Ativos

`ativos.json` e `peps.json` ficam no bucket privado `dados` do Supabase Storage (pasta `controles/`), lidos só por
usuários logados com e-mail corporativo; não fazem parte do site. Primeira vez: rode `supabase/02_storage_dados.sql`
e envie os dois arquivos pelo painel (Storage › dados › controles). Para atualizar, substitua os arquivos no bucket.
As cópias de trabalho ficam em `dados/controles/` (fora do site e do GitHub, pelo `.gitignore`).

## Equipes e situação dos colaboradores (controle de acesso — etapa 1)

`supabase/10_equipes_e_situacao.sql` cria a tabela `equipes` (com `id_equipe_pai` para a hierarquia; ciclos são
recusados) e acrescenta a `colaboradores` os campos `esta_ativo` (padrão: ativo) e `id_equipe`.
Colaborador inativo não entra no portal (regra no banco e aviso no login), sai das listas de escolha (responsáveis de
tarefa, férias) e continua no histórico (comentários, calendário de férias, tarefas). O cadastro de equipes e da
situação é feito pelo painel do Supabase.

`supabase/11_acesso_somente_cadastrados.sql`: só entra quem tem cadastro **ativo** em `colaboradores` (pelo `id_auth`
ou pelo e-mail). Sem cadastro, o login mostra "acesso ainda não liberado pela Controladoria"; para liberar alguém,
inclua a pessoa em `colaboradores`. A função `situacao_acesso()` informa o motivo (liberado, sem_cadastro, inativo,
dominio) e `usuario_corporativo()`, usada nas regras das tabelas, só é verdadeira para "liberado". Próximas etapas: permissões por módulo e por empresa.

## Tarefas por competência

`supabase/12_tarefas_meses.sql`: cada tarefa pertence a uma competência (`tarefas_meses`, 1º dia do mês; a do fechamento
de outubro é out/26, mesmo que o trabalho aconteça em novembro). Checklist, responsáveis, tags, comentários, anexos e
histórico seguem a tarefa; tags e colunas do quadro são comuns a todos os meses.
- **Prazo por data** (`tipo_prazo = data`) ou **por dias úteis** (`dias_uteis`, D+N em `prazo_du_inicio`/`prazo_du_fim`):
  D+1 = 1º dia útil do mês seguinte à competência; D0 = último dia útil da competência; D−1 = penúltimo. As datas são
  calculadas pelo banco, sem fins de semana e sem os feriados de `tarefas_feriados` (incluir feriados recalcula tudo).
- **Começar o próximo mês:** `tarefas_iniciar_mes(competência, mês de origem, tarefas)` cria a competência e clona as
  tarefas escolhidas numa única operação (título, descrição, prioridade, recorrente, prazo, responsáveis, tags e
  checklist desmarcado; sem comentários, anexos ou histórico). Data fixa: +1 mês, no próximo dia útil; dias úteis:
  recalculado para a nova competência. `tarefa_recorrente` marca o que vem selecionado.
- **Na tela** (`controladoria/tarefas/competencias.js`): seletor de competência acima do quadro (lembrado no navegador),
  "Começar <próximo mês>" com a lista para clonar (recorrentes marcadas) e a prévia das novas datas; em "+ Tarefa" e na
  janela da tarefa, a marca de recorrente e o método de prazo (Data ou Dias úteis, com a data calculada ao lado).
  Nos cartões, ↻ indica tarefa recorrente e o selo D+N, prazo em dias úteis.
- **Painel do fechamento** (`controladoria/painel/`, rota `/painel`; requer `supabase/13_tarefas_painel.sql`): por
  competência, % concluído, concluídas no prazo, atrasadas, dia útil de hoje e em que D+N o fechamento terminou
  (comparado com a competência anterior); gráfico da evolução por dia útil (realizado × planejado pelos prazos ×
  competência anterior); carga por responsável e lista de atrasadas. "Concluída" = tarefa numa coluna com
  `colunas_tarefas.conclui_tarefa`; a data (`tarefas.concluida_em`) é registrada pelo banco ao entrar nessa coluna.



`triviatrens.com.br`, `tictrens.com.br`, `comporte.com.br` e `metrobh.com.br`. A lista fica em dois lugares, que precisam
ser iguais: `DOMINIOS_CORPORATIVOS` em `public/src/scripts/core/supabase.js` e a função `usuario_corporativo()` em
`supabase/01_acesso.sql`.

## Configuração do Supabase (Authentication › URL Configuration)

Inclua `https://<domínio>/pages/hub/hub.html` (e o endereço local, veja abaixo) em Redirect URLs. Sem isso o login
volta para a raiz, que também encaminha ao hub.

## Testar localmente

Qualquer servidor local serve; só não abra o arquivo direto do disco (`file://`).

- **Live Server (VS Code):** "Go Live". O `.vscode/settings.json` publica `public/` como raiz (`http://127.0.0.1:5500/`).
- **Python:** `python -m http.server 8000` dentro de `public/` e abrir `http://localhost:8000/`.

Para o login completar localmente, inclua o endereço do hub nas Redirect URLs (ou `http://127.0.0.1:5500/**`).

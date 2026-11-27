/*
  Funções compartilhadas pelo BP e pela DR. Os dados vêm do Supabase (src/scripts/services/fonte-dados.js):
  - balancetes        saldos acumulados por empresa, conta e período
  - classificacao     plano de contas único (Nv1/Nv2/Nv3 e contraparte para eliminação)
  - empresas          nome, método de consolidação, participação e ordem de exibição
  - hierarquia        ordem das linhas das demonstrações
  - comentarios       revisão analítica

  Também concentra a "Visão" da tabela (por empresa | consolidada). As páginas que a usam
  precisam ter os controles do cabeçalho (#grupoEmpresa, #selectEmpresa e botões com data-modo)
  e definir renderizarTabela(). O detalhamento de contas (Nv3) também exige contextoContas().
*/

/* Nome da origem nas mensagens (ex.: "tabela balancetes") */
const rotuloFonte = nome => FonteDados.rotulo(nome);

const CABECALHO_COMENTARIOS = ['Empresa', 'Mês atual', 'Classificação Nv1', 'Classificação Nv2', 'Classificação Nv3', 'Comentário', 'Autor', 'Data/hora', 'Id comentário', 'Id colaborador'];

const ICONE_COMENTARIO =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 3.5h11v7.2h-5.6L5 13v-2.3H2.5z"/></svg>';

/* ---------- Texto e números ---------- */

function esc(texto) {
  return String(texto || '')
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* Valores das demonstrações em R$ mil (os cálculos seguem em reais; só a exibição divide por mil) */
const UNIDADE = 1000;
// Negativos entre parênteses, como em relatório contábil: -14.206 -> (14.206)
function formatarMoeda(val) {
  if (val === null || val === undefined || isNaN(val)) return "–";
  const n = Math.round(val / UNIDADE);
  if (n === 0) return "–";
  return n < 0 ? `(${Math.abs(n).toLocaleString('pt-BR')})` : n.toLocaleString('pt-BR');
}

/* Percentual de variação: positivo com "+", negativo entre parênteses, uma casa: +4,6% | (3,9%) */
function formatarPercentual(perc) {
  const texto = Math.abs(perc).toFixed(1).replace('.', ',');
  if (texto === '0,0') return '0,0%';
  return perc < 0 ? `(${texto}%)` : `+${texto}%`;
}

function formatarDataPeriodo(dataStr) {
  if (!dataStr) return "";
  const meses = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const partes = dataStr.split('-');
  const ano = partes[0].slice(-2);
  const mesIndex = parseInt(partes[1], 10) - 1;
  return `${meses[mesIndex]}/${ano}`;
}

function normalizarTexto(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function paraNumero(s, numeroLinha) {
  const t = String(s || '').trim();
  if (!t) return 0;
  if (!/^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/.test(t)) {
    throw new Error(`Valor numérico inválido na linha ${numeroLinha} do ${rotuloFonte('balancetes')}: "${t}".`);
  }
  return Number(t.replace(/\./g, '').replace(',', '.'));
}

function paraISO(s) {
  const t = String(s || '').trim();
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function limparNivel(v) {
  const t = String(v || '').trim();
  return (!t || t === '(vazio)') ? null : t;
}

function slugEmpresa(nome) {
  return 'emp-' + normalizarTexto(nome).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}


/* ---------- Balancete e hierarquia ---------- */

function resumirLista(itens, max = 5) {
  return itens.slice(0, max).join('; ') + (itens.length > max ? '…' : '');
}

function indiceConta(cabecalho) {
  return cabecalho.findIndex(c => c.startsWith('conta'));
}

function chaveConta(empresa, conta) {
  return `${empresa}|${conta}`;
}

async function carregarTabela(nome) {
  const linhas = await FonteDados.lerTabela(nome);
  if (linhas.length < 2) throw new Error(`A ${rotuloFonte(nome)} está vazia.`);
  return linhas;
}

/* empresas: código -> { nome, metodo, percentual, consolidado, ordem }.
   metodo_consolidacao: integral (controlada: 100% das linhas no consolidado contábil) | proporcional
   (entra pela participação) | fora (só aparece na visão por empresa, ex.: VDMG).
   percentual_participacao: participação do grupo (0 a 100). Em controladas com menos de 100%, a diferença
   aparece como "Participação de não controladores"; empresas com método "proporcional" (controle conjunto)
   entram no consolidado multiplicadas por ele.
   classificacao: posição da empresa no seletor e nas colunas lado a lado (1 = primeira); sem número, vai para o fim. */
const METODOS_CONSOLIDACAO = ['integral', 'proporcional', 'fora'];

function montarEmpresas(linhas) {
  const cab = linhas[0].map(normalizarTexto);
  const col = nome => cab.indexOf(nome);
  const iCodigo = col('empresa'), iNome = col('nome'), iMetodo = col('metodo_consolidacao');
  const iPerc = col('percentual_participacao'), iOrdem = col('classificacao');
  if (iCodigo < 0 || iNome < 0) throw new Error(`Cabeçalho do ${rotuloFonte('empresas')} inesperado. Esperado: Empresa; Nome; metodo_consolidacao; percentual_participacao; classificacao.`);

  const empresas = new Map();
  linhas.slice(1).forEach(l => {
    const codigo = (l[iCodigo] || '').trim();
    if (!codigo) return;
    let metodo = iMetodo >= 0 ? normalizarTexto(l[iMetodo]) : '';
    if (!METODOS_CONSOLIDACAO.includes(metodo)) metodo = 'integral';
    const perc = iPerc < 0 ? 100 : Number.parseFloat(String(l[iPerc] || '').replace(',', '.'));
    empresas.set(codigo, {
      nome: (l[iNome] || '').trim() || codigo,
      metodo,
      percentual: Number.isFinite(perc) ? Math.min(Math.max(perc, 0), 100) : 100,
      consolidado: metodo !== 'fora',
      ordem: iOrdem < 0 ? Infinity : (Number.parseFloat(String(l[iOrdem] || '').replace(',', '.')) || Infinity),
    });
  });
  return empresas;
}

/* Empresas da visão consolidada (colunas e soma). Método "fora" (ex.: VDMG) só aparece por empresa. */
const entraNoConsolidado = emp => emp.consolidado !== false;
const empresasDoConsolidado = empresas => empresas.filter(entraNoConsolidado);

/* ---------- Fatores das visões consolidadas ---------- */

/* Consolidada: controladas (integral) entram com 100% das linhas; método "proporcional" pela participação. */
function fatorEmpresa(emp) {
  return emp.metodo === 'proporcional' ? (emp.percentual ?? 100) / 100 : 1;
}

/* Parcela de não controladores (só consolidada contábil, controladas com menos de 100%) */
function fracaoNaoControladores(emp) {
  return modoVisao === MODO_CONSOLIDADA && emp.metodo === 'integral' ? 1 - (emp.percentual ?? 100) / 100 : 0;
}

/* ---------- Eliminações entre empresas do grupo ---------- */

/*
  A conta indica a contraparte (campo contraparte do plano de contas, com o código SAP).
  O saldo é eliminado quando quem registra e a contraparte estão no consolidado e são empresas diferentes.
  Entre controladas, elimina 100%; se uma das pontas for de método "proporcional", elimina pela menor
  participação (o restante é a parte dos outros sócios e fica como saldo com terceiros).
*/
function fatorEliminacao(conta, emp, empresas) {
  if (!conta.contraparte || conta.contraparte === emp.codigo || !entraNoConsolidado(emp)) return 0;
  const contraparte = empresas.find(e => e.codigo === conta.contraparte);
  if (!contraparte || !entraNoConsolidado(contraparte)) return 0;
  return Math.min(fatorEmpresa(emp), fatorEmpresa(contraparte));
}

/* Valor da coluna "Eliminações" (negativo do que é eliminado). somar(itens, empId, mes). */
function eliminacaoDosItens(itens, empresas, somar, mes) {
  let total = 0;
  empresasDoConsolidado(empresas).forEach(emp => {
    itens.forEach(item => Object.values(item.contas || {}).forEach(conta => {
      const fator = fatorEliminacao(conta, emp, empresas);
      if (fator) total -= somar([conta], emp.id, mes) * fator;
    }));
  });
  return total;
}


/* Plano de contas: conta -> { nv1, nv2, nv3, nome, contraparte }. Plano de contas único: a mesma conta tem a mesma
   classificação em todas as empresas. (Se o arquivo ainda tiver a coluna Empresa, ela é ignorada.) */
function montarClassificacao(linhas) {
  const cab = linhas[0].map(normalizarTexto);
  const iConta = indiceConta(cab);
  const iNv1 = cab.indexOf('classificacao nv1'), iNv2 = cab.indexOf('classificacao nv2'), iNv3 = cab.indexOf('classificacao nv3');
  const iNome = cab.findIndex(h => h.startsWith('descricao'));
  const iContraparte = cab.indexOf('contraparte');   // código SAP da outra empresa do grupo (saldo a eliminar)
  if ([iConta, iNv1, iNv2, iNv3].some(i => i < 0)) {
    throw new Error(`Cabeçalho do ${rotuloFonte('classificacao')} inesperado. Esperado: Conta contábil; Descrição conta; Classificação Nv1; Nv2; Nv3.`);
  }

  const mapa = new Map();
  linhas.slice(1).forEach(l => {
    const conta = (l[iConta] || '').trim(), nv1 = (l[iNv1] || '').trim();
    if (!conta || !nv1) return;
    mapa.set(conta, { nv1, nv2: limparNivel(l[iNv2]), nv3: limparNivel(l[iNv3]), nome: iNome < 0 ? '' : (l[iNome] || '').trim(),
                      contraparte: iContraparte < 0 ? '' : (l[iContraparte] || '').trim() });
  });
  return mapa;
}

/*
  balancetes (uma linha por empresa, conta e período) + plano de contas (onde cada conta entra).
  Só entram os grupos Nv1 pedidos em "grupos"; o sinal de cada grupo é aplicado ao montante.
*/
/* Linha do PL que recebe o resultado do ano no BP (até o encerramento, o resultado está nas contas da DR) */
const LINHA_RESULTADO_PL = { nv1: 'Patrimônio líquido', nv2: 'Resultado do período', nv3: 'Resultado do período' };
const CONTA_RESULTADO_PL = { numero: 'DR', nome: 'Resultado acumulado no ano (contas de resultado)' };

function montarDados(linhas, grupos, nomes, classificacao, opcoes = {}) {
  const resultadoNoPL = new Set(opcoes.resultadoNoPL || []);
  const cab = linhas[0].map(normalizarTexto);
  const iEmp = cab.indexOf('empresa'), iConta = indiceConta(cab), iPer = cab.indexOf('periodo');
  const iVal = cab.includes('montante') ? cab.indexOf('montante') : cab.length - 1;

  if ([iEmp, iConta, iPer].some(i => i < 0) || new Set([iEmp, iConta, iPer, iVal]).size < 4) {
    throw new Error(`Cabeçalho do ${rotuloFonte('balancetes')} inesperado. Esperado: Empresa; Conta contábil; Período; Montante. Encontrado: ${linhas[0].join('; ')}.`);
  }

  const empresasMap = new Map();
  const itensMap = new Map();
  const contagem = {};
  const nv1Ignorados = new Set();
  const semClassificacao = new Map();   // "empresa|conta" -> soma dos valores absolutos
  const mesesPorCodigo = new Map();     // meses em que cada empresa tem balancete (qualquer conta)

  linhas.slice(1).forEach((l, indice) => {
    const codigo = (l[iEmp] || '').trim();
    const conta = (l[iConta] || '').trim();
    const iso = paraISO(l[iPer]);
    if (!codigo || !conta || !iso) return;
    if (!mesesPorCodigo.has(codigo)) mesesPorCodigo.set(codigo, new Set());
    mesesPorCodigo.get(codigo).add(iso);

    const valor = paraNumero(l[iVal], indice + 2);
    const cls = classificacao.get(conta);
    if (!cls) {
      const chave = chaveConta(codigo, conta);
      semClassificacao.set(chave, (semClassificacao.get(chave) || 0) + Math.abs(valor));
      return;
    }

    let grupo = grupos.find(g => g.nome === cls.nv1);
    let clsItem = cls, contaItemInfo = { numero: conta, nome: cls.nome, contraparte: cls.contraparte };
    if (!grupo && resultadoNoPL.has(cls.nv1)) {
      // BP: conta de resultado entra no PL, numa conta-resumo única
      grupo = grupos.find(g => g.nome === LINHA_RESULTADO_PL.nv1);
      clsItem = LINHA_RESULTADO_PL;
      contaItemInfo = CONTA_RESULTADO_PL;
    }
    if (!grupo) { nv1Ignorados.add(cls.nv1); return; }

    if (!empresasMap.has(codigo)) {
      const cadastro = nomes.get(codigo);
      empresasMap.set(codigo, { id: slugEmpresa(codigo), codigo, nome: cadastro ? cadastro.nome : codigo,
                                consolidado: cadastro ? cadastro.consolidado : true, ordem: cadastro ? cadastro.ordem : Infinity,
                                metodo: cadastro ? cadastro.metodo : 'integral', percentual: cadastro ? cadastro.percentual : 100 });
    }
    const emp = empresasMap.get(codigo);

    const chave = `${clsItem.nv1}|${clsItem.nv2}|${clsItem.nv3}`;
    if (!itensMap.has(chave)) {
      itensMap.set(chave, { id: itensMap.size, classificacao_nv1: clsItem.nv1, classificacao_nv2: clsItem.nv2, classificacao_nv3: clsItem.nv3, valores: {}, contas: {} });
    }
    const item = itensMap.get(chave);
    if (!item.valores[emp.id]) item.valores[emp.id] = {};
    item.valores[emp.id][iso] = (item.valores[emp.id][iso] || 0) + valor * grupo.sinal;

    // Contas contábeis que compõem o item (detalhamento do Nv3); "valores" tem o mesmo formato do item
    const numConta = contaItemInfo.numero;
    if (!item.contas[numConta]) item.contas[numConta] = { numero: numConta, nome: contaItemInfo.nome, contraparte: contaItemInfo.contraparte || '', valores: {} };
    const contaItem = item.contas[numConta];
    if (!contaItem.nome && contaItemInfo.nome) contaItem.nome = contaItemInfo.nome;
    if (!contaItem.valores[emp.id]) contaItem.valores[emp.id] = {};
    contaItem.valores[emp.id][iso] = (contaItem.valores[emp.id][iso] || 0) + valor * grupo.sinal;

    contagem[iso] = (contagem[iso] || 0) + 1;
  });

  // Mês sem balancete da empresa aparece como "–" (e sem variação), em vez de zero
  empresasMap.forEach((emp, codigo) => { emp.meses = mesesPorCodigo.get(codigo) || new Set(); });

  const avisos = [];

  const contasSemClassificacao = [...semClassificacao].filter(([, total]) => total > 0).map(([chave]) => {
    const [codigo, conta] = chave.split('|');
    return `${nomes.get(codigo)?.nome || codigo} ${conta}`;
  });
  if (contasSemClassificacao.length) {
    avisos.push(`${contasSemClassificacao.length} conta(s) com saldo no ${rotuloFonte('balancetes')} estão sem classificação (ausentes ou em branco no ${rotuloFonte('classificacao')}) e ficaram de fora: ${resumirLista(contasSemClassificacao)}.`);
  }

  const empresasSemNome = [...empresasMap.keys()].filter(codigo => !nomes.has(codigo));
  if (empresasSemNome.length) {
    avisos.push(`Empresa(s) sem nome no ${rotuloFonte('empresas')}: ${empresasSemNome.join(', ')}.`);
  }

  // Ordem do seletor e das colunas lado a lado: classificação da empresa no cadastro (empate: código)
  const empresas = [...empresasMap.values()].sort((a, b) => a.ordem - b.ordem || a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }));
  return { periodos: Object.keys(contagem).sort(), empresas, itens: [...itensMap.values()], avisos, nv1Ignorados };
}

function montarHierarquia(linhas) {
  const cab = linhas[0].map(normalizarTexto);
  const iN1 = cab.indexOf('classificacao nv1'), iN2 = cab.indexOf('classificacao nv2'), iN3 = cab.indexOf('classificacao nv3');
  const iO1 = cab.indexOf('ordem nv1'), iO2 = cab.indexOf('ordem nv2'), iO3 = cab.indexOf('ordem nv3');
  if ([iN1, iN2, iN3, iO1, iO2, iO3].some(i => i < 0)) {
    throw new Error(`Cabeçalho da ${rotuloFonte('hierarquia')} inesperado.`);
  }

  const ordem = (v) => {
    const n = parseFloat(String(v || '').trim().replace(',', '.'));
    return isNaN(n) ? undefined : n;
  };

  const mapa = new Map();
  linhas.slice(1).forEach(l => {
    const chave = `${(l[iN1] || '').trim()}|${limparNivel(l[iN2])}|${limparNivel(l[iN3])}`;
    mapa.set(chave, { o1: ordem(l[iO1]), o2: ordem(l[iO2]), o3: ordem(l[iO3]) });
  });
  return mapa;
}

function aplicarHierarquia(dados, mapa, ignorar = []) {
  const semHierarquia = [];
  dados.itens.forEach(item => {
    if (ignorar.includes(item.classificacao_nv1)) return;
    const h = mapa.get(`${item.classificacao_nv1}|${item.classificacao_nv2}|${item.classificacao_nv3}`);
    if (h) {
      item.o1 = h.o1; item.o2 = h.o2; item.o3 = h.o3;
    } else {
      semHierarquia.push([item.classificacao_nv2, item.classificacao_nv3].filter(Boolean).join(' › ') || item.classificacao_nv1);
    }
  });
  return semHierarquia;
}

function cmpOrdem(a, b) {
  const x = typeof a === 'number' ? a : Infinity;
  const y = typeof b === 'number' ? b : Infinity;
  return x === y ? 0 : (x < y ? -1 : 1);
}

/* Lê balancetes, classificação, empresas e hierarquia. Devolve os dados e os avisos para a tela. */
/* opcoes.resultadoNoPL: grupos da DR cujo saldo vai, no BP, para "Patrimônio líquido › Resultado do período" */
async function carregarBase(grupos, ignorarNaHierarquia = [], opcoes = {}) {
  const [balancete, empresas, classificacao] = await Promise.all(
    ['balancetes', 'empresas', 'classificacao'].map(carregarTabela)
  );
  const dados = montarDados(balancete, grupos, montarEmpresas(empresas), montarClassificacao(classificacao), opcoes);
  const avisos = [...dados.avisos];

  try {
    const mapa = montarHierarquia(await carregarTabela('hierarquia'));
    const faltantes = aplicarHierarquia(dados, mapa, ignorarNaHierarquia);
    if (faltantes.length) {
      avisos.push(`${faltantes.length} classificação(ões) não constam no ${rotuloFonte('hierarquia')} e aparecem no fim do grupo: ${resumirLista(faltantes)}.`);
    }
  } catch (erro) {
    console.warn('Hierarquia não carregada:', erro);
    avisos.push(`Não foi possível ler o ${rotuloFonte('hierarquia')}; a ordem segue a do ${rotuloFonte('balancetes')}.`);
  }

  return { dados, avisos };
}

/* ---------- Seleções lembradas ---------- */

/*
  Mês, visão, empresa e tipo de valor (DR) ficam guardados no navegador (localStorage), em uma
  chave só. Assim valem ao recarregar a página e ao ir do BP para a DR. Se o navegador não
  permitir guardar, a página funciona normalmente, sem lembrar.
*/
const CHAVE_SELECOES = 'trilha_selecoes';

function lerSelecoes() {
  try { return JSON.parse(localStorage.getItem(CHAVE_SELECOES)) || {}; } catch (e) { return {}; }
}

function salvarSelecoes(novas) {
  try { localStorage.setItem(CHAVE_SELECOES, JSON.stringify({ ...lerSelecoes(), ...novas })); } catch (e) { }
}

/* Mês guardado, se ainda existir nos dados; senão, o mais recente */
function mesInicial(periodos) {
  const salvo = lerSelecoes().mes;
  return periodos.includes(salvo) ? salvo : periodos[periodos.length - 1];
}

function mesAnteriorDe(periodos, mes) {
  const i = periodos.indexOf(mes);
  return i > 0 ? periodos[i - 1] : periodos[0];
}

/* ---------- Três meses da visão por empresa ---------- */

/*
  Por empresa: M1 | Δ (M2 − M1) | M2 | Δ (M3 − M2) | M3, sendo M3 o mês selecionado e M2/M1 os dois meses
  anteriores existentes nos dados. No começo da série, o mês que não existe vem como null e aparece "–".
*/
function mesesTendencia(periodos, mes) {
  const i = periodos.indexOf(mes);
  return { m1: i >= 2 ? periodos[i - 2] : null, m2: i >= 1 ? periodos[i - 1] : null, m3: mes };
}

/* A empresa tem balancete neste mês? (mês null = fora da série) */
function temMes(emp, mes) {
  return !!mes && (!emp.meses || emp.meses.has(mes));
}

/* Valor de um mês (NaN = mês inexistente, exibido como "–") */
function celulaValor(valor, formatar) {
  return `<td class="num">${Number.isNaN(valor) ? '–' : formatar(valor)}</td>`;
}

/* Variação numa célula só: Δ $ em cima e Δ % em selo logo abaixo */
function celulaDeltaDupla(d, extra = '') {
  return `<td class="num td-delta ${extra}"><span class="delta ${d.classe}">${d.diffStr}</span>` +
         `<span class="chip ${d.classe}">${d.percStr}</span></td>`;
}

/* ---------- Ocultar linhas sem saldo ---------- */

/* Marca as linhas (não totais) em que todos os valores exibidos são "–" */
function marcarLinhasZeradas(tbody) {
  tbody.querySelectorAll('tr.tr-grupo, tr.tr-filha, tr.tr-nv3').forEach(tr => {
    const valores = [...tr.querySelectorAll('td.num:not(.td-delta)')];
    const zerada = valores.length > 0 && valores.every(td => {
      const span = td.querySelector('.cell-val-group > span:last-child');
      return (span ? span.textContent : td.textContent).trim() === '–';
    });
    tr.classList.toggle('linha-zerada', zerada);
  });
  aplicarOcultarZerados();
}

function aplicarOcultarZerados() {
  const ativo = lerSelecoes().ocultarZerados === true;
  document.querySelectorAll('.bp-table').forEach(t => t.classList.toggle('ocultar-zerados', ativo));
  const botao = document.getElementById('btnOcultarZerados');
  if (botao) {
    botao.setAttribute('aria-pressed', String(ativo));
    botao.classList.toggle('is-active', ativo);
  }
}

function alternarOcultarZerados() {
  salvarSelecoes({ ocultarZerados: lerSelecoes().ocultarZerados !== true });
  aplicarOcultarZerados();
}

/* Destaca a coluna do mês selecionado */
function marcarMesSelecionado(td) {
  return td.replace('<td class="num', '<td class="num td-mes-selecionado');
}

/* ---------- Visão da tabela: por empresa | consolidada ---------- */

/*
  Por empresa:  uma empresa (escolhida no seletor) com três meses e as variações entre eles.
  Consolidada:  o mês atual de cada empresa, lado a lado, eliminações e o consolidado (contábil).
*/
const MODO_EMPRESA = 'empresa';
const MODO_CONSOLIDADA = 'consolidada';      // contábil: controladas 100%, não controladores destacados
const MODOS_VISAO = [MODO_EMPRESA, MODO_CONSOLIDADA];

let modoVisao = MODO_EMPRESA;
let empresaSelecionadaId = '';

function empresaSelecionada(empresas) {
  return empresas.find(e => e.id === empresaSelecionadaId) || empresas[0];
}

/* Empresas que aparecem na tabela: só a selecionada ou todas, conforme a visão */
function empresasExibidas(empresas) {
  return modoVisao === MODO_EMPRESA ? [empresaSelecionada(empresas)] : empresasDoConsolidado(empresas);
}

function iniciarVisao(empresasTodas) {
  const salvas = lerSelecoes();
  // Seletor só com as empresas que a pessoa vê (empresa dela, ou todas se for da holding)
  const visiveis = empresasTodas.filter(e => Permissoes.veEmpresa(e.codigo));
  const empresas = visiveis.length ? visiveis : empresasTodas;
  modoVisao = MODOS_VISAO.includes(salvas.modo) ? salvas.modo : MODO_EMPRESA;
  if (!Permissoes.todasEmpresas) modoVisao = MODO_EMPRESA;   // Consolidada só para quem vê todas as empresas
  empresaSelecionadaId = (empresas.find(e => e.codigo === salvas.empresa) || empresas[0]).id;

  const seletor = document.getElementById('selectEmpresa');
  seletor.innerHTML = '';
  empresas.forEach(e => {
    const opcao = new Option(e.nome, e.id, false, e.id === empresaSelecionadaId);
    opcao.dataset.codigo = e.codigo;
    seletor.appendChild(opcao);
  });
  atualizarControlesVisao();
}

function atualizarControlesVisao() {
  document.querySelectorAll('[data-modo]').forEach(btn => {
    const ativo = btn.dataset.modo === modoVisao;
    btn.classList.toggle('is-active', ativo);
    btn.setAttribute('aria-pressed', ativo);
  });
  document.getElementById('grupoEmpresa').hidden = modoVisao !== MODO_EMPRESA;
}

function definirModoVisao(modo) {
  if (modo !== MODO_EMPRESA && !Permissoes.todasEmpresas) return;   // Consolidada só para quem vê todas as empresas
  modoVisao = modo;
  salvarSelecoes({ modo });
  atualizarControlesVisao();
  renderizarTabela();
}

function alterarEmpresa() {
  const seletor = document.getElementById('selectEmpresa');
  empresaSelecionadaId = seletor.value;
  salvarSelecoes({ empresa: seletor.selectedOptions[0].dataset.codigo });
  renderizarTabela();
}

/* Cabeçalho dos três meses: M1 | Δ | M2 | Δ | M3 */
function cabecalhoTendencia({ m1, m2, m3 }, classeTh = '') {
  const rot = m => m ? formatarDataPeriodo(m) : '–';
  const delta = (a, b) => `<th class="th-delta ${classeTh}">Δ ${a && b ? `${rot(a)} → ${rot(b)}` : ''}</th>`;
  return `<th class="${classeTh}">${rot(m1)}</th>${delta(m1, m2)}<th class="${classeTh}">${rot(m2)}</th>${delta(m2, m3)}` +
         `<th class="th-mes-selecionado ${classeTh}">${rot(m3)}</th>`;
}

/* Coluna de empresa nas visões consolidadas: mostra a participação quando for menor que 100% */
function thEmpresaConsolidada(e) {
  if ((e.percentual ?? 100) >= 100) return `<th>${esc(e.nome)}</th>`;
  const perc = `${String(e.percentual).replace('.', ',')}%`;
  const texto = e.metodo === 'proporcional' ? `× ${perc}` : `${perc} do grupo`;
  return `<th title="Participação do grupo: ${perc}">${esc(e.nome)}<span class="tag-participacao">${texto}</span></th>`;
}

/* Cabeçalho em dois níveis, conforme a visão. "tendencia" = { m1, m2, m3 } (mesesTendencia). */
function renderizarCabecalho(thead, empresas, tendencia, comEliminacoes = false) {
  const porEmpresa = modoVisao === MODO_EMPRESA;
  const rubrica = '<th rowspan="2" class="th-rubrica">Classificação</th>';
  const strMesRef = formatarDataPeriodo(tendencia.m3);

  thead.innerHTML = porEmpresa
    ? `<tr>${rubrica}<th colspan="5" class="th-grupo-empresa">${esc(empresaSelecionada(empresas).nome)}</th></tr>` +
      `<tr>${cabecalhoTendencia(tendencia)}</tr>`
    : `<tr>${rubrica}<th colspan="${empresasDoConsolidado(empresas).length + 1 + (comEliminacoes ? 1 : 0)}" class="th-grupo-empresa">${strMesRef} · consolidado</th></tr>` +
      `<tr>${empresasDoConsolidado(empresas).map(thEmpresaConsolidada).join('')}` +
      `${comEliminacoes ? '<th class="th-eliminacoes" title="Saldos entre empresas do grupo (partes relacionadas)">Eliminações</th>' : ''}` +
      `<th class="th-consolidado">Consolidado</th></tr>`;

  const tabela = thead.closest('table');
  tabela.classList.toggle('modo-empresa', porEmpresa);
  tabela.classList.toggle('modo-consolidada', !porEmpresa);
}

/* ---------- Expandir e recolher por nível ---------- */

const NIVEL_MIN = 1;
const NIVEL_MAX = 3;

/* Nível de expansão: 1 = só os grupos | 2 = grupos e classificações (Nv2) | 3 = tudo (Nv3).
   É lembrado no navegador e vale para BP e DR. */
let nivelAtual = nivelSalvo();

function nivelSalvo() {
  const n = Math.floor(Number(lerSelecoes().nivel));
  return n >= NIVEL_MIN && n <= NIVEL_MAX ? n : NIVEL_MIN;
}

/* Mostra ou esconde as linhas e acerta as setas conforme o nivelAtual */
function aplicarNivel() {
  // Nível 2 ou mais: filhas ficam visíveis (recolhido = false)
  document.querySelectorAll(".tr-filha").forEach(linha => {
    linha.classList.toggle("recolhido", nivelAtual < 2);
  });

  // Nível 3: netas ficam visíveis (recolhido = false)
  document.querySelectorAll(".tr-nv3").forEach(linha => {
    linha.classList.toggle("recolhido", nivelAtual < 3);
  });

  // Atualiza os botões/pills indicadores de expansão:
  // a seta do grupo abre a partir do nível 2; a da classificação (Nv2), só no nível 3
  document.querySelectorAll(".btn-expand-pill").forEach(btn => {
    const minimo = btn.closest(".tr-filha") ? 2 : 1;
    btn.classList.toggle("is-open", nivelAtual > minimo);
  });
}

function alternarTodos(expandir) {
  // Atualiza o nível conforme a intenção
  if (expandir) {
    if (nivelAtual < NIVEL_MAX) nivelAtual++;
  } else {
    if (nivelAtual > NIVEL_MIN) nivelAtual--;
  }

  salvarSelecoes({ nivel: nivelAtual });
  aplicarNivel();
}

/* ---------- Detalhamento por conta contábil (popup do Nv3) ---------- */

/* Ordem do número da conta no popup: 1 = crescente, -1 = decrescente */
const ORDEM_CONTAS_EMPRESA = 1;
const ORDEM_CONTAS_CONSOLIDADA = -1;

const ICONE_CONTAS =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 4.5h8M5.5 8h8M5.5 11.5h8M2.5 4.5h.01M2.5 8h.01M2.5 11.5h.01"/></svg>';
const ICONE_FECHAR =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';

let botaoContasAberto = null;

/*
  Cada página define contextoContas() com o que muda entre BP e DR:
  { empresas, mesAtual, mesBase, tendencia, comEliminacoes, somar(itens, empId, mes), formatar(valor), delta(atual, base) }
*/
function botaoContas(item) {
  return `<button type="button" class="btn-contas" data-item-id="${item.id}" title="Ver contas contábeis"
    aria-label="Ver contas contábeis de ${esc(item.classificacao_nv3)}" onclick="abrirContas(event, this)">${ICONE_CONTAS}</button>`;
}

function htmlContasDoItem(item, ctx) {
  const porEmpresa = modoVisao === MODO_EMPRESA;
  const empresas = empresasExibidas(ctx.empresas);
  const { mesAtual, somar, formatar, delta } = ctx;
  const tend = ctx.tendencia || { m1: null, m2: ctx.mesBase, m3: mesAtual };
  const meses = porEmpresa ? [tend.m1, tend.m2, tend.m3].filter(Boolean) : [mesAtual];

  const existentes = Object.values(item.contas).filter(c => empresas.some(e => c.valores[e.id]));
  const comSaldo = existentes.filter(c =>
    empresas.some(e => meses.some(m => Math.round(somar([c], e.id, m)) !== 0)));
  const ordem = porEmpresa ? ORDEM_CONTAS_EMPRESA : ORDEM_CONTAS_CONSOLIDADA;
  comSaldo.sort((a, b) => ordem * a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }));
  const semSaldo = existentes.length - comSaldo.length;

  const valorMes = (c, empId, m) => temMes(empresas.find(e => e.id === empId), m) ? somar([c], empId, m) : NaN;
  const numeros = (c) => empresas.map(e => ({ emp: e, atual: somar([c], e.id, mesAtual) * (porEmpresa ? 1 : fatorEmpresa(e)) }));
  let cabecalho, linhas, rodape;

  if (porEmpresa) {
    // Mesmas colunas da tabela: M1 | Δ | M2 | Δ | M3 (mês selecionado)
    const emp = empresas[0];
    cabecalho = cabecalhoTendencia(tend);
    const linha = (rotulo, v1, v2, v3) =>
      `${rotulo}${celulaValor(v1, formatar)}${celulaDeltaDupla(delta(v2, v1))}${celulaValor(v2, formatar)}` +
      `${celulaDeltaDupla(delta(v3, v2))}${marcarMesSelecionado(celulaValor(v3, formatar))}`;
    const valores = c => [valorMes(c, emp.id, tend.m1), valorMes(c, emp.id, tend.m2), somar([c], emp.id, tend.m3)];
    linhas = comSaldo.map(c => `<tr>${linha(`<td class="col-conta">${esc(c.numero)}</td><td class="col-nome">${esc(c.nome)}</td>`, ...valores(c))}</tr>`);
    const total = comSaldo.reduce((t, c) => valores(c).map((v, i) => t[i] + v), [0, 0, 0]);
    rodape = `<tr class="contas-total">${linha('<td colspan="2">Total</td>', ...total)}</tr>`;
  } else {
    // BP: coluna de eliminações quando o item é saldo com outra empresa do grupo
    const comElim = !!ctx.comEliminacoes;
    const elimConta = c => -empresas.reduce((t, e) => t + somar([c], e.id, mesAtual) * fatorEliminacao(c, e, ctx.empresas), 0);
    cabecalho = empresas.map(thEmpresaConsolidada).join('') +
                (comElim ? '<th class="th-eliminacoes">Eliminações</th>' : '') + '<th class="th-consolidado">Consolidado</th>';
    linhas = comSaldo.map(c => {
      const porEmp = numeros(c);
      const elim = comElim ? elimConta(c) : 0;
      const consolidado = porEmp.reduce((t, n) => t + n.atual, 0) + elim;
      return `<tr><td class="col-conta">${esc(c.numero)}</td><td class="col-nome">${esc(c.nome)}</td>` +
        porEmp.map(n => `<td class="num">${formatar(n.atual)}</td>`).join('') +
        (comElim ? `<td class="num td-eliminacoes">${formatar(elim)}</td>` : '') +
        `<td class="num td-consolidado">${formatar(consolidado)}</td></tr>`;
    });
    const totais = empresas.map(e => comSaldo.reduce((t, c) => t + somar([c], e.id, mesAtual) * fatorEmpresa(e), 0));
    const elimTotal = comElim ? comSaldo.reduce((t, c) => t + elimConta(c), 0) : 0;
    const totalGeral = totais.reduce((t, v) => t + v, 0) + elimTotal;
    rodape = `<tr class="contas-total"><td colspan="2">Total</td>${totais.map(t => `<td class="num">${formatar(t)}</td>`).join('')}` +
             (comElim ? `<td class="num td-eliminacoes">${formatar(elimTotal)}</td>` : '') +
             `<td class="num td-consolidado">${formatar(totalGeral)}</td></tr>`;
  }

  if (!comSaldo.length) {
    return '<p class="contas-vazio">Nenhuma conta com saldo neste período.</p>';
  }

  return `<table class="tabela-contas">
      <thead><tr><th>Conta</th><th>Nome da conta</th>${cabecalho}</tr></thead>
      <tbody>${linhas.join('')}</tbody>
      <tfoot>${rodape}</tfoot>
    </table>` +
    (semSaldo ? `<p class="contas-nota">${semSaldo} conta(s) sem saldo no período não aparecem.</p>` : '');
}

function garantirModalContas() {
  let modal = document.getElementById('modalContas');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'modalContas';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-card modal-chat modal-contas" role="dialog" aria-modal="true" aria-labelledby="contasTitulo">
      <header class="modal-header">
        <div class="modal-header-info">
          <h3 id="contasTitulo">Contas contábeis</h3>
          <p class="modal-subtitle" id="contasSubtitulo"></p>
        </div>
        <button type="button" class="btn-close-modal" aria-label="Fechar">${ICONE_FECHAR}</button>
      </header>
      <div class="contas-corpo" id="contasCorpo"></div>
    </div>`;
  modal.addEventListener('click', e => { if (e.target === modal) fecharModalContas(); });
  modal.querySelector('.btn-close-modal').addEventListener('click', fecharModalContas);
  document.body.appendChild(modal);
  return modal;
}

function abrirContas(e, botao) {
  if (e) e.stopPropagation();
  const item = dadosGlobais.itens[Number(botao.dataset.itemId)];
  if (!item) return;
  const ctx = contextoContas();
  const porEmpresa = modoVisao === MODO_EMPRESA;

  const modal = garantirModalContas();
  document.getElementById('contasSubtitulo').innerHTML =
    `<span class="tag-emp">${porEmpresa ? esc(empresaSelecionada(ctx.empresas).nome) : 'Consolidada'}</span>` +
    `<span class="tag-mes">${porEmpresa && ctx.tendencia && ctx.tendencia.m1 ? `${formatarDataPeriodo(ctx.tendencia.m1)} → ` : ''}${formatarDataPeriodo(ctx.mesAtual)}</span>` +
    `<span>${esc([item.classificacao_nv2, item.classificacao_nv3].filter(Boolean).join(' › '))}</span>`;
  document.getElementById('contasCorpo').innerHTML = htmlContasDoItem(item, ctx);

  botaoContasAberto = botao;
  modal.classList.add('active');
  modal.querySelector('.btn-close-modal').focus();
}

function fecharModalContas() {
  const modal = document.getElementById('modalContas');
  if (!modal || !modal.classList.contains('active')) return;
  modal.classList.remove('active');
  if (botaoContasAberto) botaoContasAberto.focus();
  botaoContasAberto = null;
}

document.addEventListener('keydown', ev => { if (ev.key === 'Escape') fecharModalContas(); });

/* ---------- Comentários de revisão analítica ---------- */

/*
  Compartilhado por BP e DR. Cada célula (empresa + mês + classificação) guarda uma LISTA de comentários,
  em ordem de registro. A leitura vem da fonte "comentarios" (fonte-dados.js); a gravação só funciona
  quando essa fonte está como 'tabela' no Supabase. O autor é sempre o usuário logado.
*/

function chaveComentario(empId, mesAtualISO, nv1, nv2, nv3) {
  const n2 = (nv2 && nv2 !== '(vazio)') ? nv2 : '';
  const n3 = (nv3 && nv3 !== '(vazio)') ? nv3 : '';
  return [empId, mesAtualISO, nv1, n2, n3].join('|');
}

/* A empresa pode vir como código ou como nome. */
function resolverEmpresa(rotulo, empresas) {
  const alvo = normalizarTexto(rotulo);
  const emp = empresas.find(e => normalizarTexto(e.codigo) === alvo || normalizarTexto(e.nome) === alvo);
  return emp ? emp.id : slugEmpresa(rotulo);
}

/*
  Autor = colaborador da tabela colaboradores (id_colab), achado pelo login (id_auth ou e-mail).
  Quem não está cadastrado como colaborador não pode comentar (o banco também recusa).
  Devolve { pode, colab, aviso }.
*/
async function estadoComentario() {
  try {
    const colab = await FonteDados.colaboradorLogado();
    if (!colab) {
      return { pode: false, colab: null, aviso: 'Seu usuário não está cadastrado em Colaboradores, por isso não pode comentar. Peça a inclusão do seu e-mail no cadastro da equipe.' };
    }
    return { pode: true, colab, aviso: '' };
  } catch (erro) {
    console.warn('Colaborador não identificado:', erro);
    return { pode: false, colab: null, aviso: 'Não foi possível identificar seu cadastro de colaborador. Atualize a página.' };
  }
}

/* Prepara o modal: mostra o autor, libera ou bloqueia o envio e exibe o aviso adequado. */
/* Prepara o modal: libera ou bloqueia o envio, exibe o aviso adequado e marca os comentários editáveis. */
async function aplicarEstadoComentario(erroHistorico) {
  const campoTexto = document.getElementById('txtComentario');
  const botao = document.querySelector('#modalComentario .btn-chat-send');
  const feedback = document.getElementById('feedbackComentario');

  // Enquanto identifica o colaborador, o envio fica bloqueado
  campoTexto.disabled = true;
  if (botao) botao.disabled = true;
  feedback.textContent = '';

  const estado = await estadoComentario();
  campoTexto.disabled = !estado.pode;
  campoTexto.placeholder = estado.colab ? `Escreva um comentário como ${estado.colab.nome_colab}…` : 'Escreva um comentário…';
  if (botao) botao.disabled = !estado.pode;
  feedback.textContent = estado.aviso || (erroHistorico
    ? 'Não foi possível carregar o histórico de comentários. Você ainda pode registrar um comentário.'
    : '');
  marcarComentariosEditaveis(estado.colab);
  if (estado.pode) campoTexto.focus();
  return estado;
}

/* Devolve { mapa: chave -> [comentários], erro: boolean } */
async function carregarComentariosRevisao(empresas) {
  try {
    const linhas = await FonteDados.lerTabela('comentarios');
    if (linhas.length < 2) return { mapa: {}, erro: false };

    const cab = linhas[0].map(normalizarTexto);
    const [iEmp, iAtual, iN1, iN2, iN3, iTxt, iAut, iDt, iId, iColab] = CABECALHO_COMENTARIOS.map(n => cab.indexOf(normalizarTexto(n)));
    if ([iEmp, iAtual, iN1, iTxt].some(i => i < 0)) throw new Error('Cabeçalho dos comentários inesperado.');

    const mapa = {};
    linhas.slice(1).forEach(l => {
      const mesAtual = paraISO(l[iAtual]);
      const empresa = (l[iEmp] || '').trim();
      const texto = (l[iTxt] || '').trim();
      if (!mesAtual || !empresa || !texto) return;

      const nv1 = (l[iN1] || '').trim(), nv2 = (l[iN2] || '').trim(), nv3 = (l[iN3] || '').trim();
      const chave = chaveComentario(resolverEmpresa(empresa, empresas), mesAtual, nv1, nv2, nv3);
      (mapa[chave] = mapa[chave] || []).push({
        empresa, mesAtual, nv1, nv2, nv3, texto,
        autor: (l[iAut] || '').trim(), dataHora: (l[iDt] || '').trim(),
        id: iId < 0 ? '' : (l[iId] || '').trim(), idColab: iColab < 0 ? '' : (l[iColab] || '').trim()
      });
    });
    return { mapa, erro: false };
  } catch (erro) {
    console.warn('Comentários não carregados:', erro);
    return { mapa: {}, erro: true };
  }
}

/* Grava um comentário em nome do colaborador logado. Lança erro com mensagem pronta para a tela. */
async function gravarComentarioRevisao({ empresas, empId, mesAtual, nv1, nv2, nv3, texto }) {
  const { pode, colab, aviso } = await estadoComentario();
  if (!pode) throw new Error(aviso);
  const emp = empresas.find(e => e.id === empId);
  const codigo = emp ? emp.codigo : '';
  if (!/^\d+$/.test(codigo)) throw new Error('Empresa não identificada para o comentário.');
  await FonteDados.inserir('comentarios', {
    id_empresa: Number(codigo),
    mes_atual: mesAtual,
    nivel1: nv1,
    nivel2: (nv2 && nv2 !== '(vazio)') ? nv2 : null,
    nivel3: (nv3 && nv3 !== '(vazio)') ? nv3 : null,
    mensagem: texto,
    id_colab: colab.id_colab,
  });
}

/* Balões do histórico (modal) e itens do popup ao passar o mouse */
const ICONE_LIXEIRA = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.6 6.5v4.5M9.4 6.5v4.5"/></svg>';
const ICONE_LAPIS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11.2 2.3l2.5 2.5-8 8L3 13.5l.7-2.7 7.5-8.5z"/><path d="M10 3.5l2.5 2.5"/></svg>';

/* Balões do histórico. O lápis (editar) aparece depois, só nos comentários do colaborador logado. */
function htmlHistoricoComentarios(lista) {
  if (!lista.length) return '<div class="chat-empty">Nenhum comentário registrado para este mês.</div>';
  return lista.map(c => `
    <div class="chat-bubble bubble-mine" data-id="${esc(c.id || '')}" data-colab="${esc(c.idColab || '')}">
      <div class="bubble-autor">${esc(c.autor || 'Anônimo')}</div>
      <div class="bubble-texto">${esc(c.texto)}</div>
      <span class="bubble-data">${esc(c.dataHora || '')}</span>
    </div>`).join('');
}

/* Depois de gravar um comentário: o popup continua aberto, com o histórico atualizado e o campo limpo */
async function atualizarModalAposComentario(chave) {
  const historico = document.getElementById('chatHistorico');
  historico.innerHTML = htmlHistoricoComentarios(comentariosRevisao[chave] || []);
  const { colab } = await estadoComentario();
  marcarComentariosEditaveis(colab);   // o comentário novo já vem com editar e excluir
  historico.scrollTop = historico.scrollHeight;
  const campo = document.getElementById('txtComentario');
  campo.value = '';
  campo.focus();
  // O aviso "Comentário registrado." some quando a pessoa começa o próximo
  campo.addEventListener('input', () => { document.getElementById('feedbackComentario').textContent = ''; }, { once: true });
}

/* Coloca editar (lápis) e excluir (lixeira) no canto dos comentários escritos pelo colaborador logado */
function marcarComentariosEditaveis(colab) {
  if (!colab || !Permissoes.podeEditar('demonstracoes')) return;   // grupo só consulta: sem editar/excluir
  document.querySelectorAll('#chatHistorico .chat-bubble').forEach(balao => {
    if (!balao.dataset.id || String(balao.dataset.colab) !== String(colab.id_colab) || balao.querySelector('.bubble-acoes')) return;
    const acoes = document.createElement('div');
    acoes.className = 'bubble-acoes';
    const botao = (classe, titulo, icone, acao) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = classe;
      b.title = titulo;
      b.setAttribute('aria-label', titulo);
      b.innerHTML = icone;
      b.addEventListener('click', () => acao(balao));
      acoes.appendChild(b);
    };
    botao('btn-editar-comentario', 'Editar comentário', ICONE_LAPIS, editarComentario);
    botao('btn-excluir-comentario', 'Excluir comentário', ICONE_LIXEIRA, confirmarExclusaoComentario);
    balao.prepend(acoes);
  });
}

/* Exclusão com confirmação dentro do próprio balão (evita apagar por clique acidental) */
function confirmarExclusaoComentario(balao) {
  if (balao.classList.contains('editando') || balao.querySelector('.bubble-confirmar')) return;
  balao.classList.add('confirmando');
  const caixa = document.createElement('div');
  caixa.className = 'bubble-confirmar';
  caixa.setAttribute('role', 'alertdialog');
  caixa.innerHTML = `
    <span class="bubble-confirmar-texto">Excluir este comentário?</span>
    <button type="button" class="btn-edicao-cancelar">Cancelar</button>
    <button type="button" class="btn-confirmar-excluir">Excluir</button>`;
  balao.appendChild(caixa);
  const voltar = () => { caixa.remove(); balao.classList.remove('confirmando'); };
  caixa.querySelector('.btn-edicao-cancelar').addEventListener('click', voltar);
  caixa.querySelector('.btn-edicao-cancelar').focus();
  caixa.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); voltar(); } });
  caixa.querySelector('.btn-confirmar-excluir').addEventListener('click', async () => {
    const texto = caixa.querySelector('.bubble-confirmar-texto');
    caixa.querySelectorAll('button').forEach(b => { b.disabled = true; });
    texto.textContent = 'Excluindo…';
    try {
      await FonteDados.excluir('comentarios', { id_comentario: Number(balao.dataset.id) });
      // Tira da lista em memória (ícone e balão da tabela)
      Object.keys(comentariosRevisao).forEach(chave => {
        comentariosRevisao[chave] = comentariosRevisao[chave].filter(c => String(c.id) !== balao.dataset.id);
        if (!comentariosRevisao[chave].length) delete comentariosRevisao[chave];
      });
      const historico = balao.parentElement;
      balao.remove();
      if (historico && !historico.querySelector('.chat-bubble')) historico.innerHTML = htmlHistoricoComentarios([]);
      if (typeof renderizarTabela === 'function') renderizarTabela();
    } catch (erro) {
      console.warn('Falha ao excluir comentário:', erro);
      texto.textContent = erro.message || 'Não foi possível excluir.';
      caixa.querySelectorAll('button').forEach(b => { b.disabled = false; });
    }
  });
}

/* Edição no próprio balão: o texto vira um campo com Salvar / Cancelar (Ctrl+Enter salva, Esc cancela) */
function editarComentario(balao) {
  if (balao.classList.contains('editando') || balao.classList.contains('confirmando')) return;
  const textoEl = balao.querySelector('.bubble-texto');
  const original = textoEl.textContent;
  balao.classList.add('editando');
  textoEl.hidden = true;

  const caixa = document.createElement('div');
  caixa.className = 'bubble-edicao';
  caixa.innerHTML = `
    <textarea rows="3" aria-label="Editar comentário"></textarea>
    <div class="bubble-edicao-acoes">
      <span class="bubble-edicao-aviso" role="status"></span>
      <button type="button" class="btn-edicao-cancelar">Cancelar</button>
      <button type="button" class="btn-edicao-salvar">Salvar</button>
    </div>`;
  const campo = caixa.querySelector('textarea');
  campo.value = original;
  textoEl.after(caixa);
  campo.focus();
  campo.setSelectionRange(campo.value.length, campo.value.length);

  const encerrar = novoTexto => {
    if (novoTexto !== undefined) textoEl.textContent = novoTexto;
    caixa.remove();
    textoEl.hidden = false;
    balao.classList.remove('editando');
  };
  const salvar = async () => {
    const texto = campo.value.trim();
    const aviso = caixa.querySelector('.bubble-edicao-aviso');
    if (!texto) { aviso.textContent = 'O comentário não pode ficar vazio.'; campo.focus(); return; }
    if (texto === original.trim()) { encerrar(); return; }
    caixa.querySelectorAll('button').forEach(b => { b.disabled = true; });
    aviso.textContent = 'Salvando…';
    try {
      await FonteDados.atualizar('comentarios', { id_comentario: Number(balao.dataset.id) }, { mensagem: texto });
      // Atualiza a lista em memória (balões ao passar o mouse na tabela)
      Object.values(comentariosRevisao).forEach(lista => lista.forEach(c => { if (String(c.id) === balao.dataset.id) c.texto = texto; }));
      encerrar(texto);
      if (typeof renderizarTabela === 'function') renderizarTabela();
    } catch (erro) {
      console.warn('Falha ao editar comentário:', erro);
      aviso.textContent = erro.message || 'Não foi possível salvar a alteração.';
      caixa.querySelectorAll('button').forEach(b => { b.disabled = false; });
    }
  };
  caixa.querySelector('.btn-edicao-cancelar').addEventListener('click', () => encerrar());
  caixa.querySelector('.btn-edicao-salvar').addEventListener('click', salvar);
  campo.addEventListener('keydown', e => {
    // stopPropagation: Ctrl+Enter e Esc também são atalhos do modal (enviar novo / fechar)
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); salvar(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); encerrar(); }
  });
}

function htmlTooltipComentarios(lista) {
  if (!lista.length) return '';
  return `<div class="btn-comment-tooltip">${lista.map(c => `
    <div class="tt-item">
      <div class="tt-autor">${esc(c.autor || 'Anônimo')}</div>
      <div class="tt-texto">${esc(c.texto)}</div>
      <div class="tt-data">${esc(c.dataHora || '')}</div>
    </div>`).join('')}</div>`;
}

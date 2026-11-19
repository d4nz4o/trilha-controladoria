let dadosGlobais = null;
let periodos = [];
let mesSelecionado = "";
let mesComparacao = "";
let comentariosRevisao = {};   // chave -> Array de objetos { empresa, mesAtual, mesBase, nv1, nv2, nv3, texto, autor, dataHora }
let comentarioAtivo = null;
let elementoFocoAnterior = null;
let erroCarregarComentarios = false;

const GRUPOS_BP = [
  { nome: 'Ativo circulante', sinal: 1 },
  { nome: 'Ativo não circulante', sinal: 1 },
  { nome: 'Passivo circulante', sinal: -1 },
  { nome: 'Passivo não circulante', sinal: -1 },
  { nome: 'Patrimônio líquido', sinal: -1 }
];

// Grupos da DR: no BP, o saldo deles entra no PL como "Resultado do período" (o BP fecha antes do encerramento)
const GRUPOS_RESULTADO = ['Receita líquida', 'Custos', 'Despesas', 'Outras despesas / receitas',
  'Receitas financeiras', 'Despesas financeiras', 'IR / CSLL', 'Transitória'];

const TOTAIS_BP = [
  { nome: 'Total do ativo', grupos: ['Ativo circulante', 'Ativo não circulante'] },
  { nome: 'Total do passivo + patrimônio líquido', grupos: ['Passivo circulante', 'Passivo não circulante', 'Patrimônio líquido'] }
];

let EMPRESAS = [];

function calcularDelta(valAtual, valComp) {
  const diff = valAtual - valComp;
  if (Number.isNaN(diff)) return { diffStr: "–", percStr: "–", classe: "neutral" };   // mês inexistente
  const arred = Math.round(diff);
  const sinal = arred > 0 ? "+" : "";
  const diffStr = arred === 0 ? "–" : `${sinal}${formatarMoeda(diff)}`;
  const classe = arred > 0 ? "positive" : arred < 0 ? "negative" : "neutral";

  if (!valAtual) {
    return { diffStr, percStr: "–", classe };
  }

  const perc = (diff / Math.abs(valAtual)) * 100;   // Δ % = Δ $ / mês atual
  const percStr = arred === 0
    ? "0,0%"
    : `${perc > 0 ? "+" : ""}${perc.toFixed(1).replace('.', ',')}%`;

  return { diffStr, percStr, classe };
}

/* ---------- Expandir e recolher ---------- */

function alternarElemento(idClasse, el, e) {
  if (e) e.stopPropagation();

  const btn = el.querySelector('.btn-expand-pill');
  if (!btn) return;

  const estaAberto = btn.classList.contains('is-open');

  if (estaAberto) {
    document.querySelectorAll(`.${idClasse}`).forEach(linha => {
      linha.classList.add('recolhido');
      const subBtn = linha.querySelector('.btn-expand-pill');
      if (subBtn) subBtn.classList.remove('is-open');

      if (linha.dataset.nv2Class) {
        document.querySelectorAll(`.${linha.dataset.nv2Class}`).forEach(nv3 => nv3.classList.add('recolhido'));
      }
    });
    btn.classList.remove('is-open');
  } else {
    const seletor = el.dataset.nv2Class ? `.${idClasse}` : `.${idClasse}:not(.tr-nv3)`;
    document.querySelectorAll(seletor).forEach(linha => linha.classList.remove('recolhido'));
    btn.classList.add('is-open');
  }
}

/* ---------- Comentários de revisão analítica ---------- */

async function carregarComentarios() {
  const { mapa, erro } = await carregarComentariosRevisao(EMPRESAS);
  erroCarregarComentarios = erro;
  if (!erro) comentariosRevisao = mapa;
}

function abrirModalComentario(e, btn) {
  if (e) e.stopPropagation();
  elementoFocoAnterior = btn;
  const { empId, empNome, nv1, nv2, nv3, rotulo } = btn.dataset;
  comentarioAtivo = {
    empId, empNome, nv1, nv2, nv3, rotulo,
    chave: chaveComentario(empId, mesSelecionado, nv1, nv2, nv3)
  };
  
  const lista = comentariosRevisao[comentarioAtivo.chave] || [];

  document.getElementById('modalSubtitulo').innerHTML =
    `<span class="tag-emp">${esc(empNome)}</span> ` +
    `<span class="tag-mes">${formatarDataPeriodo(mesSelecionado)}</span>`;

  const historico = document.getElementById('chatHistorico');
  historico.innerHTML = htmlHistoricoComentarios(lista);

  setTimeout(() => { historico.scrollTop = historico.scrollHeight; }, 50);

  const campoTexto = document.getElementById('txtComentario');
  campoTexto.value = '';
  document.getElementById('modalComentario').classList.add('active');
  aplicarEstadoComentario(erroCarregarComentarios);   // autor (colaborador) e permissão de comentar
}

function fecharModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('modalComentario').classList.remove('active');
  comentarioAtivo = null;
  if (elementoFocoAnterior) elementoFocoAnterior.focus();
  elementoFocoAnterior = null;
}

async function salvarComentario() {
  if (!comentarioAtivo) return;
  const ativo = comentarioAtivo;
  const texto = document.getElementById('txtComentario').value.trim();
  const feedback = document.getElementById('feedbackComentario');
  const btnSalvar = document.querySelector('#modalComentario .btn-chat-send');

  if (btnSalvar && btnSalvar.disabled) return;

  if (!texto) {
    feedback.textContent = 'Escreva um comentário antes de enviar.';
    document.getElementById('txtComentario').focus();
    return;
  }

  if (btnSalvar) btnSalvar.disabled = true;
  feedback.textContent = 'Salvando comentário…';

  try {
    await gravarComentarioRevisao({
      empresas: EMPRESAS, empId: ativo.empId, mesAtual: mesSelecionado, mesBase: mesComparacao,
      nv1: ativo.nv1, nv2: ativo.nv2, nv3: ativo.nv3, texto
    });
  } catch (erro) {
    console.warn('Falha ao gravar comentário:', erro);
    feedback.textContent = erro.message || 'Não foi possível salvar o comentário. Tente novamente.';
    if (btnSalvar) btnSalvar.disabled = false;
    return;
  }

  await carregarComentarios();
  if (erroCarregarComentarios) {
    document.getElementById('txtComentario').value = '';
    feedback.textContent = 'Comentário salvo, mas não foi possível atualizar o histórico. Atualize a página para conferir.';
    if (btnSalvar) btnSalvar.disabled = false;
    return;
  }

  if (btnSalvar) btnSalvar.disabled = false;
  fecharModal();
  renderizarTabela();
}

document.addEventListener('keydown', (ev) => {
  const modal = document.getElementById('modalComentario');
  if (!modal.classList.contains('active')) return;
  if (ev.key === 'Escape') {
    fecharModal();
    return;
  }
  if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
    ev.preventDefault();
    salvarComentario();
    return;
  }
  if (ev.key === 'Tab') {
    const focaveis = [...modal.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')]
      .filter(el => !el.hidden && el.getClientRects().length);
    if (!focaveis.length) return;
    const primeiro = focaveis[0];
    const ultimo = focaveis[focaveis.length - 1];
    if (ev.shiftKey && (document.activeElement === primeiro || !modal.contains(document.activeElement))) {
      ev.preventDefault();
      ultimo.focus();
    } else if (!ev.shiftKey && (document.activeElement === ultimo || !modal.contains(document.activeElement))) {
      ev.preventDefault();
      primeiro.focus();
    }
  }
});

/* ---------- Carga de dados ---------- */

async function carregarDadosBalanco() {
  try {
    const { dados, avisos } = await carregarBase(GRUPOS_BP, [], { resultadoNoPL: GRUPOS_RESULTADO });
    dadosGlobais = dados;
    periodos = dados.periodos;
    EMPRESAS = dados.empresas;
    if (!periodos.length || !EMPRESAS.length) throw new Error('Nenhum dado de balanço encontrado nos CSVs.');

    mesSelecionado = mesInicial(periodos);
    mesComparacao = mesAnteriorDe(periodos, mesSelecionado);

    const aviso = document.getElementById('avisoDados');
    aviso.textContent = avisos.join(' ');
    aviso.hidden = avisos.length === 0;

    await carregarComentarios();

    iniciarVisao(EMPRESAS);
    popularSeletoresMeses();
    atualizarBotoesMes();
    renderizarTabela();
    aplicarNivel();   // na abertura, respeita o nível lembrado
  } catch (erro) {
    console.error("Erro ao carregar dados do Balanço Patrimonial:", erro);
    document.getElementById('tbodyBalanco').innerHTML =
      `<tr><td class="bp-estado" colspan="20"><strong>Não foi possível carregar os dados.</strong>
       Confira as fontes de dados (${rotuloFonte('balancetes')}, ${rotuloFonte('classificacao')} e ${rotuloFonte('empresas')}) e a conexão.
       <br><small>${esc(erro.message)}</small></td></tr>`;
  }
}

function popularSeletoresMeses() {
  const selRef = document.getElementById('selectMesRef');
  selRef.innerHTML = '';
  periodos.forEach((p) => {
    const optRef = document.createElement('option');
    optRef.value = p;
    optRef.textContent = formatarDataPeriodo(p);
    if (p === mesSelecionado) optRef.selected = true;
    selRef.appendChild(optRef);
  });
}

function alterarPeriodos() {
  mesSelecionado = document.getElementById('selectMesRef').value;
  mesComparacao = mesAnteriorDe(periodos, mesSelecionado);
  salvarSelecoes({ mes: mesSelecionado });
  atualizarBotoesMes();
  renderizarTabela();
}

function navegarMes(delta) {
  const novo = periodos[periodos.indexOf(mesSelecionado) + delta];
  if (!novo) return;
  document.getElementById('selectMesRef').value = novo;
  alterarPeriodos();
}

function atualizarBotoesMes() {
  const i = periodos.indexOf(mesSelecionado);
  document.getElementById('btnMesAnterior').disabled = i <= 0;
  document.getElementById('btnMesProximo').disabled = i < 0 || i >= periodos.length - 1;
}

/* ---------- Montagem da tabela ---------- */

function celulaAtualComComentario(valAtual, emp, ref) {
  const chave = chaveComentario(emp.id, mesSelecionado, ref.nv1, ref.nv2, ref.nv3);
  const lista = comentariosRevisao[chave] || [];
  const temComentarios = lista.length > 0;
  const rotulo = temComentarios ? 'Ver revisão analítica' : 'Adicionar revisão analítica';
  
  const tooltipHtml = htmlTooltipComentarios(lista);

  return `<td class="num"><div class="cell-val-group">
    <div class="btn-comment-wrapper">
      <button type="button" class="btn-comment ${temComentarios ? 'has-comment' : ''}"
        aria-label="${esc(rotulo)} (${esc(emp.nome)})"
        data-emp-id="${esc(emp.id)}" data-emp-nome="${esc(emp.nome)}"
        data-nv1="${esc(ref.nv1)}" data-nv2="${esc(ref.nv2)}" data-nv3="${esc(ref.nv3)}" data-rotulo="${esc(ref.rotulo)}"
        onclick="abrirModalComentario(event, this)">${ICONE_COMENTARIO}</button>
      ${tooltipHtml}
    </div>
    <span>${formatarMoeda(valAtual)}</span>
  </div></td>`;
}

function contextoContas() {
  return { empresas: EMPRESAS, mesAtual: mesSelecionado, mesBase: mesComparacao, comEliminacoes: true,
           tendencia: mesesTendencia(periodos, mesSelecionado),
           somar: somaEmp, formatar: formatarMoeda, delta: calcularDelta };
}

function somaEmp(itens, empId, mes) {
  return itens.reduce((acc, i) => acc + (((i.valores[empId] || {})[mes]) || 0), 0);
}

function celulaAtual(valAtual, emp, ref) {
  return ref
    ? celulaAtualComComentario(valAtual, emp, ref)
    : `<td class="num">${formatarMoeda(valAtual)}</td>`;
}

function celulasNumericas(itens, ref) {
  if (modoVisao === MODO_EMPRESA) {
    // M1 | Δ (M2 − M1) | M2 | Δ (M3 − M2) | M3 (mês selecionado, com o comentário da revisão)
    const emp = empresaSelecionada(EMPRESAS);
    const { m1, m2, m3 } = mesesTendencia(periodos, mesSelecionado);
    const valor = m => temMes(emp, m) ? somaEmp(itens, emp.id, m) : NaN;   // mês sem balancete: "–"
    const v1 = valor(m1), v2 = valor(m2), v3 = somaEmp(itens, emp.id, m3);
    return celulaValor(v1, formatarMoeda) +
           celulaDeltaDupla(calcularDelta(v2, v1)) +
           celulaValor(v2, formatarMoeda) +
           celulaDeltaDupla(calcularDelta(v3, v2)) +
           marcarMesSelecionado(celulaAtual(v3, emp, ref));
  }

  let total = 0;
  const porEmpresa = empresasDoConsolidado(EMPRESAS).map(emp => {   // ex.: VDMG não aparece aqui
    const valAtual = somaEmp(itens, emp.id, mesSelecionado) * fatorEmpresa(emp);   // método proporcional: × participação
    total += valAtual;
    return celulaAtual(valAtual, emp, ref);
  }).join('');
  // Eliminações: saldos entre empresas do grupo (partes relacionadas)
  const elim = eliminacaoDosItens(itens, EMPRESAS, somaEmp, mesSelecionado);
  return porEmpresa + `<td class="num td-eliminacoes">${formatarMoeda(elim)}</td>` +
         `<td class="num td-consolidado">${formatarMoeda(total + elim)}</td>`;
}

/* Consolidada contábil: PL dividido entre controladores e não controladores (linhas informativas, fora dos totais) */
function linhasNaoControladores(itensPL) {
  const empresas = empresasDoConsolidado(EMPRESAS);
  if (modoVisao !== MODO_CONSOLIDADA || !empresas.some(e => fracaoNaoControladores(e) > 0)) return '';
  const pl = empresas.map(e => somaEmp(itensPL, e.id, mesSelecionado));
  const nc = empresas.map((e, i) => pl[i] * fracaoNaoControladores(e));
  const plConsolidado = pl.reduce((t, v) => t + v, 0) + eliminacaoDosItens(itensPL, EMPRESAS, somaEmp, mesSelecionado);
  const ncTotal = nc.reduce((t, v) => t + v, 0);
  const linha = (rotulo, porEmp, consolidado, dica) =>
    `<tr class="tr-memo"><td title="${esc(dica)}">${esc(rotulo)}</td>` +
    porEmp.map(v => `<td class="num">${formatarMoeda(v)}</td>`).join('') +
    `<td class="num td-eliminacoes"></td><td class="num td-consolidado">${formatarMoeda(consolidado)}</td></tr>`;
  return linha('PL atribuível aos controladores', pl.map((v, i) => v - nc[i]), plConsolidado - ncTotal,
               'Patrimônio líquido menos a parte dos outros sócios') +
         linha('Participação de não controladores', nc, ncTotal,
               'Parte do patrimônio líquido das controladas que pertence a outros sócios (100% − participação do grupo)');
}

/* Linha de conferência: total do ativo − total do passivo e PL (deve ser zero) */
function celulasConferencia(ativo, passivoPL) {
  const dif = (empId, mes) => somaEmp(ativo, empId, mes) - somaEmp(passivoPL, empId, mes);
  const celula = (v, extra = '') => {
    if (Number.isNaN(v)) return `<td class="num ${extra}">–</td>`;
    const ok = Math.abs(v) < UNIDADE / 2;
    return `<td class="num ${extra} ${ok ? 'conf-ok' : 'conf-erro'}">${ok ? '✓' : formatarMoeda(v)}</td>`;
  };
  if (modoVisao === MODO_EMPRESA) {
    const emp = empresaSelecionada(EMPRESAS);
    const { m1, m2, m3 } = mesesTendencia(periodos, mesSelecionado);
    const v = m => temMes(emp, m) ? dif(emp.id, m) : NaN;
    return celula(v(m1)) + '<td class="num td-delta"></td>' + celula(v(m2)) + '<td class="num td-delta"></td>' +
           marcarMesSelecionado(celula(somaEmp(ativo, emp.id, m3) - somaEmp(passivoPL, emp.id, m3)));
  }
  let total = 0;
  const porEmpresa = empresasDoConsolidado(EMPRESAS).map(emp => {
    const v = dif(emp.id, mesSelecionado) * fatorEmpresa(emp); total += v; return celula(v);
  }).join('');
  const elim = eliminacaoDosItens(ativo, EMPRESAS, somaEmp, mesSelecionado) - eliminacaoDosItens(passivoPL, EMPRESAS, somaEmp, mesSelecionado);
  return porEmpresa + celula(elim, 'td-eliminacoes') + celula(total + elim, 'td-consolidado');
}

/* Coluna de indicadores (só na visão por empresa): ../indicadores.js */
function atualizarIndicadores() {
  const painel = document.getElementById('painelIndicadores');
  if (modoVisao !== MODO_EMPRESA) { painel.hidden = true; painel.innerHTML = ''; return; }
  const emp = empresaSelecionada(EMPRESAS);
  const { m2 } = mesesTendencia(periodos, mesSelecionado);
  const anterior = temMes(emp, m2) ? m2 : null;
  const soma = (filtro, mes) => somaEmp(dadosGlobais.itens.filter(filtro), emp.id, mes);
  renderizarPainelIndicadores(painel, {
    titulo: 'Indicadores',
    subtitulo: `${emp.nome} · ${formatarDataPeriodo(mesSelecionado)}`,
    mesAnterior: anterior ? formatarDataPeriodo(anterior) : '',
    grupos: indicadoresBP(soma, mesSelecionado, anterior),
    nota: 'Passe o mouse sobre um indicador para ver a fórmula. Seta verde: melhorou em relação ao mês anterior.'
  });
}

function renderizarTabela() {
  const abertos = [...document.querySelectorAll('tr[data-slug] .btn-expand-pill.is-open')]
    .map(btn => btn.closest('tr').dataset.slug);

  const thead = document.getElementById('theadBalanco');
  const tbody = document.getElementById('tbodyBalanco');

  renderizarCabecalho(thead, EMPRESAS, mesesTendencia(periodos, mesSelecionado), true);

  let htmlBody = '';
  const gruposNv1 = {};

  GRUPOS_BP
    .map((g, idx) => {
      const doGrupo = dadosGlobais.itens.filter(i => i.classificacao_nv1 === g.nome);
      const o1 = doGrupo.map(i => i.o1).filter(v => typeof v === 'number');
      return { nome: g.nome, idx, doGrupo, o: o1.length ? Math.min(...o1) : undefined };
    })
    .filter(g => g.doGrupo.length)
    .sort((a, b) => cmpOrdem(a.o, b.o) || a.idx - b.idx)
    .forEach(g => {
      gruposNv1[g.nome] = [...g.doGrupo].sort((a, b) => cmpOrdem(a.o2, b.o2) || cmpOrdem(a.o3, b.o3));
    });

  const ordemExibida = Object.keys(gruposNv1);

  Object.keys(gruposNv1).forEach((nv1) => {
    const itensDoGrupo = gruposNv1[nv1];
    const slugGrupo = 'grp-' + nv1.toLowerCase().replace(/[^a-z0-9]/g, '-');

    htmlBody += `<tr class="tr-grupo" data-slug="${slugGrupo}" onclick="alternarElemento('${slugGrupo}', this, event)">`;
    htmlBody += `<td><span class="btn-expand-pill"></span>${esc(nv1)}</td>`;
    htmlBody += celulasNumericas(itensDoGrupo);
    htmlBody += `</tr>`;

    const agrupadoNv2 = {};
    itensDoGrupo.forEach(item => {
      const nv2 = item.classificacao_nv2 || "Geral";
      if (!agrupadoNv2[nv2]) agrupadoNv2[nv2] = [];
      agrupadoNv2[nv2].push(item);
    });

    let nv2Count = 0;
    Object.keys(agrupadoNv2).forEach(nv2Name => {
      nv2Count++;
      const subItens = agrupadoNv2[nv2Name];
      const slugNv2 = `${slugGrupo}-nv2-${nv2Count}`;
      const temNv3 = subItens.some(i => i.classificacao_nv3 !== null);

      // BUSCA EXAUSTIVA DE COMENTÁRIOS NO NV3 PARA SINALIZAR O NV2
      const idsExibidos = empresasExibidas(EMPRESAS).map(e => e.id);
      const temComentarioEmNv3 = subItens.some(itemNv3 => {
        if (!itemNv3.classificacao_nv3) return false;
        return Object.keys(comentariosRevisao).some(chave => {
          const msgs = comentariosRevisao[chave];
          if (!Array.isArray(msgs) || msgs.length === 0) return false;

          const [cEmp, cMes, cNv1, cNv2, cNv3] = chave.split('|');
          return idsExibidos.includes(cEmp) &&
                 cMes === mesSelecionado &&
                 cNv1 === nv1 &&
                 cNv2 === (itemNv3.classificacao_nv2 || '') &&
                 cNv3 === itemNv3.classificacao_nv3;
        });
      });

      const classeComentarioNv2 = temComentarioEmNv3 ? 'tr-nv2-comentado' : '';

      htmlBody += `<tr class="tr-filha recolhido ${slugGrupo} ${classeComentarioNv2}" data-nv2-class="${slugNv2}" ${temNv3 ? `data-slug="${slugNv2}"` : ''} ${temNv3 ? `onclick="alternarElemento('${slugNv2}', this, event)"` : ''}>`;
      htmlBody += `<td class="nivel-2">${temNv3 ? '<span class="btn-expand-pill"></span>' : '<span class="bullet-item"></span>'}${esc(nv2Name)}</td>`;
      htmlBody += celulasNumericas(subItens, { nv1, nv2: subItens[0].classificacao_nv2 || '', nv3: '', rotulo: nv2Name });
      htmlBody += `</tr>`;

      if (temNv3) {
        subItens.forEach(itemNv3 => {
          if (!itemNv3.classificacao_nv3) return;

          htmlBody += `<tr class="tr-nv3 recolhido ${slugGrupo} ${slugNv2}">`;
          htmlBody += `<td class="nivel-3">${esc(itemNv3.classificacao_nv3)}${botaoContas(itemNv3)}</td>`;
          htmlBody += celulasNumericas([itemNv3], { nv1, nv2: itemNv3.classificacao_nv2 || '', nv3: itemNv3.classificacao_nv3, rotulo: itemNv3.classificacao_nv3 });
          htmlBody += `</tr>`;
        });
      }
    });

    TOTAIS_BP.filter(t => ordemExibida.filter(n => t.grupos.includes(n)).pop() === nv1).forEach(t => {
      const itensTotal = t.grupos.flatMap(g => gruposNv1[g] || []);
      if (!itensTotal.length) return;
      htmlBody += `<tr class="tr-total"><td>${esc(t.nome)}</td>${celulasNumericas(itensTotal)}</tr>`;
    });
  });

  // Consolidada contábil: controladores × não controladores
  htmlBody += linhasNaoControladores(gruposNv1['Patrimônio líquido'] || []);

  // Conferência: ativo − (passivo + PL)
  const ativoItens = ['Ativo circulante', 'Ativo não circulante'].flatMap(g => gruposNv1[g] || []);
  const passivoItens = ['Passivo circulante', 'Passivo não circulante', 'Patrimônio líquido'].flatMap(g => gruposNv1[g] || []);
  if (ativoItens.length || passivoItens.length) {
    htmlBody += `<tr class="tr-conferencia"><td title="Total do ativo menos total do passivo e patrimônio líquido. ✓ = fecha">Conferência (ativo − passivo e PL)</td>${celulasConferencia(ativoItens, passivoItens)}</tr>`;
  }

  tbody.innerHTML = htmlBody;

  const dica = 'Clique em uma linha para abrir os detalhes e use o ícone de comentário para registrar a revisão analítica.';
  atualizarIndicadores();
  document.getElementById('tabelaLegenda').textContent = modoVisao === MODO_EMPRESA
    ? `Três meses até o selecionado (destacado). Cada Δ compara o mês à direita com o da esquerda; Δ % = Δ $ dividido pelo mês mais recente do par. ${dica}`
    : `Consolidado contábil: controladas com 100% das linhas; a parte dos outros sócios aparece em "Participação de não controladores". Saldos do mês selecionado por empresa e consolidado. Eliminações: saldos entre empresas do consolidado (contas com contraparte no plano de contas); ` +
      `diferença na conferência do consolidado = saldos entre empresas que não batem de um lado para o outro. ${dica}`;

  abertos.forEach(slug => {
    const linha = tbody.querySelector(`tr[data-slug="${slug}"]`);
    if (!linha) return;
    linha.querySelector('.btn-expand-pill').classList.add('is-open');
    const seletor = linha.dataset.nv2Class ? `.${slug}` : `.${slug}:not(.tr-nv3)`;
    tbody.querySelectorAll(seletor).forEach(l => l.classList.remove('recolhido'));
  });
  marcarLinhasZeradas(tbody);
}

document.addEventListener('DOMContentLoaded', () => {
  carregarDadosBalanco();
});

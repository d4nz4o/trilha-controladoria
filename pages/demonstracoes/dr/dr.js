/*
  DR (Demonstração do Resultado)
  - Lê os balancetes, classifica as contas pelo plano de contas e ordena pela hierarquia (funções em commons.js).
  - Os valores do balancete são acumulados no ano. A visão "Mensal" subtrai o acumulado do mês anterior.
  - Convenção contábil do arquivo: receita negativa, custo e despesa positivos.
  - Na tela o sinal é sempre invertido: receita positiva, custos e despesas negativos, resultado positivo quando há lucro.
  - Comentários (revisão analítica) usam as mesmas funções do BP, em ../commons.js.
*/

let dadosGlobais = null;
let periodos = [];
let mesSelecionado = "";
let mesComparacao = "";
let EMPRESAS = [];

let visao = "mensal";      // "mensal" | "acumulado"
const sinal = -1;          // fixo: inverte o sinal contábil para exibir a receita positiva

let comentariosRevisao = {};   // chave -> lista de comentários, como no BP
let comentarioAtivo = null;
let elementoFocoAnterior = null;
let erroCarregarComentarios = false;

// Grupos de resultado do balancete (Classificação Nv1). "Transitória" só é lida para conferir se está zerada.
const GRUPOS_DR = [
  { nome: 'Receita líquida', sinal: 1 },
  { nome: 'Custos', sinal: 1 },
  { nome: 'Despesas', sinal: 1 },
  { nome: 'Outras despesas / receitas', sinal: 1 },
  { nome: 'Receitas financeiras', sinal: 1 },
  { nome: 'Despesas financeiras', sinal: 1 },
  { nome: 'IR / CSLL', sinal: 1 },
  { nome: 'Transitória', sinal: 1 }
];
const GRUPOS_DO_BP = ['Ativo circulante', 'Ativo não circulante', 'Passivo circulante', 'Passivo não circulante', 'Patrimônio líquido'];

// Ordem da DR (mesma da planilha). "grupo" soma um ou mais Nv1; "subtotal" soma outros blocos.
const ESTRUTURA = [
  { tipo: "grupo", id: "rl", rotulo: "Receita líquida", nv1s: ["Receita líquida"] },
  { tipo: "grupo", id: "c", rotulo: "Custos", nv1s: ["Custos"] },
  { tipo: "subtotal", id: "lb", rotulo: "Lucro bruto", soma: ["rl", "c"] },
  { tipo: "grupo", id: "d", rotulo: "Despesas gerais e administrativas", nv1s: ["Despesas", "Outras despesas / receitas"] },
  { tipo: "subtotal", id: "rarf", rotulo: "Resultado antes do resultado financeiro", soma: ["lb", "d"] },
  { tipo: "grupo", id: "rfin", rotulo: "Receitas financeiras", nv1s: ["Receitas financeiras"] },
  { tipo: "grupo", id: "dfin", rotulo: "Despesas financeiras", nv1s: ["Despesas financeiras"] },
  { tipo: "subtotal", id: "rf", rotulo: "Resultado financeiro", soma: ["rfin", "dfin"] },
  { tipo: "subtotal", id: "ro", rotulo: "Resultado operacional", soma: ["rarf", "rf"] },
  { tipo: "grupo", id: "ir", rotulo: "IRPJ / CSLL", nv1s: ["IR / CSLL"] },
  { tipo: "subtotal", id: "rp", rotulo: "Resultado do período", soma: ["ro", "ir"], destaque: true }
];

/* ---------- Valores ---------- */

function isoMesAnterior(iso) {
  const [a, m] = iso.split("-").map(Number);
  if (m === 1) return null;
  const d = new Date(Date.UTC(a, m - 1, 0));
  return d.toISOString().slice(0, 10);
}

function acumuladoItem(item, empId, p) {
  return ((item.valores[empId] || {})[p]) || 0;
}

function valorItem(item, empId, p) {
  const ytd = acumuladoItem(item, empId, p);
  if (visao === "acumulado") return ytd;
  const ant = isoMesAnterior(p);
  if (ant === null) return ytd;
  if (!periodos.includes(ant)) return NaN;
  return ytd - acumuladoItem(item, empId, ant);
}

function somaEmp(itens, empId, p) {
  if (!p) return NaN;   // mês inexistente (começo da série)
  return itens.reduce((acc, i) => acc + valorItem(i, empId, p), 0);
}

function calcularDelta(atual, comp) {
  const diff = atual - comp;
  if (isNaN(diff)) return { diffStr: "–", percStr: "–", classe: "neutral" };

  // Arredondado em R$ mil, como aparece na tela: abaixo de R$ 500 a variação é exibida como zero (cinza)
  const arred = Math.round(diff / UNIDADE);
  const diffExibido = diff * sinal;
  const prefixo = Math.round(diffExibido / UNIDADE) > 0 ? "+" : "";
  const diffStr = arred === 0 ? "–" : `${prefixo}${formatarMoeda(diffExibido)}`;
  const classe = arred < 0 ? "positive" : arred > 0 ? "negative" : "neutral";

  if (!atual) return { diffStr, percStr: "–", classe };

  const perc = (diff / Math.abs(atual)) * 100 * sinal;   // Δ % = Δ $ / mês atual
  const percStr = arred === 0 ? "0,0%" : formatarPercentual(perc);
  return { diffStr, percStr, classe };
}

function fmt(valorContabil) {
  return formatarMoeda(valorContabil * sinal);
}

/* ---------- Controles ---------- */

function atualizarBotoesTipoValor() {
  document.querySelectorAll("[data-visao]").forEach(btn => {
    const ativo = btn.dataset.visao === visao;
    btn.classList.toggle("is-active", ativo);
    btn.setAttribute("aria-pressed", ativo);
  });
}

function definirVisao(novaVisao) {
  visao = novaVisao;
  salvarSelecoes({ tipo: visao });
  atualizarBotoesTipoValor();
  renderizarTabela();
}

function popularSeletoresMeses() {
  const selRef = document.getElementById("selectMesRef");
  selRef.innerHTML = "";
  periodos.forEach(p => selRef.appendChild(new Option(formatarDataPeriodo(p), p, false, p === mesSelecionado)));
}

function alterarPeriodos() {
  mesSelecionado = document.getElementById("selectMesRef").value;
  mesComparacao = mesAnteriorDe(periodos, mesSelecionado);
  salvarSelecoes({ mes: mesSelecionado });
  atualizarBotoesMes();
  renderizarTabela();
}

function navegarMes(delta) {
  const novo = periodos[periodos.indexOf(mesSelecionado) + delta];
  if (!novo) return;
  document.getElementById("selectMesRef").value = novo;
  alterarPeriodos();
}

function atualizarBotoesMes() {
  const i = periodos.indexOf(mesSelecionado);
  document.getElementById("btnMesAnterior").disabled = i <= 0;
  document.getElementById("btnMesProximo").disabled = i < 0 || i >= periodos.length - 1;
}

/* ---------- Expandir e recolher ---------- */

function alternarElemento(idClasse, el, e) {
  if (e) e.stopPropagation();

  const btn = el.querySelector(".btn-expand-pill");
  if (!btn) return;

  if (btn.classList.contains("is-open")) {
    document.querySelectorAll(`.${idClasse}`).forEach(linha => {
      linha.classList.add("recolhido");
      const subBtn = linha.querySelector(".btn-expand-pill");
      if (subBtn) subBtn.classList.remove("is-open");
      if (linha.dataset.nv2Class) {
        document.querySelectorAll(`.${linha.dataset.nv2Class}`).forEach(nv3 => nv3.classList.add("recolhido"));
      }
    });
    btn.classList.remove("is-open");
  } else {
    const seletor = el.dataset.nv2Class ? `.${idClasse}` : `.${idClasse}:not(.tr-nv3)`;
    document.querySelectorAll(seletor).forEach(linha => linha.classList.remove("recolhido"));
    btn.classList.add("is-open");
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

  document.getElementById('modalSubtitulo').innerHTML =
    `<span class="tag-emp">${esc(empNome)}</span> ` +
    `<span class="tag-mes">${formatarDataPeriodo(mesSelecionado)}</span>`;

  const historico = document.getElementById('chatHistorico');
  historico.innerHTML = htmlHistoricoComentarios(comentariosRevisao[comentarioAtivo.chave] || []);
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
      empresas: EMPRESAS, empId: ativo.empId, mesAtual: mesSelecionado,
      nv1: ativo.nv1, nv2: ativo.nv2, nv3: ativo.nv3, texto
    });
  } catch (erro) {
    console.warn('Falha ao gravar comentário:', erro);
    feedback.textContent = erro.message || 'Não foi possível salvar o comentário. Tente novamente.';
    if (btnSalvar) btnSalvar.disabled = false;
    return;
  }

  await carregarComentarios();
  if (btnSalvar) btnSalvar.disabled = false;
  if (erroCarregarComentarios) {
    document.getElementById('txtComentario').value = '';
    feedback.textContent = 'Comentário salvo, mas não foi possível atualizar o histórico. Atualize a página para conferir.';
    return;
  }
  // O popup continua aberto: histórico atualizado com o novo comentário e campo limpo
  renderizarTabela();   // ícone da célula
  await atualizarModalAposComentario(ativo.chave);
  feedback.textContent = 'Comentário registrado.';
}

document.addEventListener('keydown', ev => {
  if (!document.getElementById('modalComentario').classList.contains('active')) return;
  if (ev.key === 'Escape') fecharModal();
  if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); salvarComentario(); }
});

/* ---------- Carga de dados ---------- */

async function carregarDadosDR() {
  try {
    const { dados, avisos } = await carregarBase(GRUPOS_DR, ["Transitória"]);
    dadosGlobais = dados;
    periodos = dados.periodos;
    EMPRESAS = dados.empresas;
    if (!periodos.length || !EMPRESAS.length) throw new Error("Nenhum dado de resultado encontrado nos CSVs.");

    const desconhecidos = [...dados.nv1Ignorados].filter(n => !GRUPOS_DO_BP.includes(n));
    if (desconhecidos.length) {
      avisos.push(`Grupos do ${rotuloFonte('classificacao')} que não entram na DR nem no BP: ${desconhecidos.join(", ")}.`);
    }

    const transitoria = dados.itens.filter(i => i.classificacao_nv1 === "Transitória");
    const saldoTransitoria = transitoria.some(i => EMPRESAS.some(e => periodos.some(p => Math.abs(acumuladoItem(i, e.id, p)) >= 1)));
    if (saldoTransitoria) avisos.push("Há saldo no grupo Transitória; ele não está incluído na DR.");

    mesSelecionado = mesInicial(periodos);
    mesComparacao = mesAnteriorDe(periodos, mesSelecionado);
    visao = lerSelecoes().tipo === "acumulado" ? "acumulado" : "mensal";
    atualizarBotoesTipoValor();

    const aviso = document.getElementById("avisoDados");
    aviso.textContent = avisos.join(" ");
    aviso.hidden = avisos.length === 0;

    await carregarComentarios();

    iniciarVisao(EMPRESAS);
    popularSeletoresMeses();
    atualizarBotoesMes();
    renderizarTabela();
    aplicarNivel();   // na abertura, respeita o nível lembrado
  } catch (erro) {
    console.error("Erro ao carregar dados da DR:", erro);
    document.getElementById("tbodyDR").innerHTML =
      `<tr><td class="bp-estado" colspan="20"><strong>Não foi possível carregar os dados.</strong>
       Confira as fontes de dados (${rotuloFonte('balancetes')}, ${rotuloFonte('classificacao')} e ${rotuloFonte('empresas')}) e a conexão.
       <br><small>${esc(erro.message)}</small></td></tr>`;
  }
}

/* ---------- Montagem da tabela ---------- */

// Popup com autor, comentário e data ao passar o mouse
function celulaAtualComComentario(valAtual, emp, ref) {
  const chave = chaveComentario(emp.id, mesSelecionado, ref.nv1, ref.nv2, ref.nv3);
  const lista = comentariosRevisao[chave] || [];
  const c = lista.length > 0;
  const rotulo = c ? "Ver revisão analítica" : "Adicionar revisão analítica";
  const tooltipHtml = htmlTooltipComentarios(lista);

  return `<td class="num"><div class="cell-val-group">
    <div class="btn-comment-wrapper">
      <button type="button" class="btn-comment ${c ? "has-comment" : ""}"
        aria-label="${esc(rotulo)} (${esc(emp.nome)})"
        data-emp-id="${esc(emp.id)}" data-emp-nome="${esc(emp.nome)}"
        data-nv1="${esc(ref.nv1)}" data-nv2="${esc(ref.nv2)}" data-nv3="${esc(ref.nv3)}" data-rotulo="${esc(ref.rotulo)}"
        onclick="abrirModalComentario(event, this)">${ICONE_COMENTARIO}</button>
      ${tooltipHtml}
    </div>
    <span>${fmt(valAtual)}</span>
  </div></td>`;
}

function celulaAtual(atual, emp, ref) {
  return ref ? celulaAtualComComentario(atual, emp, ref) : `<td class="num">${fmt(atual)}</td>`;
}

function celulasNumericas(porEmp, ref) {
  if (modoVisao === MODO_EMPRESA) {
    // M1 | Δ (M2 − M1) | M2 | Δ (M3 − M2) | M3 (mês selecionado, com o comentário da revisão)
    const emp = empresaSelecionada(EMPRESAS);
    const { m1, comp, atual } = porEmp[emp.id];
    return celulaValor(m1, fmt) +
           celulaDeltaDupla(calcularDelta(comp, m1)) +
           celulaValor(comp, fmt) +
           celulaDeltaDupla(calcularDelta(atual, comp)) +
           marcarMesSelecionado(celulaAtual(atual, emp, ref));
  }

  let total = 0;
  const porEmpresa = empresasDoConsolidado(EMPRESAS).map(emp => {   // ex.: VDMG não aparece aqui
    const atual = porEmp[emp.id].atual * fatorEmpresa(emp);   // método proporcional: × participação
    total += atual;
    return celulaAtual(atual, emp, ref);
  }).join("");
  const elim = porEmp.__elim || 0;
  return porEmpresa + `<td class="num td-eliminacoes">${fmt(elim)}</td><td class="num td-consolidado">${fmt(total + elim)}</td>`;
}

/* Consolidada contábil: resultado dividido entre controladores e não controladores (linhas informativas) */
function linhasNaoControladores(resultado) {
  const empresas = empresasDoConsolidado(EMPRESAS);
  if (modoVisao !== MODO_CONSOLIDADA || !empresas.some(e => fracaoNaoControladores(e) > 0)) return "";
  const rp = empresas.map(e => resultado[e.id].atual);
  const nc = empresas.map((e, i) => rp[i] * fracaoNaoControladores(e));
  const consolidado = rp.reduce((t, v) => t + v, 0) + (resultado.__elim || 0);
  const ncTotal = nc.reduce((t, v) => t + v, 0);
  const linha = (rotulo, porEmp, cons, dica) =>
    `<tr class="tr-memo"><td title="${esc(dica)}">${esc(rotulo)}</td>` +
    porEmp.map(v => `<td class="num">${fmt(v)}</td>`).join("") +
    `<td class="num td-eliminacoes"></td><td class="num td-consolidado">${fmt(cons)}</td></tr>`;
  return linha("Atribuível aos controladores", rp.map((v, i) => v - nc[i]), consolidado - ncTotal,
               "Resultado do período menos a parte dos outros sócios") +
         linha("Atribuível a não controladores", nc, ncTotal,
               "Parte do resultado das controladas que pertence a outros sócios (100% − participação do grupo)");
}

function contextoContas() {
  return { empresas: EMPRESAS, mesAtual: mesSelecionado, mesBase: mesComparacao, comEliminacoes: true,
           tendencia: mesesTendencia(periodos, mesSelecionado),
           somar: somaEmp, formatar: fmt, delta: calcularDelta };
}

function valoresDosItens(itens) {
  const porEmp = {};
  const { m1, m2 } = mesesTendencia(periodos, mesSelecionado);
  EMPRESAS.forEach(emp => {
    const valor = m => temMes(emp, m) ? somaEmp(itens, emp.id, m) : NaN;   // mês sem balancete: "–"
    porEmp[emp.id] = { m1: valor(m1), comp: valor(m2), atual: somaEmp(itens, emp.id, mesSelecionado) };
  });
  // Eliminações do mês selecionado (visões consolidadas): receitas e custos entre empresas do grupo
  porEmp.__elim = modoVisao === MODO_EMPRESA ? 0 : eliminacaoDosItens(itens, EMPRESAS, somaEmp, mesSelecionado);
  return porEmp;
}

function somarBlocos(ids, totais) {
  const porEmp = {};
  EMPRESAS.forEach(emp => {
    porEmp[emp.id] = ids.reduce((acc, id) => ({
      m1: acc.m1 + totais[id][emp.id].m1,
      comp: acc.comp + totais[id][emp.id].comp,
      atual: acc.atual + totais[id][emp.id].atual
    }), { m1: 0, comp: 0, atual: 0 });
  });
  porEmp.__elim = ids.reduce((t, id) => t + (totais[id].__elim || 0), 0);
  return porEmp;
}

function avisoDoPeriodo() {
  if (visao !== "mensal") return "";
  const faltas = [];
  const { m1, m2 } = mesesTendencia(periodos, mesSelecionado);
  const mesesUsados = modoVisao === MODO_EMPRESA ? [mesSelecionado, m2, m1].filter(Boolean) : [mesSelecionado];
  mesesUsados.forEach(p => {
    const ant = isoMesAnterior(p);
    if (ant !== null && !periodos.includes(ant) && !faltas.includes(ant)) faltas.push(ant);
  });
  if (!faltas.length) return "";
  return `Valor mensal indisponível${modoVisao === MODO_EMPRESA ? " para parte da comparação" : ""}: falta o acumulado de ${faltas.map(formatarDataPeriodo).join(" e ")} no ${rotuloFonte('balancetes')}. ` +
         `Use a visão "Acumulado" ou carregue o mês nos balancetes.`;
}

/* Coluna de indicadores (só na visão por empresa): ../indicadores.js.
   Usa os mesmos blocos da tabela (ESTRUTURA) e respeita o seletor Mensal / Acumulado. */
function atualizarIndicadores() {
  const painel = document.getElementById("painelIndicadores");
  if (modoVisao !== MODO_EMPRESA) { painel.hidden = true; painel.innerHTML = ""; return; }
  const emp = empresaSelecionada(EMPRESAS);
  const { m2 } = mesesTendencia(periodos, mesSelecionado);
  const anterior = temMes(emp, m2) ? m2 : null;

  const itensNv1 = nv1s => dadosGlobais.itens.filter(i => nv1s.includes(i.classificacao_nv1));
  const valorBloco = (id, mes) => {
    const b = ESTRUTURA.find(x => x.id === id);
    return b.tipo === "subtotal"
      ? b.soma.reduce((t, filho) => t + valorBloco(filho, mes), 0)
      : somaEmp(itensNv1(b.nv1s), emp.id, mes);
  };
  const bloco = (id, mes) => valorBloco(id, mes) * sinal;   // sinal de exibição: receitas +, custos e despesas −
  const linhas = (pares, mes) => sinal * somaEmp(dadosGlobais.itens.filter(i =>
    pares.some(([n1, n2, n3]) => i.classificacao_nv1 === n1 && (n2 == null || i.classificacao_nv2 === n2) &&
                                 (n3 == null || i.classificacao_nv3 === n3))), emp.id, mes);

  renderizarPainelIndicadores(painel, {
    titulo: "Indicadores",
    subtitulo: `${emp.nome} · ${formatarDataPeriodo(mesSelecionado)} · ${visao === "mensal" ? "valores do mês" : "acumulado no ano"}`,
    mesAnterior: anterior ? formatarDataPeriodo(anterior) : "",
    grupos: indicadoresDR(bloco, linhas, mesSelecionado, anterior),
    nota: "Passe o mouse sobre um indicador para ver a fórmula. Ajustado = sem receita e custo de construção (ICPC 01)."
  });
}

function renderizarTabela() {
  const thead = document.getElementById("theadDR");
  const tbody = document.getElementById("tbodyDR");

  const abertos = [...document.querySelectorAll("tr[data-slug] .btn-expand-pill.is-open")]
    .map(btn => btn.closest("tr").dataset.slug);

  renderizarCabecalho(thead, EMPRESAS, mesesTendencia(periodos, mesSelecionado), true);

  const totais = {};
  let html = "";

  ESTRUTURA.forEach(bloco => {
    if (bloco.tipo === "subtotal") {
      totais[bloco.id] = somarBlocos(bloco.soma, totais);
      html += `<tr class="tr-total ${bloco.destaque ? "tr-resultado" : ""}"><td>${esc(bloco.rotulo)}</td>${celulasNumericas(totais[bloco.id])}</tr>`;
      if (bloco.id === "rp") html += linhasNaoControladores(totais[bloco.id]);
      return;
    }

    const itens = bloco.nv1s.flatMap(nv1 =>
      dadosGlobais.itens
        .filter(i => i.classificacao_nv1 === nv1)
        .sort((a, b) => cmpOrdem(a.o2, b.o2) || cmpOrdem(a.o3, b.o3))
    );
    totais[bloco.id] = valoresDosItens(itens);

    const slugGrupo = `dr-${bloco.id}`;
    html += `<tr class="tr-grupo" data-slug="${slugGrupo}" onclick="alternarElemento('${slugGrupo}', this, event)">`;
    html += `<td><span class="btn-expand-pill"></span>${esc(bloco.rotulo)}</td>${celulasNumericas(totais[bloco.id])}</tr>`;

    const porNv2 = new Map();
    itens.forEach(i => {
      const k = `${i.classificacao_nv1}|${i.classificacao_nv2 || "Geral"}`;
      if (!porNv2.has(k)) porNv2.set(k, []);
      porNv2.get(k).push(i);
    });

    let n = 0;
    porNv2.forEach((sub, k) => {
      n++;
      const nv1 = sub[0].classificacao_nv1;
      const nv2Nome = sub[0].classificacao_nv2 || "Geral";
      const slugNv2 = `${slugGrupo}-nv2-${n}`;
      const temNv3 = sub.some(i => i.classificacao_nv3 !== null);

      // ALTERAÇÃO 1: Destaca Nv2 se algum Nv3 filho possuir comentário
      const temComentarioEmNv3 = sub.some(itemNv3 => {
        if (!itemNv3.classificacao_nv3) return false;
        return empresasExibidas(EMPRESAS).some(emp => {
          const kCom = chaveComentario(emp.id, mesSelecionado, nv1, sub[0].classificacao_nv2 || '', itemNv3.classificacao_nv3);
          return (comentariosRevisao[kCom] || []).length > 0;
        });
      });
      const classeComentarioNv2 = temComentarioEmNv3 ? 'tr-nv2-comentado' : '';

      html += `<tr class="tr-filha recolhido ${slugGrupo} ${classeComentarioNv2}" data-nv2-class="${slugNv2}" ${temNv3 ? `data-slug="${slugNv2}" onclick="alternarElemento('${slugNv2}', this, event)"` : ""}>`;
      html += `<td class="nivel-2">${temNv3 ? '<span class="btn-expand-pill"></span>' : '<span class="bullet-item"></span>'}${esc(nv2Nome)}</td>`;
      html += celulasNumericas(valoresDosItens(sub), { nv1, nv2: sub[0].classificacao_nv2 || "", nv3: "", rotulo: nv2Nome });
      html += "</tr>";

      if (temNv3) {
        sub.forEach(i => {
          if (!i.classificacao_nv3) return;
          html += `<tr class="tr-nv3 recolhido ${slugGrupo} ${slugNv2}"><td class="nivel-3">${esc(i.classificacao_nv3)}${botaoContas(i)}</td>`;
          html += celulasNumericas(valoresDosItens([i]), { nv1, nv2: i.classificacao_nv2 || "", nv3: i.classificacao_nv3, rotulo: `${nv2Nome} › ${i.classificacao_nv3}` });
          html += "</tr>";
        });
      }
    });
  });

  tbody.innerHTML = html;

  abertos.forEach(slug => {
    const linha = tbody.querySelector(`tr[data-slug="${slug}"]`);
    if (!linha) return;
    linha.querySelector(".btn-expand-pill").classList.add("is-open");
    const seletor = linha.dataset.nv2Class ? `.${slug}` : `.${slug}:not(.tr-nv3)`;
    tbody.querySelectorAll(seletor).forEach(l => l.classList.remove("recolhido"));
  });
  marcarLinhasZeradas(tbody);

  const tipoValor = visao === "mensal"
    ? "Valores mensais: acumulado do mês menos o acumulado do mês anterior."
    : "Valores acumulados desde janeiro.";
  const dica = "Use o ícone de comentário para registrar a revisão analítica.";
  atualizarIndicadores();
  document.getElementById("legendaDR").textContent = modoVisao === MODO_EMPRESA
    ? `Três meses até o selecionado (destacado). Cada Δ compara o mês à direita com o da esquerda; Δ % = Δ $ dividido pelo mês mais recente do par. Verde favorece o resultado e vermelho o reduz. Receitas aparecem positivas e custos e despesas negativos. ${tipoValor} ${dica}`
    : `Consolidado contábil: controladas com 100% das linhas; a parte dos outros sócios aparece abaixo do resultado. Eliminações: receitas e custos entre empresas do grupo (contas com contraparte no plano de contas). Valores do mês selecionado por empresa e consolidado. Receitas aparecem positivas e custos e despesas negativos. ${tipoValor} ${dica}`;

  const avisoPeriodo = document.getElementById("avisoPeriodo");
  const texto = avisoDoPeriodo();
  avisoPeriodo.textContent = texto;
  avisoPeriodo.hidden = !texto;
}

document.addEventListener("DOMContentLoaded", carregarDadosDR);


/*
  EXPORTAR PARA EXCEL — baixa a visão que está na tela (BP ou DR) em .xlsx, já formatada.

  - Mesmas colunas e linhas da tabela, em R$ mil; cada Δ vira duas colunas (R$ mil e %).
  - Formatação: cabeçalho azul-marinho, mês selecionado em destaque, grupos e totais em negrito com fundo,
    negativos em vermelho, variações positivas em verde, colunas e topo congelados, impressão em paisagem.
  - Linhas recolhidas na tela vêm agrupadas e recolhidas no Excel (botões + / − à esquerda).
  - Com "Ocultar linhas sem saldo" ativo, essas linhas ficam de fora.
  - Antes de baixar, um popup mostra o que será exportado e pede confirmação; na visão por empresa,
    permite incluir os indicadores numa segunda aba.
  A biblioteca ExcelJS (gera planilhas com formatação) é carregada só quando a exportação é aberta.
*/

const EXCELJS_URL = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';

const COR = {
  marinho: 'FF15385E', azul: 'FF2573C0', azulClaro: 'FFEAF2FB', grupo: 'FFE8EEF5', total: 'FFDCE5EF',
  elim: 'FFF3F4F6', linha: 'FFDCE5EF', cinza: 'FF7A8FA6', texto: 'FF15385E', branco: 'FFFFFFFF',
};
// Sem cores no formato (cada programa interpreta a paleta de um jeito): a cor vai na fonte de cada célula
// Negativos entre parênteses, como na tela
const FMT = {
  mil: '#,##0;(#,##0);"–"',
  delta: '+#,##0;(#,##0);"–"',
  perc: '+0.0%;(0.0%);"–"',
};
const VERDE = 'FF1E7B3A', VERMELHO = 'FFC62828';
const preenchimento = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const bordaFina = { style: 'thin', color: { argb: COR.linha } };

function carregarBiblioteca() {
  if (window.ExcelJS) return Promise.resolve();
  return new Promise((resolver, rejeitar) => {
    const s = document.createElement('script');
    s.src = EXCELJS_URL;
    s.onload = resolver;
    s.onerror = () => rejeitar(new Error('Não foi possível carregar o gerador de planilhas. Verifique a conexão.'));
    document.head.appendChild(s);
  });
}

/* Texto da tela -> número. "1.234" = 1234 (R$ mil); "-6,9%" = -0,069; "–" = vazio; "✓" = 0 */
function numeroDaTela(texto) {
  let t = String(texto || '').replace(/\s+/g, '').replace('−', '-');
  if (/^\(.*\)$/.test(t)) t = '-' + t.slice(1, -1);   // (1.234) = -1.234
  if (!t || t === '–') return null;
  if (t === '✓') return 0;
  const perc = t.endsWith('%');
  const n = Number(t.replace('%', '').replace(/\./g, '').replace(',', '.').replace('+', ''));
  if (!Number.isFinite(n)) return null;
  return perc ? n / 100 : n;
}

function rotuloDaLinha(td) {
  const copia = td.cloneNode(true);
  copia.querySelectorAll('button, .btn-expand-pill, .bullet-item').forEach(el => el.remove());
  return copia.textContent.replace(/\s+/g, ' ').trim();
}

function valorDaCelula(td) {
  const span = td.querySelector('.cell-val-group > span:last-child');
  return (span ? span.textContent : td.textContent).trim();
}

function nivelDaLinha(tr) {
  if (tr.classList.contains('tr-nv3')) return 2;
  if (tr.classList.contains('tr-filha')) return 1;
  return 0;
}

function celula(valor, formato) {
  if (valor === null || valor === undefined) return { t: 's', v: '' };
  if (typeof valor === 'number') return { t: 'n', v: valor, z: formato };
  return { t: 's', v: String(valor) };
}

/* Dados da exportação atual (o que está na tela) */
function descreverExportacao() {
  const demonstracao = document.querySelector('.bp-title-group h1').textContent.trim();
  const porEmpresa = modoVisao === MODO_EMPRESA;
  const empresa = porEmpresa ? empresaSelecionada(EMPRESAS).nome : 'Consolidado';
  const mes = formatarDataPeriodo(mesSelecionado);
  const tipoDR = typeof visao !== 'undefined' ? (visao === 'mensal' ? 'valores do mês' : 'acumulado no ano') : '';
  const sigla = demonstracao.startsWith('Balanço') ? 'BP' : demonstracao.startsWith('Demonstração do Resultado') ? 'DR' : demonstracao;
  const limpar = t => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w-]+/g, '');
  const painel = document.getElementById('painelIndicadores');
  return {
    demonstracao, porEmpresa, empresa, mes, tipoDR,
    visaoTexto: porEmpresa ? 'por empresa' : 'consolidada (contábil)',
    arquivo: `${sigla}_${limpar(empresa)}_${limpar(mes.replace('/', '-'))}.xlsx`,
    comIndicadores: porEmpresa && painel && !painel.hidden,
    semZerados: document.querySelector('.bp-table')?.classList.contains('ocultar-zerados'),
  };
}

/* ---------- Confirmação antes de baixar (evita download por clique acidental) ---------- */

function modalExportacao() {
  let modal = document.getElementById('modalExportar');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'modalExportar';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-card modal-chat modal-exportar" role="dialog" aria-modal="true" aria-labelledby="exportarTitulo" aria-describedby="exportarResumo">
      <header class="modal-header">
        <div class="modal-header-info"><h3 id="exportarTitulo">Exportar planilha</h3></div>
        <button type="button" class="btn-close-modal" data-fechar aria-label="Fechar">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>
        </button>
      </header>
      <div class="exportar-corpo">
        <p class="exportar-pergunta">Baixar a visão atual em Excel?</p>
        <dl class="exportar-resumo" id="exportarResumo"></dl>
        <label class="exportar-opcao" id="exportarOpcaoIndicadores" hidden>
          <input type="checkbox" id="exportarIndicadores" checked>
          Incluir os indicadores (em uma aba separada)
        </label>
      </div>
      <footer class="exportar-acoes">
        <button type="button" class="btn-action" data-fechar>Cancelar</button>
        <button type="button" class="btn-exportar-confirmar" id="btnConfirmarExportacao">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v7M5 6.5l3 3 3-3M3 11.5v2h10v-2"/></svg>
          Baixar planilha
        </button>
      </footer>
    </div>`;
  document.body.appendChild(modal);
  const fechar = () => fecharConfirmacaoExportacao();
  modal.addEventListener('click', e => { if (e.target === modal || e.target.closest('[data-fechar]')) fechar(); });
  modal.querySelector('#btnConfirmarExportacao').addEventListener('click', async () => {
    const indicadores = modal.querySelector('#exportarIndicadores').checked;
    fechar();
    await baixarPlanilha({ indicadores });
  });
  modal.querySelector('#exportarIndicadores').addEventListener('change', () => atualizarResumoExportacao());
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal.classList.contains('active')) fechar();
  });
  return modal;
}

let focoAntesDaExportacao = null;

function atualizarResumoExportacao() {
  const d = descreverExportacao();
  const modal = modalExportacao();
  const incluir = modal.querySelector('#exportarIndicadores').checked;
  const linha = (rotulo, valor) => `<div><dt>${esc(rotulo)}</dt><dd>${esc(valor)}</dd></div>`;
  modal.querySelector('#exportarResumo').innerHTML =
    linha('Demonstração', d.demonstracao) +
    linha(d.porEmpresa ? 'Empresa' : 'Visão', d.porEmpresa ? d.empresa : 'Consolidada (contábil)') +
    linha('Mês', d.mes + (d.tipoDR ? ` · ${d.tipoDR}` : '')) +
    linha('Conteúdo', [d.comIndicadores && incluir ? 'tabela + indicadores' : 'tabela', d.semZerados ? 'sem linhas zeradas' : ''].filter(Boolean).join(', ')) +
    linha('Arquivo', d.arquivo);
  // A opção só aparece quando o painel de indicadores está visível (visão por empresa)
  modal.querySelector('#exportarOpcaoIndicadores').hidden = !d.comIndicadores;
}

function exportarExcel() {
  const modal = modalExportacao();
  modal.querySelector('#exportarIndicadores').checked = true;
  atualizarResumoExportacao();
  focoAntesDaExportacao = document.activeElement;
  modal.classList.add('active');
  setTimeout(() => modal.querySelector('#btnConfirmarExportacao').focus(), 60);
  carregarBiblioteca().catch(() => {});   // adianta o carregamento enquanto a pessoa confirma
}

function fecharConfirmacaoExportacao() {
  const modal = document.getElementById('modalExportar');
  if (!modal) return;
  modal.classList.remove('active');
  if (focoAntesDaExportacao && focoAntesDaExportacao.focus) focoAntesDaExportacao.focus();
}

/* ---------- Geração do arquivo ---------- */

/* Tipo de linha da tabela (define a formatação) */
function tipoDaLinha(tr) {
  if (tr.classList.contains('tr-conferencia')) return 'conferencia';
  if (tr.classList.contains('tr-memo')) return 'memo';
  if (tr.classList.contains('tr-total')) return 'total';
  if (tr.classList.contains('tr-grupo')) return 'grupo';
  return tr.classList.contains('tr-nv3') ? 'nv3' : 'nv2';
}

/* Colunas a partir do cabeçalho da tela: cada Δ vira duas (R$ mil e %) */
function colunasDaTabela(tabela) {
  const colunas = [{ titulo: 'Classificação', tipo: 'rotulo', largura: 50 }];
  tabela.querySelectorAll('thead tr:nth-child(2) th').forEach(th => {
    // A participação (ex.: "60% do grupo") vai entre parênteses depois do nome
    const copia = th.cloneNode(true);
    copia.querySelectorAll('.tag-participacao').forEach(tag => { tag.textContent = ` (${tag.textContent.trim()})`; });
    const t = copia.textContent.replace(/\s+/g, ' ').trim();
    if (th.classList.contains('th-delta')) {
      colunas.push({ titulo: `${t} (R$ mil)`, tipo: 'delta', largura: 16 }, { titulo: `${t} (%)`, tipo: 'perc', largura: 11 });
    } else if (th.classList.contains('th-mes-selecionado')) colunas.push({ titulo: t, tipo: 'selecionado', largura: 16 });
    else if (th.classList.contains('th-eliminacoes')) colunas.push({ titulo: t, tipo: 'elim', largura: 15 });
    else if (th.classList.contains('th-consolidado')) colunas.push({ titulo: t, tipo: 'consolidado', largura: 17 });
    else colunas.push({ titulo: t, tipo: 'valor', largura: 16 });
  });
  return colunas;
}

/* Título, informações e cabeçalho; devolve o número da linha do cabeçalho */
function escreverTopo(ws, info, titulos, larguraTotal) {
  const [titulo, ...demais] = info;
  ws.mergeCells(1, 1, 1, larguraTotal);
  const t = ws.getCell(1, 1);
  t.value = titulo;
  t.font = { name: 'Calibri', size: 15, bold: true, color: { argb: COR.marinho } };
  ws.getRow(1).height = 24;
  demais.forEach((texto, i) => {
    ws.mergeCells(2 + i, 1, 2 + i, larguraTotal);
    const c = ws.getCell(2 + i, 1);
    c.value = texto;
    c.font = { name: 'Calibri', size: 10, color: { argb: COR.cinza } };
  });
  const linhaCab = info.length + 2;   // uma linha em branco entre as informações e a tabela
  const cab = ws.getRow(linhaCab);
  titulos.forEach((tit, i) => {
    const c = cab.getCell(i + 1);
    c.value = tit;
    c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COR.branco } };
    c.fill = preenchimento(COR.marinho);
    c.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'center', wrapText: true, indent: i === 0 ? 1 : 0 };
    c.border = { bottom: { style: 'medium', color: { argb: COR.azul } } };
  });
  cab.height = 30;
  return linhaCab;
}

function abaDaTabela(wb, nome, tabela, info) {
  const colunas = colunasDaTabela(tabela);
  // Impressão por escala (e não "ajustar à página"): o ExcelJS grava o ajuste de página e a configuração dos
  // grupos fora da ordem que o Excel exige quando os dois aparecem juntos, e o Excel acusa arquivo corrompido.
  // A escala é estimada pela largura das colunas para caber na largura de uma folha A4 em paisagem.
  const larguraTotal = colunas.reduce((t, c) => t + c.largura, 0);
  const escala = Math.max(30, Math.min(100, Math.floor(100 * 128 / larguraTotal)));
  const ws = wb.addWorksheet(nome, {
    properties: { outlineProperties: { summaryBelow: false, summaryRight: false } },
    pageSetup: { orientation: 'landscape', scale: escala, paperSize: 9,
                 margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    headerFooter: { oddFooter: '&L&8' + info[0].replace(/&/g, '&&') + '&R&8Página &P de &N' },
  });
  ws.columns = colunas.map(c => ({ width: c.largura }));
  const linhaCab = escreverTopo(ws, info, colunas.map(c => c.titulo), colunas.length);
  // Destaque do mês selecionado no cabeçalho
  colunas.forEach((c, i) => { if (c.tipo === 'selecionado' || c.tipo === 'consolidado') ws.getRow(linhaCab).getCell(i + 1).fill = preenchimento(COR.azul); });

  const ocultarZerados = tabela.classList.contains('ocultar-zerados');
  tabela.querySelectorAll('tbody tr').forEach(tr => {
    if (ocultarZerados && tr.classList.contains('linha-zerada')) return;
    const tds = [...tr.cells];
    if (!tds.length) return;
    const tipo = tipoDaLinha(tr);
    const nivel = nivelDaLinha(tr);
    const valores = [];
    tds.slice(1).forEach(td => {
      if (td.classList.contains('td-delta')) {
        const d = td.querySelector('.delta'), p = td.querySelector('.chip');
        valores.push(numeroDaTela(d ? d.textContent : ''), numeroDaTela(p ? p.textContent : ''));
      } else valores.push(numeroDaTela(valorDaCelula(td)));
    });

    const linha = ws.addRow([rotuloDaLinha(tds[0]), ...valores]);
    linha.outlineLevel = nivel;
    if (tr.classList.contains('recolhido')) linha.hidden = true;

    const destaque = tipo === 'grupo' || tipo === 'total';
    const fundo = tipo === 'total' ? COR.total : tipo === 'grupo' ? COR.grupo : null;
    linha.eachCell({ includeEmpty: true }, (c, n) => {
      const col = colunas[n - 1] || { tipo: 'valor' };
      c.font = {
        name: 'Calibri', size: tipo === 'nv3' || tipo === 'conferencia' || tipo === 'memo' ? 9 : 10,
        bold: destaque || (col.tipo === 'consolidado' && tipo !== 'conferencia'),
        italic: tipo === 'conferencia' || tipo === 'memo',
        color: { argb: tipo === 'nv3' || tipo === 'conferencia' || tipo === 'memo' ? COR.cinza : COR.texto },
      };
      if (n === 1) {
        c.alignment = { vertical: 'middle', indent: 1 + nivel * 2 };
      } else {
        c.alignment = { vertical: 'middle', horizontal: 'right' };
        c.numFmt = col.tipo === 'perc' ? FMT.perc : col.tipo === 'delta' ? FMT.delta : FMT.mil;
        // Negativos em vermelho; variações positivas em verde
        if (typeof c.value === 'number' && Math.round(c.value * (col.tipo === 'perc' ? 1000 : 1)) !== 0) {
          if (c.value < 0) c.font = { ...c.font, color: { argb: VERMELHO } };
          else if (col.tipo === 'delta' || col.tipo === 'perc') c.font = { ...c.font, color: { argb: VERDE } };
        }
      }
      let cor = fundo;
      if (!cor && col.tipo === 'selecionado') cor = COR.azulClaro;
      if (!cor && col.tipo === 'elim') cor = COR.elim;
      if (!cor && col.tipo === 'consolidado') cor = COR.azulClaro;
      if (cor) c.fill = preenchimento(cor);
      c.border = tipo === 'total'
        ? { top: { style: 'thin', color: { argb: COR.marinho } }, bottom: { style: 'thin', color: { argb: COR.marinho } } }
        : { bottom: bordaFina };
      if (tipo === 'conferencia' && n > 1 && c.value === 0) { c.value = '✓'; c.alignment = { horizontal: 'right' }; c.font = { ...c.font, color: { argb: VERDE } }; }
    });
    linha.height = tipo === 'nv3' ? 15 : 17;
  });

  // Nível máximo de agrupamento declarado corretamente (senão o ExcelJS marca todas as linhas como recolhidas)
  ws.properties.outlineLevelRow = Math.max(0, ...ws.getRows(linhaCab + 1, ws.rowCount - linhaCab || 1).map(r => r.outlineLevel || 0));
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: linhaCab, showGridLines: false }];
  return ws;
}

/* Indicador da tela -> número com formato próprio ("3,1%", "2,81", "152,6 mi"…) */
function indicadorParaCelula(texto) {
  let t = String(texto || '').trim().replace('−', '-');
  if (/^\(.*\)$/.test(t)) t = '-' + t.slice(1, -1).trim();   // (4,4 mi) = -4,4 mi
  if (!t || t === '–') return { valor: '–', formato: '@' };
  const m = t.match(/^(-?[\d.]+(?:,\d+)?)\s*(%|bi|mi|mil)?$/);
  if (!m) return { valor: t, formato: '@' };
  const n = Number(m[1].replace(/\./g, '').replace(',', '.'));
  switch (m[2]) {
    case '%': return { valor: n / 100, formato: '0.0%;(0.0%)' };
    case 'bi': return { valor: n * 1e9, formato: '#,##0.0,,," bi";(#,##0.0,,," bi")' };
    case 'mi': return { valor: n * 1e6, formato: '#,##0.0,," mi";(#,##0.0,," mi")' };
    case 'mil': return { valor: n * 1e3, formato: '#,##0.0," mil";(#,##0.0," mil")' };
    default: return { valor: n, formato: m[1].includes(',') ? '0.00;(0.00)' : '#,##0;(#,##0)' };
  }
}

function abaDosIndicadores(wb, painel, info) {
  const ws = wb.addWorksheet('Indicadores', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });
  const titulos = ['Indicador', 'Mês selecionado', 'Mês anterior', 'Tendência', 'Fórmula'];
  ws.columns = [{ width: 34 }, { width: 17 }, { width: 17 }, { width: 11 }, { width: 80 }];
  const linhaCab = escreverTopo(ws, info, titulos, titulos.length);

  painel.querySelectorAll('.ind-grupo').forEach(grupo => {
    const g = ws.addRow([grupo.querySelector('h3').textContent.trim()]);
    ws.mergeCells(g.number, 1, g.number, titulos.length);
    g.getCell(1).font = { name: 'Calibri', size: 10, bold: true, color: { argb: COR.azul } };
    g.getCell(1).fill = preenchimento(COR.grupo);
    g.height = 18;

    grupo.querySelectorAll('.ind-item').forEach(item => {
      const ant = item.querySelector('.ind-anterior');
      const seta = ant.querySelector('.ind-seta');
      const textoAnterior = ant.textContent.replace(/[↑↓→]/g, '').replace(/\s+/g, ' ').trim().replace(/^[^:]*:\s*/, '');
      const atual = indicadorParaCelula(item.querySelector('.ind-valor').textContent);
      const anterior = indicadorParaCelula(textoAnterior);
      const linha = ws.addRow([item.querySelector('.ind-nome').textContent.trim(), atual.valor, anterior.valor,
                               seta ? seta.textContent.trim() : '', item.getAttribute('title') || '']);
      linha.getCell(1).alignment = { indent: 1, vertical: 'middle' };
      [2, 3].forEach((n, i) => {
        const c = linha.getCell(n);
        c.numFmt = [atual, anterior][i].formato;
        c.alignment = { horizontal: 'right', vertical: 'middle' };
      });
      const corValor = (v, padrao) => (typeof v === 'number' && v < 0 ? VERMELHO : padrao);
      linha.getCell(2).font = { name: 'Calibri', size: 10, bold: true, color: { argb: corValor(atual.valor, COR.texto) } };
      linha.getCell(2).fill = preenchimento(COR.azulClaro);
      linha.getCell(3).font = { name: 'Calibri', size: 10, color: { argb: corValor(anterior.valor, COR.cinza) } };
      const corSeta = seta && seta.classList.contains('positive') ? VERDE : seta && seta.classList.contains('negative') ? VERMELHO : COR.cinza;
      linha.getCell(4).font = { name: 'Calibri', size: 11, bold: true, color: { argb: corSeta } };
      linha.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' };
      linha.getCell(5).font = { name: 'Calibri', size: 9, color: { argb: COR.cinza } };
      linha.getCell(5).alignment = { wrapText: true, vertical: 'middle' };
      linha.eachCell({ includeEmpty: true }, c => { c.border = { bottom: bordaFina }; });
    });
  });
  ws.views = [{ state: 'frozen', ySplit: linhaCab, showGridLines: false }];
  return ws;
}

async function baixarPlanilha({ indicadores = true } = {}) {
  const botao = document.querySelector('.btn-exportar');
  try {
    if (botao) botao.disabled = true;
    await carregarBiblioteca();

    const tabela = document.querySelector('.bp-table');
    const d = descreverExportacao();
    const info = [
      `${d.demonstracao} — ${d.empresa}`,
      `Mês selecionado: ${d.mes}${d.tipoDR ? ` (${d.tipoDR})` : ''} · Visão: ${d.visaoTexto}`,
      'Valores em milhares de reais (R$ mil)',
      `Exportado em ${new Date().toLocaleString('pt-BR')}`,
    ];

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Portal da Controladoria · Trilha';
    wb.created = new Date();
    abaDaTabela(wb, d.demonstracao.slice(0, 31), tabela, info);
    if (d.comIndicadores && indicadores) abaDosIndicadores(wb, document.getElementById('painelIndicadores'), info);

    const buffer = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: d.arquivo });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (erro) {
    console.error('Falha ao exportar:', erro);
    alert(erro.message || 'Não foi possível exportar a planilha.');
  } finally {
    if (botao) botao.disabled = false;
  }
}

/*
  EXPORTAR PARA EXCEL — baixa a visão que está na tela (BP ou DR) em .xlsx.

  - Mesmas colunas e linhas da tabela, em R$ mil; cada Δ vira duas colunas (R$ mil e %).
  - Linhas recolhidas na tela vêm agrupadas e recolhidas no Excel (botões + / − à esquerda).
  - Com "Ocultar linhas sem saldo" ativo, essas linhas ficam de fora.
  - Na visão por empresa, uma segunda aba traz os indicadores com as fórmulas.
  A biblioteca SheetJS é carregada só no primeiro clique.
*/

const SHEETJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const FORMATO_MIL = '#,##0;-#,##0;"–"';
const FORMATO_PERC = '0.0%;-0.0%;"–"';

function carregarSheetJS() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((resolver, rejeitar) => {
    const s = document.createElement('script');
    s.src = SHEETJS_URL;
    s.onload = resolver;
    s.onerror = () => rejeitar(new Error('Não foi possível carregar o gerador de planilhas. Verifique a conexão.'));
    document.head.appendChild(s);
  });
}

/* Texto da tela -> número. "1.234" = 1234 (R$ mil); "-6,9%" = -0,069; "–" = vazio; "✓" = 0 */
function numeroDaTela(texto) {
  const t = String(texto || '').replace(/\s+/g, '').replace('−', '-');
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

function abaDaTabela(tabela, cabecalhoInfo) {
  // Colunas: a 2ª linha do cabeçalho (meses, Δ, empresas, eliminações, consolidado)
  const ths = [...tabela.querySelectorAll('thead tr:nth-child(2) th')];
  const cab = ['Classificação'];
  const tipos = [];
  ths.forEach(th => {
    const t = th.textContent.replace(/\s+/g, ' ').trim();
    if (th.classList.contains('th-delta')) { cab.push(`${t} (R$ mil)`, `${t} (%)`); tipos.push('mil', 'perc'); }
    else { cab.push(t); tipos.push('mil'); }
  });

  const ocultarZerados = tabela.classList.contains('ocultar-zerados');
  const linhas = [];
  const meta = [];
  tabela.querySelectorAll('tbody tr').forEach(tr => {
    if (ocultarZerados && tr.classList.contains('linha-zerada')) return;
    const tds = [...tr.cells];
    if (!tds.length) return;
    const nivel = nivelDaLinha(tr);
    const valores = [];
    tds.slice(1).forEach(td => {
      if (td.classList.contains('td-delta')) {
        const d = td.querySelector('.delta'), p = td.querySelector('.chip');
        valores.push(numeroDaTela(d ? d.textContent : ''), numeroDaTela(p ? p.textContent : ''));
      } else {
        valores.push(numeroDaTela(valorDaCelula(td)));
      }
    });
    linhas.push([`${'   '.repeat(nivel)}${rotuloDaLinha(tds[0])}`, ...valores]);
    meta.push({ level: nivel, hidden: tr.classList.contains('recolhido') });
  });

  const aoa = [...cabecalhoInfo.map(l => [l]), [], cab, ...linhas];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const inicio = cabecalhoInfo.length + 1;   // linha (0-based) do cabeçalho da tabela: info + 1 linha em branco
  linhas.forEach((linha, i) => {
    linha.slice(1).forEach((v, j) => {
      const ref = XLSX.utils.encode_cell({ r: inicio + 1 + i, c: j + 1 });
      ws[ref] = celula(v, tipos[j] === 'perc' ? FORMATO_PERC : FORMATO_MIL);
    });
  });
  ws['!cols'] = [{ wch: 48 }, ...tipos.map(t => ({ wch: t === 'perc' ? 10 : 16 }))];
  ws['!rows'] = [];
  meta.forEach((m, i) => { ws['!rows'][inicio + 1 + i] = { level: m.level, hidden: m.hidden }; });
  ws['!freeze'] = { xSplit: 1, ySplit: inicio + 1 };
  return ws;
}

function abaDosIndicadores(painel, cabecalhoInfo) {
  const aoa = [...cabecalhoInfo.map(l => [l]), [], ['Grupo', 'Indicador', 'Mês selecionado', 'Mês anterior', 'Fórmula']];
  painel.querySelectorAll('.ind-grupo').forEach(grupo => {
    const nomeGrupo = grupo.querySelector('h3').textContent.trim();
    grupo.querySelectorAll('.ind-item').forEach(item => {
      const anterior = item.querySelector('.ind-anterior').textContent.replace(/[↑↓→]/g, '').replace(/\s+/g, ' ').trim();
      aoa.push([nomeGrupo, item.querySelector('.ind-nome').textContent.trim(), item.querySelector('.ind-valor').textContent.trim(),
                anterior.replace(/^[^:]*:\s*/, ''), item.getAttribute('title') || '']);
    });
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 22 }, { wch: 32 }, { wch: 16 }, { wch: 16 }, { wch: 90 }];
  return ws;
}

async function exportarExcel() {
  const botao = document.querySelector('.btn-exportar');
  try {
    if (botao) botao.disabled = true;
    await carregarSheetJS();

    const tabela = document.querySelector('.bp-table');
    const demonstracao = document.querySelector('.bp-title-group h1').textContent.trim();
    const porEmpresa = modoVisao === MODO_EMPRESA;
    const empresa = porEmpresa ? empresaSelecionada(EMPRESAS).nome : 'Consolidado';
    const mes = formatarDataPeriodo(mesSelecionado);
    const tipoDR = typeof visao !== 'undefined' ? (visao === 'mensal' ? 'valores do mês' : 'acumulado no ano') : '';

    const info = [
      `${demonstracao} — ${empresa}`,
      `Mês selecionado: ${mes}${tipoDR ? ` (${tipoDR})` : ''} · Visão: ${porEmpresa ? 'por empresa' : 'consolidada (contábil)'}`,
      'Valores em milhares de reais (R$ mil)',
      `Exportado em ${new Date().toLocaleString('pt-BR')}`,
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, abaDaTabela(tabela, info), demonstracao.slice(0, 31));
    const painel = document.getElementById('painelIndicadores');
    if (porEmpresa && painel && !painel.hidden) XLSX.utils.book_append_sheet(wb, abaDosIndicadores(painel, info), 'Indicadores');

    const sigla = demonstracao.startsWith('Balanço') ? 'BP' : demonstracao.startsWith('Demonstração do Resultado') ? 'DR' : demonstracao;
    const limpar = t => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w-]+/g, '');
    XLSX.writeFile(wb, `${sigla}_${limpar(empresa)}_${limpar(mes.replace('/', '-'))}.xlsx`);
  } catch (erro) {
    console.error('Falha ao exportar:', erro);
    alert(erro.message || 'Não foi possível exportar a planilha.');
  } finally {
    if (botao) botao.disabled = false;
  }
}

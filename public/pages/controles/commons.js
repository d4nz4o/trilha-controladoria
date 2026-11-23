/* Código compartilhado entre as abas do controle de ativos:
   carga de dados, formatação, filtros, indicadores e exportação para Excel (com confirmação). */

export const MESES = 9; // meses da data-base (jan–set)
export const STATUS = ['Em depreciação', 'Totalmente depreciado', 'Sem depreciação', 'Desativado'];
export const $ = id => document.getElementById(id);

/* ---------- Carga de dados ---------- */
// Recebe nomes de fontes ('ativos', 'peps'); a origem de cada uma fica em /src/scripts/services/fonte-dados.js
export const carregarJSON = (...fontes) => Promise.all(fontes.map(nome => window.FonteDados.lerJSON(nome)));

export function mostrarErro(e) {
  document.querySelector('main').innerHTML =
    '<p class="bp-aviso">Não foi possível carregar os dados (' + e.message + '). Atualize a página; se persistir, confira a fonte de dados.</p>';
}

/* ---------- Formatação ---------- */
const L = n => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const f = n => Math.round(n * 100) < 0 ? '(' + L(-n) + ')' : L(n);
export const f0 = n => n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
export const rs = n => Math.round(n * 100) < 0 ? '(R$ ' + L(-n) + ')' : 'R$ ' + L(n);
export const dt = n => n ? `${String(n).slice(6)}/${String(n).slice(4, 6)}/${String(n).slice(0, 4)}` : '—';
export const y = n => n == null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
export const pc = n => n == null ? '—' : (Math.round(n * 1000) / 10 + 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';

const CHIPS = { 'Em depreciação': 'positive', Desativado: 'negative', 'Sem depreciação': 'neutral', 'Totalmente depreciado': 'alerta', Aportes: 'info', Próprias: 'positive', Reversíveis: 'alerta' };
export const tag = s => `<span class="chip ${CHIPS[s] || 'neutral'}">${s}</span>`;

/* ---------- Bens: cálculo por linha ---------- */
/* r = [imob, sub, incorp, denom, empresa, classe, desativ, custo, dep.acum, dep.ano, valor contábil, aquis, baixas, nº patrimonial] */
export function preparar(D) {
  Object.keys(D.c).forEach(k => D.c[k] = k + ' - ' + (D.c[k].startsWith('Classe ') ? 'Sem denominação' : D.c[k]));
  return D.r.map((r, i) => {
    const [, , , , , , des, cap, dac, dan, vc] = r, ma = -dan / MESES; // ma = depreciação mensal
    const st = des ? 'Desativado' : (ma === 0 && dac === 0) ? 'Sem depreciação' : ma === 0 ? 'Totalmente depreciado' : 'Em depreciação';
    return { i, r, st, ma, vida: ma > 0 && cap > 0 ? cap / (ma * 12) : null, rest: ma > 0 ? Math.max(vc, 0) / (ma * 12) : null, pct: cap > 0 ? -dac / cap : null };
  });
}

export function filtrarBens(R, { empresa = '', classe = '', status = '', busca = '' } = {}) {
  const q = busca.trim().toLowerCase();
  return R.filter(x => (!empresa || x.r[4] == empresa) && (!classe || x.r[5] == classe) && (!status || x.st == status) &&
    (!q || String(x.r[0]).includes(q) || String(x.r[13] || '').toLowerCase().includes(q) || x.r[3].toLowerCase().includes(q)));
}

/* ---------- Interface ---------- */
export const preencherSelect = (id, rotulo, opcoes) =>
  $(id).innerHTML = `<option value="">${rotulo}</option>` + opcoes.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');

export const mostrarKPIs = lista =>
  $('kpis').innerHTML = lista.map(([t, v]) => `<div class="kpi"><small>${t}</small><b>${v}</b></div>`).join('');

/* ---------- Exportação CSV (separador ;, vírgula decimal, UTF-8 com BOM) ---------- */
/* ---------- Exportação para Excel (com confirmação) ---------- */

/*
  exportarPlanilha({ pagina, arquivo, filtros, colunas, linhas, total })
    pagina   nome da aba do controle (ex.: 'Composição geral')
    arquivo  nome do .xlsx
    filtros  [[rótulo, valor], ...] — aparecem no popup e no topo da planilha
    colunas  [{ titulo, tipo, largura }] — tipo: texto | inteiro | moeda | perc | anos | data | status
    linhas   matriz de valores (números crus; datas como aaaammdd)
    total    linha de total (opcional). Colunas de valor (moeda, inteiro) viram SUBTOTAL: no Excel, o total
             acompanha o filtro. { contar: true, sufixo } conta as linhas visíveis (ex.: "1.234 bens").
  Abre um popup de confirmação; só gera e baixa o arquivo depois do "Baixar planilha".
  A biblioteca ExcelJS é carregada quando o popup abre.
*/
const EXCELJS_URL = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
const COR = { marinho: 'FF15385E', azul: 'FF2573C0', faixa: 'FFF4F7FB', total: 'FFDCE5EF', linha: 'FFDCE5EF', cinza: 'FF7A8FA6', texto: 'FF15385E', branco: 'FFFFFFFF', vermelho: 'FFC62828' };
const COR_STATUS = { 'Em depreciação': 'FF2573C0', 'Totalmente depreciado': 'FF6B7785', 'Sem depreciação': 'FFB45309', 'Desativado': 'FFC62828' };
const FORMATO = {
  inteiro: '#,##0', moeda: '#,##0.00;(#,##0.00);"–"', perc: '0.0%;(0.0%);"–"', anos: '0.0;(0.0);"–"', data: 'dd/mm/yyyy',
};
const escHtml = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function carregarExcelJS() {
  if (window.ExcelJS) return Promise.resolve();
  return new Promise((ok, falha) => {
    const s = document.createElement('script');
    s.src = EXCELJS_URL;
    s.onload = ok;
    s.onerror = () => falha(new Error('Não foi possível carregar o gerador de planilhas. Verifique a conexão.'));
    document.head.appendChild(s);
  });
}

let configExportacao = null, focoAnterior = null;

function modalExportacao() {
  let modal = document.getElementById('modalExportarAtivos');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'modalExportarAtivos';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-card modal-chat modal-exportar" role="dialog" aria-modal="true" aria-labelledby="exportarAtivosTitulo" aria-describedby="exportarAtivosResumo">
      <header class="modal-header">
        <div class="modal-header-info"><h3 id="exportarAtivosTitulo">Exportar planilha</h3></div>
        <button type="button" class="btn-close-modal" data-fechar aria-label="Fechar">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>
        </button>
      </header>
      <div class="exportar-corpo">
        <p class="exportar-pergunta">Baixar a visão atual em Excel?</p>
        <dl class="exportar-resumo" id="exportarAtivosResumo"></dl>
      </div>
      <footer class="exportar-acoes">
        <button type="button" class="btn-action" data-fechar>Cancelar</button>
        <button type="button" class="btn-exportar-confirmar" id="btnConfirmarExportacaoAtivos">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v7M5 6.5l3 3 3-3M3 11.5v2h10v-2"/></svg>
          Baixar planilha
        </button>
      </footer>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal || e.target.closest('[data-fechar]')) fecharExportacao(); });
  modal.querySelector('#btnConfirmarExportacaoAtivos').addEventListener('click', async () => {
    const config = configExportacao;
    fecharExportacao();
    await gerarPlanilha(config);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal.classList.contains('active')) fecharExportacao(); });
  return modal;
}

function fecharExportacao() {
  const modal = document.getElementById('modalExportarAtivos');
  if (!modal) return;
  modal.classList.remove('active');
  if (focoAnterior && focoAnterior.isConnected) focoAnterior.focus();
}

export function exportarPlanilha(config) {
  configExportacao = config;
  const modal = modalExportacao();
  const linha = (r, v) => `<div><dt>${escHtml(r)}</dt><dd>${escHtml(v)}</dd></div>`;
  const qtd = config.linhas.length;
  modal.querySelector('#exportarAtivosResumo').innerHTML =
    linha('Página', `Controle de ativos · ${config.pagina}`) +
    config.filtros.map(([r, v]) => linha(r, v)).join('') +
    linha('Conteúdo', `${qtd.toLocaleString('pt-BR')} ${qtd === 1 ? config.unidade[0] : config.unidade[1]}${config.total ? ' + total' : ''}`) +
    linha('Arquivo', config.arquivo);
  focoAnterior = document.activeElement;
  modal.classList.add('active');
  setTimeout(() => modal.querySelector('#btnConfirmarExportacaoAtivos').focus(), 60);
  carregarExcelJS().catch(() => {});   // adianta o carregamento enquanto a pessoa confirma
}

/* Nome de arquivo sem acentos nem espaços */
export const nomeArquivo = (...partes) =>
  partes.filter(Boolean).join('_').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w-]+/g, '') + '.xlsx';

const paraData = n => (n ? new Date(Date.UTC(Math.floor(n / 10000), Math.floor(n / 100) % 100 - 1, n % 100)) : null);

async function gerarPlanilha({ pagina, arquivo, filtros, colunas, linhas, total }) {
  const botao = document.getElementById('x');
  try {
    if (botao) botao.disabled = true;
    await carregarExcelJS();
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Portal da Controladoria · Trilha';
    wb.created = new Date();
    const ws = wb.addWorksheet(pagina.slice(0, 31), {
      // Sem grupos de linhas: aqui o "ajustar à largura" pode ser usado sem conflito
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9,
                   margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
      headerFooter: { oddFooter: '&L&8Controle de ativos — ' + pagina.replace(/&/g, '&&') + '&R&8Página &P de &N' },
    });
    ws.columns = colunas.map(c => ({ width: c.largura || 14 }));
    const n = colunas.length;

    // Topo: título e informações
    const info = [
      `Controle de ativos — ${pagina}`,
      filtros.map(([r, v]) => `${r}: ${v}`).join(' · '),
      'Valores em reais (R$)',
      `Exportado em ${new Date().toLocaleString('pt-BR')}`,
    ];
    info.forEach((texto, i) => {
      ws.mergeCells(i + 1, 1, i + 1, n);
      const c = ws.getCell(i + 1, 1);
      c.value = texto;
      c.font = i === 0 ? { name: 'Calibri', size: 15, bold: true, color: { argb: COR.marinho } }
                       : { name: 'Calibri', size: 10, color: { argb: COR.cinza } };
    });
    ws.getRow(1).height = 24;

    // Cabeçalho
    const linhaCab = info.length + 2;
    const cab = ws.getRow(linhaCab);
    colunas.forEach((col, i) => {
      const c = cab.getCell(i + 1);
      c.value = col.titulo;
      c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COR.branco } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR.marinho } };
      c.alignment = { vertical: 'middle', horizontal: ['texto', 'status'].includes(col.tipo) ? 'left' : 'center', wrapText: true };
      c.border = { bottom: { style: 'medium', color: { argb: COR.azul } } };
    });
    cab.height = 30;

    // Linhas
    const ini = linhaCab + 1, fim = linhaCab + linhas.length;
    const letra = j => ws.getColumn(j).letter;
    const valorTotal = (v, i) => {
      // Soma e contagem que acompanham o filtro do Excel (SUBTOTAL ignora linhas ocultas)
      if (v && typeof v === 'object' && v.contar) {
        // Contagem numérica; o sufixo (" bens") vai no formato da célula, que vale em qualquer idioma do Excel
        return { formula: `SUBTOTAL(103,${letra(1)}${ini}:${letra(1)}${fim})`, result: linhas.length };
      }
      if (typeof v === 'number' && ['moeda', 'inteiro'].includes(colunas[i].tipo) && linhas.length) {
        return { formula: `SUBTOTAL(109,${letra(i + 1)}${ini}:${letra(i + 1)}${fim})`, result: v };
      }
      return v === '' ? null : v;
    };
    const escrever = (valores, ehTotal, indice) => {
      const row = ws.addRow(valores.map((v, i) => ehTotal ? valorTotal(v, i)
        : colunas[i].tipo === 'data' ? paraData(v) : (v === '' ? null : v)));
      row.eachCell({ includeEmpty: true }, (c, j) => {
        const col = colunas[j - 1];
        if (!col) return;
        c.font = { name: 'Calibri', size: 10, bold: ehTotal, color: { argb: COR.texto } };
        c.alignment = { vertical: 'middle', horizontal: ['texto', 'status'].includes(col.tipo) ? 'left' : 'right' };
        if (FORMATO[col.tipo]) c.numFmt = FORMATO[col.tipo];
        const original = ehTotal ? valores[j - 1] : null;
        if (original && typeof original === 'object' && original.contar) {
          c.numFmt = `#,##0"${(original.sufixo || '').replace(/"/g, '')}"`;
          c.alignment = { vertical: 'middle', horizontal: 'left' };
        }
        const numero = typeof c.value === 'number' ? c.value : (c.value && typeof c.value.result === 'number' ? c.value.result : null);
        if (numero !== null && numero < 0 && Math.abs(numero) >= 0.005) c.font = { ...c.font, color: { argb: COR.vermelho } };
        if (col.tipo === 'status' && COR_STATUS[c.value]) c.font = { ...c.font, bold: true, color: { argb: COR_STATUS[c.value] } };
        if (ehTotal) {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR.total } };
          c.border = { top: { style: 'thin', color: { argb: COR.marinho } }, bottom: { style: 'thin', color: { argb: COR.marinho } } };
        } else {
          if (indice % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR.faixa } };
          c.border = { bottom: { style: 'thin', color: { argb: COR.linha } } };
        }
      });
    };
    linhas.forEach((l, i) => escrever(l, false, i));
    if (total) escrever(total, true, 0);

    // Filtro só sobre os dados: a linha de total fica de fora (não é ordenada nem escondida)
    ws.autoFilter = { from: { row: linhaCab, column: 1 }, to: { row: Math.max(fim, linhaCab), column: n } };
    ws.views = [{ state: 'frozen', xSplit: 0, ySplit: linhaCab, showGridLines: false }];
    ws.pageSetup.printTitlesRow = `${linhaCab}:${linhaCab}`;   // cabeçalho das colunas em todas as páginas impressas

    const buffer = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: arquivo });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (erro) {
    console.error('Falha ao exportar:', erro);
    alert(erro.message || 'Não foi possível exportar a planilha.');
  } finally {
    if (botao) botao.disabled = false;
  }
}

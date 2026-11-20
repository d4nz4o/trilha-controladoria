/* Código compartilhado entre as abas do controle de ativos:
   carga de dados, formatação, filtros, indicadores e exportação CSV. */

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
const celula = c => c == null ? '' : typeof c == 'number' ? String(c).replace('.', ',') : /[;"\n]/.test(c) ? '"' + String(c).replace(/"/g, '""') + '"' : c;
export function baixarCSV(arquivo, cabecalho, linhas) {
  const txt = [cabecalho, ...linhas].map(l => l.map(celula).join(';')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + txt], { type: 'text/csv' }));
  a.download = arquivo;
  a.click();
}

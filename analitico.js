/* Aba Analítico: inventário por bem, com busca, filtros, ordenação, paginação e ficha do bem. */
import { $, STATUS, carregarJSON, mostrarErro, preparar, preencherSelect, filtrarBens, mostrarKPIs, baixarCSV, f, f0, rs, dt, y, pc, tag } from '../commons.js';

const POR_PAGINA = 100;
let D, R, F = [], pagina = 0, ordem = 0, sentido = 1;

try { [D] = await carregarJSON('ativos'); } catch (e) { mostrarErro(e); throw e; }
R = preparar(D);

// [título, função de ordenação, numérica?]
const COLUNAS = [
  ['Imobilizado', x => x.r[0]], ['Sub', x => x.r[1]], ['Denominação', x => x.r[3]],
  ['Empresa', x => D.e[x.r[4]]], ['Classe', x => D.c[x.r[5]] || ''], ['Nº patrimonial', x => x.r[13] || ''],
  ['Incorporação', x => x.r[2]], ['Custo', x => x.r[7], 1], ['Depr. acum.', x => x.r[8], 1],
  ['Valor contábil', x => x.r[10], 1], ['% depr.', x => x.pct, 1], ['Vida útil (a)', x => x.vida, 1],
  ['Vida restante (a)', x => x.rest, 1], ['Status', x => x.st],
];

/* ---------- Filtros e ordenação ---------- */
preencherSelect('fe', 'Todas as empresas', Object.entries(D.e));
preencherSelect('fc', 'Todas as classes', Object.entries(D.c).sort((a, b) => a[1].localeCompare(b[1])));
preencherSelect('fs', 'Todos os status', STATUS.map(s => [s, s]));
['q', 'fe', 'fc', 'fs'].forEach(id => $(id).oninput = () => filtrar(0));

$('h1').innerHTML = '<tr>' + COLUNAS.map((c, i) => `<th class="${c[2] ? 'n' : ''}" data-i="${i}">${c[0]}</th>`).join('') + '</tr>';
$('h1').onclick = e => {
  const i = e.target.dataset.i;
  if (i == null) return;
  sentido = ordem == i ? -sentido : 1; ordem = +i;
  filtrar(0);
};

function filtrar(p) {
  F = filtrarBens(R, { busca: $('q').value, empresa: $('fe').value, classe: $('fc').value, status: $('fs').value });
  const k = COLUNAS[ordem][1];
  F.sort((a, b) => { const u = k(a), v = k(b); return (u == null) - (v == null) || (u > v ? 1 : u < v ? -1 : 0) * sentido; });
  pagina = p;
  desenhar();
}

/* ---------- Tabela, paginação e indicadores ---------- */
function desenhar() {
  const n = Math.max(1, Math.ceil(F.length / POR_PAGINA));
  pagina = Math.min(pagina, n - 1);

  $('t1').innerHTML = F.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA).map(x => `<tr data-i="${x.i}"><td>${x.r[0]}</td><td>${x.r[1]}</td><td class="d" title="${x.r[3]}">${x.r[3]}</td><td>${D.e[x.r[4]]}</td><td>${D.c[x.r[5]] || 'Outros'}</td><td>${x.r[13] || '—'}</td><td>${dt(x.r[2])}</td><td class="n">${f(x.r[7])}</td><td class="n">${f(x.r[8])}</td><td class="n">${f(x.r[10])}</td><td class="n">${pc(x.pct)}</td><td class="n">${y(x.vida)}</td><td class="n">${y(x.rest)}</td><td>${tag(x.st)}</td></tr>`).join('');
  $('ct').textContent = `${f0(F.length)} bens`;
  $('pn').textContent = `${pagina + 1} / ${n}`;

  const soma = i => F.reduce((s, x) => s + x.r[i], 0), qtd = st => f0(F.filter(x => x.st == st).length);
  mostrarKPIs([
    ['Total de bens', f0(F.length)], ['Custo total', rs(soma(7))], ['Valor contábil', rs(soma(10))],
    ['Em depreciação', qtd('Em depreciação')], ['Totalmente depreciados', qtd('Totalmente depreciado')], ['Total desativados', qtd('Desativado')],
  ]);
}
$('pa').onclick = () => { pagina = Math.max(0, pagina - 1); desenhar(); };
$('pp').onclick = () => { pagina++; desenhar(); };

/* ---------- Ficha do bem ---------- */
$('t1').onclick = e => {
  const tr = e.target.closest('tr');
  if (!tr) return;
  const x = R[tr.dataset.i], r = x.r;
  const campos = [
    ['Empresa', D.e[r[4]]], ['Classe', D.c[r[5]] || 'Outros'], ['Nº patrimonial', r[13] || '—'], ['Incorporação', dt(r[2])],
    ['Desativado em', dt(r[6])], ['Status', x.st], ['Custo atual', f(r[7])], ['Aquisições', f(r[11])], ['Baixas', f(r[12])],
    ['Depreciação do ano', f(r[9])], ['Depreciação acumulada', f(r[8])], ['Valor contábil', f(r[10])],
    ['Depreciação mensal', f(x.ma)], ['Vida útil implícita (a)', y(x.vida)], ['Vida restante (a)', y(x.rest)],
  ];
  $('dg').innerHTML = `<button class="fx" aria-label="Fechar">&times;</button><h2 style="margin:0;padding-right:32px">${r[0]} / ${r[1]}</h2><div>${r[3]}</div><dl>${campos.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl>`;
  $('dg').querySelector('.fx').onclick = () => $('dg').close();
  $('dg').showModal();
};
$('dg').onclick = e => { // clique fora da ficha fecha
  const b = e.currentTarget.getBoundingClientRect();
  if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) e.currentTarget.close();
};

/* ---------- Exportação ---------- */
$('x').onclick = () => baixarCSV('controle-ativos.csv', COLUNAS.map(c => c[0]).concat('Desativado em'),
  F.map(x => [x.r[0], x.r[1], x.r[3], D.e[x.r[4]], D.c[x.r[5]] || 'Outros', x.r[13] || '', dt(x.r[2]), x.r[7], x.r[8], x.r[10], x.pct ?? '', x.vida ?? '', x.rest ?? '', x.st, dt(x.r[6])]));

filtrar(0);

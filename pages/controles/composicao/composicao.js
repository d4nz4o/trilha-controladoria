/* Aba Composição geral: depreciação consolidada por classe de ativo. */
import { $, STATUS, carregarJSON, mostrarErro, preparar, preencherSelect, filtrarBens, mostrarKPIs, exportarPlanilha, nomeArquivo, f, f0, rs, y, pc } from '../commons.js';

const CABECALHO = ['Classe', 'Bens', 'Custo', 'Depr. acum.', 'Valor contábil', '% depr.', 'Taxa anual', 'Vida útil (a)', 'Vida restante (a)'];
let D, R, grupos = [];

try { [D] = await carregarJSON('ativos'); } catch (e) { mostrarErro(e); throw e; }
R = preparar(D);

preencherSelect('fe', 'Todas as empresas', Object.entries(D.e));
preencherSelect('fs', 'Todos os status', STATUS.map(s => [s, s]));
['fe', 'fs'].forEach(id => $(id).oninput = desenhar);
$('x').onclick = exportar;
desenhar();

function desenhar() {
  const F = filtrarBens(R, { empresa: $('fe').value, status: $('fs').value });

  // g[classe] = [bens, custo, depr. acum., valor contábil, custo depreciável, depr. anual, valor contábil restante]
  const g = {};
  F.forEach(x => {
    const c = D.c[x.r[5]] || 'Outros', a = g[c] ??= [0, 0, 0, 0, 0, 0, 0];
    a[0]++; a[1] += x.r[7]; a[2] += x.r[8]; a[3] += x.r[10];
    if (x.ma > 0 && x.r[7] > 0) { a[4] += x.r[7]; a[5] += x.ma * 12; a[6] += Math.max(x.r[10], 0); }
  });
  grupos = Object.entries(g).sort((a, b) => b[1][1] - a[1][1]);

  $('h2').innerHTML = '<tr>' + CABECALHO.map((t, i) => `<th class="${i ? 'n' : ''}">${t}</th>`).join('') + '</tr>';
  $('t2').innerHTML = grupos.map(([c, a]) => `<tr><td>${c}</td><td class="n">${f0(a[0])}</td><td class="n">${f(a[1])}</td><td class="n">${f(a[2])}</td><td class="n">${f(a[3])}</td><td class="n">${pc(a[1] ? -a[2] / a[1] : null)}</td><td class="n">${pc(a[4] ? a[5] / a[4] : null)}</td><td class="n">${y(a[5] ? a[4] / a[5] : null)}</td><td class="n">${y(a[5] ? a[6] / a[5] : null)}</td></tr>`).join('');

  // Indicadores
  const soma = i => F.reduce((s, x) => s + x.r[i], 0), cap = soma(7), dac = soma(8);
  const dp = F.filter(x => x.ma > 0 && x.r[7] > 0);
  const c2 = dp.reduce((s, x) => s + x.r[7], 0), a12 = dp.reduce((s, x) => s + x.ma * 12, 0), rt = dp.reduce((s, x) => s + Math.max(x.r[10], 0), 0);
  mostrarKPIs([
    ['Custo total', rs(cap)], ['Depreciação acumulada', rs(dac)], ['Valor contábil', rs(soma(10))],
    ['% depreciado', pc(cap ? -dac / cap : null)], ['Taxa anual implícita', pc(c2 ? a12 / c2 : null)],
    ['Vida útil implícita (anos)', y(a12 ? c2 / a12 : null)], ['Vida restante (anos)', y(a12 ? rt / a12 : null)],
  ]);
}

// Texto da opção escolhida num filtro (ex.: "Metrô BH"); vazio = rótulo "Todas/Todos…"
const textoFiltro = id => $(id).selectedOptions[0]?.textContent.trim() || '';

function exportar() {
  const linha = ([c, a]) => [c, a[0], a[1], a[2], a[3], a[1] ? -a[2] / a[1] : '', a[4] ? a[5] / a[4] : '', a[5] ? a[4] / a[5] : '', a[5] ? a[6] / a[5] : ''];
  // Total: soma os grupos e recalcula os índices sobre as somas
  const t = grupos.reduce((s, [, a]) => s.map((v, i) => v + a[i]), [0, 0, 0, 0, 0, 0, 0]);
  exportarPlanilha({
    pagina: 'Composição geral',
    arquivo: nomeArquivo('Ativos_Composicao', $('fe').value ? textoFiltro('fe') : 'Todas', $('fs').value ? textoFiltro('fs') : ''),
    filtros: [['Empresa', textoFiltro('fe')], ['Status', textoFiltro('fs')]],
    unidade: ['classe', 'classes'],
    colunas: [
      { titulo: 'Classe', tipo: 'texto', largura: 34 }, { titulo: 'Bens', tipo: 'inteiro', largura: 9 },
      { titulo: 'Custo', tipo: 'moeda', largura: 18 }, { titulo: 'Depr. acum.', tipo: 'moeda', largura: 18 },
      { titulo: 'Valor contábil', tipo: 'moeda', largura: 18 }, { titulo: '% depr.', tipo: 'perc', largura: 10 },
      { titulo: 'Taxa anual', tipo: 'perc', largura: 11 }, { titulo: 'Vida útil (anos)', tipo: 'anos', largura: 12 },
      { titulo: 'Vida restante (anos)', tipo: 'anos', largura: 13 },
    ],
    linhas: grupos.map(linha),
    total: grupos.length > 1 ? linha(['Total', t]) : null,
  });
}

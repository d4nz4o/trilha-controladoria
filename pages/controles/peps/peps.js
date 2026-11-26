/* Aba PEPs: árvore de projetos/PEPs com busca, filtro por natureza e expansão. */
import { $, carregarJSON, mostrarErro, mostrarKPIs, f0, dt, tag } from '../commons.js';

const LIMITE = 3000;
const NATUREZA = { A: 'Aportes', P: 'Próprias', R: 'Reversíveis' };
const abertos = new Set();

let P;
try { [P] = await carregarJSON('peps'); } catch (e) { mostrarErro(e); throw e; }

// P[i] = [índice do pai (-1 = projeto), descrição, código PEP, início base, fim base]
const N = P.map((r, i) => ({ i, par: r[0], d: r[1], p: r[2], ib: r[3], fb: r[4], ch: [], nat: r[2].split('/')[1][0], cnt: 1, lv: 0 }));
N.forEach(n => { if (n.par >= 0) { N[n.par].ch.push(n); n.lv = N[n.par].lv + 1; } });
for (let i = N.length - 1; i >= 0; i--) if (N[i].par >= 0) N[N[i].par].cnt += N[i].cnt; // total de descendentes

function desenhar() {
  const q = $('pq').value.trim().toLowerCase(), nat = $('pnat').value, linhas = [];

  // Com busca: mostra os PEPs encontrados e todos os seus ancestrais, já expandidos
  let achados = null;
  if (q) {
    achados = new Set();
    N.forEach(n => {
      if ((!nat || n.nat == nat) && (n.p.toLowerCase().includes(q) || n.d.toLowerCase().includes(q)))
        for (let a = n; a && !achados.has(a); a = a.par >= 0 ? N[a.par] : null) achados.add(a);
    });
  }
  const visitar = n => {
    if (achados && !achados.has(n)) return;
    linhas.push(n);
    if (n.ch.length && (achados || abertos.has(n.i))) n.ch.forEach(visitar);
  };
  N.forEach(n => { if (n.par < 0 && (!nat || n.nat == nat)) visitar(n); });

  $('pt').innerHTML = linhas.slice(0, LIMITE).map(n => {
    const aberto = achados || abertos.has(n.i);
    return `<tr data-i="${n.i}"${n.ch.length ? ' class="expansivel"' : ''}><td style="padding-left:${n.lv * 20 + 10}px"><span class="btn-expand-pill${n.ch.length ? (aberto ? ' is-open' : '') : ' pep-vazio'}"></span>${n.d}</td><td>${n.p}</td><td>${n.lv ? String(n.lv + 1).padStart(2, '0') : '00'}</td><td>${tag(NATUREZA[n.nat])}</td><td>${n.par < 0 ? dt(n.ib) : ''}</td><td>${n.par < 0 ? dt(n.fb) : ''}</td><td class="n">${n.ch.length ? f0(n.cnt - 1) : ''}</td></tr>`;
  }).join('');
  $('pnota').textContent = linhas.length > LIMITE
    ? `Mostrando ${f0(LIMITE)} de ${f0(linhas.length)} linhas; refine a busca.`
    : `${f0(linhas.length)} linhas exibidas. Nível 01 do SAP (repete o código do projeto) foi fundido ao nível 00.`;

  const c = k => N.filter(n => n.nat == k).length;
  mostrarKPIs([['Total de PEPs', f0(N.length)], ['Projetos', f0(N.filter(n => n.par < 0).length)], ['PEPs de aportes', f0(c('A'))], ['PEPs próprios', f0(c('P'))], ['PEPs reversíveis', f0(c('R'))]]);
}

$('pq').oninput = $('pnat').onchange = desenhar;
$('prc').onclick = () => { abertos.clear(); desenhar(); };
$('pex').onclick = () => { N.forEach(n => { if (n.par < 0) abertos.add(n.i); }); desenhar(); };
$('pt').onclick = e => {
  const tr = e.target.closest('tr'), n = tr && N[tr.dataset.i];
  if (!n || !n.ch.length) return;
  abertos.has(n.i) ? abertos.delete(n.i) : abertos.add(n.i);
  desenhar();
};

desenhar();

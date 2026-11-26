// ==========================================
// PAINEL DO FECHAMENTO (supabase/13_tarefas_painel.sql)
// Para a competência selecionada: indicadores, evolução por dia útil (realizado × planejado × competência
// anterior), carga por responsável e tarefas atrasadas.
// "Concluída" = tarefa com concluida_em (preenchida pelo banco ao entrar na coluna de conclusão).
// Dias úteis: mesmas regras e funções de ../tarefas/competencias.js.
// ==========================================

let colunasPainel = [];

async function iniciarPainel() {
  if (typeof sbClient === 'undefined' || !sbClient) return;
  const { data } = await sbClient.from('tarefas_colunas').select('id_coluna, titulo_coluna, ordem_coluna, conclui_tarefa').order('ordem_coluna');
  colunasPainel = data || [];
  await carregarCompetencias();
  await carregarPainel();
}

// Chamado por competencias.js ao trocar a competência
function aoTrocarCompetencia() { carregarPainel(); }

async function buscarTarefasDoMes(idMes) {
  if (!idMes) return [];
  const { data, error } = await sbClient.from('tarefas')
    .select('id_tarefa, titulo_tarefa, id_coluna, id_mes, prazo_fim, concluida_em, tarefa_arquivada, tipo_prazo, prazo_du_fim, tarefas_colaboradores (id_colab, colaboradores (id_colab, nome_colab))')
    .eq('id_mes', idMes);
  if (error) throw new Error(error.message);
  return (data || []).filter(t => t.tarefa_arquivada !== true);
}

const dataISO = v => (v ? String(v).slice(0, 10) : null);
const concluida = t => !!t.concluida_em;
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const fmtPct = v => `${String(v).replace('.', ',')}%`;
const nomeDU = n => (n === null ? '—' : n > 0 ? `D+${n}` : n === 0 ? 'D0' : `D${n}`);

async function carregarPainel() {
  const mes = mesSelecionado();
  const kpis = document.getElementById('painelKpis');
  if (!mes) {
    kpis.innerHTML = '<p class="painel-vazio">Nenhuma competência cadastrada. Rode supabase/12_tarefas_meses.sql.</p>';
    return;
  }
  const i = listaMeses.findIndex(m => m.id_mes === mes.id_mes);
  const anterior = i > 0 ? listaMeses[i - 1] : null;
  kpis.innerHTML = '<p class="painel-vazio">Carregando…</p>';
  try {
    const [atuais, anteriores] = await Promise.all([buscarTarefasDoMes(mes.id_mes), buscarTarefasDoMes(anterior?.id_mes)]);
    desenharPainel(mes, atuais, anterior, anteriores);
  } catch (erro) {
    kpis.innerHTML = `<p class="painel-vazio">Não foi possível carregar o painel: ${escTarefa(erro.message)}</p>`;
  }
}

/* ---------- Cálculos ---------- */

function resumo(comp, tarefas) {
  const hoje = paraISO(new Date());
  const total = tarefas.length;
  const feitas = tarefas.filter(concluida);
  const noPrazo = feitas.filter(t => t.prazo_fim && dataISO(t.concluida_em) <= dataISO(t.prazo_fim));
  const feitasComPrazo = feitas.filter(t => t.prazo_fim);
  const atrasadas = tarefas.filter(t => !concluida(t) && t.prazo_fim && dataISO(t.prazo_fim) < hoje);
  const diaConclusao = t => numeroDoDiaUtil(comp, dataISO(t.concluida_em));
  const fechamento = total && feitas.length === total ? Math.max(...feitas.map(diaConclusao)) : null;
  // % concluído até o dia útil n (realizado) e % que deveria estar concluído pelos prazos (planejado)
  const realizadoAte = n => pct(feitas.filter(t => diaConclusao(t) <= n).length, total);
  const planejadoAte = n => pct(tarefas.filter(t => t.prazo_fim && numeroDoDiaUtil(comp, dataISO(t.prazo_fim)) <= n).length, total);
  return { total, feitas, noPrazo, feitasComPrazo, atrasadas, fechamento, realizadoAte, planejadoAte, diaConclusao,
           hoje: numeroDoDiaUtil(comp, hoje) };
}

/* ---------- Desenho ---------- */

function desenharPainel(mes, tarefas, anterior, tarefasAnt) {
  const comp = mes.competencia_mes;
  const r = resumo(comp, tarefas);
  const ra = anterior ? resumo(anterior.competencia_mes, tarefasAnt) : null;
  const rotAnt = anterior ? rotuloCompetencia(anterior.competencia_mes) : '';
  atualizarContagemCompetencia(tarefas.length);
  document.getElementById('painelSub').textContent =
    `Competência ${rotuloCompetencia(comp)} · hoje é ${nomeDU(r.hoje)} · ${r.total} ${r.total === 1 ? 'tarefa' : 'tarefas'}`;

  // Indicadores
  const card = (titulo, valor, detalhe, classe = '', barra = null) => `
    <div class="painel-kpi ${classe}">
      <span class="kpi-titulo">${titulo}</span>
      <strong class="kpi-valor ${/\d/.test(valor) ? '' : 'kpi-texto'}">${valor}</strong>
      ${barra !== null ? `<span class="kpi-barra"><span style="width:${Math.min(barra, 100)}%"></span></span>` : ''}
      <span class="kpi-detalhe">${detalhe}</span>
    </div>`;
  const pConc = pct(r.feitas.length, r.total);
  const fechamentoTxt = r.fechamento !== null ? nomeDU(r.fechamento) : 'em andamento';
  const fechamentoAnt = ra && ra.fechamento !== null ? `${rotAnt}: ${nomeDU(ra.fechamento)}` : (anterior ? `${rotAnt}: não concluída` : 'sem competência anterior');
  document.getElementById('painelKpis').innerHTML =
    card('Concluídas', fmtPct(pConc), `${r.feitas.length} de ${r.total} tarefas`, '', pConc) +
    card('Concluídas no prazo', r.feitasComPrazo.length ? fmtPct(pct(r.noPrazo.length, r.feitasComPrazo.length)) : '—',
         `${r.noPrazo.length} de ${r.feitasComPrazo.length} com prazo`) +
    card('Atrasadas', String(r.atrasadas.length), r.atrasadas.length ? 'prazo vencido e não concluídas' : 'nenhuma tarefa atrasada',
         r.atrasadas.length ? 'alerta' : 'ok') +
    card('Hoje', nomeDU(r.hoje), dataCurta(paraISO(new Date()))) +
    card('Fechamento', fechamentoTxt, fechamentoAnt, r.fechamento !== null && ra && ra.fechamento !== null
         ? (r.fechamento < ra.fechamento ? 'ok' : r.fechamento > ra.fechamento ? 'alerta' : '') : '');

  desenharGrafico(r, ra, rotuloCompetencia(comp), rotAnt);

  // Comparação no mesmo dia útil
  const ref = Math.min(r.hoje, 25);
  document.getElementById('painelComparacao').textContent = ra && ra.total
    ? `Em ${nomeDU(ref)}: ${rotuloCompetencia(comp)} com ${fmtPct(r.realizadoAte(ref))} concluído; ${rotAnt} estava com ${fmtPct(ra.realizadoAte(ref))}. Planejado pelos prazos: ${fmtPct(r.planejadoAte(ref))}.`
    : `Em ${nomeDU(ref)}: ${fmtPct(r.realizadoAte(ref))} concluído; planejado pelos prazos: ${fmtPct(r.planejadoAte(ref))}.`;

  desenharResponsaveis(comp, tarefas, r);
  desenharAtrasadas(comp, r);
}

function desenharGrafico(r, ra, rot, rotAnt) {
  const alvo = document.getElementById('painelGrafico');
  if (!r.total) { alvo.innerHTML = '<p class="painel-vazio">Nenhuma tarefa nesta competência.</p>'; document.getElementById('painelLegenda').innerHTML = ''; return; }
  // Eixo: de D-3 até o maior entre hoje, prazos e conclusões (limitado a D+25)
  const prazos = [...r.feitas.map(r.diaConclusao), r.hoje, 10];
  const xMin = -3, xMax = Math.min(25, Math.max(...prazos.filter(n => n !== null)) + 1);
  const W = 860, H = 260, E = 44, D = 16, T = 14, B = 30;
  const x = n => E + ((n - xMin) / (xMax - xMin)) * (W - E - D);
  const y = v => T + (1 - v / 100) * (H - T - B);
  const serie = (fn, ate) => { const pts = []; for (let n = xMin; n <= Math.min(ate, xMax); n++) pts.push(`${x(n).toFixed(1)},${y(fn(n)).toFixed(1)}`); return pts.join(' '); };

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolução do % concluído por dia útil">`;
  [0, 25, 50, 75, 100].forEach(v => {
    svg += `<line x1="${E}" x2="${W - D}" y1="${y(v)}" y2="${y(v)}" class="g-grade"/><text x="${E - 8}" y="${y(v) + 4}" class="g-eixo" text-anchor="end">${v}%</text>`;
  });
  for (let n = xMin; n <= xMax; n++) {
    if ((xMax - xMin) > 16 && n % 2 && n !== 0) continue;
    svg += `<text x="${x(n)}" y="${H - 10}" class="g-eixo" text-anchor="middle">${nomeDU(n)}</text>`;
  }
  if (r.hoje >= xMin && r.hoje <= xMax) {
    svg += `<line x1="${x(r.hoje)}" x2="${x(r.hoje)}" y1="${T}" y2="${H - B}" class="g-hoje"/><text x="${x(r.hoje) + 4}" y="${T + 10}" class="g-hoje-txt">hoje</text>`;
  }
  svg += `<polyline points="${serie(r.planejadoAte, xMax)}" class="g-planejado"/>`;
  if (ra && ra.total) svg += `<polyline points="${serie(ra.realizadoAte, xMax)}" class="g-anterior"/>`;
  svg += `<polyline points="${serie(r.realizadoAte, r.hoje)}" class="g-realizado"/>`;
  const ult = Math.max(xMin, Math.min(r.hoje, xMax));
  svg += `<circle cx="${x(ult)}" cy="${y(r.realizadoAte(ult))}" r="4" class="g-ponto"/></svg>`;
  alvo.innerHTML = svg;

  document.getElementById('painelLegenda').innerHTML =
    `<span><i class="leg-realizado"></i>${rot} (realizado)</span><span><i class="leg-planejado"></i>Planejado pelos prazos</span>` +
    (ra && ra.total ? `<span><i class="leg-anterior"></i>${rotAnt} (realizado)</span>` : '');
}

function responsaveisDe(t) {
  const lista = (t.tarefas_colaboradores || []).map(tc => tc.colaboradores).filter(Boolean);
  return lista.length ? lista : [{ id_colab: null, nome_colab: 'Sem responsável' }];
}

function desenharResponsaveis(comp, tarefas, r) {
  const alvo = document.getElementById('painelResponsaveis');
  if (!tarefas.length) { alvo.innerHTML = '<p class="painel-vazio">Nenhuma tarefa nesta competência.</p>'; return; }
  const hoje = paraISO(new Date());
  const limite = diaUtilDaCompetencia(comp, Math.max(r.hoje, 0) + 2) || hoje;   // próximos 2 dias úteis
  const porPessoa = new Map();
  tarefas.forEach(t => responsaveisDe(t).forEach(p => {
    const chave = p.id_colab ?? 'sem';
    const reg = porPessoa.get(chave) || { p, total: 0, feitas: 0, atrasadas: 0, proximas: 0 };
    reg.total++;
    if (concluida(t)) reg.feitas++;
    else if (t.prazo_fim && dataISO(t.prazo_fim) < hoje) reg.atrasadas++;
    else if (t.prazo_fim && dataISO(t.prazo_fim) <= limite) reg.proximas++;
    porPessoa.set(chave, reg);
  }));
  const linhas = [...porPessoa.values()].sort((a, b) => b.atrasadas - a.atrasadas || (b.total - b.feitas) - (a.total - a.feitas) || b.total - a.total);
  alvo.innerHTML = `
    <table class="painel-tabela">
      <thead><tr><th>Responsável</th><th>Tarefas</th><th>Concluídas</th><th>Atrasadas</th><th title="Não concluídas com prazo nos próximos 2 dias úteis">Vencem em 2 DU</th></tr></thead>
      <tbody>${linhas.map(l => `
        <tr>
          <td><span class="pessoa"><span class="avatar-mini" style="background:${l.p.id_colab ? corDoAvatar(l.p.id_colab) : '#cbd5e1'}">${iniciaisPainel(l.p.nome_colab)}</span>${escTarefa(l.p.nome_colab)}</span></td>
          <td>${l.total}</td>
          <td><span class="mini-barra"><span style="width:${pct(l.feitas, l.total)}%"></span></span>${l.feitas}</td>
          <td class="${l.atrasadas ? 'num-alerta' : ''}">${l.atrasadas}</td>
          <td>${l.proximas}</td>
        </tr>`).join('')}</tbody>
    </table>`;
}

function desenharAtrasadas(comp, r) {
  const alvo = document.getElementById('painelAtrasadas');
  if (!r.atrasadas.length) { alvo.innerHTML = '<p class="painel-vazio ok">Nenhuma tarefa atrasada. 🎉</p>'; return; }
  const itens = r.atrasadas
    .map(t => ({ t, atraso: r.hoje - numeroDoDiaUtil(comp, dataISO(t.prazo_fim)) }))
    .sort((a, b) => b.atraso - a.atraso);
  alvo.innerHTML = `<ul class="painel-atrasadas">${itens.map(({ t, atraso }) => `
    <li>
      <div class="atr-titulo">${escTarefa(t.titulo_tarefa)}
        <small>${responsaveisDe(t).map(p => escTarefa(p.nome_colab)).join(', ')}</small></div>
      <div class="atr-prazo">${t.tipo_prazo === 'dias_uteis' ? `<b>${rotuloDU(t.prazo_du_fim)}</b> ` : ''}${dataCurta(dataISO(t.prazo_fim))}
        <span class="atr-dias">${atraso > 0 ? `${atraso} ${atraso === 1 ? 'dia útil' : 'dias úteis'} de atraso` : 'vencida'}</span></div>
    </li>`).join('')}</ul>`;
}

const iniciaisPainel = nome => String(nome || '?').split(' ').filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');

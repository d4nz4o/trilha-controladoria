// ==========================================
// TAREFAS POR COMPETÊNCIA (supabase/12_tarefas_meses.sql)
// - Barra de competência acima do quadro (‹ out/26 ›) e "Começar próximo mês"
// - Cálculo de dias úteis na tela (prévias), com a mesma regra do banco:
//     D+1 = 1º dia útil do mês seguinte à competência; D0 = último dia útil da competência; D-1 = penúltimo…
//   As datas gravadas são sempre as calculadas pelo banco; aqui é só para mostrar antes de salvar.
// ==========================================

let listaMeses = [];            // [{ id_mes, competencia_mes, id_mes_origem }]
let idMesSelecionado = null;
let feriadosTarefas = new Set(); // 'aaaa-mm-dd'
let competenciasProntas = null;

const CHAVE_MES = 'tarefas:competencia';
const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/* ---------- Datas ---------- */

const paraISO = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const deISO = iso => { const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number); return new Date(a, m - 1, d); };

function rotuloCompetencia(iso) {
  const d = deISO(iso);
  return `${MESES_CURTOS[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;
}

function dataCurta(iso) {
  if (!iso) return '—';
  const d = deISO(iso);
  const semana = d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
  return `${semana}, ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

const ehDiaUtil = d => d.getDay() !== 0 && d.getDay() !== 6 && !feriadosTarefas.has(paraISO(d));

// Data do D+N de uma competência ('aaaa-mm-01'); null se N vazio
function diaUtilDaCompetencia(competenciaISO, n) {
  if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return null;
  n = Number(n);
  const ini = deISO(competenciaISO);
  let d, conta = 0;
  if (n >= 1) {
    d = new Date(ini.getFullYear(), ini.getMonth() + 1, 0);       // último dia da competência
    while (conta < n) { d.setDate(d.getDate() + 1); if (ehDiaUtil(d)) conta++; }
  } else {
    d = new Date(ini.getFullYear(), ini.getMonth() + 1, 1);       // 1º dia do mês seguinte
    while (conta < 1 - n) { d.setDate(d.getDate() - 1); if (ehDiaUtil(d)) conta++; }
  }
  return paraISO(d);
}

function proximoDiaUtil(iso) {
  if (!iso) return null;
  const d = deISO(iso);
  while (!ehDiaUtil(d)) d.setDate(d.getDate() + 1);
  return paraISO(d);
}

// Data fixa clonada: +1 mês, no próximo dia útil (igual ao banco)
function dataNoMesSeguinte(iso) {
  if (!iso) return null;
  const d = deISO(iso);
  const alvo = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  const ultimo = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
  alvo.setDate(Math.min(d.getDate(), ultimo));
  return proximoDiaUtil(paraISO(alvo));
}

// Número do dia útil de uma data em relação à competência (inverso de diaUtilDaCompetencia):
// datas depois do mês da competência dão D+1, D+2…; o último dia útil da competência é D0; antes, D-1, D-2…
// Fim de semana ou feriado conta como o dia útil anterior.
function numeroDoDiaUtil(competenciaISO, dataISO) {
  if (!dataISO) return null;
  const ini = deISO(competenciaISO);
  const ultimo = new Date(ini.getFullYear(), ini.getMonth() + 1, 0);
  const d = deISO(dataISO);
  let n = 0;
  if (d > ultimo) {
    for (const x = new Date(ultimo); x < d;) { x.setDate(x.getDate() + 1); if (ehDiaUtil(x)) n++; }
    return n;
  }
  for (const x = new Date(d); x < ultimo;) { x.setDate(x.getDate() + 1); if (ehDiaUtil(x)) n--; }
  return n;
}

const rotuloDU = n => (n === null || n === undefined || n === '') ? '' : (Number(n) >= 0 ? `D+${Number(n)}` : `D${Number(n)}`).replace('D+0', 'D0');

/* ---------- Competências ---------- */

const mesSelecionado = () => listaMeses.find(m => m.id_mes === idMesSelecionado) || null;
const competenciaSelecionadaISO = () => mesSelecionado()?.competencia_mes || null;
const chaveCacheTarefas = () => 'tarefas-' + (idMesSelecionado ?? 'todas');

async function carregarCompetencias() {
  if (competenciasProntas) return competenciasProntas;
  competenciasProntas = (async () => {
    if (typeof sbClient === 'undefined' || !sbClient) return;
    const [meses, feriados] = await Promise.all([
      sbClient.from('tarefas_meses').select('id_mes, competencia_mes, id_mes_origem').order('competencia_mes', { ascending: true }),
      sbClient.from('tarefas_feriados').select('data_feriado'),
    ]);
    if (meses.error) {
      // Banco ainda sem as competências (12_tarefas_meses.sql): o quadro mostra todas as tarefas, como antes
      console.warn('Competências indisponíveis:', meses.error.message);
      listaMeses = [];
      idMesSelecionado = null;
      desenharBarraCompetencia();
      return;
    }
    listaMeses = meses.data || [];
    feriadosTarefas = new Set((feriados.data || []).map(f => String(f.data_feriado).slice(0, 10)));
    let salvo = null;
    try { salvo = Number(localStorage.getItem(CHAVE_MES)); } catch (e) { /* sem armazenamento */ }
    const existe = listaMeses.some(m => m.id_mes === salvo);
    idMesSelecionado = existe ? salvo : (listaMeses.length ? listaMeses[listaMeses.length - 1].id_mes : null);
    desenharBarraCompetencia();
  })();
  return competenciasProntas;
}

function selecionarCompetencia(idMes, forcar = false) {
  if (idMes === idMesSelecionado && !forcar) return;
  idMesSelecionado = idMes;
  try { localStorage.setItem(CHAVE_MES, String(idMes)); } catch (e) { /* ignora */ }
  desenharBarraCompetencia();
  // Outras páginas (ex.: painel) definem aoTrocarCompetencia; o quadro de tarefas recarrega as tarefas
  if (typeof aoTrocarCompetencia === 'function') { aoTrocarCompetencia(idMes); return; }
  listaTarefas = Cache.ler(chaveCacheTarefas()) || [];
  tarefasCarregadas = false;
  renderizarTarefas(true);
}

function mudarCompetencia(passo) {
  const i = listaMeses.findIndex(m => m.id_mes === idMesSelecionado);
  const alvo = listaMeses[i + passo];
  if (alvo) selecionarCompetencia(alvo.id_mes);
}

function desenharBarraCompetencia() {
  const barra = document.getElementById('barraCompetencia');
  if (!barra) return;
  if (!listaMeses.length) { barra.hidden = true; return; }
  barra.hidden = false;
  const i = listaMeses.findIndex(m => m.id_mes === idMesSelecionado);
  const ultima = listaMeses[listaMeses.length - 1];
  barra.innerHTML = `
    <div class="competencia-seletor" role="group" aria-label="Competência">
      <span class="competencia-rotulo">Competência</span>
      <button type="button" class="btn-competencia" aria-label="Competência anterior" ${i <= 0 ? 'disabled' : ''} onclick="mudarCompetencia(-1)">&lt;</button>
      <select id="selectCompetencia" aria-label="Competência" onchange="selecionarCompetencia(Number(this.value))">
        ${listaMeses.map(m => `<option value="${m.id_mes}" ${m.id_mes === idMesSelecionado ? 'selected' : ''}>${rotuloCompetencia(m.competencia_mes)}</option>`).join('')}
      </select>
      <button type="button" class="btn-competencia" aria-label="Próxima competência" ${i >= listaMeses.length - 1 ? 'disabled' : ''} onclick="mudarCompetencia(1)">&gt;</button>
      <span class="competencia-contagem" id="competenciaContagem"></span>
    </div>
    ${barra.dataset.semInicio !== undefined ? '' : `<button type="button" class="btn-secondary btn-proximo-mes" data-editar="tarefas" onclick="abrirInicioDeMes()"
            title="Cria ${rotuloCompetencia(proximaCompetencia(ultima.competencia_mes))}, com a opção de clonar tarefas de ${rotuloCompetencia(ultima.competencia_mes)}">
      Começar ${rotuloCompetencia(proximaCompetencia(ultima.competencia_mes))}
    </button>`}`;
}

function atualizarContagemCompetencia(qtd) {
  const el = document.getElementById('competenciaContagem');
  if (el) el.textContent = `${qtd} ${qtd === 1 ? 'tarefa' : 'tarefas'}`;
}

function proximaCompetencia(iso) {
  const d = deISO(iso);
  return paraISO(new Date(d.getFullYear(), d.getMonth() + 1, 1));
}

/* ---------- Começar próximo mês ---------- */

let inicioDeMes = null;   // { origem, nova, tarefas: [], marcadas: Set }

async function abrirInicioDeMes() {
  await carregarCompetencias();
  if (!listaMeses.length) return;
  const origem = listaMeses[listaMeses.length - 1];
  const nova = proximaCompetencia(origem.competencia_mes);

  let modal = document.getElementById('modalInicioMes');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modalInicioMes';
    modal.className = 'modal-overlay';
    modal.addEventListener('click', e => { if (e.target === modal) fecharInicioDeMes(); });
    document.body.appendChild(modal);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal.classList.contains('active')) fecharInicioDeMes(); });
  }
  modal.innerHTML = `
    <div class="modal-card-container inicio-mes" role="dialog" aria-modal="true" aria-labelledby="inicioMesTitulo">
      <button type="button" class="modal-close-btn" aria-label="Fechar" onclick="fecharInicioDeMes()">&times;</button>
      <div class="modal-header">
        <span class="modal-coluna-badge">Nova competência</span>
        <h2 id="inicioMesTitulo">Começar ${rotuloCompetencia(nova)}</h2>
      </div>
      <div class="inicio-opcoes" role="radiogroup" aria-label="Como começar">
        <label class="inicio-opcao"><input type="radio" name="inicioModo" value="clonar" checked onchange="modoInicioAlterado()">
          <span><strong>Clonar tarefas de ${rotuloCompetencia(origem.competencia_mes)}</strong><small>Escolha abaixo; as recorrentes já vêm marcadas.</small></span></label>
        <label class="inicio-opcao"><input type="radio" name="inicioModo" value="vazio" onchange="modoInicioAlterado()">
          <span><strong>Começar vazio</strong><small>A competência é criada sem tarefas.</small></span></label>
      </div>
      <div class="inicio-lista-area" id="inicioListaArea">
        <div class="inicio-lista-topo">
          <span id="inicioContagem"></span>
          <span class="inicio-atalhos">Marcar: <button type="button" onclick="marcarInicio('todas')">todas</button> ·
            <button type="button" onclick="marcarInicio('recorrentes')">recorrentes</button> · <button type="button" onclick="marcarInicio('nenhuma')">nenhuma</button></span>
        </div>
        <div class="inicio-lista" id="inicioLista"><p class="inicio-vazio">Carregando tarefas…</p></div>
        <p class="inicio-nota">Vão para a 1ª coluna, com responsáveis, tags e checklist (desmarcado). Comentários, anexos e histórico não são copiados.
          Prazos em dias úteis são recalculados; datas fixas avançam um mês, para o próximo dia útil.</p>
      </div>
      <div class="popup-rodape">
        <span class="popup-feedback" id="inicioFeedback" role="status"></span>
        <button type="button" class="btn-secondary" onclick="fecharInicioDeMes()">Cancelar</button>
        <button type="button" class="btn-primary" id="btnConfirmarInicioMes" onclick="confirmarInicioDeMes()">Começar ${rotuloCompetencia(nova)}</button>
      </div>
    </div>`;
  modal.classList.add('active');

  inicioDeMes = { origem, nova, tarefas: [], marcadas: new Set() };
  const { data, error } = await sbClient.from('tarefas')
    .select('id_tarefa, titulo_tarefa, id_coluna, tarefa_recorrente, tipo_prazo, prazo_du_inicio, prazo_du_fim, prazo_inicio, prazo_fim, tarefa_arquivada')
    .eq('id_mes', origem.id_mes).order('id_tarefa', { ascending: true });
  if (error) { document.getElementById('inicioLista').innerHTML = `<p class="inicio-vazio">Não foi possível carregar as tarefas: ${error.message}</p>`; return; }
  inicioDeMes.tarefas = (data || []).filter(t => t.tarefa_arquivada !== true);
  inicioDeMes.tarefas.forEach(t => { if (t.tarefa_recorrente) inicioDeMes.marcadas.add(t.id_tarefa); });
  desenharListaInicio();
}

function prazoPrevisto(t, competenciaNova) {
  if (t.tipo_prazo === 'dias_uteis') return { texto: rotuloDU(t.prazo_du_fim), data: diaUtilDaCompetencia(competenciaNova, t.prazo_du_fim) };
  return { texto: 'data', data: dataNoMesSeguinte(t.prazo_fim) };
}

function desenharListaInicio() {
  const lista = document.getElementById('inicioLista');
  if (!inicioDeMes.tarefas.length) { lista.innerHTML = '<p class="inicio-vazio">Nenhuma tarefa nesta competência.</p>'; atualizarContagemInicio(); return; }
  const coluna = id => (listaColunas || []).find(c => c.id_coluna == id)?.titulo_coluna || '';
  lista.innerHTML = inicioDeMes.tarefas.map(t => {
    const p = prazoPrevisto(t, inicioDeMes.nova);
    return `
      <label class="inicio-item">
        <input type="checkbox" data-id="${t.id_tarefa}" ${inicioDeMes.marcadas.has(t.id_tarefa) ? 'checked' : ''} onchange="alternarInicio(${t.id_tarefa}, this.checked)">
        <span class="inicio-item-titulo">${escTarefa(t.titulo_tarefa)}${t.tarefa_recorrente ? ' <em class="tag-recorrente" title="Recorrente">↻ recorrente</em>' : ''}
          <small>${escTarefa(coluna(t.id_coluna))}</small></span>
        <span class="inicio-item-prazo">${p.data ? `${t.tipo_prazo === 'dias_uteis' ? `<b>${p.texto}</b> ` : ''}${dataCurta(p.data)}` : '<span class="sem-prazo">sem prazo</span>'}</span>
      </label>`;
  }).join('');
  atualizarContagemInicio();
}

function alternarInicio(id, marcada) {
  if (marcada) inicioDeMes.marcadas.add(id); else inicioDeMes.marcadas.delete(id);
  atualizarContagemInicio();
}

function marcarInicio(qual) {
  inicioDeMes.marcadas = new Set(inicioDeMes.tarefas.filter(t => qual === 'todas' || (qual === 'recorrentes' && t.tarefa_recorrente)).map(t => t.id_tarefa));
  desenharListaInicio();
}

function atualizarContagemInicio() {
  const n = inicioDeMes.marcadas.size, total = inicioDeMes.tarefas.length;
  const el = document.getElementById('inicioContagem');
  if (el) el.textContent = `${n} de ${total} ${total === 1 ? 'tarefa selecionada' : 'tarefas selecionadas'}`;
}

function modoInicioAlterado() {
  const vazio = document.querySelector('input[name="inicioModo"]:checked').value === 'vazio';
  document.getElementById('inicioListaArea').classList.toggle('desativada', vazio);
}

function fecharInicioDeMes() {
  const modal = document.getElementById('modalInicioMes');
  if (modal && modal.dataset.gravando !== 'sim') modal.classList.remove('active');
}

async function confirmarInicioDeMes() {
  const modal = document.getElementById('modalInicioMes');
  const botao = document.getElementById('btnConfirmarInicioMes');
  const feedback = document.getElementById('inicioFeedback');
  const vazio = document.querySelector('input[name="inicioModo"]:checked').value === 'vazio';
  const ids = vazio ? [] : [...inicioDeMes.marcadas];

  modal.dataset.gravando = 'sim';
  botao.disabled = true;
  feedback.className = 'popup-feedback';
  feedback.textContent = ids.length ? `Criando ${rotuloCompetencia(inicioDeMes.nova)} com ${ids.length} tarefa(s)…` : `Criando ${rotuloCompetencia(inicioDeMes.nova)}…`;

  const { data: idNovo, error } = await sbClient.rpc('tarefas_iniciar_mes', {
    p_competencia: inicioDeMes.nova,
    p_id_mes_origem: vazio ? null : inicioDeMes.origem.id_mes,
    p_ids_tarefas: ids,
  });
  modal.dataset.gravando = '';
  if (error) {
    feedback.className = 'popup-feedback popup-feedback-erro';
    feedback.textContent = 'Não foi possível criar a competência: ' + error.message;
    botao.disabled = false;
    return;
  }
  modal.classList.remove('active');
  competenciasProntas = null;
  await carregarCompetencias();
  selecionarCompetencia(idNovo, true);   // força a troca: a lista recarregada pode já apontar para a nova competência
}

function escTarefa(t) {
  return String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

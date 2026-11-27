// LÓGICA DO MODAL DE DETALHES DA TAREFA

let tarefaModalAtual = null;

async function abrirModalDetalhesCard(idTarefa) {
  if (!sbClient) return;

  try {
    const { data: tarefa, error } = await sbClient
      .from('tarefas')
      .select(`
        *,
        tarefas_colaboradores (
          id_colab,
          colaboradores (nome_colab, id_colab)
        ),
        subtarefas (*),
        ${SELECT_TAGS_DA_TAREFA}
      `)
      .eq('id_tarefa', idTarefa)
      .single();

    if (error || !tarefa) {
      console.error('Erro ao buscar detalhes da tarefa:', error);
      return;
    }

    tarefaModalAtual = normalizarTagsDaTarefa(tarefa);
    tarefaModalAtual.subtarefas = (tarefa.subtarefas || [])
      .sort((a, b) => (a.ordem_subtarefa ?? 0) - (b.ordem_subtarefa ?? 0) || a.id_subtarefa - b.id_subtarefa);

    const modal = document.getElementById('modalCardDetalhes');
    if (!modal) return;
    modal.classList.add('active');

    document.getElementById('modalCardTitulo').innerText = tarefa.titulo_tarefa || 'Sem título';
    document.getElementById('modalCardDescricao').value = tarefa.descricao_tarefa || '';
    document.getElementById('modalCardPrioridade').value = tarefa.prioridade_tarefa || 'Média';
    
    preencherPrazoCardModal();
    Permissoes.travar(modal.querySelector('.modal-card-container') || modal, 'tarefas');   // só leitura para quem não edita

    const colEncontrada = listaColunas.find(c => c.id_coluna == tarefa.id_coluna);
    const badge = document.getElementById('modalCardColunaBadge');
    if (badge) {
      badge.innerText = colEncontrada ? colEncontrada.titulo_coluna : 'Sem Status';
      if (colEncontrada && colEncontrada.cor_coluna) {
        badge.style.backgroundColor = colEncontrada.cor_coluna;
        badge.style.color = '#1e293b';
      }
    }

    renderizarModalResponsaveis();
    renderizarModalSubtarefas();
    renderizarModalTags();
    await carregarModalAnexos();
    await carregarModalComentarios();

  } catch (err) {
    console.error('Erro ao abrir modal:', err);
  }
}

function fecharModalDetalhes(event) {
  if (event && event.target !== event.currentTarget) return;
  const modal = document.getElementById('modalCardDetalhes');
  if (modal) modal.classList.remove('active');
  tarefaModalAtual = null;
  renderizarTarefas(true);
}

function renderizarModalResponsaveis() {
  const container = document.getElementById('modalResponsaveisAvatares');
  if (!container || !tarefaModalAtual) return;

  container.innerHTML = '';
  const vinculos = tarefaModalAtual.tarefas_colaboradores || [];

  if (vinculos.length === 0) {
    container.innerHTML = '<span style="font-size: 0.8rem; color: var(--text-muted);">Sem responsável</span>';
    return;
  }

  vinculos.forEach(v => {
    const colab = v.colaboradores;
    if (!colab) return;
    const inc = (colab.nome_colab || '?').split(' ').filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');

    const chip = document.createElement('div');
    chip.style.display = 'inline-flex';
    chip.style.alignItems = 'center';
    chip.style.gap = '6px';
    chip.style.background = 'var(--bg-subtle)';
    chip.style.padding = '4px 8px';
    chip.style.borderRadius = '12px';
    chip.style.fontSize = '0.8rem';

    chip.innerHTML = `
      <div class="avatar" style="background:${corDoAvatar(colab.id_colab)}; width:22px; height:22px; font-size:0.65rem;">${inc}</div>
      <span>${colab.nome_colab}</span>
    `;
    container.appendChild(chip);
  });
}

function renderizarModalSubtarefas() {
  const container = document.getElementById('modalSubtarefasLista');
  if (!container || !tarefaModalAtual) return;

  container.innerHTML = '';
  const subs = tarefaModalAtual.subtarefas || [];

  if (subs.length === 0) {
    document.getElementById('modalChecklistProgressBar').style.width = '0%';
    document.getElementById('modalChecklistProgressoTexto').innerText = '0%';
  } else {
    const concluidas = subs.filter(s => s.concluido).length;
    const porc = Math.round((concluidas / subs.length) * 100);
    document.getElementById('modalChecklistProgressBar').style.width = `${porc}%`;
    document.getElementById('modalChecklistProgressoTexto').innerText = `${porc}%`;
  }

  subs.forEach(s => {
    const item = document.createElement('div');
    item.className = `subtask-item ${s.concluido ? 'concluida' : ''}`;
    item.innerHTML = `
      <input type="checkbox" ${s.concluido ? 'checked' : ''} onchange="alternarSubtarefaModal(${s.id_subtarefa}, this.checked)">
      <span>${s.titulo_subtarefa}</span>
      <button type="button" class="btn-del-sub" onclick="excluirSubtarefaModal(${s.id_subtarefa})">&times;</button>
    `;
    container.appendChild(item);
  });
}

function handleKeySubtarefa(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    adicionarSubtarefaModal();
  }
}

async function adicionarSubtarefaModal() {
  const input = document.getElementById('inputNovaSubtarefa');
  const titulo = input.value.trim();
  if (!titulo || !tarefaModalAtual) return;

  if (sbClient) {
    const { data, error } = await sbClient
      .from('subtarefas')
      .insert([{ id_tarefa: tarefaModalAtual.id_tarefa, titulo_subtarefa: titulo, concluido: false,
                 ordem_subtarefa: (tarefaModalAtual.subtarefas || []).length }])
      .select()
      .single();

    if (!error && data) {
      if (!tarefaModalAtual.subtarefas) tarefaModalAtual.subtarefas = [];
      tarefaModalAtual.subtarefas.push(data);
      input.value = '';
      renderizarModalSubtarefas();
    }
  }
}

async function alternarSubtarefaModal(idSub, novoStatus) {
  if (sbClient) {
    await sbClient
      .from('subtarefas')
      .update({ concluido: novoStatus })
      .eq('id_subtarefa', idSub);

    const sub = (tarefaModalAtual.subtarefas || []).find(s => s.id_subtarefa === idSub);
    if (sub) sub.concluido = novoStatus;
    renderizarModalSubtarefas();
  }
}

async function excluirSubtarefaModal(idSub) {
  if (sbClient) {
    await sbClient.from('subtarefas').delete().eq('id_subtarefa', idSub);
    tarefaModalAtual.subtarefas = (tarefaModalAtual.subtarefas || []).filter(s => s.id_subtarefa !== idSub);
    renderizarModalSubtarefas();
  }
}

async function salvarTituloCardModal() {
  const novoTitulo = document.getElementById('modalCardTitulo').innerText.trim();
  if (novoTitulo && tarefaModalAtual && novoTitulo !== tarefaModalAtual.titulo_tarefa) {
    tarefaModalAtual.titulo_tarefa = novoTitulo;
    await sbClient.from('tarefas').update({ titulo_tarefa: novoTitulo }).eq('id_tarefa', tarefaModalAtual.id_tarefa);
  }
}

async function salvarDescricaoCardModal() {
  const novaDesc = document.getElementById('modalCardDescricao').value.trim();
  if (tarefaModalAtual && novaDesc !== tarefaModalAtual.descricao_tarefa) {
    tarefaModalAtual.descricao_tarefa = novaDesc;
    await sbClient.from('tarefas').update({ descricao_tarefa: novaDesc }).eq('id_tarefa', tarefaModalAtual.id_tarefa);
  }
}

async function salvarPrioridadeCardModal() {
  const novaPrio = document.getElementById('modalCardPrioridade').value;
  if (tarefaModalAtual && novaPrio !== tarefaModalAtual.prioridade_tarefa) {
    tarefaModalAtual.prioridade_tarefa = novaPrio;
    await sbClient.from('tarefas').update({ prioridade_tarefa: novaPrio }).eq('id_tarefa', tarefaModalAtual.id_tarefa);
  }
}

/* ---------- Competência, prazo e recorrência ---------- */

const dataDoBanco = v => (v ? String(v).split('T')[0] : '');

function preencherPrazoCardModal() {
  const t = tarefaModalAtual;
  const mes = (listaMeses || []).find(m => m.id_mes === t.id_mes);
  document.getElementById('modalCardCompetencia').textContent = mes ? rotuloCompetencia(mes.competencia_mes) : '—';
  document.getElementById('modalCardTipoPrazo').value = t.tipo_prazo === 'dias_uteis' ? 'dias_uteis' : 'data';
  document.getElementById('modalCardPrazoInicio').value = dataDoBanco(t.prazo_inicio);
  document.getElementById('modalCardPrazoFim').value = dataDoBanco(t.prazo_fim);
  document.getElementById('modalCardDuInicio').value = t.prazo_du_inicio ?? '';
  document.getElementById('modalCardDuFim').value = t.prazo_du_fim ?? '';
  document.getElementById('modalCardRecorrente').checked = !!t.tarefa_recorrente;
  avisoPrazoCardModal('');
  mostrarCamposPrazoCardModal();
}

function mostrarCamposPrazoCardModal() {
  const du = document.getElementById('modalCardTipoPrazo').value === 'dias_uteis';
  document.getElementById('modalCardCamposData').hidden = du;
  document.getElementById('modalCardCamposDU').hidden = !du;
  // Em dias úteis, mostra as datas calculadas pelo banco
  document.getElementById('modalCardDuInicioData').textContent = tarefaModalAtual.prazo_inicio && du ? `= ${dataCurta(dataDoBanco(tarefaModalAtual.prazo_inicio))}` : '';
  document.getElementById('modalCardDuFimData').textContent = tarefaModalAtual.prazo_fim && du ? `= ${dataCurta(dataDoBanco(tarefaModalAtual.prazo_fim))}` : '';
}

function avisoPrazoCardModal(texto) { document.getElementById('modalCardPrazoAviso').textContent = texto; }

// Grava na tarefa e atualiza o cartão no quadro (as datas em dias úteis voltam calculadas pelo banco)
async function gravarPrazoCardModal(campos) {
  const { data, error } = await sbClient.from('tarefas').update(campos).eq('id_tarefa', tarefaModalAtual.id_tarefa)
    .select('tipo_prazo, prazo_du_inicio, prazo_du_fim, prazo_inicio, prazo_fim, tarefa_recorrente').single();
  if (error) { avisoPrazoCardModal('Não foi possível salvar: ' + error.message); return false; }
  Object.assign(tarefaModalAtual, data);
  const naLista = (listaTarefas || []).find(x => x.id_tarefa === tarefaModalAtual.id_tarefa);
  if (naLista) Object.assign(naLista, data);
  Cache.gravar(chaveCacheTarefas(), listaTarefas);
  desenharTarefas();
  avisoPrazoCardModal('');
  mostrarCamposPrazoCardModal();
  return true;
}

async function tipoPrazoCardModalAlterado() {
  const tipo = document.getElementById('modalCardTipoPrazo').value;
  mostrarCamposPrazoCardModal();
  if (tipo === 'data') {
    // Mantém as datas atuais como datas fixas
    await gravarPrazoCardModal({ tipo_prazo: 'data', prazo_du_inicio: null, prazo_du_fim: null });
    preencherPrazoCardModal();
  } else if (document.getElementById('modalCardDuFim').value === '') {
    avisoPrazoCardModal('Informe o prazo final em dias úteis (ex.: 2 para D+2).');
    document.getElementById('modalCardDuFim').focus();
  } else {
    await salvarDUCardModal();
  }
}

async function salvarDUCardModal() {
  const ler = id => { const v = document.getElementById(id).value; return v === '' ? null : Math.trunc(Number(v)); };
  const ini = ler('modalCardDuInicio'), fim = ler('modalCardDuFim');
  if (fim === null) { avisoPrazoCardModal('Informe o prazo final em dias úteis (ex.: 2 para D+2).'); return; }
  if (ini !== null && ini > fim) { avisoPrazoCardModal('O prazo final não pode ser anterior ao início.'); return; }
  await gravarPrazoCardModal({ tipo_prazo: 'dias_uteis', prazo_du_inicio: ini, prazo_du_fim: fim });
}

async function salvarDatasCardModal() {
  if (!tarefaModalAtual) return;
  const ini = document.getElementById('modalCardPrazoInicio').value || null;
  const fim = document.getElementById('modalCardPrazoFim').value || null;
  if (ini && fim && fim < ini) { avisoPrazoCardModal('O prazo final não pode ser anterior ao início.'); return; }
  await gravarPrazoCardModal({ tipo_prazo: 'data', prazo_inicio: ini, prazo_fim: fim });
}

async function salvarRecorrenteCardModal() {
  await gravarPrazoCardModal({ tarefa_recorrente: document.getElementById('modalCardRecorrente').checked });
}

// Arquivar = tarefa_arquivada: true. A tarefa some do quadro, mas continua no banco.
async function arquivarTarefaModal() {
  if (!tarefaModalAtual) return;
  if (!confirm("Deseja realmente arquivar esta tarefa?")) return;

  const id = tarefaModalAtual.id_tarefa;
  const { error } = await sbClient.from('tarefas').update({ tarefa_arquivada: true }).eq('id_tarefa', id);
  if (error) {
    console.error('Erro ao arquivar tarefa:', error);
    alert('Não foi possível arquivar a tarefa: ' + error.message);
    return;
  }

  registrarHistoricoTarefa(id, 'Tarefa arquivada');

  // Tira da lista em memória para o card sumir na hora
  listaTarefas = listaTarefas.filter(t => (t.id_tarefa || t.id) !== id);
  Cache.gravar(chaveCacheTarefas(), listaTarefas);
  fecharModalDetalhes();
}

// Registro em tarefas_historicos (não bloqueia a ação se falhar)
async function registrarHistoricoTarefa(idTarefa, acao) {
  try {
    const { error } = await sbClient.from('tarefas_historicos').insert([{
      id_tarefa: idTarefa, acao_historico: acao, id_colab: colaboradorLogado?.id_colab || null
    }]);
    if (error) console.warn('Histórico não registrado:', error.message);
  } catch (err) {
    console.warn('Histórico não registrado:', err);
  }
}

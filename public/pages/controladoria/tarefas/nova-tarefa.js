// ==========================================
// NOVA TAREFA — popup aberto pelo botão "+ Tarefa" da barra superior
// Grava no Supabase:
//   tarefas                (título, descrição, status, prioridade, início, prazo, criador)
//   tarefas_colaboradores  (um registro por responsável)
//   tags + tarefas_tags    (tags novas entram no cadastro; depois são vinculadas)
//   subtarefas             (itens do checklist, na ordem em que foram adicionados)
//   tarefas_historicos     ("Tarefa criada")
// ==========================================

const novaTarefa = { tags: [], subtarefas: [], responsaveis: new Set(), salvando: false };
let elementoFocoAntesNovaTarefa = null;

async function abrirModalNovaTarefa() {
  const modal = document.getElementById('modalNovaTarefa');
  if (!modal) return;

  elementoFocoAntesNovaTarefa = document.activeElement;
  limparFormularioNovaTarefa();
  preencherColunasNovaTarefa();
  modal.classList.add('active');
  setTimeout(() => document.getElementById('ntTitulo').focus(), 50);

  // Sugestões de tags já cadastradas
  carregarTagsCadastradas().then(preencherSugestoesTagsNovaTarefa).catch(() => {});

  // Equipe: mostra a lista em cache na hora e atualiza quando o Supabase responder
  renderizarResponsaveisNovaTarefa();
  try {
    await carregarColaboradoresDados(renderizarResponsaveisNovaTarefa);
  } catch (err) {
    console.warn('Não foi possível carregar a equipe:', err);
  }
  renderizarResponsaveisNovaTarefa();
}

function fecharModalNovaTarefa(event) {
  if (event && event.target !== event.currentTarget) return;
  if (novaTarefa.salvando) return;
  document.getElementById('modalNovaTarefa').classList.remove('active');
  if (elementoFocoAntesNovaTarefa && elementoFocoAntesNovaTarefa.focus) elementoFocoAntesNovaTarefa.focus();
}

function limparFormularioNovaTarefa() {
  novaTarefa.tags = [];
  novaTarefa.subtarefas = [];
  novaTarefa.responsaveis = new Set();
  novaTarefa.responsavelPadraoAplicado = false;
  ['ntTitulo', 'ntDescricao', 'ntInicio', 'ntPrazo', 'ntTagInput', 'ntSubtarefaInput'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('ntPrioridade').value = 'Média';
  document.getElementById('ntTitulo').classList.remove('popup-invalido');
  document.getElementById('ntPrazo').classList.remove('popup-invalido');
  definirFeedbackNovaTarefa('');
  renderizarTagsNovaTarefa();
  renderizarChecklistNovaTarefa();
}

function definirFeedbackNovaTarefa(texto, tipo) {
  const el = document.getElementById('ntFeedback');
  el.textContent = texto;
  el.className = 'popup-feedback' + (tipo ? ' popup-feedback-' + tipo : '');
}

// Ao digitar o título, some o aviso de campo obrigatório
function tituloNovaTarefaAlterado(campo) {
  if (!campo.classList.contains('popup-invalido') || !campo.value.trim()) return;
  campo.classList.remove('popup-invalido');
  definirFeedbackNovaTarefa('');
}

// Ao corrigir as datas, some o aviso de prazo anterior ao início
function datasNovaTarefaAlteradas() {
  const prazo = document.getElementById('ntPrazo');
  if (!prazo.classList.contains('popup-invalido')) return;
  const inicio = document.getElementById('ntInicio').value;
  if (!inicio || !prazo.value || prazo.value >= inicio) {
    prazo.classList.remove('popup-invalido');
    definirFeedbackNovaTarefa('');
  }
}

/* ---------- Status (colunas do kanban) ---------- */

function preencherColunasNovaTarefa() {
  const select = document.getElementById('ntColuna');
  const colunas = listaColunas || [];
  if (!colunas.length) {
    select.innerHTML = '<option value="">Nenhuma coluna disponível</option>';
    return;
  }
  select.innerHTML = colunas.map(c => `<option value="${c.id_coluna}">${escNovaTarefa(c.titulo_coluna)}</option>`).join('');
  select.value = String(colunas[0].id_coluna);   // primeira coluna do quadro (ex.: "A fazer")
}

/* ---------- Responsáveis ---------- */

function renderizarResponsaveisNovaTarefa() {
  const caixa = document.getElementById('ntResponsaveis');
  const equipe = colaboradoresAtivos();   // inativos não podem ser responsáveis por tarefas novas
  if (!equipe.length) {
    caixa.innerHTML = '<span class="nt-vazio">Nenhum colaborador encontrado.</span>';
    return;
  }

  // Na primeira vez, já marca o usuário logado (se ele estiver cadastrado na equipe)
  if (!novaTarefa.responsavelPadraoAplicado) {
    const eu = identificarColaboradorLogado();
    if (eu) novaTarefa.responsaveis.add(eu.id_colab);
    novaTarefa.responsavelPadraoAplicado = true;
  }

  caixa.innerHTML = equipe.map(c => {
    const marcado = novaTarefa.responsaveis.has(c.id_colab);
    const iniciais = (c.nome_colab || '?').split(' ').filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');
    return `
      <label class="nt-pessoa${marcado ? ' marcado' : ''}">
        <input type="checkbox" value="${c.id_colab}" ${marcado ? 'checked' : ''} onchange="alternarResponsavelNovaTarefa(this)">
        <span class="avatar" style="background:${corDoAvatar(c.id_colab)};">${iniciais}</span>
        <span class="nt-pessoa-nome">${escNovaTarefa(c.nome_colab || 'Sem nome')}</span>
      </label>`;
  }).join('');
}

function alternarResponsavelNovaTarefa(caixa) {
  // Usa o id como veio do Supabase (número ou texto), não o texto do checkbox
  const colab = (listaColaboradores || []).find(c => String(c.id_colab) === caixa.value);
  const chave = colab ? colab.id_colab : caixa.value;
  if (caixa.checked) novaTarefa.responsaveis.add(chave);
  else novaTarefa.responsaveis.delete(chave);
  caixa.closest('.nt-pessoa').classList.toggle('marcado', caixa.checked);
}

/* ---------- Tags ---------- */

function preencherSugestoesTagsNovaTarefa() {
  const lista = document.getElementById('ntTagsExistentes');
  if (lista) lista.innerHTML = listaTagsCadastradas.map(t => `<option value="${escNovaTarefa(t.nome_tag)}"></option>`).join('');
}

function teclaTagNovaTarefa(e) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    confirmarTagNovaTarefa();
  } else if (e.key === 'Backspace' && !e.target.value && novaTarefa.tags.length) {
    novaTarefa.tags.pop();
    renderizarTagsNovaTarefa();
  }
}

function confirmarTagNovaTarefa() {
  const input = document.getElementById('ntTagInput');
  const tag = input.value.replace(/,/g, '').trim();
  if (tag && !novaTarefa.tags.some(t => t.toLowerCase() === tag.toLowerCase())) novaTarefa.tags.push(tag);
  input.value = '';
  renderizarTagsNovaTarefa();
}

function removerTagNovaTarefa(indice) {
  novaTarefa.tags.splice(indice, 1);
  renderizarTagsNovaTarefa();
}

function renderizarTagsNovaTarefa() {
  const caixa = document.getElementById('ntTags');
  const input = document.getElementById('ntTagInput');
  caixa.querySelectorAll('.task-tag-pill').forEach(el => el.remove());
  novaTarefa.tags.forEach((tag, i) => {
    const pill = document.createElement('span');
    pill.className = 'task-tag-pill';
    pill.innerHTML = `${escNovaTarefa(tag)} <button type="button" class="nt-remover" aria-label="Remover tag ${escNovaTarefa(tag)}" onclick="removerTagNovaTarefa(${i})">&times;</button>`;
    caixa.insertBefore(pill, input);
  });
}

/* ---------- Checklist ---------- */

function teclaSubtarefaNovaTarefa(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    adicionarSubtarefaNovaTarefa();
  }
}

function adicionarSubtarefaNovaTarefa() {
  const input = document.getElementById('ntSubtarefaInput');
  const titulo = input.value.trim();
  if (!titulo) return;
  novaTarefa.subtarefas.push(titulo);
  input.value = '';
  input.focus();
  renderizarChecklistNovaTarefa();
}

function removerSubtarefaNovaTarefa(indice) {
  novaTarefa.subtarefas.splice(indice, 1);
  renderizarChecklistNovaTarefa();
}

function renderizarChecklistNovaTarefa() {
  document.getElementById('ntChecklist').innerHTML = novaTarefa.subtarefas.map((s, i) => `
    <li class="subtask-item">
      <input type="checkbox" disabled aria-hidden="true">
      <span>${escNovaTarefa(s)}</span>
      <button type="button" class="btn-del-sub" aria-label="Remover item" onclick="removerSubtarefaNovaTarefa(${i})">&times;</button>
    </li>`).join('');
}

/* ---------- Gravação ---------- */

async function salvarNovaTarefa(event) {
  if (event) event.preventDefault();
  if (novaTarefa.salvando) return;

  confirmarTagNovaTarefa();
  // Item de checklist digitado e não adicionado também entra
  if (document.getElementById('ntSubtarefaInput').value.trim()) adicionarSubtarefaNovaTarefa();

  const campoTitulo = document.getElementById('ntTitulo');
  const titulo = campoTitulo.value.trim();
  const idColuna = document.getElementById('ntColuna').value;

  if (!titulo) {
    campoTitulo.classList.add('popup-invalido');
    definirFeedbackNovaTarefa('Informe o título da tarefa.', 'erro');
    campoTitulo.focus();
    return;
  }
  campoTitulo.classList.remove('popup-invalido');
  if (!idColuna) {
    definirFeedbackNovaTarefa('Não há colunas no quadro para receber a tarefa.', 'erro');
    return;
  }
  const inicio = document.getElementById('ntInicio').value || null;
  const prazo = document.getElementById('ntPrazo').value || null;
  if (inicio && prazo && prazo < inicio) {
    document.getElementById('ntPrazo').classList.add('popup-invalido');
    definirFeedbackNovaTarefa('O prazo final não pode ser anterior ao início.', 'erro');
    return;
  }
  document.getElementById('ntPrazo').classList.remove('popup-invalido');
  if (typeof sbClient === 'undefined' || !sbClient) {
    definirFeedbackNovaTarefa('Sem conexão com o Supabase. Atualize a página.', 'erro');
    return;
  }

  const botao = document.getElementById('ntSalvar');
  novaTarefa.salvando = true;
  botao.disabled = true;
  definirFeedbackNovaTarefa('Criando tarefa…');

  const coluna = (listaColunas || []).find(c => String(c.id_coluna) === String(idColuna));
  const registro = {
    titulo_tarefa: titulo,
    descricao_tarefa: document.getElementById('ntDescricao').value.trim() || null,
    id_coluna: coluna ? coluna.id_coluna : idColuna,
    prioridade_tarefa: document.getElementById('ntPrioridade').value,
    prazo_inicio: inicio,
    prazo_fim: prazo,
    id_criador: identificarColaboradorLogado()?.id_colab ?? null,
    tarefa_arquivada: false,
  };

  try {
    // 1) Tarefa
    const { criada, ignorados } = await inserirTarefa(registro);
    const idTarefa = criada.id_tarefa || criada.id;
    const semColuna = ignorados.filter(c => ROTULOS_CAMPOS[c]).map(c => ROTULOS_CAMPOS[c] || c);
    const avisos = [];

    // 2) Responsáveis, 3) checklist e 4) tags, em paralelo
    const vinculos = [...novaTarefa.responsaveis].map(id_colab => ({ id_tarefa: idTarefa, id_colab }));
    const itens = novaTarefa.subtarefas.map((titulo_subtarefa, i) => ({ id_tarefa: idTarefa, titulo_subtarefa, concluido: false, ordem_subtarefa: i }));
    const gravarTags = novaTarefa.tags.length
      ? garantirTags(novaTarefa.tags).then(tags => vincularTags(idTarefa, tags)).then(() => ({ error: null }), error => ({ error }))
      : { error: null };
    const [resVinculos, resItens, resTags] = await Promise.all([
      vinculos.length ? sbClient.from('tarefas_colaboradores').insert(vinculos) : { error: null },
      itens.length ? sbClient.from('subtarefas').insert(itens) : { error: null },
      gravarTags,
    ]);
    if (resVinculos.error) { avisos.push('responsáveis'); console.error('Responsáveis não gravados:', resVinculos.error); }
    if (resItens.error) { avisos.push('checklist'); console.error('Checklist não gravado:', resItens.error); }
    if (resTags.error) { avisos.push('tags'); console.error('Tags não gravadas:', resTags.error); }

    registrarHistoricoTarefa(idTarefa, 'Tarefa criada');

    await renderizarTarefas(true);

    if (avisos.length || semColuna.length) {
      // A tarefa existe; avisa o que ficou de fora
      const partes = [];
      if (avisos.length) partes.push(`não foi possível gravar ${avisos.join(', ')} (complete pelos detalhes do card)`);
      if (semColuna.length) partes.push(`a tabela de tarefas não tem campo para ${semColuna.join(', ')}`);
      definirFeedbackNovaTarefa(`Tarefa criada, mas ${partes.join('; ')}.`, 'erro');
      novaTarefa.salvando = false;
      botao.disabled = false;
      return;
    }

    novaTarefa.salvando = false;
    botao.disabled = false;
    fecharModalNovaTarefa();
    destacarCardNovo(idTarefa);
  } catch (err) {
    console.error('Erro ao criar tarefa:', err);
    definirFeedbackNovaTarefa('Não foi possível criar a tarefa: ' + err.message, 'erro');
    novaTarefa.salvando = false;
    botao.disabled = false;
  }
}

/*
  Grava a tarefa. Campo opcional que não existir na tabela é deixado de fora (e avisado),
  em vez de impedir a criação. Título e status (id_coluna) são obrigatórios.
*/
const CAMPOS_OPCIONAIS = ['descricao_tarefa', 'prioridade_tarefa', 'prazo_inicio', 'prazo_fim', 'id_criador', 'tarefa_arquivada'];
const ROTULOS_CAMPOS = { descricao_tarefa: 'descrição', prioridade_tarefa: 'prioridade', prazo_inicio: 'início', prazo_fim: 'prazo', id_criador: 'criador' };

async function inserirTarefa(registroOriginal) {
  const registro = { ...registroOriginal };
  const ignorados = [];

  for (let tentativa = 0; tentativa <= CAMPOS_OPCIONAIS.length; tentativa++) {
    const { data, error } = await sbClient.from('tarefas').insert([registro]).select().single();
    if (!error && data) return { criada: data, ignorados };
    if (!error) throw new Error('o Supabase não devolveu a tarefa criada.');

    const msg = error.message || '';
    const ausente = (msg.match(/Could not find the '([^']+)' column/) || [])[1];
    if (!ausente || !CAMPOS_OPCIONAIS.includes(ausente) || !(ausente in registro)) throw new Error(msg);

    console.warn(`Coluna "${ausente}" não existe em tarefas; tarefa criada sem ela.`);
    delete registro[ausente];
    ignorados.push(ausente);
  }
  throw new Error('não foi possível ajustar os campos ao formato da tabela.');
}

function destacarCardNovo(idTarefa) {
  const card = document.getElementById(`task-${idTarefa}`);
  if (!card) return;
  card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  card.classList.add('nt-card-novo');
  setTimeout(() => card.classList.remove('nt-card-novo'), 2200);
}

/* ---------- Teclado e utilitários ---------- */

document.addEventListener('keydown', e => {
  const modal = document.getElementById('modalNovaTarefa');
  if (!modal || !modal.classList.contains('active')) return;
  if (e.key === 'Escape') fecharModalNovaTarefa();
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) salvarNovaTarefa(e);
});

function escNovaTarefa(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

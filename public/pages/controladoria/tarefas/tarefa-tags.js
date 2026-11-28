// ==========================================
// TAGS DAS TAREFAS
// Cadastro em `tags` (id_tag, nome_tag, cor_tag); vínculo em `tarefas_tags` (id_tarefa, id_tag).
// Para o restante do código, cada tarefa recebe:
//   tarefa.tagsLista → [{ id_tag, nome_tag, cor_tag }]   (cards e modal)
//   tarefa.tags      → ['Nome', ...]                     (busca)
// ==========================================

let listaTagsCadastradas = [];

// Trecho do select que traz as tags junto com a tarefa
const SELECT_TAGS_DA_TAREFA = 'tarefas_tags ( id_tag, tags ( id_tag, nome_tag, cor_tag ) )';

function normalizarTagsDaTarefa(tarefa) {
  tarefa.tagsLista = (tarefa.tarefas_tags || [])
    .map(v => v.tags)
    .filter(Boolean)
    .sort((a, b) => a.nome_tag.localeCompare(b.nome_tag, 'pt-BR'));
  tarefa.tags = tarefa.tagsLista.map(t => t.nome_tag);
  return tarefa;
}

function htmlTag(tag, extra = '') {
  const cor = tag.cor_tag || 'var(--rail)';
  return `<span class="task-tag-pill"><span class="tag-cor" style="background:${cor};"></span>${escTag(tag.nome_tag)}${extra}</span>`;
}

async function carregarTagsCadastradas() {
  const { data, error } = await sbClient.from('tags').select('*').order('nome_tag', { ascending: true });
  if (!error && data) listaTagsCadastradas = data;
  return listaTagsCadastradas;
}

// Devolve as tags pelos nomes, criando no cadastro as que ainda não existem (comparação sem diferenciar maiúsculas)
async function garantirTags(nomes) {
  await carregarTagsCadastradas();
  const resultado = [];
  const novas = [];

  nomes.forEach(nome => {
    const existente = listaTagsCadastradas.find(t => t.nome_tag.toLowerCase() === nome.toLowerCase());
    if (existente) resultado.push(existente);
    else if (!novas.some(n => n.toLowerCase() === nome.toLowerCase())) novas.push(nome);
  });

  if (novas.length) {
    const { data, error } = await sbClient.from('tags').insert(novas.map(nome_tag => ({ nome_tag }))).select();
    if (error) throw new Error('não foi possível cadastrar as tags: ' + error.message);
    listaTagsCadastradas.push(...data);
    resultado.push(...data);
  }
  return resultado;
}

async function vincularTags(idTarefa, tags) {
  if (!tags.length) return;
  const { error } = await sbClient.from('tarefas_tags').insert(tags.map(t => ({ id_tarefa: idTarefa, id_tag: t.id_tag })));
  if (error) throw new Error('não foi possível vincular as tags: ' + error.message);
}

/* ---------- Tags no modal de detalhes ---------- */

function renderizarModalTags() {
  const container = document.getElementById('modalCardTagsContainer');
  if (!container || !tarefaModalAtual) return;

  container.innerHTML = (tarefaModalAtual.tagsLista || []).map(tag => htmlTag(tag,
    `<span class="tag-remover" data-editar="tarefas" title="Remover tag" onclick="removerTagModal(${tag.id_tag})">&times;</span>`)).join('');

  const btnAdd = document.createElement('button');
  btnAdd.type = 'button';
  btnAdd.className = 'btn-add-tag-modal';
  btnAdd.innerText = '+ Tag';
  btnAdd.onclick = adicionarTagModal;
  btnAdd.dataset.editar = 'tarefas';   // só quem edita tarefas vê
  container.appendChild(btnAdd);
}

function atualizarTagsNaLista(idTarefa, tagsLista) {
  const t = listaTarefas.find(x => (x.id_tarefa || x.id) === idTarefa);
  if (t) {
    t.tarefas_tags = tagsLista.map(tag => ({ id_tag: tag.id_tag, tags: tag }));
    normalizarTagsDaTarefa(t);
  }
}

async function adicionarTagModal() {
  const nome = (prompt('Digite a nova tag (ex.: Financeiro, Urgente, BI):') || '').trim();
  if (!nome || !tarefaModalAtual) return;

  const atual = tarefaModalAtual.tagsLista || [];
  if (atual.some(t => t.nome_tag.toLowerCase() === nome.toLowerCase())) return;

  try {
    const [tag] = await garantirTags([nome]);
    await vincularTags(tarefaModalAtual.id_tarefa, [tag]);
    tarefaModalAtual.tarefas_tags = [...(tarefaModalAtual.tarefas_tags || []), { id_tag: tag.id_tag, tags: tag }];
    normalizarTagsDaTarefa(tarefaModalAtual);
    atualizarTagsNaLista(tarefaModalAtual.id_tarefa, tarefaModalAtual.tagsLista);
    renderizarModalTags();
    renderizarTarefas();
  } catch (err) {
    console.error(err);
    alert('Erro ao adicionar a tag: ' + err.message);
  }
}

async function removerTagModal(idTag) {
  if (!tarefaModalAtual) return;
  const { error } = await sbClient.from('tarefas_tags').delete()
    .eq('id_tarefa', tarefaModalAtual.id_tarefa)
    .eq('id_tag', idTag);
  if (error) {
    alert('Erro ao remover a tag: ' + error.message);
    return;
  }
  tarefaModalAtual.tarefas_tags = (tarefaModalAtual.tarefas_tags || []).filter(v => v.id_tag !== idTag);
  normalizarTagsDaTarefa(tarefaModalAtual);
  atualizarTagsNaLista(tarefaModalAtual.id_tarefa, tarefaModalAtual.tagsLista);
  renderizarModalTags();
  renderizarTarefas();
}

function escTag(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

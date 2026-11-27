// ==========================================
// CONFIGURAÇÕES · Grupos de acesso (supabase/17_grupos_acesso.sql)
//   acessos_recursos (catálogo, por módulo) · acessos_grupos · acessos_permissoes (nao_ver | ver | editar)
//   colaboradores.id_grupo: grupo de cada pessoa (definido em Configurações › Colaboradores)
// Nesta etapa, os grupos só são cadastrados: o portal e as regras do banco ainda não os aplicam.
// Usa os auxiliares de configuracao.js (escCad, cadColaboradores, cadGrupos, preencherGruposCad, avisoCadastro).
// ==========================================

let gruRecursos = [];        // catálogo, na ordem de exibição
let gruLista = [];           // grupos
let gruPermissoes = [];      // { id_grupo, id_recurso, nivel_permissao }
let gruEditando = null;
let gruNiveis = {};          // níveis no formulário: id_recurso -> nivel

const NIVEIS = [['nao_ver', 'Nenhum'], ['ver', 'Leitura'], ['editar', 'Edição']];   // valores no banco: nao_ver | ver | editar
const campoGru = nome => document.querySelector(`#gruForm [name="${nome}"]`);

async function iniciarGrupos() {
  document.getElementById('modalGrupo').addEventListener('click', e => { if (e.target.id === 'modalGrupo') fecharGrupo(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('modalGrupo').classList.contains('active')) fecharGrupo(); });
  document.getElementById('gruForm').addEventListener('input', e => {
    if (e.target.classList.contains('invalido')) { e.target.classList.remove('invalido'); feedbackGru(''); }
  });
  await carregarGrupos();
}

async function carregarGrupos() {
  const [rec, gru, per] = await Promise.all([
    sbClient.from('acessos_recursos').select('*').order('ordem_recurso'),
    sbClient.from('acessos_grupos').select('id_grupo, nome_grupo, desc_grupo').order('nome_grupo'),
    sbClient.from('acessos_permissoes').select('id_grupo, id_recurso, nivel_permissao'),
  ]);
  const erro = rec.error || gru.error || per.error;
  if (erro) {
    const falta = /acessos_/.test(erro.message) ? ' Rode supabase/17_grupos_acesso.sql no Supabase.' : '';
    document.getElementById('gruCorpo').innerHTML = `<tr><td colspan="4" class="cad-vazio">Não foi possível carregar os grupos: ${escCad(erro.message)}.${falta}</td></tr>`;
    return;
  }
  gruRecursos = rec.data || [];
  gruLista = gru.data || [];
  gruPermissoes = per.data || [];
  desenharGrupos();
}

const nivelDe = (idGrupo, idRecurso) =>
  (gruPermissoes.find(p => p.id_grupo === idGrupo && p.id_recurso === idRecurso) || {}).nivel_permissao || 'nao_ver';
const pessoasDoGrupo = idGrupo => (typeof cadColaboradores !== 'undefined' ? cadColaboradores : []).filter(c => c.id_grupo === idGrupo);

function resumoGrupo(idGrupo) {
  const n = { editar: 0, ver: 0 };
  gruRecursos.forEach(r => { const v = nivelDe(idGrupo, r.id_recurso); if (v in n) n[v]++; });
  if (!n.editar && !n.ver) return '<span class="gru-resumo vazio">Nenhum</span>';
  return [n.editar ? `<span class="gru-resumo editar">${n.editar} edição</span>` : '', n.ver ? `<span class="gru-resumo ver">${n.ver} leitura</span>` : ''].join(' ');
}

function desenharGrupos() {
  document.getElementById('gruCorpo').innerHTML = gruLista.length ? gruLista.map(g => {
    const pessoas = pessoasDoGrupo(g.id_grupo).length;
    return `
    <tr tabindex="0" onclick="abrirGrupo(${g.id_grupo})" onkeydown="if(event.key==='Enter') abrirGrupo(${g.id_grupo})">
      <td><strong>${escCad(g.nome_grupo)}</strong></td>
      <td>${escCad(g.desc_grupo || '—')}</td>
      <td>${resumoGrupo(g.id_grupo)}</td>
      <td class="num">${pessoas}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="4" class="cad-vazio">Nenhum grupo cadastrado. Use “+ Grupo” para criar o primeiro.</td></tr>';
  const semGrupo = (typeof cadColaboradores !== 'undefined' ? cadColaboradores : []).filter(c => c.esta_ativo !== false && !c.id_grupo).length;
  document.getElementById('gruRodape').textContent =
    `${gruLista.length} grupo(s)` + (semGrupo ? ` · ${semGrupo} colaborador(es) ativo(s) sem grupo` : '');
}

/* ---------- Formulário ---------- */

function feedbackGru(texto, tipo = '') {
  const el = document.getElementById('gruFeedback');
  el.textContent = texto;
  el.className = 'cad-feedback' + (tipo ? ' ' + tipo : '');
}

function desenharGrade() {
  const modulos = [...new Set(gruRecursos.map(r => r.modulo_recurso))];
  document.getElementById('gruGrade').innerHTML = modulos.map(m => `
    <div class="gru-modulo">
      <div class="gru-modulo-topo">
        <strong>${escCad(m)}</strong>
        <span class="gru-todos">Todos: ${NIVEIS.map(([v, r]) => `<button type="button" onclick="definirModulo('${escCad(m)}', '${v}')">${r}</button>`).join(' · ')}</span>
      </div>
      ${gruRecursos.filter(r => r.modulo_recurso === m).map(r => `
        <div class="gru-linha">
          <div class="gru-recurso"><span>${escCad(r.nome_recurso)}</span>${r.desc_recurso ? `<small>${escCad(r.desc_recurso)}</small>` : ''}</div>
          <div class="seg gru-seg" role="radiogroup" aria-label="${escCad(r.nome_recurso)}">
            ${NIVEIS.map(([v, rot]) => `<button type="button" class="seg-btn ${gruNiveis[r.id_recurso] === v ? 'is-active' : ''} nivel-${v}" role="radio"
                aria-checked="${gruNiveis[r.id_recurso] === v}" onclick="definirNivel('${r.id_recurso}', '${v}')">${rot}</button>`).join('')}
          </div>
        </div>`).join('')}
    </div>`).join('');
}

function definirNivel(idRecurso, nivel) { gruNiveis[idRecurso] = nivel; desenharGrade(); }
function definirModulo(modulo, nivel) {
  gruRecursos.filter(r => r.modulo_recurso === modulo).forEach(r => { gruNiveis[r.id_recurso] = nivel; });
  desenharGrade();
}

function abrirGrupo(id) {
  gruEditando = id === null ? null : gruLista.find(g => g.id_grupo === id) || null;
  document.getElementById('gruTitulo').textContent = gruEditando ? `Editar · ${gruEditando.nome_grupo}` : 'Novo grupo de acesso';
  campoGru('nome_grupo').value = gruEditando?.nome_grupo || '';
  campoGru('desc_grupo').value = gruEditando?.desc_grupo || '';
  gruNiveis = {};
  gruRecursos.forEach(r => { gruNiveis[r.id_recurso] = gruEditando ? nivelDe(gruEditando.id_grupo, r.id_recurso) : 'nao_ver'; });
  const pessoas = gruEditando ? pessoasDoGrupo(gruEditando.id_grupo) : [];
  document.getElementById('gruPessoas').textContent = !gruEditando ? 'Depois de salvar, defina o grupo de cada pessoa em Colaboradores.'
    : pessoas.length ? `Pessoas neste grupo: ${pessoas.map(c => c.nome_colab).join(', ')}.` : 'Nenhuma pessoa neste grupo.';
  const excluir = document.getElementById('gruExcluir');
  excluir.hidden = !gruEditando;
  excluir.disabled = pessoas.length > 0;
  excluir.title = pessoas.length ? 'Para excluir, tire antes as pessoas deste grupo (em Colaboradores).' : '';
  excluir.textContent = 'Excluir grupo';
  delete excluir.dataset.confirmar;
  campoGru('nome_grupo').classList.remove('invalido');
  feedbackGru('');
  desenharGrade();
  document.getElementById('modalGrupo').classList.add('active');
  if (Permissoes.travar(document.getElementById('gruForm'), 'grupos_acesso')) document.getElementById('gruTitulo').textContent += ' (somente leitura)';
  else setTimeout(() => campoGru('nome_grupo').focus(), 60);
}

function fecharGrupo() { document.getElementById('modalGrupo').classList.remove('active'); }

async function salvarGrupo() {
  const nome = campoGru('nome_grupo').value.trim();
  const desc = campoGru('desc_grupo').value.trim() || null;
  const erro = msg => { campoGru('nome_grupo').classList.add('invalido'); campoGru('nome_grupo').focus(); feedbackGru(msg, 'erro'); };
  if (!nome) return erro('Informe o nome do grupo.');
  const mesmo = gruLista.find(g => g.nome_grupo.toLowerCase() === nome.toLowerCase() && g.id_grupo !== gruEditando?.id_grupo);
  if (mesmo) return erro(`Já existe um grupo chamado ${mesmo.nome_grupo}.`);

  const botao = document.getElementById('gruSalvar');
  botao.disabled = true;
  feedbackGru('Salvando…');
  const g = gruEditando
    ? await sbClient.from('acessos_grupos').update({ nome_grupo: nome, desc_grupo: desc }).eq('id_grupo', gruEditando.id_grupo).select('id_grupo, nome_grupo, desc_grupo')
    : await sbClient.from('acessos_grupos').insert({ nome_grupo: nome, desc_grupo: desc }).select('id_grupo, nome_grupo, desc_grupo');
  const grupo = g.data && g.data[0];
  if (g.error || !grupo) { botao.disabled = false; return feedbackGru('Não foi possível salvar o grupo: ' + (g.error?.message || 'o banco não permitiu a gravação.'), 'erro'); }

  // Todas as permissões do grupo numa única gravação (insere ou atualiza)
  const linhas = gruRecursos.map(r => ({ id_grupo: grupo.id_grupo, id_recurso: r.id_recurso, nivel_permissao: gruNiveis[r.id_recurso] || 'nao_ver' }));
  const p = await sbClient.from('acessos_permissoes').upsert(linhas, { onConflict: 'id_grupo,id_recurso' });
  botao.disabled = false;
  if (p.error) return feedbackGru('O grupo foi salvo, mas as permissões não: ' + p.error.message, 'erro');

  const i = gruLista.findIndex(x => x.id_grupo === grupo.id_grupo);
  if (i >= 0) gruLista[i] = grupo; else gruLista.push(grupo);
  gruLista.sort((a, b) => a.nome_grupo.localeCompare(b.nome_grupo, 'pt-BR'));
  gruPermissoes = gruPermissoes.filter(x => x.id_grupo !== grupo.id_grupo).concat(linhas);
  sincronizarGruposCad();
  fecharGrupo();
  desenharGrupos();
  avisoCadastro(gruEditando ? 'Grupo atualizado.' : 'Grupo criado.');
}

// Exclusão em dois cliques (só para grupos sem pessoas)
async function excluirGrupo() {
  const botao = document.getElementById('gruExcluir');
  if (!gruEditando || botao.disabled) return;
  if (!botao.dataset.confirmar) {
    botao.dataset.confirmar = '1';
    botao.textContent = 'Confirmar exclusão';
    feedbackGru('Clique de novo para excluir o grupo e as permissões dele.', 'erro');
    return;
  }
  const { error } = await sbClient.from('acessos_grupos').delete().eq('id_grupo', gruEditando.id_grupo);
  if (error) {
    return feedbackGru(/foreign key|colaboradores_id_grupo/i.test(error.message)
      ? 'Há pessoas neste grupo. Tire-as antes, em Colaboradores.' : 'Não foi possível excluir: ' + error.message, 'erro');
  }
  gruLista = gruLista.filter(g => g.id_grupo !== gruEditando.id_grupo);
  gruPermissoes = gruPermissoes.filter(x => x.id_grupo !== gruEditando.id_grupo);
  sincronizarGruposCad();
  fecharGrupo();
  desenharGrupos();
  avisoCadastro('Grupo excluído.');
}

// Mantém a lista de grupos do cadastro de colaboradores igual à desta aba
function sincronizarGruposCad() {
  if (typeof cadGrupos === 'undefined') return;
  cadGrupos = gruLista.map(g => ({ id_grupo: g.id_grupo, nome_grupo: g.nome_grupo }));
  if (typeof preencherGruposCad === 'function') preencherGruposCad();
  if (typeof desenharCadastro === 'function') desenharCadastro();
}

// ==========================================
// CONFIGURAÇÕES › Empresas (tabela empresas do Supabase)
// Colunas: id_empresa (código SAP), nome_empresa, metodo_consolidacao (integral | proporcional | fora),
// percentual_participacao (0 a 100) e classificacao_empresa (ordem no seletor e nas colunas da Consolidada).
// - Código SAP só na inclusão (os balancetes dependem dele); sem exclusão: para tirar do consolidado, use "fora".
// - Gravar exige supabase/16_cadastro_empresas.sql (o script 03 dava só leitura).
// Usa os auxiliares de ../commons.js (escCad, soDigitos, avisoCadastro).
// ==========================================

let empLista = [];
let empEditando = null;

const METODOS = {
  integral:     { rotulo: 'Integral', classe: 'integral',
                  ajuda: 'Controlada: entra com 100% das linhas no consolidado; a parte que não é do grupo aparece como participação de não controladores.' },
  proporcional: { rotulo: 'Proporcional', classe: 'proporcional',
                  ajuda: 'Entra no consolidado pela participação do grupo (ex.: controle conjunto).' },
  fora:         { rotulo: 'Fora do consolidado', classe: 'fora',
                  ajuda: 'Aparece só na visão por empresa, sem entrar no consolidado (ex.: empresa incorporada).' },
};
const campoEmp = nome => document.querySelector(`#empForm [name="${nome}"]`);
const fmtPerc = v => (v === null || v === undefined || v === '') ? '—'
  : `${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: Number(v) % 1 ? 2 : 0, maximumFractionDigits: 2 })}%`;

async function iniciarConfig() {
  document.getElementById('modalEmpresa').addEventListener('click', e => { if (e.target.id === 'modalEmpresa') fecharEmpresa(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('modalEmpresa').classList.contains('active')) fecharEmpresa(); });
  document.getElementById('empMetodo').addEventListener('change', ajudaMetodo);
  document.getElementById('empForm').addEventListener('input', e => {
    if (e.target.classList.contains('invalido')) { e.target.classList.remove('invalido'); feedbackEmp(''); }
  });
  await carregarEmpresas();
}

async function carregarEmpresas() {
  const { data, error } = await sbClient.from('empresas')
    .select('id_empresa, nome_empresa, metodo_consolidacao, percentual_participacao, classificacao_empresa, empresa_holding');
  if (error) {
    document.getElementById('empCorpo').innerHTML = `<tr><td colspan="5" class="cad-vazio">Não foi possível carregar as empresas: ${escCad(error.message)}</td></tr>`;
    return;
  }
  empLista = data || [];
  ordenarEmpresas();
  desenharEmpresas();
}

// Pela ordem de exibição (vazias no fim) e depois pelo nome
function ordenarEmpresas() {
  empLista.sort((a, b) => (a.classificacao_empresa ?? 1e9) - (b.classificacao_empresa ?? 1e9)
    || (a.nome_empresa || '').localeCompare(b.nome_empresa || '', 'pt-BR'));
}

function desenharEmpresas() {
  const busca = document.getElementById('empBusca').value.trim().toLowerCase();
  const lista = empLista.filter(e => !busca || String(e.id_empresa).includes(busca) || (e.nome_empresa || '').toLowerCase().includes(busca));
  document.getElementById('empCorpo').innerHTML = lista.length ? lista.map(e => {
    const m = METODOS[e.metodo_consolidacao] || { rotulo: e.metodo_consolidacao, classe: '' };
    return `
    <tr tabindex="0" onclick="abrirEmpresa(${e.id_empresa})" onkeydown="if(event.key==='Enter') abrirEmpresa(${e.id_empresa})">
      <td>${e.classificacao_empresa ?? '—'}</td>
      <td>${e.id_empresa}</td>
      <td><strong>${escCad(e.nome_empresa)}</strong>${e.empresa_holding ? ' <span class="emp-holding" title="Quem é desta empresa vê todas">holding</span>' : ''}</td>
      <td><span class="emp-metodo ${m.classe}">${escCad(m.rotulo)}</span></td>
      <td class="num">${fmtPerc(e.percentual_participacao)}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="5" class="cad-vazio">Nenhuma empresa ${busca ? 'encontrada' : 'cadastrada'}.</td></tr>`;
  const noConsolidado = empLista.filter(e => e.metodo_consolidacao !== 'fora').length;
  document.getElementById('empRodape').textContent =
    `${lista.length} de ${empLista.length} · ${noConsolidado} no consolidado, ${empLista.length - noConsolidado} fora`;
}

function ajudaMetodo() {
  document.getElementById('empAjudaMetodo').textContent = (METODOS[campoEmp('metodo_consolidacao').value] || {}).ajuda || '';
}

function feedbackEmp(texto, tipo = '') {
  const el = document.getElementById('empFeedback');
  el.textContent = texto;
  el.className = 'cad-feedback' + (tipo ? ' ' + tipo : '');
}

function abrirEmpresa(id) {
  empEditando = id === null ? null : empLista.find(e => e.id_empresa === id) || null;
  const e = empEditando || { metodo_consolidacao: 'integral', percentual_participacao: 100 };
  document.getElementById('empTitulo').textContent = empEditando ? `Editar · ${empEditando.nome_empresa}` : 'Nova empresa';
  campoEmp('id_empresa').value = e.id_empresa ?? '';
  campoEmp('id_empresa').readOnly = !!empEditando;
  document.getElementById('empAjudaCodigo').textContent = empEditando ? 'O código não pode ser alterado: os balancetes dependem dele.' : '';
  campoEmp('nome_empresa').value = e.nome_empresa ?? '';
  campoEmp('metodo_consolidacao').value = e.metodo_consolidacao || 'integral';
  campoEmp('percentual_participacao').value = e.percentual_participacao ?? '';
  campoEmp('classificacao_empresa').value = e.classificacao_empresa ?? '';
  campoEmp('empresa_holding').checked = !!e.empresa_holding;
  document.querySelectorAll('#empForm .invalido').forEach(el => el.classList.remove('invalido'));
  feedbackEmp('');
  ajudaMetodo();
  document.getElementById('modalEmpresa').classList.add('active');
  if (Permissoes.travar(document.getElementById('empForm'), 'cad_empresas')) document.getElementById('empTitulo').textContent += ' (somente leitura)';
  else setTimeout(() => campoEmp(empEditando ? 'nome_empresa' : 'id_empresa').focus(), 60);
}

function fecharEmpresa() {
  document.getElementById('modalEmpresa').classList.remove('active');
}

function lerEmpresa() {
  const perc = String(campoEmp('percentual_participacao').value).replace(',', '.').trim();
  const ordem = String(campoEmp('classificacao_empresa').value).trim();
  return {
    id_empresa: soDigitos(campoEmp('id_empresa').value) ? Number(soDigitos(campoEmp('id_empresa').value)) : null,
    nome_empresa: campoEmp('nome_empresa').value.trim() || null,
    metodo_consolidacao: campoEmp('metodo_consolidacao').value,
    percentual_participacao: perc === '' ? 100 : Number(perc),
    classificacao_empresa: ordem === '' ? null : Number(ordem),
    empresa_holding: campoEmp('empresa_holding').checked,
  };
}

function validarEmpresa(v) {
  const erro = (nome, msg) => { campoEmp(nome).classList.add('invalido'); campoEmp(nome).focus(); feedbackEmp(msg, 'erro'); return false; };
  if (!empEditando) {
    if (!v.id_empresa) return erro('id_empresa', 'Informe o código SAP da empresa (só números).');
    const mesmo = empLista.find(e => e.id_empresa === v.id_empresa);
    if (mesmo) return erro('id_empresa', `O código ${v.id_empresa} já é da empresa ${mesmo.nome_empresa}.`);
  }
  if (!v.nome_empresa) return erro('nome_empresa', 'Informe o nome da empresa.');
  if (!Number.isFinite(v.percentual_participacao) || v.percentual_participacao < 0 || v.percentual_participacao > 100) {
    return erro('percentual_participacao', 'A participação deve estar entre 0 e 100.');
  }
  if (v.classificacao_empresa !== null) {
    if (!Number.isInteger(v.classificacao_empresa) || v.classificacao_empresa < 1) return erro('classificacao_empresa', 'A ordem deve ser um número inteiro a partir de 1.');
    const ocupada = empLista.find(e => e.classificacao_empresa === v.classificacao_empresa && e.id_empresa !== (empEditando?.id_empresa ?? v.id_empresa));
    if (ocupada) return erro('classificacao_empresa', `A ordem ${v.classificacao_empresa} já é da empresa ${ocupada.nome_empresa}. Escolha outra ou deixe vazio.`);
  }
  return true;
}

async function salvarEmpresa() {
  const v = lerEmpresa();
  if (!validarEmpresa(v)) return;
  const botao = document.getElementById('empSalvar');
  botao.disabled = true;
  feedbackEmp('Salvando…');
  const colunas = 'id_empresa, nome_empresa, metodo_consolidacao, percentual_participacao, classificacao_empresa, empresa_holding';
  let resp;
  if (empEditando) {
    const { id_empresa, ...alteracoes } = v;
    resp = await sbClient.from('empresas').update(alteracoes).eq('id_empresa', empEditando.id_empresa).select(colunas);
  } else {
    resp = await sbClient.from('empresas').insert(v).select(colunas);
  }
  botao.disabled = false;
  const salvo = resp.data && resp.data[0];
  if (resp.error || !salvo) {
    // Sem a regra de edição (script 16), o banco recusa a inclusão ou não altera nenhuma linha
    const semPermissao = !salvo && (!resp.error || /row-level security/i.test(resp.error.message));
    feedbackEmp(semPermissao ? 'O banco não permitiu gravar. Rode supabase/16_cadastro_empresas.sql no Supabase.'
                             : 'Não foi possível salvar: ' + resp.error.message, 'erro');
    return;
  }
  const i = empLista.findIndex(e => e.id_empresa === salvo.id_empresa);
  if (i >= 0) empLista[i] = salvo; else empLista.push(salvo);
  ordenarEmpresas();
  fecharEmpresa();
  desenharEmpresas();
  avisoCadastro(empEditando ? 'Empresa atualizada.' : 'Empresa incluída.');
}

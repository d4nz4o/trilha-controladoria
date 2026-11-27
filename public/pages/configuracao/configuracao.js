// ==========================================
// CONFIGURAÇÕES · Cadastro de colaboradores (tabela colaboradores do Supabase)
// - Lista com busca e filtro por situação; inclusão e edição num formulário.
// - Sem exclusão: quem sai é inativado (esta_ativo = false) e o cadastro segue no histórico
//   (comentários, tarefas, férias). Ninguém inativa o próprio cadastro.
// - id_auth (vínculo com o login) é preenchido automaticamente no primeiro acesso; aqui só é exibido.
// As regras de acesso do banco continuam valendo em cada gravação.
// ==========================================

let cadColaboradores = [];
let cadEquipes = [];
let cadGrupos = [];
let cadEmpresas = [];           // empresas (lista do campo Empresa)             // grupos de acesso (acessos_grupos)
let cadSituacao = 'ativos';
let cadEditando = null;          // registro em edição (null = novo)
let cadUsuario = { email: '', id: null };

const CAMPOS_TEXTO = ['nome_colab', 'nome_comp_colab', 'email_colab', 'cargo_colab', 'sap_colab'];
const CAMPOS_NUMERO = ['matricula_colab', 'cel_colab'];   // colunas numéricas: só dígitos
const CAMPOS_DATA = ['data_admissao', 'aniver_colab'];

const escCad = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const soDigitos = v => String(v ?? '').replace(/\D/g, '');
const nomeEmpresaCad = c => (cadEmpresas.find(e => e.id_empresa === c.id_empresa) || {}).nome_empresa || '';
const nomeGrupoCad = c => (cadGrupos.find(g => g.id_grupo === c.id_grupo) || {}).nome_grupo || '';
const nomeEquipeCad = c => (c.equipes && c.equipes.nome_equipe) || (cadEquipes.find(e => e.id_equipe === c.id_equipe) || {}).nome_equipe || '';

async function iniciarPagina() {
  const { data } = await sbClient.auth.getSession();
  cadUsuario = { email: (data.session?.user?.email || '').toLowerCase(), id: data.session?.user?.id || null };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('modalCadastro').classList.contains('active')) fecharCadastro(); });
  document.getElementById('modalCadastro').addEventListener('click', e => { if (e.target.id === 'modalCadastro') fecharCadastro(); });
  document.querySelector('#cadForm [name="email_colab"]').addEventListener('input', avisoEmail);
  // Ao corrigir um campo, some a marcação de erro e o aviso
  document.getElementById('cadForm').addEventListener('input', e => {
    if (e.target.classList.contains('invalido')) { e.target.classList.remove('invalido'); definirFeedbackCad(''); }
  });
  // Abas da barra (Colaboradores | Empresas); a aba fica no endereço (#empresas)
  window.addEventListener('hashchange', () => mostrarSecao(location.hash.slice(1)));
  mostrarSecao(location.hash.slice(1));
  await Promise.all([
    carregarCadastro(),
    typeof iniciarEmpresas === 'function' ? iniciarEmpresas() : null,
    typeof iniciarGrupos === 'function' ? iniciarGrupos() : null,
    typeof iniciarContas === 'function' ? iniciarContas() : null,
  ]);
}

function mostrarSecao(nome) {
  const secoes = [...document.querySelectorAll('[data-secao]')];
  // Só abas que o grupo de acesso permite ver; a pedida, se permitida, senão a primeira permitida
  const permitidas = [...document.querySelectorAll('.abas [data-aba]')]
    .filter(a => !a.classList.contains('sem-permissao')).map(a => a.dataset.aba);
  if (!permitidas.includes(nome)) nome = permitidas[0] || 'colaboradores';
  secoes.forEach(s => { s.hidden = s.dataset.secao !== nome; });
  document.querySelectorAll('.abas [data-aba]').forEach(a => {
    if (a.dataset.aba === nome) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

async function carregarCadastro() {
  const [eq, col, gru, emp] = await Promise.all([
    sbClient.from('equipes').select('id_equipe, nome_equipe').order('nome_equipe'),
    sbClient.from('colaboradores').select('*, equipes(nome_equipe)').order('nome_colab'),
    sbClient.from('acessos_grupos').select('id_grupo, nome_grupo').order('nome_grupo'),
    sbClient.from('empresas').select('id_empresa, nome_empresa, classificacao_empresa').order('classificacao_empresa', { nullsFirst: false }),
  ]);
  cadEmpresas = emp.error ? [] : (emp.data || []);
  cadEquipes = eq.error ? [] : (eq.data || []);
  cadGrupos = gru.error ? [] : (gru.data || []);   // sem a tabela (script 17): campo de grupo fica vazio
  let colab = col;
  if (col.error) colab = await sbClient.from('colaboradores').select('*').order('nome_colab');   // banco sem a tabela de equipes
  if (colab.error) {
    document.getElementById('cadCorpo').innerHTML = `<tr><td colspan="7" class="cad-vazio">Não foi possível carregar o cadastro: ${escCad(colab.error.message)}</td></tr>`;
    return;
  }
  cadColaboradores = colab.data || [];
  document.getElementById('cadEquipe').innerHTML = '<option value="">—</option>' +
    cadEquipes.map(e => `<option value="${e.id_equipe}">${escCad(e.nome_equipe)}</option>`).join('');
  preencherGruposCad();
  preencherEmpresasCad();
  desenharCadastro();
}

// Lista de empresas no formulário (também chamada por empresas.js quando uma empresa é incluída ou renomeada)
function preencherEmpresasCad() {
  const sel = document.getElementById('cadEmpresa');
  const atual = sel.value;
  sel.innerHTML = '<option value="">—</option>' + cadEmpresas.map(e => `<option value="${e.id_empresa}">${escCad(e.nome_empresa)}</option>`).join('');
  sel.value = atual;
}

// Lista de grupos no formulário (também chamada por grupos.js quando um grupo é criado ou renomeado)
function preencherGruposCad() {
  const sel = document.getElementById('cadGrupo');
  const atual = sel.value;
  sel.innerHTML = '<option value="">—</option>' + cadGrupos.map(g => `<option value="${g.id_grupo}">${escCad(g.nome_grupo)}</option>`).join('');
  sel.value = atual;
}

function filtrarSituacao(qual) {
  cadSituacao = qual;
  document.querySelectorAll('[data-situacao]').forEach(b => {
    const ativo = b.dataset.situacao === qual;
    b.classList.toggle('is-active', ativo);
    b.setAttribute('aria-pressed', ativo);
  });
  desenharCadastro();
}

function desenharCadastro() {
  const busca = document.getElementById('cadBusca').value.trim().toLowerCase();
  const lista = cadColaboradores
    .filter(c => cadSituacao === 'todos' || (cadSituacao === 'ativos' ? c.esta_ativo !== false : c.esta_ativo === false))
    .filter(c => !busca || [c.nome_colab, c.nome_comp_colab, c.email_colab, c.cargo_colab, nomeEquipeCad(c), nomeGrupoCad(c), nomeEmpresaCad(c)]
      .some(v => String(v || '').toLowerCase().includes(busca)));
  const corpo = document.getElementById('cadCorpo');
  corpo.innerHTML = lista.length ? lista.map(c => `
    <tr tabindex="0" onclick="abrirCadastro(${c.id_colab})" onkeydown="if(event.key==='Enter') abrirCadastro(${c.id_colab})" class="${c.esta_ativo === false ? 'inativo' : ''}">
      <td><strong>${escCad(c.nome_colab)}</strong>${c.nome_comp_colab ? `<small>${escCad(c.nome_comp_colab)}</small>` : ''}</td>
      <td>${escCad(c.email_colab || '—')}</td>
      <td>${escCad(nomeEmpresaCad(c) || '—')}</td>
      <td>${escCad(nomeEquipeCad(c) || '—')}</td>
      <td>${escCad(nomeGrupoCad(c) || '—')}</td>
      <td><span class="cad-situacao ${c.esta_ativo === false ? 'inativo' : 'ativo'}">${c.esta_ativo === false ? 'Inativo' : 'Ativo'}</span></td>
      <td>${c.id_auth ? '<span class="cad-vinculo" title="Já entrou no portal">✓</span>' : '<span class="cad-sem-vinculo" title="Ainda não entrou no portal">—</span>'}</td>
    </tr>`).join('')
    : `<tr><td colspan="7" class="cad-vazio">Nenhum colaborador ${busca ? 'encontrado' : cadSituacao === 'inativos' ? 'inativo' : 'cadastrado'}.</td></tr>`;
  const ativos = cadColaboradores.filter(c => c.esta_ativo !== false).length;
  document.getElementById('cadRodape').textContent =
    `${lista.length} de ${cadColaboradores.length} · ${ativos} ativo(s), ${cadColaboradores.length - ativos} inativo(s)`;
}

/* ---------- Formulário ---------- */

const campo = nome => document.querySelector(`#cadForm [name="${nome}"]`);
const ehProprio = c => c && ((c.email_colab || '').toLowerCase() === cadUsuario.email || (cadUsuario.id && c.id_auth === cadUsuario.id));

function abrirCadastro(id) {
  cadEditando = id === null ? null : cadColaboradores.find(c => c.id_colab === id) || null;
  const c = cadEditando || { esta_ativo: true };
  document.getElementById('cadTitulo').textContent = cadEditando ? `Editar · ${cadEditando.nome_colab}` : 'Novo colaborador';
  [...CAMPOS_TEXTO, ...CAMPOS_NUMERO].forEach(n => { campo(n).value = c[n] ?? ''; });
  if (c.cel_colab) campo('cel_colab').value = formatarCelular(String(c.cel_colab));
  CAMPOS_DATA.forEach(n => { campo(n).value = c[n] ? String(c[n]).slice(0, 10) : ''; });
  campo('id_equipe').value = c.id_equipe ?? '';
  campo('id_empresa').value = c.id_empresa ?? '';
  campo('id_grupo').value = c.id_grupo ?? '';
  campo('esta_ativo').checked = c.esta_ativo !== false;
  // O próprio usuário não pode se inativar
  campo('esta_ativo').disabled = !!(cadEditando && ehProprio(cadEditando));
  document.getElementById('cadLogin').innerHTML = !cadEditando ? ''
    : cadEditando.id_auth ? '✓ Login vinculado: já entrou no portal.'
    : 'Ainda não entrou no portal. O vínculo com o login é feito automaticamente no primeiro acesso, pelo e-mail.';
  if (cadEditando && ehProprio(cadEditando)) document.getElementById('cadLogin').innerHTML += '<br>Este é o seu cadastro: não é possível inativá-lo.';
  document.querySelectorAll('#cadForm .invalido').forEach(el => el.classList.remove('invalido'));
  definirFeedbackCad('');
  avisoEmail();
  document.getElementById('modalCadastro').classList.add('active');
  if (Permissoes.travar(document.getElementById('cadForm'), 'cad_colaboradores')) document.getElementById('cadTitulo').textContent += ' (somente leitura)';
  else setTimeout(() => campo('nome_colab').focus(), 60);
}

function fecharCadastro() {
  document.getElementById('modalCadastro').classList.remove('active');
}

function formatarCelular(d) {
  d = soDigitos(d);
  if (d.length === 11) return d.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
  if (d.length === 10) return d.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
  return d;
}

function avisoEmail() {
  const email = campo('email_colab').value.trim().toLowerCase();
  const dominio = email.split('@')[1] || '';
  const aviso = document.getElementById('cadAvisoEmail');
  aviso.textContent = email && dominio && typeof DOMINIOS_CORPORATIVOS !== 'undefined' && !DOMINIOS_CORPORATIVOS.includes(dominio)
    ? `Domínio fora do grupo (${DOMINIOS_CORPORATIVOS.join(', ')}): esta pessoa não conseguirá entrar no portal.` : '';
}

function definirFeedbackCad(texto, tipo = '') {
  const el = document.getElementById('cadFeedback');
  el.textContent = texto;
  el.className = 'cad-feedback' + (tipo ? ' ' + tipo : '');
}

function lerFormulario() {
  const v = {};
  CAMPOS_TEXTO.forEach(n => { const x = campo(n).value.trim(); v[n] = x || null; });
  CAMPOS_NUMERO.forEach(n => { const x = soDigitos(campo(n).value); v[n] = x || null; });
  CAMPOS_DATA.forEach(n => { v[n] = campo(n).value || null; });
  v.email_colab = v.email_colab ? v.email_colab.toLowerCase() : null;
  v.id_equipe = campo('id_equipe').value ? Number(campo('id_equipe').value) : null;
  if (cadEmpresas.length || campo('id_empresa').value) v.id_empresa = campo('id_empresa').value ? Number(campo('id_empresa').value) : null;
  if (cadGrupos.length || campo('id_grupo').value) v.id_grupo = campo('id_grupo').value ? Number(campo('id_grupo').value) : null;
  v.esta_ativo = campo('esta_ativo').checked;
  return v;
}

function validar(v) {
  const erro = (nome, msg) => { campo(nome).classList.add('invalido'); campo(nome).focus(); definirFeedbackCad(msg, 'erro'); return false; };
  document.querySelectorAll('#cadForm .invalido').forEach(el => el.classList.remove('invalido'));
  if (!v.nome_colab) return erro('nome_colab', 'Informe o nome de exibição.');
  if (!v.email_colab || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email_colab)) return erro('email_colab', 'Informe um e-mail válido.');
  const repetido = cadColaboradores.find(c => (c.email_colab || '').toLowerCase() === v.email_colab && c.id_colab !== cadEditando?.id_colab);
  if (repetido) return erro('email_colab', `Este e-mail já está no cadastro de ${repetido.nome_colab}.`);
  if (cadEmpresas.length && !v.id_empresa) return erro('id_empresa', 'Informe a empresa: sem ela, a pessoa não vê nenhum dado das demonstrações.');
  if (v.cel_colab && !/^\d{10,11}$/.test(v.cel_colab)) return erro('cel_colab', 'O celular deve ter DDD + número (10 ou 11 dígitos).');
  if (cadEditando && ehProprio(cadEditando) && !v.esta_ativo) return erro('esta_ativo', 'Você não pode inativar o próprio cadastro.');
  return true;
}

async function salvarCadastro() {
  const v = lerFormulario();
  if (!validar(v)) return;
  const botao = document.getElementById('cadSalvar');
  botao.disabled = true;
  definirFeedbackCad('Salvando…');
  const selecao = '*, equipes(nome_equipe)';
  let resp;
  if (cadEditando) {
    resp = await sbClient.from('colaboradores').update(v).eq('id_colab', cadEditando.id_colab).select(selecao).single();
  } else {
    resp = await sbClient.from('colaboradores').insert(v).select(selecao).single();
    // Se o id não for gerado pelo banco, usa o próximo número disponível
    if (resp.error && /id_colab/.test(resp.error.message) && /null/.test(resp.error.message)) {
      const proximo = Math.max(0, ...cadColaboradores.map(c => Number(c.id_colab) || 0)) + 1;
      resp = await sbClient.from('colaboradores').insert({ id_colab: proximo, ...v }).select(selecao).single();
    }
  }
  botao.disabled = false;
  if (resp.error) {
    definirFeedbackCad('Não foi possível salvar: ' + resp.error.message, 'erro');
    return;
  }
  const salvo = resp.data;
  const i = cadColaboradores.findIndex(c => c.id_colab === salvo.id_colab);
  if (i >= 0) cadColaboradores[i] = salvo; else cadColaboradores.push(salvo);
  cadColaboradores.sort((a, b) => (a.nome_colab || '').localeCompare(b.nome_colab || '', 'pt-BR'));
  if (typeof Cache !== 'undefined') Cache.limpar('colaboradores');   // as páginas da controladoria recarregam a lista
  fecharCadastro();
  desenharCadastro();
  if (typeof desenharGrupos === 'function') desenharGrupos();   // contagem de pessoas por grupo
  avisoCadastro(cadEditando ? 'Cadastro atualizado.' : 'Colaborador incluído.');
}

function avisoCadastro(texto) {
  let el = document.getElementById('cadAviso');
  if (!el) { el = document.createElement('div'); el.id = 'cadAviso'; el.className = 'cad-aviso'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = texto;
  el.classList.add('visivel');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('visivel'), 2800);
}

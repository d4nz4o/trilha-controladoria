// ==========================================
// CONFIGURAÇÕES › Plano de contas (balancetes_contas + balancetes_classificacoes; supabase/21_plano_de_contas.sql)
// - Contas: número (só na inclusão), descrição, classificação (Nv1 › Nv2 › Nv3) e contraparte intercompany.
// - Pendências: contas cadastradas sem classificação (as com saldo nos balancetes primeiro), com classificação
//   sugerida pelas contas de número parecido; e conferência do ARQUIVO do balancete antes da carga (o banco não
//   aceita saldo de conta não cadastrada), listando as contas do arquivo que faltam no cadastro.
// - Sem exclusão: os balancetes dependem das contas.
// Usa os auxiliares de ../commons.js (escCad, soDigitos, avisoCadastro, lerTudo, carregarSheetJS).
// ==========================================

const NV1_BP = ['Ativo circulante', 'Ativo não circulante', 'Passivo circulante', 'Passivo não circulante', 'Patrimônio líquido'];

let ctaContas = [];
let ctaClassif = [];          // hierarquia
let ctaEmpresas = [];
let ctaComSaldo = new Set();  // contas sem classificação que têm saldo nos balancetes
let ctaFiltro = 'todas';
let ctaEditando = null;
let ctaFaltantes = [];        // contas do arquivo que não estão no cadastro
let ctaPendencias = [];       // saldos em balancetes_pendencias (contas sem cadastro), agrupados por conta
let ctaPendErro = '';

const campoCta = nome => document.querySelector(`#ctaForm [name="${nome}"]`);
const classifDe = id => ctaClassif.find(c => c.id_classificacao === id);
const demDe = cl => (cl ? (NV1_BP.includes(cl.nivel1) ? 'BP' : 'DR') : '');
const rotuloClassif = cl => (cl ? `${cl.nivel1} › ${cl.nivel2} › ${cl.nivel3}` : '');
const ordemClassif = (a, b) => (a.ordem_nivel1 ?? 0) - (b.ordem_nivel1 ?? 0) || (a.ordem_nivel2 ?? 0) - (b.ordem_nivel2 ?? 0) || (a.ordem_nivel3 ?? 0) - (b.ordem_nivel3 ?? 0);

async function iniciarConfig() {
  document.getElementById('modalConta').addEventListener('click', e => { if (e.target.id === 'modalConta') fecharConta(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('modalConta').classList.contains('active')) fecharConta(); });
  document.getElementById('ctaForm').addEventListener('input', e => {
    if (e.target.classList.contains('invalido')) { e.target.classList.remove('invalido'); feedbackCta(''); }
  });
  document.getElementById('ctaDem').addEventListener('change', () => cascata('dem'));
  document.getElementById('ctaNv1').addEventListener('change', () => cascata('nv1'));
  document.getElementById('ctaNv2').addEventListener('change', () => cascata('nv2'));
  await carregarContas();
}


async function carregarContas() {
  try {
    const [contas, classif, empresas] = await Promise.all([
      lerTudo('balancetes_contas', 'id_conta, numero_conta, desc_conta, id_classificacao, id_empresa_contraparte', 'numero_conta'),
      lerTudo('balancetes_classificacoes', 'id_classificacao, nivel1, nivel2, nivel3, ordem_nivel1, ordem_nivel2, ordem_nivel3', 'id_classificacao'),
      sbClient.from('empresas').select('id_empresa, nome_empresa').order('classificacao_empresa', { nullsFirst: false }),
    ]);
    ctaContas = contas;
    ctaClassif = classif.sort(ordemClassif);
    ctaEmpresas = empresas.data || [];
  } catch (erro) {
    document.getElementById('ctaCorpo').innerHTML = `<tr><td colspan="5" class="cad-vazio">Não foi possível carregar o plano de contas: ${escCad(erro.message)}</td></tr>`;
    return;
  }
  document.getElementById('ctaContraparte').innerHTML = '<option value="">— não é intercompany —</option>' +
    ctaEmpresas.map(e => `<option value="${e.id_empresa}">${escCad(e.nome_empresa)} (${e.id_empresa})</option>`).join('');
  await Promise.all([marcarContasComSaldo(), carregarPendenciasSaldos()]);
  desenharContas();
  desenharPendencias();
  desenharPendenciasSaldos();
}

/* ---------- Saldos com conta sem cadastro (balancetes_pendencias; supabase/22_balancetes_pendencias.sql) ---------- */

async function carregarPendenciasSaldos() {
  ctaPendErro = '';
  try {
    const linhas = await lerTudo('balancetes_pendencias', 'id_pendencia, id_empresa, numero_conta, periodo_balancete, montante_balancete, desc_conta', 'id_pendencia');
    const porConta = new Map();
    linhas.forEach(l => {
      const g = porConta.get(l.numero_conta) || { numero: l.numero_conta, desc: '', linhas: 0, empresas: new Set(), meses: new Set() };
      g.linhas++;
      g.empresas.add(l.id_empresa);
      g.meses.add(String(l.periodo_balancete).slice(0, 7));
      if (l.desc_conta && !g.desc) g.desc = l.desc_conta;
      porConta.set(l.numero_conta, g);
    });
    ctaPendencias = [...porConta.values()].sort((a, b) => b.linhas - a.linhas || a.numero.localeCompare(b.numero));
  } catch (erro) {
    ctaPendencias = [];
    ctaPendErro = /balancetes_pendencias/.test(erro.message) ? 'Rode supabase/22_balancetes_pendencias.sql no Supabase para ativar as pendências.' : erro.message;
  }
}

const mesCurto = am => { const [a, m] = am.split('-'); return `${['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][Number(m) - 1]}/${a.slice(2)}`; };
const totalPendente = () => ctaPendencias.reduce((s, g) => s + g.linhas, 0);

function desenharPendenciasSaldos() {
  const alvo = document.getElementById('ctaPendSaldos');
  const topo = '<div class="cta-pend-topo"><strong>Saldos com conta sem cadastro</strong></div>';
  if (ctaPendErro) { alvo.innerHTML = topo + `<p class="cta-pend-texto">${escCad(ctaPendErro)}</p>`; return; }
  if (!ctaPendencias.length) {
    alvo.innerHTML = topo + '<p class="cta-pend-texto ok">Nenhum saldo aguardando cadastro de conta. ✓</p>';
    return;
  }
  const podeEditar = Permissoes.podeEditar('plano_contas');
  const nomeEmp = id => (ctaEmpresas.find(e => e.id_empresa === id) || {}).nome_empresa || id;
  alvo.innerHTML = `
    <div class="cta-pend-topo"><strong>Saldos com conta sem cadastro <span class="cta-pend-qtd">${totalPendente()}</span></strong></div>
    <p class="cta-pend-texto">${ctaPendencias.length} conta(s) com saldos carregados que aguardam cadastro. Ao cadastrar, os saldos passam sozinhos para os balancetes.</p>
    <ul class="cta-lista">${ctaPendencias.slice(0, 8).map(g => {
      const s = sugerirClassificacao(g.numero);
      const meses = [...g.meses].sort();
      return `<li>
        <span><strong>${escCad(g.numero)}</strong> ${escCad(g.desc)}
          <small class="cta-pend-info">${g.linhas} saldo(s) · ${escCad([...g.empresas].map(nomeEmp).join(', '))} · ${escCad(meses.length > 3 ? `${mesCurto(meses[0])} a ${mesCurto(meses[meses.length - 1])}` : meses.map(mesCurto).join(', '))}</small>
          ${s ? `<small>Sugestão: ${escCad(rotuloClassif(classifDe(s.id)))} (como as contas ${escCad(s.prefixo)}…)</small>` : ''}</span>
        ${podeEditar ? `<span class="cta-acoes">
          <button type="button" class="btn-action" onclick="cadastrarPendencia('${escCad(g.numero)}')">Cadastrar</button>
          <button type="button" class="btn-action cta-descartar" onclick="descartarPendencia(this, '${escCad(g.numero)}')" title="Apaga os saldos pendentes desta conta">Descartar</button>
        </span>` : ''}
      </li>`;
    }).join('')}</ul>
    ${ctaPendencias.length > 8 ? `<p class="cta-pend-texto">e mais ${ctaPendencias.length - 8} conta(s).</p>` : ''}`;
}

function cadastrarPendencia(numero) {
  const g = ctaPendencias.find(x => x.numero === numero);
  abrirConta(null, { numero_conta: numero, desc_conta: g ? g.desc : '' });
}

// Descarte em dois cliques: apaga os saldos pendentes da conta (ex.: linha importada por engano)
async function descartarPendencia(botao, numero) {
  if (!botao.dataset.confirmar) {
    botao.dataset.confirmar = '1';
    botao.textContent = 'Confirmar descarte';
    return;
  }
  const { error } = await sbClient.from('balancetes_pendencias').delete().eq('numero_conta', numero);
  if (error) { alert('Não foi possível descartar: ' + error.message); return; }
  await carregarPendenciasSaldos();
  desenharPendenciasSaldos();
  avisoCadastro(`Saldos pendentes da conta ${numero} descartados.`);
}

// Depois de cadastrar contas: o banco migra as pendências delas; recarrega e conta quantos saldos passaram
async function atualizarAposCadastro(textoBase) {
  const antes = totalPendente();
  await carregarPendenciasSaldos();
  desenharPendenciasSaldos();
  const migrados = antes - totalPendente();
  avisoCadastro(textoBase + (migrados > 0 ? ` ${migrados} saldo(s) pendente(s) passaram para os balancetes.` : ''));
}

// Contas sem classificação que têm saldo nos balancetes (são as que deixam o BP e a DR incompletos)
async function marcarContasComSaldo() {
  ctaComSaldo = new Set();
  const sem = ctaContas.filter(c => !c.id_classificacao).map(c => c.numero_conta);
  for (let i = 0; i < sem.length; i += 200) {
    const { data, error } = await sbClient.from('balancetes').select('numero_conta, montante_balancete')
      .in('numero_conta', sem.slice(i, i + 200)).neq('montante_balancete', 0).limit(5000);
    if (error) return;   // sem acesso aos balancetes: a pendência aparece sem a informação de saldo
    (data || []).forEach(r => ctaComSaldo.add(r.numero_conta));
  }
}

// Classificação sugerida: a mais comum entre as contas classificadas de número mais parecido (prefixo mais longo)
function sugerirClassificacao(numero) {
  const n = String(numero || '');
  for (let tam = n.length - 1; tam >= 4; tam--) {
    const prefixo = n.slice(0, tam);
    const vizinhas = ctaContas.filter(c => c.id_classificacao && c.numero_conta !== n && c.numero_conta.startsWith(prefixo));
    if (vizinhas.length) {
      const conta = {};
      vizinhas.forEach(c => { conta[c.id_classificacao] = (conta[c.id_classificacao] || 0) + 1; });
      const id = Number(Object.entries(conta).sort((a, b) => b[1] - a[1])[0][0]);
      return { id, prefixo, qtd: vizinhas.length };
    }
  }
  return null;
}

function filtrarContas(qual) {
  ctaFiltro = qual;
  document.querySelectorAll('[data-filtro-conta]').forEach(b => {
    const ativo = b.dataset.filtroConta === qual;
    b.classList.toggle('is-active', ativo);
    b.setAttribute('aria-pressed', ativo);
  });
  desenharContas();
}

function desenharContas() {
  const busca = document.getElementById('ctaBusca').value.trim().toLowerCase();
  const nomeEmp = id => (ctaEmpresas.find(e => e.id_empresa === id) || {}).nome_empresa || id;
  const lista = ctaContas.filter(c => {
    const cl = classifDe(c.id_classificacao);
    if (ctaFiltro === 'sem' && cl) return false;
    if ((ctaFiltro === 'BP' || ctaFiltro === 'DR') && demDe(cl) !== ctaFiltro) return false;
    return !busca || [c.numero_conta, c.desc_conta, rotuloClassif(cl)].some(v => String(v || '').toLowerCase().includes(busca));
  });
  const mostrar = lista.slice(0, 400);   // tabela leve; a busca encontra o resto
  document.getElementById('ctaCorpo').innerHTML = mostrar.length ? mostrar.map(c => {
    const cl = classifDe(c.id_classificacao);
    return `
    <tr tabindex="0" onclick="abrirConta(${c.id_conta})" onkeydown="if(event.key==='Enter') abrirConta(${c.id_conta})">
      <td><strong>${escCad(c.numero_conta)}</strong></td>
      <td>${escCad(c.desc_conta || '—')}</td>
      <td>${cl ? `<span class="cta-dem ${demDe(cl)}">${demDe(cl)}</span>` : ''}</td>
      <td>${cl ? escCad(rotuloClassif(cl)) : `<span class="cta-sem">sem classificação${ctaComSaldo.has(c.numero_conta) ? ' · com saldo' : ''}</span>`}</td>
      <td>${c.id_empresa_contraparte ? escCad(nomeEmp(c.id_empresa_contraparte)) : '—'}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="5" class="cad-vazio">Nenhuma conta ${busca ? 'encontrada' : 'neste filtro'}.</td></tr>`;
  const sem = ctaContas.filter(c => !c.id_classificacao).length;
  document.getElementById('ctaRodape').textContent =
    `${lista.length} de ${ctaContas.length} contas${lista.length > mostrar.length ? ` (mostrando ${mostrar.length}; use a busca)` : ''} · ${sem} sem classificação`;
}

/* ---------- Pendências ---------- */

function desenharPendencias() {
  const sem = ctaContas.filter(c => !c.id_classificacao)
    .sort((a, b) => (ctaComSaldo.has(b.numero_conta) - ctaComSaldo.has(a.numero_conta)) || a.numero_conta.localeCompare(b.numero_conta));
  const alvo = document.getElementById('ctaPendSem');
  if (!sem.length) {
    alvo.innerHTML = '<div class="cta-pend-topo"><strong>Contas sem classificação</strong></div><p class="cta-pend-texto ok">Todas as contas cadastradas estão classificadas. ✓</p>';
    return;
  }
  const comSaldo = sem.filter(c => ctaComSaldo.has(c.numero_conta)).length;
  const podeEditar = Permissoes.podeEditar('plano_contas');
  alvo.innerHTML = `
    <div class="cta-pend-topo"><strong>Contas sem classificação</strong>
      <button type="button" class="cta-link" onclick="filtrarContas('sem')">ver todas (${sem.length})</button></div>
    <p class="cta-pend-texto">${sem.length} conta(s) cadastrada(s) sem classificação${comSaldo ? `, <b>${comSaldo} com saldo nos balancetes</b> (ficam fora do BP e da DR)` : ''}.</p>
    <ul class="cta-lista">${sem.slice(0, 6).map(c => {
      const s = sugerirClassificacao(c.numero_conta);
      return `<li>
        <span><strong>${escCad(c.numero_conta)}</strong> ${escCad(c.desc_conta || '')}${ctaComSaldo.has(c.numero_conta) ? ' <em class="cta-saldo">com saldo</em>' : ''}
          ${s ? `<small>Sugestão: ${escCad(rotuloClassif(classifDe(s.id)))} (como as contas ${escCad(s.prefixo)}…)</small>` : ''}</span>
        ${podeEditar ? `<button type="button" class="btn-action" onclick="abrirConta(${c.id_conta})">Classificar</button>` : ''}
      </li>`;
    }).join('')}</ul>`;
}


// Lê o arquivo do balancete no navegador e lista as contas que não estão no cadastro
async function conferirArquivo(arquivo) {
  const alvo = document.getElementById('ctaArquivoResultado');
  document.getElementById('ctaArquivo').value = '';
  if (!arquivo) return;
  alvo.innerHTML = '<p class="cta-pend-texto">Lendo o arquivo…</p>';
  try {
    await carregarSheetJS();
    const wb = XLSX.read(await arquivo.arrayBuffer(), { type: 'array' });
    const encontradas = new Map();   // número -> descrição
    const norm = v => String(v ?? '').trim().toLowerCase();
    wb.SheetNames.forEach(nome => {
      const linhas = XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: false, defval: '' });
      const iCab = linhas.findIndex(l => l.some(v => /^(n[ºo°]?\.?\s*conta|conta raz[aã]o|ctaraz[aã]o|numero_conta|n[uú]mero da conta|conta)$/.test(norm(v))));
      if (iCab < 0) return;
      const cab = linhas[iCab].map(norm);
      const iConta = cab.findIndex(v => /^(n[ºo°]?\.?\s*conta|conta raz[aã]o|ctaraz[aã]o|numero_conta|n[uú]mero da conta|conta)$/.test(v));
      const iDesc = cab.findIndex(v => /texto|descri|denomin/.test(v));
      linhas.slice(iCab + 1).forEach(l => {
        const conta = String(l[iConta] ?? '').trim();
        if (!/^\d{8}$/.test(conta)) return;                // subtotais e linhas sem conta ficam de fora
        if (!encontradas.has(conta) || !encontradas.get(conta)) encontradas.set(conta, iDesc >= 0 ? String(l[iDesc] ?? '').trim() : '');
      });
    });
    if (!encontradas.size) {
      alvo.innerHTML = '<p class="cta-pend-texto erro">Não encontrei a coluna de contas. O arquivo precisa ter um cabeçalho como "Nº conta", "Conta razão" ou "CtaRazão".</p>';
      return;
    }
    const cadastradas = new Set(ctaContas.map(c => c.numero_conta));
    ctaFaltantes = [...encontradas].filter(([n]) => !cadastradas.has(n)).map(([numero, desc]) => ({ numero, desc }));
    desenharFaltantes(arquivo.name, encontradas.size);
  } catch (erro) {
    alvo.innerHTML = `<p class="cta-pend-texto erro">Não foi possível ler o arquivo: ${escCad(erro.message)}</p>`;
  }
}

function desenharFaltantes(nomeArquivo, total) {
  const alvo = document.getElementById('ctaArquivoResultado');
  if (nomeArquivo) alvo.dataset.arquivo = nomeArquivo;
  if (total) alvo.dataset.total = total;
  if (!ctaFaltantes.length) {
    alvo.innerHTML = `<p class="cta-pend-texto ok">${escCad(alvo.dataset.arquivo)}: as ${alvo.dataset.total} contas do arquivo já estão no cadastro. ✓</p>`;
    return;
  }
  alvo.innerHTML = `
    <p class="cta-pend-texto">${escCad(alvo.dataset.arquivo)}: ${alvo.dataset.total} contas, <b>${ctaFaltantes.length} sem cadastro</b>.
      <button type="button" class="cta-link" onclick="incluirFaltantes()">incluir todas (sem classificação)</button></p>
    <ul class="cta-lista">${ctaFaltantes.slice(0, 8).map((f, i) => {
      const s = sugerirClassificacao(f.numero);
      return `<li>
        <span><strong>${escCad(f.numero)}</strong> ${escCad(f.desc)}
          ${s ? `<small>Sugestão: ${escCad(rotuloClassif(classifDe(s.id)))} (como as contas ${escCad(s.prefixo)}…)</small>` : ''}</span>
        <button type="button" class="btn-action" onclick="cadastrarFaltante(${i})">Cadastrar</button>
      </li>`;
    }).join('')}</ul>
    ${ctaFaltantes.length > 8 ? `<p class="cta-pend-texto">e mais ${ctaFaltantes.length - 8}.</p>` : ''}`;
}

function cadastrarFaltante(i) {
  const f = ctaFaltantes[i];
  abrirConta(null, { numero_conta: f.numero, desc_conta: f.desc });
}

async function incluirFaltantes() {
  if (!ctaFaltantes.length) return;
  const linhas = ctaFaltantes.map(f => ({ numero_conta: f.numero, desc_conta: f.desc || null }));
  const { data, error } = await sbClient.from('balancetes_contas').insert(linhas)
    .select('id_conta, numero_conta, desc_conta, id_classificacao, id_empresa_contraparte');
  if (error || !data || !data.length) {
    alert(error && !/row-level security/i.test(error.message) ? 'Não foi possível incluir: ' + error.message
      : 'O banco não permitiu incluir. Rode supabase/21_plano_de_contas.sql e confira o seu grupo de acesso.');
    return;
  }
  ctaContas.push(...data);
  ctaContas.sort((a, b) => a.numero_conta.localeCompare(b.numero_conta));
  data.forEach(c => ctaComSaldo.delete(c.numero_conta));
  ctaFaltantes = [];
  desenharFaltantes();
  desenharContas();
  desenharPendencias();
  await atualizarAposCadastro(`${data.length} conta(s) incluída(s). Classifique-as em "Contas sem classificação".`);
}

/* ---------- Formulário ---------- */

function feedbackCta(texto, tipo = '') {
  const el = document.getElementById('ctaFeedback');
  el.textContent = texto;
  el.className = 'cad-feedback' + (tipo ? ' ' + tipo : '');
}

// Seletores em cascata: Demonstração -> Nível 1 -> Nível 2 -> Nível 3
function opcoes(sel, valores, atual) {
  sel.innerHTML = '<option value="">—</option>' + valores.map(v => `<option value="${escCad(v)}">${escCad(v)}</option>`).join('');
  sel.value = valores.includes(atual) ? atual : '';
  sel.disabled = !valores.length;
}

function cascata(origem, alvoClassif) {
  const dem = document.getElementById('ctaDem'), nv1 = document.getElementById('ctaNv1');
  const nv2 = document.getElementById('ctaNv2'), nv3 = document.getElementById('ctaNv3');
  const unicos = arr => [...new Set(arr)];
  if (alvoClassif) dem.value = demDe(alvoClassif);
  const daDem = ctaClassif.filter(c => dem.value && demDe(c) === dem.value);
  if (origem === 'dem' || alvoClassif) opcoes(nv1, unicos(daDem.map(c => c.nivel1)), alvoClassif?.nivel1);
  const doNv1 = daDem.filter(c => c.nivel1 === nv1.value);
  if (origem !== 'nv2' || alvoClassif) opcoes(nv2, unicos(doNv1.map(c => c.nivel2)), alvoClassif?.nivel2);
  const doNv2 = doNv1.filter(c => c.nivel2 === nv2.value);
  nv3.innerHTML = '<option value="">—</option>' + doNv2.map(c => `<option value="${c.id_classificacao}">${escCad(c.nivel3)}</option>`).join('');
  nv3.value = alvoClassif && doNv2.some(c => c.id_classificacao === alvoClassif.id_classificacao) ? String(alvoClassif.id_classificacao) : '';
  nv3.disabled = !doNv2.length;
}

function abrirConta(id, previa = null) {
  ctaEditando = id === null ? null : ctaContas.find(c => c.id_conta === id) || null;
  const c = ctaEditando || previa || {};
  document.getElementById('ctaTitulo').textContent = ctaEditando ? `Editar · ${ctaEditando.numero_conta}` : 'Nova conta';
  campoCta('numero_conta').value = c.numero_conta || '';
  campoCta('numero_conta').readOnly = !!ctaEditando;
  document.getElementById('ctaAjudaNumero').textContent = ctaEditando ? 'O número não pode ser alterado: os balancetes dependem dele.' : '';
  campoCta('desc_conta').value = c.desc_conta || '';
  campoCta('id_empresa_contraparte').value = c.id_empresa_contraparte ?? '';
  // Classificação atual; se não houver, a sugerida pelas contas de número parecido
  const atual = classifDe(c.id_classificacao);
  const sug = !atual && c.numero_conta ? sugerirClassificacao(c.numero_conta) : null;
  const caixa = document.getElementById('ctaSugestao');
  caixa.hidden = !sug;
  if (sug) caixa.innerHTML = `Sugestão aplicada: <b>${escCad(rotuloClassif(classifDe(sug.id)))}</b> — a classificação de ${sug.qtd} conta(s) que começam com ${escCad(sug.prefixo)}. Confira antes de salvar.`;
  document.getElementById('ctaDem').value = '';
  cascata('dem', atual || (sug ? classifDe(sug.id) : null));
  document.querySelectorAll('#ctaForm .invalido').forEach(el => el.classList.remove('invalido'));
  feedbackCta('');
  document.getElementById('modalConta').classList.add('active');
  if (Permissoes.travar(document.getElementById('ctaForm'), 'plano_contas')) document.getElementById('ctaTitulo').textContent += ' (somente leitura)';
  else setTimeout(() => campoCta(ctaEditando ? 'desc_conta' : 'numero_conta').focus(), 60);
}

function fecharConta() { document.getElementById('modalConta').classList.remove('active'); }

async function salvarConta() {
  const numero = soDigitos(campoCta('numero_conta').value);
  const erro = (el, msg) => { el.classList.add('invalido'); el.focus(); feedbackCta(msg, 'erro'); };
  if (!ctaEditando) {
    if (!numero) return erro(campoCta('numero_conta'), 'Informe o número da conta (só números).');
    if (ctaContas.some(c => c.numero_conta === numero)) return erro(campoCta('numero_conta'), `A conta ${numero} já está cadastrada.`);
  }
  const dem = document.getElementById('ctaDem').value, nv3 = document.getElementById('ctaNv3');
  if (dem && !nv3.value) return erro(nv3.disabled ? document.getElementById('ctaNv1') : nv3, 'Complete a classificação até o nível 3, ou deixe a demonstração vazia.');
  const v = {
    desc_conta: campoCta('desc_conta').value.trim() || null,
    id_classificacao: nv3.value ? Number(nv3.value) : null,
    id_empresa_contraparte: campoCta('id_empresa_contraparte').value ? Number(campoCta('id_empresa_contraparte').value) : null,
  };
  const botao = document.getElementById('ctaSalvar');
  botao.disabled = true;
  feedbackCta('Salvando…');
  const colunas = 'id_conta, numero_conta, desc_conta, id_classificacao, id_empresa_contraparte';
  const resp = ctaEditando
    ? await sbClient.from('balancetes_contas').update(v).eq('id_conta', ctaEditando.id_conta).select(colunas)
    : await sbClient.from('balancetes_contas').insert({ numero_conta: numero, ...v }).select(colunas);
  botao.disabled = false;
  const salva = resp.data && resp.data[0];
  if (resp.error || !salva) {
    const semPermissao = !salva && (!resp.error || /row-level security/i.test(resp.error.message));
    return feedbackCta(semPermissao ? 'O banco não permitiu gravar. Rode supabase/21_plano_de_contas.sql e confira o seu grupo de acesso.'
                                    : 'Não foi possível salvar: ' + resp.error.message, 'erro');
  }
  const i = ctaContas.findIndex(x => x.id_conta === salva.id_conta);
  if (i >= 0) ctaContas[i] = salva; else { ctaContas.push(salva); ctaContas.sort((a, b) => a.numero_conta.localeCompare(b.numero_conta)); }
  ctaFaltantes = ctaFaltantes.filter(f => f.numero !== salva.numero_conta);
  if (document.getElementById('ctaArquivoResultado').dataset.arquivo) desenharFaltantes();
  fecharConta();
  desenharContas();
  desenharPendencias();
  if (ctaEditando) avisoCadastro('Conta atualizada.');
  else await atualizarAposCadastro('Conta incluída.');
}

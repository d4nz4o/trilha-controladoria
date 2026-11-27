// ==========================================
// CONFIGURAÇÕES · Balancetes (supabase/25_gestao_balancetes.sql)
// - Meses carregados (empresa × mês, balancetes_resumo) e saldos do mês escolhido, em reais.
// - Alterar o saldo na própria linha; excluir um saldo ou o mês inteiro de uma empresa (dois cliques).
// - Carregar arquivo (CSV ou Excel): conferido no navegador; a carga vai por empresa e mês, cada uma numa única
//   operação no banco (balancetes_carregar), passando pelas pendências: conta cadastrada → balancetes;
//   conta sem cadastro → pendência em Plano de contas.
// Usa de configuracao.js: escCad, soDigitos, avisoCadastro, cadEmpresas; de contas.js: lerTudo, carregarSheetJS.
// ==========================================

let balResumo = [];          // [{id_empresa, periodo_balancete, linhas, total}]
let balSaldos = [];          // saldos do mês escolhido
let balCarga = null;         // { linhas: [...], grupos: Map, ignoradas: [...] }

const fmtReais = v => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mesRotulo = iso => { const [a, m] = String(iso).split('-'); return `${['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][Number(m) - 1]}/${a.slice(2)}`; };
const nomeEmpresaBal = id => ((typeof cadEmpresas !== 'undefined' ? cadEmpresas : []).find(e => e.id_empresa === Number(id)) || {}).nome_empresa || String(id);

async function iniciarBalancetes() {
  document.getElementById('modalCarga').addEventListener('click', e => { if (e.target.id === 'modalCarga') fecharCarga(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('modalCarga').classList.contains('active')) fecharCarga(); });
  if (Permissoes.podeVer('balancetes')) await carregarResumoBal();
}

async function carregarResumoBal(manter = true) {
  const { data, error } = await sbClient.rpc('balancetes_resumo');
  if (error) {
    const falta = /balancetes_resumo/.test(error.message) ? ' Rode supabase/25_gestao_balancetes.sql no Supabase.' : '';
    document.getElementById('balMatriz').innerHTML = `<p class="cta-pend-texto erro">Não foi possível carregar os meses: ${escCad(error.message)}.${falta}</p>`;
    document.getElementById('balCorpo').innerHTML = '<tr><td colspan="4" class="cad-vazio">—</td></tr>';
    return;
  }
  balResumo = (data || []).map(r => ({ ...r, periodo_balancete: String(r.periodo_balancete).slice(0, 10) }));
  const selEmp = document.getElementById('balEmpresa');
  const atualEmp = manter ? selEmp.value : '';
  const empresas = [...new Set(balResumo.map(r => r.id_empresa))].sort((a, b) => nomeEmpresaBal(a).localeCompare(nomeEmpresaBal(b), 'pt-BR'));
  selEmp.innerHTML = empresas.length ? empresas.map(id => `<option value="${id}">${escCad(nomeEmpresaBal(id))}</option>`).join('') : '<option value="">—</option>';
  if (empresas.map(String).includes(atualEmp)) selEmp.value = atualEmp;
  desenharMatrizBal();
  balEmpresaAlterada(manter);
}

function balEmpresaAlterada(manter = false) {
  const emp = document.getElementById('balEmpresa').value;
  const selMes = document.getElementById('balMes');
  const atual = manter ? selMes.value : '';
  const meses = balResumo.filter(r => String(r.id_empresa) === emp).map(r => r.periodo_balancete).sort().reverse();
  selMes.innerHTML = meses.length ? meses.map(m => `<option value="${m}">${mesRotulo(m)}</option>`).join('') : '<option value="">—</option>';
  if (meses.includes(atual)) selMes.value = atual;
  carregarSaldosBal();
}

// Quadro empresa × mês (últimos 12 meses com saldos)
function desenharMatrizBal() {
  const alvo = document.getElementById('balMatriz');
  if (!balResumo.length) { alvo.innerHTML = '<p class="cta-pend-texto">Nenhum saldo carregado.</p>'; document.getElementById('balMesesInfo').textContent = ''; return; }
  const meses = [...new Set(balResumo.map(r => r.periodo_balancete))].sort().reverse().slice(0, 12).reverse();
  const empresas = [...new Set(balResumo.map(r => r.id_empresa))].sort((a, b) => nomeEmpresaBal(a).localeCompare(nomeEmpresaBal(b), 'pt-BR'));
  const emp = document.getElementById('balEmpresa').value, mes = document.getElementById('balMes').value;
  const celula = (id, m) => {
    const r = balResumo.find(x => x.id_empresa === id && x.periodo_balancete === m);
    if (!r) return '<td class="bal-vazio">—</td>';
    const sel = String(id) === emp && m === mes ? ' bal-sel' : '';
    return `<td><button type="button" class="bal-celula${sel}" title="${escCad(nomeEmpresaBal(id))} · ${mesRotulo(m)}: ${r.linhas} saldo(s)" onclick="escolherMesBal(${id}, '${m}')">${r.linhas}</button></td>`;
  };
  alvo.innerHTML = `<table class="bal-matriz"><thead><tr><th>Empresa</th>${meses.map(m => `<th>${mesRotulo(m)}</th>`).join('')}</tr></thead>
    <tbody>${empresas.map(id => `<tr><th>${escCad(nomeEmpresaBal(id))}</th>${meses.map(m => celula(id, m)).join('')}</tr>`).join('')}</tbody></table>`;
  document.getElementById('balMesesInfo').textContent = `quantidade de saldos por empresa e mês · clique para abrir`;
}

function escolherMesBal(id, mes) {
  document.getElementById('balEmpresa').value = String(id);
  balEmpresaAlterada();
  document.getElementById('balMes').value = mes;
  carregarSaldosBal();
}

async function carregarSaldosBal() {
  const emp = document.getElementById('balEmpresa').value, mes = document.getElementById('balMes').value;
  desenharMatrizBal();
  if (!emp || !mes) { balSaldos = []; desenharSaldosBal(); return; }
  const todos = [];
  for (let ini = 0; ; ini += 1000) {
    const { data, error } = await sbClient.from('balancetes')
      .select('id_balancete, numero_conta, montante_balancete, balancetes_contas(desc_conta)')
      .eq('id_empresa', emp).eq('periodo_balancete', mes).order('numero_conta').range(ini, ini + 999);
    if (error) { document.getElementById('balCorpo').innerHTML = `<tr><td colspan="4" class="cad-vazio">Não foi possível carregar os saldos: ${escCad(error.message)}</td></tr>`; return; }
    todos.push(...data);
    if (data.length < 1000) break;
  }
  balSaldos = todos;
  desenharSaldosBal();
}

function desenharSaldosBal() {
  const busca = document.getElementById('balBusca').value.trim().toLowerCase();
  const podeEditar = Permissoes.podeEditar('balancetes');
  const lista = balSaldos.filter(s => !busca || s.numero_conta.includes(busca) || (s.balancetes_contas?.desc_conta || '').toLowerCase().includes(busca));
  document.getElementById('balCorpo').innerHTML = lista.length ? lista.map(s => `
    <tr data-id="${s.id_balancete}">
      <td><strong>${escCad(s.numero_conta)}</strong></td>
      <td>${escCad(s.balancetes_contas?.desc_conta || '—')}</td>
      <td class="num bal-saldo${Number(s.montante_balancete) < 0 ? ' negativo' : ''}">${podeEditar
        ? `<button type="button" class="bal-valor" title="Clique para alterar" onclick="editarSaldoBal(this, ${s.id_balancete})">${fmtReais(s.montante_balancete)}</button>`
        : fmtReais(s.montante_balancete)}</td>
      <td class="bal-acoes-col">${podeEditar ? `<button type="button" class="bal-lixeira" aria-label="Excluir o saldo da conta ${escCad(s.numero_conta)}" title="Excluir este saldo" onclick="excluirSaldoBal(this, ${s.id_balancete})">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.6 8.5h4.8l.6-8.5"/></svg></button>` : ''}</td>
    </tr>`).join('') : `<tr><td colspan="4" class="cad-vazio">${balSaldos.length ? 'Nenhum saldo encontrado na busca.' : 'Nenhum saldo neste mês.'}</td></tr>`;
  const total = lista.reduce((t, s) => t + Number(s.montante_balancete || 0), 0);
  const emp = document.getElementById('balEmpresa').value, mes = document.getElementById('balMes').value;
  document.getElementById('balRodape').textContent = emp && mes
    ? `${nomeEmpresaBal(emp)} · ${mesRotulo(mes)} · ${lista.length} de ${balSaldos.length} saldo(s) · soma R$ ${fmtReais(total)}` : '';
  document.getElementById('balExcluirMes').disabled = !balSaldos.length;
}

/* ---------- Alterar e excluir ---------- */

// Número digitado em formato brasileiro ou com ponto: "1.234,56", "-1234,5", "1234.56"
function lerValorBR(texto) {
  let t = String(texto ?? '').trim().replace(/\s|R\$/g, '');
  if (/^\(.*\)$/.test(t)) t = '-' + t.slice(1, -1);                 // (1.234,56) = negativo
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return t !== '' && Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function editarSaldoBal(botao, id) {
  const s = balSaldos.find(x => x.id_balancete === id);
  const td = botao.parentElement;
  td.innerHTML = `<input type="text" class="bal-input" inputmode="decimal" value="${fmtReais(s.montante_balancete)}" aria-label="Novo saldo da conta ${escCad(s.numero_conta)}">`;
  const input = td.querySelector('input');
  input.focus(); input.select();
  let feito = false;
  const salvar = async () => {
    if (feito) return; feito = true;
    const valor = lerValorBR(input.value);
    if (valor === null) { avisoCadastro('Valor inválido. Use, por exemplo, 1.234,56.'); desenharSaldosBal(); return; }
    if (valor === Number(s.montante_balancete)) { desenharSaldosBal(); return; }
    const { data, error } = await sbClient.from('balancetes').update({ montante_balancete: valor }).eq('id_balancete', id).select('id_balancete');
    if (error || !data || !data.length) { avisoCadastro('O banco não permitiu alterar o saldo' + (error ? ': ' + error.message : '.')); desenharSaldosBal(); return; }
    s.montante_balancete = valor;
    desenharSaldosBal();
    atualizarResumoLocal();
    avisoCadastro(`Saldo da conta ${s.numero_conta} alterado para R$ ${fmtReais(valor)}.`);
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); salvar(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); feito = true; desenharSaldosBal(); }
  });
  input.addEventListener('blur', salvar);
}

async function excluirSaldoBal(botao, id) {
  if (!botao.dataset.confirmar) {
    botao.dataset.confirmar = '1';
    botao.classList.add('confirmar');
    botao.title = 'Clique de novo para excluir';
    setTimeout(() => { if (botao.isConnected) { delete botao.dataset.confirmar; botao.classList.remove('confirmar'); botao.title = 'Excluir este saldo'; } }, 4000);
    return;
  }
  const s = balSaldos.find(x => x.id_balancete === id);
  const { data, error } = await sbClient.from('balancetes').delete().eq('id_balancete', id).select('id_balancete');
  if (error || !data || !data.length) { avisoCadastro('O banco não permitiu excluir' + (error ? ': ' + error.message : '.')); return; }
  balSaldos = balSaldos.filter(x => x.id_balancete !== id);
  desenharSaldosBal();
  atualizarResumoLocal();
  avisoCadastro(`Saldo da conta ${s.numero_conta} excluído.`);
}

async function excluirMesBal(botao) {
  const emp = document.getElementById('balEmpresa').value, mes = document.getElementById('balMes').value;
  if (!emp || !mes) return;
  if (!botao.dataset.confirmar) {
    botao.dataset.confirmar = '1';
    botao.textContent = `Confirmar: excluir ${mesRotulo(mes)} de ${nomeEmpresaBal(emp)}`;
    setTimeout(() => { delete botao.dataset.confirmar; botao.textContent = 'Excluir mês'; }, 5000);
    return;
  }
  delete botao.dataset.confirmar;
  botao.textContent = 'Excluir mês';
  const { data, error } = await sbClient.from('balancetes').delete().eq('id_empresa', emp).eq('periodo_balancete', mes).select('id_balancete');
  if (error) { avisoCadastro('Não foi possível excluir o mês: ' + error.message); return; }
  avisoCadastro(`${(data || []).length} saldo(s) de ${mesRotulo(mes)} da ${nomeEmpresaBal(emp)} excluído(s).`);
  await carregarResumoBal(false);
}

function atualizarResumoLocal() {
  const emp = Number(document.getElementById('balEmpresa').value), mes = document.getElementById('balMes').value;
  const r = balResumo.find(x => x.id_empresa === emp && x.periodo_balancete === mes);
  if (r) { r.linhas = balSaldos.length; r.total = balSaldos.reduce((t, s) => t + Number(s.montante_balancete || 0), 0); }
  desenharMatrizBal();
}

/* ---------- Carga de arquivo ---------- */

function abrirCarga() {
  balCarga = null;
  document.getElementById('cargaArquivo').value = '';
  document.getElementById('cargaResumo').innerHTML = '';
  document.getElementById('cargaConfirmar').disabled = true;
  document.getElementById('cargaConfirmar').textContent = 'Carregar';
  document.getElementById('cargaFeedback').textContent = '';
  document.getElementById('cargaFeedback').className = 'cad-feedback';
  document.getElementById('modalCarga').classList.add('active');
}
function fecharCarga() {
  if (document.getElementById('modalCarga').dataset.carregando === 'sim') return;
  document.getElementById('modalCarga').classList.remove('active');
}

const normalizar = t => String(t ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const COLUNAS_CARGA = {
  id_empresa: ['id_empresa', 'empresa', 'codigo_empresa', 'cod_empresa'],
  numero_conta: ['numero_conta', 'conta', 'n_conta', 'no_conta', 'conta_razao', 'ctarazao', 'conta_contabil'],
  periodo_balancete: ['periodo_balancete', 'periodo', 'mes', 'data', 'competencia'],
  montante_balancete: ['montante_balancete', 'montante', 'saldo', 'valor'],
  desc_conta: ['desc_conta', 'descricao', 'descricao_conta', 'texto', 'denominacao'],
};

// Linhas de um CSV (separador ; , ou tabulação, detectado pelo cabeçalho; aspas simples de campo)
function lerCSV(texto) {
  const linhas = texto.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
  if (!linhas.length) return [];
  const cab = linhas[0];
  const sep = [';', '\t', ','].sort((a, b) => cab.split(b).length - cab.split(a).length)[0];
  const campos = l => { const out = []; let atual = '', aspas = false;
    for (const ch of l) { if (ch === '"') aspas = !aspas; else if (ch === sep && !aspas) { out.push(atual); atual = ''; } else atual += ch; }
    out.push(atual); return out.map(v => v.trim()); };
  return linhas.map(campos);
}

// Mês → último dia ("2026-10-31", "2026-10", "31/10/2026", "10/2026")
function lerMes(t) {
  const s = String(t ?? '').trim();
  let a, m;
  let r = s.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?/); if (r) { a = +r[1]; m = +r[2]; }
  r = r || s.match(/^(?:\d{1,2}\/)?(\d{1,2})\/(\d{4})$/); if (r && !a) { m = +r[1]; a = +r[2]; }
  if (!a || !m || m < 1 || m > 12) return null;
  const d = new Date(a, m, 0);
  return `${a}-${String(m).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function lerArquivoCarga(arquivo) {
  const resumo = document.getElementById('cargaResumo');
  if (!arquivo) return;
  resumo.innerHTML = '<p class="cta-pend-texto">Lendo o arquivo…</p>';
  try {
    let tabela;
    if (/\.(xlsx|xls)$/i.test(arquivo.name)) {
      await carregarSheetJS();
      const wb = XLSX.read(await arquivo.arrayBuffer(), { type: 'array' });
      tabela = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
    } else {
      tabela = lerCSV(await arquivo.text());
    }
    const iCab = tabela.findIndex(l => l.some(v => COLUNAS_CARGA.numero_conta.includes(normalizar(v))));
    if (iCab < 0) throw new Error('não encontrei o cabeçalho (id_empresa; numero_conta; periodo_balancete; montante_balancete).');
    const cab = tabela[iCab].map(normalizar);
    const idx = {};
    for (const [col, nomes] of Object.entries(COLUNAS_CARGA)) idx[col] = cab.findIndex(v => nomes.includes(v));
    const faltam = ['id_empresa', 'numero_conta', 'periodo_balancete', 'montante_balancete'].filter(c => idx[c] < 0);
    if (faltam.length) throw new Error('faltam as colunas: ' + faltam.join(', ') + '.');

    const empresasOk = new Set((typeof cadEmpresas !== 'undefined' ? cadEmpresas : []).map(e => e.id_empresa));
    const linhas = [], ignoradas = [];
    tabela.slice(iCab + 1).forEach((l, i) => {
      if (!l.some(v => String(v).trim())) return;
      const emp = Number(soDigitos(l[idx.id_empresa]));
      const conta = soDigitos(l[idx.numero_conta]);
      const mes = lerMes(l[idx.periodo_balancete]);
      const valor = lerValorBR(l[idx.montante_balancete]);
      const motivo = !emp ? 'empresa vazia' : !empresasOk.has(emp) || !Permissoes.veEmpresa(emp) ? `empresa ${emp} sem acesso ou inexistente`
        : !conta ? 'conta vazia' : !mes ? 'mês inválido' : valor === null ? 'valor inválido' : '';
      if (motivo) { ignoradas.push(`linha ${iCab + i + 2}: ${motivo}`); return; }
      linhas.push({ id_empresa: emp, numero_conta: conta, periodo_balancete: mes, montante_balancete: valor,
                    desc_conta: idx.desc_conta >= 0 ? String(l[idx.desc_conta] || '').trim() || null : null });
    });
    if (!linhas.length) throw new Error('nenhuma linha válida.' + (ignoradas.length ? ' ' + ignoradas.slice(0, 3).join('; ') : ''));

    // Agrupa por empresa e mês (cada grupo é uma operação no banco)
    const grupos = new Map();
    linhas.forEach(l => { const k = `${l.id_empresa}|${l.periodo_balancete}`; (grupos.get(k) || grupos.set(k, []).get(k)).push(l); });
    let contas;
    try { contas = new Set((await lerTudo('balancetes_contas', 'numero_conta', 'numero_conta')).map(c => c.numero_conta)); } catch { contas = null; }
    const semCadastro = contas ? [...new Set(linhas.map(l => l.numero_conta))].filter(n => !contas.has(n)) : [];
    balCarga = { linhas, grupos, ignoradas, nome: arquivo.name };

    const empresas = [...new Set(linhas.map(l => l.id_empresa))].map(nomeEmpresaBal).join(', ');
    const meses = [...new Set(linhas.map(l => l.periodo_balancete))].sort().map(mesRotulo);
    const jaCarregados = [...grupos.keys()].filter(k => { const [e, m] = k.split('|'); return balResumo.some(r => r.id_empresa === Number(e) && r.periodo_balancete === m); }).length;
    resumo.innerHTML = `
      <dl class="carga-resumo">
        <div><dt>Arquivo</dt><dd>${escCad(arquivo.name)}</dd></div>
        <div><dt>Linhas válidas</dt><dd>${linhas.length.toLocaleString('pt-BR')}</dd></div>
        <div><dt>Empresas</dt><dd>${escCad(empresas)}</dd></div>
        <div><dt>Meses</dt><dd>${escCad(meses.length > 6 ? `${meses[0]} a ${meses[meses.length - 1]} (${meses.length})` : meses.join(', '))}</dd></div>
        <div><dt>Já carregados</dt><dd>${jaCarregados ? `${jaCarregados} empresa/mês já têm saldos` : 'nenhum'}</dd></div>
        <div><dt>Contas sem cadastro</dt><dd>${semCadastro.length ? `<b>${semCadastro.length}</b> (ficarão como pendência): ${escCad(semCadastro.slice(0, 5).join(', '))}${semCadastro.length > 5 ? '…' : ''}` : 'nenhuma'}</dd></div>
      </dl>
      ${ignoradas.length ? `<p class="cta-pend-texto erro">${ignoradas.length} linha(s) ignorada(s): ${escCad(ignoradas.slice(0, 4).join('; '))}${ignoradas.length > 4 ? '…' : ''}</p>` : ''}`;
    document.getElementById('cargaConfirmar').disabled = false;
  } catch (erro) {
    balCarga = null;
    resumo.innerHTML = `<p class="cta-pend-texto erro">Não foi possível usar o arquivo: ${escCad(erro.message)}</p>`;
    document.getElementById('cargaConfirmar').disabled = true;
  }
}

async function confirmarCarga() {
  if (!balCarga) return;
  const modal = document.getElementById('modalCarga'), botao = document.getElementById('cargaConfirmar');
  const feedback = document.getElementById('cargaFeedback');
  const substituir = document.getElementById('cargaSubstituir').checked;
  modal.dataset.carregando = 'sim';
  botao.disabled = true;
  const total = { linhas: 0, gravadas: 0, pendentes: 0, apagadas: 0 };
  const grupos = [...balCarga.grupos.entries()];
  for (let i = 0; i < grupos.length; i++) {
    const [chave, linhas] = grupos[i];
    const [emp, mes] = chave.split('|');
    feedback.className = 'cad-feedback';
    feedback.textContent = `Carregando ${nomeEmpresaBal(emp)} · ${mesRotulo(mes)} (${i + 1} de ${grupos.length})…`;
    const { data, error } = await sbClient.rpc('balancetes_carregar', { p_linhas: linhas, p_substituir: substituir });
    if (error) {
      modal.dataset.carregando = '';
      feedback.className = 'cad-feedback erro';
      feedback.textContent = `Parou em ${nomeEmpresaBal(emp)} · ${mesRotulo(mes)}: ${error.message}` + (i ? ` (${i} grupo(s) anterior(es) já carregado(s))` : ' (nada foi carregado)');
      botao.disabled = false;
      await carregarResumoBal();
      return;
    }
    for (const k of Object.keys(total)) total[k] += data[k] || 0;
  }
  modal.dataset.carregando = '';
  modal.classList.remove('active');
  avisoCadastro(`Carga concluída: ${total.gravadas.toLocaleString('pt-BR')} saldo(s) nos balancetes` +
    (total.pendentes ? `, ${total.pendentes} pendente(s) de cadastro de conta` : '') +
    (total.apagadas ? `, ${total.apagadas.toLocaleString('pt-BR')} saldo(s) anterior(es) substituído(s)` : '') + '.');
  const [emp, mes] = grupos[grupos.length - 1][0].split('|');
  await carregarResumoBal();
  escolherMesBal(Number(emp), mes);
  if (typeof carregarPendenciasSaldos === 'function') { await carregarPendenciasSaldos(); desenharPendenciasSaldos(); }
}

// ==========================================
// NOVAS FÉRIAS — popup aberto pelo botão "+ Férias" da barra superior
// Grava em `ferias` (id_colab, data_de, data_ate). Day off = período de um dia (data_de = data_ate).
// Regras:
//   - fim não pode ser anterior ao início;
//   - a mesma pessoa não pode ter dois períodos que se sobrepõem;
//   - se outras pessoas estiverem fora no mesmo período, apenas avisa.
// ==========================================

const novasFerias = { salvando: false, focoAnterior: null };

async function abrirModalNovasFerias() {
  const modal = document.getElementById('modalNovasFerias');
  if (!modal) return;

  novasFerias.focoAnterior = document.activeElement;
  document.getElementById('nfInicio').value = '';
  document.getElementById('nfFim').value = '';
  document.querySelector('input[name="nfTipo"][value="ferias"]').checked = true;
  tipoNovasFeriasAlterado();
  definirFeedbackNovasFerias('');
  marcarInvalido('nfColaborador', false);
  marcarInvalido('nfFim', false);

  preencherColaboradoresNovasFerias(true);
  modal.classList.add('active');
  setTimeout(() => document.getElementById('nfColaborador').focus(), 50);

  // Garante a equipe atualizada (a página já carrega; aqui é só para o caso de ainda não ter chegado)
  if (!listaColaboradores.length) {
    try { await carregarColaboradoresDados(() => preencherColaboradoresNovasFerias(true)); } catch (e) { console.warn(e); }
    preencherColaboradoresNovasFerias(true);
  }
}

function fecharModalNovasFerias(event) {
  if (event && event.target !== event.currentTarget) return;
  if (novasFerias.salvando) return;
  document.getElementById('modalNovasFerias').classList.remove('active');
  if (novasFerias.focoAnterior && novasFerias.focoAnterior.focus) novasFerias.focoAnterior.focus();
}

function preencherColaboradoresNovasFerias(selecionarUsuario) {
  const select = document.getElementById('nfColaborador');
  const equipe = listaColaboradores || [];
  if (!equipe.length) {
    select.innerHTML = '<option value="">Nenhum colaborador encontrado</option>';
    return;
  }
  const anterior = select.value;
  select.innerHTML = '<option value="">Selecione…</option>' +
    equipe.map(c => `<option value="${c.id_colab}">${escFerias(c.nome_colab || 'Sem nome')}</option>`).join('');

  const eu = selecionarUsuario ? identificarColaboradorLogado() : null;
  if (anterior && equipe.some(c => String(c.id_colab) === anterior)) select.value = anterior;
  else if (eu) select.value = String(eu.id_colab);
  atualizarResumoNovasFerias();
}

/* ---------- Tipo e datas ---------- */

function tipoAtualNovasFerias() {
  return document.querySelector('input[name="nfTipo"]:checked').value;
}

function tipoNovasFeriasAlterado() {
  const dayoff = tipoAtualNovasFerias() === 'dayoff';
  document.getElementById('nfCampoFim').hidden = dayoff;
  document.querySelector('label[for="nfInicio"]').firstChild.textContent = dayoff ? 'Data ' : 'Início ';
  if (dayoff) document.getElementById('nfFim').value = document.getElementById('nfInicio').value;
  atualizarResumoNovasFerias();
}

function dataNovasFeriasAlterada(qual) {
  const inicio = document.getElementById('nfInicio');
  const fim = document.getElementById('nfFim');
  if (tipoAtualNovasFerias() === 'dayoff') fim.value = inicio.value;
  // Ao escolher o início, sugere o fim no mesmo dia se ainda estiver vazio ou antes do início
  else if (qual === 'inicio' && inicio.value && (!fim.value || fim.value < inicio.value)) fim.value = inicio.value;
  marcarInvalido('nfFim', false);
  definirFeedbackNovasFerias('');
  atualizarResumoNovasFerias();
}

function periodoNovasFerias() {
  const de = document.getElementById('nfInicio').value;
  const ate = tipoAtualNovasFerias() === 'dayoff' ? de : document.getElementById('nfFim').value;
  return { de, ate };
}

/* ---------- Resumo: duração e sobreposições ---------- */

function paraData(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(a, m - 1, d);
}

function formatarBR(iso) {
  return iso ? iso.split('-').reverse().join('/') : '';
}

function contarDias(de, ate) {
  let corridos = 0, uteis = 0;
  for (let d = paraData(de); d <= paraData(ate); d.setDate(d.getDate() + 1)) {
    corridos++;
    if (d.getDay() !== 0 && d.getDay() !== 6) uteis++;
  }
  return { corridos, uteis };
}

const seSobrepoe = (f, de, ate) => f.data_de <= ate && f.data_ate >= de;

function atualizarResumoNovasFerias() {
  const resumo = document.getElementById('nfResumo');
  const { de, ate } = periodoNovasFerias();
  if (!de || !ate || ate < de) { resumo.innerHTML = ''; return; }

  const { corridos, uteis } = contarDias(de, ate);
  const idColab = document.getElementById('nfColaborador').value;
  const partes = [`<div class="nf-duracao"><strong>${corridos}</strong> dia${corridos > 1 ? 's' : ''} corrido${corridos > 1 ? 's' : ''} · <strong>${uteis}</strong> ${uteis === 1 ? 'útil' : 'úteis'} <span>(sem considerar feriados)</span></div>`];

  const conflitos = (listaFerias || []).filter(f => seSobrepoe(f, de, ate));
  const proprio = conflitos.filter(f => String(f.id_colab) === idColab);
  const outros = conflitos.filter(f => String(f.id_colab) !== idColab);

  if (proprio.length) {
    partes.push(`<div class="nf-alerta nf-alerta-erro">Já existe um período registrado para esta pessoa: ${proprio.map(f => `${formatarBR(f.data_de)} a ${formatarBR(f.data_ate)}`).join('; ')}.</div>`);
  }
  if (outros.length) {
    const nomes = outros.map(f => {
      const c = listaColaboradores.find(x => x.id_colab === f.id_colab);
      return `${escFerias(c ? c.nome_colab : 'Colaborador')} (${formatarBR(f.data_de)} a ${formatarBR(f.data_ate)})`;
    });
    partes.push(`<div class="nf-alerta">Também ${nomes.length > 1 ? 'estarão' : 'estará'} fora no período: ${nomes.join('; ')}.</div>`);
  }
  resumo.innerHTML = partes.join('');
}

/* ---------- Gravação ---------- */

function definirFeedbackNovasFerias(texto, tipo) {
  const el = document.getElementById('nfFeedback');
  el.textContent = texto;
  el.className = 'popup-feedback' + (tipo ? ' popup-feedback-' + tipo : '');
}

function marcarInvalido(id, invalido) {
  document.getElementById(id).classList.toggle('popup-invalido', invalido);
}

async function salvarNovasFerias(event) {
  if (event) event.preventDefault();
  if (novasFerias.salvando) return;

  const idColabTexto = document.getElementById('nfColaborador').value;
  const { de, ate } = periodoNovasFerias();

  if (!idColabTexto) {
    marcarInvalido('nfColaborador', true);
    definirFeedbackNovasFerias('Selecione o(a) colaborador(a).', 'erro');
    document.getElementById('nfColaborador').focus();
    return;
  }
  marcarInvalido('nfColaborador', false);
  if (!de || !ate) {
    definirFeedbackNovasFerias(tipoAtualNovasFerias() === 'dayoff' ? 'Informe a data do day off.' : 'Informe o início e o fim do período.', 'erro');
    return;
  }
  if (ate < de) {
    marcarInvalido('nfFim', true);
    definirFeedbackNovasFerias('O fim não pode ser anterior ao início.', 'erro');
    return;
  }
  if ((listaFerias || []).some(f => String(f.id_colab) === idColabTexto && seSobrepoe(f, de, ate))) {
    definirFeedbackNovasFerias('Este período se sobrepõe a outro já registrado para a mesma pessoa.', 'erro');
    return;
  }
  if (typeof sbClient === 'undefined' || !sbClient) {
    definirFeedbackNovasFerias('Sem conexão com o Supabase. Atualize a página.', 'erro');
    return;
  }

  const colab = listaColaboradores.find(c => String(c.id_colab) === idColabTexto);
  const botao = document.getElementById('nfSalvar');
  novasFerias.salvando = true;
  botao.disabled = true;
  definirFeedbackNovasFerias('Registrando…');

  try {
    const { error } = await sbClient.from('ferias').insert([{ id_colab: colab ? colab.id_colab : Number(idColabTexto), data_de: de, data_ate: ate }]);
    if (error) throw new Error(error.message);

    // Mostra o ano do período registrado e recarrega o calendário
    const ano = Number(de.slice(0, 4));
    if (ano !== anoFeriasAtual) {
      anoFeriasAtual = ano;
      const el = document.getElementById('anoFeriasAtual');
      if (el) el.innerText = ano;
    }
    Cache.limpar('ferias');
    await carregarFerias();

    novasFerias.salvando = false;
    botao.disabled = false;
    fecharModalNovasFerias();
  } catch (err) {
    console.error('Erro ao registrar férias:', err);
    definirFeedbackNovasFerias('Não foi possível registrar: ' + err.message, 'erro');
    novasFerias.salvando = false;
    botao.disabled = false;
  }
}

document.addEventListener('keydown', e => {
  const modal = document.getElementById('modalNovasFerias');
  if (!modal || !modal.classList.contains('active')) return;
  if (e.key === 'Escape') fecharModalNovasFerias();
});

function escFerias(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

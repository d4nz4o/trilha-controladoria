// FÉRIAS — Lógica do Calendário e Supabase

// Feriados do calendário: data 'aaaa-mm-dd' -> nome (tabela feriados; se não existir, tarefas_feriados)
let feriadosCalendario = new Map();

async function carregarFeriadosCalendario() {
  if (!sbClient) return;
  for (const tabela of ['feriados', 'tarefas_feriados']) {
    const { data, error } = await sbClient.from(tabela).select('data_feriado, nome_feriado');
    if (!error) {
      feriadosCalendario = new Map((data || []).map(f => [String(f.data_feriado).slice(0, 10), f.nome_feriado || 'Feriado']));
      return;
    }
  }
  console.warn('Feriados indisponíveis: o calendário mostra só os fins de semana.');
}

async function carregarFerias() {
  await Promise.all([
    carregarFeriadosCalendario(),
    carregarColaboradoresDados(renderizarFeriasFiltradas),
    swr('ferias', () => sbClient.from('ferias').select('*'), d => { listaFerias = d; renderizarFeriasFiltradas(); })
  ]);
  renderizarFeriasFiltradas();   // com os feriados já carregados
}

function renderizarFeriasFiltradas() {
  renderizarMapaFerias(listaFerias, listaColaboradores);
}

function mudarAnoFerias(delta) {
  anoFeriasAtual += delta;

  const elem = document.getElementById('anoFeriasAtual');
  if (elem) {
    elem.innerText = anoFeriasAtual;
  }

  renderizarFeriasFiltradas();
}

function renderizarMapaFerias(ferias, colaboradores) {
  const containerGrid = document.getElementById('mapaFeriasGrid');
  const containerLegenda = document.getElementById('legendaFerias');
  if (!containerGrid || !containerLegenda) return;

  containerGrid.innerHTML = '';
  containerLegenda.innerHTML = '';

  const colabsComFerias = colaboradores.filter(c => 
    ferias.some(f => f.id_colab === c.id_colab)
  );

  colabsComFerias.forEach(c => {
    const legItem = document.createElement('div');
    legItem.className = 'legenda-item';
    legItem.innerHTML = `
      <span class="legenda-cor" style="background-color: ${corDoAvatar(c.id_colab)};"></span>
      <span>${c.nome_colab}</span>
    `;
    containerLegenda.appendChild(legItem);
  });

  // Tipos de dia (depois das pessoas)
  [['legenda-fim-de-semana', 'Fim de semana'], ['legenda-feriado', 'Feriado']].forEach(([classe, rotulo]) => {
    const legItem = document.createElement('div');
    legItem.className = 'legenda-item legenda-tipo-dia';
    legItem.innerHTML = `<span class="legenda-cor ${classe}"></span><span>${rotulo}</span>`;
    containerLegenda.appendChild(legItem);
  });

  const nomesMeses = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
  ];

  const diasSemana = ["D", "S", "T", "Q", "Q", "S", "S"];

  for (let mes = 0; mes < 12; mes++) {
    const mesCard = document.createElement('div');
    mesCard.className = 'mes-card';

    const mesTitle = document.createElement('h4');
    mesTitle.innerText = nomesMeses[mes];
    mesCard.appendChild(mesTitle);

    const semanaHeader = document.createElement('div');
    semanaHeader.className = 'dias-semana-grid';
    diasSemana.forEach(d => {
      const span = document.createElement('span');
      span.innerText = d;
      semanaHeader.appendChild(span);
    });
    mesCard.appendChild(semanaHeader);

    const gridDias = document.createElement('div');
    gridDias.className = 'dias-grid';

    const primeiroDia = new Date(anoFeriasAtual, mes, 1).getDay();
    const totalDias = new Date(anoFeriasAtual, mes + 1, 0).getDate();

    for (let i = 0; i < primeiroDia; i++) {
      const cellVazia = document.createElement('div');
      cellVazia.className = 'dia-cell vazio';
      gridDias.appendChild(cellVazia);
    }

    for (let dia = 1; dia <= totalDias; dia++) {
      const cellDia = document.createElement('div');
      cellDia.className = 'dia-cell';
      cellDia.innerText = dia;

      const mesFormatado = String(mes + 1).padStart(2, '0');
      const diaFormatado = String(dia).padStart(2, '0');
      const dataStr = `${anoFeriasAtual}-${mesFormatado}-${diaFormatado}`;

      // Fim de semana (cinza mais escuro) e feriado (cinza-chumbo, com o nome ao passar o mouse)
      const diaSemana = new Date(anoFeriasAtual, mes, dia).getDay();
      const feriado = feriadosCalendario.get(dataStr);
      if (feriado) { cellDia.classList.add('feriado'); cellDia.title = feriado; }
      else if (diaSemana === 0 || diaSemana === 6) cellDia.classList.add('fim-de-semana');

      // Todas as pessoas fora neste dia (uma entrada por pessoa), em ordem alfabética para as cores ficarem estáveis
      const registrosDia = registrosDoDia(ferias, colaboradores, dataStr);

      if (registrosDia.length) {
        cellDia.classList.add('com-ferias');
        if (registrosDia.length > 1) cellDia.classList.add('dividido');
        cellDia.style.background = fundoDividido(registrosDia.map(r => corDoAvatar(r.colab.id_colab)));
        const podeRemover = Permissoes.podeEditar('ferias_equipe');
        cellDia.style.cursor = podeRemover ? 'pointer' : 'default';
        cellDia.title = (feriado ? `${feriado} · ` : '') + registrosDia.map(r => r.colab.nome_colab).join(', ') +
          (!podeRemover ? '' : registrosDia.length > 1 ? ' (clique para escolher um período a remover)' : ' (clique para remover)');

        if (podeRemover) cellDia.onclick = () => {
          if (registrosDia.length === 1) {
            const { registro, colab } = registrosDia[0];
            excluirFerias(registro.id_ferias, colab.nome_colab, registro.data_de, registro.data_ate);
          } else {
            abrirEscolhaPeriodoDia(dataStr, registrosDia);
          }
        };
      }

      gridDias.appendChild(cellDia);
    }

    mesCard.appendChild(gridDias);
    containerGrid.appendChild(mesCard);
  }
}

// Registros que cobrem a data, um por colaborador (se houver dados repetidos, vale o primeiro)
function registrosDoDia(ferias, colaboradores, dataStr) {
  const porColab = new Map();
  ferias.forEach(f => {
    if (dataStr < f.data_de || dataStr > f.data_ate || porColab.has(f.id_colab)) return;
    const colab = colaboradores.find(c => c.id_colab === f.id_colab);
    if (colab) porColab.set(f.id_colab, { registro: f, colab });
  });
  return [...porColab.values()].sort((a, b) => (a.colab.nome_colab || '').localeCompare(b.colab.nome_colab || '', 'pt-BR'));
}

// Uma cor: fundo sólido. Várias: faixas verticais de mesma largura (2 = metade/metade, 3 = terços…)
function fundoDividido(cores) {
  if (cores.length === 1) return cores[0];
  const passo = 100 / cores.length;
  const faixas = cores.map((cor, i) => `${cor} ${(i * passo).toFixed(3)}% ${((i + 1) * passo).toFixed(3)}%`);
  return `linear-gradient(to right, ${faixas.join(', ')})`;
}

// Dia com mais de uma pessoa: escolhe qual período remover
function abrirEscolhaPeriodoDia(dataStr, registrosDia) {
  let modal = document.getElementById('modalPeriodosDia');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'modalPeriodosDia';
    modal.onclick = e => { if (e.target === modal) modal.classList.remove('active'); };
    document.body.appendChild(modal);
  }
  const br = iso => iso.split('-').reverse().join('/');
  modal.innerHTML = `
    <div class="modal-card-container periodos-dia" role="dialog" aria-modal="true" aria-labelledby="periodosDiaTitulo">
      <button type="button" class="modal-close-btn" aria-label="Fechar" onclick="document.getElementById('modalPeriodosDia').classList.remove('active')">&times;</button>
      <div class="modal-header">
        <span class="modal-coluna-badge">${br(dataStr)}</span>
        <h2 id="periodosDiaTitulo">${registrosDia.length} pessoas fora neste dia</h2>
      </div>
      <ul class="periodos-lista">
        ${registrosDia.map(({ registro, colab }) => `
          <li>
            <span class="legenda-cor" style="background-color:${corDoAvatar(colab.id_colab)};"></span>
            <span class="periodo-nome">${colab.nome_colab}</span>
            <span class="periodo-datas">${registro.data_de === registro.data_ate ? 'Day off · ' + br(registro.data_de) : br(registro.data_de) + ' a ' + br(registro.data_ate)}</span>
            <button data-editar="ferias_equipe" type="button" class="btn-remover-periodo" data-id="${registro.id_ferias}">Remover</button>
          </li>`).join('')}
      </ul>
    </div>`;
  modal.querySelectorAll('.btn-remover-periodo').forEach(btn => {
    btn.onclick = () => {
      const r = registrosDia.find(x => String(x.registro.id_ferias) === btn.dataset.id);
      modal.classList.remove('active');
      excluirFerias(r.registro.id_ferias, r.colab.nome_colab, r.registro.data_de, r.registro.data_ate);
    };
  });
  modal.classList.add('active');
}

document.addEventListener('keydown', e => {
  const modal = document.getElementById('modalPeriodosDia');
  if (e.key === 'Escape' && modal && modal.classList.contains('active')) modal.classList.remove('active');
});

/* ---------- Remoção de um período (férias ou day off) ---------- */

// Popup de confirmação com o resumo do período; a remoção acontece dentro dele (erros aparecem ali mesmo)
function excluirFerias(idFerias, nomeColab, dataDe, dataAte) {
  if (!Permissoes.podeEditar('ferias_equipe')) return;   // só quem edita férias remove períodos
  const registro = (listaFerias || []).find(f => String(f.id_ferias) === String(idFerias)) || {};
  const dayoff = dataDe === dataAte;
  const dataLonga = iso => {
    const [a, m, d] = iso.split('-').map(Number);
    const data = new Date(a, m - 1, d);
    return `${data.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${a}`;
  };
  const { corridos, uteis } = typeof contarDias === 'function' ? contarDias(dataDe, dataAte) : { corridos: 0, uteis: 0 };
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

  let modal = document.getElementById('modalRemoverFerias');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'modalRemoverFerias';
    modal.addEventListener('click', e => { if (e.target === modal) fecharRemocaoFerias(); });
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="modal-card-container remover-ferias" role="alertdialog" aria-modal="true" aria-labelledby="removerFeriasTitulo" aria-describedby="removerFeriasResumo">
      <button type="button" class="modal-close-btn" aria-label="Fechar" data-fechar>&times;</button>
      <div class="modal-header">
        <span class="modal-coluna-badge badge-remover">Remover período</span>
        <h2 id="removerFeriasTitulo">Remover ${dayoff ? 'o day off' : 'as férias'} de ${escFerias(nomeColab)}?</h2>
      </div>
      <div class="remover-resumo" id="removerFeriasResumo">
        <div class="remover-pessoa">
          <span class="legenda-cor" style="background-color:${corDoAvatar(registro.id_colab)};"></span>
          <strong>${escFerias(nomeColab)}</strong>
          <span class="remover-tipo">${dayoff ? 'Day off' : 'Férias'}</span>
        </div>
        <dl>
          <div><dt>${dayoff ? 'Data' : 'Período'}</dt><dd>${dayoff ? dataLonga(dataDe) : `${dataLonga(dataDe)} <span class="remover-ate">até</span> ${dataLonga(dataAte)}`}</dd></div>
          <div><dt>Duração</dt><dd>${plural(corridos, 'dia corrido', 'dias corridos')} · ${plural(uteis, 'dia útil', 'dias úteis')}</dd></div>
        </dl>
      </div>
      <p class="remover-aviso">O período sai do calendário de toda a equipe. Esta ação não pode ser desfeita.</p>
      <div class="popup-rodape">
        <span class="popup-feedback" id="removerFeriasFeedback" role="status"></span>
        <button type="button" class="btn-secondary" data-fechar>Cancelar</button>
        <button type="button" class="btn-perigo" id="btnConfirmarRemocaoFerias">Remover período</button>
      </div>
    </div>`;

  modal.querySelectorAll('[data-fechar]').forEach(b => b.addEventListener('click', fecharRemocaoFerias));
  modal.querySelector('#btnConfirmarRemocaoFerias').addEventListener('click', () => removerPeriodoFerias(idFerias, dayoff));
  focoAntesDaRemocao = document.activeElement;
  modal.classList.add('active');
  setTimeout(() => modal.querySelector('.btn-secondary').focus(), 50);   // foco em Cancelar, por segurança
}

let focoAntesDaRemocao = null;

function fecharRemocaoFerias() {
  const modal = document.getElementById('modalRemoverFerias');
  if (!modal || modal.dataset.removendo === 'sim') return;
  modal.classList.remove('active');
  if (focoAntesDaRemocao && focoAntesDaRemocao.isConnected) focoAntesDaRemocao.focus();
}

document.addEventListener('keydown', e => {
  const modal = document.getElementById('modalRemoverFerias');
  if (e.key === 'Escape' && modal && modal.classList.contains('active')) fecharRemocaoFerias();
});

async function removerPeriodoFerias(idFerias, dayoff) {
  const modal = document.getElementById('modalRemoverFerias');
  const botao = modal.querySelector('#btnConfirmarRemocaoFerias');
  const feedback = modal.querySelector('#removerFeriasFeedback');
  const erro = texto => {
    feedback.textContent = texto;
    feedback.classList.add('popup-feedback-erro');
    botao.disabled = false;
    botao.textContent = 'Tentar novamente';
    modal.dataset.removendo = '';
  };

  modal.dataset.removendo = 'sim';
  botao.disabled = true;
  botao.textContent = 'Removendo…';
  feedback.textContent = '';
  feedback.classList.remove('popup-feedback-erro');

  if (sbClient) {
    try {
      const { error } = await sbClient.from('ferias').delete().eq('id_ferias', idFerias);
      if (error) {
        console.error('Erro ao excluir férias:', error.message);
        return erro('Não foi possível remover: ' + error.message);
      }
    } catch (err) {
      console.error('Falha de conexão ao excluir férias:', err);
      return erro('Falha de conexão. Verifique a internet e tente novamente.');
    }
  } else {
    listaFerias = listaFerias.filter(f => f.id_ferias !== idFerias);
  }

  modal.dataset.removendo = '';
  fecharRemocaoFerias();
  avisoFerias(dayoff ? 'Day off removido.' : 'Período de férias removido.');
  Cache.limpar('ferias');
  await carregarFerias();
}

// Aviso discreto no canto da tela, que some sozinho
function avisoFerias(texto) {
  let aviso = document.getElementById('avisoFerias');
  if (!aviso) {
    aviso = document.createElement('div');
    aviso.id = 'avisoFerias';
    aviso.className = 'aviso-ferias';
    aviso.setAttribute('role', 'status');
    document.body.appendChild(aviso);
  }
  aviso.textContent = texto;
  aviso.classList.add('visivel');
  clearTimeout(aviso._tempo);
  aviso._tempo = setTimeout(() => aviso.classList.remove('visivel'), 3000);
}

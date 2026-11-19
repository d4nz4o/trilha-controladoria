// FÉRIAS — Lógica do Calendário e Supabase

async function carregarFerias() {
  await Promise.all([
    carregarColaboradoresDados(renderizarFeriasFiltradas),
    swr('ferias', () => sbClient.from('ferias').select('*'), d => { listaFerias = d; renderizarFeriasFiltradas(); })
  ]);
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

      // Todas as pessoas fora neste dia (uma entrada por pessoa), em ordem alfabética para as cores ficarem estáveis
      const registrosDia = registrosDoDia(ferias, colaboradores, dataStr);

      if (registrosDia.length) {
        cellDia.classList.add('com-ferias');
        if (registrosDia.length > 1) cellDia.classList.add('dividido');
        cellDia.style.background = fundoDividido(registrosDia.map(r => corDoAvatar(r.colab.id_colab)));
        cellDia.style.cursor = 'pointer';
        cellDia.title = registrosDia.map(r => r.colab.nome_colab).join(', ') +
          (registrosDia.length > 1 ? ' (clique para escolher um período a remover)' : ' (clique para remover)');

        cellDia.onclick = () => {
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
            <button type="button" class="btn-remover-periodo" data-id="${registro.id_ferias}">Remover</button>
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

async function excluirFerias(idFerias, nomeColab, dataDe, dataAte) {
  const inicio = dataDe.split('-').reverse().join('/');
  const fim = dataAte.split('-').reverse().join('/');

  const confirmou = confirm(
    `Deseja realmente remover o período de férias de ${nomeColab} (${inicio} até ${fim})?`
  );

  if (!confirmou) return;

  if (sbClient) {
    try {
      const { error } = await sbClient
        .from('ferias')
        .delete()
        .eq('id_ferias', idFerias);

      if (error) {
        console.error('Erro ao excluir férias:', error.message);
        alert('Erro ao excluir férias no banco de dados: ' + error.message);
        return;
      }
    } catch (err) {
      console.error('Falha de conexão ao excluir férias:', err);
      alert('Falha de conexão ao excluir férias.');
      return;
    }
  } else {
    listaFerias = listaFerias.filter(f => f.id_ferias !== idFerias);
  }

  alert('Férias removidas com sucesso!');
  Cache.limpar('ferias');
  await carregarFerias();
}

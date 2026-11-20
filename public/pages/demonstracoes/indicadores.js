/*
  INDICADORES — coluna à direita da tabela, só na visão por empresa (BP e DR).
  Mostra o mês selecionado e, abaixo, o mês anterior com a seta da tendência.

  As linhas usadas vêm da hierarquia (Nv1 › Nv2). Se uma linha da hierarquia (tabela classificacoes) for renomeada,
  ajuste os nomes nas constantes abaixo.

  BP: saldos do mês. DR: segue o seletor Mensal (só o mês) / Acumulado (no ano).
  "Receita ajustada" e "EBITDA ajustado" excluem receita e custo de construção (ICPC 01 / OCPC 05),
  que nas concessões entram na receita com margem próxima de zero e distorcem as margens.
*/

/* ---------- Linhas usadas ---------- */

const LINHAS_BP = {
  estoques: ['Ativo circulante', 'Estoques'],
  caixa: ['Ativo circulante', 'Caixa e equivalentes de caixa'],
  tvm: ['Ativo não circulante', 'Títulos e valores imobiliários'],
  // Ativo não circulante que não é "realizável" (fica fora da liquidez geral)
  permanente: ['Investimentos', 'Imobilizado', 'Intangível', 'Direito de uso'],
  // Dívida financeira: debêntures e arrendamentos (circulante e não circulante)
  divida: ['Debêntures', 'Passivo de arrendamento'],
};

// Cada linha é [Nv1, Nv2, Nv3]; Nv2/Nv3 omitidos ou null = qualquer um
const LINHAS_DR = {
  depreciacao: [['Custos', 'Depreciação e amortização'], ['Despesas', 'Depreciação e amortização']],
  receitaConstrucao: [['Receita líquida', 'Receita de construção']],
  custoConstrucao: [['Custos', 'Custos de construção']],
  // Receitas não tarifárias: a linha "Receita acessória" e os Nv3 de aluguel, publicidade e permissão de uso
  receitaAcessoria: [['Outras despesas / receitas', 'Receita acessória'],
                     ['Outras despesas / receitas', null, 'Aluguel'],
                     ['Outras despesas / receitas', null, 'Publicidade'],
                     ['Outras despesas / receitas', null, 'Permissão de uso']],
  pessoal: [['Custos', 'Mão de obra'], ['Despesas', 'Mão de obra']],
  energia: [['Custos', 'Energia']],
};

/* ---------- Cálculo ---------- */

const dividir = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b !== 0) ? a / b : NaN;

/*
  BP. "soma(filtro, mes)" devolve o saldo (sinal de exibição: ativo, passivo e PL positivos) dos itens
  em que filtro(item) é verdadeiro, para a empresa selecionada.
*/
function indicadoresBP(soma, mesAtual, mesAnterior) {
  const calc = mes => {
    if (!mes) return null;
    const nv1 = n => soma(i => i.classificacao_nv1 === n, mes);
    const nv2 = (n1, n2) => soma(i => i.classificacao_nv1 === n1 && i.classificacao_nv2 === n2, mes);
    const AC = nv1('Ativo circulante'), ANC = nv1('Ativo não circulante');
    const PC = nv1('Passivo circulante'), PNC = nv1('Passivo não circulante'), PL = nv1('Patrimônio líquido');
    const estoques = nv2(...LINHAS_BP.estoques), caixa = nv2(...LINHAS_BP.caixa), tvm = nv2(...LINHAS_BP.tvm);
    const permanente = soma(i => i.classificacao_nv1 === 'Ativo não circulante' && LINHAS_BP.permanente.includes(i.classificacao_nv2), mes);
    const divida = soma(i => ['Passivo circulante', 'Passivo não circulante'].includes(i.classificacao_nv1) && LINHAS_BP.divida.includes(i.classificacao_nv2), mes);
    const terceiros = PC + PNC, ativo = AC + ANC;
    return {
      liqCorrente: dividir(AC, PC),
      liqSeca: dividir(AC - estoques, PC),
      liqImediata: dividir(caixa, PC),
      liqGeral: dividir(AC + (ANC - permanente), terceiros),
      endividamento: dividir(terceiros, ativo),
      composicao: dividir(PC, terceiros),
      terceirosPL: PL > 0 ? dividir(terceiros, PL) : NaN,
      imobilizacaoPL: PL > 0 ? dividir(permanente, PL) : NaN,
      ccl: AC - PC,
      caixaTotal: caixa + tvm,
      dividaBruta: divida,
      dividaLiquida: divida - caixa - tvm,
      plNegativo: PL <= 0,
    };
  };
  const a = calc(mesAtual), b = calc(mesAnterior) || {};
  const ind = (nome, chave, formato, melhor, formula) => ({ nome, atual: a[chave], anterior: b[chave], formato, melhor, formula });
  return [
    { titulo: 'Liquidez', itens: [
      ind('Liquidez corrente', 'liqCorrente', 'x', 'maior', 'Ativo circulante ÷ passivo circulante'),
      ind('Liquidez seca', 'liqSeca', 'x', 'maior', '(Ativo circulante − estoques) ÷ passivo circulante'),
      ind('Liquidez imediata', 'liqImediata', 'x', 'maior', 'Caixa e equivalentes ÷ passivo circulante'),
      ind('Liquidez geral', 'liqGeral', 'x', 'maior', '(Ativo circulante + realizável a longo prazo) ÷ (passivo circulante + não circulante). Realizável = ativo não circulante sem investimentos, imobilizado, intangível e direito de uso'),
    ]},
    { titulo: 'Estrutura de capital', itens: [
      ind('Endividamento geral', 'endividamento', '%', 'menor', '(Passivo circulante + não circulante) ÷ ativo total'),
      ind('Composição do endividamento', 'composicao', '%', 'menor', 'Passivo circulante ÷ (passivo circulante + não circulante): quanto da dívida vence em até 12 meses'),
      ind('Capital de terceiros / PL', 'terceirosPL', 'x', 'menor', '(Passivo circulante + não circulante) ÷ patrimônio líquido' + (a.plNegativo ? '. Patrimônio líquido negativo: indicador não se aplica' : '')),
      ind('Imobilização do PL', 'imobilizacaoPL', '%', 'menor', '(Investimentos + imobilizado + intangível + direito de uso) ÷ patrimônio líquido'),
    ]},
    { titulo: 'Caixa e dívida', itens: [
      ind('Capital circulante líquido', 'ccl', 'R$', 'maior', 'Ativo circulante − passivo circulante'),
      ind('Caixa e aplicações', 'caixaTotal', 'R$', 'maior', 'Caixa e equivalentes + títulos e valores mobiliários (não inclui caixa restrito)'),
      ind('Dívida bruta', 'dividaBruta', 'R$', 'menor', 'Debêntures + passivo de arrendamento (circulante e não circulante)'),
      ind('Dívida líquida', 'dividaLiquida', 'R$', 'menor', 'Dívida bruta − caixa e aplicações. Negativa = caixa líquido'),
    ]},
  ];
}

/*
  DR. "bloco(id, mes)" devolve o subtotal da tabela (rl, c, lb, d, rarf, rfin, dfin, rf, ro, ir, rp) e
  "linhas(pares, mes)" a soma de Nv1 › Nv2, ambos já no sinal de exibição (receitas +, custos e despesas −)
  e no modo do seletor (mensal ou acumulado).
*/
function indicadoresDR(bloco, linhas, mesAtual, mesAnterior) {
  const calc = mes => {
    if (!mes) return null;
    const rl = bloco('rl', mes), lb = bloco('lb', mes), ebit = bloco('rarf', mes);
    const dfin = bloco('dfin', mes), ro = bloco('ro', mes), ir = bloco('ir', mes), rp = bloco('rp', mes);
    const da = linhas(LINHAS_DR.depreciacao, mes);                 // negativo
    const recConstr = linhas(LINHAS_DR.receitaConstrucao, mes);    // positivo
    const custoConstr = linhas(LINHAS_DR.custoConstrucao, mes);    // negativo
    const ebitda = ebit - da;
    const ebitdaAj = ebitda - (recConstr + custoConstr);
    const rlAj = rl - recConstr;
    return {
      margemBruta: dividir(lb, rl),
      ebitda,
      margemEbitda: dividir(ebitda, rl),
      margemOperacional: dividir(ebit, rl),
      margemLiquida: dividir(rp, rl),
      ebitdaAj,
      margemEbitdaAj: dividir(ebitdaAj, rlAj),
      margemConstrucao: recConstr ? dividir(recConstr + custoConstr, recConstr) : NaN,
      acessorias: dividir(linhas(LINHAS_DR.receitaAcessoria, mes), rlAj),
      pessoal: dividir(-linhas(LINHAS_DR.pessoal, mes), rlAj),
      energia: dividir(-linhas(LINHAS_DR.energia, mes), rlAj),
      coberturaJuros: dfin < 0 ? dividir(ebitda, -dfin) : NaN,
      aliquota: ro > 0 ? dividir(-ir, ro) : NaN,
    };
  };
  const a = calc(mesAtual), b = calc(mesAnterior) || {};
  const ind = (nome, chave, formato, melhor, formula) => ({ nome, atual: a[chave], anterior: b[chave], formato, melhor, formula });
  return [
    { titulo: 'Rentabilidade', itens: [
      ind('Margem bruta', 'margemBruta', '%', 'maior', 'Lucro bruto ÷ receita líquida'),
      ind('EBITDA', 'ebitda', 'R$', 'maior', 'Resultado antes do resultado financeiro + depreciação e amortização (custos e despesas)'),
      ind('Margem EBITDA', 'margemEbitda', '%', 'maior', 'EBITDA ÷ receita líquida'),
      ind('Margem operacional (EBIT)', 'margemOperacional', '%', 'maior', 'Resultado antes do resultado financeiro ÷ receita líquida'),
      ind('Margem líquida', 'margemLiquida', '%', 'maior', 'Resultado do período ÷ receita líquida'),
    ]},
    { titulo: 'Concessão e operação', itens: [
      ind('EBITDA ajustado', 'ebitdaAj', 'R$', 'maior', 'EBITDA sem receita e custo de construção (ICPC 01): o resultado da operação da concessão'),
      ind('Margem EBITDA ajustada', 'margemEbitdaAj', '%', 'maior', 'EBITDA ajustado ÷ receita ajustada (receita líquida − receita de construção)'),
      ind('Margem de construção', 'margemConstrucao', '%', null, '(Receita de construção + custo de construção) ÷ receita de construção. Em concessões costuma ficar perto de zero'),
      ind('Receitas acessórias / receita', 'acessorias', '%', 'maior', 'Aluguéis, publicidade e permissão de uso ÷ receita ajustada: peso das receitas não tarifárias'),
      ind('Pessoal / receita', 'pessoal', '%', 'menor', 'Mão de obra (custos e despesas) ÷ receita ajustada'),
      ind('Energia / receita', 'energia', '%', 'menor', 'Energia ÷ receita ajustada: principal insumo da operação metroferroviária'),
    ]},
    { titulo: 'Financeiro e tributos', itens: [
      ind('Cobertura de juros', 'coberturaJuros', 'x', 'maior', 'EBITDA ÷ despesas financeiras: quantas vezes o resultado operacional cobre o custo financeiro (aproximação do ICSD)'),
      ind('Alíquota efetiva de IR/CSLL', 'aliquota', '%', null, 'IRPJ e CSLL ÷ resultado antes dos tributos. A alíquota nominal é 34%'),
    ]},
  ];
}

/* ---------- Exibição ---------- */

function formatarIndicador(valor, formato) {
  if (!Number.isFinite(valor)) return '–';
  if (formato === '%') return `${(valor * 100).toFixed(1).replace('.', ',')}%`;
  if (formato === 'x') return valor.toFixed(2).replace('.', ',');
  const abs = Math.abs(valor);
  const [div, suf] = abs >= 1e9 ? [1e9, ' bi'] : abs >= 1e6 ? [1e6, ' mi'] : abs >= 1e3 ? [1e3, ' mil'] : [1, ''];
  return `${(valor / div).toLocaleString('pt-BR', { minimumFractionDigits: div > 1 ? 1 : 0, maximumFractionDigits: div > 1 ? 1 : 0 })}${suf}`;
}

function tendenciaIndicador({ atual, anterior, melhor, formato }) {
  if (!Number.isFinite(atual) || !Number.isFinite(anterior)) return { seta: '', classe: 'neutral' };
  const tolerancia = formato === '%' ? 0.0005 : formato === 'x' ? 0.005 : 0.5;
  const diff = atual - anterior;
  if (Math.abs(diff) < tolerancia) return { seta: '→', classe: 'neutral' };
  const subiu = diff > 0;
  const classe = !melhor ? 'neutral' : (subiu === (melhor === 'maior') ? 'positive' : 'negative');
  return { seta: subiu ? '↑' : '↓', classe };
}

/* Monta a coluna. opcoes = { titulo, subtitulo, mesAnterior (rótulo), grupos, nota } */
function renderizarPainelIndicadores(painel, opcoes) {
  const { titulo, subtitulo, mesAnterior, grupos, nota } = opcoes;
  painel.innerHTML = `
    <header class="ind-cabecalho">
      <h2>${esc(titulo)}</h2>
      <p>${esc(subtitulo)}</p>
    </header>
    ${grupos.map(g => `
      <section class="ind-grupo">
        <h3>${esc(g.titulo)}</h3>
        ${g.itens.map(i => {
          const t = tendenciaIndicador(i);
          return `
          <div class="ind-item" title="${esc(i.formula)}">
            <span class="ind-nome">${esc(i.nome)}</span>
            <span class="ind-valor">${formatarIndicador(i.atual, i.formato)}</span>
            <span class="ind-anterior">${mesAnterior ? `${esc(mesAnterior)}: ${formatarIndicador(i.anterior, i.formato)}` : ''}
              ${t.seta ? `<b class="ind-seta ${t.classe}" aria-hidden="true">${t.seta}</b>` : ''}</span>
          </div>`;
        }).join('')}
      </section>`).join('')}
    <p class="ind-nota">${esc(nota)}</p>`;
  painel.hidden = false;
}

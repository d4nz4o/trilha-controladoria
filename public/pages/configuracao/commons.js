// ==========================================
// CONFIGURAÇÕES — o que é COMUM às páginas (colaboradores, empresas, plano de contas, balancetes, grupos)
// - Barra de abas (montada aqui, a partir de PAGINAS_CONFIG; cada aba aparece só para quem vê o recurso dela)
// - Auxiliares: escCad, soDigitos, avisoCadastro, lerTudo, carregarSheetJS
// - Tabelas que rolam por dentro, com o cabeçalho visível (ajustarAlturaTabelas)
// Cada página define iniciarConfig(); o main.js chama iniciarPagina() depois de conferir a sessão e as permissões.
// ==========================================

// Páginas de Configurações (pasta = página): id, rótulo e recurso exigido
const PAGINAS_CONFIG = [
  { id: 'colaboradores', rotulo: 'Colaboradores',    recurso: 'cad_colaboradores' },
  { id: 'empresas',      rotulo: 'Empresas',         recurso: 'cad_empresas' },
  { id: 'plano-contas',  rotulo: 'Plano de contas',  recurso: 'plano_contas' },
  { id: 'balancetes',    rotulo: 'Balancetes',       recurso: 'balancetes' },
  { id: 'grupos',        rotulo: 'Grupos de acesso', recurso: 'grupos_acesso' },
];

/* ---------- Auxiliares ---------- */

const escCad = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const soDigitos = v => String(v ?? '').replace(/\D/g, '');

// Aviso discreto no rodapé da tela, que some sozinho
function avisoCadastro(texto) {
  let el = document.getElementById('cadAviso');
  if (!el) { el = document.createElement('div'); el.id = 'cadAviso'; el.className = 'cad-aviso'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = texto;
  el.classList.add('visivel');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('visivel'), 2800);
}

// Lê uma tabela inteira, em páginas de 1000 linhas (limite da API)
async function lerTudo(tabela, colunas, ordem) {
  const todas = [];
  for (let ini = 0; ; ini += 1000) {
    const { data, error } = await sbClient.from(tabela).select(colunas).order(ordem).range(ini, ini + 999);
    if (error) throw error;
    todas.push(...data);
    if (data.length < 1000) return todas;
  }
}

// Leitor de planilhas (SheetJS), carregado só quando um arquivo Excel é aberto
const SHEETJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
function carregarSheetJS() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((ok, falha) => {
    const s = document.createElement('script');
    s.src = SHEETJS_URL;
    s.onload = ok;
    s.onerror = () => falha(new Error('Não foi possível carregar o leitor de planilhas. Verifique a conexão.'));
    document.head.appendChild(s);
  });
}

/* ---------- Barra de abas ---------- */

function montarAbasConfig() {
  const nav = document.getElementById('abasConfig');
  if (!nav) return;
  const atual = document.body.dataset.paginaConfig;
  nav.innerHTML = '<a href="../../hub/hub.html">Início</a>' + PAGINAS_CONFIG.map(p => p.id === atual
    ? `<a aria-current="page" data-recurso="${p.recurso}">${p.rotulo}</a>`
    : `<a href="../${p.id}/${p.id}.html" data-recurso="${p.recurso}">${p.rotulo}</a>`).join('');
}

/* ---------- Tabelas rolam por dentro (como no BP e na DR) ----------
   A tabela da página ocupa o espaço que sobra na tela, abaixo dos filtros e painéis, e rola por dentro, com o
   cabeçalho sempre visível. Recalcula ao mudar o tamanho da janela e quando filtros ou painéis mudam de altura. */
function ajustarAlturaTabelas() {
  const area = document.querySelector('.cad-secao .cad-tabela-area');
  if (!area) return;
  const secao = area.closest('.cad-secao');
  const topo = area.getBoundingClientRect().top + window.scrollY;
  const rodape = secao.querySelector('.cad-rodape');
  const minimo = window.innerHeight < 800 ? 220 : 300;   // telas baixas aceitam uma tabela menor
  const altura = Math.max(minimo, window.innerHeight - topo - (rodape ? rodape.offsetHeight : 0) - 34);
  area.style.maxHeight = altura + 'px';
  // Se ainda sobrar rolagem na página, desconta o que sobrou
  const sobra = document.documentElement.scrollHeight - window.innerHeight;
  if (sobra > 0 && altura > minimo) area.style.maxHeight = Math.max(minimo, altura - sobra) + 'px';
}
window.addEventListener('resize', ajustarAlturaTabelas);
document.addEventListener('DOMContentLoaded', () => {
  montarAbasConfig();
  if ('ResizeObserver' in window) {
    const observador = new ResizeObserver(() => ajustarAlturaTabelas());
    document.querySelectorAll('.cad-secao .topbar, .cta-pendencias, .bal-meses').forEach(el => observador.observe(el));
  }
  ajustarAlturaTabelas();
});

/* ---------- Início da página ---------- */

// Chamado pelo main.js depois de conferir a sessão e as permissões; cada página define iniciarConfig()
async function iniciarPagina(user) {
  if (typeof iniciarConfig === 'function') await iniciarConfig(user);
  ajustarAlturaTabelas();
}

// CONEXÃO COM SUPABASE

const SUPABASE_URL = "https://luujxgjjkbppjbefllsg.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_eziJVLtciOqcihK-lLCfnw_ZGK72sFh";

// Domínios de e-mail com acesso ao portal. Manter igual à função usuario_corporativo() (supabase/01_acesso.sql).
const DOMINIOS_CORPORATIVOS = ['triviatrens.com.br', 'tictrens.com.br', 'comporte.com.br', 'metrobh.com.br'];

function emailCorporativo(email) {
  const dominio = String(email || '').toLowerCase().trim().split('@')[1] || '';
  return DOMINIOS_CORPORATIVOS.includes(dominio);
}

// Última conta que entrou no portal (só o e-mail), para sugerir ao Google/Microsoft no próximo login
const CHAVE_ULTIMO_EMAIL = 'portal_ultimo_email';
function lembrarEmailLogin(email) { try { localStorage.setItem(CHAVE_ULTIMO_EMAIL, String(email || '').toLowerCase()); } catch {} }
function ultimoEmailLogin() { try { return localStorage.getItem(CHAVE_ULTIMO_EMAIL) || ''; } catch { return ''; } }

let sbClient = null;
try {
  sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
} catch (err) {
  console.error("Falha ao iniciar o Supabase:", err);
}

/*
  Passo de build da Vercel (vercel.json › buildCommand). Roda só na publicação; o projeto local não muda.

  As rotas curtas (/bp, /hub…) são reescritas pela Vercel para a página real, mas a barra continua mostrando
  a rota curta. Para os caminhos relativos das páginas (../commons.css…) funcionarem a partir dela, cada página
  publicada recebe um <base> fixo com o seu endereço real, logo no início do <head>.
  (Precisa ser fixo no HTML: o navegador começa a baixar os arquivos antes de executar qualquer script.)

  A pasta publicada vem do vercel.json (outputDirectory). Todas as páginas .html dentro dela recebem o <base>,
  exceto as que ficam direto na raiz publicada (como o index.html), que não precisam.
*/
import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

let saida = 'public';
try {
  saida = JSON.parse(readFileSync(join(REPO, 'vercel.json'), 'utf8')).outputDirectory || saida;
} catch { /* sem vercel.json legível: usa "public" */ }
const RAIZ = join(REPO, saida);

function listar(pasta, nivel = 0) {
  if (nivel > 2) return [];
  return readdirSync(pasta).filter(n => !n.startsWith('.') && n !== 'node_modules').flatMap(n => {
    const c = join(pasta, n);
    return statSync(c).isDirectory() ? [`${'  '.repeat(nivel)}${n}/`, ...listar(c, nivel + 1)] : [];
  });
}

if (!existsSync(RAIZ)) {
  console.error(`Pasta publicada "${saida}" (outputDirectory do vercel.json) não existe no repositório.`);
  console.error('Pastas encontradas na raiz do repositório:\n' + listar(REPO).join('\n'));
  process.exit(1);
}

function paginas(pasta) {
  return readdirSync(pasta).flatMap(nome => {
    if (nome.startsWith('.') || nome === 'node_modules') return [];
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) return paginas(caminho);
    return nome.endsWith('.html') ? [caminho] : [];
  });
}

const todas = paginas(RAIZ).filter(arquivo => dirname(arquivo) !== RAIZ);   // index.html da raiz não precisa
if (!todas.length) {
  console.error(`Nenhuma página .html em subpastas de "${saida}". Estrutura encontrada:\n` + listar(RAIZ).join('\n'));
  process.exit(1);
}

let alteradas = 0;
for (const arquivo of todas) {
  const html = readFileSync(arquivo, 'utf8');
  if (/<base\s/i.test(html)) continue;
  const real = '/' + relative(RAIZ, arquivo).split(sep).join('/');
  const novo = html.replace(/(<meta charset="UTF-8">\s*\n)/i, `$1  <base href="${real}">\n`);
  if (novo === html) {
    console.warn(`(aviso) ${real}: <meta charset="UTF-8"> não encontrado; página publicada sem <base>.`);
    continue;
  }
  writeFileSync(arquivo, novo);
  alteradas++;
}
console.log(`Rotas curtas: <base> incluído em ${alteradas} página(s) de "${saida}".`);

/*
  Passo de build da Vercel (vercel.json › buildCommand). Roda só na publicação; o projeto local não muda.

  As rotas curtas (/bp, /hub…) são reescritas pela Vercel para a página real, mas a barra continua mostrando
  a rota curta. Para os caminhos relativos das páginas (../commons.css…) funcionarem a partir dela, cada página
  publicada recebe um <base> fixo com o seu endereço real, logo no início do <head>.
  (Precisa ser fixo no HTML: o navegador começa a baixar os arquivos antes de executar qualquer script.)
*/
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const RAIZ = new URL('../public/', import.meta.url).pathname;

function paginas(pasta) {
  return readdirSync(pasta).flatMap(nome => {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) return paginas(caminho);
    return nome.endsWith('.html') ? [caminho] : [];
  });
}

let alteradas = 0;
for (const arquivo of paginas(join(RAIZ, 'pages'))) {
  const html = readFileSync(arquivo, 'utf8');
  if (html.includes('<base ')) continue;
  const real = '/' + relative(RAIZ, arquivo).split(sep).join('/');
  const novo = html.replace(/(<meta charset="UTF-8">\s*\n)/i, `$1  <base href="${real}">\n`);
  if (novo === html) {
    console.warn(`(aviso) ${real}: <meta charset> não encontrado; página publicada sem <base>.`);
    continue;
  }
  writeFileSync(arquivo, novo);
  alteradas++;
}
console.log(`Rotas curtas: <base> incluído em ${alteradas} página(s).`);

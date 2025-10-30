/**
 * Exporta 100 IDs TMDB de filmes e 100 IDs TMDB de séries (TV)
 * Formato de saída: type;tmdbId;title;year
 */

const fs = require('fs');
const path = require('path');

const TMDB_TOKEN = process.env.TMDB_TOKEN || '';
const TMDB_BASE = process.env.TMDB_BASE || 'https://api.themoviedb.org/3';

if (!TMDB_TOKEN) {
  console.error('Erro: TMDB_TOKEN não encontrado nas variáveis de ambiente.');
  console.error('Defina TMDB_TOKEN no seu .env e tente novamente.');
  process.exit(1);
}

async function fetchPaginated(endpoint, totalNeeded) {
  const items = [];
  let page = 1;
  while (items.length < totalNeeded) {
    const url = `${TMDB_BASE}/${endpoint}?language=pt-BR&page=${page}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${TMDB_TOKEN}`,
        'Content-Type': 'application/json;charset=utf-8'
      }
    });
    if (!res.ok) {
      throw new Error(`Falha ao buscar ${endpoint} página ${page}: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    if (!data.results || data.results.length === 0) break;
    items.push(...data.results);
    page += 1;
    if (page > 20) break; // limite de segurança
  }
  return items.slice(0, totalNeeded);
}

function normalizeMovie(m) {
  const year = (m.release_date || '').slice(0, 4) || '';
  return { type: 'movie', tmdbId: m.id, title: m.title || m.original_title || '', year };
}

function normalizeTv(t) {
  const year = (t.first_air_date || '').slice(0, 4) || '';
  return { type: 'tv', tmdbId: t.id, title: t.name || t.original_name || '', year };
}

async function main() {
  console.log('Buscando 100 filmes populares do TMDB...');
  const moviesRaw = await fetchPaginated('movie/popular', 100);
  const movies = moviesRaw.map(normalizeMovie);

  console.log('Buscando 100 séries populares do TMDB...');
  const tvRaw = await fetchPaginated('tv/popular', 100);
  const tvs = tvRaw.map(normalizeTv);

  const lines = [
    ...movies.map(m => `${m.type};${m.tmdbId};${sanitize(m.title)};${m.year}`),
    ...tvs.map(t => `${t.type};${t.tmdbId};${sanitize(t.title)};${t.year}`),
  ];

  const outPath = path.join(process.cwd(), 'tmdb_ids.txt');
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log(`Arquivo gerado: ${outPath}`);
  console.log(`Total linhas: ${lines.length}`);
}

function sanitize(str) {
  return String(str).replace(/[\r\n;]+/g, ' ').trim();
}

main().catch(err => {
  console.error('Erro ao exportar IDs TMDB:', err);
  process.exit(1);
});
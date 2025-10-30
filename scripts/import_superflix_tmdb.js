// Importa 100 IDs de filmes e 100 IDs de séries a partir do TMDB
// (compatíveis com SuperFlix, que usa TMDB ID nas URLs)
// Atualiza data/movies.json adicionando os itens APENAS para as abas
// "Filmes" e "Séries" (não aparecem na Home porque não definimos "row").

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.TMDB_API_KEY || '8a2d4c3351370eb863b79cc6dda7bb81';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';

async function fetchJson(url){
  const r = await fetch(url);
  if(!r.ok){ throw new Error(`HTTP ${r.status} ao buscar ${url}`); }
  return await r.json();
}

async function collectPopular(kind, total){
  const items = [];
  let page = 1;
  while(items.length < total){
    const url = `https://api.themoviedb.org/3/${kind}/popular?language=pt-BR&page=${page}&api_key=${API_KEY}`;
    const json = await fetchJson(url);
    for(const it of (json.results||[])){
      items.push(it);
      if(items.length >= total) break;
    }
    if(page >= (json.total_pages||page)) break; // segurança
    page++;
  }
  return items;
}

function mapToItem(kind, it){
  const type = (kind === 'tv') ? 'serie' : 'filme';
  const title = kind === 'tv' ? (it.name || it.original_name || '') : (it.title || it.original_title || '');
  const year = (kind === 'tv' ? (it.first_air_date||'') : (it.release_date||'')).slice(0,4);
  const poster = it.poster_path ? `${TMDB_IMG}${it.poster_path}` : '';
  const description = it.overview || '';
  return {
    id: `seed-${type}-${it.id}`,
    type,
    tmdbId: it.id,
    title,
    year,
    genres: [],
    poster,
    trailer: '',
    description,
    category: ''
  };
}

async function main(){
  const root = path.resolve(__dirname, '..');
  const dataFile = path.join(root, 'data', 'movies.json');
  const raw = fs.readFileSync(dataFile, 'utf8');
  const base = JSON.parse(raw);
  const exists = new Set(base.map(m=> `${m.type||'filme'}:${String(m.tmdbId||'')}`));

  console.log('Coletando filmes populares…');
  const popularMovies = await collectPopular('movie', 100);
  console.log('Coletando séries populares…');
  const popularSeries = await collectPopular('tv', 100);

  const mappedMovies = popularMovies.map(it=> mapToItem('movie', it));
  const mappedSeries = popularSeries.map(it=> mapToItem('tv', it));

  const toAppend = [];
  for(const item of [...mappedMovies, ...mappedSeries]){
    const key = `${item.type}:${item.tmdbId}`;
    if(!exists.has(key)){
      toAppend.push(item);
      exists.add(key);
    }
  }

  const next = [...base, ...toAppend];
  fs.writeFileSync(dataFile, JSON.stringify(next, null, 2), 'utf8');
  console.log(`Adicionados ${toAppend.length} itens a data/movies.json`);
}

main().catch(err=>{ console.error(err); process.exit(1); });
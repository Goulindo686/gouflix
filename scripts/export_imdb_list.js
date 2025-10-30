// Gera uma lista grande (100 filmes e 100 séries) com IDs do IMDb e TMDB
// Fonte: TMDB popular + detalhes (append_to_response=external_ids)
// Saída: imdb_list.txt no diretório raiz, formato semicolon-separated

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.TMDB_API_KEY || '8a2d4c3351370eb863b79cc6dda7bb81';

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
    if(page >= (json.total_pages||page)) break;
    page++;
  }
  return items;
}

async function fetchDetails(kind, id){
  const url = `https://api.themoviedb.org/3/${kind}/${id}?language=pt-BR&append_to_response=external_ids&api_key=${API_KEY}`;
  return await fetchJson(url);
}

function normalize(kind, d){
  const type = (kind === 'tv') ? 'serie' : 'filme';
  const tmdbId = d.id;
  const imdbId = d.external_ids && d.external_ids.imdb_id ? d.external_ids.imdb_id : '';
  const title = kind === 'tv' ? (d.name || d.original_name || '') : (d.title || d.original_title || '');
  const year = (kind === 'tv' ? (d.first_air_date||'') : (d.release_date||'')).slice(0,4);
  return { type, tmdbId, imdbId, title, year };
}

async function main(){
  const MOVIE_COUNT = 100;
  const SERIES_COUNT = 100;
  console.log('Coletando populares do TMDB…');
  const popularMovies = await collectPopular('movie', MOVIE_COUNT);
  const popularSeries = await collectPopular('tv', SERIES_COUNT);

  console.log('Buscando detalhes para obter IMDb IDs…');
  const movies = [];
  for(const it of popularMovies){
    try{
      const d = await fetchDetails('movie', it.id);
      const normalized = normalize('movie', d);
      if(normalized.imdbId){ movies.push(normalized); }
    }catch(err){ /* ignora */ }
  }
  const series = [];
  for(const it of popularSeries){
    try{
      const d = await fetchDetails('tv', it.id);
      const normalized = normalize('tv', d);
      if(normalized.imdbId){ series.push(normalized); }
    }catch(err){ /* ignora */ }
  }

  const lines = [];
  lines.push('# Filmes (type;tmdbId;imdbId;title;year)');
  for(const m of movies){ lines.push(`${m.type};${m.tmdbId};${m.imdbId};${m.title};${m.year}`); }
  lines.push('');
  lines.push('# Séries (type;tmdbId;imdbId;title;year)');
  for(const s of series){ lines.push(`${s.type};${s.tmdbId};${s.imdbId};${s.title};${s.year}`); }

  const outFile = path.resolve(__dirname, '..', 'imdb_list.txt');
  fs.writeFileSync(outFile, lines.join('\n'), 'utf8');
  console.log(`Arquivo gerado: ${outFile}`);
  console.log(`Totais: Filmes=${movies.length}, Séries=${series.length}`);
}

main().catch(err=>{ console.error(err); process.exit(1); });
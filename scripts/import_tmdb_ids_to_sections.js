/**
 * Lê IDs do arquivo imdb_list.txt e adiciona itens completos em data/movies.json
 * - Adiciona filmes (type=filme) e séries (type=serie) com título, ano, poster, descrição e gêneros
 * - NÃO altera Home: não define a propriedade "row"
 * - Evita duplicados pelo par (type, tmdbId)
 */

const fs = require('fs');
const path = require('path');

const TMDB_BASE = process.env.TMDB_BASE || 'https://api.themoviedb.org/3';
const TMDB_IMG = process.env.TMDB_IMG || 'https://image.tmdb.org/t/p/w500';
// Usa Bearer se disponível; caso contrário, usa API key pública já presente no projeto
const TMDB_TOKEN = process.env.TMDB_TOKEN || '';
const TMDB_API_KEY = process.env.TMDB_API_KEY || '8a2d4c3351370eb863b79cc6dda7bb81';

function readImdbListFile(){
  const filePath = path.join(process.cwd(), 'imdb_list.txt');
  if(!fs.existsSync(filePath)) throw new Error('imdb_list.txt não encontrado');
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
  const movies = [];
  const series = [];
  for(const line of lines){
    const parts = line.split(';');
    if(parts.length < 2) continue;
    const kind = parts[0].trim();
    const tmdbId = parts[1].trim();
    if(!tmdbId) continue;
    if(kind === 'filme') movies.push(tmdbId);
    if(kind === 'serie') series.push(tmdbId);
  }
  return { movies, series };
}

async function fetchTmdbDetails(kind, id){
  const endpoint = kind === 'serie' ? `tv/${id}` : `movie/${id}`;
  const urlBearer = `${TMDB_BASE}/${endpoint}?language=pt-BR&append_to_response=external_ids`;
  const urlApiKey = `${TMDB_BASE}/${endpoint}?api_key=${TMDB_API_KEY}&language=pt-BR&append_to_response=external_ids`;
  const url = TMDB_TOKEN ? urlBearer : urlApiKey;
  const res = await fetch(url, {
    headers: TMDB_TOKEN ? { Authorization: `Bearer ${TMDB_TOKEN}`, 'Content-Type': 'application/json;charset=utf-8' } : {}
  });
  if(!res.ok){ throw new Error(`TMDB falhou (${res.status}) para ${kind}:${id}`); }
  return res.json();
}

function mapToItem(json, kind){
  if(kind === 'serie'){
    return {
      id: `serie:${json.id}`,
      type: 'serie',
      tmdbId: json.id,
      title: json.name || json.original_name || '',
      year: (json.first_air_date||'').slice(0,4) || '',
      description: json.overview || '',
      poster: json.poster_path ? `${TMDB_IMG}${json.poster_path}` : '',
      genres: Array.isArray(json.genres) ? json.genres.map(g=>g.name).filter(Boolean) : []
    };
  }
  return {
    id: `filme:${json.id}`,
    type: 'filme',
    tmdbId: json.id,
    title: json.title || json.original_title || '',
    year: (json.release_date||'').slice(0,4) || '',
    description: json.overview || '',
    poster: json.poster_path ? `${TMDB_IMG}${json.poster_path}` : '',
    genres: Array.isArray(json.genres) ? json.genres.map(g=>g.name).filter(Boolean) : []
  };
}

function readJson(file){
  if(!fs.existsSync(file)) return [];
  try{ return JSON.parse(fs.readFileSync(file,'utf8')); }catch(_){ return []; }
}

function writeJson(file, data){
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function ensureNoDuplicates(base, items){
  const key = x => `${x.type||'filme'}:${String(x.tmdbId)}`;
  const existing = new Set(base.map(key));
  const merged = base.slice();
  for(const it of items){
    const k = key(it);
    if(!existing.has(k)){
      merged.push(it);
      existing.add(k);
    }
  }
  return merged;
}

async function main(){
  const { movies, series } = readImdbListFile();
  console.log(`Encontrados ${movies.length} filmes e ${series.length} séries em imdb_list.txt`);

  const newItems = [];
  // Buscar detalhes dos filmes
  for(const mid of movies){
    try{
      const j = await fetchTmdbDetails('filme', mid);
      newItems.push(mapToItem(j, 'filme'));
    }catch(err){ console.error('Falha filme', mid, err.message); }
  }
  // Buscar detalhes das séries
  for(const tid of series){
    try{
      const j = await fetchTmdbDetails('serie', tid);
      newItems.push(mapToItem(j, 'serie'));
    }catch(err){ console.error('Falha serie', tid, err.message); }
  }

  // Atualizar ambos data/movies.json (root e gouflix-remote)
  const targets = [
    path.join(process.cwd(), 'data', 'movies.json'),
    path.join(process.cwd(), 'gouflix-remote', 'data', 'movies.json')
  ];
  for(const file of targets){
    const base = readJson(file);
    const merged = ensureNoDuplicates(base, newItems);
    writeJson(file, merged);
    console.log(`Atualizado: ${file} (+${merged.length - base.length} itens novos)`);
  }
  console.log('Importação concluída. Itens adicionados apenas às abas de Filmes/Séries.');
}

main().catch(err=>{ console.error('Erro na importação:', err); process.exit(1); });
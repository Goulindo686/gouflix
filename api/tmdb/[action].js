export default async function handler(req, res) {
  const action = (req.url || '').split('?')[0].replace(/^.*\/api\/tmdb\//,'').toLowerCase();
  if (action === 'details') return handleDetails(req, res);
  if (action === 'list') return handleList(req, res);
  return res.status(404).json({ ok:false, error:'ação TMDB inválida' });
}

async function handleDetails(req, res){
  try {
    const type = (req.query?.type === 'serie') ? 'tv' : 'movie';
    const id = req.query?.id;
    if (!id) {
      return res.status(400).json({ ok: false, error: 'missing id' });
    }
    const base = process.env.TMDB_BASE || 'https://api.themoviedb.org/3';
    const token = process.env.TMDB_TOKEN || '';
    const url = `${base}/${type}/${encodeURIComponent(id)}?language=pt-BR&append_to_response=external_ids`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json;charset=utf-8' } });
    if (!r.ok) {
      return res.status(r.status).json({ ok: false, error: 'tmdb', status: r.status });
    }
    const json = await r.json();
    return res.status(200).json(json);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Erro interno em /api/tmdb/details' });
  }
}

async function handleList(req, res){
  try {
    const type = (req.query?.type === 'serie') ? 'tv' : 'movie';
    const page = req.query?.page || '1';
    const base = process.env.TMDB_BASE || 'https://api.themoviedb.org/3';
    const token = process.env.TMDB_TOKEN || '';
    const url = `${base}/${type}/popular?language=pt-BR&page=${encodeURIComponent(page)}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json;charset=utf-8' } });
    if (!r.ok) {
      return res.status(r.status).json({ ok: false, error: 'tmdb', status: r.status });
    }
    const json = await r.json();
    return res.status(200).json(json);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Erro interno em /api/tmdb/list' });
  }
}
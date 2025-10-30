export default async function handler(req, res) {
  try {
    const base = process.env.TMDB_BASE || 'https://api.themoviedb.org/3';
    const token = process.env.TMDB_TOKEN || '';
    const typeRaw = String(req.query?.type || '').toLowerCase();
    const type = (typeRaw === 'serie' || typeRaw === 'tv') ? 'tv' : 'movie';
    const id = req.query?.id || null;

    if (!token) {
      return res.status(500).json({ ok: false, error: 'TMDB_TOKEN ausente' });
    }

    if (id) {
      const url = `${base}/${type}/${encodeURIComponent(id)}?language=pt-BR&append_to_response=external_ids`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json;charset=utf-8' } });
      if (!r.ok) return res.status(r.status).json({ ok: false, error: 'tmdb', status: r.status });
      const json = await r.json();
      return res.status(200).json(json);
    }

    const page = Math.max(1, parseInt(String(req.query?.page || '1'), 10) || 1);
    const listPath = type === 'tv' ? 'discover/tv' : 'discover/movie';
    const url = `${base}/${listPath}?language=pt-BR&page=${page}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json;charset=utf-8' } });
    if (!r.ok) return res.status(r.status).json({ ok: false, error: 'tmdb', status: r.status });
    const json = await r.json();
    return res.status(200).json(json);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Erro interno em /api/tmdb' });
  }
}
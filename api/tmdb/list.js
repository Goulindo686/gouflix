export default async function handler(req, res) {
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
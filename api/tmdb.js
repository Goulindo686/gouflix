export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname || '';
    const after = pathname.replace(/^\/api\/tmdb/, '') || '';
    const seg = after.split('/').filter(Boolean);

    const base = process.env.TMDB_BASE || 'https://api.themoviedb.org/3';
    const token = process.env.TMDB_TOKEN || '';

    // Determine type (movie/tv)
    const typeParam = (url.searchParams.get('type') === 'serie') ? 'tv' : 'movie';

    if (!seg.length || seg[0] === 'list') {
      const page = url.searchParams.get('page') || '1';
      const endpoint = `${base}/${typeParam}/popular?language=pt-BR&page=${encodeURIComponent(page)}`;
      const r = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json;charset=utf-8' } });
      if (!r.ok) return res.status(r.status).json({ ok: false, error: 'tmdb', status: r.status });
      const json = await r.json();
      return res.status(200).json(json);
    }

    if (seg[0] === 'details') {
      const id = url.searchParams.get('id');
      const type = typeParam;
      if (!id) return res.status(400).json({ ok: false, error: 'missing id' });
      const endpoint = `${base}/${type}/${encodeURIComponent(id)}?language=pt-BR&append_to_response=external_ids`;
      const r = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json;charset=utf-8' } });
      if (!r.ok) return res.status(r.status).json({ ok: false, error: 'tmdb', status: r.status });
      const json = await r.json();
      return res.status(200).json(json);
    }

    // Fallback 404 for unknown subroutes
    return res.status(404).json({ ok: false, error: 'not_found' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Erro interno em /api/tmdb' });
  }
}
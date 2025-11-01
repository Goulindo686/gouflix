export default async function handler(req, res) {
  const method = req.method;

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || null;
  const SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE ||
    null;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ ok: false, error: 'Missing SUPABASE_URL or service role key' });
  }

  const table = 'gouflix_state';
  const base = `${SUPABASE_URL}/rest/v1/${table}`;
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Prefer': 'resolution=merge-duplicates'
  };

  try {
    if (method === 'GET') {
      const sel = await fetch(`${base}?select=data&id=eq.global`, { headers });
      if (!sel.ok) return res.status(sel.status).json({ ok: false, error: `select failed: ${sel.status}` });
      const arr = await sel.json();
      let data = (arr && arr[0] && arr[0].data) || null;
      if (!data) {
        // Bootstrap registro com estrutura mínima
        data = { added: [], removed: [], subscriptions: {}, suggestions: [], config: {} };
        const up = await fetch(`${base}?on_conflict=id`, { method: 'POST', headers, body: JSON.stringify({ id: 'global', data }) });
        if (!up.ok) return res.status(up.status).json({ ok: false, error: `bootstrap failed: ${up.status}` });
      }
      const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
      // Cliente espera um array diretamente
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(suggestions);
    }

    if (method === 'POST') {
      const body = await readBody(req);
      const title = String(body?.title || '').trim();
      const kind = String(body?.kind || 'filme').trim();
      const tmdbId = body?.tmdbId ? String(body.tmdbId).trim() : '';
      const details = String(body?.details || '').trim();
      if (!title) return res.status(400).json({ ok: false, error: 'Título é obrigatório' });

      // Carregar estado atual
      const sel = await fetch(`${base}?select=data&id=eq.global`, { headers });
      if (!sel.ok) return res.status(sel.status).json({ ok: false, error: `select failed: ${sel.status}` });
      const arr = await sel.json();
      const current = (arr && arr[0] && arr[0].data) || { added: [], removed: [], subscriptions: {}, suggestions: [], config: {} };

      const cookies = parseCookies(req.headers?.cookie || '');
      const suggestion = {
        id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        title,
        kind,
        tmdbId,
        details,
        author: cookies.uname || null,
        authorId: cookies.uid || null,
        createdAt: new Date().toISOString(),
      };

      const nextSuggestions = Array.isArray(current.suggestions) ? current.suggestions.slice() : [];
      nextSuggestions.push(suggestion);
      const next = { ...current, suggestions: nextSuggestions };
      const up = await fetch(`${base}?on_conflict=id`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ id: 'global', data: next })
      });
      if (!up.ok) {
        const tx = await up.text();
        return res.status(up.status).json({ ok: false, error: 'upsert failed', details: tx });
      }
      return res.status(200).json({ ok: true, suggestion });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Método não permitido' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Erro interno em /api/suggestions' });
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

function parseCookies(str) {
  const out = {};
  (str || '').split(';').forEach((part) => {
    const [k, v] = part.split('=');
    if (!k) return;
    out[k.trim()] = decodeURIComponent((v || '').trim());
  });
  return out;
}
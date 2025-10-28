export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ENV_PUBLIC_URL = process.env.PUBLIC_URL || process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`;
  const ENV_EXTRA = {
    SUPABASE_URL: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || null,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || null,
    TMDB_BASE: process.env.TMDB_BASE || 'https://api.themoviedb.org/3',
    TMDB_IMG: process.env.TMDB_IMG || 'https://image.tmdb.org/t/p/w500',
    TMDB_TOKEN: process.env.TMDB_TOKEN || null,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL || null,
  };
  const COOKIES = parseCookies(req.headers?.cookie || '');
  const COOKIE_PUBLIC = COOKIES['public_url'] || null;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    // Sem Supabase: permitir leitura de env/cookies e escrita em cookies
    if (req.method === 'GET') {
      // Se solicitado como /api/env via rewrite, retornar apenas os envs esperados
      if (String(req.query?.env || '').length) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json(ENV_EXTRA);
      }
      return res.status(200).json({
        ok: true,
        writable: true,
        publicUrl: COOKIE_PUBLIC || ENV_PUBLIC_URL || null,
        ...ENV_EXTRA,
      });
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      const pub = body?.publicUrl || '';
      const bm = body?.bootstrapMoviesUrl || '';
      const ba = !!body?.bootstrapAuto;
      const cookieBase = `Path=/; HttpOnly; SameSite=Lax; Secure`;
      res.setHeader('Set-Cookie', [
        `public_url=${encodeURIComponent(pub||'')}; Max-Age=${60*60*24*30}; ${cookieBase}`,
        `bootstrap_movies_url=${encodeURIComponent(bm||'')}; Max-Age=${60*60*24*30}; ${cookieBase}`,
        `bootstrap_auto=${ba?1:0}; Max-Age=${60*60*24*30}; ${cookieBase}`,
      ]);
      return res.status(200).json({ ok: true, source: 'cookie' });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Método não permitido' });
  }

  const table = 'app_config';
  const configId = 'global';
  const base = `${SUPABASE_URL}/rest/v1/${table}`;

  const headers = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Accept': 'application/json',
  };

  try {
    if (req.method === 'GET') {
      // Tenta buscar do Supabase; se falhar, retorna env/cookies
      let row = null;
      try {
        const url = `${base}?id=eq.${configId}&select=*`;
        const r = await fetch(url, { headers });
        if (r.ok) {
          const data = await r.json();
          row = Array.isArray(data) && data.length ? data[0] : null;
        }
      } catch (_) {
        // ignorar e cair para env/cookies
      }
      return res.status(200).json({
        ok: true,
        writable: true,
        publicUrl: row?.public_url || COOKIE_PUBLIC || ENV_PUBLIC_URL || null,
        bootstrapMoviesUrl: row?.bootstrap_movies_url || null,
        bootstrapAuto: !!row?.bootstrap_auto,
      });
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      try {
        const payload = {
          id: configId,
          public_url: body?.publicUrl || null,
          bootstrap_movies_url: body?.bootstrapMoviesUrl || null,
          bootstrap_auto: !!body?.bootstrapAuto,
          updated_at: new Date().toISOString(),
        };
        const upsertUrl = `${base}?on_conflict=id`;
        const r = await fetch(upsertUrl, {
          method: 'POST',
          headers: { ...headers, 'Prefer': 'resolution=merge-duplicates' },
          body: JSON.stringify(payload),
        });
        if (r.ok) {
          const saved = await r.json();
          return res.status(200).json({ ok: true, saved });
        }
      } catch (_) {
        // Ignorar erro e cair no fallback de cookies
      }
      // Fallback: salvar em cookies quando DB não estiver acessível ou falhar
      const cookieBase = `Path=/; HttpOnly; SameSite=Lax; Secure`;
      const pub = body?.publicUrl || '';
      const bm = body?.bootstrapMoviesUrl || '';
      const ba = !!body?.bootstrapAuto;
      res.setHeader('Set-Cookie', [
        `public_url=${encodeURIComponent(pub||'')}; Max-Age=${60*60*24*30}; ${cookieBase}`,
        `bootstrap_movies_url=${encodeURIComponent(bm||'')}; Max-Age=${60*60*24*30}; ${cookieBase}`,
        `bootstrap_auto=${ba?1:0}; Max-Age=${60*60*24*30}; ${cookieBase}`,
      ]);
      return res.status(200).json({ ok: true, source: 'cookie' });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Método não permitido' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Erro interno em /api/config' });
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

function parseCookies(str){
  const out = {};
  str.split(';').forEach(part=>{
    const [k,v] = part.split('=');
    if(!k) return;
    out[k.trim()] = decodeURIComponent((v||'').trim());
  });
  return out;
}
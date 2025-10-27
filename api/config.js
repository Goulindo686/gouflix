export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ENV_MP_TOKEN = process.env.MP_ACCESS_TOKEN || process.env.MERCADO_PAGO_ACCESS_TOKEN;
  const ENV_PUBLIC_URL = process.env.PUBLIC_URL || process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`;
  const COOKIES = parseCookies(req.headers?.cookie || '');
  const COOKIE_MP = COOKIES['mp_token'] || null;
  const COOKIE_PUBLIC = COOKIES['public_url'] || null;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    // Sem Supabase: permitir leitura de env/cookies e escrita em cookies
    if (req.method === 'GET') {
      return res.status(200).json({
        ok: true,
        source: COOKIE_MP || COOKIE_PUBLIC ? 'cookie' : 'env',
        writable: true,
        mpToken: (COOKIE_MP || ENV_MP_TOKEN) ? 'set' : null,
        publicUrl: COOKIE_PUBLIC || ENV_PUBLIC_URL || null,
      });
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      const mp = body?.mpToken || '';
      const pub = body?.publicUrl || '';
      const bm = body?.bootstrapMoviesUrl || '';
      const ba = !!body?.bootstrapAuto;
      const cookieBase = `Path=/; HttpOnly; SameSite=Lax; Secure`;
      if (mp) res.setHeader('Set-Cookie', [
        `mp_token=${encodeURIComponent(mp)}; Max-Age=${60*60*24*30}; ${cookieBase}`,
        `public_url=${encodeURIComponent(pub||'')}; Max-Age=${60*60*24*30}; ${cookieBase}`,
        `bootstrap_movies_url=${encodeURIComponent(bm||'')}; Max-Age=${60*60*24*30}; ${cookieBase}`,
        `bootstrap_auto=${ba?1:0}; Max-Age=${60*60*24*30}; ${cookieBase}`,
      ]);
      else res.setHeader('Set-Cookie', [
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
      // Tenta buscar do Supabase; se não houver, retorna env
      const url = `${base}?id=eq.${configId}&select=*`;
      const r = await fetch(url, { headers });
      if (!r.ok) {
        // fallback para env
        return res.status(200).json({
          ok: true,
          source: 'env',
          writable: false,
          mpToken: !!ENV_MP_TOKEN ? 'set' : null,
          publicUrl: ENV_PUBLIC_URL || null,
        });
      }
      const data = await r.json();
      const row = Array.isArray(data) && data.length ? data[0] : null;
      return res.status(200).json({
        ok: true,
        source: row ? 'db' : (ENV_MP_TOKEN || ENV_PUBLIC_URL ? 'env' : 'empty'),
        writable: true,
        mpToken: row?.mp_token ? 'set' : (!!ENV_MP_TOKEN ? 'set' : null),
        publicUrl: row?.public_url || ENV_PUBLIC_URL || null,
        bootstrapMoviesUrl: row?.bootstrap_movies_url || null,
        bootstrapAuto: !!row?.bootstrap_auto,
      });
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      const payload = {
        id: configId,
        mp_token: body?.mpToken || null,
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
      if (!r.ok) {
        const text = await r.text();
        return res.status(r.status || 500).json({ ok: false, error: 'Falha ao salvar configuração', details: text });
      }
      const saved = await r.json();
      return res.status(200).json({ ok: true, saved });
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
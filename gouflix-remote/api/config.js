export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ENV_PUBLIC_URL = process.env.PUBLIC_URL || process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`;
  // Sanitizado: nunca expor segredos ao frontend
  const ENV_EXTRA = {
    TMDB_BASE: process.env.TMDB_BASE || 'https://api.themoviedb.org/3',
    TMDB_IMG: process.env.TMDB_IMG || 'https://image.tmdb.org/t/p/w500',
    NEXTAUTH_URL: process.env.NEXTAUTH_URL || null,
    CONFIG_API_BASE_URL: process.env.CONFIG_API_BASE_URL || null,
  };
  const COOKIES = parseCookies(req.headers?.cookie || '');
  const COOKIE_PUBLIC = COOKIES['public_url'] || null;
  const COOKIE_DISCORD = COOKIES['discord_invite_url'] || null;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    // Sem Supabase: permitir leitura de env/cookies e escrita em cookies
    if (req.method === 'GET') {
      // Se solicitado como /api/env via rewrite, retornar apenas envs não sensíveis
      if (String(req.query?.env || '').length) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json(ENV_EXTRA);
      }
      return res.status(200).json({
        ok: true,
        writable: true,
        publicUrl: COOKIE_PUBLIC || ENV_PUBLIC_URL || null,
        discordInviteUrl: COOKIE_DISCORD || null,
        ...ENV_EXTRA,
      });
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      const pub = body?.publicUrl || '';
      const di = body?.discordInviteUrl || '';
      const cookieBase = `Path=/; HttpOnly; SameSite=Lax; Secure`;
      res.setHeader('Set-Cookie', [
        `public_url=${encodeURIComponent(pub||'')}; Max-Age=${60*60*24*30}; ${cookieBase}`,
        `discord_invite_url=${encodeURIComponent(di||'')}; Max-Age=${60*60*24*30}; ${cookieBase}`,
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
      const isAdmin = await ensureIsAdmin(req, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const hasSunizeSecret = !!(
        row?.sunize_api_secret || process.env.SUNIZE_API_SECRET ||
        (row?.sunize_client_key && row?.sunize_client_secret) ||
        (process.env.SUNIZE_CLIENT_KEY && process.env.SUNIZE_CLIENT_SECRET)
      );
      return res.status(200).json({
        ok: true,
        writable: !!isAdmin,
        publicUrl: row?.public_url || COOKIE_PUBLIC || ENV_PUBLIC_URL || null,
        hasSunizeSecret,
        discordInviteUrl: row?.discord_invite_url || COOKIE_DISCORD || null,
        ...ENV_EXTRA,
      });
    }

    if (req.method === 'POST') {
      const isAdmin = await ensureIsAdmin(req, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      if (!isAdmin) {
        return res.status(403).json({ ok: false, error: 'Acesso negado' });
      }
      const body = await readBody(req);
      try {
        const payload = {
          id: configId,
          public_url: body?.publicUrl || null,
          sunize_api_secret: body?.sunizeApiSecret || null,
          sunize_client_key: body?.sunizeClientKey || null,
          sunize_client_secret: body?.sunizeClientSecret || null,
          discord_invite_url: body?.discordInviteUrl || null,
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
      const di = body?.discordInviteUrl || '';
      res.setHeader('Set-Cookie', [
        `public_url=${encodeURIComponent(pub||'')}; Max-Age=${60*60*24*30}; ${cookieBase}`,
        `discord_invite_url=${encodeURIComponent(di||'')}; Max-Age=${60*60*24*30}; ${cookieBase}`,
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

async function ensureIsAdmin(req, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY){
  try{
    const ids = String(process.env.ADMIN_IDS||'').split(',').map(s=>s.trim()).filter(Boolean);
    const names = String(process.env.ADMIN_USERNAMES||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
    if(ids.length === 0) return false;
    const cookies = parseCookies(req.headers?.cookie||'');
    const uid = cookies['uid'] || null;
    const uname = (cookies['uname']||'').toLowerCase();
    if((uid && ids.includes(String(uid))) || (uname && names.includes(uname))) return true;
    const sid = cookies['sid'] || null;
    if(!sid || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return false;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/sessions?id=eq.${encodeURIComponent(sid)}&select=user_id,username,expires_at`, {
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Accept: 'application/json' }
    });
    if(!r.ok) return false;
    const data = await r.json();
    const row = Array.isArray(data) && data.length ? data[0] : null;
    if(!row) return false;
    const exp = row.expires_at ? (new Date(row.expires_at)).getTime() : Date.now();
    if(exp < Date.now()) return false;
    return ids.includes(String(row.user_id)) || (row.username && names.includes(String(row.username).toLowerCase()));
  }catch(_){ return false; }
}
function readCookie(req, name){
  const cookie = req.headers.cookie || '';
  const parts = cookie.split(';').map(s=>s.trim());
  for(const p of parts){
    if(p.startsWith(name+'=')) return decodeURIComponent(p.slice(name.length+1));
  }
  return null;
}

async function upsertSession(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, session){
  const url = `${SUPABASE_URL}/rest/v1/sessions?on_conflict=id`;
  const headers = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Prefer': 'resolution=merge-duplicates'
  };
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(session) });
  return r.ok;
}

async function upsertUser(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, user){
  const url = `${SUPABASE_URL}/rest/v1/users?on_conflict=id`;
  const headers = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Prefer': 'resolution=merge-duplicates'
  };
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(user) });
  return r.ok;
}

export default async function handler(req, res){
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
  const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
  const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || (process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/api/auth/discord/callback` : `https://${req.headers.host}/api/auth/discord/callback`);

  if(!CLIENT_ID || !CLIENT_SECRET){
    return res.status(500).json({ ok:false, error:'DISCORD_CLIENT_ID/DISCORD_CLIENT_SECRET não configurados' });
  }

  try{
    const u = new URL(req.url, `http://${req.headers.host}`);
    const code = u.searchParams.get('code');
    const state = u.searchParams.get('state');
    const cookieState = readCookie(req, 'd_state');
    const returnTo = readCookie(req, 'd_return') || '/';
    if(!code){ return res.status(400).json({ ok:false, error:'code ausente' }); }
    if(!state || !cookieState || state !== cookieState){ return res.status(400).json({ ok:false, error:'state inválido' }); }

    // Trocar code por token
    const form = new URLSearchParams();
    form.set('client_id', CLIENT_ID);
    form.set('client_secret', CLIENT_SECRET);
    form.set('grant_type', 'authorization_code');
    form.set('code', code);
    form.set('redirect_uri', REDIRECT_URI);
    form.set('scope', 'identify email');
    const tokenResp = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if(!tokenResp.ok){ const t = await tokenResp.text(); return res.status(tokenResp.status||500).json({ ok:false, error:'Falha ao obter token', details:t }); }
    const tokenJson = await tokenResp.json();
    const accessToken = tokenJson.access_token;

    // Buscar usuário
    const userResp = await fetch('https://discord.com/api/users/@me', {
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' }
    });
    if(!userResp.ok){ const t = await userResp.text(); return res.status(userResp.status||500).json({ ok:false, error:'Falha ao obter usuário', details:t }); }
    const user = await userResp.json();

    // Criar sessão
    const sid = 's_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const expiresAt = new Date(Date.now() + 30*24*60*60*1000).toISOString();
    const session = { id: sid, user_id: String(user.id), username: user.username, avatar: user.avatar || null, email: user.email || null, created_at: new Date().toISOString(), expires_at: expiresAt };
    if(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY){
      await upsertUser(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { id: String(user.id), username: user.username, avatar: user.avatar||null, email: user.email||null, updated_at: new Date().toISOString() });
      await upsertSession(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, session);
    }

    // Setar cookie de sessão e limpar cookies temporários
    res.setHeader('Set-Cookie', [
      `sid=${sid}; HttpOnly; Path=/; SameSite=Lax`,
      `d_state=; Max-Age=0; Path=/; SameSite=Lax`,
      `d_return=; Max-Age=0; Path=/; SameSite=Lax`
    ]);

    res.statusCode = 302;
    res.setHeader('Location', returnTo);
    res.end();
  }catch(err){
    res.status(500).json({ ok:false, error: err?.message || 'Erro em /api/auth/discord/callback' });
  }
}
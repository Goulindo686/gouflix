function readCookie(req, name){
  const cookie = req.headers.cookie || '';
  const parts = cookie.split(';').map(s=>s.trim());
  for(const p of parts){ if(p.startsWith(name+'=')) return decodeURIComponent(p.slice(name.length+1)); }
  return null;
}

function randomState(){
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
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
  const step = (req.url || '').split('?')[0].replace(/^.*\/api\/auth\/discord\//,'').toLowerCase();
  if(step === 'start') return handleStart(req, res);
  if(step === 'callback') return handleCallback(req, res);
  return res.status(404).json({ ok:false, error:'passo Discord inválido' });
}

async function handleStart(req, res){
  try{
    const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
    const currentHost = req.headers.host;
    const defaultRedirect = `https://${currentHost}/api/auth/discord/callback`;
    const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || defaultRedirect;
    const scope = encodeURIComponent('identify email');
    const returnTo = (new URL(req.url, `http://${req.headers.host}`)).searchParams.get('returnTo') || '/';

    if(!CLIENT_ID){
      return res.status(500).json({ ok:false, error:'DISCORD_CLIENT_ID não configurado' });
    }

    const state = randomState();
    const isHttps = String(req.headers['x-forwarded-proto']||'').includes('https') || String(currentHost||'').startsWith('localhost') === false;
    const cookieFlags = `HttpOnly; Path=/; SameSite=Lax${isHttps ? '; Secure' : ''}`;
    res.setHeader('Set-Cookie', [
      `d_state=${state}; ${cookieFlags}` ,
      `d_return=${encodeURIComponent(returnTo)}; ${cookieFlags}`
    ]);

    const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(CLIENT_ID)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${scope}&state=${encodeURIComponent(state)}`;
    res.statusCode = 302;
    res.setHeader('Location', authUrl);
    res.end();
  }catch(err){
    res.status(500).json({ ok:false, error: err?.message || 'Erro em /api/auth/discord/start' });
  }
}

async function handleCallback(req, res){
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
  const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
  const currentHost = req.headers.host;
  const defaultRedirect = `https://${currentHost}/api/auth/discord/callback`;
  const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || defaultRedirect;

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

    const userResp = await fetch('https://discord.com/api/users/@me', {
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' }
    });
    if(!userResp.ok){ const t = await userResp.text(); return res.status(userResp.status||500).json({ ok:false, error:'Falha ao obter usuário', details:t }); }
    const user = await userResp.json();

    const sid = 's_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const expiresAt = new Date(Date.now() + 30*24*60*60*1000).toISOString();
    const session = { id: sid, user_id: String(user.id), username: user.username, avatar: user.avatar || null, email: user.email || null, created_at: new Date().toISOString(), expires_at: expiresAt };
    if(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY){
      await upsertUser(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { id: String(user.id), username: user.username, avatar: user.avatar||null, email: user.email||null, updated_at: new Date().toISOString() });
      await upsertSession(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, session);
    }

    const maxAge = 30 * 24 * 60 * 60;
    const isHttps = String(req.headers['x-forwarded-proto']||'').includes('https') || String(currentHost||'').startsWith('localhost') === false;
    const cookieFlags = `HttpOnly; Path=/; SameSite=Lax${isHttps ? '; Secure' : ''}`;
    res.setHeader('Set-Cookie', [
      `sid=${sid}; ${cookieFlags}; Max-Age=${maxAge}`,
      `uid=${encodeURIComponent(String(user.id))}; ${cookieFlags}; Max-Age=${maxAge}`,
      `uname=${encodeURIComponent(user.username||'')}; ${cookieFlags}; Max-Age=${maxAge}`,
      `uavatar=${encodeURIComponent(user.avatar||'')}; ${cookieFlags}; Max-Age=${maxAge}`,
      `uemail=${encodeURIComponent(user.email||'')}; ${cookieFlags}; Max-Age=${maxAge}`,
      `uexp=${encodeURIComponent(expiresAt)}; ${cookieFlags}; Max-Age=${maxAge}`,
      `d_state=; Max-Age=0; Path=/; SameSite=Lax${isHttps ? '; Secure' : ''}`,
      `d_return=; Max-Age=0; Path=/; SameSite=Lax${isHttps ? '; Secure' : ''}`
    ]);

    res.statusCode = 302;
    res.setHeader('Location', returnTo);
    res.end();
  }catch(err){
    res.status(500).json({ ok:false, error: err?.message || 'Erro em /api/auth/discord/callback' });
  }
}
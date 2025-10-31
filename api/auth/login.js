async function readBody(req){
  return new Promise((resolve)=>{
    let data='';
    req.on('data',chunk=>{ data+=chunk; });
    req.on('end',()=>{
      try{ resolve(JSON.parse(data||'{}')); }
      catch(_){ resolve({}); }
    });
  });
}

function mkStableIdFromEmail(email){
  const e = String(email||'').trim().toLowerCase();
  return e ? `email:${e}` : '';
}

function newSessionId(){
  return 's_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function cookieFlags(req){
  const currentHost = req.headers.host||'';
  const isHttps = String(req.headers['x-forwarded-proto']||'').includes('https') || !String(currentHost||'').startsWith('localhost');
  return `HttpOnly; Path=/; SameSite=Lax${isHttps ? '; Secure' : ''}`;
}

import crypto from 'crypto';
function verifyPassword(password, salt, hash){
  try{
    const derived = crypto.pbkdf2Sync(String(password||''), String(salt||''), 100000, 32, 'sha256').toString('hex');
    return derived === String(hash||'');
  }catch(_){ return false; }
}

export default async function handler(req, res){
  if(req.method !== 'POST'){ res.status(405).json({ ok:false, error:'Método não permitido' }); return; }
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  try{
    const body = await readBody(req);
    const email = String(body?.email||'').trim().toLowerCase();
    const password = String(body?.password||'');
    if(!email || !password){ res.status(400).json({ ok:false, error:'Email/senha inválidos' }); return; }

    let fullName = String(body?.fullName||'').trim();
    let okAuth = true;
    if(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY){
      // Buscar no Supabase
      const r = await fetch(`${SUPABASE_URL}/rest/v1/local_auth_users?email=eq.${encodeURIComponent(email)}&select=password_salt,password_hash,id`,{
        headers:{ apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Accept:'application/json' }
      });
      if(!r.ok){ const tx = await r.text(); res.status(r.status).json({ ok:false, error:'Falha ao consultar usuário', details: tx }); return; }
      const rows = await r.json();
      const row = Array.isArray(rows) && rows.length ? rows[0] : null;
      if(!row){ okAuth = false; }
      else{ okAuth = verifyPassword(password, row.password_salt, row.password_hash); }
      // Buscar nome
      if(okAuth){
        const r2 = await fetch(`${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=username`,{
          headers:{ apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Accept:'application/json' }
        });
        if(r2.ok){ const rows2 = await r2.json(); const row2 = Array.isArray(rows2)&&rows2.length?rows2[0]:null; fullName = row2?.username || fullName || email; }
      }
    }

    if(!okAuth){ res.status(401).json({ ok:false, error:'Credenciais inválidas' }); return; }

    const uid = mkStableIdFromEmail(email);
    const sid = newSessionId();
    const expiresAt = new Date(Date.now() + 30*24*60*60*1000).toISOString();

    // Registrar sessão no Supabase se disponível
    if(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY){
      const payload = { id: sid, user_id: uid, username: fullName || email, avatar: null, email, created_at: new Date().toISOString(), expires_at: expiresAt };
      try{
        const url = `${SUPABASE_URL}/rest/v1/sessions?on_conflict=id`;
        const headers = { 'Content-Type':'application/json', apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Prefer:'resolution=merge-duplicates' };
        await fetch(url,{ method:'POST', headers, body: JSON.stringify(payload) });
      }catch(_){ /* ignore */ }
    }

    const flags = cookieFlags(req);
    const maxAge = 30*24*60*60;
    res.setHeader('Set-Cookie', [
      `sid=${sid}; ${flags}; Max-Age=${maxAge}`,
      `uid=${encodeURIComponent(uid)}; ${flags}; Max-Age=${maxAge}`,
      `uname=${encodeURIComponent(fullName || email)}; ${flags}; Max-Age=${maxAge}`,
      `uavatar=${encodeURIComponent('')}; ${flags}; Max-Age=${maxAge}`,
      `uemail=${encodeURIComponent(email)}; ${flags}; Max-Age=${maxAge}`,
      `uexp=${encodeURIComponent(expiresAt)}; ${flags}; Max-Age=${maxAge}`
    ]);

    res.status(200).json({ ok:true, user:{ id: uid, username: fullName || email, email } });
  }catch(err){ res.status(500).json({ ok:false, error: err?.message || 'Erro em /api/auth/login' }); }
}
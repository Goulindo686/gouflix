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

async function upsertUser(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, user){
  try{
    const url = `${SUPABASE_URL}/rest/v1/users?on_conflict=id`;
    const headers = {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Prefer': 'resolution=merge-duplicates'
    };
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(user) });
    return r.ok;
  }catch(_){ return false; }
}

async function upsertSession(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, session){
  try{
    const url = `${SUPABASE_URL}/rest/v1/sessions?on_conflict=id`;
    const headers = {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Prefer': 'resolution=merge-duplicates'
    };
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(session) });
    return r.ok;
  }catch(_){ return false; }
}

// Tabela de autenticação local (email/senha)
async function upsertLocalAuth(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, record){
  try{
    const url = `${SUPABASE_URL}/rest/v1/local_auth_users?on_conflict=email`;
    const headers = {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Prefer': 'resolution=merge-duplicates'
    };
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify([record]) });
    return r.ok;
  }catch(_){ return false; }
}

import crypto from 'crypto';
function hashPassword(password, salt){
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(String(password||''), s, 100000, 32, 'sha256').toString('hex');
  return { salt: s, hash };
}

export default async function handler(req, res){
  if(req.method !== 'POST'){ res.status(405).json({ ok:false, error:'Método não permitido' }); return; }
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  try{
    const body = await readBody(req);
    const fullName = String(body?.fullName||'').trim();
    const email = String(body?.email||'').trim().toLowerCase();
    const password = String(body?.password||'');
    if(!fullName || !email || !password){ res.status(400).json({ ok:false, error:'Dados inválidos (nome/email/senha)' }); return; }

    const uid = mkStableIdFromEmail(email);
    const sid = newSessionId();
    const expiresAt = new Date(Date.now() + 30*24*60*60*1000).toISOString();

    // Persistir no Supabase se disponível
    if(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY){
      await upsertUser(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { id: uid, username: fullName, avatar: null, email, updated_at: new Date().toISOString() });
      await upsertSession(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { id: sid, user_id: uid, username: fullName, avatar: null, email, created_at: new Date().toISOString(), expires_at: expiresAt });
      const { salt, hash } = hashPassword(password);
      await upsertLocalAuth(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { id: uid, email, password_salt: salt, password_hash: hash, updated_at: new Date().toISOString() });
    }

    // Setar cookies compatíveis com o fluxo do Discord
    const flags = cookieFlags(req);
    const maxAge = 30 * 24 * 60 * 60; // 30 dias
    res.setHeader('Set-Cookie', [
      `sid=${sid}; ${flags}; Max-Age=${maxAge}`,
      `uid=${encodeURIComponent(uid)}; ${flags}; Max-Age=${maxAge}`,
      `uname=${encodeURIComponent(fullName)}; ${flags}; Max-Age=${maxAge}`,
      `uavatar=${encodeURIComponent('')}; ${flags}; Max-Age=${maxAge}`,
      `uemail=${encodeURIComponent(email)}; ${flags}; Max-Age=${maxAge}`,
      `uexp=${encodeURIComponent(expiresAt)}; ${flags}; Max-Age=${maxAge}`
    ]);

    res.status(200).json({ ok:true, user:{ id: uid, username: fullName, email } });
  }catch(err){ res.status(500).json({ ok:false, error: err?.message || 'Erro em /api/auth/register' }); }
}
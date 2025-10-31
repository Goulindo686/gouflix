import crypto from 'crypto';

// Helpers compartilhados
function readBody(req){
  return new Promise((resolve)=>{
    let data='';
    req.on('data',chunk=>{ data+=chunk; });
    req.on('end',()=>{ try{ resolve(JSON.parse(data||'{}')); }catch(_){ resolve({}); } });
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

function readCookie(req, name){
  const cookie = req.headers.cookie || '';
  const parts = cookie.split(';').map(s=>s.trim());
  for(const p of parts){ if(p.startsWith(name+'=')) return decodeURIComponent(p.slice(name.length+1)); }
  return null;
}

function hashPassword(password, salt){
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(String(password||''), s, 100000, 32, 'sha256').toString('hex');
  return { salt: s, hash };
}

function verifyPassword(password, salt, hash){
  try{
    const derived = crypto.pbkdf2Sync(String(password||''), String(salt||''), 100000, 32, 'sha256').toString('hex');
    return derived === String(hash||'');
  }catch(_){ return false; }
}

async function upsertUser(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, user){
  try{
    const url = `${SUPABASE_URL}/rest/v1/users?on_conflict=id`;
    const headers = { 'Content-Type':'application/json', apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Prefer: 'resolution=merge-duplicates' };
    const r = await fetch(url, { method:'POST', headers, body: JSON.stringify(user) });
    return r.ok;
  }catch(_){ return false; }
}

async function upsertSession(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, session){
  try{
    const url = `${SUPABASE_URL}/rest/v1/sessions?on_conflict=id`;
    const headers = { 'Content-Type':'application/json', apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Prefer: 'resolution=merge-duplicates' };
    const r = await fetch(url, { method:'POST', headers, body: JSON.stringify(session) });
    return r.ok;
  }catch(_){ return false; }
}

async function upsertLocalAuth(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, record){
  try{
    const url = `${SUPABASE_URL}/rest/v1/local_auth_users?on_conflict=email`;
    const headers = { 'Content-Type':'application/json', apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Prefer: 'resolution=merge-duplicates' };
    const r = await fetch(url, { method:'POST', headers, body: JSON.stringify([record]) });
    return r.ok;
  }catch(_){ return false; }
}

export default async function handler(req, res){
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  try{
    // /api/auth/me
    if(pathname === '/api/auth/me'){
      if(req.method !== 'GET'){ res.statusCode = 405; return res.end(JSON.stringify({ ok:false, error:'Método não permitido' })); }
      const sid = readCookie(req, 'sid');
      if(!sid){ return res.end(JSON.stringify({ ok:true, logged:false, user:null })); }
      if(!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY){
        const uid = readCookie(req, 'uid');
        const uname = readCookie(req, 'uname') || 'Usuário';
        const uavatar = readCookie(req, 'uavatar') || null;
        const uemail = readCookie(req, 'uemail') || null;
        const uexp = readCookie(req, 'uexp');
        const expMs = uexp ? (new Date(uexp)).getTime() : Date.now();
        if(!uid || expMs < Date.now()){ return res.end(JSON.stringify({ ok:true, logged:false, user:null })); }
        return res.end(JSON.stringify({ ok:true, logged:true, user:{ id: uid, username: uname, avatar: uavatar, email: uemail } }));
      }
      const r = await fetch(`${SUPABASE_URL}/rest/v1/sessions?id=eq.${encodeURIComponent(sid)}&select=user_id,username,avatar,email,expires_at`,{
        headers:{ apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Accept:'application/json' }
      });
      if(!r.ok){ return res.end(JSON.stringify({ ok:true, logged:false, user:null })); }
      const data = await r.json();
      const row = Array.isArray(data)&&data.length?data[0]:null;
      if(!row){ return res.end(JSON.stringify({ ok:true, logged:false, user:null })); }
      const exp = row.expires_at ? (new Date(row.expires_at)).getTime() : Date.now();
      if(exp < Date.now()){ return res.end(JSON.stringify({ ok:true, logged:false, user:null })); }
      const user = { id: row.user_id, username: row.username, avatar: row.avatar||null, email: row.email||null };
      return res.end(JSON.stringify({ ok:true, logged:true, user }));
    }

    // /api/auth/logout (aceita GET ou POST)
    if(pathname === '/api/auth/logout'){
      res.setHeader('Set-Cookie', [
        'sid=; Max-Age=0; Path=/; SameSite=Lax',
        'uid=; Max-Age=0; Path=/; SameSite=Lax',
        'uname=; Max-Age=0; Path=/; SameSite=Lax',
        'uavatar=; Max-Age=0; Path=/; SameSite=Lax',
        'uemail=; Max-Age=0; Path=/; SameSite=Lax',
        'uexp=; Max-Age=0; Path=/; SameSite=Lax'
      ]);
      return res.end(JSON.stringify({ ok:true }));
    }

    // /api/auth/login
    if(pathname === '/api/auth/login'){
      if(req.method !== 'POST'){ res.statusCode = 405; return res.end(JSON.stringify({ ok:false, error:'Método não permitido' })); }
      const body = await readBody(req);
      const email = String(body?.email||'').trim().toLowerCase();
      const password = String(body?.password||'');
      if(!email || !password){ res.statusCode = 400; return res.end(JSON.stringify({ ok:false, error:'Email/senha inválidos' })); }

      let fullName = String(body?.fullName||'').trim();
      let okAuth = true;
      if(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY){
        const r = await fetch(`${SUPABASE_URL}/rest/v1/local_auth_users?email=eq.${encodeURIComponent(email)}&select=password_salt,password_hash,id`,{
          headers:{ apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Accept:'application/json' }
        });
        if(!r.ok){ res.statusCode = r.status; const tx = await r.text(); return res.end(JSON.stringify({ ok:false, error:'Falha ao consultar usuário', details: tx })); }
        const rows = await r.json();
        const row = Array.isArray(rows)&&rows.length?rows[0]:null;
        if(!row){ okAuth = false; }
        else{ okAuth = verifyPassword(password, row.password_salt, row.password_hash); }
        if(okAuth){
          const r2 = await fetch(`${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=username`,{
            headers:{ apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Accept:'application/json' }
          });
          if(r2.ok){ const rows2 = await r2.json(); const row2 = Array.isArray(rows2)&&rows2.length?rows2[0]:null; fullName = row2?.username || fullName || email; }
        }
      }
      if(!okAuth){ res.statusCode = 401; return res.end(JSON.stringify({ ok:false, error:'Credenciais inválidas' })); }

      const uid = mkStableIdFromEmail(email);
      const sid = newSessionId();
      const expiresAt = new Date(Date.now() + 30*24*60*60*1000).toISOString();

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
      return res.end(JSON.stringify({ ok:true, user:{ id: uid, username: fullName || email, email } }));
    }

    // /api/auth/register
    if(pathname === '/api/auth/register'){
      if(req.method !== 'POST'){ res.statusCode = 405; return res.end(JSON.stringify({ ok:false, error:'Método não permitido' })); }
      const body = await readBody(req);
      const fullName = String(body?.fullName||'').trim();
      const email = String(body?.email||'').trim().toLowerCase();
      const password = String(body?.password||'');
      if(!fullName || !email || !password){ res.statusCode = 400; return res.end(JSON.stringify({ ok:false, error:'Dados inválidos (nome/email/senha)' })); }

      const uid = mkStableIdFromEmail(email);
      const sid = newSessionId();
      const expiresAt = new Date(Date.now() + 30*24*60*60*1000).toISOString();

      if(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY){
        await upsertUser(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { id: uid, username: fullName, avatar: null, email, updated_at: new Date().toISOString() });
        await upsertSession(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { id: sid, user_id: uid, username: fullName, avatar: null, email, created_at: new Date().toISOString(), expires_at: expiresAt });
        const { salt, hash } = hashPassword(password);
        await upsertLocalAuth(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { id: uid, email, password_salt: salt, password_hash: hash, updated_at: new Date().toISOString() });
      }

      const flags = cookieFlags(req);
      const maxAge = 30 * 24 * 60 * 60;
      res.setHeader('Set-Cookie', [
        `sid=${sid}; ${flags}; Max-Age=${maxAge}`,
        `uid=${encodeURIComponent(uid)}; ${flags}; Max-Age=${maxAge}`,
        `uname=${encodeURIComponent(fullName)}; ${flags}; Max-Age=${maxAge}`,
        `uavatar=${encodeURIComponent('')}; ${flags}; Max-Age=${maxAge}`,
        `uemail=${encodeURIComponent(email)}; ${flags}; Max-Age=${maxAge}`,
        `uexp=${encodeURIComponent(expiresAt)}; ${flags}; Max-Age=${maxAge}`
      ]);
      return res.end(JSON.stringify({ ok:true, user:{ id: uid, username: fullName, email } }));
    }

    // Não encontrado
    res.statusCode = 404;
    return res.end(JSON.stringify({ ok:false, error:'Not Found' }));
  }catch(err){
    res.statusCode = 500;
    return res.end(JSON.stringify({ ok:false, error: err?.message || 'Erro em /api/auth/*' }));
  }
}
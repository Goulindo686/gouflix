function readCookie(req, name){
  const cookie = req.headers.cookie || '';
  const parts = cookie.split(';').map(s=>s.trim());
  for(const p of parts){ if(p.startsWith(name+'=')) return decodeURIComponent(p.slice(name.length+1)); }
  return null;
}

export default async function handler(req, res){
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try{
    const sid = readCookie(req, 'sid');
    if(!sid){ return res.status(200).json({ ok:true, logged:false, user:null }); }
    // Fallback: se Supabase não estiver configurado, usar cookies auxiliares
    if(!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY){
      const uid = readCookie(req, 'uid');
      const uname = readCookie(req, 'uname') || 'Usuário';
      const uavatar = readCookie(req, 'uavatar') || null;
      const uemail = readCookie(req, 'uemail') || null;
      const uexp = readCookie(req, 'uexp');
      const expMs = uexp ? (new Date(uexp)).getTime() : Date.now();
      if(!uid || expMs < Date.now()){
        return res.status(200).json({ ok:true, logged:false, user:null });
      }
      return res.status(200).json({ ok:true, logged:true, user:{ id: uid, username: uname, avatar: uavatar, email: uemail } });
    }
    const r = await fetch(`${SUPABASE_URL}/rest/v1/sessions?id=eq.${encodeURIComponent(sid)}&select=user_id,username,avatar,email,expires_at`, {
      headers: { 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Accept': 'application/json' }
    });
    if(!r.ok){
      // Falha no Supabase: tentar fallback por cookies
      const uid = readCookie(req, 'uid');
      const uname = readCookie(req, 'uname');
      const uavatar = readCookie(req, 'uavatar') || null;
      const uemail = readCookie(req, 'uemail') || null;
      const uexp = readCookie(req, 'uexp');
      const expMs = uexp ? (new Date(uexp)).getTime() : 0;
      if(uid && uname && expMs > Date.now()){
        const user = { id: uid, username: uname, avatar: uavatar, email: uemail };
        return res.status(200).json({ ok:true, logged:true, user });
      }
      return res.status(200).json({ ok:true, logged:false, user:null });
    }
    const data = await r.json();
    const row = Array.isArray(data) && data.length ? data[0] : null;
    if(!row){
      // Sessão não encontrada: tentar fallback por cookies
      const uid = readCookie(req, 'uid');
      const uname = readCookie(req, 'uname');
      const uavatar = readCookie(req, 'uavatar') || null;
      const uemail = readCookie(req, 'uemail') || null;
      const uexp = readCookie(req, 'uexp');
      const expMs = uexp ? (new Date(uexp)).getTime() : 0;
      if(uid && uname && expMs > Date.now()){
        const user = { id: uid, username: uname, avatar: uavatar, email: uemail };
        return res.status(200).json({ ok:true, logged:true, user });
      }
      return res.status(200).json({ ok:true, logged:false, user:null });
    }
    const exp = row.expires_at ? (new Date(row.expires_at)).getTime() : Date.now();
    if(exp < Date.now()){
      // Se sessão expirada ou não encontrada no Supabase, tentar fallback via cookies
      const uid = readCookie(req, 'uid');
      const uname = readCookie(req, 'uname');
      const uavatar = readCookie(req, 'uavatar') || null;
      const uemail = readCookie(req, 'uemail') || null;
      const uexp = readCookie(req, 'uexp');
      const expMs = uexp ? (new Date(uexp)).getTime() : 0;
      if(uid && uname && expMs > Date.now()){
        const user = { id: uid, username: uname, avatar: uavatar, email: uemail };
        return res.status(200).json({ ok:true, logged:true, user });
      }
      return res.status(200).json({ ok:true, logged:false, user:null });
    }
    const user = { id: row.user_id, username: row.username, avatar: row.avatar || null, email: row.email || null };
    return res.status(200).json({ ok:true, logged:true, user });
  }catch(err){
    return res.status(500).json({ ok:false, error: err?.message || 'Erro em /api/auth/me' });
  }
}
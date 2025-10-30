function readCookie(req, name){
  const cookie = req.headers.cookie || '';
  const parts = cookie.split(';').map(s=>s.trim());
  for(const p of parts){ if(p.startsWith(name+'=')) return decodeURIComponent(p.slice(name.length+1)); }
  return null;
}

export default async function handler(req, res){
  try{
    const sid = readCookie(req, 'sid');
    if(!sid){ return res.status(401).json({ error: 'Usuário não autenticado' }); }
    const uid = readCookie(req, 'uid');
    const uemail = readCookie(req, 'uemail') || null;
    const uname = readCookie(req, 'uname') || '';
    const uavatar = readCookie(req, 'uavatar') || '';
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

    if(req.method === 'POST'){
      let body = {};
      try{
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        body = JSON.parse(Buffer.concat(chunks).toString('utf-8')||'{}');
      }catch(_){ body = {}; }
      const profileName = (body?.profileName||'').trim();
      const avatar = body?.avatar || '';
      if(!profileName){ return res.status(400).json({ error:'Nome do perfil é obrigatório' }); }
      // Atualiza no Supabase quando disponível
      if(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && uid){
        try{
          const headers = { 'Content-Type':'application/json', apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Accept:'application/json', Prefer:'return=representation' };
          const r = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(uid)}`,{ method:'PATCH', headers, body: JSON.stringify({ profile_name: profileName, avatar, updated_at: new Date().toISOString() }) });
          if(!r.ok){ /* ignore and continue with cookies */ }
        }catch(_){ /* ignore */ }
      }
      const maxAge = 30*24*60*60;
      const isHttps = String(req.headers['x-forwarded-proto']||'').includes('https');
      const cookieFlags = `HttpOnly; Path=/; SameSite=Lax${isHttps ? '; Secure' : ''}`;
      res.setHeader('Set-Cookie', [
        `uname=${encodeURIComponent(profileName)}; ${cookieFlags}; Max-Age=${maxAge}`,
        `uavatar=${encodeURIComponent(avatar||'')}; ${cookieFlags}; Max-Age=${maxAge}`,
      ]);
      return res.status(200).json({ success:true, message:'Perfil criado com sucesso', user:{ id: uid, email: uemail, username: profileName, avatar } });
    }
    if(req.method === 'GET'){
      // Quando possível, lê do Supabase para refletir atualização
      if(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && uid){
        try{
          const headers = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Accept:'application/json' };
          const r = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(uid)}&select=id,email,username,profile_name,avatar,auth_type`,{ headers });
          if(r.ok){
            const rows = await r.json();
            const row = Array.isArray(rows)&&rows.length?rows[0]:null;
            if(row){
              const user = { id: String(row.id||uid), email: row.email||uemail, username: row.profile_name||row.username||uname, profileName: row.profile_name||row.username||uname, avatar: row.avatar||uavatar, authType: row.auth_type||'traditional', hasProfile: !!(row.profile_name||row.username||uname) };
              return res.status(200).json({ success:true, user });
            }
          }
        }catch(_){ /* ignore */ }
      }
      return res.status(200).json({ success:true, user:{ id: uid, email: uemail, username: uname, profileName: uname, avatar: uavatar, authType:'traditional', hasProfile: !!uname } });
    }
    res.setHeader('Allow','GET, POST');
    return res.status(405).json({ error:'Method not allowed' });
  }catch(err){
    console.error('Erro na API de perfil (remote):', err);
    return res.status(500).json({ error:'Erro interno do servidor' });
  }
}
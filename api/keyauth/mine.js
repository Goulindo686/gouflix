function readCookie(req, name){
  const cookie = req.headers.cookie || '';
  const parts = cookie.split(';').map(s=>s.trim());
  for(const p of parts){
    if(p.startsWith(name+'=')) return decodeURIComponent(p.slice(name.length+1));
  }
  return null;
}

async function fetchJson(url, headers){
  const r = await fetch(url, { headers: headers || { 'Accept': 'application/json' } });
  if(!r.ok){ return null; }
  try{ return await r.json(); }catch{ return null; }
}

export default async function handler(req, res){
  try{
    if(req.method !== 'GET'){
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ ok:false, error:'Método não permitido' });
    }
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const SID = readCookie(req, 'sid');
    let userId = null;
    if(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && SID){
      try{
        const r = await fetch(`${SUPABASE_URL}/rest/v1/sessions?id=eq.${encodeURIComponent(SID)}&select=user_id`, {
          headers: { 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Accept': 'application/json' }
        });
        if(r.ok){ const arr = await r.json(); const row = Array.isArray(arr)&&arr.length?arr[0]:null; if(row){ userId = row.user_id; } }
      }catch{}
    }
    if(!userId){ const exp = readCookie(req, 'uexp'); const expMs = exp ? (new Date(exp)).getTime() : 0; const uid = readCookie(req, 'uid'); if(uid && expMs > Date.now()){ userId = uid; } }
    if(!userId){ return res.status(200).json({ ok:true, license:null }); }

    if(!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY){ return res.status(200).json({ ok:true, license:null }); }

    // Buscar licença vinculada no Supabase
    const headers = { 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Accept':'application/json' };
    const rows = await fetchJson(`${SUPABASE_URL}/rest/v1/keyauth_licenses?user_id=eq.${encodeURIComponent(userId)}&select=license_key,hwid,status,timeleft,updated_at&order=updated_at.desc`, headers);
    const license = Array.isArray(rows) && rows.length ? rows[0] : null;
    if(!license){ return res.status(200).json({ ok:true, license:null }); }

    // Revalidar status rapidamente via Client API (sem secret), conforme solicitado
    let active = false; let timeleft = license.timeleft ?? null; let status = license.status || 'active';
    const baseClient = process.env.KEYAUTH_API_URL || 'https://keyauth.win/api/1.0/';
    const appName = process.env.KEYAUTH_APP_NAME || '';
    const ownerId = process.env.KEYAUTH_OWNER_ID || '';
    const appVersion = process.env.KEYAUTH_APP_VERSION || '1.0.0';
    try{
      if(appName && ownerId){
        const login = await fetchJson(`${baseClient}?name=${encodeURIComponent(appName)}&ownerid=${encodeURIComponent(ownerId)}&version=${encodeURIComponent(appVersion)}&type=license&key=${encodeURIComponent(license.license_key)}&hwid=${encodeURIComponent(license.hwid||'')}&format=json`);
        if(login?.success){
          const data = login.data || login.info || login;
          const tl = (data?.timeleft ?? data?.time_left ?? data?.timeLeft);
          timeleft = tl != null ? (parseInt(String(tl), 10) || 0) : null;
          status = String(data?.status || data?.state || 'active').toLowerCase();
          active = (status === 'active') && (typeof timeleft !== 'number' || timeleft > 0);
        }
      }
    }catch{}

    return res.status(200).json({ ok:true, license: { license_key: license.license_key, hwid: license.hwid||null, status, timeleft, active } });
  }catch(err){
    return res.status(500).json({ ok:false, error: err?.message || 'Erro interno em /api/keyauth/mine' });
  }
}
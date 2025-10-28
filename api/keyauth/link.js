function readCookie(req, name){
  const cookie = req.headers.cookie || '';
  const parts = cookie.split(';').map(s=>s.trim());
  for(const p of parts){
    if(p.startsWith(name+'=')) return decodeURIComponent(p.slice(name.length+1));
  }
  return null;
}

async function readBody(req){
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try{ return JSON.parse(Buffer.concat(chunks).toString('utf8')); }catch{ return {}; }
}

async function fetchJson(url){
  const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if(!r.ok){ return null; }
  try{ return await r.json(); }catch{ return null; }
}

export default async function handler(req, res){
  try{
    if(req.method !== 'POST'){
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok:false, error:'Método não permitido' });
    }

    const body = await readBody(req);
    const licenseKey = body?.licenseKey || body?.key || '';
    const hwid = body?.hwid || '';
    if(!licenseKey || !hwid){
      return res.status(400).json({ ok:false, error:'key e hwid são obrigatórios' });
    }

    // Identificar usuário logado
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const sid = readCookie(req, 'sid');
    let userId = null;
    let username = null;
    let avatar = null;
    let email = null;
    if(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && sid){
      try{
        const r = await fetch(`${SUPABASE_URL}/rest/v1/sessions?id=eq.${encodeURIComponent(sid)}&select=user_id,username,avatar,email,expires_at`, {
          headers: { 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Accept': 'application/json' }
        });
        if(r.ok){
          const arr = await r.json();
          const row = Array.isArray(arr) && arr.length ? arr[0] : null;
          if(row){ userId = row.user_id; username = row.username||null; avatar = row.avatar||null; email = row.email||null; }
        }
      }catch{}
    }
    if(!userId){
      // Fallback pelo cookie quando Supabase não estiver disponível
      const exp = readCookie(req, 'uexp');
      const expMs = exp ? (new Date(exp)).getTime() : 0;
      const uid = readCookie(req, 'uid');
      if(uid && expMs > Date.now()){ userId = uid; username = readCookie(req, 'uname'); avatar = readCookie(req, 'uavatar'); email = readCookie(req, 'uemail'); }
    }
    if(!userId){ return res.status(401).json({ ok:false, error:'Necessário estar logado com Discord' }); }

    // Validar licença usando a mesma lógica da rota /api/keyauth/validate
    const baseClient = process.env.KEYAUTH_API_URL || 'https://keyauth.win/api/1.0/';
    const appName = process.env.KEYAUTH_APP_NAME || '';
    const ownerId = process.env.KEYAUTH_OWNER_ID || '';
    const appVersion = process.env.KEYAUTH_APP_VERSION || '1.0.0';
    const ignoreHwid = String(process.env.KEYAUTH_IGNORE_HWID || '').toLowerCase() === 'true';

    let timeleft = null; let serverHwid = null; let status = 'active'; let banned = false;
    if(appName && ownerId){
      const loginUrl = `${baseClient}?name=${encodeURIComponent(appName)}&ownerid=${encodeURIComponent(ownerId)}&version=${encodeURIComponent(appVersion)}&type=license&key=${encodeURIComponent(licenseKey)}&hwid=${encodeURIComponent(hwid)}&format=json`;
      const login = await fetchJson(loginUrl);
      if(login?.success){
        const data = login.data || login.info || login;
        const tl = (data?.timeleft ?? data?.time_left ?? data?.timeLeft);
        timeleft = tl != null ? (parseInt(String(tl), 10) || 0) : null;
        serverHwid = data?.hwid || data?.device || data?.bound_hwid || null;
        status = String(data?.status || data?.state || 'active').toLowerCase();
        banned = String(data?.banned || data?.is_banned || '').toLowerCase() === 'true';
      } else {
        return res.status(403).json({ ok:false, error: login?.message || 'licença inválida', reason:'client_license_failed' });
      }
    } else {
      return res.status(500).json({ ok:false, error:'Credenciais do KeyAuth ausentes (name/ownerid)', reason:'client_missing_credentials' });
    }

    if(banned) return res.status(403).json({ ok:false, error:'licença banida', reason:'banned' });
    if(typeof timeleft === 'number' && Number.isFinite(timeleft) && timeleft <= 0){ return res.status(403).json({ ok:false, error:'licença expirada', reason:'expired' }); }
    if(status && ['disabled','inactive','invalid'].includes(status)) return res.status(403).json({ ok:false, error:'licença inativa', reason:'inactive' });
    if(serverHwid && serverHwid !== hwid && appName && ownerId && !ignoreHwid){
      return res.status(403).json({ ok:false, error:'HWID não corresponde ao dispositivo vinculado', reason:'hwid_mismatch' });
    }

    // Persistir vínculo no Supabase
    if(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY){
      try{
        const headers = {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Prefer': 'resolution=merge-duplicates',
        };
        const row = {
          user_id: String(userId),
          license_key: String(licenseKey),
          hwid: String(hwid),
          status: status || 'active',
          timeleft: timeleft != null ? Number(timeleft) : null,
          updated_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        };
        await fetch(`${SUPABASE_URL}/rest/v1/keyauth_licenses?on_conflict=license_key`, { method:'POST', headers, body: JSON.stringify(row) });
      }catch{}
    }

    return res.status(200).json({ ok:true, linked:true, timeleft, status, userId });
  }catch(err){
    return res.status(500).json({ ok:false, error: err?.message || 'Erro interno em /api/keyauth/link' });
  }
}
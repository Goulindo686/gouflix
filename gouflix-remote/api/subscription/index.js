const PLAN_DURATIONS = { mensal: 30, trimestral: 90, anual: 365 };
function isUuid(v){ return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v)); }
function toUuidStable(input){
  const s = String(input||'').trim();
  if(!s) return '00000000-0000-0000-0000-000000000000';
  if(isUuid(s)) return s.toLowerCase();
  const crypto = require('crypto');
  const namespace = 'gouflix-namespace-fixed-v5';
  const hash = crypto.createHash('sha1').update(namespace+':'+s).digest('hex');
  let hex = hash.slice(0,32).toLowerCase();
  hex = hex.slice(0,12) + '5' + hex.slice(13);
  hex = hex.slice(0,16) + '8' + hex.slice(17);
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
}

export default async function handler(req, res){
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const table = process.env.SUBSCRIPTIONS_TABLE || 'subscriptions';

  if(req.method === 'GET'){
    const userId = String(req.query?.userId||'').trim();
    if(!userId){ return res.status(400).json({ ok:false, error:'userId obrigatório' }); }
    if(!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY){
      // Fallback: sem Supabase, sempre inativo
      return res.status(200).json({ ok:true, active:false });
    }
    try{
      const uid = toUuidStable(userId);
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?user_id=eq.${encodeURIComponent(uid)}&select=*`,{
        headers:{ apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Accept:'application/json' }
      });
      if(!r.ok){ return res.status(r.status).json({ ok:false, error:'Falha ao consultar assinatura' }); }
      const rows = await r.json();
      const row = Array.isArray(rows) && rows.length ? rows[0] : null;
      if(!row){ return res.status(200).json({ ok:true, active:false }); }
      const now = Date.now();
      const endIso = row.end_date || row.end_at || null;
      const end = endIso ? (new Date(endIso)).getTime() : 0;
      const flagActive = (String(row.status||'').toLowerCase() === 'active') || (!!row.active);
      const active = flagActive && end > now;
      const planOut = row.plan || row.plan_id || null;
      return res.status(200).json({ ok:true, active, plan: planOut, end_date: row.end_date || row.end_at });
    }catch(err){ return res.status(500).json({ ok:false, error: err.message }); }
  }

  if(req.method === 'POST'){
    if(!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY){
      return res.status(500).json({ ok:false, error:'Supabase não configurado (SERVICE ROLE KEY ausente)' });
    }
    try{
      const body = await readBody(req);
      const userId = String(body?.userId||'').trim();
      const uid = toUuidStable(userId);
      const plan = String(body?.plan||'').toLowerCase();
      const action = String(body?.action||'activate'); // activate | deactivate
      if(!userId || !plan){ return res.status(400).json({ ok:false, error:'Parâmetros inválidos (userId/plan)' }); }
      const duration = PLAN_DURATIONS[plan];
      if(action === 'activate'){
        const start = new Date();
        const end = new Date(start.getTime() + (duration||30)*24*60*60*1000);
        const startIso = start.toISOString();
        const endIso = end.toISOString();
        // Variante A (status/plan + start_date/end_date)
        const payloadA = [{ user_id: uid, plan, status:'active', start_date: startIso, end_date: endIso }];
        let r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=user_id`,{
          method:'POST',
          headers:{ apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type':'application/json', Prefer:'resolution=merge-duplicates' },
          body: JSON.stringify(payloadA)
        });
        if(!r.ok){
          // Fallback: Variante B (active/plan_id + start_at/end_at)
          const payloadB = [{ user_id: uid, plan_id: plan, active: true, start_at: startIso, end_at: endIso }];
          r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=user_id`,{
            method:'POST',
            headers:{ apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type':'application/json', Prefer:'resolution=merge-duplicates' },
            body: JSON.stringify(payloadB)
          });
        }
        if(!r.ok){ const tx = await r.text(); return res.status(r.status).json({ ok:false, error:'Falha ao ativar', details: tx }); }
        return res.status(200).json({ ok:true });
      } else {
        // Desativar com fallback (status ou active)
        let r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?user_id=eq.${encodeURIComponent(uid)}`,{
          method:'PATCH',
          headers:{ apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type':'application/json' },
          body: JSON.stringify({ status:'inactive' })
        });
        if(!r.ok){
          r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?user_id=eq.${encodeURIComponent(uid)}`,{
            method:'PATCH',
            headers:{ apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type':'application/json' },
            body: JSON.stringify({ active:false })
          });
        }
        if(!r.ok){ const tx = await r.text(); return res.status(r.status).json({ ok:false, error:'Falha ao desativar', details: tx }); }
        return res.status(200).json({ ok:true });
      }
    }catch(err){ return res.status(500).json({ ok:false, error: err.message }); }
  }

  res.setHeader('Allow','GET, POST');
  return res.status(405).json({ ok:false, error:'Método não permitido' });
}

async function readBody(req){
  return await new Promise((resolve)=>{
    let data='';
    req.on('data',chunk=> data+=chunk);
    req.on('end',()=>{ try{ resolve(JSON.parse(data||'{}')); }catch(_){ resolve({}); } });
  });
}
export default async function handler(req, res){
  if(req.method !== 'POST'){
    res.setHeader('Allow','POST');
    return res.status(405).json({ ok:false, error:'Método não permitido' });
  }
  try{
    const body = await readBody(req);
    // Sunize envia notificações de transação; buscar status consultando a transação
    const id = body?.id || body?.transaction_id || body?.data?.id || body?.event?.id || null;
    let SUNIZE_CLIENT_KEY = process.env.SUNIZE_CLIENT_KEY || '';
    let SUNIZE_CLIENT_SECRET = process.env.SUNIZE_CLIENT_SECRET || '';
    let SUNIZE_API_SECRET = process.env.SUNIZE_API_SECRET || '';
    let PUBLIC_URL = process.env.PUBLIC_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '') || '';
    if(!(SUNIZE_CLIENT_KEY && SUNIZE_CLIENT_SECRET) && !SUNIZE_API_SECRET){
      const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
      const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
      if(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY){
        try{
          const r = await fetch(`${SUPABASE_URL}/rest/v1/app_config?id=eq.global&select=sunize_client_key,sunize_client_secret,sunize_api_secret,public_url`,{ headers:{ apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Accept:'application/json' } });
          if(r.ok){
            const j = await r.json();
            const row = Array.isArray(j)&&j.length?j[0]:null;
            SUNIZE_CLIENT_KEY = row?.sunize_client_key || SUNIZE_CLIENT_KEY;
            SUNIZE_CLIENT_SECRET = row?.sunize_client_secret || SUNIZE_CLIENT_SECRET;
            SUNIZE_API_SECRET = row?.sunize_api_secret || SUNIZE_API_SECRET;
            if(!PUBLIC_URL) PUBLIC_URL = row?.public_url || PUBLIC_URL;
          }
        }catch(_){ /* ignore */ }
      }
      if(!(SUNIZE_CLIENT_KEY && SUNIZE_CLIENT_SECRET) && !SUNIZE_API_SECRET){
        return res.status(500).json({ ok:false, error:'Credenciais Sunize ausentes (SUNIZE_CLIENT_KEY/SUNIZE_CLIENT_SECRET ou SUNIZE_API_SECRET)' });
      }
    }
    if(!id){ return res.status(400).json({ ok:false, error:'Webhook Sunize sem id de transação' }); }
    const SUNIZE_BASE = process.env.SUNIZE_BASE_URL || 'https://api.sunize.com.br/v1';
    // Cabeçalho Sunize: prefer Basic (client key/secret), fallback Bearer (api secret)
    function buildSunizeHeaders(){
      if(SUNIZE_CLIENT_KEY && SUNIZE_CLIENT_SECRET){
        const basic = Buffer.from(`${SUNIZE_CLIENT_KEY}:${SUNIZE_CLIENT_SECRET}`).toString('base64');
        return { Authorization: `Basic ${basic}` };
      }
      if(SUNIZE_API_SECRET){
        return { Authorization: `Bearer ${SUNIZE_API_SECRET}` };
      }
      throw new Error('Credenciais Sunize ausentes');
    }
    const r = await fetch(`${SUNIZE_BASE}/transactions/${encodeURIComponent(String(id))}`,{ headers: buildSunizeHeaders() });
    const json = await r.json().catch(()=>({}));
    if(!r.ok){ return res.status(r.status||500).json({ ok:false, error:'Falha ao consultar transação', details: json }); }
    const status = String(json?.status||'').toLowerCase();
    const ext = String(json?.external_id || json?.external_reference || '');
    const [userIdRaw, planRaw] = ext.split('|');
    const plan = String(planRaw||'').toLowerCase();
    const userId = toUuidStable(userIdRaw);
    if(['approved','paid','confirmed','succeeded'].includes(status) && userId && plan){
      const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
      const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
      const table = process.env.SUBSCRIPTIONS_TABLE || 'subscriptions';
      const durationDays = { mensal:30, trimestral:90, anual:365 }[plan] || 30;
      const startIso = new Date().toISOString();
      const endIso = new Date(Date.now() + durationDays*24*60*60*1000).toISOString();
      let activated = false;
      if(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY){
        try{
          const payloadA = [{ user_id: userId, plan, status:'active', start_date: startIso, end_date: endIso }];
          let r2 = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=user_id`,{
            method:'POST',
            headers:{ apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type':'application/json', Prefer:'resolution=merge-duplicates' },
            body: JSON.stringify(payloadA)
          });
          if(!r2.ok){
            const payloadB = [{ user_id: userId, plan_id: plan, active: true, start_at: startIso, end_at: endIso }];
            r2 = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=user_id`,{
              method:'POST',
              headers:{ apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type':'application/json', Prefer:'resolution=merge-duplicates' },
              body: JSON.stringify(payloadB)
            });
          }
          if(r2.ok){ activated = true; }
        }catch(err){ console.error('Supabase activation error', err); }
      }
      if(!activated){
        try{
          const act = await fetch(`${PUBLIC_URL||''}/api/subscription`,{ method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ userId, plan, action:'activate' }) });
          if(!act.ok){ console.error('Falha ao ativar assinatura via webhook (fallback)', await act.text()); }
        }catch(err){ console.error('Erro ao ativar assinatura via webhook (fallback)', err); }
      }
    }
    res.status(200).json({ ok:true });
  }catch(err){
    res.status(500).json({ ok:false, error: err.message });
  }
}

async function readBody(req){
  return await new Promise((resolve)=>{
    let data='';
    req.on('data',chunk=> data+=chunk);
    req.on('end',()=>{ try{ resolve(JSON.parse(data||'{}')); }catch(_){ resolve({}); } });
  });
}

function toUuidStable(input){
  const s = String(input||'').trim();
  if(!s) return '00000000-0000-0000-0000-000000000000';
  if(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)) return s.toLowerCase();
  const crypto = require('crypto');
  const namespace = 'gouflix-namespace-fixed-v5';
  const hash = crypto.createHash('sha1').update(namespace+':'+s).digest('hex');
  let hex = hash.slice(0,32).toLowerCase();
  hex = hex.slice(0,12) + '5' + hex.slice(13);
  hex = hex.slice(0,16) + '8' + hex.slice(17);
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
}
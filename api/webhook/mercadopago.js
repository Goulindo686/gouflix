export default async function handler(req, res){
  if(req.method !== 'POST'){
    res.setHeader('Allow','POST');
    return res.status(405).json({ ok:false, error:'Método não permitido' });
  }
  try{
    const body = await readBody(req);
    // Mercado Pago envia eventos diferentes; preferir buscar payment por id
    const data = body?.data || {};
    const type = String(body?.type||body?.event||'').toLowerCase();
    const id = data?.id || body?.id || null;
    let MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || process.env.MERCADOPAGO_ACCESS_TOKEN || '';
    if(!MP_ACCESS_TOKEN){
      const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
      const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
      if(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY){
        try{
          const r = await fetch(`${SUPABASE_URL}/rest/v1/app_config?id=eq.global&select=mp_access_token`,{ headers:{ apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Accept:'application/json' } });
          if(r.ok){ const j = await r.json(); const row = Array.isArray(j)&&j.length?j[0]:null; MP_ACCESS_TOKEN = row?.mp_access_token || ''; }
        }catch(_){ /* ignore */ }
      }
      if(!MP_ACCESS_TOKEN){ return res.status(500).json({ ok:false, error:'MP_ACCESS_TOKEN ausente' }); }
    }
    if(!id){ return res.status(400).json({ ok:false, error:'Webhook sem id de pagamento' }); }
    // Consultar status do pagamento
    const r = await fetch(`https://api.mercadopago.com/v1/payments/${id}`,{ headers:{ Authorization:`Bearer ${MP_ACCESS_TOKEN}` } });
    const json = await r.json();
    if(!r.ok){ return res.status(r.status).json({ ok:false, error:'Falha ao consultar pagamento', details: json }); }
    const status = String(json.status||'').toLowerCase();
    const ext = String(json.external_reference||'');
    // external_reference formato: userId|plan|timestamp
    const [userId, plan] = ext.split('|');
    if(status === 'approved' && userId && plan){
      // ativar assinatura diretamente no Supabase (mais robusto), com fallback para endpoint interno
      const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
      const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
      const table = process.env.SUBSCRIPTIONS_TABLE || 'subscriptions';
      const durationDays = { mensal:30, trimestral:90, anual:365 }[String(plan).toLowerCase()] || 30;
      const startIso = new Date().toISOString();
      const endIso = new Date(Date.now() + durationDays*24*60*60*1000).toISOString();
      let activated = false;
      if(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY){
        try{
          // Variante A (status/plan + start_date/end_date)
          const payloadA = [{ user_id: userId, plan, status:'active', start_date: startIso, end_date: endIso }];
          let r2 = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=user_id`,{
            method:'POST',
            headers:{ apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type':'application/json', Prefer:'resolution=merge-duplicates' },
            body: JSON.stringify(payloadA)
          });
          if(!r2.ok){
            // Fallback: Variante B (active/plan_id + start_at/end_at)
            const payloadB = [{ user_id: userId, plan_id: plan, active: true, start_at: startIso, end_at: endIso }];
            r2 = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=user_id`,{
              method:'POST',
              headers:{ apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type':'application/json', Prefer:'resolution=merge-duplicates' },
              body: JSON.stringify(payloadB)
            });
          }
          if(r2.ok){ activated = true; }
          else { console.error('Supabase activation failed', await r2.text()); }
        }catch(err){ console.error('Supabase activation error', err); }
      }
      if(!activated){
        // Resolver PUBLIC_URL para fallback
        let BASE_URL = process.env.PUBLIC_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '') || '';
        if(!BASE_URL && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY){
          try{
            const rCfg = await fetch(`${SUPABASE_URL}/rest/v1/app_config?id=eq.global&select=public_url`,{ headers:{ apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Accept:'application/json' } });
            if(rCfg.ok){ const j = await rCfg.json(); const row = Array.isArray(j)&&j.length?j[0]:null; BASE_URL = row?.public_url || ''; }
          }catch(_){ /* ignore */ }
        }
        try{
          const act = await fetch(`${BASE_URL || ''}/api/subscription`,{
            method:'POST',
            headers:{ 'Content-Type':'application/json' },
            body: JSON.stringify({ userId, plan, action:'activate' })
          });
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
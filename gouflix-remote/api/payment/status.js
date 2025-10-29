export default async function handler(req, res){
  if(req.method !== 'GET'){
    res.setHeader('Allow','GET');
    return res.status(405).json({ ok:false, error:'Método não permitido' });
  }
  try{
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
      if(!MP_ACCESS_TOKEN){ return res.status(500).json({ ok:false, error:'MP_ACCESS_TOKEN não configurado' }); }
    }
    const id = req.query?.id || req.query?.paymentId;
    if(!id){
      return res.status(400).json({ ok:false, error:'Informe id do pagamento' });
    }
    const r = await fetch(`https://api.mercadopago.com/v1/payments/${id}`,{
      headers:{ 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` }
    });
    const json = await r.json();
    if(!r.ok){
      return res.status(r.status).json({ ok:false, error: json?.message || 'Falha ao consultar pagamento', details: json });
    }
    return res.status(200).json({ ok:true, id: json.id, status: json.status, status_detail: json.status_detail });
  }catch(err){
    return res.status(500).json({ ok:false, error: err.message });
  }
}
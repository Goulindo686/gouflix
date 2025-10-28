export default async function handler(req, res){
  if(req.method !== 'POST'){
    res.setHeader('Allow','POST');
    return res.status(405).json({ ok:false, error:'Método não permitido' });
  }
  try{
    let MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || process.env.MERCADOPAGO_ACCESS_TOKEN || '';
    const PUBLIC_URL = process.env.PUBLIC_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '') || '';
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
    const body = await readBody(req);
    const plan = String(body?.plan||'').toLowerCase();
    const userId = String(body?.userId||'').trim();
    const PLAN_PRICES = { mensal: 19.90, trimestral: 49.90, anual: 147.90 };
    const amount = PLAN_PRICES[plan];
    if(!userId || !amount){
      return res.status(400).json({ ok:false, error:'Parâmetros inválidos (userId/plan)' });
    }
    const preference = {
      transaction_amount: Number(amount.toFixed(2)),
      description: `Assinatura GouFlix — ${plan}`,
      payment_method_id: 'pix',
      payer: { email: `${userId}@example.local` },
      notification_url: PUBLIC_URL ? `${PUBLIC_URL}/api/webhook/mercadopago` : undefined,
      external_reference: `${userId}|${plan}|${Date.now()}`
    };
    const r = await fetch('https://api.mercadopago.com/v1/payments',{
      method:'POST',
      headers:{
        'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
        'Content-Type':'application/json'
      },
      body: JSON.stringify(preference)
    });
    const json = await r.json();
    if(!r.ok){
      return res.status(r.status).json({ ok:false, error: json?.message || 'Falha ao criar pagamento', details: json });
    }
    const poi = json?.point_of_interaction?.transaction_data || {};
    const out = {
      ok:true,
      id: json.id,
      status: json.status,
      qr_code_base64: poi.qr_code_base64 || null,
      qr_code: poi.qr_code || null,
      external_reference: json.external_reference || null
    };
    return res.status(200).json(out);
  }catch(err){
    return res.status(500).json({ ok:false, error: err.message });
  }
}

async function readBody(req){
  return await new Promise((resolve)=>{
    let data='';
    req.on('data',chunk=> data+=chunk);
    req.on('end',()=>{
      try{ resolve(JSON.parse(data||'{}')); }catch(_){ resolve({}); }
    });
  });
}
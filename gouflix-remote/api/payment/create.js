export default async function handler(req, res){
  if(req.method !== 'POST'){
    res.setHeader('Allow','POST');
    return res.status(405).json({ ok:false, error:'Método não permitido' });
  }
  try{
    let MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || process.env.MERCADOPAGO_ACCESS_TOKEN || '';
    let PUBLIC_URL = process.env.PUBLIC_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '') || '';
    if(!MP_ACCESS_TOKEN){
      const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
      const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
      if(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY){
        try{
          const r = await fetch(`${SUPABASE_URL}/rest/v1/app_config?id=eq.global&select=mp_access_token,public_url`,{ headers:{ apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Accept:'application/json' } });
          if(r.ok){ const j = await r.json(); const row = Array.isArray(j)&&j.length?j[0]:null; MP_ACCESS_TOKEN = row?.mp_access_token || ''; if(!PUBLIC_URL) PUBLIC_URL = row?.public_url || ''; }
        }catch(_){ /* ignore */ }
      }
      if(!MP_ACCESS_TOKEN){ return res.status(500).json({ ok:false, error:'MP_ACCESS_TOKEN não configurado' }); }
    }
    // Se PUBLIC_URL seguir vazio, notificar para evitar webhook sem destino
    if(!PUBLIC_URL){
      console.warn('PUBLIC_URL não configurado — webhook pode não ser entregue');
    }
    const body = await readBody(req);
    const plan = String(body?.plan||'').toLowerCase();
    const userId = String(body?.userId||'').trim();
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
    const uuidForSub = toUuidStable(userId);
    const PLAN_PRICES = { mensal: 19.90, trimestral: 49.90, anual: 147.90 };
    const amount = PLAN_PRICES[plan];
    if(!userId || !amount){
      return res.status(400).json({ ok:false, error:'Parâmetros inválidos (userId/plan)' });
    }
    let emailDomain = 'gouflix.app';
    try{ if(PUBLIC_URL){ const u = new URL(PUBLIC_URL); if(u.hostname && u.hostname.includes('.')) emailDomain = u.hostname; } }catch(_){}
    const safeUser = String(userId).replace(/[^a-zA-Z0-9_.+-]/g,'_');
    const payerEmail = `${safeUser}@${emailDomain}`;
    const preference = {
      transaction_amount: Number(amount.toFixed(2)),
      description: `Assinatura GouFlix — ${plan}`,
      payment_method_id: 'pix',
      payer: { email: payerEmail },
      notification_url: PUBLIC_URL ? `${PUBLIC_URL}/api/webhook/mercadopago` : undefined,
      external_reference: `${uuidForSub}|${plan}|${Date.now()}`
    };
    const r = await fetch('https://api.mercadopago.com/v1/payments',{
      method:'POST',
      headers:{
        'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
        'Content-Type':'application/json',
        'X-Idempotency-Key': preference.external_reference
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
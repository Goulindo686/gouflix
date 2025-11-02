export default async function handler(req, res){
  try{
    const route = String(req.query?.route||'').toLowerCase();
    if(req.method === 'POST' || route === 'create'){
      // ----- Create (PIX) -----
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
      if(!PUBLIC_URL){ console.warn('PUBLIC_URL não configurado — webhook pode não ser entregue'); }
      const body = await readBody(req);
      const plan = String(body?.plan||'').toLowerCase();
      const userId = String(body?.userId||'').trim();
      const PLAN_PRICES = { mensal: 19.90, trimestral: 49.90, anual: 147.90 };
      const amount = PLAN_PRICES[plan];
      if(!userId || !amount){ return res.status(400).json({ ok:false, error:'Parâmetros inválidos' }); }
      // Definir um e-mail de payer válido (MP exige payer para PIX)
      let emailDomain = 'gouflix.app';
      try{
        if(PUBLIC_URL){
          const u = new URL(PUBLIC_URL);
          if(u.hostname && u.hostname.includes('.')) emailDomain = u.hostname;
        }
      }catch(_){ /* ignore */ }
      const safeUser = String(userId).replace(/[^a-zA-Z0-9_.+-]/g,'_');
      const payerEmail = `${safeUser}@${emailDomain}`;
      const payload = {
        transaction_amount: Number(Number(amount).toFixed(2)),
        description: `Assinatura Gouflix - ${plan}`,
        payment_method_id: 'pix',
        payer: { email: payerEmail },
        external_reference: `${userId}|${plan}|${Date.now()}`,
        notification_url: PUBLIC_URL ? `${PUBLIC_URL}/api/webhook/mercadopago` : undefined
      };
      const r = await fetch('https://api.mercadopago.com/v1/payments',{
        method:'POST',
        headers:{ 'Authorization': `Bearer ${MP_ACCESS_TOKEN}`, 'Content-Type':'application/json', 'X-Idempotency-Key': payload.external_reference },
        body: JSON.stringify(payload)
      });
      const json = await r.json();
      if(!r.ok){ return res.status(r.status).json({ ok:false, error: json?.message || 'Falha ao criar pagamento', details: json }); }
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
    }
    if(req.method === 'GET' || route === 'status'){
      // ----- Status -----
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
      if(!id){ return res.status(400).json({ ok:false, error:'Informe id do pagamento' }); }
      const r = await fetch(`https://api.mercadopago.com/v1/payments/${id}`,{ headers:{ 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` } });
      const json = await r.json();
      if(!r.ok){ return res.status(r.status).json({ ok:false, error: json?.message || 'Falha ao consultar pagamento', details: json }); }
      return res.status(200).json({ ok:true, id: json.id, status: json.status, status_detail: json.status_detail });
    }
    res.setHeader('Allow','GET, POST');
    return res.status(405).json({ ok:false, error:'Método não permitido' });
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
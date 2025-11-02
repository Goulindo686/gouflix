export default async function handler(req, res){
  try{
    const route = String(req.query?.route||'').toLowerCase();
    const SUNIZE_BASE = process.env.SUNIZE_BASE_URL || 'https://api.sunize.com.br/v1';
    let PUBLIC_URL = process.env.PUBLIC_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '') || '';
    // Sunize Auth: prefer Basic com CLIENT KEY/SECRET; manter fallback para API SECRET (Bearer)
    let SUNIZE_CLIENT_KEY = process.env.SUNIZE_CLIENT_KEY || '';
    let SUNIZE_CLIENT_SECRET = process.env.SUNIZE_CLIENT_SECRET || '';
    let SUNIZE_API_SECRET = process.env.SUNIZE_API_SECRET || '';
    if(!(SUNIZE_CLIENT_KEY && SUNIZE_CLIENT_SECRET) && !SUNIZE_API_SECRET){
      // Tentar obter do Supabase app_config
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
    }

    // Cache simples de token em memória (Vercel instancia por execução)
    let SUNIZE_TOKEN_CACHE = { token: '', expiresAt: 0 };

    async function getSunizeAccessToken(){
      const now = Date.now();
      if(SUNIZE_TOKEN_CACHE.token && SUNIZE_TOKEN_CACHE.expiresAt > now + 5000){
        return SUNIZE_TOKEN_CACHE.token;
      }
      if(SUNIZE_API_SECRET){
        SUNIZE_TOKEN_CACHE = { token: SUNIZE_API_SECRET, expiresAt: now + (60*60*1000) };
        return SUNIZE_API_SECRET;
      }
      if(!(SUNIZE_CLIENT_KEY && SUNIZE_CLIENT_SECRET)){
        throw new Error('Credenciais Sunize ausentes');
      }
      const basic = Buffer.from(`${SUNIZE_CLIENT_KEY}:${SUNIZE_CLIENT_SECRET}`).toString('base64');
      const candidates = [
        `${SUNIZE_BASE}/oauth/token`,
        `${SUNIZE_BASE}/auth/oauth/v2/token`,
        `${SUNIZE_BASE}/auth/token`
      ];
      let lastErr = null;
      for(const url of candidates){
        try{
          const r = await fetch(url,{
            method:'POST',
            headers:{ 'Authorization': `Basic ${basic}`, 'Content-Type':'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type:'client_credentials' }).toString()
          });
          const j = await r.json().catch(()=>({}));
          if(r.ok && (j.access_token || j.token)){
            const token = j.access_token || j.token;
            const expiresSec = Number(j.expires_in||3600);
            SUNIZE_TOKEN_CACHE = { token, expiresAt: Date.now() + (expiresSec*1000) };
            return token;
          }
          lastErr = new Error(`Falha ao obter token Sunize em ${url}: ${j.error||j.message||r.status}`);
        }catch(err){ lastErr = err; }
      }
      throw lastErr || new Error('Falha ao obter token Sunize');
    }

    async function buildSunizeHeaders(){
      const headers = {};
      const token = await getSunizeAccessToken();
      headers['Authorization'] = `Bearer ${token}`;
      return headers;
    }
    if(req.method === 'POST' || route === 'create'){
      if(!(SUNIZE_CLIENT_KEY && SUNIZE_CLIENT_SECRET) && !SUNIZE_API_SECRET){
        return res.status(500).json({ ok:false, error:'Credenciais Sunize não configuradas (SUNIZE_CLIENT_KEY/SUNIZE_CLIENT_SECRET ou SUNIZE_API_SECRET)' });
      }
      const body = await readBody(req);
      const plan = String(body?.plan||'').toLowerCase();
      const userId = String(body?.userId||'').trim();
      const PLAN_PRICES = { mensal: 19.90, trimestral: 49.90, anual: 147.90 };
      const amount = PLAN_PRICES[plan];
      if(!userId || !amount){ return res.status(400).json({ ok:false, error:'Parâmetros inválidos' }); }
      let emailDomain = 'gouflix.app';
      try{
        if(PUBLIC_URL){
          const u = new URL(PUBLIC_URL);
          if(u.hostname && u.hostname.includes('.')) emailDomain = u.hostname;
        }
      }catch(_){ /* ignore */ }
      const safeUser = String(userId).replace(/[^a-zA-Z0-9_.+-]/g,'_');
      const customerEmail = `${safeUser}@${emailDomain}`;
      const externalId = `${userId}|${plan}|${Date.now()}`;
      // Monta payload Sunize
      const payload = {
        external_id: externalId,
        total_amount: Number(Number(amount).toFixed(2)),
        payment_method: 'PIX',
        items: [
          { id: `plan_${plan}`, title: `Assinatura GouFlix — ${plan}`, description: `Plano ${plan}`, price: Number(Number(amount).toFixed(2)), quantity: 1, is_physical: false }
        ],
        ip: (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString(),
        customer: { name: safeUser, email: customerEmail }
      };
      const r = await fetch(`${SUNIZE_BASE}/transactions`,{
        method:'POST',
        headers:{ ...(await buildSunizeHeaders()), 'Content-Type':'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await r.json().catch(()=>({}));
      if(!r.ok){ return res.status(r.status||500).json({ ok:false, error: json?.message || json?.error_description || 'Falha ao criar transação Sunize', details: json }); }
      // Tenta mapear possíveis campos de PIX
      const pix = json.pix || json.payment || {};
      const ticketUrl = json.ticket_url || json.payment_url || json.url || null;
      const out = {
        ok:true,
        id: json.id || json.transaction_id || null,
        status: json.status || 'PENDING',
        qr_code_base64: pix.qr_code_base64 || json.qr_code_base64 || null,
        qr_code: pix.code || json.qr_code || json.emv || null,
        payment_url: ticketUrl,
        external_reference: externalId
      };
      return res.status(200).json(out);
    }
    if(req.method === 'GET' || route === 'status'){
      if(!(SUNIZE_CLIENT_KEY && SUNIZE_CLIENT_SECRET) && !SUNIZE_API_SECRET){
        return res.status(500).json({ ok:false, error:'Credenciais Sunize não configuradas (SUNIZE_CLIENT_KEY/SUNIZE_CLIENT_SECRET ou SUNIZE_API_SECRET)' });
      }
      const id = req.query?.id || req.query?.paymentId;
      if(!id){ return res.status(400).json({ ok:false, error:'Informe id da transação' }); }
      const r = await fetch(`${SUNIZE_BASE}/transactions/${encodeURIComponent(String(id))}`,{ headers: { ...(await buildSunizeHeaders()) } });
      const json = await r.json().catch(()=>({}));
      if(!r.ok){ return res.status(r.status||500).json({ ok:false, error: json?.message || json?.error_description || 'Falha ao consultar transação Sunize', details: json }); }
      return res.status(200).json({ ok:true, id: json.id || id, status: json.status || 'PENDING' });
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
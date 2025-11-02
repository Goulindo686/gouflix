export default async function handler(req, res){
  if(req.method !== 'POST'){
    res.setHeader('Allow','POST');
    return res.status(405).json({ ok:false, error:'Método não permitido' });
  }
  try{
    const tokenEnv = process.env.SUNIZE_WEBHOOK_TOKEN || '';
    const tokenHdr = (req.headers['x-sunize-token'] || req.headers['x-token'] || '').toString();
    const tokenQry = (req.query && req.query.token) ? String(req.query.token) : '';
    if(tokenEnv){
      const provided = tokenHdr || tokenQry;
      if(!provided || String(provided) !== String(tokenEnv)){
        return res.status(401).json({ ok:false, error:'Token inválido no webhook' });
      }
    }

    const body = await readBody(req);
    // Tentar mapear campos comuns de eventos Sunize
    const event = normalizeStr(body.event || body.type || body.status_event || '');
    const status = normalizeStr(body.status || body.payment_status || '');
    const productName = String(
      body.product || body.product_name || (body.product && body.product.name) || body.plan_name || body.item_name || ''
    );
    const buyer = body.buyer || body.client || body.customer || {};
    const email = String(buyer.email || body.email || '').trim().toLowerCase();

    const plan = detectPlanFromProduct(productName);
    if(!plan){
      return res.status(200).json({ ok:true, skipped:true, reason:'Produto não reconhecido' });
    }

    if(!email){
      return res.status(200).json({ ok:true, skipped:true, reason:'E-mail do comprador ausente' });
    }

    const shouldActivate = isApproved(event, status);
    const shouldDeactivate = isCanceled(event, status);

    if(!shouldActivate && !shouldDeactivate){
      return res.status(200).json({ ok:true, ignored:true });
    }

    // Construir URL absoluta para chamar /api/subscription
    // Prioriza PUBLIC_URL; se VERCEL_URL vier sem protocolo, prefixa https; caso contrário usa host/protocolo do request
    const rawBase = (process.env.PUBLIC_URL || process.env.VERCEL_URL || '').trim();
    let API_BASE = '';
    if (rawBase) {
      API_BASE = rawBase.startsWith('http') ? rawBase : `https://${rawBase}`;
    } else {
      const proto = String(req.headers['x-forwarded-proto'] || 'https');
      const host = String(req.headers['host'] || '').trim();
      if (host) API_BASE = `${proto}://${host}`;
    }
    const endpoint = '/api/subscription';
    const url = API_BASE ? `${API_BASE}${endpoint}` : `${endpoint}`;
    const payload = shouldActivate
      ? { action:'activate', userId: email, plan }
      : { action:'deactivate', userId: email };
    try{
      const r = await fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
      if(!r.ok){ const tx = await r.text(); return res.status(r.status).json({ ok:false, error:'Falha ao atualizar assinatura', details: tx }); }
    }catch(err){ return res.status(500).json({ ok:false, error:'Erro ao chamar assinatura', details: err.message }); }

    return res.status(200).json({ ok:true, processed:true, plan, email, action: shouldActivate?'activate':'deactivate' });
  }catch(err){ return res.status(500).json({ ok:false, error: err.message }); }
}

function normalizeStr(s){ return String(s||'').trim().toLowerCase(); }
function detectPlanFromProduct(name){
  const n = normalizeStr(name);
  if(!n) return null;
  if(n.includes('mensal')) return 'mensal';
  if(n.includes('trimestral')) return 'trimestral';
  if(n.includes('anual')) return 'anual';
  // fallback por ids no nome
  if(n.includes('month')) return 'mensal';
  if(n.includes('quarter')) return 'trimestral';
  if(n.includes('year')) return 'anual';
  return null;
}
function isApproved(event, status){
  const e = normalizeStr(event);
  const s = normalizeStr(status);
  return (
    e.includes('compra aprovada') || e.includes('assinatura renovada') || s==='approved' || s==='paid' || s==='confirmed'
  );
}
function isCanceled(event, status){
  const e = normalizeStr(event);
  const s = normalizeStr(status);
  return (
    e.includes('assinatura cancelada') || e.includes('chargeback') || e.includes('reembolso') || s==='canceled' || s==='refunded'
  );
}

async function readBody(req){
  return await new Promise((resolve)=>{
    let data='';
    req.on('data',chunk=> data+=chunk);
    req.on('end',()=>{ try{ resolve(JSON.parse(data||'{}')); }catch(_){ resolve({}); } });
  });
}
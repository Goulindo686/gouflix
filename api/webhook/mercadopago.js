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
    const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || process.env.MERCADOPAGO_ACCESS_TOKEN || '';
    if(!MP_ACCESS_TOKEN){ return res.status(500).json({ ok:false, error:'MP_ACCESS_TOKEN ausente' }); }
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
      // ativar assinatura
      try{
        const act = await fetch(`${process.env.PUBLIC_URL || ''}/api/subscription`,{
          method:'POST',
          headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify({ userId, plan, action:'activate' })
        });
        if(!act.ok){ console.error('Falha ao ativar assinatura via webhook', await act.text()); }
      }catch(err){ console.error('Erro ao ativar assinatura via webhook', err); }
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
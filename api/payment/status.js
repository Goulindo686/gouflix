export default async function handler(req, res){
  if(req.method !== 'GET'){
    res.setHeader('Allow','GET');
    return res.status(405).json({ ok:false, error:'Método não permitido' });
  }
  try{
    const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || process.env.MERCADOPAGO_ACCESS_TOKEN || '';
    if(!MP_ACCESS_TOKEN){
      return res.status(500).json({ ok:false, error:'MP_ACCESS_TOKEN não configurado' });
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
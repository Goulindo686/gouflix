import crypto from 'crypto';

function stableUuidFromAny(input){
  const ns = 'gouflix-user:' + String(input||'unknown');
  const bytes = crypto.createHash('sha1').update(ns).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = [...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
}

export default async function handler(req, res){
  if(req.method !== 'POST'){
    res.setHeader('Allow','POST');
    return res.status(405).json({ ok:false, error:'Método não permitido' });
  }
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const table = process.env.SUBSCRIPTIONS_TABLE || 'subscriptions';
  if(!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY){
    return res.status(200).json({ ok:false, error:'Supabase não configurado' });
  }
  try{
    const body = (typeof req.body === 'object' && req.body) ? req.body : JSON.parse(req.body||'{}');
    const id = body.id || null;
    const userIdInput = body.userId || null;
    const userUuid = userIdInput ? stableUuidFromAny(userIdInput) : null;
    // Localiza a linha alvo
    let query = `${SUPABASE_URL}/rest/v1/${table}?select=*`;
    if(id){
      query += `&id=eq.${encodeURIComponent(id)}`;
    }else if(userUuid){
      // Pega a mais recente e ativa
      query += `&user_id=eq.${encodeURIComponent(userUuid)}&or=(status.eq.active,active.eq.true)&order=updated_at.desc&limit=1`;
    }else{
      return res.status(400).json({ ok:false, error:'Informe id ou userId' });
    }
    const rGet = await fetch(query,{
      headers:{ apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Accept:'application/json' }
    });
    if(!rGet.ok){ const tx = await rGet.text(); return res.status(rGet.status).json({ ok:false, error:'Falha ao localizar assinatura', details: tx }); }
    const rows = await rGet.json();
    const target = Array.isArray(rows) ? rows[0] : null;
    if(!target){ return res.status(404).json({ ok:false, error:'Assinatura não encontrada' }); }
    const targetId = target.id;
    // Decide quais campos atualizar conforme existem no row
    const update = {};
    if(Object.prototype.hasOwnProperty.call(target,'status')) update.status = 'inactive';
    if(Object.prototype.hasOwnProperty.call(target,'active')) update.active = false;
    const nowIso = new Date().toISOString();
    if(Object.prototype.hasOwnProperty.call(target,'end_at')) update.end_at = nowIso;
    if(Object.prototype.hasOwnProperty.call(target,'end_date')) update.end_date = nowIso;
    if(Object.keys(update).length === 0){
      // Se não há campos conhecidos, ainda assim tenta atualizar status
      update.status = 'inactive';
    }
    const patchUrl = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(targetId)}`;
    const rPatch = await fetch(patchUrl,{
      method:'PATCH',
      headers:{
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type':'application/json',
        Accept:'application/json',
        Prefer:'return=representation'
      },
      body: JSON.stringify(update)
    });
    if(!rPatch.ok){ const tx = await rPatch.text(); return res.status(rPatch.status).json({ ok:false, error:'Falha ao desativar assinatura', details: tx }); }
    const updated = await rPatch.json();
    return res.status(200).json({ ok:true, item: Array.isArray(updated) ? updated[0] : updated });
  }catch(err){
    return res.status(500).json({ ok:false, error: err.message });
  }
}
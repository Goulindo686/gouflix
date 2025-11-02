const PLAN_DURATIONS = { mensal: 30, trimestral: 90, anual: 365 };
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

export default async function handler(req, res){
  if(req.method !== 'POST'){
    res.setHeader('Allow','POST');
    return res.status(405).json({ ok:false, error:'Método não permitido' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
  const table = process.env.SUBSCRIPTIONS_TABLE || 'subscriptions';

  try{
    const body = await readBody(req);
    const status = body?.status || body?.data?.status || body?.transaction_status || body?.data?.transaction_status || '';
    const externalRef = body?.external_reference || body?.external_id || body?.data?.external_reference || body?.data?.external_id || '';
    const txId = body?.id || body?.transaction_id || body?.data?.id || body?.data?.transaction_id || null;
    if(!externalRef){ return res.status(400).json({ ok:false, error:'external_reference ausente no webhook' }); }

    const parts = String(externalRef).split('|');
    const userId = parts[0] || '';
    const plan = (parts[1] || '').toLowerCase();
    if(!userId || !plan){ return res.status(400).json({ ok:false, error:'external_reference inválido (esperado userId|plan|...)' }); }

    if(!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY){
      return res.status(200).json({ ok:true, received:true, note:'Supabase não configurado; evento ignorado', id: txId, status, userId, plan });
    }

    const uid = toUuidStable(userId);
    const statusUp = String(status||'').toUpperCase();
    const isPaid = ['AUTHORIZED','PAID','CONFIRMED','APPROVED'].includes(statusUp);
    const isFailed = ['FAILED','CHARGEBACK','CANCELED','CANCELLED'].includes(statusUp);

    if(isPaid){
      const duration = PLAN_DURATIONS[plan] || 30;
      const start = new Date();
      const end = new Date(start.getTime() + duration*24*60*60*1000);
      const startIso = start.toISOString();
      const endIso = end.toISOString();
      const payloadA = [{ user_id: uid, plan, status:'active', start_date: startIso, end_date: endIso, payment_id: txId }];
      let r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=user_id`,{
        method:'POST',
        headers:{ apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type':'application/json', Prefer:'resolution=merge-duplicates' },
        body: JSON.stringify(payloadA)
      });
      if(!r.ok){
        const payloadB = [{ user_id: uid, plan_id: plan, active: true, start_at: startIso, end_at: endIso, payment_id: txId }];
        r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=user_id`,{
          method:'POST',
          headers:{ apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type':'application/json', Prefer:'resolution=merge-duplicates' },
          body: JSON.stringify(payloadB)
        });
      }
      if(!r.ok){ const tx = await r.text(); return res.status(r.status).json({ ok:false, error:'Falha ao ativar assinatura via webhook', details: tx }); }
      const out = await r.json();
      return res.status(200).json({ ok:true, action:'activate', item: Array.isArray(out)? out[0] : out });
    }

    if(isFailed){
      let q = `${SUPABASE_URL}/rest/v1/${table}?select=*`;
      q += `&user_id=eq.${encodeURIComponent(uid)}&or=(status.eq.active,active.eq.true)&order=updated_at.desc&limit=1`;
      const rGet = await fetch(q,{ headers:{ apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Accept:'application/json' } });
      if(!rGet.ok){ const tx = await rGet.text(); return res.status(rGet.status).json({ ok:false, error:'Falha ao localizar assinatura para desativar', details: tx }); }
      const rows = await rGet.json();
      const target = Array.isArray(rows) ? rows[0] : null;
      if(!target){ return res.status(200).json({ ok:true, action:'none', note:'Nenhuma assinatura ativa encontrada' }); }
      const update = {};
      if(Object.prototype.hasOwnProperty.call(target,'status')) update.status = 'inactive';
      if(Object.prototype.hasOwnProperty.call(target,'active')) update.active = false;
      const nowIso = new Date().toISOString();
      if(Object.prototype.hasOwnProperty.call(target,'end_at')) update.end_at = nowIso;
      if(Object.prototype.hasOwnProperty.call(target,'end_date')) update.end_date = nowIso;
      const patchUrl = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(target.id)}`;
      const rPatch = await fetch(patchUrl,{
        method:'PATCH',
        headers:{ apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type':'application/json', Accept:'application/json', Prefer:'return=representation' },
        body: JSON.stringify(update)
      });
      if(!rPatch.ok){ const tx = await rPatch.text(); return res.status(rPatch.status).json({ ok:false, error:'Falha ao desativar assinatura via webhook', details: tx }); }
      const updated = await rPatch.json();
      return res.status(200).json({ ok:true, action:'deactivate', item: Array.isArray(updated)? updated[0] : updated });
    }

    return res.status(200).json({ ok:true, action:'noop', id: txId, status });
  }catch(err){
    return res.status(500).json({ ok:false, error: err.message });
  }
}

async function readBody(req){
  if(req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try{ return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}'); }catch(_){ return {}; }
}
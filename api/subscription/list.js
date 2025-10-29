export default async function handler(req, res){
  if(req.method !== 'GET'){
    res.setHeader('Allow','GET');
    return res.status(405).json({ ok:false, error:'Método não permitido' });
  }
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const table = process.env.SUBSCRIPTIONS_TABLE || 'subscriptions';
  if(!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY){
    return res.status(200).json({ ok:true, items: [] });
  }
  try{
    const q = new URLSearchParams();
    const status = String(req.query?.status||'').toLowerCase(); // 'active' | 'inactive' | ''
    const limit = parseInt(String(req.query?.limit||'100'),10);
    const order = String(req.query?.order||'updated_at.desc');
    // Monta URL básica com select=* para compatibilidade de schema
    let url = `${SUPABASE_URL}/rest/v1/${table}?select=*`;
    // Filtro por status/active
    if(status === 'active'){
      url += `&or=(status.eq.active,active.eq.true)`;
    } else if(status === 'inactive'){
      url += `&or=(status.eq.inactive,active.eq.false)`;
    }
    // Ordenação
    const [col, dir] = order.split('.');
    if(col){ url += `&order=${encodeURIComponent(col)}.${encodeURIComponent(dir||'desc')}`; }
    // Limite
    if(limit){ url += `&limit=${limit}`; }
    const r = await fetch(url,{
      headers:{ apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Accept:'application/json' }
    });
    if(!r.ok){ const tx = await r.text(); return res.status(r.status).json({ ok:false, error:'Falha ao buscar assinaturas', details: tx }); }
    const rows = await r.json();
    // Normaliza saída
    const items = (Array.isArray(rows)?rows:[]).map(row=>{
      const start = row.start_date || row.start_at || null;
      const end = row.end_date || row.end_at || null;
      const plan = row.plan || row.plan_id || null;
      const active = (String(row.status||'').toLowerCase()==='active') || (!!row.active);
      return {
        id: row.id || null,
        user_id: row.user_id || null,
        plan,
        status: row.status || (row.active===true?'active':'inactive'),
        active,
        start,
        end,
        updated_at: row.updated_at || null,
        payment_id: row.payment_id || null
      };
    });
    return res.status(200).json({ ok:true, items });
  }catch(err){
    return res.status(500).json({ ok:false, error: err.message });
  }
}
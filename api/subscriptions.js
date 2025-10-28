export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const READ_KEY = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  const WRITE_KEY = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  const READY = !!(SUPABASE_URL && READ_KEY);

  try {
    if (req.method === 'GET') {
      if (!READY) return res.status(200).json({ ok: true, subscriptions: [] });
      const status = (req.query?.status || '').trim();
      const select = 'user_id,plan,start_at,end_at,status,payment_id';
      const base = `${SUPABASE_URL}/rest/v1/subscriptions?select=${select}`;
      const url = status ? `${base}&status=eq.${encodeURIComponent(status)}` : base;
      const r = await fetch(url, { headers: { 'apikey': READ_KEY, 'Authorization': `Bearer ${READ_KEY}`, 'Accept': 'application/json' } });
      if (!r.ok) {
        const text = await r.text();
        return res.status(r.status || 500).json({ ok: false, error: 'Falha ao listar assinaturas', details: text });
      }
      const rows = await r.json();
      return res.status(200).json({ ok: true, subscriptions: rows || [] });
    }

    if (req.method === 'PATCH') {
      if (!READY) return res.status(400).json({ ok: false, error: 'Supabase não configurado' });
      // Atualiza status de uma assinatura específica
      const body = await readBody(req);
      const userId = body?.userId;
      const status = body?.status;
      if (!userId || !status) return res.status(400).json({ ok: false, error: 'userId e status são obrigatórios' });
      const r = await fetch(`${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': WRITE_KEY,
          'Authorization': `Bearer ${WRITE_KEY}`,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) {
        const text = await r.text();
        return res.status(r.status || 500).json({ ok: false, error: 'Falha ao atualizar assinatura', details: text });
      }
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ ok: false, error: 'Método não permitido' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Erro interno em /api/subscriptions' });
  }
}

async function readBody(req){
  return await new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => { try { resolve(JSON.parse(data||'{}')); } catch (err) { reject(err); } });
    req.on('error', reject);
  });
}
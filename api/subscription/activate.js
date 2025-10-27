export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Método não permitido' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ ok: false, error: 'SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY não configurados' });
  }

  try {
    const body = await readBody(req);
    const paymentId = String(body?.paymentId || '');
    const status = body?.status || 'approved';
    const plan = body?.plan || null;
    const userId = body?.userId || null;
    if (!paymentId) return res.status(400).json({ ok: false, error: 'paymentId é obrigatório' });

    // Atualiza status no Supabase
    const url = `${SUPABASE_URL}/rest/v1/purchases?id=eq.${encodeURIComponent(paymentId)}`;
    const headers = {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Prefer': 'return=representation',
    };
    const updatePayload = { status };
    if (plan) updatePayload.plan = plan;
    if (userId) updatePayload.user_id = userId;

    const r = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify(updatePayload) });
    if (!r.ok) {
      const text = await r.text();
      return res.status(r.status || 500).json({ ok: false, error: 'Falha ao ativar assinatura', details: text });
    }
    const [row] = await r.json();
    return res.status(200).json({ ok: true, purchase: row });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Erro interno em /api/subscription/activate' });
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}
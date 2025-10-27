const PLAN_DURATIONS_DAYS = {
  mensal: 30,
  trimestral: 90,
  anual: 365,
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Método não permitido' });
  }

  const userId = req.query?.userId;
  if (!userId) return res.status(400).json({ ok: false, error: 'Parâmetro userId é obrigatório' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ ok: false, error: 'SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY não configurados' });
  }

  try {
    const url = `${SUPABASE_URL}/rest/v1/purchases?user_id=eq.${encodeURIComponent(userId)}&status=eq.approved&select=id,plan,created_at&order=created_at.desc`;
    const r = await fetch(url, {
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Accept': 'application/json',
      },
    });
    if (!r.ok) {
      const text = await r.text();
      return res.status(r.status || 500).json({ ok: false, error: 'Falha ao consultar compras aprovadas', details: text });
    }
    const rows = await r.json();
    const last = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (!last) return res.status(200).json({ ok: true, subscription: { active: false } });

    const plan = last.plan || 'mensal';
    const createdAt = new Date(last.created_at);
    let until;
    if (plan === 'test2min') {
      until = new Date(createdAt.getTime() + 2 * 60 * 1000);
    } else {
      const days = PLAN_DURATIONS_DAYS[plan] ?? 30;
      until = new Date(createdAt.getTime() + days * 24 * 60 * 60 * 1000);
    }
    const active = until.getTime() > Date.now();

    return res.status(200).json({ ok: true, subscription: { active, plan, until: until.toISOString() } });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Erro interno em /api/subscription' });
  }
}
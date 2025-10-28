export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Método não permitido' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ ok: false, error: 'SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY não configurados' });
  }

  try {
    const status = req.query?.status; // ex: approved, pending, rejected
    const limit = Math.min(parseInt(req.query?.limit || '100', 10), 500);
    const url = new URL(`${SUPABASE_URL}/rest/v1/purchases`);
    // Seleciona tudo para evitar erro quando a coluna 'amount' não existe no schema
    url.searchParams.set('select', '*');
    url.searchParams.set('order', 'created_at.desc');
    url.searchParams.set('limit', String(limit));
    if (status) url.searchParams.set('status', `eq.${status}`);

    const r = await fetch(url.toString(), {
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Accept': 'application/json',
      },
    });
    if (!r.ok) {
      const text = await r.text();
      return res.status(r.status || 500).json({ ok: false, error: 'Falha ao listar compras', details: text });
    }
    const rows = await r.json();
    // Normaliza campo amount para UI do Admin (usa amount, price, ou price_cents/100)
    const normalized = (Array.isArray(rows) ? rows : []).map((p) => {
      const amount =
        (p.amount != null ? Number(p.amount) : null) ??
        (p.price != null ? Number(p.price) : null) ??
        (p.price_cents != null ? Number(p.price_cents) / 100 : null);
      return { ...p, amount: amount != null ? amount : null };
    });
    return res.status(200).json({ ok: true, purchases: normalized });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Erro interno em /api/purchases' });
  }
}
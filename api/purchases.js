export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const SUPABASE_WRITE_KEY = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    // Para leitura, exigimos SERVICE_ROLE; para escrita, verificamos WRITE_KEY mais abaixo
    return res.status(500).json({ ok: false, error: 'SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY não configurados' });
  }

  try {
    if (req.method === 'GET') {
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
    }

    if (req.method === 'POST') {
      const action = (req.query?.action || '').toLowerCase();
      if (action !== 'update') {
        res.setHeader('Allow', 'GET, POST');
        return res.status(400).json({ ok: false, error: 'Ação inválida' });
      }
      if (!SUPABASE_URL || !SUPABASE_WRITE_KEY) {
        res.setHeader('Allow', 'POST');
        return res.status(500).json({ ok: false, error: 'SUPABASE_URL e chave de escrita do Supabase não configurados' });
      }

      const body = await readBody(req);
      const id = body?.id ? String(body.id) : null;
      const status = body?.status ? String(body.status) : null;
      const note = body?.note ? String(body.note) : null;
      if (!id) return res.status(400).json({ ok: false, error: 'Parâmetro id é obrigatório' });
      if (!status) return res.status(400).json({ ok: false, error: 'Parâmetro status é obrigatório' });
      if (!['pending','approved','cancelled','rejected'].includes(status)) {
        return res.status(400).json({ ok: false, error: 'Status inválido' });
      }

      // Atualiza a purchase no Supabase
      const headers = {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_WRITE_KEY,
        'Authorization': `Bearer ${SUPABASE_WRITE_KEY}`,
        'Accept': 'application/json',
        'Prefer': 'return=minimal',
      };
      const pUrl = `${SUPABASE_URL}/rest/v1/purchases?id=eq.${encodeURIComponent(id)}`;
      const patchPayload = note ? { status, note } : { status };
      const r = await fetch(pUrl, { method: 'PATCH', headers, body: JSON.stringify(patchPayload) });
      if (!r.ok) {
        const text = await r.text();
        return res.status(r.status || 500).json({ ok: false, error: 'Falha ao atualizar compra', details: text });
      }

      // Se aprovado, ativar assinatura automaticamente
      if (status === 'approved') {
        try {
          // Buscar dados da compra
          const rp = await fetch(`${SUPABASE_URL}/rest/v1/purchases?id=eq.${encodeURIComponent(id)}&select=user_id,plan`, {
            headers: { 'apikey': SUPABASE_WRITE_KEY, 'Authorization': `Bearer ${SUPABASE_WRITE_KEY}`, 'Accept': 'application/json' },
          });
          if (rp.ok) {
            const rows = await rp.json();
            const p = Array.isArray(rows) && rows.length ? rows[0] : null;
            const userId = p?.user_id ? String(p.user_id) : null;
            const plan = p?.plan ? String(p.plan) : null;
            if (userId && plan) {
              // Buscar duração do plano (compatível com 'days' ou 'duration_days'), com fallback
              let days = 30;
              try {
                const planUrl = `${SUPABASE_URL}/rest/v1/plans?id=eq.${encodeURIComponent(plan)}&select=days,duration_days`;
                const pr = await fetch(planUrl, { headers: { 'apikey': SUPABASE_WRITE_KEY, 'Authorization': `Bearer ${SUPABASE_WRITE_KEY}`, 'Accept': 'application/json' } });
                if (pr.ok) {
                  const arr = await pr.json();
                  const row = Array.isArray(arr) && arr.length ? arr[0] : null;
                  const d = (row?.days ?? row?.duration_days);
                  if (typeof d === 'number' && d > 0) days = d;
                }
              } catch {}

              const startAt = new Date();
              const endAt = new Date(startAt.getTime() + days * 24 * 60 * 60 * 1000);
              await fetch(`${SUPABASE_URL}/rest/v1/subscriptions?on_conflict=user_id`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'apikey': SUPABASE_WRITE_KEY,
                  'Authorization': `Bearer ${SUPABASE_WRITE_KEY}`,
                  'Prefer': 'resolution=merge-duplicates',
                },
                body: JSON.stringify({ user_id: userId, plan, start_at: startAt.toISOString(), end_at: endAt.toISOString(), status: 'active', payment_id: id }),
              });
            }
          }
        } catch {}
      }

      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Método não permitido' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Erro interno em /api/purchases' });
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}
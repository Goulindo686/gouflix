export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.setHeader('Allow', 'POST');
    return res.status(500).json({ ok: false, error: 'SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY não configurados' });
  }

  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false, error: 'Método não permitido' });
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
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
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
          headers: { 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Accept': 'application/json' },
        });
        if (rp.ok) {
          const rows = await rp.json();
          const p = Array.isArray(rows) && rows.length ? rows[0] : null;
          const userId = p?.user_id ? String(p.user_id) : null;
          const plan = p?.plan ? String(p.plan) : null;
          if (userId && plan && ['mensal','trimestral','anual'].includes(plan)) {
            // Buscar duração do plano (compatível com 'days' ou 'duration_days'), com fallback
            let days = 30;
            try {
              const planUrl = `${SUPABASE_URL}/rest/v1/plans?id=eq.${encodeURIComponent(plan)}&select=days,duration_days`;
              const pr = await fetch(planUrl, { headers: { 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Accept': 'application/json' } });
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
                'apikey': SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                'Prefer': 'resolution=merge-duplicates',
              },
              body: JSON.stringify({ user_id: userId, plan, start_at: startAt.toISOString(), end_at: endAt.toISOString(), status: 'active', payment_id: id }),
            });
          }
        }
      } catch {}
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Erro interno em /api/purchases/update' });
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}
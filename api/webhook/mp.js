export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Método não permitido' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ENV_MP_TOKEN = process.env.MP_ACCESS_TOKEN || process.env.MERCADO_PAGO_ACCESS_TOKEN;
  const WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET || null;

  try {
    // Validação simples por segredo em querystring (opcional)
    const provided = req.query?.secret || null;
    if (WEBHOOK_SECRET && provided !== WEBHOOK_SECRET) {
      return res.status(401).json({ ok: false, error: 'Segredo do webhook inválido' });
    }

    const body = await readBody(req);
    const paymentId = body?.data?.id || body?.id || null;
    if (!paymentId) {
      // Aceita, mas informa ausência de id
      return res.status(200).json({ ok: true, received: true, message: 'Webhook recebido sem payment id', body });
    }

    const mpToken = await getMpToken(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ENV_MP_TOKEN);
    if (!mpToken) {
      // Sem token, apenas reconhece recebimento para evitar reenvios infinitos
      return res.status(200).json({ ok: true, received: true, message: 'MP token ausente; não foi possível consultar status.' });
    }

    // Consulta detalhes do pagamento
    const r = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(String(paymentId))}`, {
      headers: { 'Authorization': `Bearer ${mpToken}`, 'Accept': 'application/json' },
    });
    const payment = r.ok ? await r.json() : null;
    const status = payment?.status || 'unknown';

    // Atualiza status em Supabase, e ativa assinatura se aprovado
    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      try {
        // Atualiza purchase
        await fetch(`${SUPABASE_URL}/rest/v1/purchases?id=eq.${encodeURIComponent(String(paymentId))}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({ status }),
        });

        if (status === 'approved') {
          // Carrega purchase para obter user/plan
          const rp = await fetch(`${SUPABASE_URL}/rest/v1/purchases?id=eq.${encodeURIComponent(String(paymentId))}&select=user_id,plan`, {
            headers: { 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Accept': 'application/json' },
          });
          if (rp.ok) {
            const rows = await rp.json();
            let p = Array.isArray(rows) && rows.length ? rows[0] : null;
            // Fallback: se a compra não tiver user/plan, tente external_reference
            if ((!p || !p.user_id || !p.plan) && payment?.external_reference) {
              const parts = String(payment.external_reference).split(':');
              const refUser = parts[0];
              const refPlan = parts[1];
              if (refUser && refPlan) {
                // Upsert da purchase para manter admin consistente
                await fetch(`${SUPABASE_URL}/rest/v1/purchases?on_conflict=id`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'apikey': SUPABASE_SERVICE_ROLE_KEY,
                    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                    'Prefer': 'resolution=merge-duplicates',
                  },
                  body: JSON.stringify({ id: String(paymentId), user_id: String(refUser), plan: String(refPlan), status: 'approved' }),
                });
                p = { user_id: String(refUser), plan: String(refPlan) };
              }
            }
            if (p && p.user_id && p.plan) {
              const plan = String(p.plan);
              const startAt = new Date();
              const map = { mensal: 30, trimestral: 90, anual: 365 };
              const days = map[plan] ?? 30;
              const endAt = new Date(startAt.getTime() + days * 24 * 60 * 60 * 1000);
              await fetch(`${SUPABASE_URL}/rest/v1/subscriptions?on_conflict=user_id`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'apikey': SUPABASE_SERVICE_ROLE_KEY,
                  'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                  'Prefer': 'resolution=merge-duplicates',
                },
                body: JSON.stringify({ user_id: String(p.user_id), plan, start_at: startAt.toISOString(), end_at: endAt.toISOString(), status: 'active', payment_id: String(paymentId) }),
              });
            }
          }
        }
      } catch {}
    }

    return res.status(200).json({ ok: true, received: true, status, paymentId });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Erro interno em /api/webhook/mp' });
  }
}

async function getMpToken(supabaseUrl, serviceKey, envToken) {
  if (envToken) return envToken;
  if (!supabaseUrl || !serviceKey) return null;
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/app_config?id=eq.global&select=mp_token`, {
      headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}`, 'Accept': 'application/json' },
    });
    if (!r.ok) return null;
    const data = await r.json();
    const row = Array.isArray(data) && data.length ? data[0] : null;
    return row?.mp_token || null;
  } catch {
    return null;
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
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Método não permitido' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY; // fallback para leitura pública
  const SUPABASE_WRITE_KEY = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  const ENV_MP_TOKEN = process.env.MP_ACCESS_TOKEN || process.env.MERCADO_PAGO_ACCESS_TOKEN;
  const WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET || null;

  try {
    // Observabilidade básica
    console.log('[MP Webhook] headers', req.headers);
    // Validação simples por segredo em querystring (opcional)
    const provided = req.query?.secret || null;
    if (WEBHOOK_SECRET && provided !== WEBHOOK_SECRET) {
      console.warn('[MP Webhook] Segredo inválido');
      return res.status(401).json({ ok: false, error: 'Segredo do webhook inválido' });
    }

    const body = await readBody(req);
    console.log('[MP Webhook] body', body);
    const paymentId = body?.data?.id || body?.id || null;
    if (!paymentId) {
      // Aceita, mas informa ausência de id
      return res.status(200).json({ ok: true, received: true, message: 'Webhook recebido sem payment id', body });
    }

    const mpToken = await getMpToken(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ENV_MP_TOKEN, SUPABASE_ANON_KEY);
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
    console.log('[MP Webhook] paymentId', paymentId, 'status', status);

    // Atualiza status em Supabase, e ativa assinatura se aprovado
    if (SUPABASE_URL && SUPABASE_WRITE_KEY) {
      try {
        // Upsert da purchase com status atual (garante registro mesmo se criação falhou)
        const baseRow = { id: String(paymentId), status };
        // Se houver external_reference, tentar preencher user/plan
        try {
          const ext = payment?.external_reference ? String(payment.external_reference) : '';
          if (ext) {
            const parts = ext.split(':');
            if (parts[0]) baseRow.user_id = String(parts[0]);
            if (parts[1]) baseRow.plan = String(parts[1]);
          }
        } catch (_) {}
        await fetch(`${SUPABASE_URL}/rest/v1/purchases?on_conflict=id`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_WRITE_KEY,
            'Authorization': `Bearer ${SUPABASE_WRITE_KEY}`,
            'Prefer': 'resolution=merge-duplicates',
          },
          body: JSON.stringify(baseRow),
        });

        if (status === 'approved') {
          // Carrega purchase para obter user/plan
          const rp = await fetch(`${SUPABASE_URL}/rest/v1/purchases?id=eq.${encodeURIComponent(String(paymentId))}&select=user_id,plan`, {
            headers: { 'apikey': SUPABASE_WRITE_KEY, 'Authorization': `Bearer ${SUPABASE_WRITE_KEY}`, 'Accept': 'application/json' },
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
                    'apikey': SUPABASE_WRITE_KEY,
                    'Authorization': `Bearer ${SUPABASE_WRITE_KEY}`,
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
              // Busca duração do plano no Supabase (compatível com 'days' ou 'duration_days')
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
              // Fallback: map padrão para planos conhecidos
              if (days === 30) {
                const map = { mensal: 30, trimestral: 90, anual: 365 };
                if (map[plan]) days = map[plan];
              }
              const endAt = new Date(startAt.getTime() + days * 24 * 60 * 60 * 1000);
              await fetch(`${SUPABASE_URL}/rest/v1/subscriptions?on_conflict=user_id`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'apikey': SUPABASE_WRITE_KEY,
                  'Authorization': `Bearer ${SUPABASE_WRITE_KEY}`,
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
    console.error('[MP Webhook] Erro', err);
    return res.status(500).json({ ok: false, error: err?.message || 'Erro interno em /api/webhook/mp' });
  }
}

async function getMpToken(supabaseUrl, serviceKey, envToken, anonKey) {
  if (envToken) return envToken;
  // Primeiro tenta com Service Role
  if (supabaseUrl && serviceKey) {
    try {
      const r = await fetch(`${supabaseUrl}/rest/v1/app_config?id=eq.global&select=mp_token`, {
        headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}`, 'Accept': 'application/json' },
      });
      if (r.ok) {
        const data = await r.json();
        const row = Array.isArray(data) && data.length ? data[0] : null;
        if (row?.mp_token) return row.mp_token;
      }
    } catch {}
  }
  // Fallback com ANON KEY (caso a tabela seja legível publicamente)
  if (supabaseUrl && anonKey) {
    try {
      const r = await fetch(`${supabaseUrl}/rest/v1/app_config?id=eq.global&select=mp_token`, {
        headers: { 'apikey': anonKey, 'Authorization': `Bearer ${anonKey}`, 'Accept': 'application/json' },
      });
      if (r.ok) {
        const data = await r.json();
        const row = Array.isArray(data) && data.length ? data[0] : null;
        if (row?.mp_token) return row.mp_token;
      }
    } catch {}
  }
  return null;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  // Tenta JSON primeiro
  try { return JSON.parse(raw); } catch {}
  // Tenta URL-encoded (alguns provedores enviam assim)
  try {
    const params = new URLSearchParams(raw);
    const obj = {};
    for (const [k, v] of params.entries()) obj[k] = v;
    // Normaliza estruturas comuns (data.id)
    if (obj['data.id'] && !obj.data) obj.data = { id: obj['data.id'] };
    if (obj['id'] && !obj.data) obj.id = obj['id'];
    return obj;
  } catch {}
  return {};
}
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Método não permitido' });
  }

  const id = req.query?.id;
  if (!id) {
    return res.status(400).json({ ok: false, error: 'Parâmetro id é obrigatório' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ENV_MP_TOKEN = process.env.MP_ACCESS_TOKEN || process.env.MERCADO_PAGO_ACCESS_TOKEN;
  const COOKIES = parseCookies(req.headers?.cookie || '');

  try {
    const mpToken = await getMpToken(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ENV_MP_TOKEN || COOKIES['mp_token']);
    if (!mpToken) {
      return res.status(400).json({ ok: false, error: 'MP_ACCESS_TOKEN não configurado' });
    }

    const r = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(id)}`, {
      headers: { 'Authorization': `Bearer ${mpToken}`, 'Accept': 'application/json' },
    });
    if (!r.ok) {
      const text = await r.text();
      return res.status(r.status || 500).json({ ok: false, error: 'Falha ao consultar status', details: text });
    }
    const payment = await r.json();
    const status = payment?.status || 'unknown';

    // Sincroniza status na tabela purchases se possível
    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/purchases?id=eq.${encodeURIComponent(String(id))}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({ status }),
        });

        // Ativação automática server-side quando o pagamento aprovar
        if (status === 'approved') {
          // Buscar dados da compra para obter user_id e plan
          const rp = await fetch(`${SUPABASE_URL}/rest/v1/purchases?id=eq.${encodeURIComponent(String(id))}&select=user_id,plan`, {
            headers: { 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Accept': 'application/json' },
          });
          if (rp.ok) {
            const rows = await rp.json();
            let p = Array.isArray(rows) && rows.length ? rows[0] : null;
            // Fallback: tentar extrair de external_reference caso a compra esteja incompleta
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
                  body: JSON.stringify({ id: String(id), user_id: String(refUser), plan: String(refPlan), status: 'approved' }),
                });
                p = { user_id: String(refUser), plan: String(refPlan) };
              }
            }
            if (p && p.user_id && p.plan) {
              const plan = String(p.plan);
              const startAt = new Date();
              let endAt;
              if (plan === 'test2min') {
                endAt = new Date(startAt.getTime() + 2 * 60 * 1000);
              } else {
                // Tenta buscar duração do plano no Supabase (compatível com 'days' ou 'duration_days')
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
                endAt = new Date(startAt.getTime() + days * 24 * 60 * 60 * 1000);
              }
              await fetch(`${SUPABASE_URL}/rest/v1/subscriptions?on_conflict=user_id`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'apikey': SUPABASE_SERVICE_ROLE_KEY,
                  'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                  'Prefer': 'resolution=merge-duplicates',
                },
                body: JSON.stringify({ user_id: String(p.user_id), plan, start_at: startAt.toISOString(), end_at: endAt.toISOString(), status: 'active', payment_id: String(id) }),
              });
            }
          }
        }
      } catch {}
    }

    return res.status(200).json({ ok: true, status, payment });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Erro interno em /api/payment/status' });
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

function parseCookies(str){
  const out = {};
  str.split(';').forEach(part=>{
    const [k,v] = part.split('=');
    if(!k) return;
    out[k.trim()] = decodeURIComponent((v||'').trim());
  });
  return out;
}
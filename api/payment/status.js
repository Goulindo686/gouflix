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

  try {
    const mpToken = await getMpToken(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ENV_MP_TOKEN);
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
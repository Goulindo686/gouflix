export default async function handler(req, res) {
  const method = req.method;
  if (method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Método não permitido' });
  }

  try {
    const SUNIZE_API_BASE = process.env.SUNIZE_API_BASE || 'https://api.sunize.com.br/v1';
    const PUBLIC_URL = process.env.PUBLIC_URL || process.env.NEXT_PUBLIC_SITE_URL || null;

    // Buscar credenciais Sunize do Supabase (app_config) ou das envs
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || null;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || null;
    let SUNIZE_API_SECRET = process.env.SUNIZE_API_SECRET || '';
    let SUNIZE_CLIENT_KEY = process.env.SUNIZE_CLIENT_KEY || '';
    let SUNIZE_CLIENT_SECRET = process.env.SUNIZE_CLIENT_SECRET || '';
    if ((SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)) {
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/app_config?id=eq.global&select=sunize_api_secret,sunize_client_key,sunize_client_secret`, {
          headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Accept: 'application/json' }
        });
        if (r.ok) {
          const data = await r.json();
          const row = Array.isArray(data) && data.length ? data[0] : null;
          SUNIZE_API_SECRET = SUNIZE_API_SECRET || row?.sunize_api_secret || '';
          SUNIZE_CLIENT_KEY = SUNIZE_CLIENT_KEY || row?.sunize_client_key || '';
          SUNIZE_CLIENT_SECRET = SUNIZE_CLIENT_SECRET || row?.sunize_client_secret || '';
        }
      } catch (_) { /* ignore */ }
    }
    const hasBearer = !!SUNIZE_API_SECRET;
    const hasBasic = !!(SUNIZE_CLIENT_KEY && SUNIZE_CLIENT_SECRET);
    if (!hasBearer && !hasBasic) {
      return res.status(500).json({ ok: false, error: 'Credenciais Sunize não configuradas (Bearer ou client key/secret)' });
    }

    const body = await readBody(req);
    const plan = String(body?.plan || '').toLowerCase();
    const userId = String(body?.userId || '').trim();
    const PLAN_PRICES = { mensal: 19.90, trimestral: 49.90, anual: 147.90 };
    const amount = PLAN_PRICES[plan];
    if (!userId || !amount) {
      return res.status(400).json({ ok: false, error: 'Parâmetros inválidos (userId/plan)' });
    }

    const payload = {
      amount: Number(Number(amount).toFixed(2)),
      description: `Assinatura GouFlix — ${plan}`,
      external_reference: `${userId}|${plan}|${Date.now()}`,
      callback_url: PUBLIC_URL ? `${PUBLIC_URL}/api/webhook/sunize` : undefined
    };

    const authValue = hasBearer ? `Bearer ${SUNIZE_API_SECRET}` : `Basic ${Buffer.from(`${SUNIZE_CLIENT_KEY}:${SUNIZE_CLIENT_SECRET}`).toString('base64')}`;
    const r = await fetch(`${SUNIZE_API_BASE}/transactions`, {
      method: 'POST',
      headers: { 'Authorization': authValue, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await readJsonSafe(r);
    if (!r.ok) {
      return res.status(r.status || 500).json({ ok: false, error: json?.message || 'Falha ao criar transação', details: json });
    }
    const out = normalizeSunizeCreate(json);
    return res.status(200).json({ ok: true, ...out });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

function normalizeSunizeCreate(json) {
  const id = json?.id || json?.transaction_id || json?.data?.id || json?.data?.transaction_id;
  const qr = json?.pix_qr_code || json?.data?.pix_qr_code || json?.pix?.qr_code || json?.data?.pix?.qr_code;
  const qrbase64 = json?.pix_qr_code_base64 || json?.data?.pix_qr_code_base64 || json?.pix?.qr_code_base64 || json?.data?.pix?.qr_code_base64;
  const copiaecola = json?.pix_code || json?.data?.pix_code || json?.payload || json?.data?.payload;
  return { id, qr, qrbase64, copiaecola };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

async function readJsonSafe(res) {
  try { return await res.json(); } catch (_) { return {}; }
}
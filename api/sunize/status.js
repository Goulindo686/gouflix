export default async function handler(req, res) {
  const method = req.method;
  if (method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Método não permitido' });
  }

  try {
    const SUNIZE_API_BASE = process.env.SUNIZE_API_BASE || 'https://api.sunize.com.br/v1';

    // Buscar credenciais Sunize do Supabase (app_config) ou das envs
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || null;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || null;
    let SUNIZE_API_SECRET = process.env.SUNIZE_API_SECRET || '';
    let SUNIZE_CLIENT_KEY = process.env.SUNIZE_CLIENT_KEY || '';
    let SUNIZE_CLIENT_SECRET = process.env.SUNIZE_CLIENT_SECRET || '';
    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
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

    const params = new URLSearchParams(req.url.split('?')[1] || '');
    const id = params.get('id') || params.get('transactionId');
    if (!id) {
      return res.status(400).json({ ok: false, error: 'Informe id da transação' });
    }
    const authValue = hasBearer ? `Bearer ${SUNIZE_API_SECRET}` : `Basic ${Buffer.from(`${SUNIZE_CLIENT_KEY}:${SUNIZE_CLIENT_SECRET}`).toString('base64')}`;
    const r = await fetch(`${SUNIZE_API_BASE}/transactions/${encodeURIComponent(id)}`, {
      headers: { 'Authorization': authValue }
    });
    const json = await readJsonSafe(r);
    if (!r.ok) {
      return res.status(r.status || 500).json({ ok: false, error: json?.message || 'Falha ao consultar transação', details: json });
    }
    const status = json?.status || json?.data?.status || json?.transaction_status || json?.data?.transaction_status || null;
    return res.status(200).json({ ok: true, id, status });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

async function readJsonSafe(res) {
  try { return await res.json(); } catch (_) { return {}; }
}
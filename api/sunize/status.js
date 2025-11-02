export default async function handler(req, res) {
  const method = req.method;
  if (method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Método não permitido' });
  }

  try {
    const SUNIZE_API_BASE = process.env.SUNIZE_API_BASE || 'https://api.sunize.com.br/v1';

    // Buscar segredo Sunize do Supabase (app_config) ou das envs
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || null;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || null;
    let SUNIZE_API_SECRET = process.env.SUNIZE_API_SECRET || '';
    if (!SUNIZE_API_SECRET && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/app_config?id=eq.global&select=sunize_api_secret`, {
          headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Accept: 'application/json' }
        });
        if (r.ok) {
          const data = await r.json();
          const row = Array.isArray(data) && data.length ? data[0] : null;
          SUNIZE_API_SECRET = row?.sunize_api_secret || '';
        }
      } catch (_) { /* ignore */ }
    }
    if (!SUNIZE_API_SECRET) {
      return res.status(500).json({ ok: false, error: 'SUNIZE_API_SECRET não configurado' });
    }

    const params = new URLSearchParams(req.url.split('?')[1] || '');
    const id = params.get('id') || params.get('transactionId');
    if (!id) {
      return res.status(400).json({ ok: false, error: 'Informe id da transação' });
    }
    const r = await fetch(`${SUNIZE_API_BASE}/transactions/${encodeURIComponent(id)}`, {
      headers: { 'Authorization': `Bearer ${SUNIZE_API_SECRET}` }
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
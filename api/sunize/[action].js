// Preencha estes dois valores para usar credenciais diretamente no código
// ATENÇÃO: substituir por valores reais do Sunize
const CODE_SUNIZE_CLIENT_KEY = 'ck_6bd83e10e5bd12a26b9f8dca9a00ed96';
const CODE_SUNIZE_CLIENT_SECRET = 'cs_84bfd72a65da7af5f48a4fa4c905deab';

export default async function handler(req, res) {
  const urlPath = (req.url || '').split('?')[0];
  const action = (urlPath.replace(/^.*\/api\/sunize\//, '') || '').toLowerCase();

  if (action === 'create') return handleCreate(req, res);
  if (action === 'status') return handleStatus(req, res);

  return res.status(404).json({ ok: false, error: 'Ação Sunize não encontrada' });
}

async function handleCreate(req, res) {
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
    // Fallback para credenciais definidas diretamente no código
    SUNIZE_CLIENT_KEY = SUNIZE_CLIENT_KEY || CODE_SUNIZE_CLIENT_KEY;
    SUNIZE_CLIENT_SECRET = SUNIZE_CLIENT_SECRET || CODE_SUNIZE_CLIENT_SECRET;
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

    // Estrutura de payload compatível com modo PIX/Basic
    const clientIp = (req.headers['x-forwarded-for']||'').toString().split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || '';
    let emailDomain = 'gouflix.app';
    try{ if(PUBLIC_URL){ const u = new URL(PUBLIC_URL); if(u.hostname && u.hostname.includes('.')) emailDomain = u.hostname; } }catch(_){ }
    const safeUser = String(userId).replace(/[^a-zA-Z0-9_.+-]/g,'_');
    const payerEmail = `${safeUser}@${emailDomain}`;
    const payload = {
      external_id: `${userId}|${plan}|${Date.now()}`,
      total_amount: Number(Number(amount).toFixed(2)),
      payment_method: 'PIX',
      items: [{ id: plan, title: `Assinatura GouFlix — ${plan}`, description: `Plano ${plan}`, price: Number(Number(amount).toFixed(2)), quantity: 1, is_physical: false }],
      ip: clientIp,
      customer: { name: 'Usuário GouFlix', email: payerEmail },
      ...(PUBLIC_URL ? { callback_url: `${PUBLIC_URL}/api/webhook/sunize` } : {})
    };

    const authValue = hasBearer ? `Bearer ${SUNIZE_API_SECRET}` : `Basic ${Buffer.from(`${SUNIZE_CLIENT_KEY}:${SUNIZE_CLIENT_SECRET}`).toString('base64')}`;
    const r = await fetch(`${SUNIZE_API_BASE}/transactions`, {
      method: 'POST',
      headers: { 'Authorization': authValue, 'Content-Type': 'application/json', 'Accept': 'application/json' },
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

async function handleStatus(req, res) {
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
    // Fallback para credenciais definidas diretamente no código
    SUNIZE_CLIENT_KEY = SUNIZE_CLIENT_KEY || CODE_SUNIZE_CLIENT_KEY;
    SUNIZE_CLIENT_SECRET = SUNIZE_CLIENT_SECRET || CODE_SUNIZE_CLIENT_SECRET;
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
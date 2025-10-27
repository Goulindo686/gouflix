const PLAN_PRICES = {
  mensal: 19.9,
  trimestral: 49.9,
  anual: 147.9,
  test2min: 1.0,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Método não permitido' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ENV_MP_TOKEN = process.env.MP_ACCESS_TOKEN || process.env.MERCADO_PAGO_ACCESS_TOKEN;
  const PUBLIC_URL = process.env.PUBLIC_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
  const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET || null;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ ok: false, error: 'SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY não configurados' });
  }

  try {
    const body = await readBody(req);
    const userId = body?.userId;
    const plan = body?.plan || 'mensal';
    const amount = PLAN_PRICES[plan] ?? PLAN_PRICES.mensal;
    if (!userId) {
      return res.status(400).json({ ok: false, error: 'userId é obrigatório' });
    }

    const mpToken = await getMpToken(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ENV_MP_TOKEN);
    if (!mpToken) {
      return res.status(400).json({ ok: false, error: 'MP_ACCESS_TOKEN não configurado. Defina em variáveis de ambiente ou salve via /api/config.' });
    }

    // Cria pagamento PIX no Mercado Pago
    const notificationUrl = PUBLIC_URL ? `${PUBLIC_URL}/api/webhook/mp${MP_WEBHOOK_SECRET ? `?secret=${encodeURIComponent(MP_WEBHOOK_SECRET)}` : ''}` : undefined;
    const paymentPayload = {
      transaction_amount: amount,
      description: `Assinatura ${plan}`,
      payment_method_id: 'pix',
      payer: {
        email: `${userId}@gouflix.local`,
        identification: { type: 'CPF', number: '19100000000' },
      },
      ...(notificationUrl ? { notification_url: notificationUrl } : {}),
    };

    const mpResp = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${mpToken}`,
      },
      body: JSON.stringify(paymentPayload),
    });

    if (!mpResp.ok) {
      const text = await mpResp.text();
      return res.status(mpResp.status || 500).json({ ok: false, error: 'Falha ao criar pagamento PIX', details: text });
    }

    const payment = await mpResp.json();
    const paymentId = payment?.id;
    const qr = payment?.point_of_interaction?.transaction_data?.qr_code_base64 || null;
    const qrCode = payment?.point_of_interaction?.transaction_data?.qr_code || null;

    // Persiste compra no Supabase
    const table = 'purchases';
    const upsertUrl = `${SUPABASE_URL}/rest/v1/${table}?on_conflict=id`;
    const headers = {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Prefer': 'resolution=merge-duplicates',
    };

    const purchaseRow = {
      id: String(paymentId),
      user_id: userId,
      plan,
      amount,
      status: payment?.status || 'pending',
      created_at: new Date().toISOString(),
    };

    const saveResp = await fetch(upsertUrl, { method: 'POST', headers, body: JSON.stringify(purchaseRow) });
    if (!saveResp.ok) {
      const text = await saveResp.text();
      // Ainda assim retorna os dados do pagamento para continuar no frontend
      return res.status(200).json({ ok: true, paymentId, qr, qrCode, warning: 'Compra criada, mas não persistida no Supabase', details: text });
    }

    return res.status(200).json({ ok: true, paymentId, qr, qrCode });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Erro interno em /api/subscription/create' });
  }
}

async function getMpToken(supabaseUrl, serviceKey, envToken) {
  if (envToken) return envToken;
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/app_config?id=eq.global&select=mp_token`, {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Accept': 'application/json',
      },
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
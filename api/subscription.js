const PLAN_DURATIONS_DAYS = {
  mensal: 30,
  trimestral: 90,
  anual: 365,
};

export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const SUPABASE_READ_KEY = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  const SUPABASE_WRITE_KEY = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  const SUPABASE_READY = !!(SUPABASE_URL && SUPABASE_READ_KEY);

  try {
    if (req.method === 'GET') {
      const listMode = req.query?.list;
      const userId = req.query?.userId;
      // Listagem de assinaturas (para reduzir número de funções na Vercel)
      if (listMode) {
        if (!SUPABASE_READY) return res.status(200).json({ ok: true, subscriptions: [] });
        const status = (req.query?.status || '').trim();
        const select = 'user_id,plan,start_at,end_at,status,payment_id';
        const base = `${SUPABASE_URL}/rest/v1/subscriptions?select=${select}`;
        const url = status ? `${base}&status=eq.${encodeURIComponent(status)}` : base;
        const r = await fetch(url, { headers: { 'apikey': SUPABASE_READ_KEY, 'Authorization': `Bearer ${SUPABASE_READ_KEY}`, 'Accept': 'application/json' } });
        if (!r.ok) {
          const text = await r.text();
          return res.status(r.status || 500).json({ ok: false, error: 'Falha ao listar assinaturas', details: text });
        }
        const rows = await r.json();
        return res.status(200).json({ ok: true, subscriptions: rows || [] });
      }
      if (!userId) return res.status(400).json({ ok: false, error: 'Parâmetro userId é obrigatório' });
      if (SUPABASE_READY) {
        // Primeiro tenta na tabela subscriptions
        const rSub = await fetch(`${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=user_id,plan,start_at,end_at,status`, {
          headers: { 'apikey': SUPABASE_READ_KEY, 'Authorization': `Bearer ${SUPABASE_READ_KEY}`, 'Accept': 'application/json' },
        });
        if (rSub.ok) {
          const subs = await rSub.json();
          const sub = Array.isArray(subs) && subs.length ? subs[0] : null;
          if (sub) {
            const expired = new Date(sub.end_at).getTime() <= Date.now();
            const active = (sub.status === 'active') && !expired;
            // Se expirou mas está marcado como active, corrigir status no banco
            if (expired && sub.status === 'active') {
              try {
                await fetch(`${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${encodeURIComponent(userId)}`, {
                  method: 'PATCH',
                  headers: {
                    'Content-Type': 'application/json',
                    'apikey': SUPABASE_WRITE_KEY,
                    'Authorization': `Bearer ${SUPABASE_WRITE_KEY}`,
                    'Prefer': 'return=minimal',
                  },
                  body: JSON.stringify({ status: 'inactive' }),
                });
              } catch {}
            }
            return res.status(200).json({ ok: true, subscription: { active, plan: sub.plan, until: sub.end_at } });
          }
        }
        // Fallback: deduz pelo último purchase aprovado
        const url = `${SUPABASE_URL}/rest/v1/purchases?user_id=eq.${encodeURIComponent(userId)}&status=eq.approved&select=id,plan,created_at&order=created_at.desc`;
        const r = await fetch(url, {
          headers: {
            'apikey': SUPABASE_READ_KEY,
            'Authorization': `Bearer ${SUPABASE_READ_KEY}`,
            'Accept': 'application/json',
          },
        });
        if (r.ok) {
          const rows = await r.json();
          const last = Array.isArray(rows) && rows.length ? rows[0] : null;
          if (last) {
            const plan = last.plan || 'mensal';
            const createdAt = new Date(last.created_at);
            const days = PLAN_DURATIONS_DAYS[plan] ?? 30;
            const until = new Date(createdAt.getTime() + days * 24 * 60 * 60 * 1000);
            const active = until.getTime() > Date.now();
            return res.status(200).json({ ok: true, subscription: { active, plan, until: until.toISOString() } });
          }
        }
      }
      // Sem Supabase ou nenhum registro: inativo
      return res.status(200).json({ ok: true, subscription: { active: false } });
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      const action = (body?.action || req.query?.action || '').toLowerCase();
      const COOKIES = parseCookies(req.headers?.cookie || '');
      const ENV_MP_TOKEN = process.env.MP_ACCESS_TOKEN || process.env.MERCADO_PAGO_ACCESS_TOKEN;
      const PUBLIC_URL = process.env.PUBLIC_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
      const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET || null;
      if (action === 'activate') {
        const userId = body?.userId;
        const plan = body?.plan || 'mensal';
        const paymentId = body?.paymentId || String(Date.now());
        if (!userId) return res.status(400).json({ ok: false, error: 'userId é obrigatório' });
        if (!SUPABASE_READY) {
          // Sem Supabase, apenas confirma ativação (cliente tratará como ativo)
          return res.status(200).json({ ok: true, activated: true, paymentId });
        }
        // Persiste compra aprovada
        const upsertUrl = `${SUPABASE_URL}/rest/v1/purchases?on_conflict=id`;
        const headers = {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_WRITE_KEY,
          'Authorization': `Bearer ${SUPABASE_WRITE_KEY}`,
          'Prefer': 'resolution=merge-duplicates',
        };
        // Não enviar 'amount' para evitar erro quando a coluna não existir no schema
        const row = { id: String(paymentId), user_id: userId, plan, status: 'approved', created_at: new Date().toISOString() };
        await fetch(upsertUrl, { method: 'POST', headers, body: JSON.stringify(row) });
        // Persistir/atualizar assinatura com expiração
        const startAt = new Date();
        // Busca duração do plano no Supabase (compatível com 'days' ou 'duration_days')
        let days = PLAN_DURATIONS_DAYS[plan] ?? 30;
        try {
          const planUrl = `${SUPABASE_URL}/rest/v1/plans?id=eq.${encodeURIComponent(plan)}&select=days,duration_days`;
          const pr = await fetch(planUrl, { headers: { 'apikey': SUPABASE_READ_KEY, 'Authorization': `Bearer ${SUPABASE_READ_KEY}`, 'Accept': 'application/json' } });
          if (pr.ok) {
            const arr = await pr.json();
            const row = Array.isArray(arr) && arr.length ? arr[0] : null;
            const d = (row?.days ?? row?.duration_days);
            if (typeof d === 'number' && d > 0) days = d;
          }
        } catch {}
        const endAt = new Date(startAt.getTime() + days * 24 * 60 * 60 * 1000);
        const subHeaders = {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_WRITE_KEY,
          'Authorization': `Bearer ${SUPABASE_WRITE_KEY}`,
          'Prefer': 'resolution=merge-duplicates',
        };
        // subscriptions usa user_id como chave única para manter apenas uma assinatura atual
        await fetch(`${SUPABASE_URL}/rest/v1/subscriptions?on_conflict=user_id`, {
          method: 'POST',
          headers: subHeaders,
          body: JSON.stringify({ user_id: userId, plan, start_at: startAt.toISOString(), end_at: endAt.toISOString(), status: 'active', payment_id: String(paymentId) })
        });
        return res.status(200).json({ ok: true, activated: true, paymentId });
      }
      if (action === 'deactivate') {
        const userId = body?.userId;
        if (!userId) return res.status(400).json({ ok: false, error: 'userId é obrigatório' });
        if (!SUPABASE_READY) return res.status(200).json({ ok: true, deactivated: true });
        // Marca últimas compras como canceladas
        try {
          await fetch(`${SUPABASE_URL}/rest/v1/purchases?user_id=eq.${encodeURIComponent(userId)}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'apikey': SUPABASE_WRITE_KEY,
              'Authorization': `Bearer ${SUPABASE_WRITE_KEY}`,
              'Prefer': 'return=minimal',
            },
            body: JSON.stringify({ status: 'cancelled' }),
          });
        } catch {}
        // Atualiza assinatura como inativa e expira agora
        try {
          await fetch(`${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${encodeURIComponent(userId)}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'apikey': SUPABASE_WRITE_KEY,
              'Authorization': `Bearer ${SUPABASE_WRITE_KEY}`,
              'Prefer': 'return=minimal',
            },
            body: JSON.stringify({ status: 'inactive', end_at: new Date().toISOString() }),
          });
        } catch {}
        return res.status(200).json({ ok: true, deactivated: true });
      }
      if (action === 'create') {
        const userId = body?.userId;
        const plan = body?.plan || 'mensal';
        // Buscar preço do plano no Supabase quando possível, com fallback para mapa
        let amount = null;
        try {
          if (SUPABASE_READ_KEY) {
            // Suporta colunas price (reais) e price_cents (centavos)
            const pr = await fetch(`${SUPABASE_URL}/rest/v1/plans?id=eq.${encodeURIComponent(plan)}&select=price,price_cents`, { headers: { 'apikey': SUPABASE_READ_KEY, 'Authorization': `Bearer ${SUPABASE_READ_KEY}`, 'Accept': 'application/json' } });
            if (pr.ok) {
              const arr = await pr.json();
              const row = Array.isArray(arr) && arr.length ? arr[0] : null;
              const price = row?.price;
              const cents = row?.price_cents;
              if (typeof price === 'number' && price > 0) amount = price;
              else if (typeof cents === 'number' && cents > 0) amount = Math.round(cents) / 100;
            }
          }
        } catch {}
        if (amount == null) {
          const PLAN_PRICES = { mensal: 19.9, trimestral: 49.9, anual: 147.9 };
          amount = PLAN_PRICES[plan];
        }
        if (!userId) return res.status(400).json({ ok: false, error: 'userId é obrigatório' });
        if (!amount) return res.status(400).json({ ok: false, error: 'Plano inválido (preço não encontrado)' });
        const mpToken = await getMpToken(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ENV_MP_TOKEN || COOKIES['mp_token'], process.env.SUPABASE_ANON_KEY);
        if (!mpToken) return res.status(400).json({ ok: false, error: 'MP_ACCESS_TOKEN não configurado. Defina em variáveis de ambiente ou salve via /api/config.' });
        // notification_url: usar cookie/env e, se vazio, buscar de app_config
        let PUBLIC_FALLBACK = COOKIES['public_url'] || PUBLIC_URL;
        if (!PUBLIC_FALLBACK && SUPABASE_URL && SUPABASE_READ_KEY) {
          try {
            const cr = await fetch(`${SUPABASE_URL}/rest/v1/app_config?id=eq.global&select=public_url`, {
              headers: { 'apikey': SUPABASE_READ_KEY, 'Authorization': `Bearer ${SUPABASE_READ_KEY}`, 'Accept': 'application/json' },
            });
            if (cr.ok) {
              const data = await cr.json();
              const row = Array.isArray(data) && data.length ? data[0] : null;
              if (row?.public_url) PUBLIC_FALLBACK = row.public_url;
            }
          } catch {}
        }
        // Fallback final: derivar da requisição atual (host) para garantir webhook
        if (!PUBLIC_FALLBACK && req?.headers?.host) {
          const scheme = (req.headers['x-forwarded-proto'] || '').includes('http') ? req.headers['x-forwarded-proto'] : 'https';
          const host = req.headers.host;
          PUBLIC_FALLBACK = `${scheme}://${host}`;
        }
        const notificationUrl = PUBLIC_FALLBACK ? `${PUBLIC_FALLBACK}/api/webhook/mp${MP_WEBHOOK_SECRET ? `?secret=${encodeURIComponent(MP_WEBHOOK_SECRET)}` : ''}` : undefined;
        const idempotencyKey = `${userId}:${plan}:${Date.now()}`;
        const paymentPayload = {
          transaction_amount: amount,
          description: `Assinatura ${plan}`,
          payment_method_id: 'pix',
          // Mercado Pago exige email válido; usar domínio example.com para testes
          payer: { email: `${userId}@example.com`, identification: { type: 'CPF', number: '19100000000' } },
          // Referência externa para fallback no webhook se o purchase não existir
          external_reference: `${userId}:${plan}:${Date.now()}`,
          ...(notificationUrl ? { notification_url: notificationUrl } : {}),
        };

        const mpResp = await fetch('https://api.mercadopago.com/v1/payments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${mpToken}`, 'X-Idempotency-Key': idempotencyKey },
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

        if (SUPABASE_READY) {
          const upsertUrl = `${SUPABASE_URL}/rest/v1/purchases?on_conflict=id`;
          const headers = {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'Prefer': 'resolution=merge-duplicates',
          };
          // Não enviar 'amount' para evitar incompatibilidade com schema
          const initialStatus = payment?.status || 'pending';
          const purchaseRow = { id: String(paymentId), user_id: userId, plan, status: initialStatus, created_at: new Date().toISOString() };
          const saveResp = await fetch(upsertUrl, { method: 'POST', headers, body: JSON.stringify(purchaseRow) });
          if (!saveResp.ok) {
            const text = await saveResp.text();
            return res.status(200).json({ ok: true, paymentId, qr, qrCode, warning: 'Compra criada, mas não persistida no Supabase', details: text });
          }
          return res.status(200).json({ ok: true, paymentId, qr, qrCode });
        }
        return res.status(200).json({ ok: true, paymentId, qr, qrCode, warning: 'Supabase não configurado; pagamento não foi persistido no banco.' });
      }
      return res.status(400).json({ ok: false, error: 'Ação inválida' });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Método não permitido' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Erro interno em /api/subscription' });
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

async function getMpToken(supabaseUrl, serviceKey, envToken, anonKey) {
  if (envToken) return envToken;
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

function parseCookies(str){
  const out = {};
  str.split(';').forEach(part=>{
    const [k,v] = part.split('=');
    if(!k) return;
    out[k.trim()] = decodeURIComponent((v||'').trim());
  });
  return out;
}
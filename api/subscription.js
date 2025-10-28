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
      if (action === 'activate') {
        const userId = body?.userId;
        let plan = body?.plan || null;
        const paymentId = body?.paymentId || String(Date.now());
        if (!userId) return res.status(400).json({ ok: false, error: 'userId é obrigatório' });
        if (!SUPABASE_READY) {
          // Sem Supabase, apenas confirma ativação (cliente tratará como ativo)
          return res.status(200).json({ ok: true, activated: true, paymentId });
        }
        // Se plano não foi informado, tentar deduzir das compras
        if (!plan) {
          try {
            // Tenta pela compra específica
            if (paymentId) {
              const rp = await fetch(`${SUPABASE_URL}/rest/v1/purchases?id=eq.${encodeURIComponent(String(paymentId))}&select=plan`, {
                headers: { 'apikey': SUPABASE_WRITE_KEY, 'Authorization': `Bearer ${SUPABASE_WRITE_KEY}`, 'Accept': 'application/json' },
              });
              if (rp.ok) {
                const rows = await rp.json();
                const p = Array.isArray(rows) && rows.length ? rows[0] : null;
                if (p?.plan) plan = String(p.plan);
              }
            }
            // Fallback: última compra aprovada do usuário
            if (!plan) {
              const ru = await fetch(`${SUPABASE_URL}/rest/v1/purchases?user_id=eq.${encodeURIComponent(userId)}&status=eq.approved&select=plan,created_at&order=created_at.desc`, {
                headers: { 'apikey': SUPABASE_WRITE_KEY, 'Authorization': `Bearer ${SUPABASE_WRITE_KEY}`, 'Accept': 'application/json' },
              });
              if (ru.ok) {
                const rows = await ru.json();
                const last = Array.isArray(rows) && rows.length ? rows[0] : null;
                if (last?.plan) plan = String(last.plan);
              }
            }
          } catch {}
        }
        if (!plan) plan = 'mensal';
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
      // Removido: ação 'create' via Mercado Pago
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


function parseCookies(str){
  const out = {};
  str.split(';').forEach(part=>{
    const [k,v] = part.split('=');
    if(!k) return;
    out[k.trim()] = decodeURIComponent((v||'').trim());
  });
  return out;
}
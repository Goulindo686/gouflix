export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || null;
    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE ||
      process.env.SUPABASE_SERVICE ||
      null;

    if (!url || !serviceKey) {
      return res.status(500).json({ error: 'Missing SUPABASE_URL or service role key' });
    }

    const body = await readBody(req);
    if (!body || !body.key) {
      return res.status(400).json({ error: 'Missing item key' });
    }

    const base = `${url}/rest/v1/gouflix_state`;
    // Carregar estado atual
    const r = await fetch(`${base}?select=data&id=eq.global`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: 'application/json' },
    });
    if (!r.ok) {
      return res.status(500).json({ error: `select failed: ${r.status}` });
    }
    const arr = await r.json();
    const current = (arr && arr[0] && arr[0].data) || { added: [], removed: [] };

    // Atualiza estado: adiciona item e remove chave dos removidos
    const exists = (current.added || []).some((m) => String(m.key || '') === String(body.key));
    const nextAdded = exists ? current.added : [...(current.added || []), body];
    const nextRemoved = (current.removed || []).filter((k) => String(k) !== String(body.key));
    const next = { ...current, added: nextAdded, removed: nextRemoved };

    const up = await fetch(`${base}?on_conflict=id`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ id: 'global', data: next }),
    });
    if (!up.ok) {
      const txt = await up.text();
      return res.status(500).json({ error: `upsert failed: ${up.status}`, details: txt });
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Erro interno em /api/state/add' });
  }
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', (err) => reject(err));
  });
}
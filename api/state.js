export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

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

  try {
    const base = `${url}/rest/v1/gouflix_state`;
    const q = `${base}?select=data&id=eq.global`;
    const r = await fetch(q, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Accept: 'application/json',
      },
    });
    if (!r.ok) {
      throw new Error(`select failed: ${r.status}`);
    }
    const arr = await r.json();
    let payload = (arr && arr[0] && arr[0].data) || null;

    // Se não existir, cria estado inicial
    if (!payload) {
      const init = { added: [], removed: [] };
      const up = await fetch(`${base}?on_conflict=id`, {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates',
        },
        body: JSON.stringify({ id: 'global', data: init }),
      });
      if (!up.ok) {
        throw new Error(`bootstrap failed: ${up.status}`);
      }
      payload = init;
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(payload);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
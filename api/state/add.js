export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
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
    const body = req.body || {};
    const key = body.key || null;
    if (!key) {
      return res.status(400).json({ error: 'Missing item key' });
    }

    const base = `${url}/rest/v1/gouflix_state`;
    const sel = await fetch(`${base}?select=data&id=eq.global`, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Accept: 'application/json',
      },
    });
    if (!sel.ok) {
      throw new Error(`select failed: ${sel.status}`);
    }
    const arr = await sel.json();
    const current = (arr && arr[0] && arr[0].data) || { added: [], removed: [] };

    const next = {
      added: [...(current.added || []), body],
      removed: (current.removed || []).filter((k) => k !== key),
    };

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
      throw new Error(`upsert failed: ${up.status}`);
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
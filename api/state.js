export default async function handler(req, res) {
  const method = req.method;

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

    if (method === 'GET') {
      const q = `${base}?select=data&id=eq.global`;
      const r = await fetch(q, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: 'application/json' },
      });
      if (!r.ok) throw new Error(`select failed: ${r.status}`);
      const arr = await r.json();
      let payload = (arr && arr[0] && arr[0].data) || null;
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
        if (!up.ok) throw new Error(`bootstrap failed: ${up.status}`);
        payload = init;
      }
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(payload);
    }

    if (method === 'POST') {
      const isAdmin = await ensureIsAdmin(req, url, serviceKey);
      if (!isAdmin) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const body = await readBody(req);
      const action = String((req.query?.action || body?.action || '').toLowerCase());
      if (!action) return res.status(400).json({ error: 'Missing action' });
      // Carrega estado atual
      const sel = await fetch(`${base}?select=data&id=eq.global`, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: 'application/json' },
      });
      if (!sel.ok) return res.status(500).json({ error: `select failed: ${sel.status}` });
      const arr = await sel.json();
      const current = (arr && arr[0] && arr[0].data) || { added: [], removed: [] };

      let next = current;
      if (action === 'add') {
        const item = body || {};
        if (!item.key) return res.status(400).json({ error: 'Missing item key' });
        const exists = (current.added || []).some((m) => String(m.key || '') === String(item.key));
        const nextAdded = exists ? current.added : [...(current.added || []), item];
        const nextRemoved = (current.removed || []).filter((k) => String(k) !== String(item.key));
        next = { ...current, added: nextAdded, removed: nextRemoved };
      } else if (action === 'remove') {
        const key = String(body?.key || '').trim();
        if (!key) return res.status(400).json({ error: 'Missing item key' });
        const nextAdded = (current.added || []).filter((m) => String(m.key || '') !== key);
        const wasRemoved = (current.removed || []).some((k) => String(k) === key);
        const nextRemoved = wasRemoved ? current.removed : [...(current.removed || []), key];
        next = { ...current, added: nextAdded, removed: nextRemoved };
      } else {
        return res.status(400).json({ error: 'Invalid action' });
      }

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
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
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

function parseCookies(str){
  const out = {};
  str.split(';').forEach(part=>{
    const [k,v] = part.split('=');
    if(!k) return;
    out[k.trim()] = decodeURIComponent((v||'').trim());
  });
  return out;
}

async function ensureIsAdmin(req, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY){
  try{
    const ids = String(process.env.ADMIN_IDS||'').split(',').map(s=>s.trim()).filter(Boolean);
    const names = String(process.env.ADMIN_USERNAMES||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
    if(ids.length === 0) return false;
    const cookies = parseCookies(req.headers?.cookie||'');
    const uid = cookies['uid'] || null;
    const uname = (cookies['uname']||'').toLowerCase();
    if((uid && ids.includes(String(uid))) || (uname && names.includes(uname))) return true;
    const sid = cookies['sid'] || null;
    if(!sid || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return false;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/sessions?id=eq.${encodeURIComponent(sid)}&select=user_id,username,expires_at`, {
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Accept: 'application/json' }
    });
    if(!r.ok) return false;
    const data = await r.json();
    const row = Array.isArray(data) && data.length ? data[0] : null;
    if(!row) return false;
    const exp = row.expires_at ? (new Date(row.expires_at)).getTime() : Date.now();
    if(exp < Date.now()) return false;
    return ids.includes(String(row.user_id)) || (row.username && names.includes(String(row.username).toLowerCase()));
  }catch(_){ return false; }
}
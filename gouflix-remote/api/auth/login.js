export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  try {
    let body = {};
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
    } catch (_) { body = {}; }

    const { email, password } = body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email e senha são obrigatórios' });
    }
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    const nowIso = new Date().toISOString();
    const crypto = await import('crypto');
    const sha256 = (s)=>crypto.createHash('sha256').update(String(s)).digest('hex');
    const headers = {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Accept': 'application/json',
      'Prefer': 'resolution=merge-duplicates'
    };

    let uid = 'u_' + Math.random().toString(36).slice(2);
    let username = String(email).split('@')[0] || 'Usuário';
    let avatar = '';
    let supabaseOk = false;
    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const rUser = await fetch(`${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=id,password_hash,username,avatar`, { headers });
        if (rUser.ok) {
          const rows = await rUser.json();
          const row = Array.isArray(rows) && rows.length ? rows[0] : null;
          if (!row) {
            return res.status(401).json({ success: false, error: 'Credenciais inválidas' });
          }
          uid = String(row.id || uid);
          username = row.username || username;
          avatar = row.avatar || '';
          const stored = String(row.password_hash || '');
          const expected = `sha256:${sha256(password)}`;
          if (stored && stored !== expected) {
            return res.status(401).json({ success: false, error: 'Credenciais inválidas' });
          }
        }
      } catch (_) { /* ignore and fallback */ }
    }

    const sid = 's_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const sessPayload = [{ id: sid, user_id: uid, email, username, created_at: nowIso, expires_at: expiresAt }];
        const rSess = await fetch(`${SUPABASE_URL}/rest/v1/sessions?on_conflict=id`, { method: 'POST', headers, body: JSON.stringify(sessPayload) });
        supabaseOk = rSess.ok;
      } catch (_) { supabaseOk = false; }
    }

    const maxAge = 30 * 24 * 60 * 60;
    const isHttps = String(req.headers['x-forwarded-proto'] || '').includes('https');
    const cookieFlags = `HttpOnly; Path=/; SameSite=Lax${isHttps ? '; Secure' : ''}`;
    res.setHeader('Set-Cookie', [
      `sid=${sid}; ${cookieFlags}; Max-Age=${maxAge}`,
      `uid=${encodeURIComponent(uid)}; ${cookieFlags}; Max-Age=${maxAge}`,
      `uname=${encodeURIComponent(username)}; ${cookieFlags}; Max-Age=${maxAge}`,
      `uavatar=${encodeURIComponent(avatar||'')}; ${cookieFlags}; Max-Age=${maxAge}`,
      `uemail=${encodeURIComponent(email)}; ${cookieFlags}; Max-Age=${maxAge}`,
      `uexp=${encodeURIComponent(expiresAt)}; ${cookieFlags}; Max-Age=${maxAge}`
    ]);

    return res.status(200).json({
      success: true,
      message: supabaseOk ? 'Login realizado' : 'Login realizado (modo teste; persistência limitada)',
      user: { id: uid, email, username, hasProfile: !!username }
    });
  } catch (error) {
    console.error('Erro no login (remote):', error);
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
}
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

    const { email, password, username, name } = body || {};
    const finalUsername = (username || name || '').trim();
    if (!email || !password || !finalUsername) {
      return res.status(400).json({ success: false, error: 'Email, senha e nome de usuário são obrigatórios' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ success: false, error: 'A senha deve ter pelo menos 6 caracteres' });
    }
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    const nowIso = new Date().toISOString();
    const crypto = await import('crypto');
    const sha256 = (s)=>crypto.createHash('sha256').update(String(s)).digest('hex');
    const uid = 'u_' + sha256(email).slice(0, 24);
    const sid = 's_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const maxAge = 30 * 24 * 60 * 60;
    const isHttps = String(req.headers['x-forwarded-proto'] || '').includes('https');
    const cookieFlags = `HttpOnly; Path=/; SameSite=Lax${isHttps ? '; Secure' : ''}`;

    let supabaseOk = false;
    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const headers = {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Prefer': 'resolution=merge-duplicates',
          'Accept': 'application/json',
        };
        const userPayload = [{ id: uid, email, username: finalUsername, password_hash: `sha256:${sha256(password)}`, auth_type: 'traditional', updated_at: nowIso }];
        const rUser = await fetch(`${SUPABASE_URL}/rest/v1/users?on_conflict=id`, { method:'POST', headers, body: JSON.stringify(userPayload) });
        if (rUser.ok) {
          const sessPayload = [{ id: sid, user_id: uid, email, username: finalUsername, created_at: nowIso, expires_at: expiresAt }];
          const rSess = await fetch(`${SUPABASE_URL}/rest/v1/sessions?on_conflict=id`, { method:'POST', headers, body: JSON.stringify(sessPayload) });
          supabaseOk = rSess.ok;
        }
      } catch (_) { supabaseOk = false; }
    }

    res.setHeader('Set-Cookie', [
      `sid=${sid}; ${cookieFlags}; Max-Age=${maxAge}`,
      `uid=${encodeURIComponent(uid)}; ${cookieFlags}; Max-Age=${maxAge}`,
      `uname=${encodeURIComponent(finalUsername)}; ${cookieFlags}; Max-Age=${maxAge}`,
      `uavatar=${encodeURIComponent('')}; ${cookieFlags}; Max-Age=${maxAge}`,
      `uemail=${encodeURIComponent(email)}; ${cookieFlags}; Max-Age=${maxAge}`,
      `uexp=${encodeURIComponent(expiresAt)}; ${cookieFlags}; Max-Age=${maxAge}`
    ]);

    return res.status(201).json({
      success: true,
      message: supabaseOk ? 'Conta criada com sucesso' : 'Conta criada (modo teste; persistência limitada)',
      user: { id: uid, email, username: finalUsername }
    });
  } catch (error) {
    console.error('Erro no registro (remote):', error);
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
}
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

    // Fallback sem Supabase: criar sessão via cookies
    const sid = 's_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const uid = 'u_' + Math.random().toString(36).slice(2);
    const username = String(email).split('@')[0] || 'Usuário';
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const maxAge = 30 * 24 * 60 * 60; // 30 dias
    const isHttps = String(req.headers['x-forwarded-proto'] || '').includes('https');
    const cookieFlags = `HttpOnly; Path=/; SameSite=Lax${isHttps ? '; Secure' : ''}`;
    res.setHeader('Set-Cookie', [
      `sid=${sid}; ${cookieFlags}; Max-Age=${maxAge}`,
      `uid=${encodeURIComponent(uid)}; ${cookieFlags}; Max-Age=${maxAge}`,
      `uname=${encodeURIComponent(username)}; ${cookieFlags}; Max-Age=${maxAge}`,
      `uavatar=${encodeURIComponent('')}; ${cookieFlags}; Max-Age=${maxAge}`,
      `uemail=${encodeURIComponent(email)}; ${cookieFlags}; Max-Age=${maxAge}`,
      `uexp=${encodeURIComponent(expiresAt)}; ${cookieFlags}; Max-Age=${maxAge}`
    ]);

    return res.status(200).json({
      success: true,
      message: 'Login realizado (modo teste sem Supabase)',
      user: { id: uid, email, username, hasProfile: false }
    });
  } catch (error) {
    console.error('Erro no login (remote):', error);
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
}
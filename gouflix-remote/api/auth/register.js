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

    // Fallback sem Supabase: criar sessão via cookies
    const uid = 'u_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const sid = 's_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const maxAge = 30 * 24 * 60 * 60; // 30 dias
    const isHttps = String(req.headers['x-forwarded-proto'] || '').includes('https');
    const cookieFlags = `HttpOnly; Path=/; SameSite=Lax${isHttps ? '; Secure' : ''}`;
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
      message: 'Conta criada com sucesso (modo teste sem Supabase)',
      user: { id: uid, email, username: finalUsername }
    });
  } catch (error) {
    console.error('Erro no registro (remote):', error);
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
}
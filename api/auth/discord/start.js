function randomState(){
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

export default async function handler(req, res){
  try{
    const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
    // Usar sempre o domínio atual para evitar cookies em domínio diferente
    const currentHost = req.headers.host;
    const defaultRedirect = `https://${currentHost}/api/auth/discord/callback`;
    const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || defaultRedirect;
    const scope = encodeURIComponent('identify email');
    const returnTo = (new URL(req.url, `http://${req.headers.host}`)).searchParams.get('returnTo') || '/';

    if(!CLIENT_ID){
      return res.status(500).json({ ok:false, error:'DISCORD_CLIENT_ID não configurado' });
    }

    const state = randomState();
    const isHttps = String(req.headers['x-forwarded-proto']||'').includes('https') || String(currentHost||'').startsWith('localhost') === false;
    const cookieFlags = `HttpOnly; Path=/; SameSite=Lax${isHttps ? '; Secure' : ''}`;
    res.setHeader('Set-Cookie', [
      `d_state=${state}; ${cookieFlags}` ,
      `d_return=${encodeURIComponent(returnTo)}; ${cookieFlags}`
    ]);

    const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(CLIENT_ID)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${scope}&state=${encodeURIComponent(state)}`;
    res.statusCode = 302;
    res.setHeader('Location', authUrl);
    res.end();
  }catch(err){
    res.status(500).json({ ok:false, error: err?.message || 'Erro em /api/auth/discord/start' });
  }
}
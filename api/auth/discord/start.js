function randomState(){
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

export default async function handler(req, res){
  try{
    const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
    const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || (process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/api/auth/discord/callback` : `https://${req.headers.host}/api/auth/discord/callback`);
    const scope = encodeURIComponent('identify email');
    const returnTo = (new URL(req.url, `http://${req.headers.host}`)).searchParams.get('returnTo') || '/';

    if(!CLIENT_ID){
      return res.status(500).json({ ok:false, error:'DISCORD_CLIENT_ID não configurado' });
    }

    const state = randomState();
    res.setHeader('Set-Cookie', [
      `d_state=${state}; HttpOnly; Path=/; SameSite=Lax` ,
      `d_return=${encodeURIComponent(returnTo)}; HttpOnly; Path=/; SameSite=Lax`
    ]);

    const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(CLIENT_ID)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${scope}&state=${encodeURIComponent(state)}`;
    res.statusCode = 302;
    res.setHeader('Location', authUrl);
    res.end();
  }catch(err){
    res.status(500).json({ ok:false, error: err?.message || 'Erro em /api/auth/discord/start' });
  }
}
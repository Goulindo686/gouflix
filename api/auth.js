// Importa as funções auxiliares
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// Helper para cookies
function setCookie(res, name, value, options = {}) {
  const opts = Object.assign({ path: '/', httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'Lax', maxAge: 30 * 24 * 60 * 60 }, options);

  let cookie = `${name}=${encodeURIComponent(value)}`;
  if (opts.path) cookie += `; Path=${opts.path}`;
  if (opts.httpOnly) cookie += `; HttpOnly`;
  if (opts.secure) cookie += `; Secure`;
  if (opts.sameSite) cookie += `; SameSite=${opts.sameSite}`;
  if (typeof opts.maxAge === 'number') cookie += `; Max-Age=${Math.floor(opts.maxAge)}`;

  // Append Set-Cookie header instead of overwriting
  try{
    const prev = res.getHeader('Set-Cookie');
    if(!prev){
      res.setHeader('Set-Cookie', cookie);
    } else if (Array.isArray(prev)){
      res.setHeader('Set-Cookie', [...prev, cookie]);
    } else {
      res.setHeader('Set-Cookie', [prev, cookie]);
    }
  }catch(e){
    try{ res.setHeader('Set-Cookie', cookie); }catch(_){}
  }
}

function readCookie(req, name) {
  const cookie = req.headers.cookie || '';
  const parts = cookie.split(';').map(s => s.trim());
  for (const p of parts) { if (p.startsWith(name + '=')) return decodeURIComponent(p.slice(name.length + 1)); }
  return null;
}

function clearCookie(res, name) {
  setCookie(res, name, '', { maxAge: 0 });
}

// Handlers combinados de autenticação
export default async function handler(req, res) {
  try {
    const { method, query: { action } = {} } = req;

    // When not performing redirects for OAuth, ensure responses are JSON
    if (action !== 'discord-start' && action !== 'discord-callback') {
      try { res.setHeader('Content-Type', 'application/json; charset=utf-8'); } catch(_) {}
    }

  // Rotas de autenticação Discord
  if (action === 'discord-start') {
    const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
    const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || `${process.env.VERCEL_URL}/api/auth/discord/callback`;
    
    const params = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      redirect_uri: DISCORD_REDIRECT_URI,
      response_type: 'code',
      scope: 'identify email'
    });

    return res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
  }

  if (action === 'discord-callback') {
    try {
      const { code } = req.query;
      const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
      const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
      const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI;

      const params = new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: DISCORD_REDIRECT_URI
      });

      const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        body: params,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      const tokens = await tokenRes.json();

      const userRes = await fetch('https://discord.com/api/users/@me', {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`
        }
      });

      const userData = await userRes.json();

      // Set cookies
      setCookie(res, 'sid', userData.id);
      setCookie(res, 'uid', userData.id);
      setCookie(res, 'uname', userData.username);
      setCookie(res, 'uemail', userData.email);
      setCookie(res, 'uavatar', `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}`);

      return res.redirect('/');
    } catch (error) {
      console.error('Erro no callback Discord:', error);
      // If something goes wrong in the callback, return a JSON error when requested by XHR
      try {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.status(500).json({ message: 'Erro no callback do Discord', error: String(error) });
      } catch(_) {
        return res.redirect('/?error=auth');
      }
    }
  }

  // Rota de logout
  if (action === 'logout') {
    clearCookie(res, 'sid');
    clearCookie(res, 'uid');
    clearCookie(res, 'uname');
    clearCookie(res, 'uemail');
    clearCookie(res, 'uavatar');
    clearCookie(res, 'uexp');
    return res.status(200).json({ ok: true });
  }

  // Rota de registro
  if (action === 'register' && method === 'POST') {
    try {
      const { fullname, email, password } = req.body;

      if (!fullname || !email || !password) {
        return res.status(400).json({ 
          message: 'Nome completo, email e senha são obrigatórios' 
        });
      }

      if (password.length < 8) {
        return res.status(400).json({ 
          message: 'A senha deve ter pelo menos 8 caracteres' 
        });
      }

      // Se o Supabase estiver configurado
      const SUPABASE_URL = process.env.SUPABASE_URL;
      const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

      if (SUPABASE_URL && SUPABASE_ANON_KEY) {
        const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        
        const { data: { user }, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullname
            }
          }
        });

        if (error) throw error;

        setCookie(res, 'sid', user.id);
        setCookie(res, 'uid', user.id);
        setCookie(res, 'uname', fullname);
        setCookie(res, 'uemail', email);

        return res.status(200).json({ 
          ok: true,
          user: {
            id: user.id,
            email: user.email,
            name: fullname
          }
        });
      }

      // Fallback: criar usuário local
      const userId = 'user_' + Math.random().toString(36).substr(2, 9);
      
      // store hashed password in cookie so a later login can validate (HttpOnly)
      try{
        const hashed = crypto.createHash('sha256').update(password || '').digest('hex');
        setCookie(res, 'upass', hashed);
      }catch(_){ /* ignore hashing errors */ }

      setCookie(res, 'sid', userId);
      setCookie(res, 'uid', userId);
      setCookie(res, 'uname', fullname);
      setCookie(res, 'uemail', email);

      return res.status(200).json({
        ok: true,
        user: {
          id: userId,
          email,
          name: fullname
        }
      });

    } catch (error) {
      console.error('Erro no registro:', error);
      return res.status(500).json({ 
        message: error.message || 'Erro ao criar conta. Por favor, tente novamente mais tarde.'
      });
    }
  }

  // Rota de login (email + password)
  if (action === 'login' && method === 'POST') {
    try {
      const { email, password } = req.body || {};
      if (!email || !password) return res.status(400).json({ message: 'Email e senha são obrigatórios' });

      const SUPABASE_URL = process.env.SUPABASE_URL;
      const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
      if (SUPABASE_URL && SUPABASE_ANON_KEY) {
        const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return res.status(401).json({ message: error.message || 'Credenciais inválidas' });
        const user = data.user;
        setCookie(res, 'sid', user.id);
        setCookie(res, 'uid', user.id);
        setCookie(res, 'uname', user.user_metadata?.full_name || user.email || 'Usuário');
        setCookie(res, 'uemail', user.email);
        return res.status(200).json({ ok: true, user: { id: user.id, email: user.email, name: user.user_metadata?.full_name } });
      }

      // Fallback local: compare against stored hashed cookie (upass)
      const storedHash = readCookie(req, 'upass');
      const providedHash = crypto.createHash('sha256').update(password || '').digest('hex');
      const storedEmail = readCookie(req, 'uemail') || '';
      if (storedEmail.toLowerCase() === (email||'').toLowerCase() && storedHash && storedHash === providedHash) {
        const uid = readCookie(req, 'uid') || ('user_' + Math.random().toString(36).substr(2,9));
        setCookie(res, 'sid', uid);
        setCookie(res, 'uid', uid);
        setCookie(res, 'uname', readCookie(req, 'uname') || 'Usuário');
        setCookie(res, 'uemail', email);
        return res.status(200).json({ ok: true, user: { id: uid, email, name: readCookie(req, 'uname') || '' } });
      }

      return res.status(401).json({ message: 'Credenciais inválidas' });
    } catch (err) {
      console.error('Erro no login:', err);
      return res.status(500).json({ message: 'Erro no login', error: String(err) });
    }
  }

  // Rota me (informações do usuário)
  if (action === 'me') {
    const sid = readCookie(req, 'sid');
    if (!sid) { 
      return res.status(200).json({ ok: true, logged: false, user: null }); 
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // Fallback: se Supabase não estiver configurado, usar cookies auxiliares
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      const uid = readCookie(req, 'uid');
      const uname = readCookie(req, 'uname') || 'Usuário';
      const uavatar = readCookie(req, 'uavatar') || null;
      const uemail = readCookie(req, 'uemail') || null;
      const uexp = readCookie(req, 'uexp');
      
      return res.status(200).json({
        ok: true,
        logged: true,
        user: {
          id: uid,
          name: uname,
          email: uemail,
          avatar: uavatar,
          exp: uexp ? parseInt(uexp, 10) : null
        }
      });
    }

    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: { user }, error } = await supabase.auth.admin.getUserById(sid);
      
      if (error) throw error;
      if (!user) {
        return res.status(200).json({ ok: true, logged: false, user: null });
      }

      return res.status(200).json({
        ok: true,
        logged: true,
        user: {
          id: user.id,
          name: user.user_metadata?.full_name || 'Usuário',
          email: user.email,
          avatar: user.user_metadata?.avatar_url,
          exp: user.user_metadata?.exp
        }
      });

    } catch (error) {
      console.error('Erro ao buscar usuário:', error);
      return res.status(500).json({ 
        message: 'Erro ao buscar informações do usuário' 
      });
    }
  }

    // Se nenhuma ação corresponder
    return res.status(404).json({ message: 'Rota não encontrada' });
  } catch (err) {
    // Catch any unexpected runtime errors and return JSON so client can handle it
    console.error('Unhandled error in /api/auth:', err && err.stack ? err.stack : String(err));
    try { res.setHeader('Content-Type', 'application/json; charset=utf-8'); } catch(_) {}
    return res.status(500).json({ message: 'Internal server error', error: String(err) });
  }
}
import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

async function createSession(user) {
  const sid = 's_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  if (supabase) {
    const { error } = await supabase
      .from('sessions')
      .upsert({
        id: sid,
        user_id: user.id,
        username: user.username,
        email: user.email,
        avatar: user.avatar || null,
        created_at: new Date().toISOString(),
        expires_at: expiresAt
      });
    if (error) {
      console.error('Erro ao persistir sessão:', error);
    }
  }
  return { sid, expiresAt };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  if (!supabase) {
    return res.status(500).json({ success: false, error: 'Supabase não configurado' });
  }

  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email e senha são obrigatórios' });
    }

    // Buscar usuário tradicional
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .eq('auth_type', 'traditional')
      .single();
    if (userError || !user) {
      return res.status(401).json({ success: false, error: 'Email ou senha incorretos' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, error: 'Email ou senha incorretos' });
    }

    // Criar sessão e cookies compatíveis (sid/uid/uname/uemail/uavatar/uexp)
    const { sid, expiresAt } = await createSession(user);
    const maxAge = 30 * 24 * 60 * 60; // 30 dias
    const isHttps = String(req.headers['x-forwarded-proto'] || '').includes('https');
    const cookieFlags = `HttpOnly; Path=/; SameSite=Lax${isHttps ? '; Secure' : ''}`;
    res.setHeader('Set-Cookie', [
      `sid=${sid}; ${cookieFlags}; Max-Age=${maxAge}`,
      `uid=${encodeURIComponent(String(user.id))}; ${cookieFlags}; Max-Age=${maxAge}`,
      `uname=${encodeURIComponent(user.username || '')}; ${cookieFlags}; Max-Age=${maxAge}`,
      `uavatar=${encodeURIComponent(user.avatar || '')}; ${cookieFlags}; Max-Age=${maxAge}`,
      `uemail=${encodeURIComponent(user.email || '')}; ${cookieFlags}; Max-Age=${maxAge}`,
      `uexp=${encodeURIComponent(expiresAt)}; ${cookieFlags}; Max-Age=${maxAge}`
    ]);

    return res.status(200).json({
      success: true,
      message: 'Login realizado com sucesso',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        avatar: user.avatar || null,
        hasProfile: !!user.profile_name
      }
    });
  } catch (error) {
    console.error('Erro no login:', error);
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
}
import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { email, password, username, name } = req.body || {};
    const finalUsername = (username || name || '').trim();

    // Validação básica
    if (!email || !password || !finalUsername) {
      return res.status(400).json({ success: false, error: 'Email, senha e nome de usuário são obrigatórios' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'A senha deve ter pelo menos 6 caracteres' });
    }

    if (!supabase) {
      // Fallback sem Supabase: gerar usuário e sessão em cookies (ambiente de testes)
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
    }

    // --- Fluxo com Supabase ---
    // Verificar email existente
    const { data: existingEmail } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (existingEmail && existingEmail.id) {
      return res.status(400).json({ success: false, error: 'Este email já está em uso' });
    }

    // Verificar username existente
    const { data: existingUsername } = await supabase
      .from('users')
      .select('id')
      .eq('username', finalUsername)
      .maybeSingle();
    if (existingUsername && existingUsername.id) {
      return res.status(400).json({ success: false, error: 'Este nome de usuário já está em uso' });
    }

    // Hash da senha
    const hashedPassword = await bcrypt.hash(password, 12);

    // Criar usuário
    const { data: newUser, error: createError } = await supabase
      .from('users')
      .insert({
        email,
        username: finalUsername,
        password_hash: hashedPassword,
        auth_type: 'traditional',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (createError) {
      console.error('Erro ao criar usuário:', createError);
      return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
    }

    return res.status(201).json({
      success: true,
      message: 'Conta criada com sucesso',
      user: { id: newUser.id, email: newUser.email, username: newUser.username }
    });
  } catch (error) {
    console.error('Erro no registro:', error);
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
}
// Importa as funções auxiliares
import { createClient } from '@supabase/supabase-js';

// Helper para cookies
function setCookie(res, name, value, options = {}) {
  const opts = {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60, // 30 dias
    ...options
  };
  
  const cookie = Object.entries(opts).reduce((acc, [key, value]) => {
    if (value === true) return `${acc}; ${key}`;
    if (value === false) return acc;
    return `${acc}; ${key}=${value}`;
  }, `${name}=${encodeURIComponent(value)}`);
  
  res.setHeader('Set-Cookie', cookie);
}

export default async function handler(req, res) {
  // Apenas POST
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Método não permitido' });
  }

  try {
    const { fullname, email, password } = req.body;

    // Validação básica
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

      // Set session cookies
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

    // Fallback: criar usuário local (você pode implementar sua própria lógica aqui)
    const userId = 'user_' + Math.random().toString(36).substr(2, 9);
    
    // Set session cookies
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
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

// Função para extrair dados do usuário do cookie
function getUserFromCookie(req) {
    const cookie = req.headers.cookie;
    if (!cookie) return null;

    // Compatível com cookies existentes: sid + auxiliares
    const parts = cookie.split(';').map(c => c.trim());
    const sidPart = parts.find(c => c.startsWith('sid='));
    const uidPart = parts.find(c => c.startsWith('uid='));
    const unamePart = parts.find(c => c.startsWith('uname='));
    const uavatarPart = parts.find(c => c.startsWith('uavatar='));
    const uemailPart = parts.find(c => c.startsWith('uemail='));
    if (!sidPart || !uidPart) return null;

    try {
        const sid = decodeURIComponent(sidPart.split('=')[1] || '');
        const userId = decodeURIComponent(uidPart.split('=')[1] || '');
        const username = unamePart ? decodeURIComponent(unamePart.split('=')[1] || '') : '';
        const avatar = uavatarPart ? decodeURIComponent(uavatarPart.split('=')[1] || '') : '';
        const email = uemailPart ? decodeURIComponent(uemailPart.split('=')[1] || '') : '';
        return { sid, userId, username, avatar, email };
    } catch (error) {
        return null;
    }
}

export default async function handler(req, res) {
    try {
        const user = getUserFromCookie(req);
        if (!user) {
            return res.status(401).json({ error: 'Usuário não autenticado' });
        }

        if (req.method === 'POST') {
            // Criar/atualizar perfil
            const { profileName, avatar } = req.body || {};

            if (!profileName) {
                return res.status(400).json({ error: 'Nome do perfil é obrigatório' });
            }

            let updatedUser = { id: user.userId, email: user.email, username: profileName, avatar };
            if (supabase) {
                // Atualizar usuário com dados do perfil
                const { data, error: updateError } = await supabase
                    .from('users')
                    .update({
                        profile_name: profileName,
                        avatar: avatar,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', user.userId)
                    .select()
                    .single();
                if (updateError) {
                    console.error('Erro ao atualizar perfil:', updateError);
                } else {
                    updatedUser = data || updatedUser;
                }

                // Atualizar sessão com novos dados
                const { error: sessionError } = await supabase
                    .from('sessions')
                    .update({
                        username: profileName,
                        avatar: avatar
                    })
                    .eq('user_id', user.userId);
                if (sessionError) {
                    console.error('Erro ao atualizar sessão:', sessionError);
                }
            }

            // Atualizar cookie
            const maxAge = 30 * 24 * 60 * 60;
            const isHttps = String(req.headers['x-forwarded-proto'] || '').includes('https');
            const cookieFlags = `HttpOnly; Path=/; SameSite=Lax${isHttps ? '; Secure' : ''}`;
            res.setHeader('Set-Cookie', [
              `uname=${encodeURIComponent(profileName)}; ${cookieFlags}; Max-Age=${maxAge}`,
              `uavatar=${encodeURIComponent(avatar || '')}; ${cookieFlags}; Max-Age=${maxAge}`
            ]);

            res.status(200).json({
                success: true,
                message: 'Perfil criado com sucesso',
                user: {
                    id: updatedUser.id,
                    email: updatedUser.email,
                    username: profileName,
                    avatar: avatar
                }
            });

        } else if (req.method === 'GET') {
            // Buscar dados do perfil atual
            if (supabase) {
                const { data: userData, error: userError } = await supabase
                    .from('users')
                    .select('id, email, username, profile_name, avatar, auth_type')
                    .eq('id', user.userId)
                    .single();
                if (userError) {
                    return res.status(404).json({ error: 'Usuário não encontrado' });
                }
                res.status(200).json({
                    success: true,
                    user: {
                        id: userData.id,
                        email: userData.email,
                        username: userData.username,
                        profileName: userData.profile_name,
                        avatar: userData.avatar,
                        authType: userData.auth_type,
                        hasProfile: !!userData.profile_name
                    }
                });
            } else {
                // Fallback sem Supabase: usar cookies
                res.status(200).json({
                    success: true,
                    user: {
                        id: user.userId,
                        email: user.email,
                        username: user.username,
                        profileName: user.username || '',
                        avatar: user.avatar,
                        authType: 'password',
                        hasProfile: !!user.username
                    }
                });
            }

        } else {
            res.status(405).json({ error: 'Method not allowed' });
        }

    } catch (error) {
        console.error('Erro na API de perfil:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
}
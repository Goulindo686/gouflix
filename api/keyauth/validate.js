export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false, error: 'Método não permitido' });
    }

    const body = await readBody(req);
    const licenseKey = body?.licenseKey || body?.key || '';
    const hwid = body?.hwid || '';
    if (!licenseKey || !hwid) {
      return res.status(400).json({ ok: false, error: 'key e hwid são obrigatórios' });
    }

    const appName = process.env.KEYAUTH_APP_NAME || '';
    const ownerId = process.env.KEYAUTH_OWNER_ID || '';
    const appVersion = process.env.KEYAUTH_APP_VERSION || '1.0.0';
    const baseClient = process.env.KEYAUTH_API_URL || 'https://keyauth.win/api/1.0/';
    const ignoreHwid = String(process.env.KEYAUTH_IGNORE_HWID || '').toLowerCase() === 'true';

    let timeleft = null; // null quando o campo não vier do KeyAuth
    let serverHwid = null;
    let status = 'active';
    let banned = false;
    // Tentar diretamente a Client API sem secret, conforme solicitação
    if (appName && ownerId) {
      const loginUrl = `${baseClient}?name=${encodeURIComponent(appName)}&ownerid=${encodeURIComponent(ownerId)}&version=${encodeURIComponent(appVersion)}&type=license&key=${encodeURIComponent(licenseKey)}&hwid=${encodeURIComponent(hwid)}&format=json`;
      const login = await fetchJson(loginUrl);
      if (login?.success) {
        const data = login.data || login.info || login;
        const tl = (data?.timeleft ?? data?.time_left ?? data?.timeLeft);
        timeleft = tl != null ? (parseInt(String(tl), 10) || 0) : null;
        serverHwid = data?.hwid || data?.device || data?.bound_hwid || null;
        status = String(data?.status || data?.state || 'active').toLowerCase();
        banned = String(data?.banned || data?.is_banned || '').toLowerCase() === 'true';
      } else {
        return res.status(403).json({ ok: false, error: login?.message || 'licença inválida', reason: 'client_license_failed' });
      }
    } else {
      return res.status(500).json({ ok: false, error: 'Credenciais do KeyAuth ausentes (name/ownerid)', reason: 'client_missing_credentials' });
    }

    // Checagens finais
    if (banned) return res.status(403).json({ ok: false, error: 'licença banida', reason: 'banned' });
    if (typeof timeleft === 'number' && Number.isFinite(timeleft) && timeleft <= 0) {
      return res.status(403).json({ ok: false, error: 'licença expirada', reason: 'expired' });
    }
    if (status && ['disabled', 'inactive', 'invalid'].includes(status)) return res.status(403).json({ ok: false, error: 'licença inativa', reason: 'inactive' });

    // Importante: em Vercel não persistimos HWID localmente.
    // Se a Client API retornar um HWID diferente, podemos ainda aceitar se o Seller API indicou tempo restante.
    // Isso evita bloqueio indevido quando a licença foi vinculada via outro app.
    if (serverHwid && serverHwid !== hwid && appName && ownerId && !ignoreHwid) {
      return res.status(403).json({ ok: false, error: 'HWID não corresponde ao dispositivo vinculado', reason: 'hwid_mismatch' });
    }

    return res.status(200).json({ ok: true, timeleft, bound: !!serverHwid });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'falha ao validar no KeyAuth', reason: 'server_error', details: err?.message || String(err) });
  }
}

async function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch (_) { resolve({}); }
    });
  });
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
  try {
    return await r.json();
  } catch (_) {
    return { success: false, message: `invalid json from ${url}` };
  }
}
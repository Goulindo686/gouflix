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
    const appSecret = process.env.KEYAUTH_APP_SECRET || '';
    const appVersion = process.env.KEYAUTH_APP_VERSION || '1.0.0';
    const sellerKey = process.env.KEYAUTH_SELLER_KEY || '';
    const baseClient = process.env.KEYAUTH_API_URL || 'https://keyauth.win/api/1.0/';

    let timeleft = 0;
    let serverHwid = null;
    let status = 'active';
    let banned = false;

    // Primeiro: tentar Client API se credenciais estão presentes
    if (appName && ownerId && appSecret) {
      const initUrl = `${baseClient}?name=${encodeURIComponent(appName)}&ownerid=${encodeURIComponent(ownerId)}&version=${encodeURIComponent(appVersion)}&secret=${encodeURIComponent(appSecret)}&type=init&format=json`;
      const init = await fetchJson(initUrl);
      if (!init?.success) {
        // Falha no init; se houver sellerKey, tentar fallback
        if (!sellerKey) {
          return res.status(500).json({ ok: false, error: 'Falha ao inicializar KeyAuth (client)', details: init?.message || 'init error' });
        }
      } else {
        const loginUrl = `${baseClient}?name=${encodeURIComponent(appName)}&ownerid=${encodeURIComponent(ownerId)}&version=${encodeURIComponent(appVersion)}&secret=${encodeURIComponent(appSecret)}&type=license&key=${encodeURIComponent(licenseKey)}&hwid=${encodeURIComponent(hwid)}&format=json`;
        const login = await fetchJson(loginUrl);
        if (login?.success) {
          const data = login.data || login.info || login;
          timeleft = parseInt((data?.timeleft || data?.time_left || data?.timeLeft) || '0', 10) || 0;
          serverHwid = data?.hwid || data?.device || data?.bound_hwid || null;
          status = String(data?.status || data?.state || 'active').toLowerCase();
          banned = String(data?.banned || data?.is_banned || '').toLowerCase() === 'true';
        } else if (!sellerKey) {
          return res.status(403).json({ ok: false, error: login?.message || 'licença inválida' });
        }
      }
    }

    // Fallback Seller API (sem HWID) caso client falhe ou não esteja configurado
    if ((!appName || !ownerId || !appSecret) || timeleft === 0 && sellerKey) {
      if (sellerKey) {
        const sellerBase = 'https://keyauth.win/api/seller/';
        const infoUrl = `${sellerBase}?sellerkey=${encodeURIComponent(sellerKey)}&type=licenseinfo&key=${encodeURIComponent(licenseKey)}&format=json`;
        const info = await fetchJson(infoUrl);
        if (!info?.success) {
          return res.status(403).json({ ok: false, error: info?.message || 'licença inválida' });
        }
        const data = info.data || info.license || info.info || info;
        timeleft = parseInt((data?.timeleft || data?.time_left || data?.timeLeft) || '0', 10) || 0;
        serverHwid = data?.hwid || data?.device || data?.bound_hwid || null;
        status = String(data?.status || data?.state || 'active').toLowerCase();
        banned = String(data?.banned || data?.is_banned || '').toLowerCase() === 'true';
      }
    }

    // Checagens finais
    if (banned) return res.status(403).json({ ok: false, error: 'licença banida' });
    if (Number.isFinite(timeleft) && timeleft <= 0) return res.status(403).json({ ok: false, error: 'licença expirada' });
    if (status && ['disabled', 'inactive', 'invalid'].includes(status)) return res.status(403).json({ ok: false, error: 'licença inativa' });

    // Importante: em Vercel não persistimos HWID localmente.
    // Se a Client API retornar um HWID diferente, podemos ainda aceitar se o Seller API indicou tempo restante.
    // Isso evita bloqueio indevido quando a licença foi vinculada via outro app.
    if (serverHwid && serverHwid !== hwid && appName && ownerId && appSecret && !sellerKey) {
      return res.status(403).json({ ok: false, error: 'HWID não corresponde ao dispositivo vinculado' });
    }

    return res.status(200).json({ ok: true, timeleft, bound: !!serverHwid });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'falha ao validar no KeyAuth', details: err?.message || String(err) });
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
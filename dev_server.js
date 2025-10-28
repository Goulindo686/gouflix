try { require('dotenv').config(); } catch (_e) {
  // Fallback simples para carregar .env sem dependência
  try {
    const fs = require('fs');
    const path = require('path');
    const root = process.cwd();
    const envPath = path.join(root, '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      content.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const idx = trimmed.indexOf('=');
        if (idx === -1) return;
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!(key in process.env)) process.env[key] = val;
      });
    }
  } catch (_) { /* ignore */ }
}
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
// Removido: integração Mercado Pago

const root = process.cwd();
const port = process.env.PORT || 8000;

const types = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

// --- Persistência: arquivo local + opção remota ---
const statePath = path.join(root, 'data', 'state.json');
function ensureState() {
  try {
    if (!fs.existsSync(statePath)) {
      const initial = { added: [], removed: [], subscriptions: {}, config: { publicUrl: process.env.PUBLIC_URL || 'https://gouflix.discloud.app' } };
      fs.writeFileSync(statePath, JSON.stringify(initial, null, 2));
    }
  } catch (_) {}
}
function defaultState() {
  return { added: [], removed: [], subscriptions: {}, config: { publicUrl: process.env.PUBLIC_URL || 'https://gouflix.discloud.app', bootstrapMoviesUrl: process.env.BOOTSTRAP_MOVIES_URL || '', bootstrapAuto: !!(process.env.BOOTSTRAP_AUTO || false), bootstrapDone: 0 } };
}
function normalizeState(s) {
  const state = s || {};
  state.added = Array.isArray(state.added) ? state.added : [];
  state.removed = Array.isArray(state.removed) ? state.removed : [];
  state.subscriptions = state.subscriptions || {};
  state.config = state.config || {};
  if (!state.config.publicUrl) state.config.publicUrl = process.env.PUBLIC_URL || 'https://gouflix.discloud.app';
  if (!state.config.bootstrapMoviesUrl) state.config.bootstrapMoviesUrl = process.env.BOOTSTRAP_MOVIES_URL || '';
  if (typeof state.config.bootstrapAuto === 'undefined') state.config.bootstrapAuto = !!(process.env.BOOTSTRAP_AUTO || false);
  if (!state.config.bootstrapDone) state.config.bootstrapDone = 0;
  return state;
}

const REMOTE_STATE_URL = process.env.REMOTE_STATE_URL || '';
const REMOTE_STATE_TOKEN = process.env.REMOTE_STATE_TOKEN || '';
function hasRemoteState() { return !!REMOTE_STATE_URL; }
function remoteGetState() {
  if (!hasRemoteState()) return Promise.resolve(null);
  const mod = String(REMOTE_STATE_URL).startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    try {
      const req = mod.get(REMOTE_STATE_URL, { headers: REMOTE_STATE_TOKEN ? { Authorization: `Bearer ${REMOTE_STATE_TOKEN}` } : {} }, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) { reject(new Error(`remote status ${res.statusCode}`)); return; }
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch (err) { reject(err); } });
      });
      req.on('error', (err) => reject(err));
    } catch (err) { reject(err); }
  });
}
function remoteSetState(state) {
  if (!hasRemoteState()) return Promise.resolve(false);
  const payload = JSON.stringify(normalizeState(state));
  const urlObj = new URL(REMOTE_STATE_URL);
  const mod = urlObj.protocol === 'https:' ? https : http;
  const options = {
    method: 'PUT',
    hostname: urlObj.hostname,
    port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
    path: urlObj.pathname + (urlObj.search || ''),
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      ...(REMOTE_STATE_TOKEN ? { Authorization: `Bearer ${REMOTE_STATE_TOKEN}` } : {})
    }
  };
  return new Promise((resolve, reject) => {
    const req = mod.request(options, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) { reject(new Error(`remote status ${res.statusCode}`)); return; }
      res.on('data', ()=>{});
      res.on('end', () => resolve(true));
    });
    req.on('error', (err) => reject(err));
    req.write(payload);
    req.end();
  });
}

async function readState() {
  if (hasRemoteState()) {
    try {
      const remote = await remoteGetState();
      if (remote && typeof remote === 'object') return normalizeState(remote);
    } catch (err) {
      console.error('Falha ao ler estado remoto:', err);
    }
  }
  ensureState();
  try {
    const s = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    return normalizeState(s);
  } catch (_) {
    return defaultState();
  }
}
async function writeState(state) {
  if (hasRemoteState()) {
    try { await remoteSetState(state); } catch (err) { console.error('Falha ao salvar estado remoto:', err); }
  }
  try {
    fs.writeFileSync(statePath, JSON.stringify(normalizeState(state), null, 2));
    return true;
  } catch (_) {
    return false;
  }
}
function getKey(item) {
  if (item && item.tmdbId) return `${item.type || 'filme'}:${item.tmdbId}`;
  if (item && item.id) return `seed:${item.id}`;
  return '';
}
function parseBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch (_) {
        resolve({});
      }
    });
  });
}

// ---- Util: baixar JSON remoto ----
function fetchJsonUrl(u) {
  return new Promise((resolve, reject) => {
    try {
      const mod = String(u).startsWith('https') ? https : http;
      const req = mod.get(u, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`status ${res.statusCode}`));
          return;
        }
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (err) { reject(err); }
        });
      });
      req.on('error', (err) => reject(err));
    } catch (err) { reject(err); }
  });
}

// ---- KeyAuth Client API (ownerid/appname/version) ----
async function keyauthClientLicense(appName, ownerId, version, licenseKey, hwid) {
  const base = process.env.KEYAUTH_API_URL || 'https://keyauth.win/api/1.0/';
  const url = `${base}?name=${encodeURIComponent(appName)}&ownerid=${encodeURIComponent(ownerId)}&version=${encodeURIComponent(version || '1.0.0')}&type=license&key=${encodeURIComponent(licenseKey)}&hwid=${encodeURIComponent(hwid)}&format=json`;
  try {
    return await fetchJsonUrl(url);
  } catch (err) {
    return { success: false, message: String(err) };
  }
}

// ---- Bootstrap automático ao iniciar ----
async function bootstrapFromConfig(force = false) {
  try {
    const state = await readState();
    const cfg = state.config || {};
    const shouldRun = force || (cfg.bootstrapAuto && !cfg.bootstrapDone);
    if (!shouldRun) return;

    // Removido: bootstrap de state.json remoto (somente movies.json)

    // Baixar e substituir movies.json remoto
    const moviesPath = path.join(root, 'data', 'movies.json');
    if (cfg.bootstrapMoviesUrl) {
      try {
        const movies = await fetchJsonUrl(cfg.bootstrapMoviesUrl);
        fs.writeFileSync(moviesPath, JSON.stringify(movies, null, 2));
      } catch (err) {
        console.error('Bootstrap: falha ao baixar movies.json:', err);
      }
    }

    const updated = await readState();
    updated.config.bootstrapDone = Date.now();
    await writeState(updated);
    console.log('Bootstrap concluído.');
  } catch (err) {
    console.error('Bootstrap erro:', err);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const [pathOnly, queryStr] = req.url.split('?');
    const urlPath = decodeURIComponent(pathOnly);

    // API de persistência
    if (urlPath.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json');
      const params = new URLSearchParams(queryStr || '');
      // ----- KEYAUTH VALIDATE LICENSE -----
      if (urlPath === '/api/keyauth/validate' && req.method === 'POST') {
        const body = await parseBody(req);
        // Aceitar tanto 'key' quanto 'licenseKey' enviados pelo frontend
        const licenseKey = (body && (body.key || body.licenseKey)) || '';
        const hwid = (body && body.hwid) || '';
        if (!licenseKey || !hwid) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: 'key e hwid são obrigatórios' }));
          return;
        }
        const appName = process.env.KEYAUTH_APP_NAME || '';
        const ownerId = process.env.KEYAUTH_OWNER_ID || '';
        const appVersion = process.env.KEYAUTH_APP_VERSION || '1.0.0';
        const ignoreHwid = String(process.env.KEYAUTH_IGNORE_HWID || '').toLowerCase() === 'true';
        try {
          let timeleft = null; // null quando não houver campo
          let serverHwid = null;
          let status = 'active';
          let banned = false;
          if (appName && ownerId) {
            const login = await keyauthClientLicense(appName, ownerId, appVersion, licenseKey, hwid);
            if (!login || login.success === false) {
              res.statusCode = 403;
              res.end(JSON.stringify({ ok: false, error: (login && login.message) || 'licença inválida' }));
              return;
            }
            // Tentar extrair tempo restante
            const data = login.data || login.info || login;
            const tl = data && (data.timeleft ?? data.time_left ?? data.timeLeft);
            timeleft = tl != null ? (parseInt(String(tl), 10) || 0) : null;
            serverHwid = (data && (data.hwid || data.device || data.bound_hwid)) || null;
            status = String((data && (data.status || data.state)) || 'active').toLowerCase();
            banned = String((data && (data.banned || data.is_banned)) || '').toLowerCase() === 'true';
          } else {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: 'Credenciais KeyAuth não configuradas (name/ownerid)' }));
            return;
          }

          // Checar expiração/banimento/estado
          if (banned) {
            res.statusCode = 403;
            res.end(JSON.stringify({ ok: false, error: 'licença banida' }));
            return;
          }
          if (typeof timeleft === 'number' && Number.isFinite(timeleft) && timeleft <= 0) {
            res.statusCode = 403;
            res.end(JSON.stringify({ ok: false, error: 'licença expirada' }));
            return;
          }
          if (status && ['disabled', 'inactive', 'invalid'].includes(status)) {
            res.statusCode = 403;
            res.end(JSON.stringify({ ok: false, error: 'licença inativa' }));
            return;
          }

          // Enforce single device: key -> hwid mapping in local state
          const state = await readState();
          state.keyauth = state.keyauth || { keys: {} };
          const existing = state.keyauth.keys[licenseKey];
          const now = Date.now();
          if (existing && existing.hwid && existing.hwid !== hwid) {
            res.statusCode = 403;
            res.end(JSON.stringify({ ok: false, error: 'licença já vinculada a outro dispositivo' }));
            return;
          }
          // Se o KeyAuth já possui HWID e é diferente, bloquear
          if (serverHwid && serverHwid !== hwid && !ignoreHwid) {
            res.statusCode = 403;
            res.end(JSON.stringify({ ok: false, error: 'HWID não corresponde ao dispositivo vinculado' }));
            return;
          }
          // Vincular localmente se ainda não houver registro
          state.keyauth.keys[licenseKey] = {
            hwid,
            lastValidatedAt: now,
            timeleft: timeleft,
            status: status || 'active'
          };
          await writeState(state);

          res.end(JSON.stringify({ ok: true, timeleft, bound: true }));
          return;
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: 'falha ao validar no KeyAuth', details: String(err) }));
          return;
        }
      }
      // ----- CONFIG -----
      if (urlPath === '/api/config' && req.method === 'GET') {
        const state = await readState();
        const cfg = state.config || {};
        const publicUrl = cfg.publicUrl || process.env.PUBLIC_URL || 'https://gouflix.discloud.app';
        res.end(JSON.stringify({ publicUrl, bootstrapMoviesUrl: cfg.bootstrapMoviesUrl || '', bootstrapAuto: !!cfg.bootstrapAuto, bootstrapDone: cfg.bootstrapDone || 0 }));
        return;
      }
      if (urlPath === '/api/config' && req.method === 'POST') {
        const body = await parseBody(req);
        const state = await readState();
        state.config.publicUrl = body.publicUrl || state.config.publicUrl || process.env.PUBLIC_URL || 'https://gouflix.discloud.app';
        // salvar config de bootstrap (sem state)
        if (body.bootstrapMoviesUrl !== undefined) state.config.bootstrapMoviesUrl = body.bootstrapMoviesUrl || '';
        if (body.bootstrapAuto !== undefined) state.config.bootstrapAuto = !!body.bootstrapAuto;
        await writeState(state);
        res.end(JSON.stringify({ ok: true, config: state.config }));
        return;
      }
      // Disparar bootstrap manualmente
      if (urlPath === '/api/bootstrap/run' && req.method === 'POST') {
        await bootstrapFromConfig(true);
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      // ----- SUBSCRIPTION STATUS -----
      if (urlPath === '/api/subscription' && req.method === 'GET') {
        const state = await readState();
        const list = params.get('list');
        if (list) {
          const statusFilter = params.get('status');
          const rows = Object.values(state.subscriptions||{}).map(s=>{
            const endAt = s.expiry ? new Date(s.expiry) : null;
            const startAt = s.start ? new Date(s.start) : null;
            const expired = endAt ? (endAt.getTime() <= Date.now()) : false;
            const status = expired ? 'inactive' : (s.status||'active');
            return {
              user_id: s.userId,
              plan: s.plan,
              start_at: startAt ? startAt.toISOString() : null,
              end_at: endAt ? endAt.toISOString() : null,
              status,
              payment_id: s.paymentId||null,
            };
          });
          const filtered = statusFilter ? rows.filter(r=> String(r.status) === String(statusFilter)) : rows;
          res.end(JSON.stringify({ ok:true, subscriptions: filtered }));
          return;
        }
        const userId = params.get('userId');
        if (!userId) { res.statusCode = 400; res.end(JSON.stringify({ ok:false, error:'userId required' })); return; }
        const sub = state.subscriptions[userId] || null;
        if (sub) {
          const now = Date.now();
          const active = (sub.expiry || 0) > now;
          sub.active = active;
          if (!active) sub.status = 'inactive'; else sub.status = 'active';
          await writeState(state);
        }
        res.end(JSON.stringify({ ok: true, subscription: sub }));
        return;
      }
      // ----- DEACTIVATE SUBSCRIPTION -----
      if (urlPath === '/api/subscription/deactivate' && req.method === 'POST') {
        const body = await parseBody(req);
        const { userId } = body;
        if(!userId){ res.statusCode = 400; res.end(JSON.stringify({ ok:false, error:'userId required' })); return; }
        const state = await readState();
        const sub = state.subscriptions[userId];
        if(sub){
          sub.active = false; sub.status = 'inactive'; sub.expiry = Date.now();
          await writeState(state);
        }
        res.end(JSON.stringify({ ok:true }));
        return;
      }
      // ----- ACTIVATE AFTER RETURN -----
      if (urlPath === '/api/subscription/activate' && req.method === 'POST') {
        const body = await parseBody(req);
        const { userId, plan, status, paymentId } = body;
        if (!userId || !plan || !status) { res.statusCode = 400; res.end(JSON.stringify({ ok:false, error:'userId, plan, status required' })); return; }
        if (status !== 'approved') { res.statusCode = 400; res.end(JSON.stringify({ ok:false, error:'status not approved' })); return; }
        const daysMap = { mensal: 30, trimestral: 90, anual: 365 };
        const days = daysMap[plan];
        if (!days) { res.statusCode = 400; res.end(JSON.stringify({ ok:false, error:'invalid plan' })); return; }
        const now = Date.now();
        const state = await readState();
        state.subscriptions[userId] = {
          userId,
          plan,
          start: now,
          expiry: now + days * 24 * 60 * 60 * 1000,
          status: 'active',
          active: true,
          paymentId: paymentId || null
        };
        await writeState(state);
        res.end(JSON.stringify({ ok:true }));
        return;
      }
      // CORS não é necessário pois é mesma origem
      if (urlPath === '/api/state' && req.method === 'GET') {
        const state = await readState();
        res.end(JSON.stringify(state));
        return;
      }
      // Exportar estado completo
      if (urlPath === '/api/state/export' && req.method === 'GET') {
        const state = await readState();
        res.end(JSON.stringify(state));
        return;
      }
      // Importar/mesclar estado (opcional replace)
      if (urlPath === '/api/state/import' && req.method === 'POST') {
        const body = await parseBody(req);
        const { state: incoming, replace } = body;
        if (!incoming || typeof incoming !== 'object') {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok:false, error:'invalid state payload' }));
          return;
        }
        const current = await readState();
        if (replace) {
          await writeState({
            added: Array.isArray(incoming.added) ? incoming.added : [],
            removed: Array.isArray(incoming.removed) ? incoming.removed : [],
            subscriptions: incoming.subscriptions || {},
            config: current.config // não sobrescreve config do servidor
          });
        } else {
          // mesclar listas
          const merged = {
            added: [...(current.added||[]), ...((incoming.added||[]).filter(i=> !(current.added||[]).some(j=> (j.key||'') === (i.key||''))))],
            removed: Array.from(new Set([...(current.removed||[]), ...((incoming.removed||[]))])),
            subscriptions: { ...(current.subscriptions||{}), ...(incoming.subscriptions||{}) },
            config: current.config
          };
          await writeState(merged);
        }
        res.end(JSON.stringify({ ok:true }));
        return;
      }
      if (urlPath === '/api/state/add' && req.method === 'POST') {
        const body = await parseBody(req);
        const state = await readState();
        const key = body.key || getKey(body);
        if (!key) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: 'invalid item/key' }));
          return;
        }
        const exists = state.added.some((i) => (i.key || getKey(i)) === key);
        if (!exists) {
          state.added.push({ ...body, key });
        }
        // Se estava removido, tirar da lista de removidos
        state.removed = state.removed.filter((k) => k !== key);
        await writeState(state);
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (urlPath === '/api/state/remove' && req.method === 'POST') {
        const body = await parseBody(req);
        const state = await readState();
        const key = body.key;
        if (!key) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: 'key required' }));
          return;
        }
        // remover de added, se existir
        state.added = state.added.filter((i) => (i.key || getKey(i)) !== key);
        // adicionar à lista de removidos
        if (!state.removed.includes(key)) state.removed.push(key);
        await writeState(state);
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (urlPath === '/api/state/unremove' && req.method === 'POST') {
        const body = await parseBody(req);
        const state = await readState();
        const key = body.key;
        state.removed = state.removed.filter((k) => k !== key);
        await writeState(state);
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ ok: false, error: 'Not Found' }));
      return;
    }

    // Arquivos estáticos
    let target = path.join(root, urlPath);
    if (urlPath === '/' || urlPath === '') {
      target = path.join(root, 'index.html');
    }
    if (fs.existsSync(target) && fs.statSync(target).isFile()) {
      const ext = path.extname(target);
      res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
      // Evitar cache para garantir que novas versões apareçam após deploy
      res.setHeader('Cache-Control', 'no-store');
      fs.createReadStream(target).pipe(res);
    } else {
      res.statusCode = 404;
      res.end('Not Found');
    }
  } catch (err) {
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
});

server.listen(port, () => {
  console.log(`Preview running at http://localhost:${port}/`);
  // Iniciar bootstrap em background (não bloqueia o servidor)
  bootstrapFromConfig(false);
});
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
  return { added: [], removed: [], subscriptions: {}, config: { publicUrl: process.env.PUBLIC_URL || 'https://gouflix.discloud.app', bootstrapMoviesUrl: process.env.BOOTSTRAP_MOVIES_URL || '', bootstrapAuto: !!(process.env.BOOTSTRAP_AUTO || false), bootstrapDone: 0, mpAccessToken: process.env.MP_ACCESS_TOKEN || process.env.MERCADOPAGO_ACCESS_TOKEN || '' } };
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
  if (typeof state.config.mpAccessToken === 'undefined') state.config.mpAccessToken = process.env.MP_ACCESS_TOKEN || process.env.MERCADOPAGO_ACCESS_TOKEN || '';
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
      // Cabeçalhos de segurança básicos
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
      res.setHeader('Content-Security-Policy', "default-src 'self' https: data:; img-src 'self' https: data: blob:; style-src 'self' 'unsafe-inline' https:; script-src 'self' https://cdn.jsdelivr.net; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'self'");
      const params = new URLSearchParams(queryStr || '');
      // /api/env para local (sem rewrite do Vercel)
      if (urlPath === '/api/env' && req.method === 'GET') {
        res.end(JSON.stringify({
          SUPABASE_URL: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || null,
          SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || null,
          TMDB_BASE: process.env.TMDB_BASE || 'https://api.themoviedb.org/3',
          TMDB_IMG: process.env.TMDB_IMG || 'https://image.tmdb.org/t/p/w500',
          TMDB_TOKEN: process.env.TMDB_TOKEN || null,
          NEXTAUTH_URL: process.env.NEXTAUTH_URL || null,
          ADMIN_IDS: process.env.ADMIN_IDS || null,
          ADMIN_USERNAMES: process.env.ADMIN_USERNAMES || null,
        }));
        return;
      }
      // ----- CONFIG -----
      if (urlPath === '/api/config' && req.method === 'GET') {
        const state = await readState();
        const cfg = state.config || {};
        const publicUrl = cfg.publicUrl || process.env.PUBLIC_URL || 'https://gouflix.discloud.app';
        const isAdmin = ensureIsAdminLocal(req);
        const hasMpAccessToken = !!(cfg.mpAccessToken && String(cfg.mpAccessToken).length);
        res.end(JSON.stringify({ publicUrl, bootstrapMoviesUrl: cfg.bootstrapMoviesUrl || '', bootstrapAuto: !!cfg.bootstrapAuto, bootstrapDone: cfg.bootstrapDone || 0, writable: !!isAdmin, hasMpAccessToken }));
        return;
      }
      if (urlPath === '/api/config' && req.method === 'POST') {
        if(!ensureIsAdminLocal(req)){ res.statusCode = 403; res.end(JSON.stringify({ ok:false, error:'forbidden' })); return; }
        const body = await parseBody(req);
        const state = await readState();
        state.config.publicUrl = body.publicUrl || state.config.publicUrl || process.env.PUBLIC_URL || 'https://gouflix.discloud.app';
        // salvar config de bootstrap (sem state)
        if (body.bootstrapMoviesUrl !== undefined) state.config.bootstrapMoviesUrl = body.bootstrapMoviesUrl || '';
        if (body.bootstrapAuto !== undefined) state.config.bootstrapAuto = !!body.bootstrapAuto;
        if (body.mpAccessToken !== undefined) state.config.mpAccessToken = String(body.mpAccessToken || '');
        await writeState(state);
        res.end(JSON.stringify({ ok: true, config: { ...state.config, mpAccessToken: undefined } }));
        return;
      }
      // Disparar bootstrap manualmente
      if (urlPath === '/api/bootstrap/run' && req.method === 'POST') {
        if(!ensureIsAdminLocal(req)){ res.statusCode = 403; res.end(JSON.stringify({ ok:false, error:'forbidden' })); return; }
        await bootstrapFromConfig(true);
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      // ----- Pagamentos (Mercado Pago PIX) -----
      if (urlPath === '/api/payment/create' && req.method === 'POST') {
        try {
          const currentState = await readState();
          const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || process.env.MERCADOPAGO_ACCESS_TOKEN || currentState.config?.mpAccessToken || '';
          const PUBLIC_URL = process.env.PUBLIC_URL || '';
          if (!MP_ACCESS_TOKEN) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok:false, error:'MP_ACCESS_TOKEN não configurado' }));
            return;
          }
          const body = await parseBody(req);
          const plan = String(body?.plan||'').toLowerCase();
          const userId = String(body?.userId||'').trim();
          const PLAN_PRICES = { mensal: 19.90, trimestral: 49.90, anual: 147.90 };
          const amount = PLAN_PRICES[plan];
          if(!userId || !amount){
            res.statusCode = 400;
            res.end(JSON.stringify({ ok:false, error:'Parâmetros inválidos (userId/plan)' }));
            return;
          }
          let emailDomain = 'gouflix.app';
          try{ if(PUBLIC_URL){ const u = new URL(PUBLIC_URL); if(u.hostname && u.hostname.includes('.')) emailDomain = u.hostname; } }catch(_){}
          const safeUser = String(userId).replace(/[^a-zA-Z0-9_.+-]/g,'_');
          const payerEmail = `${safeUser}@${emailDomain}`;
          const preference = {
            transaction_amount: Number(Number(amount).toFixed(2)),
            description: `Assinatura GouFlix — ${plan}`,
            payment_method_id: 'pix',
            payer: { email: payerEmail },
            notification_url: PUBLIC_URL ? `${PUBLIC_URL}/api/webhook/mercadopago` : undefined,
            external_reference: `${userId}|${plan}|${Date.now()}`
          };
          const r = await fetch('https://api.mercadopago.com/v1/payments',{
            method:'POST',
            headers:{ 'Authorization': `Bearer ${MP_ACCESS_TOKEN}`, 'Content-Type':'application/json', 'X-Idempotency-Key': preference.external_reference },
            body: JSON.stringify(preference)
          });
          const json = await r.json();
          if(!r.ok){
            res.statusCode = r.status || 500;
            res.end(JSON.stringify({ ok:false, error: json?.message || 'Falha ao criar pagamento', details: json }));
            return;
          }
          const poi = json?.point_of_interaction?.transaction_data || {};
          res.end(JSON.stringify({ ok:true, id: json.id, status: json.status, qr_code_base64: poi.qr_code_base64 || null, qr_code: poi.qr_code || null, external_reference: json.external_reference || null }));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok:false, error: err.message }));
        }
        return;
      }
      if (urlPath === '/api/payment/status' && req.method === 'GET') {
        try {
          const currentState = await readState();
          const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || process.env.MERCADOPAGO_ACCESS_TOKEN || currentState.config?.mpAccessToken || '';
          if (!MP_ACCESS_TOKEN) { res.statusCode = 500; res.end(JSON.stringify({ ok:false, error:'MP_ACCESS_TOKEN não configurado' })); return; }
          const paramsObj = new URLSearchParams(queryStr || '');
          const id = paramsObj.get('id') || paramsObj.get('paymentId');
          if(!id){ res.statusCode = 400; res.end(JSON.stringify({ ok:false, error:'Informe id do pagamento' })); return; }
          const r = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(id)}`,{
            headers:{ 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` }
          });
          const json = await r.json();
          if(!r.ok){ res.statusCode = r.status || 500; res.end(JSON.stringify({ ok:false, error: json?.message || 'Falha ao consultar pagamento', details: json })); return; }
          res.end(JSON.stringify({ ok:true, id: json.id, status: json.status, status_detail: json.status_detail }));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok:false, error: err.message }));
        }
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
        if(!ensureIsAdminLocal(req)){ res.statusCode = 403; res.end(JSON.stringify({ ok:false, error:'forbidden' })); return; }
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
        if(!ensureIsAdminLocal(req)){ res.statusCode = 403; res.end(JSON.stringify({ ok:false, error:'forbidden' })); return; }
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
        if(!ensureIsAdminLocal(req)){ res.statusCode = 403; res.end(JSON.stringify({ ok:false, error:'forbidden' })); return; }
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
      // Cabeçalhos de segurança básicos para páginas
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
      res.setHeader('Content-Security-Policy', "default-src 'self' https: data:; img-src 'self' https: data: blob:; style-src 'self' 'unsafe-inline' https:; script-src 'self' https://cdn.jsdelivr.net; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'self'");
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

// ---- Admin check helpers (local) ----
function parseCookieHeader(cookie) {
  const out = {};
  (cookie||'').split(';').forEach(part => {
    const [k,v] = part.split('=');
    if(!k) return; out[k.trim()] = decodeURIComponent((v||'').trim());
  });
  return out;
}
function ensureIsAdminLocal(req){
  try{
    const ids = String(process.env.ADMIN_IDS||'').split(',').map(s=>s.trim()).filter(Boolean);
    const names = String(process.env.ADMIN_USERNAMES||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
    if(ids.length === 0) return false;
    const cookies = parseCookieHeader(req.headers.cookie||'');
    const uid = cookies['uid'] || null;
    const uname = (cookies['uname']||'').toLowerCase();
    return !!((uid && ids.includes(String(uid))) || (uname && names.includes(uname)));
  }catch(_){ return false; }
}
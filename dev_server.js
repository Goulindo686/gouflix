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
// Integração de Pagamentos atual: Sunize (substitui Mercado Pago)

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
      const initial = { added: [], removed: [], subscriptions: {}, suggestions: [], config: { publicUrl: process.env.PUBLIC_URL || 'https://gouflix.discloud.app' } };
      fs.writeFileSync(statePath, JSON.stringify(initial, null, 2));
    }
  } catch (_) {}
}
function defaultState() {
  return { added: [], removed: [], subscriptions: {}, suggestions: [], config: { publicUrl: process.env.PUBLIC_URL || 'https://gouflix.discloud.app', sunizeApiSecret: process.env.SUNIZE_API_SECRET || '', sunizeClientKey: process.env.SUNIZE_CLIENT_KEY || '', sunizeClientSecret: process.env.SUNIZE_CLIENT_SECRET || '', discordInviteUrl: process.env.DISCORD_INVITE_URL || '' } };
}
function normalizeState(s) {
  const state = s || {};
  state.added = Array.isArray(state.added) ? state.added : [];
  state.removed = Array.isArray(state.removed) ? state.removed : [];
  state.subscriptions = state.subscriptions || {};
  state.suggestions = Array.isArray(state.suggestions) ? state.suggestions : [];
  state.config = state.config || {};
  if (!state.config.publicUrl) state.config.publicUrl = process.env.PUBLIC_URL || 'https://gouflix.discloud.app';
  if (typeof state.config.sunizeApiSecret === 'undefined') state.config.sunizeApiSecret = process.env.SUNIZE_API_SECRET || '';
  if (typeof state.config.sunizeClientKey === 'undefined') state.config.sunizeClientKey = process.env.SUNIZE_CLIENT_KEY || '';
  if (typeof state.config.sunizeClientSecret === 'undefined') state.config.sunizeClientSecret = process.env.SUNIZE_CLIENT_SECRET || '';
  if (typeof state.config.discordInviteUrl === 'undefined') state.config.discordInviteUrl = process.env.DISCORD_INVITE_URL || '';
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
// Removido: funcionalidades de Bootstrap

async function readJsonSafe(res){
  try{ return await res.json(); }catch(_){ return {}; }
}

function normalizeSunizeCreate(json){
  const id = json?.id || json?.transaction_id || json?.data?.id || json?.data?.transaction_id;
  const qr = json?.pix_qr_code || json?.data?.pix_qr_code || json?.pix?.qr_code || json?.data?.pix?.qr_code;
  const qrbase64 = json?.pix_qr_code_base64 || json?.data?.pix_qr_code_base64 || json?.pix?.qr_code_base64 || json?.data?.pix?.qr_code_base64;
  const copiaecola = json?.pix_code || json?.data?.pix_code || json?.payload || json?.data?.payload;
  return { id, qr, qrbase64, copiaecola };
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
      // Reverter CSP padrão anterior (permitindo CDN e conexões HTTPS gerais)
      res.setHeader('Content-Security-Policy', "default-src 'self' https: data:; img-src 'self' https: data: blob:; style-src 'self' 'unsafe-inline' https:; script-src 'self' https://cdn.jsdelivr.net; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'self'");
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      const params = new URLSearchParams(queryStr || '');
      // /api/env para local (sem rewrite do Vercel)
      if (urlPath === '/api/env' && req.method === 'GET') {
        res.end(JSON.stringify({
          TMDB_BASE: process.env.TMDB_BASE || 'https://api.themoviedb.org/3',
          TMDB_IMG: process.env.TMDB_IMG || 'https://image.tmdb.org/t/p/w500',
          NEXTAUTH_URL: process.env.NEXTAUTH_URL || null,
          CONFIG_API_BASE_URL: process.env.CONFIG_API_BASE_URL || null,
        }));
        return;
      }

      // ---- TMDB proxy endpoints ----
      if (urlPath.startsWith('/api/tmdb/details') && req.method === 'GET') {
        const paramsObj = new URLSearchParams(queryStr || '');
        const type = paramsObj.get('type') === 'serie' ? 'tv' : 'movie';
        const id = paramsObj.get('id');
        if(!id){ res.statusCode = 400; res.end(JSON.stringify({ ok:false, error:'missing id' })); return; }
        const base = process.env.TMDB_BASE || 'https://api.themoviedb.org/3';
        const token = process.env.TMDB_TOKEN || '';
        const endpoint = `${base}/${type}/${encodeURIComponent(id)}?language=pt-BR&append_to_response=external_ids`;
        const r = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json;charset=utf-8' } });
        if(!r.ok){ res.statusCode = r.status; res.end(JSON.stringify({ ok:false, error:'tmdb', status:r.status })); return; }
        const json = await r.json();
        res.end(JSON.stringify(json));
        return;
      }
      if (urlPath.startsWith('/api/tmdb/list') && req.method === 'GET') {
        const paramsObj = new URLSearchParams(queryStr || '');
        const type = paramsObj.get('type') === 'serie' ? 'tv' : 'movie';
        const page = paramsObj.get('page') || '1';
        const base = process.env.TMDB_BASE || 'https://api.themoviedb.org/3';
        const token = process.env.TMDB_TOKEN || '';
        const endpoint = `${base}/${type}/popular?language=pt-BR&page=${encodeURIComponent(page)}`;
        const r = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json;charset=utf-8' } });
        if(!r.ok){ res.statusCode = r.status; res.end(JSON.stringify({ ok:false, error:'tmdb', status:r.status })); return; }
        const json = await r.json();
        res.end(JSON.stringify(json));
        return;
      }
      // ----- CONFIG -----
      if (urlPath === '/api/config' && req.method === 'GET') {
        const state = await readState();
        const cfg = state.config || {};
        const publicUrl = cfg.publicUrl || process.env.PUBLIC_URL || 'https://gouflix.discloud.app';
        const isAdmin = ensureIsAdminLocal(req);
        const hasSunizeSecret = !!(
          (cfg.sunizeApiSecret && String(cfg.sunizeApiSecret).length) ||
          ((cfg.sunizeClientKey && cfg.sunizeClientSecret) && String(cfg.sunizeClientKey).length && String(cfg.sunizeClientSecret).length)
        );
        res.end(JSON.stringify({ publicUrl, writable: !!isAdmin, hasSunizeSecret, discordInviteUrl: cfg.discordInviteUrl || '' }));
        return;
      }
      if (urlPath === '/api/config' && req.method === 'POST') {
        if(!ensureIsAdminLocal(req)){ res.statusCode = 403; res.end(JSON.stringify({ ok:false, error:'forbidden' })); return; }
        const body = await parseBody(req);
        const state = await readState();
        state.config.publicUrl = body.publicUrl || state.config.publicUrl || process.env.PUBLIC_URL || 'https://gouflix.discloud.app';
        if (body.sunizeApiSecret !== undefined) state.config.sunizeApiSecret = String(body.sunizeApiSecret || '');
        if (body.sunizeClientKey !== undefined) state.config.sunizeClientKey = String(body.sunizeClientKey || '');
        if (body.sunizeClientSecret !== undefined) state.config.sunizeClientSecret = String(body.sunizeClientSecret || '');
        if (body.discordInviteUrl !== undefined) state.config.discordInviteUrl = String(body.discordInviteUrl || '');
        await writeState(state);
        res.end(JSON.stringify({ ok: true, config: { ...state.config, sunizeApiSecret: undefined } }));
        return;
      }
      // ----- SUGESTÕES -----
      if (urlPath === '/api/suggestions' && req.method === 'GET') {
        const state = await readState();
        const suggestions = Array.isArray(state.suggestions) ? state.suggestions : [];
        res.end(JSON.stringify({ ok: true, suggestions }));
        return;
      }
      if (urlPath === '/api/suggestions' && req.method === 'POST') {
        const body = await parseBody(req);
        const title = String(body.title || '').trim();
        const kind = String(body.kind || '').trim();
        const tmdbId = body.tmdbId ? String(body.tmdbId).trim() : '';
        const details = String(body.details || '').trim();
        if (!title) { res.statusCode = 400; res.end(JSON.stringify({ ok:false, error:'Título é obrigatório' })); return; }
        const cookies = parseCookieHeader(req.headers['cookie']);
        const suggestion = {
          id: `s_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
          title, kind, tmdbId, details,
          authorId: cookies.uid || null,
          authorName: cookies.uname || null,
          createdAt: new Date().toISOString()
        };
        const state = await readState();
        state.suggestions = Array.isArray(state.suggestions) ? state.suggestions : [];
        state.suggestions.push(suggestion);
        await writeState(state);
        res.end(JSON.stringify({ ok:true, suggestion }));
        return;
      }
      // Removido: endpoint manual de bootstrap
      // ----- Pagamentos (Sunize PIX) -----
      if (urlPath === '/api/sunize/create' && req.method === 'POST') {
        try {
          const currentState = await readState();
          const SUNIZE_API_BASE = process.env.SUNIZE_API_BASE || 'https://api.sunize.com.br/v1';
          const SUNIZE_API_SECRET = process.env.SUNIZE_API_SECRET || currentState.config?.sunizeApiSecret || '';
          const SUNIZE_CLIENT_KEY = process.env.SUNIZE_CLIENT_KEY || currentState.config?.sunizeClientKey || '';
          const SUNIZE_CLIENT_SECRET = process.env.SUNIZE_CLIENT_SECRET || currentState.config?.sunizeClientSecret || '';
          const PUBLIC_URL = process.env.PUBLIC_URL || '';
          const hasBearer = !!SUNIZE_API_SECRET;
          const hasBasic = !!(SUNIZE_CLIENT_KEY && SUNIZE_CLIENT_SECRET);
          if (!hasBearer && !hasBasic) { res.statusCode = 500; res.end(JSON.stringify({ ok:false, error:'Credenciais Sunize não configuradas (Bearer ou client key/secret)' })); return; }
          const body = await parseBody(req);
          const plan = String(body?.plan||'').toLowerCase();
          const userId = String(body?.userId||'').trim();
          const PLAN_PRICES = { mensal: 19.90, trimestral: 49.90, anual: 147.90 };
          const amount = PLAN_PRICES[plan];
          if(!userId || !amount){ res.statusCode = 400; res.end(JSON.stringify({ ok:false, error:'Parâmetros inválidos (userId/plan)' })); return; }
          let emailDomain = 'gouflix.app';
          try{ if(PUBLIC_URL){ const u = new URL(PUBLIC_URL); if(u.hostname && u.hostname.includes('.')) emailDomain = u.hostname; } }catch(_){ }
          const safeUser = String(userId).replace(/[^a-zA-Z0-9_.+-]/g,'_');
          const payerEmail = `${safeUser}@${emailDomain}`;
          const externalId = `${userId}|${plan}|${Date.now()}`;
          const clientIp = (req.headers['x-forwarded-for']||'').toString().split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || '';
          const payload = {
            external_id: externalId,
            total_amount: Number(Number(amount).toFixed(2)),
            payment_method: 'PIX',
            items: [{ id: plan, title: `Assinatura GouFlix — ${plan}`, description: `Plano ${plan}`, price: Number(Number(amount).toFixed(2)), quantity: 1, is_physical: false }],
            ip: clientIp,
            customer: { name: 'Usuário GouFlix', email: payerEmail }
          };
          const r = await fetch(`${SUNIZE_API_BASE}/transactions`,{
            method:'POST',
            headers:{ 'Authorization': hasBearer ? `Bearer ${SUNIZE_API_SECRET}` : `Basic ${Buffer.from(`${SUNIZE_CLIENT_KEY}:${SUNIZE_CLIENT_SECRET}`).toString('base64')}` , 'Content-Type':'application/json' },
            body: JSON.stringify(payload)
          });
          const json = await readJsonSafe(r);
          if(!r.ok){ res.statusCode = r.status || 500; res.end(JSON.stringify({ ok:false, error: json?.message || 'Falha ao criar transação', details: json })); return; }
          const out = normalizeSunizeCreate(json);
          res.end(JSON.stringify({ ok:true, ...out }));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok:false, error: err.message }));
        }
        return;
      }
      if (urlPath === '/api/sunize/status' && req.method === 'GET') {
        try {
          const currentState = await readState();
          const SUNIZE_API_BASE = process.env.SUNIZE_API_BASE || 'https://api.sunize.com.br/v1';
          const SUNIZE_API_SECRET = process.env.SUNIZE_API_SECRET || currentState.config?.sunizeApiSecret || '';
          const SUNIZE_CLIENT_KEY = process.env.SUNIZE_CLIENT_KEY || currentState.config?.sunizeClientKey || '';
          const SUNIZE_CLIENT_SECRET = process.env.SUNIZE_CLIENT_SECRET || currentState.config?.sunizeClientSecret || '';
          const hasBearer = !!SUNIZE_API_SECRET;
          const hasBasic = !!(SUNIZE_CLIENT_KEY && SUNIZE_CLIENT_SECRET);
          if (!hasBearer && !hasBasic) { res.statusCode = 500; res.end(JSON.stringify({ ok:false, error:'Credenciais Sunize não configuradas (Bearer ou client key/secret)' })); return; }
          const paramsObj = new URLSearchParams(queryStr || '');
          const id = paramsObj.get('id') || paramsObj.get('transactionId');
          if(!id){ res.statusCode = 400; res.end(JSON.stringify({ ok:false, error:'Informe id da transação' })); return; }
          const r = await fetch(`${SUNIZE_API_BASE}/transactions/${encodeURIComponent(id)}`,{
            headers:{ 'Authorization': hasBearer ? `Bearer ${SUNIZE_API_SECRET}` : `Basic ${Buffer.from(`${SUNIZE_CLIENT_KEY}:${SUNIZE_CLIENT_SECRET}`).toString('base64')}` }
          });
          const json = await readJsonSafe(r);
          if(!r.ok){ res.statusCode = r.status || 500; res.end(JSON.stringify({ ok:false, error: json?.message || 'Falha ao consultar transação', details: json })); return; }
          const status = String(json?.status||'');
          res.end(JSON.stringify({ ok:true, id: json.id, status }));
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
      // Reverter CSP padrão anterior (permitindo CDN e conexões HTTPS gerais)
      res.setHeader('Content-Security-Policy', "default-src 'self' https: data:; img-src 'self' https: data: blob:; style-src 'self' 'unsafe-inline' https:; script-src 'self' https://cdn.jsdelivr.net; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'self'");
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
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
  // Removido: bootstrap automático
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
    // Em ambiente local, se ADMIN_IDS não estiver configurado, permitir escrita
    if(ids.length === 0) return true;
    const cookies = parseCookieHeader(req.headers.cookie||'');
    const uid = cookies['uid'] || null;
    const uname = (cookies['uname']||'').toLowerCase();
    return !!((uid && ids.includes(String(uid))) || (uname && names.includes(uname)));
  }catch(_){ return false; }
}
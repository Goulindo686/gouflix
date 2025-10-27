const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

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
      const initial = { added: [], removed: [], subscriptions: {}, purchases: [], config: { mercadoPagoAccessToken: process.env.MP_ACCESS_TOKEN || '', publicUrl: process.env.PUBLIC_URL || 'https://gouflix.discloud.app' } };
      fs.writeFileSync(statePath, JSON.stringify(initial, null, 2));
    }
  } catch (_) {}
}
function defaultState() {
  return { added: [], removed: [], subscriptions: {}, purchases: [], config: { mercadoPagoAccessToken: process.env.MP_ACCESS_TOKEN || '', publicUrl: process.env.PUBLIC_URL || 'https://gouflix.discloud.app', bootstrapMoviesUrl: process.env.BOOTSTRAP_MOVIES_URL || '', bootstrapAuto: !!(process.env.BOOTSTRAP_AUTO || false), bootstrapDone: 0 } };
}
function normalizeState(s) {
  const state = s || {};
  state.added = Array.isArray(state.added) ? state.added : [];
  state.removed = Array.isArray(state.removed) ? state.removed : [];
  state.subscriptions = state.subscriptions || {};
  state.purchases = Array.isArray(state.purchases) ? state.purchases : [];
  state.config = state.config || {};
  if (!state.config.mercadoPagoAccessToken) state.config.mercadoPagoAccessToken = process.env.MP_ACCESS_TOKEN || '';
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
      // ----- CONFIG -----
      if (urlPath === '/api/config' && req.method === 'GET') {
        const state = await readState();
        const cfg = state.config || {};
        const token = cfg.mercadoPagoAccessToken || process.env.MP_ACCESS_TOKEN || '';
        const publicUrl = cfg.publicUrl || process.env.PUBLIC_URL || 'https://gouflix.discloud.app';
        res.end(JSON.stringify({ mercadoPagoAccessToken: token, publicUrl, bootstrapMoviesUrl: cfg.bootstrapMoviesUrl || '', bootstrapAuto: !!cfg.bootstrapAuto, bootstrapDone: cfg.bootstrapDone || 0 }));
        return;
      }
      if (urlPath === '/api/config' && req.method === 'POST') {
        const body = await parseBody(req);
        const state = await readState();
        state.config.mercadoPagoAccessToken = body.token || state.config.mercadoPagoAccessToken || '';
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
      // ----- CREATE CHECKOUT VIA MERCADO PAGO -----
      if (urlPath === '/api/subscription/create' && req.method === 'POST') {
        const body = await parseBody(req);
        const { userId, plan } = body;
        if (!userId || !plan) { res.statusCode = 400; res.end(JSON.stringify({ ok:false, error:'userId and plan required' })); return; }
        const state = await readState();
        const token = state.config.mercadoPagoAccessToken;
        if (!token) { res.statusCode = 400; res.end(JSON.stringify({ ok:false, error:'Mercado Pago token not configured' })); return; }

        const priceMap = { mensal: 19.90, trimestral: 49.90, anual: 147.90, test2min: 1.00 };
        const titleMap = { mensal:'Plano Mensal', trimestral:'Plano Trimestral', anual:'Plano Anual', test2min:'Plano Teste 2 minutos' };
        const amount = priceMap[plan];
        const title = titleMap[plan];
        if (!amount) { res.statusCode = 400; res.end(JSON.stringify({ ok:false, error:'invalid plan' })); return; }

        try {
          // Configurar cliente do Mercado Pago
          const client = new MercadoPagoConfig({ 
            accessToken: token,
            options: { timeout: 5000 }
          });

          // Criar pagamento PIX para gerar QR Code
          const payment = new Payment(client);
          const paymentData = {
            transaction_amount: Number(amount.toFixed(2)),
            description: title,
            payment_method_id: 'pix',
            payer: {
              email: `${userId}@example.com` // placeholder local; substitua por email real se houver
            },
            external_reference: `${userId}:${plan}:${Date.now()}`
          };
          // incluir webhook em produção/discloud
          try{
            const publicUrl = (state.config && state.config.publicUrl) ? state.config.publicUrl : (process.env.PUBLIC_URL || '');
            const base = String(publicUrl||'').replace(/\/$/, '');
            const webhookUrl = base ? `${base}/api/webhook` : '';
            if (webhookUrl && /^https:\/\//.test(webhookUrl)) {
              paymentData.notification_url = webhookUrl;
            }
          }catch(_){/* ignore */}

          const result = await payment.create({ body: paymentData });
          const qrBase64 = result?.point_of_interaction?.transaction_data?.qr_code_base64 || null;
          const paymentId = result?.id || null;
          // Registrar compra
          const now = Date.now();
          const state = await readState();
          state.purchases.push({
            id: paymentId,
            userId,
            plan,
            amount,
            status: result?.status || 'pending',
            createdAt: now,
            updatedAt: now
          });
          await writeState(state);

          res.end(JSON.stringify({
            ok: true,
            paymentId,
            qr_code_base64: qrBase64,
            status: result?.status || 'pending'
          }));
        } catch (err) {
          console.error('Erro ao criar pagamento PIX:', err);
          res.statusCode = 500;
          res.end(JSON.stringify({ ok:false, error: 'failed to create payment', details: String(err) }));
        }
        return;
      }
      // ----- LIST PURCHASES -----
      if (urlPath === '/api/purchases' && req.method === 'GET') {
        const state = await readState();
        const params = new URLSearchParams(queryStr || '');
        const userId = params.get('userId');
        const status = params.get('status');
        let list = state.purchases || [];
        if (userId) list = list.filter(p => String(p.userId) === String(userId));
        if (status) list = list.filter(p => String(p.status) === String(status));
        res.end(JSON.stringify({ ok:true, purchases: list }));
        return;
      }
      // ----- UPDATE PURCHASE -----
      if (urlPath === '/api/purchases/update' && req.method === 'POST') {
        const body = await parseBody(req);
        const { id, status, note } = body;
        if(!id){ res.statusCode = 400; res.end(JSON.stringify({ ok:false, error:'id required' })); return; }
        const state = await readState();
        const p = (state.purchases || []).find(x => String(x.id) === String(id));
        if(!p){ res.statusCode = 404; res.end(JSON.stringify({ ok:false, error:'purchase not found' })); return; }
        if(status) p.status = status;
        if(note) p.note = note;
        p.updatedAt = Date.now();
        await writeState(state);
        res.end(JSON.stringify({ ok:true, purchase: p }));
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
        const daysMap = { mensal: 30, trimestral: 90, anual: 365, test2min: (2/(24*60)) };
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
        // Atualizar status da compra vinculada
        if (paymentId) {
          const p = (state.purchases || []).find(x => String(x.id) === String(paymentId));
          if (p) { p.status = 'approved'; p.updatedAt = Date.now(); }
        }
        await writeState(state);
        res.end(JSON.stringify({ ok:true }));
        return;
      }
      // ----- PAYMENT STATUS -----
      if (urlPath === '/api/payment/status' && req.method === 'GET') {
        const params = new URLSearchParams(queryStr || '');
        const id = params.get('id');
        if(!id){ res.statusCode = 400; res.end(JSON.stringify({ ok:false, error:'payment id required' })); return; }
        try{
          const state = await readState();
          const token = state.config.mercadoPagoAccessToken;
          const client = new MercadoPagoConfig({ accessToken: token });
          const paymentApi = new Payment(client);
          const pay = await paymentApi.get({ id });
          const status = pay?.status || pay?.response?.status || 'unknown';
          res.end(JSON.stringify({ ok:true, status }));
        }catch(err){
          console.error('Erro ao consultar pagamento:', err);
          res.statusCode = 500;
          res.end(JSON.stringify({ ok:false, error:'failed to check payment', details:String(err) }));
        }
        return;
      }
      // ----- WEBHOOK HANDLER -----
      if (urlPath === '/api/webhook' && req.method === 'POST') {
        const body = await parseBody(req);
        console.log('Webhook recebido:', body);
        try{
          const state = readState();
          const token = state.config.mercadoPagoAccessToken;
          const client = new MercadoPagoConfig({ accessToken: token });
          const paymentApi = new Payment(client);
          const paymentId = body?.data?.id || body?.id || body?.resource?.id || null;
          if(paymentId){
            const pay = await paymentApi.get({ id: paymentId });
            const status = pay?.status || pay?.response?.status;
            const ext = pay?.external_reference || pay?.response?.external_reference || '';
            // external_reference format: userId:plan:timestamp
            if(status === 'approved' && ext){
              const [userId, plan] = String(ext).split(':');
              const daysMap = { mensal: 30, trimestral: 90, anual: 365 };
              const days = daysMap[plan];
              if(userId && days){
                const now = Date.now();
                state.subscriptions[userId] = {
                  userId, plan, start: now, expiry: now + days*24*60*60*1000,
                  status: 'active', active: true, paymentId
                };
                await writeState(state);
              }
            }
          }
        }catch(err){
          console.error('Erro ao processar webhook:', err);
        }
        res.end(JSON.stringify({ ok: true }));
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
            purchases: Array.isArray(incoming.purchases) ? incoming.purchases : [],
            config: current.config // não sobrescreve config do servidor
          });
        } else {
          // mesclar listas
          const merged = {
            added: [...(current.added||[]), ...((incoming.added||[]).filter(i=> !(current.added||[]).some(j=> (j.key||'') === (i.key||''))))],
            removed: Array.from(new Set([...(current.removed||[]), ...((incoming.removed||[]))])),
            subscriptions: { ...(current.subscriptions||{}), ...(incoming.subscriptions||{}) },
            purchases: [...(current.purchases||[]), ...((incoming.purchases||[]))],
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
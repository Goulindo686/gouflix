// Testa o webhook da Sunize sem depender de HTTP local ou Supabase.
// Mocka fetch para "/api/subscription" usando um fallback em memória.

const path = require('path');
const { pathToFileURL } = require('url');
const { Readable } = require('stream');

// ===== Configuração do teste (substitua conforme necessário) =====
const TEST_TOKEN = process.env.TEST_SUNIZE_TOKEN || 'REPLACE_TOKEN';
const TEST_EMAIL = process.env.TEST_BUYER_EMAIL || 'buyer@example.com';
const TEST_PRODUCT = process.env.TEST_PRODUCT_NAME || 'Plano Mensal';

// ===== Fallback de assinatura em memória =====
global.__SUBS = global.__SUBS || new Map();
function memSubscription(action, payload) {
  const { userId, plan } = payload || {};
  if (action === 'activate') {
    const now = Date.now();
    const durationDays = plan === 'mensal' ? 30 : plan === 'trimestral' ? 90 : plan === 'anual' ? 365 : 30;
    const end = new Date(now + durationDays * 24 * 60 * 60 * 1000).toISOString();
    global.__SUBS.set(String(userId), { active: true, plan, end });
    return { ok: true, status: 200 };
  }
  if (action === 'deactivate') {
    const item = global.__SUBS.get(String(userId));
    if (item) { item.active = false; }
    return { ok: true, status: 200 };
  }
  return { ok: false, status: 400 };
}

// ===== Mock do fetch: intercepta /api/subscription =====
global.fetch = async function (url, opts) {
  const endpoint = typeof url === 'string' ? url : (url && url.href) || '';
  if (endpoint.endsWith('/api/subscription') || endpoint.includes('/api/subscription')) {
    try {
      const body = typeof opts?.body === 'string' ? JSON.parse(opts.body || '{}') : (opts?.body || {});
      const action = String(body.action || 'activate');
      const result = memSubscription(action, body);
      return {
        ok: result.ok,
        status: result.status,
        async json() { return { ok: result.ok }; },
        async text() { return JSON.stringify({ ok: result.ok }); },
      };
    } catch (err) {
      return { ok: false, status: 500, async text() { return err.message; }, async json() { return { error: err.message }; } };
    }
  }
  throw new Error('fetch externo não permitido neste teste: ' + endpoint);
};

// ===== Helper: cria req/res mocks compatíveis =====
function createMockReq({ token, email, product }) {
  const bodyObj = {
    event: 'compra aprovada',
    status: 'approved',
    product_name: product,
    buyer: { email },
  };
  const stream = new Readable({ read() {} });
  const jsonStr = JSON.stringify(bodyObj);
  setImmediate(() => {
    stream.emit('data', Buffer.from(jsonStr));
    stream.emit('end');
  });
  stream.method = 'POST';
  stream.headers = { 'x-sunize-token': token, 'content-type': 'application/json' };
  stream.query = {};
  return stream;
}

function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.setHeader('Content-Type', 'application/json'); console.log(JSON.stringify(obj)); },
    end(text) { if (text) console.log(String(text)); },
  };
}

async function main() {
  if (!TEST_TOKEN || TEST_TOKEN === 'REPLACE_TOKEN') {
    console.error('Defina TEST_SUNIZE_TOKEN no ambiente.');
    process.exit(1);
  }
  const filePath = path.join(process.cwd(), 'api', 'webhook', 'sunize.js');
  const mod = await import(pathToFileURL(filePath).href);
  const handler = mod.default || mod.handler;
  const req = createMockReq({ token: TEST_TOKEN, email: TEST_EMAIL, product: TEST_PRODUCT });
  const res = createMockRes();
  await handler(req, res);
  // Mostrar estado de assinatura após processamento
  const sub = global.__SUBS.get(String(TEST_EMAIL));
  console.log('Estado em memória:', JSON.stringify(sub || null));
}

main().catch((err) => { console.error(err); process.exit(1); });
// script.js - versão moderna estilo Netflix
let TMDB_API_KEY = '8a2d4c3351370eb863b79cc6dda7bb81';
let TMDB_TOKEN = null;
let TMDB_BASE = 'https://api.themoviedb.org/3';
let TMDB_IMG = 'https://image.tmdb.org/t/p/w500';
// Base sem tamanho para montar banners responsivos
function tmdbImgBase(){
  try{ return String(TMDB_IMG||'').replace(/\/w\d+$/, ''); }catch(_){ return 'https://image.tmdb.org/t/p'; }
}
// Paginação dos lotes para sempre trazer conteúdos novos
window.BULK_PAGES = { filme: 0, serie: 0 };

// Integração com Vercel/Supabase: obter env e iniciar cliente
window.__ENV = {};
window.supabaseClient = null;
let CURRENT_USER = null;

// Helper para construir URL de API suportando base remota (ex.: Vercel)
function apiUrl(p){
  try{
    const base = (window.__ENV && (window.__ENV.CONFIG_API_BASE_URL||'').trim()) || '';
    return base ? `${base}${p}` : p;
  }catch(_){ return p; }
}

// Sanitizador de console: oculta tokens/segredos em logs sem alterar o restante
(function initConsoleSanitizer(){
  try{
    const SECRET_KEYS = [
      'supabase_anon_key','supabase_key','SUPABASE_ANON_KEY','SUPABASE_KEY','mp_access_token','MERCADOPAGO_ACCESS_TOKEN',
      'MP_ACCESS_TOKEN','TMDB_TOKEN','nextauth_secret','NEXTAUTH_SECRET','NEXTAUTH_URL','token','auth','authorization',
      'bearer','session','cookie','secret','password','api_key','apikey','key'
    ];
    const MASK = '[REDACTED]';
    const keySet = new Set(SECRET_KEYS.map(k=>k.toLowerCase()));

    function sanitizeString(s){
      try{
        let out = String(s);
        out = out.replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/gi, 'Bearer '+MASK);
        out = out.replace(/([?&])(token|key|apikey|auth|access_token)=([^&#]+)/gi, `$1$2=${MASK}`);
        // mascarar sequências longas (possíveis chaves)
        out = out.replace(/[A-Za-z0-9_\-]{32,}/g, MASK);
        // mascarar JWTs
        out = out.replace(/eyJ[A-Za-z0-9._\-]+\.[A-Za-z0-9._\-]+\.[A-Za-z0-9._\-]+/g, MASK);
        return out;
      }catch{ return s; }
    }

    function sanitizeAny(v, seen){
      if(v == null) return v;
      const t = typeof v;
      if(t === 'string') return sanitizeString(v);
      if(t !== 'object') return v;
      return deepCloneSanitize(v, seen);
    }

    function deepCloneSanitize(obj, seen = new WeakMap()){
      try{
        if(seen.has(obj)) return '[Circular]';
        if(Array.isArray(obj)){
          const arr = [];
          seen.set(obj, arr);
          for(const item of obj){ arr.push(sanitizeAny(item, seen)); }
          return arr;
        }
        const out = {};
        seen.set(obj, out);
        Object.keys(obj).forEach((k)=>{
          const lower = k.toLowerCase();
          if(keySet.has(lower) || /token|key|secret|password|auth|bearer|session|cookie/i.test(lower)){
            out[k] = MASK;
          } else {
            out[k] = sanitizeAny(obj[k], seen);
          }
        });
        return out;
      }catch{ return obj; }
    }

    const c = console;
    const orig = {
      log: c.log && c.log.bind(c), info: c.info && c.info.bind(c), warn: c.warn && c.warn.bind(c), error: c.error && c.error.bind(c),
      debug: c.debug && c.debug.bind(c), table: c.table && c.table.bind(c), dir: c.dir && c.dir.bind(c), trace: c.trace && c.trace.bind(c),
      group: c.group && c.group.bind(c), groupCollapsed: c.groupCollapsed && c.groupCollapsed.bind(c)
    };
    function wrap(name){
      if(!orig[name]) return;
      console[name] = function(){
        try{
          const args = Array.from(arguments).map(a => sanitizeAny(a));
          orig[name].apply(c, args);
        }catch{ orig[name].apply(c, arguments); }
      };
    }
    ['log','info','warn','error','debug','table','dir','trace','group','groupCollapsed'].forEach(wrap);
  }catch(_){ /* silencioso */ }
})();

// DevTools/Inspecionar: bloqueio desativado para compatibilidade e acesso em dispositivos móveis

async function initEnvAndSupabase(){
  try{
    const res = await fetch('/api/env');
  if(res.ok){
      const env = await res.json();
      window.__ENV = env || {};
      TMDB_BASE = env.TMDB_BASE || TMDB_BASE;
      TMDB_IMG = env.TMDB_IMG || TMDB_IMG;
      // Sanitizado: não carregar Supabase/ADMIN/TMDB_TOKEN no browser
    }
  }catch(_){/* ignore */}
  // Fallback para ambientes estáticos (GitHub Pages): meta tag
  try{
    const meta = document.querySelector('meta[name="config-api-base-url"]');
    if(meta && meta.content){
      window.__ENV = window.__ENV || {};
      window.__ENV.CONFIG_API_BASE_URL = meta.content;
    }
  }catch(_){/* ignore */}
}

async function supabaseGetState(){
  const sb = window.supabaseClient;
  if(!sb) return null;
  try{
    const { data, error } = await sb
      .from('gouflix_state')
      .select('data')
      .eq('id', 'global')
      .maybeSingle();
    if(error) return null;
    return (data && data.data) || { added: [], removed: [] };
  }catch(_){ return null; }
}

async function supabaseSetState(next){
  const sb = window.supabaseClient;
  if(!sb) return false;
  try{
    const { error } = await sb
      .from('gouflix_state')
      .upsert({ id: 'global', data: next }, { onConflict: 'id' });
    return !error;
  }catch(_){ return false; }
}

// Usuário (demo): ID local para vincular assinatura (fallback)
const USER_ID = (()=>{
  try{
    const saved = localStorage.getItem('USER_ID');
    if(saved) return saved;
    const id = 'user-' + Math.random().toString(36).slice(2,10);
    localStorage.setItem('USER_ID', id);
    return id;
  }catch(_){ return 'user-demo'; }
})();

function getEffectiveUserId(){
  try{
    if (CURRENT_USER && CURRENT_USER.id) return String(CURRENT_USER.id);
  }catch(_){/* ignore */}
  return USER_ID;
}

// Favoritos (Local Storage por usuário)
function favoritesKey(){
  return `favorites:${getEffectiveUserId()}`;
}
function getFavorites(){
  try{
    const raw = localStorage.getItem(favoritesKey());
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  }catch(_){ return []; }
}
function setFavorites(arr){
  try{ localStorage.setItem(favoritesKey(), JSON.stringify(Array.from(new Set(arr)))); }catch(_){/* ignore */}
}
function isFavorite(id){
  const favs = getFavorites();
  return favs.includes(String(id));
}
function toggleFavorite(id){
  const sId = String(id);
  const favs = getFavorites();
  const idx = favs.indexOf(sId);
  if(idx >= 0){ favs.splice(idx,1); } else { favs.push(sId); }
  setFavorites(favs);
  if((window.CURRENT_ROUTE||'home') === 'minha-lista'){
    const base = getRouteList('minha-lista');
    renderSingleSection('Minha Lista', base);
  }
}

// Planos
const PLAN_PRICES = { mensal: 19.90, trimestral: 49.90, anual: 147.90 };
const PLAN_DURATIONS = { mensal: 30, trimestral: 90, anual: 365 };

function buildSuperflixUrl(type, id){
  const kind = (type === 'serie') ? 'serie' : 'filme';
  return `https://superflixapi.asia/${kind}/${id}`;
}

async function loadMovies(){
  const res = await fetch('data/movies.json');
  const movies = await res.json();
  // Buscar estado persistido no backend (sem fallback local)
  let added = [];
  let removed = [];
  // Tenta via Supabase primeiro
  const sbState = await supabaseGetState();
  if(sbState){
    added = sbState.added || [];
    removed = sbState.removed || [];
  } else {
    // Fallback para backend local
    try{
      const stateRes = await fetch('/api/state');
      if(stateRes.ok){
        const state = await stateRes.json();
        added = state.added || [];
        removed = state.removed || [];
      }
    }catch(_){/* ignore */}
  }
  const all = [...movies];
  added.forEach(a=>{
    const dup = all.some(m=> (m.tmdbId===a.tmdbId && (m.type||'filme')===a.type));
    if(!dup){ all.push(a); }
  });
  const filtered = all.filter(m=> !removed.includes(getItemKey(m)));
  window.ALL_MOVIES = filtered;
  window.MOVIES = filtered;
  setRoute('home');
  // Atualiza o slideshow do topo com as capas
  updateHeroSlides(filtered);
}

function renderCardsIntoRow(movies, rowEl){
  if(!rowEl) return;
  rowEl.innerHTML = '';
  movies.forEach(m => {
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `
      <img src="${m.poster}" alt="${m.title}">
      <div class="info">
        <h3>${m.title}</h3>
        <p>${m.year||''}</p>
      </div>
    `;
    // Botão de favoritos (coração)
    const favBtn = document.createElement('button');
    favBtn.className = 'fav-btn' + (isFavorite(m.id) ? ' active' : '');
    favBtn.setAttribute('aria-label','Favoritar');
    favBtn.innerHTML = '❤';
    favBtn.addEventListener('click', (e)=>{
      e.stopPropagation();
      toggleFavorite(m.id);
      favBtn.classList.toggle('active', isFavorite(m.id));
    });
    div.appendChild(favBtn);
    div.onclick = () => openModal(m.id);
    rowEl.appendChild(div);
  });
}

function createRowSection(title, items, id, showTitle = true, variant = 'carousel'){
  const container = document.getElementById('sections');
  if(!container) return;
  const wrap = document.createElement('div');
  wrap.className = 'row-wrap' + (variant==='grid' ? ' grid' : '');

  if(showTitle){
    const h2 = document.createElement('h2');
    h2.className = 'row-title section-title';
    h2.textContent = title;
    wrap.appendChild(h2);
  }

  const row = document.createElement('div');
  row.className = 'row' + (variant==='grid' ? ' grid' : '');
  if(id) row.id = id;
  wrap.appendChild(row);

  // Setas
  const prev = document.createElement('button');
  prev.className = 'row-arrow prev';
  prev.setAttribute('aria-label','Anterior');
  prev.textContent = '‹';
  prev.addEventListener('click', () => {
    row.scrollBy({ left: -Math.max(row.clientWidth*0.9, 300), behavior: 'smooth' });
  });
  wrap.appendChild(prev);

  const next = document.createElement('button');
  next.className = 'row-arrow next';
  next.setAttribute('aria-label','Próximo');
  next.textContent = '›';
  next.addEventListener('click', () => {
    row.scrollBy({ left: Math.max(row.clientWidth*0.9, 300), behavior: 'smooth' });
  });
  wrap.appendChild(next);

  container.appendChild(wrap);
  renderCardsIntoRow(items, row);
}

function clearSections(){
  const container = document.getElementById('sections');
  if(container) container.innerHTML = '';
}

function renderHomeSections(base){
  clearSections();
  // Home com carrossel e setas, em três categorias configuráveis
  const sortByTitle = (arr)=> arr.slice().sort((a,b)=> (a.title||'').localeCompare(b.title||''));
  const recomendados = sortByTitle(base.filter(m=> (m.row||'') === 'recomendados'));
  const maisAssistidos = sortByTitle(base.filter(m=> (m.row||'') === 'mais-assistidos'));
  const ultimosLanc = sortByTitle(base.filter(m=> (m.row||'') === 'ultimos-lancamentos'));
  if(recomendados.length) createRowSection('Recomendados', recomendados, 'rowRecomendados', true, 'carousel');
  if(maisAssistidos.length) createRowSection('Mais assistidos', maisAssistidos, 'rowMaisAssistidos', true, 'carousel');
  if(ultimosLanc.length) createRowSection('Últimos lançamentos', ultimosLanc, 'rowUltimosLancamentos', true, 'carousel');
}

function renderSingleSection(title, items){
  clearSections();
  const sorted = items.slice().sort((a,b)=> (a.title||'').localeCompare(b.title||''));
  createRowSection(title, sorted, 'rowSingle', true, 'grid');
}

// Slideshow do topo (Hero)
let HERO_INTERVAL_ID = null;
let HERO_ITEMS = [];
let HERO_INDEX = 0;
// Usa tamanho maior para pôsters no Hero para melhorar qualidade
function toHighResPoster(url){
  if(!url) return url;
  try{
    // Substitui qualquer /w<numero>/ por /w780/ para pôster vertical
    const upgraded = url.replace(/\/w\d+(?=\/)/, '/w780');
    // Se vier como original deixamos como está
    return upgraded;
  }catch(_){ return url; }
}
// Escolhe tamanho de banner responsivo conforme viewport / DPR
function bannerSizes(){
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio||1));
  const w = window.innerWidth||1280;
  // Base de backdrops do TMDB: w300, w780, w1280, original
  if(w <= 768){ return dpr > 1 ? ['w780','w780'] : ['w780','w780']; }
  if(w <= 1440){ return dpr > 1 ? ['w1280','w1280'] : ['w780','w780']; }
  return dpr > 1 ? ['w1280','w1280'] : ['w1280','w1280'];
}
function buildBannerImageSet(path){
  const base = tmdbImgBase();
  const [size1, size2] = bannerSizes();
  const u1 = `${base}/${size1}${path}`;
  const u2 = `${base}/${size2}${path}`;
  // Usa image-set para background com fallback
  return {
    css: `image-set(url('${u1}') 1x, url('${u2}') 2x)`,
    fallback: u2
  };
}
function buildBannerSrcSet(path){
  const base = tmdbImgBase();
  const w780 = `${base}/w780${path}`;
  const w1280 = `${base}/w1280${path}`;
  const orig = `${base}/original${path}`;
  return `${w780} 780w, ${w1280} 1280w, ${orig} 1920w`;
}
async function ensureBannerPath(item){
  if(item.bannerPath) return item.bannerPath;
  const type = (item.type === 'serie') ? 'serie' : 'filme';
  const id = item.tmdbId || item.imdbId || '';
  if(!id) return null;
  try{
    const det = await fetchTmdbDetails(type, id);
    const bp = det.backdrop_path || '';
    // Captura metadados úteis para chips do Hero
    const vote = typeof det.vote_average === 'number' ? Math.round(det.vote_average * 10) / 10 : null;
    const runtime = (type === 'filme') ? (det.runtime || null) : (Array.isArray(det.episode_run_time) ? det.episode_run_time[0] || null : null);
    if(vote != null) item.tmdbVote = vote;
    if(runtime != null) item.runtime = runtime; // minutos
    if(bp){ item.bannerPath = bp; return bp; }
  }catch(_){ /* ignore */ }
  return null;
}

function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

async function prepareHeroItems(items){
  const pool = shuffle((items||[]));
  const limit = 12;
  const maxTries = Math.min(pool.length, 60);
  const out = [];
  const used = new Set();
  let tries = 0;
  for(const m of pool){
    if(tries++ >= maxTries) break;
    // Precisa ter uma referência para buscar banner
    const hasRef = Boolean(m.tmdbId || m.imdbId);
    if(!hasRef) continue;
    try{ await ensureBannerPath(m); }catch(_){/* ignore */}
    if(!m.bannerPath) continue;
    const key = getItemKey(m);
    if(used.has(key)) continue;
    out.push(m);
    used.add(key);
    if(out.length >= limit) break;
  }
  return out;
}

async function buildHeroSlides(items){
  const container = document.getElementById('heroSlides');
  if(!container) return;
  container.innerHTML = '';
  const list = await prepareHeroItems(items);
  HERO_ITEMS = list;
  list.forEach((m, idx) => {
    const slide = document.createElement('div');
    slide.className = 'slide' + (idx === 0 ? ' active' : '');
    // Usa banner/backdrop se disponível, com image-set para responsividade
    if(m.bannerPath){
      const iset = buildBannerImageSet(m.bannerPath);
      // Define variáveis CSS para fallback e image-set sem sobrescrever
      slide.style.setProperty('--hero-img', `url('${iset.fallback}')`);
      slide.style.setProperty('--hero-img-set', iset.css);
      // Imagem real por cima, sem zoom (retangular)
      const img = document.createElement('img');
      img.className = 'banner-img';
      img.src = `${tmdbImgBase()}/w1280${m.bannerPath}`;
      img.srcset = buildBannerSrcSet(m.bannerPath);
      img.sizes = '100vw';
      img.alt = m.title || '';
      slide.appendChild(img);
    } else if(m.poster) {
      // Sem backdrop, preferimos não usar pôster vertical no Hero
      // (mantém visual consistente sem gerar faixa estreita)
      return; // pula este item
    }
    container.appendChild(slide);
  });
  // Atualiza conteúdo textual do hero com o primeiro item
  heroUpdateContent(HERO_ITEMS[0] || null);
  initHeroDots();
}

function initHeroDots(){
  const box = document.getElementById('heroDots');
  if(!box) return;
  box.innerHTML = '';
  HERO_ITEMS.forEach((_, idx)=>{
    const dot = document.createElement('span');
    dot.className = 'dot' + (idx===0 ? ' active' : '');
    dot.addEventListener('click', ()=>{
      const container = document.getElementById('heroSlides');
      if(!container) return;
      const slides = Array.from(container.querySelectorAll('.slide'));
      if(!slides.length) return;
      slides[HERO_INDEX].classList.remove('active');
      HERO_INDEX = idx;
      slides[HERO_INDEX].classList.add('active');
      heroUpdateContent(HERO_ITEMS[HERO_INDEX] || null);
      updateHeroDots();
    });
    box.appendChild(dot);
  });
  function updateHeroDots(){
    const dots = Array.from(box.querySelectorAll('.dot'));
    dots.forEach((d,i)=> d.classList.toggle('active', i===HERO_INDEX));
  }
  // Exponho para uso no slideshow automático
  window.updateHeroDots = updateHeroDots;
}

function startHeroSlideshow(){
  const container = document.getElementById('heroSlides');
  if(!container) return;
  const slides = Array.from(container.querySelectorAll('.slide'));
  if(slides.length <= 1) return;
  HERO_INDEX = 0;
  if(HERO_INTERVAL_ID){ clearInterval(HERO_INTERVAL_ID); }
  HERO_INTERVAL_ID = setInterval(() => {
    slides[HERO_INDEX].classList.remove('active');
    HERO_INDEX = (HERO_INDEX + 1) % slides.length;
    slides[HERO_INDEX].classList.add('active');
    heroUpdateContent(HERO_ITEMS[HERO_INDEX] || null);
    if(typeof window.updateHeroDots === 'function'){ window.updateHeroDots(); }
  }, 5000);
}

async function updateHeroSlides(items){
  await buildHeroSlides(items);
  startHeroSlideshow();
}

// =====================
// Admin: Assinaturas
// =====================
async function fetchSubscriptions(status){
  try{
    const q = status && status !== 'all' ? `?status=${encodeURIComponent(status)}` : '';
    const r = await fetch(`/api/subscription/list${q}`);
    if(!r.ok){
      const tx = await r.text();
      return { ok:false, error: tx };
    }
    return await r.json();
  }catch(err){ return { ok:false, error: err.message }; }
}

function renderSubscriptionsTable(items){
  const wrap = document.getElementById('subsTable');
  if(!wrap) return;
  const arr = Array.isArray(items) ? items : [];
  if(!arr.length){
    wrap.innerHTML = '<p style="opacity:.8">Nenhuma assinatura encontrada para o filtro atual.</p>';
    return;
  }
  const headers = ['Usuário','Plano','Status','Ativa?','Início','Fim','Atualizado','Ações'];
  let html = '<table class="admin-table"><thead><tr>' + headers.map(h=>`<th>${h}</th>`).join('') + '</tr></thead><tbody>';
  html += arr.map(row=>{
    const id = row.id || '';
    const uid = row.user_id || '';
    const plan = row.plan || '';
    const status = row.status || (row.active ? 'active' : 'inactive');
    const active = row.active ? 'Sim' : 'Não';
    const start = row.start || '';
    const end = row.end || '';
    const updated = row.updated_at || '';
    const actionBtn = row.active ? `<button class="btn danger" data-action="deactivate" data-id="${id}" data-user="${uid}">Desativar</button>` : '<span style="opacity:.6">—</span>';
    return `<tr>
      <td title="${uid}">${String(uid).slice(0,8)}…</td>
      <td>${plan}</td>
      <td>${status}</td>
      <td>${active}</td>
      <td>${start||''}</td>
      <td>${end||''}</td>
      <td>${updated||''}</td>
      <td>${actionBtn}</td>
    </tr>`;
  }).join('');
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

async function refreshSubscriptions(){
  const radios = Array.from(document.querySelectorAll('input[name="subsFilter"]'));
  const checked = radios.find(r=>r.checked);
  const status = checked ? checked.value : 'all';
  const res = await fetchSubscriptions(status);
  if(res.ok){ renderSubscriptionsTable(res.items || []); }
  else {
    const wrap = document.getElementById('subsTable');
    if(wrap) wrap.innerHTML = `<p style="color:#f88">Erro: ${res.error||'Falha ao buscar assinaturas'}</p>`;
  }
}

function initSubscriptionsPanel(){
  const btn = document.getElementById('refreshSubsBtn');
  if(btn){ btn.addEventListener('click', refreshSubscriptions); }
  const radios = Array.from(document.querySelectorAll('input[name="subsFilter"]'));
  radios.forEach(r=> r.addEventListener('change', refreshSubscriptions));
  const tableWrap = document.getElementById('subsTable');
  if(tableWrap){
    tableWrap.addEventListener('click', async (e)=>{
      const tgt = e.target;
      if(!(tgt && tgt.matches('button[data-action="deactivate"]'))) return;
      if(!isAdminUser()){ alert('Apenas admin pode desativar assinaturas.'); return; }
      const id = tgt.getAttribute('data-id');
      const user = tgt.getAttribute('data-user');
      if(!confirm('Confirmar desativação desta assinatura?')) return;
      try{
        const r = await fetch('/api/subscription/deactivate',{
          method:'POST',
          headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify({ id, userId: user })
        });
        if(!r.ok){ const tx = await r.text(); alert('Falha ao desativar: '+tx); return; }
        const js = await r.json();
        if(js && js.ok){
          await refreshSubscriptions();
        } else {
          alert('Erro: '+(js && js.error || 'Falha desconhecida'));
        }
      }catch(err){ alert('Erro: '+err.message); }
    });
  }
  // Carrega inicialmente
  refreshSubscriptions();
}

function heroUpdateContent(item){
  const titleEl = document.querySelector('.hero-content h2');
  const descEl = document.querySelector('.hero-content p');
  const chipsEl = document.getElementById('heroChips');
  const watchBtn = document.getElementById('heroWatchBtn');
  const infoBtn = document.getElementById('heroInfoBtn');
  if(titleEl){ titleEl.textContent = item?.title || 'Explorar conteúdos'; }
  if(descEl){ descEl.textContent = item?.description || 'Seleção de filmes e séries atualizada.'; }
  if(chipsEl){
    const vote = (item && typeof item.tmdbVote === 'number') ? item.tmdbVote.toFixed(1) : null;
    const runtimeMin = (item && typeof item.runtime === 'number') ? item.runtime : null;
    const timeStr = (runtimeMin!=null) ? `${Math.floor(runtimeMin/60)}h ${runtimeMin%60}m` : null;
    const year = item?.year || null;
    const type = item?.type === 'serie' ? 'SÉRIE' : 'FILME';
    const chips = [];
    if(vote) chips.push(`<span class="chip"><span class="icon">⭐</span>${vote}</span>`);
    if(timeStr) chips.push(`<span class="chip"><span class="icon">⏱️</span>${timeStr}</span>`);
    if(year) chips.push(`<span class="chip red">${year}</span>`);
    chips.push(`<span class="chip green">${type}</span>`);
    chipsEl.innerHTML = chips.join(' ');
  }
  if(watchBtn){ watchBtn.onclick = ()=>{ if(item && item.id){ openModal(item.id); } }; }
  if(infoBtn){ infoBtn.onclick = ()=>{ if(item && item.id){ openModal(item.id); } }; }
}

// Assinaturas/Mercado Pago removidos

async function openModal(id){
  const movie = window.MOVIES.find(m=>m.id===id);
  const modal = document.getElementById('modal');
  const body = document.getElementById('modalBody');
  const kind = (movie.type === 'serie') ? 'serie' : 'filme';
  const contentId = movie.tmdbId || movie.imdbId || '';
  const superflixUrl = contentId ? `https://superflixapi.asia/${kind}/${contentId}` : null;
  const canWatch = !!superflixUrl;
  // Checar assinatura
  let active = false;
  try{
    const r = await fetch(`/api/subscription?userId=${encodeURIComponent(getEffectiveUserId())}`);
    if(r.ok){
      const sub = await r.json();
      active = !!sub?.active;
    }
  }catch(_){ /* fallback: sem assinatura */ }
  if(!active){
    // Bloqueio com link para Planos
    body.innerHTML = `
      <img src="${movie.poster}" alt="${movie.title} poster">
      <div class="modal-info" style="width:100%">
        <h2>${movie.title} <span style="color:#666;font-size:14px;">(${movie.year})</span></h2>
        <p>${movie.description}</p>
        <div class="genres">
          ${movie.genres.map(g=>`<span class='genre-pill'>${g}</span>`).join('')}
        </div>
        <div class="missing-id" style="margin-top:16px">
          Assine um plano para assistir. Seu acesso está bloqueado sem assinatura ativa.
        </div>
        <div style="margin-top:12px">
          <button id="goToPlansBtn" class="btn primary">Ver planos</button>
        </div>
      </div>
    `;
    modal.classList.remove('hidden');
    const goBtn = document.getElementById('goToPlansBtn');
    if(goBtn){ goBtn.onclick = ()=>{ modal.classList.add('hidden'); setRoute('plans'); } }
    return;
  }
  // Assinante: exibir player
  body.innerHTML = `
    <img src="${movie.poster}" alt="${movie.title} poster">
    <div class="modal-info" style="width:100%">
      <h2>${movie.title} <span style="color:#666;font-size:14px;">(${movie.year})</span></h2>
      <p>${movie.description}</p>
      <div class="genres">
        ${movie.genres.map(g=>`<span class='genre-pill'>${g}</span>`).join('')}
      </div>
      <div class="player" style="margin-top:20px;width:100%">
        <iframe id=\"superflixPlayer\" src=\"${superflixUrl}\" frameborder=\"0\" allow=\"autoplay; fullscreen\" allowfullscreen referrerpolicy=\"no-referrer\"></iframe>
      </div>
    </div>
  `;
  modal.classList.remove('hidden');
}

// --------- Usuário atual (Discord) ---------
async function fetchCurrentUser(){
  try{
    const res = await fetch('/api/auth/me');
    if(!res.ok){ CURRENT_USER = null; updateUserArea(); return; }
    const j = await res.json();
    CURRENT_USER = (j.logged && j.user) ? j.user : null;
    updateUserArea();
    applyAdminVisibility();
  }catch(_){ CURRENT_USER = null; updateUserArea(); }
}

function updateUserArea(){
  const area = document.getElementById('userArea');
  if(!area) return;
  if(CURRENT_USER){
    const sub = window.SUBSCRIPTION || null;
    const badge = (sub && sub.active) ? `<span class="user-badge" title="${sub.plan ? `Plano ${sub.plan}` : 'Plano ativo'}${sub.until ? ` até ${new Date(sub.until).toLocaleDateString('pt-BR')}` : ''}">Plano ativo</span>` : '';
    area.innerHTML = `
      <div class="user-avatar">${CURRENT_USER.avatar ? `<img src="https://cdn.discordapp.com/avatars/${CURRENT_USER.id}/${CURRENT_USER.avatar}.png" style="width:100%;height:100%;object-fit:cover"/>` : ''}</div>
      <button id="userMenuToggle" class="user-toggle"><span class="user-name">${CURRENT_USER.username}</span><span class="caret">▾</span></button>
      ${badge}
      <div id="userMenu" class="user-menu hidden">
        <div class="user-menu-header">
          <div class="user-avatar small">${CURRENT_USER.avatar ? `<img src="https://cdn.discordapp.com/avatars/${CURRENT_USER.id}/${CURRENT_USER.avatar}.png" style="width:100%;height:100%;object-fit:cover"/>` : ''}</div>
          <div class="user-ident">
            <div class="user-title">${CURRENT_USER.username}</div>
            <div class="user-email">${CURRENT_USER.email || ''}</div>
          </div>
        </div>
        <div class="user-menu-items">
          <button id="menuAccount" class="menu-item">Minha Conta</button>
          <button id="menuFavorites" class="menu-item">Favoritos</button>
          <button id="menuPlans" class="menu-item highlight">Planos Premium</button>
          <button id="menuLogout" class="menu-item danger">Sair da Conta</button>
        </div>
      </div>
    `;

    const toggle = document.getElementById('userMenuToggle');
    const menu = document.getElementById('userMenu');
    if(toggle && menu){
      toggle.onclick = (e)=>{ e.stopPropagation(); menu.classList.toggle('hidden'); };
    }
    const menuAccount = document.getElementById('menuAccount');
    const menuFavorites = document.getElementById('menuFavorites');
    const menuPlans = document.getElementById('menuPlans');
    const menuLogout = document.getElementById('menuLogout');
    if(menuAccount){ menuAccount.onclick = ()=>{ setRoute('minha-conta'); if(menu) menu.classList.add('hidden'); }; }
    if(menuFavorites){ menuFavorites.onclick = ()=>{ setRoute('minha-lista'); if(menu) menu.classList.add('hidden'); }; }
    if(menuPlans){ menuPlans.onclick = ()=>{ setRoute('plans'); if(menu) menu.classList.add('hidden'); }; }
    if(menuLogout){ menuLogout.onclick = async()=>{
      try{ await fetch('/api/auth/logout'); }catch(_){/* ignore */}
      CURRENT_USER = null; updateUserArea(); applyAdminVisibility();
    }; }
  } else {
    area.innerHTML = `<button id="loginBtn" class="btn secondary">Entrar com Discord</button>`;
    const loginBtn = document.getElementById('loginBtn');
    if(loginBtn){ loginBtn.onclick = ()=>{
      const ret = location.href;
      location.href = `/api/auth/discord/start?returnTo=${encodeURIComponent(ret)}`;
    }; }
  }
}

function renderAccountPage(){
  const avatarEl = document.getElementById('accountAvatar');
  const userEl = document.getElementById('accountUsername');
  const emailEl = document.getElementById('accountEmail');
  const nameField = document.getElementById('accountNameField');
  const emailField = document.getElementById('accountEmailField');
  const planBadge = document.getElementById('accountPlanBadge');
  const myListBtn = document.getElementById('accountMyListBtn');
  const subscribeBtn = document.getElementById('accountSubscribeBtn');
  const sub = window.SUBSCRIPTION || null;
  const u = CURRENT_USER || null;
  if(avatarEl){
    avatarEl.innerHTML = u && u.avatar ? `<img src="https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png" style="width:100%;height:100%;object-fit:cover"/>` : '';
  }
  if(userEl){ userEl.textContent = u ? (u.username || '—') : '—'; }
  if(emailEl){ emailEl.textContent = u ? (u.email || '—') : '—'; }
  if(nameField){ nameField.value = u ? (u.username || '') : ''; }
  if(emailField){ emailField.value = u ? (u.email || '') : ''; }
  if(planBadge){ planBadge.textContent = sub && sub.active ? `Plano: ${sub.plan || 'Ativo'}` : 'Plano: —'; }
  if(myListBtn){ myListBtn.onclick = ()=> setRoute('minha-lista'); }
  if(subscribeBtn){ subscribeBtn.onclick = ()=> setRoute('plans'); }
}

async function loadSubscriptionStatus(){
  try{
    const res = await fetch('/api/subscription');
    if(res.ok){
      const j = await res.json();
      window.SUBSCRIPTION = j || null;
    } else {
      window.SUBSCRIPTION = null;
    }
  }catch(_){ window.SUBSCRIPTION = null; }
  updateUserArea();
  if((window.CURRENT_ROUTE||'') === 'minha-conta') renderAccountPage();
}

function isAdminUser(){
  return !!window.ADMIN_WRITABLE;
}

function setRobotsMeta(content){
  try{
    let m = document.querySelector('meta[name="robots"]');
    if(!m){ m = document.createElement('meta'); m.setAttribute('name','robots'); document.head.appendChild(m); }
    m.setAttribute('content', content);
  }catch(_){/* ignore */}
}

function applyAdminVisibility(){
  const navAdmin = document.getElementById('navAdmin');
  const isAdmin = isAdminUser();
  if(navAdmin){ navAdmin.style.display = isAdmin ? '' : 'none'; navAdmin.setAttribute('rel','nofollow'); }
  if((window.CURRENT_ROUTE||'home') === 'admin' && !isAdmin){
    setRoute('home');
  }
}

// Modal de login removida: o login ocorre somente via botão no topo

async function openModalFromTmdbData(data){
  const modal = document.getElementById('modal');
  const body = document.getElementById('modalBody');
  const superflixUrl = buildSuperflixUrl(data.type, data.tmdbId);
  const canWatch = !!superflixUrl;
  // Checar assinatura
  let active = false;
  try{
    const r = await fetch(`/api/subscription?userId=${encodeURIComponent(getEffectiveUserId())}`);
    if(r.ok){ const sub = await r.json(); active = !!sub?.active; }
  }catch(_){}
  const baseInfo = `
    <img src="${data.poster}" alt="${data.title} poster">
    <div class="modal-info">
      <h2>${data.title} <span style="color:#666;font-size:14px;">(${data.year || 'N/A'})</span></h2>
      <p>${data.description || 'Sem descrição disponível.'}</p>
      <div class="genres">
        ${(data.genres||[]).map(g=>`<span class='genre-pill'>${g}</span>`).join('')}
      </div>
      <div style="margin-top:10px;color:#999;font-size:13px">SuperFlix: ${superflixUrl}</div>`;
  if(!active){
    body.innerHTML = baseInfo + `
      <div class="missing-id" style="margin-top:12px">Assine um plano para assistir. Seu acesso está bloqueado sem assinatura ativa.</div>
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
        <button id="addToSiteBtn" class="btn secondary">Adicionar ao site</button>
        <button id="goToPlansBtn" class="btn primary">Ver planos</button>
      </div>
    </div>`;
    modal.classList.remove('hidden');
    const goBtn = document.getElementById('goToPlansBtn');
    if(goBtn){ goBtn.onclick = ()=>{ modal.classList.add('hidden'); setRoute('plans'); } }
  } else {
    body.innerHTML = baseInfo + `
      <div class="player" style="margin-top:12px;width:100%">
        <iframe id=\"superflixPlayer\" src=\"${superflixUrl}\" frameborder=\"0\" allow=\"autoplay; fullscreen\" allowfullscreen referrerpolicy=\"no-referrer\"></iframe>
      </div>
      <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
        <button id="addToSiteBtn" class="btn secondary">Adicionar ao site</button>
      </div>
    </div>`;
  modal.classList.remove('hidden');
}

  const addBtn = document.getElementById('addToSiteBtn');
  if(addBtn){
    addBtn.addEventListener('click', ()=>{
      addFromTmdbData(data);
      alert('Conteúdo adicionado ao site com sucesso.');
      renderAdminList();
    });
  }
  
}

async function addFromTmdbData(data){
  const id = `tmdb-${data.type}-${data.tmdbId}`;
  const rowSel = document.getElementById('adminRow');
  const targetInput = document.querySelector('input[name="adminTarget"]:checked');
  const target = targetInput ? targetInput.value : 'home';
  const row = (target === 'home') ? (rowSel ? rowSel.value : 'recomendados') : '';
  const exists = (window.MOVIES||[]).some(m=> (m.tmdbId===data.tmdbId && (m.type||'filme')===data.type));
  if(exists){ return true; }
  const item = {
    id,
    type: data.type,
    tmdbId: data.tmdbId,
    title: data.title,
    year: data.year,
    genres: data.genres || [],
    poster: data.poster,
    trailer: '',
    description: data.description || '',
    category: '',
    row
  };
  const key = getItemKey(item);
  // Preferir API de estado (serverless) para evitar condições de corrida
  try{
    const res = await fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add', ...item, key })
    });
    if(!res.ok){ throw new Error('fallback'); }
  }catch(_){
    // Fallback: tentar persistir via Supabase client
    const current = (await supabaseGetState()) || { added: [], removed: [] };
    const savedSb = await supabaseSetState({
      added: [...(current.added||[]), { ...item, key }],
      removed: (current.removed||[]).filter(k=>k!==key)
    });
    if(!savedSb){
      // Fallback local (dev_server)
      try{
        const r2 = await fetch('/api/state/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...item, key })
        });
        if(!r2.ok) throw new Error('Falha ao salvar no backend');
      }catch(err){
        alert('Falha ao salvar no servidor: ' + err.message);
        return false;
      }
    }
  }
  // Atualizar estado em memória e UI
  window.ALL_MOVIES = (window.ALL_MOVIES||window.MOVIES||[]).concat(item);
  window.MOVIES = window.ALL_MOVIES;
  setRoute(window.CURRENT_ROUTE||'home');
  updateHeroSlides(window.ALL_MOVIES);
  filterAdminItems();
  return true;
}

function getItemKey(item){
  if(item.tmdbId){ return `${item.type||'filme'}:${item.tmdbId}`; }
  return `seed:${item.id}`;
}

function renderAdminList(){
  const container = document.getElementById('adminItems');
  if(!container) return;
  const source = window.ADMIN_FILTERED || window.ALL_MOVIES || window.MOVIES || [];
  // Atualiza contadores na topbar, se existir
  try{
    const moviesCount = source.filter(m=> (m.type||'filme') === 'filme').length;
    const seriesCount = source.filter(m=> (m.type||'filme') === 'serie').length;
    const elMov = document.getElementById('adminCountMovies');
    const elSer = document.getElementById('adminCountSeries');
    if(elMov) elMov.textContent = String(moviesCount);
    if(elSer) elSer.textContent = String(seriesCount);
  }catch(_){}
  container.innerHTML = '';
  source.forEach(m => {
    const div = document.createElement('div');
    div.className = 'admin-card';
    const key = getItemKey(m);
    const thumb = (m.poster ? `<img class="thumb" src="${m.poster}" alt="${m.title}">`
      : `<div class="thumb" style="width:110px;height:160px;border-radius:12px;background:linear-gradient(135deg,#1e293b,#0ea5e9)"></div>`);
    const genre = (Array.isArray(m.genres) && m.genres.length) ? m.genres[0] : ((m.type||'filme')==='filme'?'Filme':'Série');
    div.innerHTML = `
      ${thumb}
      <div class="body">
        <h4>${m.title}</h4>
        <div class="meta">
          <span class="pill">${genre}</span>
          <span>${m.year||''}</span>
          <span>Fileira: ${(m.row || (m.type==='serie'?'series':'filmes'))}</span>
        </div>
        <div class="card-actions">
          <button class="btn remove" data-key="${key}">Remover</button>
        </div>
      </div>
    `;
    container.appendChild(div);
  });
  container.querySelectorAll('button.remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-key');
      removeItemByKey(key);
    });
  });
}

async function removeItemByKey(key){
  // Preferir API de estado (serverless)
  let ok = false;
  try{
    const r = await fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'remove', key })
    });
    ok = r.ok;
  }catch(_){ ok = false; }
  if(!ok){
    // Supabase client fallback
    const current = (await supabaseGetState()) || { added: [], removed: [] };
    const savedSb = await supabaseSetState({
      added: (current.added||[]).filter(i => (i.key || getItemKey(i)) !== key),
      removed: [...(current.removed||[]), key]
    });
    if(!savedSb){
      // Local backend fallback
      try{
        const res = await fetch('/api/state/remove', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key })
        });
        if(!res.ok) throw new Error('Falha ao remover no backend');
      }catch(err){
        alert('Falha ao remover no servidor: ' + err.message);
        return;
      }
    }
  }
  // Atualizar estado em memória e UI
  window.ALL_MOVIES = (window.ALL_MOVIES||window.MOVIES||[]).filter(m => getItemKey(m) !== key);
  window.MOVIES = window.ALL_MOVIES;
  setRoute(window.CURRENT_ROUTE||'home');
  filterAdminItems();
  updateHeroSlides(window.ALL_MOVIES);
}

// KeyAuth removido: helpers e validações não são mais necessários

function showSection(section){
  const admin = document.getElementById('adminPanel');
  const main = document.getElementById('mainContent');
  const plans = document.getElementById('plansPage');
  const account = document.getElementById('accountPage');
  const suggestions = document.getElementById('suggestionsPage');
  if(section === 'admin'){
    if(!isAdminUser()){
      // Bloqueia acesso direto
      setRoute('home');
      return;
    }
    admin.classList.remove('hidden');
    main.classList.add('hidden');
    if(plans) plans.classList.add('hidden');
    if(account) account.classList.add('hidden');
    if(suggestions) suggestions.classList.add('hidden');
    renderAdminList();
    renderAdminSuggestions();
    setRobotsMeta('noindex, nofollow');
    
  } else {
    admin.classList.add('hidden');
    if(section === 'plans'){
      if(plans) plans.classList.remove('hidden');
      main.classList.add('hidden');
      if(account) account.classList.add('hidden');
      if(suggestions) suggestions.classList.add('hidden');
    } else if(section === 'account'){
      if(account) account.classList.remove('hidden');
      if(plans) plans.classList.add('hidden');
      main.classList.add('hidden');
      if(suggestions) suggestions.classList.add('hidden');
      renderAccountPage();
      setRobotsMeta('noindex, nofollow');
      return;
    } else if(section === 'suggestions'){
      if(plans) plans.classList.add('hidden');
      if(account) account.classList.add('hidden');
      if(suggestions) suggestions.classList.remove('hidden');
      main.classList.add('hidden');
      setRobotsMeta('index, follow');
      return;
    } else {
      if(plans) plans.classList.add('hidden');
      if(account) account.classList.add('hidden');
      if(suggestions) suggestions.classList.add('hidden');
      main.classList.remove('hidden');
    }
    setRobotsMeta('index, follow');
  }
}

function updateActiveNav(route){
  const ids = ['navHome','navFilmes','navSeries','navLista','navSuggestions','navAccount','navPlans','navAdmin'];
  ids.forEach(id=>{
    const el = document.getElementById(id);
    if(!el) return;
    el.classList.remove('active');
  });
  const map = {
    home: 'navHome',
    filmes: 'navFilmes',
    series: 'navSeries',
    'minha-lista': 'navLista',
    suggestions: 'navSuggestions',
    'minha-conta': 'navAccount',
    plans: 'navPlans',
    admin: 'navAdmin'
  };
  const activeId = map[route];
  const activeEl = activeId ? document.getElementById(activeId) : null;
  if(activeEl){ activeEl.classList.add('active'); }
}

function getRouteList(route){
  const base = window.ALL_MOVIES||window.MOVIES||[];
  if(route === 'filmes') return base.filter(m=> (m.type||'filme') === 'filme');
  if(route === 'series') return base.filter(m=> (m.type||'filme') === 'serie');
  if(route === 'minha-lista'){
    const favs = new Set(getFavorites().map(String));
    return base.filter(m=> favs.has(String(m.id)));
  }
  // Home: retorna base completa; renderização decide as fileiras (Filmes e Séries)
  return base;
}

function setRoute(route){
  window.CURRENT_ROUTE = route;
  if(route === 'admin'){
    showSection('admin');
    updateActiveNav('admin');
    return;
  }
  if(route === 'plans'){
    showSection('plans');
    updateActiveNav('plans');
    return;
  }
  if(route === 'suggestions'){
    showSection('suggestions');
    updateActiveNav('suggestions');
    return;
  }
  if(route === 'minha-conta'){
    showSection('account');
    updateActiveNav('minha-conta');
    return;
  }
  showSection('home');
  updateActiveNav(route);
  const base = getRouteList(route);
  window.MOVIES = base;
  if(route === 'home'){
    // Home = apenas fileiras Filmes e Séries
    renderHomeSections(base);
  } else {
    const titles = { filmes:'Filmes', series:'Séries', 'minha-lista':'Minha Lista' };
    if(route === 'populares'){
      renderSingleSection('Populares', base);
    } else {
      renderSingleSection(titles[route] || 'Itens', base);
    }
  }
}

function handleSearchInput(e){
  const query = (e.target.value||'').toLowerCase();
  const base = getRouteList(window.CURRENT_ROUTE||'home');
  const filtered = base.filter(m=> (m.title||'').toLowerCase().includes(query));
  if(query){
    renderSingleSection('Resultados', filtered);
  } else {
    if((window.CURRENT_ROUTE||'home') === 'home'){
      renderHomeSections(base);
    } else {
      const titles = { filmes:'Filmes', series:'Séries', 'minha-lista':'Minha Lista' };
      if((window.CURRENT_ROUTE||'home') === 'populares'){
        renderSingleSection('Populares', base);
      } else {
        renderSingleSection(titles[window.CURRENT_ROUTE] || 'Itens', base);
      }
    }
  }
}

// Busca rápida por título na lista do Admin
function filterAdminItems(){
  try{
    const input = document.getElementById('adminSearchInput');
    const q = (input && input.value ? input.value : '').toLowerCase();
    const base = window.ALL_MOVIES || window.MOVIES || [];
    const filtered = !q ? base : base.filter(m => String(m.title||'').toLowerCase().includes(q));
    window.ADMIN_FILTERED = filtered;
  }catch(_){ window.ADMIN_FILTERED = window.ALL_MOVIES || window.MOVIES || []; }
  renderAdminList();
}

// Sugestões: enviar e listar
async function handleSuggestionSubmit(){
  const btn = document.getElementById('sgSubmitBtn');
  const title = (document.getElementById('sgTitle')?.value||'').trim();
  const kind = (document.getElementById('sgKind')?.value||'filme');
  if(!title){ alert('Informe um título para a sugestão.'); return; }
  try{
    if(btn){ btn.disabled = true; btn.textContent = 'Enviando...'; }
    const res = await fetch(apiUrl('/api/suggestions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, kind })
    });
    if(!res.ok){
      const t = await res.text();
      throw new Error(t || 'Falha ao enviar sugestão');
    }
    try{
      document.getElementById('sgTitle').value = '';
      document.getElementById('sgKind').value = 'filme';
    }catch(_){}
    alert('Sugestão enviada com sucesso!');
    renderAdminSuggestions();
  }catch(err){
    alert('Erro: ' + (err && err.message ? err.message : String(err)));
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = 'Enviar Sugestão'; }
  }
}

async function renderAdminSuggestions(){
  const box = document.getElementById('adminSuggestions');
  if(!box) return;
  try{
    const res = await fetch(apiUrl('/api/suggestions'));
    if(!res.ok){ box.innerHTML = '<div class="panel">Falha ao carregar sugestões.</div>'; return; }
    const list = await res.json();
    const items = Array.isArray(list) ? list.slice().sort((a,b)=>{
      const ta = new Date(a.createdAt||0).getTime();
      const tb = new Date(b.createdAt||0).getTime();
      return tb - ta;
    }) : [];
    if(!items.length){ box.innerHTML = '<div class="panel">Nenhuma sugestão enviada ainda.</div>'; return; }
    box.innerHTML = '';
    items.forEach(s => {
      const el = document.createElement('div');
      el.className = 'admin-card';
      const when = s.createdAt ? new Date(s.createdAt).toLocaleString() : '';
      const tmdb = s.tmdbId ? `<span class=\"pill\">TMDB: ${s.tmdbId}</span>` : '';
      el.innerHTML = `
        <div class=\"body\">
          <h4>${s.title||'(sem título)'} <span class=\"pill\">${(s.kind||'filme')==='serie'?'Série':'Filme'}</span></h4>
          <div class=\"meta\" style=\"gap:8px;display:flex;flex-wrap:wrap\">${tmdb}
            <span style=\"color:#999\">${when}</span>
            ${s.author ? `<span style=\"color:#999\">por ${s.author}</span>` : ''}
          </div>
          ${s.details ? `<p style=\"margin-top:6px;color:#ddd\">${s.details}</p>` : ''}
        </div>`;
      box.appendChild(el);
    });
  }catch(err){
    box.innerHTML = '<div class="panel">Erro ao listar sugestões.</div>';
  }
}

function renderAdminPreview(data){
  const results = document.getElementById('adminResults');
  if(!results) return;
  const superflixUrl = buildSuperflixUrl(data.type, data.tmdbId);
  results.innerHTML = `
    <div class="preview panel">
      <img src="${data.poster}" alt="poster">
      <div class="meta">
        <h3>${data.title} <span style="color:#666;font-size:12px">(${data.year||'N/A'})</span></h3>
        <p style="color:#999">${data.description||''}</p>
        <div style="margin-top:6px;color:#999;font-size:12px">SuperFlix: ${superflixUrl}</div>
        <div style="margin-top:10px;display:flex;gap:8px">
          <button id="adminAddBtn" class="btn secondary">Adicionar ao site</button>
        </div>
      </div>
    </div>
  `;
  const addBtn = document.getElementById('adminAddBtn');
  if(addBtn){ addBtn.onclick = () => { addFromTmdbData(data); filterAdminItems(); } }
}

// ---- Importação em massa (IMDb/SuperFlix via TMDB) ----
async function fetchTmdbDetails(type, id){
  const endpoint = `/api/tmdb/details?type=${type}&id=${encodeURIComponent(id)}`;
  const r = await fetch(apiUrl(endpoint));
  if(!r.ok) throw new Error('TMDB detalhe falhou');
  return await r.json();
}

function normalizeFromDetails(type, details){
  const tmdbId = details.id;
  const imdbId = (details.external_ids && details.external_ids.imdb_id) || '';
  const title = type === 'serie' ? (details.name || details.original_name) : (details.title || details.original_title);
  const year = (type === 'serie' ? (details.first_air_date||'') : (details.release_date||'')).slice(0,4);
  const genres = Array.isArray(details.genres) ? details.genres.map(g=>g.name) : [];
  const poster = details.poster_path ? `${TMDB_IMG}${details.poster_path}` : '';
  const description = details.overview || '';
  const bannerPath = details.backdrop_path || '';
  return { type, tmdbId, imdbId, title, year, genres, poster, description, bannerPath };
}

async function fetchBulkFromTmdb(kind, limit = 24){
  limit = Math.max(6, Math.min(60, Number(limit)||24)); // controla quantidade
  // memória de sessão para evitar repetir itens entre puxadas
  window.BULK_SEEN = window.BULK_SEEN || { filme: new Set(), serie: new Set() };

  const shuffle = (arr) => {
    for(let i = arr.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  const makeList = async (type) => {
    const seen = window.BULK_SEEN[type] || new Set();
    const selected = [];
    let tries = 0;
    while(selected.length < limit && tries < 4){
      // Avançar página para sempre trazer novos itens
      const page = (type === 'serie' ? (window.BULK_PAGES.serie = (window.BULK_PAGES.serie||0) + 1) : (window.BULK_PAGES.filme = (window.BULK_PAGES.filme||0) + 1));
      const url = `/api/tmdb/list?type=${type}&page=${page}`;
      const r = await fetch(apiUrl(url));
      if(!r.ok) throw new Error('TMDB lista falhou');
      const json = await r.json();
      const raw = (json.results||[]);
      // remove ids já vistos nesta sessão
      const unseen = raw.filter(it => !seen.has(it.id));
      // aleatório para variar conteúdos
      const pick = shuffle(unseen).slice(0, Math.min(limit - selected.length, unseen.length));
      selected.push(...pick);
      // marca como visto para próximas puxadas
      pick.forEach(it => seen.add(it.id));
      tries++;
      if(unseen.length === 0) break; // evita loop inútil quando página esgotada
    }

    const out = [];
    for(const it of selected){
      try{
        const det = await fetchTmdbDetails(type, it.id);
        const norm = normalizeFromDetails(type, det);
        out.push(norm);
        // reforça marcação com tmdbId normalizado
        seen.add(norm.tmdbId);
      }catch(_){ /* ignora item com erro */ }
    }
    // Filtrar duplicados já adicionados ao site
    const already = window.ALL_MOVIES || [];
    const filtered = out.filter(it => !already.some(m => m.tmdbId === it.tmdbId && (m.type||'filme') === it.type));
    // persiste set atualizado
    window.BULK_SEEN[type] = seen;
    return filtered.slice(0, limit);
  };
  if(kind === 'filme') return await makeList('filme');
  if(kind === 'serie') return await makeList('serie');
  const movies = await makeList('filme');
  const series = await makeList('serie');
  // Misturado: intercalar
  const mixed = [];
  const max = Math.max(movies.length, series.length);
  for(let i=0;i<max;i++){
    if(movies[i]) mixed.push(movies[i]);
    if(series[i]) mixed.push(series[i]);
  }
  return shuffle(mixed).slice(0, limit);
}

// UI e handlers de importação em massa
function renderBulkResults(items){
  const container = document.getElementById('adminResults');
  if(!container) return;
  window.ADMIN_BULK = items || [];
  if(!items || items.length === 0){
    container.innerHTML = '<p class="muted">Nenhum resultado encontrado para esta busca.</p>';
    return;
  }
  const html = items.map((it, idx)=>{
    const poster = it.poster || '';
    const title = `${it.title||''}`;
    const meta = `${it.type==='serie'?'Série':'Filme'} • ${it.year||'—'}`;
    const genres = (Array.isArray(it.genres)?it.genres.join(', '):'');
    return `
      <div class="bulk-card">
        ${poster ? `<img src="${poster}" alt="${title}">` : `<div style="width:90px;height:135px;border-radius:8px;background:#222"></div>`}
        <div class="meta">
          <h4>${title}</h4>
          <p>${meta}</p>
          ${genres?`<small class="muted">${genres}</small>`:''}
          <div class="actions">
            <button class="btn primary" data-action="add" data-index="${idx}">Adicionar</button>
            <button class="btn secondary" data-action="sobre" data-index="${idx}">Sobre</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
  container.innerHTML = html;
}

async function handleBulkFetch(){
  try{
    const kind = document.querySelector('input[name="bulkKind"]:checked')?.value || 'misto';
    const qty = parseInt(document.getElementById('bulkQty')?.value||'24', 10);
    const items = await fetchBulkFromTmdb(kind, qty);
    renderBulkResults(items);
  }catch(err){
    const container = document.getElementById('adminResults');
    if(container){ container.innerHTML = `<p class="muted">Erro ao buscar em massa: ${err.message}</p>`; }
  }
}

async function addAllBulk(){
  const list = window.ADMIN_BULK || [];
  if(!list.length){ return; }
  let ok = 0;
  for(const it of list){
    const res = await addFromTmdbData(it);
    if(res) ok++;
  }
  const container = document.getElementById('adminResults');
  if(container){
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = `Adicionados ${ok} itens ao destino selecionado.`;
    container.prepend(note);
  }
}

function bindBulkCardEvents(){
  const container = document.getElementById('adminResults');
  if(!container) return;
  container.addEventListener('click', async (e)=>{
    const btn = e.target.closest('[data-action]');
    if(!btn) return;
    const action = btn.getAttribute('data-action');
    const idx = parseInt(btn.getAttribute('data-index')||'-1', 10);
    const list = window.ADMIN_BULK || [];
    const item = list[idx];
    if(!item) return;
    if(action === 'add'){
      const res = await addFromTmdbData(item);
      if(res){ btn.textContent = 'Adicionado'; btn.disabled = true; }
    }else if(action === 'sobre'){
      await openModalFromTmdbData(item);
    }
  });
}


// Fechar dropdown do usuário ao clicar fora
window.addEventListener('click', (e)=>{
  try{
    const menu = document.getElementById('userMenu');
    const toggle = document.getElementById('userMenuToggle');
    if(menu && !menu.classList.contains('hidden')){
      const target = e.target;
      const insideMenu = menu.contains(target);
      const isToggle = toggle && toggle.contains(target);
      if(!insideMenu && !isToggle){ menu.classList.add('hidden'); }
    }
  }catch(_){/* ignore */}
});

async function handleAdminSearch(){
  const type = document.querySelector('input[name="adminType"]:checked').value;
  const id = (document.getElementById('adminTmdbId').value||'').trim();
  if(!id) return;
  try{
    const data = await fetchTmdbById(type, id);
    renderAdminPreview(data);
  }catch(err){
    alert('Falha ao buscar no TMDB: ' + err.message);
  }
}

async function fetchTmdbById(type, id){
  // Tenta o endpoint do tipo selecionado; se 404, tenta o tipo alternativo.
  const primary = type === 'serie' ? 'serie' : 'filme';
  const secondary = primary === 'filme' ? 'serie' : 'filme';

  // Helper de mapeamento
  const mapJson = (json, kind) => {
    if(kind === 'serie'){
      return {
        type: 'serie',
        tmdbId: json.id,
        title: json.name,
        year: (json.first_air_date||'').slice(0,4),
        description: json.overview,
        poster: json.poster_path ? `${TMDB_IMG}${json.poster_path}` : '',
        genres: (json.genres||[]).map(g=>g.name)
      };
    }
    return {
      type: 'filme',
      tmdbId: json.id,
      title: json.title,
      year: (json.release_date||'').slice(0,4),
      description: json.overview,
      poster: json.poster_path ? `${TMDB_IMG}${json.poster_path}` : '',
      genres: (json.genres||[]).map(g=>g.name)
    };
  };

  // Primeiro: tentar o tipo primário via proxy
  let res = await fetch(apiUrl(`/api/tmdb/details?type=${primary}&id=${encodeURIComponent(id)}`));
  if(res.ok){
    const json = await res.json();
    return mapJson(json, primary);
  }
  // Se 404, tenta automaticamente o tipo alternativo
  if(res.status === 404){
    const res2 = await fetch(apiUrl(`/api/tmdb/details?type=${secondary}&id=${encodeURIComponent(id)}`));
    if(res2.ok){
      const json2 = await res2.json();
      return mapJson(json2, secondary);
    }
    throw new Error(`TMDB erro 404: ID não encontrado para ${primary}. Tente ${secondary}.`);
  }
  throw new Error(`TMDB erro ${res.status}`);
}

async function handleTmdbFetch(){
  const idInput = document.getElementById('tmdbIdInput');
  const type = document.querySelector('input[name="tmdbType"]:checked').value;
  const id = (idInput.value||'').trim();
  if(!id){
    idInput.focus();
    return;
  }
  try{
    const data = await fetchTmdbById(type, id);
    openModalFromTmdbData(data);
  }catch(err){
    alert('Falha ao buscar no TMDB: ' + err.message);
  }
}

document.getElementById('closeModal').addEventListener('click', ()=>{
  document.getElementById('modal').classList.add('hidden');
});

window.addEventListener('click', e=>{
  const modal = document.getElementById('modal');
  if(e.target === modal){
    modal.classList.add('hidden');
  }
});

document.getElementById('search').addEventListener('input', handleSearchInput);

const btnTmdb = document.getElementById('tmdbFetchBtn');
if(btnTmdb){ btnTmdb.addEventListener('click', handleTmdbFetch); }
const navAdmin = document.getElementById('navAdmin');
if(navAdmin){ navAdmin.addEventListener('click', ()=> setRoute('admin')); }
const navHome = document.getElementById('navHome');
if(navHome){ navHome.addEventListener('click', ()=> setRoute('home')); }
// Removido: Populares
const navFilmes = document.getElementById('navFilmes');
if(navFilmes){ navFilmes.addEventListener('click', ()=> setRoute('filmes')); }
const navSeries = document.getElementById('navSeries');
if(navSeries){ navSeries.addEventListener('click', ()=> setRoute('series')); }
const navSuggestions = document.getElementById('navSuggestions');
if(navSuggestions){ navSuggestions.addEventListener('click', ()=> setRoute('suggestions')); }
const navLista = document.getElementById('navLista');
if(navLista){ navLista.addEventListener('click', ()=> setRoute('minha-lista')); }
const navAccount = document.getElementById('navAccount');
if(navAccount){ navAccount.addEventListener('click', ()=> setRoute('minha-conta')); }
const navPlans = document.getElementById('navPlans');
  if(navPlans){ navPlans.addEventListener('click', ()=> setRoute('plans')); }
  // Efeito de sombra na navbar ao rolar
  const navbar = document.querySelector('.navbar');
  function updateNavbarShadow(){
    if(!navbar) return; if(window.scrollY > 2) navbar.classList.add('scrolled'); else navbar.classList.remove('scrolled');
  }
  window.addEventListener('scroll', updateNavbarShadow, { passive: true });
  updateNavbarShadow();
const adminSearchBtn = document.getElementById('adminSearchBtn');
if(adminSearchBtn){ adminSearchBtn.addEventListener('click', handleAdminSearch); }
// Envio de sugestões
const sgSubmitBtn = document.getElementById('sgSubmitBtn');
if(sgSubmitBtn){ sgSubmitBtn.addEventListener('click', handleSuggestionSubmit); }
// Bind do campo de busca rápida do Admin
  const adminSearchInput = document.getElementById('adminSearchInput');
  if(adminSearchInput){ adminSearchInput.addEventListener('input', filterAdminItems); }
// Importação em massa
const bulkFetchBtn = document.getElementById('bulkFetchBtn');
if(bulkFetchBtn){ bulkFetchBtn.addEventListener('click', handleBulkFetch); }
const bulkAddAllBtn = document.getElementById('bulkAddAllBtn');
if(bulkAddAllBtn){ bulkAddAllBtn.addEventListener('click', addAllBulk); }
bindBulkCardEvents();
// Desabilitar seletor de fileira quando destino não é Home
const adminRowSel = document.getElementById('adminRow');
const targetRadios = Array.from(document.querySelectorAll('input[name="adminTarget"]'));
function updateAdminRowEnabled(){
  const selected = document.querySelector('input[name="adminTarget"]:checked')?.value || 'home';
  if(adminRowSel){
    adminRowSel.disabled = selected !== 'home';
    adminRowSel.title = selected !== 'home' ? 'Desabilitado: item não aparecerá na Home' : '';
  }
}
targetRadios.forEach(r => r.addEventListener('change', updateAdminRowEnabled));
updateAdminRowEnabled();
// Admin Compras: filtros e atualizar
// Admin compras removido

// Botões de compra
// Botões de compra removidos

// Admin: salvar segredo Sunize
const saveSunizeSecretBtn = document.getElementById('saveSunizeSecretBtn');
if(saveSunizeSecretBtn){
  const API_BASE = (window.__ENV && (window.__ENV.CONFIG_API_BASE_URL||'').trim()) || (window.location && window.location.origin) || '';
  const apiUrl = (p)=> `${API_BASE}${p}`;
  saveSunizeSecretBtn.addEventListener('click', async ()=>{
    const publicUrl = (document.getElementById('publicUrl').value||'').trim();
    // Campos atualizados: somente Client Key/Secret
    const sunizeClientKey = (document.getElementById('sunizeClientKey').value||'').trim();
    const sunizeClientSecret = (document.getElementById('sunizeClientSecret').value||'').trim();
    const discordInviteUrl = (document.getElementById('discordInviteUrl').value||'').trim();
    try{
      const probe = await fetch(apiUrl('/api/config'));
      const cfgProbe = probe.ok ? await probe.json() : { writable:false, source:'env' };
      if (!cfgProbe.writable) {
        // Fallback local: persistir o link do Discord via cookie e atualizar UI
        try{
          const maxAge = 60*60*24*30; // 30 dias
          document.cookie = `discord_invite_url=${encodeURIComponent(discordInviteUrl||'')}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
          const di = document.getElementById('discordInviteUrl');
          if(di){ di.value = discordInviteUrl || ''; }
          const discordBtn = document.getElementById('discordFloatingBtn');
          if(discordBtn && discordInviteUrl){ discordBtn.href = discordInviteUrl; }
          alert('Link do Discord salvo localmente para este navegador. Para salvar globalmente, configure admins/variáveis de ambiente.');
          return;
        }catch(_){
          alert('Somente leitura. Configure no Vercel/variáveis de ambiente.');
          return;
        }
      }
      const res = await fetch(apiUrl('/api/config'), { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ publicUrl, sunizeClientKey, sunizeClientSecret, discordInviteUrl }) });
      if(!res.ok) throw new Error('Falha ao salvar configurações');
      alert('Configurações salvas com sucesso.');
      const stat = document.getElementById('sunizeSecretStatus');
      if(stat){ stat.textContent = ((sunizeClientKey && sunizeClientSecret)) ? 'Segredo configurado' : 'Segredo não configurado'; }
      const discordBtn = document.getElementById('discordFloatingBtn');
      if(discordBtn && discordInviteUrl){ discordBtn.href = discordInviteUrl; }
    }catch(err){ alert('Erro ao salvar configurações: '+err.message); }
  });
}

// Prefill token no Admin
(async ()=>{
  try{
    const API_BASE = (window.__ENV && (window.__ENV.CONFIG_API_BASE_URL||'').trim()) || (window.location && window.location.origin) || '';
    const apiUrl = (p)=> `${API_BASE}${p}`;
    const res = await fetch(apiUrl('/api/config'));
    if(res.ok){
      const cfg = await res.json();
      window.ADMIN_WRITABLE = !!cfg.writable;
      try{ applyAdminVisibility(); }catch(_){}
      const pub = document.getElementById('publicUrl');
      if(pub) pub.value = cfg.publicUrl || (window.location && window.location.origin) || 'https://gouflix.discloud.app';
      // Campos de Bootstrap removidos
      if(!cfg.writable && saveSunizeSecretBtn){ saveSunizeSecretBtn.disabled = true; saveSunizeSecretBtn.title = 'Somente leitura. Gerenciado por variáveis de ambiente.'; }
      const stat = document.getElementById('sunizeSecretStatus');
      if(stat){ stat.textContent = cfg.hasSunizeSecret ? 'Segredo configurado' : 'Segredo não configurado'; }
      const di = document.getElementById('discordInviteUrl');
      if(di){
        let discordVal = cfg.discordInviteUrl || '';
        if(!discordVal){
          try{
            const raw = (document.cookie||'').split(';').find(c=>c.trim().startsWith('discord_invite_url='));
            if(raw){ discordVal = decodeURIComponent(raw.split('=')[1]||''); }
          }catch(_){ /* ignore */ }
        }
        di.value = discordVal;
      }
      const discordBtn = document.getElementById('discordFloatingBtn');
      if(discordBtn){
        const href = cfg.discordInviteUrl || (function(){
          try{
            const raw = (document.cookie||'').split(';').find(c=>c.trim().startsWith('discord_invite_url='));
            if(raw){ return decodeURIComponent(raw.split('=')[1]||''); }
          }catch(_){}
          return '';
        })();
        if(href){ discordBtn.href = href; }
      }
    }
  }catch(_){/* ignore */}
})();

// Import/Export de estado removido do Admin

// Executar bootstrap agora
// Botão de executar bootstrap removido

initEnvAndSupabase().then(async()=>{
  await fetchCurrentUser();
  await loadSubscriptionStatus();
  const pm = document.getElementById('paymentModal');
  if(pm){ pm.classList.add('hidden'); }
  const searchEl = document.getElementById('search');
  if(searchEl){ searchEl.value = ''; }
  loadMovies();
});

// ----- Pagamentos (Mercado Pago PIX) -----
function bindPlanButtons(){
  const buttons = Array.from(document.querySelectorAll('.plan-buy[data-plan]'));
  buttons.forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const plan = btn.getAttribute('data-plan');
      openPaymentModal(plan);
    });
  });
}

async function openPaymentModal(plan){
  const modal = document.getElementById('paymentModal');
  const img = document.getElementById('qrCodeImage');
  const codeEl = document.getElementById('pixCode');
  const statusEl = document.getElementById('paymentStatus');
  if(!modal) return;
  img.src = '';
  codeEl.textContent = '';
  statusEl.textContent = 'Gerando pagamento...';
  modal.classList.remove('hidden');
  try{
    const r = await fetch('/api/sunize/create',{ method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ plan, userId: getEffectiveUserId() }) });
    const json = await r.json();
    if(!r.ok || !json.ok){ throw new Error(json.error||'Falha ao gerar pagamento'); }
    const id = json.id;
    const qrBase64 = json.qr_code_base64 || json.qrbase64 || null;
    const pixCode = json.qr_code || json.copiaecola || json.qr || '';
    if(qrBase64){ img.src = `data:image/png;base64,${qrBase64}`; }
    codeEl.textContent = pixCode;
    statusEl.textContent = 'Aguardando pagamento...';
    pollPaymentStatus(id, plan);
  }catch(err){
    statusEl.textContent = 'Erro: ' + err.message;
  }
}

let paymentPollTimer = null;
function stopPaymentPoll(){ if(paymentPollTimer){ clearInterval(paymentPollTimer); paymentPollTimer=null; } }
function pollPaymentStatus(id, plan){
  stopPaymentPoll();
  let attempts = 0;
  const statusEl = document.getElementById('paymentStatus');
  paymentPollTimer = setInterval(async ()=>{
    attempts++;
    if(attempts>90){ stopPaymentPoll(); statusEl.textContent = 'Tempo esgotado. Tente novamente.'; return; }
    try{
      const r = await fetch(`/api/sunize/status?id=${encodeURIComponent(id)}`);
      const json = await r.json();
      const status = String(json?.status||'').toLowerCase();
      if(['approved','paid','completed','confirmed'].includes(status)){
        stopPaymentPoll();
        // ativar assinatura imediatamente (fallback se webhook não acionou)
        try{ await fetch('/api/subscription',{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ userId: getEffectiveUserId(), plan, action:'activate' }) }); }catch(_){}
        statusEl.textContent = 'Pagamento aprovado! Assinatura ativada.';
        setTimeout(()=>{ document.getElementById('paymentModal').classList.add('hidden'); setRoute('home'); }, 1500);
      }
    }catch(_){ /* ignore */ }
  }, 5000);
}

const closePaymentBtn = document.getElementById('closePayment');
if(closePaymentBtn){ closePaymentBtn.addEventListener('click', ()=>{ document.getElementById('paymentModal').classList.add('hidden'); stopPaymentPoll(); }); }
bindPlanButtons();

// Admin compras/assinaturas removido

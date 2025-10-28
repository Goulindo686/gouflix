// script.js - versão moderna estilo Netflix
let TMDB_API_KEY = '8a2d4c3351370eb863b79cc6dda7bb81';
let TMDB_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI4YTJkNGMzMzUxMzcwZWI4NjNiNzljYzZkZGE3YmI4MSIsIm5iZiI6MTc2MTU0MTY5NC4zNTMsInN1YiI6IjY4ZmVmZTNlMTU2MThmMDM5OGRhMDIwMCIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.Raq9U3uybPj034WxjdiVEdbycZ0VBUQRokSgaN5rjlo';
let TMDB_BASE = 'https://api.themoviedb.org/3';
let TMDB_IMG = 'https://image.tmdb.org/t/p/w500';

// Integração com Vercel/Supabase: obter env e iniciar cliente
window.__ENV = {};
window.supabaseClient = null;
let CURRENT_USER = null;
async function initEnvAndSupabase(){
  try{
    const res = await fetch('/api/env');
  if(res.ok){
      const env = await res.json();
      window.__ENV = env || {};
      TMDB_BASE = env.TMDB_BASE || TMDB_BASE;
      TMDB_IMG = env.TMDB_IMG || TMDB_IMG;
      TMDB_TOKEN = env.TMDB_TOKEN || TMDB_TOKEN;
      const url = env.SUPABASE_URL;
      const key = env.SUPABASE_ANON_KEY;
      if(url && key && window.supabase){
        window.supabaseClient = window.supabase.createClient(url, key);
      }
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

function renderMovies(movies){
  const row = document.getElementById('movieRow');
  row.innerHTML = '';
  movies.forEach(m => {
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `
      <img src="${m.poster}" alt="${m.title}">
      <div class="info">
        <h3>${m.title}</h3>
        <p>${m.year}</p>
      </div>
    `;
    div.onclick = () => openModal(m.id);
    row.appendChild(div);
  });
}

// Slideshow do topo (Hero)
let HERO_INTERVAL_ID = null;
function buildHeroSlides(items){
  const container = document.getElementById('heroSlides');
  if(!container) return;
  container.innerHTML = '';
  const posters = (items||[]).filter(m => !!m.poster).slice(0, 12);
  posters.forEach((m, idx) => {
    const slide = document.createElement('div');
    slide.className = 'slide' + (idx === 0 ? ' active' : '');
    slide.style.backgroundImage = `url('${m.poster}')`;
    container.appendChild(slide);
  });
}

function startHeroSlideshow(){
  const container = document.getElementById('heroSlides');
  if(!container) return;
  const slides = Array.from(container.querySelectorAll('.slide'));
  if(slides.length <= 1) return;
  let index = 0;
  if(HERO_INTERVAL_ID){ clearInterval(HERO_INTERVAL_ID); }
  HERO_INTERVAL_ID = setInterval(() => {
    slides[index].classList.remove('active');
    index = (index + 1) % slides.length;
    slides[index].classList.add('active');
  }, 5000);
}

function updateHeroSlides(items){
  buildHeroSlides(items);
  startHeroSlideshow();
}

// Assinaturas/Mercado Pago removidos

function openModal(id){
  const movie = window.MOVIES.find(m=>m.id===id);
  const modal = document.getElementById('modal');
  const body = document.getElementById('modalBody');
  const kind = (movie.type === 'serie') ? 'serie' : 'filme';
  const contentId = movie.tmdbId || movie.imdbId || '';
  const superflixUrl = contentId ? `https://superflixapi.asia/${kind}/${contentId}` : null;
  const canWatch = !!superflixUrl;
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

// --------- Login via Discord ---------
async function fetchCurrentUser(){
  try{
    const res = await fetch('/api/auth/me');
    if(!res.ok){ CURRENT_USER = null; updateUserArea(); return; }
    const j = await res.json();
    CURRENT_USER = (j.logged && j.user) ? j.user : null;
    updateUserArea();
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
      <span class="user-name">${CURRENT_USER.username}</span>
      ${badge}
      <button id="logoutBtn" class="btn secondary">Sair</button>
    `;
    const logoutBtn = document.getElementById('logoutBtn');
    if(logoutBtn){ logoutBtn.onclick = async()=>{ try{ await fetch('/api/auth/logout'); CURRENT_USER = null; updateUserArea(); }catch(_){/* ignore */} } }
  } else {
    area.innerHTML = `<button id="loginBtn" class="btn secondary">Entrar com Discord</button>`;
    const loginBtn = document.getElementById('loginBtn');
    if(loginBtn){ loginBtn.onclick = ()=>{
      const ret = location.href;
      location.href = `/api/auth/discord/start?returnTo=${encodeURIComponent(ret)}`;
    }; }
  }
}

// Modal de login removida: o login ocorre somente via botão no topo

function openModalFromTmdbData(data){
  const modal = document.getElementById('modal');
  const body = document.getElementById('modalBody');
  const superflixUrl = buildSuperflixUrl(data.type, data.tmdbId);
  const canWatch = !!superflixUrl;
  body.innerHTML = `
    <img src="${data.poster}" alt="${data.title} poster">
    <div class="modal-info">
      <h2>${data.title} <span style="color:#666;font-size:14px;">(${data.year || 'N/A'})</span></h2>
      <p>${data.description || 'Sem descrição disponível.'}</p>
      <div class="genres">
        ${(data.genres||[]).map(g=>`<span class='genre-pill'>${g}</span>`).join('')}
      </div>
      <div style="margin-top:10px;color:#999;font-size:13px">SuperFlix: ${superflixUrl}</div>
      <div class="player" style="margin-top:12px;width:100%">
        <iframe id=\"superflixPlayer\" src=\"${superflixUrl}\" frameborder=\"0\" allow=\"autoplay; fullscreen\" allowfullscreen referrerpolicy=\"no-referrer\"></iframe>
      </div>
      <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
        <button id="addToSiteBtn" class="btn secondary">Adicionar ao site</button>
      </div>
    </div>
  `;
  modal.classList.remove('hidden');

  const addBtn = document.getElementById('addToSiteBtn');
  if(addBtn){
    addBtn.addEventListener('click', ()=>{
      addFromTmdbData(data);
      alert('Conteúdo adicionado ao site com sucesso.');
      renderAdminList();
    });
  }
  
}

function addFromTmdbData(data){
  const id = `tmdb-${data.type}-${data.tmdbId}`;
  const categorySel = document.getElementById('adminCategory');
  const category = categorySel ? categorySel.value : 'popular';
  const exists = (window.MOVIES||[]).some(m=> (m.tmdbId===data.tmdbId && (m.type||'filme')===data.type));
  if(exists){ return; }
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
    category
  };
  // Persistir via Supabase (fallback para backend)
  (async ()=>{
    const key = getItemKey(item);
    const current = (await supabaseGetState()) || { added: [], removed: [] };
    const savedSb = await supabaseSetState({
      added: [...(current.added||[]), { ...item, key }],
      removed: (current.removed||[]).filter(k=>k!==key)
    });
    if(!savedSb){
      try{
        const res = await fetch('/api/state/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...item, key })
        });
        if(!res.ok) throw new Error('Falha ao salvar no backend');
      }catch(err){
        alert('Falha ao salvar no servidor: ' + err.message);
        return;
      }
    }
    // Atualizar estado em memória e UI
    window.ALL_MOVIES = (window.ALL_MOVIES||window.MOVIES||[]).concat(item);
    window.MOVIES = window.ALL_MOVIES;
    setRoute(window.CURRENT_ROUTE||'home');
    updateHeroSlides(window.ALL_MOVIES);
    renderAdminList();
  })();
}

function getItemKey(item){
  if(item.tmdbId){ return `${item.type||'filme'}:${item.tmdbId}`; }
  return `seed:${item.id}`;
}

function renderAdminList(){
  const container = document.getElementById('adminItems');
  if(!container) return;
  container.innerHTML = '';
  (window.ALL_MOVIES||window.MOVIES||[]).forEach(m => {
    const div = document.createElement('div');
    div.className = 'admin-card';
    const key = getItemKey(m);
    div.innerHTML = `
      <h4>${m.title}</h4>
      <div class="meta">${(m.type||'filme').toUpperCase()} • ${m.year||''}</div>
      <button class="btn remove" data-key="${key}">Remover</button>
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

function removeItemByKey(key){
  (async ()=>{
    // Tenta persistir via Supabase; fallback para backend
    const current = (await supabaseGetState()) || { added: [], removed: [] };
    const savedSb = await supabaseSetState({
      added: (current.added||[]).filter(i => (i.key || getItemKey(i)) !== key),
      removed: [...(current.removed||[]), key]
    });
    if(!savedSb){
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
    // Atualizar estado em memória e UI
    window.ALL_MOVIES = (window.ALL_MOVIES||window.MOVIES||[]).filter(m => getItemKey(m) !== key);
    window.MOVIES = window.ALL_MOVIES;
    setRoute(window.CURRENT_ROUTE||'home');
    renderAdminList();
    updateHeroSlides(window.ALL_MOVIES);
  })();
}

// KeyAuth removido: helpers e validações não são mais necessários

function showSection(section){
  const admin = document.getElementById('adminPanel');
  const main = document.getElementById('mainContent');
  const plans = document.getElementById('plansPage');
  if(section === 'admin'){
    admin.classList.remove('hidden');
    main.classList.add('hidden');
    if(plans) plans.classList.add('hidden');
    renderAdminList();
    
  } else {
    admin.classList.add('hidden');
    if(section === 'plans'){
      if(plans) plans.classList.remove('hidden');
      main.classList.add('hidden');
    } else {
      if(plans) plans.classList.add('hidden');
      main.classList.remove('hidden');
    }
  }
}

function updateActiveNav(route){
  const ids = ['navHome','navFilmes','navSeries','navLista','navPlans','navAdmin'];
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
  if(route === 'minha-lista') return base.filter(m=> (m.category||'popular') === 'minha-lista');
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
  showSection('home');
  updateActiveNav(route);
  const titleEl = document.querySelector('#mainContent .section-title');
  if(titleEl){
    const titles = { home:'Populares', filmes:'Filmes', series:'Séries', 'minha-lista':'Minha Lista' };
    titleEl.textContent = titles[route] || 'Populares';
  }
  const list = getRouteList(route);
  window.MOVIES = list;
  renderMovies(list);
}

function handleSearchInput(e){
  const query = (e.target.value||'').toLowerCase();
  const base = getRouteList(window.CURRENT_ROUTE||'home');
  const filtered = base.filter(m=> (m.title||'').toLowerCase().includes(query));
  renderMovies(filtered);
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
  if(addBtn){ addBtn.onclick = () => { addFromTmdbData(data); renderAdminList(); } }
}

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
  const endpoints = {
    filme: `${TMDB_BASE}/movie/${id}?language=pt-BR`,
    serie: `${TMDB_BASE}/tv/${id}?language=pt-BR`
  };
  const headers = {
    Authorization: `Bearer ${TMDB_TOKEN}`,
    'Content-Type': 'application/json;charset=utf-8'
  };

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

  // Primeiro: tentar o tipo primário
  let res = await fetch(endpoints[primary], { headers });
  if(res.ok){
    const json = await res.json();
    return mapJson(json, primary);
  }
  // Se 404, tenta automaticamente o tipo alternativo
  if(res.status === 404){
    const res2 = await fetch(endpoints[secondary], { headers });
    if(res2.ok){
      const json2 = await res2.json();
      return mapJson(json2, secondary);
    }
    // Mensagem mais clara para 404
    throw new Error(`TMDB erro 404: ID não encontrado para ${primary}. Tente ${secondary}.`);
  }
  // Outros erros: repassar status
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
if(navAdmin){ navAdmin.addEventListener('click', ()=> showSection('admin')); }
const navHome = document.getElementById('navHome');
if(navHome){ navHome.addEventListener('click', ()=> setRoute('home')); }
const navFilmes = document.getElementById('navFilmes');
if(navFilmes){ navFilmes.addEventListener('click', ()=> setRoute('filmes')); }
const navSeries = document.getElementById('navSeries');
if(navSeries){ navSeries.addEventListener('click', ()=> setRoute('series')); }
const navLista = document.getElementById('navLista');
if(navLista){ navLista.addEventListener('click', ()=> setRoute('minha-lista')); }
const navPlans = document.getElementById('navPlans');
if(navPlans){ navPlans.addEventListener('click', ()=> setRoute('plans')); }
const adminSearchBtn = document.getElementById('adminSearchBtn');
if(adminSearchBtn){ adminSearchBtn.addEventListener('click', handleAdminSearch); }
// Admin Compras: filtros e atualizar
// Admin compras removido

// Botões de compra
// Botões de compra removidos

// Admin: salvar token Mercado Pago
const saveMpTokenBtn = document.getElementById('saveMpTokenBtn');
if(saveMpTokenBtn){
  saveMpTokenBtn.addEventListener('click', async ()=>{
    const publicUrl = (document.getElementById('publicUrl').value||'').trim();
    const bootstrapMoviesUrl = (document.getElementById('bootstrapMoviesUrl').value||'').trim();
    const bootstrapAuto = !!(document.getElementById('bootstrapAuto')?.checked);
    try{
      const probe = await fetch('/api/config');
      const cfgProbe = probe.ok ? await probe.json() : { writable:false, source:'env' };
      if (!cfgProbe.writable) {
        alert('Configurações gerenciadas por ambiente. Edite no Vercel/variáveis de ambiente.');
        return;
      }
      const res = await fetch('/api/config', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ publicUrl, bootstrapMoviesUrl, bootstrapAuto }) });
      if(!res.ok) throw new Error('Falha ao salvar configurações');
      alert('Configurações salvas com sucesso.');
    }catch(err){ alert('Erro ao salvar configurações: '+err.message); }
  });
}

// Prefill token no Admin
(async ()=>{
  try{
    const res = await fetch('/api/config');
    if(res.ok){
      const cfg = await res.json();
      const pub = document.getElementById('publicUrl');
      if(pub) pub.value = cfg.publicUrl || 'https://gouflix.discloud.app';
      const bm = document.getElementById('bootstrapMoviesUrl');
      if(bm) bm.value = cfg.bootstrapMoviesUrl || '';
      const ba = document.getElementById('bootstrapAuto');
      if(ba) ba.checked = !!cfg.bootstrapAuto;
      if(!cfg.writable && saveMpTokenBtn){ saveMpTokenBtn.disabled = true; saveMpTokenBtn.title = 'Somente leitura. Gerenciado por variáveis de ambiente.'; }
    }
  }catch(_){/* ignore */}
})();

// Import/Export de estado removido do Admin

// Executar bootstrap agora
const runBootstrapBtn = document.getElementById('runBootstrapBtn');
if(runBootstrapBtn){
  runBootstrapBtn.addEventListener('click', async()=>{
    try{
      const r = await fetch('/api/bootstrap/run', { method:'POST' });
      if(!r.ok) throw new Error('Falha ao executar bootstrap');
      alert('Bootstrap executado. Atualizando conteúdo...');
      await loadMovies();
      renderAdminList();
    }catch(err){ alert(err.message); }
  });
}

initEnvAndSupabase().then(()=>{
  loadMovies();
  fetchCurrentUser();
});

// Pagamentos removidos

// Admin compras/assinaturas removido

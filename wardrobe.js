import * as THREE from 'three';

/* ============================================================
   CONSTANTS & STATE
============================================================ */
const LDSP_W=2750, LDSP_H=1830, HDF_W=2800, HDF_H=2070;
const T=16; // толщина ЛДСП мм

/* ============================================================
   PROJECT SYSTEM
   Storage layout:
     wc_proj_index  = [{id, name, client, date, savedAt}]   — индекс всех проектов
     wc_proj_{id}   = {meta, sections, secId, matChoice}     — данные проекта
   Глобальные каталоги (hw, prices, catalog) — общие, не per-project.
============================================================ */
const PROJ_STORE_PREFIX = 'wc_proj_';
const PROJ_INDEX_KEY    = 'wc_proj_index';

// Текущий активный проект
let activeProjectId = null;
let projUnsaved = false;      // есть несохранённые изменения
let autoSaveTimer = null;

// Читаем индекс проектов из localStorage
function projGetIndex(){
  try{ return JSON.parse(localStorage.getItem(PROJ_INDEX_KEY)||'[]'); }catch(e){ return []; }
}
function projSetIndex(idx){
  try{ localStorage.setItem(PROJ_INDEX_KEY, JSON.stringify(idx)); }catch(e){}
}

// Генерируем уникальный ID проекта
function projGenId(){
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
}

// Снимок текущего состояния (sections + secId + matChoice)
function projSnapshot(){
  return {
    meta: {
      name:   (document.getElementById('proj-name-inp')  ||{}).value||'Новый проект',
      client: (document.getElementById('proj-client-inp')||{}).value||'',
      date:   (document.getElementById('proj-date-inp')  ||{}).value||'',
    },
    sections:   JSON.parse(JSON.stringify(sections)),
    secId:      secId,
    matChoice:  JSON.parse(JSON.stringify(matChoice)),
  };
}

// Восстановить state из снапшота
function projRestore(snap){
  sections  = snap.sections  || [];
  if(!sections.length) sections=[mkSection()];
  secId     = snap.secId     || 0;
  Object.assign(matChoice, snap.matChoice || {});
}

// Сохранить текущий проект
function projSave(){
  if(!activeProjectId) activeProjectId = projGenId();

  const snap = projSnapshot();
  const idx  = projGetIndex();
  const existing = idx.find(p => p.id === activeProjectId);
  const entry = {
    id:      activeProjectId,
    name:    snap.meta.name   || 'Без названия',
    client:  snap.meta.client || '',
    date:    snap.meta.date   || '',
    savedAt: new Date().toISOString(),
  };
  if(existing) Object.assign(existing, entry);
  else idx.unshift(entry);
  projSetIndex(idx);

  try{ localStorage.setItem(PROJ_STORE_PREFIX + activeProjectId, JSON.stringify(snap)); }catch(e){
    alert('Ошибка сохранения: '+e.message); return;
  }

  projUnsaved = false;
  projRenderTabs();

  // Flash «Сохранено»
  const fl = document.getElementById('proj-saved-flash');
  if(fl){ fl.style.opacity='1'; setTimeout(()=>{ fl.style.opacity='0'; },1800); }
}

// Загрузить проект по ID
function projLoad(id){
  try{
    const raw = localStorage.getItem(PROJ_STORE_PREFIX + id);
    if(!raw) return false;
    const snap = JSON.parse(raw);
    projRestore(snap);
    activeProjectId = id;
    projUnsaved = false;
    // Заполнить meta strip
    const m = snap.meta||{};
    const ni = document.getElementById('proj-name-inp');   if(ni) ni.value = m.name||'';
    const ci = document.getElementById('proj-client-inp'); if(ci) ci.value = m.client||'';
    const di = document.getElementById('proj-date-inp');   if(di) di.value = m.date||'';
    return true;
  }catch(e){ console.error('projLoad error',e); return false; }
}

// Удалить проект
function projDelete(id){
  let idx = projGetIndex();
  idx = idx.filter(p => p.id !== id);
  projSetIndex(idx);
  try{ localStorage.removeItem(PROJ_STORE_PREFIX + id); }catch(e){}

  // Если удалили текущий — переключаемся на первый оставшийся или создаём новый
  if(id === activeProjectId){
    if(idx.length > 0) projSwitchTo(idx[0].id);
    else projNew();
  }
}

// Дублировать проект
function projDuplicate(id){
  try{
    const raw = localStorage.getItem(PROJ_STORE_PREFIX + id);
    if(!raw) return;
    const snap = JSON.parse(raw);
    const newId = projGenId();
    snap.meta.name = (snap.meta.name||'Проект') + ' (копия)';
    const idx = projGetIndex();
    idx.unshift({ id:newId, name:snap.meta.name, client:snap.meta.client||'', date:snap.meta.date||'', savedAt:new Date().toISOString() });
    projSetIndex(idx);
    localStorage.setItem(PROJ_STORE_PREFIX + newId, JSON.stringify(snap));
    projSwitchTo(newId);
    projModalOpen();
  }catch(e){ console.error('projDuplicate error',e); }
}

// Переключиться на проект
function projSwitchTo(id){
  // Автосохранить текущий если есть изменения
  if(projUnsaved && activeProjectId) projSave();

  const ok = projLoad(id);
  if(!ok) return;

  renderPanel();
  render3D();
  updateStats();
  renderMatCards();
  updateMaterials();
  projRenderTabs();
  projModalClose();
}

// Создать новый проект
function projNew(){
  // Сохранить текущий
  if(projUnsaved && activeProjectId) projSave();

  const newId = projGenId();
  activeProjectId = newId;
  projUnsaved = false;

  // Сброс state
  secId = 0;
  sections = [];
  matChoice = { ldspName:'', ldspPrice:0, mdfType:'plenka', mdfName:'', mdfPrice:0,
    hingeBrand:'En-7', slideBrand:'En-7', slideType:'Телескоп' };

  // Мета по умолчанию
  const today = new Date().toISOString().split('T')[0];
  const ni = document.getElementById('proj-name-inp');   if(ni) ni.value = 'Новый проект';
  const ci = document.getElementById('proj-client-inp'); if(ci) ci.value = '';
  const di = document.getElementById('proj-date-inp');   if(di) di.value = today;

  addSection();         // добавляет первую секцию, рендерит панель и 3D
  renderMatCards();
  projRenderTabs();
  // Сразу сохраняем чтобы появился в индексе
  projSave();
}

// Пометить как несохранённый (вызывается из всех функций-мутаторов)
function projMarkUnsaved(){
  if(!projUnsaved){
    projUnsaved = true;
    projRenderTabs();
  }
  // Автосохранение с задержкой 4 секунды
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(()=>{ if(projUnsaved && activeProjectId) projSave(); }, 4000);
}

// Render tabs
function projRenderTabs(){
  const idx   = projGetIndex();
  const tabsEl = document.getElementById('proj-tabs');
  if(!tabsEl) return;

  tabsEl.innerHTML = idx.map(p => {
    const isActive = p.id === activeProjectId;
    const isDirty  = isActive && projUnsaved;
    return `<button class="proj-tab${isActive?' active':''}${isDirty?' unsaved':''}"
        onclick="projSwitchTo('${p.id}')" title="${p.name}${p.client?' — '+p.client:''}">
      <span class="proj-dot" title="Несохранённые изменения"></span>
      <span class="proj-name-text">${p.name||'Без названия'}</span>
      <button class="proj-close" onclick="event.stopPropagation();projDelete('${p.id}')" title="Закрыть">&times;</button>
    </button>`;
  }).join('');
}

// Modal
function projModalOpen(){
  const idx = projGetIndex();
  const mc  = document.getElementById('proj-modal-content');
  if(!mc) return;

  if(!idx.length){
    mc.innerHTML = '<p class="proj-empty">Нет сохранённых проектов</p>';
  } else {
    const rows = idx.map(p => {
      const savedAt = p.savedAt ? new Date(p.savedAt).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
      const isActive = p.id === activeProjectId;
      return `<tr>
        <td><b>${p.name||'Без названия'}</b>${isActive?'<span style="margin-left:6px;font-size:10px;background:#e8f5e9;color:#1a7a3a;padding:1px 6px;border-radius:4px">открыт</span>':''}<br>
          <span style="font-size:11px;color:#888">${p.client||'—'}</span></td>
        <td style="font-size:11px;color:#888">${p.date||'—'}</td>
        <td style="font-size:11px;color:#aaa">${savedAt}</td>
        <td style="text-align:right;white-space:nowrap">
          ${isActive?'':`<button class="proj-open-btn" onclick="projSwitchTo('${p.id}')">Открыть</button>&nbsp;`}
          <button class="proj-dup-btn" onclick="projDuplicate('${p.id}')" title="Дублировать"><i class="ti ti-copy"></i></button>&nbsp;
          <button class="proj-del-btn" onclick="if(confirm('Удалить «${(p.name||'').replace(/'/g,'&apos;')}»?')){projDelete('${p.id}');projModalOpen();}" title="Удалить"><i class="ti ti-trash"></i></button>
        </td>
      </tr>`;
    }).join('');
    mc.innerHTML = `
      <div style="margin-bottom:10px;display:flex;justify-content:flex-end">
        <button onclick="projNew();projModalClose()" style="padding:6px 14px;background:#1a5252;color:#fff;border:none;border-radius:7px;cursor:pointer;font-size:12px;font-weight:700">
          <i class="ti ti-plus"></i> Новый проект
        </button>
      </div>
      <table class="proj-list-table">
        <thead><tr><th>Название / Клиент</th><th>Дата</th><th>Сохранён</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }
  document.getElementById('proj-modal').style.display = 'block';
}
function projModalClose(){ document.getElementById('proj-modal').style.display = 'none'; }

// Вызывается при изменении meta strip
function projMetaChanged(){ projMarkUnsaved(); }

let sections=[], secId=0;

// ── КАТАЛОГ ИЗ GOOGLE SHEETS ──────────────────────────────
let catalog={
  ldsp:[],        // [{name, price}] — декоры ЛДСП
  hdf: 0,         // цена листа ХДФ
  edgeThin: 0,    // кромка 0.4мм за пм
  facadePlenka:[], // [{name, price}] — МДФ Плёнка (цена за м²)
  facadeKraska:[], // [{name, price}] — МДФ Краска (цена за м²)
  loaded: false
};
// Активный выбор материалов на проект
let matChoice={
  ldspName:'',      // название декора ЛДСП
  ldspPrice:0,
  mdfType:'plenka', // 'plenka' | 'kraska'
  mdfName:'',
  mdfPrice:0,
  hingeBrand:'En-7',
  slideBrand:'En-7',
  slideType:'Телескоп',
};

function saveCatalog(){
  try{ localStorage.setItem('wc_catalog',JSON.stringify({catalog,matChoice})); }catch(e){}
}
function loadCatalog(){
  try{
    const s=localStorage.getItem('wc_catalog');
    if(s){const d=JSON.parse(s);
      if(d.catalog) Object.assign(catalog,d.catalog);
      if(d.matChoice) Object.assign(matChoice,d.matChoice);
    }
  }catch(e){}
}

// Прайс петель [{brand,price}] — один бренд активен
let hingeCatalog=[
  {brand:'En-7',  price:320},
  {brand:'GTV',   price:670},
];
let activehingeBrand='En-7';

// Прайс телескопов [{brand,type,length,price}]
let slideCatalog=[
  {brand:'En-7',   type:'Телескоп',  length:200, price:1800},
  {brand:'En-7',   type:'Телескоп',  length:250, price:1670},
  {brand:'En-7',   type:'Телескоп',  length:300, price:2100},
  {brand:'En-7',   type:'Телескоп',  length:350, price:2130},
  {brand:'En-7',   type:'Телескоп',  length:400, price:2270},
  {brand:'En-7',   type:'Телескоп',  length:450, price:2400},
  {brand:'En-7',   type:'Телескоп',  length:500, price:2500},
  {brand:'GTV',    type:'Телескоп',  length:300, price:8000},
  {brand:'GTV',    type:'Телескоп',  length:350, price:8000},
  {brand:'GTV',    type:'Телескоп',  length:400, price:8000},
  {brand:'GTV',    type:'Телескоп',  length:450, price:8000},
  {brand:'GTV',    type:'Телескоп',  length:500, price:8000},
  {brand:'Boyard', type:'Push-open', length:300, price:5780},
  {brand:'Boyard', type:'Push-open', length:350, price:5250},
  {brand:'Boyard', type:'Push-open', length:550, price:6300},
];
// активный бренд/тип телескопов на проект
let activeSlide={brand:'En-7', type:'Телескоп'};

function saveHardware(){
  try{
    localStorage.setItem('wc_hw',JSON.stringify({hingeCatalog,activehingeBrand,slideCatalog,activeSlide}));
  }catch(e){}
}
function loadHardware(){
  try{
    const s=localStorage.getItem('wc_hw');
    if(s){const d=JSON.parse(s);
      if(d.hingeCatalog) hingeCatalog=d.hingeCatalog;
      if(d.activehingeBrand) activehingeBrand=d.activehingeBrand;
      if(d.slideCatalog) slideCatalog=d.slideCatalog;
      if(d.activeSlide) activeSlide=d.activeSlide;
    }
  }catch(e){}
}

// подобрать телескоп по ГЛУБИНЕ секции (не ширине!)
function pickSlide(sectionDepth){
  // Телескоп = глубина секции минус ~100мм (зазор спереди и сзади)
  const maxLen = sectionDepth - 100;
  const matches=slideCatalog
    .filter(s=>s.brand===activeSlide.brand && s.type===activeSlide.type && s.length<=maxLen)
    .sort((a,b)=>b.length-a.length);
  return matches[0]||null;
}
// цена активной петли
function hingePrice(){
  const h=hingeCatalog.find(h=>h.brand===activehingeBrand);
  return h?h.price:0;
}

// Prices — фиксированные цены (не из каталога)
let prices={
  edgeThick: 280,  // ПВХ 2мм — за 1 пм (видимые торцы)
  mdfWaste: 12,    // % отхода МДФ
  handle: 800,     // 1 ручка
  rod: 2000,       // 1 штанга
  leg: 500,        // 1 ножка
  gsUrl: 'https://script.google.com/macros/s/AKfycbxONvblIcQPE-SaLhTqS-uWjtQXZY4pRvDMsCAfbBeXy7EC6ITXJdKzEVvL7ryR2wHo8g/exec',
  // Работы
  workCut:      0,  // раскрой — за лист ЛДСП
  workEdge:     0,  // кромкование — за пм
  workAssembly: 0,  // сборка — за секцию
  workInstall:  0,  // установка — за проект
  workFacade:   0,  // установка фасадов — за дверь
  workDrawer:   0,  // установка ящиков — за ящик
};

function loadPrices(){
  try{
    const s=localStorage.getItem('wc_prices');
    if(s) Object.assign(prices,JSON.parse(s));
  }catch(e){}
  const el=document.getElementById('p-edge-thick');
  if(el) el.value=prices.edgeThick;
  const mw=document.getElementById('p-mdf-waste');
  if(mw) mw.value=prices.mdfWaste;
  const ph=document.getElementById('p-handle');
  if(ph) ph.value=prices.handle;
  const pr=document.getElementById('p-rod');
  if(pr) pr.value=prices.rod||2000;
  const pl=document.getElementById('p-leg');
  if(pl) pl.value=prices.leg||500;
  const gu=document.getElementById('gs-url');
  if(!prices.gsUrl) prices.gsUrl='https://script.google.com/macros/s/AKfycbxONvblIcQPE-SaLhTqS-uWjtQXZY4pRvDMsCAfbBeXy7EC6ITXJdKzEVvL7ryR2wHo8g/exec';
  if(gu) gu.value=prices.gsUrl;
  // Работы
  const wf={workCut:'p-work-cut',workEdge:'p-work-edge',workAssembly:'p-work-assembly',
            workInstall:'p-work-install',workFacade:'p-work-facade',workDrawer:'p-work-drawer'};
  Object.entries(wf).forEach(([k,id])=>{const el2=document.getElementById(id);if(el2)el2.value=prices[k]||0;});
}

function savePrices(){
  prices.edgeThick = parseFloat(document.getElementById('p-edge-thick').value)||0;
  prices.mdfWaste  = parseFloat(document.getElementById('p-mdf-waste').value)||0;
  prices.handle    = parseFloat(document.getElementById('p-handle').value)||0;
  prices.rod       = parseFloat(document.getElementById('p-rod')?.value||'2000')||0;
  prices.leg       = parseFloat(document.getElementById('p-leg')?.value||'500')||0;
  prices.gsUrl     = (document.getElementById('gs-url').value||'').trim();
  // Работы
  const wf={workCut:'p-work-cut',workEdge:'p-work-edge',workAssembly:'p-work-assembly',
            workInstall:'p-work-install',workFacade:'p-work-facade',workDrawer:'p-work-drawer'};
  Object.entries(wf).forEach(([k,id])=>{const el=document.getElementById(id);if(el)prices[k]=parseFloat(el.value)||0;});
  try{ localStorage.setItem('wc_prices',JSON.stringify(prices)); }catch(e){}
  updateStats();
}

async function loadFromSheets(){
  const url=(document.getElementById('gs-url')||{}).value||prices.gsUrl||'';
  const st=document.getElementById('gs-status');
  const btn=document.getElementById('gs-load-btn');
  if(!url){ if(st) st.textContent='⚠ URL не задан'; return; }
  if(st) st.textContent='Загружаю каталог...'; 
  if(st) st.style.color='#888';
  if(btn) btn.disabled=true;

  // Пробуем fetch сначала, потом JSONP как fallback
  let d=null;
  try{
    const r=await Promise.race([
      fetch(url),
      new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),8000))
    ]);
    d=await r.json();
  }catch(fetchErr){
    // fetch не сработал — пробуем JSONP
    try{
      d=await new Promise((resolve,reject)=>{
        const cbName='_wc_cb_'+Date.now();
        const script=document.createElement('script');
        const t=setTimeout(()=>{
          cleanup();reject(new Error('JSONP timeout'));
        },10000);
        function cleanup(){
          clearTimeout(t);
          delete window[cbName];
          if(script.parentNode) script.parentNode.removeChild(script);
        }
        window[cbName]=function(data){ cleanup(); resolve(data); };
        const sep=url.includes('?')?'&':'?';
        script.src=url+sep+'callback='+cbName;
        script.onerror=()=>{ cleanup(); reject(new Error('script load error')); };
        document.head.appendChild(script);
      });
    }catch(jsonpErr){
      if(st){ st.textContent='✗ Ошибка: '+jsonpErr.message+'. Проверьте доступ к скрипту (должен быть "Все")'; st.style.color='#c0392b'; }
      if(btn) btn.disabled=false;
      return;
    }
  }

  // Обрабатываем данные
  try{
    if(d.ldsp) catalog.ldsp=d.ldsp;
    if(d.hdf)  catalog.hdf=d.hdf;
    if(d.edgeThin) catalog.edgeThin=d.edgeThin;
    if(d.facadePlenka) catalog.facadePlenka=d.facadePlenka;
    if(d.facadeKraska) catalog.facadeKraska=d.facadeKraska;
    if(d.hingeCatalog&&d.hingeCatalog.length) hingeCatalog=d.hingeCatalog;
    if(d.slideCatalog&&d.slideCatalog.length) slideCatalog=d.slideCatalog;
    catalog.loaded=true;
    if(!matChoice.ldspName&&catalog.ldsp.length){
      matChoice.ldspName=catalog.ldsp[0].name;
      matChoice.ldspPrice=catalog.ldsp[0].price;
    }
    if(!matChoice.mdfName){
      const list=matChoice.mdfType==='plenka'?catalog.facadePlenka:catalog.facadeKraska;
      if(list&&list.length){ matChoice.mdfName=list[0].name; matChoice.mdfPrice=list[0].price; }
    }
    saveCatalog(); saveHardware();
    if(st){ st.textContent='✓ Загружено: '+catalog.ldsp.length+' декоров ЛДСП'; st.style.color='#27ae60'; }
    renderPricesPane(); renderMatCards(); updateStats();
  }catch(e){
    if(st){ st.textContent='✗ Ошибка данных: '+e.message; st.style.color='#c0392b'; }
  }
  if(btn) btn.disabled=false;
}
function syncFromSheets(){ loadFromSheets(); }

/* ============================================================
   SECTION HELPERS
============================================================ */
function mkSection(){
  return{
    id:secId++, width:800, height:2200, depth:600,
    shelves:[], dividers:[],
    hasRod:false, rodHeight:1600,
    facade:{type:'none', material:'ldsp', hasTexture:false},
    facadeDoors:[],
    antresol:{enabled:false, height:400, facade:{type:'none', material:'ldsp'}},
    edgeFront:'2mm', edgeBack:'04mm',
    drawerBlocks:[],
    shelfId:0, divId:0
  };
}

// ── Антресоль ─────────────────────────────────────────────────
function updAntresol(sid,field,val){
  const s=sections.find(x=>x.id===sid);
  if(!s)return;
  if(field==='enabled') s.antresol.enabled=val;
  else if(field==='height') s.antresol.height=parseInt(val)||400;
  else if(field==='facType') s.antresol.facade.type=val;
  else if(field==='facMat') s.antresol.facade.material=val;
  if(field==='enabled') renderPanel();
  render3D(); updateStats(); projMarkUnsaved();
}

// ── Фасад по дверям ───────────────────────────────────────────
function updDoorMat(sid,doorIdx,val){
  const s=sections.find(x=>x.id===sid);
  while(s.facadeDoors.length<=doorIdx) s.facadeDoors.push({material:s.facade.material});
  s.facadeDoors[doorIdx].material=val;
  updateStats(); projMarkUnsaved();
}

// ── Каталог петель ────────────────────────────────────────────
function addHinge(){
  const brand=document.getElementById('new-hinge-brand').value.trim();
  const price=parseFloat(document.getElementById('new-hinge-price').value)||0;
  if(!brand) return;
  hingeCatalog.push({brand,price});
  saveHardware(); renderPricesPane();
}
function removeHinge(i){
  hingeCatalog.splice(i,1);
  if(hingeCatalog.length&&!hingeCatalog.find(h=>h.brand===activehingeBrand))
    activehingeBrand=hingeCatalog[0].brand;
  saveHardware(); renderPricesPane();
}
function setActivehingeBrand(brand){ activehingeBrand=brand; saveHardware(); renderPricesPane(); updateStats(); }

// ── Каталог телескопов ────────────────────────────────────────
function addSlide(){
  const brand=document.getElementById('new-slide-brand').value.trim();
  const type=document.getElementById('new-slide-type').value.trim();
  const length=parseInt(document.getElementById('new-slide-len').value)||0;
  const price=parseFloat(document.getElementById('new-slide-price').value)||0;
  if(!brand||!length) return;
  slideCatalog.push({brand,type,length,price});
  slideCatalog.sort((a,b)=>a.brand.localeCompare(b.brand)||a.length-b.length);
  saveHardware(); renderPricesPane();
}
function removeSlide(i){ slideCatalog.splice(i,1); saveHardware(); renderPricesPane(); updateStats(); }
function setActiveSlide(brand,type){ activeSlide={brand,type}; saveHardware(); renderPricesPane(); updateStats(); }

function updateGlobalFacadeBar(){
  if(!sections.length) return;
  const types=sections.map(s=>s.facade.type);
  const mats=sections.map(s=>s.facade.material);
  const allNone=types.every(t=>t==='none');
  const allLdsp=!allNone&&mats.every(m=>m==='ldsp');
  const allMdf=!allNone&&mats.every(m=>m==='mdf');
  const lb=document.getElementById('gf-ldsp');
  const mb=document.getElementById('gf-mdf');
  const nb=document.getElementById('gf-none');
  if(!lb) return;
  lb.className='gf-btn'+(allLdsp?' active-ldsp':'');
  mb.className='gf-btn'+(allMdf?' active-mdf':'');
  nb.className='gf-btn'+(allNone?' active-none':'');
}

function setAllFacadeMat(mat){
  sections.forEach(s=>{
    if(mat==='none'){
      s.facade.type='none';
      s.antresol.facade.type='none';
    } else {
      if(s.facade.type==='none') s.facade.type='doors2';
      s.facade.material=mat;
      s.facadeDoors=[];
      // антресоль — если включена, тоже меняем материал
      s.antresol.facade.material=mat;
      if(s.antresol.enabled && s.antresol.facade.type==='none')
        s.antresol.facade.type='doors2';
    }
  });
  renderPanel();
  render3D();
  updateStats();
  projMarkUnsaved();
}
function addSection(){ sections.push(mkSection()); renderPanel(); render3D(); projMarkUnsaved(); }
function removeSection(id){ sections=sections.filter(s=>s.id!==id); renderPanel(); render3D(); projMarkUnsaved(); }
function addShelf(sid){
  const s=sections.find(x=>x.id===sid);
  s.shelves.push({id:s.shelfId++, height:Math.round(s.height/2)});
  s.shelves.sort((a,b)=>a.height-b.height);
  renderPanel(); render3D(); projMarkUnsaved();
}
function autoShelves(sid){
  const s=sections.find(x=>x.id===sid);
  const n=parseInt(prompt(`Количество полок для секции (высота ${s.height} мм):`,'3'));
  if(!n||n<1||n>20)return;
  // свободная зона: от дна (T) до крыши (H-T), минус зона ящиков снизу
  const zoneBottom=T;
  const zoneTop=s.height-T;
  const usable=zoneTop-zoneBottom;
  if(usable<100){alert('Недостаточно места для полок');return;}
  const step=Math.round(usable/(n+1));
  s.shelves=[];
  for(let i=1;i<=n;i++){
    s.shelves.push({id:s.shelfId++,height:zoneBottom+step*i});
  }
  // сбрасываем nicheIdx ящиков если ниша больше не существует
  const newNicheCount=n+1; // n полок дают n+1 нишу
  s.drawerBlocks.forEach(db=>{
    if(db.nicheIdx>=newNicheCount) db.nicheIdx=newNicheCount-1;
  });
  renderPanel();render3D(); projMarkUnsaved();
}
function removeShelf(sid,shid){
  sections.find(x=>x.id===sid).shelves=sections.find(x=>x.id===sid).shelves.filter(x=>x.id!==shid);
  renderPanel(); render3D(); projMarkUnsaved();
}
function addDivider(sid){
  const s=sections.find(x=>x.id===sid);
  s.dividers.push({id:s.divId++, pos:Math.round(s.width/2)});
  renderPanel(); render3D(); projMarkUnsaved();
}
function removeDivider(sid,did){
  sections.find(x=>x.id===sid).dividers=sections.find(x=>x.id===sid).dividers.filter(x=>x.id!==did);
  renderPanel(); render3D(); projMarkUnsaved();
}
function upd(sid,field,val){
  sections.find(x=>x.id===sid)[field]=parseInt(val)||0;
  render3D(); updateStats(); projMarkUnsaved();
}
function updShelf(sid,shid,val){
  const _sh=sections.find(x=>x.id===sid)?.shelves.find(x=>x.id===shid); if(_sh) _sh.height=Math.max(0,parseInt(val)||0);
  render3D(); projMarkUnsaved();
}
function updDiv(sid,did,val){
  sections.find(x=>x.id===sid).dividers.find(x=>x.id===did).pos=parseInt(val)||0;
  render3D(); projMarkUnsaved();
}
function updEdge(sid,field,val){
  const s=sections.find(x=>x.id===sid);
  s[field]=val;
  updateStats(); projMarkUnsaved();
}


function toggleRod(sid){
  const s=sections.find(x=>x.id===sid); s.hasRod=!s.hasRod;
  renderPanel(); render3D(); projMarkUnsaved();
}
function addDrawerBlock(sid){
  const s=sections.find(x=>x.id===sid); if(!s)return;
  // ниш = полки+1 (дно→полка1, полка1→полка2, ..., полкаN→крыша)
  const niches=getNiches(s);
  // берём первую нишу без ящиков
  const usedNiches=s.drawerBlocks.map(b=>b.nicheIdx);
  const freeNiche=niches.findIndex((_,i)=>!usedNiches.includes(i));
  s.drawerBlocks.push({nicheIdx:freeNiche>=0?freeNiche:0,count:3});
  renderPanel();render3D(); projMarkUnsaved();
}
function removeDrawerBlock(sid,bi){
  const s=sections.find(x=>x.id===sid);
  s.drawerBlocks.splice(bi,1);
  renderPanel();render3D(); projMarkUnsaved();
}
function updDrawerBlock(sid,bi,field,val){
  const s=sections.find(x=>x.id===sid);
  if(field==='nicheIdx') s.drawerBlocks[bi].nicheIdx=parseInt(val);
  if(field==='count') s.drawerBlocks[bi].count=Math.max(1,parseInt(val)||1);
  renderPanel(); render3D(); updateStats(); projMarkUnsaved();
}
// возвращает массив ниш: [{bottom, top, label}]
function getNiches(s){
  const pts=[T,...s.shelves.map(sh=>sh.height+T),s.height-T];
  const niches=[];
  for(let i=0;i<pts.length-1;i++){
    const bot=pts[i], top=pts[i+1];
    const lbl=i===0?`Дно → Полка 1`
      :i===pts.length-2?`Полка ${i} → Крыша`
      :`Полка ${i} → Полка ${i+1}`;
    niches.push({bottom:bot,top:top,label:lbl});
  }
  return niches;
}

// Колонки секции по перегородкам: [{left, right, width}]
// left/right — координаты относительно внутренней части секции (от T до W-T)
function getColumns(s){
  const W=s.width;
  const divX=[...s.dividers.map(d=>d.pos)].sort((a,b)=>a-b);
  const pts=[T,...divX,W-T];
  const cols=[];
  for(let i=0;i<pts.length-1;i++){
    const left=pts[i];
    const right=pts[i+1];
    const isLast=(i===pts.length-2);
    // left = правый край левой стенки/перегородки (чистое начало пространства)
    // right = начало правой перегородки или левый край правой стенки
    // если не последняя колонка — справа перегородка толщиной T, её не включаем
    const innerWidth=isLast ? right-left : right-left-T;
    cols.push({left, right, width: Math.max(0, innerWidth)});
  }
  return cols;
}
function updFacade(sid,field,val){
  const s=sections.find(x=>x.id===sid);
  if(field==='hasTexture') s.facade.hasTexture=val;
  else s.facade[field]=val;
  if(field==='material') renderPanel();
  render3D(); updateStats(); projMarkUnsaved();
}

/* ============================================================
   TAB SWITCH
============================================================ */
function renderMatCards(){
  // ── ЛДСП ──────────────────────────────────────────────
  const ldspCard=document.getElementById('mat-ldsp-card');
  if(ldspCard){
    if(!catalog.loaded||!catalog.ldsp.length){
      ldspCard.innerHTML='<div class="price-card-title"><span style="color:#c8a96e">■</span> ЛДСП корпус</div>' +
        '<div class="cat-not-loaded">⚠ Загрузите каталог из Google Sheets</div>';
    } else {
      const opts=catalog.ldsp.map(d=>
        '<option value="'+d.name+'" '+(matChoice.ldspName===d.name?'selected':'')+'>'+d.name+(d.price?' — '+(d.price||0).toLocaleString('ru-RU')+' ₸':'')+' </option>'
      ).join('');
      ldspCard.innerHTML='<div class="price-card-title"><span style="color:#c8a96e">■</span> ЛДСП (декор на весь проект)</div>' +
        '<select class="cat-select" onchange="setLdsp(this.value)">'+opts+'</select>' +
        '<div class="cat-price-badge">'+matChoice.ldspPrice.toLocaleString('ru-RU')+' ₸ / лист</div>';
    }
  }

  // ── МДФ ───────────────────────────────────────────────
  const mdfCard=document.getElementById('mat-mdf-card');
  if(mdfCard){
    if(!catalog.loaded){
      mdfCard.innerHTML='<div class="price-card-title"><span style="color:#fff0d4;border:1px solid #ccc">■</span> МДФ фасад</div>' +
        '<div class="cat-not-loaded">⚠ Загрузите каталог из Google Sheets</div>';
    } else {
      const typeOpts=
        '<option value="plenka" '+(matChoice.mdfType==='plenka'?'selected':'')+'>Плёнка</option>'+
        '<option value="kraska" '+(matChoice.mdfType==='kraska'?'selected':'')+'>Краска</option>';
      const list=matChoice.mdfType==='plenka'?catalog.facadePlenka:catalog.facadeKraska;
      const mdfOpts=(list||[]).map(d=>
        '<option value="'+d.name+'" '+(matChoice.mdfName===d.name?'selected':'')+'>'+d.name+' — '+d.price.toLocaleString('ru-RU')+' ₸/м²</option>'
      ).join('');
      mdfCard.innerHTML='<div class="price-card-title"><span style="color:#fff0d4;border:1px solid #ccc">■</span> МДФ фасад</div>' +
        '<div class="fl">Тип</div><select class="cat-select" onchange="setMdfType(this.value)">'+typeOpts+'</select>' +
        '<div class="fl">Марка</div><select class="cat-select" onchange="setMdfName(this.value)">'+mdfOpts+'</select>' +
        '<div class="cat-price-badge">'+matChoice.mdfPrice.toLocaleString('ru-RU')+' ₸ / м²</div>';
    }
  }

  // ── ХДФ ───────────────────────────────────────────────
  const hdfCard=document.getElementById('mat-hdf-card');
  if(hdfCard){
    if(!catalog.loaded){
      hdfCard.innerHTML='<div class="price-card-title"><span style="color:#d4c49a">■</span> ХДФ задняя стенка</div>' +
        '<div class="cat-not-loaded">⚠ Загрузите каталог из Google Sheets</div>';
    } else {
      hdfCard.innerHTML='<div class="price-card-title"><span style="color:#d4c49a">■</span> ХДФ задняя стенка</div>' +
        '<div class="cat-price-badge">'+catalog.hdf.toLocaleString('ru-RU')+' ₸ / лист</div>' +
        '<div style="font-size:10px;color:#888">Кромка 0.4мм: '+catalog.edgeThin+' ₸/пм</div>';
    }
  }
}

function updateMaterials(){
  // Сбрасываем кэш для текущего декора и пересоздаём материалы
  const name = matChoice.ldspName;
  const key = name||'__default__';
  delete _texCache[key];
  // Если это реальная текстура — не удаляем _realTexCache (она переиспользуется),
  // просто принудительно пересоздаём запись в _texCache
  if(ML){ initMaterials(); render3D(); }
}
function setLdsp(name){
  const d=catalog.ldsp.find(x=>x.name===name);
  if(d){ matChoice.ldspName=d.name; matChoice.ldspPrice=d.price; }
  saveCatalog(); renderMatCards(); updateMaterials(); updateStats(); projMarkUnsaved();
}
function setMdfType(type){
  matChoice.mdfType=type;
  const list=type==='plenka'?catalog.facadePlenka:catalog.facadeKraska;
  if(list&&list.length){ matChoice.mdfName=list[0].name; matChoice.mdfPrice=list[0].price; }
  saveCatalog(); renderMatCards(); updateStats(); projMarkUnsaved();
}
function setMdfName(name){
  const list=matChoice.mdfType==='plenka'?catalog.facadePlenka:catalog.facadeKraska;
  const d=(list||[]).find(x=>x.name===name);
  if(d){ matChoice.mdfName=d.name; matChoice.mdfPrice=d.price; }
  saveCatalog(); updateStats(); projMarkUnsaved();
}

function renderPricesPane(){
  // ── Петли ─────────────────────────────────────────────────
  const hc=document.getElementById('hinge-catalog-card');
  if(!hc)return;
  const hRows=hingeCatalog.map((h,i)=>
    `<tr>
      <td><label style="display:flex;align-items:center;gap:5px;cursor:pointer">
        <input type="radio" name="hinge-brand" value="${h.brand}" ${activehingeBrand===h.brand?'checked':''} onchange="setActivehingeBrand('${h.brand}')">
        ${h.brand}
      </label></td>
      <td class="num">${h.price} ₸</td>
      <td><button class="hw-del" onclick="removeHinge(${i})"><i class="ti ti-x"></i></button></td>
    </tr>`
  ).join('');
  hc.innerHTML=`
    <div class="price-card-title"><span style="color:#e67e22">■</span> Петли — выбор бренда</div>
    <table class="hw-table"><thead><tr><th>Бренд</th><th class="num">Цена/шт</th><th></th></tr></thead>
    <tbody>${hRows}</tbody></table>
    <div class="hw-add-row" style="margin-top:8px">
      <input type="text" id="new-hinge-brand" placeholder="Бренд">
      <input type="number" id="new-hinge-price" placeholder="Цена">
      <button onclick="addHinge()"><i class="ti ti-plus"></i> Добавить</button>
    </div>`;

  // ── Телескопы ──────────────────────────────────────────────
  const sc=document.getElementById('slide-catalog-card');
  if(!sc)return;
  // группируем по бренд+тип
  const groups={};
  slideCatalog.forEach(s=>{
    const k=s.brand+'|'+s.type;
    if(!groups[k]) groups[k]={brand:s.brand,type:s.type,items:[]};
    groups[k].items.push(s);
  });
  const gHtml=Object.values(groups).map(g=>{
    const isActive=activeSlide.brand===g.brand&&activeSlide.type===g.type;
    const rows=g.items.map((sl,gi)=>{
      const realIdx=slideCatalog.indexOf(sl);
      return `<tr>
        <td>${sl.length} мм</td>
        <td class="num">${sl.price} ₸</td>
        <td><button class="hw-del" onclick="removeSlide(${realIdx})"><i class="ti ti-x"></i></button></td>
      </tr>`;
    }).join('');
    return `<div style="margin-bottom:10px;border:1px solid ${isActive?'#1a5252':'#e0e0e0'};border-radius:6px;overflow:hidden">
      <div style="background:${isActive?'#1a5252':'#f5f5f5'};padding:6px 10px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:11px;font-weight:700;color:${isActive?'#fff':'#333'}">${g.brand} — ${g.type}</span>
        <button onclick="setActiveSlide('${g.brand}','${g.type}')" style="font-size:10px;padding:2px 8px;border:none;border-radius:4px;cursor:pointer;background:${isActive?'rgba(255,255,255,0.2)':'#1a5252'};color:${isActive?'#fff':'#fff'}">
          ${isActive?'✓ Активен':'Выбрать'}
        </button>
      </div>
      <table class="hw-table"><thead><tr><th>Длина</th><th class="num">Цена/пара</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>`;
  }).join('');
  sc.innerHTML=`
    <div class="price-card-title"><span style="color:#5c6bc0">■</span> Телескопы / направляющие</div>
    ${gHtml}
    <div style="font-size:10px;color:#888;margin-bottom:6px">Добавить позицию:</div>
    <div class="hw-add-row">
      <input type="text" id="new-slide-brand" placeholder="Бренд" style="max-width:70px">
      <select id="new-slide-type" style="flex:1"><option>Телескоп</option><option>Push-open</option><option>Мягкое закрытие</option></select>
      <input type="number" id="new-slide-len" placeholder="мм" style="max-width:55px">
      <input type="number" id="new-slide-price" placeholder="₸" style="max-width:65px">
      <button onclick="addSlide()"><i class="ti ti-plus"></i></button>
    </div>`;
}

function switchTab(tab){
  document.getElementById('pane-constructor').style.display=tab==='constructor'?'':'none';
  document.getElementById('pane-prices').style.display=tab==='prices'?'':'none';
  document.getElementById('tab-constructor').classList.toggle('active',tab==='constructor');
  document.getElementById('tab-prices').classList.toggle('active',tab==='prices');
  if(tab==='prices'){ renderPricesPane(); renderMatCards(); }
}

let clientMode = false;
function toggleClientMode(){
  clientMode = !clientMode;
  const btn = document.getElementById('client-mode-btn');
  const tp  = document.getElementById('tab-prices');
  if(btn){
    btn.classList.toggle('active', clientMode);
    btn.title = clientMode ? 'Режим менеджера — показать цены' : 'Режим клиента — скрыть цены';
    btn.innerHTML = clientMode ? '<i class="ti ti-eye-off"></i>' : '<i class="ti ti-eye"></i>';
  }
  if(tp) tp.style.display = clientMode ? 'none' : '';
  if(clientMode) switchTab('constructor');
}
window.toggleClientMode = toggleClientMode;


/* ============================================================
   ШАБЛОНЫ СЕКЦИЙ — только пользовательские, с SVG превью
============================================================ */

// ── SVG-превью наполнения секции ─────────────────────────────
function drawSectionSvg(data, W=72, H=100){
  const {shelves=[], hasRod=false, rodHeight=1320, drawerBlocks=[], height=2200} = data;
  const T=4;
  const scaleY = (H - T*2) / height;

  let items = '';
  // Корпус
  items += `<rect x="0" y="0" width="${W}" height="${H}" rx="3" fill="#f8f8f8" stroke="#ccc" stroke-width="1"/>`;
  items += `<rect x="0" y="0" width="${T}" height="${H}" fill="#d0c8b8"/>`;
  items += `<rect x="${W-T}" y="0" width="${T}" height="${H}" fill="#d0c8b8"/>`;
  items += `<rect x="0" y="0" width="${W}" height="${T}" fill="#d0c8b8"/>`;
  items += `<rect x="0" y="${H-T}" width="${W}" height="${T}" fill="#d0c8b8"/>`;

  // Полки
  shelves.forEach(sh => {
    const y = H - T - Math.round(sh.height * scaleY) - 2;
    items += `<rect x="${T}" y="${y}" width="${W-T*2}" height="3" rx="1" fill="#b8a898"/>`;
  });

  // Ящики
  drawerBlocks.forEach(db => {
    const zoneH = H - T*2;
    const dh = Math.floor(zoneH / (db.count + 1));
    for(let i=0; i<db.count; i++){
      const dy = (H - T) - dh*(i+1);
      items += `<rect x="${T+2}" y="${dy}" width="${W-T*2-4}" height="${dh-2}" rx="2" fill="#dbe8ff" stroke="#7a9fd4" stroke-width="0.5"/>`;
      const mw=10, mx=(W-mw)/2;
      items += `<rect x="${mx}" y="${dy+dh/2-1.5}" width="${mw}" height="3" rx="1.5" fill="#7a9fd4"/>`;
    }
  });

  // Штанга
  if(hasRod){
    const ry = H - T - Math.round(rodHeight * scaleY) - 1;
    items += `<line x1="${T+4}" y1="${ry}" x2="${W-T-4}" y2="${ry}" stroke="#88888888" stroke-width="2.5"/>`;
    items += `<circle cx="${T+6}" cy="${ry}" r="2.5" fill="#999"/>`;
    items += `<circle cx="${W-T-6}" cy="${ry}" r="2.5" fill="#999"/>`;
    const nH=3;
    for(let i=0;i<nH;i++){
      const hx = T+8 + i*((W-T*2-16)/(nH-1||1));
      items += `<path d="M${hx},${ry} Q${hx},${ry+7} ${hx-5},${ry+9} M${hx},${ry} Q${hx},${ry+7} ${hx+5},${ry+9}" stroke="#bbb" stroke-width="1" fill="none"/>`;
    }
  }

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${items}</svg>`;
}

// ── Встроенные шаблоны — пусто, только пользовательские ──────
const BUILT_IN_TEMPLATES = [];

// ── Пользовательские шаблоны (localStorage) ──────────────────
function loadUserTemplates(){
  try{ return JSON.parse(localStorage.getItem('mebeloff_sec_templates')||'[]'); }
  catch(e){ return []; }
}
function saveUserTemplates(arr){
  localStorage.setItem('mebeloff_sec_templates',JSON.stringify(arr));
}

function applyTemplate(sid,tplId){
  const s=sections.find(x=>x.id===sid); if(!s)return;
  const tpl=BUILT_IN_TEMPLATES.find(t=>t.id===tplId); if(!tpl)return;
  tpl.apply(s);
  renderPanel(); render3D(); projMarkUnsaved();
}
function applyUserTemplate(sid,tplId){
  const s=sections.find(x=>x.id===sid); if(!s)return;
  const tpl=loadUserTemplates().find(t=>t.id===tplId); if(!tpl||!tpl.data)return;
  s.shelves=tpl.data.shelves.map(sh=>({id:s.shelfId++,height:sh.height}));
  s.hasRod=tpl.data.hasRod;
  s.rodHeight=tpl.data.rodHeight||Math.round(s.height*.6);
  s.drawerBlocks=tpl.data.drawerBlocks.map(db=>({...db}));
  renderPanel(); render3D(); projMarkUnsaved();
}
function saveAsTemplate(sid){
  const s=sections.find(x=>x.id===sid); if(!s)return;
  const name=prompt('Название шаблона:','Мой шаблон'); if(!name)return;
  const arr=loadUserTemplates();
  arr.push({ id:'utpl_'+Date.now(), name, isUser:true,
    data:{ shelves:s.shelves.map(sh=>({height:sh.height})),
           hasRod:s.hasRod, rodHeight:s.rodHeight, height:s.height,
           drawerBlocks:s.drawerBlocks.map(db=>({nicheIdx:db.nicheIdx,count:db.count})) }});
  saveUserTemplates(arr);
  renderPanel();
}
function deleteUserTemplate(tplId){
  if(!confirm('Удалить шаблон?'))return;
  saveUserTemplates(loadUserTemplates().filter(t=>t.id!==tplId));
  renderPanel();
}

// ── HTML блок шаблонов для секции ────────────────────────────
function renderTemplateBar(sid){
  const userTpls = loadUserTemplates();

  const userBtns = userTpls.map(t=>{
    const svg = drawSectionSvg(t.data || {shelves:[],hasRod:false,drawerBlocks:[],height:2200});
    return `<div style="position:relative;display:inline-flex;flex-direction:column;align-items:center">
      <button onclick="applyUserTemplate(${sid},'${t.id}')" title="Применить: ${t.name}"
        style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:6px 6px 5px;
               border:1.5px solid #c8b400;border-radius:10px;background:#fffbe6;cursor:pointer;
               min-width:60px;flex-shrink:0;transition:.15s;box-shadow:0 1px 4px #e8b91e22"
        onmouseover="this.style.borderColor='#e8b91e';this.style.boxShadow='0 3px 10px #e8b91e44'"
        onmouseout="this.style.borderColor='#c8b400';this.style.boxShadow='0 1px 4px #e8b91e22'">
        ${svg}
        <span style="font-size:9px;color:#7a5c00;font-weight:600;white-space:nowrap;max-width:64px;
                     overflow:hidden;text-overflow:ellipsis;text-align:center;line-height:1.3">${t.name}</span>
      </button>
      <button onclick="deleteUserTemplate('${t.id}')" title="Удалить шаблон"
        style="position:absolute;top:-6px;right:-6px;width:17px;height:17px;border-radius:50%;
               background:#e74c3c;color:#fff;border:2px solid #fff;cursor:pointer;font-size:9px;
               display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px #0003">✕</button>
    </div>`;
  }).join('');

  // Кнопка "Сохранить" — всегда есть
  const saveBtn = `<button onclick="saveAsTemplate(${sid})" title="Сохранить текущее наполнение как шаблон"
    style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;
           padding:6px;border:1.5px dashed #c8b400;border-radius:10px;background:#fffbe6;
           cursor:pointer;min-width:60px;height:${100+4+9+4}px;flex-shrink:0;transition:.15s"
    onmouseover="this.style.background='#fff8d6';this.style.borderColor='#e8b91e'"
    onmouseout="this.style.background='#fffbe6';this.style.borderColor='#c8b400'">
    <span style="font-size:26px;line-height:1">💾</span>
    <span style="font-size:9px;color:#7a5c00;font-weight:600;white-space:nowrap">Сохранить</span>
  </button>`;

  const empty = userTpls.length === 0
    ? `<div style="font-size:11px;color:#bbb;padding:8px 4px;align-self:center">
         Нет шаблонов — настройте секцию и нажмите 💾
       </div>`
    : '';

  return `<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:flex-start">
    ${userBtns}${empty}${saveBtn}
  </div>`;
}
/* ============================================================
   КОНЕЦ ШАБЛОНОВ
============================================================ */
/* ============================================================
   RENDER PANEL
============================================================ */
function renderPanel(){
  const cont=document.getElementById('sections-container');
  cont.innerHTML='';
  sections.forEach((s,idx)=>{
    const showTex=s.facade.material==='ldsp';
    const div=document.createElement('div');
    div.className='sec-card';

    const delBtn=sections.length>1
      ?`<button class="delbtn" onclick="removeSection(${s.id})"><i class="ti ti-trash"></i></button>`
      :'';
    const shelvesHtml=s.shelves.map(sh=>
      `<div class="irow">
        <span class="hint">от пола</span>
        <input type="number" value="${sh.height}" onchange="updShelf(${s.id},${sh.id},this.value)">
        <span class="hint">мм</span>
        <button class="ibtn" onclick="removeShelf(${s.id},${sh.id})"><i class="ti ti-x"></i></button>
      </div>`
    ).join('');
    const divsHtml=s.dividers.map(d=>
      `<div class="irow">
        <span class="hint">от лев.</span>
        <input type="number" value="${d.pos}" onchange="updDiv(${s.id},${d.id},this.value)">
        <span class="hint">мм</span>
        <button class="ibtn" onclick="removeDivider(${s.id},${d.id})"><i class="ti ti-x"></i></button>
      </div>`
    ).join('');
    const rodHtml=s.hasRod
      ?`<div class="irow" style="margin-bottom:8px">
          <span class="hint">высота</span>
          <input type="number" value="${s.rodHeight}" onchange="upd(${s.id},'rodHeight',this.value)" style="max-width:80px">
          <span class="hint">мм</span>
        </div>`
      :'';
    const texHtml=(s.facade.type!=='none'&&showTex)
      ?`<label class="chkrow" style="margin-bottom:4px">
          <input type="checkbox" ${s.facade.hasTexture?'checked':''} onchange="updFacade(${s.id},'hasTexture',this.checked)">
          Текстура (↕ только по длине)
          <span class="badge-tex badge-grain">волокно</span>
        </label>`
      :'';

    const niches=getNiches(s);
    const cols=getColumns(s);
    const colCount=cols.length;
    const drawerBlocksHtml=s.drawerBlocks.map((db,bi)=>{
      const nicheH=niches[db.nicheIdx]?niches[db.nicheIdx].top-niches[db.nicheIdx].bottom:0;
      const drawerH=db.count>0?Math.floor((nicheH-(db.count+1)*4)/db.count):0;
      const totalDrawers=db.count*colCount;
      const nicheOpts=niches.map((n,ni)=>
        `<option value="${ni}" ${db.nicheIdx===ni?'selected':''}>${n.label} (${Math.round(n.top-n.bottom)} мм)</option>`
      ).join('');
      const colInfo=colCount>1
        ?`<div style="font-size:10px;color:#1a5252;background:#e8f5e9;border-radius:4px;padding:3px 6px;margin-bottom:6px">` +
          `<i class="ti ti-layout-columns"></i> ${colCount} колонки × ${db.count} ящ. = <b>${totalDrawers} ящиков</b></div>`
        :'';
      return `<div style="background:#f0f4ff;border:1px solid #c5d3f5;border-radius:6px;padding:8px;margin-bottom:6px">` +
        `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">` +
          `<span style="font-size:11px;font-weight:700;color:#1a3a8a">Блок ящиков ${bi+1}</span>` +
          `<button class="ibtn" onclick="removeDrawerBlock(${s.id},${bi})" style="color:#c0392b"><i class="ti ti-trash"></i></button>` +
        `</div>` +
        colInfo +
        `<div class="fl">Ниша</div>` +
        `<select style="width:100%;margin-bottom:6px;font-size:11px" onchange="updDrawerBlock(${s.id},${bi},'nicheIdx',this.value)">${nicheOpts}</select>` +
        `<div class="g2">` +
          `<div><div class="fl">Ящиков в колонке</div><input type="number" value="${db.count}" min="1" max="10" onchange="updDrawerBlock(${s.id},${bi},'count',this.value)"></div>` +
          `<div><div class="fl">Высота ящика</div><div style="font-size:12px;padding:5px 6px;background:#e8f0fe;border-radius:6px;color:#1a3a8a;font-weight:600">${drawerH} мм</div></div>` +
        `</div>` +
      `</div>`;
    }).join('');

    // Вспомогательная функция аккордеона — заголовок + тело
    const acc=(id,label,badge,content,openByDefault=false)=>{
      const bid=`acc-${s.id}-${id}`;
      const open=openByDefault;
      return `<div style="border:1px solid #eee;border-radius:7px;margin-bottom:4px;overflow:hidden">
        <div onclick="(function(el){const b=el.nextElementSibling;const arr=el.querySelector('.acc-arr');const open=b.style.display!=='none';b.style.display=open?'none':'';arr.textContent=open?'▶':'▼';})(this)"
          style="display:flex;align-items:center;justify-content:space-between;padding:7px 10px;
                 background:#f7f7f7;cursor:pointer;user-select:none;font-size:12px;font-weight:600;color:#333">
          <span>${label}${badge?` <span style="font-size:10px;font-weight:400;color:#888;margin-left:4px">${badge}</span>`:''}</span>
          <span class="acc-arr" style="font-size:9px;color:#aaa">${open?'▼':'▶'}</span>
        </div>
        <div style="padding:8px 10px;display:${open?'':'none'}">${content}</div>
      </div>`;
    };

    // Бейджи с кол-вом элементов
    const shBadge = s.shelves.length ? `${s.shelves.length} шт` : '';
    const divBadge = s.dividers.length ? `${s.dividers.length} шт` : '';
    const rodBadge = s.hasRod ? '✓' : '';
    const drBadge  = s.drawerBlocks.length ? `${s.drawerBlocks.reduce((a,b)=>a+b.count,0)} шт` : '';
    const facBadge = s.facade.type==='none' ? 'нет' : s.facade.type==='full' ? 'сплошной' : s.facade.type==='doors2' ? '2 дв.' : '3 дв.';

    div.innerHTML=
      `<div class="sec-hdr"><span>Секция ${idx+1}</span>${delBtn}</div>` +
      `<div class="sec-body">` +

      // ── Габариты (всегда открыты) ──
      `<div class="g3" style="margin-bottom:6px">` +
        `<div><div class="fl">Ширина</div><input type="number" value="${s.width}" onchange="upd(${s.id},'width',this.value)"></div>` +
        `<div><div class="fl">Высота</div><input type="number" value="${s.height}" onchange="upd(${s.id},'height',this.value)"></div>` +
        `<div><div class="fl">Глубина</div><input type="number" value="${s.depth}" onchange="upd(${s.id},'depth',this.value)"></div>` +
      `</div>` +

      // ── Шаблоны (по умолчанию открыты) ──
      acc('tpl','📐 Шаблоны наполнения','',renderTemplateBar(s.id),true) +

      // ── Полки ──
      acc('shelves','▤ Полки',shBadge,
        shelvesHtml +
        `<div style="display:flex;gap:5px;margin-top:4px">` +
          `<button class="addbtn" style="margin-bottom:0" onclick="addShelf(${s.id})">+ полка</button>` +
          `<button class="addbtn" style="margin-bottom:0;background:#f0f4ff;color:#1a3a8a;border-color:#c5d3f5;flex-shrink:0;width:auto;padding:4px 10px" onclick="autoShelves(${s.id})">⚡ Авто</button>` +
        `</div>`,
        s.shelves.length>0
      ) +

      // ── Перегородки ──
      acc('divs','⊟ Перегородки',divBadge,
        divsHtml + `<button class="addbtn" onclick="addDivider(${s.id})">+ перегородка</button>`,
        s.dividers.length>0
      ) +

      // ── Штанга ──
      acc('rod','⊢ Штанга',rodBadge,
        `<label class="chkrow" style="margin-bottom:${s.hasRod?'8px':'0'}"><input type="checkbox" ${s.hasRod?'checked':''} onchange="toggleRod(${s.id})"> Штанга для одежды</label>` +
        rodHtml,
        s.hasRod
      ) +


      // ── Ящики ──
      acc('drawers','▦ Ящики',drBadge,
        drawerBlocksHtml + `<button class="addbtn" onclick="addDrawerBlock(${s.id})">+ блок ящиков</button>`,
        s.drawerBlocks.length>0
      ) +

      // ── Фасад ──
      acc('facade','🎨 Фасад',facBadge,
        `<div class="g2" style="margin-bottom:6px">` +
          `<div><div class="fl">Тип</div>` +
          `<select onchange="updFacade(${s.id},'type',this.value)">` +
            `<option value="none" ${s.facade.type==='none'?'selected':''}>Без фасада</option>` +
            `<option value="full" ${s.facade.type==='full'?'selected':''}>Сплошной</option>` +
            `<option value="doors2" ${s.facade.type==='doors2'?'selected':''}>2 двери</option>` +
            `<option value="doors3" ${s.facade.type==='doors3'?'selected':''}>3 двери</option>` +
          `</select></div>` +
          `<div><div class="fl">Материал</div>` +
          `<select onchange="updFacade(${s.id},'material',this.value)">` +
            `<option value="ldsp" ${s.facade.material==='ldsp'?'selected':''}>ЛДСП</option>` +
            `<option value="mdf" ${s.facade.material==='mdf'?'selected':''}>МДФ</option>` +
          `</select></div>` +
        `</div>` + texHtml,
        true
      ) +

      // ── Кромка ──
      acc('edge','📏 Кромка ПВХ','',
        `<div class="g2" style="margin-bottom:0">` +
          `<div><div class="fl">Лицевые торцы</div>` +
          `<select onchange="updEdge(${s.id},'edgeFront',this.value)">` +
            `<option value="2mm" ${s.edgeFront==='2mm'?'selected':''}>2 мм</option>` +
            `<option value="04mm" ${s.edgeFront==='04mm'?'selected':''}>0.4 мм</option>` +
            `<option value="none" ${s.edgeFront==='none'?'selected':''}>Без кромки</option>` +
          `</select></div>` +
          `<div><div class="fl">Скрытые торцы</div>` +
          `<select onchange="updEdge(${s.id},'edgeBack',this.value)">` +
            `<option value="04mm" ${s.edgeBack==='04mm'?'selected':''}>0.4 мм</option>` +
            `<option value="2mm" ${s.edgeBack==='2mm'?'selected':''}>2 мм</option>` +
            `<option value="none" ${s.edgeBack==='none'?'selected':''}>Без кромки</option>` +
          `</select></div>` +
        `</div>`,
        false
      ) +
      `</div>`;

    // ── антресоль секции ──────────────────────────────────────
    const antr=s.antresol;
    const antrDetails=antr.enabled
      ? `<div class="g2" style="margin-bottom:6px">` +
          `<div><div class="fl">Высота, мм</div>` +
            `<input type="number" value="${antr.height}" onchange="updAntresol(${s.id},'height',this.value)">` +
          `</div>` +
          `<div><div class="fl">Ширина (авто)</div>` +
            `<div style="font-size:12px;padding:5px 6px;background:#f5f0e0;border-radius:6px;color:#7a5c2e;font-weight:600">${s.width} мм</div>` +
          `</div>` +
        `</div>` +
        `<div class="g2">` +
          `<div><div class="fl">Фасад</div>` +
            `<select onchange="updAntresol(${s.id},'facType',this.value)">` +
              `<option value="none" ${antr.facade.type==='none'?'selected':''}>Без фасада</option>` +
              `<option value="full" ${antr.facade.type==='full'?'selected':''}>Сплошной</option>` +
              `<option value="doors2" ${antr.facade.type==='doors2'?'selected':''}>2 двери</option>` +
              `<option value="doors3" ${antr.facade.type==='doors3'?'selected':''}>3 двери</option>` +
            `</select></div>` +
          `<div><div class="fl">Материал</div>` +
            `<select onchange="updAntresol(${s.id},'facMat',this.value)">` +
              `<option value="ldsp" ${antr.facade.material==='ldsp'?'selected':''}>ЛДСП</option>` +
              `<option value="mdf" ${antr.facade.material==='mdf'?'selected':''}>МДФ</option>` +
            `</select></div>` +
        `</div>`
      : '';
    const antrDiv=document.createElement('div');
    antrDiv.className='antr-card';
    antrDiv.style.marginTop='8px';
    antrDiv.innerHTML=
      `<div class="antr-card-title"><i class="ti ti-layout-navbar"></i> Антресоль секции</div>` +
      `<label class="chkrow" style="margin-bottom:6px">` +
        `<input type="checkbox" ${antr.enabled?'checked':''} onchange="updAntresol(${s.id},'enabled',this.checked)">` +
        ` Включить антресоль` +
      `</label>` +
      antrDetails;
    div.appendChild(antrDiv);

    // ── фасады по дверям ──────────────────────────────────────
    const doorCount=s.facade.type==='doors3'?3:s.facade.type==='doors2'?2:1;
    if(s.facade.type!=='none'){
      const doorRows=Array.from({length:doorCount},(_,di)=>{
        const curMat=s.facadeDoors[di]?s.facadeDoors[di].material:s.facade.material;
        return `<div class="facade-door-row">
          <span class="dl">Дверь ${di+1}</span>
          <select onchange="updDoorMat(${s.id},${di},this.value)">
            <option value="ldsp" ${curMat==='ldsp'?'selected':''}>ЛДСП</option>
            <option value="mdf" ${curMat==='mdf'?'selected':''}>МДФ</option>
          </select>
        </div>`;
      }).join('');
      const doorDiv=document.createElement('div');
      doorDiv.style.cssText='margin-top:6px;padding:8px;background:#fafafa;border:1px solid #eee;border-radius:6px';
      doorDiv.innerHTML=`<div class="stitle" style="margin-top:0">Материал по дверям</div>${doorRows}`;
      div.appendChild(doorDiv);
    }

    cont.appendChild(div);
  });
  updateStats();
  updateGlobalFacadeBar();
}

/* ============================================================
   THREE.JS
============================================================ */
let renderer,scene,camera;

function initThree(){
  const canvas=document.getElementById('c3d');
  const vp=document.getElementById('viewport');
  renderer=new THREE.WebGLRenderer({canvas,antialias:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.1;

  function resize(){
    const w=vp.clientWidth,h=vp.clientHeight;
    renderer.setSize(w,h,false);
    if(camera){camera.aspect=w/h;camera.updateProjectionMatrix();}
  }
  resize(); new ResizeObserver(resize).observe(vp);

  scene=new THREE.Scene();
  scene.background=new THREE.Color(0xf0ede8);
  scene.fog=new THREE.Fog(0xf0ede8,8000,22000);
  camera=new THREE.PerspectiveCamera(42,vp.clientWidth/vp.clientHeight,1,40000);

  // Освещение
  scene.add(new THREE.AmbientLight(0xfff5e0,0.55));
  const dl=new THREE.DirectionalLight(0xfffaf0,1.1);
  dl.position.set(3000,5000,2000); dl.castShadow=true;
  dl.shadow.mapSize.width=dl.shadow.mapSize.height=2048;
  dl.shadow.camera.near=100; dl.shadow.camera.far=20000;
  dl.shadow.camera.left=dl.shadow.camera.bottom=-5000;
  dl.shadow.camera.right=dl.shadow.camera.top=5000;
  dl.shadow.radius=3; dl.shadow.bias=-0.0002;
  scene.add(dl);
  const dl2=new THREE.DirectionalLight(0xd0e8ff,0.35);
  dl2.position.set(-2000,1500,-1000); scene.add(dl2);
  const dl3=new THREE.DirectionalLight(0xfff0d0,0.2);
  dl3.position.set(0,800,3000); scene.add(dl3);

  // Пол — паркет
  const floorMat=new THREE.MeshStandardMaterial({color:0xc8a878,roughness:0.8,metalness:0.0});
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(30000,30000),floorMat);
  floor.rotation.x=-Math.PI/2; floor.receiveShadow=true; scene.add(floor);

  // Стены (фон комнаты)
  const wallMat=new THREE.MeshStandardMaterial({color:0xede8e0,roughness:1.0,metalness:0.0});
  const wallBack=new THREE.Mesh(new THREE.PlaneGeometry(16000,6000),wallMat);
  wallBack.position.set(0,3000,7000); wallBack.rotation.y=Math.PI; wallBack.receiveShadow=true; scene.add(wallBack);
  const wallLeft=new THREE.Mesh(new THREE.PlaneGeometry(14000,6000),wallMat);
  wallLeft.position.set(-8000,3000,0); wallLeft.rotation.y=Math.PI/2; wallLeft.receiveShadow=true; scene.add(wallLeft);

  // Тонкая сетка пола
  const grid=new THREE.GridHelper(10000,50,0xb0a090,0xccc4b8); grid.position.y=2; grid.material.opacity=0.3; grid.material.transparent=true; scene.add(grid);

  let isDrag=false,lx=0,ly=0,theta=35,phi=25,radius=4500;
  const target=new THREE.Vector3(0,900,0);
  canvas.addEventListener('mousedown',e=>{
    if(!_drag){isDrag=true;lx=e.clientX;ly=e.clientY;}
  });
  window.addEventListener('mouseup',()=>isDrag=false);
  canvas.addEventListener('mousemove',e=>{
    if(!isDrag)return;
    theta-=(e.clientX-lx)*0.4; phi=Math.max(3,Math.min(85,phi-(e.clientY-ly)*0.3));
    lx=e.clientX;ly=e.clientY; cam(); renderDimensions();
  });
  canvas.addEventListener('wheel',e=>{radius=Math.max(800,Math.min(15000,radius+e.deltaY*3));cam();renderDimensions();e.preventDefault();},{passive:false});

  function cam(){
    const tr=theta*Math.PI/180,pr=phi*Math.PI/180;
    camera.position.set(target.x+Math.sin(tr)*Math.cos(pr)*radius,target.y+Math.sin(pr)*radius,target.z+Math.cos(tr)*Math.cos(pr)*radius);
    camera.lookAt(target);
  }
  cam();
  initMaterials();
  (function loop(){requestAnimationFrame(loop);renderer.render(scene,camera);})();

  // ── Drag & Drop полок ──────────────────────────────────────
  initShelfDrag(canvas, vp);
}

/* ============================================================
   SHELF DRAG & DROP
   Логика: клик по полке → drag по Y в мировых координатах
   → обновляем sh.height → renderPanel синхронизирует инпут
============================================================ */
const MAT_HIGHLIGHT = new THREE.MeshStandardMaterial({color:0x4fc3f7, transparent:true, opacity:0.85, roughness:0.5});
const MAT_GHOST     = new THREE.MeshStandardMaterial({color:0x4fc3f7, transparent:true, opacity:0.35, depthWrite:false, roughness:0.5});

let _drag = null; // активный drag-объект

function initShelfDrag(canvas, vp){
  const raycaster = new THREE.Raycaster();
  const mouse     = new THREE.Vector2();

  // Вспомогательная плоскость для отслеживания Y при drag
  const dragPlane = new THREE.Plane();
  const planeHit  = new THREE.Vector3();

  // Подсветка — клон геометрии полки
  let highlightMesh = null;
  let ghostLine     = null;

  function getMouseNDC(e){
    const r = vp.getBoundingClientRect();
    mouse.x =  ((e.clientX-r.left)/r.width )*2-1;
    mouse.y = -((e.clientY-r.top )/r.height)*2+1;
  }

  function pickShelf(e){
    getMouseNDC(e);
    raycaster.setFromCamera(mouse, camera);
    // Перебираем только объекты с userData.drag
    const targets = scene.children.filter(c=>c.userData.drag);
    const hits = raycaster.intersectObjects(targets, false);
    return hits.length ? hits[0] : null;
  }

  function startDrag(hit){
    const mesh = hit.object;
    const ud   = mesh.userData;
    _drag = {
      mesh, ud,
      startY: mesh.position.y,
      startMouseY: hit.point.y,
    };
    // Горизонтальная плоскость на высоте попадания
    dragPlane.setFromNormalAndCoplanarPoint(
      new THREE.Vector3(0,0,1).applyQuaternion(camera.quaternion),
      hit.point
    );
    // Подсветка
    mesh.material = MAT_HIGHLIGHT;
    canvas.style.cursor = 'grab';
    // Ghost-линия на стене
    if(ghostLine) scene.remove(ghostLine);
    const gl = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(ud.sw, T, ud.sd)),
      new THREE.LineBasicMaterial({color:0x0288d1, linewidth:2})
    );
    gl.position.copy(mesh.position);
    gl.userData={w:true};
    scene.add(gl);
    ghostLine = gl;
  }

  function doDrag(e){
    if(!_drag) return;
    getMouseNDC(e);
    raycaster.setFromCamera(mouse, camera);
    if(!raycaster.ray.intersectPlane(dragPlane, planeHit)) return;

    const ud = _drag.ud;
    // Новая Y полки (низ полки)
    let newY = Math.round(planeHit.y - T/2);
    // Ограничения: не ниже дна+T и не выше крыши-2T
    newY = Math.max(ud.minY, Math.min(ud.maxY, newY));
    // Snap to 10mm grid
    newY = Math.round(newY/10)*10;

    _drag.mesh.position.y = newY + T/2;
    if(ghostLine) ghostLine.position.y = newY + T/2;
    canvas.style.cursor = 'grabbing';
  }

  function endDrag(){
    if(!_drag) return;
    const {mesh, ud} = _drag;
    // Финальная позиция
    const newH = Math.round(mesh.position.y - T/2);

    // Обновляем state
    const sec = sections.find(s=>s.id===ud.secId);
    if(sec){
      const sh = sec.shelves.find(x=>x.id===ud.shelfId);
      if(sh){
        sh.height = Math.max(ud.minY, Math.min(ud.maxY, newH));
        // Сортируем полки по высоте
        sec.shelves.sort((a,b)=>a.height-b.height);
        projMarkUnsaved();
      }
    }

    // Убираем подсветку
    mesh.material = ML;
    if(ghostLine){ scene.remove(ghostLine); ghostLine=null; }
    canvas.style.cursor = '';
    _drag = null;

    // Полный перерисов и синхронизация панели
    render3D();
    renderPanel();
  }

  const hint = document.getElementById('drag-hint');
  function showHint(v){ if(hint) hint.classList.toggle('show', v); }

  // Курсор при наведении
  canvas.addEventListener('mousemove', e=>{
    if(_drag){ doDrag(e); return; }
    const hit = pickShelf(e);
    canvas.style.cursor = hit ? 'grab' : '';
    showHint(!!hit);
  });

  canvas.addEventListener('mousedown', e=>{
    if(e.button!==0) return;
    const hit = pickShelf(e);
    if(hit){ e.stopPropagation(); showHint(false); startDrag(hit); }
  });

  canvas.addEventListener('mouseleave', ()=>showHint(false));

  window.addEventListener('mouseup', e=>{
    if(_drag) endDrag();
  });

  // Touch support
  canvas.addEventListener('touchstart', e=>{
    if(e.touches.length!==1) return;
    const t=e.touches[0];
    const fakeE={clientX:t.clientX,clientY:t.clientY,button:0};
    const hit=pickShelf(fakeE);
    if(hit){e.preventDefault();startDrag(hit);}
  },{passive:false});

  canvas.addEventListener('touchmove', e=>{
    if(!_drag||e.touches.length!==1) return;
    e.preventDefault();
    const t=e.touches[0];
    doDrag({clientX:t.clientX,clientY:t.clientY});
  },{passive:false});

  canvas.addEventListener('touchend', e=>{
    if(_drag) endDrag();
  });
}

function clrScene(){ scene.children.filter(c=>c.userData.w).forEach(c=>scene.remove(c)); }

let ML,ML2,MH,MR,MFL,MFM,ME;

/* ============================================================
   ДЕКОР-ТЕКСТУРЫ — процедурная генерация через CanvasTexture
============================================================ */
const DECOR_PROFILES = {
  'Белый':            { base:'#f2f0ec', type:'plain' },
  'Белый Апельсин':   { base:'#f5efe6', type:'plain' },
  'Белый Гладкий':    { base:'#f2f0ec', type:'plain' },
  'Белый Глянец':     { base:'#fafafa', type:'gloss' },
  'Слоновая кость':   { base:'#f0e8d0', type:'plain' },
  'Фрост':            { base:'#e8eef4', type:'plain' },
  'Кашемир':          { base:'#d4c4a8', type:'linen', grain:'#c4b498' },
  'Сатин':            { base:'#c8c0b0', type:'linen', grain:'#b8b0a0' },
  'Бежевый':          { base:'#d4b896', type:'plain' },
  'Сонома':           { base:'#c09060', type:'wood',  grain:'#8a5820', dark:'#6a4010' },
  'Америка Орех':     { base:'#b07840', type:'wood',  grain:'#7a4818', dark:'#5a3008' },
  'ЛДСП':             { base:'#c8a96e', type:'wood',  grain:'#a07840', dark:'#806020' },
  'Темный Дуб Вотан': { base:'#6a4820', type:'wood',  grain:'#4a2808', dark:'#2a1000' },
  'Серый Светлый':    { base:'#c0c0c0', type:'stone', grain:'#b0b0b0' },
  'Серый Камень':     { base:'#909090', type:'stone', grain:'#808080' },
  'Цемент СВ':        { base:'#a8a898', type:'cement',grain:'#989888' },
  'Цемент Тем':       { base:'#707068', type:'cement',grain:'#606058' },
  'Дымчатый Зеленый': { base:'#8aaa8a', type:'plain' },
  'Зеленый темный':   { base:'#507050', type:'plain' },
  'Графит':           { base:'#606060', type:'plain' },
  'Черный':           { base:'#282828', type:'plain' },
};
const _texCache = {};

/* ── Встроенные текстуры Lamarty (base64) ───────────────────── */
const TEX_B64 = {
  sonoma:   'data:image/jpeg;base64,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',
  votan:    'data:image/jpeg;base64,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',
  karia:    'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBAUEBAYFBQUGBgYHCQ4JCQgICRINDQoOFRIWFhUSFBQXGiEcFxgfGRQUHScdHyIjJSUlFhwpLCgkKyEkJST/2wBDAQYGBgkICREJCREkGBQYJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCT/wAARCAIAAgADASIAAhEBAxEB/8QAGgAAAwEBAQEAAAAAAAAAAAAAAgMEAQUABv/EAEQQAAEDAgMEBwYEBAYCAgIDAAEAAhEDIQQSMSJBUWETIzJxobHBM0JicoGRBVLR8BQkNOFDgqKywvFjkhVzJTVT0uL/xAAZAQEBAQEBAQAAAAAAAAAAAAACAQADBAX/xAAdEQEBAQEBAQADAQAAAAAAAAAAAQIxQREDIVFh/9oADAMBAAIRAxEAPwD4cHOABzUlSDhi1U0zkInjCgrOIY4C+UE+K+fHuNwgysIO4eoTKpOnck0CXOdbc7zCpxLS2Yk6eZW9Z4Ek6lY7TE8w0rAetjj+i2rGavv2G+iSGF3WSeG/uCZANOq0ze45/spJMVGiToPJNeQGgcWkKVSS7skjU+ic/wBm081O1pDKW+wVFQkUuMFGrBPbLCNBqgaYzAnT9E512GwmN6ULCpM/fkpGSvIAdbWD4Ln4p3RvETorKjpE62Hko8XFQRNxpddMjoHSB7Q78pv3KrpMzPihQsYRUyHRwhE2sQ0B8scN5S+B9ZiAC8AG8XVpEUgOAUAeatY5RIAAn6roOzXHCFdNkGHaA6oTvKuxL8tEHgCVHQFp4mU7FOLqRaNYhc710i+BTwbGjkscYjkxexLoa1vLRLrOtUj8sIE9fNSHACfspqpmo6B73qqou2P3ZS1WkVI+IpQaFl6DvmI8lj7VoG7L6rabYoA/mcfNL7WLeCbQDH3TgnuM1D3lU4Uyx4UNR21HBxCswEZiJ1EqXiw8Na6sS8bLgCfsk1+jFPYAA5Jj2E1Gn3ct/ohxdNrA3cCIXOdNHVYMzAFTRjKDwkpNW72zcJ9K1LTUKimmI5Eeapr7VN54BSEEuvxHmqnkdFUbxarWibGAPY0c0dA9WIN5/wCIU1R5lpFxIHgn4TbA4HL/ALVmG49aO8+aZTnMNdQhqAtrAX7TrrcOZfroR5qoykctOjyqlMpGHEFKbEN5VimMPWuHM+arDfagwnVrgI8EtroeARuW4o7LgDvBB7lgBFYhFTnAdIy02XqjZi+i85xFSmdUb9BYawgRJcOi13+qkqRlDY3qp5y4eZNiPNRvdtTG8pwahq1MlV2sImv22vEX8whxDRUeCCJ3pbA4Ne2Npu1C6fHNbUcHN2fqow0OxJgyAfRaa4iScp3gr2ELqlbNEAuJV5G7VlXT98FuCAa1nFDUJyEnmm4cZS3eAhTh+JOaqxp95warK/aptChBNTF0eAcCfFVVH5sQORQpRlQyHc3ALCesqHdlKFx7N9Xoi2c0bx+q0aonmxtuKMDM2jwgeSXUHa5NTcuQUwdzfQJiCkT0pj4kQOs8EnDbRqE3hzlubM4cwFUdPDumkw8HLGMpta8VAIBMLMJeg7fCJtPNXfmu3NZc9dOEV8stAEBIa0fxIPAhU12BlYDS8pAPXSRefVaNRvcQ8EfmKHoM9NzoBmQB9D+qNkOc6dAT5rekAAH5QSFkJptNORuyk/cp+JfYkby3zU9N2Zridwy+ITq4EzuLh5KzrMYR0kmf2ELtqpV500wDM6DH25LxbD3XnqlUC4mWuH5QR90b4L2g/mXqgHRUubD5rKjXXPIEFZhPaGuDeE+f90dURTfu5FLquPSSN9/AIqkua4TuQpQy5oB2ss3JLXmHmI3eCZRdOGmdGXQNEh2hB4dyzIHuMX4BLqNaTBHaCbUsSBaEitLXTMgXPJdINLr0yxrYMxcI2PpuZmeJlG7bYBFwgw2HBcZkDUc0hDTvUDsuVp0TWVM+Y8SjqDLTIAiLNHNJwzS2mM3BZjqbTlGXVNcZDZ3lew7dgHetcJLB8Q80acV4oziWt4QhqAlzhGpAW1CHYs8j5BePtR83ogQtXg81JVO20niVUDeeBlR4rsie5WDRN9lSH1SGuIxNQx7o8yqDYM4SPVSkxXqEbwEoNESHVTP5yPBV/h5LakG9lBIL3HfAd9VdhHAVrcVq0dECx+vmoMVXNTEMZBygm6te4Na8xNypqtIU6bS4bRXOOhDr1WpzXBmHZ3BTU/aklUuaDSbwBCQpne0nuTHOMkcWrHQC+95TGZXMLitWLqYcikCQCbFHQ6p2Uxsvy6cGr1WpLHnfYfv7LKDs2Rx1c6fBRhVXQ9uty4r1Ihs8f7rCIqN7iR90TG5tSP2UkKHZcT7tVNEisR8RQkANqb+sCZVEYggcWnwVZjWipVy8Wla29X7eSxoLKrSdzo+ixpIqfb1RqwysYDDwdvTK0tE67SRXJ6OeBTqhmnM2LgiqZ7j/AA2mt1I8y6/FWubNCDBETZROkm3GEolKfTa5xabEaJNWaVUO4W7wmOJbU1m8AoqwFQTHJdIFY51IUwS3M7chpO6PM5wy7wmYfDjJtTI91ZiwTSgdo7uAWb/WgzShNaCDLdEkAimeJVbGw2ylKDw18XSG/wDsmg5sS76peHvjGHgD5JlCHPef3qhSjzQS9vIuKIyGuI1yoad3Hk31Wk7BPEQpGqOtq8cQB4p1Q9Zbc0+iTV9s2dSmOMPv+UpCnwziA+xu8+SGntC2pZIWU3FrT8xnwW0YDp0hxH0SF0sAZpvaeHoqycrcx71F+Hu3clRVvSDQJLoA+y5a66TiPpjVxLiQQAAJ4rGgGqe8DxTsSwUjlAvCThYzX3u9VWHTO3V5PQTNQAbwUVC9Sr8/ktpjrGkjQ2+6tSFUjauD+f1T6lwbDX0WsaG0iT2nPCBzic3H/paMbSkmIXnNAcDa9I+q8zVhPBesazG27BBVQDTNGi6dSQjzFzAeLYW0WN/gmkXLHSjDWh4ZospDwczQJuI8EbBIJ5BC69Vv74pjPZnkjVhdIuFJ43gEIqInMDuMIWkZakH82q2nDXPlRkVaZeN/91NUaRYxdU1mnaPBTOOaeO5dINeoulreIEKikBSaXKWkS55Gl5VGIIDGsb7zhKXwQvqdJWGsd0LGtySJmy8/tAC8BEJc3VZj8O7qo4SiI66mOLh5oMPGTw8U0AfxNAHjKFODpicS87hPmjAJq/f9EumQH1HD93KZSu8H4fVGqx5ytOnBS1bhs73hUVrNvvIU9QgOpCdXSlEoqpDRTA4j1UTif4qDoWz9iqcUcpby/RSvHW0HjeS0nkUoNMY1vSzuhVYX2sADXRTEEkcyFVhI6SPiC1aOlXhuyby8IcfALRwR1gP4qmyN4d4Jf4gNoLlHRzS7K4qh5iiy+rlKRmfHNU1ZDWW0JKQlTL6oO5xTKbgaAJ4HzSiMr3jg8ptG+HmNxK1QLTJqchPgtwvsqPI+iJgs8xBLSmQKbaQGsEn7qKB1y020TGCWnkEmbNi6eNXa3SQFcZBX07YK9UJbUB4sDu9ZVAcMQCYFvRPfTa4USBMsy/v7rMW+ST3goHA9I6JgGfEpwhweeAlJF3v7lKsE9p6J31WyTRHeETj1YPH9EtvsmgHe3VGK0DNhid+VQVQXCI95XCOgcONgoarS0TzSylS1QQDxF05sPnmluvf7rcKc2XNusV0BU1wosAU4PSveDMHeQjquDqzGDshsoZOYuF4Nysz2jTeVYx2Zg+ikeNiTuF1VS7IUpRtEdeZOjSfBMwoOVxPEeSCnHT1uVMoqbstI83FClDKY7R5BBUMNATGaP74Sa1i0b7+ikakkTVZb3ZW1nAVYGmU+ayQcTlmYalYh8VT3R4piRSMvqg7jb6hNotbmfvk6JbWlmKcB7zQfqExo2wOSVGOh+G7T2iysZBr0m8ASpPwuDVZylWUYOKcPyNjxK5a66RNjSDVO+LKOi7rGj4lVjRtu3KXDNzV2RxWiU2jsYh4PvOlMbBra70DgOkzH8y89wZUZG8OPgrWgr9FQA1JcUFQQH8QAfJEbMon5kDp2xraPJaNTmEB7RyCwmKzL7ivSM0wNFsB1ZgvMn7SqjMM+cO9o1y+SYH/zAPH9ErBAdI5nMiEUQ6keBE+SzF1DtjvKc2Qw98pNX2n1On0THAhhAtYWRpR6kXbYgntCAF5rLuvcxvXqJcXOABvOiFrSBHIFZiKjYD1E5wDhMc1bX7J5/wB1BUAkxdPI1ohtYjcUdU9cw6xdLJJeY0hY501GnlCYLXw1kxBjUJM9XKZXeGtudbKeT0cclFUYPsNBB0uqHGMXS5KfBgluYR9U8AuxlK+hv9ijTjGECnUdy/VUUxlA+QKd1qFTuAVW88gAhVhGJMNb3+ijxlTIaRGgfBVmJMFvf+i5uKdn6QD3TmCeRp2OdswNYsltOfDMcBcXlbiJcxrt0JNCtDHUyIAaSEpwfVIcBldrdU4Y9eDzCia7MwC9jZWYT2wtoQjSjr1mTjKVQbmQkY67lS501GHko8c7b3wucNz6Ql8Hc4XVNa7hwki6RQtUaOJ9FTVueYJSEiqf5mo2PeTMJstLHbgkPcf4l3xOB8E9jWtf3hW8Ro9m+NcvqjeCawDdzGpRcA6o3k0Jj56bva1FSyLNPF0H7JzXCXjvSWHs7xm9ExpEmdTPkkgKjo6e+4eifTqDoqcXyuCS9oeK1j2JP2RYfaw79TFx91qwqbvaN4j9Uppmp3j9E0DrzGhafNIaJqDXQWClWKHT0YGtispuc6kNblt4WPkRB3lY0uNEiDAhFXskUiJ4qSqIp85VZENI4SpMRcRzlKJUoILyNxXsOYeRwNkNg8EcVjSZJneukCmsviDvtCdXIa0xaVPQdOJnifRNxD/cm5WYFeTTgb7KzD7W7eoapOXfxVuGBDJEXUvFjQ6Klc/At0Y1vF8eKGm0ufXJ0LPVM96kP/IT5oEcLZuZU9cjpWjl6qkHXvUtYxVvFgpFqbpYx7ODmpWOfDwRqD4Ic8vpPjsuyrcWCSSdCusc6bUIzNeBFolEx2WoO5TNrZ6MOsQQ1Oa7O5p3wosdL8LtWb9VdTZlxVdwtmIPgoPwz2gMcV0mnrXFc9HHPxwlzoSMEB01N3P1TcY4lzggwFqzRa0eazNyy5t9Ste3akxZpXn2d9Z8UWILc7m/AVakZINGl3FBUEVnx+7hY0l1JoGgnzR1R1h03+YWjCmXG0my8xwFVh5nzXi4BwIBQB1mn4vsqg6Oxi3/ADnzQ57/AOb/AJLc0Yt5n3p8Ep5EtG8OPmFmbVM1iCN5TTcA309UiZru5Ep8jIOUhGrA0DD54lHYAb0LYa0WOqNwaGCRFyLrKlxETEzZQ1d6uxZ2nwLW5KGrMukJ5GvWkjxSxIqDvTBckBC2S/cmFOxIL302xYyURaA1o5gLXsJqMj8pRVWbTQTvUUWDbNId/qU2jJxF9x9EOEEUW/VHS9v4eCFOB1pv+ZoVUzKm0pOG/O30VVMSwnmjVieuM1Vo5LnP7bTFnAtK6NbZxF9IHqoKkFjo1a6U4NDh3GpSLCYjZSXEU3ibbLgZRVKn8P1wGy4XhKPXvFRwgBspCdhHF1JkzqCulgoNe3EKTBhvQhxGpJVuFOWpPNHS5dRw6wA+Chxl3mFWXZnypMR7Q5rDVc4aSiCazBG/VU4huU63uk4cRWbwglU1ru+irJaoGeR8Ka1vWHfZLAl7+RCbT9sB9FUBUAaHuMagJzoNYdw8kiuWltTk70TGkvqNO7//ACoxdKWuHf6JoIh1r38kDbOvcCPJa50B0AwUkMpEF728WeiXhnRQf8h8kVFwFZhG8a8kugYpubJ7JCzDpul44wfJKYZdMXC1pmqCPy/8UNE2OugWqnVRAdrv8l6mYY4TFl6oQ4cZ/RaIsIMFqMWtdGnio613HXVXOyh7eYUFYknQ6lWJUh7Td117csOonit1bI4rpAr2GkVRcI3tz4kgjswhw4OfdqqGsJrug7wrUhdYDK6/ulV0mwwEcFNVbOb5VY3sDuCGjgKN21Dy9UbDJon5j5rKN2VO4HxXgYFHkHIkoF7qOvc1Tw/srmt2G93oonx1odvJjwWy1QVQW9IAODwjnp6AM7pWPcIpv3RBSn1jhHZCLONoTjnS6j8jaoAjskBWUDOWdzSoy276jhqYHoulRa1rG2vAVrRb+FiXW5q4AZnE2hQ/h7sjgqxodFxvXSIMTOZxWYBpdXGo0uirxtybhFgYFY6WICrCrMh8TvhTYh3XwT7p81XVIzz8fqpcUIrM5t9VYj2Hh9NtoN5+6abk8581PhXHomkjWSPv/ZUAAuIOoAKyBcBO8wCUBswGdHafRMDYzWJsV54HR9zh5KsB5OcP0Jb5IHCKjRxf+iKt7OmeBIWVHTiGx+ab9yrBmaz9Tco2PDmmCdUFK754kyvMZkqReDojVh8iAAbgor5BJJufNLaQ0GQNU5rQTA4zCiosU6HPtFlHUJLjvCuxRJe4Re6hrSwOEJ5GjpxfjAWU2gVXdy9RG1zhawB1UkXsJ70gVVRDxu2Sjc2XA66L1fZeydIKYCNkAcFCLw1qQHCfNHRvX+6CkMtTLOpJRUPankD5o0ox16dQ/E0qik7YHefNIddlQc2pzQRTb3okRXaXV3cNkea59aWVJmA8eIXRdesfmHkpq1JlRpLuyd3BOBUNZwMUjMOghblDaTY94ELWNLqwY+7mn7jim1QQyn+9xSE+jDMO0HUsOv0CspN6zWLJJaQym2PdA8VRTEVLnehSiunePopcRcA96qpE/SFLXacs8EIZOHjpWz+VUVTBB35VPRb1rDwVFYRIOuVWoW1vWubNj/2iA6zXdKGld8kXCMkZhrcFZEVV5mrxB0+ipZBGYCLA/wClTYqGVK/Ip9ImzSINgqg7TGn/AEgcBc9wmUYaHNJBvJHkvNbAgj3gqxc5XMIM29V4CKrmxGZ2neEVWIYQd3qscYxTHcQCsxdMxUE7qc+CCk6Gk33LWu2nngwhbTbLS06QFqxjHBzW3KMmYh3upNFuWWm8JtMthrSBwRIe9tibDyUNZ1+F/wBV0Wi0i8DjyXPqy4/X9VYlSXJnmExoBYQEqoSCGxvTaey13LeukAWEaM3GXFUi1Y3IuPJIwjR0gI0LiqHQK5B5LVoGqzYeDwKe07E8l522CAIsUun2Hjg1GlB0OxUPIIHWZSPzDzR0Ow88wELrsp/5kSVNNgFC9pl55uPirXWcFKNCSJgE+K2UrnO6t5Y4mM0xySarhUdld2qc9xCtxFAFuu1q08OSmogPzPPaiCOBldJ/Qv8AHqjQ12QcQfFdEbLmsjeBfuUrmk4lojh5q4gmvcbyVKsNw4ynXQj6qs2Y4jgVLQG6b2VVzScud6cRYnU80WDgVDxzAocQ3ed63BMPTTe5Hmsw3Xc8Rv8AVTYntMPL9VVG29TOaH0ydcsrRA4QTTYOAAv3p2955eqXgycgkjtAT9SmtGw493qqj0xItEb0OaaThacw3LQAXFs7v0XnCG1Z3FVi6/sWX98+SFxHSFxN7nwWVb0jyd6FC6SZ4SD9gqzaUP36E+aZUINZrBulKwoh0cU4t6wOtMwjVjIkO4hNaSCSYOiUDepYRATGmSSOAUVNWJOYwd6irkk+KtryQ7vKjImoCe7wTyNeaSMpG6xT6IDXAb/NIaNL71VhMpe0G5mUqJuLO0y/FG03aSOCDFw6s1o3NRhpEDfAUULRNbNwB81tAy+oeR80TRqd69hwCXfKfNGlAySHji5pTmk5WjgEg2cR8vmntmB3foiSerOd8H3hp8qGnTFSlfeCjeBnfOmb/ilUKkVRTNwSYKcCpujy4psi4EFOcyWM+WUzE08uJz7jdFTAdUYwn3QrakODszw0DswiYdocSgsatSJIEiUYZtEg2GiFKLKPZScTstT6UCne6nxegA1MoETQO20776plYyXCdyXQBzt70eJHWOa3W3mqjBaY5Lxu2eErPfI5hE6OideNVURYwS+prf8AVU0pMuPMpOIbmpdILZgLp1N00hzaT5Ko1oGUfMfRaXbJ0sfqvEQ1o4k+YWUwHbxY+irMc7MymLCxQVDGIp/KI+5RuHUsPMhJf2qTh+7qsElrWOM3gJlFocQZP7CS4bBjQgJ2GGyRpAlStGB2eq4jdCMDskWusa0NJNriV5hhotbOiRklrDaTB0UdWReN6rB2Du19VJWmAf3qrEqN5Jfe8FMaCSQIhwQxJdeJuibqCDuXSBVWFIzgDvR1XfzJvwW4LK46DSEL4qYhxEaqKcCATaLFAwZRUdrMeSIggnkSvOEUypVj1D2LjxcsElrBwzeaOmOpdH5vRA07QHBzvRElE5nH6KFxPRiDu9VaNfsoyAKQm2z6q5SifRD6YiSbEKOk0Z6sWmCrMHUzuLCLtASuiNOq4c/VIRNZ/MNcdzrqlrsxc8d1+9BQyuqvJOhJ8FtCC2TOoM+KKm0ztGFaJyKKm0gzKukBgGqFKIsUSDZFgj1oI5IcX24HJFgQTWbI4LeM83aqPbxKEta0uaIEgnxQh8VX2vM+KUauWu8OMAiR/wCxCvxCcG43bP8AiafVXMaBRceY9VDhR0dUNdAJe1dKIoACJJ9EqhDGOFVwG4b96yq4A1G2juTRIqVC4CwKRUG28yIAlZk5d1NThmHkUUAsfxBKU4TTIt2gLJk5Q4HffxKrPUZDxw3J7m9brvNlPTjO3W4mE+oAHTJ4hGrBgCKkj3dQvD2hvNgbrKdw8WOxpKKoAKjCPyqKnqzMEjVRPs8yrK52jyJCiqAkuPO6UGhpnYk6SrsC2ZcufTGYObwXUwTQxkHhKdGBcOkq1HawYVOXJE7zCDDtloM6nMU2sZgjkVChDTYATdDhiRUNrCn6o6QBYD3raUdbuOUI1YW4yR9PNUNIEd36JDgIZPLzTZhw+VFSn3qO+f0CmpjM9jhba8ZKocMxcQSCHnyCVlh1Ii4ztCcGqMWw9I7gIQYYZsRm4WTajg4gfmuhpWzHfBhRh0Wy4njf7lE0QSBpKKk0BtuEfYLwNzAjRSrDycrBxU+Jd2DwlPfBASMSyGi5QhApHabG4yU6o1pqPdEGR5pFMQQAYMiJTnzcGDLgZ5XVQnNDz3ptMB7DO66Q4kOtvKOm+GkDdIVqAxAaMNUY33RA+yXhXF1Fl52T6Ic5fTqU/ekiPsVuCgQy05SPH+6qLXMGSmOM+aXhwYJOkjXuT3a0w2NPVKp2p3gXHkrGIqPBpDSQbBIJ2aP1j7plQRTdMakdyQQS6nECzlWMc0dG0jl5I8NOYg3S3GGgcDHijw8dKQpWhjRDjee8pgADBaNu0JLgA4702ndl77fFEmN7L4MxKnqAkwSNPVUkRVqQpKpvI3iVYlRuMNM6ommA2d4QvGz9F6m3pGt3XhdIFdLCDJSzfVDQZmLXcTKY3Yw747k6i0NjWGiFPqgfstIOsSl1DLHATomYizXHkVhAy98WRpQNJxFKrOmePALB7Ubrn0RiP4YxrnMoSB0w7z6KLD2uubcFE72ROvVyq2ugunipi0OptMmC0ArRK9gmTimniNDwW1GkOzG9zqspbGJa7UZHGU2pBLmj3QlUgcMMtOq86kJ1JgyEHTTwAQMHVkcSFQBDJ+viooaQJIBT3uyxCVTMkGIEpjxLgud6US4h3Wmd8BOwZ69rtRYJOIZFQX4I8NPSsgxczPh5qsQ4n+II3keqU4tqYxhM9mPFUYhmTEggWzR4qYgmpSduJ9UoIKjgMZF5hpnvJXRcYog7swH+lc7FN6PGF3wtXQkdDH70aqjXCH1L6gpLwSTcbTYTDeqSNSNx5KWoYdSbOsqxicxInUZh5onNPRuMnRKoiKdrkGYVNUdoKoHKf4lttya8E34Ssj+YbO+wTK7IBnQhClGU3ZXROrEyoBmZMiw3JLGy5hv2Sm1buABtAUVLirVHAXupiMxePqq8WCXEzN0ge03cEoNJpMl5aLF1wVYDlpQDd9hyCmpmHHkE+k7M4cGiPqkitmzRP2CYRZoM/sLBTytptnfJW1XwWDd/ZRU1IgQDwKOlrU5tSQdsj4ZVFAgh3yo1YST2ByB8U02I5hBFmO/eqMuktA4KKGjBJ3bbkuozK9jfjW0ZzCDq90p9WnL2P4SmLABmmxiSeUIW2ZOkuhaW7NR5MyQ0c+KGZpsH1UVQwwGjS3mV6nvtuCXVc4OEbiG25BHScc5B4BStDah3c0GKGwFtXQHxQ4h2duiBF0Wg1R8pKKs7aJn3h5L2HHWzwaB4oazgWzHvH9FWBVM5CEDHw6pwaSfAJtFmd+WLNulPGR9QaSCVRLohpxFYybm3kgwrgcUQAbPcPEJtJp/iiDvbNkjDjJjHDjVM/cJI6knPS5t9SlgZacToQizAdFpaPVLcDkqAfW6zFVgQx8kWOZTySW8wYRYk5jWbPuLKHbp7xoqgsplmp2l6gCKtQoh22d6PDtms4WlSrGOEmeMb02k7tN+IaJddmWxvBEI6LetcTO5EhkDpjJ47lBU7W+wV1+lmd5UdUbYMqxKnLZZ3FbQZIjTLc80Qu13dP2W0zY8ynBqgzsU535iqpOWnxJlS0OscT+YwO5W5YqfKIUUFcSx4+H1SWuEH6JtZ8ucDOnqpmmzt0OClU0f07hwcsBmvHAn0TJBw7o1n0Qxlqz+9yivOMB1l6k0PpADewLz3E544eizDSMsXGRqsSgYB04FyAxNLQGuNjaJ5rTTy1nO0kASgeMlBnF8u/RZBaBgtdspziRmA7o7oSm7WIYNYgL2dxqAjeJ8VlUU4nS2Yr0zUH2QUXWN9CiJy1QY3rmReJ7Y4IsIAKpdvDggr7TgUzC7Jc7i+fIKsTjXdczm/1U7Gk06BOvSEeH9kf4kYh4mxJ8UuhJw7C6RD2u8/1SnBD+ItjFNJ0LD4f9qtrhAaSNP/AOqR+K05qtv7rx/pn0TW0rgn92aVZxL1rz1rRvgFSVZ6Snr24T6ziKrXD8osVO/2gAIkVFYgKcNYfnhUuaSSYmSEik0OcAdxcbd6qdAa0zJF1a0LBP8AEtO8CVVie0BOouPopKZH8STM6BUVSTlnihTgGwOiHJNqkg6iIakyMtOAm1S0kdzdVGT4rtk6DVLEFxTcTBda2ylMkuknfHgrEoHFjKjmuIE3VGGpy9ggSTJSzS6Q03xmcLgK7C0SJe7WLJIIumsDFkmtUPSD6lV9FlAdvCirg5jc2BusxbR1ht7qdhhtO4ZPVC0S8wPdTcK0lzvkPmjShZFm94HiV5vaaeS8bA8iFsS8ROijF0YD28OlPkqHuJaRvmFMdkOP5ak+AXullwYLuIlx4AJCdJNBrN7iXeKW3arZdwha29TKdGtHkvURndn5krM9WcS4EfmJTKYPSknhCU4ElncB4p52apB0gLaWDe45b8Eut2AUT3bOlxvXql6YPJcyDQOXO46C5+gSz7Fgi8SfM+ia4TQqW5LGgOB5Bw9PRVD6TctNzovCgxTj0jgNch8wrqRP8M7hG5cvHuLKsiZIhWdS8UUmfzLOdIeqmyx+IPBtttI+qroN66gSSDDm+Snq0ycfzLqfqFZ1PFbXTA328kDiC+oBcCR4r1NmQB2thZKcT01QDeTM9yrJ6gJe6ZvTKKjY0uMEoSZuCI6M6plFsnNNwAPD+6SGNaQ4SOJRYM/zDjreFr4DrHkgwZhxjfJlGlDcRdzhMix8VrI6Y8bIa5uSZ0XgR04OltyKmEnpLkG5UdS1S+kqslvS/wCY696lrRncWmIdZaJQsAcEtpb2ARmFo5pjJAnfE+KNtGKxcwSTaeCcSn4Nga+QBDGp7HQ55i62hQLKZntE3Rup5Qd071mRPeS5w7v1S2Czu9MdOabxIHgvAbD4G9SrDGDqKnzeiF1njmD5hNY0nD1OGb0S/wAp+YIqyPaA7wvYWxbcT0QhEGy56QCWspGYJbEpRKorOJZbhM+S9VuWtA7AASWv6V5a3sgiTxK0PMVKhjfH3WRtB205/CSvS4VhG4AC68xuWk4iRswia0nE/U+CrDoggO4k+qOoTm+qFh2nDeHFa512lc704Ct22hawxQHFxDR3koqvbBXiBlomNHg/a60ZPjAKrXcSXR90vBjpMHUOYDI0QOcp7mF+IawAQHOM8FlOk2jhqjQBtu8JS+iV+KEE043tnwhUNALZ3w3/AGj9FN+KgCuxo3MjyVTAcn19AtOITiRNNkDQEKZ13F+7O2PqE/GHq7aglSB5i/Fp8E4hmGBdUaToXO8090gQSNPRJwoswze5TarbgDhv7gpWhdG+J+yrrAgMOl9yjww64/MFbiASxvIyjooSYDackC6c6/RaCQOc3QQejaddpMqMGWkQCLNHiopOJb1uvu8FMdkGBpCqrNArC40U7rlwmVYlUYYDJcCAYVLHBmp5Qp8MAac63KK+o+iSKi8lpkKJxzPcIsAG/XVUCoG0nOdplmFO1pAJcQHXce8rM3DwX1O5Nw563vaQk4T2lSY0COmctVp5kfdC9KcDqx/0RgQ9vErCMoqDu816ZLTzKylkHrB8Q8luDpA4l0gRA+wC885OkeQT2T5rcKS01HO1LCUhY1t6zudro8OwNaRwAQs/p3Em7j5lNpdk8yFkIY6XhvAAeJR1SRiaZ3OBHilkZajSBqP+SdXu6nxDlq0ZVkMJTHEmg0QL+C9VbskcELvZNBO+EDHSuxwO93qsotMNtqJ+5QsPVzuzH1TGWIPwjyWZlN+ShUB3BQfiDQWyNWwVYNHtP5Uk0jW6WQMoZF1Z0R0vZUapcJ6XTkp65A/Emge69o8SVZTphv8AD0twdJUVQ5vxEn4wrGVwOjEfu6TiIFcO3SJJ5p47DTuyqPGOIc0tPCUohN2UwTvY5Ow7TeT7o+6mqOJZF5hw8VXQG0d+gKqRrzrJGqzBdp0c1lUTOi3Abu4+aNU6uCHEfCUJIFUX3I8QCagM7iF4jaZInZQIxw/mHCwgnmpKresfvvwVdRg/iCbiZNz3Kdwio+4VjVPqAOMhW0gHMBIEkKPdroVawAUhrokJzHhtgZJCKq6WacFNJbeNfJMrPLaRAu8nKFWTg5wXcSSO7RFRjoHHfJQluSnAItDQjw98M7SSSpeLBsPU1R3FBEtZ3uRU9Xt/M3yQkwxvzORIQG08DvSQ3NTYCOI8U0HbJ4hKeTTYABLiXAfdWDTMHTAoVHHdJ+pKWGE4doOrtUbD0eEqAa5gPBa6G0qbZ/cKo2B0Dj3rKLs1Vx5nejcJokcj6pdPYruEe8fJVnmkjEVR3EX5IqkhzQOK2A7Ejm2FtVtwUKUFXMkCNBK2JpMnX9YHqgrG4n8pKNszSB+H/cFIrzWOFeo7kb/VC4TRpDQl4BVdZuVjQBqCfFKrNhtMaxV1Wl/aVzvxDax7ATrZVNMUzff6BTYqHfitNvDL5EqxgJojSb+QSFDiWm95uCpmXjuHkqqhzOLdbDzUzLjnHomhtCwbr2fRNdBd3JbWw0E7hC15h/IqKGhs1TwzDyVVdxgxp5KOl2td6uc0GnO+CjpYEGKIbqS8ckdR3VUj+9VjW5gAARtBHWYOhZckzp9UVIxJPStngpoOfknYi9USPolkAvdAgWSiVVg29VroSidOV0BDRqBrGtPvE24pgYCI36pIGtApNG4wPFBVfZ3M2RYqQylP5vRJqguy5SswsDPSVJ3gJjrHuIKDCWrEbyPVNxDcpKN6U4x/aqDl6rI0v7xXqgmqeeYeErBcD5gorKrZbB3x6rSYbUdoAI9VtWQJF9PVOrUxTw2RxzEhUU0RhRG9wTKZgfX9ENQAU2jmjpiSJ5nxVQlzr099j5pj7m+gcEBExyLh4pnaceRatWhuI2QlOINGnO4puOMEXmynqDLhgTuKEIVORg2kzO0Y+hVDWGBxIt4JBEUGjXZPkFTlOemZ3GVmTMBBG4uEImtc2jUtq6EFO72N5q6s3rC3QAjyWrROR/M04tDHFc6nfHvk6GfJdQj+YpD/AMev1C5lCHY2u7hP+5WJVhtTYJgwoMS0gi+n6ro1RFIdwXPrnMxx4E7+5ODSSMzTbf6qmkYJ+iQ0SOc+qe0Rc7z6Ks86DK9gjlInggcQMwK3DWLe5SqfVJLhwnVG9ximNYYTJWvaBB5heDcwBEjZK5kOq7+ZHP8AQKSqeteDrzVdZoFZhG0Y39wUhg1nSJAVjUoAkOBsr6Y6lp+FRNA10uVY14I6Obho03Jiw3yyBE35IqrgKzBpEnwRBkkRuSsQevaDbYv91mLrOOQC2bVMwf8ATkfEUmo1znkjTen4K4e0bnFTXFnWs7be4hDqzud5hHEVm958ksan/K70RIUXmfdQub1jeRKJokt3bK85hfVa0WzEieCsSgqQKNzAc6QIRVP8Icv0TsW1uw3gUmqYqNj8pVgtJ6mB+X0WA/zLuZ1+iLL1b51DfRA32gdIvlKrGUhmrUyd4K9iDCLDXq0z8TkGK9qRM3QvSgcWZaTvLIToipQ1N2DxSK42qY3mPNPH9RSg6OYsy2uIeBrFvFTVzZg/8h9VRWviSBpnI8VNXEOpj/yFGMiqifxdp45f9ioY7q2dx9EupTjH0nG8kf7SmZctJu+QnBQ1TBudWx4qeiSBmncnV4z2v2vNLoAGmU0PkQRcTCFw2pMWPoii8TAmVjve7z5qKyi0GNLuVzgBQM3GUqKl7YAXi6uqewHMRojpYUwgNBAjaCZVJ6Nump80phIpaxEaplWOhb3+qKk4p2l1OTJTsSS4gWjek6Fs8UolNdsZHg9ncm08Tnrke7FkhzhTlpOyRmCXQPWBw0JSFZjHgdDbe4+SGnBpt4+azHtOWmbC8H6oaEuaWTcXVZuHcRjG8wQrcW2wMKCgZq03aGSujibtQ1088IqXrD5x5IKc5QTpI8k+oA3EsaTO/wACgYJbHMIq0ND3ARaR6ptchxa3eSAlMdD3GLB0eCE1A6qJ3AlVKysNgRxlGLNHcfNDWENadbomXaOcpIQSGl3zm/0TqLZB3THmEl93HdBBTabtgkageq1Y3GMkkTuCnqtnDOBGpjyVGLbJJA3AqYmWU2nVzwPVFT6jYaBynxCZVnMI3SsrHrY4NB/1L1VxzE8z5qKRhGZqzeRV9S73nkTP0Un4ZtVgTplJVLQXOd8pW11IVm/mqXyDzC5uEEV8RPP/AHroOBOIaPgHmpKVPLiK4+E/71YlOquJY75QudiTDXtkayujWaGsI5ei5laDn32F/onBraUjXeQngzA5pVJtmnmmN3EnQKqAi08QmUGg5dNJQmMo3Ax5IsLdxi4AAUrKsTAaJE7QQsMBsCLFFihIH30QyQGyRvC5kOo4iqyYFvRS13RUsVTVMVGcYUlcl1Q6W0VjULblODuhr5rkOseSSwDpMpsCF6pUDWlrjcWTgq8NXNTNOs7kvFvBxDgPyNCXgpFQDiF7GNIxAvEt8lmOfBbIsYut/DSemqNPIpROagXC5aI70zA2xHe0LXjRTUEVwY3pB1Mfl/5Kp4zVmcyEmBmqjUgAeK5mFogieCbRANUPI0k+KFoDoPf5r1N5DJjUT4qoKtDqkcASlVh1g5DgtY7M9x3yAENXZeLWyqxDXRef3ZTMMBgi+UKk9njACmOoPAkKorw7Jc2+hPkl12S+ZvJTKD4c0j81/slYppDjAnaRJlRoc+iIvM+CcxsYinycB4JVPaxNMcGklPpH+ZtueR4KKdWn+M1/xEuv2qc/mJ806pfFz/5EqswjISLBx9VETYvYxmFPEwf/AFRSAxnCPVZ+In+bwu4BxPgsdGRspxK59a72kGZzIKUBsRqVtUDZg/mQtAyt45kxUNbJdyleeIaSBFyPFa07Lwd8pdR4NFsal7vNRW4dvWE8gr3S6h9JUFA7Trbgrm7VHSENLCg3qnai0plVrhQuBr6oXAZDNpaUx56kAQb71FSYkS8bjCQe3fcVVioD223FTZc9TLx4JRKY/I8AG8BKpWeQd1152ekQAZaN/KUbYdUEDUJiuc0PpkOEgiFIxpo4jopsn0qmdoaTtDcl1wBiqTxcXb9VItDhwf4hjeDiuhiNWN4lQ0Y/iw7dmKurGalLmUddLPAPP8wXaw13kvBokDdIQntPPEHzROkO195FSc0Me743JTJJzH3o+iI3oR+YuP8AqWNBLm9+icGqcUMlNs70ui7YE8Ssx9Qy1t9FlLsSBvWnGeJzOdEdn1Rsi4HMJJGXM7SWlNBuTrBC1Y7GEips8FMBFakNTJKfjndYyLbKTSObFNHBs+KKnvJzPJ3Nb5onCWucd+Y+KyppV+gH3WVXEMI5O81GZ+F+0aP/AB+iopT0jr+4UnADLiYiIYn02yX/ACELVoAj+ZHHKB4qRxy4+u3caYP+pW5cuJaSNwUVX/8AYVj/AOMDxC0SmYgjK8acPsuXUEudeRlaujiAMrpP7sudU7Rg2ytXSDR0YOURuTGNmnMTb0SqcBzI/L+iaXAUe5Vg1bAW1gx9AjwzcsxxKVWcCafyCfsEygYYTHvFGqsxIJYDfWEsts0CZmL9ybUEtCBwAIBMEOCBtrAh9Own+ykqN6117q6oSXU7A29FHWI6Vw81YlIpxmBKZVa18kCSlspipmExlBNloe5j4dppbeukCiwh2m8jAVlakKzA0i5Mjko6eri0aEK2m8Pvm71FSUiSKrJ0BT/w69aeDQltAZiavBzZCZ+H2qk8WhbXGnVbj/MAcB6JTO1UkdotHmUbjFd3JpQ07QPi9FzNtg0k7mkqdzyygwi5yt8kyqS2k+/+GUuqIDRHZjyViV6gw5mt1JMymYw5XRpayGgD0wPJLxNQuxBG6UvUOa7ZHGEAuCbRm9Fo9mCN4QNGQxMbQ8lUU4e9RojUg+CXXk1HAaSiw5iownigru/mXgfZAmUP6l1tGgJ9IkVWnjUPklYM5qtUncY8E1utLcS8lSsre7+ZdzclYhwAb8xHiiqgOrkfFf7oMWI7g/1UZJ+Ju6+gZ/MtzAtYRF/7pP4lP8Thp0dmHiEcZRTtuPkU5wagN+7aWU23ZzdPmtEZLTYuW07dFNpKaGtNyBbXyQOaejHHMUbBv3k+i9ANNpn3isocOD0jr/uF0GA9C3fZQUT1pB5q+kc1MDlKGlyURNr6FaT1G6y0cOZCxonDmSI/sipGJMvbp2UpsisDJnmm4oAPB3gaqedsHmlEq99Fj2CQJIjvUDJADmg21VlGo6o7I06KSeje9h0BhOC0uA229oJrpLqcnST4JLmmm6RoRJTL5hPusH3KzGU9k05N8xVte1akoJmpTPMK+qZxFPuQvTgAZa7uHmtd2x3lY32Zj4fNE0ZndxKKo5LaLAefmU7DjOcztBb9Ul96TbRAnzVNKn0bGTuFwkJeMcOmNtwCygZY4j8yHEmah42XsM45HjgUvEa/WHEXBsibo8/VZUYKlWIMhuv1CKO2BwIUrDx+rD3Keg7Ni5+Eeaoxx2GW4JFNo/i2ib5d/eiqyrdrvmCCsYa75Xea2ptSBxC3EgZHaezcfFSELC2rZuQCfTN3DkVPhXS/6BPotDqvIA+SlQL3gV27tn0XPxLsv4hUJMDKPJW1Pas+Urm1wT+JVmn8rT/pSylUYogMqDSGz4rmuu0k3EDyV2JAy1bGMvqoql6cjeB5JwaKm2H8g3cmiSwhALVCN+VGLN+kn7qsB7YyfKNe5HhQejMnf6rzm9mDOwF7DGWu5QpeLF9UHLHJJdeTfUJ52mHkkvuw7rA+K5m2o72ZtuUtQ9c/ffcqnCRTkiZUdaBVcQNVYlew46yJ75T8XSZ0bnAXADu5S03Q+VUC7EUXwbAQU4KZpLIIBgi6JrsrmlnvG4QU3ZhlPGy8AWPy8xCqGuk1H3vlAVGEI/iGtH5Qp2nbe74/AJuFMYwbrKXixS8xWqfKtG75j5IX3qVjyWnRscXLmZVeTRqcckeCXWdD44J9UTReY92FPWaX1Y3kwlEqnCiCHu36KWq8Go48SVYAKbjv4KCqZcY5+asFSz2TCN4SyRmIJFiPJHQdNJn2Qim173uggTHgqxtCzmH4oKDFbOIJR0u0z5gUOLvXaNJBRVn4eZqVDOriqRepS7z6qXBgdNVMg3mFSy9anwBPqjViuA7FwdDJScV2ahjRwKcP6od5BS8R7Ktyup6zm/i9nYR4Gjnen6I6kzJmzj5Fe/E2l9PDEbqiOrBMcTPgnng1zQbQOJRDtUxGkwhB2SdNp0fdbSuaZ+CSnUhrDtsHNa1s0zoNvisYD0tM801ohtSdRBUVPQ/qT9VfhyJidAosJt13cZVlIZXSTyR0uXgcrp4OWUnE0HAfvVecwtqngspbL3skCQTJ3GUVBiy00GuE6KWAXmFVimg4eAZJnRTOJmUolU4YxWdHBZiKQIc8WIv3pNCoaVZzibExfuTnP6Rjom86pImLszR3I6r5e/UaDyQUNtrW/mMeK1pDiTxqepVQ5/tGDgQr6vtmcgT4Ln1DFSid5cFfVM1WkflPkhThTfZH6eaZTO/vSpLaLh8vmmUzJ+pRqpnDM1g5BWMe0taDGsKX8p4BHTeSPqkJGIJ6d3NyOkA1rzzCXV7TiRvsmUpdSdmEHy1SQZdlNR57ljDmBPEa/RBVIDDJO/6oqUGmSBAymylZRimzSbbQeila2a9J19SrMTPQjuhT0my+iBxJ8ESOIJabcPNbVb1Z/wDrMz3oyAMw+Jo8UFUwXfI7zRUrCPy4stm0BX4cDPUJ3LnYW2KJ5DyXSodupzEq1InqWNI94UGJGX8Yt71Nv+0roVuzSPxQo8Q0/wDylJ27o7rZSl15LHEzdnqpJkCPyjyVuJgU3/C0+ahectIG85QusEwe0fxiCjaZLxGjfVC3t1TNpACOkD0jubfVRnsvVsPwoMH2H/TyTX7NCeZCHBNzUnEcFrxVtMh1NyU52Wkd+wjpNtBNylhh22/RczMc/q2E6A3+6nxgb0jSNCU2kQaJEtGUiJ3yErFjbpkbjKsSkUQC4W3qvCGab+BKlbOYQiwtY0qZBvN+aYtxFPowHi19ELTNVrvi9EWJOagTe0H6IWnZJ/K0u8FUepuzvbqJM/v7qjDGcY0jeCpqQuyPykqigQ38Qb8pUqxRV7VbuA8Vh7LTzK2rM1ecIXEgMHNyBieeocOICSb1p4FNceqcfhCW6znEcVolVZw69pgnuXNvnjvVYcS36FSOkCw2r2SgqaWyxo5lDmyUwTbMZP3Wi7Gnfe6VWc0Bs8rKsooyXD5h5rcYNvNvCykLt+YI8bcjgT9UFIw7ctd5v2QqmtJfT+YpeHYDXdyYPVPpxmp/5ipVUNjpmk73IKozNrAcPReD5cw/Ei1fVH08FGjn4/2FAjUVG2XqhzCm4A3IssxhP8GyB2Xt8whpnYAMCHJxKgJ2BwzO8yvUjanuhhlefvG7ObfUrabbNPwEeSYw9kZ6XDNCY6M7he7PVLbs9GRuc1G4TXImLOCip8GMmMI3HVXTla48CocOScXJtdU1zAyj8yOurOKKjszyOIClyGrVeIsM3on1JDwb6Df3JbXuL3AAkkuCkWgqtiiN4lJ3iN6fUjoeeZTTqeCsSn0qdmuMQ4m3FOpsAeWBohuhRUGgUac7gCjoOaTUqHeUkQ4QDpRbTTxQUWTUpt+M+qdhhLrWkx5oaUNrUyN5d6qo2uAMRh28XLo1G7TYG4qB+1jaINrmxXTcNofbwQpxGey4d3mmM4cj5rA2Q7/L5rWSCOY9UapDoaxv73rQbaoaogNQPcM8TptFODQvOZ5F4CfhrggqdgJB5J1KxcRpcpICpLmFszoPFOotAIA0IKnfd0TEX8FTR1YOSNY6tJw1K8EiJ+yDDtlzADcByZW/pqXL9EvCy6swzYMPmisOI2iPialV754I7LgfunP7ZE+81Kq3dxlrj4ozpJsM7LjIG8NXWpQHu+VcZhy40HkF2Kbprd7SroYVVHUtPB481FizlxtFwv1bvRXPvhncjPioMfJrUCB7rh4f2WytZjNKnAsPmufW7A+Uei6FUzRJP5CIXPfcD5f0XSBTWmXvnQkJ9KOlM/k9UkN2ncC4eSfStVFtWuBWUNQZmVBfteiD8N7NRqPdUI1EGEH4fq+d4K1406sY7KafPivOdJPIk2Sg4mvTA0H6ozLXO136nkuZEMpl7C4jSL8LL2IGUtnzRscXUyItDZQVyAGEcEkK03aBUMojsO0yqUXAGskDxXSdDAXcBCSJnjNhahLQLEJTBNCtbVpCrdDcC61yJU7W9S+9spJVQOGpzVM6BgTMOAfxIjg1Zhtmq8ATsj6o8FtY+p3BGrFVVt3/AESToO93kqags/n+qQW7Eji4+CBtqCadQcP0SqhAenOGzUB4qd89L91YlFMDXcppmXInOBzQbDZjnvXmdkHcnBUNvQdeDuSX7bmybSUxlqZHMBIAzOnhuWZXTESBuI8wjxoJeLxae9Cy5d9EeOO0D8MIKLDtlziOAlHTG23lmQYQHPWJNpA8EbD1jeRPmEaTGOJph28O9U8f1DxxAKW1gFJ+naKcAOlzW0AWqRDjW/y1UQdkz5FII2Y4keatx4mhVI3sJ8FFmlrjrB9UspUdUbWsw4+ZR0Wxl+UrHiee0fMraMAsF+xddBOy9XPCPNaf6oEkam6AnM2370WVnQQ+CYINlFJwt8S8O4q2szrxwv6KEnLjXxNzKtD+kqtPAXCmmh2JjOJ4JNJo6QwN7tNyOs4OLXanTwWUIFd+vacPBAiK09GQTqfRIgE79FVW9juvw7lIHbUdyUSrzUDKLNNAhoOPQNHKVFVrOfaIaLHeraLf5duU3OpKU4JWGcGVC61nH1U7DNWjzJNk+iMlOo4kEQYSqZH8RTk7OUwqw6bs2Kp1J0fC7LhtAc/RcXD7U2mHSF2htVmoaPKdmh7x5rWCIB4eq1rRFSNxHmvRtA/CjSiSsYDT3KWjtNdUPvFPxU9CI3iEtjIaALJwKKlEOsn0yOjMxrCU0bOUbymM2aGY7yVUTueP4kDcVXh9qq2NAYURcP4hhvI9AuhgmwWTrmEqaaG1Wg4Vgm9knD/1DBpaT9yqanspAsG+qTSbFQHQ5fVAhVjlqkDXMEt0w21wwo8RIr8i8eSB8xMxlp+qkVE4kYv6N8l1qZPSMN7ghc0MzYw5uDfJdRjQBRIhLQxlIZmPbzKixrZbRdwMeBXRpgMLjxJPio8eIazk8eqM6tTVG7JE6ByhqCT3j0CsqHqp4tN/opagnduC6wKaxtnzxHknNbD2GYmR4JTCAatzANoRA7TXcwsrB2a2l2iEH4WMwEm6MENrNkGHS1T4F7mPNiYN1q3q+gz+ZnmFtUA1Hgwf+isou6x7/FedlNXjmF1zpApDqj3Nuk1rBknT9VRh46Axwab96Tifd0tuV9Qmm2Xjv3qvF1RlLRYlRsfBm5hY6q6o8F1gTIgJyJV1V00nC0QkNdlwzxY5mx9ynV2dRDTAyxdJcAzDQSJLgqhVJwbWqOO5m5Ufhv8AWZjfOxTsPt8xkwI+yo/Dx1lJ0XvdSrHRqCWu+X1Sjen/AOydEirOkJQb1bTG9wXM2OgNdyUWKeWZnfZW1BDaneocYCXtEWmSrlNFsaGUgPqmtgUxaLoQ3duCN3Y4QJTE0kCkPqfBTUXA1XtO66oqbDGg8ApaRmq/LMkAfcrMuojM153Fsp2OaC4EGYlew4AYfkKLFCxtqbIUgYMTUqDcJWZpqAC9/UJmGEVXfMUlsis0cp/1Iqe0y2oJ95G0mL8kik/M+sBaD6lPOhO+y1SAxG3hXdxHgubROZjxOkea6ThmwzhwzeS5OFJPSdwSylYdps6f9lewpJcw7i39FlMSwA7yR5plBm0y26PJOi8NkHuKMMBpHm3f3oARA3+75omu2ZE7llLpta/Fse0doaKqqBScH6SCo8ID0jZuWuI8FbiGdJTEai9kb1YRRDspzGLghOYD07hptTrySb5naaAptIdeATMlv+1SqVV9mBG9TNbtKqtIaQdABuUzO0YViV57SbAc1S8luGyHV0Bep0i58I8WwCkI4hJCCMmEqOidwSaJ67k1nHif7J2KBGDYwGJf6IKDINV2+Gj1VQWDiCLrs07VSTuaVx8KD0jRe7gF1wYdUPBvqho8hZem6NczQhB1+UJrB1R+dKFs55IUkeJEU2jkFgALGpmKGy0JdoATgV42J3QEyoMtJjfhn7pTu060iITcZDWiNwASRNRYC/pJ1t+/ur6Bg8IMqag0Ck0cIPqq6DR0rM2+AjpYOoctF4+IhBB6Zh4MB806rDaBdE62S6Jz1Hu3MDQfsgoMTJqi+tT/AIpdWBSefgA8U3FGKrCB7/8AxKRUM03NMe6FY1BH80TwDfJXAk02QdFzmPmu862HkrcO4uptj8xCtSHZrffzU/4kJoh26WnxT39mRzSPxEH+EzCdGeaM6tQzOGBBmJ8kmtZhdojbP8G6OawjMwA8AV1gDpzlqgxC8Zyxvn9VrWQ2odLSsJGv18Voo6ga1uY7nT90ODpgVqsCQb/dZVk0XNFpBC3AmTn/ADNBUvGhlbqg9rdXRAW0Adie1cIq7Je1/DVKpzIuAQ5Hwh0gehIO5vqk4i8CNAn0RsvGsA/7kjEXF9ZhadYlrdV4MJqNAE3hFSEmBx9VTQpZiSdAnBBiTmDGHcST9EvEg08PSEdo68U3Ft61gHglY2XVaDZ0bp9VUKac1OtOhdH2hWYG7mDgVMxsYYxvcT4qr8O9q0fCXKVYvb7OqeJAWG9NkD8x8QtHsjzciI6un8vquZkvvTI4u9VFifahW/4d/wA3qpMQJrBXKV4tGYIYm06kBFYu7l6iM1RoI1fMpwW4swXcoHh/dLw7A2Yg5rrcYZcY0d+v9k1gnLxiP39lvGUULiNLEFFVfs0xrovUAAXyLwSjxENDBEyR9FzpBogjEPPxEJIHXMk+7P8AqT8MczekOj3GPukm2JaALFo/3KMKlTy1qo5eqoqDKXADcEpnt6pH7umViDUcN8LVoy/R1GxuP+0rjYNwL6g3QF3WsJoE749CuDhxlxdZo7vFLKVtLRt958ym0SWupghLp6COPDmUYhpYL7x5p1CrgHkZ8UQ0cN4JHqhfpUi8NJ+xCKrDXEg3MOHqqheDd17hGpzeC6ZEtm+i5OHluJvoR6ldUExqhoonqiCRxBR0jNVhJEENPmsfDqgH7CXTEVGExoPMqKKs2RbcLlSMjPCsrmxItYa2UTZLxO5WJXUw7Whgdx1S8flcxoBvPkia8UsM1znECApS41qheTDdAClEbi4yUWybklExgDHni4+AQ4i76dxDWrWsy0GA66rVmYFvW0WkRtF32C6Qv0nOB5qTBNBrh29rPNVU75u9DRZHJFMfM7yQRZ88PRMdek0ccxSzcVB3+SJJsQJgpZdoAmvE5QQlvFwOacCsYScttTC9inS155n0R0INUDhdKrXY1s3dvHMpIZQG8C2g8FbRh1QATZwUmFbGRvMBUYZ2WqXboB+5R0sPqszURO/gkYeR/ERpmHkFQSG0Gl0gCUugCcK6pEZ3k34fsIKnxbj0lOB73oUl9mOG8keSZinbTdxBd6oKgywIkZv0VjUmhTL8RUncB5LoYNmzHxlTYZvXVSdbBWYS0fMVdVI13ADek40k4F0jSPByaTmJjc5bjac4R3AifEozpONSIdgn8brdxjgl4b+lqDv8gmgSCN0FdXMwkxVEe76pIk5RyI8EwnbeJ92UtvaYbWqAfcLRWOdNEOFzAJlF+HO2Y4W8UupsjKNwIjxCLAEio8H8xWvGjovba8qVxykidHAqom1ypX7WeNw4IQjadnVAY96I70jEN1OgnvlMo2qvJ3k7p4JeJOySLXK0YmgRmjmupTa1gHBcqlOeTOvqujXqtotbmJvoOKYk4rK7EMIJsL/VKr5TihrstHqvUwXOzONyZuhry+tUgiXWHgFkFUZlwrRvyzCowA6x/wALI+5SqwAgawAFRhG5W1nD3jH2UvFnVA9mO8lG8kBgj3WoG+z7pTKvaHIBCmSbUxP5lLVEPBVLr0hHEeaQ8ZnfRaNSnOMmL20TKRIqAxoCUDgC/wCiNh6uqRFgQF0AmqdqnOlpVGHFgSNbqeu0OqZZ04b4hVUhDDyaVLxYpo3Dj8J9EWJpiWzNrpVB0U3g7yR9k3F1BSYXEEuiwXNSsKSMLSPMkfdJJJxYG6B/uVZZ0VCk3g30Uch2Lbce7b6resqp+2eeY816reuTyKxhPSP7x5oqg2ieZClaKKfsPo7/AGrgsj+NxQO5wXepHqddx8lwHAt/EMRO/KUsJptHskRp+qY+C5g+L1SsObkHi7zCc4glh3z9tF0qJnNio5ovma4eC86XsouG9t/smPEV2H4oQMJGFg+6SPFZCW2rMeDaSPVdA1mtc0E6rnUmlwA3wfujc4uqtmZDSpYsXVYFVmn0QNAzsi27xWseKppOFtxuj1LDBtPmiReJADXATJA3KJpgkAK3FTBud2qiY09KRIgq5SqqrppU2k21IR0YGokRJ70qoOzY2anYYHJJvm3J+D6Vispq7wMv6o8RsU99m2ScTH8Q9vBo9U3FDO1rRaYUU3CyKxB5BWMEBx5qDCe3dOuYroNAynm5HRQR7DR8JKSQT0ifFmDgwylAe0+qBJ3zAM8EDtpwEjUrahs2+seSW6xBG9OBTqDdtzibAQpcQMscgAq6Yii8gWhT1gCwGfeHokiii6JOmWfJOYCLgawEmmAKhtxPkqxAY0/ET4oaWMc09FUbNp8095DcPlAsCAgOy6oDoRm+oC120CBxBQJz65GZpPDT/MvVAGsYTv8A1W4gbVM62HnKGuYpUu8BKJRUiBVfHFV4WAPq4qKl2333qzDkgf8AstWgW2c7vCpxAnDEHgPVTmzhfgVTW/pzfcPVFXzuGg4N3GXKindoMfuFNhgRRe34nDyT8O4FgJ5eS7OYnAOqH5fQKaS0O5PY7xhV2z23t9FM9p60AXLJH3laNXqwio+4AgFDhZbXJJMOAPoixTs1EEbx6SgYDJcBdpG/ct4y9lVpq5JugdGeoI3KRlTLWc+5ggq0EF73CYLZEFClGUgDUOvHyScUBEC8Eqls9ITBEgadymxIJtOpNitFpFImRAOuqfXdnqiTMC31U+HacxBOhTqtnOIF5ifoukCqaRaBdtgYCngHEnXtqqk3ZDTe09yjpEHEE7ukI8Sop1aekaBJJcB4J+DOZrh3lTVhmrtItlkp2Asz/KpeLOrBamOco6p2ncQUMbDRylHUEuqfvcgSYgimD8Q80t1napzrUQfiHmFM87UKxqwXcTOgCNjJoOk3cfVKiH5T9U92zQbuuEwSuM4gTcEn1VlN005ntZRbvKmyjp6cHdp9FTQAAIjSN3IqVodTaZAjWT90eQvbRDjN/JG0RUZ3ALzDlABjZdA+plc6b2KfNNttx8lA4gYnnmjw/urau1SngCFG4fzve633AWjKaUkuPF3qiq3Eg++UNEzmHxplSMp5OKlSDZPQC8bJ8lwqkj8TxDSdwj7ruMMUh3O8lxK+1+K1hESz9E8JoLDDqjeZ8gnuOWm3Sx3JDLVnH7/+qbOYCTPEfROiDESKo+dYLmszjf7osXrPMIWnr3Di0ecLKSwwZ71eyiG4ik5zRmLSTbuUFAS6NVYzFvZisrrtEieCmmjC3osWWgADUck8AinTO8zvWV4diC4AHQIgNmmJH7IQpEYoG/081GJNXfYK/FCAZBUI/qISylPqSWOHBgCoaCynpAA1U+oeI5eCe6DTaOQTFETmq1ZgkDLPG3906tHT022G0FPTH8y7ftAX3xATi4OxzQZsSpWh1AZXl28yfFX0icjT3rnUTJ3/ALK6FERTajTihoDg0/CfRINjU+qezQfKUhx2av1QVGRLW6RA8lhEgxC84w0dy1kZYnmukGnsbOHcN5EwosW8tAG4OVodDCBoGqLEwXMjUugqxKoovklxM7LvNXUzNNoOslc3CGSR848VdTMQB+ZHSw+qWkDn+iGm7tE6ZQvWfSzcCAirtDZy6ZFzJFiBDaQ5X+xSa1+iHxhH+IEtaIMQD4NS3A5qQO4T5J5Ssov62oOBldGhZrZ5lcuif5ip8oXUoGWsPwlTSQLxdpn3Qn1Wk0yJ4eRSnxlYeUJrnAN49lEnz2DOZlSTfpCD9gjomabRY6eoQYX/ABuVQHwR0DlYY+n/ALFd3NSXHpWjSRu+qnE9MAb7Kcz2jTM8PukvtXYe9RgdrCgH3THovUJzNAiTC8fZVmjc4n1RYQbUi5G/7rVVdGgwVKzMkggC/ck0pHSNMSLJmBxbn1S2pvi/0XoBc4xqT5oEcQW1AOXHko8TIM8yrYmqRNwPRTYkAGI4+SkapKEmoSJ1hUPGdw51EjD3e6OKcy4Z3g+K6QFFSWs/KdFFhjnLTAlz5j7lV4iCDBiBM9yjwFiLaAnwW8b00Omu+NzCnYeKbSJ/cKai4F1Z15yqijedblSrHRFteATXCc57vJK3Jp0f+9yFNLUtQ+o9FM4XvEKmr7Ad4UrzeFYlYQTlIVVRnVt5H0SWwQL6Jr3ksJi0pihfUIr077j5Kuk45XXuSNPlUVUDpTGgpk+BVeG2mE6jZPgteNOui1wzsPABDVImBuSg+BM2DU+A57Cd65Uy3XoOB3ujxU1X+sEaSP8Ad/ZV1QA4gaF/91z6xP8AFMvEuZ5rRKqoavuO2jqSA7vKVhyIefiKKoTtToYK160MDuqbHPyXGrAj8RcZ1p7l1WOENb8XouTWd/P3GjAEsJpo9o7iMp75BCZEacB6pYdtgjewHxCdYOc02uI+6dEvFTlvyI8Fjh1rXfCfNHiYNKdBAQOu5umjvRZg4f2xg3BK0ia0mb5l6iMuId8xCMDrKYm5BUqqabxVbm+XVNJDXUhxU9I7LWjeU8wKlKG3ynehTKxZ2CY0XPZ/VC1pHmrcXIoOMD9lc+k7+aaTpp4p54FVgw+DbNdHUdIYBEgBDWbnqMvvheaR0zg7SEkTYYE4ls90c5TGO/m3OnsglDRObEl+gLifNZRma51IbCzKKAi9tAulTkMA5fooKLdkbjp4LoZYgDgUKcNYZY0/CUgnYrHkU5tms+VTVDFKqUFTO0AXgbZdLrHmw5leaZdC6QaoYbO4HeudiTlrtANmuJ+8K4F0P4QocQevncC2UoNPwJLargbwT6q+mZM8CudhXda/gI8iuhQbskd3khoopojqY4u9UVZobRc7WQFlBpDGtP7sjrwaTWgLmTlYyXCOIcEFXZqM4Bvqm4oDpAOAJSK5hzb6NhPKUmi7+ad8oXWw/s26aFceQ3GOA0LQutQMU28VtJGvsGzyRVXbIA/K3zS3kwAdx9V4vloHBvk4IxXIw4IqVxPvj0R0oP3cCO4/3S6TwKtYke/+idT7bm7sxHh/ZdgGyc7fm9UqpPSsO+SE5pFpmQT6IK4AqMPM+qjFkXq8x/xW4YwxxB3XWgZnuAjcPBDhvZOHwytVbRPRvLoOyQVc2HBpERcqSOsqgHQBUMOaG6gDihVh+YdO4DcP0UmLMEGNZHgqTHS1Ybw1Pco8fIDO/wBFItT4UkPfbiqKcAlpgZY+qmwLuufJ1uFRlmuXcty6g9iTmzlusEFKwdjVJO4lMa8Np1C7Vswk0ARTqX1bv71mFROxVP5nBqqw7YcBbX1UlAE0BF81SSVdh2guZzupViwk5fsnPs18fuyS4RMbiPRMqWD+X6LnTTVb4dvzBSuMlUVjFFnzKdxhw7lYlE03bfQXTtaWU2vEpFIz9EyXdGCfzJi5xJNZ/NmUfYq7Au6t0xw8VCPbcjIVeDdmp8JP/JbXEnVzbtncRCqaJawfCpmNmmALX9VUwWAO4LlTBih0YAA3k3XNeM2Kp/M31XUxYzO7guaQDiJ4PaFsrW0nRSPHMUx5lpJO4Kak45HDg4pv+CdeyFb1BtMZSPzhcmu7+dN/dXVb2G8c3ouPiZbjeREeASwOjBfowDqwhUVCC5zuICmafYzuDvJPc6RMWAhNHqzuqjcR+qE7T2Eaw70W17Uj5fdZJ6Qcg70UZlEluLf3z4BPaya1LuKm7GLJiZaDH0V9BoDgY7LUasA7ZxAbrlhPa2X0tOyUmc1ckDfr9E9ocXM0sy6NJPjgW0XAxeVyWmK4PBdXHNIpA8Z0XILoqCeMJ44OnRLpcTwugNRrqdQiRAIQXLI4pdI5KNYOvrHfKSCwjw4E8ASspPltQj3ngWWYUZS/gWyEVATRaf8AylZF9K+Uc1c43HcVDh/bNnvVxvA5Fc66QxvZZyYVLVvRrdyqaLNHwlTVR1NfuUVJUIAZJhYwxX01BWV5IAG6fJZSINRrp1tH0Tg1UxwAePhnRQVnRVMxBgeCpa4BzhBMiJ+qixA6wSfeslBqjDAh1Qn97K6WGMggb4HgufSYYdEXMeAC6GE2XQPzBHSxY0Q4g7gI8kVYbR5AeSxjM4vpkHmhqmadQjfYLibm1hLnHg0KfEjaaN5hVVrNfG9wCmxntmjSB6LplKj0xbu5dVroFPuC5L/6meS6DXF1NvcFdJD38/zL05QPk9QhqGw+YrzrgfKPNFXHY7bq8cyppmMQ4yYDgfNRNkPqg62KraR07zxDV1czDDZteT5L1dxzt5OnzXnGTJ0P6Iax22778O9RWsB6V3+RBgj1T28oR0jL3cJaErDbL6jDfa9StVWUaeevU4GF6mcz3nUf3TqWwHu4mEqiSSSLf9oUopDSatWI/YUP4iC0AcD6K6CTVNolQfiLSHQtnrXiLCOy1iearz5Q5xUFF/WDiQqagLmRyXVzbiHt/h8wkSQvMeBh3P5BLc4fwjGuF8wvyhebLcI8HUGPBRvo6BOSiNxBculh71G8mqCiL0f/AK1dg+07uhHRZVO1dzI8k2qbVDxjySyJce8Jj7tf9PJA0Ve9Kn86Q4jPBO7RU1h1VP51FVMODuEKxKOgYLxwTy4dERvDoU9G2YE7pRhwLHNgi5M/RMUgPWZd5NvuqMIMtJt9/qVK0TiGg6qygw5GDdY+ZVqR0sPttAA3z4lVUhLhOuaPFSYY7IjSCrA0DM4nR5XGnCa/ZceJ9VzwOsDuNQeavrHq2TxkqNo6yiOLp8loqLBHphVI01VoB6J0/lCRhAymHtYIA495VBIyv+VW9SceaNlv+Y/6Vx8WJxmmgA8F2qdwLe64+C42OH87vEgA/ZLHR0JsNZT45yPNNO46W9EmB0THCZFRNc3ZZzb6J0Y9iZ6MCd481hs8n4XeaPEDsjiQELjHAbB81CBWEV6buIA8FfTFnR+UBSVWiKdtwVrOyRyCOlhTfazGgN1VT9pv7GiTSbIfIGgCopAdIYMSzggqP8SgUW2ImVwqlnjvld38UJNNoI0C4dQbdl1/HwNr6V6YO6EJLTQe6ZDhuQUqn8s6DcBIp1Wtw7qRm9/ql8T6ZhXw14MGGW+6PDO6sSf8QlKwp2Hk7mx4osO7qxN9srVo6eGOaqL6K94yxf3Cubhj1p5NCvqu2i3gwD7lc66Q8at5NU9W1GsnA9ZbSCk1h1NXmQiqR5nNOgKlZMBwMwSqniS4TqVGZoVS09mpdp4HeE8hVLXZqoINjYcipsTHSFvB8eaPDu67LxIQ1mk13SPf9E4NWYcDLpq71CqwTj01xO0omONPK2RFyZ36qjBPEuI3EoUo6UkDWLAIX3Zl4lGNR3rKlg4965GgLczWji6fNS4sg17awfJWDS3uhQ1hNU/KllKgxNUUawJECQF0cMC7DtdwK5+Jw7K2Kb0mYtaQYHFdegR0IAAAzGyWuDOjqDYE/nWkQO4M8155GT/Oi9xxi4yIE4DRNSpulVAgVGRqWCZ7wpo6+oLxJ9E8gB9Iibs9Qu7maBeNNPVZWnpWfXyRZYrRrcIavtR3Eoq8yzjr22jwQU25cU4G83THHbcLDbHkERbGK03lZVQtTJ4uJQ0dXWiSAiN6f1KKk0ZASPeuudIxkFtTV20ud+K9uII01XUpgBrwDo/TRcv8VOaoS4cFc9a8clhy1hysui4hrMxIA4rnaOkaAhVYh+bCATrYrrXKNxWVuHAm5MhD0hOFfpOaPBKq1mvw7WCQ5uiMH+UceJnwW+MooO2aRJuGLoYIZnOPOFzKDrU5/KF0cCZJ5uQ0eVps8j4gEbr9JzSg6ap4Zz4BG0yHyhTIreypj4ioq5mlJ/Kra4hlLvPqo3NzNAJ3KxKVTOV4fMg69ydTuXiZtIP0UjC5k0Xdpuh4ibJ+DdmBaNwdEroBDXB1dhI3HzXQpCKbQBcNPkufSaXPBiDHqVYHxmaSIDYA3/uy2mi/AklpkXy+qqcTcTqSVHgXzTEWmArm9r6FcddOEYgzT7gp2N66mdzf1VNcRTIPJTjUHcXNCkVLRMVajeXqnVHQ545BJpHr6h/eqbWBIeUr1JwdA5Wn5Hei5P4gB/8AIX/eq6lA6ifdPmud+In/APIADhPilnqaeygUmEnV+v0RSdj5Usk9FS4F3omsGZzW/C3zCdCNxJOene2ZDVBFp931RV4NRkc16ozK9o1lg81CZVJzYcfmbH1Ct0BSC0ZKNhIVDLgg6IaWCY3YkRchMIy1nNAmGx5LKAllIZT2pWucP4mqZ3RH2RJF+JAtpgkblw3kipBsu9+KEFhHJfP1xFWRxXX8fHPajD2IB7kOIpFskLafa700xUZB1jVMScO7tN4tRURFIcql0phy4lrfhI8EzDiWOB3PWrR1MEILuEALoFsFziJBeB9AFFgGgv5EhdF4GwBvJd5rlXWPMEvOmiRX9jU70+l2z3KesZo1PmRVPUiHd8qfEMbUolsb8wPAqgmKxFjdTmARJ1BH6J5CpqJc6sJ7WYA/Qpz2k1as7nOhLwzAcYBuLm3+ypAHSOO4uMfdP6PxpbIDjvkBOwHZqAbyPNJrEikwRo3zITsLALiR73qELwo6re2F6v7J54NKGnuXq7ooVD9FxNM2A1xj3QoTeq4HuVoJFFrjaSB9goQZxFQgTf7J5SkuGbEFWYQyI+MqOSMSCVZg7An4ktJGudLSPiT2HqyOYH+lT1WnK0zvT6JBab2Dv+KKuGB/NVTJmfUKl4DTTG/J97qd5/ma1tD+ic6elYD+UeYXVzOa4isZ3FA+TiIn3UdMAvcToC7yQkZsQe4KEF8h5v7/AOiaJOPe3hDh9UD2RVqN4OKoIH8RmAHZ1UrGk2AO9Np05dTH1Sj7K4uAq6I6wGIDWLnTKZtB8DVy5n4nIfpcrp4dwgyRd0+C5v4oQXfWUs9G8cgGSRoqaIztLSpBaraIVNOQDG5dq5wqtTLHckYdmw7xwPom1WioyRZTsdm6cAcDCzcU0hPRbgWQur+H3AnjK5GGuykSdAu1gAA3uB8kNHk9jcoZOpBdPMlMaJY881jwM5A0a0Bay1N/73LnTTV+zS7z6qZxGVsjdCpq3bR+vqpZlrhrb1ViVPi2F2RzRD2TB48kOB2qkiwyuN+5G6NoE6wQhwDADUm0Nf8AoungevUWkAOOsD1TntgX1IlZTbs5eQ9EVZxNUW3x/pC1aLMB7KmOZXQpzmK5uEIDW2jXyXRYuOunkGLjIPmASI2Wga5/UJmMdFJkal0+KU45SyeE+KkVLS7bzz9Uyq7q6gGt0NIWq968++cHiEvUZQfeeLPVR/ijS3GMdGoIVOHabDg1wSvxZo6SkTxN0s9G8T26GkODiqKV6o/ypGtFnzHyKooCagjWR5J1IGpeq08j5IqhJfR5tI9UbmS9k8IuVppOq4YkduntD6IqBrz0oYd109lQzB+6maRUqtcBEwZ5QqqTJ1uEdFFdPYNIHcJSmEF7yY0k/VMqOgGNzClNGUOjiI+yMVJ+JVJAA4FcSuesMldf8SIzQOC4mMB6QBvNdsOWz6brsR5XvqkMMA3vuS6Jl7E+ctdp4hViH0306zJAzTrOoTMOIzfOFW9oe0SFLSEF/wAwW+/pvnyuzgBZo0Mq585mtG5n6KHAOii1x5qzNmr1OUBc66QTGgOPcFNVE06nzgqoOhx+ilquilU7wiqWqDneeajrlzC9o1AzBW1SQ50fmClxoAa1w1ILD9k8hp7BNz4ljnW2Z+wTmQG5jFhP3lBhBBDiDam4+CYxp6J2+w+iqQVd0FoAtAOnNHQ1drrN0vEug8ZG5Hh3A1C0aQfJTxXTpmGN3LK9sOXbnO9FjdGum0QtxJihTaYFiVyNO+1OmDzv9lBSvVedxcVdiNno+9c+gZqfVPKUFQxiG21VuHs0KOq2cQ2+8K6iIpM71tJAV6hFNkckeHddw+L0SaozUo33TMMCXOvvbf6FbxXLxDSzF1mnfBTnHr2H4QPELMc0DGOPFoWn2jL3yjzXSOZ9D3t/aPiEGlVx7kzDtsY4eq85sOeSRMAqEwycRU5w6PotpVC5zjoWiAUVdha2nXG45Hdx/ul0my926ylZTTcahyxHqqy7KakcA1Iw7IIJGiZVMgji8LmbKZaGE27VlzPxB81T6rosEU2iOJK5WNIdVcLapZ6N45ZO3qqabts9yifP8RbQQrKHbPcu1c48ylVqZmtIAFr70sMc2q8ERs3VNE5ar2802uwEF0XhT6vwnDdlnMHzXdwbZgcvVcGjamz6+a+gwbsuTnCGiya4l733tmjwWgAU3fVBROZuadST4oy6GO5yhTSvFqXIH1UZaYAnWVZUdal3n1UpJlo3X81YlQ1XuAFrtdlKfhmBtPEuMaQB3lKxYy1obo6HeMFU0xFKrzc0eK6AYyGkE73AfZDUPXEEaEjwCJgMUzrtG6Co7rYNxm9FFU4YbLeMroZoHBc7COzA8iFfBk3mYIXPXSgMUC0Um74Hmk13AP7mhU4szXAtaAo8Scrz3BSKGnYVBOpQm7X8VtIS+oRp/da5oAPdCtSFUe2O93kg/FoFOkRrKbTEFh+MjwSvxY9TTtp/ZKdS8TwehZ8zj4KrDE593aUoI6Fk/EfAKvDCX8w7gnRgnCXtMaHX7J1KGPc0WS7CCdJAPdotqnJD/wAtigSanTdTxgZNjJbHAq+lDInhKQwZ61OrbZcQe6E5h2ROv90dLDKgJY8Wkt9QgGyw7zJWvqQyprJgeKU2Q0XFxI+6kZB+IPPSOG4Bc2o0F5cRxE8Ffj5NVxlRP1txK7ZDT1IQ5tk5/aYRcylUmxluZumPcAG8ZV9TxQ5+WieIU1ElxsNST6JlU2InegwpsOTfFRvXRwj5ZSpzJL10AbOdxJXJ/DgamNncwOK6c9S3mZ8UK6Q73jPJTVuxU7/RP0N+SRUuKg5jyRVNVJ6Sd2YeSTimjomxoXBMqCSZ0t5La7P5Vk73ApwaykMjCZ0pwvMeCXtPEDyXgIovI3Bo8V5jYzuGpdqe9VGYi7RyHqtw16oPEFKxpLQwHfKbgn5i0kcfRa8T11gycPIgkHzWYntNaToAEVJ2zlO9BVBfUsuLonxdujjifNQ4ZsudN4nXuV2MMNpfU+KkoCATa49E5xKVrW1uACrGmKQE6SoiA3FHhlCtpNJpn5itUgH+z+pRYbW/BnmvPAyxzleo7L26XaPNZUX4lbFNjQtXiCHt+Ro8178TM4pq0kF7RvhvqnOBeqcMdndceq1jZqXFnCFmHE05H5fVMbGcDeZjvBUqiAFSg+mbA2UuDa8OqteRIEHgqHv6N+YaOCym2C+oI26Y+8lSqppkAlu+YC9VaS0aCHbu5Y03kIKz5pNaJkuJ8AhCE6zAACYF1xsS8l5kjtFdZxLZkixN/ouPXB6QzzTz0bxHkF5FzeU6hZx7kDhPdCaxoBJvoJXWucEPbW3hNxL4phKDh0zQNYKHEmaccFFbRnIN0ALr4WqHPaAZyU5K5lIjI8xvVX4YCadeqTuDQjSjps2QwcUXum28oHWqNbwRTY/Vc6aZ5tT7/wBVNO0M1gQfNUuuxh5+qlImOKuUpWJbNamNLHzCo7NM83jwQ4tgFSkJuB+i11qbTNi53kmLKTg+m0akT5IK7oqZufomU25WMDRqD36KbFPLa5tpHqrE8W4MXcOYXTLJdSI32JXMwTgTzsupTcCAN7brlvpwmptV3E8SpMXPSkA7gPJVEEkuU2M/qI5geIUytbTuX77eq2rYFeYIFT971lW5Pyq1ITo5h41Ev8VE4Zh/e5MFzT/+30WfikfwbDO8+SU6lR/4bL3yn0VeGMVXO+NR+7TiOyfRV0C41Xa6pjD6ohxadCSPFLqOh0O1cMp71RWtUJHakOj6f9pGJZmqRNnNkHmESbhtl4G7mqWtsI10UmGf1jSd4VVxlO5DSxlRssceYuO9aASWuGmUarxjoHni4CPusY7NSadDYLM5mKkvcb7hdROHWCw1VmKEOeRcZxqpS3MC6RMa/VdchXuzlK89s5RzC1wJbBhLnLqdCAlBNxDgCfqtwzQ1otuAS6pDi4HhqqsPSJz8ApVnVWCApMc4e9JVZ7FMRuClpENpRviFU/3eULnXSGHtEdyUdao5j1TSde8JDjDqvePVFU729a4dw8l7GNIpU2m8u9FrwRXdzcEX4iILMusT6JQaS3+nqRvc0LWy3NBklxJ+6IjqhbtVdI5LJ6TpCBF3eqURP+IAuY087o8CScubWFmIlzTA0IKLCtyO/fFW8T12ezBHHTgvO1stYQXCOEoXWBK4OiTGO2aQ+H9VO3ZAF/2AnY+eqt7vole+GgWunEpVSBiZ02QrafZ094qSqJxIE7h5KxghjfmWqQFW1ucJdMxVaOLPVHU396Cn7Vk//wAfqtFqT8VEYhhFrBe/xbbo8ij/ABYAV6V9QEtsisdN3+0pzgVXguwG8WH6ao7l8DUQ4d6HAF2Ztt6a0ZXjWBsn7qVU7y1xLBoSHBOw5lrm8rJNZuV7zvYZHcU3DO7QJvqpeLFNt3elvAHRkyBJ9ETtkuBG4rK5y0qcCTc+KEKvVAQKh4yVyK0kk7jK69QyN4kGQuNWlgaeRuU8jU7RtEQIi0I9HEcQvFkQQd684FxXQBMHXtPCUutDjl4kea8x0Pbe5BXgA54mxDlUPpgBnIyV0qA6OgKcb2hRUaR6EOIV1JwzMbEnMPBc6cUEzWutEk/VyEe1CObDnmQMgCabfmPmpqTczhGslUs7LRzKThR1rQeasSl4sde0H3W+q8fY0RpIcfBbirYsxJGnh/dEYZ0QiYpH1SELCWtaBoP0UWODumaRvCtbdjXCLwVNXaX5TFr+SU6l4t/DyC8LpDZNtCNVy8Bs1G95XUbo7gLLlvp5BUnKYnio8S7NjI+JvmFY+wtqTCir3x9x7w81ItNbcVBzQOuJm2iJur+/1QExTMclUhTLlnKp6L34oJwLNOKFpgDk+fBe/ENrCU+4+iU6lTNjLTHwOHkqKZ6x4Fv+1O1rstK/5h4J7QembpBAn7JjFlQkOpuEkZSPqD+hSapLqbwD7OT9E6sCKI4gg+iQ2c750eB+iJFUCOkj4rLoZhDbb1zMP2h/lXSe2Kfa0KOljzpNI94jxQgxSGkyjptDqLjOkeqVmJokAaOiykZzq8kvG/Mp6LQ6xtbVOrdpx5/fVLoA5SLSGyF0gUFSW0m1IgSQUmuYa6NQQQr6VOMOAQDIlQV2HO0C/upQabibtbzCqw1muMaqZ+1Ro33KmkOrPefMqVYopkFzI0KrJJP1UeHbNRsXACsIuO9c66QT7sdG6Eqr26o+IJxuHpFXtvPFwUUDpOIHzBLxbhUxIbptAeCY0Zq/OQUh4LsWTwJJSg0516NFvGpN0GGEhxd7xMD7rxl1OhxDz6LKBLS0ETtT9JSiCaW1GOBgcfBC0AVXjSP1WUoyvGhXtKj51g+a1R1WyLjc1bU2aAPELGz0IcD7u/vRVfZtHMBcXRFjhNam3nCVo57t10/F3xDO8pDYymfesnEoHXxM8gPBVzNJvfKm/wAVx+yf/hRzK1SBq6Ezql0u2w7ujHmjrHYA70pjoyH4QPFSLS/xgDp6UxuQNg1Xf5fIovxQTWZ9ELQ4Vpncw+K6TgU/DGSIMDMVTUJ6WprDoI+o/VS4cEVSDGtlRiJa5h4AhSrCa5zsbUmxhpWYN2nHKheIoPb+V0j7ytwYmoB3+al4s6ucRJ10Q1gS1vGCF6q2Gg5tyKo3qGusZJ1QhF1iclhfKVyK92DXT1XUrOJpNdoCwrlVRs+HiumQoQ0FjjplvCyqCyo2bBwTILqJiAZDU6tTHRARcb0xQTFalG45SmVbVxyM+CS4EVidw2lTXbNc93oqkU0jloiQqqB64jgpI2Gkm0KvDN23uGhXOukUN7QRC5pnmfJC3t/RGLNYeaBJ6ZOxyJQ4f23KCtGzl+qygO0QbgFWJUpd0lVzpM5STCfiTtCPdpeanpggvdyAH3/unV9p5d/4f0SFtMZaF7uAB8f7rQGvY08P0QNJ6NzSATkiedlrCDSEcz4FJBYO7mn4vRdG4a7W7oXMw5h3DbHkuq4GQAdXei566ceqiKjG8SoDfGyd11e8zVaeRKhd/UuPADzCMUTXdufzJbj1TvotBg1OTkL/AGb+9KpCWuk24j/ajxN8JSM7j5JVE2b8/oUdQl2Dpa2F/BWJSm2FEcXxfuKY2A2mZvl/fkgAllNxgRUatk5GQZ1Hj/dMVlT2TyTMf9pDzGTkYTWODmQfe/RIe7YbHEIqChaqG639Sui4DII471z2N66Y971XQquhg01R0Ubh5GGffQj1U7Ccjr2ziQqKJJw88bqdomk/Wc4UjOfWhocLfTvS6J6wtmIF0zENkOJMf9qZoJq2sdxXSBXQY4FgHIKaowdJUto6QqKYBpsItx717oy6k55F5hZkdW1CnycR4p9EzTqcnFJxABw4IB1J9UygTme3SSNVakV4TZYOZVju00qHCy6BzVmbs9y510hrL0394SKov9k+kJoOPMJNUafRRQ0xFaTe/op6lnVD8IVTrOJjf6KfEgS8m6UGvDsYccyfFLFsvEH1Tj2MP9fNTtmT85EpRKIkNqPEWGsdyxpkuJ1yOlbVJzu7/vZBRk5ubCr4nrsMPUTyA8UyqIgfEEvDbWG+ydW9owbrFcXRDif6ht9Gkqdg2W8J3JuJP8wTOjSp2vIptjiLpRK0OOf7KieqHG6nImoRoLeSc09WB3rVIGs7ZaeZ80lrpA7v+SPEexH1Ss2zb8n/ACWjD/ERNRt9WtSnds7urB+zk3HElzTugBLeAHBxtNN3onBp7LVzDt+5NrXawzqVNmIqz3Gft+qe4h1K+4A+Kyk1r5h+Zt1uDM1YO6TZY8y4W3Fbg29aDxCN4vqusBlEH3Ux5IwrCOfmlV3wG6aJtUHoAOA4c0CSPvh2gkEZCFzqsEAc10agBoUyJ7BXOrtiJO/RdINeomWuMwA4KyzxHgudRBzE9xI4hXuEXbpFkqMRFo6OYvBC2sevbvlvoqqtPLSaSDcSVLXA6SkQDMD1WiU5u1h2E7wrsOcuUclz6RmhAi0q3D6TwCOjirR5Rx1TO9KcblOcIosKBJiNsRzXqeyx9tR6oiOtHeV5sNdpr+srRqjdZpvq86d6ZWG28adWB4BBVAAHGfRNr+2qD4APAJgW29Qb5EIGuhhgd3itoTsGQJE3S3khvcEpEOoEZgfjb5Lri5p83egXGoyG9z2rtUxIpHmVz30s8C/tN+UqCp7aoebQug/2rr2AK5jjtvPF7fNGE87Wpxn1W1hAeO5D/iVBwPqtxBGaokhDLPaPjB8EypbBM+oSqe1Ub3+iZiLYRnO6sQlwyUG3mHNKMmGO0gPcPX0S33oP+UHxTM16okHsuTE6i4dFJ3JZEUzyd6raf9Mbmbr0nI+2+VKrW+1Heqak9GY/MpWujEN3hVVLgid656KGsJZRjnuSRHRVDvzhMJPQwBvH1SqZmjVBic4n7LRnPq3zfvep2t25kWunVXDbEDWPFJaJAO/00XWBVmGcC17Rr2gqMpFB5B0MqLDWrRGrSFfTu17d0FStHMrwKL9TlM+CZQbmq8QWhA4ksqg8AjwxIZmn3QR9lWWYNozNnTMQqXjKSkYIAsDvi9VViRpG+AudOComMPHNKff7BMbaiznJQHU/KESDV1PIhSV3bD3Rq0FWVgZd3+ilriKZ5gBLI1n+HQP71S2yajwfzei8XFuGw7iNTPivVBkc48SPJODXsT7ZwHH0CLDtGeBplhKqk9K9wOrjZU4UEPFuKt4k6twzopZe71VVY7bO6Vz6RMtuQM0FdDEiCwiL2XF0cvEHbqngCkUDmbcaGU2t2aruJKXQALgJ1/RKJTKw650aQFtMSWgfmK9Uu9w+FZhzJB4ErICtBaO8pTbz8n/JMqu2QeaClq48h5haMZjb5BOoCU+z6Y1Ba5vgjx1nsHBAe1RMxFSPBOcGvFxyMPFo8FQ8g0uZG7uU0zQA4Ett3p7o6NkXFrLKE9pn1R4b2ncEA7NO2/X6IsK6KxHJGrD6gJ6McounVHEUxusUk3yngjrElrYF4KBE1YGFpx+Urn1btnnvXQeQcGw8Gn1XMqvltheZTyNDSaG3MHcraJD6TR+U5Sog28jf+/VU4PR7eY/ROhFFdp6BhnWQufWImkb6x4rpVpOEdxbELm1T1bCdz/VaLTqLJZU+sFdDBtBF47NlA0llIyeS6WEaAWTwR0UY8QCnvPVMHIJVcbcDmnVBBDeEBAio6z/MUqoYv3+ac27v8xSqg0+nmtGqSu6ALauPknVLVzfVv6JGLs0COaZVJGKa0jVseCYBwgkszHT9SkkS6Nyazq3tHf5lJZIgTNgmimg2Wu5EFdWg/MWN4OK5tAQx88FZhJNdgJMEErloooqnbfvgLkudAaeLwupitl743tJXMeMraQm2cKRa/9k=',
  cement:   'data:image/jpeg;base64,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',
  graphite: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBAUEBAYFBQUGBgYHCQ4JCQgICRINDQoOFRIWFhUSFBQXGiEcFxgfGRQUHScdHyIjJSUlFhwpLCgkKyEkJST/2wBDAQYGBgkICREJCREkGBQYJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCT/wAARCAIAAgADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJeAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/2Q==',
};

function _getProfile(){
  const lname=(matChoice.ldspName||'').toLowerCase();
  for(const [key,p] of Object.entries(DECOR_PROFILES)){
    if(lname.includes(key.toLowerCase())) return p;
  }
  return DECOR_PROFILES['ЛДСП'];
}

/* Маппинг имени декора → ключ в TEX_B64 */
const DECOR_REAL_TEX = {
  // Дуб Сонома и схожие светлые дубы
  'сонома':     'sonoma',
  'дуб сэнди':  'sonoma',
  'дуб нейво':  'sonoma',
  'дуб дымчатый':'sonoma',
  'каньон':     'sonoma',
  'ясень':      'sonoma',
  'калипсо':    'sonoma',
  'береза':     'sonoma',
  'выбеленное': 'sonoma',
  'сканди':     'sonoma',
  'аликанте':   'sonoma',
  'феникс':     'sonoma',
  'пальмира':   'sonoma',
  'альберо':    'sonoma',
  // Дуб Вотан и тёмные дубы
  'вотан':      'votan',
  'галиано':    'votan',
  'марсала':    'votan',
  'солсбери':   'votan',
  'кальяри':    'votan',
  'трансильвания':'votan',
  'блэквуд':    'votan',
  'хронос':     'votan',
  'одиссея':    'votan',
  'венге':      'votan',
  'намибия':    'votan',
  'айронвуд':   'votan',
  'кейптаун':   'votan',
  'интра':      'votan',
  'руанда':     'votan',
  'вяз':        'votan',
  'бамбук':     'votan',
  'капучино':   'votan',
  'элит':       'votan',
  // Орех Кария и другие орехи
  'кария':      'karia',
  'орех':       'karia',
  'афелия':     'karia',
  'сосна':      'karia',
  'вишня':      'karia',
  'бетон пайн': 'karia',
  // Цемент и фантазийные
  'цемент':     'cement',
  'слэйт':      'cement',
  'рускеала':   'cement',
  'терра':      'cement',
  'малави':     'cement',
  'карум':      'cement',
  'рамбла':     'cement',
  'орион':      'cement',
  'терраццо':   'cement',
  'графика':    'cement',
  'нейро':      'cement',
  'дуо':        'cement',
  // Графит и тёмные однотонные
  'графит':     'graphite',
  'черный':     'graphite',
  'маренго':    'graphite',
  'титан':      'graphite',
  'скала':      'graphite',
  'вулканический':'graphite',
};

// Кэш THREE.Texture созданных из реальных изображений
const _realTexCache = {};

function getRealTexKey(name){
  const l = (name||'').toLowerCase();
  for(const [kw, key] of Object.entries(DECOR_REAL_TEX)){
    if(l.includes(kw)) return key;
  }
  return null;
}

function makeDecorTexture(name){
  const cacheKey = name||'__default__';
  if(_texCache[cacheKey]) return _texCache[cacheKey];

  // Пробуем реальную текстуру
  const realKey = getRealTexKey(name);
  if(realKey && TEX_B64[realKey]){
    // Проверяем кэш реальных текстур
    if(_realTexCache[realKey]) {
      const t = _realTexCache[realKey].clone();
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(2, 2);
      t.needsUpdate = true;
      _texCache[cacheKey] = t;
      return t;
    }
    // Создаём из base64
    const img = new Image();
    const tex = new THREE.Texture(img);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 2);
    img.onload = () => { tex.needsUpdate = true; render3D(); };
    img.src = TEX_B64[realKey];
    _realTexCache[realKey] = tex;
    _texCache[cacheKey] = tex;
    return tex;
  }

  // Иначе — процедурная генерация
  const p = (()=>{
    const lname=(name||'').toLowerCase();
    for(const [key,pr] of Object.entries(DECOR_PROFILES)){
      if(lname.includes(key.toLowerCase())) return pr;
    }
    return DECOR_PROFILES['ЛДСП'];
  })();

  const SZ=1024;
  const cv=document.createElement('canvas'); cv.width=cv.height=SZ;
  const ctx=cv.getContext('2d');
  ctx.fillStyle=p.base; ctx.fillRect(0,0,SZ,SZ);

  if(p.type==='wood'){
    const gr=p.grain||'#806040', dk=p.dark||'#604020';
    for(let i=0;i<34;i++){
      const y0=(i/34)*SZ;
      ctx.beginPath(); ctx.moveTo(0,y0);
      for(let x=0;x<=SZ;x+=36) ctx.lineTo(x, y0+(Math.random()-.5)*14);
      ctx.lineWidth=2+Math.random()*9; ctx.strokeStyle=gr;
      ctx.globalAlpha=0.07+Math.random()*0.16; ctx.stroke();
    }
    for(let i=0;i<9;i++){
      const y0=Math.random()*SZ;
      ctx.beginPath(); ctx.moveTo(0,y0);
      for(let x=0;x<=SZ;x+=28) ctx.lineTo(x, y0+(Math.random()-.5)*9);
      ctx.lineWidth=0.5+Math.random()*2; ctx.strokeStyle=dk;
      ctx.globalAlpha=0.2+Math.random()*0.22; ctx.stroke();
    }
    ctx.globalAlpha=1;
  } else if(p.type==='stone'){
    const gr=p.grain||'#808080';
    for(let i=0;i<65;i++){
      const x=Math.random()*SZ, y=Math.random()*SZ, r=8+Math.random()*44;
      const grd=ctx.createRadialGradient(x,y,0,x,y,r);
      grd.addColorStop(0,gr); grd.addColorStop(1,'transparent');
      ctx.globalAlpha=0.06+Math.random()*0.1; ctx.fillStyle=grd;
      ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
    }
    for(let i=0;i<7;i++){
      ctx.beginPath(); ctx.moveTo(Math.random()*SZ,Math.random()*SZ);
      ctx.bezierCurveTo(Math.random()*SZ,Math.random()*SZ,Math.random()*SZ,Math.random()*SZ,Math.random()*SZ,Math.random()*SZ);
      ctx.strokeStyle='#fff'; ctx.globalAlpha=0.05+Math.random()*0.07;
      ctx.lineWidth=0.5+Math.random()*1.5; ctx.stroke();
    }
    ctx.globalAlpha=1;
  } else if(p.type==='cement'){
    const gr=p.grain||'#909080';
    for(let i=0;i<220;i++){
      const x=Math.random()*SZ, y=Math.random()*SZ, r=1+Math.random()*4;
      ctx.globalAlpha=0.03+Math.random()*0.09;
      ctx.fillStyle=Math.random()>.5?'#fff':gr;
      ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha=1;
  } else if(p.type==='linen'){
    const gr=p.grain||'#c0b090';
    ctx.globalAlpha=0.12; ctx.strokeStyle=gr; ctx.lineWidth=1;
    for(let x=0;x<SZ;x+=4){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,SZ);ctx.stroke();}
    for(let y=0;y<SZ;y+=4){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(SZ,y);ctx.stroke();}
    ctx.globalAlpha=1;
  } else if(p.type==='gloss'){
    const grd=ctx.createRadialGradient(SZ*.35,SZ*.25,0,SZ*.5,SZ*.5,SZ*.7);
    grd.addColorStop(0,'rgba(255,255,255,0.35)'); grd.addColorStop(.4,'rgba(255,255,255,0.08)'); grd.addColorStop(1,'rgba(0,0,0,0.06)');
    ctx.fillStyle=grd; ctx.fillRect(0,0,SZ,SZ);
  }
  // виньетка
  const vig=ctx.createRadialGradient(SZ/2,SZ/2,SZ*.3,SZ/2,SZ/2,SZ*.75);
  vig.addColorStop(0,'rgba(0,0,0,0)'); vig.addColorStop(1,'rgba(0,0,0,0.07)');
  ctx.fillStyle=vig; ctx.fillRect(0,0,SZ,SZ);

  const tex=new THREE.CanvasTexture(cv);
  tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
  tex.repeat.set(3,3);
  _texCache[cacheKey]=tex;
  return tex;
}

function getLdspColor(){
  const p=_getProfile();
  return parseInt((p.base||'#c8a96e').replace('#',''),16);
}

function initMaterials(){
  const tex     = makeDecorTexture(matChoice.ldspName);
  const hexColor= getLdspColor();
  const edgeHex = Math.round(hexColor*0.75);
  ML  = new THREE.MeshStandardMaterial({map:tex, roughness:0.75, metalness:0.0});
  ML2 = new THREE.MeshStandardMaterial({color:edgeHex, roughness:0.6, metalness:0.0});
  MH  = new THREE.MeshStandardMaterial({color:0xd4c49a, roughness:0.9, metalness:0.0, side:THREE.DoubleSide});
  MR  = new THREE.MeshStandardMaterial({color:0xaaaaaa, roughness:0.3, metalness:0.6});
  MFL = new THREE.MeshStandardMaterial({map:tex, roughness:0.65, metalness:0.0});
  MFM = new THREE.MeshStandardMaterial({color:0xfff8f0, roughness:0.55, metalness:0.05});
  ME  = new THREE.LineBasicMaterial({color:edgeHex, transparent:true, opacity:0.5});
}

function addBoard(x,y,z,w,h,d,mat,noEdge,ud){
  const g=new THREE.BoxGeometry(w,h,d);
  const m=new THREE.Mesh(g,mat||ML); m.position.set(x+w/2,y+h/2,z+d/2);
  m.castShadow=true; m.receiveShadow=true;
  m.userData=Object.assign({w:true},ud||{});
  scene.add(m);
  if(!noEdge){const l=new THREE.LineSegments(new THREE.EdgesGeometry(g),ME);l.position.copy(m.position);l.userData={w:true};scene.add(l);}
  return m;
}

function render3D(){
  if(!renderer)return; clrScene();
  if(!sections.length)return;
  const totalW=sections.reduce((a,s)=>a+s.width,0);
  if(!totalW) return;
  let ox=-totalW/2;
  sections.forEach(s=>{
    const W=s.width||600,H=s.height||2200,D=s.depth||600;
    const LH=100; // высота ножек — корпус всегда начинается с Y=LH
    // ── Корпус (поднят на LH) ──
    addBoard(ox,LH,0,T,H,D); addBoard(ox+W-T,LH,0,T,H,D);
    addBoard(ox+T,LH+H-T,0,W-2*T,T,D); addBoard(ox+T,LH,0,W-2*T,T,D,ML2);
    addBoard(ox,LH,D-8,W,H,8,MH);
    s.shelves.forEach(sh=>{
      const sm=addBoard(ox+T,LH+sh.height,0,W-2*T,T,D,ML,false,{
        drag:true, secId:s.id, shelfId:sh.id,
        minY:LH+T*2, maxY:LH+Math.max(T*2+1,H-T*2),
        ox:ox+T, oz:0, sw:W-2*T, sd:D
      });
    });
    // ящики по нишам и колонкам
    if(s.drawerBlocks&&s.drawerBlocks.length>0){
      const MD=new THREE.MeshStandardMaterial({color:0x8d9db6, roughness:0.6, metalness:0.1});
      const niches3d=getNiches(s);
      const cols=getColumns(s);
      s.drawerBlocks.forEach(db=>{
        const niche=niches3d[db.nicheIdx];
        if(!niche)return;
        const gap=4, dCount=db.count;
        const nicheH=niche.top-niche.bottom;
        const dH=Math.floor((nicheH-(dCount+1)*gap)/dCount);
        if(dH<20)return;
        cols.forEach(col=>{
          const dW=col.width-4;
          if(dW<50)return;
          for(let di=0;di<dCount;di++){
            const dy=niche.bottom+gap+(dH+gap)*di;
            const dg=new THREE.BoxGeometry(dW,dH-2,D-60);
            const dm=new THREE.Mesh(dg,MD);
            dm.position.set(ox+col.left+dW/2+2, LH+dy+dH/2, (D-60)/2+8);
            dm.castShadow=true; dm.userData={w:true}; scene.add(dm);
            const de=new THREE.LineSegments(new THREE.EdgesGeometry(dg),ME);
            de.position.copy(dm.position); de.userData={w:true}; scene.add(de);
          }
        });
      });
    }
    s.dividers.forEach(dv=>addBoard(ox+dv.pos,LH+T,0,T,H-2*T,D));
    if(s.hasRod){
      const rh=LH+Math.min(s.rodHeight,H-T*3);
      const g2=new THREE.CylinderGeometry(10,10,W-2*T-20,16);
      const rm=new THREE.Mesh(g2,MR); rm.rotation.z=Math.PI/2;
      rm.position.set(ox+W/2,rh,D/2); rm.castShadow=true; rm.userData={w:true}; scene.add(rm);
    }
    // ── Ножки (всегда, 4 шт, высота LH=100мм) ──
    {
      const legMat=new THREE.MeshStandardMaterial({color:0x888888,roughness:0.3,metalness:0.6});
      const legGeo=new THREE.CylinderGeometry(15,12,LH,12);
      const capGeo=new THREE.CylinderGeometry(20,20,6,12);
      [[ox+40,40],[ox+W-40,40],[ox+40,D-40],[ox+W-40,D-40]].forEach(([lx,lz])=>{
        const leg=new THREE.Mesh(legGeo,legMat);
        leg.position.set(lx,LH/2,lz); leg.castShadow=true; leg.userData={w:true}; scene.add(leg);
        const cap=new THREE.Mesh(capGeo,legMat);
        cap.position.set(lx,LH-3,lz); cap.castShadow=true; cap.userData={w:true}; scene.add(cap);
      });
    }
    if(s.facade.type!=='none'){
      const fm=s.facade.material==='mdf'?MFM:MFL;
      const count=s.facade.type==='doors3'?3:s.facade.type==='doors2'?2:1;
      const gap=4,thick=18,dw=(W-gap*(count+1))/count;
      for(let i=0;i<count;i++) addBoard(ox+gap+(dw+gap)*i,LH+gap,-thick,dw,H-gap*2,thick,fm,true);
    }
    ox+=W;
  });
  // ── Антресоль per-section ─────────────────────────────────
  {
    const LH=100; // высота ножек — константа
    const totalW=sections.reduce((a,s)=>a+s.width,0);
    let aox=-totalW/2;
    sections.forEach(s=>{
      if(s.antresol&&s.antresol.enabled){
        const AH=s.antresol.height, AW=s.width, AD=s.depth, ay=LH+s.height;
        addBoard(aox,ay,0,T,AH,AD);
        addBoard(aox+AW-T,ay,0,T,AH,AD);
        addBoard(aox+T,ay+AH-T,0,AW-2*T,T,AD);
        addBoard(aox+T,ay,0,AW-2*T,T,AD,ML2);
        addBoard(aox,ay,AD-8,AW,AH,8,MH);
        if(s.antresol.facade.type!=='none'){
          const fm=s.antresol.facade.material==='mdf'?MFM:MFL;
          const cnt=s.antresol.facade.type==='doors3'?3:s.antresol.facade.type==='doors2'?2:1;
          const gap=4,thick=18,dw=(AW-gap*(cnt+1))/cnt;
          for(let i=0;i<cnt;i++) addBoard(aox+gap+(dw+gap)*i,ay+gap,-thick,dw,AH-gap*2,thick,fm,true);
        }
      }

      aox+=s.width;
    });
  }
  updateStats();
  setTimeout(renderDimensions, 50); // после рендера кадра
}

/* ============================================================
   РАЗМЕРНЫЕ ЛИНИИ НА 3D
   Проецируем 3D точки в экранные координаты через camera
============================================================ */
let _dimEnabled = true; // можно скрыть кнопкой

function project3D(x, y, z){
  // Проецирует 3D точку в координаты viewport (px)
  const vp = document.getElementById('viewport');
  const vec = new THREE.Vector3(x, y, z);
  vec.project(camera);
  return {
    x: (vec.x * 0.5 + 0.5) * vp.clientWidth,
    y: (-vec.y * 0.5 + 0.5) * vp.clientHeight,
    behind: vec.z > 1
  };
}

function drawDimLine(overlay, p1, p2, label, offset=0, color='#1a5252'){
  if(p1.behind || p2.behind) return;
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len = Math.sqrt(dx*dx + dy*dy);
  if(len < 20) return;
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;

  // Перпендикулярный сдвиг
  const nx = -dy/len * offset, ny = dx/len * offset;
  const sx = p1.x + nx, sy = p1.y + ny;
  const ex = p2.x + nx, ey = p2.y + ny;
  const mx = (sx+ex)/2, my = (sy+ey)/2;

  // Линия
  const line = document.createElement('div');
  line.className = 'dim-line';
  line.style.cssText = `left:${sx}px;top:${sy}px;width:${len}px;height:1.5px;background:${color};
    transform:rotate(${angle}deg);transform-origin:0 50%`;
  overlay.appendChild(line);

  // Засечки на концах
  [-1,1].forEach(side=>{
    const tx = side<0 ? sx : ex;
    const ty = side<0 ? sy : ey;
    const tick = document.createElement('div');
    tick.className = 'dim-tick';
    tick.style.cssText = `left:${tx}px;top:${ty-5}px;width:1.5px;height:10px;background:${color};
      transform:rotate(${angle}deg);transform-origin:0 50%`;
    overlay.appendChild(tick);
  });

  // Метка
  const lbl = document.createElement('div');
  lbl.className = 'dim-label';
  lbl.style.cssText = `left:${mx}px;top:${my}px;background:${color}`;
  lbl.textContent = label;
  overlay.appendChild(lbl);
}

function renderDimensions(){
  const overlay = document.getElementById('dim-overlay');
  if(!overlay || !camera || !_dimEnabled || !sections.length) return;
  overlay.innerHTML = '';

  const totalW = sections.reduce((a,s)=>a+s.width, 0);
  let ox = -totalW / 2;

  sections.forEach((s, idx) => {
    const W=s.width, H=s.height, D=s.depth;
    const cx = ox + W/2;

    // Ширина каждой секции — снизу под шкафом
    const wL = project3D(ox,    -60, D/2);
    const wR = project3D(ox+W,  -60, D/2);
    drawDimLine(overlay, wL, wR, W+'мм', 0, '#1a5252');

    // Высота — слева от первой секции
    if(idx === 0){
      const hB = project3D(ox-60, 0,   D/2);
      const hT = project3D(ox-60, H,   D/2);
      drawDimLine(overlay, hB, hT, H+'мм', 0, '#534AB7');
    }

    ox += W;
  });

  // Общая ширина — если больше одной секции
  if(sections.length > 1){
    const ox0 = -totalW/2;
    const aL = project3D(ox0,       -140, (sections[0]?.depth||600)/2);
    const aR = project3D(ox0+totalW, -140, (sections[0]?.depth||600)/2);
    drawDimLine(overlay, aL, aR, totalW+'мм', 0, '#8B4513');
  }

  // Глубина — сбоку от последней секции
  const last = sections[sections.length-1];
  const ox1 = totalW/2;
  const dF = project3D(ox1+60, last.height/2, 0);
  const dB = project3D(ox1+60, last.height/2, last.depth);
  drawDimLine(overlay, dF, dB, last.depth+'мм', 0, '#0F6E56');
}

// Кнопка вкл/выкл размеров
function toggleDimensions(){
  _dimEnabled = !_dimEnabled;
  const btn = document.getElementById('dim-toggle-btn');
  if(btn) btn.style.background = _dimEnabled ? '#1a5252' : '#aaa';
  if(!_dimEnabled){ const o=document.getElementById('dim-overlay');if(o)o.innerHTML=''; }
  else renderDimensions();
}

/* ============================================================
   КОНЕЦ РАЗМЕРНЫХ ЛИНИЙ
============================================================ */
function calcParts(){
  const ldsp=[],hdf=[],facLdsp=[],facMdf=[];
  const edgeRows=[];
  let partNum=0; // сквозная нумерация деталей

  sections.forEach((s,i)=>{
    const W=s.width,H=s.height,D=s.depth,L=`С${i+1}`;
    const ef=s.edgeFront||'2mm', eb=s.edgeBack||'04mm';

    // helper: add edge for a part
    // visibleEdges: array of lengths in мм that get "front" кромку
    // hiddenEdges: array of lengths that get "back" кромку
    function addEdge(name,visEdges,hidEdges){
      const pm04=(
        (ef==='04mm'?visEdges.reduce((a,v)=>a+v,0):0) +
        (eb==='04mm'?hidEdges.reduce((a,v)=>a+v,0):0)
      )/1000;
      const pm2=(
        (ef==='2mm'?visEdges.reduce((a,v)=>a+v,0):0) +
        (eb==='2mm'?hidEdges.reduce((a,v)=>a+v,0):0)
      )/1000;
      if(pm04>0||pm2>0) edgeRows.push({name,pm04,pm2});
    }

    // Боковины: видимые — передний торец (H) и верхний (D), скрытые — задний (H) и нижний (D)
    ldsp.push({name:`${L} Бок лев`,w:D,h:H,tex:false,edgeFront:ef,edgeBack:eb});
    addEdge(`${L} Бок лев`,[H,D],[H,D]);
    ldsp.push({name:`${L} Бок пр`,w:D,h:H,tex:false,edgeFront:ef,edgeBack:eb});
    addEdge(`${L} Бок пр`,[H,D],[H,D]);

    // Крыша: видимый — передний торец (W-2T), скрытый — остальные
    ldsp.push({name:`${L} Крыша`,w:W-2*T,h:D,tex:false,edgeFront:ef,edgeBack:eb});
    addEdge(`${L} Крыша`,[W-2*T],[D,D,W-2*T]);

    // Дно: видимый — передний торец (W-2T)
    ldsp.push({name:`${L} Дно`,w:W-2*T,h:D,tex:false,edgeFront:ef,edgeBack:eb});
    addEdge(`${L} Дно`,[W-2*T],[D,D,W-2*T]);

    // Полки: видимый — передний торец (W-2T)
    s.shelves.forEach((sh,j)=>{
      ldsp.push({name:`${L} Полка ${j+1}`,w:W-2*T,h:D,tex:false,edgeFront:ef,edgeBack:eb});
      addEdge(`${L} Полка ${j+1}`,[W-2*T],[D,D,W-2*T]);
    });

    // Перегородки: видимые — оба торца по высоте (H-2T)
    s.dividers.forEach((dv,j)=>{
      ldsp.push({name:`${L} Перегор.${j+1}`,w:D,h:H-2*T,tex:false,edgeFront:ef,edgeBack:eb});
      addEdge(`${L} Перегор.${j+1}`,[H-2*T,H-2*T],[D,D]);
    });

    // Ящики по нишам и колонкам
    if(s.drawerBlocks&&s.drawerBlocks.length>0){
      const nichesCalc=getNiches(s);
      const colsCalc=getColumns(s);
      let drawerNum=0;
      s.drawerBlocks.forEach((db,bi)=>{
        const niche=nichesCalc[db.nicheIdx];
        if(!niche)return;
        const gap=4, dCount=db.count;
        const nicheH=niche.top-niche.bottom;
        const dH=Math.floor((nicheH-(dCount+1)*gap)/dCount);
        const dD=D-60;
        colsCalc.forEach((col,ci)=>{
          const dW=col.width-4;
          if(dW<50)return;
          for(let di=0;di<dCount;di++){
            drawerNum++;
            const lbl=colsCalc.length>1?`${L} К${ci+1} Яш.${drawerNum}`:`${L} Яш.${drawerNum}`;
            const facPart={name:`${lbl} фас`,w:dW,h:dH,tex:s.facade.hasTexture};
            if(s.facade.material==='mdf') facMdf.push(facPart);
            else facLdsp.push(facPart);
            ldsp.push({name:`${lbl} дно`,w:dW,h:dD,tex:false});
            ldsp.push({name:`${lbl} бок.л`,w:dD,h:dH-2*T,tex:false});
            ldsp.push({name:`${lbl} бок.п`,w:dD,h:dH-2*T,tex:false});
            ldsp.push({name:`${lbl} пер`,w:dW-2*T,h:dH-2*T,tex:false});
            ldsp.push({name:`${lbl} зад`,w:dW-2*T,h:dH-2*T,tex:false});
          }
        });
      });
    }

    // Задняя стенка — без кромки
    hdf.push({name:`${L} Задняя`,w:W,h:H,tex:false});


    // Фасады: кромка по всему периметру — передний тип
    if(s.facade.type!=='none'){
      const count=s.facade.type==='doors3'?3:s.facade.type==='doors2'?2:1;
      const gap=4,dw=Math.round((W-gap*(count+1))/count),dh=H-gap*2;
      for(let i=0;i<count;i++){
        const p={name:`${L} Фасад ${i+1}`,w:dw,h:dh,tex:s.facade.hasTexture};
        if(s.facade.material==='mdf') facMdf.push(p); else facLdsp.push(p);
        // фасад — весь периметр лицевой кромкой
        if(s.facade.material==='ldsp'){
          addEdge(`${L} Фасад ${i+1}`,[dw*2+dh*2],[]);
        }
      }
    }
  });

  // Merge edgeRows by summing
  const totalPm04=edgeRows.reduce((a,r)=>a+r.pm04,0);
  const totalPm2=edgeRows.reduce((a,r)=>a+r.pm2,0);

  // Антресоль per-section
  sections.forEach((s,si)=>{
    if(!s.antresol||!s.antresol.enabled)return;
    const AH=s.antresol.height, AW=s.width, AD=s.depth, L=`С${si+1}А`;
    ldsp.push({name:`${L} Бок лев`,w:AD,h:AH,tex:false});
    ldsp.push({name:`${L} Бок пр`,w:AD,h:AH,tex:false});
    ldsp.push({name:`${L} Крыша`,w:AW-2*T,h:AD,tex:false});
    ldsp.push({name:`${L} Дно`,w:AW-2*T,h:AD,tex:false});
    hdf.push({name:`${L} Задняя`,w:AW,h:AH,tex:false});
    if(s.antresol.facade.type!=='none'){
      const cnt=s.antresol.facade.type==='doors3'?3:s.antresol.facade.type==='doors2'?2:1;
      const gap=4,dw=Math.round((AW-gap*(cnt+1))/cnt),dh=AH-gap*2;
      for(let i=0;i<cnt;i++){
        const p={name:`${L} Фасад ${i+1}`,w:dw,h:dh,tex:false};
        if(s.antresol.facade.material==='mdf') facMdf.push(p); else facLdsp.push(p);
      }
    }
  });

  // Нумерация деталей
  let n=1;
  ldsp.forEach(p=>p.num=n++);
  hdf.forEach(p=>p.num=n++);
  facLdsp.forEach(p=>p.num=n++);
  facMdf.forEach(p=>p.num=n++);
  return{ldsp,hdf,facLdsp,facMdf,edgeRows,totalPm04,totalPm2};
}

/* ============================================================
   BIN PACKING — Guillotine + MAXRECTS-style best short side
============================================================ */
function packSheets(parts,SW,SH,label,allowRotate,preferLong){
  if(!parts.length)return[];
  const gap=4;
  // Предобработка: если preferLong — ориентируем деталь так чтобы
  // её длинная сторона шла вдоль длинной стороны листа (SW)
  if(preferLong){
    parts=parts.map(p=>{
      if(p.w<p.h && p.h<=SW && p.w<=SH){
        // поворачиваем: длинная сторона (h) → по X (вдоль SW)
        return{...p,w:p.h,h:p.w,_preRotated:true};
      }
      return p;
    });
  }
  function tryFit(p,rect,canRot){
    if(p.w+gap<=rect.w&&p.h+gap<=rect.h) return{rotated:false,uw:p.w,uh:p.h};
    if(canRot&&p.h+gap<=rect.w&&p.w+gap<=rect.h) return{rotated:true,uw:p.h,uh:p.w};
    return null;
  }
  function splitRect(rect,uw,uh){
    const r=[];
    if(rect.w-(uw+gap)>10) r.push({x:rect.x+uw+gap,y:rect.y,w:rect.w-(uw+gap),h:uh+gap});
    if(rect.h-(uh+gap)>10) r.push({x:rect.x,y:rect.y+uh+gap,w:rect.w,h:rect.h-(uh+gap)});
    return r;
  }
  const sheets=[];
  [...parts].sort((a,b)=>b.w*b.h-a.w*a.h).forEach(p=>{
    let placed=false;
    for(const sh of sheets){
      let best=null,bestRi=-1,bestScore=Infinity;
      sh.free.forEach((rect,ri)=>{
        const f=tryFit(p,rect,allowRotate);
        if(f){const sc=Math.min(rect.w-f.uw,rect.h-f.uh);if(sc<bestScore){bestScore=sc;best={...f,x:rect.x,y:rect.y};bestRi=ri;}}
      });
      if(best){
        sh.items.push({name:p.name,w:best.uw,h:best.uh,x:best.x,y:best.y,rotated:best.rotated,tex:p.tex});
        sh.free.splice(bestRi,1,...splitRect(sh.free[bestRi],best.uw,best.uh));
        placed=true;break;
      }
    }
    if(!placed){
      const sh={label:`${label} Лист ${sheets.length+1}`,items:[],free:[{x:0,y:0,w:SW,h:SH}]};
      const f=tryFit(p,sh.free[0],allowRotate);
      if(f){
        sh.items.push({name:p.name,w:f.uw,h:f.uh,x:0,y:0,rotated:f.rotated,tex:p.tex});
        sh.free=splitRect(sh.free[0],f.uw,f.uh);
      }
      sheets.push(sh);
    }
  });
  return sheets;
}

/* ============================================================
   COST CALCULATION — по занятой ширине листа (сторона SH = 1830мм)
   Для каждого листа берём максимальный Y+H среди всех деталей —
   это сколько "занято" по стороне 1830. Стоимость = (maxY / SH) × цена.
============================================================ */
function calcSheetsCost(sheets,SW,SH,pricePerSheet){
  return sheets.reduce((total,sh)=>{
    // максимальная занятая координата по оси Y (сторона SH=1830)
    const maxY=sh.items.reduce((m,it)=>Math.max(m,it.y+it.h),0);
    const ratio=Math.min(maxY/SH,1); // не более 1 листа
    return total+ratio*pricePerSheet;
  },0);
}

function calcAllCosts(){
  const{ldsp,hdf,facLdsp,facMdf,totalPm04,totalPm2,edgeRows}=calcParts();

  const ldspSheets=packSheets(ldsp,LDSP_W,LDSP_H,'',true);
  const hdfSheets=packSheets(hdf,HDF_W,HDF_H,'',false,true); // ХДФ: без поворота, длинная сторона по X
  const facTex=facLdsp.filter(p=>p.tex);
  const facNoTex=facLdsp.filter(p=>!p.tex);
  const facTexSheets=packSheets(facTex,LDSP_W,LDSP_H,'',false);
  const facNoTexSheets=packSheets(facNoTex,LDSP_W,LDSP_H,'',true);

  const ldspPricePerSheet=matChoice.ldspPrice||0;
  const hdfPricePerSheet=catalog.hdf||0;
  const ldspCost=calcSheetsCost(ldspSheets,LDSP_W,LDSP_H,ldspPricePerSheet);
  const hdfCost=calcSheetsCost(hdfSheets,HDF_W,HDF_H,hdfPricePerSheet);
  const facLdspCost=calcSheetsCost([...facTexSheets,...facNoTexSheets],LDSP_W,LDSP_H,ldspPricePerSheet);

  const mdfM2=facMdf.reduce((a,p)=>a+p.w*p.h/1e6,0);
  const mdfM2Total=mdfM2*(1+(prices.mdfWaste||0)/100);
  const mdfPricePerM2=matChoice.mdfPrice||0;
  const mdfCost=mdfM2Total*mdfPricePerM2;

  const edgeCost04=totalPm04*(catalog.edgeThin||0);
  const edgeCost2=totalPm2*prices.edgeThick;
  const edgeCost=edgeCost04+edgeCost2;

  // направляющие
  const totalDrawerPairs=sections.reduce((a,s)=>a+(s.drawerBlocks?s.drawerBlocks.reduce((b,db)=>b+db.count,0):0),0);
  const drawerCost=0; // теперь стоимость направляющих — в телескопах

  // петли — 2 шт на дверь до 1500мм высотой, 3 шт если выше
  let totalHinges=0, totalHandles=0;
  let slideDetails=[]; // [{width,brand,type,length,price,count}]

  sections.forEach(s=>{
    if(s.facade.type!=='none'){
      const doorCount=s.facade.type==='doors3'?3:s.facade.type==='doors2'?2:1;
      const doorH=s.height-8;
      totalHinges+=doorCount*(doorH>1500?3:2);
      totalHandles+=doorCount;
    }
    if(s.drawerBlocks) totalHandles+=s.drawerBlocks.reduce((b,db)=>b+db.count,0);
    // телескопы
    if(s.drawerBlocks&&s.drawerBlocks.length>0){
      const colCount=getColumns(s).length;
      const sl=pickSlide(s.depth||600);
      if(sl){
        const totalDrawers=s.drawerBlocks.reduce((b,db)=>b+db.count,0)*colCount;
        const existing=slideDetails.find(x=>x.brand===sl.brand&&x.length===sl.length&&x.type===sl.type);
        if(existing) existing.count+=totalDrawers;
        else slideDetails.push({...sl,count:totalDrawers});
      }
    }
  });
  // антресоль петли per-section
  sections.forEach(s=>{
    if(s.antresol&&s.antresol.enabled&&s.antresol.facade.type!=='none'){
      const cnt=s.antresol.facade.type==='doors3'?3:s.antresol.facade.type==='doors2'?2:1;
      totalHinges+=cnt*(s.antresol.height>1500?3:2);
      totalHandles+=cnt;
    }
  });
  const hp=hingePrice();
  const hingeCost=totalHinges*hp;
  const handleCost=totalHandles*prices.handle;
  const slideCost=slideDetails.reduce((a,sl)=>a+sl.price*sl.count,0);
  const hardwareCost=hingeCost+handleCost+slideCost;

  // ── Стоимость работ ──────────────────────────────────────────
  const totalLdspSheets=(ldspSheets.length)+(facTexSheets.length+facNoTexSheets.length);
  const totalEdgePm=totalPm04+totalPm2;
  const totalSections=sections.length;
  // считаем двери и ящики по всем секциям + антресолям
  let totalDoors=0, totalDrawerUnits=0;
  sections.forEach(s=>{
    if(s.facade.type!=='none'){
      totalDoors+=s.facade.type==='doors3'?3:s.facade.type==='doors2'?2:1;
    }
    if(s.antresol&&s.antresol.enabled&&s.antresol.facade.type!=='none'){
      totalDoors+=s.antresol.facade.type==='doors3'?3:s.antresol.facade.type==='doors2'?2:1;
    }
    if(s.drawerBlocks) totalDrawerUnits+=s.drawerBlocks.reduce((b,db)=>b+db.count,0)*getColumns(s).length;
  });
  const workCutCost      = totalLdspSheets * (prices.workCut||0);
  const workEdgeCost     = totalEdgePm     * (prices.workEdge||0);
  const workAssemblyCost = totalSections   * (prices.workAssembly||0);
  const workInstallCost  =                   (prices.workInstall||0);
  const workFacadeCost   = totalDoors      * (prices.workFacade||0);
  const workDrawerCost   = totalDrawerUnits* (prices.workDrawer||0);
  const workTotal = workCutCost+workEdgeCost+workAssemblyCost+workInstallCost+workFacadeCost+workDrawerCost;

  const matTotal = ldspCost+hdfCost+facLdspCost+mdfCost+edgeCost+drawerCost+hardwareCost;

  // Дробные эквиваленты листов (как в КП: занятая высота / высота листа)
  const ldspEquiv    = ldspSheets.length>0 ? ldspSheets.reduce((a,sh)=>a+sh.items.reduce((m,it)=>Math.max(m,it.y+it.h),0),0)/LDSP_H : 0;
  const hdfEquiv     = hdfSheets.length>0  ? hdfSheets.reduce((a,sh)=>a+sh.items.reduce((m,it)=>Math.max(m,it.y+it.h),0),0)/HDF_H  : 0;
  const _facAll      = [...facTexSheets,...facNoTexSheets];
  const facLdspEquiv = _facAll.length>0    ? _facAll.reduce((a,sh)=>a+sh.items.reduce((m,it)=>Math.max(m,it.y+it.h),0),0)/LDSP_H   : 0;

  // Штанги — 1 секция с штангой = 1 штанга
  const totalRods = sections.reduce((a,s) => a + (s.hasRod ? 1 : 0), 0);
  const totalLegs = sections.length * 4; // ножки всегда, 4 шт на секцию
  const legPrice  = prices.leg || 500;
  const legCost   = totalLegs * legPrice;
  const rodPrice  = prices.rod || 2000;
  const rodCost   = totalRods * rodPrice;

  return{
    ldspSheets,hdfSheets,facTexSheets,facNoTexSheets,facMdf,
    ldspCost,hdfCost,facLdspCost,mdfM2,mdfM2Total,mdfCost,
    ldspPricePerSheet,hdfPricePerSheet,mdfPricePerM2,
    edgeRows,totalPm04,totalPm2,edgeCost04,edgeCost2,edgeCost,
    totalDrawerPairs,drawerCost,
    totalHinges,hingeCost,totalHandles,handleCost,slideDetails,slideCost,hardwareCost,
    totalRods, rodPrice, rodCost,
    totalLegs, legPrice, legCost,
    ldspCount:ldspSheets.length, hdfCount:hdfSheets.length,
    facLdspCount:facTexSheets.length+facNoTexSheets.length,
    ldspEquiv, hdfEquiv, facLdspEquiv,
    totalLdspSheets,totalEdgePm,totalSections,totalDoors,totalDrawerUnits,
    workCutCost,workEdgeCost,workAssemblyCost,workInstallCost,workFacadeCost,workDrawerCost,workTotal,
    matTotal: matTotal + rodCost + legCost, total: matTotal + rodCost + legCost + workTotal
  };
}

/* ============================================================
   SPEC MODAL
============================================================ */
function fmt(n){ return Math.round(n).toLocaleString('ru-RU'); }

function showSpec(){
  const d=calcAllCosts();
  let html=`<div class="spec-note">Стоимость считается по занятой ширине листа (сторона 1830мм): сколько мм занято по ширине ÷ 1830 × цена листа.</div>`;
  html+=`<table class="spec-table">
    <thead><tr><th>Материал</th><th class="num">Занято 1830</th><th class="num">Ед.</th><th class="num">Цена ₸/лист</th><th class="num">Сумма ₸</th></tr></thead>
    <tbody>`;

  // helper — максимальный Y по листам
  function sheetsMaxY(sheets){
    return sheets.reduce((a,sh)=>a+sh.items.reduce((m,it)=>Math.max(m,it.y+it.h),0),0);
  }

  // ЛДСП корпус
  if(d.ldspCount>0){
    const totalMaxY=d.ldspSheets.reduce((a,sh)=>a+sh.items.reduce((m,it)=>Math.max(m,it.y+it.h),0),0);
    const equiv=(totalMaxY/LDSP_H).toFixed(2); // эквивалент листов по ширине
    html+=`<tr>
      <td><span class="color-dot" style="background:#c8a96e;margin-right:6px"></span>${matChoice.ldspName?matChoice.ldspName+' — ':''}ЛДСП корпус 2750×1830<br>
        <span style="font-size:10px;color:#888">${d.ldspCount} лист(ов), занято ${Math.round(totalMaxY/d.ldspCount)} мм из 1830</span></td>
      <td class="num">${equiv}</td>
      <td class="num">лист</td>
      <td class="num">${fmt(d.ldspPricePerSheet)}</td>
      <td class="num"><b>${fmt(d.ldspCost)}</b></td>
    </tr>`;
  }

  // ХДФ
  if(d.hdfCount>0){
    const totalMaxY=d.hdfSheets.reduce((a,sh)=>a+sh.items.reduce((m,it)=>Math.max(m,it.y+it.h),0),0);
    const equiv=(totalMaxY/HDF_H).toFixed(2);
    html+=`<tr>
      <td><span class="color-dot" style="background:#d4c49a;margin-right:6px"></span>ХДФ задняя стенка 2800×2070<br>
        <span style="font-size:10px;color:#888">${d.hdfCount} лист(ов), занято ${Math.round(totalMaxY/d.hdfCount)} мм из 2070</span></td>
      <td class="num">${equiv}</td>
      <td class="num">лист</td>
      <td class="num">${fmt(d.hdfPricePerSheet)}</td>
      <td class="num"><b>${fmt(d.hdfCost)}</b></td>
    </tr>`;
  }

  // ЛДСП фасад
  if(d.facLdspCount>0){
    const allFacSheets=[...d.facTexSheets,...d.facNoTexSheets];
    const totalMaxY=allFacSheets.reduce((a,sh)=>a+sh.items.reduce((m,it)=>Math.max(m,it.y+it.h),0),0);
    const equiv=(totalMaxY/LDSP_H).toFixed(2);
    html+=`<tr>
      <td><span class="color-dot" style="background:#e2c484;margin-right:6px"></span>${matChoice.ldspName?matChoice.ldspName+' — ':''}ЛДСП фасад 2750×1830<br>
        <span style="font-size:10px;color:#888">${d.facLdspCount} лист(ов), занято ${Math.round(totalMaxY/d.facLdspCount)} мм из 1830</span></td>
      <td class="num">${equiv}</td>
      <td class="num">лист</td>
      <td class="num">${fmt(d.ldspPricePerSheet)}</td>
      <td class="num"><b>${fmt(d.facLdspCost)}</b></td>
    </tr>`;
  }

  // МДФ
  if(d.mdfM2>0){
    html+=`<tr>
      <td><span class="color-dot" style="background:#fff0d4;border:1px solid #ccc;margin-right:6px"></span>${matChoice.mdfName||'МДФ'} фасад<br>
        <span style="font-size:10px;color:#888">+${prices.mdfWaste}% отход → итого ${d.mdfM2Total.toFixed(3)} м²</span></td>
      <td class="num">${d.mdfM2Total.toFixed(3)}</td>
      <td class="num">м²</td>
      <td class="num">${fmt(d.mdfPricePerM2)}</td>
      <td class="num"><b>${fmt(d.mdfCost)}</b></td>
    </tr>`;
  }

  // Кромка
  if(d.totalPm04>0){
    html+=`<tr>
      <td><span class="color-dot" style="background:#e8896d;margin-right:6px"></span>Кромка ПВХ 0.4 мм<br>
        <span style="font-size:10px;color:#888">скрытые торцы (из каталога)</span></td>
      <td class="num">${d.totalPm04.toFixed(2)}</td>
      <td class="num">пм</td>
      <td class="num">${fmt(catalog.edgeThin||0)}</td>
      <td class="num"><b>${fmt(d.edgeCost04)}</b></td>
    </tr>`;
  }
  if(d.totalPm2>0){
    html+=`<tr>
      <td><span class="color-dot" style="background:#c0392b;margin-right:6px"></span>Кромка ПВХ 2 мм<br>
        <span style="font-size:10px;color:#888">лицевые торцы</span></td>
      <td class="num">${d.totalPm2.toFixed(2)}</td>
      <td class="num">пм</td>
      <td class="num">${fmt(prices.edgeThick)}</td>
      <td class="num"><b>${fmt(d.edgeCost2)}</b></td>
    </tr>`;
  }

  // Петли
  if(d.totalHinges>0){
    html+=`<tr>
      <td><span class="color-dot" style="background:#e67e22;margin-right:6px"></span>Петли ${activehingeBrand}<br>
        <span style="font-size:10px;color:#888">авто: 2 шт/дверь до 1500мм, 3 шт выше</span></td>
      <td class="num">${d.totalHinges}</td>
      <td class="num">шт</td>
      <td class="num">${fmt(hingePrice())}</td>
      <td class="num"><b>${fmt(d.hingeCost)}</b></td>
    </tr>`;
  }
  // Телескопы
  d.slideDetails.forEach(sl=>{
    html+=`<tr>
      <td><span class="color-dot" style="background:#7986cb;margin-right:6px"></span>${sl.brand} ${sl.type} ${sl.length}мм<br>
        <span style="font-size:10px;color:#888">авто по ширине модуля</span></td>
      <td class="num">${sl.count}</td>
      <td class="num">пара</td>
      <td class="num">${fmt(sl.price)}</td>
      <td class="num"><b>${fmt(sl.price*sl.count)}</b></td>
    </tr>`;
  });
  // Ручки
  if(d.totalHandles>0){
    html+=`<tr>
      <td><span class="color-dot" style="background:#d35400;margin-right:6px"></span>Ручки<br>
        <span style="font-size:10px;color:#888">двери: ${d.totalHandles-(sections.reduce((a,s)=>a+(s.drawerBlocks?s.drawerBlocks.reduce((b,db)=>b+db.count,0):0),0))} шт, ящики: ${sections.reduce((a,s)=>a+(s.drawerBlocks?s.drawerBlocks.reduce((b,db)=>b+db.count,0):0),0)} шт</span></td>
      <td class="num">${d.totalHandles}</td>
      <td class="num">шт</td>
      <td class="num">${fmt(prices.handle)}</td>
      <td class="num"><b>${fmt(d.handleCost)}</b></td>
    </tr>`;
  }

  html+=`</tbody></table>`;
  html+=`<div class="spec-total" style="background:#2a4a8a;margin-top:0;border-radius:0">
    <span>Итого материалы</span>
    <span>${fmt(d.matTotal)} ₸</span>
  </div>`;

  // ── Работы ──────────────────────────────────────────────────
  const hasWork=d.workTotal>0;
  if(hasWork||true){ // всегда показываем блок работ (даже нулевой — чтобы было видно)
    html+=`<div style="padding:12px 0 4px;font-size:11px;font-weight:700;color:#1a3a8a;text-transform:uppercase;letter-spacing:.04em;border-top:1px solid #eee;margin-top:8px">
      <i class="ti ti-tools" style="margin-right:4px"></i> Стоимость работ
    </div>`;
    html+=`<table class="spec-table"><thead><tr><th>Вид работ</th><th class="num">Кол.</th><th class="num">Ед.</th><th class="num">Расценка ₸</th><th class="num">Сумма ₸</th></tr></thead><tbody>`;

    const workRows=[
      {name:'Раскрой ЛДСП', q:d.totalLdspSheets, unit:'лист', rate:prices.workCut||0,    cost:d.workCutCost,      show:d.totalLdspSheets>0},
      {name:'Кромкование',   q:+d.totalEdgePm.toFixed(2), unit:'пм',   rate:prices.workEdge||0,   cost:d.workEdgeCost,     show:d.totalEdgePm>0},
      {name:'Сборка корпуса',q:d.totalSections,  unit:'секц.', rate:prices.workAssembly||0,cost:d.workAssemblyCost, show:d.totalSections>0},
      {name:'Установка на месте',q:1,             unit:'проект',rate:prices.workInstall||0,cost:d.workInstallCost,  show:true},
      {name:'Установка фасадов',q:d.totalDoors,   unit:'дверь', rate:prices.workFacade||0, cost:d.workFacadeCost,   show:d.totalDoors>0},
      {name:'Установка ящиков',  q:d.totalDrawerUnits,unit:'ящик',rate:prices.workDrawer||0,cost:d.workDrawerCost,  show:d.totalDrawerUnits>0},
    ];
    workRows.filter(r=>r.show).forEach(r=>{
      const noPrice=r.rate===0;
      html+=`<tr${noPrice?' style="color:#bbb"':''}>
        <td>${r.name}${noPrice?'<span style="font-size:10px;color:#ccc;margin-left:6px">— не задана</span>':''}</td>
        <td class="num">${r.q}</td>
        <td class="num">${r.unit}</td>
        <td class="num">${noPrice?'—':fmt(r.rate)}</td>
        <td class="num"><b>${noPrice?'—':fmt(r.cost)}</b></td>
      </tr>`;
    });
    html+=`</tbody></table>`;
    html+=`<div class="spec-total" style="background:#1a3a8a;border-radius:0;margin-top:0">
      <span>Итого работы</span>
      <span>${fmt(d.workTotal)} ₸${d.workTotal===0?' <span style="font-size:11px;opacity:.6">(расценки не заданы)</span>':''}</span>
    </div>`;
  }

  html+=`<div class="spec-total" style="border-radius:0 0 8px 8px;margin-top:0;font-size:16px">
    <span>ИТОГО (материалы + работы)</span>
    <span>${fmt(d.total)} ₸</span>
  </div>`;

  document.getElementById('spec-content').innerHTML=html;
  document.getElementById('spec-modal').style.display='block';
}

function closeSpec(){ document.getElementById('spec-modal').style.display='none'; }

/* ============================================================
   KP — КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ
============================================================ */
function confShowKP(){
  const d = calcAllCosts();
  const meta = {
    name:   (document.getElementById('proj-name-inp')  ||{}).value || 'Шкаф',
    client: (document.getElementById('proj-client-inp')||{}).value || '',
    date:   (document.getElementById('proj-date-inp')  ||{}).value || '',
  };

  // Размеры изделия
  const totalW  = sections.reduce((a,s)=>a+s.width,0);
  const maxH    = Math.max(...sections.map(s=>s.height+(s.antresol&&s.antresol.enabled?s.antresol.height:0)));
  const maxD    = Math.max(...sections.map(s=>s.depth));
  const secCount = sections.length;

  const dateStr = meta.date
    ? new Date(meta.date).toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'})
    : new Date().toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'});

  const kpNum = 'КП-' + (activeProjectId||'').slice(1,7).toUpperCase();

  // ── Таблица материалов ─────────────────────────────────────
  let matRows = '';

  if(d.ldspCount>0){
    const totalMaxY=d.ldspSheets.reduce((a,sh)=>a+sh.items.reduce((m,it)=>Math.max(m,it.y+it.h),0),0);
    const equiv=+(totalMaxY/LDSP_H).toFixed(2);
    matRows+=kpRow('ЛДСП корпус'+(matChoice.ldspName?' ('+matChoice.ldspName+')':''),equiv,'л',fmt(d.ldspPricePerSheet),fmt(d.ldspCost));
  }
  if(d.hdfCount>0){
    const totalMaxY=d.hdfSheets.reduce((a,sh)=>a+sh.items.reduce((m,it)=>Math.max(m,it.y+it.h),0),0);
    const equiv=+(totalMaxY/HDF_H).toFixed(2);
    matRows+=kpRow('ХДФ задние стенки',equiv,'л',fmt(d.hdfPricePerSheet),fmt(d.hdfCost));
  }
  if(d.facLdspCount>0){
    const allFs=[...d.facTexSheets,...d.facNoTexSheets];
    const totalMaxY=allFs.reduce((a,sh)=>a+sh.items.reduce((m,it)=>Math.max(m,it.y+it.h),0),0);
    const equiv=+(totalMaxY/LDSP_H).toFixed(2);
    matRows+=kpRow('ЛДСП фасад'+(matChoice.ldspName?' ('+matChoice.ldspName+')':''),equiv,'л',fmt(d.ldspPricePerSheet),fmt(d.facLdspCost));
  }
  if(d.mdfM2>0){
    matRows+=kpRow('МДФ фасад'+(matChoice.mdfName?' ('+matChoice.mdfName+')':''),d.mdfM2Total.toFixed(3),'м²',fmt(d.mdfPricePerM2),fmt(d.mdfCost));
  }
  if(d.totalPm04>0) matRows+=kpRow('Кромка ПВХ 0.4 мм',d.totalPm04.toFixed(2),'пм',fmt(catalog.edgeThin||0),fmt(d.edgeCost04));
  if(d.totalPm2>0)  matRows+=kpRow('Кромка ПВХ 2 мм',d.totalPm2.toFixed(2),'пм',fmt(prices.edgeThick),fmt(d.edgeCost2));
  if(d.totalHinges>0) matRows+=kpRow('Петли '+activehingeBrand,d.totalHinges,'шт',fmt(hingePrice()),fmt(d.hingeCost));
  d.slideDetails.forEach(sl=>{
    matRows+=kpRow(sl.brand+' '+sl.type+' '+sl.length+'мм',sl.count,'пара',fmt(sl.price),fmt(sl.price*sl.count));
  });
  if(d.totalRods>0) matRows+=kpRow('Штанга для одежды',d.totalRods,'шт',fmt(d.rodPrice),fmt(d.rodCost));
  if(d.totalLegs>0) matRows+=kpRow('Ножки',d.totalLegs,'шт',fmt(d.legPrice),fmt(d.legCost));
  if(d.totalHandles>0) matRows+=kpRow('Ручки',d.totalHandles,'шт',fmt(prices.handle),fmt(d.handleCost));

  // ── Таблица работ ──────────────────────────────────────────
  let workRows = '';
  const wDefs=[
    ['Раскрой ЛДСП',        d.totalLdspSheets,   'лист',   prices.workCut||0,      d.workCutCost],
    ['Кромкование',          +d.totalEdgePm.toFixed(2),'пм',prices.workEdge||0,     d.workEdgeCost],
    ['Сборка корпуса',       d.totalSections,     'секц.',  prices.workAssembly||0, d.workAssemblyCost],
    ['Установка на месте',   1,                   'проект', prices.workInstall||0,  d.workInstallCost],
    ['Установка фасадов',    d.totalDoors,        'дверь',  prices.workFacade||0,   d.workFacadeCost],
    ['Установка ящиков',     d.totalDrawerUnits,  'ящик',   prices.workDrawer||0,   d.workDrawerCost],
  ];
  wDefs.forEach(([name,q,unit,rate,cost])=>{
    if(rate>0) workRows+=kpRow(name,q,unit,fmt(rate),fmt(cost));
  });

  // ── Секции шкафа (компонент) ───────────────────────────────
  const secSummary = sections.map((s,i)=>{
    const parts=[];
    if(s.shelves.length) parts.push(`${s.shelves.length} пол.`);
    if(s.dividers.length) parts.push(`${s.dividers.length} пер.`);
    if(s.hasRod) parts.push('штанга');
    if(s.drawerBlocks&&s.drawerBlocks.length){
      const total=s.drawerBlocks.reduce((a,b)=>a+b.count,0)*getColumns(s).length;
      parts.push(`${total} ящ.`);
    }
    if(s.facade.type!=='none'){
      const dc=s.facade.type==='doors3'?3:s.facade.type==='doors2'?2:1;
      parts.push(`${dc} дв. ${s.facade.material.toUpperCase()}`);
    }
    const antrStr=s.antresol&&s.antresol.enabled?` + антресоль ${s.antresol.height}мм`:'';
    return `<tr><td style="color:#888;font-size:12px">С${i+1}</td>
      <td style="font-size:12px">${s.width}×${s.height}×${s.depth} мм${antrStr}</td>
      <td style="font-size:12px;color:#555">${parts.join(', ')||'—'}</td></tr>`;
  }).join('');

  const html = `
  <div class="kp-header">
    <div class="kp-company">Коммерческое предложение ${kpNum}</div>
    <div class="kp-title">${meta.name||'Шкаф-купе'}</div>
    <div class="kp-subtitle">${meta.client?'Клиент: '+meta.client:''}</div>
    <div class="kp-meta-grid">
      <div class="kp-meta-item">
        <div class="kp-meta-lbl">Ширина</div>
        <div class="kp-meta-val">${(totalW/1000).toFixed(2)} м</div>
      </div>
      <div class="kp-meta-item">
        <div class="kp-meta-lbl">Высота</div>
        <div class="kp-meta-val">${(maxH/1000).toFixed(2)} м</div>
      </div>
      <div class="kp-meta-item">
        <div class="kp-meta-lbl">Глубина</div>
        <div class="kp-meta-val">${(maxD/1000).toFixed(2)} м</div>
      </div>
    </div>
  </div>

  <div class="kp-section">
    <div class="kp-section-title"><i class="ti ti-layout-columns"></i> Состав изделия — ${secCount} секц.</div>
    <div class="kp-dims-grid">
      <div class="kp-dim-card">
        <div class="kp-dim-lbl">Секции</div>
        <div class="kp-dim-val">${secCount} <span class="kp-dim-unit">шт</span></div>
      </div>
      <div class="kp-dim-card">
        <div class="kp-dim-lbl">Листов ЛДСП</div>
        <div class="kp-dim-val">${d.ldspCount+d.facLdspCount} <span class="kp-dim-unit">шт</span></div>
      </div>
      <div class="kp-dim-card">
        <div class="kp-dim-lbl">Дверей/фасадов</div>
        <div class="kp-dim-val">${d.totalDoors} <span class="kp-dim-unit">шт</span></div>
      </div>
      <div class="kp-dim-card">
        <div class="kp-dim-lbl">Ящиков</div>
        <div class="kp-dim-val">${d.totalDrawerUnits} <span class="kp-dim-unit">шт</span></div>
      </div>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-top:12px;font-size:12px">
      <thead><tr>
        <th style="text-align:left;font-size:10px;font-weight:700;color:#aaa;padding:4px 6px;border-bottom:1px solid #eee">№</th>
        <th style="text-align:left;font-size:10px;font-weight:700;color:#aaa;padding:4px 6px;border-bottom:1px solid #eee">Габариты</th>
        <th style="text-align:left;font-size:10px;font-weight:700;color:#aaa;padding:4px 6px;border-bottom:1px solid #eee">Наполнение</th>
      </tr></thead>
      <tbody>${secSummary}</tbody>
    </table>
  </div>

  <div class="kp-spec-section">
    <div class="kp-section-title" style="padding-top:16px"><i class="ti ti-package"></i> Материалы и фурнитура</div>
    <table class="kp-table">
      <thead><tr><th>Наименование</th><th class="num">Кол.</th><th class="num">Ед.</th><th class="num">Цена ₸</th><th class="num">Сумма ₸</th></tr></thead>
      <tbody>${matRows}</tbody>
      <tfoot><tr class="subtotal-row">
        <td colspan="4">Итого материалы и фурнитура</td>
        <td class="num">${fmt(d.matTotal)} ₸</td>
      </tr></tfoot>
    </table>

    ${workRows ? `
    <div class="kp-section-title" style="padding-top:16px"><i class="ti ti-tools"></i> Работы</div>
    <table class="kp-table">
      <thead><tr><th>Вид работ</th><th class="num">Кол.</th><th class="num">Ед.</th><th class="num">Расценка ₸</th><th class="num">Сумма ₸</th></tr></thead>
      <tbody>${workRows}</tbody>
      <tfoot><tr class="work-subtotal">
        <td colspan="4">Итого работы</td>
        <td class="num">${fmt(d.workTotal)} ₸</td>
      </tr></tfoot>
    </table>` : `<div style="font-size:12px;color:#bbb;padding:8px 0 4px">Расценки на работы не заданы — укажите их на вкладке <b>Цены</b>.</div>`}
  </div>

  <div class="kp-footer-bar">
    <div>
      <div class="kp-footer-total-lbl">ИТОГО к оплате &nbsp;·&nbsp; ${dateStr}</div>
      <div class="kp-footer-total-num">${fmt(d.total)} ₸</div>
    </div>
    <button class="kp-print-btn" onclick="window.print()"><i class="ti ti-printer"></i> Печать / PDF</button>
  </div>`;

  document.getElementById('kp-body').innerHTML = html;
  document.getElementById('kp-modal').style.display = 'block';
}

function kpRow(name, q, unit, rate, sum){
  return `<tr><td>${name}</td><td class="num">${q}</td><td class="num">${unit}</td><td class="num">${rate}</td><td class="num"><b>${sum}</b></td></tr>`;
}

function confCloseKP(){ document.getElementById('kp-modal').style.display='none'; }

/* ============================================================
   CUT MODAL
============================================================ */
const COLORS=['#7fb3d3','#82c785','#e8c56d','#e8896d','#b39ddb','#80cbc4','#ef9a9a','#a5d6a7','#ce93d8','#ffcc80','#90caf9','#f48fb1'];

function drawSheet(sh,SW,SH,scale,showEdge){
  const pw=Math.round(SW*scale),ph=Math.round(SH*scale);
  let ci=0,svgItems='';
  sh.items.forEach((item,idx)=>{
    const iw=Math.max(2,Math.round(item.w*scale)),ih=Math.max(2,Math.round(item.h*scale));
    const ix=Math.round(item.x*scale),iy=Math.round(item.y*scale);
    const col=COLORS[ci%COLORS.length];ci++;
    const num=item.num||'';
    // Стрелка волокна: если текстурная деталь — вертикальная стрелка
    const hasGrain=item.tex&&!item.rotated;
    const grainArrow=hasGrain&&iw>20&&ih>20
      ?`<line x1="${ix+iw/2}" y1="${iy+6}" x2="${ix+iw/2}" y2="${iy+ih-6}" stroke="rgba(0,0,0,0.35)" stroke-width="1.5" marker-end="url(#arr)"/>`
      :'';
    // Кромка — подсветка торцов
    let edgeMarkup='';
    if(showEdge&&item.edgeFront){
      // Лицевая кромка (2мм) — жёлтая полоса по переднему торцу (левый край)
      edgeMarkup+=`<rect x="${ix}" y="${iy}" width="3" height="${ih}" fill="#f0c040" opacity="0.9"/>`;
    }
    if(showEdge&&item.edgeBack){
      // Скрытая кромка (0.4мм) — серая полоса по заднему торцу (правый край)
      edgeMarkup+=`<rect x="${ix+iw-2}" y="${iy}" width="2" height="${ih}" fill="#aaa" opacity="0.7"/>`;
    }
    svgItems+=`<g>
      <rect x="${ix}" y="${iy}" width="${iw}" height="${ih}" fill="${col}" stroke="rgba(0,0,0,0.15)" stroke-width="1"/>
      ${edgeMarkup}
      ${grainArrow}
      <text x="${ix+iw/2}" y="${iy+8}" text-anchor="middle" font-size="9" font-weight="bold" fill="#222">${num}</text>
      <text x="${ix+iw/2}" y="${iy+ih/2}" text-anchor="middle" font-size="7" fill="#333">${item.name}</text>
      <text x="${ix+iw/2}" y="${iy+ih-5}" text-anchor="middle" font-size="7" fill="#555">${item.w}×${item.h}</text>
    </g>`;
  });
  // Занятая высота (по стороне 1830)
  const maxY=sh.items.reduce((m,it)=>Math.max(m,it.y+it.h),0);
  const effH=Math.round(maxY/SH*100);
  // Линия заполнения
  const fillLine=maxY>0?`<line x1="0" y1="${Math.round(maxY*scale)}" x2="${pw}" y2="${Math.round(maxY*scale)}" stroke="#e53935" stroke-width="1" stroke-dasharray="4,3"/>`:''
  return`<div class="sheet-wrap">
    <div class="sheet-lbl">${sh.label} &nbsp;<span style="font-weight:400;color:#888">занято ${effH}% по ширине 1830</span></div>
    <svg width="${pw}" height="${ph}" style="border:1.5px solid #aaa;background:#fdf8f0;display:block" xmlns="http://www.w3.org/2000/svg">
      <defs><marker id="arr" markerWidth="4" markerHeight="4" refX="2" refY="2" orient="auto">
        <path d="M0,0 L0,4 L4,2 z" fill="rgba(0,0,0,0.35)"/>
      </marker></defs>
      ${svgItems}
      ${fillLine}
      <text x="2" y="${ph-3}" font-size="7" fill="#aaa">${SW}×${SH}мм</text>
    </svg>
    <div style="font-size:9px;color:#888;margin-top:3px;display:flex;gap:8px">
      <span><span style="display:inline-block;width:8px;height:8px;background:#f0c040;border-radius:1px;margin-right:2px"></span>Лицевая кромка 2мм</span>
      <span><span style="display:inline-block;width:8px;height:8px;background:#aaa;border-radius:1px;margin-right:2px"></span>Скрытая кромка 0.4мм</span>
      <span style="font-size:9px;color:#888">↕ стрелка = направление волокна</span>
    </div>
  </div>`;
}
// helper для легенды — вызывается отдельно
function sheetHasGrain(sh){ return sh.items.some(it=>it.tex&&!it.rotated); }

// Переключение вкладок раскроя
function cutSwitchTab(tab){
  document.getElementById('cut-pane-sheets').style.display=tab==='sheets'?'':'none';
  document.getElementById('cut-pane-list').style.display=tab==='list'?'':'none';
  document.querySelectorAll('.cut-tab').forEach(el=>{
    el.classList.toggle('active',el.dataset.tab===tab);
  });
}
window.cutSwitchTab=cutSwitchTab;

function buildDetailTable(parts, matName, color){
  if(!parts.length) return '';
  const rows=parts.map(p=>{
    const edgeFront=p.edgeFront==='2mm'?'<span class="edge-dot" style="background:#f0c040"></span>2мм'
      :p.edgeFront==='04mm'?'<span class="edge-dot" style="background:#aaa"></span>0.4мм':'—';
    const edgeBack=p.edgeBack==='04mm'?'<span class="edge-dot" style="background:#aaa"></span>0.4мм'
      :p.edgeBack==='2mm'?'<span class="edge-dot" style="background:#f0c040"></span>2мм':'—';
    return `<tr>
      <td>${p.num||''}</td>
      <td>${p.name}</td>
      <td class="num">${p.w}</td>
      <td class="num">${p.h}</td>
      <td>${p.tex?'↕ волокно':'—'}</td>
      <td>${edgeFront}</td>
      <td>${edgeBack}</td>
    </tr>`;
  }).join('');
  return `<div class="cut-mat-block">
    <div class="cut-mat-title"><span class="color-dot" style="background:${color}"></span>${matName} — ${parts.length} дет.</div>
    <table class="cut-detail-table">
      <thead><tr><th>#</th><th>Название</th><th class="num">Ш, мм</th><th class="num">В, мм</th><th>Волокно</th><th>Кромка лиц.</th><th>Кромка скр.</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function showCut(){
  const{ldsp,hdf,facLdsp,facMdf,totalPm04,totalPm2,edgeRows}=calcParts();
  const ldspSheets=packSheets(ldsp,LDSP_W,LDSP_H,'ЛДСП корпус',true);
  const hdfSheets=packSheets(hdf,HDF_W,HDF_H,'ХДФ',false,true);
  const facTex=facLdsp.filter(p=>p.tex);
  const facNoTex=facLdsp.filter(p=>!p.tex);
  const facTexSheets=packSheets(facTex,LDSP_W,LDSP_H,'ЛДСП фасад (текстура)',false);
  const facNoTexSheets=packSheets(facNoTex,LDSP_W,LDSP_H,'ЛДСП фасад',true);
  const mdfM2=facMdf.reduce((a,p)=>a+p.w*p.h/1e6,0);
  const sc=Math.min(0.115,320/Math.max(LDSP_W,HDF_W));

  // ── Вкладка Раскрой ──────────────────────────────────────────
  let sheetsHtml='';
  if(ldspSheets.length) sheetsHtml+=`<div class="cut-mat-block">
    <div class="cut-mat-title"><span class="color-dot" style="background:#c8a96e"></span>${matChoice.ldspName||'ЛДСП'} корпус 2750×1830 — ${ldspSheets.length} лист(ов)</div>
    <div class="cut-sheets-wrap">${ldspSheets.map(s=>drawSheet(s,LDSP_W,LDSP_H,sc,true)).join('')}</div>
  </div>`;
  if(hdfSheets.length) sheetsHtml+=`<div class="cut-mat-block">
    <div class="cut-mat-title"><span class="color-dot" style="background:#d4c49a"></span>ХДФ задние стенки 2800×2070 — ${hdfSheets.length} лист(ов) <span style="font-size:10px;color:#888">(по длинной стороне)</span></div>
    <div class="cut-sheets-wrap">${hdfSheets.map(s=>drawSheet(s,HDF_W,HDF_H,sc,false)).join('')}</div>
  </div>`;
  if(facTexSheets.length) sheetsHtml+=`<div class="cut-mat-block">
    <div class="cut-mat-title"><span class="color-dot" style="background:#e2c484"></span>ЛДСП фасад с текстурой — ${facTexSheets.length} лист(ов) <span class="badge-tex badge-grain">↕ без поворота</span></div>
    <div class="cut-sheets-wrap">${facTexSheets.map(s=>drawSheet(s,LDSP_W,LDSP_H,sc,true)).join('')}</div>
  </div>`;
  if(facNoTexSheets.length) sheetsHtml+=`<div class="cut-mat-block">
    <div class="cut-mat-title"><span class="color-dot" style="background:#e2c484"></span>ЛДСП фасад — ${facNoTexSheets.length} лист(ов) <span class="badge-tex badge-notex">↔ с поворотом</span></div>
    <div class="cut-sheets-wrap">${facNoTexSheets.map(s=>drawSheet(s,LDSP_W,LDSP_H,sc,true)).join('')}</div>
  </div>`;
  if(facMdf.length) sheetsHtml+=`<div class="cut-mat-block">
    <div class="cut-mat-title"><span class="color-dot" style="background:#fff0d4;border:1px solid #ccc"></span>МДФ фасады — расчёт по площади</div>
    <div class="mdf-block">
      ${facMdf.map(p=>`<div class="mdf-row"><span>${p.num?'#'+p.num+' ':''} ${p.name}</span><span>${p.w}×${p.h} мм = <b>${(p.w*p.h/1e6).toFixed(3)} м²</b></span></div>`).join('')}
      <div class="mdf-row"><span>Чистая площадь</span><span><b>${mdfM2.toFixed(3)} м²</b></span></div>
      <div class="mdf-row"><span>С учётом отхода +${prices.mdfWaste}%</span><span><b>${(mdfM2*(1+prices.mdfWaste/100)).toFixed(3)} м²</b></span></div>
    </div>
  </div>`;
  if(!sheetsHtml) sheetsHtml='<p style="color:#888;text-align:center;padding:30px">Нет деталей для раскроя</p>';

  // ── Вкладка Список деталей ────────────────────────────────────
  let listHtml='';
  listHtml+=buildDetailTable(ldsp,'ЛДСП корпус','#c8a96e');
  listHtml+=buildDetailTable(hdf,'ХДФ задние стенки','#d4c49a');
  listHtml+=buildDetailTable([...facTex,...facNoTex],'ЛДСП фасад','#e2c484');
  if(facMdf.length) listHtml+=buildDetailTable(facMdf,'МДФ фасад','#fff0d4');

  const html=`
    <div class="cut-tabs">
      <button class="cut-tab active" data-tab="sheets" onclick="cutSwitchTab('sheets')">📐 Раскрой листов</button>
      <button class="cut-tab" data-tab="list" onclick="cutSwitchTab('list')">📋 Список деталей</button>
    </div>
    <div id="cut-pane-sheets">${sheetsHtml}</div>
    <div id="cut-pane-list" style="display:none">${listHtml}</div>`;

  document.getElementById('cut-content').innerHTML=html;
  document.getElementById('cut-modal').style.display='block';
}
function closeCut(){ document.getElementById('cut-modal').style.display='none'; }

/* ============================================================
   STATS BADGE
============================================================ */
function updateStats(){
  let d;
  try{ d=calcAllCosts(); }catch(e){ console.error('calcAllCosts error:',e); return; }
  let t=`ЛДСП: <b>${d.ldspCount}</b> л &nbsp; ХДФ: <b>${d.hdfCount}</b> л`;
  if(d.facLdspCount) t+=` &nbsp; ЛДСП фас: <b>${d.facLdspCount}</b> л`;
  if(d.mdfM2>0) t+=` &nbsp; МДФ: <b>${d.mdfM2.toFixed(2)}</b> м²`;
  if(d.totalHinges>0||d.totalHandles>0) t+=` &nbsp; Петли: <b>${d.totalHinges}</b> шт &nbsp; Ручки: <b>${d.totalHandles}</b> шт`;
  t+=`<br>Материалы: <b>${fmt(d.matTotal)} ₸</b>`;
  if(d.workTotal>0) t+=` &nbsp;+&nbsp; Работы: <b>${fmt(d.workTotal)} ₸</b> &nbsp;=&nbsp; <b style="color:#1a5252">${fmt(d.total)} ₸</b>`;
  else t+=` &nbsp; <b style="color:#1a5252">Итого: ${fmt(d.total)} ₸</b>`;
  document.getElementById('stats-badge').innerHTML=t;
}

/* ============================================================
   MOBILE 3D PREVIEW
============================================================ */
let mobileRenderer=null, mobileScene=null, mobileCamera=null, mobileAnimId=null;

function showPreview3D(){
  document.getElementById('preview3d-modal').style.display='block';
  document.body.style.overflow='hidden';
  setTimeout(()=>{const h=document.getElementById('mobile-hint');if(h)h.style.opacity='0';},3000);
  // всегда пересоздаём — иначе после закрытия loop теряется
  if(mobileAnimId){cancelAnimationFrame(mobileAnimId);mobileAnimId=null;}
  if(mobileRenderer){mobileRenderer.dispose();mobileRenderer=null;mobileScene=null;mobileCamera=null;}
  initMobileThree();
}

function closePreview3D(){
  document.getElementById('preview3d-modal').style.display='none';
  document.body.style.overflow='';
  if(mobileAnimId){cancelAnimationFrame(mobileAnimId);mobileAnimId=null;}
  if(mobileRenderer){mobileRenderer.dispose();mobileRenderer=null;mobileScene=null;mobileCamera=null;}
}

function initMobileThree(){
  const canvas=document.getElementById('c3d-mobile');
  const wrap=canvas.parentElement;
  mobileRenderer=new THREE.WebGLRenderer({canvas,antialias:true});
  mobileRenderer.setPixelRatio(window.devicePixelRatio);
  mobileRenderer.shadowMap.enabled=true;

  const W=wrap.clientWidth, H=wrap.clientHeight;
  mobileRenderer.setSize(W,H,false);
  mobileCamera=new THREE.PerspectiveCamera(45,W/H,1,40000);

  mobileScene=new THREE.Scene();
  mobileScene.background=new THREE.Color(0x1e2226);

  mobileScene.add(new THREE.AmbientLight(0xffffff,0.7));
  const dl=new THREE.DirectionalLight(0xffffff,0.9); dl.position.set(2000,3000,2000); dl.castShadow=true; mobileScene.add(dl);
  const dl2=new THREE.DirectionalLight(0xffffff,0.25); dl2.position.set(-1500,1000,-800); mobileScene.add(dl2);

  const floor=new THREE.Mesh(new THREE.PlaneGeometry(30000,30000),new THREE.MeshLambertMaterial({color:0x2a2e32}));
  floor.rotation.x=-Math.PI/2; floor.receiveShadow=true; mobileScene.add(floor);
  const grid=new THREE.GridHelper(10000,50,0x3a3e42,0x2e3236); grid.position.y=1; mobileScene.add(grid);

  // touch controls
  let theta=35, phi=25, radius=4500;
  const target=new THREE.Vector3(0,900,0);
  let lastTouches=[];

  function camM(){
    const tr=theta*Math.PI/180, pr=phi*Math.PI/180;
    mobileCamera.position.set(
      target.x+Math.sin(tr)*Math.cos(pr)*radius,
      target.y+Math.sin(pr)*radius,
      target.z+Math.cos(tr)*Math.cos(pr)*radius
    );
    mobileCamera.lookAt(target);
  }
  camM();

  canvas.addEventListener('touchstart',e=>{lastTouches=Array.from(e.touches);e.preventDefault();},{passive:false});
  canvas.addEventListener('touchmove',e=>{
    e.preventDefault();
    const touches=Array.from(e.touches);
    if(touches.length===1&&lastTouches.length===1){
      // rotate
      theta-=(touches[0].clientX-lastTouches[0].clientX)*0.5;
      phi=Math.max(3,Math.min(85,phi-(touches[0].clientY-lastTouches[0].clientY)*0.4));
      camM();
    } else if(touches.length===2&&lastTouches.length===2){
      // pinch zoom
      const d0=Math.hypot(lastTouches[0].clientX-lastTouches[1].clientX,lastTouches[0].clientY-lastTouches[1].clientY);
      const d1=Math.hypot(touches[0].clientX-touches[1].clientX,touches[0].clientY-touches[1].clientY);
      radius=Math.max(800,Math.min(15000,radius*(d0/d1)));
      camM();
    }
    lastTouches=touches;
  },{passive:false});

  new ResizeObserver(()=>{
    const W=wrap.clientWidth,H=wrap.clientHeight;
    mobileRenderer.setSize(W,H,false);
    mobileCamera.aspect=W/H; mobileCamera.updateProjectionMatrix();
  }).observe(wrap);

  renderMobile3D();

  function loop(){mobileAnimId=requestAnimationFrame(loop);mobileRenderer.render(mobileScene,mobileCamera);}
  loop();
}

function renderMobile3D(){
  if(!mobileScene)return;
  mobileScene.children.filter(c=>c.userData.mw).forEach(c=>mobileScene.remove(c));

  const mML =new THREE.MeshLambertMaterial({color:0xc8a96e});
  const mML2=new THREE.MeshLambertMaterial({color:0xb89050});
  const mMH =new THREE.MeshLambertMaterial({color:0xd4c49a,side:THREE.DoubleSide});
  const mMR =new THREE.MeshLambertMaterial({color:0x9e9e9e});
  const mMFL=new THREE.MeshLambertMaterial({color:0xe2c484});
  const mMFM=new THREE.MeshLambertMaterial({color:0xfff8f0});
  const mMD =new THREE.MeshLambertMaterial({color:0x8d9db6});
  const mME =new THREE.LineBasicMaterial({color:0x7a5c2e});

  function addB(x,y,z,w,h,d,mat,noEdge){
    if(w<=0||h<=0||d<=0)return;
    const g=new THREE.BoxGeometry(w,h,d);
    const m=new THREE.Mesh(g,mat||mML);
    m.position.set(x+w/2,y+h/2,z+d/2);
    m.castShadow=true; m.userData={mw:true}; mobileScene.add(m);
    if(!noEdge){
      const l=new THREE.LineSegments(new THREE.EdgesGeometry(g),mME);
      l.position.copy(m.position); l.userData={mw:true}; mobileScene.add(l);
    }
  }

  const totalW=sections.reduce((a,s)=>a+s.width,0);
  let ox=-totalW/2;

  sections.forEach(s=>{
    const W=s.width,H=s.height,D=s.depth;

    // корпус
    addB(ox,0,0,T,H,D); addB(ox+W-T,0,0,T,H,D);
    addB(ox+T,H-T,0,W-2*T,T,D); addB(ox+T,0,0,W-2*T,T,D,mML2);
    addB(ox,0,D-8,W,H,8,mMH);

    // полки
    s.shelves.forEach(sh=>addB(ox+T,sh.height,0,W-2*T,T,D));

    // перегородки
    s.dividers.forEach(dv=>addB(ox+dv.pos,T,0,T,H-2*T,D));

    // штанга
    if(s.hasRod){
      const rh=Math.min(s.rodHeight,H-T*3);
      const g2=new THREE.CylinderGeometry(10,10,W-2*T-20,16);
      const rm=new THREE.Mesh(g2,mMR);
      rm.rotation.z=Math.PI/2;
      rm.position.set(ox+W/2,rh,D/2);
      rm.userData={mw:true}; mobileScene.add(rm);
    }

    // фасад
    if(s.facade.type!=='none'){
      const fm=s.facade.material==='mdf'?mMFM:mMFL;
      const count=s.facade.type==='doors3'?3:s.facade.type==='doors2'?2:1;
      const gap=4,thick=18,dw=(W-gap*(count+1))/count;
      for(let i=0;i<count;i++) addB(ox+gap+(dw+gap)*i,gap,-thick,dw,H-gap*2,thick,fm,true);
    }

    // ящики по нишам и колонкам
    if(s.drawerBlocks&&s.drawerBlocks.length>0){
      const MD=new THREE.MeshStandardMaterial({color:0x8d9db6, roughness:0.6, metalness:0.1});
      const niches=getNiches(s);
      const cols=getColumns(s);
      s.drawerBlocks.forEach(db=>{
        const niche=niches[db.nicheIdx];
        if(!niche)return;
        const gap=4, dCount=db.count;
        const nicheH=niche.top-niche.bottom;
        const dH=Math.floor((nicheH-(dCount+1)*gap)/dCount);
        if(dH<20)return;
        cols.forEach(col=>{
          const dW=col.width-4;
          if(dW<50)return;
          for(let di=0;di<dCount;di++){
            const dy=niche.bottom+gap+(dH+gap)*di;
            addB(ox+col.left+2, dy, 8, dW, dH-2, D-68, mMD, true);
          }
        });
      });
    }

    // антресоль
    if(s.antresol&&s.antresol.enabled){
      const AH=s.antresol.height, ay=H;
      addB(ox,ay,0,T,AH,D); addB(ox+W-T,ay,0,T,AH,D);
      addB(ox+T,ay+AH-T,0,W-2*T,T,D); addB(ox+T,ay,0,W-2*T,T,D,mML2);
      addB(ox,ay,D-8,W,AH,8,mMH);
      if(s.antresol.facade.type!=='none'){
        const fm=s.antresol.facade.material==='mdf'?mMFM:mMFL;
        const cnt=s.antresol.facade.type==='doors3'?3:s.antresol.facade.type==='doors2'?2:1;
        const gap=4,thick=18,dw=(W-gap*(cnt+1))/cnt;
        for(let i=0;i<cnt;i++) addB(ox+gap+(dw+gap)*i,ay+gap,-thick,dw,AH-gap*2,thick,fm,true);
      }
    }

    ox+=W;
  });
}

/* ============================================================
   EXPOSE & INIT
============================================================ */
window.setAllFacadeMat=setAllFacadeMat;
window.addSection=addSection; window.removeSection=removeSection;
window.setLdsp=setLdsp; window.setMdfType=setMdfType; window.setMdfName=setMdfName;
window.loadFromSheets=loadFromSheets; window.syncFromSheets=syncFromSheets;
window.updAntresol=updAntresol; window.updDoorMat=updDoorMat;
window.addHinge=addHinge; window.removeHinge=removeHinge; window.setActivehingeBrand=setActivehingeBrand;
window.addSlide=addSlide; window.removeSlide=removeSlide; window.setActiveSlide=setActiveSlide;
window.addShelf=addShelf; window.removeShelf=removeShelf; window.autoShelves=autoShelves;
window.applyTemplate=applyTemplate; window.applyUserTemplate=applyUserTemplate;
window.saveAsTemplate=saveAsTemplate; window.deleteUserTemplate=deleteUserTemplate;
window.addDivider=addDivider; window.removeDivider=removeDivider;
window.upd=upd; window.updShelf=updShelf; window.updDiv=updDiv;
window.toggleRod=toggleRod;
window.updFacade=updFacade; window.updEdge=updEdge;
window.addDrawerBlock=addDrawerBlock; window.removeDrawerBlock=removeDrawerBlock; window.updDrawerBlock=updDrawerBlock;
window.showCut=showCut; window.closeCut=closeCut;
window.showSpec=showSpec; window.closeSpec=closeSpec;
window.confShowKP=confShowKP; window.confCloseKP=confCloseKP;
window.switchTab=switchTab; window.savePrices=savePrices;
window.syncFromSheets=syncFromSheets;
window.showPreview3D=showPreview3D; window.closePreview3D=closePreview3D;
window.toggleDimensions=toggleDimensions;
// Project system
window.projNew=projNew; window.projSave=projSave; window.projSwitchTo=projSwitchTo;
window.projDelete=projDelete; window.projDuplicate=projDuplicate;
window.projModalOpen=projModalOpen; window.projModalClose=projModalClose;
window.projMetaChanged=projMetaChanged;
// Экспорт для интеграции с калькулятором
window.calcAllCosts = calcAllCosts;
window._getMatChoice = () => matChoice;
window._getSections  = () => sections;
// Экспорт для ИИ-помощника — через геттер чтобы всегда получать актуальный массив
Object.defineProperty(window, '_ai_sections', { get: ()=>sections, set: v=>{sections=v;} });
window._ai_mkSection   = mkSection;
window._ai_renderPanel = renderPanel;
window._ai_render3D    = render3D;
window._ai_updateStats = updateStats;



// ═══════════════════════════════════════════════════════════════
// KITCHEN PROJECTS SYSTEM
// ═══════════════════════════════════════════════════════════════
const K_PROJ_PREFIX    = 'k_proj_';
const K_PROJ_INDEX_KEY = 'k_proj_index';

let kActiveProjectId = null;
let kProjUnsaved = false;
let kAutoSaveTimer = null;

function kProjGetIndex(){
  try{ return JSON.parse(localStorage.getItem(K_PROJ_INDEX_KEY)||'[]'); }catch(e){ return []; }
}
function kProjSetIndex(idx){
  try{ localStorage.setItem(K_PROJ_INDEX_KEY, JSON.stringify(idx)); }catch(e){}
}
function kProjGenId(){
  return 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
}

function kProjSnapshot(){
  return {
    meta: {
      name:   (document.getElementById('k-proj-name-inp')  ||{}).value||'Новая кухня',
      client: (document.getElementById('k-proj-client-inp')||{}).value||'',
      date:   (document.getElementById('k-proj-date-inp')  ||{}).value||'',
    },
    lower:     JSON.parse(JSON.stringify(KitchenState.lower)),
    upper:     JSON.parse(JSON.stringify(KitchenState.upper)),
    lId:       KitchenState.lId,
    uId:       KitchenState.uId,
    facadeMat: document.getElementById('k-facade-mat')?.value || 'ldsp',
    topType:   document.getElementById('k-top-type')?.value   || 'none',
    floorH:    document.getElementById('k-floor-h')?.value    || '850',
    depth:     document.getElementById('k-depth')?.value      || '501',
    upperGap:  document.getElementById('k-upper-gap')?.value  || '600',
    sheetFmt:  document.getElementById('k-sheet-fmt')?.value  || '2750x1830',
    facadeColorName: kFacadeColorName,
    corpusColorName: kCorpusColorName,
    accItems: JSON.parse(JSON.stringify(kAccItems)),
    accId: kAccId,
  };
}

function kProjRestore(snap){
  KitchenState.lower = snap.lower || [];
  KitchenState.upper = snap.upper || [];
  KitchenState.lId   = snap.lId   || 0;
  KitchenState.uId   = snap.uId   || 0;
  const fm = document.getElementById('k-facade-mat'); if(fm) fm.value = snap.facadeMat||'ldsp';
  const fh = document.getElementById('k-floor-h');   if(fh) fh.value = snap.floorH||'850';
  const dp = document.getElementById('k-depth');      if(dp) dp.value = snap.depth||'501';
  const ug = document.getElementById('k-upper-gap'); if(ug) ug.value = snap.upperGap||'600';
  const sf = document.getElementById('k-sheet-fmt'); if(sf) sf.value = snap.sheetFmt||'2750x1830';
  if(snap.facadeColorName) kSetFacadeColor(null, snap.facadeColorName, null);
  if(snap.corpusColorName) kSetCorpusColor(null, snap.corpusColorName, null);
  kAccItems = snap.accItems ? JSON.parse(JSON.stringify(snap.accItems)) : [];
  kAccId    = snap.accId    || 0;
}

function kProjSave(){
  if(!kActiveProjectId) kActiveProjectId = kProjGenId();
  const snap = kProjSnapshot();
  const idx  = kProjGetIndex();
  const existing = idx.find(p => p.id === kActiveProjectId);
  const entry = {
    id:      kActiveProjectId,
    name:    snap.meta.name   || 'Без названия',
    client:  snap.meta.client || '',
    date:    snap.meta.date   || '',
    savedAt: new Date().toISOString(),
  };
  if(existing) Object.assign(existing, entry);
  else idx.unshift(entry);
  kProjSetIndex(idx);
  try{ localStorage.setItem(K_PROJ_PREFIX + kActiveProjectId, JSON.stringify(snap)); }catch(e){
    alert('Ошибка сохранения: '+e.message); return;
  }
  kProjUnsaved = false;
  kProjRenderTabs();
  const fl = document.getElementById('k-proj-saved-flash');
  if(fl){ fl.style.opacity='1'; setTimeout(()=>{ fl.style.opacity='0'; }, 1800); }
}

function kProjLoad(id){
  try{
    const raw = localStorage.getItem(K_PROJ_PREFIX + id);
    if(!raw) return false;
    const snap = JSON.parse(raw);
    kProjRestore(snap);
    kActiveProjectId = id;
    kProjUnsaved = false;
    const m = snap.meta||{};
    const ni = document.getElementById('k-proj-name-inp');   if(ni) ni.value = m.name||'';
    const ci = document.getElementById('k-proj-client-inp'); if(ci) ci.value = m.client||'';
    const di = document.getElementById('k-proj-date-inp');   if(di) di.value = m.date||'';
    return true;
  }catch(e){ console.error('kProjLoad error',e); return false; }
}

function kProjDelete(id){
  let idx = kProjGetIndex();
  idx = idx.filter(p => p.id !== id);
  kProjSetIndex(idx);
  try{ localStorage.removeItem(K_PROJ_PREFIX + id); }catch(e){}
  if(id === kActiveProjectId){
    if(idx.length > 0) kProjSwitchTo(idx[0].id);
    else kProjNew();
  }
}

function kProjDuplicate(id){
  try{
    const raw = localStorage.getItem(K_PROJ_PREFIX + id);
    if(!raw) return;
    const snap = JSON.parse(raw);
    const newId = kProjGenId();
    snap.meta.name = (snap.meta.name||'Кухня') + ' (копия)';
    const idx = kProjGetIndex();
    idx.unshift({ id:newId, name:snap.meta.name, client:snap.meta.client||'', date:snap.meta.date||'', savedAt:new Date().toISOString() });
    kProjSetIndex(idx);
    localStorage.setItem(K_PROJ_PREFIX + newId, JSON.stringify(snap));
    kProjSwitchTo(newId);
    kProjModalOpen();
  }catch(e){ console.error('kProjDuplicate error',e); }
}

function kProjSwitchTo(id){
  if(kProjUnsaved && kActiveProjectId) kProjSave();
  const ok = kProjLoad(id);
  if(!ok) return;
  kRenderPanel();
  kRender();
  kUpdateTopSelect();
  kRenderColorPickers();
  kProjRenderTabs();
  kProjModalClose();
}

function kProjNew(){
  if(kProjUnsaved && kActiveProjectId) kProjSave();
  const newId = kProjGenId();
  kActiveProjectId = newId;
  kProjUnsaved = false;
  KitchenState.lower = [];
  KitchenState.upper = [];
  KitchenState.lId = 0;
  KitchenState.uId = 0;
  kAccItems = [];
  kAccId = 0;
  const today = new Date().toISOString().split('T')[0];
  const ni = document.getElementById('k-proj-name-inp');   if(ni) ni.value = 'Новая кухня';
  const ci = document.getElementById('k-proj-client-inp'); if(ci) ci.value = '';
  const di = document.getElementById('k-proj-date-inp');   if(di) di.value = today;
  kRenderPanel();
  kRender();
  kProjRenderTabs();
  kProjSave();
}

function kProjMarkUnsaved(){
  if(!kProjUnsaved){
    kProjUnsaved = true;
    kProjRenderTabs();
  }
  clearTimeout(kAutoSaveTimer);
  kAutoSaveTimer = setTimeout(()=>{ if(kProjUnsaved && kActiveProjectId) kProjSave(); }, 4000);
}

function kProjRenderTabs(){
  const idx    = kProjGetIndex();
  const tabsEl = document.getElementById('k-proj-tabs');
  if(!tabsEl) return;
  tabsEl.innerHTML = idx.map(p => {
    const isActive = p.id === kActiveProjectId;
    const isDirty  = isActive && kProjUnsaved;
    return `<button class="proj-tab${isActive?' active':''}${isDirty?' unsaved':''}"
        onclick="kProjSwitchTo('${p.id}')" title="${p.name}${p.client?' — '+p.client:''}">
      <span class="proj-dot" title="Несохранённые изменения"></span>
      <span class="proj-name-text">${p.name||'Без названия'}</span>
      <button class="proj-close" onclick="event.stopPropagation();kProjDelete('${p.id}')" title="Закрыть">&times;</button>
    </button>`;
  }).join('');
}

function kProjModalOpen(){
  const idx = kProjGetIndex();
  const mc  = document.getElementById('k-proj-modal-content');
  if(!mc) return;
  if(!idx.length){
    mc.innerHTML = '<p class="proj-empty">Нет сохранённых проектов</p>';
  } else {
    const rows = idx.map(p => {
      const savedAt = p.savedAt ? new Date(p.savedAt).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
      const isActive = p.id === kActiveProjectId;
      return `<tr>
        <td><b>${p.name||'Без названия'}</b>${isActive?'<span style="margin-left:6px;font-size:10px;background:#e8f5e9;color:#1a7a3a;padding:1px 6px;border-radius:4px">открыт</span>':''}<br>
          <span style="font-size:11px;color:#888">${p.client||'—'}</span></td>
        <td style="font-size:11px;color:#888">${p.date||'—'}</td>
        <td style="font-size:11px;color:#aaa">${savedAt}</td>
        <td style="text-align:right;white-space:nowrap">
          ${isActive?'':`<button class="proj-open-btn" onclick="kProjSwitchTo('${p.id}')">Открыть</button>&nbsp;`}
          <button class="proj-dup-btn" onclick="kProjDuplicate('${p.id}')" title="Дублировать"><i class="ti ti-copy"></i></button>&nbsp;
          <button class="proj-del-btn" onclick="if(confirm('Удалить «${(p.name||'').replace(/'/g,'&apos;')}»?')){kProjDelete('${p.id}');kProjModalOpen();}" title="Удалить"><i class="ti ti-trash"></i></button>
        </td>
      </tr>`;
    }).join('');
    mc.innerHTML = `
      <div style="margin-bottom:10px;display:flex;justify-content:flex-end">
        <button onclick="kProjNew();kProjModalClose()" style="padding:6px 14px;background:#1a5252;color:#fff;border:none;border-radius:7px;cursor:pointer;font-size:12px;font-weight:700">
          <i class="ti ti-plus"></i> Новый проект
        </button>
      </div>
      <table class="proj-list-table">
        <thead><tr><th>Название / Клиент</th><th>Дата</th><th>Сохранён</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }
  document.getElementById('k-proj-modal').style.display = 'block';
}
function kProjModalClose(){ document.getElementById('k-proj-modal').style.display = 'none'; }
function kProjMetaChanged(){ kProjMarkUnsaved(); }

// Экспорт
window.kProjNew=kProjNew; window.kProjSave=kProjSave; window.kProjSwitchTo=kProjSwitchTo;
window.kProjDelete=kProjDelete; window.kProjDuplicate=kProjDuplicate;
window.kProjModalOpen=kProjModalOpen; window.kProjModalClose=kProjModalClose;
window.kProjMetaChanged=kProjMetaChanged;

// ═══════════════════════════════════════════════════════════════
// KITCHEN 3D CONFIGURATOR
// ═══════════════════════════════════════════════════════════════
const KitchenState = {
  lower: [],   // [{id, width, type, facade}]
  upper: [],   // [{id, width, height, facade}]
  lId: 0,
  uId: 0
};
// type: 'shelves'|'drawers'|'sink'|'appliance'
// facade: 'door'|'none'

function kMkLower(w=600){
  return {id: KitchenState.lId++, width:w, type:'shelves', facade:'door'};
}
function kMkUpper(w=600){
  return {id: KitchenState.uId++, width:w, height:720, facade:'door'};
}

// ── Переключатель вкладок ─────────────────────────────────────
function kAccToggle(id){
  const body=document.getElementById(id); if(!body) return;
  const hdr=body.previousElementSibling;
  const arr=hdr?.querySelector('.kacc-arr');
  const open=body.classList.toggle('open');
  if(arr) arr.style.transform=open?'':'rotate(-90deg)';
}
window.kAccToggle=kAccToggle;
function kSwitchTab(tab){
  const con = document.getElementById('k-pane-constructor');
  const pri = document.getElementById('k-pane-prices');
  const tc  = document.getElementById('k-tab-constructor');
  const tp  = document.getElementById('k-tab-prices');
  if(!con || !pri) return;
  con.style.display = tab==='constructor' ? '' : 'none';
  pri.style.display = tab==='prices'      ? '' : 'none';
  if(tc) tc.classList.toggle('active', tab==='constructor');
  if(tp) tp.classList.toggle('active', tab==='prices');
}

let kClientMode = false;
function kToggleClientMode(){
  kClientMode = !kClientMode;
  const btn = document.getElementById('k-client-mode-btn');
  const tp  = document.getElementById('k-tab-prices');
  if(btn){
    btn.classList.toggle('active', kClientMode);
    btn.title = kClientMode ? 'Режим менеджера — показать цены' : 'Режим клиента — скрыть цены';
    btn.innerHTML = kClientMode ? '<i class="ti ti-eye-off"></i>' : '<i class="ti ti-eye"></i>';
  }
  if(tp) tp.style.display = kClientMode ? 'none' : '';
  // Если сейчас на табе Цены — переключить на Конструктор
  if(kClientMode) kSwitchTab('constructor');
}
window.kToggleClientMode = kToggleClientMode;

// ── Добавить модули ───────────────────────────────────────────
function kAddLower(){
  KitchenState.lower.push(kMkLower());
  kRenderPanel(); kRender(); kUpdateTopSelect(); kProjMarkUnsaved();
}
function kAddUpper(){
  KitchenState.upper.push(kMkUpper());
  kRenderPanel(); kRender(); kProjMarkUnsaved();
}
function kRemoveLower(id){ KitchenState.lower=KitchenState.lower.filter(m=>m.id!==id); kRenderPanel(); kRender(); kUpdateTopSelect(); kProjMarkUnsaved(); }
function kRemoveUpper(id){ KitchenState.upper=KitchenState.upper.filter(m=>m.id!==id); kRenderPanel(); kRender(); kProjMarkUnsaved(); }
function kUpdateLower(id, field, val){
  const m=KitchenState.lower.find(x=>x.id===id); if(!m)return;
  if(field==='width'){
    m.width=Math.max(200,parseInt(val)||600);
    kUpdateTopSelect();
  }
  else if(field==='type'){
    m.type=val;
    if(val==='sink'||val==='appliance') m.facade='none';
    else if(m.facade==='none') m.facade='door';
  }
  else if(field==='facade') m.facade=val;
  kRender(); kProjMarkUnsaved();
}
function kUpdateUpper(id, field, val){
  const m=KitchenState.upper.find(x=>x.id===id); if(!m)return;
  if(field==='width') m.width=Math.max(200,parseInt(val)||600);
  else if(field==='height') m.height=Math.max(300,parseInt(val)||720);
  else if(field==='facade') m.facade=val;
  kRender(); kProjMarkUnsaved();
}

// ── Рендер панели ─────────────────────────────────────────────
const TYPE_LABELS = {shelves:'Полки', drawers:'Ящики', sink:'Мойка', appliance:'Техника'};
const TYPE_ICONS  = {shelves:'📦', drawers:'🗄️', sink:'🚿', appliance:'🔌'};

function kRenderPanel(){
  // Нижние — рендерим в оба контейнера (новый аккордеон + старый pane)
  const lowerContainers = [
    document.getElementById('k-lower-list'),
    document.getElementById('kpane-lower')?.querySelector('#k-lower-list-old')
  ].filter(Boolean);

  const ll = document.getElementById('k-lower-list');
  if(ll){
    if(!KitchenState.lower.length){ ll.innerHTML='<p class="hint">Нет нижних модулей</p>'; }
    else { ll.innerHTML = KitchenState.lower.map(m=>`
      <div class="km-card" id="km-l-${m.id}">
        <div class="km-hdr" onclick="kToggle('kml${m.id}')">
          <span class="km-title"><i class="ti ti-rectangle"></i> ${TYPE_ICONS[m.type]||''} ${m.width}мм — ${TYPE_LABELS[m.type]||m.type}</span>
          <button class="km-del" onclick="event.stopPropagation();kRemoveLower(${m.id})">✕</button>
        </div>
        <div class="km-body" id="kml${m.id}">
          <div class="km-row">
            <span class="km-lbl">Ширина (мм)</span>
            <input class="km-inp" type="number" value="${m.width}" min="200" max="1200" onchange="kUpdateLower(${m.id},'width',this.value);this.closest('.km-title')&&(this.closest('.km-card').querySelector('.km-title').textContent='${m.width}мм')">
          </div>
          <div style="font-size:11px;color:#666;margin-top:8px;margin-bottom:4px">Тип:</div>
          <div class="km-type-grid">
            ${['shelves','drawers','sink','appliance'].map(t=>`
            <button class="km-type-btn ${m.type===t?'active':''}" onclick="kUpdateLower(${m.id},'type','${t}');kRenderPanel()">${TYPE_ICONS[t]} ${TYPE_LABELS[t]}</button>
            `).join('')}
          </div>
          ${m.type==='sink'||m.type==='appliance' ? '' : `
          <div class="km-row" style="margin-top:8px">
            <span class="km-lbl">Фасад</span>
            <select class="km-sel" onchange="kUpdateLower(${m.id},'facade',this.value)">
              <option value="door" ${m.facade==='door'?'selected':''}>С дверью</option>
              <option value="none" ${m.facade==='none'?'selected':''}>Без двери</option>
            </select>
          </div>`}
        </div>
      </div>`).join(''); }
  }
  // Верхние
  const ul=document.getElementById('k-upper-list');
  if(ul){
    if(!KitchenState.upper.length){ ul.innerHTML='<p class="hint">Нет верхних модулей</p>'; }
    else { ul.innerHTML = KitchenState.upper.map(m=>`
      <div class="km-card" id="km-u-${m.id}">
        <div class="km-hdr" onclick="kToggle('kmu${m.id}')">
          <span class="km-title"><i class="ti ti-rectangle" style="opacity:.6"></i> ${m.width}мм × ${m.height}мм выс.</span>
          <button class="km-del" onclick="event.stopPropagation();kRemoveUpper(${m.id})">✕</button>
        </div>
        <div class="km-body" id="kmu${m.id}">
          <div class="km-row">
            <span class="km-lbl">Ширина (мм)</span>
            <input class="km-inp" type="number" value="${m.width}" min="200" max="1200" onchange="kUpdateUpper(${m.id},'width',this.value)">
          </div>
          <div class="km-row">
            <span class="km-lbl">Высота (мм)</span>
            <input class="km-inp" type="number" value="${m.height}" min="300" max="1100" onchange="kUpdateUpper(${m.id},'height',this.value)">
          </div>
          <div class="km-row">
            <span class="km-lbl">Фасад</span>
            <select class="km-sel" onchange="kUpdateUpper(${m.id},'facade',this.value)">
              <option value="door" ${m.facade==='door'?'selected':''}>С дверью</option>
              <option value="none" ${m.facade==='none'?'selected':''}>Без двери</option>
            </select>
          </div>
        </div>
      </div>`).join(''); }
  }
  // ── Счётчики в заголовках аккордеонов ────────────────────────
  const lCnt=document.getElementById('kacc-lower-cnt');
  const uCnt=document.getElementById('kacc-upper-cnt');
  const lLen=KitchenState.lower.reduce((s,m)=>s+m.width,0);
  const uLen=KitchenState.upper.reduce((s,m)=>s+m.width,0);
  if(lCnt) lCnt.textContent=KitchenState.lower.length?`${KitchenState.lower.length} мод · ${lLen}мм`:'';
  if(uCnt) uCnt.textContent=KitchenState.upper.length?`${KitchenState.upper.length} мод · ${uLen}мм`:'';
}

function kToggle(id){
  const b=document.getElementById(id); if(!b)return;
  b.classList.toggle('open');
}

// ── 3D рендер кухни ───────────────────────────────────────────
let kScene, kCamera, kRenderer, kAnimId;
let kTheta=205, kPhi=20, kRadius=4500;
let kDrag=false, kLastX=0, kLastY=0;

const K_BOARD = 16;   // толщина плиты мм (стандарт MebelOFF)
const K_TOP   = 38;   // толщина столешницы мм

// Материалы Three.js (создаются один раз при initKitchen)
// ── Карта цветов по именам ЛДСП ──────────────────────────────
const K_COLOR_MAP = {
  'белый':       0xf5f5f0, 'белый апельсин': 0xf5f5f0,
  'белый гладкий':0xf5f5f0,'белый глянец':   0xfafafa,
  'бежевый':     0xd4c5a9, 'кашемир':        0xe0d5c0,
  'слоновая кость':0xf0ead5,'фрост':          0xe8ecf0,
  'сатин':       0xe0ddd8, 'лдсп':           0xd4c5a9,
  'серый':       0xb8b8b0, 'серый светлый':  0xc8c8c0,
  'серый камень':0x9a9a95, 'цемент св':      0xb0aca5,
  'цемент тем':  0x888480, 'графит':         0x555550,
  'черный':      0x222222,
  'зеленый темный':0x3a5a40,'дымчатый зеленый':0x5a7a60,
  'сонома':      0xc8a870, 'вотан':          0x8a6845,
  'темный дуб вотан':0x6a5035,'америка орех':0xa07845,
};
function kColorByName(name){
  if(!name) return null;
  const key=name.toLowerCase().trim();
  for(const [k,v] of Object.entries(K_COLOR_MAP)){
    if(key.includes(k)||k.includes(key)) return v;
  }
  return null;
}

let kFacadeColorHex = 0xf5f5f0;  // текущий hex фасада
let kCorpusColorHex = 0xd4c5a9;  // текущий hex корпуса
let kFacadeColorName = 'Белый';
let kCorpusColorName = 'Бежевый';

function kSetFacadeColor(hexVal, name, btn){
  kFacadeColorHex = hexVal;
  kFacadeColorName = name||'';
  document.querySelectorAll('#k-facade-colors .kcolor-btn').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  if(kMats){ kMats.door.color.setHex(hexVal); }
  kRender();
}
function kSetCorpusColor(hexVal, name, btn){
  kCorpusColorHex = hexVal;
  kCorpusColorName = name||'';
  document.querySelectorAll('#k-corpus-colors .kcolor-btn').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  if(kMats){ kMats.corpus.color.setHex(hexVal); }
  kRender();
}
// Рендер пикеров цвета из DB.ldsp
function kRenderColorPickers(){
  const colors = (DB.ldsp||[]).map(x=>({name:x.n, hex: kColorByName(x.n)||0xd4c5a9}));
  // удаляем дубли по hex
  const seen=new Set(); const uniq=colors.filter(c=>{ const k=c.hex; if(seen.has(k))return false; seen.add(k);return true; });

  const facDiv=document.getElementById('k-facade-colors');
  const corpDiv=document.getElementById('k-corpus-colors');

  function mkBtn(c, clickFn, activeHex){
    const hexStr='#'+c.hex.toString(16).padStart(6,'0');
    const isActive=c.hex===activeHex;
    return `<button class="kcolor-btn ${isActive?'active':''}" style="background:${hexStr}" title="${c.name}" onclick="${clickFn}(0x${c.hex.toString(16)}, '${c.name.replace(/'/g,'_')}', this)"></button>`;
  }

  if(facDiv)  facDiv.innerHTML  = uniq.map(c=>mkBtn(c,'kSetFacadeColor', kFacadeColorHex)).join('');
  if(corpDiv) corpDiv.innerHTML = uniq.map(c=>mkBtn(c,'kSetCorpusColor', kCorpusColorHex)).join('');
}
window.kSetFacadeColor=kSetFacadeColor; window.kSetCorpusColor=kSetCorpusColor;
window.kRenderColorPickers=kRenderColorPickers;

// ── Столешница: заполнить селект из DB.kuh ────────────────────
function kFillTopSelect(){
  const sel=document.getElementById('k-top-type'); if(!sel) return;
  const kuh=DB.kuh||[];
  const tops=kuh.filter(x=>x.cat==='Столешница');
  // сохраняем текущий выбор
  const cur=sel.value;
  sel.innerHTML='<option value="none">Без столешницы</option>'+
    tops.map(t=>`<option value="${t.vid}"${t.vid===cur?' selected':''}>${t.vid} — ${t.p.toLocaleString('ru')}₸/пм</option>`).join('');
  kUpdateTopSelect();
}
function kUpdateTopSelect(){
  const lbl=document.getElementById('k-top-len-lbl'); if(!lbl) return;
  const totalMm=KitchenState.lower.reduce((s,m)=>s+m.width, 0);
  const totalM=(totalMm/1000).toFixed(2);
  const sel=document.getElementById('k-top-type');
  if(!sel||sel.value==='none'){ lbl.textContent=''; return; }
  const kuh=DB.kuh||[];
  const row=kuh.find(x=>x.cat==='Столешница'&&x.vid===sel.value);
  const price=row?row.p:0;
  const total=price*parseFloat(totalM);
  lbl.textContent=`${totalM} пм × ${price.toLocaleString('ru')}₸ = ${total.toLocaleString('ru')}₸`;
}
window.kFillTopSelect=kFillTopSelect;
window.kUpdateTopSelect=kUpdateTopSelect;

let kMats = null;
function kGetMats(){
  if(kMats) return kMats;
  kMats = {
    corpus: new THREE.MeshStandardMaterial({color:kCorpusColorHex, roughness:0.55, metalness:0.0}),
    door:   new THREE.MeshStandardMaterial({color:kFacadeColorHex, roughness:0.35, metalness:0.05}),
    top:    new THREE.MeshStandardMaterial({color:0x4a3828, roughness:0.25, metalness:0.08}),
    handle: new THREE.MeshStandardMaterial({color:0xb0b0b0, roughness:0.15, metalness:0.85}),
    leg:    new THREE.MeshStandardMaterial({color:0xd0d0d0, roughness:0.2,  metalness:0.7}),
    sink:   new THREE.MeshStandardMaterial({color:0xc0d0d0, roughness:0.2,  metalness:0.5}),
    appl:   new THREE.MeshStandardMaterial({color:0x808080, roughness:0.4,  metalness:0.35}),
    hdf:    new THREE.MeshStandardMaterial({color:0xc0b090, roughness:0.7,  metalness:0.0}),
    floor:  new THREE.MeshStandardMaterial({color:0xc8a878, roughness:0.8,  metalness:0.0}),
    wall:   new THREE.MeshStandardMaterial({color:0xf0ece6, roughness:1.0,  metalness:0.0}),
  };
  return kMats;
}

function kInitThree(){
  const canvas = document.getElementById('kc3d');
  if(!canvas) return;
  const vp = document.getElementById('kvp');
  if(!vp) return;

  kRenderer = new THREE.WebGLRenderer({canvas, antialias:true});
  kRenderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  kRenderer.setSize(vp.clientWidth, vp.clientHeight);
  kRenderer.shadowMap.enabled = true;
  kRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
  kRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  kRenderer.toneMappingExposure = 1.1;

  kScene = new THREE.Scene();
  kScene.background = new THREE.Color(0xf0ede8);
  kScene.fog = new THREE.Fog(0xf0ede8, 8000, 22000);

  kCamera = new THREE.PerspectiveCamera(42, vp.clientWidth/vp.clientHeight, 1, 40000);

  // Освещение
  kScene.add(new THREE.AmbientLight(0xfff5e0, 0.55));
  const dl = new THREE.DirectionalLight(0xfffaf0, 1.1);
  dl.position.set(3000, 5000, 2000);
  dl.castShadow = true;
  dl.shadow.mapSize.set(1024,1024);
  dl.shadow.camera.near = 10; dl.shadow.camera.far = 20000;
  dl.shadow.camera.left = dl.shadow.camera.bottom = -8000;
  dl.shadow.camera.right = dl.shadow.camera.top = 8000;
  kScene.add(dl);
  const dl2 = new THREE.DirectionalLight(0xd0e8ff, 0.35);
  dl2.position.set(-2000,3000,1000); kScene.add(dl2);

  const M = kGetMats();
  // Пол
  const kFloor = new THREE.Mesh(new THREE.PlaneGeometry(20000,20000), M.floor);
  kFloor.rotation.x = -Math.PI/2; kFloor.receiveShadow = true; kScene.add(kFloor);
  // Задняя стена (динамическая — перерисовывается при resize, здесь ставим далеко)
  const kWallB = new THREE.Mesh(new THREE.PlaneGeometry(16000,5000), M.wall);
  kWallB.position.set(0,2500,-700); kScene.add(kWallB);
  // Левая стена
  const kWallL = new THREE.Mesh(new THREE.PlaneGeometry(12000,5000), M.wall);
  kWallL.rotation.y = Math.PI/2; kWallL.position.set(-3500,2500,1500); kScene.add(kWallL);

  // Управление мышью
  canvas.addEventListener('mousedown', e=>{kDrag=true;kLastX=e.clientX;kLastY=e.clientY;});
  window.addEventListener('mouseup', ()=>kDrag=false);
  window.addEventListener('mousemove', e=>{
    if(!kDrag)return;
    kTheta -= (e.clientX-kLastX)*0.4;
    kPhi = Math.max(5,Math.min(60,kPhi-(e.clientY-kLastY)*0.3));
    kLastX=e.clientX; kLastY=e.clientY;
    kRender();
  });
  canvas.addEventListener('wheel', e=>{ kRadius=Math.max(1200,Math.min(12000,kRadius+e.deltaY*3)); kRender(); e.preventDefault(); },{passive:false});
  // Touch
  let kTouches=[], kLastDist=0;
  canvas.addEventListener('touchstart',e=>{kTouches=[...e.touches];if(e.touches.length===1){kDrag=true;kLastX=e.touches[0].clientX;kLastY=e.touches[0].clientY;}if(e.touches.length===2){kLastDist=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);}e.preventDefault();},{passive:false});
  canvas.addEventListener('touchmove',e=>{if(e.touches.length===1&&kDrag){kTheta-=(e.touches[0].clientX-kLastX)*0.5;kPhi=Math.max(5,Math.min(60,kPhi-(e.touches[0].clientY-kLastY)*0.4));kLastX=e.touches[0].clientX;kLastY=e.touches[0].clientY;kRender();}if(e.touches.length===2){const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);kRadius=Math.max(1200,Math.min(12000,kRadius-(d-kLastDist)*8));kLastDist=d;kRender();}e.preventDefault();},{passive:false});
  canvas.addEventListener('touchend',()=>{kDrag=false;});

  window.addEventListener('resize', ()=>{
    if(!kRenderer||!kCamera)return;
    const w=vp.clientWidth,h=vp.clientHeight;
    kRenderer.setSize(w,h); kCamera.aspect=w/h; kCamera.updateProjectionMatrix();
    kRender();
  });
}

function kBox(w,h,d, mat, x,y,z, cast=true){
  const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat);
  m.position.set(x,y,z);
  if(cast){ m.castShadow=true; m.receiveShadow=true; }
  return m;
}

// ── Вспомогательная функция: ручка-скоба ─────────────────
function kHandle(cx, cy, cz, W, tag, M){
  // горизонтальная скоба
  const len = Math.min(W*0.45, 180);
  const bar = kBox(len, 8, 8, M.handle, cx, cy, cz); tag(bar);
  // два штырька
  [-1,1].forEach(s=>{
    const pin = kBox(8, 22, 8, M.handle, cx+s*(len/2-4), cy-11, cz); tag(pin);
  });
  kScene.add(bar);
}

function kRender(){
  if(!kScene||!kRenderer||!kCamera) return;

  // Убираем кухонные объекты и HTML-метки
  const toRemove=[];
  kScene.traverse(o=>{ if(o.userData.kitchen) toRemove.push(o); });
  toRemove.forEach(o=>{ kScene.remove(o); o.geometry?.dispose(); });
  document.querySelectorAll('.kdim-badge').forEach(e=>e.remove());

  const M = kGetMats();
  // Обновляем цвета из актуального состояния
  M.door.color.setHex(kFacadeColorHex);
  M.corpus.color.setHex(kCorpusColorHex);

  const floorH  = parseInt(document.getElementById('k-floor-h')?.value||850);
  const depth   = parseInt(document.getElementById('k-depth')?.value||600);
  const upperGap= parseInt(document.getElementById('k-upper-gap')?.value||600);
  const LEG_H   = 100;  // высота ножек мм
  const LEG_S   = 28;   // сечение ножки мм
  const WALL_Z  = -depth/2 - 5; // задняя стена прижата к шкафам

  // ── Нижние шкафы — стандарт MebelOFF ────────────────────
  // 100 (ножки) + 712 (боковины) + 38 (столешница) = 850мм
  // Боковины = высота от верха ножек до низа столешницы
  // Дно лежит ВНУТРИ боковин (не под ними)
  const lowers = KitchenState.lower;
  const totalLowerW = lowers.reduce((s,m)=>s+m.width,0);
  const startX = -totalLowerW/2;

  const CORP_BASE = LEG_H;              // Y нижней грани боковин = верх ножек
  const CORP_H    = floorH - K_TOP - LEG_H; // высота боковин = 850-38-100 = 712мм

  let xL = 0;
  lowers.forEach((mod, mi)=>{
    const W=mod.width, H=CORP_H, D=depth;
    const cx = startX + xL + W/2;
    const tag = o=>{ o.userData.kitchen=true; return o; };
    const tadd = o=>{ kScene.add(tag(o)); return o; };

    // ── Корпус (стандарт MebelOFF 16мм) ──────────────────────
    // Боковины — полная высота CORP_H
    tadd(kBox(K_BOARD, H, D, M.corpus, startX+xL+K_BOARD/2,    CORP_BASE+H/2, 0));
    tadd(kBox(K_BOARD, H, D, M.corpus, startX+xL+W-K_BOARD/2,  CORP_BASE+H/2, 0));
    // Дно — внутри боковин, снизу
    tadd(kBox(W-K_BOARD*2, K_BOARD, D, M.corpus, cx, CORP_BASE+K_BOARD/2, 0));
    // Верхней крышки НЕТ — сразу столешница
    // Задник ХДФ 4мм
    tadd(kBox(W-K_BOARD*2, H-K_BOARD, 4, M.hdf, cx, CORP_BASE+K_BOARD+(H-K_BOARD)/2, -D/2+2));

    // ── Наполнение ──
    const innerY0 = CORP_BASE + K_BOARD;   // от верха дна
    const innerH  = H - K_BOARD;           // до верха боковины (нет крышки)
    const innerW  = W - K_BOARD*2;
    const innerD  = D - 4 - 2;             // за вычетом задника ХДФ

    if(mod.type==='shelves'){
      // Две полки на 1/3 и 2/3 высоты
      [1/3, 2/3].forEach(frac=>{
        tadd(kBox(innerW, K_BOARD, innerD, M.corpus, cx, innerY0+innerH*frac, -2.5));
      });
    } else if(mod.type==='drawers'){
      // 3 ящика равной высоты
      const dH = innerH/3;
      for(let i=0;i<3;i++){
        const dy = innerY0 + dH*i + dH/2;
        // ящик (тело)
        tadd(kBox(innerW-4, dH-8, innerD-30, M.corpus, cx, dy, -17));
        // фасад ящика
        const fmat = M.door;
        tadd(kBox(W-2, dH-4, 16, fmat, cx, dy, D/2+8));
        // ручка-скоба на ящике
        kHandle(cx, dy+(dH/2)-14, D/2+18, W, tag, M);
      }
    } else if(mod.type==='sink'){
      // Открытый проём под мойку — только боковые перегородки
      tadd(kBox(K_BOARD, innerH, innerD, M.corpus, cx-innerW/2+K_BOARD/2, CORP_BASE+H/2, -2.5));
      tadd(kBox(K_BOARD, innerH, innerD, M.corpus, cx+innerW/2-K_BOARD/2, CORP_BASE+H/2, -2.5));
      // Мойка (нержавейка)
      const sW=innerW-K_BOARD*2-20, sD=innerD*0.7;
      tadd(kBox(sW, 25, sD, M.sink, cx, CORP_BASE+H-K_BOARD-12, -5));
    } else if(mod.type==='appliance'){
      // Пустой проём (техника встроенная) — тёмный фон
      tadd(kBox(innerW-4, innerH-4, 6, M.appl, cx, CORP_BASE+H/2, -D/2+8));
    }

    // ── Фасад ─────────────────────────────────────────────────
    // Высота фасада = высота боковин (нет верхней крышки, столешница сверху)
    if(mod.facade==='door' && (mod.type==='shelves'||mod.type==='sink'||mod.type==='appliance')){
      tadd(kBox(W-2, H-2, 16, M.door, cx, CORP_BASE+H/2, D/2+8));
      kHandle(cx, CORP_BASE+H*0.55, D/2+19, W, tag, M);
    }

    // ── Ножки (4 шт цилиндрические) ──
    [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([sx,sz])=>{
      tadd(kBox(LEG_S, LEG_H, LEG_S, M.leg, cx+sx*(W/2-36), LEG_H/2, sz*(D/2-36)));
    });

    xL += W;
  });

  // ── Столешница (38мм, выступ 30мм спереди) ──────────────
  if(lowers.length){
    const topW = totalLowerW;      // вровень с боковинами по ширине
    const topD = depth + 30;       // выступ 30мм спереди
    const topY = floorH - K_TOP/2; // центр столешницы
    const topMesh = kBox(topW, K_TOP, topD, M.top, startX+totalLowerW/2, topY, 15);
    topMesh.userData.kitchen=true; kScene.add(topMesh);
  }

  // ── Верхние шкафы (прижаты к задней стене) ───────────────
  const uppers = KitchenState.upper;
  const totalUpperW = uppers.reduce((s,m)=>s+m.width,0);
  const startXU = -totalUpperW/2;
  const UD = 350; // глубина верхних
  const upperBaseY = floorH + upperGap;
  let xU=0;

  uppers.forEach(mod=>{
    const W=mod.width, H=mod.height, D=UD;
    const cx=startXU+xU+W/2;
    const bY=upperBaseY;
    // Верхние шкафы прижаты к задней стене (z = WALL_Z + D/2)
    const uz = WALL_Z + D/2;
    const tag = o=>{ o.userData.kitchen=true; return o; };
    const tadd = o=>{ kScene.add(tag(o)); return o; };

    // Корпус
    tadd(kBox(W, K_BOARD, D, M.corpus, cx, bY+K_BOARD/2, uz));
    tadd(kBox(W, K_BOARD, D, M.corpus, cx, bY+H-K_BOARD/2, uz));
    tadd(kBox(K_BOARD, H, D, M.corpus, startXU+xU+K_BOARD/2, bY+H/2, uz));
    tadd(kBox(K_BOARD, H, D, M.corpus, startXU+xU+W-K_BOARD/2, bY+H/2, uz));
    // Задник ХДФ
    tadd(kBox(W-K_BOARD*2, H-K_BOARD*2, 5, M.hdf, cx, bY+H/2, uz-D/2+2.5));
    // Полка
    tadd(kBox(W-K_BOARD*2, K_BOARD, D-5, M.corpus, cx, bY+H*0.5, uz));

    // Фасад
    if(mod.facade==='door'){
      tadd(kBox(W-2, H-2, 16, M.door, cx, bY+H/2, uz+D/2+8));
      kHandle(cx, bY+H/2, uz+D/2+18, W, tag, M);
    }
    xU+=W;
  });

  // ── Цоколь (плинтус) 100мм под нижними шкафами ──────────
  if(lowers.length){
    const plinW = totalLowerW;
    // Цоколь высотой LEG_H, отступ от фасада 50мм
    const plin = kBox(plinW, LEG_H, 12, M.corpus, startX+totalLowerW/2, LEG_H/2, depth/2-6);
    plin.userData.kitchen=true; kScene.add(plin);
  }

  // ── Размерные HTML-метки на canvas ───────────────────────
  const vp = document.getElementById('kvp');
  if(vp && lowers.length){
    // Общая ширина нижних
    const p1 = kWorldToScreen(new THREE.Vector3(startX, floorH+30, depth/2));
    const p2 = kWorldToScreen(new THREE.Vector3(startX+totalLowerW, floorH+30, depth/2));
    if(p1&&p2){ kDimLabel(vp,(p1.x+p2.x)/2, Math.min(p1.y,p2.y)-22, `${totalLowerW} мм`); }
    // Высота
    const ph = kWorldToScreen(new THREE.Vector3(startX-60, floorH/2, 0));
    if(ph){ kDimLabel(vp, ph.x-50, ph.y, `${floorH} мм`, true); }
  }

  // ── Камера ───────────────────────────────────────────────
  const totalW = Math.max(totalLowerW, totalUpperW, 1200);
  const targetY = floorH * 0.55;
  const tr = kTheta*Math.PI/180, pr = kPhi*Math.PI/180;
  kCamera.position.set(
    kRadius * Math.cos(pr) * Math.sin(tr),
    targetY + kRadius * Math.sin(pr),
    kRadius * Math.cos(pr) * Math.cos(tr)
  );
  kCamera.lookAt(0, targetY, 0);
  kCamera.updateProjectionMatrix();

  // ── Stats badge ──────────────────────────────────────────
  const stats = document.getElementById('kstats');
  if(stats){
    stats.innerHTML =
      `Н: ${lowers.length} мод · ${totalLowerW}мм<br>` +
      `В: ${uppers.length} мод · ${totalUpperW}мм<br>` +
      `Выс: ${floorH}мм · Гл: ${depth}мм`;
  }

  kRenderer.render(kScene, kCamera);
}

// ── Проекция 3D → 2D для меток ───────────────────────────────
function kWorldToScreen(v3){
  if(!kCamera||!kRenderer) return null;
  const v = v3.clone().project(kCamera);
  const w=kRenderer.domElement.clientWidth, h=kRenderer.domElement.clientHeight;
  return {x:(v.x+1)/2*w, y:(-v.y+1)/2*h};
}
function kDimLabel(vp, x, y, text, vertical=false){
  const el=document.createElement('div');
  el.className='kdim-badge';
  el.textContent=text;
  el.style.left=x+'px'; el.style.top=y+'px';
  if(vertical) el.style.transform='translateY(-50%) rotate(-90deg)';
  vp.appendChild(el);
}

// ── Инициализация кухни ───────────────────────────────────────
let kInited = false;
function initKitchen(){
  if(!kInited){
    kInited = true;
    kInitThree();
    kRenderColorPickers();
    kFillTopSelect();
    // Инициализация системы проектов кухни
    const kidx = kProjGetIndex();
    if(kidx.length > 0){
      const loaded = kProjLoad(kidx[0].id);
      if(loaded){
        kRenderPanel();
        kProjRenderTabs();
        setTimeout(()=>kRender(), 50);
      } else {
        kProjNew();
      }
    } else {
      // Первый запуск — стартовый набор
      KitchenState.lower = [kMkLower(600), kMkLower(600), kMkLower(600)];
      KitchenState.upper = [kMkUpper(600), kMkUpper(600)];
      kRenderPanel();
      kProjRenderTabs();
      setTimeout(()=>kRender(), 50);
    }
  } else {
    kRenderColorPickers();
    kFillTopSelect();
    kProjRenderTabs();
    kRender();
  }
}

// ── Mobile preview ────────────────────────────────────────────
function kShowPreview(){
  const vp=document.getElementById('kvp');
  if(vp) vp.style.display='block';
}

// ── Синхронизация цен кухни из Google Sheets ─────────────────
async function kLoadFromSheets(){
  const btn=document.getElementById('k-sync-btn');
  const st=document.getElementById('k-sync-status');
  const url = prices.gsUrl || SHEETS_URL || '';
  if(!url){ if(st) st.textContent='⚠ URL не задан в настройках'; return; }
  if(btn) btn.disabled=true;
  if(st){ st.textContent='Загружаю...'; st.style.color='#888'; }
  try{
    const r=await Promise.race([
      fetch(url),
      new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),8000))
    ]);
    const d=await r.json();
    let updated=0;
    if(d.ldsp&&d.ldsp.length)   { DB.ldsp=d.ldsp;        updated++; }
    if(d.fas_plen&&d.fas_plen.length){ DB.fas_plen=d.fas_plen; updated++; }
    if(d.fas_kr&&d.fas_kr.length)    { DB.fas_kr=d.fas_kr;     updated++; }
    if(d.furn&&d.furn.length)        { DB.furn=d.furn;          updated++; }
    if(d.kuh&&d.kuh.length)          { DB.kuh=d.kuh;            updated++; }
    if(d.shk&&d.shk.length)          { DB.shk=d.shk;            updated++; }
    if(d.acc&&d.acc.length)          { DB.acc=d.acc;            updated++; }
    if(d.hingeCatalog&&d.hingeCatalog.length) hingeCatalog=d.hingeCatalog;
    if(d.slideCatalog&&d.slideCatalog.length) slideCatalog=d.slideCatalog;
    kRenderColorPickers();
    kFillTopSelect();
    kRenderPricesPreview();
    if(st){ st.textContent=`✓ Загружено: ЛДСП ${DB.ldsp.length}, Кухня ${DB.kuh.length}, Фурнитура ${DB.furn.length}`; st.style.color='#27ae60'; }
    showStatus('OK: Цены кухни синхронизированы из Google Sheets','#1D9E75');
    setTimeout(hideStatus,2500);
  }catch(e){
    if(st){ st.textContent='✗ '+e.message; st.style.color='#c0392b'; }
  }
  if(btn) btn.disabled=false;
}
window.kLoadFromSheets=kLoadFromSheets;

// ── Превью загруженных цен ────────────────────────────────────
function kRenderPricesPreview(){
  const el=document.getElementById('k-prices-preview'); if(!el) return;
  const cats=[...new Set((DB.kuh||[]).map(x=>x.cat))];
  if(!cats.length){ el.textContent='Нет данных — нажмите «Загрузить»'; return; }
  el.innerHTML='<div style="font-size:11px;font-weight:600;color:#444;margin-bottom:4px">Загруженные категории кухни:</div>'+
    cats.map(c=>{
      const items=(DB.kuh||[]).filter(x=>x.cat===c);
      return `<div style="margin-bottom:4px"><b>${c}</b>: ${items.map(x=>`${x.vid} ${x.p.toLocaleString('ru')}₸`).join(', ')}</div>`;
    }).join('');
}

// ── Доп. аксессуары кухни ─────────────────────────────────────
let kExtraItems = []; // совместимость
let kExtraId = 0;

// ── Аксессуары кухни (DB.acc -> Доп.Позиции без наценки) ─────
let kAccItems = []; // [{id, cat, vid, qty}]
let kAccId = 0;

function kRenderAccItems(){
  const list = document.getElementById('k-acc-list'); if(!list) return;
  const cnt  = document.getElementById('kacc-acc-cnt');
  if(!kAccItems.length){
    list.innerHTML = '<p class="hint">Нет позиций — нажмите «Добавить»</p>';
    if(cnt) cnt.textContent = '';
    return;
  }
  const acc = DB.acc || [];
  const cats = [...new Set(acc.map(x=>x.cat))];
  list.innerHTML = kAccItems.map(item=>{
    const vids = acc.filter(x=>x.cat===item.cat);
    const price = (acc.find(x=>x.cat===item.cat&&x.vid===item.vid)||{p:0}).p;
    return '<div class="km-card" style="margin-bottom:6px;padding:8px 10px" id="kacc-item-'+item.id+'">' +
      '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
        '<select class="km-sel" style="flex:1;min-width:100px" onchange="kAccSetCat('+item.id+',this.value)">' +
          cats.map(c=>'<option value="'+c+'"'+(c===item.cat?' selected':'')+'>'+c+'</option>').join('') +
        '</select>' +
        '<select class="km-sel" style="flex:1;min-width:80px" onchange="kAccSetVid('+item.id+',this.value)">' +
          vids.map(v=>'<option value="'+v.vid+'"'+(v.vid===item.vid?' selected':'')+'>'+v.vid+' — '+v.p.toLocaleString('ru')+'₸</option>').join('') +
        '</select>' +
        '<input class="km-inp" type="number" value="'+item.qty+'" min="1" style="width:50px" onchange="kAccSetQty('+item.id+',this.value)">' +
        '<button class="km-del" onclick="kAccRemove('+item.id+')">✕</button>' +
      '</div>' +
      '<div style="font-size:10px;color:#888;margin-top:3px">'+price.toLocaleString('ru')+'₸ × '+item.qty+' = '+(price*item.qty).toLocaleString('ru')+'₸</div>' +
    '</div>';
  }).join('');
  if(cnt) cnt.textContent = kAccItems.length ? kAccItems.length+' поз.' : '';
}
function kAddAccItem(){
  const acc = DB.acc||[];
  if(!acc.length){ alert('Загрузите цены (Синхронизация цен -> Кухня-безнаценки)'); return; }
  kAccItems.push({id:kAccId++, cat:acc[0].cat, vid:acc[0].vid, qty:1});
  kRenderAccItems(); kProjMarkUnsaved();
}
function kAccSetCat(id, cat){
  const item = kAccItems.find(x=>x.id===id); if(!item) return;
  item.cat = cat;
  const first = (DB.acc||[]).find(x=>x.cat===cat);
  item.vid = first ? first.vid : '';
  kRenderAccItems(); kProjMarkUnsaved();
}
function kAccSetVid(id, vid){
  const item = kAccItems.find(x=>x.id===id); if(!item) return;
  item.vid = vid; kRenderAccItems(); kProjMarkUnsaved();
}
function kAccSetQty(id, qty){
  const item = kAccItems.find(x=>x.id===id); if(!item) return;
  item.qty = Math.max(1, parseInt(qty)||1); kProjMarkUnsaved();
}
function kAccRemove(id){
  kAccItems = kAccItems.filter(x=>x.id!==id); kRenderAccItems(); kProjMarkUnsaved();
}
window.kAddAccItem=kAddAccItem; window.kAccSetCat=kAccSetCat;
window.kAccSetVid=kAccSetVid; window.kAccSetQty=kAccSetQty;
window.kAccRemove=kAccRemove; window.kRenderAccItems=kRenderAccItems;

// ── Столешница: обновление длины ─────────────────────────────
function kUpdateTopLen(){
  const sel = document.getElementById('k-top-type');
  const lenRow = document.getElementById('k-top-len-row');
  const lenInp = document.getElementById('k-top-len');
  const lenLbl = document.getElementById('k-top-len-lbl');
  if(!sel) return;
  const hasTop = sel.value && sel.value !== 'none';
  if(lenRow) lenRow.style.display = hasTop ? 'flex' : 'none';
  if(hasTop && lenInp){
    if(!lenInp.value || parseFloat(lenInp.value) === 0){
      const autoLen = Math.round(KitchenState.lower.reduce((s,m)=>s+m.width,0)/1000*100)/100;
      lenInp.value = autoLen;
    }
    if(lenLbl){
      const autoLen = Math.round(KitchenState.lower.reduce((s,m)=>s+m.width,0)/1000*100)/100;
      lenLbl.textContent = 'Авто: '+autoLen+' пм по нижним модулям';
    }
  } else {
    if(lenLbl) lenLbl.textContent = '';
  }
  kProjMarkUnsaved();
}
window.kUpdateTopLen = kUpdateTopLen;

// ── Совместимость со старым кодом ────────────────────────────
function kRenderExtras(){ kRenderAccItems(); }
function kAddExtra(){ kAddAccItem(); }
window.kAddExtra=kAddExtra; window.kRenderExtras=kRenderExtras;
window.kRenderPricesPreview=kRenderPricesPreview;

// ── Смета ─────────────────────────────────────────────────────
function kShowSpec(){
  const modal=document.getElementById('k-spec-modal');
  const content=document.getElementById('k-spec-content');
  if(!modal||!content) return;

  const depth  = parseInt(document.getElementById('k-depth')?.value||600);
  const floorH = parseInt(document.getElementById('k-floor-h')?.value||850);
  const uGap   = parseInt(document.getElementById('k-upper-gap')?.value||600);
  const T=K_BOARD/1000, upperD=350/1000;

  // Считаем площадь ЛДСП (в кв.м → листах)
  let lowerParts=[], upperParts=[];
  KitchenState.lower.forEach((m,i)=>{
    const W=m.width/1000, H=(floorH-K_TOP)/1000, D=depth/1000;
    lowerParts.push({n:`Нижний ${i+1} (${m.width}мм)`, parts:[
      {n:'Дно',    w:W,    h:T,    d:D},
      {n:'Верх',   w:W,    h:T,    d:D},
      {n:'Бок×2',  w:T,    h:H,    d:D, qty:2},
      {n:'Полка',  w:W-T*2,h:T,    d:D-(4/1000), skip: m.type!=='shelves'},
    ]});
  });
  KitchenState.upper.forEach((m,i)=>{
    const W=m.width/1000, H=m.height/1000, D=upperD;
    upperParts.push({n:`Верхний ${i+1} (${m.width}мм)`, parts:[
      {n:'Дно',   w:W,    h:T,    d:D},
      {n:'Верх',  w:W,    h:T,    d:D},
      {n:'Бок×2', w:T,    h:H,    d:D, qty:2},
      {n:'Полка', w:W-T*2,h:T,    d:D-0.004},
    ]});
  });

  // Суммируем площадь ЛДСП
  let totalM2=0;
  const fmt2=n=>n.toFixed(3);
  let rows='';
  [...lowerParts,...upperParts].forEach(mod=>{
    mod.parts.forEach(p=>{
      if(p.skip) return;
      const qty=p.qty||1;
      const s=p.w*p.d*qty; // ЛДСП — ширина × глубина
      totalM2+=s;
      rows+=`<tr><td>${mod.n} — ${p.n}</td><td>${qty}</td><td>${fmt2(p.w*1000)}×${fmt2(p.d*1000)}</td><td>${fmt2(s)}</td></tr>`;
    });
  });
  const LDSP_SHEET_M2 = 2.75*1.83; // 5.0325 м²
  const sheets = totalM2/LDSP_SHEET_M2;

  content.innerHTML=`
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:#f0f0f0">
        <th style="text-align:left;padding:5px">Деталь</th>
        <th style="padding:5px">Кол</th>
        <th style="padding:5px">Ш×Г (мм)</th>
        <th style="padding:5px">м²</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr style="background:#e8f4f4;font-weight:700">
        <td colspan="3" style="padding:6px">ИТОГО ЛДСП</td>
        <td style="padding:6px">${fmt2(totalM2)} м² ≈ ${sheets.toFixed(2)} л</td>
      </tr></tfoot>
    </table>
    <div style="margin-top:12px;font-size:11px;color:#888">* Без учёта отходов. Нижние модули глубина ${depth}мм, верхние 350мм.</div>
  `;
  modal.style.display='flex';
}
function kShowCut(){
  const modal=document.getElementById('k-cut-modal');
  const content=document.getElementById('k-cut-content');
  if(!modal||!content) return;

  const depth  = parseInt(document.getElementById('k-depth')?.value||501);
  const floorH = parseInt(document.getElementById('k-floor-h')?.value||850);
  const LEG_H  = 100;
  const upperD = 350;
  const T = K_BOARD;  // 16мм
  // Формат листа выбирается в панели

  // Собираем все детали
  const parts = [];
  function addPart(name, w, h, qty=1){
    for(let i=0;i<qty;i++) parts.push({name, w:Math.round(w), h:Math.round(h)});
  }

  KitchenState.lower.forEach((m,mi)=>{
    const W=m.width, H=floorH-K_TOP-LEG_H, D=depth;
    const lbl=`Н${mi+1}(${W})`;
    addPart(`${lbl} Дно`, W, D);
    addPart(`${lbl} Верх`, W, D);
    addPart(`${lbl} Бок`, T, D, 2);
    if(m.type==='shelves') addPart(`${lbl} Полка`, W-T*2, D, 2);
    if(m.type==='drawers'){
      const dH=Math.floor((H-T*2)/3);
      addPart(`${lbl} Дно яш`, W-T*2, D-30, 3);
    }
  });

  KitchenState.upper.forEach((m,mi)=>{
    const W=m.width, H=m.height, D=upperD;
    const lbl=`В${mi+1}(${W})`;
    addPart(`${lbl} Дно`, W, D);
    addPart(`${lbl} Верх`, W, D);
    addPart(`${lbl} Бок`, T, D, 2);
    addPart(`${lbl} Полка`, W-T*2, D);
  });

  if(!parts.length){ content.innerHTML='<p class="hint">Нет модулей</p>'; modal.style.display='flex'; return; }

  // Формат листа — определяем ДО bin-packing
  const sheetFmt=document.getElementById('k-sheet-fmt')?.value||'2750x1830';
  const [LDSP_W, LDSP_H] = sheetFmt==='2800x2070' ? [2800,2070] : [2750,1830];

  // Простой раскрой: сортируем по убыванию площади и укладываем построчно
  const sorted=[...parts].sort((a,b)=>b.w*b.h - a.w*a.h);
  const sheets=[];
  function tryPlace(part){
    for(const sh of sheets){
      // простое bin-packing по строкам
      if(sh.curX+part.w<=LDSP_W && sh.curY+sh.rowH<=LDSP_H && sh.rowH>=part.h){
        sh.items.push({...part, x:sh.curX, y:sh.curY});
        sh.curX+=part.w+2;
        return;
      }
      if(sh.curX+part.w>LDSP_W){
        // новая строка
        sh.curY+=sh.rowH+2;
        sh.rowH=0; sh.curX=0;
        if(sh.curY+part.h<=LDSP_H){
          sh.rowH=part.h;
          sh.items.push({...part, x:sh.curX, y:sh.curY});
          sh.curX+=part.w+2;
          return;
        }
      }
    }
    // новый лист
    const sh={items:[{...part,x:0,y:0}], curX:part.w+2, curY:0, rowH:part.h};
    sheets.push(sh);
  }
  sorted.forEach(p=>tryPlace(p));

  // SVG раскрой каждого листа
  const scale=Math.min(320/LDSP_W, 200/LDSP_H);
  const SW=Math.round(LDSP_W*scale), SH=Math.round(LDSP_H*scale);
  const COLORS=['#d4e8d4','#e8d4d4','#d4d4e8','#e8e8d4','#e8d4e8','#d4e8e8'];
  let html2=`<div style="font-size:11px;color:#666;margin-bottom:8px">Листы ЛДСП ${LDSP_W}×${LDSP_H}мм | масштаб ~1:8</div>`;
  sheets.forEach((sh,si)=>{
    const used=sh.items.reduce((a,it)=>a+it.w*it.h,0)/(LDSP_W*LDSP_H)*100;
    html2+=`<div style="margin-bottom:14px"><div style="font-size:12px;font-weight:600;color:#1a5252;margin-bottom:4px">Лист ${si+1} — заполнено ${used.toFixed(0)}%</div>`;
    html2+=`<svg width="${SW}" height="${SH}" style="border:1px solid #ccc;border-radius:4px;background:#f9f9f9;display:block">`;
    // граница листа
    html2+=`<rect x="0" y="0" width="${SW}" height="${SH}" fill="none" stroke="#aaa" stroke-width="1"/>`;
    sh.items.forEach((it,ii)=>{
      const x=Math.round(it.x*scale), y=Math.round(it.y*scale);
      const w=Math.max(2,Math.round(it.w*scale)-1), h=Math.max(2,Math.round(it.h*scale)-1);
      const col=COLORS[ii%COLORS.length];
      html2+=`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${col}" stroke="#888" stroke-width="0.5" rx="1"/>`;
      if(w>20&&h>10){
        const fs=Math.max(6,Math.min(9,w/8));
        html2+=`<text x="${x+w/2}" y="${y+h/2}" text-anchor="middle" dominant-baseline="middle" font-size="${fs}" fill="#333" style="pointer-events:none">${it.name}</text>`;
        html2+=`<text x="${x+w/2}" y="${y+h/2+fs+1}" text-anchor="middle" font-size="${fs-1}" fill="#666" style="pointer-events:none">${it.w}×${it.h}</text>`;
      }
    });
    html2+=`</svg></div>`;
  });

  // Сводная таблица
  html2+=`<div style="margin-top:12px;font-size:12px;font-weight:700;color:#1a5252">Итого: ${sheets.length} лист(ов) ЛДСП</div>`;
  html2+=`<table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:8px">
    <thead><tr style="background:#f0f0f0"><th style="text-align:left;padding:4px">Деталь</th><th style="padding:4px">Ш×Г (мм)</th></tr></thead><tbody>`;
  parts.forEach(p=>{ html2+=`<tr><td style="padding:3px">${p.name}</td><td style="padding:3px;text-align:center">${p.w}×${p.h}</td></tr>`; });
  html2+=`</tbody></table>`;

  content.innerHTML=html2;
  modal.style.display='flex';
}
// ════════════════════════════════════════════════════════════
// ЧЕРТЁЖ КУХНИ — ВИД СПЕРЕДИ
// ════════════════════════════════════════════════════════════
let _kBlueprintSVG = ''; // кэш SVG для скачивания/печати

function kShowBlueprint(){
  const modal = document.getElementById('k-blueprint-modal');
  const content = document.getElementById('k-blueprint-content');
  if(!modal || !content) return;

  const floorH  = parseInt(document.getElementById('k-floor-h')?.value || 850);
  const depth   = parseInt(document.getElementById('k-depth')?.value   || 501);
  const upperGap= parseInt(document.getElementById('k-upper-gap')?.value || 600);
  const LEG_H   = 100;
  const T       = K_BOARD; // 16мм
  const TOP_H   = K_TOP;   // 38мм
  const UPPER_D = 350;

  const lowers  = KitchenState.lower;
  const uppers  = KitchenState.upper;

  const totalLW = lowers.reduce((s,m) => s+m.width, 0);
  const totalUW = uppers.reduce((s,m) => s+m.width, 0);
  const totalW  = Math.max(totalLW, totalUW, 600);

  // Общая высота сцены: от пола до верха верхних шкафов
  const upperBaseY  = floorH + upperGap; // от пола до низа верхних
  const maxUpperH   = uppers.length ? Math.max(...uppers.map(m=>m.height)) : 0;
  const totalSceneH = uppers.length ? upperBaseY + maxUpperH : floorH + 100;

  // SVG параметры
  const SCALE    = 0.38;          // мм → px (~1:2.6)
  const PAD_L    = 90;            // место для размерных линий слева
  const PAD_T    = 50;
  const PAD_R    = 40;
  const PAD_B    = 70;
  const DIM_OFF  = 22;            // отступ размерной линии
  const svgW     = Math.round(totalW * SCALE) + PAD_L + PAD_R;
  const svgH     = Math.round(totalSceneH * SCALE) + PAD_T + PAD_B;

  // Координатная функция: Y в SVG перевёрнут (0 = верх)
  const sx = x => PAD_L + Math.round(x * SCALE);
  const sy = y => PAD_T + Math.round((totalSceneH - y) * SCALE); // перевёрнуто

  // Цвета
  const C_CORP   = '#c8b89a';  // корпус
  const C_DOOR   = '#8fada0';  // дверь
  const C_TOP    = '#4a3828';  // столешница
  const C_SINK   = '#9bbaba';  // мойка
  const C_APPL   = '#888';     // техника
  const C_LEG    = '#aaa';     // ножка
  const C_DIM    = '#1d4ed8';  // размерная линия
  const C_DIM2   = '#059669';  // вторая размерная линия
  const C_HATCH  = '#e2e8f0';  // штриховка
  const C_GRID   = '#e5e7eb';  // сетка
  const C_TEXT   = '#1e293b';
  const C_WALL   = '#94a3b8';  // линия стены

  let svg = '';

  // ── Вспомогательные SVG-функции ──────────────────────────

  // Прямоугольник с заливкой и обводкой
  function rect(x,y,w,h,fill,stroke='#475569',sw=1,rx=0,opts=''){
    return `<rect x="${sx(x)}" y="${sy(y+h)}" width="${Math.max(1,Math.round(w*SCALE))}" height="${Math.max(1,Math.round(h*SCALE))}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" rx="${rx}" ${opts}/>`;
  }

  // Линия
  function line(x1,y1,x2,y2,color,sw=1,dash=''){
    return `<line x1="${sx(x1)}" y1="${sy(y1)}" x2="${sx(x2)}" y2="${sy(y2)}" stroke="${color}" stroke-width="${sw}" ${dash?`stroke-dasharray="${dash}"`:''} stroke-linecap="round"/>`;
  }

  // Размерная линия с текстом (горизонтальная)
  function dimH(x1,x2,y,label,color=C_DIM,textAbove=true){
    const px1=sx(x1), px2=sx(x2), py=sy(y);
    const mid=(px1+px2)/2;
    const ta = textAbove ? py-6 : py+14;
    return `<g>
      <line x1="${px1}" y1="${py}" x2="${px2}" y2="${py}" stroke="${color}" stroke-width="1" marker-start="url(#arr)" marker-end="url(#arr)"/>
      <line x1="${px1}" y1="${py-6}" x2="${px1}" y2="${py+6}" stroke="${color}" stroke-width="1"/>
      <line x1="${px2}" y1="${py-6}" x2="${px2}" y2="${py+6}" stroke="${color}" stroke-width="1"/>
      <text x="${mid}" y="${ta}" text-anchor="middle" font-size="9" fill="${color}" font-family="Inter,Arial,sans-serif" font-weight="600">${label}</text>
    </g>`;
  }

  // Размерная линия вертикальная
  function dimV(x,y1,y2,label,color=C_DIM,side=1){
    const px=sx(x)+(side>0?8:-8), py1=sy(y1), py2=sy(y2);
    const mid=(py1+py2)/2;
    const tx = side>0 ? px+14 : px-14;
    const ta = side>0 ? 'start' : 'end';
    return `<g>
      <line x1="${px}" y1="${py1}" x2="${px}" y2="${py2}" stroke="${color}" stroke-width="1" marker-start="url(#arr)" marker-end="url(#arr)"/>
      <line x1="${px-5}" y1="${py1}" x2="${px+5}" y2="${py1}" stroke="${color}" stroke-width="1"/>
      <line x1="${px-5}" y1="${py2}" x2="${px+5}" y2="${py2}" stroke="${color}" stroke-width="1"/>
      <text x="${tx}" y="${mid+3}" text-anchor="${ta}" font-size="9" fill="${color}" font-family="Inter,Arial,sans-serif" font-weight="600">${label}</text>
    </g>`;
  }

  // Текст по центру прямоугольника
  function labelRect(x,y,w,h,text,fs=9,col='#334155'){
    const cx=sx(x+w/2), cy=sy(y+h/2)+4;
    return `<text x="${cx}" y="${cy}" text-anchor="middle" font-size="${fs}" fill="${col}" font-family="Inter,Arial,sans-serif">${text}</text>`;
  }

  // Штриховка (диагональные линии внутри прямоугольника)
  function hatch(x,y,w,h,color='#cbd5e1',step=12){
    const lines=[];
    const px=sx(x), py=sy(y+h);
    const pw=Math.round(w*SCALE), ph=Math.round(h*SCALE);
    for(let i=-ph;i<pw+ph;i+=step){
      const x1=Math.max(px,px+i), y1=i<0?py-i:py;
      const x2=Math.min(px+pw,px+i+ph), y2=i+ph>pw?py+pw+ph-i-ph:py+ph;
      lines.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="0.7" stroke-linecap="round"/>`);
    }
    return `<g clip-path="url(#clip-${Math.round(x)}-${Math.round(y)})">${lines.join('')}</g>
      <clipPath id="clip-${Math.round(x)}-${Math.round(y)}"><rect x="${px}" y="${py}" width="${pw}" height="${ph}"/></clipPath>`;
  }

  // ── SVG заголовок ─────────────────────────────────────────
  svg += `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" style="font-family:Inter,Arial,sans-serif;background:#fff">`;

  // Маркеры стрелок
  svg += `<defs>
    <marker id="arr" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
      <path d="M0,0 L6,3 L0,6 Z" fill="${C_DIM}"/>
    </marker>
    <marker id="arr2" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
      <path d="M0,0 L6,3 L0,6 Z" fill="${C_DIM2}"/>
    </marker>
  </defs>`;

  // Рамка и название
  svg += `<rect x="0" y="0" width="${svgW}" height="${svgH}" fill="#fff" stroke="#e2e8f0" stroke-width="1"/>`;
  svg += `<rect x="2" y="2" width="${svgW-4}" height="${svgH-4}" fill="none" stroke="#cbd5e1" stroke-width="0.5"/>`;

  // Линия пола
  svg += `<line x1="${sx(-5)}" y1="${sy(0)}" x2="${sx(totalW+20)}" y2="${sy(0)}" stroke="${C_WALL}" stroke-width="2"/>`;
  svg += `<text x="${sx(totalW+22)}" y="${sy(0)+4}" font-size="8" fill="${C_WALL}" font-family="Inter,Arial,sans-serif">ПОЛ</text>`;

  // Линия стены (слева)
  svg += `<line x1="${sx(0)}" y1="${sy(0)}" x2="${sx(0)}" y2="${sy(totalSceneH)}" stroke="${C_WALL}" stroke-width="1.5" stroke-dasharray="6,3"/>`;

  // ── Нижние шкафы ──────────────────────────────────────────
  const CORP_H = floorH - TOP_H - LEG_H; // 712мм
  let xL = 0;

  lowers.forEach((mod, mi) => {
    const W = mod.width;

    // Ножки
    const legW = 28, legPad = 36;
    [legPad, W-legPad-legW].forEach(lx => {
      svg += rect(xL+lx, 0, legW, LEG_H, C_LEG, '#64748b', 0.8);
    });

    // Корпус
    // Левая боковина
    svg += rect(xL, LEG_H, T, CORP_H, C_CORP);
    // Правая боковина
    svg += rect(xL+W-T, LEG_H, T, CORP_H, C_CORP);
    // Дно
    svg += rect(xL+T, LEG_H, W-T*2, T, C_CORP);

    // Наполнение по типу
    if(mod.type === 'shelves'){
      // 2 полки
      [1/3, 2/3].forEach(f => {
        svg += rect(xL+T, LEG_H + T + (CORP_H-T)*f, W-T*2, T, C_CORP, '#64748b', 0.7);
      });
      // Фасад
      if(mod.facade === 'door'){
        svg += rect(xL, LEG_H, W, CORP_H, C_DOOR, '#2d6a5a', 1.2, 0, 'opacity="0.85"');
        // Ручка
        const hx = sx(xL + W*0.72), hy = sy(LEG_H + CORP_H*0.55);
        svg += `<line x1="${hx}" y1="${hy}" x2="${hx}" y2="${sy(LEG_H + CORP_H*0.45)}" stroke="#334155" stroke-width="2.5" stroke-linecap="round"/>`;
      }
    } else if(mod.type === 'drawers'){
      const dH = (CORP_H - T) / 3;
      for(let i=0; i<3; i++){
        const dy = LEG_H + T + dH*i;
        svg += rect(xL+1, dy+1, W-2, dH-2, C_DOOR, '#2d6a5a', 1, 0, 'opacity="0.9"');
        // Ручка ящика
        const hx1=sx(xL+W*0.25), hx2=sx(xL+W*0.75);
        const hy=sy(dy+dH*0.15);
        svg += `<line x1="${hx1}" y1="${hy}" x2="${hx2}" y2="${hy}" stroke="#334155" stroke-width="2.5" stroke-linecap="round"/>`;
      }
    } else if(mod.type === 'sink'){
      svg += hatch(xL+T, LEG_H+T, W-T*2, CORP_H-T, '#bae6fd');
      // Мойка
      const sinkY = LEG_H + CORP_H - 50;
      svg += rect(xL + W*0.15, sinkY, W*0.7, 40, C_SINK, '#0891b2', 1, 2);
      svg += labelRect(xL, LEG_H, W, CORP_H, '🚿', 14, '#0891b2');
    } else if(mod.type === 'appliance'){
      svg += hatch(xL+T, LEG_H+T, W-T*2, CORP_H-T, '#e2e8f0');
      svg += rect(xL+T+4, LEG_H+T+4, W-T*2-8, CORP_H-T-8, C_APPL, '#475569', 1, 3, 'opacity="0.7"');
      svg += labelRect(xL, LEG_H, W, CORP_H, '🔌', 14, '#475569');
    }

    // Размер модуля (над ним)
    svg += dimH(xL, xL+W, floorH + 18, `${W}`, C_DIM2, true);

    xL += W;
  });

  // Столешница
  if(lowers.length){
    svg += rect(0, floorH-TOP_H, totalLW, TOP_H, C_TOP, '#1e1008', 1.5);
    svg += labelRect(0, floorH-TOP_H, totalLW, TOP_H, `Столешница ${TOP_H}мм`, 8, '#e2e8f0');
  }

  // ── Верхние шкафы ─────────────────────────────────────────
  let xU = 0;
  uppers.forEach((mod, mi) => {
    const W = mod.width, H = mod.height;
    const baseY = upperBaseY; // от пола

    // Корпус
    svg += rect(xU,     baseY,   T, H, C_CORP);
    svg += rect(xU+W-T, baseY,   T, H, C_CORP);
    svg += rect(xU+T,   baseY,   W-T*2, T, C_CORP);
    svg += rect(xU+T,   baseY+H-T, W-T*2, T, C_CORP);
    // Полка
    svg += rect(xU+T,   baseY+H*0.5, W-T*2, T, C_CORP, '#64748b', 0.7);

    // Фасад
    if(mod.facade === 'door'){
      svg += rect(xU, baseY, W, H, C_DOOR, '#2d6a5a', 1.2, 0, 'opacity="0.8"');
      const hx = sx(xU + W*0.72), hy = sy(baseY + H*0.55);
      svg += `<line x1="${hx}" y1="${hy}" x2="${hx}" y2="${sy(baseY + H*0.45)}" stroke="#334155" stroke-width="2.5" stroke-linecap="round"/>`;
    }

    // Размер модуля
    svg += dimH(xU, xU+W, baseY+H+20, `${W}`, C_DIM2, true);
    xU += W;
  });

  // ── Глобальные размерные линии ─────────────────────────────
  const dimX = -65; // X позиция вертикальных линий (слева)

  // Высота ножек
  if(lowers.length)
    svg += dimV(dimX, 0, LEG_H, `${LEG_H}мм`, '#f59e0b', -1);

  // Высота корпуса
  if(lowers.length)
    svg += dimV(dimX, LEG_H, LEG_H+CORP_H, `${CORP_H}мм`, C_DIM, -1);

  // Столешница
  if(lowers.length)
    svg += dimV(dimX, floorH-TOP_H, floorH, `${TOP_H}мм`, '#8b5cf6', -1);

  // Полная высота кухни
  if(lowers.length)
    svg += dimV(dimX-30, 0, floorH, `${floorH}мм`, '#ef4444', -1);

  // Зазор до верхних
  if(lowers.length && uppers.length)
    svg += dimV(dimX, floorH, upperBaseY, `${upperGap}мм`, '#f97316', -1);

  // Высота верхних шкафов
  if(uppers.length){
    const maxH = Math.max(...uppers.map(m=>m.height));
    svg += dimV(dimX, upperBaseY, upperBaseY+maxH, `${maxH}мм`, C_DIM, -1);
  }

  // Общая ширина нижних
  if(lowers.length)
    svg += dimH(0, totalLW, -35, `${totalLW}мм`, '#ef4444', true);

  // Общая ширина верхних (если отличается)
  if(uppers.length && totalUW !== totalLW)
    svg += dimH(0, totalUW, upperBaseY + (uppers[0]?.height||720) + 30, `${totalUW}мм`, '#ef4444', true);

  // Глубина нижних (пунктир)
  if(lowers.length){
    const depthY = LEG_H + CORP_H/2;
    svg += `<text x="${sx(totalLW+8)}" y="${sy(depthY)+4}" font-size="8" fill="#94a3b8" font-family="Inter,Arial,sans-serif">глуб. ${depth}мм</text>`;
  }

  // ── Штамп (titleblock) ───────────────────────────────────
  const tbY = svgH - 46;
  svg += `<rect x="0" y="${tbY}" width="${svgW}" height="46" fill="#0f172a"/>`;
  svg += `<text x="14" y="${tbY+18}" font-size="13" font-weight="900" fill="#fff" font-family="Inter,Arial,sans-serif" letter-spacing="2">MEBELOFF</text>`;
  svg += `<text x="14" y="${tbY+32}" font-size="8" fill="#60a5fa" font-family="Inter,Arial,sans-serif">Чертёж кухни — вид спереди</text>`;
  svg += `<text x="14" y="${tbY+43}" font-size="7" fill="#475569" font-family="Inter,Arial,sans-serif">mebeloff.kz · Абая 68, Сатпаев</text>`;

  const today = new Date().toLocaleDateString('ru-RU');
  const scaleLabel = `Масштаб ~1:${Math.round(1/SCALE*10/10*10)}`;
  svg += `<text x="${svgW-14}" y="${tbY+18}" text-anchor="end" font-size="8" fill="#94a3b8" font-family="Inter,Arial,sans-serif">Дата: ${today}</text>`;
  svg += `<text x="${svgW-14}" y="${tbY+32}" text-anchor="end" font-size="8" fill="#94a3b8" font-family="Inter,Arial,sans-serif">${scaleLabel}</text>`;
  svg += `<text x="${svgW-14}" y="${tbY+43}" text-anchor="end" font-size="8" fill="#64748b" font-family="Inter,Arial,sans-serif">Н: ${lowers.length} мод. · В: ${uppers.length} мод.</text>`;

  // Легенда
  const lgX = svgW/2 - 120;
  svg += `<text x="${lgX}" y="${tbY+16}" font-size="7" fill="#64748b" font-family="Inter,Arial,sans-serif">■ <tspan fill="${C_CORP}">Корпус ЛДСП</tspan>  ■ <tspan fill="${C_DOOR}">Фасад</tspan>  ■ <tspan fill="${C_TOP}">Столешница</tspan>  ■ <tspan fill="${C_SINK}">Мойка/техника</tspan></text>`;
  svg += `<text x="${lgX}" y="${tbY+30}" font-size="7" fill="#64748b" font-family="Inter,Arial,sans-serif">— <tspan fill="${C_DIM2}">Ширина модулей</tspan>  — <tspan fill="${C_DIM}">Высоты</tspan>  — <tspan fill="#ef4444">Суммарная ширина</tspan></text>`;

  svg += '</svg>';
  _kBlueprintSVG = svg;

  // Рендерим в модалку
  content.innerHTML = `
    <div style="overflow-x:auto;background:#fff;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.08);padding:8px">
      ${svg}
    </div>
    <div style="margin-top:10px;padding:10px;background:#eff6ff;border-radius:8px;border:1px solid #bfdbfe;font-size:11px;color:#1e40af;line-height:1.6">
      <b>Условные обозначения:</b> размерные линии показывают точные размеры каждого модуля.
      Синие — ширина модулей, красные — суммарная ширина, серые — высоты.
      Штриховка = мойка/техника (открытый проём).
    </div>`;

  modal.style.display = 'flex';
}

function kCloseBlueprint(){
  const m = document.getElementById('k-blueprint-modal');
  if(m) m.style.display = 'none';
}

function kBlueprintDownload(){
  if(!_kBlueprintSVG) return;
  const blob = new Blob([_kBlueprintSVG], {type:'image/svg+xml'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'mebeloff-kitchen-blueprint.svg';
  a.click();
  URL.revokeObjectURL(a.href);
}

function kBlueprintPrint(){
  if(!_kBlueprintSVG) return;
  const win = window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html><head>
    <title>Чертёж кухни MebelOFF</title>
    <style>
      body{margin:0;padding:0;background:#fff}
      svg{max-width:100%;height:auto;display:block}
      @page{size:A4 landscape;margin:8mm}
      @media print{body{margin:0}}
    </style>
  </head><body>${_kBlueprintSVG}</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(()=>{ win.print(); win.close(); }, 400);
}

window.kShowBlueprint  = kShowBlueprint;
window.kCloseBlueprint = kCloseBlueprint;
window.kBlueprintDownload = kBlueprintDownload;
window.kBlueprintPrint = kBlueprintPrint;

function kCloseCut(){
  const m=document.getElementById('k-cut-modal'); if(m) m.style.display='none';
}
window.kCloseCut=kCloseCut; window.kShowCut=kShowCut;

function kCloseSpec(){
  const m=document.getElementById('k-spec-modal'); if(m) m.style.display='none';
}
window.kCloseSpec=kCloseSpec;

// ── Вспомогательная: добавить строку фурнитуры ────────────────
function kAddFurnRow(catName, qty){
  const arr=DB.furn;
  if(!arr||!arr.length) return;

  const cats=[...new Set(arr.map(x=>x.cat))];
  const fi=ST.furn.length;
  ST.furn.push({p:0});

  const fc=$('furn-list');
  if(!fc) return;
  if(fi===0) fc.innerHTML=''; // убираем hint

  // Строим DOM
  const fd=document.createElement('div');
  fd.id='furnr'+fi;
  if(fi>0) fd.className='ib';
  fd.style.marginTop='8px';

  // Ищем первую позицию в DB с этой категорией для цены
  const firstRow=arr.find(x=>x.cat===catName)||{p:0};

  fd.innerHTML=
    `<div class="fr">` +
      `<select id="furnc${fi}" onchange="uC('furn',${fi})">` +
        cats.map(c=>`<option value="${c}"${c===catName?' selected':''}>${c}</option>`).join('') +
      `</select>` +
      `<button class="db" onclick="$('furnr${fi}').style.display='none';ST.furn[${fi}]=null;recalc()">✕</button>` +
    `</div>` +
    `<div class="fr" id="furnvf${fi}"></div>` +
    `<div class="fr">` +
      `<span class="lb">Кол-во</span>` +
      `<input class="qi" type="number" id="furnq${fi}" value="${qty}" min="0" onchange="recalc()">` +
      `<span class="fp" id="furnpp${fi}">${firstRow.p.toLocaleString('ru')}₸</span>` +
    `</div>`;

  fc.appendChild(fd);

  // uC строит подселект vid/firm и вызывает uCP → обновляет ST.furn[fi].p
  uC('furn', fi);

  // Обновляем qty ПОСЛЕ uC (uC не трогает qty)
  const qEl=$('furnq'+fi);
  if(qEl) qEl.value=qty;

  // Обновляем цену в ST
  const catSel=$('furnc'+fi);
  const vidSel=$('furnv'+fi);
  const firmSel=$('furnf'+fi);
  const cat=catSel?.value||catName;
  const vid=vidSel?.value||'—';
  const firm=firmSel?.value||'—';
  const row=arr.find(x=>x.cat===cat&&(x.vid===vid||x.vid==='—')&&(x.firm===firm||x.firm==='—'||!x.firm));
  if(row&&ST.furn[fi]) ST.furn[fi]={p:row.p};
  const ppEl=$('furnpp'+fi);
  if(ppEl&&row) ppEl.textContent=row.p.toLocaleString('ru')+'₸';

  // Открываем секцию фурнитуры в калькуляторе
  const cb=$('cb-furn');
  if(cb&&!cb.classList.contains('op')) tog('furn');
}

// ── Мост: Кухня → Калькулятор ────────────────────────────────
function sendKitchenToCalc(){
  const depth   = parseInt(document.getElementById('k-depth')?.value||600);
  const floorH  = parseInt(document.getElementById('k-floor-h')?.value||850);
  const upperD  = 350;
  const facadeMat = document.getElementById('k-facade-mat')?.value || 'ldsp';
  // Формат листа ЛДСП: стандарт 2750×1830 (можно переключить на 2800×2070)
  const kSheetFmt = document.getElementById('k-sheet-fmt')?.value || '2750x1830';
  const [LDSP_W_MM, LDSP_H_MM] = kSheetFmt==='2800x2070' ? [2800,2070] : [2750,1830];
  const LDSP_SHEET_M2 = LDSP_W_MM/1000 * LDSP_H_MM/1000;
  const T = K_BOARD;

  // ── ХДФ задние стенки (стандарт MebelOFF: 4мм ХДФ) ────────
  // Нижние: W × H каждого модуля (без столешницы и ножек)
  // Верхние: W × H каждого модуля
  let hdfM2 = 0;
  KitchenState.lower.forEach(m=>{
    const W = m.width, H = floorH - K_TOP - 100;
    hdfM2 += (W * H) / 1e6;
  });
  KitchenState.upper.forEach(m=>{
    hdfM2 += (m.width * m.height) / 1e6;
  });
  // Пересчёт в листы ХДФ (формат 2800×2070)
  const HDF_SHEET_M2 = 2.8 * 2.07;
  const hdfSheets = Math.round((hdfM2 / HDF_SHEET_M2) * 100) / 100;

  // ── Подсчёт ЛДСП корпуса (стандарт MebelOFF 16мм) ──────────
  // Нижний: 2 боковины + дно (верхней крышки нет — столешница)
  // + полки если тип shelves
  let corpM2 = 0;
  KitchenState.lower.forEach(m=>{
    const W=m.width, H=floorH-K_TOP-100, D=depth;
    // 2 боковины (H × D каждая)
    corpM2 += 2*H*D/1e6;
    // дно (внутри боковин: (W-2T) × D)
    corpM2 += (W-T*2)*D/1e6;
    // полки
    if(m.type==='shelves') corpM2 += (W-T*2)*D*2/1e6; // 2 полки
    if(m.type==='drawers'){
      // дна ящиков (3 шт): ширина ящика × (D - задник)
      const dW=W-T*2-3; // ширина ящика (боковины + зазор)
      corpM2 += dW*(D-50)/1e6 * 3; // 3 дна ящиков
      // 2 боковины каждого ящика (3 ящика × 2 бока)
      const dH=(H-T)/3; // высота ящика
      corpM2 += 2*(dH*D/1e6)*3; // боковины ящиков (упрощённо)
    }
  });
  KitchenState.upper.forEach(m=>{
    const W=m.width, H=m.height, D=upperD;
    // 2 боковины + дно + верх + 1 полка
    corpM2 += 2*H*D/1e6;
    corpM2 += (W-T*2)*D/1e6 * 2; // дно + верх
    corpM2 += (W-T*2)*D/1e6;      // 1 полка
  });
  const corpSheets = Math.round((corpM2/LDSP_SHEET_M2)*100)/100;

  // ── Подсчёт площади фасадов (м²) ────────────────────────────
  let facM2 = 0;
  KitchenState.lower.forEach(m=>{
    if(m.facade!=='door') return;
    const W=m.width/1000;
    const H=(floorH-K_TOP-100)/1000;
    if(m.type==='drawers'){
      // 3 ящика-фасада
      facM2 += W * (H/3) * 3;
    } else {
      facM2 += W * H;
    }
  });
  KitchenState.upper.forEach(m=>{
    if(m.facade!=='door') return;
    facM2 += (m.width/1000) * (m.height/1000);
  });
  const facSheets = Math.round((facM2/LDSP_SHEET_M2)*100)/100;

  // ── Кромка ───────────────────────────────────────────────────
  let edgePm = 0;
  KitchenState.lower.forEach(m=>{
    const H=(floorH-K_TOP-100)/1000, D=depth/1000;
    edgePm += 2*(H+D)*2;                           // 2 бока × 2 торца
    if(m.facade==='door') edgePm += 2*(H+m.width/1000); // фасады
  });
  KitchenState.upper.forEach(m=>{
    const H=m.height/1000, D=upperD/1000;
    edgePm += 2*(H+D)*2;
    if(m.facade==='door') edgePm += 2*(H+m.width/1000);
  });
  edgePm = Math.ceil(edgePm);

  // ── Петли: 2 на дверь (ящики: 1 на ящик × 3) ────────────────
  let hinges = 0;
  KitchenState.lower.forEach(m=>{
    if(m.facade!=='door') return;
    hinges += m.type==='drawers' ? 3 : 2;
  });
  KitchenState.upper.forEach(m=>{ if(m.facade==='door') hinges+=2; });

  // ── Ручки ────────────────────────────────────────────────────
  let handles = 0;
  KitchenState.lower.forEach(m=>{
    if(m.facade!=='door') return;
    handles += m.type==='drawers' ? 3 : 1;
  });
  handles += KitchenState.upper.filter(m=>m.facade==='door').length;

  // ── Ножки: 4 на нижний модуль ────────────────────────────────
  const legs = KitchenState.lower.length * 4;

  // ── Сброс калькулятора ───────────────────────────────────────
  Object.keys(ST).forEach(k=>ST[k]=[]);
  // Очищаем списки в '' — kAddFurnRow сам решает показывать hint или нет
  ['ldsp-list','fldsp-list','fplen-list','fkr-list','furn-list',
   'kuh-list','shk-list','svet-list','dop-list','vit-list'].forEach(id=>{
    const e=$(id); if(e) e.innerHTML='';
  });
  ['hdf-qty','krom-qty'].forEach(id=>{ const e=$(id); if(e) e.value='0'; });

  let imported=0;

  // ── ЛДСП КОРПУС → раздел "ЛДСП корпус" ──────────────────────
  if(corpSheets>0 && DB.ldsp?.length){
    const i=ST.ldsp.length; ST.ldsp.push(0);
    const c=$('ldsp-list');
    if(c){
      if(i===0) c.innerHTML='';
      const d2=document.createElement('div');
      d2.id='lr'+i; if(i>0) d2.className='ib'; d2.style.marginTop='8px';
      const o=DB.ldsp.map((x,j)=>`<option value="${j}">${x.n} — ${x.p.toLocaleString('ru')}₸</option>`).join('');
      d2.innerHTML=`<div class="fr"><select id="ls${i}" onchange="ST.ldsp[${i}]=+this.value;$('lp${i}').textContent=DB.ldsp[+this.value].p.toLocaleString('ru')+'₸/л';recalc()">${o}</select><button class="db" onclick="$('lr${i}').style.display='none';ST.ldsp[${i}]=null;recalc()">✕</button></div><div class="fr"><span class="lb">Кол-во</span><input class="qi" type="number" inputmode="decimal" id="lq${i}" placeholder="0" min="0" step="0.01" onchange="recalc()"><span class="fp" id="lp${i}">${DB.ldsp[0]?.p?.toLocaleString('ru')||0}₸/л</span></div>`;
      c.appendChild(d2); $('lq'+i).value=corpSheets;
      const cb=$('cb-korp'); if(cb&&!cb.classList.contains('op')) tog('korp');
      imported++;
    }
  }

  // ── ФАСАД → нужный раздел калькулятора ───────────────────────
  if(facSheets>0 && facadeMat!=='none'){
    if(facadeMat==='ldsp' && DB.ldsp?.length){
      // Фасад ЛДСП → раздел fldsp
      const i=ST.fldsp.length; ST.fldsp.push(0);
      const c=$('fldsp-list');
      if(c){
        if(i===0) c.innerHTML='';
        const d2=document.createElement('div');
        d2.id='fldspr'+i; if(i>0) d2.className='ib'; d2.style.marginTop='8px';
        const o=DB.ldsp.map((x,j)=>`<option value="${j}">${x.n} — ${x.p.toLocaleString('ru')}₸</option>`).join('');
        d2.innerHTML=`<div class="fr"><select id="fldspsel${i}" onchange="ST.fldsp[${i}]=+this.value;recalc()">${o}</select><button class="db" onclick="$('fldspr${i}').style.display='none';ST.fldsp[${i}]=null;recalc()">✕</button></div><div class="fr"><span class="lb">Кол-во</span><input class="qi" type="number" inputmode="decimal" id="fldspq${i}" placeholder="0" min="0" step="0.01" onchange="recalc()"><span class="fp">${DB.ldsp[0]?.p?.toLocaleString('ru')||0}₸/л</span></div>`;
        c.appendChild(d2); $('fldspq'+i).value=facSheets;
        const cb=$('cb-fldsp'); if(cb&&!cb.classList.contains('op')) tog('fldsp');
        imported++;
      }
    } else if(facadeMat==='mdf_plen' && DB.fas_plen?.length){
      // МДФ Плёнка → fplen (м²)
      const i=ST.fplen.length; ST.fplen.push(0);
      const c=$('fplen-list');
      if(c){
        if(i===0) c.innerHTML='';
        const d2=document.createElement('div');
        d2.id='fplenr'+i; if(i>0) d2.className='ib'; d2.style.marginTop='8px';
        const o=DB.fas_plen.map((x,j)=>`<option value="${j}">${x.n} — ${x.p.toLocaleString('ru')}₸</option>`).join('');
        d2.innerHTML=`<div class="fr"><select id="fplensel${i}" onchange="ST.fplen[${i}]=+this.value;recalc()">${o}</select><button class="db" onclick="$('fplenr${i}').style.display='none';ST.fplen[${i}]=null;recalc()">✕</button></div><div class="fr"><span class="lb">Кол-во м²</span><input class="qi" type="number" inputmode="decimal" id="fplenq${i}" placeholder="0" min="0" step="0.01" onchange="recalc()"><span class="fp">${DB.fas_plen[0]?.p?.toLocaleString('ru')||0}₸</span></div>`;
        c.appendChild(d2); $('fplenq'+i).value=Math.round(facM2*100)/100;
        const cb=$('cb-fplen'); if(cb&&!cb.classList.contains('op')) tog('fplen');
        imported++;
      }
    } else if(facadeMat==='mdf_kr' && DB.fas_kr?.length){
      // МДФ Краска → fkr (м²)
      const i=ST.fkr.length; ST.fkr.push(0);
      const c=$('fkr-list');
      if(c){
        if(i===0) c.innerHTML='';
        const d2=document.createElement('div');
        d2.id='fkrr'+i; if(i>0) d2.className='ib'; d2.style.marginTop='8px';
        const o=DB.fas_kr.map((x,j)=>`<option value="${j}">${x.n} — ${x.p.toLocaleString('ru')}₸</option>`).join('');
        d2.innerHTML=`<div class="fr"><select id="fkrsel${i}" onchange="ST.fkr[${i}]=+this.value;recalc()">${o}</select><button class="db" onclick="$('fkrr${i}').style.display='none';ST.fkr[${i}]=null;recalc()">✕</button></div><div class="fr"><span class="lb">Кол-во м²</span><input class="qi" type="number" inputmode="decimal" id="fkrq${i}" placeholder="0" min="0" step="0.01" onchange="recalc()"><span class="fp">${DB.fas_kr[0]?.p?.toLocaleString('ru')||0}₸</span></div>`;
        c.appendChild(d2); $('fkrq'+i).value=Math.round(facM2*100)/100;
        const cb=$('cb-fkr'); if(cb&&!cb.classList.contains('op')) tog('fkr');
        imported++;
      }
    }
  }

  // ── Кромка ───────────────────────────────────────────────────
  if(edgePm>0){ const e=$('krom-qty'); if(e){ e.value=edgePm; imported++; } }

  // ── ХДФ задние стенки ────────────────────────────────────────
  if(hdfSheets>0){ const e=$('hdf-qty'); if(e){ e.value=hdfSheets; imported++; } }

  // ── Столешница (длина: ручная из k-top-len или авто по нижним) ─
  const topSel=document.getElementById('k-top-type');
  const topVid=topSel?.value;
  if(topVid && topVid!=='none'){
    const kuh=DB.kuh||[];
    const topRow=kuh.find(x=>x.cat==='Столешница'&&x.vid===topVid);
    if(topRow){
      // Длина: ручная если задана, иначе авто
      const lenInp = document.getElementById('k-top-len');
      const manualLen = lenInp ? parseFloat(lenInp.value)||0 : 0;
      const autoLen = Math.round(KitchenState.lower.reduce((s,m)=>s+m.width,0)/1000*100)/100;
      const totalM = manualLen > 0 ? manualLen : autoLen;
      const kuhCats=[...new Set(kuh.map(x=>x.cat))];
      const ki=ST.kuh.length; ST.kuh.push({cat:'Столешница',vid:topVid,p:topRow.p});
      const kl=$('kuh-list');
      if(kl){
        if(ki===0) kl.innerHTML='';
        const fd=document.createElement('div');
        fd.id='kuhr'+ki; if(ki>0) fd.className='ib'; fd.style.marginTop='8px';
        const catOpts=kuhCats.map(c=>`<option value="${c}"${c==='Столешница'?' selected':''}>${c}</option>`).join('');
        const vidOpts=kuh.filter(x=>x.cat==='Столешница')
          .map(v=>`<option value="${v.vid}"${v.vid===topVid?' selected':''}>${v.vid} — ${v.p.toLocaleString('ru')}₸</option>`).join('');
        fd.innerHTML=
          `<div class="fr"><select id="kuhc${ki}" onchange="uC('kuh',${ki})">${catOpts}</select>` +
          `<button class="db" onclick="$('kuhr${ki}').style.display='none';ST.kuh[${ki}]=null;recalc()">✕</button></div>` +
          `<div class="fr" id="kuhvf${ki}"><select id="kuhv${ki}" onchange="uCP('kuh',${ki})">${vidOpts}</select></div>` +
          `<div class="fr"><span class="lb">Кол-во пм</span>` +
          `<input class="qi" type="number" inputmode="decimal" id="kuhq${ki}" value="${totalM}" min="0" step="0.01" onchange="recalc()">` +
          `<span class="fp" id="kuhpp${ki}">${topRow.p.toLocaleString('ru')}₸/пм</span></div>`;
        kl.appendChild(fd);
        uCP('kuh',ki);
        const kuhCb=$('cb-kuh'); if(kuhCb&&!kuhCb.classList.contains('op')) tog('kuh');
        imported++;
      }
    }
  }

  // ── Петли ────────────────────────────────────────────────────
  if(hinges>0) kAddFurnRow('Петля', hinges);

  // ── Ручки ────────────────────────────────────────────────────
  if(handles>0){
    const ruchCat=['Руч-Скоба','Руч-Скрытая','Руч-Торцевая']
      .find(c=>DB.furn?.some(x=>x.cat===c))||'Руч-Скоба';
    kAddFurnRow(ruchCat, handles);
  }

  // ── Ножки ────────────────────────────────────────────────────
  if(legs>0) kAddFurnRow('Ножки', legs);

  // ── Телескопы (направляющие для ящиков) ─────────────────────
  // Стандарт кухни: глубина корпуса 600мм → внутренняя ≈ 516мм → телескоп 500мм
  // Формула: макс. длина телескопа = глубина − 84мм, берём ближайший размер снизу
  // Пара = 2 штуки на 1 ящик, 3 ящика на модуль
  const drawerModules = KitchenState.lower.filter(m=>m.type==='drawers');
  if(drawerModules.length > 0){
    // Подбираем длину телескопа по глубине корпуса
    const innerDepth = depth - 84; // внутренняя глубина ≈ глубина − 84мм
    // Стандартные длины телескопов (мм)
    const SLIDE_LENGTHS = [200, 250, 300, 350, 400, 450, 500, 550, 600];
    // Берём максимальный размер ≤ innerDepth
    const slideLen = SLIDE_LENGTHS.filter(l => l <= innerDepth).pop() || SLIDE_LENGTHS[0];
    const slideLenStr = slideLen + 'мм';

    // 3 ящика × кол-во модулей (1 телескоп = 1 ящик)
    const totalSlides = drawerModules.length * 3;

    // Ищем в DB.furn подходящий телескоп (Телескоп → нужный vid)
    const arr = DB.furn || [];
    // Предпочитаем 'Телескоп', fallback 'Телескоп-Д'
    const catPref = ['Телескоп','Телескоп-Д','СМ-полный'];
    let slideRow = null;
    for(const cat of catPref){
      slideRow = arr.find(x => x.cat===cat && x.vid===slideLenStr);
      if(slideRow) break;
    }
    // Если точного размера нет — берём ближайший доступный
    if(!slideRow){
      const avail = arr
        .filter(x => x.cat==='Телескоп' && parseInt(x.vid) <= innerDepth)
        .sort((a,b) => parseInt(b.vid) - parseInt(a.vid));
      slideRow = avail[0] || arr.find(x=>x.cat==='Телескоп');
    }

    if(slideRow){
      const catName = slideRow.cat;
      const vidName = slideRow.vid;
      // Используем надёжную kAddFurnRow, потом выбираем нужный vid
      kAddFurnRow(catName, totalSlides);
      // Выбираем правильный vid в только что добавленной строке
      const fi = ST.furn.length - 1;
      const vidSel = $('furnv'+fi);
      if(vidSel){
        for(const o of vidSel.options){
          if(o.value === vidName){ vidSel.value = vidName; uCP('furn', fi); break; }
        }
      }
      // Обновляем цену в бейдже
      const ppEl = $('furnpp'+fi);
      if(ppEl) ppEl.textContent = slideRow.p.toLocaleString('ru')+'₸';
      if(ST.furn[fi]) ST.furn[fi] = {p: slideRow.p};
      recalc();
    } else {
      // Если DB.furn пустой — добавляем просто кат. Телескоп
      kAddFurnRow('Телескоп', totalSlides);
    }
  }

  // ── Аксессуары кухни (kAccItems → Доп.Позиции без наценки) ──
  if(kAccItems.length){
    const acc = DB.acc||[];
    const dl = $('dop-list');
    if(dl){
      if(!ST.dop.length) dl.innerHTML='';
      kAccItems.forEach(item=>{
        const row = acc.find(x=>x.cat===item.cat&&x.vid===item.vid);
        if(!row) return;
        const di = ST.dop.length;
        ST.dop.push(1); // 1 = активная позиция (не null)
        const fd = document.createElement('div');
        fd.id = 'dr'+di;
        if(di>0) fd.className='ib';
        fd.style.marginTop='8px';
        fd.innerHTML =
          '<div class="fr">' +
          '<input style="font-size:12px;border:1px solid #ddd;border-radius:8px;padding:6px 8px;flex:1;min-width:0" type="text" id="dn'+di+'" value="'+item.cat+' '+item.vid+'">' +
          '<button class="db" onclick="$(\'dr'+di+'\').style.display=\'none\';ST.dop['+di+']=null;recalc()">✕</button>' +
          '</div>' +
          '<div class="fr"><span class="lb">Цена</span>' +
          '<input class="qi" type="number" inputmode="decimal" id="dp'+di+'" value="'+row.p+'" onchange="recalc()">' +
          '<span class="fp">₸/шт</span></div>' +
          '<div class="fr"><span class="lb">Кол-во</span>' +
          '<input class="qi" type="number" inputmode="decimal" id="dq'+di+'" value="'+item.qty+'" onchange="recalc()">' +
          '<span class="fp">шт</span></div>';
        dl.appendChild(fd);
      });
      const dopCb=$('cb-dop'); if(dopCb&&!dopCb.classList.contains('op')) tog('dop');
      imported++;
      recalc();
    }
  }

  // Финальный пересчёт уже после всех добавлений
  recalc();
  // Переходим в калькулятор
  page('calc'); tab('calc');
  const facLabel={'ldsp':'ЛДСП','mdf_plen':'МДФ Плёнка','mdf_kr':'МДФ Краска','none':'без фасада'}[facadeMat]||facadeMat;
  showStatus(`✓ Кухня: корпус ${corpSheets}л, ХДФ ${hdfSheets}л, фасад ${facLabel}${facSheets>0?' '+facSheets+'л':''}, кромка ${edgePm}пм, петли ${hinges}шт, ручки ${handles}шт, ножки ${legs}шт`, '#1a5252');
  setTimeout(hideStatus, 4000);
}
window.sendKitchenToCalc=sendKitchenToCalc;
window.initKitchen=initKitchen;
window.kRender=kRender;
window.kRenderPanel=kRenderPanel;
window.kAddLower=kAddLower; window.kAddUpper=kAddUpper;
window.kRemoveLower=kRemoveLower; window.kRemoveUpper=kRemoveUpper;
window.kUpdateLower=kUpdateLower; window.kUpdateUpper=kUpdateUpper;
window.kToggle=kToggle; window.kSwitchTab=kSwitchTab;
window.kShowSpec=kShowSpec; window.kShowPreview=kShowPreview;


// ════════════════════════════════════════════════════════════
// ЧЕРТЁЖ ШКАФА — ВИД СПЕРЕДИ
// ════════════════════════════════════════════════════════════
let _confBlueprintSVG = '';

function showConfBlueprint(){
  if(!sections.length){ alert('Нет секций'); return; }
  const modal   = document.getElementById('conf-blueprint-modal');
  const content = document.getElementById('conf-blueprint-content');
  if(!modal || !content) return;

  const BD = 16;   // толщина плиты мм (T)
  const LH = 100;  // высота ножек

  // Суммарная ширина всех секций
  const totalW = sections.reduce((s,sec) => s + sec.width, 0);
  // Максимальная высота (с антресолью)
  const maxH = sections.reduce((s,sec) => {
    const ant = sec.antresol?.enabled ? sec.antresol.height : 0;
    return Math.max(s, sec.height + ant);
  }, 0);
  const totalSceneH = LH + maxH + 60; // +60 для размерных линий сверху

  // SVG параметры
  const SCALE  = Math.min(0.38, 560 / totalW, 600 / totalSceneH);
  const PAD_L  = 80;
  const PAD_T  = 50;
  const PAD_R  = 40;
  const PAD_B  = 64;
  const svgW   = Math.round(totalW * SCALE) + PAD_L + PAD_R;
  const svgH   = Math.round(totalSceneH * SCALE) + PAD_T + PAD_B;

  const sx = x => PAD_L + Math.round(x * SCALE);
  const sy = y => PAD_T + Math.round((totalSceneH - y) * SCALE);

  // Цвета
  const C_CORP = '#c8b89a';
  const C_DOOR = '#8fada0';
  const C_DOOR_MDF = '#b5cce0';
  const C_SHELF= '#d4c5a9';
  const C_ROD  = '#94a3b8';
  const C_DIM  = '#1d4ed8';
  const C_DIM2 = '#059669';
  const C_RED  = '#ef4444';
  const C_LEG  = '#aaa';
  const C_WALL = '#94a3b8';
  const C_ANT  = '#e2d5be';

  function r(x,y,w,h,fill,stroke='#475569',sw=1,rx=0,op=''){
    return `<rect x="${sx(x)}" y="${sy(y+h)}" width="${Math.max(1,Math.round(w*SCALE))}" height="${Math.max(1,Math.round(h*SCALE))}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" rx="${rx}" ${op}/>`;
  }
  function l(x1,y1,x2,y2,color,sw=1,dash=''){
    return `<line x1="${sx(x1)}" y1="${sy(y1)}" x2="${sx(x2)}" y2="${sy(y2)}" stroke="${color}" stroke-width="${sw}" ${dash?`stroke-dasharray="${dash}"`:''} stroke-linecap="round"/>`;
  }
  function txt(x,y,text,fs=9,col='#334155',anchor='middle',dy=0){
    return `<text x="${x}" y="${y+dy}" text-anchor="${anchor}" font-size="${fs}" fill="${col}" font-family="Inter,Arial,sans-serif">${text}</text>`;
  }
  function dimH(x1,x2,y,label,col=C_DIM){
    const px1=sx(x1),px2=sx(x2),py=sy(y),mid=(px1+px2)/2;
    return `<g>
      <line x1="${px1}" y1="${py}" x2="${px2}" y2="${py}" stroke="${col}" stroke-width="1" marker-start="url(#ca)" marker-end="url(#ca)"/>
      <line x1="${px1}" y1="${py-5}" x2="${px1}" y2="${py+5}" stroke="${col}" stroke-width="1"/>
      <line x1="${px2}" y1="${py-5}" x2="${px2}" y2="${py+5}" stroke="${col}" stroke-width="1"/>
      ${txt(mid,py-7,label,8,col,'middle')}
    </g>`;
  }
  function dimV(x,y1,y2,label,col=C_DIM,side=-1){
    const off=side*38, px=sx(x)+off, py1=sy(y1), py2=sy(y2), mid=(py1+py2)/2;
    const ta=side<0?'end':'start', tx=px+(side<0?-6:6);
    return `<g>
      <line x1="${px}" y1="${py1}" x2="${px}" y2="${py2}" stroke="${col}" stroke-width="1" marker-start="url(#ca)" marker-end="url(#ca)"/>
      <line x1="${px-4}" y1="${py1}" x2="${px+4}" y2="${py1}" stroke="${col}" stroke-width="1"/>
      <line x1="${px-4}" y1="${py2}" x2="${px+4}" y2="${py2}" stroke="${col}" stroke-width="1"/>
      ${txt(tx,mid+3,label,8,col,ta)}
    </g>`;
  }

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">`;
  svg += `<defs>
    <marker id="ca" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
      <path d="M0,0 L6,3 L0,6 Z" fill="${C_DIM}"/>
    </marker>
  </defs>`;
  svg += `<rect x="0" y="0" width="${svgW}" height="${svgH}" fill="#fff" stroke="#e2e8f0" stroke-width="1"/>`;

  // Линия пола
  svg += l(-5, 0, totalW+20, 0, C_WALL, 2);
  svg += txt(sx(totalW+22), sy(0)+4, 'ПОЛ', 8, C_WALL, 'start');
  // Стена слева (пунктир)
  svg += l(0, 0, 0, totalSceneH, C_WALL, 1.5, '6,3');

  let xOff = 0;

  sections.forEach((sec, si) => {
    const W  = sec.width;
    const H  = sec.height;
    const D  = sec.depth;
    const antH = sec.antresol?.enabled ? sec.antresol.height : 0;
    const totalSecH = H + antH;

    // ── Ножки ──────────────────────────────────────────────
    const legW=24, legPad=30;
    [[legPad,0],[W-legPad-legW,0]].forEach(([lx])=>{
      svg += r(xOff+lx, 0, legW, LH, C_LEG, '#64748b', 0.8);
    });

    // ── Корпус ─────────────────────────────────────────────
    const baseY = LH;
    // Левая боковина
    svg += r(xOff,       baseY, BD, H, C_CORP);
    // Правая боковина
    svg += r(xOff+W-BD,  baseY, BD, H, C_CORP);
    // Дно
    svg += r(xOff+BD, baseY,    W-BD*2, BD, C_CORP);
    // Верх
    svg += r(xOff+BD, baseY+H-BD, W-BD*2, BD, C_CORP);
    // Задник (тонкая линия)
    svg += l(xOff+2, baseY+BD, xOff+2, baseY+H-BD, '#94a3b8', 0.5, '3,2');

    // ── Полки ──────────────────────────────────────────────
    sec.shelves.forEach(sh => {
      const sy_ = baseY + sh.height;
      svg += r(xOff+BD, sy_, W-BD*2, BD, C_SHELF, '#64748b', 0.7);
    });

    // ── Перегородки (вертикальные внутри) ─────────────────
    sec.dividers.forEach(div => {
      svg += r(xOff + div.pos - BD/2, baseY+BD, BD, H-BD*2, C_CORP, '#64748b', 0.7);
    });

    // ── Ящики (drawerBlocks) ───────────────────────────────
    if(sec.drawerBlocks?.length){
      sec.drawerBlocks.forEach(db => {
        const dCount = db.count || 3;
        const dTop   = db.top   || H-BD;
        const dBot   = db.bot   || BD;
        const blockH = dTop - dBot;
        const dH = blockH / dCount;
        for(let i=0; i<dCount; i++){
          const dy = baseY + dBot + dH*i;
          svg += r(xOff+BD+2, dy+2, W-BD*2-4, dH-4, C_DOOR, '#2d6a5a', 1, 0, 'opacity="0.85"');
          // ручка
          const hx1=sx(xOff+W*0.25), hx2=sx(xOff+W*0.75), hy_=sy(dy+dH*0.22);
          svg += `<line x1="${hx1}" y1="${hy_}" x2="${hx2}" y2="${hy_}" stroke="#334155" stroke-width="2" stroke-linecap="round"/>`;
        }
      });
    }

    // ── Штанга ─────────────────────────────────────────────
    if(sec.hasRod){
      const rodY = baseY + (sec.rodHeight || H*0.7);
      svg += l(xOff+BD+4, rodY, xOff+W-BD-4, rodY, C_ROD, 2.5);
      // Крючок-держатель
      [xOff+BD+20, xOff+W-BD-20].forEach(rx => {
        svg += `<circle cx="${sx(rx)}" cy="${sy(rodY)}" r="3" fill="${C_ROD}" stroke="#475569" stroke-width="0.7"/>`;
      });
    }

    // ── Фасад ──────────────────────────────────────────────
    const facType = sec.facade?.type || 'none';
    const facMat  = sec.facade?.material || 'ldsp';
    const facCol  = facMat === 'ldsp' ? C_DOOR : C_DOOR_MDF;

    if(facType !== 'none'){
      const nDoors = facType === 'doors1' ? 1 : facType === 'doors3' ? 3 : 2;
      const dw = (W - BD*2) / nDoors;
      for(let i=0; i<nDoors; i++){
        const mat = sec.facadeDoors?.[i]?.material || facMat;
        const fc  = mat === 'ldsp' ? C_DOOR : C_DOOR_MDF;
        svg += r(xOff+BD + dw*i + 1, baseY+1, dw-2, H-BD-2, fc, '#2d6a5a', 1.2, 0, 'opacity="0.88"');
        // ручка
        const hx=sx(xOff+BD+dw*(i+0.5));
        const hy_top=sy(baseY+H*0.65), hy_bot=sy(baseY+H*0.45);
        svg += `<line x1="${hx}" y1="${hy_top}" x2="${hx}" y2="${hy_bot}" stroke="#334155" stroke-width="2.5" stroke-linecap="round"/>`;
      }
    }

    // ── Антресоль ──────────────────────────────────────────
    if(sec.antresol?.enabled && antH > 0){
      const antBaseY = baseY + H;
      svg += r(xOff,        antBaseY, BD, antH, C_ANT, '#64748b', 1);
      svg += r(xOff+W-BD,   antBaseY, BD, antH, C_ANT, '#64748b', 1);
      svg += r(xOff+BD,     antBaseY, W-BD*2, BD, C_ANT, '#64748b', 1);
      svg += r(xOff+BD,     antBaseY+antH-BD, W-BD*2, BD, C_ANT, '#64748b', 1);
      const antFacType = sec.antresol.facade?.type || 'none';
      if(antFacType !== 'none'){
        svg += r(xOff+BD+1, antBaseY+1, W-BD*2-2, antH-BD-2, C_ANT, '#7a6a3a', 1, 0, 'opacity="0.8"');
        const hx=sx(xOff+W/2);
        svg += `<line x1="${hx}" y1="${sy(antBaseY+antH*0.6)}" x2="${hx}" y2="${sy(antBaseY+antH*0.4)}" stroke="#334155" stroke-width="2" stroke-linecap="round"/>`;
      }
      // Размер антресоли
      svg += dimH(xOff, xOff+W, baseY+H+antH+22, `${W}×${antH}`, '#8b5cf6');
    }

    // ── Размер секции по ширине ────────────────────────────
    svg += dimH(xOff, xOff+W, LH+H+18, `${W}`, C_DIM2);

    // ── Номер секции ───────────────────────────────────────
    const cx = sx(xOff+W/2), cy = sy(baseY+H/2);
    svg += `<circle cx="${cx}" cy="${cy}" r="10" fill="rgba(30,41,59,0.08)" stroke="#94a3b8" stroke-width="0.7"/>`;
    svg += txt(cx, cy+3, `${si+1}`, 9, '#334155');

    xOff += W;
  });

  // ── Глобальные размерные линии ─────────────────────────
  const firstSec = sections[0];
  const lastSec  = sections[sections.length-1];
  const H0 = firstSec.height;

  // Высота ножек
  svg += dimV(0, 0, LH, `${LH}мм`, '#f59e0b');
  // Высота корпуса первой секции
  svg += dimV(0, LH, LH+H0, `${H0}мм`, C_DIM);
  // Полная высота
  svg += dimV(-30, 0, LH+H0, `${LH+H0}мм`, C_RED);
  // Антресоль если есть
  if(firstSec.antresol?.enabled){
    const antH = firstSec.antresol.height;
    svg += dimV(0, LH+H0, LH+H0+antH, `${antH}мм`, '#8b5cf6');
    svg += dimV(-30, 0, LH+H0+antH, `${LH+H0+antH}мм`, C_RED);
  }
  // Глубина
  const depth0 = firstSec.depth;
  svg += txt(sx(totalW+8), sy(LH+H0/2)+4, `глуб.
${depth0}мм`, 8, '#94a3b8', 'start');
  // Суммарная ширина
  svg += dimH(0, totalW, -30, `${totalW}мм`, C_RED);

  // ── Штамп ───────────────────────────────────────────────
  const tbY = svgH - 50;
  svg += `<rect x="0" y="${tbY}" width="${svgW}" height="50" fill="#0f172a"/>`;
  svg += txt(14, tbY+18, 'MEBELOFF', 13, '#fff', 'start');
  svg += txt(14, tbY+32, 'Чертёж шкафа — вид спереди', 8, '#60a5fa', 'start');
  svg += txt(14, tbY+44, 'mebeloff.kz · Абая 68, Сатпаев', 7, '#475569', 'start');
  const today = new Date().toLocaleDateString('ru-RU');
  svg += txt(svgW-14, tbY+18, `Дата: ${today}`, 8, '#94a3b8', 'end');
  svg += txt(svgW-14, tbY+32, `Масштаб ~1:${Math.round(1/SCALE)}`, 8, '#94a3b8', 'end');
  svg += txt(svgW-14, tbY+44, `${sections.length} секц. · ${totalW}мм`, 8, '#64748b', 'end');

  // Легенда
  const lgX = svgW/2;
  svg += txt(lgX, tbY+18, `■ Корпус ЛДСП  ■ Фасад ЛДСП  ■ Фасад МДФ  ■ Антресоль`, 7, '#64748b', 'middle');
  svg += txt(lgX, tbY+30, `— Ширина секций  — Высоты  — Суммарная ширина`, 7, '#64748b', 'middle');

  svg += '</svg>';
  _confBlueprintSVG = svg;

  content.innerHTML = `
    <div style="overflow-x:auto;background:#fff;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.08);padding:8px">
      ${svg}
    </div>
    <div style="margin-top:10px;padding:10px;background:#eff6ff;border-radius:8px;border:1px solid #bfdbfe;font-size:11px;color:#1e40af;line-height:1.6">
      <b>Секции слева направо:</b>
      ${sections.map((s,i)=>`<b>${i+1}</b>: ${s.width}×${s.height}мм${s.antresol?.enabled?' +ант.'+s.antresol.height:''}${s.hasRod?' (штанга)':''}`).join(' · ')}
    </div>`;

  modal.style.display = 'flex';
}

function closeConfBlueprint(){
  const m = document.getElementById('conf-blueprint-modal');
  if(m) m.style.display = 'none';
}
function confBlueprintDownload(){
  if(!_confBlueprintSVG) return;
  const blob = new Blob([_confBlueprintSVG], {type:'image/svg+xml'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'mebeloff-wardrobe-blueprint.svg';
  a.click(); URL.revokeObjectURL(a.href);
}
function confBlueprintPrint(){
  if(!_confBlueprintSVG) return;
  const win = window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html><head>
    <title>Чертёж шкафа MebelOFF</title>
    <style>
      body{margin:0;padding:0;background:#fff}
      svg{max-width:100%;height:auto;display:block}
      @page{size:A4 landscape;margin:8mm}
    </style>
  </head><body>${_confBlueprintSVG}</body></html>`);
  win.document.close(); win.focus();
  setTimeout(()=>{ win.print(); win.close(); }, 400);
}
window.showConfBlueprint   = showConfBlueprint;
window.closeConfBlueprint  = closeConfBlueprint;
window.confBlueprintDownload = confBlueprintDownload;
window.confBlueprintPrint    = confBlueprintPrint;

window.addEventListener('load',()=>{
  loadPrices();
  loadHardware();
  loadCatalog();
  initThree();

  // ── Инициализация системы проектов ──────────────────────────
  const idx = projGetIndex();
  if(idx.length > 0){
    // Есть сохранённые проекты — загружаем последний открытый
    const loaded = projLoad(idx[0].id);
    if(loaded){
      renderPanel();
      render3D();
      renderMatCards();
      updateMaterials();
      projRenderTabs();
    } else {
      projNew();
    }
  } else {
    // Первый запуск — создаём новый проект
    projNew();
  }

  // Автозагрузка каталога при каждом запуске
  setTimeout(()=>{
    const st=document.getElementById('gs-status');
    if(st) st.textContent='Загружаю каталог...';
    loadFromSheets();
  }, 800);
});

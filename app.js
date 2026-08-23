/* ============================================================
   CONTROLE · Base SINAPI
   ============================================================ */

let DB = { items: {}, children: {}, tops: [], meta: {} };
let unitMemo = {};
let calendar = null;
let toastTimer = null;

let orcamento = [];
let nextOrcId = 1;
let bdiPercent = 0;
let abcLevel = 'item';
let abcChart = null;
let porItemChart = null;
let fluxoCharts = {mdo:null, mat:null, outros:null};
let fluxoPeriod = 'quinzena';
let ganttLevel = 'subitem';
let pendingFocusId = null;
let dragBlockIds = null;

/* ---------------- utilidades ---------------- */
function normalize(s){
  return (s||'').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
}
function fmtNum(n, dec=2){
  if(n===null||n===undefined||isNaN(n)) return '-';
  return Number(n).toLocaleString('pt-BR',{minimumFractionDigits:dec,maximumFractionDigits:dec});
}
function fmtDate(d){
  if(!d) return '-';
  const dt = (typeof d==='string') ? new Date(d+'T00:00:00') : d;
  if(isNaN(dt)) return '-';
  return dt.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'});
}
function toISO(d){
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), dd=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${dd}`;
}
function parseISO(s){ return new Date(s+'T00:00:00'); }
function addDays(d, n){ const r=new Date(d); r.setDate(r.getDate()+n); return r; }
function truncate(s,n){ return (s||'').length>n ? s.slice(0,n-1)+'…' : (s||''); }
function escapeXml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escapeAttr(s){ return String(s??'').replace(/"/g,'&quot;'); }
function round2(n){ return Math.round(n*100)/100; }
function fmtInput(n){ return (n===null||n===undefined||isNaN(n)) ? '' : round2(n); }

function showToast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>t.classList.remove('show'), 3200);
}

function showModal(title, message, buttons){
  return new Promise(resolve=>{
    const overlay = document.getElementById('modalOverlay');
    const box = document.getElementById('modalBox');
    box.innerHTML = `
      <h3>${title}</h3>
      <p>${message}</p>
      <div class="modal-actions">${buttons.map((b,i)=>`<button class="btn ${b.primary?'primary':''} ${b.danger?'danger':''}" data-mv="${i}">${b.label}</button>`).join('')}</div>
    `;
    overlay.style.display = 'flex';
    function cleanup(v){ overlay.style.display='none'; resolve(v); }
    box.querySelectorAll('[data-mv]').forEach(btn=>{
      btn.addEventListener('click', ()=> cleanup(buttons[+btn.dataset.mv].value));
    });
    overlay.addEventListener('click', function outside(e){
      if(e.target===overlay){ overlay.removeEventListener('click',outside); cleanup(null); }
    });
  });
}

function showDeleteConfirmModal(){
  return new Promise(resolve=>{
    const overlay = document.getElementById('modalOverlay');
    const box = document.getElementById('modalBox');
    box.innerHTML = `
      <h3>Excluir obra</h3>
      <p>Essa ação é permanente — apaga o orçamento, o cronograma e tudo mais deste projeto do banco de dados. Não tem como desfazer.</p>
      <p>Para confirmar, digite <b>excluir</b> abaixo:</p>
      <input type="text" id="delConfirmInput" class="cell" placeholder="digite: excluir" autocomplete="off">
      <div class="modal-error" id="delConfirmError">Digite exatamente "excluir" para confirmar.</div>
      <div class="modal-actions">
        <button class="btn" id="delCancelBtn">Cancelar</button>
        <button class="btn danger" id="delConfirmBtn">Excluir definitivamente</button>
      </div>
    `;
    overlay.style.display='flex';
    const inp = document.getElementById('delConfirmInput');
    inp.focus();
    function cleanup(v){ overlay.style.display='none'; resolve(v); }
    document.getElementById('delCancelBtn').addEventListener('click', ()=>cleanup(false));
    document.getElementById('delConfirmBtn').addEventListener('click', ()=>{
      if(inp.value.trim().toLowerCase()==='excluir') cleanup(true);
      else document.getElementById('delConfirmError').style.display='block';
    });
    inp.addEventListener('keydown', (e)=>{ if(e.key==='Enter') document.getElementById('delConfirmBtn').click(); });
    overlay.addEventListener('click', function outside(e){
      if(e.target===overlay){ overlay.removeEventListener('click',outside); cleanup(false); }
    });
  });
}

/* ============================================================
   1. CARGA DA BASE SINAPI
   ============================================================ */
async function loadSinapi(){
  try{
    const res = await fetch('sinapi_data.json');
    if(!res.ok) throw new Error('http '+res.status);
    DB = await res.json();
    if(!DB.meta) DB.meta = {};
    unitMemo = {};
    updateDataStamp();
    document.getElementById('loadStatus').textContent = '';
  }catch(e){
    document.getElementById('dataStamp').textContent = 'falha ao carregar base — use "Atualizar base SINAPI"';
    document.getElementById('loadStatus').textContent = 'Base SINAPI não encontrada. Envie a planilha atualizada pelo botão acima.';
    console.error(e);
  }
}
function updateDataStamp(sufixo){
  const ref = DB.meta && DB.meta.referencia ? `referência ${DB.meta.referencia}` : 'referência não identificada';
  document.getElementById('dataStamp').textContent = `${DB.tops.length.toLocaleString('pt-BR')} composições carregadas — ${ref}${sufixo||''}`;
}

let EAP_PADRAO = null;
async function loadEapPadrao(){
  if(EAP_PADRAO) return EAP_PADRAO;
  const res = await fetch('eap_padrao.json');
  if(!res.ok) throw new Error('http '+res.status);
  EAP_PADRAO = await res.json();
  return EAP_PADRAO;
}

function parseSinapiWorkbook(wb){
  const sheetName = wb.SheetNames.includes('Analítico') ? 'Analítico' : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, {header:1, raw:true, defval:null});
  const items = {}, children = {}, tops = [];
  for(let i=1;i<rows.length;i++){
    const r = rows[i];
    if(!r || r.length<6) continue;
    const [grupo, codComp, tipo, codItem, desc, un, coef] = r;
    if(codComp===null || codComp===undefined) continue;
    if(tipo===null || tipo===undefined || tipo===''){
      tops.push([grupo, codComp, desc, un]);
      if(!items[codComp]) items[codComp]=[desc,un];
    } else {
      if(!items[codItem]) items[codItem]=[desc,un];
      const tflag = (String(tipo).toUpperCase()==='INSUMO') ? 0 : 1;
      (children[codComp] = children[codComp]||[]).push([tflag, codItem, coef]);
    }
  }
  return {items, children, tops, meta:{}};
}

/* ============================================================
   2. EXPANSÃO RECURSIVA DAS COMPOSIÇÕES
   ============================================================ */
function emptyBreakdown(){ return {roles:{}, materials:{}, equip:{}}; }
function addTo(bucket, code, desc, unit, qty){
  if(!bucket[code]) bucket[code] = {desc, unit, qty:0};
  bucket[code].qty += qty;
}
function mergeScaled(target, source, factor){
  for(const bucketName of ['roles','materials','equip']){
    const src = source[bucketName];
    for(const code in src){
      addTo(target[bucketName], code, src[code].desc, src[code].unit, src[code].qty*factor);
    }
  }
}
function computeUnitBreakdown(code, computing){
  computing = computing || new Set();
  if(unitMemo[code]) return unitMemo[code];
  if(computing.has(code)) return emptyBreakdown();
  computing.add(code);
  const result = emptyBreakdown();
  const kids = DB.children[code] || [];
  for(const [tflag, childCode, coef] of kids){
    const item = DB.items[childCode];
    const desc = item ? item[0] : ('#'+childCode);
    const unit = item ? item[1] : '';
    if(desc && normalize(desc).startsWith('curso de capacita')){ continue; }
    if(unit==='H'){ addTo(result.roles, childCode, desc, unit, coef); continue; }
    if(unit==='CHP' || unit==='CHI'){ addTo(result.equip, childCode, desc, unit, coef); continue; }
    const hasChildren = DB.children[childCode] && DB.children[childCode].length>0;
    if(hasChildren){
      const sub = computeUnitBreakdown(childCode, computing);
      mergeScaled(result, sub, coef);
    } else {
      addTo(result.materials, childCode, desc, unit, coef);
    }
  }
  computing.delete(code);
  unitMemo[code] = result;
  return result;
}
function expandActivity(code, qty){
  const unit = computeUnitBreakdown(code);
  const out = emptyBreakdown();
  mergeScaled(out, unit, qty);
  return out;
}
function priceOf(code){
  const item = DB.items[code];
  if(!item || item.length<3) return null;
  return (item[2]===undefined) ? null : item[2];
}
function priceBreakdownUnit(code){
  const b = computeUnitBreakdown(code);
  let mdo=0, mat=0, equip=0, semPreco=false;
  for(const c in b.roles){ const p=priceOf(c); if(p===null) semPreco=true; else mdo+=p*b.roles[c].qty; }
  for(const c in b.materials){ const p=priceOf(c); if(p===null) semPreco=true; else mat+=p*b.materials[c].qty; }
  for(const c in b.equip){ const p=priceOf(c); if(p===null) semPreco=true; else equip+=p*b.equip[c].qty; }
  return {mdo, mat, equip, semPreco};
}

/* ============================================================
   3. CALENDÁRIO
   ============================================================ */
function easterDate(year){
  const a=year%19, b=Math.floor(year/100), c=year%100;
  const d=Math.floor(b/4), e=b%4, f=Math.floor((b+8)/25);
  const g=Math.floor((b-f+1)/3), h=(19*a+b-d-g+15)%30;
  const i=Math.floor(c/4), k=c%4, l=(32+2*e+2*i-h-k)%7;
  const m=Math.floor((a+11*h+22*l)/451);
  const month=Math.floor((h+l-7*m+114)/31), day=((h+l-7*m+114)%31)+1;
  return new Date(year, month-1, day);
}
function generateHolidays(year){
  const easter = easterDate(year);
  const list = [
    [new Date(year,0,1), 'Confraternização Universal', 'nacional'],
    [addDays(easter,-48), 'Carnaval (segunda)', 'nacional'],
    [addDays(easter,-47), 'Carnaval (terça)', 'nacional'],
    [addDays(easter,-2), 'Sexta-feira Santa', 'nacional'],
    [new Date(year,3,21), 'Tiradentes', 'nacional'],
    [new Date(year,4,1), 'Dia do Trabalho', 'nacional'],
    [addDays(easter,60), 'Corpus Christi', 'nacional'],
    [new Date(year,8,7), 'Independência do Brasil', 'nacional'],
    [new Date(year,9,12), 'Nossa Senhora Aparecida', 'nacional'],
    [new Date(year,10,2), 'Finados', 'nacional'],
    [new Date(year,10,15), 'Proclamação da República', 'nacional'],
    [new Date(year,10,20), 'Consciência Negra', 'nacional'],
    [new Date(year,11,25), 'Natal', 'nacional'],
    [new Date(year,9,19), 'Dia do Piauí', 'estadual'],
    [new Date(year,7,16), 'Aniversário de Teresina', 'municipal'],
    [new Date(year,11,8), 'Nossa Senhora da Conceição', 'municipal'],
  ];
  return list.map(([d,name,sphere])=>({date:toISO(d), name, sphere, enabled:true}));
}
function defaultCalendar(){
  return {
    start: toISO(new Date()),
    weekdays: [
      {enabled:false, hours:0},{enabled:true,hours:8},{enabled:true,hours:8},{enabled:true,hours:8},
      {enabled:true,hours:8},{enabled:true,hours:8},{enabled:true,hours:4},
    ],
    holidays: generateHolidays(new Date().getFullYear()).concat(generateHolidays(new Date().getFullYear()+1))
  };
}
function isHoliday(dateISO){ return calendar.holidays.some(h=>h.enabled && h.date===dateISO); }
function isWorkday(date){
  const dow = date.getDay();
  const wd = calendar.weekdays[dow];
  if(!wd || !wd.enabled) return false;
  if(isHoliday(toISO(date))) return false;
  return true;
}
function hoursOnDate(date){ if(!isWorkday(date)) return 0; return calendar.weekdays[date.getDay()].hours; }
function nextWorkday(date){ let d=new Date(date); while(!isWorkday(d)) d=addDays(d,1); return d; }
function addWorkdaysSigned(date, n){
  let d = new Date(date);
  if(n===0) return d;
  const step = n>0?1:-1;
  let count = 0;
  while(count < Math.abs(n)){ d = addDays(d, step); if(isWorkday(d)) count++; }
  return d;
}
function simulateActivity(earliestStart, roleHours){
  const remaining = {};
  let hasWork = false;
  for(const code in roleHours){
    remaining[code] = roleHours[code].hoursNeeded;
    if(remaining[code] > 0.0001) hasWork = true;
  }
  let cur = nextWorkday(earliestStart);
  const start = new Date(cur);
  if(!hasWork) return {start, end: start, days:1};
  let lastWorked = new Date(cur);
  let guard = 0;
  while(true){
    guard++;
    if(guard>20000) break;
    if(isWorkday(cur)){
      const dayHours = hoursOnDate(cur);
      let anyRemaining = false;
      for(const code in remaining){
        const qty = roleHours[code].qtyWorkers || 1;
        remaining[code] -= qty * dayHours;
        if(remaining[code] > 0.0001) anyRemaining = true;
      }
      lastWorked = new Date(cur);
      if(!anyRemaining) break;
    }
    cur = addDays(cur, 1);
  }
  return {start, end:lastWorked, days: Math.round((lastWorked-start)/86400000)+1};
}

/* ============================================================
   4. PREDECESSORAS
   ============================================================ */
function parsePreds(text){
  if(!text) return [];
  return text.split(',').map(s=>s.trim()).filter(Boolean).map(tok=>{
    const m = tok.match(/^(\d+)\s*([+-]\s*\d+)?$/);
    if(!m) return null;
    return {seq: parseInt(m[1],10), lag: m[2]? parseInt(m[2].replace(/\s/g,''),10) : 0};
  }).filter(Boolean);
}

/* ============================================================
   5. ORÇAMENTO — criação/edição/hierarquia de linhas
   ============================================================ */
function newOrcRow(level){
  return {
    id: nextOrcId++,
    level, // 'item' | 'subitem_principal' | 'subitem'
    nome: level==='item' ? 'Novo item' : level==='subitem_principal' ? 'Novo subitem principal' : 'Novo subitem',
    quant: level==='subitem' ? 0 : null,
    unidade: '',
    sinapiCode: '',
    mdo: 0, taxaMdo: 0, mat: 0, taxaMat: 0, equip: 0, taxaEquipPct: 0,
    semPreco: false,
    predText: '', roleAssign: {}, expanded: false,
  };
}

/* Acha o índice (exclusivo) onde termina o grupo que começa em startIndex.
   Item: vai até o próximo Item. Subitem principal: vai até o próximo
   subitem_principal ou item (ou seja, até o fim dos seus subitens filhos). */
function findGroupEnd(startIndex){
  const level = orcamento[startIndex].level;
  let i = startIndex+1;
  if(level==='item'){
    while(i<orcamento.length && orcamento[i].level!=='item') i++;
  } else if(level==='subitem_principal'){
    while(i<orcamento.length && orcamento[i].level==='subitem') i++;
  }
  return i;
}

const NIVEL_MODAL_BUTTONS = [
  {label:'Item', value:'item'},
  {label:'Subitem principal', value:'subitem_principal'},
  {label:'Subitem', value:'subitem', primary:true},
  {label:'Cancelar', value:null},
];
const NIVEL_MODAL_MSG = 'Essa linha é um <b>Item</b> (grupo/etapa, ex: "MURO"), um <b>Subitem principal</b> (agrupador dentro do item, ex: "2.1 Fundação" reunindo vários subitens) ou um <b>Subitem</b> (serviço com quantidade e custo)?';

async function addOrcRowGlobal(){
  const level = await showModal('Nova linha do orçamento', NIVEL_MODAL_MSG, NIVEL_MODAL_BUTTONS);
  if(!level) return;
  const row = newOrcRow(level);
  orcamento.push(row);
  pendingFocusId = row.id;
  recalcAll();
}

async function addOrcRowInGroup(anchorId){
  const level = await showModal('Nova linha do orçamento', NIVEL_MODAL_MSG, NIVEL_MODAL_BUTTONS);
  if(!level) return;
  const idx = orcamento.findIndex(r=>r.id===anchorId);
  if(idx===-1) return;
  const endIdx = findGroupEnd(idx);
  const row = newOrcRow(level);
  orcamento.splice(endIdx, 0, row);
  pendingFocusId = row.id;
  recalcAll();
}

function addSubitemUnderPrincipal(principalId){
  const idx = orcamento.findIndex(r=>r.id===principalId);
  if(idx===-1) return;
  const endIdx = findGroupEnd(idx);
  const row = newOrcRow('subitem');
  orcamento.splice(endIdx, 0, row);
  pendingFocusId = row.id;
  recalcAll();
}

async function loadEapPadraoIntoOrcamento(){
  const eap = await loadEapPadrao();
  orcamento = eap.map(([level, nome, code])=>({
    id: nextOrcId++,
    level,
    nome,
    quant: level==='subitem' ? 0 : null,
    unidade: '',
    sinapiCode: code || '',
    mdo:0, taxaMdo:0, mat:0, taxaMat:0, equip:0, taxaEquipPct:0, semPreco:false,
    predText:'', roleAssign:{}, expanded:false,
  }));
  orcamento.forEach(r=>{ if(r.level==='subitem' && r.sinapiCode) applySinapiPricing(r); });
}

function applySinapiPricing(row){
  const code = parseInt(row.sinapiCode,10);
  if(!code || !DB.items[code]){ row.semPreco=false; return; }
  const pb = priceBreakdownUnit(code);
  row.mdo = round2(pb.mdo);
  row.mat = round2(pb.mat);
  row.equip = round2(pb.equip);
  row.semPreco = pb.semPreco;
  row.unidade = row.unidade || (DB.items[code][1]||'');
}

/* ============================================================
   6. RECÁLCULO GERAL
   ============================================================ */
function recalcAll(){
  let itemSeq=0, subSeq=0, subSubSeq=0, seq=0, curPrincipal=null;
  orcamento.forEach(r=>{
    if(r.level==='item'){
      itemSeq++; subSeq=0; curPrincipal=null;
      r.numero = String(itemSeq);
    } else if(r.level==='subitem_principal'){
      subSeq++; subSubSeq=0; curPrincipal=r;
      r.numero = `${itemSeq}.${subSeq}`;
    } else {
      r.underPrincipal = !!curPrincipal;
      if(curPrincipal){ subSubSeq++; r.numero = `${itemSeq}.${subSeq}.${subSubSeq}`; }
      else { subSeq++; r.numero = `${itemSeq}.${subSeq}`; }
      seq++; r.seq = seq;
    }
  });

  const subitens = orcamento.filter(r=>r.level==='subitem');
  subitens.forEach(r=>{
    const code = parseInt(r.sinapiCode,10);
    if(code && DB.items[code]){
      r.valid = true;
      r.desc = DB.items[code][0];
      r.breakdown = expandActivity(code, r.quant||0);
    } else {
      r.valid = r.sinapiCode ? false : null;
      r.breakdown = emptyBreakdown();
    }
    r.roleAssign = r.roleAssign || {};
    for(const c in r.breakdown.roles){ if(!(c in r.roleAssign)) r.roleAssign[c] = 1; }

    const qty = r.quant||0;
    const totalMdoUnit = (r.mdo||0) + (r.taxaMdo||0);
    const totalMatUnit = (r.mat||0) + (r.taxaMat||0);
    const totalEquipUnit = (r.equip||0) * (1 + (r.taxaEquipPct||0)/100);
    const totalSemBdiUnit = totalMdoUnit + totalMatUnit + totalEquipUnit;
    r.totalMdoUnit=totalMdoUnit; r.totalMatUnit=totalMatUnit; r.totalEquipUnit=totalEquipUnit;
    r.totalSemBdiUnit=totalSemBdiUnit;
    r.totalMdoSemBdi=totalMdoUnit*qty; r.totalMatSemBdi=totalMatUnit*qty; r.totalEquipSemBdi=totalEquipUnit*qty;
    r.totalSemBdi=totalSemBdiUnit*qty;
    r.valorUnit=totalSemBdiUnit*(1+(bdiPercent||0)/100);
    r.valorTotal=r.valorUnit*qty;
  });

  let curItem=null, curPrincipal2=null, grandTotal=0;
  orcamento.forEach(r=>{
    if(r.level==='item'){
      curItem=r; curPrincipal2=null;
      r.totalMdoSemBdi=0; r.totalMatSemBdi=0; r.totalEquipSemBdi=0; r.totalSemBdi=0; r.valorTotal=0;
    } else if(r.level==='subitem_principal'){
      curPrincipal2=r;
      r.totalMdoSemBdi=0; r.totalMatSemBdi=0; r.totalEquipSemBdi=0; r.totalSemBdi=0; r.valorTotal=0;
    } else {
      if(curItem){
        curItem.totalMdoSemBdi+=r.totalMdoSemBdi; curItem.totalMatSemBdi+=r.totalMatSemBdi;
        curItem.totalEquipSemBdi+=r.totalEquipSemBdi; curItem.totalSemBdi+=r.totalSemBdi; curItem.valorTotal+=r.valorTotal;
      }
      if(curPrincipal2){
        curPrincipal2.totalMdoSemBdi+=r.totalMdoSemBdi; curPrincipal2.totalMatSemBdi+=r.totalMatSemBdi;
        curPrincipal2.totalEquipSemBdi+=r.totalEquipSemBdi; curPrincipal2.totalSemBdi+=r.totalSemBdi; curPrincipal2.valorTotal+=r.valorTotal;
      }
      grandTotal += r.valorTotal;
    }
  });
  orcamento.forEach(r=>{ r.incidencia = grandTotal>0 ? (r.valorTotal/grandTotal*100) : 0; });
  window._orcGrandTotal = grandTotal;

  const bySeq = {};
  subitens.forEach(r=>{ bySeq[r.seq]=r; r.preds = parsePreds(r.predText); r.scheduled=false; });
  const projStart = parseISO(calendar.start);
  let progress = true, passes = 0;
  while(progress && passes < subitens.length+2){
    progress = false; passes++;
    for(const act of subitens){
      if(act.scheduled) continue;
      let earliest = projStart, ready = true;
      for(const p of act.preds){
        const pred = bySeq[p.seq];
        if(!pred || pred===act) continue;
        if(!pred.scheduled){ ready=false; break; }
        const influence = addWorkdaysSigned(pred.end, p.lag);
        const candidate = p.lag>=0 ? addDays(influence,1) : influence;
        if(candidate > earliest) earliest = candidate;
      }
      if(!ready) continue;
      const roleHours = {};
      for(const c in act.breakdown.roles){ roleHours[c] = { hoursNeeded: act.breakdown.roles[c].qty, qtyWorkers: act.roleAssign[c]||1 }; }
      const sim = simulateActivity(earliest, roleHours);
      act.start = sim.start; act.end = sim.end; act.durationDays = sim.days;
      act.scheduled = true; progress = true;
    }
  }
  subitens.forEach(act=>{
    if(!act.scheduled){
      const roleHours = {};
      for(const c in act.breakdown.roles){ roleHours[c] = { hoursNeeded: act.breakdown.roles[c].qty, qtyWorkers: act.roleAssign[c]||1 }; }
      const sim = simulateActivity(projStart, roleHours);
      act.start=sim.start; act.end=sim.end; act.durationDays=sim.days; act.cyclic=true;
    } else act.cyclic=false;
  });

  renderAll();
  saveProject();
}

function renderAll(){
  renderOrcamento();
  renderOrcStats();
  renderAtividades();
  renderRecursos();
  renderStats();
  renderGantt();
  renderDashboardAll();
}

/* ============================================================
   7. RENDER — ORÇAMENTO
   ============================================================ */
function renderOrcStats(){
  const strip = document.getElementById('orcStatsStrip');
  if(!strip) return;
  const total = window._orcGrandTotal || 0;
  const subitens = orcamento.filter(r=>r.level==='subitem');
  const nSub = subitens.length;
  const semPreco = subitens.filter(r=>r.sinapiCode && r.semPreco).length;
  const bdiMul = 1+(bdiPercent||0)/100;
  const totalMdo = subitens.reduce((s,r)=>s+(r.totalMdoSemBdi||0),0)*bdiMul;
  const totalMat = subitens.reduce((s,r)=>s+(r.totalMatSemBdi||0),0)*bdiMul;
  const totalOutros = subitens.reduce((s,r)=>s+(r.totalEquipSemBdi||0),0)*bdiMul;
  const pct = v => total>0 ? (v/total*100) : 0;

  strip.innerHTML = `
    <div class="stat accent"><div class="lbl">Valor total do orçamento</div><div class="val" style="font-size:17px;">R$ ${fmtNum(total,2)}</div></div>
    <div class="stat"><div class="lbl">Valor total da mão de obra</div><div class="val" style="font-size:15px;">R$ ${fmtNum(totalMdo,2)} <span class="pct">(${fmtNum(pct(totalMdo),1)}%)</span></div></div>
    <div class="stat"><div class="lbl">Valor total de materiais</div><div class="val" style="font-size:15px;">R$ ${fmtNum(totalMat,2)} <span class="pct">(${fmtNum(pct(totalMat),1)}%)</span></div></div>
    <div class="stat"><div class="lbl">Outros valores (equip.)</div><div class="val" style="font-size:15px;">R$ ${fmtNum(totalOutros,2)} <span class="pct">(${fmtNum(pct(totalOutros),1)}%)</span></div></div>
    <div class="stat"><div class="lbl">Subitens</div><div class="val">${nSub}</div></div>
    ${semPreco>0?`<div class="stat"><div class="lbl">Atenção</div><div class="val" style="font-size:13px;color:var(--accent);">${semPreco} subitem(ns) com preço incompleto</div></div>`:''}
  `;
}

function orcRowHtml(r){
  if(r.level==='item'){
    return `<tr class="tr-orc-item" data-orc="${r.id}" draggable="true">
      <td><button class="icon-btn drag" title="Arrastar para reordenar">⠿</button></td>
      <td>${r.numero}</td>
      <td colspan="16"><input type="text" class="cell" style="background:transparent;border:none;font-weight:600;" data-orcf="nome" data-orc="${r.id}" value="${escapeAttr(r.nome)}"></td>
      <td class="num" style="font-family:var(--mono)">R$ ${fmtNum(r.valorTotal,2)}</td>
      <td class="num" style="font-family:var(--mono)">${fmtNum(r.incidencia,1)}%</td>
      <td class="orc-actions">
        <button class="icon-btn add" data-orcadd="${r.id}" title="Adicionar linha neste item">+</button>
        <button class="icon-btn" data-orcremove="${r.id}" title="Remover">✕</button>
      </td>
    </tr>`;
  }
  if(r.level==='subitem_principal'){
    return `<tr class="tr-orc-principal" data-orc="${r.id}" draggable="true">
      <td><button class="icon-btn drag" title="Arrastar para reordenar">⠿</button></td>
      <td>${r.numero}</td>
      <td colspan="16"><input type="text" class="cell" style="background:transparent;border:none;font-weight:600;padding-left:14px;" data-orcf="nome" data-orc="${r.id}" value="${escapeAttr(r.nome)}"></td>
      <td class="num" style="font-family:var(--mono)">R$ ${fmtNum(r.valorTotal,2)}</td>
      <td class="num" style="font-family:var(--mono)">${fmtNum(r.incidencia,1)}%</td>
      <td class="orc-actions">
        <button class="icon-btn add" data-orcaddchild="${r.id}" title="Adicionar subitem aqui">+</button>
        <button class="icon-btn" data-orcremove="${r.id}" title="Remover">✕</button>
      </td>
    </tr>`;
  }
  const semPrecoBadge = (r.sinapiCode && r.semPreco) ? '<span class="badge warn" title="Algum insumo dessa composição está sem preço cadastrado — soma parcial">parcial</span>' : '';
  return `<tr class="tr-orc-subitem${r.underPrincipal?' indent':''}" data-orc="${r.id}" draggable="true">
    <td><button class="icon-btn drag" title="Arrastar para reordenar">⠿</button></td>
    <td>${r.numero}</td>
    <td><input type="text" class="cell" data-orcf="nome" data-orc="${r.id}" value="${escapeAttr(r.nome)}"></td>
    <td class="num"><input type="number" class="cell small" style="width:60px;" data-orcf="quant" data-orc="${r.id}" value="${r.quant??''}" step="0.01"></td>
    <td><input type="text" class="cell" style="width:50px;" data-orcf="unidade" data-orc="${r.id}" value="${escapeAttr(r.unidade)}"></td>
    <td><div class="code-search"><input type="text" class="cell mono" data-orcf="sinapiCode" data-orc="${r.id}" value="${r.sinapiCode||''}" placeholder="código ou descrição…" autocomplete="off"></div> ${semPrecoBadge}</td>
    <td class="num"><input type="number" class="cell small" data-orcf="mdo" data-orc="${r.id}" value="${fmtInput(r.mdo)}" step="0.01" ${r.sinapiCode?'title="preenchido pelo SINAPI — edite se quiser sobrescrever"':''}></td>
    <td class="num"><input type="number" class="cell small" data-orcf="taxaMdo" data-orc="${r.id}" value="${fmtInput(r.taxaMdo)}" step="0.01"></td>
    <td class="num"><input type="number" class="cell small" data-orcf="mat" data-orc="${r.id}" value="${fmtInput(r.mat)}" step="0.01"></td>
    <td class="num"><input type="number" class="cell small" data-orcf="taxaMat" data-orc="${r.id}" value="${fmtInput(r.taxaMat)}" step="0.01"></td>
    <td class="num"><input type="number" class="cell small" data-orcf="equip" data-orc="${r.id}" value="${fmtInput(r.equip)}" step="0.01"></td>
    <td class="num"><input type="number" class="cell small" data-orcf="taxaEquipPct" data-orc="${r.id}" value="${fmtInput(r.taxaEquipPct)}" step="0.1"></td>
    <td class="num" style="font-family:var(--mono);color:var(--text-faint)">${fmtNum(r.totalSemBdiUnit,2)}</td>
    <td class="num" style="font-family:var(--mono);color:var(--text-faint)">${fmtNum(r.totalMdoSemBdi,2)}</td>
    <td class="num" style="font-family:var(--mono);color:var(--text-faint)">${fmtNum(r.totalMatSemBdi,2)}</td>
    <td class="num" style="font-family:var(--mono);color:var(--text-faint)">${fmtNum(r.totalEquipSemBdi,2)}</td>
    <td class="num" style="font-family:var(--mono)">${fmtNum(r.totalSemBdi,2)}</td>
    <td class="num" style="font-family:var(--mono)">${fmtNum(r.valorUnit,2)}</td>
    <td class="num" style="font-family:var(--mono);color:var(--accent)">${fmtNum(r.valorTotal,2)}</td>
    <td class="num" style="font-family:var(--mono)">${fmtNum(r.incidencia,1)}%</td>
    <td class="orc-actions"><button class="icon-btn" data-orcremove="${r.id}" title="Remover">✕</button></td>
  </tr>`;
}

function renderOrcamento(){
  const tbody = document.getElementById('tbodyOrcamento');
  document.getElementById('cOrc').textContent = orcamento.length;
  document.getElementById('emptyOrcamento').style.display = orcamento.length ? 'none':'block';

  tbody.innerHTML = orcamento.map(orcRowHtml).join('');

  bindOrcamentoEvents();
  bindOrcDragEvents();

  if(pendingFocusId){
    const inp = tbody.querySelector(`input[data-orcf="nome"][data-orc="${pendingFocusId}"]`);
    if(inp){ inp.focus(); inp.select(); }
    pendingFocusId = null;
  }
}

function bindOrcamentoEvents(){
  document.querySelectorAll('#tblOrcamento input[data-orcf]').forEach(inp=>{
    if(inp.dataset.orcf==='sinapiCode'){
      setupCodeSearch(inp, ()=>{
        const row = orcamento.find(r=>r.id==inp.dataset.orc);
        row.sinapiCode = inp.value.trim();
        applySinapiPricing(row);
        recalcAll();
      });
    }
    inp.addEventListener('change', ()=>{
      const row = orcamento.find(r=>r.id==inp.dataset.orc);
      const f = inp.dataset.orcf;
      if(f==='nome') row.nome = inp.value;
      else if(f==='unidade') row.unidade = inp.value;
      else if(f==='quant') row.quant = parseFloat(inp.value)||0;
      else if(f==='sinapiCode'){ row.sinapiCode = inp.value.trim(); applySinapiPricing(row); }
      else row[f] = parseFloat(inp.value)||0;
      recalcAll();
    });
  });
  document.querySelectorAll('[data-orcremove]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = +btn.dataset.orcremove;
      const idx = orcamento.findIndex(r=>r.id===id);
      if(idx===-1) return;
      const row = orcamento[idx];
      if(row.level==='item' || row.level==='subitem_principal'){
        const endIdx = findGroupEnd(idx);
        const n = endIdx - idx;
        if(n>1 && !confirm(`Isso remove "${row.nome}" e as ${n-1} linha(s) dentro dele. Continuar?`)) return;
        orcamento.splice(idx, n);
      } else {
        orcamento.splice(idx, 1);
      }
      recalcAll();
    });
  });
  document.querySelectorAll('[data-orcadd]').forEach(btn=>{
    btn.addEventListener('click', ()=> addOrcRowInGroup(+btn.dataset.orcadd));
  });
  document.querySelectorAll('[data-orcaddchild]').forEach(btn=>{
    btn.addEventListener('click', ()=> addSubitemUnderPrincipal(+btn.dataset.orcaddchild));
  });
}

/* Bloco de linhas que se move junto ao arrastar startIndex */
function computeDragBlock(startIndex){
  const end = findGroupEnd(startIndex);
  return orcamento.slice(startIndex, end).map(r=>r.id);
}

function bindOrcDragEvents(){
  const tbody = document.getElementById('tbodyOrcamento');
  tbody.querySelectorAll('tr[draggable="true"]').forEach(tr=>{
    tr.addEventListener('dragstart', (e)=>{
      const id = +tr.dataset.orc;
      const idx = orcamento.findIndex(r=>r.id===id);
      if(idx===-1) return;
      dragBlockIds = computeDragBlock(idx);
      e.dataTransfer.effectAllowed = 'move';
      try{ e.dataTransfer.setData('text/plain', String(id)); }catch(err){}
    });
    tr.addEventListener('dragover', (e)=>{ e.preventDefault(); tr.classList.add('drag-over'); });
    tr.addEventListener('dragleave', ()=> tr.classList.remove('drag-over'));
    tr.addEventListener('drop', (e)=>{
      e.preventDefault();
      tr.classList.remove('drag-over');
      if(!dragBlockIds) return;
      const targetId = +tr.dataset.orc;
      if(dragBlockIds.includes(targetId)){ dragBlockIds=null; return; }
      const block = orcamento.filter(r=>dragBlockIds.includes(r.id));
      orcamento = orcamento.filter(r=>!dragBlockIds.includes(r.id));
      const targetIdx = orcamento.findIndex(r=>r.id===targetId);
      dragBlockIds = null;
      if(targetIdx===-1) return;
      orcamento.splice(targetIdx, 0, ...block);
      recalcAll();
    });
    tr.addEventListener('dragend', ()=>{
      dragBlockIds = null;
      tbody.querySelectorAll('.drag-over').forEach(x=>x.classList.remove('drag-over'));
    });
  });
}

function setupCodeSearch(inp, onSelect){
  onSelect = onSelect || (()=>{});
  let acp = null;
  function close(){ if(acp){ acp.remove(); acp=null; } }
  inp.addEventListener('input', ()=>{
    close();
    const q = normalize(inp.value);
    if(q.length<2) return;
    const matches = [];
    for(const [grupo, codigo, desc, un] of DB.tops){
      if(matches.length>=30) break;
      const codeStr = String(codigo);
      if(codeStr.startsWith(inp.value.trim()) || normalize(desc).includes(q)){
        matches.push([grupo,codigo,desc,un]);
      }
    }
    acp = document.createElement('div');
    acp.className = 'acp';
    if(matches.length===0){
      acp.innerHTML = '<div class="acp-empty">Nenhuma composição encontrada</div>';
    } else {
      acp.innerHTML = matches.map(([g,c,d,u])=>`
        <div class="acp-item" data-code="${c}">
          <span class="acp-grupo">${g||''}</span>
          <span class="acp-unit">${u||''}</span>
          <div><span class="acp-code">${c}</span></div>
          <span class="acp-desc">${d}</span>
        </div>`).join('');
    }
    inp.parentElement.appendChild(acp);
    acp.querySelectorAll('.acp-item[data-code]').forEach(item=>{
      item.addEventListener('mousedown', (ev)=>{
        ev.preventDefault();
        inp.value = item.dataset.code;
        close();
        onSelect();
      });
    });
  });
  inp.addEventListener('blur', ()=> setTimeout(close, 150));
}

/* ============================================================
   8. RENDER — PLANEJAMENTO
   ============================================================ */
function fnLabel(desc){
  return (desc||'').replace(/ COM ENCARGOS COMPLEMENTARES.*$/i,'').replace(/\(HORISTA\)/i,'').trim();
}

function renderAtividades(){
  const tbody = document.getElementById('tbodyAtividades');
  const subitens = orcamento.filter(r=>r.level==='subitem');
  tbody.innerHTML = '';
  document.getElementById('cAtiv').textContent = subitens.length;
  document.getElementById('emptyAtividades').style.display = subitens.length ? 'none':'block';

  subitens.forEach(act=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><button class="icon-btn expand" data-act="${act.id}" title="Detalhar mão de obra">${act.expanded?'▾':'▸'}</button></td>
      <td class="num" style="font-family:var(--mono);color:var(--text-faint)">${act.seq}</td>
      <td>${escapeXml(act.nome||'')}</td>
      <td class="code" style="font-size:11.5px;">${act.sinapiCode || '<span style="color:var(--text-faint)">—</span>'}</td>
      <td class="code">${act.unidade||''}</td>
      <td class="num" style="font-family:var(--mono)">${fmtNum(act.quant,2)}</td>
      <td><input type="text" class="cell mono" data-field="predText" data-act="${act.id}" placeholder="ex: 2+3" value="${act.predText||''}"></td>
      <td class="num" style="font-family:var(--mono)">${act.durationDays? act.durationDays+'d':'-'} ${act.cyclic?'<span class="badge crit" title="Predecessora circular/ inválida">ciclo</span>':''}</td>
      <td style="font-family:var(--mono);font-size:11.5px;">${fmtDate(act.start)}</td>
      <td style="font-family:var(--mono);font-size:11.5px;">${fmtDate(act.end)}</td>
    `;
    tbody.appendChild(tr);
    if(act.expanded){
      const subTr = document.createElement('tr');
      subTr.className = 'row-sub';
      const td = document.createElement('td');
      td.colSpan = 10;
      td.appendChild(buildRoleEditor(act));
      subTr.appendChild(td);
      tbody.appendChild(subTr);
    }
  });
  bindActivityEvents();
}

function buildRoleEditor(act){
  const wrap = document.createElement('div');
  const roles = act.breakdown ? act.breakdown.roles : {};
  const codes = Object.keys(roles);
  if(codes.length===0){
    wrap.innerHTML = `<span class="hint">${act.sinapiCode ? 'Esta composição não possui mão de obra direta (H) identificada.' : 'Este subitem não tem código SINAPI — sem cálculo automático de mão de obra/duração. Defina o código na aba Orçamento.'}</span>`;
    return wrap;
  }
  let rowsHtml = '';
  codes.forEach(code=>{
    const r = roles[code];
    const qtyW = act.roleAssign[code] || 1;
    const dayHours = calendar.weekdays[1].hours || 8;
    const daysNeeded = (r.qty>0) ? (r.qty/(qtyW*Math.max(dayHours,0.1))) : 0;
    rowsHtml += `
      <tr>
        <td>${fnLabel(r.desc)}</td>
        <td class="num" style="font-family:var(--mono)">${fmtNum(r.qty,2)} h</td>
        <td class="num"><input type="number" min="1" step="1" class="cell small" data-role-act="${act.id}" data-role-code="${code}" value="${qtyW}"></td>
        <td class="num" style="font-family:var(--mono);color:var(--text-faint)">≈ ${fmtNum(daysNeeded,1)} dias</td>
      </tr>`;
  });
  wrap.innerHTML = `
    <div style="max-width:640px;">
      <div class="hint" style="margin-bottom:8px;">Ajuste a quantidade de trabalhadores por função — a duração recalcula automaticamente.</div>
      <table>
        <thead><tr><th>Função</th><th class="num">Horas necessárias</th><th class="num">Qtd. trabalhadores</th><th class="num">Dias (isolado)</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>`;
  return wrap;
}

function bindActivityEvents(){
  document.querySelectorAll('#tblAtividades input[data-field="predText"]').forEach(inp=>{
    inp.addEventListener('change', ()=>{
      const act = orcamento.find(r=>r.id==inp.dataset.act);
      act.predText = inp.value.trim();
      recalcAll();
    });
  });
  document.querySelectorAll('input[data-role-act]').forEach(inp=>{
    inp.addEventListener('change', ()=>{
      const act = orcamento.find(r=>r.id==inp.dataset.roleAct);
      const val = Math.max(1, parseFloat(inp.value)||1);
      act.roleAssign[inp.dataset.roleCode] = val;
      recalcAll();
    });
  });
  document.querySelectorAll('#tblAtividades .icon-btn.expand').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const act = orcamento.find(r=>r.id==btn.dataset.act);
      act.expanded = !act.expanded;
      renderAtividades();
    });
  });
}

/* ============================================================
   9. RENDER — RECURSOS
   ============================================================ */
function renderRecursos(){
  const subitens = orcamento.filter(r=>r.level==='subitem');
  const roleTotals = {}, matTotals = {}, equipTotals = {};
  subitens.forEach(act=>{
    if(!act.breakdown) return;
    for(const c in act.breakdown.roles){ addTo(roleTotals, c, act.breakdown.roles[c].desc, act.breakdown.roles[c].unit, act.breakdown.roles[c].qty); }
    for(const c in act.breakdown.materials){ addTo(matTotals, c, act.breakdown.materials[c].desc, act.breakdown.materials[c].unit, act.breakdown.materials[c].qty); }
    for(const c in act.breakdown.equip){ addTo(equipTotals, c, act.breakdown.equip[c].desc, act.breakdown.equip[c].unit, act.breakdown.equip[c].qty); }
  });
  fillSimpleTable('#tblMaoObra tbody', Object.values(roleTotals).sort((a,b)=>b.qty-a.qty), r=>`
    <tr><td>${fnLabel(r.desc)}</td><td class="num" style="font-family:var(--mono)">${fmtNum(r.qty,1)}</td><td class="num" style="font-family:var(--mono);color:var(--text-faint)">${fmtNum(r.qty/8,1)}</td></tr>`);
  fillSimpleTable('#tblMateriais tbody', Object.entries(matTotals).sort((a,b)=>b[1].qty-a[1].qty), ([code,r])=>`
    <tr><td class="code">${code}</td><td>${r.desc}</td><td>${r.unit}</td><td class="num" style="font-family:var(--mono)">${fmtNum(r.qty,2)}</td></tr>`);
  fillSimpleTable('#tblEquipamentos tbody', Object.entries(equipTotals).sort((a,b)=>b[1].qty-a[1].qty), ([code,r])=>`
    <tr><td class="code">${code}</td><td>${r.desc}</td><td>${r.unit}</td><td class="num" style="font-family:var(--mono)">${fmtNum(r.qty,2)}</td></tr>`);
  window._totals = {roleTotals, matTotals, equipTotals};
}
function fillSimpleTable(sel, arr, rowFn){
  const tb = document.querySelector(sel);
  tb.innerHTML = arr.length ? arr.map(rowFn).join('') : `<tr><td colspan="4" style="color:var(--text-faint);text-align:center;padding:20px;">Sem dados ainda</td></tr>`;
}

/* ============================================================
   10. RENDER — CRONOGRAMA / STATS / GANTT
   ============================================================ */
function renderStats(){
  const strip = document.getElementById('statsStrip');
  const subitens = orcamento.filter(r=>r.level==='subitem');
  if(subitens.length===0){ strip.innerHTML=''; return; }
  const valid = subitens.filter(a=>a.start && a.end);
  const minStart = valid.length? new Date(Math.min(...valid.map(a=>a.start))) : null;
  const maxEnd = valid.length? new Date(Math.max(...valid.map(a=>a.end))) : null;
  const totalDays = (minStart&&maxEnd) ? Math.round((maxEnd-minStart)/86400000)+1 : 0;
  let totalRoleHours=0; subitens.forEach(a=>{ if(a.breakdown) for(const c in a.breakdown.roles) totalRoleHours+=a.breakdown.roles[c].qty; });
  strip.innerHTML = `
    <div class="stat accent"><div class="lbl">Duração total</div><div class="val">${totalDays}<span class="unit">dias corridos</span></div></div>
    <div class="stat"><div class="lbl">Início</div><div class="val" style="font-size:16px;">${fmtDate(minStart)}</div></div>
    <div class="stat"><div class="lbl">Término</div><div class="val" style="font-size:16px;">${fmtDate(maxEnd)}</div></div>
    <div class="stat"><div class="lbl">Atividades</div><div class="val">${subitens.length}</div></div>
    <div class="stat"><div class="lbl">Horas de mão de obra</div><div class="val">${fmtNum(totalRoleHours,0)}<span class="unit">h</span></div></div>
  `;
}

function ganttSvgFor(rows, todayLine){
  const minStart = new Date(Math.min(...rows.map(r=>r.start)));
  const maxEnd = new Date(Math.max(...rows.map(r=>r.end)));
  const totalDays = Math.max(1, Math.round((maxEnd-minStart)/86400000)+1);
  const dayW = totalDays>90 ? 8 : totalDays>45 ? 14 : 24;
  const rowH = 26;
  const labelW = 280;
  const chartW = totalDays*dayW;
  const chartH = rows.length*rowH + 30;
  const today = new Date(); today.setHours(0,0,0,0);

  let svg = `<svg width="${labelW+chartW}" height="${chartH}" style="display:block;font-family:var(--mono);">`;
  for(let i=0;i<totalDays;i++){
    const d = addDays(minStart,i);
    const x = labelW + i*dayW;
    if(!isWorkday(d)) svg += `<rect x="${x}" y="0" width="${dayW}" height="${chartH}" fill="url(#hatch)" opacity="0.5"/>`;
    if(d.getDate()===1){
      svg += `<line x1="${x}" y1="0" x2="${x}" y2="${chartH}" stroke="#333c47" stroke-width="1"/>`;
      svg += `<text x="${x+3}" y="12" fill="#8a94a1" font-size="9">${d.toLocaleDateString('pt-BR',{month:'short',year:'2-digit'})}</text>`;
    }
  }
  svg += `<defs><pattern id="hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="#1a1f26"/><line x1="0" y1="0" x2="0" y2="6" stroke="#2b333e" stroke-width="3"/></pattern></defs>`;
  if(todayLine && today>=minStart && today<=maxEnd){
    const x = labelW + Math.round((today-minStart)/86400000)*dayW;
    svg += `<line x1="${x}" y1="0" x2="${x}" y2="${chartH}" stroke="#d9695b" stroke-width="1.5" stroke-dasharray="3,2"/>`;
  }
  rows.forEach((row,i)=>{
    const y = 30 + i*rowH;
    const x = labelW + Math.round((row.start-minStart)/86400000)*dayW;
    const w = Math.max(dayW*0.6, Math.round((row.end-row.start)/86400000+1)*dayW - 2);
    const barColor = row.isItem ? '#e8a33d' : (row.end<today ? 'var(--red)' : '#5b9dd9');
    const labelIndent = row.indent ? 16 : 0;
    const cursorAttr = row.clickable ? ` style="cursor:pointer;" data-toggle-item="${row.toggleId}"` : '';
    svg += `<g${cursorAttr}><rect x="0" y="${y}" width="${labelW+chartW}" height="${rowH}" fill="transparent"/>
      <text x="${8+labelIndent}" y="${y+15}" fill="${row.isItem?'#e7ebef':'#c7cdd4'}" font-size="11" font-family="Inter, sans-serif" font-weight="${row.isItem?600:400}">${row.clickable?(row.expanded?'▾ ':'▸ '):''}${escapeXml(row.label)}</text>
      <rect x="${x}" y="${y+4}" width="${w}" height="14" rx="2" fill="${barColor}" opacity="0.9"><title>${escapeXml(row.label+' · '+fmtDate(row.start)+' a '+fmtDate(row.end))}</title></rect>
    </g>`;
  });
  svg += `</svg>`;
  return svg;
}

function renderGantt(){
  const wrap = document.getElementById('ganttWrap');
  if(ganttLevel==='subitem'){
    const subitens = orcamento.filter(r=>r.level==='subitem' && r.start && r.end);
    if(subitens.length===0){ wrap.innerHTML = '<div class="empty-state">Adicione subitens no Orçamento para visualizar o cronograma.</div>'; return; }
    const rows = subitens.map(act=>({start:act.start, end:act.end, label:`${act.seq}. ${truncate(act.nome||act.sinapiCode||'—',34)}`, isItem:false}));
    wrap.innerHTML = ganttSvgFor(rows, true);
    return;
  }
  // nível item: agrupa por item, com expand/collapse
  const groups = [];
  let curGroup = null;
  orcamento.forEach(r=>{
    if(r.level==='item'){ curGroup = {item:r, children:[]}; groups.push(curGroup); }
    else if(r.level==='subitem' && curGroup) curGroup.children.push(r);
  });
  const rows = [];
  groups.forEach(g=>{
    const scheduled = g.children.filter(c=>c.start && c.end);
    if(scheduled.length===0) return;
    const start = new Date(Math.min(...scheduled.map(c=>c.start)));
    const end = new Date(Math.max(...scheduled.map(c=>c.end)));
    rows.push({start, end, label:`${g.item.numero} ${truncate(g.item.nome,32)}`, isItem:true, clickable:true, toggleId:g.item.id, expanded:!!g.item.ganttExpanded});
    if(g.item.ganttExpanded){
      scheduled.forEach(c=>{
        rows.push({start:c.start, end:c.end, label:`${c.seq}. ${truncate(c.nome||c.sinapiCode||'—',30)}`, isItem:false, indent:true});
      });
    }
  });
  if(rows.length===0){ wrap.innerHTML = '<div class="empty-state">Adicione subitens no Orçamento para visualizar o cronograma.</div>'; return; }
  wrap.innerHTML = ganttSvgFor(rows, true);
  wrap.querySelectorAll('[data-toggle-item]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const id = +el.dataset.toggleItem;
      const item = orcamento.find(r=>r.id===id);
      if(item) item.ganttExpanded = !item.ganttExpanded;
      renderGantt();
    });
  });
}

function setupGanttToggle(){
  document.getElementById('btnGanttSubitens').addEventListener('click', ()=>{
    ganttLevel='subitem';
    document.getElementById('btnGanttSubitens').classList.add('active');
    document.getElementById('btnGanttItens').classList.remove('active');
    renderGantt();
  });
  document.getElementById('btnGanttItens').addEventListener('click', ()=>{
    ganttLevel='item';
    document.getElementById('btnGanttItens').classList.add('active');
    document.getElementById('btnGanttSubitens').classList.remove('active');
    renderGantt();
  });
}

/* ============================================================
   11. BDI
   ============================================================ */
function setupBdiTab(){
  const inp = document.getElementById('bdiPercent');
  inp.value = bdiPercent;
  inp.addEventListener('change', ()=>{ bdiPercent = parseFloat(inp.value)||0; recalcAll(); });
}

/* ============================================================
   12. DASHBOARD
   ============================================================ */
function renderDashboardAll(){
  try{ renderDashboardAbc(); }catch(e){ console.error('Curva ABC:', e); }
  try{ renderChartPorItem(); }catch(e){ console.error('Custo por item:', e); }
  try{ renderFluxoCharts(); }catch(e){ console.error('Fluxo financeiro:', e); }
}

function renderDashboardAbc(){
  const canvas = document.getElementById('chartAbc');
  if(!canvas) return;
  if(typeof Chart==='undefined'){ document.getElementById('emptyDashboard').style.display='block'; document.getElementById('emptyDashboard').textContent='Biblioteca de gráficos não carregou (sem internet?).'; return; }
  const rows = orcamento.filter(r=> r.level===abcLevel && (r.valorTotal||0) > 0).sort((a,b)=> b.valorTotal - a.valorTotal);
  document.getElementById('emptyDashboard').style.display = rows.length ? 'none' : 'block';
  if(rows.length===0){ if(abcChart){ abcChart.destroy(); abcChart=null; } return; }

  const total = rows.reduce((s,r)=>s+r.valorTotal,0);
  let acc = 0;
  const labels = rows.map(r=>`${r.numero} ${truncate(r.nome,22)}`);
  const values = rows.map(r=>r.valorTotal);
  const cumPct = rows.map(r=>{ acc += r.valorTotal; return total>0 ? acc/total*100 : 0; });
  const barColors = cumPct.map(p=> p<=80 ? '#e8a33d' : p<=95 ? '#5b9dd9' : '#8a94a1');

  if(abcChart) abcChart.destroy();
  abcChart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { type:'bar', label:'Valor (R$)', data:values, backgroundColor:barColors, yAxisID:'y', order:2 },
        { type:'line', label:'Acumulado (%)', data:cumPct, borderColor:'#e7ebef', backgroundColor:'#e7ebef', borderWidth:1.5, pointRadius:2, yAxisID:'y1', order:1, tension:0.15 }
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false, interaction:{mode:'index', intersect:false},
      scales: {
        x:{ ticks:{color:'#b7c0cb', font:{size:10}, maxRotation:60, minRotation:40}, grid:{color:'#232a33'} },
        y:{ position:'left', ticks:{color:'#b7c0cb', callback:v=>'R$ '+fmtNum(v,0)}, grid:{color:'#232a33'}, title:{display:true,text:'Valor (R$)',color:'#b7c0cb'} },
        y1:{ position:'right', min:0, max:100, ticks:{color:'#b7c0cb', callback:v=>v+'%'}, grid:{drawOnChartArea:false}, title:{display:true,text:'Acumulado (%)',color:'#b7c0cb'} },
      },
      plugins: {
        legend:{ labels:{color:'#e7ebef'} },
        tooltip:{ callbacks:{ label:(ctx)=> ctx.dataset.type==='line' ? `Acumulado: ${fmtNum(ctx.parsed.y,1)}%` : `Valor: R$ ${fmtNum(ctx.parsed.y,2)}` } }
      }
    }
  });

  const stripTotal = rows.reduce((s,r)=>s+r.valorTotal,0);
  let acc2=0, classA=0, classB=0, classC=0;
  rows.forEach(r=>{ acc2+=r.valorTotal; const p=stripTotal>0?acc2/stripTotal*100:0; if(p<=80)classA++; else if(p<=95)classB++; else classC++; });
  const strip = document.getElementById('dashStatsStrip');
  strip.innerHTML = `
    <div class="stat accent"><div class="lbl">Valor total (nível ${abcLevel==='item'?'itens':'subitens'})</div><div class="val" style="font-size:18px;">R$ ${fmtNum(stripTotal,2)}</div></div>
    <div class="stat"><div class="lbl">Classe A</div><div class="val">${classA}<span class="unit">linhas</span></div></div>
    <div class="stat"><div class="lbl">Classe B</div><div class="val">${classB}<span class="unit">linhas</span></div></div>
    <div class="stat"><div class="lbl">Classe C</div><div class="val">${classC}<span class="unit">linhas</span></div></div>
  `;
}

function renderChartPorItem(){
  const canvas = document.getElementById('chartPorItem');
  if(!canvas || typeof Chart==='undefined') return;
  const items = orcamento.filter(r=>r.level==='item' && (r.valorTotal||0)>0).sort((a,b)=>b.valorTotal-a.valorTotal);
  document.getElementById('emptyPorItem').style.display = items.length?'none':'block';
  if(porItemChart){ porItemChart.destroy(); porItemChart=null; }
  if(items.length===0) return;
  porItemChart = new Chart(canvas.getContext('2d'), {
    type:'bar',
    data:{
      labels: items.map(r=>`${r.numero} ${truncate(r.nome,28)}`),
      datasets:[{label:'Valor total (R$)', data:items.map(r=>r.valorTotal), backgroundColor:'#e8a33d'}]
    },
    options:{
      indexAxis:'y', responsive:true, maintainAspectRatio:false,
      scales:{
        x:{ ticks:{color:'#b7c0cb', callback:v=>'R$ '+fmtNum(v,0)}, grid:{color:'#232a33'} },
        y:{ ticks:{color:'#e7ebef', font:{size:11}}, grid:{display:false} },
      },
      plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:ctx=>'R$ '+fmtNum(ctx.parsed.x,2) } } }
    }
  });
}

function periodKeyFor(date, periodType, projStart){
  if(periodType==='mes') return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
  const days = periodType==='semana'?7:14;
  const diff = Math.floor((date - projStart)/86400000);
  return `B${Math.floor(diff/days)}`;
}
function periodLabelFor(key, periodType, projStart){
  if(periodType==='mes'){
    const [y,m] = key.split('-').map(Number);
    return new Date(y, m-1, 1).toLocaleDateString('pt-BR',{month:'short',year:'2-digit'});
  }
  const days = periodType==='semana'?7:14;
  const bucket = parseInt(key.slice(1),10);
  const start = addDays(projStart, bucket*days);
  return start.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
}
function computeCashFlow(periodType){
  const subitens = orcamento.filter(r=>r.level==='subitem' && r.start && r.end);
  if(subitens.length===0) return null;
  const projStart = new Date(Math.min(...subitens.map(a=>a.start)));
  const bdiMul = 1+(bdiPercent||0)/100;
  const buckets = {};
  subitens.forEach(act=>{
    const workdays = [];
    let d = new Date(act.start);
    while(d<=act.end){ if(isWorkday(d)) workdays.push(new Date(d)); d = addDays(d,1); }
    if(workdays.length===0) workdays.push(new Date(act.start));
    const mdoTotal = (act.totalMdoSemBdi||0)*bdiMul;
    const matTotal = (act.totalMatSemBdi||0)*bdiMul;
    const outrosTotal = (act.totalEquipSemBdi||0)*bdiMul;
    const n = workdays.length;
    workdays.forEach(wd=>{
      const key = periodKeyFor(wd, periodType, projStart);
      if(!buckets[key]) buckets[key] = {mdo:0,mat:0,outros:0, sortDate:wd};
      buckets[key].mdo += mdoTotal/n;
      buckets[key].mat += matTotal/n;
      buckets[key].outros += outrosTotal/n;
      if(wd<buckets[key].sortDate) buckets[key].sortDate = wd;
    });
  });
  const keys = Object.keys(buckets).sort((a,b)=> buckets[a].sortDate - buckets[b].sortDate);
  return {
    labels: keys.map(k=>periodLabelFor(k, periodType, projStart)),
    mdo: keys.map(k=>buckets[k].mdo),
    mat: keys.map(k=>buckets[k].mat),
    outros: keys.map(k=>buckets[k].outros),
  };
}
function renderFluxoCharts(){
  const data = computeCashFlow(fluxoPeriod);
  const emptyEl = document.getElementById('emptyFluxo');
  if(emptyEl) emptyEl.style.display = data ? 'none' : 'block';
  ['mdo','mat','outros'].forEach(cat=>{ if(fluxoCharts[cat]){ fluxoCharts[cat].destroy(); fluxoCharts[cat]=null; } });
  if(!data || typeof Chart==='undefined') return;
  const colors = {mdo:'#e8a33d', mat:'#5b9dd9', outros:'#a58bd9'};
  const canvasIds = {mdo:'chartFluxoMdo', mat:'chartFluxoMat', outros:'chartFluxoOutros'};
  ['mdo','mat','outros'].forEach(cat=>{
    const canvas = document.getElementById(canvasIds[cat]);
    if(!canvas) return;
    fluxoCharts[cat] = new Chart(canvas.getContext('2d'), {
      type:'bar',
      data:{ labels:data.labels, datasets:[{label:'R$', data:data[cat], backgroundColor:colors[cat]}] },
      options:{
        responsive:true, maintainAspectRatio:false,
        scales:{
          x:{ ticks:{color:'#b7c0cb', font:{size:10}, maxRotation:60, minRotation:30}, grid:{color:'#232a33'} },
          y:{ ticks:{color:'#b7c0cb', callback:v=>'R$ '+fmtNum(v,0)}, grid:{color:'#232a33'} },
        },
        plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:ctx=>'R$ '+fmtNum(ctx.parsed.y,2) } } }
      }
    });
  });
}
function setFluxoPeriod(p){
  fluxoPeriod = p;
  document.getElementById('btnPerSemana').classList.toggle('active', p==='semana');
  document.getElementById('btnPerQuinzena').classList.toggle('active', p==='quinzena');
  document.getElementById('btnPerMes').classList.toggle('active', p==='mes');
  renderFluxoCharts();
}
function setupDashboardTab(){
  document.getElementById('btnAbcItens').addEventListener('click', ()=>{
    abcLevel='item';
    document.getElementById('btnAbcItens').classList.add('active');
    document.getElementById('btnAbcSubitens').classList.remove('active');
    renderDashboardAbc();
  });
  document.getElementById('btnAbcSubitens').addEventListener('click', ()=>{
    abcLevel='subitem';
    document.getElementById('btnAbcSubitens').classList.add('active');
    document.getElementById('btnAbcItens').classList.remove('active');
    renderDashboardAbc();
  });
  document.getElementById('btnPerSemana').addEventListener('click', ()=>setFluxoPeriod('semana'));
  document.getElementById('btnPerQuinzena').addEventListener('click', ()=>setFluxoPeriod('quinzena'));
  document.getElementById('btnPerMes').addEventListener('click', ()=>setFluxoPeriod('mes'));
}

/* ============================================================
   13. CRONOGRAMA — calendário embutido
   ============================================================ */
const WEEKDAY_NAMES = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
function renderCalendarTab(){
  const c = document.getElementById('weekdayConfig');
  c.innerHTML = calendar.weekdays.map((wd,i)=>`
    <div class="weekday-row">
      <label><input type="checkbox" data-wd="${i}" data-f="enabled" ${wd.enabled?'checked':''}> ${WEEKDAY_NAMES[i]}</label>
      <input type="number" class="cell" data-wd="${i}" data-f="hours" min="0" max="24" step="0.5" value="${wd.hours}" ${wd.enabled?'':'disabled'} style="width:70px;">
    </div>`).join('');
  c.querySelectorAll('input[data-wd]').forEach(inp=>{
    inp.addEventListener('change', ()=>{
      const i = +inp.dataset.wd;
      if(inp.dataset.f==='enabled') calendar.weekdays[i].enabled = inp.checked;
      else calendar.weekdays[i].hours = parseFloat(inp.value)||0;
      renderCalendarTab();
      recalcAll();
    });
  });
  document.getElementById('projStart').value = calendar.start;
  renderHolidaysTable();
}
function renderHolidaysTable(){
  const tb = document.querySelector('#tblFeriados tbody');
  const sorted = [...calendar.holidays].sort((a,b)=>a.date.localeCompare(b.date));
  tb.innerHTML = sorted.map((h)=>{
    const realIdx = calendar.holidays.indexOf(h);
    const sphereBadge = h.sphere==='nacional'?'ok':h.sphere==='estadual'?'warn':'crit';
    return `<tr>
      <td><input type="checkbox" ${h.enabled?'checked':''} data-hidx="${realIdx}" data-hf="enabled"></td>
      <td><input type="date" class="cell mono" style="font-size:11px;" value="${h.date}" data-hidx="${realIdx}" data-hf="date"></td>
      <td><input type="text" class="cell" value="${h.name}" data-hidx="${realIdx}" data-hf="name"></td>
      <td><span class="badge ${sphereBadge}">${h.sphere}</span></td>
      <td><button class="icon-btn" data-hremove="${realIdx}">✕</button></td>
    </tr>`;
  }).join('');
  tb.querySelectorAll('[data-hidx]').forEach(el=>{
    el.addEventListener('change', ()=>{
      const idx = +el.dataset.hidx, f = el.dataset.hf;
      if(f==='enabled') calendar.holidays[idx].enabled = el.checked;
      else if(f==='date') calendar.holidays[idx].date = el.value;
      else if(f==='name') calendar.holidays[idx].name = el.value;
      recalcAll();
    });
  });
  tb.querySelectorAll('[data-hremove]').forEach(btn=>{
    btn.addEventListener('click', ()=>{ calendar.holidays.splice(+btn.dataset.hremove,1); renderHolidaysTable(); recalcAll(); });
  });
}
function setupCalendarTab(){
  document.getElementById('projStart').addEventListener('change', e=>{ calendar.start = e.target.value; recalcAll(); });
  document.getElementById('btnGenHolidays').addEventListener('click', ()=>{
    const year = parseInt(document.getElementById('genYear').value,10);
    if(!year) return;
    const existing = new Set(calendar.holidays.map(h=>h.date));
    const gen = generateHolidays(year).filter(h=>!existing.has(h.date));
    calendar.holidays = calendar.holidays.concat(gen);
    renderHolidaysTable();
    recalcAll();
    showToast(`${gen.length} feriados de ${year} adicionados.`);
  });
  document.getElementById('btnAddHoliday').addEventListener('click', ()=>{
    calendar.holidays.push({date: toISO(new Date()), name:'Novo feriado', sphere:'municipal', enabled:true});
    renderHolidaysTable(); recalcAll();
  });
  document.getElementById('calToggle').addEventListener('click', ()=>{
    document.getElementById('calToggle').classList.toggle('open');
    document.getElementById('calBody').classList.toggle('open');
  });
}

/* ============================================================
   14. CONFIGURAÇÃO
   ============================================================ */
function collectConfig(){
  return {
    nome: document.getElementById('cfgNome').value,
    createdAt: window._createdAt || new Date().toISOString(),
    cliente: document.getElementById('cfgCliente').value,
    telefone: document.getElementById('cfgTelefone').value,
    email: document.getElementById('cfgEmail').value,
    endereco: document.getElementById('cfgEndereco').value,
    tipo: document.getElementById('cfgTipo').value,
    subtipo: document.getElementById('cfgSubtipo').value,
  };
}
function applyConfig(cfg){
  cfg = cfg || {};
  document.getElementById('cfgNome').value = cfg.nome || 'Nova obra';
  window._createdAt = cfg.createdAt || new Date().toISOString();
  document.getElementById('cfgCriadoEm').value = fmtDate(new Date(window._createdAt));
  document.getElementById('cfgCliente').value = cfg.cliente || '';
  document.getElementById('cfgTelefone').value = cfg.telefone || '';
  document.getElementById('cfgEmail').value = cfg.email || '';
  document.getElementById('cfgEndereco').value = cfg.endereco || '';
  document.getElementById('cfgTipo').value = cfg.tipo || 'Residencial';
  document.getElementById('cfgSubtipo').value = cfg.subtipo || 'Construção';
}
function setupConfigTab(){
  ['cfgNome','cfgCliente','cfgTelefone','cfgEmail','cfgEndereco','cfgTipo','cfgSubtipo'].forEach(id=>{
    document.getElementById(id).addEventListener('change', ()=>{
      if(id==='cfgNome') refreshProjectSelect();
      saveProject();
    });
  });
  document.getElementById('btnDeleteProject').addEventListener('click', deleteCurrentProject);
}

/* ============================================================
   15. EXPORTAÇÃO EXCEL
   ============================================================ */
function exportExcel(){
  const wb = XLSX.utils.book_new();
  const subitens = orcamento.filter(r=>r.level==='subitem');

  const cronoRows = [['#','Descrição','Código SINAPI','Unidade','Quantidade','Predecessoras','Duração (dias)','Início','Fim']];
  subitens.forEach(a=>cronoRows.push([a.seq, a.nome, a.sinapiCode||'', a.unidade||'', a.quant||0, a.predText||'', a.durationDays||'', a.start?fmtDate(a.start):'', a.end?fmtDate(a.end):'']));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cronoRows), 'Cronograma');

  const {roleTotals, matTotals, equipTotals} = window._totals || {roleTotals:{},matTotals:{},equipTotals:{}};
  const roleRows = [['Função','Horas totais','Homens-dia (8h)']];
  Object.values(roleTotals).forEach(r=>roleRows.push([fnLabel(r.desc), Number(r.qty.toFixed(2)), Number((r.qty/8).toFixed(2))]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(roleRows), 'Mao de obra');

  const matRows = [['Código','Descrição','Unidade','Quantidade']];
  Object.entries(matTotals).forEach(([code,r])=>matRows.push([code, r.desc, r.unit, Number(r.qty.toFixed(3))]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matRows), 'Materiais');

  const equipRows = [['Código','Descrição','Unidade','Quantidade']];
  Object.entries(equipTotals).forEach(([code,r])=>equipRows.push([code, r.desc, r.unit, Number(r.qty.toFixed(3))]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(equipRows), 'Equipamentos');

  if(orcamento.length){
    const orcRows = [[
      'Item','Discriminação do evento','Quant.','Unid.','SINAPI','MDO (R$)','Taxa extra MDO (R$)',
      'MAT (R$)','Taxa extra MAT (R$)','EQUIP (R$)','Taxa extra EQUIP (%)','Total sem BDI/unid. (R$)',
      'Total MDO sem BDI (R$)','Total MAT sem BDI (R$)','Total EQUIP sem BDI (R$)','Total sem BDI (R$)',
      'Valor unit. (R$)','Valor total (R$)','Incidência (%)'
    ]];
    orcamento.forEach(r=>{
      if(r.level!=='subitem'){
        orcRows.push([r.numero, r.nome,'','','','','','','','','','','','','',
          Number((r.totalSemBdi||0).toFixed(2)),'', Number((r.valorTotal||0).toFixed(2)), Number((r.incidencia||0).toFixed(2))]);
      } else {
        orcRows.push([
          r.numero, r.nome, r.quant||0, r.unidade||'', r.sinapiCode||'',
          Number((r.mdo||0).toFixed(2)), Number((r.taxaMdo||0).toFixed(2)),
          Number((r.mat||0).toFixed(2)), Number((r.taxaMat||0).toFixed(2)),
          Number((r.equip||0).toFixed(2)), Number((r.taxaEquipPct||0).toFixed(2)),
          Number((r.totalSemBdiUnit||0).toFixed(2)), Number((r.totalMdoSemBdi||0).toFixed(2)),
          Number((r.totalMatSemBdi||0).toFixed(2)), Number((r.totalEquipSemBdi||0).toFixed(2)),
          Number((r.totalSemBdi||0).toFixed(2)), Number((r.valorUnit||0).toFixed(2)),
          Number((r.valorTotal||0).toFixed(2)), Number((r.incidencia||0).toFixed(2))
        ]);
      }
    });
    orcRows.push([]);
    orcRows.push(['BDI aplicado (%)', bdiPercent]);
    orcRows.push(['Valor total do orçamento (R$)', Number((window._orcGrandTotal||0).toFixed(2))]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(orcRows), 'Orcamento');
  }

  const cfg = collectConfig();
  const cfgRows = [
    ['Nome da obra', cfg.nome],['Data de criação', fmtDate(new Date(cfg.createdAt))],
    ['Cliente', cfg.cliente],['Telefone', cfg.telefone],['E-mail', cfg.email],
    ['Endereço', cfg.endereco],['Tipo', cfg.tipo],['Subtipo', cfg.subtipo],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cfgRows), 'Dados da obra');

  const name = (cfg.nome||'projeto').replace(/[^\w\- ]/g,'').trim() || 'projeto';
  XLSX.writeFile(wb, `Controle_${name}.xlsx`);
}

/* ============================================================
   16. PERSISTÊNCIA (Supabase)
   ============================================================ */
const SUPABASE_URL = 'https://kbuiljbrrvdabwtdwayp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_psFslciJm9QIZTBkCiF77Q_SxA0hTaA';
const SUPA_HEADERS = { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json' };
const LOCAL_PTR_KEY = 'controle_sinapi:current_project_id';
const LOCAL_CACHE_KEY = 'controle_sinapi:cache';
let currentProjectId = null;
let saveDebounce = null;

function setSyncStatus(text, isError){
  const el = document.getElementById('syncStatus');
  if(!el) return;
  el.textContent = text;
  el.style.color = isError ? 'var(--red)' : 'var(--text-faint)';
}
async function supaRequest(path, options){
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {headers: SUPA_HEADERS, ...options});
  if(!res.ok){ const body = await res.text().catch(()=> ''); throw new Error(`Supabase ${res.status}: ${body}`); }
  return res.status===204 ? null : res.json();
}
async function supaListProjects(){ return supaRequest('projetos?select=id,nome,atualizado_em&order=atualizado_em.desc', {method:'GET'}); }
async function supaLoadProject(id){ const rows = await supaRequest(`projetos?id=eq.${id}&select=*`, {method:'GET'}); return rows && rows[0] ? rows[0] : null; }
async function supaUpsertProject(row){
  return supaRequest('projetos', { method:'POST', headers:{...SUPA_HEADERS,'Prefer':'resolution=merge-duplicates,return=representation'}, body: JSON.stringify(row) });
}
async function supaDeleteProject(id){ return supaRequest(`projetos?id=eq.${id}`, {method:'DELETE'}); }

function collectProjectPayload(){
  return { config: collectConfig(), calendar, orcamento: orcamento.map(r=>({...r})), bdiPercent };
}
function saveProject(){ clearTimeout(saveDebounce); saveDebounce = setTimeout(doSaveProject, 500); }
async function doSaveProject(){
  const payload = collectProjectPayload();
  try{ localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify({id:currentProjectId, ...payload})); }catch(e){}
  if(!currentProjectId){
    currentProjectId = crypto.randomUUID();
    try{ localStorage.setItem(LOCAL_PTR_KEY, currentProjectId); }catch(e){}
  }
  setSyncStatus('salvando…');
  try{
    await supaUpsertProject({
      id: currentProjectId, nome: payload.config.nome,
      dados: {config: payload.config, calendar: payload.calendar, orcamento: payload.orcamento, bdiPercent: payload.bdiPercent},
      atualizado_em: new Date().toISOString()
    });
    setSyncStatus('salvo no banco ✓');
    refreshProjectSelect();
  }catch(e){ console.error(e); setSyncStatus('offline — salvo só neste navegador', true); }
}
function applyProjectPayload(payload){
  applyConfig(payload.config);
  if(payload.calendar) calendar = payload.calendar;
  orcamento = payload.orcamento || [];
  bdiPercent = payload.bdiPercent || 0;
  nextOrcId = orcamento.reduce((m,r)=>Math.max(m,r.id||0), 0) + 1;
}
async function refreshProjectSelect(){
  const sel = document.getElementById('projectSelect');
  try{
    const rows = await supaListProjects();
    sel.innerHTML = rows.map(r=>`<option value="${r.id}" ${r.id===currentProjectId?'selected':''}>${escapeXml(r.nome||'(sem nome)')}</option>`).join('');
  }catch(e){
    sel.innerHTML = currentProjectId ? `<option value="${currentProjectId}" selected>${escapeXml(document.getElementById('cfgNome').value)}</option>` : '';
  }
}
async function loadProject(){
  let ptr = null;
  try{ ptr = localStorage.getItem(LOCAL_PTR_KEY); }catch(e){}
  try{
    if(ptr){
      const row = await supaLoadProject(ptr);
      if(row){
        currentProjectId = row.id;
        applyProjectPayload({config: row.dados?.config || {nome: row.nome}, calendar: row.dados?.calendar, orcamento: row.dados?.orcamento, bdiPercent: row.dados?.bdiPercent});
        setSyncStatus('carregado do banco ✓');
        await refreshProjectSelect();
        return true;
      }
    }
    const rows = await supaListProjects();
    if(rows && rows.length){
      const row = await supaLoadProject(rows[0].id);
      currentProjectId = row.id;
      try{ localStorage.setItem(LOCAL_PTR_KEY, currentProjectId); }catch(e){}
      applyProjectPayload({config: row.dados?.config || {nome: row.nome}, calendar: row.dados?.calendar, orcamento: row.dados?.orcamento, bdiPercent: row.dados?.bdiPercent});
      setSyncStatus('carregado do banco ✓');
      await refreshProjectSelect();
      return true;
    }
  }catch(e){
    console.error(e);
    setSyncStatus('sem conexão com o banco — usando cópia local', true);
    try{
      const raw = localStorage.getItem(LOCAL_CACHE_KEY);
      if(raw){ const payload = JSON.parse(raw); currentProjectId = payload.id || null; applyProjectPayload(payload); return true; }
    }catch(e2){}
  }
  return false;
}
async function switchProject(id){
  const row = await supaLoadProject(id);
  if(!row) return;
  currentProjectId = row.id;
  try{ localStorage.setItem(LOCAL_PTR_KEY, currentProjectId); }catch(e){}
  applyProjectPayload({config: row.dados?.config || {nome: row.nome}, calendar: row.dados?.calendar, orcamento: row.dados?.orcamento, bdiPercent: row.dados?.bdiPercent});
  renderCalendarTab();
  document.getElementById('bdiPercent').value = bdiPercent;
  recalcAll();
}
async function createNewProject(){
  const nome = prompt('Nome da nova obra:', 'Nova obra');
  if(!nome) return;
  currentProjectId = crypto.randomUUID();
  try{ localStorage.setItem(LOCAL_PTR_KEY, currentProjectId); }catch(e){}
  orcamento = []; nextOrcId = 1; bdiPercent = 0; calendar = defaultCalendar();
  applyConfig({nome, createdAt: new Date().toISOString()});
  document.getElementById('bdiPercent').value = 0;

  const usarEap = await showModal(
    'EAP Padrão',
    'Quer começar este orçamento com a <b>EAP Padrão</b> (estrutura de itens e subitens já pronta, com alguns códigos SINAPI preenchidos)? Você pode editar tudo depois.',
    [ {label:'Começar em branco', value:'nao'}, {label:'Usar EAP Padrão', value:'sim', primary:true} ]
  );
  if(usarEap==='sim'){
    setOrcLoadStatus('carregando EAP Padrão…');
    try{ await loadEapPadraoIntoOrcamento(); setOrcLoadStatus(''); }
    catch(e){ console.error(e); setOrcLoadStatus('não consegui carregar a EAP Padrão (eap_padrao.json) — comece manualmente.', true); }
  }
  renderCalendarTab();
  recalcAll();
  await doSaveProject();
}
async function deleteCurrentProject(){
  const confirmed = await showDeleteConfirmModal();
  if(!confirmed) return;
  if(!currentProjectId){ showToast('Nenhum projeto para excluir.'); return; }
  try{
    await supaDeleteProject(currentProjectId);
    try{ localStorage.removeItem(LOCAL_PTR_KEY); }catch(e){}
    currentProjectId = null;
    showToast('Obra excluída.');
    const had = await loadProject();
    if(!had){
      orcamento = []; nextOrcId = 1; bdiPercent = 0; calendar = defaultCalendar();
      applyConfig({nome:'Nova obra', createdAt: new Date().toISOString()});
      await doSaveProject();
    }
    renderCalendarTab();
    document.getElementById('bdiPercent').value = bdiPercent;
    recalcAll();
    await refreshProjectSelect();
  }catch(e){ console.error(e); showToast('Não consegui excluir — confira a conexão com o banco.'); }
}
function setOrcLoadStatus(text, isError){
  const el = document.getElementById('orcLoadStatus');
  if(!el) return;
  el.textContent = text;
  el.style.color = isError ? 'var(--red)' : 'var(--text-faint)';
}

/* ============================================================
   17. NAVEGAÇÃO / TOPBAR / INIT
   ============================================================ */
function setupTabs(){
  document.querySelectorAll('.navbtn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('.navbtn').forEach(b=>b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('panel-'+btn.dataset.tab).classList.add('active');
      if(btn.dataset.tab==='cronograma') renderGantt();
      if(btn.dataset.tab==='dashboard') setTimeout(renderDashboardAll, 30);
      document.getElementById('sidebar').classList.remove('open');
    });
  });
  const ham = document.getElementById('btnHamburger');
  if(ham) ham.addEventListener('click', ()=> document.getElementById('sidebar').classList.toggle('open'));
}

function setupTopbar(){
  document.getElementById('btnExport').addEventListener('click', exportExcel);
  document.getElementById('btnNewProject').addEventListener('click', createNewProject);
  document.getElementById('projectSelect').addEventListener('change', (e)=> switchProject(e.target.value));
  document.getElementById('btnAddOrcItem').addEventListener('click', addOrcRowGlobal);

  document.getElementById('btnUpdateSinapi').addEventListener('click', ()=> document.getElementById('sinapiUpload').click());
  document.getElementById('sinapiUpload').addEventListener('change', async (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    document.getElementById('loadStatus').textContent = 'Lendo planilha…';
    try{
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, {type:'array', cellDates:false});
      const parsed = parseSinapiWorkbook(wb);
      DB = parsed;
      unitMemo = {};
      updateDataStamp(' — sem preços neste upload rápido, veja abaixo');
      document.getElementById('loadStatus').textContent = '';
      showToast(`Base atualizada: ${DB.tops.length} composições. Atenção: esse upload rápido não traz preços (R$) nem a referência do mês. Para atualizar por completo, rode convert_sinapi.py com a planilha SINAPI completa e republique o sinapi_data.json.`);
      recalcAll();
    }catch(err){
      console.error(err);
      showToast('Não foi possível ler essa planilha. Confira se é o formato "Analítico" do SINAPI.');
    }
  });
}

(async function init(){
  calendar = defaultCalendar();
  setupTabs();
  setupTopbar();
  setupCalendarTab();
  setupBdiTab();
  setupDashboardTab();
  setupGanttToggle();
  setupConfigTab();
  await loadSinapi();
  const had = await loadProject();
  renderCalendarTab();
  document.getElementById('bdiPercent').value = bdiPercent;
  if(!had) applyConfig({nome:'Jardins di Roma · Módulo 4', createdAt: new Date().toISOString()});
  recalcAll();
  if(!had) await doSaveProject();
})();

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
let fluxoView = 'chart';

/* ---- compras / fluxo de caixa ---- */
let compras = [];
let nextCompraId = 1;
let recebimentos = [];
let nextRecebId = 1;
let bancos = [];
let fcxPeriod = 'quinzena';
let recPeriod = {mdo:'quinzena', mat:'quinzena', equip:'quinzena'};
let recCharts = {mdo:null, mat:null, equip:null};
let prevRealChart = null;
let fluxoCaixaChart = null;
let saldoObraChart = null;

const TIPOS_COMPRA = ['Mão de obra','Material','Equipamento','Extra'];
const FORMAS_PAGTO = ['PIX','Cartão de crédito','Cartão de débito','Espécie'];

/* ---- quantitativos: alvenaria/muro ---- */
let revestimentos = [];
let nextRevestimentoId = 1;
let alvenariaRows = [];
let nextAlvenariaId = 1;
let muroRows = [];
let nextMuroId = 1;
const REVEST_TIPOS = ['Tinta','Textura','Papel de parede','Revestimento/Pedra','Outro'];
const SENTIDO_OPTIONS = ['Horizontal','Vertical'];
const FACE_OPTIONS = ['Interno','Externo','Externo (parte interna da platibanda)','Banheiro','Cozinha'];
const FACES_INTERNAS = ['Interno','Banheiro','Cozinha'];
const FACES_EXTERNAS = ['Externo','Externo (parte interna da platibanda)'];
const UNIDADES_COMPRA = ['ajuda de custo','balde','diária','g','kg','lata','litro','m','m2','m3','mensal','mil','produção','quinzenal','salário','semanal','ton','unid','vara','vb'];
let antecipacao = {};
let comprasPrevisaoPeriod = 'quinzena';

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
  try{ renderCompras(); }catch(e){ console.error('Compras:', e); }
  try{ renderEstoque(); }catch(e){ console.error('Estoque:', e); }
  try{ renderFluxoCaixaAll(); }catch(e){ console.error('Fluxo de caixa:', e); }
  try{ renderComposicoes(); }catch(e){ console.error('Composições:', e); }
  try{ renderAlvenariaAll(); }catch(e){ console.error('Quantitativos:', e); }
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
      const targetRow = orcamento.find(r=>r.id===targetId);
      const droppingOnlySubitens = block.every(r=>r.level==='subitem');
      orcamento = orcamento.filter(r=>!dragBlockIds.includes(r.id));
      let targetIdx = orcamento.findIndex(r=>r.id===targetId);
      dragBlockIds = null;
      if(targetIdx===-1) return;
      /* Soltar um subitem em cima do cabeçalho de um Subitem principal
         faz com que ele entre para dentro do grupo (vira o 1º filho). */
      if(targetRow && targetRow.level==='subitem_principal' && droppingOnlySubitens){
        targetIdx = targetIdx + 1;
      }
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
      const code = inp.dataset.roleCode;
      const oldVal = act.roleAssign[code] || 1;
      const val = Math.max(1, parseFloat(inp.value)||1);
      const factor = val / oldVal;
      if(factor>0 && factor!==1 && isFinite(factor)){
        Object.keys(act.roleAssign).forEach(c=>{
          if(c===code) return;
          act.roleAssign[c] = Math.max(1, Math.round((act.roleAssign[c]||1)*factor));
        });
      }
      act.roleAssign[code] = val;
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

  renderResourceChart('roles','mdo','chartRecMdo',recPeriod.mdo,'Homens-dia','#e8a33d',8);
  renderResourceChart('materials','mat','chartRecMat',recPeriod.mat,'Quantidade','#5b9dd9',1);
  renderResourceChart('equip','equip','chartRecEquip',recPeriod.equip,'Quantidade','#a58bd9',1);
}
function fillSimpleTable(sel, arr, rowFn){
  const tb = document.querySelector(sel);
  tb.innerHTML = arr.length ? arr.map(rowFn).join('') : `<tr><td colspan="4" style="color:var(--text-faint);text-align:center;padding:20px;">Sem dados ainda</td></tr>`;
}

function computeResourceSeries(kind, periodType){
  const subitens = orcamento.filter(r=>r.level==='subitem' && r.start && r.end && r.breakdown);
  if(subitens.length===0) return null;
  const projStart = new Date(Math.min(...subitens.map(a=>a.start)));
  const buckets = {};
  subitens.forEach(act=>{
    const bucketMap = act.breakdown[kind];
    if(!bucketMap) return;
    let total = 0;
    for(const c in bucketMap) total += bucketMap[c].qty || 0;
    if(total<=0) return;
    const workdays = [];
    let d = new Date(act.start);
    while(d<=act.end){ if(isWorkday(d)) workdays.push(new Date(d)); d = addDays(d,1); }
    if(workdays.length===0) workdays.push(new Date(act.start));
    const n = workdays.length;
    workdays.forEach(wd=>{
      const key = periodKeyFor(wd, periodType, projStart);
      if(!buckets[key]) buckets[key] = {qty:0, sortDate:wd};
      buckets[key].qty += total/n;
      if(wd<buckets[key].sortDate) buckets[key].sortDate = wd;
    });
  });
  const keys = Object.keys(buckets).sort((a,b)=> buckets[a].sortDate - buckets[b].sortDate);
  if(keys.length===0) return null;
  return {
    labels: keys.map(k=>periodLabelFor(k, periodType, projStart)),
    values: keys.map(k=>buckets[k].qty),
  };
}
function renderResourceChart(kind, chartKey, canvasId, periodType, label, color, divisor){
  const canvas = document.getElementById(canvasId);
  if(recCharts[chartKey]){ recCharts[chartKey].destroy(); recCharts[chartKey]=null; }
  if(!canvas || typeof Chart==='undefined') return;
  const data = computeResourceSeries(kind, periodType);
  if(!data) return;
  recCharts[chartKey] = new Chart(canvas.getContext('2d'), {
    type:'bar',
    data:{ labels:data.labels, datasets:[{label, data:data.values.map(v=>v/(divisor||1)), backgroundColor:color}] },
    options:{
      responsive:true, maintainAspectRatio:false,
      scales:{
        x:{ ticks:{color:'#b7c0cb', font:{size:10}, maxRotation:60, minRotation:30}, grid:{color:'#232a33'} },
        y:{ ticks:{color:'#b7c0cb'}, grid:{color:'#232a33'} },
      },
      plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:ctx=>label+': '+fmtNum(ctx.parsed.y,2) } } }
    }
  });
}
function setupRecursosTab(){
  document.querySelectorAll('[data-recgroup]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const group = btn.dataset.recgroup, period = btn.dataset.period;
      recPeriod[group] = period;
      document.querySelectorAll(`[data-recgroup="${group}"]`).forEach(b=>b.classList.toggle('active', b.dataset.period===period));
      renderRecursos();
    });
  });
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

  const chartsWrap = document.getElementById('fluxoChartsWrap');
  const tableWrap = document.getElementById('fluxoTableWrap');
  if(fluxoView==='table'){
    if(chartsWrap) chartsWrap.style.display='none';
    if(tableWrap) tableWrap.style.display='block';
    const tb = document.querySelector('#tblFluxo tbody');
    if(tb){
      if(!data){
        tb.innerHTML = `<tr><td colspan="5" style="color:var(--text-faint);text-align:center;padding:20px;">Sem dados ainda</td></tr>`;
      } else {
        tb.innerHTML = data.labels.map((lbl,i)=>{
          const mdo=data.mdo[i]||0, mat=data.mat[i]||0, outros=data.outros[i]||0;
          return `<tr><td>${lbl}</td><td class="num" style="font-family:var(--mono)">${fmtNum(mdo,2)}</td><td class="num" style="font-family:var(--mono)">${fmtNum(mat,2)}</td><td class="num" style="font-family:var(--mono)">${fmtNum(outros,2)}</td><td class="num" style="font-family:var(--mono);color:var(--accent)">${fmtNum(mdo+mat+outros,2)}</td></tr>`;
        }).join('');
      }
    }
    return;
  }
  if(chartsWrap) chartsWrap.style.display='block';
  if(tableWrap) tableWrap.style.display='none';
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
function setFluxoView(v){
  fluxoView = v;
  document.getElementById('btnFluxoViewChart').classList.toggle('active', v==='chart');
  document.getElementById('btnFluxoViewTable').classList.toggle('active', v==='table');
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
  document.getElementById('btnFluxoViewChart').addEventListener('click', ()=>setFluxoView('chart'));
  document.getElementById('btnFluxoViewTable').addEventListener('click', ()=>setFluxoView('table'));
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
   15b. COMPRAS
   ============================================================ */
function orcOptionsHtml(selectedId){
  return orcamento.map(r=>{
    const label = `${r.numero} ${truncate(r.nome||'',44)}`;
    return `<option value="${r.id}" ${String(r.id)===String(selectedId)?'selected':''}>${escapeXml(label)}</option>`;
  }).join('');
}
function compraRowHtml(c){
  const showParc = c.formaPagto==='Cartão de crédito';
  return `<tr data-compra="${c.id}">
    <td><select class="cell" data-cf="orcId" data-compra="${c.id}"><option value="">—</option>${orcOptionsHtml(c.orcId)}</select></td>
    <td><select class="cell" data-cf="tipo" data-compra="${c.id}">${TIPOS_COMPRA.map(t=>`<option ${t===c.tipo?'selected':''}>${t}</option>`).join('')}</select></td>
    <td><input type="date" class="cell" data-cf="data" data-compra="${c.id}" value="${c.data||''}"></td>
    <td><input type="text" class="cell" data-cf="loja" data-compra="${c.id}" value="${escapeAttr(c.loja)}"></td>
    <td><input type="text" class="cell" data-cf="notaNum" data-compra="${c.id}" value="${escapeAttr(c.notaNum)}"></td>
    <td><select class="cell" data-cf="formaPagto" data-compra="${c.id}">${FORMAS_PAGTO.map(f=>`<option ${f===c.formaPagto?'selected':''}>${f}</option>`).join('')}</select></td>
    <td>${showParc?`<input type="number" min="1" step="1" class="cell small nospin" style="width:44px;" data-cf="parcelas" data-compra="${c.id}" value="${c.parcelas||1}" title="Nº de parcelas (1 = à vista)">`:'<span class="hint">—</span>'}</td>
    <td><select class="cell" data-cf="banco" data-compra="${c.id}"><option value="">—</option>${bancos.map(b=>`<option ${b===c.banco?'selected':''}>${escapeXml(b)}</option>`).join('')}</select></td>
    <td><input type="text" class="cell" data-cf="descricao" data-compra="${c.id}" value="${escapeAttr(c.descricao)}"></td>
    <td class="num"><input type="number" step="0.01" class="cell small nospin" data-cf="quantidade" data-compra="${c.id}" value="${fmtInput(c.quantidade)}"></td>
    <td><select class="cell" style="width:78px;" data-cf="unidade" data-compra="${c.id}">
      <option value="">—</option>
      ${UNIDADES_COMPRA.map(u=>`<option ${u===c.unidade?'selected':''}>${u}</option>`).join('')}
    </select></td>
    <td class="num"><input type="number" step="0.01" class="cell small nospin" data-cf="valorUnid" data-compra="${c.id}" value="${fmtInput(c.valorUnid)}"></td>
    <td class="num" style="font-family:var(--mono);color:var(--accent)" data-comprtotal="${c.id}">R$ ${fmtNum(c.valorTotal,2)}</td>
    <td><button class="icon-btn" data-comprremove="${c.id}" title="Remover">✕</button></td>
  </tr>`;
}
function bindComprasEvents(){
  document.querySelectorAll('#tblCompras [data-cf]').forEach(el=>{
    if(el.dataset.cf==='quantidade' || el.dataset.cf==='valorUnid'){
      el.addEventListener('input', ()=>{
        const c = compras.find(x=>String(x.id)===el.dataset.compra);
        if(!c) return;
        const qtyEl = document.querySelector(`#tblCompras [data-cf="quantidade"][data-compra="${c.id}"]`);
        const priceEl = document.querySelector(`#tblCompras [data-cf="valorUnid"][data-compra="${c.id}"]`);
        const qty = parseFloat(qtyEl && qtyEl.value)||0;
        const price = parseFloat(priceEl && priceEl.value)||0;
        c.valorTotal = round2(qty*price);
        const totalCell = document.querySelector(`[data-comprtotal="${c.id}"]`);
        if(totalCell) totalCell.textContent = 'R$ ' + fmtNum(c.valorTotal, 2);
      });
    }
    el.addEventListener('change', ()=>{
      const c = compras.find(x=>String(x.id)===el.dataset.compra);
      if(!c) return;
      const f = el.dataset.cf;
      if(f==='quantidade' || f==='valorUnid'){
        c[f] = parseFloat(el.value)||0;
        c.valorTotal = round2((c.quantidade||0)*(c.valorUnid||0));
        const totalCell = document.querySelector(`[data-comprtotal="${c.id}"]`);
        if(totalCell) totalCell.textContent = 'R$ ' + fmtNum(c.valorTotal, 2);
      } else if(f==='parcelas'){
        c.parcelas = Math.max(1, parseInt(el.value,10)||1);
      } else {
        c[f] = el.value;
      }
      saveProject();
      if(f==='formaPagto'){ renderCompras(); return; }
      renderComprasStats();
      renderFluxoCaixaAll();
    });
  });
  document.querySelectorAll('#tblCompras [data-comprremove]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      compras = compras.filter(c=>String(c.id)!==btn.dataset.comprremove);
      renderCompras();
      renderFluxoCaixaAll();
      saveProject();
    });
  });
}
function renderComprasStats(){
  const total = compras.reduce((s,c)=>s+(c.valorTotal||0),0);
  const strip = document.getElementById('comprasStatsStrip');
  if(strip){
    strip.innerHTML = `
      <div class="stat accent"><div class="lbl">Total comprado</div><div class="val" style="font-size:17px;">R$ ${fmtNum(total,2)}</div></div>
      <div class="stat"><div class="lbl">Registros</div><div class="val">${compras.length}</div></div>
    `;
  }
}
function renderBancosChips(){
  const wrap = document.getElementById('bancosChips');
  if(!wrap) return;
  wrap.innerHTML = bancos.length ? bancos.map(b=>`<span class="badge ok" style="display:inline-flex;align-items:center;gap:6px;padding:4px 8px;">${escapeXml(b)}<button class="icon-btn" style="padding:0;" data-bancoremove="${escapeAttr(b)}" title="Remover conta">✕</button></span>`).join('') : '<span class="hint">Nenhuma conta cadastrada ainda.</span>';
  wrap.querySelectorAll('[data-bancoremove]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      bancos = bancos.filter(b=>b!==btn.dataset.bancoremove);
      renderBancosChips();
      renderCompras();
      saveProject();
    });
  });
}
function renderCompras(){
  renderBancosChips();
  const tbody = document.getElementById('tbodyCompras');
  if(!tbody) return;
  const emptyEl = document.getElementById('emptyCompras');
  if(emptyEl) emptyEl.style.display = compras.length ? 'none':'block';
  tbody.innerHTML = compras.map(compraRowHtml).join('');
  bindComprasEvents();
  renderComprasStats();
  renderPrevisaoCompras();
}
function addCompra(){
  compras.push({id:nextCompraId++, orcId:null, tipo:'Material', data:toISO(new Date()), loja:'', notaNum:'', formaPagto:'PIX', parcelas:1, banco:'', descricao:'', quantidade:1, unidade:'', valorUnid:0, valorTotal:0});
  renderCompras();
  renderFluxoCaixaAll();
  saveProject();
}
function addBanco(){
  const nome = (prompt('Nome da conta/banco:')||'').trim();
  if(!nome) return;
  if(!bancos.includes(nome)) bancos.push(nome);
  renderBancosChips();
  renderCompras();
  saveProject();
}
function computeComprasPrevisaoRows(){
  const subitens = orcamento.filter(r=>r.level==='subitem' && r.start && r.breakdown);
  const rows = [];
  subitens.forEach(act=>{
    ['materials','equip'].forEach(kind=>{
      const map = act.breakdown[kind];
      if(!map) return;
      for(const code in map){
        const info = map[code];
        if(!info.qty) continue;
        const dias = antecipacao[code] || 0;
        const dataUso = act.start;
        const dataPedido = dias>0 ? addWorkdaysSigned(dataUso, -dias) : dataUso;
        rows.push({
          subitemId: act.id, subitemNome: `${act.numero} ${act.nome}`,
          kind: kind==='materials'?'Material':'Equipamento', code,
          desc: info.desc || ('#'+code), unit: info.unit || '',
          qty: info.qty, dataUso, dataPedido, antecedencia: dias,
        });
      }
    });
  });
  rows.sort((a,b)=>a.dataUso-b.dataUso);
  return rows;
}
function renderPrevisaoCompras(){
  const rows = computeComprasPrevisaoRows();
  const tbody = document.getElementById('tbodyPrevisaoCompras');
  if(tbody){
    if(rows.length===0){
      tbody.innerHTML = `<tr><td colspan="7" style="color:var(--text-faint);text-align:center;padding:20px;">Sem cronograma calculado ainda — preencha o Orçamento e o Planejamento.</td></tr>`;
    } else {
      const projStart = new Date(Math.min(...rows.map(r=>r.dataUso)));
      tbody.innerHTML = rows.map(r=>{
        const periodo = periodLabelFor(periodKeyFor(r.dataUso, comprasPrevisaoPeriod, projStart), comprasPrevisaoPeriod, projStart);
        return `<tr>
          <td>${periodo}</td>
          <td>${escapeXml(r.subitemNome)}</td>
          <td>${r.kind}</td>
          <td>${escapeXml(r.desc)}</td>
          <td class="num" style="font-family:var(--mono)">${fmtNum(r.qty,2)} ${escapeXml(r.unit||'')}</td>
          <td>${fmtDate(r.dataUso)}</td>
          <td><input type="number" min="0" step="1" class="cell small nospin" style="width:56px;" data-antecip="${r.code}" value="${r.antecedencia||0}" title="Dias úteis de antecedência para pedir"> <span class="hint">→ pedir até ${fmtDate(r.dataPedido)}</span></td>
        </tr>`;
      }).join('');
      tbody.querySelectorAll('[data-antecip]').forEach(inp=>{
        inp.addEventListener('change', ()=>{
          antecipacao[inp.dataset.antecip] = Math.max(0, parseInt(inp.value,10)||0);
          saveProject();
          renderPrevisaoCompras();
        });
      });
    }
  }
  renderComprasDaSemana(rows);
}
function renderComprasDaSemana(rows){
  const wrap = document.getElementById('comprasDaSemanaList');
  if(!wrap) return;
  const today = new Date(); today.setHours(0,0,0,0);
  const weekEnd = addDays(today, 7);
  const overdue = rows.filter(r=> r.dataPedido<today && r.dataUso>=today).sort((a,b)=>a.dataUso-b.dataUso);
  const due = rows.filter(r=> r.dataPedido>=today && r.dataPedido<weekEnd).sort((a,b)=>a.dataPedido-b.dataPedido);
  if(overdue.length===0 && due.length===0){
    wrap.innerHTML = '<div class="hint">Nenhum pedido de compra precisa ser feito nos próximos 7 dias.</div>';
    return;
  }
  const item = (r, crit)=>`
    <div style="padding:8px 10px;border:1px solid var(--line);border-left:3px solid ${crit?'var(--red)':'var(--accent)'};border-radius:4px;margin-bottom:6px;">
      <b>${escapeXml(r.desc)}</b> · ${fmtNum(r.qty,2)} ${escapeXml(r.unit||'')}
      <span class="badge ${crit?'crit':'warn'}" style="margin-left:6px;">${crit?'pedido atrasado':'pedir até '+fmtDate(r.dataPedido)}</span>
      <div class="hint">uso em ${fmtDate(r.dataUso)} — ${escapeXml(r.subitemNome)}</div>
    </div>`;
  wrap.innerHTML = overdue.map(r=>item(r,true)).join('') + due.map(r=>item(r,false)).join('');
}
function setPrevCompPeriod(p){
  comprasPrevisaoPeriod = p;
  document.getElementById('btnPrevCompSemana').classList.toggle('active', p==='semana');
  document.getElementById('btnPrevCompQuinzena').classList.toggle('active', p==='quinzena');
  document.getElementById('btnPrevCompMes').classList.toggle('active', p==='mes');
  renderPrevisaoCompras();
}
function setupComprasTab(){
  document.getElementById('btnAddCompra').addEventListener('click', addCompra);
  document.getElementById('btnAddBanco').addEventListener('click', addBanco);
  document.getElementById('btnPrevCompSemana').addEventListener('click', ()=>setPrevCompPeriod('semana'));
  document.getElementById('btnPrevCompQuinzena').addEventListener('click', ()=>setPrevCompPeriod('quinzena'));
  document.getElementById('btnPrevCompMes').addEventListener('click', ()=>setPrevCompPeriod('mes'));
}

/* ============================================================
   15e. COMPOSIÇÕES PRÓPRIAS
   ============================================================ */
let composicoesProprias = [];
let nextComposicaoId = 1;
let compNovoItens = []; // {ref:'sinapi'|'propria', code, desc, unit, coef}

function computeCustomBreakdown(comp, computing){
  computing = computing || new Set();
  const key = 'own:'+comp.id;
  if(computing.has(key)) return emptyBreakdown();
  computing.add(key);
  const result = emptyBreakdown();
  (comp.itens||[]).forEach(it=>{
    const coef = parseFloat(it.coef)||0;
    if(coef===0) return;
    if(it.ref==='sinapi'){
      const code = parseInt(it.code,10);
      const item = DB.items[code];
      const desc = item ? item[0] : (it.desc||('#'+code));
      const unit = item ? item[1] : (it.unit||'');
      if(unit==='H'){ addTo(result.roles, code, desc, unit, coef); return; }
      if(unit==='CHP' || unit==='CHI'){ addTo(result.equip, code, desc, unit, coef); return; }
      const hasChildren = DB.children[code] && DB.children[code].length>0;
      if(hasChildren){ mergeScaled(result, computeUnitBreakdown(code), coef); }
      else { addTo(result.materials, code, desc, unit, coef); }
    } else if(it.ref==='propria'){
      const sub = composicoesProprias.find(c=>String(c.id)===String(it.code));
      if(!sub) return;
      mergeScaled(result, computeCustomBreakdown(sub, computing), coef);
    }
  });
  return result;
}
function priceCustomComposition(comp){
  const b = computeCustomBreakdown(comp);
  let mdo=0, mat=0, equip=0, semPreco=false;
  for(const c in b.roles){ const p=priceOf(c); if(p===null) semPreco=true; else mdo+=p*b.roles[c].qty; }
  for(const c in b.materials){ const p=priceOf(c); if(p===null) semPreco=true; else mat+=p*b.materials[c].qty; }
  for(const c in b.equip){ const p=priceOf(c); if(p===null) semPreco=true; else equip+=p*b.equip[c].qty; }
  return {mdo, mat, equip, total:mdo+mat+equip, semPreco};
}
function compNovoItemRowHtml(it, idx){
  return `<tr data-compidx="${idx}">
    <td><select class="cell" data-cnf="ref" data-compidx="${idx}">
      <option value="sinapi" ${it.ref==='sinapi'?'selected':''}>SINAPI</option>
      <option value="propria" ${it.ref==='propria'?'selected':''}>Própria</option>
    </select></td>
    <td>${it.ref==='propria'
        ? `<select class="cell" data-cnf="code" data-compidx="${idx}"><option value="">selecione…</option>${composicoesProprias.filter(c=>c.id!==compEditingId).map(c=>`<option value="${c.id}" ${String(c.id)===String(it.code)?'selected':''}>${escapeXml(c.codigo)} — ${escapeXml(truncate(c.descricao,40))}</option>`).join('')}</select>`
        : `<div class="code-search"><input type="text" class="cell mono" data-cnf="code" data-compidx="${idx}" value="${it.code||''}" placeholder="código ou descrição SINAPI…" autocomplete="off"></div>`}
      <span class="hint">${escapeXml(truncate(it.desc||'',50))}</span></td>
    <td class="num"><input type="number" step="0.0001" class="cell small" data-cnf="coef" data-compidx="${idx}" value="${it.coef??''}"></td>
    <td>${escapeXml(it.unit||'')}</td>
    <td><button class="icon-btn" data-compitemremove="${idx}" title="Remover">✕</button></td>
  </tr>`;
}
let compEditingId = null;
function renderCompNovoItens(){
  const tbody = document.getElementById('tbodyCompNovoItens');
  if(!tbody) return;
  tbody.innerHTML = compNovoItens.length ? compNovoItens.map(compNovoItemRowHtml).join('') : `<tr><td colspan="5" style="color:var(--text-faint);text-align:center;padding:14px;">Nenhum item adicionado ainda</td></tr>`;
  tbody.querySelectorAll('[data-cnf="ref"]').forEach(sel=>{
    sel.addEventListener('change', ()=>{
      const idx = +sel.dataset.compidx;
      compNovoItens[idx].ref = sel.value;
      compNovoItens[idx].code = ''; compNovoItens[idx].desc=''; compNovoItens[idx].unit='';
      renderCompNovoItens();
    });
  });
  tbody.querySelectorAll('select[data-cnf="code"]').forEach(sel=>{
    sel.addEventListener('change', ()=>{
      const idx = +sel.dataset.compidx;
      const comp = composicoesProprias.find(c=>String(c.id)===sel.value);
      compNovoItens[idx].code = sel.value;
      compNovoItens[idx].desc = comp ? comp.descricao : '';
      compNovoItens[idx].unit = comp ? comp.unidade : '';
      renderCompNovoPreview();
    });
  });
  tbody.querySelectorAll('input[data-cnf="code"]').forEach(inp=>{
    setupCodeSearch(inp, ()=>{
      const idx = +inp.dataset.compidx;
      const code = parseInt(inp.value,10);
      const item = DB.items[code];
      compNovoItens[idx].code = inp.value.trim();
      compNovoItens[idx].desc = item ? item[0] : '';
      compNovoItens[idx].unit = item ? item[1] : '';
      renderCompNovoItens();
      renderCompNovoPreview();
    });
  });
  tbody.querySelectorAll('[data-cnf="coef"]').forEach(inp=>{
    inp.addEventListener('change', ()=>{
      compNovoItens[+inp.dataset.compidx].coef = parseFloat(inp.value)||0;
      renderCompNovoPreview();
    });
  });
  tbody.querySelectorAll('[data-compitemremove]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      compNovoItens.splice(+btn.dataset.compitemremove, 1);
      renderCompNovoItens();
      renderCompNovoPreview();
    });
  });
  renderCompNovoPreview();
}
function renderCompNovoPreview(){
  const el = document.getElementById('compNovoPreview');
  if(!el) return;
  const draft = {id:compEditingId||-1, itens:compNovoItens};
  const p = priceCustomComposition(draft);
  el.textContent = compNovoItens.length ? `Prévia — MDO R$ ${fmtNum(p.mdo,2)} · MAT R$ ${fmtNum(p.mat,2)} · EQUIP R$ ${fmtNum(p.equip,2)} · Total unit. R$ ${fmtNum(p.total,2)}${p.semPreco?' (parcial — algum insumo sem preço)':''}` : '';
}
function addCompNovoItem(){
  compNovoItens.push({ref:'sinapi', code:'', desc:'', unit:'', coef:1});
  renderCompNovoItens();
}
function resetCompNovoForm(){
  document.getElementById('compNovoCodigo').value = '';
  document.getElementById('compNovoDescricao').value = '';
  document.getElementById('compNovoUnidade').value = '';
  compNovoItens = [];
  compEditingId = null;
  renderCompNovoItens();
}
function salvarComposicaoPropria(){
  const codigo = document.getElementById('compNovoCodigo').value.trim() || ('P-'+nextComposicaoId);
  const descricao = document.getElementById('compNovoDescricao').value.trim();
  const unidade = document.getElementById('compNovoUnidade').value.trim();
  if(!descricao){ alert('Informe uma descrição para a composição.'); return; }
  const itens = compNovoItens.filter(it=>it.code!=='' && it.code!==null && (parseFloat(it.coef)||0)!==0);
  if(itens.length===0){ alert('Adicione ao menos um insumo/composição com coeficiente maior que zero.'); return; }
  if(compEditingId){
    const comp = composicoesProprias.find(c=>c.id===compEditingId);
    Object.assign(comp, {codigo, descricao, unidade, itens});
  } else {
    composicoesProprias.push({id:nextComposicaoId++, codigo, descricao, unidade, itens, criadoEm:toISO(new Date())});
  }
  resetCompNovoForm();
  renderComposicoes();
  saveProject();
}
function editComposicaoPropria(id){
  const comp = composicoesProprias.find(c=>String(c.id)===String(id));
  if(!comp) return;
  compEditingId = comp.id;
  document.getElementById('compNovoCodigo').value = comp.codigo;
  document.getElementById('compNovoDescricao').value = comp.descricao;
  document.getElementById('compNovoUnidade').value = comp.unidade;
  compNovoItens = comp.itens.map(it=>({...it}));
  renderCompNovoItens();
  document.getElementById('compNovoCodigo').scrollIntoView({behavior:'smooth', block:'center'});
}
function removeComposicaoPropria(id){
  if(!confirm('Remover esta composição própria? Isso não afeta composições que já a usam como base.')) return;
  composicoesProprias = composicoesProprias.filter(c=>String(c.id)!==String(id));
  renderComposicoes();
  saveProject();
}
function renderComposicoesProprias(){
  const tbody = document.getElementById('tbodyComposicoesProprias');
  if(!tbody) return;
  const emptyEl = document.getElementById('emptyComposicoesProprias');
  if(emptyEl) emptyEl.style.display = composicoesProprias.length ? 'none':'block';
  tbody.innerHTML = composicoesProprias.map(c=>{
    const p = priceCustomComposition(c);
    return `<tr>
      <td class="mono">${escapeXml(c.codigo)}</td>
      <td>${escapeXml(c.descricao)}</td>
      <td>${escapeXml(c.unidade)}</td>
      <td class="num" style="font-family:var(--mono)">${fmtNum(p.mdo,2)}</td>
      <td class="num" style="font-family:var(--mono)">${fmtNum(p.mat,2)}</td>
      <td class="num" style="font-family:var(--mono)">${fmtNum(p.equip,2)}</td>
      <td class="num" style="font-family:var(--mono);color:var(--accent)">${fmtNum(p.total,2)}</td>
      <td class="orc-actions">
        <button class="icon-btn" data-compedit="${c.id}" title="Editar">✎</button>
        <button class="icon-btn" data-compremove="${c.id}" title="Remover">✕</button>
      </td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('[data-compedit]').forEach(btn=> btn.addEventListener('click', ()=>editComposicaoPropria(btn.dataset.compedit)));
  tbody.querySelectorAll('[data-compremove]').forEach(btn=> btn.addEventListener('click', ()=>removeComposicaoPropria(btn.dataset.compremove)));
}
function computeComposicoesUsadas(){
  const usoCount = {};
  orcamento.filter(r=>r.level==='subitem' && r.sinapiCode).forEach(r=>{
    const code = parseInt(r.sinapiCode,10);
    if(!code || !DB.items[code]) return;
    usoCount[code] = (usoCount[code]||0)+1;
  });
  return Object.keys(usoCount).map(code=>{
    const item = DB.items[code];
    const pb = priceBreakdownUnit(code);
    return { codigo: code, descricao: item[0], unidade: item[1], mdo: pb.mdo, mat: pb.mat, equip: pb.equip, total: pb.mdo+pb.mat+pb.equip, usos: usoCount[code] };
  }).sort((a,b)=>b.usos-a.usos);
}
function renderComposicoesUsadas(){
  const rows = computeComposicoesUsadas();
  const tbody = document.getElementById('tbodyComposicoesUsadas');
  if(!tbody) return;
  const emptyEl = document.getElementById('emptyComposicoesUsadas');
  if(emptyEl) emptyEl.style.display = rows.length ? 'none':'block';
  tbody.innerHTML = rows.map(r=>`<tr>
    <td class="mono">${r.codigo}</td><td>${escapeXml(r.descricao)}</td><td>${escapeXml(r.unidade)}</td>
    <td class="num" style="font-family:var(--mono)">${fmtNum(r.mdo,2)}</td>
    <td class="num" style="font-family:var(--mono)">${fmtNum(r.mat,2)}</td>
    <td class="num" style="font-family:var(--mono)">${fmtNum(r.equip,2)}</td>
    <td class="num" style="font-family:var(--mono);color:var(--accent)">${fmtNum(r.total,2)}</td>
    <td class="num">${r.usos}</td>
  </tr>`).join('');
}
function exportComposicoesXlsx(){
  if(typeof XLSX==='undefined'){ alert('Biblioteca de exportação não carregada.'); return; }
  const wb = XLSX.utils.book_new();
  const usadas = computeComposicoesUsadas();
  const rowsUsadas = [['Código','Descrição','Unidade','MDO (R$)','MAT (R$)','EQUIP (R$)','Total unit. (R$)','Nº usos no orçamento']];
  usadas.forEach(r=>rowsUsadas.push([r.codigo, r.descricao, r.unidade, round2(r.mdo), round2(r.mat), round2(r.equip), round2(r.total), r.usos]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rowsUsadas), 'Composições SINAPI usadas');
  const rowsProprias = [['Código','Descrição','Unidade','MDO (R$)','MAT (R$)','EQUIP (R$)','Total unit. (R$)']];
  composicoesProprias.forEach(c=>{
    const p = priceCustomComposition(c);
    rowsProprias.push([c.codigo, c.descricao, c.unidade, round2(p.mdo), round2(p.mat), round2(p.equip), round2(p.total)]);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rowsProprias), 'Composições próprias');
  XLSX.writeFile(wb, `Composicoes_${(collectConfig().nome||'Projeto').replace(/[^\w\- ]/g,'')}.xlsx`);
}
function renderComposicoes(){
  renderComposicoesProprias();
  renderComposicoesUsadas();
  if(!compEditingId) renderCompNovoItens();
}
function setupComposicoesTab(){
  document.getElementById('btnCompNovoAddItem').addEventListener('click', addCompNovoItem);
  document.getElementById('btnCompNovoSalvar').addEventListener('click', salvarComposicaoPropria);
  document.getElementById('btnExportComposicoes').addEventListener('click', exportComposicoesXlsx);
  renderCompNovoItens();
}

/* ============================================================
   15d. ESTOQUE
   ============================================================ */
let estoqueConsumos = [];
let nextEstoqueConsumoId = 1;

function estoqueKeyFor(desc, unidade){
  return (desc||'').trim().toLowerCase()+'|'+(unidade||'').trim().toLowerCase();
}
function computeEstoqueGroups(){
  const groups = {};
  compras.filter(c=>c.tipo==='Material' && (c.descricao||'').trim()).forEach(c=>{
    const key = estoqueKeyFor(c.descricao, c.unidade);
    if(!groups[key]) groups[key] = {key, nome:c.descricao.trim(), unidade:c.unidade||'', comprado:0, gasto:0};
    groups[key].comprado += (c.quantidade||0);
  });
  estoqueConsumos.forEach(u=>{
    if(!groups[u.materialKey]) return;
    groups[u.materialKey].gasto += (u.quantidade||0);
  });
  return Object.values(groups).map(g=>({...g, saldo: g.comprado-g.gasto})).sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));
}
function renderEstoque(){
  const groups = computeEstoqueGroups();
  const tbody = document.getElementById('tbodyEstoque');
  if(!tbody) return;
  const emptyEl = document.getElementById('emptyEstoque');
  if(emptyEl) emptyEl.style.display = groups.length ? 'none' : 'block';
  tbody.innerHTML = groups.map(g=>{
    const cls = g.saldo<=0.0001 ? 'crit' : (g.comprado>0 && g.saldo < g.comprado*0.15 ? 'warn' : 'ok');
    return `<tr>
      <td>${escapeXml(g.nome)}</td>
      <td>${escapeXml(g.unidade)}</td>
      <td class="num" style="font-family:var(--mono)">${fmtNum(g.comprado,2)}</td>
      <td class="num" style="font-family:var(--mono)">${fmtNum(g.gasto,2)}</td>
      <td class="num"><span class="badge ${cls}" style="font-family:var(--mono)">${fmtNum(g.saldo,2)}</span></td>
      <td><button class="btn small" data-estuse="${escapeAttr(g.key)}">Registrar uso</button></td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('[data-estuse]').forEach(btn=>{
    btn.addEventListener('click', ()=> registrarUsoEstoque(btn.dataset.estuse));
  });
  renderEstoqueConsumosList(groups);
}
function registrarUsoEstoque(key){
  const qtyStr = prompt('Quantidade usada:');
  if(qtyStr===null) return;
  const qty = parseFloat(qtyStr.replace(',','.'));
  if(!qty || qty<=0){ alert('Quantidade inválida.'); return; }
  const dataStr = prompt('Data de uso (AAAA-MM-DD):', toISO(new Date())) || toISO(new Date());
  estoqueConsumos.push({id:nextEstoqueConsumoId++, materialKey:key, quantidade:qty, data:dataStr});
  renderEstoque();
  saveProject();
}
function renderEstoqueConsumosList(groups){
  const wrap = document.getElementById('estoqueConsumosList');
  if(!wrap) return;
  if(estoqueConsumos.length===0){ wrap.innerHTML = '<div class="hint">Nenhum uso registrado ainda.</div>'; return; }
  const nameByKey = {};
  (groups||computeEstoqueGroups()).forEach(g=>{ nameByKey[g.key] = g.nome + (g.unidade?` (${g.unidade})`:''); });
  const sorted = [...estoqueConsumos].sort((a,b)=>(b.data||'').localeCompare(a.data||''));
  wrap.innerHTML = `<div class="tbl-wrap"><table><thead><tr><th style="width:110px;">Data</th><th>Material</th><th class="num" style="width:110px;">Quant. usada</th><th style="width:34px;"></th></tr></thead><tbody>
    ${sorted.map(u=>`<tr><td>${fmtDate(u.data)}</td><td>${escapeXml(nameByKey[u.materialKey]||u.materialKey)}</td><td class="num" style="font-family:var(--mono)">${fmtNum(u.quantidade,2)}</td><td><button class="icon-btn" data-estremove="${u.id}" title="Remover">✕</button></td></tr>`).join('')}
  </tbody></table></div>`;
  wrap.querySelectorAll('[data-estremove]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      estoqueConsumos = estoqueConsumos.filter(u=>String(u.id)!==btn.dataset.estremove);
      renderEstoque();
      saveProject();
    });
  });
}

/* ============================================================
   15c. FLUXO DE CAIXA
   ============================================================ */
function recebimentoRowHtml(r, acumulado){
  return `<tr data-receb="${r.id}">
    <td><input type="date" class="cell" data-rf="data" data-receb="${r.id}" value="${r.data||''}"></td>
    <td><select class="cell" data-rf="formaPagto" data-receb="${r.id}">${FORMAS_PAGTO.map(f=>`<option ${f===r.formaPagto?'selected':''}>${f}</option>`).join('')}</select></td>
    <td class="num"><input type="number" step="0.01" class="cell small" data-rf="valor" data-receb="${r.id}" value="${fmtInput(r.valor)}"></td>
    <td class="num" style="font-family:var(--mono);color:var(--accent)">R$ ${fmtNum(acumulado,2)}</td>
    <td><button class="icon-btn" data-rembrremove="${r.id}" title="Remover">✕</button></td>
  </tr>`;
}
function renderRecebimentos(){
  const tbody = document.getElementById('tbodyRecebimentos');
  if(!tbody) return;
  const emptyEl = document.getElementById('emptyRecebimentos');
  if(emptyEl) emptyEl.style.display = recebimentos.length ? 'none':'block';
  const sorted = [...recebimentos].sort((a,b)=>(a.data||'').localeCompare(b.data||''));
  let acc=0;
  tbody.innerHTML = sorted.map(r=>{ acc += (r.valor||0); return recebimentoRowHtml(r, acc); }).join('');
  document.querySelectorAll('#tblRecebimentos [data-rf]').forEach(el=>{
    el.addEventListener('change', ()=>{
      const r = recebimentos.find(x=>String(x.id)===el.dataset.receb);
      if(!r) return;
      const f = el.dataset.rf;
      r[f] = f==='valor' ? (parseFloat(el.value)||0) : el.value;
      renderRecebimentos();
      renderPrevRealizado();
      renderFluxoCaixaTempo();
      renderSaldoObra();
      saveProject();
    });
  });
  document.querySelectorAll('#tblRecebimentos [data-rembrremove]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      recebimentos = recebimentos.filter(r=>String(r.id)!==btn.dataset.rembrremove);
      renderFluxoCaixaAll();
      saveProject();
    });
  });
}
function addRecebimento(){
  recebimentos.push({id:nextRecebId++, data:toISO(new Date()), formaPagto:'PIX', valor:0});
  renderRecebimentos();
  saveProject();
}
function computePrevRealizado(){
  const bdiMul = 1+(bdiPercent||0)/100;
  const subitens = orcamento.filter(r=>r.level==='subitem');
  const realizadoByOrc = {};
  compras.forEach(c=>{
    if(!c.orcId) return;
    if(!realizadoByOrc[c.orcId]) realizadoByOrc[c.orcId] = {'Mão de obra':0,'Material':0,'Equipamento':0,'Extra':0};
    realizadoByOrc[c.orcId][c.tipo] = (realizadoByOrc[c.orcId][c.tipo]||0) + (c.valorTotal||0);
  });
  const rows = [];
  subitens.forEach(r=>{
    const prevMdo = (r.totalMdoSemBdi||0)*bdiMul;
    const prevMat = (r.totalMatSemBdi||0)*bdiMul;
    const prevEquip = (r.totalEquipSemBdi||0)*bdiMul;
    const real = realizadoByOrc[r.id] || {};
    const realMdo = real['Mão de obra']||0, realMat = real['Material']||0, realEquip = real['Equipamento']||0, realExtra = real['Extra']||0;
    const prevTotal = prevMdo+prevMat+prevEquip;
    const realTotal = realMdo+realMat+realEquip+realExtra;
    if(prevTotal<=0.0001 && realTotal<=0.0001) return;
    const pct = prevTotal>0 ? (realTotal/prevTotal*100) : (realTotal>0?999:0);
    rows.push({ nome:`${r.numero} ${r.nome}`, prevMdo, realMdo, prevMat, realMat, prevEquip, realEquip, realExtra, prevTotal, realTotal, pct });
  });
  return rows;
}
function renderPrevRealizado(){
  const rows = computePrevRealizado();
  const tbody = document.getElementById('tbodyPrevRealizado');
  if(tbody){
    tbody.innerHTML = rows.length ? rows.map(r=>{
      const cls = r.pct>110?'crit':(r.pct>=90?'ok':'warn');
      const cell = (v)=>`<td class="num" style="font-family:var(--mono)">${v>0.0001?fmtNum(v,2):'—'}</td>`;
      return `<tr><td>${escapeXml(r.nome)}</td>
        ${cell(r.prevMdo)}${cell(r.realMdo)}
        ${cell(r.prevMat)}${cell(r.realMat)}
        ${cell(r.prevEquip)}${cell(r.realEquip)}
        ${cell(r.realExtra)}
        <td class="num"><span class="badge ${cls}">${r.prevTotal>0?fmtNum(r.pct,0)+'%':'-'}</span></td></tr>`;
    }).join('') : `<tr><td colspan="9" style="color:var(--text-faint);text-align:center;padding:20px;">Sem dados ainda</td></tr>`;
  }
  const canvas = document.getElementById('chartPrevRealizado');
  if(prevRealChart){ prevRealChart.destroy(); prevRealChart=null; }
  if(!canvas || typeof Chart==='undefined' || rows.length===0) return;
  const top = rows.slice().sort((a,b)=>(b.prevTotal+b.realTotal)-(a.prevTotal+a.realTotal)).slice(0,15);
  prevRealChart = new Chart(canvas.getContext('2d'), {
    type:'bar',
    data:{
      labels: top.map(r=>truncate(r.nome,22)),
      datasets:[
        {label:'Previsto', data:top.map(r=>r.prevTotal), backgroundColor:'#5b9dd9'},
        {label:'Realizado', data:top.map(r=>r.realTotal), backgroundColor:'#e8a33d'},
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      scales:{
        x:{ ticks:{color:'#b7c0cb', font:{size:9}, maxRotation:70, minRotation:40}, grid:{color:'#232a33'} },
        y:{ ticks:{color:'#b7c0cb', callback:v=>'R$ '+fmtNum(v,0)}, grid:{color:'#232a33'} },
      },
      plugins:{ legend:{labels:{color:'#e7ebef'}}, tooltip:{ callbacks:{ label:ctx=>ctx.dataset.label+': R$ '+fmtNum(ctx.parsed.y,2) } } }
    }
  });
}
function computeFluxoCaixaSeries(periodType){
  const allDates = [];
  recebimentos.forEach(r=>{ if(r.data) allDates.push(parseISO(r.data)); });
  compras.forEach(c=>{ if(c.data) allDates.push(parseISO(c.data)); });
  if(allDates.length===0) return null;
  const projStart = new Date(Math.min(...allDates));
  const buckets = {};
  function addBucket(date, field, val){
    const key = periodKeyFor(date, periodType, projStart);
    if(!buckets[key]) buckets[key] = {entradas:0, saidas:0, sortDate:date};
    buckets[key][field] += val;
    if(date<buckets[key].sortDate) buckets[key].sortDate = date;
  }
  recebimentos.forEach(r=>{ if(r.data) addBucket(parseISO(r.data), 'entradas', r.valor||0); });
  compras.forEach(c=>{ if(c.data) addBucket(parseISO(c.data), 'saidas', c.valorTotal||0); });
  const keys = Object.keys(buckets).sort((a,b)=> buckets[a].sortDate - buckets[b].sortDate);
  return {
    labels: keys.map(k=>periodLabelFor(k, periodType, projStart)),
    entradas: keys.map(k=>buckets[k].entradas),
    saidas: keys.map(k=>buckets[k].saidas),
  };
}
function renderFluxoCaixaTempo(){
  const data = computeFluxoCaixaSeries(fcxPeriod);
  const tbody = document.getElementById('tbodyFluxoCaixa');
  if(tbody){
    tbody.innerHTML = data ? data.labels.map((lbl,i)=>{
      const ent=data.entradas[i]||0, sai=data.saidas[i]||0;
      return `<tr><td>${lbl}</td><td class="num" style="font-family:var(--mono);color:var(--green)">${fmtNum(ent,2)}</td><td class="num" style="font-family:var(--mono);color:var(--red)">${fmtNum(sai,2)}</td><td class="num" style="font-family:var(--mono)">${fmtNum(ent-sai,2)}</td></tr>`;
    }).join('') : `<tr><td colspan="4" style="color:var(--text-faint);text-align:center;padding:20px;">Sem dados ainda</td></tr>`;
  }
  const canvas = document.getElementById('chartFluxoCaixa');
  if(fluxoCaixaChart){ fluxoCaixaChart.destroy(); fluxoCaixaChart=null; }
  if(!canvas || typeof Chart==='undefined' || !data) return;
  fluxoCaixaChart = new Chart(canvas.getContext('2d'), {
    type:'bar',
    data:{ labels:data.labels, datasets:[
      {label:'Entradas', data:data.entradas, backgroundColor:'#6fbf8b'},
      {label:'Saídas', data:data.saidas, backgroundColor:'#d9695b'},
    ]},
    options:{
      responsive:true, maintainAspectRatio:false,
      scales:{
        x:{ ticks:{color:'#b7c0cb', font:{size:10}, maxRotation:60, minRotation:30}, grid:{color:'#232a33'} },
        y:{ ticks:{color:'#b7c0cb', callback:v=>'R$ '+fmtNum(v,0)}, grid:{color:'#232a33'} },
      },
      plugins:{ legend:{labels:{color:'#e7ebef'}}, tooltip:{ callbacks:{ label:ctx=>ctx.dataset.label+': R$ '+fmtNum(ctx.parsed.y,2) } } }
    }
  });
}
function setFcxPeriod(p){
  fcxPeriod = p;
  document.getElementById('btnFcxPerSemana').classList.toggle('active', p==='semana');
  document.getElementById('btnFcxPerQuinzena').classList.toggle('active', p==='quinzena');
  document.getElementById('btnFcxPerMes').classList.toggle('active', p==='mes');
  renderFluxoCaixaTempo();
}
function renderSaldoObra(){
  const canvas = document.getElementById('chartSaldoObra');
  if(saldoObraChart){ saldoObraChart.destroy(); saldoObraChart=null; }
  if(!canvas || typeof Chart==='undefined') return;
  const byDate = {};
  recebimentos.forEach(r=>{ if(r.data) byDate[r.data] = (byDate[r.data]||0) + (r.valor||0); });
  compras.forEach(c=>{ if(c.data) byDate[c.data] = (byDate[c.data]||0) - (c.valorTotal||0); });
  const dates = Object.keys(byDate).sort();
  if(dates.length===0) return;
  let acc=0;
  const labels=[], values=[];
  dates.forEach(d=>{ acc+=byDate[d]; labels.push(fmtDate(d)); values.push(acc); });
  saldoObraChart = new Chart(canvas.getContext('2d'), {
    type:'line',
    data:{ labels, datasets:[{label:'Saldo acumulado (R$)', data:values, borderColor:'#e8a33d', backgroundColor:'rgba(232,163,61,0.15)', fill:true, tension:0.2, pointRadius:2}] },
    options:{
      responsive:true, maintainAspectRatio:false,
      scales:{
        x:{ ticks:{color:'#b7c0cb', font:{size:10}, maxRotation:60, minRotation:30}, grid:{color:'#232a33'} },
        y:{ ticks:{color:'#b7c0cb', callback:v=>'R$ '+fmtNum(v,0)}, grid:{color:'#232a33'} },
      },
      plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:ctx=>'Saldo: R$ '+fmtNum(ctx.parsed.y,2) } } }
    }
  });
}
function renderFluxoCaixaAll(){
  renderRecebimentos();
  renderPrevRealizado();
  renderFluxoCaixaTempo();
  renderSaldoObra();
}
function setupFluxoCaixaTab(){
  document.getElementById('btnAddRecebimento').addEventListener('click', addRecebimento);
  document.getElementById('btnFcxPerSemana').addEventListener('click', ()=>setFcxPeriod('semana'));
  document.getElementById('btnFcxPerQuinzena').addEventListener('click', ()=>setFcxPeriod('quinzena'));
  document.getElementById('btnFcxPerMes').addEventListener('click', ()=>setFcxPeriod('mes'));
}

/* ============================================================
   15d. QUANTITATIVOS — ALVENARIA / MURO
   ============================================================ */
function alvArea(r){ return round2((parseFloat(r.linear)||0)*(parseFloat(r.peDireito)||0)*(parseFloat(r.repeticoes)||0)); }
function alvFundacaoVal(r){ return r.fundacao ? round2((parseFloat(r.linear)||0)*(parseFloat(r.repeticoes)||0)) : 0; }
function muroArea(r){ return round2((parseFloat(r.linear)||0)*(parseFloat(r.peDireito)||0)); }
function muroFundacaoVal(r){ return r.fundacao ? round2(parseFloat(r.linear)||0) : 0; }
function revestTipo(nome){ const rv = revestimentos.find(r=>r.nome===nome); return rv ? rv.tipo : null; }
function revestOptionsHtml(selected){
  return `<option value="">—</option>` + revestimentos.map(r=>`<option value="${escapeAttr(r.nome)}" ${r.nome===selected?'selected':''}>${escapeXml(r.nome)} (${r.tipo})</option>`).join('');
}
function faceOptionsHtml(selected){
  return FACE_OPTIONS.map(f=>`<option ${f===selected?'selected':''}>${f}</option>`).join('');
}

/* --- revestimentos --- */
function revestimentoRowHtml(r){
  return `<tr data-revest="${r.id}">
    <td><input type="text" class="cell" data-rvf="nome" data-revest="${r.id}" value="${escapeAttr(r.nome)}" placeholder="Ex: Tinta - Cor branco neve / Fosco / Suvinil"></td>
    <td><select class="cell" data-rvf="tipo" data-revest="${r.id}">${REVEST_TIPOS.map(t=>`<option ${t===r.tipo?'selected':''}>${t}</option>`).join('')}</select></td>
    <td><button class="icon-btn" data-revestremove="${r.id}" title="Remover">✕</button></td>
  </tr>`;
}
function renderRevestimentos(){
  const tbody = document.getElementById('tbodyRevestimentos');
  if(!tbody) return;
  const emptyEl = document.getElementById('emptyRevestimentos');
  if(emptyEl) emptyEl.style.display = revestimentos.length ? 'none':'block';
  tbody.innerHTML = revestimentos.map(revestimentoRowHtml).join('');
  tbody.querySelectorAll('[data-rvf]').forEach(el=>{
    el.addEventListener('change', ()=>{
      const r = revestimentos.find(x=>String(x.id)===el.dataset.revest);
      if(!r) return;
      r[el.dataset.rvf] = el.value;
      renderAlvenariaAll();
      saveProject();
    });
  });
  tbody.querySelectorAll('[data-revestremove]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const nome = revestimentos.find(r=>String(r.id)===btn.dataset.revestremove)?.nome;
      revestimentos = revestimentos.filter(r=>String(r.id)!==btn.dataset.revestremove);
      alvenariaRows.forEach(r=>{ if(r.acab1===nome) r.acab1=''; if(r.acab2===nome) r.acab2=''; });
      muroRows.forEach(r=>{ if(r.acabExt===nome) r.acabExt=''; if(r.acabInt===nome) r.acabInt=''; });
      renderAlvenariaAll();
      saveProject();
    });
  });
}
function addRevestimento(){
  revestimentos.push({id:nextRevestimentoId++, nome:'', tipo:'Tinta'});
  renderRevestimentos();
  saveProject();
}

/* --- alvenaria (paredes) --- */
function alvenariaRowHtml(r){
  const area = alvArea(r);
  const fv = alvFundacaoVal(r);
  return `<tr data-alv="${r.id}">
    <td><input type="text" class="cell" data-af="local1" data-alv="${r.id}" value="${escapeAttr(r.local1)}"></td>
    <td><input type="text" class="cell" data-af="local2" data-alv="${r.id}" value="${escapeAttr(r.local2)}"></td>
    <td><select class="cell" data-af="sentido" data-alv="${r.id}">${SENTIDO_OPTIONS.map(s=>`<option ${s===r.sentido?'selected':''}>${s}</option>`).join('')}</select></td>
    <td><input type="text" class="cell" data-af="pavimento" data-alv="${r.id}" value="${escapeAttr(r.pavimento)}"></td>
    <td class="num"><input type="number" step="0.01" class="cell small nospin" data-af="linear" data-alv="${r.id}" value="${fmtInput(r.linear)}"></td>
    <td class="num"><input type="number" step="0.01" class="cell small nospin" data-af="peDireito" data-alv="${r.id}" value="${fmtInput(r.peDireito)}"></td>
    <td class="num"><input type="number" step="1" class="cell small nospin" data-af="repeticoes" data-alv="${r.id}" value="${fmtInput(r.repeticoes)}"></td>
    <td><select class="cell" data-af="face1" data-alv="${r.id}">${faceOptionsHtml(r.face1)}</select></td>
    <td><select class="cell" data-af="acab1" data-alv="${r.id}">${revestOptionsHtml(r.acab1)}</select></td>
    <td><select class="cell" data-af="face2" data-alv="${r.id}">${faceOptionsHtml(r.face2)}</select></td>
    <td><select class="cell" data-af="acab2" data-alv="${r.id}">${revestOptionsHtml(r.acab2)}</select></td>
    <td class="num" style="font-family:var(--mono);color:var(--accent)">${fmtNum(area,2)}</td>
    <td style="text-align:center;"><input type="checkbox" data-af="fundacao" data-alv="${r.id}" ${r.fundacao?'checked':''}></td>
    <td><button class="icon-btn" data-alvremove="${r.id}" title="Remover">✕</button></td>
  </tr>`;
}
function bindAlvenariaEvents(){
  document.querySelectorAll('#tblAlvenaria [data-af]').forEach(el=>{
    const ev = (el.type==='checkbox' || el.tagName==='SELECT') ? 'change' : 'input';
    el.addEventListener(ev, ()=>{
      const r = alvenariaRows.find(x=>String(x.id)===el.dataset.alv);
      if(!r) return;
      const f = el.dataset.af;
      if(f==='fundacao') r[f] = el.checked;
      else if(['linear','peDireito','repeticoes'].includes(f)) r[f] = parseFloat(el.value)||0;
      else r[f] = el.value;
      if(['linear','peDireito','repeticoes','fundacao'].includes(f)){
        const tr = el.closest('tr');
        tr.children[11].textContent = fmtNum(alvArea(r),2);
      }
      renderAlvenariaTotals();
      renderResumoAlvenaria();
      saveProject();
    });
  });
  document.querySelectorAll('[data-alvremove]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      alvenariaRows = alvenariaRows.filter(r=>String(r.id)!==btn.dataset.alvremove);
      renderAlvenaria();
      saveProject();
    });
  });
}
function renderAlvenaria(){
  const tbody = document.getElementById('tbodyAlvenaria');
  if(!tbody) return;
  const emptyEl = document.getElementById('emptyAlvenaria');
  if(emptyEl) emptyEl.style.display = alvenariaRows.length ? 'none':'block';
  tbody.innerHTML = alvenariaRows.map(alvenariaRowHtml).join('');
  bindAlvenariaEvents();
  renderAlvenariaTotals();
  renderResumoAlvenaria();
}
function renderAlvenariaTotals(){
  const totalArea = alvenariaRows.reduce((s,r)=>s+alvArea(r),0);
  const totalFund = alvenariaRows.reduce((s,r)=>s+alvFundacaoVal(r),0);
  const elA = document.getElementById('alvenariaTotalArea');
  const elF = document.getElementById('alvenariaTotalFundacao');
  if(elA) elA.textContent = fmtNum(totalArea,2);
  if(elF) elF.textContent = fmtNum(totalFund,2);
  const meta = document.getElementById('qMetaAlvenaria');
  if(meta) meta.textContent = `${alvenariaRows.length} parede(s) · ${fmtNum(totalArea,2)} m²`;
}
function addAlvenariaRow(){
  alvenariaRows.push({id:nextAlvenariaId++, local1:'', local2:'', sentido:'Horizontal', pavimento:'Térreo', linear:0, peDireito:0, repeticoes:1, face1:'Externo', acab1:'', face2:'Interno', acab2:'', fundacao:false});
  renderAlvenaria();
  saveProject();
}
function computeResumoAlvenaria(){
  let fundoInt=0, emassInt=0, pintInt=0, fundoExt=0;
  alvenariaRows.forEach(r=>{
    const area = alvArea(r);
    if(area<=0) return;
    [[r.face1,r.acab1],[r.face2,r.acab2]].forEach(([face,acab])=>{
      if(!face || !acab) return;
      const tipo = revestTipo(acab);
      if(FACES_INTERNAS.includes(face)){
        if(tipo==='Tinta'||tipo==='Textura') fundoInt += area;
        if(tipo==='Tinta'){ emassInt += area; pintInt += area; }
      } else if(FACES_EXTERNAS.includes(face)){
        if(tipo==='Tinta'||tipo==='Textura') fundoExt += area;
      }
    });
  });
  return {fundoInt, emassInt, pintInt, fundoTeto:0, emassTeto:0, pintTeto:0, fundoExt};
}
function renderResumoAlvenaria(){
  const tbody = document.getElementById('tbodyResumoAlvenaria');
  if(!tbody) return;
  const s = computeResumoAlvenaria();
  const rows = [
    ['Fundo selador em área interna', s.fundoInt],
    ['Emassamento e lixamento de parede interna', s.emassInt],
    ['Pintura em parede interna', s.pintInt],
    ['Fundo selador em teto', s.fundoTeto, true],
    ['Emassamento e lixamento de teto', s.emassTeto, true],
    ['Pintura em teto', s.pintTeto, true],
    ['Fundo selador em área externa', s.fundoExt],
  ];
  tbody.innerHTML = rows.map(([lbl,val,pendente])=>`<tr><td>${lbl}${pendente?' <span class="badge warn">calc. no Forro</span>':''}</td><td class="num">${fmtNum(val,2)} m²</td></tr>`).join('');
}

/* --- muro --- */
function muroRowHtml(r){
  const area = muroArea(r);
  return `<tr data-muro="${r.id}">
    <td><input type="text" class="cell" data-mf="local" data-muro="${r.id}" value="${escapeAttr(r.local)}"></td>
    <td class="num"><input type="number" step="0.01" class="cell small nospin" data-mf="linear" data-muro="${r.id}" value="${fmtInput(r.linear)}"></td>
    <td class="num"><input type="number" step="0.01" class="cell small nospin" data-mf="peDireito" data-muro="${r.id}" value="${fmtInput(r.peDireito)}"></td>
    <td style="text-align:center;"><input type="checkbox" data-mf="chapiscoExt" data-muro="${r.id}" ${r.chapiscoExt?'checked':''}></td>
    <td style="text-align:center;"><input type="checkbox" data-mf="chapiscoInt" data-muro="${r.id}" ${r.chapiscoInt?'checked':''}></td>
    <td style="text-align:center;"><input type="checkbox" data-mf="rebocoExt" data-muro="${r.id}" ${r.rebocoExt?'checked':''}></td>
    <td style="text-align:center;"><input type="checkbox" data-mf="rebocoInt" data-muro="${r.id}" ${r.rebocoInt?'checked':''}></td>
    <td><select class="cell" data-mf="acabExt" data-muro="${r.id}">${revestOptionsHtml(r.acabExt)}</select></td>
    <td><select class="cell" data-mf="acabInt" data-muro="${r.id}">${revestOptionsHtml(r.acabInt)}</select></td>
    <td style="text-align:center;"><input type="checkbox" data-mf="fundacao" data-muro="${r.id}" ${r.fundacao?'checked':''}></td>
    <td class="num" style="font-family:var(--mono);color:var(--accent)">${fmtNum(area,2)}</td>
    <td><button class="icon-btn" data-muroremove="${r.id}" title="Remover">✕</button></td>
  </tr>`;
}
function bindMuroEvents(){
  document.querySelectorAll('#tblMuro [data-mf]').forEach(el=>{
    const ev = (el.type==='checkbox' || el.tagName==='SELECT') ? 'change' : 'input';
    el.addEventListener(ev, ()=>{
      const r = muroRows.find(x=>String(x.id)===el.dataset.muro);
      if(!r) return;
      const f = el.dataset.mf;
      if(f==='fundacao' || f==='chapiscoExt' || f==='chapiscoInt' || f==='rebocoExt' || f==='rebocoInt') r[f] = el.checked;
      else if(['linear','peDireito'].includes(f)) r[f] = parseFloat(el.value)||0;
      else r[f] = el.value;
      if(['linear','peDireito'].includes(f)){
        const tr = el.closest('tr');
        tr.children[10].textContent = fmtNum(muroArea(r),2);
      }
      renderMuroTotals();
      renderResumoMuro();
      saveProject();
    });
  });
  document.querySelectorAll('[data-muroremove]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      muroRows = muroRows.filter(r=>String(r.id)!==btn.dataset.muroremove);
      renderMuro();
      saveProject();
    });
  });
}
function renderMuro(){
  const tbody = document.getElementById('tbodyMuro');
  if(!tbody) return;
  const emptyEl = document.getElementById('emptyMuro');
  if(emptyEl) emptyEl.style.display = muroRows.length ? 'none':'block';
  tbody.innerHTML = muroRows.map(muroRowHtml).join('');
  bindMuroEvents();
  renderMuroTotals();
  renderResumoMuro();
}
function renderMuroTotals(){
  const totalArea = muroRows.reduce((s,r)=>s+muroArea(r),0);
  const totalFund = muroRows.reduce((s,r)=>s+muroFundacaoVal(r),0);
  const elA = document.getElementById('muroTotalArea');
  const elF = document.getElementById('muroTotalFundacao');
  if(elA) elA.textContent = fmtNum(totalArea,2);
  if(elF) elF.textContent = fmtNum(totalFund,2);
}
function addMuroRow(){
  muroRows.push({id:nextMuroId++, local:'', linear:0, peDireito:0, chapiscoExt:false, chapiscoInt:false, rebocoExt:false, rebocoInt:false, acabExt:'', acabInt:'', fundacao:false});
  renderMuro();
  saveProject();
}
function computeResumoMuro(){
  let fundacao=0, chapiscoExt=0, rebocoExt=0, fundoExt=0, chapiscoInt=0, rebocoInt=0, fundoInt=0;
  muroRows.forEach(r=>{
    const area = muroArea(r);
    fundacao += muroFundacaoVal(r);
    if(r.chapiscoExt) chapiscoExt += area;
    if(r.rebocoExt) rebocoExt += area;
    if(r.acabExt){ const t=revestTipo(r.acabExt); if(t==='Tinta'||t==='Textura') fundoExt += area; }
    if(r.chapiscoInt) chapiscoInt += area;
    if(r.rebocoInt) rebocoInt += area;
    if(r.acabInt){ const t=revestTipo(r.acabInt); if(t==='Tinta'||t==='Textura') fundoInt += area; }
  });
  return {fundacao, chapiscoExt, rebocoExt, fundoExt, chapiscoInt, rebocoInt, fundoInt};
}
function renderResumoMuro(){
  const tbody = document.getElementById('tbodyResumoMuro');
  if(!tbody) return;
  const s = computeResumoMuro();
  const rows = [
    ['Fundação', s.fundacao, 'm'],
    ['Chapisco externo', s.chapiscoExt, 'm²'],
    ['Reboco externo', s.rebocoExt, 'm²'],
    ['Fundo selador externo', s.fundoExt, 'm²'],
    ['Chapisco interno', s.chapiscoInt, 'm²'],
    ['Reboco interno', s.rebocoInt, 'm²'],
    ['Fundo selador interno', s.fundoInt, 'm²'],
  ];
  tbody.innerHTML = rows.map(([lbl,val,unit])=>`<tr><td>${lbl}</td><td class="num">${fmtNum(val,2)} ${unit}</td></tr>`).join('');
}

function renderAlvenariaAll(){
  renderRevestimentos();
  renderAlvenaria();
  renderMuro();
}
function setupQuantitativosTab(){
  document.getElementById('btnAddRevestimento').addEventListener('click', addRevestimento);
  document.getElementById('btnAddAlvenaria').addEventListener('click', addAlvenariaRow);
  document.getElementById('btnAddMuro').addEventListener('click', addMuroRow);
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
  return { config: collectConfig(), calendar, orcamento: orcamento.map(r=>({...r})), bdiPercent, compras: compras.map(c=>({...c})), bancos: [...bancos], recebimentos: recebimentos.map(r=>({...r})), antecipacao: {...antecipacao}, estoqueConsumos: estoqueConsumos.map(u=>({...u})), composicoesProprias: composicoesProprias.map(c=>({...c})), revestimentos: revestimentos.map(r=>({...r})), alvenariaRows: alvenariaRows.map(r=>({...r})), muroRows: muroRows.map(r=>({...r})) };
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
      dados: {config: payload.config, calendar: payload.calendar, orcamento: payload.orcamento, bdiPercent: payload.bdiPercent, compras: payload.compras, bancos: payload.bancos, recebimentos: payload.recebimentos, antecipacao: payload.antecipacao, estoqueConsumos: payload.estoqueConsumos, composicoesProprias: payload.composicoesProprias, revestimentos: payload.revestimentos, alvenariaRows: payload.alvenariaRows, muroRows: payload.muroRows},
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
  compras = payload.compras || [];
  nextCompraId = compras.reduce((m,c)=>Math.max(m,c.id||0), 0) + 1;
  bancos = payload.bancos || [];
  recebimentos = payload.recebimentos || [];
  nextRecebId = recebimentos.reduce((m,r)=>Math.max(m,r.id||0), 0) + 1;
  antecipacao = payload.antecipacao || {};
  estoqueConsumos = payload.estoqueConsumos || [];
  nextEstoqueConsumoId = estoqueConsumos.reduce((m,u)=>Math.max(m,u.id||0), 0) + 1;
  composicoesProprias = payload.composicoesProprias || [];
  nextComposicaoId = composicoesProprias.reduce((m,c)=>Math.max(m,c.id||0), 0) + 1;
  compEditingId = null;
  revestimentos = payload.revestimentos || [];
  nextRevestimentoId = revestimentos.reduce((m,r)=>Math.max(m,r.id||0), 0) + 1;
  alvenariaRows = payload.alvenariaRows || [];
  nextAlvenariaId = alvenariaRows.reduce((m,r)=>Math.max(m,r.id||0), 0) + 1;
  muroRows = payload.muroRows || [];
  nextMuroId = muroRows.reduce((m,r)=>Math.max(m,r.id||0), 0) + 1;
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
        applyProjectPayload({config: row.dados?.config || {nome: row.nome}, calendar: row.dados?.calendar, orcamento: row.dados?.orcamento, bdiPercent: row.dados?.bdiPercent, compras: row.dados?.compras, bancos: row.dados?.bancos, recebimentos: row.dados?.recebimentos, antecipacao: row.dados?.antecipacao, estoqueConsumos: row.dados?.estoqueConsumos, composicoesProprias: row.dados?.composicoesProprias, revestimentos: row.dados?.revestimentos, alvenariaRows: row.dados?.alvenariaRows, muroRows: row.dados?.muroRows});
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
      applyProjectPayload({config: row.dados?.config || {nome: row.nome}, calendar: row.dados?.calendar, orcamento: row.dados?.orcamento, bdiPercent: row.dados?.bdiPercent, compras: row.dados?.compras, bancos: row.dados?.bancos, recebimentos: row.dados?.recebimentos, antecipacao: row.dados?.antecipacao, estoqueConsumos: row.dados?.estoqueConsumos, composicoesProprias: row.dados?.composicoesProprias, revestimentos: row.dados?.revestimentos, alvenariaRows: row.dados?.alvenariaRows, muroRows: row.dados?.muroRows});
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
  applyProjectPayload({config: row.dados?.config || {nome: row.nome}, calendar: row.dados?.calendar, orcamento: row.dados?.orcamento, bdiPercent: row.dados?.bdiPercent, compras: row.dados?.compras, bancos: row.dados?.bancos, recebimentos: row.dados?.recebimentos, antecipacao: row.dados?.antecipacao, estoqueConsumos: row.dados?.estoqueConsumos, composicoesProprias: row.dados?.composicoesProprias, revestimentos: row.dados?.revestimentos, alvenariaRows: row.dados?.alvenariaRows, muroRows: row.dados?.muroRows});
  renderCalendarTab();
  document.getElementById('bdiPercent').value = bdiPercent;
  recalcAll();
}
async function createNewProject(){
  const nome = prompt('Nome da nova obra:', 'Nova obra');
  if(!nome) return;
  currentProjectId = crypto.randomUUID();
  try{ localStorage.setItem(LOCAL_PTR_KEY, currentProjectId); }catch(e){}
  orcamento = []; nextOrcId = 1; bdiPercent = 0; calendar = defaultCalendar(); compras = []; nextCompraId = 1; bancos = []; recebimentos = []; nextRecebId = 1; antecipacao = {}; estoqueConsumos = []; nextEstoqueConsumoId = 1; composicoesProprias = []; nextComposicaoId = 1; compEditingId = null; revestimentos = []; nextRevestimentoId = 1; alvenariaRows = []; nextAlvenariaId = 1; muroRows = []; nextMuroId = 1;
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
      orcamento = []; nextOrcId = 1; bdiPercent = 0; calendar = defaultCalendar(); compras = []; nextCompraId = 1; bancos = []; recebimentos = []; nextRecebId = 1; antecipacao = {}; estoqueConsumos = []; nextEstoqueConsumoId = 1; composicoesProprias = []; nextComposicaoId = 1; compEditingId = null; revestimentos = []; nextRevestimentoId = 1; alvenariaRows = []; nextAlvenariaId = 1; muroRows = []; nextMuroId = 1;
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
      if(btn.dataset.tab==='recursos') setTimeout(renderRecursos, 30);
      if(btn.dataset.tab==='fluxocaixa') setTimeout(renderFluxoCaixaAll, 30);
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
  setupRecursosTab();
  setupComprasTab();
  setupFluxoCaixaTab();
  setupComposicoesTab();
  setupQuantitativosTab();
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

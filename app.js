/* ============================================================
   PLANEJADOR DE OBRAS · Base SINAPI
   ============================================================ */

let DB = { items: {}, children: {}, tops: [] };
let unitMemo = {};           // codigo -> {roles,materials,equip} POR UNIDADE (qty=1)
let activities = [];         // lista de atividades do projeto
let nextActId = 1;
let calendar = null;
let toastTimer = null;

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
function showToast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>t.classList.remove('show'), 3200);
}

/* ============================================================
   1. CARGA DA BASE SINAPI
   ============================================================ */
async function loadSinapi(){
  try{
    const res = await fetch('sinapi_data.json');
    if(!res.ok) throw new Error('http '+res.status);
    DB = await res.json();
    unitMemo = {};
    document.getElementById('dataStamp').textContent = `${DB.tops.length.toLocaleString('pt-BR')} composições carregadas`;
    document.getElementById('loadStatus').textContent = '';
  }catch(e){
    document.getElementById('dataStamp').textContent = 'falha ao carregar base — use "Atualizar base SINAPI"';
    document.getElementById('loadStatus').textContent = 'Base SINAPI não encontrada. Envie a planilha analítica pelo botão "Atualizar base SINAPI" no topo.';
    console.error(e);
  }
}

/* Parser client-side de uma planilha SINAPI Analítico (mesmo layout oficial) */
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
  return {items, children, tops};
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
  if(computing.has(code)) return emptyBreakdown(); // guarda contra ciclo
  computing.add(code);

  const result = emptyBreakdown();
  const kids = DB.children[code] || [];
  for(const [tflag, childCode, coef] of kids){
    const item = DB.items[childCode];
    const desc = item ? item[0] : ('#'+childCode);
    const unit = item ? item[1] : '';

    // Mão de obra (H) e equipamento (CHP/CHI) são sempre terminais: mesmo que a
    // base SINAPI guarde por baixo o detalhamento de encargos sociais
    // (ferramentas, EPI, alimentação etc, também em "H"), isso não deve virar
    // "funções" extras. Só sub-composições de MATERIAL são decompostas.
    if(desc && normalize(desc).startsWith('curso de capacita')){
      continue; // treinamento/curso, não é hora produtiva de execução
    }
    if(unit==='H'){
      addTo(result.roles, childCode, desc, unit, coef);
      continue;
    }
    if(unit==='CHP' || unit==='CHI'){
      addTo(result.equip, childCode, desc, unit, coef);
      continue;
    }
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

/* ============================================================
   3. CALENDÁRIO — feriados e jornada
   ============================================================ */
function easterDate(year){
  // algoritmo de Meeus/Jones/Butcher
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
      {enabled:false, hours:0},  // domingo
      {enabled:true,  hours:8},  // segunda
      {enabled:true,  hours:8},  // terça
      {enabled:true,  hours:8},  // quarta
      {enabled:true,  hours:8},  // quinta
      {enabled:true,  hours:8},  // sexta
      {enabled:true,  hours:4},  // sábado
    ],
    holidays: generateHolidays(new Date().getFullYear()).concat(generateHolidays(new Date().getFullYear()+1))
  };
}

function isHoliday(dateISO){
  return calendar.holidays.some(h=>h.enabled && h.date===dateISO);
}
function isWorkday(date){
  const dow = date.getDay();
  const wd = calendar.weekdays[dow];
  if(!wd || !wd.enabled) return false;
  if(isHoliday(toISO(date))) return false;
  return true;
}
function hoursOnDate(date){
  if(!isWorkday(date)) return 0;
  return calendar.weekdays[date.getDay()].hours;
}
function nextWorkday(date){
  let d = new Date(date);
  while(!isWorkday(d)) d = addDays(d,1);
  return d;
}
function addWorkdaysSigned(date, n){
  // desloca 'date' por n dias úteis (n pode ser negativo = antecipação)
  let d = new Date(date);
  if(n===0) return d;
  const step = n>0?1:-1;
  let count = 0;
  while(count < Math.abs(n)){
    d = addDays(d, step);
    if(isWorkday(d)) count++;
  }
  return d;
}

/* Simula a execução de uma atividade a partir de earliestStart, respeitando
   o calendário, e retorna {start, end, days} */
function simulateActivity(earliestStart, roleHours){
  const remaining = {};
  let hasWork = false;
  for(const code in roleHours){
    remaining[code] = roleHours[code].hoursNeeded;
    if(remaining[code] > 0.0001) hasWork = true;
  }
  let cur = nextWorkday(earliestStart);
  const start = new Date(cur);
  if(!hasWork){
    return {start, end: start, days:1};
  }
  let lastWorked = new Date(cur);
  let guard = 0;
  while(true){
    guard++;
    if(guard>20000) break; // proteção contra loop infinito
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
   4. PREDECESSORAS — parsing
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
   5. RECÁLCULO GERAL
   ============================================================ */
function recalcAll(){
  // 1) expandir cada atividade (materiais/mão de obra/equip por unidade * qty)
  activities.forEach(act=>{
    if(!act.code || !DB.items[act.code]){
      act.breakdown = emptyBreakdown();
      act.valid = false;
      return;
    }
    act.valid = true;
    act.desc = DB.items[act.code][0];
    act.unit = DB.items[act.code][1];
    act.breakdown = expandActivity(act.code, act.qty || 0);
    // roleAssign: qtyWorkers por função (mantém valores já definidos pelo usuário)
    act.roleAssign = act.roleAssign || {};
    for(const code in act.breakdown.roles){
      if(!(code in act.roleAssign)) act.roleAssign[code] = 1;
    }
  });

  // 2) agendar respeitando predecessoras (resolução iterativa)
  const bySeq = {};
  activities.forEach((a,i)=>{ a.seq = i+1; bySeq[a.seq]=a; a.preds = parsePreds(a.predText); a.scheduled=false; });

  const projStart = parseISO(calendar.start);
  let progress = true, passes = 0;
  while(progress && passes < activities.length+2){
    progress = false; passes++;
    for(const act of activities){
      if(act.scheduled) continue;
      let earliest = projStart;
      let ready = true;
      for(const p of act.preds){
        const pred = bySeq[p.seq];
        if(!pred || pred===act){ continue; }
        if(!pred.scheduled){ ready=false; break; }
        const influence = addWorkdaysSigned(pred.end, p.lag);
        const candidate = p.lag>=0 ? addDays(influence,1) : influence;
        if(candidate > earliest) earliest = candidate;
      }
      if(!ready) continue;
      const roleHours = {};
      for(const code in act.breakdown.roles){
        roleHours[code] = { hoursNeeded: act.breakdown.roles[code].qty, qtyWorkers: act.roleAssign[code]||1 };
      }
      const sim = simulateActivity(earliest, roleHours);
      act.start = sim.start; act.end = sim.end; act.durationDays = sim.days;
      act.scheduled = true;
      progress = true;
    }
  }
  // atividades não resolvidas (ciclo de predecessoras) -> agenda a partir do início do projeto, isolada
  activities.forEach(act=>{
    if(!act.scheduled){
      const roleHours = {};
      for(const code in act.breakdown.roles){
        roleHours[code] = { hoursNeeded: act.breakdown.roles[code].qty, qtyWorkers: act.roleAssign[code]||1 };
      }
      const sim = simulateActivity(projStart, roleHours);
      act.start=sim.start; act.end=sim.end; act.durationDays=sim.days; act.cyclic=true;
    } else {
      act.cyclic=false;
    }
  });

  renderAll();
  saveProject();
}

/* ============================================================
   6. RENDER — ATIVIDADES
   ============================================================ */
function fnLabel(desc){
  // Encurta descrições longas de mão-de-obra tipo "SERVENTE COM ENCARGOS COMPLEMENTARES"
  return desc.replace(/ COM ENCARGOS COMPLEMENTARES.*$/i,'').replace(/\(HORISTA\)/i,'').trim();
}

function renderAtividades(){
  const tbody = document.getElementById('tbodyAtividades');
  tbody.innerHTML = '';
  document.getElementById('cAtiv').textContent = activities.length;
  document.getElementById('emptyAtividades').style.display = activities.length ? 'none':'block';

  activities.forEach((act, idx)=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><button class="icon-btn expand" data-act="${act.id}" title="Detalhar mão de obra">${act.expanded?'▾':'▸'}</button></td>
      <td class="num" style="font-family:var(--mono);color:var(--text-faint)">${idx+1}</td>
      <td></td>
      <td>${act.valid===false && act.code ? '<span style="color:var(--red)">código não encontrado na base</span>' : (act.desc||'')}</td>
      <td class="code">${act.unit||''}</td>
      <td class="num"><input type="number" min="0" step="0.01" class="cell small" data-field="qty" data-act="${act.id}" value="${act.qty ?? ''}"></td>
      <td><input type="text" class="cell mono" data-field="predText" data-act="${act.id}" placeholder="ex: 2+3" value="${act.predText||''}"></td>
      <td class="num" style="font-family:var(--mono)">${act.durationDays? act.durationDays+'d':'-'} ${act.cyclic?'<span class="badge crit" title="Predecessora circular/ inválida">ciclo</span>':''}</td>
      <td style="font-family:var(--mono);font-size:11.5px;">${fmtDate(act.start)}</td>
      <td style="font-family:var(--mono);font-size:11.5px;">${fmtDate(act.end)}</td>
      <td><button class="icon-btn" data-remove="${act.id}" title="Remover">✕</button></td>
    `;
    // code search cell
    const codeTd = tr.children[2];
    codeTd.innerHTML = `<div class="code-search"><input type="text" class="cell mono" data-field="code" data-act="${act.id}" placeholder="código ou descrição…" value="${act.code||''}" autocomplete="off"></div>`;
    tbody.appendChild(tr);

    if(act.expanded){
      const subTr = document.createElement('tr');
      subTr.className = 'row-sub';
      const td = document.createElement('td');
      td.colSpan = 11;
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
    wrap.innerHTML = `<span class="hint">Esta composição não possui mão de obra direta (H) identificada — verifique o código informado.</span>`;
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
      <div class="hint" style="margin-bottom:8px;">Ajuste a quantidade de trabalhadores por função — a duração da atividade recalcula automaticamente (usa a função que demorar mais como gargalo).</div>
      <table>
        <thead><tr><th>Função</th><th class="num">Horas necessárias</th><th class="num">Qtd. trabalhadores</th><th class="num">Dias (isolado)</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>`;
  return wrap;
}

function bindActivityEvents(){
  document.querySelectorAll('[data-act][data-field]').forEach(el=>{
    el.addEventListener(el.tagName==='INPUT'?'change':'click', ()=>{});
  });
  document.querySelectorAll('input[data-field]').forEach(inp=>{
    if(inp.dataset.field==='code'){ setupCodeSearch(inp); }
    inp.addEventListener('change', onFieldChange);
  });
  document.querySelectorAll('input[data-role-act]').forEach(inp=>{
    inp.addEventListener('change', ()=>{
      const act = activities.find(a=>a.id==inp.dataset.roleAct);
      const val = Math.max(1, parseFloat(inp.value)||1);
      act.roleAssign[inp.dataset.roleCode] = val;
      recalcAll();
    });
  });
  document.querySelectorAll('[data-remove]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      activities = activities.filter(a=>a.id!=btn.dataset.remove);
      recalcAll();
    });
  });
  document.querySelectorAll('.icon-btn.expand').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const act = activities.find(a=>a.id==btn.dataset.act);
      act.expanded = !act.expanded;
      renderAtividades();
    });
  });
}

function onFieldChange(e){
  const inp = e.target;
  const act = activities.find(a=>a.id==inp.dataset.act);
  if(!act) return;
  const field = inp.dataset.field;
  if(field==='qty') act.qty = parseFloat(inp.value)||0;
  else if(field==='predText') act.predText = inp.value.trim();
  else if(field==='code') act.code = inp.value.trim();
  recalcAll();
}

/* ---------------- busca / autocomplete de código ---------------- */
function setupCodeSearch(inp){
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
        onFieldChange({target:inp});
      });
    });
  });
  inp.addEventListener('blur', ()=> setTimeout(close, 150));
}

/* ============================================================
   7. RENDER — RECURSOS CONSOLIDADOS
   ============================================================ */
function renderRecursos(){
  const roleTotals = {}, matTotals = {}, equipTotals = {};
  activities.forEach(act=>{
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
   8. RENDER — CRONOGRAMA / STATS / GANTT
   ============================================================ */
function renderStats(){
  const strip = document.getElementById('statsStrip');
  if(activities.length===0){ strip.innerHTML=''; return; }
  const valid = activities.filter(a=>a.start && a.end);
  const minStart = valid.length? new Date(Math.min(...valid.map(a=>a.start))) : null;
  const maxEnd = valid.length? new Date(Math.max(...valid.map(a=>a.end))) : null;
  const totalDays = (minStart&&maxEnd) ? Math.round((maxEnd-minStart)/86400000)+1 : 0;
  let totalRoleHours=0; activities.forEach(a=>{ if(a.breakdown) for(const c in a.breakdown.roles) totalRoleHours+=a.breakdown.roles[c].qty; });

  strip.innerHTML = `
    <div class="stat accent"><div class="lbl">Duração total</div><div class="val">${totalDays}<span class="unit">dias corridos</span></div></div>
    <div class="stat"><div class="lbl">Início</div><div class="val" style="font-size:16px;">${fmtDate(minStart)}</div></div>
    <div class="stat"><div class="lbl">Término</div><div class="val" style="font-size:16px;">${fmtDate(maxEnd)}</div></div>
    <div class="stat"><div class="lbl">Atividades</div><div class="val">${activities.length}</div></div>
    <div class="stat"><div class="lbl">Horas de mão de obra</div><div class="val">${fmtNum(totalRoleHours,0)}<span class="unit">h</span></div></div>
  `;
}

function renderGantt(){
  const wrap = document.getElementById('ganttWrap');
  const valid = activities.filter(a=>a.start && a.end);
  if(valid.length===0){
    wrap.innerHTML = '<div class="empty-state">Adicione atividades para visualizar o cronograma.</div>';
    return;
  }
  const minStart = new Date(Math.min(...valid.map(a=>a.start)));
  const maxEnd = new Date(Math.max(...valid.map(a=>a.end)));
  const totalDays = Math.max(1, Math.round((maxEnd-minStart)/86400000)+1);
  const dayW = totalDays>90 ? 8 : totalDays>45 ? 14 : 24;
  const rowH = 26;
  const labelW = 260;
  const chartW = totalDays*dayW;
  const chartH = valid.length*rowH + 30;
  const today = new Date(); today.setHours(0,0,0,0);

  let svg = `<svg width="${labelW+chartW}" height="${chartH}" style="display:block;font-family:var(--mono);">`;

  // background stripes for non-workdays + month gridlines
  for(let i=0;i<totalDays;i++){
    const d = addDays(minStart,i);
    const x = labelW + i*dayW;
    if(!isWorkday(d)){
      svg += `<rect x="${x}" y="0" width="${dayW}" height="${chartH}" fill="url(#hatch)" opacity="0.5"/>`;
    }
    if(d.getDate()===1){
      svg += `<line x1="${x}" y1="0" x2="${x}" y2="${chartH}" stroke="#333c47" stroke-width="1"/>`;
      svg += `<text x="${x+3}" y="12" fill="#5b6673" font-size="9">${d.toLocaleDateString('pt-BR',{month:'short',year:'2-digit'})}</text>`;
    }
  }
  svg += `<defs><pattern id="hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="#1a1f26"/><line x1="0" y1="0" x2="0" y2="6" stroke="#2b333e" stroke-width="3"/></pattern></defs>`;

  // today line
  if(today>=minStart && today<=maxEnd){
    const x = labelW + Math.round((today-minStart)/86400000)*dayW;
    svg += `<line x1="${x}" y1="0" x2="${x}" y2="${chartH}" stroke="#d9695b" stroke-width="1.5" stroke-dasharray="3,2"/>`;
  }

  valid.forEach((act,i)=>{
    const y = 30 + i*rowH;
    const x = labelW + Math.round((act.start-minStart)/86400000)*dayW;
    const w = Math.max(dayW*0.6, Math.round((act.end-act.start)/86400000+1)*dayW - 2);
    const late = act.end < today ? 'var(--red)' : 'var(--accent)';
    svg += `<text x="8" y="${y+15}" fill="#c7cdd4" font-size="11" font-family="Inter, sans-serif">${escapeXml(act.seq+'. '+truncate(act.desc||act.code||'—',30))}</text>`;
    svg += `<rect x="${x}" y="${y+4}" width="${w}" height="14" rx="2" fill="${late}" opacity="0.9"><title>${escapeXml((act.desc||act.code)+' · '+fmtDate(act.start)+' a '+fmtDate(act.end))}</title></rect>`;
  });

  svg += `</svg>`;
  wrap.innerHTML = svg;
}
function truncate(s,n){ return s.length>n ? s.slice(0,n-1)+'…' : s; }
function escapeXml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/* ============================================================
   9. CALENDÁRIO — render/eventos
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
    btn.addEventListener('click', ()=>{
      calendar.holidays.splice(+btn.dataset.hremove,1);
      renderHolidaysTable();
      recalcAll();
    });
  });
}

/* ============================================================
   10. RENDER GERAL
   ============================================================ */
function renderAll(){
  renderAtividades();
  renderRecursos();
  renderStats();
  renderGantt();
}

/* ============================================================
   11. EXPORTAÇÃO EXCEL
   ============================================================ */
function exportExcel(){
  const wb = XLSX.utils.book_new();

  const cronoRows = [['#','Código','Descrição','Unidade','Quantidade','Predecessoras','Duração (dias)','Início','Fim']];
  activities.forEach(a=>cronoRows.push([a.seq, a.code, a.desc||'', a.unit||'', a.qty||0, a.predText||'', a.durationDays||'', a.start?fmtDate(a.start):'', a.end?fmtDate(a.end):'']));
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

  const name = (document.getElementById('projName').value||'projeto').replace(/[^\w\- ]/g,'').trim() || 'projeto';
  XLSX.writeFile(wb, `Planejamento_${name}.xlsx`);
}

/* ============================================================
   12. PERSISTÊNCIA (window.storage)
   ============================================================ */
const SUPABASE_URL = 'https://kbuiljbrrvdabwtdwayp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_psFslciJm9QIZTBkCiF77Q_SxA0hTaA';
const SUPA_HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': 'Bearer ' + SUPABASE_KEY,
  'Content-Type': 'application/json'
};
const LOCAL_PTR_KEY = 'planejador_obras_sinapi:current_project_id';
const LOCAL_CACHE_KEY = 'planejador_obras_sinapi:cache'; // salva-vaidas offline

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
  if(!res.ok){
    const body = await res.text().catch(()=> '');
    throw new Error(`Supabase ${res.status}: ${body}`);
  }
  return res.status===204 ? null : res.json();
}

async function supaListProjects(){
  return supaRequest('projetos?select=id,nome,atualizado_em&order=atualizado_em.desc', {method:'GET'});
}
async function supaLoadProject(id){
  const rows = await supaRequest(`projetos?id=eq.${id}&select=*`, {method:'GET'});
  return rows && rows[0] ? rows[0] : null;
}
async function supaUpsertProject(row){
  return supaRequest('projetos', {
    method:'POST',
    headers: {...SUPA_HEADERS, 'Prefer':'resolution=merge-duplicates,return=representation'},
    body: JSON.stringify(row)
  });
}
async function supaDeleteProject(id){
  return supaRequest(`projetos?id=eq.${id}`, {method:'DELETE'});
}

function collectProjectPayload(){
  return {
    name: document.getElementById('projName').value,
    calendar,
    activities: activities.map(a=>({id:a.id, code:a.code, qty:a.qty, predText:a.predText, roleAssign:a.roleAssign, expanded:a.expanded}))
  };
}

function saveProject(){
  clearTimeout(saveDebounce);
  saveDebounce = setTimeout(doSaveProject, 500);
}

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
      id: currentProjectId,
      nome: payload.name,
      dados: {calendar: payload.calendar, activities: payload.activities},
      atualizado_em: new Date().toISOString()
    });
    setSyncStatus('salvo no banco ✓');
    refreshProjectSelect();
  }catch(e){
    console.error(e);
    setSyncStatus('offline — salvo só neste navegador', true);
  }
}

function applyProjectPayload(payload){
  if(payload.name) document.getElementById('projName').value = payload.name;
  if(payload.calendar) calendar = payload.calendar;
  if(payload.activities) activities = payload.activities;
}

async function refreshProjectSelect(){
  const sel = document.getElementById('projectSelect');
  try{
    const rows = await supaListProjects();
    sel.innerHTML = rows.map(r=>`<option value="${r.id}" ${r.id===currentProjectId?'selected':''}>${escapeXml(r.nome||'(sem nome)')}</option>`).join('');
  }catch(e){
    sel.innerHTML = currentProjectId ? `<option value="${currentProjectId}" selected>${escapeXml(document.getElementById('projName').value)}</option>` : '';
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
        applyProjectPayload({name: row.nome, calendar: row.dados?.calendar, activities: row.dados?.activities});
        setSyncStatus('carregado do banco ✓');
        await refreshProjectSelect();
        return true;
      }
    }
    // sem ponteiro local (ex: computador novo) — pega o projeto mais recente do banco
    const rows = await supaListProjects();
    if(rows && rows.length){
      const row = await supaLoadProject(rows[0].id);
      currentProjectId = row.id;
      try{ localStorage.setItem(LOCAL_PTR_KEY, currentProjectId); }catch(e){}
      applyProjectPayload({name: row.nome, calendar: row.dados?.calendar, activities: row.dados?.activities});
      setSyncStatus('carregado do banco ✓');
      await refreshProjectSelect();
      return true;
    }
  }catch(e){
    console.error(e);
    setSyncStatus('sem conexão com o banco — usando cópia local', true);
    try{
      const raw = localStorage.getItem(LOCAL_CACHE_KEY);
      if(raw){
        const payload = JSON.parse(raw);
        currentProjectId = payload.id || null;
        applyProjectPayload(payload);
        return true;
      }
    }catch(e2){}
  }
  return false;
}

async function switchProject(id){
  const row = await supaLoadProject(id);
  if(!row) return;
  currentProjectId = row.id;
  try{ localStorage.setItem(LOCAL_PTR_KEY, currentProjectId); }catch(e){}
  applyProjectPayload({name: row.nome, calendar: row.dados?.calendar, activities: row.dados?.activities});
  renderCalendarTab();
  recalcAll();
}

async function createNewProject(){
  const nome = prompt('Nome do novo projeto:', 'Nova obra');
  if(!nome) return;
  currentProjectId = crypto.randomUUID();
  try{ localStorage.setItem(LOCAL_PTR_KEY, currentProjectId); }catch(e){}
  document.getElementById('projName').value = nome;
  activities = []; nextActId = 1; calendar = defaultCalendar();
  renderCalendarTab();
  recalcAll();
  await doSaveProject();
}

/* ============================================================
   13. INICIALIZAÇÃO / EVENTOS GLOBAIS
   ============================================================ */
function addActivity(){
  activities.push({id: nextActId++, code:'', qty:1, predText:'', roleAssign:{}, expanded:true});
  recalcAll();
}

function setupTabs(){
  document.querySelectorAll('.tab').forEach(tab=>{
    tab.addEventListener('click', ()=>{
      document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('panel-'+tab.dataset.tab).classList.add('active');
      if(tab.dataset.tab==='cronograma') renderGantt();
    });
  });
}

function setupTopbar(){
  document.getElementById('btnAddRow').addEventListener('click', addActivity);
  document.getElementById('btnExport').addEventListener('click', exportExcel);
  document.getElementById('projName').addEventListener('change', saveProject);
  document.getElementById('btnReset').addEventListener('click', ()=>{
    if(!confirm('Isso vai limpar todas as atividades deste projeto (o cadastro continua salvo no banco, só as atividades somem). Continuar?')) return;
    activities = []; nextActId = 1;
    recalcAll();
  });
  document.getElementById('btnNewProject').addEventListener('click', createNewProject);
  document.getElementById('projectSelect').addEventListener('change', (e)=> switchProject(e.target.value));
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
      document.getElementById('dataStamp').textContent = `${DB.tops.length.toLocaleString('pt-BR')} composições carregadas (base atualizada nesta sessão)`;
      document.getElementById('loadStatus').textContent = '';
      showToast(`Base SINAPI atualizada: ${DB.tops.length} composições. Para tornar permanente, rode convert_sinapi.py e republique o sinapi_data.json.`);
      recalcAll();
    }catch(err){
      console.error(err);
      showToast('Não foi possível ler essa planilha. Confira se é o formato "Analítico" do SINAPI.');
    }
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
    renderHolidaysTable();
    recalcAll();
  });
}

(async function init(){
  calendar = defaultCalendar();
  setupTabs();
  setupTopbar();
  setupCalendarTab();
  await loadSinapi();
  const had = await loadProject();
  renderCalendarTab();
  recalcAll();
  if(!had) await doSaveProject(); // primeiro uso: cria o projeto padrão no banco
})();

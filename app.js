// ── SUPABASE CONFIG ─────────────────────────────────────────
// Replace with your Supabase project URL and anon key
const SUPABASE_URL = "https://https://kciyeboeuiplkqrowbef.supabase.co.supabase.co";
const SUPABASE_KEY = "sb_publishable_Pprou7FHi71ziiSU5zAcwQ_TNgjG8vV";
const REDIRECT_URL = "https://siraxelloid1460.github.io/fincontrol/";

// Legacy Google Apps Script URL (kept for migration, can be removed after)
const GAS_URL = "https://script.google.com/macros/s/AKfycbx1RZEZN3aI5YWrSeoh9Jt9vFcT1DN772pC_IJDUHqFwO5wgVrPQpXoMamqqzw5PWv_/exec";

let _supabase = null;
let _user = null;

function getSupabase(){
  if(!_supabase && window.supabase){
    _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return _supabase;
}
const FREQ={
  daily:    {label:'Diario',      factor:30.44},
  weekly:   {label:'Semanal',     factor:4.33},
  biweekly: {label:'Quincenal',   factor:2},
  monthly:  {label:'Mensual',     factor:1},
  quarterly:{label:'Trimestral',  factor:1/3},
  biannual: {label:'Semestral',   factor:1/6},
  annual:   {label:'Anual',       factor:1/12},
  variable: {label:'Variable',    factor:1},
};

// Convert any entry amount to monthly equivalent
function toMonthly(e){
  const f=(FREQ[e.frequency||'monthly']||FREQ.monthly).factor;
  return e.amount*f;
}

// Next occurrence date of a recurring entry from a reference date
function nextOccurrence(e, refDate){
  const d=new Date(refDate);
  const freq=e.frequency||'monthly';
  const startD=e.startDate?new Date(e.startDate):new Date(d.getFullYear(),d.getMonth(),1);
  if(freq==='daily') return new Date(d.getTime()+86400000);
  if(freq==='weekly'){d.setDate(d.getDate()+7);return d;}
  if(freq==='biweekly'){d.setDate(d.getDate()+14);return d;}
  if(freq==='monthly'){d.setMonth(d.getMonth()+1);return d;}
  if(freq==='quarterly'){d.setMonth(d.getMonth()+3);return d;}
  if(freq==='biannual'){d.setMonth(d.getMonth()+6);return d;}
  if(freq==='annual'){d.setFullYear(d.getFullYear()+1);return d;}
  return null; // variable — no projection
}

// Does this entry occur within [start, end] period?
function occursInPeriod(e, periodStart, periodEnd){
  const freq=e.frequency||'monthly';
  if(freq==='variable') return true; // always shown
  if(freq==='daily') return true;
  if(freq==='weekly'||freq==='biweekly') return true;
  if(freq==='monthly') return true;
  if(freq==='quarterly'){
    // Occurs if periodStart month is divisible by 3 from startDate
    const start=e.startDate?new Date(e.startDate):new Date(periodStart.getFullYear(),0,1);
    const monthsDiff=(periodStart.getFullYear()-start.getFullYear())*12+(periodStart.getMonth()-start.getMonth());
    return monthsDiff%3===0;
  }
  if(freq==='biannual'){
    const start=e.startDate?new Date(e.startDate):new Date(periodStart.getFullYear(),0,1);
    const monthsDiff=(periodStart.getFullYear()-start.getFullYear())*12+(periodStart.getMonth()-start.getMonth());
    return monthsDiff%6===0;
  }
  if(freq==='annual'){
    const start=e.startDate?new Date(e.startDate):new Date(periodStart.getFullYear(),0,1);
    return periodStart.getMonth()===start.getMonth();
  }
  return true;
}

const CATS={
  income:{label:"Ingreso fijo",color:"#2EE8A5",bg:"#2EE8A51A",icon:"⬆"},
  variable:{label:"Sueldo / Variable",color:"#00C9A7",bg:"#00C9A71A",icon:"💰"},
  expense:{label:"Gasto",color:"#FF6B6B",bg:"#FF6B6B1A",icon:"⬇"},
  monthly:{label:"Mensualidad",color:"#FFD166",bg:"#FFD1661A",icon:"↺"},
  annual:{label:"Anualidad",color:"#A78BFA",bg:"#A78BFA1A",icon:"📅"},
  debt:{label:"Deuda",color:"#F97316",bg:"#F973161A",icon:"⚡"},
  savings:{label:"Ahorro",color:"#38BDF8",bg:"#38BDF81A",icon:"🏦"},
};
const MO=["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const isDesktop=()=>window.innerWidth>=768;
const MF=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const $=id=>document.getElementById(id);
const fmt=n=>new Intl.NumberFormat("de-AT",{style:"currency",currency:"EUR",maximumFractionDigits:2}).format(n);
const fmtK=n=>{const a=Math.abs(n);return(n<0?"-":"")+( a>=1000000?`€${(a/1000000).toFixed(1)}M`:a>=1000?`€${(a/1000).toFixed(0)}k`:fmt(n));};
// calcM: months to pay off a debt
// Supports trimestral interest model: every 3 months bank charges quartlyCharge to balance
// netPerQuarter = monthly*3 - quarterlyCharge  =>  months = ceil(remaining / (netPerQuarter/3))
// Calculate months remaining from current remaining balance and monthly payment
// Uses quarterly charge if set, else simple division
function calcM(rem, mo, rate, quarterlyCharge){
  if(!mo||mo<=0||!rem||rem<=0) return null;
  if(quarterlyCharge>0){
    const netPerMonth=(mo*3-quarterlyCharge)/3;
    if(netPerMonth<=0) return null;
    return Math.ceil(rem/netPerMonth);
  }
  if(rate>0){
    const r=rate/100/12;
    if(mo<=rem*r) return null;
    return Math.ceil(Math.log(mo/(mo-rem*r))/Math.log(1+r));
  }
  return Math.ceil(rem/mo);
}

// Compute debt details from user inputs
// origAmount: original loan, totalAmount: total to repay, monthlyPayment: fixed monthly
// remaining: current outstanding balance, startDate: "YYYY-MM-DD"
// ── DEBT CALCULATION ─────────────────────────────────────────
// BAWAG quarterly interest formula (Kontoführungsentgelt):
//   cargoTrimestral = saldoPendiente × tasaEfectiva / 4
//
// The 'tasaEfectiva' is NOT the nominal rate on the contract (11.18%)
// but the actual rate the bank applies — typically higher (~12.45% for BAWAG).
// You can back it out from any known quarterly charge:
//   tasaEfectiva = cargoConocido / (saldoEnEseMomento / 4)
//
// This charge DECREASES each quarter as the outstanding balance drops.
// Net monthly capital progress = (cuota×3 − cargoTrimestral) / 3

// ── BAWAG QUARTERLY CHARGE FORMULA ──────────────────────────
// cargo = (saldo_pendiente × tasa_nominal × (365.25/4)) / total_contrato + cargo_fijo
// Donde tasa_nominal es el número tal cual (ej. 11.18, NO 0.1118)
// Documentado por BAWAG PSK en conversación directa con cliente (mar 2026)
function bawagQuarterlyCharge(remaining, interestRateNominal, totalContract, fixedCharge){
  if(!remaining||!interestRateNominal||!totalContract) return fixedCharge||0;
  const interestPart=(remaining * interestRateNominal * (365.25/4)) / totalContract;
  const total=interestPart+(fixedCharge||0);
  return Math.round(total*100)/100;
}

// Back-calculate: what nominal rate produces a known charge given known balance?
function inferNominalRate(knownCharge, knownBalance, totalContract, fixedCharge){
  if(!knownBalance||!totalContract) return 0;
  const interestPart=(knownCharge||0)-(fixedCharge||0);
  if(interestPart<=0) return 0;
  // interestPart = (balance * rate * 91.3125) / total  =>  rate = interestPart * total / (balance * 91.3125)
  return (interestPart * totalContract) / (knownBalance * (365.25/4));
}

function computeDebt(d){
  const orig=parseFloat(d.origAmount)||0;
  const total=parseFloat(d.totalAmount)||0;
  const mo=parseFloat(d.amount)||0;       // monthly payment
  const rem=parseFloat(d.remaining)||0;
  const startDate=d.startDate||null;
  let interestRate=parseFloat(d.interestRate)||0;
  const totalTerms=parseInt(d.totalTerms)||0;

  // Total interest = total to repay − original
  const totalInterest=total>0&&orig>0?Math.round((total-orig)*100)/100:null;

  // Quarterly charge: use BAWAG formula if we have rate+total, else use stored value
  let quarterlyCharge=0;
  // effectiveRate kept for backward compat but formula now uses nominal rate directly
  let effectiveRate=parseFloat(d.effectiveRate)||0;

  // Quarterly charge using the correct BAWAG formula
  const fixedCharge=parseFloat(d.quarterlyCharge)||0; // the €21.99 fixed part
  if(interestRate>0&&total>0&&rem>0){
    // Full BAWAG formula: variable interest part + fixed charge
    quarterlyCharge=bawagQuarterlyCharge(rem, interestRate, total, fixedCharge);
  } else if(fixedCharge>0){
    quarterlyCharge=fixedCharge;
  }

  // Net monthly capital progress = (cuota×3 − cargoTrimestral) / 3
  const netMonthly=quarterlyCharge>0
    ? Math.round((mo*3-quarterlyCharge)/3*100)/100
    : mo;

  // Elapsed months since start
  let elapsedMonths=0;
  if(startDate){
    const sd=new Date(startDate),now=new Date();
    elapsedMonths=Math.max(0,Math.round((now-sd)/(1000*60*60*24*30.44)));
  }

  // Months remaining
  let monthsLeft=null;
  if(totalTerms>0&&startDate){
    monthsLeft=Math.max(0,totalTerms-elapsedMonths);
  } else if(rem>0&&netMonthly>0){
    monthsLeft=Math.ceil(rem/netMonthly);
  }

  // End date
  let endDate=null;
  if(monthsLeft){
    const dt=new Date();
    dt.setMonth(dt.getMonth()+monthsLeft);
    endDate=`${MO[dt.getMonth()]} ${dt.getFullYear()}`;
  }

  // % paid = (original - remaining) / original
  const pctPaid=orig>0&&rem>=0?Math.max(0,Math.min(100,Math.round((orig-rem)/orig*100))):null;

  // Project next 4 quarters of charges (shows how it decreases over time)
  let projectedCharges=null;
  if(interestRate>0&&total>0&&rem>0&&netMonthly>0&&fixedCharge>=0){
    projectedCharges=[];
    let projRem=rem;
    for(let q=0;q<4&&projRem>0;q++){
      const charge=bawagQuarterlyCharge(projRem, interestRate, total, fixedCharge);
      projectedCharges.push({quarter:q+1,charge,remaining:Math.round(projRem*100)/100});
      projRem=Math.max(0,projRem-(netMonthly*3));
    }
  }

  return{orig,total,mo,rem,totalInterest,quarterlyCharge,effectiveRate,interestRate,netMonthly,
    monthsLeft,totalTerms,elapsedMonths,endDate,pctPaid,startDate,projectedCharges};
}

function debtNetMonthly(mo,quarterlyCharge){
  return quarterlyCharge>0?Math.round((mo*3-quarterlyCharge)/3*100)/100:mo;
}

let entries=[],history=[],revolut=[],investments=[],savings_account=[],accounts=[],stmtConfig={annualRate:0,overdraftRate:0,maintenanceFeeHigh:0,maintenanceFeeLow:0,maintenanceThreshold:500},tab=0,filter="all",editId=null,ctype="expense",syncing=false,statsYear=new Date().getFullYear();

const lc=()=>{try{const d=JSON.parse(localStorage.getItem("fc_v5"));return d||{entries:[],history:[],revolut:[],investments:[],savings_account:[],stmtConfig:{annualRate:0,overdraftRate:0,maintenanceFeeHigh:0,maintenanceFeeLow:0,maintenanceThreshold:500}};}catch{return{entries:[],history:[],revolut:[],investments:[]};}};
const sc=()=>{try{localStorage.setItem("fc_v5",JSON.stringify({entries,history,revolut,investments,savings_account,stmtConfig}));}catch{}};

function bnr(type,txt){const b=$("bnr");b.className="show "+type;$("bic").innerHTML=type==="loading"?`<span class="sp">⟳</span>`:type==="success"?"✓":"✕";$("btx").textContent=txt;if(type!=="loading")setTimeout(()=>{b.className="";},3500);}
function sbs(state){$("sbtn").className="sbtn "+(state||"");$("sbi").innerHTML=state==="syncing"?`<span class="sp">⟳</span>`:state==="ok"?"✓":state==="err"?"✕":"⟳";}

// Supabase sync
async function sbLoad(){
  const sb=getSupabase();if(!sb||!_user)return null;
  const{data,error}=await sb.from("user_data").select("kind,record_id,data").eq("user_id",_user.id);
  if(error){console.error("sbLoad:",error);return null;}
  return(data||[]).map(r=>[r.kind,JSON.stringify(r.data)]);
}
async function sbSave(rows){
  const sb=getSupabase();if(!sb||!_user)return;
  const upserts=rows.map(([kind,jsonStr])=>{
    let data,record_id;
    try{data=JSON.parse(jsonStr);record_id=String(data.id||kind+"_cfg");}catch{return null;}
    return{user_id:_user.id,kind,record_id,data};
  }).filter(Boolean);
  if(!upserts.length)return;
  const{error}=await sb.from("user_data").upsert(upserts,{onConflict:"user_id,kind,record_id"});
  if(error)console.error("sbSave:",error);
}
// Legacy JSONP fallback
function jsonpGet(){return new Promise((resolve,reject)=>{const cb="fc_cb_"+Date.now(),s=document.createElement("script");const t=setTimeout(()=>{cleanup();reject(new Error("timeout"));},12000);function cleanup(){clearTimeout(t);delete window[cb];if(s.parentNode)s.parentNode.removeChild(s);}window[cb]=d=>{cleanup();resolve(d);};s.onerror=()=>{cleanup();reject(new Error("err"));};s.src=GAS_URL+"?callback="+cb+"&t="+Date.now();document.head.appendChild(s);});}
async function postData(rows){
  if(getSupabase()&&_user){await sbSave(rows);return;}
  await fetch(GAS_URL,{method:"POST",mode:"no-cors",headers:{"Content-Type":"text/plain"},body:JSON.stringify({data:rows})});
}

function toRows(){const rows=[];entries.forEach(e=>rows.push(["entry",JSON.stringify(e)]));history.forEach(h=>rows.push(["history",JSON.stringify(h)]));revolut.forEach(r=>rows.push(["revolut",JSON.stringify(r)]));investments.forEach(i=>rows.push(["investment",JSON.stringify(i)]));savings_account.forEach(s=>rows.push(["saving",JSON.stringify(s)]));accounts.forEach(a=>rows.push(["account",JSON.stringify(a)]));rows.push(["stmtconfig",JSON.stringify(stmtConfig)]);return rows;}
function fromRows(rows){
  const ent=[],hist=[],rev=[],inv=[],sav_acc=[],acc=[],sc_cfg={};
  const KINDS=new Set(["entry","history","revolut","investment","saving","account","stmtconfig"]);
  rows.forEach(r=>{
    if(!r[0]) return;
    const first=String(r[0]).trim();
    // New format only: ["kind", "{json}"]
    if(!KINDS.has(first)) return;
    try{
      const d=JSON.parse(String(r[1]));
      if(!d||typeof d!=="object") return;
      if(first==="entry")ent.push(d);
      else if(first==="history")hist.push(d);
      else if(first==="revolut")rev.push(d);
      else if(first==="investment")inv.push(d);
      else if(first==="saving")sav_acc.push(d);
      else if(first==="account")acc.push(d);
      else if(first==="stmtconfig"&&d){Object.assign(sc_cfg,d);}
    }catch{}
  });
  return{entries:ent,history:hist,revolut:rev,investments:inv,savings_account:sav_acc,accounts:acc,stmtConfig:sc_cfg};
}

async function syncNow(){
  if(syncing)return;
  syncing=true;sbs("syncing");
  bnr("loading","Conectando con Google Sheets…");
  try{
    // Load from Supabase (or legacy GAS)
    let raw;
    if(getSupabase()&&_user){raw=await sbLoad();}
    else{raw=await jsonpGet();}
    const rem=fromRows(raw||[]);

    // Deduplicate by id — Sheet may have accumulated duplicates
    const dedup=(arr,key="id")=>{
      const seen=new Set();
      return arr.filter(x=>{
        const k=x[key];
        if(seen.has(k)) return false;
        seen.add(k); return true;
      });
    };

    const remEntries=dedup(rem.entries);
    const remHistory=dedup(rem.history);
    const remRevolut=dedup(rem.revolut||[]);
    const remInvestments=dedup(rem.investments||[]);
    const remSavings=dedup(rem.savings_account||[]);

    // Remote is authoritative if it has data
    // Only keep local items not present remotely (added since last push)
    const merge=(remote,local)=>{
      if(!remote.length && local.length) return local; // Sheet empty, keep local
      const ids=new Set(remote.map(x=>x.id));
      const onlyLocal=local.filter(x=>!ids.has(x.id));
      return [...remote,...onlyLocal];
    };

    const newEntries=merge(remEntries,entries);
    const newHistory=merge(remHistory,history);
    const newRevolut=merge(remRevolut,revolut);
    const newInvestments=merge(remInvestments,investments);
    const newSavings=merge(remSavings,savings_account);

    // Only push if we added local-only items not yet in remote
    const needsPush=
      newEntries.length>remEntries.length||
      newHistory.length>remHistory.length||
      newRevolut.length>remRevolut.length||
      newInvestments.length>remInvestments.length||
      newSavings.length>remSavings.length;

    entries=newEntries;history=newHistory;revolut=newRevolut;
    investments=newInvestments;savings_account=newSavings;
    if(rem.stmtConfig&&Object.keys(rem.stmtConfig).length) Object.assign(stmtConfig,rem.stmtConfig);

    if(needsPush) await postData(toRows());
    sc();retagHistory();render();sbs("ok");
    bnr("success","Sincronizado ✓");
  }catch(e){
    console.error(e);sbs("err");
    bnr("error","Sin conexión — datos locales activos");
  }
  syncing=false;
}
async function push(){sc();sbs("syncing");try{await postData(toRows());sbs("ok");}catch{sbs("err");bnr("error","Guardado local. Sin conexión.");}}

// ── STATS ────────────────────────────────────────────────────
// avgVariableIncome: average of variable income entries from history (last 6 months with data)
// Average net salary from history (income - fixed recurring expenses)
// Uses last 6 months that have history data
function avgVariableIncome(){
  const now=new Date();
  const curM=now.getMonth()+1, curY=now.getFullYear();
  const fixedOut=entries.filter(e=>e.type!=="income"&&e.type!=="variable"&&e.type!=="savings"&&e.type!=="annual").reduce((a,b)=>a+b.amount,0);
  const fixedInc=entries.filter(e=>e.type==="income").reduce((a,b)=>a+b.amount,0);
  // Get last 6 months with history, excluding current month
  const recent=[...history]
    .filter(h=>!(h.month===curM&&h.year===curY))
    .sort((a,b)=>a.year!==b.year?b.year-a.year:b.month-a.month)
    .slice(0,6);
  if(!recent.length) return 0;
  // Variable income = total income from history minus fixed incomes
  const varIncomes=recent.map(h=>Math.max(0,h.income-fixedInc));
  return varIncomes.reduce((a,b)=>a+b,0)/varIncomes.length;
}

// Get history data for a specific month/year
function histMonth(monthNum, yr){
  return history.find(h=>h.month===monthNum&&h.year===yr)||null;
}

function sm(monthNum, yr){
  const now=new Date();
  const curM=now.getMonth()+1, curY=now.getFullYear();
  yr=yr||curY;

  const isPast=(yr<curY)||(yr===curY&&monthNum<curM);
  const isCurrentMonth=(monthNum===curM&&yr===curY);
  const isFuture=(yr>curY)||(yr===curY&&monthNum>curM);

  const fixedInc=entries.filter(e=>e.type==="income").reduce((a,b)=>a+b.amount,0);
  const rec=entries.filter(e=>e.type!=="income"&&e.type!=="variable"&&e.type!=="savings"&&e.type!=="annual").reduce((a,b)=>a+b.amount,0);
  const ann=entries.filter(e=>e.type==="annual"&&parseInt(e.month)===monthNum).reduce((a,b)=>a+b.amount,0);
  const sav=entries.filter(e=>e.type==="savings").reduce((a,b)=>a+b.amount,0);
  const varEntries=entries.filter(e=>e.type==="variable"&&parseInt(e.varMonth)===monthNum&&parseInt(e.varYear)===yr);
  const varInc=varEntries.reduce((a,b)=>a+b.amount,0);

  let inc, actualInc, actualOut, fromHistory=false;
  const hm=histMonth(monthNum, yr);

  if(hm){
    // Any month that has real CSV data (past OR current): use actual figures
    // For current month: history income already includes the salary from CSV
    actualInc=hm.income;
    actualOut=hm.expenses;
    inc=actualInc;
    fromHistory=true;
  } else if(isCurrentMonth){
    // Current month with no CSV imported yet: fixed + manual variable entries
    inc=fixedInc+varInc;
    actualOut=rec+ann;
  } else if(isFuture){
    // Future month: fixed income + avg variable salary from history
    const avgVar=avgVariableIncome();
    inc=fixedInc+avgVar;
    actualOut=rec+ann;
  } else {
    // Past month with no history: use fixed entries only
    inc=fixedInc+varInc;
    actualOut=rec+ann;
  }

  const out=fromHistory?actualOut:(rec+ann);
  const avail=fromHistory?(actualInc-actualOut):(inc-out-sav);
  const pct=inc>0?Math.min(100,(out+sav)/inc*100):0;

  return{
    inc, fixedInc,
    varInc: fromHistory?(hm.income-fixedInc):isCurrentMonth?varInc:isFuture?avgVariableIncome():0,
    rec, ann, sav, out, avail, pct,
    fromHistory, hm,
    debts:entries.filter(e=>e.type==="debt")
  };
}

// ── CSV ──────────────────────────────────────────────────────
function parseCSV(text){
  const lines=text.trim().split(/\r?\n/);if(lines.length<2)return[];
  const sep=lines[0].includes(";")?";":",";
  const headers=lines[0].split(sep).map(h=>h.trim().toLowerCase().replace(/["\uFEFF]/g,""));
  return lines.slice(1).map(l=>{const cols=l.split(sep).map(c=>c.trim().replace(/^"|"$/g,""));const o={};headers.forEach((h,i)=>{o[h]=cols[i]||"";});return o;}).filter(r=>Object.values(r).some(v=>v));
}
// Parse European decimal: "-9,95" or "+2.682,72" -> float
function parseEuroNum(s){
  if(!s)return 0;
  const clean=s.trim().replace(/^\+/,"").replace(/\./g,"").replace(",",".");
  return parseFloat(clean)||0;
}

// Extract readable merchant name from BAWAG description field
function cleanDesc(raw){
  if(!raw)return "Sin descripción";
  const parts=raw.split("|");
  let desc=parts[0].trim();
  // If first part is generic (short alpha content), try to use part after second pipe
  const alphaOnly=desc.replace(/[A-ZÄÖÜ\/0-9 ]/g,"");
  if(parts.length>=3&&alphaOnly.length<5){
    const merchant=parts[2].split("\\")[0].trim();
    if(merchant) desc=merchant;
  }
  // Remove internal reference codes like "MC/000003585"
  desc=desc.replace(/\b[A-Z]{2}\/[0-9]+\b/g,"").replace(/\s{2,}/g," ").trim();
  return desc.substring(0,50)||"Sin descripción";
}

function importCSV(text){
  // BAWAG format (no header): IBAN;Description;FechaCargo;FechaPago;Amount;Currency
  // Uses FechaPago (col index 3) as the real transaction date
  // File encoding: latin-1, decimal separator: comma, column separator: semicolon
  const lines=text.trim().split(/\r?\n/).filter(l=>l.trim());
  if(!lines.length)return null;

  const monthMap={};
  lines.forEach(line=>{
    const cols=line.split(";");
    if(cols.length<5)return;
    const rawDesc=cols[1]||"";
    const fechaPago=(cols[3]||"").trim();   // DD.MM.YYYY — real payment date
    const rawAmt=cols[4]||"";

    // Parse DD.MM.YYYY
    const dp=fechaPago.split(".");
    if(dp.length<3)return;
    const day=parseInt(dp[0]),month=parseInt(dp[1]),year=parseInt(dp[2]);
    if(!month||!year||isNaN(day))return;

    const amount=parseEuroNum(rawAmt);
    if(amount===0)return;

    const type=amount>0?"income":"expense";
    const absAmt=Math.round(Math.abs(amount)*100)/100;
    const desc=cleanDesc(rawDesc);
    const key=year+"-"+month;
    if(!monthMap[key])monthMap[key]={year,month,income:0,expenses:0,transactions:[]};
    if(type==="income")monthMap[key].income=Math.round((monthMap[key].income+absAmt)*100)/100;
    else monthMap[key].expenses=Math.round((monthMap[key].expenses+absAmt)*100)/100;
    monthMap[key].transactions.push({desc,amount:absAmt,type,day});
  });

  const results=Object.values(monthMap).map(m=>({
    id:Date.now()+m.year*100+m.month,
    year:m.year,month:m.month,
    income:m.income,expenses:m.expenses,
    balance:Math.round((m.income-m.expenses)*100)/100,
    transactions:m.transactions.sort((a,b)=>b.day-a.day)
  }));

  return results.length?results:null;
}

// ── MATCHING ENGINE ─────────────────────────────────────────
// Returns the matched entry (if any) for a CSV transaction
// Patterns that identify BAWAG→Revolut transfers (shown as internal in BAWAG history)
const REVOLUT_BAWAG_PATTERNS=[/revolut/i,/LT383250/i];

function matchTransaction(tx){
  const txDesc=(tx.desc||"");
  const txDescL=txDesc.toLowerCase();
  const txAmt=tx.amount;

  // Check if this is a BAWAG→Revolut internal transfer
  for(const pat of REVOLUT_BAWAG_PATTERNS){
    if(pat.test(txDesc)) return{name:"Revolut (interno)",type:"__internal__",id:"revolut-internal"};
  }

  for(const e of entries){
    // Statement entries match by their stmtKeywords field
    if(e.type==="income"||e.type==="savings") continue;
    if(e.type==="statement"){
      if(!e.stmtKeywords) continue;
      const kwList=e.stmtKeywords.split(/[,\s]+/).filter(w=>w.length>2);
      if(kwList.length&&kwList.some(kw=>txDescL.includes(kw)))
        return{...e,name:(e.name||"Estado de cuenta")};
      continue;
    }

    const eAmt=parseFloat(e.amount)||0;
    const eName=(e.name||"").toLowerCase();
    const eKw=(e.keywords||"").toLowerCase();
    const isFixed=eAmt>0&&e.fixedAmount!==false;

    const kwList=[
      ...eKw.split(/[,\s]+/).filter(w=>w.length>2),
      ...eName.split(/[\s,]+/).filter(w=>w.length>3),
    ];
    const hasKeywords=kwList.length>0;
    const kwMatch=hasKeywords&&kwList.some(kw=>txDescL.includes(kw));

    if(isFixed){
      const amtMatch=Math.abs(txAmt-eAmt)<0.02;
      if(amtMatch) return e;
      if(eKw.length>0&&kwMatch) return e;
    } else {
      if(kwMatch) return e;
    }
  }
  return null;
}

// Tag all transactions in a history month with their matched entry
function tagHistoryMonth(hMonth){
  if(!hMonth||!hMonth.transactions) return hMonth;
  return{
    ...hMonth,
    transactions: hMonth.transactions.map(tx=>({
      ...tx,
      matched: matchTransaction(tx)||null
    }))
  };
}

// Recompute match tags for all history (call after entries change)
function retagHistory(){
  history=history.map(h=>tagHistoryMonth(h));
}

// ── PAYROLL PERIOD ENGINE ────────────────────────────────────
// Detects salary payment days from history and builds financial periods
// "Financial month of February" = from salary paid in Feb (day ~13-15) to day before salary in March

// Detect the salary transaction in a history month
// Salary = BEZUEGE pattern or largest single income transaction
function detectSalaryDay(hMonth){
  if(!hMonth||!hMonth.transactions) return null;
  // First try BEZUEGE keyword (voestalpine specific)
  const bezuege=hMonth.transactions.find(t=>
    t.type==="income"&&/bezuege|bezüge|zuwendung|gehalt|lohn/i.test(t.desc)
  );
  if(bezuege) return bezuege.day;
  // Fallback: largest income transaction
  const incomes=hMonth.transactions.filter(t=>t.type==="income");
  if(!incomes.length) return null;
  const largest=incomes.reduce((a,b)=>b.amount>a.amount?b:a);
  return largest.amount>500?largest.day:null;
}

// Build a map of financial periods from history
// Returns array of {label, salaryMonth, salaryYear, startDay, startMonth, startYear, endDay, endMonth, endYear, hMonth}
function buildPayrollPeriods(){
  if(!history.length) return [];

  // Get all months with detected salary day, sorted chronologically
  const salaryDays=[...history]
    .map(h=>({h, day:detectSalaryDay(h), month:h.month, year:h.year}))
    .filter(x=>x.day!==null)
    .sort((a,b)=>a.year!==b.year?a.year-b.year:a.month-b.month);

  if(!salaryDays.length) return [];

  const periods=[];
  for(let i=0;i<salaryDays.length;i++){
    const cur=salaryDays[i];
    const next=salaryDays[i+1]||null;

    // Period starts on salary day of this calendar month
    const startDay=cur.day, startMonth=cur.month, startYear=cur.year;

    // Period ends day before next salary (or end of last known day)
    let endDay, endMonth, endYear;
    if(next){
      // End = day before next salary
      endDay=next.day-1;
      endMonth=next.month;
      endYear=next.year;
      if(endDay<1){
        // Wrap back a month
        endMonth=endMonth-1;
        if(endMonth<1){endMonth=12;endYear--;}
        endDay=new Date(endYear,endMonth,0).getDate(); // last day of prev month
      }
    } else {
      // Last period: end = today or projected next salary
      const now=new Date();
      endDay=now.getDate()-1;
      endMonth=now.getMonth()+1;
      endYear=now.getFullYear();
    }

    // Label: the salary month in description is the month BEFORE the payment month
    // e.g. BEZUEGE 2026/02 paid on 2026-03-13 → financial label = "Febrero 2026"
    // Detect from description if possible
    let labelMonth=cur.month-1, labelYear=cur.year;
    if(labelMonth<1){labelMonth=12;labelYear--;}
    // Try to extract from BEZUEGE description
    const bezTx=cur.h.transactions.find(t=>/bezuege/i.test(t.desc));
    if(bezTx){
      const m=bezTx.desc.match(/(\d{4})\/(\d{2})/);
      if(m){labelYear=parseInt(m[1]);labelMonth=parseInt(m[2]);}
    }

    // Sum transactions within this period from all overlapping history months
    // (a period can span parts of 2 calendar months)
    let periodIncome=0, periodExpenses=0, periodTransactions=[];
    history.forEach(hm=>{
      (hm.transactions||[]).forEach(t=>{
        const tDate=new Date(hm.year,hm.month-1,t.day||1);
        const startDate=new Date(startYear,startMonth-1,startDay);
        const endDate=new Date(endYear,endMonth-1,endDay+1);
        if(tDate>=startDate&&tDate<endDate){
          if(t.type==="income") periodIncome+=t.amount;
          else periodExpenses+=t.amount;
          periodTransactions.push({...t,calMonth:hm.month,calYear:hm.year});
        }
      });
    });

    periods.push({
      label:`${MF[labelMonth-1]} ${labelYear}`,
      labelMonth, labelYear,
      startDay, startMonth, startYear,
      endDay, endMonth, endYear,
      income:Math.round(periodIncome*100)/100,
      expenses:Math.round(periodExpenses*100)/100,
      balance:Math.round((periodIncome-periodExpenses)*100)/100,
      salaryDay:cur.day,
      transactionCount:periodTransactions.length,
      hMonths:[cur.h]
    });
  }

  return periods.reverse(); // newest first
}

// Get the current financial period (ongoing)
function getCurrentPayrollPeriod(){
  const periods=buildPayrollPeriods();
  if(!periods.length) return null;
  // First period is the most recent
  return periods[0];
}

// Estimated next salary date
function getNextSalaryDate(){
  const now=new Date();
  // Find most recent salary day from history
  const recent=[...history]
    .sort((a,b)=>a.year!==b.year?b.year-a.year:b.month-a.month)
    .slice(0,3);
  const days=recent.map(h=>detectSalaryDay(h)).filter(d=>d!==null);
  if(!days.length) return null;
  // Average salary day
  const avgDay=Math.round(days.reduce((a,b)=>a+b,0)/days.length);
  // Next occurrence
  let nextMonth=now.getMonth()+1, nextYear=now.getFullYear();
  if(now.getDate()>=avgDay){nextMonth++;if(nextMonth>12){nextMonth=1;nextYear++;}}
  return{day:avgDay,month:nextMonth,year:nextYear,
    label:`${avgDay} ${MF[nextMonth-1]} ${nextYear}`};
}

// ── RENDER ───────────────────────────────────────────────────
function render(){
  const now=new Date();
  $("hdate").textContent=`${MO[now.getMonth()]} ${now.getFullYear()}`;
  if(tab===0)$("con").innerHTML=rHome();
  else if(tab===1){rStats();}
  else if(tab===2){$("con").innerHTML=rHistory();}
  else if(tab===3)$("con").innerHTML=rList();

  if(tab===1)setTimeout(drawCharts,50);
  if(tab===4)rPatrimonio();
  if(tab===5)rStocks();
  if(tab===6)rCrypto();
  if(tab===7)rDebts();

}

// ── HOME ─────────────────────────────────────────────────────
function rHome(){
  const now=new Date(),cm=now.getMonth()+1;
  const st=sm(cm,now.getFullYear());
  const r=40,C=2*Math.PI*r,dash=(C*Math.min(st.pct,100))/100;
  const rc=st.pct>90?"#FF6B6B":st.pct>70?"#FFD166":"#2EE8A5";
  // Payroll period
  const pp=getCurrentPayrollPeriod();
  const nextSal=getNextSalaryDate();
  const ppIncome=pp?pp.income:st.inc;
  const ppExpenses=pp?pp.expenses:st.out;
  const ppBalance=pp?pp.balance:(st.inc-st.out-st.sav);
  const ppLabel=pp?pp.label:`${MF[now.getMonth()]} ${now.getFullYear()}`;
  const ppPeriod=pp?`${pp.startDay} ${MO[pp.startMonth-1]} — ${pp.endDay} ${MO[pp.endMonth-1]}`:"";
  let dh="";
  if(!st.debts.length){dh=`<div style="text-align:center;padding:20px;color:#2EE8A5;font-size:20px">✓ Sin deudas</div>`;}
  else st.debts.forEach(d=>{
    const cd=computeDebt(d);
    const paidPct=cd.orig>0&&cd.rem>=0?Math.max(0,Math.min(100,Math.round((cd.orig-cd.rem)/cd.orig*100))):0;
    const qLabel=cd.monthsLeft?Math.ceil(cd.monthsLeft/3)+" pagos trimestrales restantes":"";
    const qRow=cd.quarterlyCharge>0?('<div style="font-size:10px;color:#F97316;margin-top:1px">⚡ Cargo trimestral: '+fmt(cd.quarterlyCharge)+' · Avance real: '+fmt(cd.netMonthly)+'/mes</div>'):"";
    const origInfo=cd.orig>0?(
      '<div style="font-size:10px;color:#555;margin-top:1px">Monto original: '+fmt(cd.orig)+
      (cd.totalInterest?' · Interés total: '+fmt(cd.totalInterest):"")+
      (cd.startDate?' · Desde: '+cd.startDate:"")+
      (d.totalTerms?' · '+d.totalTerms+' plazos':"")+
      (d.fixedRateEnd?' · Tipo fijo hasta '+d.fixedRateEnd:"")+
      '</div>'):""
    ;
    const mlRow=cd.monthsLeft?('<div style="font-size:9px;color:#555;margin-top:1px">'+cd.monthsLeft+' meses</div>'):"";
    dh+=`<div class="card" style="background:rgba(249,115,22,.07);border-color:rgba(249,115,22,.2)">
      <div style="display:flex;justify-content:space-between;margin-bottom:7px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:13px">${d.name}</div>
          <div style="font-size:10px;color:#555;margin-top:1px">${fmt(cd.mo)}/mes · termina ${cd.endDate||"—"}</div>
          ${qRow}${origInfo}
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-family:monospace;font-weight:800;font-size:15px;color:#F97316">${fmt(cd.rem)}</div>
          ${mlRow}
        </div>
      </div>
      <div style="background:rgba(255,255,255,.07);border-radius:99px;height:5px"><div style="background:linear-gradient(90deg,#F97316,#FFD166);height:100%;border-radius:99px;width:${paidPct}%"></div></div>
      <div style="display:flex;justify-content:space-between;margin-top:3px">
        <span style="font-size:9px;color:#555">Saldo actual</span>
        <span style="font-size:9px;color:#555">${qLabel}</span>
      </div></div>`;
  });
  // Full year forecast
  const fcYear=now.getFullYear();
  let fc="";
  for(let i=1;i<=12;i++){
    const mst=sm(i,fcYear);
    const isn=i===cm;
    const isPast=(i<cm);
    const hasA=mst.ann>0;
    const hasHist=mst.fromHistory;
    let cls="fc";
    if(isn) cls+=" now";
    else if(hasA&&!isPast) cls+=" ha";
    let monthColor=isn?"color:#2EE8A5;font-weight:700":hasA&&!isPast?"color:#A78BFA;font-weight:600":isPast?"color:#666":"color:#555";
    fc+=`<div class="${cls}" style="${isPast&&!isn?'opacity:.7':''}">
      <div style="font-size:10px;margin-bottom:3px;${monthColor}">${MO[i-1]}</div>
      <div style="font-family:monospace;font-weight:800;font-size:11px;color:${mst.avail>=0?"#2EE8A5":"#FF6B6B"}">${fmtK(mst.avail)}</div>
      <div style="font-size:8px;margin-top:2px;color:#555">${hasHist?"📋":isn?"":"~"}</div>
    </div>`;
  }
  const avg=avgVariableIncome();
  const varNote=avg>0&&st.varInc===0&&!st.fromHistory?`<div style="background:rgba(0,201,167,.07);border:1px solid rgba(0,201,167,.2);border-radius:13px;padding:10px 13px;margin-bottom:12px;display:flex;align-items:center;gap:9px"><span style="font-size:17px">💰</span><div><div style="font-size:11px;font-weight:700;color:#00C9A7">Sueldo no registrado este mes</div><div style="font-size:10px;color:#777;margin-top:1px">Previsión usa promedio histórico: ${fmt(avg)}</div></div></div>`:"";
  const aw=st.ann>0?`<div style="background:rgba(167,139,250,.08);border:1px solid rgba(167,139,250,.25);border-radius:13px;padding:10px 13px;margin-bottom:12px;display:flex;align-items:center;gap:9px"><span style="font-size:17px">📅</span><div><div style="font-size:11px;font-weight:700;color:#A78BFA">Anualidad este mes</div><div style="font-size:10px;color:#777;margin-top:1px">${fmt(st.ann)} en pagos anuales</div></div></div>`:"";
  return`<div class="hero"><div class="glow"></div>
    <div style="font-size:10px;color:#666;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Disponible — ${ppLabel}${ppPeriod?` · <span style="font-size:9px;color:#444">${ppPeriod}</span>`:""}</div>
    <div style="font-family:monospace;font-weight:900;font-size:32px;letter-spacing:-1px;line-height:1;margin-bottom:16px;color:${ppBalance>=0?"#2EE8A5":"#FF6B6B"}">${fmt(ppBalance)}</div>
    <div style="display:flex;align-items:center;gap:16px">
      <div class="rw"><svg width="92" height="92" style="transform:rotate(-90deg)"><circle cx="46" cy="46" r="${r}" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="8"/><circle cx="46" cy="46" r="${r}" fill="none" stroke="${rc}" stroke-width="8" stroke-dasharray="${dash} ${C-dash}" stroke-linecap="round"/></svg>
        <div class="rc"><div style="font-size:8px;color:#666">USADO</div><div style="font-family:monospace;font-weight:800;font-size:18px;color:${st.pct>90?"#FF6B6B":st.pct>70?"#FFD166":"#f0f0f0"}">${Math.round(st.pct)}%</div></div></div>
      <div style="flex:1">${pp?[["Ingresos","#2EE8A5",ppIncome],["Gastos","#FF6B6B",ppExpenses]].map(([l,c,v])=>`<div class="strow"><div style="display:flex;align-items:center"><div class="sdot" style="background:${c}"></div><span style="font-size:10px;color:#777;margin-left:5px">${l}</span></div><span style="font-family:monospace;font-size:11px;font-weight:700;color:${v>0?c:"#444"}">${fmt(v)}</span></div>`).join(""):[["Ingreso fijo","#2EE8A5",st.fixedInc],["Sueldo (este mes)","#00C9A7",st.varInc],["Gastos fijos","#FF6B6B",st.rec],["Anualidades","#A78BFA",st.ann],["Ahorro","#38BDF8",st.sav]].map(([l,c,v])=>`<div class="strow"><div style="display:flex;align-items:center"><div class="sdot" style="background:${c}"></div><span style="font-size:10px;color:#777;margin-left:5px">${l}</span></div><span style="font-family:monospace;font-size:11px;font-weight:700;color:${v>0?c:"#444"}">${fmt(v)}</span></div>`).join("")}</div>
    </div></div>
  ${varNote}${aw}${buildStatementSummaryHTML()}
  ${nextSal?`<div style="background:rgba(46,232,165,.06);border:1px solid rgba(46,232,165,.15);border-radius:13px;padding:10px 13px;margin-bottom:12px;display:flex;align-items:center;gap:9px">
    <span style="font-size:17px">💰</span>
    <div><div style="font-size:11px;font-weight:700;color:#2EE8A5">Próximo sueldo estimado</div>
    <div style="font-size:10px;color:#777;margin-top:1px">${nextSal.label}</div></div>
  </div>`:""}
  <div class="sec">Previsión anual ${now.getFullYear()}</div>
  <div class="fscroll">${fc}</div>
  <div style="display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap">
    <div style="display:flex;align-items:center;gap:4px;font-size:10px;color:#555"><span>📋</span> Datos reales del banco</div>
    <div style="display:flex;align-items:center;gap:4px;font-size:10px;color:#555"><span style="color:#aaa">~</span> Estimado</div>
    <div style="display:flex;align-items:center;gap:4px;font-size:10px;color:#A78BFA"><span>📅</span> Anualidad</div>
  </div>
  <div class="sec">Deudas activas</div>${dh}<div style="height:20px"></div>`;
}

// ── STATS ────────────────────────────────────────────────────
function rStats(){
  const years=[...new Set(history.map(h=>h.year))].sort((a,b)=>a-b);
  if(!years.length){$("con").innerHTML=`<div class="empty"><div style="font-size:44px;margin-bottom:10px">📊</div><div style="font-size:14px;color:#444">Sin historial aún</div><div style="font-size:12px;color:#333;margin-top:3px">Importa un CSV en la pestaña Historial</div></div>`;return;}
  if(!years.includes(statsYear))statsYear=years[years.length-1];
  const ybtns=years.map(y=>`<button class="yb${y===statsYear?' active':''}" onclick="statsYear=${y};rStats();setTimeout(drawCharts,50)">${y}</button>`).join("");
  // Use payroll periods instead of calendar months for statistics
  const allPeriods=buildPayrollPeriods();
  const yearPeriods=allPeriods.filter(p=>p.labelYear===statsYear).reverse(); // oldest first
  // Fallback to calendar months if no payroll periods
  const months=yearPeriods.length>0
    ? yearPeriods.map(p=>({...p,month:p.labelMonth,year:p.labelYear}))
    : Array.from({length:12},(_,i)=>history.find(x=>x.year===statsYear&&x.month===i+1)||{year:statsYear,month:i+1,income:0,expenses:0,balance:0,transactions:[]});
  const tInc=months.reduce((a,b)=>a+b.income,0),tExp=months.reduce((a,b)=>a+b.expenses,0);
  const best=months.reduce((a,b)=>(b.income-b.expenses)>(a.income-a.expenses)?b:a,months[0]||{income:0,expenses:0,month:1});
  const worst=months.reduce((a,b)=>(b.income-b.expenses)<(a.income-a.expenses)?b:a,months[0]||{income:0,expenses:0,month:1});
  $("con").innerHTML=`
  <div class="ys">${ybtns}</div>
  <div class="g2">
    ${[["Total ingresos","#2EE8A5",fmt(tInc)],["Total gastos","#FF6B6B",fmt(tExp)],["Balance neto",tInc-tExp>=0?"#2EE8A5":"#FF6B6B",fmt(tInc-tExp)],["Mejor mes","#FFD166",`${MO[best.month-1]}: ${fmt(best.income-best.expenses)}`]].map(([l,c,v])=>`<div class="card"><div style="font-size:9px;color:#555;text-transform:uppercase;letter-spacing:.7px;margin-bottom:4px">${l}</div><div style="font-family:monospace;font-weight:800;font-size:14px;color:${c}">${v}</div></div>`).join("")}
  </div>
  <div class="cwrap"><div class="ctitle">Ingresos vs Gastos — ${statsYear}</div><canvas id="c-bar" height="150"></canvas><div class="cleg"><div class="li"><div class="ld" style="background:#2EE8A5"></div>Ingresos</div><div class="li"><div class="ld" style="background:#FF6B6B"></div>Gastos</div></div></div>
  <div class="cwrap"><div class="ctitle">Evolución del saldo acumulado — ${statsYear}</div><canvas id="c-line" height="130"></canvas></div>
  <div class="cwrap"><div class="ctitle">Top gastos por categoría</div><canvas id="c-donut" height="150"></canvas><div class="cleg" id="dleg"></div></div>
  <div class="cwrap"><div class="ctitle">Comparativa mensual</div>
    <table class="ftable"><tr><th>Mes</th><th>Ingresos</th><th>Gastos</th><th>Balance</th></tr>
    ${months.map((m,i)=>{
    const bal=m.income-m.expenses;
    const pp2=getCurrentPayrollPeriod();
    const isc=pp2&&m.labelMonth===pp2.labelMonth&&m.labelYear===pp2.labelYear;
    const lbl=m.label||MO[(m.month||1)-1];
    const periodStr=m.startDay&&m.startMonth?`<div style="font-size:9px;color:#444">${m.startDay} ${MO[m.startMonth-1]}—${m.endDay} ${MO[m.endMonth-1]}</div>`:"";
    return`<tr class="${isc?"cm":""}">
      <td style="color:#aaa;font-weight:${isc?700:400}">${lbl}${periodStr}</td>
      <td style="font-family:monospace;color:#2EE8A5">${m.income?fmt(m.income):"—"}</td>
      <td style="font-family:monospace;color:#FF6B6B">${m.expenses?fmt(m.expenses):"—"}</td>
      <td style="font-family:monospace;color:${bal>=0?"#2EE8A5":"#FF6B6B"};font-weight:700">${m.income||m.expenses?fmt(bal):"—"}</td>
    </tr>`;}).join("")}
    </table>
  </div><div style="height:20px"></div>`;
}

function drawCharts(){
  if(tab!==1)return;
  const allP=buildPayrollPeriods().filter(p=>p.labelYear===statsYear).reverse();
  const months=allP.length>0?allP:Array.from({length:12},(_,i)=>history.find(x=>x.year===statsYear&&x.month===i+1)||{income:0,expenses:0,transactions:[]});
  const COLS=["#FF6B6B","#FFD166","#2EE8A5","#38BDF8","#A78BFA","#F97316"];

  // BAR
  const cb=$("c-bar");if(!cb)return;
  cb.width=cb.parentElement.clientWidth-28;
  const bx=cb.getContext("2d"),bw=cb.width,bh=cb.height;
  bx.clearRect(0,0,bw,bh);
  const maxV=Math.max(...months.map(m=>Math.max(m.income,m.expenses)),1);
  const colW=(bw-30)/12,barW=colW/2-2,pH=bh-22,pL=4;
  months.forEach((m,i)=>{
    const x=pL+i*colW,ih=(m.income/maxV)*pH,eh=(m.expenses/maxV)*pH;
    bx.fillStyle="#2EE8A518";bx.beginPath();if(bx.roundRect)bx.roundRect(x,pH-ih+2,barW,ih,2);else bx.rect(x,pH-ih+2,barW,ih);bx.fill();
    if(ih>2){bx.fillStyle="#2EE8A5";bx.beginPath();if(bx.roundRect)bx.roundRect(x,pH-ih+2,barW,3,1);else bx.rect(x,pH-ih+2,barW,3);bx.fill();}
    bx.fillStyle="#FF6B6B18";bx.beginPath();if(bx.roundRect)bx.roundRect(x+barW+2,pH-eh+2,barW,eh,2);else bx.rect(x+barW+2,pH-eh+2,barW,eh);bx.fill();
    if(eh>2){bx.fillStyle="#FF6B6B";bx.beginPath();if(bx.roundRect)bx.roundRect(x+barW+2,pH-eh+2,barW,3,1);else bx.rect(x+barW+2,pH-eh+2,barW,3);bx.fill();}
    bx.fillStyle="#555";bx.font="8px DM Sans";bx.textAlign="center";bx.fillText(months[i]&&months[i].label?months[i].label.substring(0,3):MO[i],x+barW,bh-5);
  });

  // LINE
  const cl=$("c-line");if(!cl)return;
  cl.width=cl.parentElement.clientWidth-28;
  const lx=cl.getContext("2d"),lw=cl.width,lh=cl.height;
  lx.clearRect(0,0,lw,lh);
  let cum=0;const bals=months.map(m=>{cum+=m.income-m.expenses;return cum;});
  const minB=Math.min(...bals,0),maxB=Math.max(...bals,1),range=maxB-minB||1;
  const lpad=8,lpb=18,lch=lh-lpb-6;
  const pts=bals.map((b,i)=>({x:lpad+i*(lw-lpad*2)/11,y:5+((maxB-b)/range)*lch}));
  const grad=lx.createLinearGradient(0,0,0,lh);grad.addColorStop(0,"rgba(46,232,165,.18)");grad.addColorStop(1,"rgba(46,232,165,0)");
  lx.beginPath();lx.moveTo(pts[0].x,pts[0].y);pts.forEach(p=>lx.lineTo(p.x,p.y));lx.lineTo(pts[11].x,lh-lpb);lx.lineTo(pts[0].x,lh-lpb);lx.closePath();lx.fillStyle=grad;lx.fill();
  lx.beginPath();lx.moveTo(pts[0].x,pts[0].y);pts.forEach(p=>lx.lineTo(p.x,p.y));lx.strokeStyle="#2EE8A5";lx.lineWidth=2;lx.stroke();
  pts.forEach((p,i)=>{lx.beginPath();lx.arc(p.x,p.y,3,0,Math.PI*2);lx.fillStyle=bals[i]>=0?"#2EE8A5":"#FF6B6B";lx.fill();lx.fillStyle="#555";lx.font="8px DM Sans";lx.textAlign="center";lx.fillText(months[i]&&months[i].label?months[i].label.substring(0,3):MO[i],p.x,lh-4);});
  if(minB<0&&maxB>0){const zy=5+((maxB-0)/range)*lch;lx.beginPath();lx.moveTo(lpad,zy);lx.lineTo(lw-lpad,zy);lx.strokeStyle="rgba(255,255,255,.1)";lx.lineWidth=1;lx.setLineDash([3,4]);lx.stroke();lx.setLineDash([]);}

  // DONUT
  const cd=$("c-donut");if(!cd)return;
  cd.width=cd.parentElement.clientWidth-28;
  const dx=cd.getContext("2d"),dw=cd.width,dh=cd.height;
  dx.clearRect(0,0,dw,dh);
  const cats={};months.forEach(m=>(m.transactions||[]).forEach(t=>{if(t.type==="expense")cats[t.desc]=(cats[t.desc]||0)+t.amount;}));
  const ca=Object.entries(cats).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const tot=ca.reduce((a,b)=>a+b[1],0)||1;
  const cr=Math.min(dh,dw/2)*0.44,ir=cr*0.55,cx=dw/2,cy=dh/2;
  if(!ca.length){dx.fillStyle="#444";dx.font="12px DM Sans";dx.textAlign="center";dx.fillText("Sin transacciones aún",cx,cy);}
  else{
    let ang=-Math.PI/2;
    ca.forEach(([n,v],i)=>{const s=(v/tot)*Math.PI*2;dx.beginPath();dx.moveTo(cx,cy);dx.arc(cx,cy,cr,ang,ang+s);dx.arc(cx,cy,ir,ang+s,ang,true);dx.closePath();dx.fillStyle=COLS[i%6];dx.fill();ang+=s;});
    const leg=$("dleg");if(leg)leg.innerHTML=ca.map(([n,v],i)=>`<div class="li"><div class="ld" style="background:${COLS[i%6]}"></div><span>${n.substring(0,20)}: ${fmt(v)}</span></div>`).join("");
  }
}

// ── HISTORY ──────────────────────────────────────────────────
// ── HISTORIAL STATE ─────────────────────────────────────────
let _histMonth=new Date().getMonth()+1, _histYear=new Date().getFullYear();

function rHistory(){
  const now=new Date();
  const today=now.getDate();
  const curM=now.getMonth()+1, curY=now.getFullYear();
  const isCurrentMonth=(_histMonth===curM&&_histYear===curY);

  // Get real transactions from history for this month
  const hm=history.find(h=>h.month===_histMonth&&h.year===_histYear);
  const realTxns=(hm?.transactions||[]).map(t=>({
    ...t, date:new Date(_histYear,_histMonth-1,t.day||1),
    source:'real'
  }));

  // Project recurrents into this month (future items)
  const projTxns=[];
  const today_d=new Date(curY,curM-1,today);
  const periodStart=new Date(_histYear,_histMonth-1,1);
  const periodEnd=new Date(_histYear,_histMonth,0);
  entries.filter(e=>['income','variable','monthly','annual','debt','savings'].includes(e.type)).forEach(e=>{
    // Check if this entry occurs in the current period (respects frequency)
    if(!occursInPeriod(e,periodStart,periodEnd)) return;
    const freq=e.frequency||'monthly';
    // For daily/weekly: show once as summary
    const dayNum=e.type==='income'||e.type==='variable'?15:1;
    const txDate=new Date(_histYear,_histMonth-1,dayNum);
    // Only project if not already in real transactions (match by amount)
    const alreadyReal=realTxns.some(r=>Math.abs(r.amount-e.amount)<0.5&&r.type===((['income','variable'].includes(e.type))?'income':'expense'));
    if(alreadyReal&&isCurrentMonth) return;
    const isInc=['income','variable'].includes(e.type);
    const freqLabel=freq!=='monthly'?` (${FREQ[freq]?.label||freq})`:'';
    projTxns.push({
      desc:e.name+freqLabel, amount:e.amount,
      type:isInc?'income':'expense',
      day:dayNum, date:txDate, source:'projected', entryType:e.type
    });
  });

  // Merge and sort all transactions by day
  const allTxns=[...realTxns,...(isCurrentMonth?projTxns:[])].sort((a,b)=>a.day-b.day||(a.source==='real'?-1:1));

  // Running balance for the month
  const prevBal=hm?.balance??0;

  // Build rows
  let rows='', runBal=0;
  if(!allTxns.length){
    rows=`<div class="empty" style="padding:40px 20px;text-align:center">
      <div style="font-size:36px;margin-bottom:8px">🗓</div>
      <div style="font-size:14px;color:#555">Sin movimientos</div>
      <div style="font-size:12px;color:#444;margin-top:4px">Importa un CSV o añade uno manual</div>
    </div>`;
  } else {
    allTxns.forEach(t=>{
      const isReal=t.source==='real';
      const isFuture=t.date>today_d||!isCurrentMonth;
      const isInc=t.type==='income';
      const sign=isInc?1:-1;
      runBal+=sign*t.amount;
      const amtColor=isFuture?(isInc?'#2EE8A5':'#FF6B6B'):(isInc?'#2EE8A5':'#FF6B6B');
      const rowOpacity=isFuture?'opacity:.55;':'';
      const projBadge=!isReal?`<span style="font-size:9px;background:rgba(167,139,250,.15);color:#A78BFA;border-radius:4px;padding:1px 5px;margin-left:4px">proyectado</span>`:'';
      rows+=`<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,.04);${rowOpacity}">
        <div style="width:32px;height:32px;border-radius:10px;background:${isInc?'rgba(46,232,165,.12)':'rgba(255,107,107,.1)'};display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0">
          ${isInc?'↑':'↓'}
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.desc}${projBadge}</div>
          <div style="font-size:11px;color:#555;margin-top:1px">${t.day} ${MF[_histMonth-1]}</div>
        </div>
        <div style="font-family:monospace;font-weight:800;font-size:14px;color:${amtColor};flex-shrink:0">${isInc?'+':'-'}${fmt(t.amount)}</div>
      </div>`;
    });
  }

  // Summary totals
  const totalIn=allTxns.filter(t=>t.type==='income').reduce((a,t)=>a+t.amount,0);
  const totalOut=allTxns.filter(t=>t.type==='expense').reduce((a,t)=>a+t.amount,0);
  const balance=totalIn-totalOut;

  return`
    <!-- Month nav -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <button onclick="histPrevMonth()" style="width:36px;height:36px;border-radius:11px;border:1px solid rgba(255,255,255,.1);background:transparent;color:#aaa;font-size:18px;cursor:pointer;font-family:inherit">‹</button>
      <div style="text-align:center">
        <div style="font-weight:800;font-size:16px">${MF[_histMonth-1]} ${_histYear}</div>
        ${isCurrentMonth?'<div style="font-size:10px;color:#2EE8A5;margin-top:1px">Mes actual</div>':''}
      </div>
      <button onclick="histNextMonth()" style="width:36px;height:36px;border-radius:11px;border:1px solid rgba(255,255,255,.1);background:transparent;color:#aaa;font-size:18px;cursor:pointer;font-family:inherit">›</button>
    </div>

    <!-- Summary cards -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">
      <div class="card" style="padding:12px;text-align:center">
        <div style="font-size:10px;color:#555;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px">Ingresos</div>
        <div style="font-family:monospace;font-weight:800;font-size:13px;color:#2EE8A5">+${fmt(totalIn)}</div>
      </div>
      <div class="card" style="padding:12px;text-align:center">
        <div style="font-size:10px;color:#555;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px">Gastos</div>
        <div style="font-family:monospace;font-weight:800;font-size:13px;color:#FF6B6B">-${fmt(totalOut)}</div>
      </div>
      <div class="card" style="padding:12px;text-align:center">
        <div style="font-size:10px;color:#555;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px">Balance</div>
        <div style="font-family:monospace;font-weight:800;font-size:13px;color:${balance>=0?'#2EE8A5':'#FF6B6B'}">${balance>=0?'+':''}${fmt(balance)}</div>
      </div>
    </div>

    <!-- Transactions list -->
    <div style="padding:0 2px">${rows}</div>
    <div style="height:20px"></div>
  `;
}

function histPrevMonth(){
  _histMonth--;
  if(_histMonth<1){_histMonth=12;_histYear--;}
  $("con").innerHTML=rHistory();
}
function histNextMonth(){
  _histMonth++;
  if(_histMonth>12){_histMonth=1;_histYear++;}
  $("con").innerHTML=rHistory();
}


// ── LIST ─────────────────────────────────────────────────────
function entryCard(e){
  const cat=CATS[e.type]||CATS.expense;
  const isOut=e.type!=="income"&&e.type!=="variable"&&e.type!=="savings";
  const m=e.type==="debt"?(()=>{const cd=computeDebt(e);return cd.monthsLeft;})():null;
  let ed="";if(m){const dt=new Date();dt.setMonth(dt.getMonth()+parseInt(m));ed=` · <span style="color:#A78BFA">termina ${MO[dt.getMonth()]} ${dt.getFullYear()}</span>`;}
  const ab=e.type==="annual"&&e.month?`<span class="abadge">${MF[parseInt(e.month)-1]}</span>`:e.type==="variable"&&e.varMonth?`<span class="abadge" style="background:rgba(0,201,167,.15);color:#00C9A7;border-color:rgba(0,201,167,.3)">${MO[parseInt(e.varMonth)-1]} ${e.varYear||""}</span>`:"";
  return`<div class="ec" onclick="editEntry(${e.id})">
    <div class="ei" style="background:${cat.bg};border:1px solid ${cat.color}33">${cat.icon}</div>
    <div style="flex:1;min-width:0">
      <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${e.name}${ab}</div>
      <div style="font-size:10px;color:#555;margin-top:1px"><span style="color:${cat.color}bb">${cat.label}</span>${e.day?` · día ${e.day}`:""}${ed}</div>
    </div>
    <div>
      <div style="font-family:monospace;font-weight:800;font-size:13px;text-align:right;color:${isOut?"#FF6B6B":"#2EE8A5"}">${e.amount>0?(isOut?"−":"+")+fmt(e.amount):'<span style="font-size:10px;background:rgba(46,232,165,.12);color:#2EE8A5;border-radius:5px;padding:2px 6px;font-family:inherit">keyword</span>'}</div>
      <button class="edel" onclick="event.stopPropagation();delEntry(${e.id})">eliminar</button>
    </div>
  </div>`;
}

function rList(){
  const now=new Date();
  const curM=now.getMonth()+1, curY=now.getFullYear();
  const RECURRENT_TYPES=['income','variable','monthly','annual','debt','savings'];
  const recs=entries.filter(e=>RECURRENT_TYPES.includes(e.type)).sort((a,b)=>{
    const order=['income','variable','monthly','annual','debt','savings'];
    return order.indexOf(a.type)-order.indexOf(b.type);
  });

  // Group by type
  const groups={
    income:{label:'💰 Ingresos fijos',items:[]},
    variable:{label:'💼 Sueldo / Variable',items:[]},
    monthly:{label:'↺ Mensualidades',items:[]},
    annual:{label:'📅 Anualidades',items:[]},
    debt:{label:'⚡ Deudas',items:[]},
    savings:{label:'🏦 Ahorro',items:[]},
  };
  recs.forEach(e=>{ if(groups[e.type]) groups[e.type].items.push(e); });

  // Total monthly commitment
  const totalOut=recs.filter(e=>!['income','variable'].includes(e.type)).reduce((a,e)=>{
    if(e.type==='annual') return a+e.amount/12;
    if(e.type==='debt') return a+e.amount;
    return a+e.amount;
  },0);
  const totalIn=recs.filter(e=>['income','variable'].includes(e.type)).reduce((a,e)=>a+e.amount,0);

  let html='';
  Object.entries(groups).forEach(([type,g])=>{
    if(!g.items.length) return;
    const cfg=CATS[type];
    html+=`<div class="sec" style="margin-top:16px">${g.label}</div>`;
    g.items.forEach(e=>{
      const freq=FREQ[e.frequency||'monthly']||FREQ.monthly;
      const monthly=toMonthly(e);
      const showProrate=e.frequency&&e.frequency!=='monthly'&&e.frequency!=='variable';
      html+=`<div class="ec" onclick="openEntry('${e.id}')">
        <div class="ei" style="background:${cfg.bg}">${cfg.icon}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${e.name}</div>
          <div style="font-size:11px;color:#555;margin-top:1px;display:flex;align-items:center;gap:5px">
            <span>${cfg.label}</span>
            <span style="background:rgba(255,255,255,.07);border-radius:4px;padding:1px 5px;font-size:9px;font-weight:600">${freq.label}</span>
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-family:monospace;font-weight:800;font-size:14px;color:${cfg.color}">${fmt(e.amount)}</div>
          ${showProrate?`<div style="font-size:9px;color:#555;margin-top:1px">${fmt(monthly)}/mes</div>`:''}
        </div>
      </div>`;
    });
  });

  if(!recs.length){
    html=`<div class="empty"><div style="font-size:36px;margin-bottom:8px">📋</div>
      <div style="font-size:14px;color:#555">Sin pagos recurrentes</div>
      <div style="font-size:12px;color:#444;margin-top:4px">Añade ingresos, mensualidades y deudas</div>
    </div>`;
  }

  return`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
      <div style="font-size:11px;font-weight:700;color:#555;letter-spacing:.8px;text-transform:uppercase">Pagos Recurrentes</div>
      <div style="font-size:11px;color:#555">Neto: <span style="font-family:monospace;font-weight:700;color:${totalIn-totalOut>=0?'#2EE8A5':'#FF6B6B'}">${fmt(totalIn-totalOut)}/mes</span></div>
    </div>
    ${html}
    <div style="height:20px"></div>
  `;
}


// ── NAV ──────────────────────────────────────────────────────
function go(t){tab=t;[0,1,2,3,4,5].forEach(i=>{$(`n${i}`)&&($(`n${i}`).className="nb"+(t===i?' active':''));$(`d${i}`)&&($(`d${i}`).style.display=t===i?"block":"none");});render();}
function setF(f){filter=f;render();}

// ── SHEET ────────────────────────────────────────────────────
function buildTG(){const g=$("tg");g.innerHTML="";Object.entries(CATS).forEach(([k,v])=>{const b=document.createElement("button");b.className="tb";b.style.cssText=ctype===k?`border-color:${v.color};background:${v.bg};color:${v.color}`:"";b.innerHTML=`<span style="font-size:14px">${v.icon}</span><span>${v.label}</span>`;b.onclick=()=>{ctype=k;buildTG();updSh();};g.appendChild(b);});}
function updSh(){
  const cat=CATS[ctype];
  const si=$("sico");si.style.cssText=`background:${cat.bg}`;si.textContent=cat.icon;
  const bs=$("bsv");
  const darkText=ctype==="income"||ctype==="variable"||ctype==="savings";
  bs.style.cssText=`background:linear-gradient(135deg,${cat.color},${cat.color}99);color:${darkText?"#001a10":"#fff"};box-shadow:0 8px 24px ${cat.color}44`;
  $("df").style.display=ctype==="debt"?"block":"none";
  $("af").style.display=ctype==="annual"?"block":"none";
  $("vf").style.display=ctype==="variable"?"block":"none";
  $("stf").style.display="none"; // statement config now uses modal
  $("main-amount-row").style.display=ctype==="debt"?"none":"grid";
  $("fixed-toggle").style.display=["income","savings","variable"].includes(ctype)?"none":"flex";
  // Set default varYear to current year when switching to variable
  if(ctype==="variable"&&!$("fvy").value) $("fvy").value=new Date().getFullYear();
  if(ctype==="variable"&&!$("fvm").value) $("fvm").value=new Date().getMonth()+1;
  const showKw=["expense","monthly","annual","debt","savings","variable","income"].includes(ctype);
  if($("kw-hint")) $("kw-hint").style.display=showKw?"block":"none";
  // Hide fixed-toggle for income/variable types (they don't need it)
  if($("fixed-toggle")) $("fixed-toggle").style.display=["income","savings"].includes(ctype)?"none":"flex";
  // Apply default: income = fixed, expense/monthly = fixed, variable = variable amount
  if(!editId){
    setFixed(ctype!=="variable");
  }
}

let _isFixed=true;
function setFixed(val){
  _isFixed=val;
  const yes=$("btn-fixed-yes"), no=$("btn-fixed-no");
  if(!yes||!no) return;
  const activeStyle="background:#2EE8A5;color:#001a10;font-weight:700";
  const inactiveStyle="background:rgba(255,255,255,.06);color:#666;font-weight:400";
  yes.style.cssText=val?activeStyle:inactiveStyle;
  no.style.cssText=!val?activeStyle:inactiveStyle;
  if($("kw-hint")) $("kw-hint").style.display=!val?"block":"none";
  // If variable amount, make keywords field more prominent
  const kwField=$("fkw");
  if(kwField){
    kwField.style.borderColor=!val?"rgba(46,232,165,.4)":"rgba(255,255,255,.1)";
  }
}
function openAddMenu(){
  if(tab===2){
    openSheet('Añadir movimiento',`
      <div style="display:flex;flex-direction:column;gap:10px">
        <button onclick="closeSheet();setTimeout(openSheet,50)" style="padding:16px;border-radius:14px;border:1px solid rgba(46,232,165,.2);background:rgba(46,232,165,.06);color:#f0f0f0;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;text-align:left;display:flex;align-items:center;gap:12px">
          <span style="font-size:24px">✏️</span>
          <div><div style="font-weight:700">Entrada manual</div><div style="font-size:12px;color:#555;margin-top:2px">Añade un ingreso o gasto</div></div>
        </button>
        <button onclick="closeSheet();openImportMenu()" style="padding:16px;border-radius:14px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);color:#f0f0f0;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;text-align:left;display:flex;align-items:center;gap:12px">
          <span style="font-size:24px">📂</span>
          <div><div style="font-weight:700">Importar CSV</div><div style="font-size:12px;color:#555;margin-top:2px">Importa el extracto de tu banco</div></div>
        </button>
      </div>
    `);
  } else if(tab===5){
    openAddInv('stock');
  } else if(tab===6){
    openAddInv('crypto');
  } else {
    openSheet();
  }
}
function openImportMenu(){
  if(!accounts.length){
    openSheet('Importar CSV',`
      <div style="text-align:center;padding:20px 0">
        <div style="font-size:36px;margin-bottom:12px">🏦</div>
        <div style="font-weight:700;margin-bottom:8px">Sin cuentas configuradas</div>
        <div style="font-size:13px;color:#555;margin-bottom:20px">Ve a la pestaña Cuentas para añadir una cuenta antes de importar</div>
        <button onclick="closeSheet();go(4)" style="padding:12px 24px;border-radius:12px;border:none;background:linear-gradient(135deg,#2EE8A5,#0097a7);color:#001a10;font-weight:800;cursor:pointer;font-family:inherit">Ir a Cuentas →</button>
      </div>
    `);
    return;
  }
  const btns=accounts.map(a=>{
    const cfg=ACCT_TYPES[a.type]||ACCT_TYPES.checking;
    return`<button onclick="closeSheet();openCsvImport(${a.id})" style="padding:14px;border-radius:13px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);color:#f0f0f0;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;text-align:left;display:flex;align-items:center;gap:12px">
      <span style="font-size:22px">${cfg.icon}</span>
      <div><div style="font-weight:700">${a.name}</div><div style="font-size:11px;color:#555;margin-top:1px">${cfg.label}</div></div>
    </button>`;
  }).join('');
  openSheet('Selecciona cuenta',`<div style="display:flex;flex-direction:column;gap:8px">${btns}</div>`);
}

function openSheet(){editId=null;ctype="expense";$("sttl").textContent="Nuevo registro";["fn","fa","fa2","fd","fr","fq","fi","fkw","fno","f-tax-rate","f-penalty-rate","f-adjustment","f-stmt-kw","fd-orig","fd-total","fd-date","fd-terms","fd-fixed-end"].forEach(id=>$(id)&&($(id).value=""));_isFixed=true;$("f-stmt-month")&&($("f-stmt-month").value=new Date().getMonth()+1);$("f-stmt-year")&&($("f-stmt-year").value=new Date().getFullYear());if($("debt-preview"))$("debt-preview").style.display="none";$("fvm").value=new Date().getMonth()+1;$("fvy").value=new Date().getFullYear();$("fd").value=new Date().getDate();$("fm").value=new Date().getMonth()+1;buildTG();updSh();$("ov").classList.add("open");setTimeout(()=>$("sh").classList.add("open"),20);}
function editEntry(id){const e=entries.find(x=>x.id===id);if(!e)return;editId=id;ctype=e.type;$("sttl").textContent="Editar registro";buildTG();updSh();$("fn").value=e.name||"";$("fa").value=e.amount||"";$("fa2").value=e.amount||"";$("fd").value=e.day||"";$("fr").value=e.remaining||"";$("fq").value=e.quarterlyCharge||"";if($("fd-known-charge"))$("fd-known-charge").value=e.knownCharge||"";if($("fd-known-balance"))$("fd-known-balance").value=e.knownBalance||"";if($("fd-effective-rate"))$("fd-effective-rate").value=e.effectiveRate||"";if(e.effectiveRate&&$("fd-effective-rate-display")){$("fd-effective-rate-display").style.display="block";$("fd-effective-rate-display").textContent="Tasa efectiva guardada: "+(parseFloat(e.effectiveRate)*100).toFixed(4)+"%";};$("fi").value=e.interestRate||"";$("fm").value=e.month||new Date().getMonth()+1;$("fvm").value=e.varMonth||new Date().getMonth()+1;$("fvy").value=e.varYear||new Date().getFullYear();$("fkw").value=e.keywords||"";$("fno").value=e.note||"";if($("f-freq"))$("f-freq").value=e.frequency||"monthly";setFixed(e.fixedAmount!==false);if($("fd-orig"))$("fd-orig").value=e.origAmount||"";if($("fd-total"))$("fd-total").value=e.totalAmount||"";if($("fd-date"))$("fd-date").value=e.startDate||"";if($("fd-terms"))$("fd-terms").value=e.totalTerms||"";if($("fd-fixed-end"))$("fd-fixed-end").value=e.fixedRateEnd||"";if($("debt-preview"))$("debt-preview").style.display="none";if(e.type==="debt")setTimeout(calcDebtPreview,50);if($("f-tax-rate"))$("f-tax-rate").value=e.taxRate||"";if($("f-penalty-rate"))$("f-penalty-rate").value=e.penaltyRate||"";if($("f-adjustment"))$("f-adjustment").value=e.adjustment||"";if($("f-stmt-month"))$("f-stmt-month").value=e.stmtMonth||new Date().getMonth()+1;if($("f-stmt-year"))$("f-stmt-year").value=e.stmtYear||new Date().getFullYear();if($("f-stmt-kw"))$("f-stmt-kw").value=e.stmtKeywords||"";$("ov").classList.add("open");setTimeout(()=>$("sh").classList.add("open"),20);}
function closeSheet(){$("sh").classList.remove("open");setTimeout(()=>$("ov").classList.remove("open"),300);}
function bgc(e){if(e.target===$("ovbg"))closeSheet();}
async function saveEntry(){
  const name=$("fn").value.trim();
  if(!name){bnr("error","Completa el nombre");return;}
  // For debts use fa2 (cuota mensual) as the amount, fa is hidden
  const isDebt=ctype==="debt";
  // Show frequency for recurrent types, hide for one-off expenses
  const showFreq=['income','variable','monthly','annual','debt','savings'].includes(ctype);
  if($('f-freq-row')) $('f-freq-row').style.display=showFreq?'block':'none';
  const amount=isDebt?(parseFloat($("fa2").value)||parseFloat($("fa").value)||0):(parseFloat($("fa").value)||0);
  // Amount 0 is allowed for variable-amount entries matched by keyword only
  const entry={
    id:editId||Date.now(),name,type:ctype,amount,
    day:parseInt($("fd").value)||1,
    origAmount:ctype==="debt"?(parseFloat($("fd-orig")&&$("fd-orig").value)||""):"",
    totalAmount:ctype==="debt"?(parseFloat($("fd-total")&&$("fd-total").value)||""):"",
    startDate:ctype==="debt"?($("fd-date")&&$("fd-date").value||""):"",
    totalTerms:ctype==="debt"?(parseInt($("fd-terms")&&$("fd-terms").value)||0):0,
    fixedRateEnd:ctype==="debt"?($("fd-fixed-end")&&$("fd-fixed-end").value||""):"",
    remaining:parseFloat($("fr").value)||"",
    quarterlyCharge:parseFloat($("fq").value)||"",
    effectiveRate:parseFloat($("fd-effective-rate")&&$("fd-effective-rate").value)||"",
    knownCharge:parseFloat($("fd-known-charge")&&$("fd-known-charge").value)||"",
    knownBalance:parseFloat($("fd-known-balance")&&$("fd-known-balance").value)||"",
    interestRate:parseFloat($("fi").value)||"",
    month:parseInt($("fm").value)||new Date().getMonth()+1,
    varMonth:ctype==="variable"?(parseInt($("fvm").value)||new Date().getMonth()+1):"",
    varYear:ctype==="variable"?(parseInt($("fvy").value)||new Date().getFullYear()):"",
    fixedAmount:amount>0?_isFixed:false,
    keywords:$("fkw").value.trim().toLowerCase(),
    taxRate:ctype==="statement"?(parseFloat($("f-tax-rate")&&$("f-tax-rate").value)||0):0,
    penaltyRate:ctype==="statement"?(parseFloat($("f-penalty-rate")&&$("f-penalty-rate").value)||0):0,
    adjustment:ctype==="statement"?(parseFloat($("f-adjustment")&&$("f-adjustment").value)||0):0,
    stmtMonth:ctype==="statement"?(parseInt($("f-stmt-month")&&$("f-stmt-month").value)||new Date().getMonth()+1):0,
    stmtYear:ctype==="statement"?(parseInt($("f-stmt-year")&&$("f-stmt-year").value)||new Date().getFullYear()):0,
    stmtKeywords:ctype==="statement"?($("f-stmt-kw")&&$("f-stmt-kw").value.trim().toLowerCase()||""):"",  
    note:$("fno").value.trim()
  };
  if(editId){
    const i=entries.findIndex(e=>e.id===editId);
    if(i>=0)entries[i]=entry;
  } else {
    // For statement type: replace existing entry for same month/year if exists
    if(ctype==="statement"&&entry.stmtMonth&&entry.stmtYear){
      const existing=entries.findIndex(e=>
        e.type==="statement"&&
        parseInt(e.stmtMonth)===entry.stmtMonth&&
        parseInt(e.stmtYear)===entry.stmtYear
      );
      if(existing>=0){entries[existing]=entry;}
      else entries.push(entry);
    } else {
      entries.push(entry);
    }
  }
  retagHistory();closeSheet();render();await push();
}
async function delEntry(id){if(!confirm("¿Eliminar este registro?"))return;entries=entries.filter(e=>e.id!==id);retagHistory();render();await push();}

// ── INIT ─────────────────────────────────────────────────────
// ── THEME ────────────────────────────────────────────────────
function applyTheme(t){
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('fc_theme', t);
}
function toggleTheme(){
  const cur=localStorage.getItem('fc_theme')||'dark';
  const next=cur==='dark'?'light':'dark';
  applyTheme(next);
  // Re-render the menu to update switch state
  const menu=$('user-menu');
  if(menu){menu.remove();_menuOpen=false;toggleUserMenu();}
}
function initTheme(){
  const saved=localStorage.getItem('fc_theme')||'dark';
  applyTheme(saved);
}
initTheme();

// ── USER MENU ────────────────────────────────────────────────
let _menuOpen=false;
function toggleUserMenu(){
  _menuOpen=!_menuOpen;
  let menu=$('user-menu');
  if(!menu){
    menu=document.createElement('div');
    menu.id='user-menu';
    menu.style.cssText=`
      position:fixed;top:60px;right:16px;z-index:999;
      background:#1a2030;border:1px solid rgba(255,255,255,.1);
      border-radius:16px;padding:8px;min-width:200px;
      box-shadow:0 16px 48px rgba(0,0,0,.5);
    `;
    const curTheme=localStorage.getItem('fc_theme')||'dark';
    const isLight=curTheme==='light';
    menu.innerHTML=`
      <div style="padding:10px 12px 8px;border-bottom:1px solid rgba(255,255,255,.06);margin-bottom:6px">
        <div style="font-size:13px;font-weight:700;color:#f0f0f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${_user?.user_metadata?.full_name||_user?.user_metadata?.name||_user?.email||'Usuario'}
        </div>
        <div style="font-size:11px;color:#555;margin-top:1px">${_user?.email||''}</div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:10px">
        <div style="display:flex;align-items:center;gap:8px;font-size:13px;color:#aaa">
          <span>${isLight?'☀️':'🌙'}</span>
          <span>${isLight?'Modo claro':'Modo oscuro'}</span>
        </div>
        <div onclick="toggleTheme()" id="theme-switch"
          style="width:44px;height:24px;border-radius:99px;cursor:pointer;position:relative;transition:background .2s;
          background:${isLight?'#2EE8A5':'rgba(255,255,255,.12)'}">
          <div style="position:absolute;top:3px;left:${isLight?'23px':'3px'};width:18px;height:18px;border-radius:50%;
            background:#fff;transition:left .2s;box-shadow:0 1px 4px rgba(0,0,0,.3)"></div>
        </div>
      </div>
      <div style="height:1px;background:rgba(255,255,255,.06);margin:2px 0 6px"></div>
      <button onclick="signOut()" style="width:100%;padding:10px 12px;border-radius:10px;border:none;background:transparent;color:#FF6B6B;font-size:13px;text-align:left;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:10px">
        ↩ <span>Cerrar sesión</span>
      </button>
    `;
    document.body.appendChild(menu);
    // Close on outside click
    setTimeout(()=>document.addEventListener('click', closeUserMenuOutside), 10);
  } else {
    menu.style.display=_menuOpen?'block':'none';
    if(_menuOpen) setTimeout(()=>document.addEventListener('click', closeUserMenuOutside), 10);
  }
}
function closeUserMenu(){
  _menuOpen=false;
  const menu=$('user-menu');
  if(menu) menu.style.display='none';
  document.removeEventListener('click', closeUserMenuOutside);
}
function closeUserMenuOutside(e){
  if(!e.target.closest('#user-menu')&&!e.target.closest('[title]')) closeUserMenu();
}
function signOut(){
  const sb=getSupabase();
  if(sb) sb.auth.signOut().then(()=>window.location.href='landing.html');
  else window.location.href='landing.html';
}

(async()=>{
  // ── AUTH CHECK ──────────────────────────────────────────────
  const sb=getSupabase();
  if(sb){
    const{data:{session}}=await sb.auth.getSession();
    if(!session){
      // Not logged in — redirect to landing
      window.location.href=window.location.pathname.replace('index.html','')+'landing.html';
      return;
    }
    _user=session.user;
    // Show user info in header
    const name=_user.user_metadata?.full_name||_user.user_metadata?.name||_user.email||'';
    const avatar=_user.user_metadata?.avatar_url||'';
    const hright=$("hright");
    if(hright){
      const userEl=document.createElement("div");
      userEl.style.cssText="display:flex;align-items:center;gap:8px;cursor:pointer;";
      userEl.innerHTML=avatar
        ?`<img src="${avatar}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;border:2px solid rgba(46,232,165,.3)" />`
        :`<div style="width:32px;height:32px;border-radius:50%;background:rgba(46,232,165,.2);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#2EE8A5">${(name[0]||'U').toUpperCase()}</div>`;
      userEl.title=name;
      userEl.onclick=(e)=>{e.stopPropagation();toggleUserMenu();};
      hright.insertBefore(userEl, hright.firstChild);
    }
    // Listen for auth changes
    sb.auth.onAuthStateChange((event)=>{
      if(event==='SIGNED_OUT') window.location.href='landing.html';
    });
  }

  const s=lc();entries=s.entries;history=s.history;revolut=s.revolut||[];investments=s.investments||[];savings_account=s.savings_account||[];accounts=s.accounts||[];if(s.stmtConfig)Object.assign(stmtConfig,s.stmtConfig);retagHistory();render();$("d0").style.display="block";["d1","d2","d3","d4","d5","d6","d7"].forEach(id=>$(id)&&($(id).style.display="none"));
  // PWA install banner
  let _deferredPrompt=null;
  window.addEventListener('beforeinstallprompt',e=>{
    e.preventDefault();_deferredPrompt=e;
    const b=document.createElement('div');
    b.style.cssText='position:fixed;bottom:76px;left:50%;transform:translateX(-50%);background:linear-gradient(135deg,#2EE8A5,#0097a7);color:#001a10;padding:11px 22px;border-radius:99px;font-size:13px;font-weight:700;cursor:pointer;z-index:300;box-shadow:0 4px 20px rgba(46,232,165,.5);white-space:nowrap;font-family:inherit;animation:fadeIn .3s ease';
    b.textContent='📲 Instalar FinControl';
    b.onclick=async()=>{if(_deferredPrompt){_deferredPrompt.prompt();_deferredPrompt=null;b.remove();}};
    document.body.appendChild(b);setTimeout(()=>{if(b.parentNode)b.remove();},9000);
  });
  await syncNow();})();

// ── REVOLUT PARSER ──────────────────────────────────────────
// Internal transfer patterns — these are moves between your own accounts
const REVOLUT_INTERNAL = [
  /recarga con open banking/i,
  /recarga de \*/i,
  /a cuenta de inversi[oó]n/i,
  /to fondos monetarios/i,
  /desde eur fondos monetarios/i,
  /fondos monetarios flexibles/i,
  /savings vault/i,
  /from investment account/i,
  /to miguel garcia/i,
  /miguel alejandro garcia/i,
];

function isRevolutInternal(desc){
  return REVOLUT_INTERNAL.some(re=>re.test(desc));
}

function importRevolutCSV(text){
  const lines=text.trim().split(/\r?\n/).filter(l=>l.trim());
  if(lines.length<2) return null;
  // CSV has header: Tipo,Producto,Fecha de inicio,Fecha de finalización,Descripción,Importe,Comisión,Divisa,State,Saldo
  const sep=",";
  const headers=lines[0].split(sep).map(h=>h.trim().replace(/^"|"$/g,"").toLowerCase()
    .replace("fecha de inicio","date").replace("descripción","desc").replace("importe","amount")
    .replace("divisa","currency").replace("saldo","balance").replace("tipo","type")
    .replace("state","state").replace("comisión","fee"));

  const monthMap={};

  lines.slice(1).forEach(line=>{
    // Handle quoted fields with commas inside
    const cols=[];let cur="",inQ=false;
    for(let i=0;i<line.length;i++){
      if(line[i]==='"'){inQ=!inQ;}
      else if(line[i]===","&&!inQ){cols.push(cur.trim());cur="";}
      else cur+=line[i];
    }
    cols.push(cur.trim());

    const row={};
    headers.forEach((h,i)=>{row[h]=cols[i]||"";});

    const dateStr=(row.date||"").substring(0,10); // YYYY-MM-DD
    const dp=dateStr.split("-");
    if(dp.length<3) return;
    const year=parseInt(dp[0]),month=parseInt(dp[1]),day=parseInt(dp[2]);
    if(!year||!month) return;

    const desc=row.desc||"";
    const rawAmt=row.amount||"0";
    const amount=parseFloat(rawAmt)||0;
    const balance=parseFloat(row.balance)||0;
    const state=(row.state||"").toLowerCase();
    if(state==="fallido"||state==="failed"||state==="revertido") return;

    const internal=isRevolutInternal(desc);
    const key=year+"-"+month;

    if(!monthMap[key]) monthMap[key]={year,month,income:0,expenses:0,balance:0,transactions:[],lastBalance:0};

    monthMap[key].lastBalance=balance; // will be overwritten until last row (sorted oldest→newest)

    monthMap[key].transactions.push({
      desc:desc.substring(0,50),
      amount:Math.abs(amount),
      type:amount>=0?"income":"expense",
      day,internal
    });

    if(!internal){
      if(amount>0) monthMap[key].income+=amount;
      else monthMap[key].expenses+=Math.abs(amount);
    }
  });

  // Sort transactions within each month newest first, compute balance as last known
  const results=Object.values(monthMap).map(m=>({
    id:Date.now()+m.year*100+m.month+Math.random(),
    year:m.year,month:m.month,
    income:Math.round(m.income*100)/100,
    expenses:Math.round(m.expenses*100)/100,
    balance:Math.round(m.lastBalance*100)/100,
    transactions:m.transactions.sort((a,b)=>b.day-a.day)
  }));

  return results.length?results:null;
}

// ── INVESTMENTS ──────────────────────────────────────────────
// ── PRICE FETCHING — Finnhub (no CORS, free) ─────────────────
// Finnhub free key — public demo key, works without registration
const FINNHUB_KEY="demo";

// Map Yahoo-style tickers to Finnhub format
function toFinnhubTicker(ticker){
  const t=ticker.toUpperCase();
  // Finnhub uses : for exchange prefix for non-US stocks
  const exchangeMap={
    ".VI":"WBAG:",  // Vienna
    ".DE":"XETRA:", // XETRA Germany
    ".L":"LSE:",    // London
    ".PA":"EPA:",   // Paris
    ".MI":"BIT:",   // Milan
    ".AS":"AMS:",   // Amsterdam
    ".SW":"SWX:",   // Switzerland
  };
  for(const[suffix,prefix]of Object.entries(exchangeMap)){
    if(t.endsWith(suffix)){
      return prefix+t.slice(0,-suffix.length);
    }
  }
  // Crypto: BTC-USD -> BINANCE:BTCUSDT or use Finnhub crypto format
  if(t.endsWith("-USD")){
    const coin=t.replace("-USD","");
    return`BINANCE:${coin}USDT`;
  }
  return t; // US stocks as-is
}

// Fallback: use exchangerate.host for EUR conversion (free, no key)
async function fetchEURRatePublic(currency){
  if(!currency||currency==="EUR") return 1;
  if(currency==="GBp"||currency==="GBX") return(await fetchEURRatePublic("GBP"))/100;
  try{
    const res=await fetch(`https://api.exchangerate-api.com/v4/latest/EUR`,{signal:AbortSignal.timeout(5000)});
    const data=await res.json();
    const rate=data?.rates?.[currency];
    return rate?1/rate:null;
  }catch{}
  // Static fallbacks
  const f={USD:0.92,GBP:1.17,CHF:1.05,JPY:0.0062,CAD:0.68,AUD:0.58,SEK:0.086,NOK:0.085,DKK:0.134};
  return f[currency]||null;
}

async function fetchPriceFromFinnhub(ticker){
  const fhTicker=toFinnhubTicker(ticker);
  try{
    const url=`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(fhTicker)}&token=${FINNHUB_KEY}`;
    const res=await fetch(url,{signal:AbortSignal.timeout(8000)});
    if(!res.ok) return null;
    const data=await res.json();
    // Finnhub returns {c: currentPrice, h, l, o, pc}
    if(data?.c&&data.c>0){
      // Determine currency from exchange
      let currency="USD";
      if(fhTicker.startsWith("WBAG:")) currency="EUR";
      else if(fhTicker.startsWith("XETRA:")) currency="EUR";
      else if(fhTicker.startsWith("BIT:")) currency="EUR";
      else if(fhTicker.startsWith("EPA:")) currency="EUR";
      else if(fhTicker.startsWith("AMS:")) currency="EUR";
      else if(fhTicker.startsWith("SWX:")) currency="CHF";
      else if(fhTicker.startsWith("LSE:")) currency="GBp";
      return{price:data.c,currency};
    }
  }catch(e){console.warn("Finnhub failed:",e.message);}
  return null;
}

async function fetchPriceFromYahooProxy(ticker){
  // Keep as fallback with single best proxy
  const proxies=[
    `https://corsproxy.io/?${encodeURIComponent(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`)}`,
    `https://api.allorigins.win/get?url=${encodeURIComponent(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`)}`,
  ];
  for(const url of proxies){
    try{
      const res=await fetch(url,{signal:AbortSignal.timeout(6000)});
      if(!res.ok) continue;
      const raw=await res.json();
      const data=raw.contents?JSON.parse(raw.contents):raw;
      const result=data?.chart?.result?.[0];
      if(!result) continue;
      const price=result.meta?.regularMarketPrice||result.meta?.previousClose;
      const currency=result.meta?.currency||"USD";
      if(price) return{price,currency};
    }catch{}
  }
  return null;
}

// CoinGecko ID map for common cryptos
const COINGECKO_IDS={
  BTC:'bitcoin',ETH:'ethereum',SOL:'solana',BNB:'binancecoin',
  XRP:'ripple',ADA:'cardano',DOGE:'dogecoin',DOT:'polkadot',
  AVAX:'avalanche-2',MATIC:'matic-network',LINK:'chainlink',
  LTC:'litecoin',UNI:'uniswap',ATOM:'cosmos',XLM:'stellar',
  ALGO:'algorand',NEAR:'near',TON:'the-open-network',
  SHIB:'shiba-inu',TRX:'tron',OP:'optimism',ARB:'arbitrum',
};

function cgId(ticker){
  const t=(ticker||'').toUpperCase().replace(/-?(USD|EUR|USDT|USDC)$/i,'').trim();
  return COINGECKO_IDS[t]||t.toLowerCase();
}

async function fetchPriceFromCoinGecko(ticker){
  try{
    const id=cgId(ticker);
    const res=await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=eur`,
      {signal:AbortSignal.timeout(7000)}
    );
    if(!res.ok) return null;
    const d=await res.json();
    const price=d[id]?.eur;
    return price?{price,currency:'EUR'}:null;
  }catch{return null;}
}

// Full cascade: Finnhub → Yahoo → CoinGecko → null (manual fallback)
async function fetchPrice(ticker, assetType){
  const t=(ticker||'').toUpperCase();
  const r1=await fetchPriceFromFinnhub(t);
  if(r1?.price) return r1;
  const r2=await fetchPriceFromYahooProxy(t);
  if(r2?.price) return r2;
  // Finnhub crypto suffix attempt
  if(!t.includes('-')&&!t.includes(':')){
    const r3=await fetchPriceFromFinnhub(t+'-USD');
    if(r3?.price) return r3;
  }
  // CoinGecko for crypto
  if(assetType==='crypto'){
    const r4=await fetchPriceFromCoinGecko(t);
    if(r4?.price) return r4;
    // Try base ticker without suffix
    const base=t.replace(/-?(USD|EUR|USDT|USDC)$/i,'');
    if(base!==t){
      const r5=await fetchPriceFromCoinGecko(base);
      if(r5?.price) return r5;
    }
  }
  return null; // All failed — caller uses manualPrice
}

async function fetchEURRate(currency){
  return fetchEURRatePublic(currency);
}

// ── PATRIMONIO TAB ────────────────────────────────────────────
// ── SAVINGS PROJECTION ENGINE ────────────────────────────────

// Convert interestFreq to annual periods (how many times per year interest compounds)
function freqToPeriodsPerYear(freq){
  const map={daily:365,weekly:52,biweekly:26,monthly:12,quarterly:4,biannual:2,annual:1};
  return map[freq]||12;
}

// Project savings balance over N months given:
//   balance0: starting balance
//   annualRate: % per year (e.g. 3.5)
//   freq: compounding frequency string
//   monthlyDeposit: recurring deposit per month
function projectSavings(balance0, annualRate, freq, monthlyDeposit, months){
  const n=freqToPeriodsPerYear(freq);
  const rPeriod=annualRate/100/n;
  const periodsPerMonth=n/12;
  let bal=balance0;
  const points=[{month:0,balance:bal}];
  for(let m=1;m<=months;m++){
    bal+=monthlyDeposit;
    // Compound for periodsPerMonth periods
    bal=bal*Math.pow(1+rPeriod,periodsPerMonth);
    points.push({month:m,balance:Math.round(bal*100)/100});
  }
  return points;
}

// Get monthly deposit from savings entries linked to this account
function getSavingsDeposit(accountId){
  return entries
    .filter(e=>e.type==='savings'&&(!accountId||String(e.accountId)===String(accountId)))
    .reduce((a,e)=>a+toMonthly(e),0);
}

// ── SAVINGS TAB STATE ─────────────────────────────────────────
let _savAccId=null; // which savings account is shown
let _savHorizon=12; // months to project (6/12/36/60)

function rSavingsAccount(acctId){
  _savAccId=acctId;
  const a=accounts.find(x=>String(x.id)===String(acctId));
  if(!a){$("con").innerHTML='<div class="empty"><div style="font-size:36px">⚠️</div><div>Cuenta no encontrada</div></div>';return;}

  const isVar=a.rateType==='variable';
  const rateAvg=a.interestRate||0;
  const rateMin=isVar?(a.interestRateMin||0):rateAvg;
  const rateMax=isVar?(a.interestRateMax||0):rateAvg;
  const freq=a.interestFreq||'monthly';
  const balance0=a.currentBalance||0;
  const monthlyDep=getSavingsDeposit(acctId);

  // Project for all horizons
  const horizons=[6,12,36,60];
  const maxMonths=60;

  // Build projection data for chart
  const projMin=projectSavings(balance0,rateMin,freq,monthlyDep,maxMonths);
  const projAvg=projectSavings(balance0,rateAvg,freq,monthlyDep,maxMonths);
  const projMax=projectSavings(balance0,rateMax,freq,monthlyDep,maxMonths);

  // Horizon selector
  const hBtns=horizons.map(h=>`
    <button onclick="_savHorizon=${h};rSavingsAccount('${acctId}')"
      style="flex:1;padding:8px 4px;border-radius:10px;border:1.5px solid ${_savHorizon===h?'#38BDF8':'rgba(255,255,255,.08)'};
      background:${_savHorizon===h?'rgba(56,189,248,.15)':'transparent'};
      color:${_savHorizon===h?'#38BDF8':'#555'};font-size:12px;font-weight:${_savHorizon===h?700:400};
      cursor:pointer;font-family:inherit">
      ${h===6?'6m':h===12?'1a':h===36?'3a':'5a'}
    </button>`).join('');

  // Summary cards for selected horizon
  const hIdx=_savHorizon;
  const valMin=projMin[hIdx]?.balance||0;
  const valAvg=projAvg[hIdx]?.balance||0;
  const valMax=projMax[hIdx]?.balance||0;
  const gainMin=valMin-balance0;
  const gainAvg=valAvg-balance0;
  const gainMax=valMax-balance0;

  // Table: show at 6m, 1y, 3y, 5y milestones
  const tableRows=horizons.map(h=>`
    <tr>
      <td style="padding:8px 10px;color:#555;font-size:12px">${h===6?'6 meses':h===12?'1 año':h===36?'3 años':'5 años'}</td>
      <td style="padding:8px 10px;font-family:monospace;font-size:12px;color:${isVar?'#FF6B6B':'#38BDF8'};text-align:right">${isVar?fmt(projMin[h]?.balance||0):'—'}</td>
      <td style="padding:8px 10px;font-family:monospace;font-size:12px;color:#38BDF8;text-align:right;font-weight:700">${fmt(projAvg[h]?.balance||0)}</td>
      <td style="padding:8px 10px;font-family:monospace;font-size:12px;color:${isVar?'#2EE8A5':'#38BDF8'};text-align:right">${isVar?fmt(projMax[h]?.balance||0):'—'}</td>
    </tr>`).join('');

  $("con").innerHTML=`
    <!-- Header -->
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
      <button onclick="go(4)" style="width:32px;height:32px;border-radius:9px;border:1px solid rgba(255,255,255,.1);background:transparent;color:#aaa;font-size:15px;cursor:pointer;font-family:inherit">←</button>
      <div>
        <div style="font-weight:900;font-size:18px;letter-spacing:-.3px">${a.name}</div>
        <div style="font-size:11px;color:#555;margin-top:1px">${isVar?'Tasa variable '+a.interestRateMin+'%–'+a.interestRateMax+'%':'Tasa fija '+rateAvg+'%'} · ${(freqToPeriodsPerYear(freq)===365?'Diaria':freqToPeriodsPerYear(freq)===12?'Mensual':freq)} liquidación</div>
      </div>
    </div>

    <!-- Balance card -->
    <div class="card" style="background:linear-gradient(135deg,rgba(56,189,248,.1),rgba(0,151,167,.06));margin-bottom:14px">
      <div style="font-size:10px;color:#38BDF8;font-weight:700;letter-spacing:.8px;text-transform:uppercase;margin-bottom:6px">Saldo actual</div>
      <div style="font-family:monospace;font-weight:900;font-size:28px;letter-spacing:-1px;color:#38BDF8">${fmt(balance0)}</div>
      <div style="font-size:11px;color:#555;margin-top:4px">Depósito recurrente: ${fmt(monthlyDep)}/mes</div>
    </div>

    <!-- Horizon selector -->
    <div style="display:flex;gap:6px;margin-bottom:14px">${hBtns}</div>

    <!-- Projection summary cards -->
    <div style="display:grid;grid-template-columns:${isVar?'1fr 1fr 1fr':'1fr'};gap:8px;margin-bottom:16px">
      ${isVar?`
      <div class="card" style="padding:12px;text-align:center">
        <div style="font-size:9px;color:#FF6B6B;font-weight:700;letter-spacing:.5px;text-transform:uppercase;margin-bottom:4px">Mínimo</div>
        <div style="font-family:monospace;font-weight:800;font-size:14px;color:#FF6B6B">${fmt(valMin)}</div>
        <div style="font-size:10px;color:#555;margin-top:2px">+${fmt(gainMin)}</div>
      </div>`:''}
      <div class="card" style="padding:12px;text-align:center;${isVar?'':'background:rgba(56,189,248,.08);border-color:rgba(56,189,248,.2)'}">
        <div style="font-size:9px;color:#38BDF8;font-weight:700;letter-spacing:.5px;text-transform:uppercase;margin-bottom:4px">${isVar?'Promedio':'Proyectado'}</div>
        <div style="font-family:monospace;font-weight:800;font-size:${isVar?14:20}px;color:#38BDF8">${fmt(valAvg)}</div>
        <div style="font-size:10px;color:#555;margin-top:2px">+${fmt(gainAvg)}</div>
      </div>
      ${isVar?`
      <div class="card" style="padding:12px;text-align:center">
        <div style="font-size:9px;color:#2EE8A5;font-weight:700;letter-spacing:.5px;text-transform:uppercase;margin-bottom:4px">Máximo</div>
        <div style="font-family:monospace;font-weight:800;font-size:14px;color:#2EE8A5">${fmt(valMax)}</div>
        <div style="font-size:10px;color:#555;margin-top:2px">+${fmt(gainMax)}</div>
      </div>`:''}
    </div>

    <!-- Chart -->
    <div class="cwrap" style="margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:#555;letter-spacing:.5px;text-transform:uppercase;margin-bottom:12px">Proyección de crecimiento</div>
      <canvas id="c-savings-proj" style="width:100%;height:200px"></canvas>
      <div style="display:flex;gap:14px;margin-top:10px;flex-wrap:wrap">
        ${isVar?`<div style="display:flex;align-items:center;gap:5px"><div style="width:8px;height:8px;border-radius:50%;background:#FF6B6B"></div><span style="font-size:10px;color:#555">Mínimo</span></div>`:''}
        <div style="display:flex;align-items:center;gap:5px"><div style="width:8px;height:8px;border-radius:50%;background:#38BDF8"></div><span style="font-size:10px;color:#555">${isVar?'Promedio':'Proyectado'}</span></div>
        ${isVar?`<div style="display:flex;align-items:center;gap:5px"><div style="width:8px;height:8px;border-radius:50%;background:#2EE8A5"></div><span style="font-size:10px;color:#555">Máximo</span></div>`:''}
      </div>
    </div>

    <!-- Table -->
    <div class="cwrap">
      <div style="font-size:11px;font-weight:700;color:#555;letter-spacing:.5px;text-transform:uppercase;margin-bottom:10px">Resumen por hito</div>
      <table class="ftable" style="width:100%">
        <thead>
          <tr>
            <th>Plazo</th>
            ${isVar?'<th style="text-align:right;color:#FF6B6B">Mín</th>':''}
            <th style="text-align:right;color:#38BDF8">${isVar?'Prom':'Balance'}</th>
            ${isVar?'<th style="text-align:right;color:#2EE8A5">Máx</th>':''}
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    <div style="height:20px"></div>
  `;

  // Draw chart
  setTimeout(()=>drawSavingsProjectionChart(projMin,projAvg,projMax,isVar,_savHorizon),50);
}

function drawSavingsProjectionChart(projMin,projAvg,projMax,isVar,months){
  const canvas=$('c-savings-proj');
  if(!canvas) return;
  const ctx=canvas.getContext('2d');
  const W=canvas.parentElement?.clientWidth||300;
  canvas.width=W;canvas.height=200;
  ctx.clearRect(0,0,W,200);

  // Only draw up to selected horizon
  const data=projAvg.slice(0,months+1);
  const minData=projMin.slice(0,months+1);
  const maxData=projMax.slice(0,months+1);
  const n=data.length;
  if(n<2) return;

  const allVals=[...data,...minData,...maxData].map(p=>p.balance);
  const vMin=Math.min(...allVals)*0.99;
  const vMax=Math.max(...allVals)*1.01;
  const pad={t:10,r:10,b:30,l:55};
  const W2=W-pad.l-pad.r;
  const H2=200-pad.t-pad.b;

  const xOf=i=>pad.l+(i/(n-1))*W2;
  const yOf=v=>pad.t+H2-(((v-vMin)/(vMax-vMin))*H2);

  // Grid lines
  ctx.strokeStyle='rgba(255,255,255,.05)';ctx.lineWidth=1;
  for(let i=0;i<=4;i++){
    const y=pad.t+(i/4)*H2;
    ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(pad.l+W2,y);ctx.stroke();
    const val=vMax-(i/4)*(vMax-vMin);
    ctx.fillStyle='#444';ctx.font='9px sans-serif';ctx.textAlign='right';
    ctx.fillText('€'+Math.round(val/100)*100,pad.l-4,y+3);
  }

  // Draw shaded area between min and max
  if(isVar){
    ctx.beginPath();
    maxData.slice(0,n).forEach((p,i)=>i===0?ctx.moveTo(xOf(i),yOf(p.balance)):ctx.lineTo(xOf(i),yOf(p.balance)));
    minData.slice(0,n).reverse().forEach((p,i)=>ctx.lineTo(xOf(n-1-i),yOf(p.balance)));
    ctx.closePath();
    ctx.fillStyle='rgba(56,189,248,.08)';ctx.fill();
  }

  // Draw lines
  const lines=isVar
    ?[{d:minData,c:'#FF6B6B',w:1.5},{d:data,c:'#38BDF8',w:2},{d:maxData,c:'#2EE8A5',w:1.5}]
    :[{d:data,c:'#38BDF8',w:2.5}];

  lines.forEach(({d,c,w})=>{
    ctx.beginPath();ctx.strokeStyle=c;ctx.lineWidth=w;ctx.lineJoin='round';
    d.slice(0,n).forEach((p,i)=>i===0?ctx.moveTo(xOf(i),yOf(p.balance)):ctx.lineTo(xOf(i),yOf(p.balance)));
    ctx.stroke();
  });

  // X axis labels
  ctx.fillStyle='#444';ctx.font='9px sans-serif';ctx.textAlign='center';
  const labelIdxs=[0,Math.round((n-1)/4),Math.round((n-1)/2),Math.round(3*(n-1)/4),n-1];
  labelIdxs.forEach(i=>{
    if(i>=n) return;
    const m=data[i]?.month||i;
    const lbl=m===0?'Hoy':m<12?m+'m':m===12?'1a':m===36?'3a':'5a';
    ctx.fillText(lbl,xOf(i),200-pad.b+14);
  });
}

// ── PATRIMONIO (Account Manager) ─────────────────────────────
const ACCT_TYPES={
  checking:{label:'Cuenta corriente',icon:'🏦',color:'#2EE8A5',
    fields:[
      {key:'interestRate',  label:'Tasa interés saldo positivo (%/año)', type:'number', placeholder:'ej. 12.5'},
      {key:'overdraftRate', label:'Tasa descubierto (%/año)',            type:'number', placeholder:'ej. 17'},
      {key:'maintenanceFee',label:'Cuota mantenimiento (€/mes)',         type:'number', placeholder:'ej. 2.00'},
      {key:'overdraftFee',  label:'Penalización descubierto fija (€)',   type:'number', placeholder:'ej. 0'},
      {key:'transferFee',   label:'Comisión por transferencia (€)',      type:'number', placeholder:'ej. 0'},
    ]
  },
  savings:{label:'Cuenta de ahorro',icon:'💰',color:'#38BDF8',
    fields:[
      {key:'rateType',      label:'Tipo de tasa',                        type:'select',
        options:['fixed','variable'],
        optionLabels:['Fija','Variable'],
        default:'fixed', onChange:'onRateTypeChange()'},
      {key:'interestRate',  label:'Tasa de interés (%/año)',             type:'number', placeholder:'ej. 3.5'},
      {key:'interestRateMin',label:'Tasa mínima (%/año)',                type:'number', placeholder:'ej. 2.0', showIf:'variable'},
      {key:'interestRateMax',label:'Tasa máxima (%/año)',                type:'number', placeholder:'ej. 5.0', showIf:'variable'},
      {key:'interestFreq',  label:'Frecuencia de liquidación',           type:'select',
        options:['daily','weekly','biweekly','monthly','quarterly','biannual','annual'],
        optionLabels:['Diaria','Semanal','Quincenal','Mensual','Trimestral','Semestral','Anual'],
        default:'monthly'},
      {key:'currentBalance',label:'Saldo actual (€)',                    type:'number', placeholder:'ej. 1500.00'},
    ]
  },
  cash:{label:'Efectivo',icon:'💵',color:'#FFD166', fields:[]},
};

function rPatrimonio(){
  const acctCards=accounts.map(a=>{
    const cfg=ACCT_TYPES[a.type]||ACCT_TYPES.checking;
    const isSav=a.type==='savings';
    const rateLabel=isSav?(a.rateType==='variable'?(a.interestRateMin||0)+'%–'+(a.interestRateMax||0)+'%':(a.interestRate||0)+'%'):'';
    const balLabel=isSav&&a.currentBalance?fmt(a.currentBalance):'';
    const cardClick=isSav?'rSavingsAccount('+a.id+')':'openEditAccount('+a.id+')';
    return`<div class="card" style="cursor:pointer" onclick="${cardClick}">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:40px;height:40px;border-radius:12px;background:rgba(255,255,255,.06);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">${cfg.icon}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:14px">${a.name}</div>
          <div style="font-size:11px;color:#555;margin-top:1px">${cfg.label}${rateLabel?' · '+rateLabel:''}${balLabel?' · '+balLabel:''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
          ${!isSav?`<button onclick="event.stopPropagation();openCsvImport(${a.id})" style="padding:6px 12px;border-radius:9px;border:1px solid rgba(46,232,165,.3);background:rgba(46,232,165,.08);color:#2EE8A5;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit">CSV</button>`:''}
          ${isSav?`<div style="font-size:12px;color:#38BDF8;font-weight:700">Ver →</div>`:''}
          <button onclick="event.stopPropagation();openEditAccount(${a.id})" style="width:28px;height:28px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:transparent;color:#555;font-size:13px;cursor:pointer;font-family:inherit">✎</button>
        </div>
      </div>
    </div>`;
  }).join('');

  const empty=!accounts.length?`<div class="empty" style="padding:40px 20px;text-align:center">
    <div style="font-size:36px;margin-bottom:8px">🏦</div>
    <div style="font-size:14px;color:#555">Sin cuentas</div>
    <div style="font-size:12px;color:#444;margin-top:4px">Añade una cuenta para poder importar extractos CSV</div>
  </div>`:'';

  $("con").innerHTML=`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;color:#555;letter-spacing:.8px;text-transform:uppercase">Mis Cuentas</div>
      <button onclick="openAddAccount()" style="padding:8px 14px;border-radius:11px;border:1px solid rgba(46,232,165,.3);background:rgba(46,232,165,.1);color:#2EE8A5;font-weight:700;font-size:12px;cursor:pointer;font-family:inherit">+ Cuenta</button>
    </div>
    ${acctCards}${empty}
    <div style="height:20px"></div>
  `;
}

function buildAccountForm(type, vals={}){
  const cfg=ACCT_TYPES[type]||ACCT_TYPES.checking;
  const curRateType=vals.rateType||'fixed';
  let fieldsHtml=cfg.fields.map(f=>{
    // showIf: only show when rateType matches
    if(f.showIf&&curRateType!==f.showIf) return '';
    if(f.type==='select'){
      const opts=f.options.map((o,i)=>`<option value="${o}"${(vals[f.key]||f.default)===o?' selected':''}>${f.optionLabels[i]}</option>`).join('');
      const onChange=f.onChange?` onchange="${f.onChange}"`:'';
      return`<div class="f" id="acf-row-${f.key}"><label class="fl">${f.label}</label><select id="acf-${f.key}"${onChange}>${opts}</select></div>`;
    }
    return`<div class="f" id="acf-row-${f.key}"><label class="fl">${f.label}</label><input id="acf-${f.key}" type="${f.type}" placeholder="${f.placeholder||''}" value="${vals[f.key]||''}"/></div>`;
  }).join('');

  // Custom extra charges (checking only)
  const extras=(vals.extraCharges||[]);
  const extraHtml=extras.map((ec,i)=>`
    <div style="display:grid;grid-template-columns:1fr auto;gap:8px;margin-bottom:8px" id="extra-${i}">
      <input placeholder="Nombre del cargo" value="${ec.label||''}" id="ecl-${i}" style="background:rgba(255,255,255,.05);border:1.5px solid rgba(255,255,255,.1);border-radius:11px;padding:10px 12px;color:#f0f0f0;font-size:15px;outline:none;font-family:inherit"/>
      <input type="number" placeholder="€" value="${ec.amount||''}" id="eca-${i}" style="width:80px;background:rgba(255,255,255,.05);border:1.5px solid rgba(255,255,255,.1);border-radius:11px;padding:10px 12px;color:#f0f0f0;font-size:15px;outline:none;font-family:inherit"/>
    </div>`).join('');

  const addExtraBtn=type==='checking'?`
    <div style="margin-bottom:12px">
      <div style="font-size:10px;color:#555;letter-spacing:.5px;text-transform:uppercase;margin-bottom:8px">Cargos adicionales</div>
      <div id="extra-fields">${extraHtml}</div>
      <button type="button" onclick="addExtraChargeField()" style="padding:8px 14px;border-radius:9px;border:1px dashed rgba(255,255,255,.15);background:transparent;color:#666;font-size:12px;cursor:pointer;font-family:inherit">+ Añadir cargo</button>
    </div>`:'';

  // Period of account cut
  const cutHtml=`
    <div style="margin-bottom:14px">
      <div style="font-size:10px;color:#555;letter-spacing:.5px;text-transform:uppercase;margin-bottom:8px">Período de corte</div>
      <div class="fg">
        <div class="f" style="margin-bottom:0"><label class="fl">Día inicio</label><input id="ac-cut-start" type="number" min="1" max="31" placeholder="1" value="${vals.cutStart||1}"/></div>
        <div class="f" style="margin-bottom:0"><label class="fl">Día fin</label><input id="ac-cut-end" type="number" min="1" max="31" placeholder="31" value="${vals.cutEnd||31}"/></div>
      </div>
      <div style="font-size:10px;color:#444;margin-top:5px">Deja 1–31 para mes calendario completo, o personaliza (ej. 13–12 para período de nómina)</div>
    </div>`;

  return fieldsHtml+addExtraBtn+cutHtml;
}

function addExtraChargeField(){
  const cont=$('extra-fields');
  if(!cont) return;
  const i=cont.children.length;
  const div=document.createElement('div');
  div.style.cssText='display:grid;grid-template-columns:1fr auto;gap:8px;margin-bottom:8px';
  div.id='extra-'+i;
  div.innerHTML=`
    <input placeholder="Nombre del cargo" id="ecl-${i}" style="background:rgba(255,255,255,.05);border:1.5px solid rgba(255,255,255,.1);border-radius:11px;padding:10px 12px;color:#f0f0f0;font-size:15px;outline:none;font-family:inherit"/>
    <input type="number" placeholder="€" id="eca-${i}" style="width:80px;background:rgba(255,255,255,.05);border:1.5px solid rgba(255,255,255,.1);border-radius:11px;padding:10px 12px;color:#f0f0f0;font-size:15px;outline:none;font-family:inherit"/>`;
  cont.appendChild(div);
}

function collectAccountData(type){
  const cfg=ACCT_TYPES[type]||ACCT_TYPES.checking;
  const data={};
  cfg.fields.forEach(f=>{
    const el=$('acf-'+f.key);
    if(!el) return;
    if(f.type==='number'){
      const v=parseFloat(el.value);
      data[f.key]=isNaN(v)?0:v;
    } else {
      data[f.key]=el.value||f.default||'';
    }
  });
  // Extra charges
  if(type==='checking'){
    const extras=[];
    const cont=$('extra-fields');
    if(cont){
      for(let i=0;i<cont.children.length;i++){
        const lbl=$('ecl-'+i)?.value?.trim();
        const amt=parseFloat($('eca-'+i)?.value||0);
        if(lbl&&amt) extras.push({label:lbl,amount:amt});
      }
    }
    data.extraCharges=extras;
  }
  // Cut period
  data.cutStart=parseInt($('ac-cut-start')?.value)||1;
  data.cutEnd=parseInt($('ac-cut-end')?.value)||31;
  return data;
}

function onRateTypeChange(){
  const isVar=($('acf-rateType')?.value||'fixed')==='variable';
  // Show/hide min/max rate fields
  ['interestRateMin','interestRateMax'].forEach(k=>{
    const row=$('acf-row-'+k);
    if(row) row.style.display=isVar?'block':'none';
  });
  // Relabel the main rate field
  const mainLabel=$('acf-row-interestRate');
  if(mainLabel){
    const lbl=mainLabel.querySelector('.fl');
    if(lbl) lbl.textContent=isVar?'Tasa promedio (%/año)':'Tasa de interés (%/año)';
  }
}

function onAccountTypeChange(){
  const type=$('ac-type')?.value||'checking';
  const cont=$('ac-fields');
  if(cont) cont.innerHTML=buildAccountForm(type);
}

function openAddAccount(){
  openSheet('Nueva cuenta',`
    <div class="f"><label class="fl">Nombre</label><input id="ac-name" placeholder="ej. BAWAG Principal"/></div>
    <div class="f"><label class="fl">Tipo</label>
      <select id="ac-type" onchange="onAccountTypeChange()">
        <option value="checking">🏦 Cuenta corriente</option>
        <option value="savings">💰 Cuenta de ahorro</option>
        <option value="cash">💵 Efectivo</option>
      </select>
    </div>
    <div id="ac-fields">${buildAccountForm('checking')}</div>
    <button class="bsv" style="background:linear-gradient(135deg,#2EE8A5,#0097a7);color:#001a10" onclick="saveAccount()">Guardar cuenta</button>
  `);
}

function saveAccount(){
  const name=($('ac-name')&&$('ac-name').value||'').trim();
  const type=$('ac-type')&&$('ac-type').value||'checking';
  if(!name){bnr('error','Introduce un nombre');return;}
  const data=collectAccountData(type);
  accounts.push({id:Date.now(),name,type,...data});
  sc();push();closeSheet();rPatrimonio();
}
function openEditAccount(id){
  const a=accounts.find(x=>String(x.id)===String(id));
  if(!a) return;
  openSheet('Editar cuenta',`
    <div class="f"><label class="fl">Nombre</label><input id="ac-name" value="${a.name}"/></div>
    <div class="f"><label class="fl">Tipo</label>
      <select id="ac-type" onchange="onAccountTypeChange()">
        <option value="checking"${a.type==='checking'?' selected':''}>🏦 Cuenta corriente</option>
        <option value="savings"${a.type==='savings'?' selected':''}>💰 Cuenta de ahorro</option>
        <option value="cash"${a.type==='cash'?' selected':''}>💵 Efectivo</option>
      </select>
    </div>
    <div id="ac-fields">${buildAccountForm(a.type||'checking', a)}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px">
      <button class="bsv" style="background:rgba(255,107,107,.15);color:#FF6B6B;border:1px solid rgba(255,107,107,.3)" onclick="deleteAccount('${id}')">Eliminar</button>
      <button class="bsv" style="background:linear-gradient(135deg,#2EE8A5,#0097a7);color:#001a10" onclick="updateAccount('${id}')">Guardar</button>
    </div>
  `);
}
function updateAccount(id){
  const a=accounts.find(x=>String(x.id)===String(id));
  if(!a) return;
  a.name=($('ac-name')&&$('ac-name').value||'').trim()||a.name;
  a.type=$('ac-type')&&$('ac-type').value||a.type;
  const data=collectAccountData(a.type);
  Object.assign(a,data);
  sc();push();closeSheet();rPatrimonio();
}
function deleteAccount(id){
  accounts=accounts.filter(x=>String(x.id)!==String(id));
  sc();push();closeSheet();rPatrimonio();
}
function openCsvImport(accountId){
  const a=accounts.find(x=>String(x.id)===String(accountId));
  openSheet('Importar CSV'+(a?' — '+a.name:''),`
    <div class="import-area" onclick="$('cfi-pat').click()" id="dra-pat"
      ondragover="event.preventDefault();this.classList.add('drag')"
      ondragleave="this.classList.remove('drag')"
      ondrop="hdropPat(event,'${accountId}')">
      <input type="file" id="cfi-pat" accept=".csv,.txt" onchange="hfilePat(this.files[0],'${accountId}')"/>
      <div style="font-size:28px;margin-bottom:8px">📂</div>
      <div style="font-weight:700;font-size:13px;margin-bottom:4px">Toca para seleccionar CSV</div>
      <div style="font-size:11px;color:#555">Compatible con BAWAG y Revolut</div>
    </div>
  `);
}
function hdropPat(e,accountId){
  e.preventDefault();
  $('dra-pat')&&$('dra-pat').classList.remove('drag');
  const f=e.dataTransfer.files[0];
  if(f) hfilePat(f,accountId);
}
function hfilePat(f,accountId){
  // Re-use existing CSV parser
  hfile(f);
  closeSheet();
}


// ── TICKER HINTS ─────────────────────────────────────────────
const KNOWN_TICKERS={
  // Your specific holdings
  "1F80":"1F80.DE","1F80.DE":"1F80.DE",
  "VAS":"VOE.VI","VOE.VI":"VOE.VI",
  "JUP":"JUP.L","JUP.L":"JUP.L",
  // Common EU/AT stocks
  "VOE":"VOE.VI","VOESTALPINE":"VOE.VI",
  "FCT":"FCT.MI","FINCANTIERI":"FCT.MI",
  // Common crypto
  "BTC":"BTC-USD","ETH":"ETH-USD","SOL":"SOL-USD",
  "XRP":"XRP-USD","ADA":"ADA-USD","DOT":"DOT-USD",
  // US big caps
  "APPLE":"AAPL","AMAZON":"AMZN","GOOGLE":"GOOGL","MICROSOFT":"MSFT",
  "TESLA":"TSLA","NVIDIA":"NVDA","META":"META",
};

// Map of known name keywords to ticker info
const KNOWN_NAME_MAP={
  "voestalpine":{symbol:"VOE.VI",shortname:"Voestalpine AG",exchDisp:"Vienna",quoteType:"EQUITY"},
  "voest":       {symbol:"VOE.VI",shortname:"Voestalpine AG",exchDisp:"Vienna",quoteType:"EQUITY"},
  "fincantieri": {symbol:"1F80.DE",shortname:"Fincantieri S.p.A.",exchDisp:"XETRA",quoteType:"EQUITY"},
  "jupiter":     {symbol:"JUP.L",shortname:"Jupiter Fund Management",exchDisp:"London",quoteType:"EQUITY"},
  "bitcoin":     {symbol:"BTC-USD",shortname:"Bitcoin USD",exchDisp:"CCC",quoteType:"CRYPTOCURRENCY"},
  "ethereum":    {symbol:"ETH-USD",shortname:"Ethereum USD",exchDisp:"CCC",quoteType:"CRYPTOCURRENCY"},
  "apple":       {symbol:"AAPL",shortname:"Apple Inc.",exchDisp:"NASDAQ",quoteType:"EQUITY"},
  "amazon":      {symbol:"AMZN",shortname:"Amazon.com Inc.",exchDisp:"NASDAQ",quoteType:"EQUITY"},
  "microsoft":   {symbol:"MSFT",shortname:"Microsoft Corp.",exchDisp:"NASDAQ",quoteType:"EQUITY"},
  "nvidia":      {symbol:"NVDA",shortname:"NVIDIA Corp.",exchDisp:"NASDAQ",quoteType:"EQUITY"},
  "tesla":       {symbol:"TSLA",shortname:"Tesla Inc.",exchDisp:"NASDAQ",quoteType:"EQUITY"},
};

function suggestKnownTicker(query){
  const q=query.toLowerCase().trim();
  // Check name map first
  for(const[key,val]of Object.entries(KNOWN_NAME_MAP)){
    if(q.includes(key)||key.includes(q)) return val;
  }
  // Check known tickers map
  const up=q.toUpperCase();
  const resolved=KNOWN_TICKERS[up];
  if(resolved){
    return{symbol:resolved,shortname:resolved,exchDisp:"",quoteType:"EQUITY"};
  }
  return null;
}

const TICKER_SUFFIX_HINTS={
  ".DE":"Bolsa alemana XETRA — EUR",
  ".VI":"Bolsa de Viena — EUR",
  ".MI":"Bolsa italiana Milán — EUR",
  ".PA":"Bolsa de París — EUR",
  ".L":"Bolsa de Londres — GBp (peniques)",
  ".SW":"Bolsa suiza — CHF",
  ".AS":"Bolsa de Ámsterdam — EUR",
  "-USD":"Crypto en dólares",
  "-EUR":"Crypto en euros",
};

function showTickerHint(val){
  const el=$("ticker-hint");if(!el)return;
  if(!val){el.style.display="none";return;}
  const up=val.toUpperCase();
  // Check if known ticker
  if(KNOWN_TICKERS[up]&&KNOWN_TICKERS[up]!==up){
    el.textContent=`💡 Usa "${KNOWN_TICKERS[up]}" para que Yahoo Finance lo encuentre`;
    el.style.display="block";return;
  }
  // Check suffix
  for(const[suf,desc]of Object.entries(TICKER_SUFFIX_HINTS)){
    if(up.endsWith(suf)){el.textContent=`✓ ${desc}`;el.style.display="block";return;}
  }
  // No suffix warning for plain tickers
  if(!up.includes(".")&&!up.includes("-")&&up.length<=6){
    el.textContent="⚠ Sin sufijo de bolsa — prueba añadir .DE (Alemania), .VI (Viena), .L (Londres)...";
    el.style.display="block";return;
  }
  el.style.display="none";
}


// ── TICKER LIVE SEARCH ────────────────────────────────────────
let _searchTimer=null;
let _selectedTicker=null;

async function searchTicker(query){
  const spin=$("inv-search-spin");
  const resultsEl=$("ticker-results");
  clearTimeout(_searchTimer);
  if(!query||query.length<2){
    resultsEl.style.display="none";
    if(spin) spin.style.display="none";
    return;
  }
  if(spin) spin.style.display="inline";
  _searchTimer=setTimeout(async()=>{
    try{
      // Yahoo Finance autocomplete search API
      // Try Finnhub symbol search first, fallback to Yahoo
      const finnhubSearchUrl=`https://finnhub.io/api/v1/search?q=${encodeURIComponent(query)}&token=${FINNHUB_KEY}`;
      let data=null;
      try{
        const fhRes=await fetch(finnhubSearchUrl,{signal:AbortSignal.timeout(6000)});
        if(fhRes.ok){
          const fhData=await fhRes.json();
          if(fhData?.result?.length){
            // Convert Finnhub format to Yahoo-like format for rendering
            const quotes=fhData.result.slice(0,8).map(r=>({
              symbol:r.symbol,
              shortname:r.description,
              longname:r.description,
              quoteType:r.type==="Crypto"?"CRYPTOCURRENCY":r.type==="ETP"?"ETF":"EQUITY",
              exchDisp:r.displaySymbol||"",
              typeDisp:r.type||"Stock",
            }));
            data={quotes};
          }
        }
      }catch(e){console.warn("Finnhub search failed:",e.message);}

      // Fallback to Yahoo proxy search
      if(!data?.quotes?.length){
      const url=`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0&listsCount=0`;
      const proxies=[
        `https://corsproxy.io/?${encodeURIComponent(url)}`,
        `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
      ];
      let yahooData=null;
      for(const proxy of proxies){
        try{
          const res=await fetch(proxy,{signal:AbortSignal.timeout(6000)});
          if(!res.ok) continue;
          const raw=await res.json();
          yahooData=raw.contents?JSON.parse(raw.contents):raw;
          if(yahooData?.quotes) break;
        }catch(e){ continue; }
      }
      if(spin) spin.style.display="none";
      if(!data?.quotes?.length) data=yahooData;
      const allQuotes=data?.quotes||[];
      const quotes=allQuotes.filter(q=>["EQUITY","ETF","MUTUALFUND","CRYPTOCURRENCY","CURRENCY"].includes(q.quoteType));
      if(!quotes.length){
        // Try to match known tickers before giving up
        const fallback=suggestKnownTicker(query);
        if(fallback){
          window._tickerResults=[fallback];
          resultsEl.innerHTML=`<div onclick="selectTickerIdx(0)"
            style="padding:11px 14px;cursor:pointer;display:flex;align-items:center;gap:10px;background:rgba(255,213,102,.05)"
            onmouseover="this.style.background='rgba(255,213,102,.12)'" onmouseout="this.style.background='rgba(255,213,102,.05)'">
            <span style="font-size:14px">📈</span>
            <div style="flex:1"><div style="font-weight:700;font-size:13px">${fallback.shortname}</div>
            <div style="font-size:10px;color:#555;margin-top:1px">${fallback.symbol} · Ticker conocido</div></div>
            <span style="font-size:11px;color:#FFD166">${fallback.symbol}</span>
          </div>`;
          resultsEl.style.display="block";
        } else {
          resultsEl.innerHTML=`<div style="padding:12px 14px;font-size:12px;color:#555">Sin resultados · Prueba escribir el ticker directamente (ej. VOE.VI, 1F80.DE, JUP.L)</div>`;
          resultsEl.style.display="block";
        }
        return;
      }
      const typeIcons={EQUITY:"📈",ETF:"🗂",MUTUALFUND:"💼",CRYPTOCURRENCY:"₿",CURRENCY:"💱"};
      // Store results globally so onclick can reference by index safely
      window._tickerResults=quotes;
      resultsEl.innerHTML=quotes.map((q,idx)=>{
        const name=(q.shortname||q.longname||q.symbol||"").replace(/'/g,"&#39;").replace(/"/g,"&quot;");
        const exch=(q.exchDisp||q.exchange||"").replace(/'/g,"&#39;");
        const type2=(q.typeDisp||q.quoteType||"").replace(/'/g,"&#39;");
        return`<div onclick="selectTickerIdx(${idx})"
          style="padding:11px 14px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.05);display:flex;align-items:center;gap:10px"
          onmouseover="this.style.background='rgba(255,213,102,.08)'" onmouseout="this.style.background=''">
          <span style="font-size:14px">${typeIcons[q.quoteType]||"📊"}</span>
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name}</div>
            <div style="font-size:10px;color:#555;margin-top:1px">${q.symbol} · ${exch} · ${type2}</div>
          </div>
          <span style="font-size:11px;color:#FFD166;flex-shrink:0">${q.symbol}</span>
        </div>`;}).join("");
      resultsEl.style.display="block";
      } // end yahoo fallback
    }catch(e){
      if(spin) spin.style.display="none";
      console.warn("Ticker search failed:",e);
      const fallback=suggestKnownTicker(query);
      if(fallback){
        window._tickerResults=[fallback];
        resultsEl.innerHTML=`<div onclick="selectTickerIdx(0)"
          style="padding:11px 14px;cursor:pointer;display:flex;align-items:center;gap:10px;background:rgba(255,213,102,.05)"
          onmouseover="this.style.background='rgba(255,213,102,.12)'" onmouseout="this.style.background='rgba(255,213,102,.05)'">
          <span style="font-size:14px">📈</span>
          <div style="flex:1"><div style="font-weight:700;font-size:13px">${fallback.shortname}</div>
          <div style="font-size:10px;color:#555;margin-top:1px">${fallback.symbol} · Ticker conocido</div></div>
          <span style="font-size:11px;color:#FFD166">${fallback.symbol}</span>
        </div>`;
      } else {
        resultsEl.innerHTML=`<div style="padding:12px 14px;font-size:12px;color:#777">Sin conexión al buscador · Escribe el ticker: VOE.VI, 1F80.DE, JUP.L...</div>`;
      }
      resultsEl.style.display="block";
    }
  },400);
}

function selectTickerIdx(idx){
  const q=(window._tickerResults||[])[idx];
  if(!q) return;
  _selectedTicker=q;
  $("inv-ticker").value=q.symbol;
  $("inv-name").value=q.shortname||q.longname||q.symbol;
  $("sel-name").textContent=q.shortname||q.longname||q.symbol;
  $("sel-ticker-display").textContent=q.symbol;
  $("sel-exchange").textContent=`${q.exchDisp||q.exchange||""} · ${q.typeDisp||q.quoteType||""}`;
  $("inv-selected").style.display="block";
  $("inv-search").value="";
  $("ticker-results").style.display="none";
}

function selectTicker(jsonStr){
  const q=JSON.parse(jsonStr);
  _selectedTicker=q;
  // Fill hidden fields
  $("inv-ticker").value=q.symbol;
  $("inv-name").value=q.shortname||q.longname||q.symbol;
  // Update selection display
  $("sel-name").textContent=q.shortname||q.longname||q.symbol;
  $("sel-ticker-display").textContent=q.symbol;
  $("sel-exchange").textContent=`${q.exchDisp||q.exchange||""} · ${q.typeDisp||q.quoteType||""}`;
  $("inv-selected").style.display="block";
  // Clear search
  $("inv-search").value="";
  $("ticker-results").style.display="none";
}

function clearTickerSelection(){
  _selectedTicker=null;
  $("inv-ticker").value="";
  $("inv-name").value="";
  $("inv-selected").style.display="none";
  $("inv-search").value="";
  $("inv-search").focus();
}

// Close results when clicking outside
document.addEventListener("click",e=>{
  const el=$("ticker-results");
  if(el&&!el.contains(e.target)&&e.target.id!=="inv-search") el.style.display="none";
});


// ── SAVINGS ACCOUNT ENGINE ───────────────────────────────────
// Entry types: deposit, withdrawal, interest
// savings_account = [{id, date:"YYYY-MM-DD", type, amount, note}]

function savingsEntriesSorted(){
  return [...savings_account].sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0);
}

// Build daily ledger: for each day compute opening balance, interest earned, closing balance
function buildSavingsLedger(){
  const entries2=savingsEntriesSorted();
  if(!entries2.length) return{days:[],currentBalance:0,totalInterest:0,avgDailyRate:0,avgAnnualRate:0};

  // Group by date
  const byDate={};
  entries2.forEach(e=>{
    if(!byDate[e.date]) byDate[e.date]={deposits:0,withdrawals:0,interest:0,entries:[]};
    if(e.type==="deposit") byDate[e.date].deposits+=e.amount;
    else if(e.type==="withdrawal") byDate[e.date].withdrawals+=e.amount;
    else if(e.type==="interest") byDate[e.date].interest+=e.amount;
    byDate[e.date].entries.push(e);
  });

  // Fill days from first entry to today
  const dates=Object.keys(byDate).sort();
  const firstDate=new Date(dates[0]);
  const today=new Date();
  today.setHours(0,0,0,0);

  const days=[];
  let balance=0;
  let totalInterest=0;
  const dailyRates=[];

  let cur=new Date(firstDate);
  while(cur<=today){
    const ds=cur.toISOString().substring(0,10);
    const d=byDate[ds]||{deposits:0,withdrawals:0,interest:0,entries:[]};
    const openBalance=balance;
    balance+=d.deposits-d.withdrawals;
    const beforeInterest=balance;
    // Calculate daily rate if we have both a positive balance and interest
    if(d.interest>0&&openBalance>0){
      const rate=d.interest/openBalance;
      dailyRates.push(rate);
    }
    balance+=d.interest;
    totalInterest+=d.interest;
    days.push({
      date:ds,
      openBalance:Math.round(openBalance*100)/100,
      deposits:d.deposits,
      withdrawals:d.withdrawals,
      interest:d.interest,
      closeBalance:Math.round(balance*100)/100,
      entries:d.entries
    });
    cur.setDate(cur.getDate()+1);
  }

  const avgDailyRate=dailyRates.length?dailyRates.reduce((a,b)=>a+b,0)/dailyRates.length:0;
  const avgAnnualRate=avgDailyRate>0?(Math.pow(1+avgDailyRate,365)-1)*100:0;

  return{days,currentBalance:Math.round(balance*100)/100,totalInterest:Math.round(totalInterest*100)/100,avgDailyRate,avgAnnualRate:Math.round(avgAnnualRate*100)/100};
}

// Project future balance for N months
// projectSavings moved to savings engine above


function buildSavingsSummaryHTML(){
  const ledger=buildSavingsLedger();
  const {currentBalance,totalInterest,avgDailyRate,avgAnnualRate,days}=ledger;

  if(!savings_account.length){
    return`<div style="text-align:center;padding:20px;color:#444;font-size:13px">
      Sin movimientos registrados.<br>Toca <b style="color:#2EE8A5">+ Añadir</b> para empezar.
    </div>`;
  }

  // Projections
  const proj3 =projectSavings(currentBalance,avgDailyRate,3);
  const proj6 =projectSavings(currentBalance,avgDailyRate,6);
  const proj12=projectSavings(currentBalance,avgDailyRate,12);

  // Recent days (last 30 with activity)
  const recentDays=[...days].reverse().filter(d=>d.deposits||d.withdrawals||d.interest).slice(0,30);

  // Balance chart data (monthly snapshots)
  const monthSnaps={};
  days.forEach(d=>{
    const m=d.date.substring(0,7);
    monthSnaps[m]=d.closeBalance;
  });
  const snapKeys=Object.keys(monthSnaps).sort();

  return`
  <!-- Stats cards -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:14px">
    <div class="card" style="grid-column:1/-1">
      <div style="font-size:9px;color:#555;text-transform:uppercase;letter-spacing:.7px;margin-bottom:4px">Saldo actual</div>
      <div style="font-family:monospace;font-weight:900;font-size:26px;color:#2EE8A5">${fmt(currentBalance)}</div>
    </div>
    ${[
      ["Interés total ganado","#2EE8A5",fmt(totalInterest)],
      ["Tasa diaria promedio","#FFD166",(avgDailyRate*100).toFixed(4)+"%"],
      ["TAE equivalente","#A78BFA",avgAnnualRate+"%"],
      ["Días registrados","#38BDF8",days.length+" días"],
    ].map(([l,c,v])=>`<div class="card">
      <div style="font-size:9px;color:#555;text-transform:uppercase;letter-spacing:.7px;margin-bottom:4px">${l}</div>
      <div style="font-family:monospace;font-weight:700;font-size:15px;color:${c}">${v}</div>
    </div>`).join("")}
  </div>

  <!-- Balance evolution chart -->
  ${snapKeys.length>1?`<div class="cwrap" style="margin-bottom:14px">
    <div class="ctitle">Evolución del saldo de ahorro</div>
    <canvas id="c-savings" height="110"></canvas>
  </div>`:""}

  <!-- Projections -->
  <div class="cwrap" style="margin-bottom:14px">
    <div class="ctitle">📈 Proyección (sin depósitos adicionales)</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
      ${[[3,"3 meses",proj3],[6,"6 meses",proj6],[12,"1 año",proj12]].map(([m,l,v])=>`
        <div style="text-align:center;background:rgba(255,255,255,.03);border-radius:12px;padding:12px 8px;border:1px solid rgba(255,255,255,.07)">
          <div style="font-size:10px;color:#555;margin-bottom:5px">${l}</div>
          <div style="font-family:monospace;font-weight:800;font-size:13px;color:#2EE8A5">${fmt(v)}</div>
          <div style="font-size:9px;color:#444;margin-top:3px">+${fmt(v-currentBalance)}</div>
        </div>`).join("")}
    </div>
    <div style="margin-top:12px">
      <div style="font-size:11px;color:#555;margin-bottom:6px">Con depósito mensual adicional de:</div>
      <div style="display:flex;gap:8px;align-items:center">
        <input id="sv-proj-deposit" type="number" placeholder="€ mensuales" min="0" step="10"
          oninput="updateSavingsProjection()"
          style="flex:1;background:rgba(255,255,255,.05);border:1.5px solid rgba(255,255,255,.1);border-radius:9px;padding:9px 12px;color:#f0f0f0;font-size:14px;outline:none;font-family:inherit"/>
      </div>
      <div id="sv-proj-result" style="display:none;margin-top:10px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px"></div>
    </div>
  </div>

  <!-- Transaction log -->
  <div class="cwrap">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div class="ctitle" style="margin-bottom:0">Movimientos recientes</div>
    </div>
    ${recentDays.map(d=>`
      <div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,.04)">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="font-size:11px;color:#555">${d.date}</div>
          <div style="font-family:monospace;font-size:12px;font-weight:700;color:#2EE8A5">${fmt(d.closeBalance)}</div>
        </div>
        ${d.deposits?`<div style="font-size:11px;color:#2EE8A5">↑ Depósito: ${fmt(d.deposits)}</div>`:""}
        ${d.withdrawals?`<div style="font-size:11px;color:#FF6B6B">↓ Retiro: ${fmt(d.withdrawals)}</div>`:""}
        ${d.interest?`<div style="font-size:11px;color:#FFD166">✦ Interés: +${fmt(d.interest)} <span style="color:#555;font-size:10px">(${d.openBalance>0?((d.interest/d.openBalance)*100).toFixed(4):"—"}% diario)</span></div>`:""}
        ${d.entries.map(e=>`<button onclick="deleteSavingsEntry(${e.id})" style="font-size:9px;color:#555;background:none;border:none;cursor:pointer;font-family:inherit;padding:0;margin-top:1px">✕ eliminar</button>`).join("")}
      </div>`).join("")}
  </div>`;
}

// Draw savings balance chart
function drawSavingsChart(){
  const c=$("c-savings");if(!c)return;
  c.width=c.parentElement.clientWidth-28;
  const ctx=c.getContext("2d"),w=c.width,h=c.height;
  ctx.clearRect(0,0,w,h);
  const ledger=buildSavingsLedger();
  const {days}=ledger;
  // Monthly snapshots
  const monthSnaps={};
  days.forEach(d=>{const m=d.date.substring(0,7);monthSnaps[m]=d.closeBalance;});
  const keys=Object.keys(monthSnaps).sort();
  if(keys.length<2)return;
  const bals=keys.map(k=>monthSnaps[k]);
  const labels=keys.map(k=>k.substring(5)); // MM
  const minB=Math.min(...bals,0),maxB=Math.max(...bals,1),range=maxB-minB||1;
  const lpad=8,lpb=18,lch=h-lpb-6;
  const pts=bals.map((b,i)=>({x:lpad+i*(w-lpad*2)/(keys.length-1),y:5+((maxB-b)/range)*lch}));
  const grad=ctx.createLinearGradient(0,0,0,h);
  grad.addColorStop(0,"rgba(46,232,165,.2)");grad.addColorStop(1,"rgba(46,232,165,0)");
  ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);pts.forEach(p=>ctx.lineTo(p.x,p.y));
  ctx.lineTo(pts[pts.length-1].x,h-lpb);ctx.lineTo(pts[0].x,h-lpb);
  ctx.closePath();ctx.fillStyle=grad;ctx.fill();
  ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);pts.forEach(p=>ctx.lineTo(p.x,p.y));
  ctx.strokeStyle="#2EE8A5";ctx.lineWidth=2;ctx.stroke();
  pts.forEach((p,i)=>{
    ctx.beginPath();ctx.arc(p.x,p.y,3,0,Math.PI*2);ctx.fillStyle="#2EE8A5";ctx.fill();
    ctx.fillStyle="#555";ctx.font="8px DM Sans";ctx.textAlign="center";ctx.fillText(labels[i],p.x,h-4);
  });
}

function updateSavingsProjection(){
  const monthly=parseFloat($("sv-proj-deposit")&&$("sv-proj-deposit").value)||0;
  const el=$("sv-proj-result");if(!el)return;
  if(!monthly){el.style.display="none";return;}
  const ledger=buildSavingsLedger();
  const{currentBalance,avgDailyRate}=ledger;
  el.style.display="grid";
  const projs=[[3,"3 meses"],[6,"6 meses"],[12,"1 año"]].map(([m,l])=>{
    const v=projectSavings(currentBalance,avgDailyRate,m,monthly);
    return`<div style="text-align:center;background:rgba(46,232,165,.06);border-radius:12px;padding:12px 8px;border:1px solid rgba(46,232,165,.15)">
      <div style="font-size:10px;color:#555;margin-bottom:5px">${l}</div>
      <div style="font-family:monospace;font-weight:800;font-size:13px;color:#2EE8A5">${fmt(v)}</div>
      <div style="font-size:9px;color:#444;margin-top:3px">+${fmt(v-currentBalance)}</div>
    </div>`;
  });
  el.innerHTML=projs.join("");
}

// CRUD
function openSavingsEntry(){
  $("savings-form").style.display="block";
  $("sv-date").value=new Date().toISOString().substring(0,10);
  $("sv-amount").value="";
  $("sv-note").value="";
  $("savings-form").scrollIntoView({behavior:"smooth"});
}

function saveSavingsEntry(){
  const type=$("sv-type").value;
  const date=$("sv-date").value;
  const amount=parseFloat($("sv-amount").value)||0;
  const note=$("sv-note").value.trim();
  if(!date||!amount){bnr("error","Completa fecha y monto");return;}
  const entry={id:Date.now(),type,date,amount,note};
  savings_account.push(entry);
  $("savings-form").style.display="none";
  sc();

  setTimeout(drawSavingsChart,50);
  push();
  bnr("success","Movimiento guardado ✓");
}

function deleteSavingsEntry(id){
  if(!confirm("¿Eliminar este movimiento?"))return;
  savings_account=savings_account.filter(e=>e.id!==id);
  sc();

  setTimeout(drawSavingsChart,50);
  push();
}


// ── SAVINGS TAB ───────────────────────────────────────────────
// ── SAVINGS CALENDAR STATE ───────────────────────────────────
let _savCal={year:new Date().getFullYear(),month:new Date().getMonth(),selected:new Set(),type:'interest'};

function rSavingsTab(){
  const now=new Date();
  $("con").innerHTML=`
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
    <div>
      <div style="font-size:10px;color:#555;letter-spacing:.8px;text-transform:uppercase;margin-bottom:2px">Cuenta de ahorro</div>
      <div style="font-weight:900;font-size:20px;letter-spacing:-.5px;color:#2EE8A5">Revolut Savings</div>
    </div>
    <button onclick="openSavingsEntry()" style="padding:9px 16px;border-radius:12px;border:1px solid rgba(46,232,165,.3);background:rgba(46,232,165,.1);color:#2EE8A5;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit">+ Entrada única</button>
  </div>

  <div id="sav-cal-block" style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:14px;margin-bottom:14px"></div>

  <!-- SINGLE ENTRY FORM -->
  <div id="savings-form" style="display:none;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:16px;margin-bottom:14px">
    <div style="font-weight:700;font-size:14px;margin-bottom:14px;color:#f0f0f0">Entrada única</div>
    <div class="fg" style="margin-bottom:12px">
      <div class="f" style="margin-bottom:0">
        <label class="fl">Tipo</label>
        <select id="sv-type" style="width:100%;background:rgba(255,255,255,.05);border:1.5px solid rgba(255,255,255,.1);border-radius:11px;padding:13px 14px;color:#f0f0f0;font-size:16px;outline:none;font-family:inherit;-webkit-appearance:none">
          <option value="deposit">💰 Depósito</option>
          <option value="withdrawal">💸 Retiro</option>
          <option value="interest">📈 Interés diario</option>
        </select>
      </div>
      <div class="f" style="margin-bottom:0">
        <label class="fl">Fecha</label>
        <input id="sv-date" type="date" style="width:100%;background:rgba(255,255,255,.05);border:1.5px solid rgba(255,255,255,.1);border-radius:11px;padding:13px 14px;color:#f0f0f0;font-size:16px;outline:none;font-family:inherit"/>
      </div>
    </div>
    <div class="f" style="margin-bottom:12px">
      <label class="fl">Monto (€)</label>
      <input id="sv-amount" type="number" placeholder="0.00" min="0" step="0.01"/>
    </div>
    <div class="f" style="margin-bottom:14px">
      <label class="fl">Nota (opcional)</label>
      <input id="sv-note" type="text" placeholder="ej. Transferencia desde BAWAG"/>
    </div>
    <div class="fg">
      <button onclick="$('savings-form').style.display='none'" style="flex:1;padding:13px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:transparent;color:#666;cursor:pointer;font-family:inherit;font-size:15px">Cancelar</button>
      <button onclick="saveSavingsEntry()" style="flex:2;padding:13px;border-radius:12px;border:none;background:linear-gradient(135deg,#2EE8A5,#0097a7);color:#001a10;font-weight:800;cursor:pointer;font-family:inherit;font-size:15px">Guardar</button>
    </div>
  </div>

  <div id="savings-summary-block">${buildSavingsSummaryHTML()}</div>
  `;
  setTimeout(()=>{drawSavCalendar();drawSavingsChart();},50);
}

// ── SAVINGS CALENDAR LOGIC ────────────────────────────────────
const SAV_TYPE_CFG={
  interest:{label:'📈 Interés',color:'#FFD166',bg:'rgba(255,213,102,.15)'},
  deposit: {label:'💰 Depósito',color:'#2EE8A5',bg:'rgba(46,232,165,.15)'},
  withdrawal:{label:'💸 Retiro',color:'#FF6B6B',bg:'rgba(255,107,107,.15)'},
};

let _savRangeStart=null; // for range selection

function drawSavCalendar(){
  const el=$("sav-cal-block");
  if(!el) return;
  const {year,month,selected,type}=_savCal;
  const cfg=SAV_TYPE_CFG[type];
  const firstDay=(new Date(year,month,1).getDay()+6)%7;
  const daysInMonth=new Date(year,month+1,0).getDate();
  const existingDates=new Set(savings_account
    .filter(e=>{const d=new Date(e.date);return d.getFullYear()===year&&d.getMonth()===month;})
    .map(e=>new Date(e.date).getDate())
  );

  const typeBtns=Object.entries(SAV_TYPE_CFG).map(([k,v])=>`
    <button onclick="savCalSetType('${k}')" style="flex:1;padding:8px 4px;border-radius:10px;
      border:1.5px solid ${type===k?v.color:'rgba(255,255,255,.1)'};
      background:${type===k?v.bg:'transparent'};
      color:${type===k?v.color:'#555'};
      font-size:12px;font-weight:${type===k?700:400};cursor:pointer;font-family:inherit">
      ${v.label}</button>`).join('');

  const headers=['L','M','X','J','V','S','D'].map(d=>
    `<div style="text-align:center;font-size:10px;color:#444;font-weight:600;padding:2px 0">${d}</div>`
  ).join('');

  let cells='';
  for(let i=0;i<firstDay;i++) cells+=`<div></div>`;
  for(let d=1;d<=daysInMonth;d++){
    const sel=selected.has(d);
    const has=existingDates.has(d);
    cells+=`<div onclick="savCalToggle(${d})" ontouchstart="savCalTouchStart(${d})" ontouchend="savCalTouchEnd(${d},event)"
      style="height:36px;border-radius:8px;display:flex;flex-direction:column;align-items:center;
        justify-content:center;cursor:pointer;font-size:13px;
        border:1.5px solid ${sel?cfg.color:'rgba(255,255,255,.08)'};
        background:${sel?cfg.bg:'rgba(255,255,255,.03)'};
        color:${sel?cfg.color:'#666'};font-weight:${sel?700:400};
        user-select:none;-webkit-user-select:none;touch-action:manipulation">
      ${d}
      <div style="width:4px;height:4px;border-radius:50%;background:${has?(sel?cfg.color:'#333'):'transparent'};margin-top:1px"></div>
    </div>`;
  }

  el.innerHTML=`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <span style="font-size:11px;font-weight:700;color:#2EE8A5;letter-spacing:.5px">📅 ENTRADA MASIVA</span>
      <div style="display:flex;align-items:center;gap:6px">
        <button onclick="savCalPrev()" style="width:30px;height:30px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:transparent;color:#aaa;cursor:pointer;font-size:15px;line-height:1;font-family:inherit">‹</button>
        <span style="font-size:12px;color:#ccc;font-weight:600;min-width:90px;text-align:center">${MF[month]} ${year}</span>
        <button onclick="savCalNext()" style="width:30px;height:30px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:transparent;color:#aaa;cursor:pointer;font-size:15px;line-height:1;font-family:inherit">›</button>
      </div>
    </div>
    <div style="display:flex;gap:6px;margin-bottom:12px">${typeBtns}</div>
    <div style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px;margin-bottom:3px">${headers}</div>
    <div style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px;margin-bottom:14px">${cells}</div>
    <div style="margin-bottom:8px">
      <div style="font-size:10px;color:#555;margin-bottom:5px;text-transform:uppercase;letter-spacing:.5px">Monto por día</div>
      <input id="sav-bulk-amount" type="number" placeholder="0.00" min="0" step="0.01"
        style="width:100%;box-sizing:border-box;background:rgba(255,255,255,.05);border:1.5px solid rgba(255,255,255,.1);
          border-radius:11px;padding:12px 14px;color:#f0f0f0;font-size:16px;outline:none;font-family:inherit"/>
    </div>
    <button onclick="saveBulkSave()" style="width:100%;box-sizing:border-box;padding:13px;border-radius:12px;border:none;
      background:linear-gradient(135deg,#2EE8A5,#0097a7);color:#001a10;font-weight:800;font-size:15px;cursor:pointer;
      font-family:inherit;display:flex;align-items:center;justify-content:center;gap:8px">
      <span>Guardar</span>
      <span style="font-size:11px;background:rgba(0,0,0,.2);padding:2px 8px;border-radius:99px">
        ${selected.size} día${selected.size!==1?'s':''}
      </span>
    </button>
    <div style="font-size:10px;color:#444;margin-top:8px;line-height:1.5">Toca para seleccionar · Toca de nuevo para quitar · Mantén para rango</div>
  `;
}

function savCalToggle(day){
  if(_savCal.selected.has(day)) _savCal.selected.delete(day);
  else _savCal.selected.add(day);
  drawSavCalendar();
}

let _touchTimer=null;
function savCalTouchStart(day){
  _touchTimer=setTimeout(()=>{
    // Long press = select range from last selected to this day
    if(_savRangeStart!==null){
      const from=Math.min(_savRangeStart,day);
      const to=Math.max(_savRangeStart,day);
      for(let d=from;d<=to;d++) _savCal.selected.add(d);
      _savRangeStart=null;
      drawSavCalendar();
    } else {
      _savRangeStart=day;
    }
  },500);
}
function savCalTouchEnd(day,e){
  clearTimeout(_touchTimer);
}

function savCalSetType(t){
  _savCal.type=t;
  drawSavCalendar();
}
function savCalPrev(){
  _savCal.month--;
  if(_savCal.month<0){_savCal.month=11;_savCal.year--;}
  _savCal.selected=new Set();
  drawSavCalendar();
}
function savCalNext(){
  _savCal.month++;
  if(_savCal.month>11){_savCal.month=0;_savCal.year++;}
  _savCal.selected=new Set();
  drawSavCalendar();
}

function saveBulkSave(){
  const amount=parseFloat($("sav-bulk-amount")&&$("sav-bulk-amount").value)||0;
  const {year,month,selected,type}=_savCal;
  if(!selected.size){bnr("error","Selecciona al menos un día");return;}
  if(!amount){bnr("error","Introduce el monto por día");return;}

  let added=0;
  selected.forEach(day=>{
    const date=`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    // Skip if already exists for this date+type
    const exists=savings_account.some(e=>e.date===date&&e.type===type);
    if(!exists){
      savings_account.push({id:Date.now()+added,type,date,amount,note:'bulk'});
      added++;
    }
  });

  if(added===0){bnr("error","Esos días ya tienen entradas de ese tipo");return;}
  _savCal.selected=new Set();
  sc();push();
  bnr("success",`${added} entrada${added!==1?'s':''} guardada${added!==1?'s':''} ✓`);
  rSavingsTab();
}


// ── ESTADO DE CUENTA ENGINE ──────────────────────────────────
// Computes the real account statement for a given month/year
// = history balance + manual adjustments from statement entries
// + tax charges + penalty charges

// Compute the RUNNING balance up to (but not including) a given month
// by accumulating all history month flows from the oldest available month
function runningBalance(upToMonth, upToYear){
  // Sort history oldest first
  const sorted=[...history].sort((a,b)=>
    a.year!==b.year?a.year-b.year:a.month-b.month
  );
  if(!sorted.length) return null;
  let bal=0, hasData=false;
  for(const h of sorted){
    // Stop before the target month
    if(h.year>upToYear||(h.year===upToYear&&h.month>=upToMonth)) break;
    bal += (h.income - h.expenses);
    hasData=true;
  }
  return hasData?Math.round(bal*100)/100:null;
}

// Running balance INCLUDING a given month
function runningBalanceThrough(month, year){
  const sorted=[...history].sort((a,b)=>
    a.year!==b.year?a.year-b.year:a.month-b.month
  );
  if(!sorted.length) return null;
  let bal=0, hasData=false;
  for(const h of sorted){
    if(h.year>year||(h.year===year&&h.month>month)) break;
    bal += (h.income - h.expenses);
    hasData=true;
  }
  return hasData?Math.round(bal*100)/100:null;
}

// Previous month's RUNNING closing balance
function prevMonthBalance(month, year){
  return runningBalance(month, year);
}

function computeStatement(stmtMonth, stmtYear){
  // Tax & penalty apply on the 1st of stmtMonth, calculated on the PREVIOUS month's closing balance
  // Then the current month's income/expenses happen on top of that

  // 1. Previous month's closing balance = the base for tax/penalty calculation
  const prevBal = prevMonthBalance(stmtMonth, stmtYear);

  // 2. Current month's history (income - expenses this month)
  const hm = history.find(h=>h.month===stmtMonth&&h.year===stmtYear);

  // Use global stmtConfig (single permanent config, not per-month entries)
  if(!hm && prevBal===null) return null;

  const prevBalance = prevBal || 0;
  const monthFlow = hm ? Math.round((hm.income - hm.expenses)*100)/100 : 0;

  // Day 1 of this month: charges applied on previous month's closing balance
  let interestCharge=0, maintenanceFee=0;
  if(prevBalance >= 0 && stmtConfig.annualRate){
    interestCharge = -Math.round(prevBalance * (stmtConfig.annualRate/12/100) * 100) / 100;
  } else if(prevBalance < 0 && stmtConfig.overdraftRate){
    interestCharge = -Math.round(Math.abs(prevBalance) * (stmtConfig.overdraftRate/12/100) * 100) / 100;
  }
  if(stmtConfig.maintenanceFeeHigh || stmtConfig.maintenanceFeeLow){
    const threshold = stmtConfig.maintenanceThreshold || 500;
    const fee = prevBalance >= threshold ? stmtConfig.maintenanceFeeHigh : stmtConfig.maintenanceFeeLow;
    maintenanceFee = fee ? -Math.abs(fee) : 0;
  }
  const totalCharges = Math.round((interestCharge + maintenanceFee)*100)/100;

  // Final balance: prev + day-1 charges + rest of month flow
  const balance = Math.round((prevBalance + totalCharges + monthFlow)*100)/100;

  return{
    prevBalance,     // running balance close of previous month
    interestCharge,  // applied day 1
    maintenanceFee,  // applied day 1
    totalCharges,    // total day-1 charges
    monthFlow,       // net flow rest of month (incl. Revolut)
    balance,         // final balance
    hasHistory: hm !== null,
    hasPrevHistory: prevBal !== null,
    month: stmtMonth, year: stmtYear
  };
}

// Get all statement entries grouped by month
function getAllStatements(){
  const stmtEntries=entries.filter(e=>e.type==="statement");
  // Also include months with history even if no entry
  const months=new Set([
    ...stmtEntries.map(e=>`${e.stmtYear}-${e.stmtMonth}`),
    ...history.map(h=>`${h.year}-${h.month}`)
  ]);
  return [...months].sort().reverse().map(key=>{
    const [yr,mo]=[parseInt(key.split("-")[0]),parseInt(key.split("-")[1])];
    return computeStatement(mo,yr);
  }).filter(s=>s!==null);
}

// Render statement card in rHome and stats
function buildStatementSummaryHTML(){
  const now=new Date();
  const s=computeStatement(now.getMonth()+1,now.getFullYear());
  if(!s) return "";

  const color=s.balance>=0?"#2EE8A5":"#FF6B6B";
  const prevColor=s.prevBalance>=0?"#aaa":"#FF6B6B";
  const interestLabel=s.prevBalance>=0
    ?"Interés ("+stmtConfig.annualRate+"% ÷12)"
    :"Interés descubierto ("+stmtConfig.overdraftRate+"% ÷12)";

  const row=(label,color,value,bold=false)=>`
    <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:5px">
      <span style="color:${bold?"#ccc":"#666"};font-weight:${bold?700:400}">${label}</span>
      <span style="font-family:monospace;color:${color};font-weight:${bold?900:700}">${value>=0&&!bold?"+":""}${fmt(value)}</span>
    </div>`;

  return`<div class="card" style="border-color:rgba(232,121,249,.3);background:rgba(232,121,249,.06);margin-bottom:12px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
      <div>
        <div style="font-size:10px;color:#E879F9;letter-spacing:.8px;text-transform:uppercase;margin-bottom:3px">🏦 Estado de cuenta</div>
        <div style="font-size:9px;color:#555">${MF[now.getMonth()]} ${now.getFullYear()}</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <button onclick="openStmtConfig()" style="font-size:11px;padding:5px 12px;border-radius:9px;border:1px solid rgba(232,121,249,.3);background:rgba(232,121,249,.1);color:#E879F9;cursor:pointer;font-family:inherit">⚙ Config</button>
        <div style="font-family:monospace;font-weight:900;font-size:20px;color:${color}">${fmt(s.balance)}</div>
      </div>
    </div>
    ${row("Saldo mes anterior",prevColor,s.prevBalance)}
    ${s.interestCharge!==0?row(interestLabel,"#FF6B6B",s.interestCharge):""}
    ${s.maintenanceFee!==0?row("Cuota de mantenimiento","#FF6B6B",s.maintenanceFee):""}
    ${s.totalCharges!==0?row("= Saldo día 1",s.prevBalance+s.totalCharges>=0?"#888":"#FF6B6B",s.prevBalance+s.totalCharges):""}
    ${s.monthFlow!==0?row("Flujo del mes (incl. Revolut)",s.monthFlow>=0?"#2EE8A5":"#FF6B6B",s.monthFlow):""}
    <div style="border-top:1px solid rgba(255,255,255,.08);margin-top:8px;padding-top:8px;display:flex;justify-content:space-between;font-size:12px">
      <span style="color:#ccc;font-weight:700">Saldo final</span>
      <span style="font-family:monospace;color:${color};font-weight:900">${fmt(s.balance)}</span>
    </div>
    ${!s.hasPrevHistory?`<div style="margin-top:8px;font-size:10px;color:#555">⚠ Sin historial del mes anterior — importa el CSV</div>`:""}
  </div>`;
}


// Open global statement config modal
function openStmtConfig(){
  // Build a simple modal overlay
  let existing=$("stmt-config-modal");
  if(existing) existing.remove();
  const modal=document.createElement("div");
  modal.id="stmt-config-modal";
  modal.style.cssText="position:fixed;inset:0;z-index:300;display:flex;flex-direction:column;justify-content:flex-end";
  modal.innerHTML=`
    <div onclick="this.parentElement.remove()" style="position:absolute;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(8px)"></div>
    <div style="position:relative;background:#131820;border-radius:24px 24px 0 0;padding:20px 20px calc(max(env(safe-area-inset-bottom,0px),20px)+20px);box-shadow:0 -20px 60px rgba(0,0,0,.5)">
      <div style="width:40px;height:4px;border-radius:99px;background:rgba(255,255,255,.15);margin:0 auto 20px"></div>
      <div style="font-weight:800;font-size:17px;margin-bottom:4px">⚙ Estado de cuenta</div>
      <div style="font-size:11px;color:#555;margin-bottom:18px">Cargos aplicados el día 1 de cada mes sobre el saldo del mes anterior</div>
      <div style="margin-bottom:13px">
        <label style="display:block;font-size:10px;color:#666;margin-bottom:5px;letter-spacing:.8px;text-transform:uppercase">Interés anual (%)</label>
        <input id="cfg-annual" type="number" placeholder="ej. 12.5" min="0" step="0.01" value="${stmtConfig.annualRate||""}"
          style="width:100%;background:rgba(255,255,255,.05);border:1.5px solid rgba(255,255,255,.1);border-radius:11px;padding:12px 14px;color:#f0f0f0;font-size:16px;outline:none;font-family:inherit"/>
        <div style="font-size:10px;color:#555;margin-top:4px">Cargo mensual = rate ÷ 12 — aplica cuando el saldo es positivo</div>
      </div>
      <div style="margin-bottom:13px">
        <label style="display:block;font-size:10px;color:#666;margin-bottom:5px;letter-spacing:.8px;text-transform:uppercase">Interés descubierto (% mensual)</label>
        <input id="cfg-overdraft" type="number" placeholder="ej. 17" min="0" step="0.01" value="${stmtConfig.overdraftRate||""}"
          style="width:100%;background:rgba(255,255,255,.05);border:1.5px solid rgba(255,255,255,.1);border-radius:11px;padding:12px 14px;color:#f0f0f0;font-size:16px;outline:none;font-family:inherit"/>
        <div style="font-size:10px;color:#555;margin-top:4px">Cargo mensual = rate ÷ 12 — aplica cuando el saldo es negativo</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:6px">
        <div>
          <label style="display:block;font-size:10px;color:#666;margin-bottom:5px;letter-spacing:.8px;text-transform:uppercase">Cuota si saldo ≥ umbral (€)</label>
          <input id="cfg-fee-high" type="number" placeholder="ej. 2.00" min="0" step="0.01" value="${stmtConfig.maintenanceFeeHigh||""}"
            style="width:100%;background:rgba(255,255,255,.05);border:1.5px solid rgba(255,255,255,.1);border-radius:11px;padding:12px 14px;color:#f0f0f0;font-size:16px;outline:none;font-family:inherit"/>
        </div>
        <div>
          <label style="display:block;font-size:10px;color:#666;margin-bottom:5px;letter-spacing:.8px;text-transform:uppercase">Cuota si saldo < umbral (€)</label>
          <input id="cfg-fee-low" type="number" placeholder="ej. 5.90" min="0" step="0.01" value="${stmtConfig.maintenanceFeeLow||""}"
            style="width:100%;background:rgba(255,255,255,.05);border:1.5px solid rgba(255,255,255,.1);border-radius:11px;padding:12px 14px;color:#f0f0f0;font-size:16px;outline:none;font-family:inherit"/>
        </div>
      </div>
      <div style="margin-bottom:18px">
        <label style="display:block;font-size:10px;color:#666;margin-bottom:5px;letter-spacing:.8px;text-transform:uppercase">Umbral de cuota (€)</label>
        <input id="cfg-threshold" type="number" placeholder="500" min="0" step="1" value="${stmtConfig.maintenanceThreshold||500}"
          style="width:100%;background:rgba(255,255,255,.05);border:1.5px solid rgba(255,255,255,.1);border-radius:11px;padding:12px 14px;color:#f0f0f0;font-size:16px;outline:none;font-family:inherit"/>
        <div style="font-size:10px;color:#555;margin-top:4px">Para BAWAG: €2 si saldo ≥ €500, €5.90 si saldo < €500</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 2fr;gap:10px">
        <button onclick="this.closest('#stmt-config-modal').remove()" style="padding:14px;border-radius:13px;border:1px solid rgba(255,255,255,.1);background:transparent;color:#666;cursor:pointer;font-family:inherit;font-size:15px">Cancelar</button>
        <button onclick="saveStmtConfig()" style="padding:14px;border-radius:13px;border:none;background:linear-gradient(135deg,#E879F9,#9333ea);color:#fff;font-weight:800;cursor:pointer;font-family:inherit;font-size:15px">Guardar</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  setTimeout(()=>modal.querySelector("div:nth-child(2)").style.transform="translateY(0)",10);
}

function saveStmtConfig(){
  stmtConfig.annualRate=parseFloat($("cfg-annual")&&$("cfg-annual").value)||0;
  stmtConfig.overdraftRate=parseFloat($("cfg-overdraft")&&$("cfg-overdraft").value)||0;
  stmtConfig.maintenanceFeeHigh=parseFloat($("cfg-fee-high")&&$("cfg-fee-high").value)||0;
  stmtConfig.maintenanceFeeLow=parseFloat($("cfg-fee-low")&&$("cfg-fee-low").value)||0;
  stmtConfig.maintenanceThreshold=parseFloat($("cfg-threshold")&&$("cfg-threshold").value)||500;
  const modal=$("stmt-config-modal");
  if(modal) modal.remove();
  sc(); render(); push();
  bnr("success","Configuración guardada ✓");
}


// Live preview for debt form — based on contract structure
function calcEffectiveRate(){
  const charge=parseFloat($('fd-known-charge')?.value)||0;
  const bal=parseFloat($('fd-known-balance')?.value)||0;
  const display=$('fd-effective-rate-display');
  const hidden=$('fd-effective-rate');
  if(charge>0&&bal>0){
    const rate=inferEffectiveRate(charge,bal);
    if(display){
      display.style.display='block';
      display.textContent='Tasa efectiva: '+( rate*100).toFixed(4)+'% anual (cargo próximo trimestre con este saldo: '+fmt(bawagQuarterlyCharge(bal,rate))+')';
    }
    if(hidden) hidden.value=rate;
  } else {
    if(display) display.style.display='none';
    if(hidden) hidden.value='';
  }
}

function calcDebtPreview(){
  const orig      = parseFloat($("fd-orig")&&$("fd-orig").value)||0;
  const total     = parseFloat($("fd-total")&&$("fd-total").value)||0;
  const mo        = parseFloat($("fa2")&&$("fa2").value)||0;
  const qcFixed   = parseFloat($("fq")&&$("fq").value)||0;   // cargo fijo (ej. €21.99)
  const rate      = parseFloat($("fi")&&$("fi").value)||0;   // tasa nominal (ej. 11.18)
  const rem       = parseFloat($("fr")&&$("fr").value)||0;
  const terms     = parseInt($("fd-terms")&&$("fd-terms").value)||0;
  const startDate = $("fd-date")&&$("fd-date").value||"";
  const fixedEnd  = $("fd-fixed-end")&&$("fd-fixed-end").value||"";
  // Also read the "real charge" field if user provided it
  const knownCharge = parseFloat($("fd-known-charge")&&$("fd-known-charge").value)||0;

  const prev=$("debt-preview"), rows=$("debt-preview-rows");
  if(!prev||!rows) return;
  if(!mo&&!orig){prev.style.display="none";return;}

  const totalInterest = total>0&&orig>0 ? Math.round((total-orig)*100)/100 : null;

  // Compute actual quarterly charge using BAWAG formula
  let qcTotal=0;
  let qcInterestPart=0;
  if(rate>0&&total>0&&rem>0){
    qcInterestPart=Math.round(((rem*rate*(365.25/4))/total)*100)/100;
    qcTotal=qcInterestPart+qcFixed;
  } else if(knownCharge>0){
    qcTotal=knownCharge;
    qcInterestPart=knownCharge-qcFixed;
  } else if(qcFixed>0){
    qcTotal=qcFixed;
  }

  const netMonthly = qcTotal>0 ? Math.round(((mo*3)-qcTotal)/3*100)/100 : mo;

  let elapsedMonths=0;
  if(startDate){
    const sd=new Date(startDate), now=new Date();
    elapsedMonths=Math.max(0,Math.round((now-sd)/(1000*60*60*24*30.44)));
  }

  let monthsLeft=null;
  if(terms>0&&startDate){
    monthsLeft=Math.max(0,terms-elapsedMonths);
  } else if(rem>0&&netMonthly>0){
    monthsLeft=Math.ceil(rem/netMonthly);
  }

  let endStr="";
  if(monthsLeft){
    const dt=new Date();
    dt.setMonth(dt.getMonth()+monthsLeft);
    endStr=`${MO[dt.getMonth()]} ${dt.getFullYear()}`;
  }

  const pctPaid = orig>0&&rem>=0&&rem<orig ? Math.round((orig-rem)/orig*100) : null;

  const items=[
    totalInterest!==null           ? ["Total de intereses",          fmt(totalInterest),       "#F97316"] : null,
    qcTotal>0&&qcInterestPart>0    ? ["  Parte variable (impuesto)", fmt(qcInterestPart),      "#F97316"] : null,
    qcTotal>0&&qcFixed>0           ? ["  Parte fija (comisión)",     fmt(qcFixed),             "#F97316"] : null,
    qcTotal>0                      ? ["Cargo trimestral TOTAL",      fmt(qcTotal),             "#FF6B6B"] : null,
    qcTotal>0&&mo>0                ? ["Avance real/mes",             fmt(netMonthly),          "#2EE8A5"] : null,
    elapsedMonths>0                ? ["Meses transcurridos",         elapsedMonths+" m",       "#555"   ] : null,
    monthsLeft!==null              ? ["Meses restantes",             monthsLeft+" m",          "#ccc"   ] : null,
    endStr                         ? ["Fin estimado",                endStr,                   "#2EE8A5"] : null,
    fixedEnd                       ? ["Vencto. tipo fijo",           fixedEnd,                 "#A78BFA"] : null,
    pctPaid!==null                 ? ["Amortizado",                  pctPaid+"%",              "#2EE8A5"] : null,
  ].filter(Boolean);

  rows.innerHTML=items.map(([l,v,c])=>`
    <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:6px">
      <span style="color:#666">${l}</span>
      <span style="font-family:monospace;color:${c};font-weight:700">${v}</span>
    </div>`).join("");
  prev.style.display=items.length?"block":"none";
}
// ── INVESTMENT / CRYPTO SYSTEM ────────────────────────────────

// ── SHARED HELPERS ────────────────────────────────────────────
// Annualised ROI from purchase to now
function roiAnnualised(costBasis, currentValue, buyDate){
  if(!costBasis||!currentValue||!buyDate) return null;
  const years=(Date.now()-new Date(buyDate).getTime())/(1000*60*60*24*365.25);
  if(years<0.01) return null;
  return(Math.pow(currentValue/costBasis,1/years)-1)*100;
}

// Format % with sign and color
function fmtPct(p,decimals=1){
  if(p===null||p===undefined||isNaN(p)) return '—';
  const s=p>=0?'+':'';
  return s+p.toFixed(decimals)+'%';
}
function pctColor(p){ return p>=0?'#2EE8A5':'#FF6B6B'; }

// ── PORTFOLIO CHART (donut distribution) ─────────────────────
function drawPortfolioDonut(canvasId, items, colorFn){
  const canvas=$(canvasId);
  if(!canvas) return;
  const ctx=canvas.getContext('2d');
  const size=Math.min(canvas.parentElement?.clientWidth||160,160);
  canvas.width=size; canvas.height=size;
  ctx.clearRect(0,0,size,size);
  const total=items.reduce((a,x)=>a+x.value,0);
  if(!total) return;
  let angle=-Math.PI/2;
  const cx=size/2, cy=size/2, r=size/2-4, inner=r*0.55;
  items.forEach((item,i)=>{
    const sweep=(item.value/total)*2*Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx,cy);
    ctx.arc(cx,cy,r,angle,angle+sweep);
    ctx.closePath();
    ctx.fillStyle=colorFn(i,item);
    ctx.fill();
    angle+=sweep;
  });
  // Inner circle cutout
  ctx.beginPath();
  ctx.arc(cx,cy,inner,0,2*Math.PI);
  ctx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--bg2')||'#131820';
  ctx.fill();
}

// Performance bar chart
function drawPerfChart(canvasId, items, colorFn){
  const canvas=$(canvasId);
  if(!canvas) return;
  const ctx=canvas.getContext('2d');
  const W=canvas.parentElement?.clientWidth||300;
  const H=Math.max(60, items.length*36);
  canvas.width=W; canvas.height=H;
  ctx.clearRect(0,0,W,H);
  const maxAbs=Math.max(...items.map(x=>Math.abs(x.pct||0)),1);
  const midX=W*0.38;
  items.forEach((item,i)=>{
    const y=i*36+8;
    const pct=item.pct||0;
    const barW=Math.abs(pct)/maxAbs*(W-midX-8);
    // Label
    ctx.fillStyle='#888'; ctx.font='11px sans-serif'; ctx.textAlign='right';
    ctx.fillText(item.name.slice(0,14),midX-6,y+14);
    // Bar
    ctx.fillStyle=colorFn(i,item);
    ctx.beginPath();
    ctx.roundRect(pct>=0?midX:midX-barW, y+2, barW, 20, 4);
    ctx.fill();
    // Pct label
    ctx.fillStyle=colorFn(i,item); ctx.textAlign='left';
    ctx.fillText(fmtPct(pct), pct>=0?midX+barW+4:midX+4, y+15);
  });
}

// PORTFOLIO COLORS
const STOCK_COLORS=['#2EE8A5','#38BDF8','#A78BFA','#FFD166','#F97316','#FF6B6B','#34D399','#60A5FA','#C084FC','#FB923C'];
const CRYPTO_COLORS=['#F7931A','#627EEA','#9945FF','#0033AD','#E84142','#00FFA3','#2775CA','#16213E','#EB3349','#26A17B'];

// ── INVESTMENT STATE ──────────────────────────────────────────
let _priceCache={};  // ticker -> {price, currency, priceEur, ts}
let _priceLoading=new Set();

async function fetchAndCachePrice(inv){
  const key=inv.ticker+'|'+inv.assetType;
  const cached=_priceCache[key];
  if(cached&&(Date.now()-cached.ts)<300000) return cached; // 5min cache
  if(_priceLoading.has(key)) return cached||null;
  _priceLoading.add(key);
  try{
    // Use manual price as instant fallback while fetching
    let result=await fetchPrice(inv.ticker, inv.assetType);
    if(!result&&inv.manualPrice){
      result={price:inv.manualPrice,currency:'EUR'};
    }
    if(result){
      const eurRate=await fetchEURRate(result.currency);
      const priceEur=result.price*eurRate;
      const entry={price:result.price,currency:result.currency,priceEur,ts:Date.now(),source:'live'};
      _priceCache[key]=entry;
      _priceLoading.delete(key);
      return entry;
    }
  }catch(e){console.warn('Price fetch failed:',e.message);}
  _priceLoading.delete(key);
  // Fallback to manual price
  if(inv.manualPrice){
    const entry={price:inv.manualPrice,currency:'EUR',priceEur:inv.manualPrice,ts:Date.now(),source:'manual'};
    _priceCache[key]=entry;
    return entry;
  }
  return null;
}

// ── PORTFOLIO CALCULATIONS ────────────────────────────────────
function calcPortfolio(assetType){
  const items=investments.filter(x=>x.assetType===assetType);
  let totalCost=0, totalValue=0;
  const enriched=items.map(inv=>{
    const key=inv.ticker+'|'+inv.assetType;
    const cached=_priceCache[key];
    const priceEur=cached?.priceEur||inv.manualPrice||0;
    const cost=(inv.avgCost||0)*(inv.qty||0);
    const value=priceEur*(inv.qty||0);
    const pnlEur=value-cost;
    const pnlPct=cost>0?(pnlEur/cost)*100:null;
    const roi=roiAnnualised(cost,value,inv.buyDate);
    totalCost+=cost;
    totalValue+=value;
    return{...inv,priceEur,cost,value,pnlEur,pnlPct,roi,loading:!cached&&!inv.manualPrice};
  });
  const totalPnl=totalValue-totalCost;
  const totalPnlPct=totalCost>0?(totalPnl/totalCost)*100:null;
  return{items:enriched,totalCost,totalValue,totalPnl,totalPnlPct};
}

// ── SHARED INVESTMENT TAB RENDERER ────────────────────────────
function renderInvestmentTab(assetType){
  const isStock=assetType==='stock';
  const port=calcPortfolio(assetType);
  const colors=isStock?STOCK_COLORS:CRYPTO_COLORS;
  const colorFn=(i)=>colors[i%colors.length];
  const title=isStock?'Acciones & ETFs':'Crypto';
  const icon=isStock?'📈':'🪙';

  // Header metrics
  const header=`
    <div class="card" style="background:linear-gradient(135deg,rgba(${isStock?'46,232,165':'247,147,26'}, .1),rgba(0,0,0,.0));margin-bottom:14px">
      <div style="font-size:10px;color:#555;letter-spacing:.8px;text-transform:uppercase;margin-bottom:10px">${icon} ${title}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <div style="font-size:10px;color:#555;margin-bottom:3px">Valor actual</div>
          <div style="font-family:monospace;font-weight:900;font-size:18px">${fmt(port.totalValue)}</div>
        </div>
        <div>
          <div style="font-size:10px;color:#555;margin-bottom:3px">Coste total</div>
          <div style="font-family:monospace;font-weight:700;font-size:16px;color:#666">${fmt(port.totalCost)}</div>
        </div>
        <div>
          <div style="font-size:10px;color:#555;margin-bottom:3px">P&L total</div>
          <div style="font-family:monospace;font-weight:800;font-size:16px;color:${pctColor(port.totalPnl)}">${port.totalPnl>=0?'+':''}${fmt(port.totalPnl)}</div>
        </div>
        <div>
          <div style="font-size:10px;color:#555;margin-bottom:3px">P&L %</div>
          <div style="font-family:monospace;font-weight:800;font-size:16px;color:${pctColor(port.totalPnlPct)}">${fmtPct(port.totalPnlPct)}</div>
        </div>
      </div>
    </div>`;

  // Charts
  const donutData=port.items.map((x,i)=>({name:x.ticker,value:x.value,color:colorFn(i)}));
  const perfData=port.items.map((x,i)=>({name:x.name||x.ticker,pct:x.pnlPct,color:colorFn(i)}));

  const chartsHtml=port.items.length>=2?`
    <div class="desktop-grid" style="margin-bottom:14px">
      <div class="cwrap">
        <div style="font-size:11px;font-weight:700;color:#555;letter-spacing:.5px;text-transform:uppercase;margin-bottom:10px">Distribución</div>
        <div style="display:flex;align-items:center;gap:14px">
          <canvas id="c-donut-${assetType}" style="flex-shrink:0"></canvas>
          <div style="font-size:11px;display:flex;flex-direction:column;gap:5px">
            ${port.items.map((x,i)=>`
              <div style="display:flex;align-items:center;gap:6px">
                <div style="width:8px;height:8px;border-radius:50%;background:${colorFn(i)};flex-shrink:0"></div>
                <span style="color:#888">${x.ticker}</span>
                <span style="font-family:monospace;color:#aaa;margin-left:auto">${port.totalValue>0?((x.value/port.totalValue)*100).toFixed(1)+'%':'—'}</span>
              </div>`).join('')}
          </div>
        </div>
      </div>
      <div class="cwrap">
        <div style="font-size:11px;font-weight:700;color:#555;letter-spacing:.5px;text-transform:uppercase;margin-bottom:10px">Rendimiento</div>
        <canvas id="c-perf-${assetType}"></canvas>
      </div>
    </div>`:'';

  // Asset list
  const listHtml=port.items.length?port.items.map((inv,i)=>{
    const isManual=(_priceCache[inv.ticker+'|'+inv.assetType]?.source==='manual')||(!_priceCache[inv.ticker+'|'+inv.assetType]&&inv.manualPrice);
    return`<div class="card" style="margin-bottom:10px">
      <div style="display:flex;align-items:flex-start;gap:12px">
        <div style="width:40px;height:40px;border-radius:12px;background:${colorFn(i)}22;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:13px;color:${colorFn(i)};flex-shrink:0">${(inv.ticker||'?').slice(0,3)}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span style="font-weight:700;font-size:14px">${inv.ticker}</span>
            ${isManual?'<span style="font-size:9px;background:rgba(255,213,102,.15);color:#FFD166;border-radius:4px;padding:1px 5px">manual</span>':''}
            ${inv.loading?'<span style="font-size:9px;color:#555">cargando…</span>':''}
          </div>
          <div style="font-size:11px;color:#555;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${inv.name||''}</div>
          <div style="display:flex;gap:12px;margin-top:6px;flex-wrap:wrap">
            <div style="font-size:11px;color:#555">${inv.qty} uds · coste med. ${fmt(inv.avgCost)}</div>
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-family:monospace;font-weight:800;font-size:15px">${fmt(inv.value)}</div>
          <div style="font-size:12px;color:${pctColor(inv.pnlPct)};font-family:monospace;font-weight:700">${fmtPct(inv.pnlPct)}</div>
          <div style="font-size:11px;color:${pctColor(inv.pnlEur)};font-family:monospace">${inv.pnlEur>=0?'+':''}${fmt(inv.pnlEur)}</div>
        </div>
      </div>
      <div style="border-top:1px solid rgba(255,255,255,.06);margin-top:10px;padding-top:8px;display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:11px;color:#555">
          Precio actual: <span style="font-family:monospace;color:#aaa">${inv.priceEur?fmt(inv.priceEur):'—'}</span>
          ${inv.roi!==null&&inv.roi!==undefined?'· ROI anualizado: <span style="font-family:monospace;color:'+pctColor(inv.roi)+'">'+fmtPct(inv.roi)+'</span>':''}
        </div>
        <div style="display:flex;gap:6px">
          <button onclick="refreshInvPrice('${inv.id}')" style="padding:4px 10px;border-radius:7px;border:1px solid rgba(255,255,255,.1);background:transparent;color:#555;font-size:11px;cursor:pointer;font-family:inherit">↻</button>
          <button onclick="openEditInv('${inv.id}')" style="padding:4px 10px;border-radius:7px;border:1px solid rgba(255,255,255,.1);background:transparent;color:#aaa;font-size:11px;cursor:pointer;font-family:inherit">✎</button>
          <button onclick="deleteInv('${inv.id}')" style="padding:4px 10px;border-radius:7px;border:1px solid rgba(255,107,107,.2);background:transparent;color:#FF6B6B;font-size:11px;cursor:pointer;font-family:inherit">✕</button>
        </div>
      </div>
    </div>`;
  }).join(''):`<div class="empty"><div style="font-size:36px;margin-bottom:8px">${icon}</div>
    <div style="font-size:14px;color:#555">Sin ${title.toLowerCase()}</div>
    <div style="font-size:12px;color:#444;margin-top:4px">Añade tu primera posición con +</div>
  </div>`;

  $("con").innerHTML=header+chartsHtml+listHtml+'<div style="height:20px"></div>';

  // Draw charts after render
  if(port.items.length>=2){
    setTimeout(()=>{
      drawPortfolioDonut('c-donut-'+assetType, donutData, colorFn);
      drawPerfChart('c-perf-'+assetType, perfData, colorFn);
    },50);
  }

  // Fetch prices in background and refresh
  let needsRefresh=false;
  Promise.all(port.items.map(inv=>fetchAndCachePrice(inv).then(r=>{if(r)needsRefresh=true;}))).then(()=>{
    if(needsRefresh) renderInvestmentTab(assetType);
  });
}

function rStocks(){ renderInvestmentTab('stock'); }
function rCrypto(){ renderInvestmentTab('crypto'); }

// ── ADD / EDIT INVESTMENT ─────────────────────────────────────
function openAddInv(assetType){
  const isStock=assetType==='stock';
  openSheet('Nueva '+(isStock?'posición':'crypto'),`
    <div class="f">
      <label class="fl">Ticker / Símbolo</label>
      <div style="position:relative">
        <input id="inv-ticker-input" type="text" placeholder="${isStock?'ej. AAPL, VOW3.DE':'ej. BTC, ETH, SOL'}"
          oninput="searchInvTicker(this.value,'${assetType}')" autocomplete="off" autocorrect="off"
          style="width:100%;background:rgba(255,255,255,.05);border:1.5px solid rgba(255,255,255,.1);border-radius:12px;padding:14px;color:#f0f0f0;font-size:16px;outline:none;font-family:inherit"/>
        <div id="inv-ticker-results" style="display:none;position:absolute;top:100%;left:0;right:0;background:#1a2030;border:1px solid rgba(255,255,255,.1);border-radius:12px;z-index:100;max-height:200px;overflow-y:auto;margin-top:4px"></div>
      </div>
      <input type="hidden" id="inv-ticker-val"/>
      <input type="hidden" id="inv-name-val"/>
    </div>
    <div class="f"><label class="fl">Nombre (se rellena automático)</label><input id="inv-display-name" type="text" placeholder="ej. Apple Inc."/></div>
    <div class="fg">
      <div class="f" style="margin-bottom:0"><label class="fl">Cantidad / unidades</label><input id="inv-qty" type="number" placeholder="10" min="0" step="any"/></div>
      <div class="f" style="margin-bottom:0"><label class="fl">Coste medio (€/ud)</label><input id="inv-avg-cost" type="number" placeholder="150.00" min="0" step="any"/></div>
    </div>
    <div class="f"><label class="fl">Fecha de primera compra</label><input id="inv-buy-date" type="date" value="${new Date().toISOString().slice(0,10)}"/></div>
    <div class="f"><label class="fl">Precio manual (€) — opcional, fallback si no carga online</label>
      <input id="inv-manual-price" type="number" placeholder="déjalo vacío para buscar online" min="0" step="any"/></div>
    <input type="hidden" id="inv-asset-type" value="${assetType}"/>
    <button class="bsv" style="background:linear-gradient(135deg,#2EE8A5,#0097a7);color:#001a10" onclick="saveInv()">Añadir posición</button>
  `);
}

function openEditInv(id){
  const inv=investments.find(x=>String(x.id)===String(id));
  if(!inv) return;
  openSheet('Editar posición',`
    <div class="f"><label class="fl">Ticker</label><input id="inv-ticker-input" value="${inv.ticker}" readonly style="width:100%;background:rgba(255,255,255,.05);border:1.5px solid rgba(255,255,255,.1);border-radius:12px;padding:14px;color:#aaa;font-size:16px;outline:none;font-family:inherit"/><input type="hidden" id="inv-ticker-val" value="${inv.ticker}"/><input type="hidden" id="inv-name-val" value="${inv.name||''}"/></div>
    <div class="f"><label class="fl">Nombre</label><input id="inv-display-name" type="text" value="${inv.name||''}"/></div>
    <div class="fg">
      <div class="f" style="margin-bottom:0"><label class="fl">Cantidad</label><input id="inv-qty" type="number" value="${inv.qty||0}" min="0" step="any"/></div>
      <div class="f" style="margin-bottom:0"><label class="fl">Coste medio (€/ud)</label><input id="inv-avg-cost" type="number" value="${inv.avgCost||0}" min="0" step="any"/></div>
    </div>
    <div class="f"><label class="fl">Fecha primera compra</label><input id="inv-buy-date" type="date" value="${inv.buyDate||''}"/></div>
    <div class="f"><label class="fl">Precio manual (€) — sobreescrito cuando se encuentre online</label>
      <input id="inv-manual-price" type="number" value="${inv.manualPrice||''}" min="0" step="any"/></div>
    <input type="hidden" id="inv-asset-type" value="${inv.assetType}"/>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px">
      <button class="bsv" style="background:rgba(255,107,107,.12);color:#FF6B6B;border:1px solid rgba(255,107,107,.3)" onclick="deleteInv('${id}')">Eliminar</button>
      <button class="bsv" style="background:linear-gradient(135deg,#2EE8A5,#0097a7);color:#001a10" onclick="saveInv('${id}')">Guardar</button>
    </div>
  `);
}

// Ticker search for investments
let _invSearchTimer=null;
function searchInvTicker(query, assetType){
  clearTimeout(_invSearchTimer);
  const results=$('inv-ticker-results');
  if(!query||query.length<1){if(results)results.style.display='none';return;}
  _invSearchTimer=setTimeout(async()=>{
    if(!results) return;
    results.innerHTML='<div style="padding:10px;color:#555;font-size:12px">Buscando…</div>';
    results.style.display='block';
    try{
      // Try Finnhub search first
      const fhUrl=`https://finnhub.io/api/v1/search?q=${encodeURIComponent(query)}&token=demo`;
      const res=await fetch(fhUrl,{signal:AbortSignal.timeout(5000)});
      if(res.ok){
        const d=await res.json();
        if(d.result?.length){
          const filtered=d.result.filter(r=>assetType==='crypto'?r.type==='Crypto':r.type!=='Crypto').slice(0,6);
          window._invTickerResults=filtered;
          results.innerHTML=filtered.map((r,i)=>`
            <div onclick="selectInvTicker(${i})" style="padding:10px 12px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.05);font-size:13px" onmouseover="this.style.background='rgba(255,255,255,.05)'" onmouseout="this.style.background=''">
              <span style="font-weight:700;color:#f0f0f0">${r.symbol}</span>
              <span style="color:#555;margin-left:6px;font-size:11px">${r.description||''}</span>
            </div>`).join('');
          return;
        }
      }
    }catch{}
    // Fallback: just use the typed value
    results.innerHTML=`<div onclick="useRawTicker('${query}')" style="padding:10px 12px;cursor:pointer;font-size:13px" onmouseover="this.style.background='rgba(255,255,255,.05)'" onmouseout="this.style.background=''">
      Usar "<strong>${query}</strong>" como ticker
    </div>`;
  },350);
}

function selectInvTicker(idx){
  const r=(window._invTickerResults||[])[idx];
  if(!r) return;
  const tickerInput=$('inv-ticker-input');
  const tickerVal=$('inv-ticker-val');
  const nameVal=$('inv-name-val');
  const displayName=$('inv-display-name');
  if(tickerInput) tickerInput.value=r.symbol;
  if(tickerVal) tickerVal.value=r.symbol;
  if(nameVal) nameVal.value=r.description||r.symbol;
  if(displayName&&!displayName.value) displayName.value=r.description||r.symbol;
  const results=$('inv-ticker-results');
  if(results) results.style.display='none';
}

function useRawTicker(q){
  const tickerInput=$('inv-ticker-input');
  const tickerVal=$('inv-ticker-val');
  if(tickerInput) tickerInput.value=q.toUpperCase();
  if(tickerVal) tickerVal.value=q.toUpperCase();
  const results=$('inv-ticker-results');
  if(results) results.style.display='none';
}

function saveInv(editId){
  const ticker=($('inv-ticker-val')?.value||$('inv-ticker-input')?.value||'').trim().toUpperCase();
  const name=($('inv-display-name')?.value||$('inv-name-val')?.value||ticker).trim();
  const qty=parseFloat($('inv-qty')?.value)||0;
  const avgCost=parseFloat($('inv-avg-cost')?.value)||0;
  const buyDate=$('inv-buy-date')?.value||'';
  const manualPrice=parseFloat($('inv-manual-price')?.value)||0;
  const assetType=$('inv-asset-type')?.value||'stock';
  if(!ticker){bnr('error','Introduce un ticker');return;}
  if(!qty){bnr('error','Introduce la cantidad');return;}
  if(editId){
    const inv=investments.find(x=>String(x.id)===String(editId));
    if(inv){Object.assign(inv,{name,qty,avgCost,buyDate,manualPrice:manualPrice||0});
      // Clear price cache to force refresh
      delete _priceCache[inv.ticker+'|'+inv.assetType];
    }
  } else {
    const id=Date.now();
    investments.push({id,ticker,name,qty,avgCost,buyDate,manualPrice:manualPrice||0,assetType});
  }
  sc();push();closeSheet();
  if(assetType==='stock') rStocks(); else rCrypto();
}

function deleteInv(id){
  investments=investments.filter(x=>String(x.id)!==String(id));
  const assetType=(investments.find(x=>String(x.id)===String(id))?.assetType)||'stock';
  sc();push();closeSheet();
  // Re-render whichever tab is active
  if(tab===5) rStocks(); else if(tab===6) rCrypto();
}

async function refreshInvPrice(id){
  const inv=investments.find(x=>String(x.id)===String(id));
  if(!inv) return;
  const key=inv.ticker+'|'+inv.assetType;
  delete _priceCache[key]; // Force refresh
  bnr('loading','Actualizando precio…');
  const result=await fetchAndCachePrice(inv);
  if(result){bnr('success',`${inv.ticker}: ${fmt(result.priceEur)}/ud`);}
  else{bnr('error','No se encontró precio online');}
  if(tab===5) rStocks(); else if(tab===6) rCrypto();
}


// ── DEUDAS TAB ────────────────────────────────────────────────

function rDebts(){
  const debts=entries.filter(e=>e.type==='debt');
  const now=new Date();

  if(!debts.length){
    $("con").innerHTML=`
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div style="font-size:11px;font-weight:700;color:#555;letter-spacing:.8px;text-transform:uppercase">Deudas</div>
        <button onclick="openSheet()" style="padding:8px 14px;border-radius:11px;border:1px solid rgba(249,115,22,.3);background:rgba(249,115,22,.08);color:#F97316;font-weight:700;font-size:12px;cursor:pointer;font-family:inherit">+ Deuda</button>
      </div>
      <div class="empty"><div style="font-size:36px;margin-bottom:8px">💳</div>
        <div style="font-size:14px;color:#555">Sin deudas registradas</div>
        <div style="font-size:12px;color:#444;margin-top:4px">Añade un préstamo o crédito</div>
      </div>`;
    return;
  }

  // Global totals
  const totalRemaining=debts.reduce((a,d)=>a+((parseFloat(d.remaining)||0)),0);
  const totalMonthly=debts.reduce((a,d)=>a+(parseFloat(d.amount)||0),0);

  // Build each debt card
  const cards=debts.map(d=>{
    const cd=computeDebt(d);
    const paidPct=cd.pctPaid||0;
    const barColor=paidPct>66?'#2EE8A5':paidPct>33?'#FFD166':'#F97316';

    // Quarterly projection table (next 4 quarters)
    let projTable='';
    if(cd.projectedCharges?.length){
      projTable=`
        <div style="margin-top:12px;border-top:1px solid rgba(255,255,255,.06);padding-top:10px">
          <div style="font-size:10px;color:#555;font-weight:700;letter-spacing:.5px;text-transform:uppercase;margin-bottom:8px">Próximos cargos trimestrales</div>
          ${cd.projectedCharges.map(q=>`
            <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.03)">
              <span style="font-size:11px;color:#555">T${q.quarter} — saldo ${fmt(q.remaining)}</span>
              <div style="text-align:right">
                <span style="font-family:monospace;font-size:12px;font-weight:700;color:#F97316">${fmt(q.charge)}</span>
                <span style="font-size:10px;color:#555;margin-left:6px">avance ${fmt((d.amount*3-q.charge)/3)}/mes</span>
              </div>
            </div>`).join('')}
        </div>`;
    }

    // Key metrics row
    const metrics=[
      cd.netMonthly&&cd.quarterlyCharge?{label:'Avance real/mes',value:fmt(cd.netMonthly),color:'#2EE8A5'}:null,
      cd.quarterlyCharge?{label:'Cargo trimestral',value:fmt(cd.quarterlyCharge),color:'#F97316'}:null,
      cd.monthsLeft?{label:'Meses restantes',value:cd.monthsLeft+' m',color:'#aaa'}:null,
      cd.endDate?{label:'Fin estimado',value:cd.endDate,color:'#A78BFA'}:null,
      cd.totalInterest?{label:'Interés total',value:fmt(cd.totalInterest),color:'#F97316'}:null,
      cd.interestRate?{label:'Tasa nominal',value:cd.interestRate+'%',color:'#555'}:null,
    ].filter(Boolean);

    return`<div class="card" style="margin-bottom:14px;border-color:rgba(249,115,22,.2);background:rgba(249,115,22,.04)">
      <!-- Header -->
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:800;font-size:15px">${d.name}</div>
          <div style="font-size:11px;color:#555;margin-top:2px">
            ${fmt(d.amount)}/mes
            ${d.startDate?'· desde '+d.startDate:''}
            ${d.fixedRateEnd?'· tipo fijo hasta '+d.fixedRateEnd:''}
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0;margin-left:12px">
          <div style="font-family:monospace;font-weight:900;font-size:20px;color:#F97316">${fmt(cd.rem)}</div>
          <div style="font-size:10px;color:#555;margin-top:1px">pendiente</div>
        </div>
      </div>

      <!-- Progress bar -->
      <div style="background:rgba(255,255,255,.07);border-radius:99px;height:6px;margin-bottom:8px">
        <div style="background:linear-gradient(90deg,${barColor},${barColor}88);height:100%;border-radius:99px;width:${paidPct}%;transition:width .3s"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:10px;color:#444;margin-bottom:12px">
        <span>0%</span>
        <span style="color:${barColor};font-weight:700">${paidPct}% amortizado</span>
        <span>100%</span>
      </div>

      <!-- Metrics grid -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:${projTable?0:4}px">
        ${metrics.map(m=>`
          <div style="background:rgba(255,255,255,.03);border-radius:10px;padding:8px 10px">
            <div style="font-size:9px;color:#555;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">${m.label}</div>
            <div style="font-family:monospace;font-weight:700;font-size:13px;color:${m.color}">${m.value}</div>
          </div>`).join('')}
      </div>

      ${projTable}

      <!-- Actions -->
      <div style="display:flex;gap:6px;margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,.06)">
        <button onclick="openEntry('${d.id}')" style="flex:1;padding:8px;border-radius:9px;border:1px solid rgba(255,255,255,.1);background:transparent;color:#aaa;font-size:12px;cursor:pointer;font-family:inherit">✎ Editar</button>
        <button onclick="go(3)" style="flex:1;padding:8px;border-radius:9px;border:1px solid rgba(249,115,22,.2);background:rgba(249,115,22,.06);color:#F97316;font-size:12px;cursor:pointer;font-family:inherit">Ver en recurrentes →</button>
      </div>
    </div>`;
  }).join('');

  // Summary header card
  const summary=`
    <div class="card" style="background:linear-gradient(135deg,rgba(249,115,22,.1),rgba(0,0,0,0));margin-bottom:16px;border-color:rgba(249,115,22,.2)">
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
        <div>
          <div style="font-size:9px;color:#555;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Deudas activas</div>
          <div style="font-family:monospace;font-weight:900;font-size:20px;color:#F97316">${debts.length}</div>
        </div>
        <div>
          <div style="font-size:9px;color:#555;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Total pendiente</div>
          <div style="font-family:monospace;font-weight:800;font-size:16px;color:#F97316">${fmt(totalRemaining)}</div>
        </div>
        <div>
          <div style="font-size:9px;color:#555;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Cuota mensual</div>
          <div style="font-family:monospace;font-weight:800;font-size:16px;color:#FF6B6B">${fmt(totalMonthly)}/mes</div>
        </div>
      </div>
    </div>`;

  $("con").innerHTML=`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:#555;letter-spacing:.8px;text-transform:uppercase">Deudas</div>
      <button onclick="openSheet()" style="padding:8px 14px;border-radius:11px;border:1px solid rgba(249,115,22,.3);background:rgba(249,115,22,.08);color:#F97316;font-weight:700;font-size:12px;cursor:pointer;font-family:inherit">+ Deuda</button>
    </div>
    ${summary}${cards}
    <div style="height:20px"></div>
  `;
}

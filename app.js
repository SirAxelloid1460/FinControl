const API="https://script.google.com/macros/s/AKfycbx1RZEZN3aI5YWrSeoh9Jt9vFcT1DN772pC_IJDUHqFwO5wgVrPQpXoMamqqzw5PWv_/exec";
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
function computeDebt(d){
  const orig=parseFloat(d.origAmount)||0;
  const total=parseFloat(d.totalAmount)||0;
  const mo=parseFloat(d.amount)||0;       // monthly payment
  const rem=parseFloat(d.remaining)||0;
  const startDate=d.startDate||null;

  // Total interest = total to repay − original
  const totalInterest=total>0&&orig>0?Math.round((total-orig)*100)/100:null;

  // Quarterly charge: if the bank charges quarterly interest
  // = total interest / (loan duration in quarters)
  // We derive it from: total = orig + quarterlyCharge * numQuarters
  // numQuarters = total duration in months / 3
  // duration = total / monthly payment (approx)
  let quarterlyCharge=parseFloat(d.quarterlyCharge)||0;
  let interestRate=parseFloat(d.interestRate)||0;

  const totalTerms=parseInt(d.totalTerms)||0; // fixed number of instalments if known

  if(total>0&&orig>0&&mo>0&&!quarterlyCharge){
    // Use fixed terms if provided, else derive from total/monthly
    const durationMonths=totalTerms>0?totalTerms:Math.round(total/mo);
    const numQuarters=Math.floor(durationMonths/3);
    if(numQuarters>0) quarterlyCharge=Math.round((totalInterest/numQuarters)*100)/100;
  }

  // Net monthly capital progress = (monthly*3 - quarterlyCharge) / 3
  const netMonthly=quarterlyCharge>0?Math.round((mo*3-quarterlyCharge)/3*100)/100:mo;

  // Months remaining: if fixed terms, use remaining terms; else derive from balance
  // Elapsed months since start
  let elapsedMonths=0;
  if(startDate){
    const sd=new Date(startDate),now=new Date();
    elapsedMonths=Math.max(0,Math.round((now-sd)/(1000*60*60*24*30.44)));
  }
  let monthsLeft=null;
  if(totalTerms>0&&startDate){
    monthsLeft=Math.max(0,totalTerms-elapsedMonths);
  } else if(rem>0&&netMonthly>0){
    monthsLeft=Math.ceil(rem/netMonthly);
  }

  // End date
  let endDate=null;
  if(monthsLeft){
    const dt=new Date();dt.setMonth(dt.getMonth()+monthsLeft);
    endDate=`${MO[dt.getMonth()]} ${dt.getFullYear()}`;
  }

  // % paid = (original - remaining) / original
  const pctPaid=orig>0&&rem>=0?Math.max(0,Math.min(100,Math.round((orig-rem)/orig*100))):null;

  return{orig,total,mo,rem,totalInterest,quarterlyCharge,interestRate,netMonthly,monthsLeft,totalTerms,elapsedMonths,endDate,pctPaid,startDate};
}

function debtNetMonthly(mo,quarterlyCharge){
  return quarterlyCharge>0?Math.round((mo*3-quarterlyCharge)/3*100)/100:mo;
}

let entries=[],history=[],revolut=[],investments=[],savings_account=[],stmtConfig={annualRate:0,overdraftRate:0,maintenanceFeeHigh:0,maintenanceFeeLow:0,maintenanceThreshold:500},tab=0,filter="all",editId=null,ctype="expense",syncing=false,statsYear=new Date().getFullYear();

const lc=()=>{try{const d=JSON.parse(localStorage.getItem("fc_v5"));return d||{entries:[],history:[],revolut:[],investments:[],savings_account:[],stmtConfig:{annualRate:0,overdraftRate:0,maintenanceFeeHigh:0,maintenanceFeeLow:0,maintenanceThreshold:500}};}catch{return{entries:[],history:[],revolut:[],investments:[]};}};
const sc=()=>{try{localStorage.setItem("fc_v5",JSON.stringify({entries,history,revolut,investments,savings_account,stmtConfig}));}catch{}};

function bnr(type,txt){const b=$("bnr");b.className="show "+type;$("bic").innerHTML=type==="loading"?`<span class="sp">⟳</span>`:type==="success"?"✓":"✕";$("btx").textContent=txt;if(type!=="loading")setTimeout(()=>{b.className="";},3500);}
function sbs(state){$("sbtn").className="sbtn "+(state||"");$("sbi").innerHTML=state==="syncing"?`<span class="sp">⟳</span>`:state==="ok"?"✓":state==="err"?"✕":"⟳";}

function jsonpGet(){return new Promise((resolve,reject)=>{const cb="fc_cb_"+Date.now(),s=document.createElement("script");const t=setTimeout(()=>{cleanup();reject(new Error("timeout"));},12000);function cleanup(){clearTimeout(t);delete window[cb];if(s.parentNode)s.parentNode.removeChild(s);}window[cb]=d=>{cleanup();resolve(d);};s.onerror=()=>{cleanup();reject(new Error("err"));};s.src=API+"?callback="+cb+"&t="+Date.now();document.head.appendChild(s);});}
function postData(payload){return fetch(API,{method:"POST",mode:"no-cors",headers:{"Content-Type":"text/plain"},body:JSON.stringify(payload)});}

function toRows(){const rows=[];entries.forEach(e=>rows.push(["entry",JSON.stringify(e)]));history.forEach(h=>rows.push(["history",JSON.stringify(h)]));revolut.forEach(r=>rows.push(["revolut",JSON.stringify(r)]));investments.forEach(i=>rows.push(["investment",JSON.stringify(i)]));savings_account.forEach(s=>rows.push(["saving",JSON.stringify(s)]));rows.push(["stmtconfig",JSON.stringify(stmtConfig)]);return rows;}
function fromRows(rows){
  const ent=[],hist=[],rev=[],inv=[],sav_acc=[],sc_cfg={};
  const KINDS=new Set(["entry","history","revolut","investment","saving","stmtconfig"]);
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
      else if(first==="stmtconfig"&&d){Object.assign(sc_cfg,d);}
    }catch{}
  });
  return{entries:ent,history:hist,revolut:rev,investments:inv,savings_account:sav_acc,stmtConfig:sc_cfg};
}

async function syncNow(){
  if(syncing)return;
  syncing=true;sbs("syncing");
  bnr("loading","Conectando con Google Sheets…");
  try{
    const raw=await jsonpGet();
    const rem=fromRows(raw);

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
  else if(tab===2)$("con").innerHTML=rHistory();
  else if(tab===3)$("con").innerHTML=rList();
  else if(tab===4)rPatrimonio();
  else if(tab===5)rSavingsTab();
  if(tab===1)setTimeout(drawCharts,50);
  if(tab===4){setTimeout(drawRevolutChart,100);}
  if(tab===5)setTimeout(drawSavingsChart,100);
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
    dh+=`<div class="card" style="background:rgba(249,115,22,.07);border-color:rgba(249,115,22,.2)">
      <div style="display:flex;justify-content:space-between;margin-bottom:7px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:13px">${d.name}</div>
          <div style="font-size:10px;color:#555;margin-top:1px">${fmt(cd.mo)}/mes · termina ${cd.endDate||"—"}</div>
          ${cd.quarterlyCharge>0?`<div style="font-size:10px;color:#F97316;margin-top:1px">⚡ Cargo trimestral: ${fmt(cd.quarterlyCharge)} · Avance real: ${fmt(cd.netMonthly)}/mes</div>`:""}
          ${cd.orig>0?`<div style="font-size:10px;color:#555;margin-top:1px">Monto original: ${fmt(cd.orig)}${cd.totalInterest?` · Interés total: ${fmt(cd.totalInterest)}`:""}${cd.startDate?` · Desde: ${cd.startDate}`:""}${d.totalTerms?` · ${d.totalTerms} plazos`:""}${d.fixedRateEnd?` · Tipo fijo hasta ${d.fixedRateEnd}`:""}</div>`:""}
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-family:monospace;font-weight:800;font-size:15px;color:#F97316">${fmt(cd.rem)}</div>
          ${cd.monthsLeft?`<div style="font-size:9px;color:#555;margin-top:1px">${cd.monthsLeft} meses</div>`:""}
        </div>
      </div>
      <div style="background:rgba(255,255,255,.07);border-radius:99px;height:5px"><div style="background:linear-gradient(90deg,#F97316,#FFD166);height:100%;border-radius:99px;width:${paidPct}%"></div></div>
      <div style="display:flex;justify-content:space-between;margin-top:3px">
        <span style="font-size:9px;color:#555">Saldo actual</span>
        <span style="font-size:9px;color:#555">${m?Math.ceil(m/3)+" pagos trimestrales restantes":""}</span>
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
    fc+=`<div class="${cls}" style="${isPast&&!isn?"opacity:.7":""}">
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
  const ybtns=years.map(y=>`<button class="yb${y===statsYear?" active":""}" onclick="statsYear=${y};rStats();setTimeout(drawCharts,50)">${y}</button>`).join("");
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
function rHistory(){
  const sorted=[...history].sort((a,b)=>a.year!==b.year?b.year-a.year:b.month-a.month);
  return`<div class="import-area" id="dra" onclick="$('cfi').click()" ondragover="event.preventDefault();this.classList.add('drag')" ondragleave="this.classList.remove('drag')" ondrop="hdrop(event)">
    <input type="file" id="cfi" accept=".csv,.txt" onchange="hfile(this.files[0])"/>
    <div style="font-size:28px;margin-bottom:7px">📂</div>
    <div style="font-weight:700;font-size:13px;margin-bottom:3px">Importar estado de cuenta</div>
    <div style="font-size:11px;color:#555">Toca para seleccionar · Arrastra tu CSV aquí</div>
    <div style="font-size:10px;color:#444;margin-top:5px">Optimizado para CSV de BAWAG · Importa varios meses a la vez</div>
  </div>
  ${!sorted.length?`<div class="empty"><div style="font-size:36px;margin-bottom:8px">🕐</div><div style="font-size:13px;color:#444">Sin historial importado</div></div>`:""}
  ${sorted.map(h=>{const bal=h.income-h.expenses,hid=`hm${h.id}`;return`<div class="hm">
    <div class="hmh" onclick="thm('${hid}')">
      <div><div style="font-weight:700;font-size:13px">${MF[h.month-1]} ${h.year}</div><div style="font-size:10px;color:#555;margin-top:1px">${(h.transactions||[]).length} transacciones${(()=>{const mc=(h.transactions||[]).filter(t=>t.matched).length;const mi=(h.transactions||[]).filter(t=>t.matched&&t.matched.type==="__internal__").length;const mr=mc-mi;return(mr>0?` <span style="color:#FFD166">· ${mr} registradas</span>`:"")+( mi>0?` <span style="color:#38BDF8">· ${mi} internas</span>`:"");})()}</div></div>
      <div style="text-align:right">
          <div style="font-family:monospace;font-weight:800;font-size:14px;color:${bal>=0?"#2EE8A5":"#FF6B6B"}">${fmt(bal)}</div>
          <div style="font-size:9px;color:#555;margin-top:1px">↑${fmt(h.income)} ↓${fmt(h.expenses)}</div>
        </div>
    </div>
    <div class="hmb" id="${hid}">
      ${(h.transactions||[]).slice(0,40).map(t=>{
        const isMatched=t.matched;
        const isInternal=isMatched&&isMatched.type==="__internal__";
        const badgeColor=isInternal?"color:#38BDF8;background:rgba(56,189,248,.12);border-color:rgba(56,189,248,.3)":"color:#FFD166;background:rgba(255,213,102,.12);border-color:rgba(255,213,102,.3)";
        const matchLabel=isMatched?`<span style="font-size:9px;${badgeColor};border:1px solid;border-radius:5px;padding:1px 5px;margin-left:5px;flex-shrink:0">${isMatched.name.substring(0,16)}</span>`:"";
        return`<div class="hr" style="${isMatched?"opacity:.5":""}">
          <span style="color:${isMatched?"#555":"#aaa"};flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px">${t.desc}</span>
          ${matchLabel}
          <span style="font-family:monospace;font-weight:700;color:${t.type==="income"?"#2EE8A5":"#FF6B6B"};margin-left:8px;flex-shrink:0;font-size:11px">${t.type==="income"?"+":"−"}${fmt(t.amount)}</span>
        </div>`;}).join("")}
      ${(h.transactions||[]).length>40?`<div style="font-size:10px;color:#555;text-align:center;padding:6px 0">+${h.transactions.length-40} transacciones más</div>`:""}
      <button onclick="delHist(${h.id})" style="width:100%;margin-top:9px;padding:7px;border-radius:9px;border:1px solid rgba(255,107,107,.2);background:rgba(255,107,107,.08);color:#FF6B6B;cursor:pointer;font-size:11px;font-family:inherit">Eliminar este mes</button>
    </div></div>`;}).join("")}
  <div style="height:20px"></div>`;
}
function thm(id){const el=$(id);if(el)el.classList.toggle("open");}
function hdrop(e){e.preventDefault();$("dra").classList.remove("drag");const f=e.dataTransfer.files[0];if(f)hfile(f);}
function hfile(file){
  if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    const text=e.target.result;
    const results=importCSV(text);
    if(!results||!results.length){bnr("error","No se pudieron leer datos. Verifica que el archivo sea el CSV de BAWAG.");return;}
    // Merge: replace existing months, keep others
    results.forEach(result=>{
      history=history.filter(h=>!(h.year===result.year&&h.month===result.month));
      history.push(result);
    });
    const totalTx=results.reduce((a,b)=>a+b.transactions.length,0);
    const months=results.map(r=>`${MF[r.month-1]} ${r.year}`).join(", ");
    retagHistory();
    bnr("success",`${totalTx} transacciones importadas — ${months} ✓`);
    render();push();
  };
  reader.readAsText(file,"latin1");
}
function delHist(id){if(!confirm("¿Eliminar este mes?"))return;history=history.filter(h=>h.id!==id);render();push();}

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

  // Recurrent = rules that repeat every month (not tied to a specific month/year)
  const RECURRENT_TYPES=new Set(["income","monthly","annual","debt","savings"]);
  // Current month = variable income for this month + one-off expenses
  const CURRENT_TYPES=new Set(["expense","variable"]);

  const recurrent=entries.filter(e=>RECURRENT_TYPES.has(e.type));
  const currentMonth=entries.filter(e=>{
    if(e.type==="expense") return true;
    if(e.type==="variable"&&parseInt(e.varMonth)===curM&&parseInt(e.varYear)===curY) return true;
    return false;
  });
  // Past variable entries (other months)
  const pastVariable=entries.filter(e=>
    e.type==="variable"&&!(parseInt(e.varMonth)===curM&&parseInt(e.varYear)===curY)
  );

  const totRec=recurrent.reduce((a,e)=>{
    const isOut=e.type!=="income"&&e.type!=="savings";
    return a+(isOut?-e.amount:e.amount);
  },0);
  const totCur=currentMonth.reduce((a,e)=>{
    const isOut=e.type!=="income"&&e.type!=="variable"&&e.type!=="savings";
    return a+(isOut?-e.amount:e.amount);
  },0);

  const secTitle=(label,color,total,addBtn)=>`
    <div style="display:flex;align-items:center;justify-content:space-between;margin:16px 0 10px">
      <div class="sec" style="margin-bottom:0;color:${color}">${label}</div>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-family:monospace;font-size:12px;font-weight:700;color:${total>=0?"#2EE8A5":"#FF6B6B"}">${total>=0?"+":""}${fmt(total)}</span>
        ${addBtn?`<button onclick="openSheet()" style="font-size:11px;padding:4px 11px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.05);color:#aaa;cursor:pointer;font-family:inherit">+</button>`:""}
      </div>
    </div>`;

  const empty=`<div style="text-align:center;padding:16px;color:#333;font-size:12px">Sin registros · toca + para agregar</div>`;

  return`
    ${secTitle("↻ RECURRENTES","#888",totRec,false)}
    ${recurrent.length?recurrent.map(entryCard).join(""):empty}

    ${secTitle("📅 ESTE MES — ${MF[now.getMonth()]} ${curY}","#888",totCur,true)}
    ${currentMonth.length?currentMonth.map(entryCard).join(""):empty}

    ${pastVariable.length?`
      <div style="margin:14px 0 10px">
        <div class="sec" style="color:#555">SUELDOS ANTERIORES</div>
      </div>
      ${pastVariable.sort((a,b)=>b.varYear!==a.varYear?b.varYear-a.varYear:b.varMonth-a.varMonth).map(entryCard).join("")}
    `:""}
    <div style="height:20px"></div>`;
}

// ── NAV ──────────────────────────────────────────────────────
function go(t){tab=t;[0,1,2,3,4,5].forEach(i=>{$(`n${i}`)&&($(`n${i}`).className="nb"+(t===i?" active":""));$(`d${i}`)&&($(`d${i}`).style.display=t===i?"block":"none");});render();}
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
function openSheet(){editId=null;ctype="expense";$("sttl").textContent="Nuevo registro";["fn","fa","fa2","fd","fr","fq","fi","fkw","fno","f-tax-rate","f-penalty-rate","f-adjustment","f-stmt-kw","fd-orig","fd-total","fd-date","fd-terms","fd-fixed-end"].forEach(id=>$(id)&&($(id).value=""));_isFixed=true;$("f-stmt-month")&&($("f-stmt-month").value=new Date().getMonth()+1);$("f-stmt-year")&&($("f-stmt-year").value=new Date().getFullYear());if($("debt-preview"))$("debt-preview").style.display="none";$("fvm").value=new Date().getMonth()+1;$("fvy").value=new Date().getFullYear();$("fd").value=new Date().getDate();$("fm").value=new Date().getMonth()+1;buildTG();updSh();$("ov").classList.add("open");setTimeout(()=>$("sh").classList.add("open"),20);}
function editEntry(id){const e=entries.find(x=>x.id===id);if(!e)return;editId=id;ctype=e.type;$("sttl").textContent="Editar registro";buildTG();updSh();$("fn").value=e.name||"";$("fa").value=e.amount||"";$("fa2").value=e.amount||"";$("fd").value=e.day||"";$("fr").value=e.remaining||"";$("fq").value=e.quarterlyCharge||"";$("fi").value=e.interestRate||"";$("fm").value=e.month||new Date().getMonth()+1;$("fvm").value=e.varMonth||new Date().getMonth()+1;$("fvy").value=e.varYear||new Date().getFullYear();$("fkw").value=e.keywords||"";$("fno").value=e.note||"";setFixed(e.fixedAmount!==false);if($("fd-orig"))$("fd-orig").value=e.origAmount||"";if($("fd-total"))$("fd-total").value=e.totalAmount||"";if($("fd-date"))$("fd-date").value=e.startDate||"";if($("fd-terms"))$("fd-terms").value=e.totalTerms||"";if($("fd-fixed-end"))$("fd-fixed-end").value=e.fixedRateEnd||"";if($("debt-preview"))$("debt-preview").style.display="none";if(e.type==="debt")setTimeout(calcDebtPreview,50);if($("f-tax-rate"))$("f-tax-rate").value=e.taxRate||"";if($("f-penalty-rate"))$("f-penalty-rate").value=e.penaltyRate||"";if($("f-adjustment"))$("f-adjustment").value=e.adjustment||"";if($("f-stmt-month"))$("f-stmt-month").value=e.stmtMonth||new Date().getMonth()+1;if($("f-stmt-year"))$("f-stmt-year").value=e.stmtYear||new Date().getFullYear();if($("f-stmt-kw"))$("f-stmt-kw").value=e.stmtKeywords||"";$("ov").classList.add("open");setTimeout(()=>$("sh").classList.add("open"),20);}
function closeSheet(){$("sh").classList.remove("open");setTimeout(()=>$("ov").classList.remove("open"),300);}
function bgc(e){if(e.target===$("ovbg"))closeSheet();}
async function saveEntry(){
  const name=$("fn").value.trim();
  if(!name){bnr("error","Completa el nombre");return;}
  // For debts use fa2 (cuota mensual) as the amount, fa is hidden
  const isDebt=ctype==="debt";
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
(async()=>{const s=lc();entries=s.entries;history=s.history;revolut=s.revolut||[];investments=s.investments||[];savings_account=s.savings_account||[];if(s.stmtConfig)Object.assign(stmtConfig,s.stmtConfig);retagHistory();render();$("d0").style.display="block";["d1","d2","d3","d4","d5"].forEach(id=>$(id)&&($(id).style.display="none"));
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

async function fetchPrice(ticker){
  const t=ticker.toUpperCase();
  // Try Finnhub first (no CORS issues)
  const r1=await fetchPriceFromFinnhub(t);
  if(r1?.price) return r1;
  // Fallback to Yahoo proxy
  const r2=await fetchPriceFromYahooProxy(t);
  if(r2?.price) return r2;
  // Try crypto with USDT suffix on Finnhub
  if(!t.includes("-")&&!t.includes(":")){
    const r3=await fetchPriceFromFinnhub(t+"-USD");
    if(r3?.price) return r3;
  }
  return{price:null,currency:"EUR"};
}

async function fetchEURRate(currency){
  return fetchEURRatePublic(currency);
}

// ── PATRIMONIO TAB ────────────────────────────────────────────
async function rPatrimonio(){
  $("con").innerHTML=buildPatrimonioHTML();
  // Async: fetch live prices for investments
  await refreshInvestmentPrices();
}

function getCurrentRevolutBalance(){
  if(!revolut.length) return 0;
  // Get the most recent month's balance
  const sorted=[...revolut].sort((a,b)=>a.year!==b.year?b.year-a.year:b.month-a.month);
  return sorted[0].balance||0;
}

function getTotalInvestments(){
  return investments.reduce((a,b)=>a+(parseFloat(b.valueEUR)||0),0);
}

function getTotalDebt(){
  return entries.filter(e=>e.type==="debt").reduce((a,b)=>a+(parseFloat(b.remaining)||0),0);
}

function getCurrentBawagBalance(){
  // Approximate: sum of last 3 months net from history
  const now=new Date();
  const sorted=[...history].sort((a,b)=>a.year!==b.year?b.year-a.year:b.month-a.month);
  return sorted.length?sorted[0].balance:0;
}

function buildPatrimonioHTML(){
  const revBal=getCurrentRevolutBalance();
  const invTotal=getTotalInvestments();
  const debtTotal=getTotalDebt();
  const bawagBal=getCurrentBawagBalance();
  const netWorth=bawagBal+revBal+invTotal-debtTotal;

  // Revolut monthly chart data
  const revSorted=[...revolut].sort((a,b)=>a.year!==b.year?a.year-b.year:a.month-b.month);

  // Build revolut months HTML
  const MF2=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const revMonthsHTML=revSorted.slice().reverse().map(h=>{
    const hid=`rm${h.year}${h.month}`;
    const internalCount=h.transactions.filter(t=>t.internal).length;
    return`<div class="hm">
      <div class="hmh" onclick="thm('${hid}')">
        <div>
          <div style="font-weight:700;font-size:13px">${MF2[h.month-1]} ${h.year}</div>
          <div style="font-size:10px;color:#555;margin-top:1px">${h.transactions.length} movimientos · ${internalCount} transferencias internas</div>
        </div>
        <div style="text-align:right">
          <div style="font-family:monospace;font-weight:800;font-size:14px;color:#38BDF8">${fmt(h.balance)}</div>
          <div style="font-size:9px;color:#555;margin-top:1px">↑${fmt(h.income)} ↓${fmt(h.expenses)}</div>
        </div>
      </div>
      <div class="hmb" id="${hid}">
        ${h.transactions.map(t=>`
          <div class="hr" style="${t.internal?"opacity:.4":""}">
            <span style="font-size:11px;color:${t.internal?"#555":"#aaa"};flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.desc}</span>
            ${t.internal?`<span style="font-size:9px;color:#555;margin-left:6px;flex-shrink:0">interno</span>`:""}
            <span style="font-family:monospace;font-weight:700;font-size:11px;color:${t.type==="income"?"#38BDF8":"#FF6B6B"};margin-left:8px;flex-shrink:0">${t.type==="income"?"+":"−"}${fmt(t.amount)}</span>
          </div>`).join("")}
        <button onclick="deleteRevolut(${h.id})" style="width:100%;margin-top:9px;padding:7px;border-radius:9px;border:1px solid rgba(255,107,107,.2);background:rgba(255,107,107,.08);color:#FF6B6B;cursor:pointer;font-size:11px;font-family:inherit">Eliminar este mes</button>
      </div>
    </div>`;
  }).join("");

  // Investments HTML
  const invHTML=investments.length?investments.map(inv=>`
    <div class="card" style="display:flex;align-items:center;gap:12px" id="inv-${inv.id}">
      <div style="width:38px;height:38px;border-radius:11px;background:rgba(255,213,102,.1);border:1px solid rgba(255,213,102,.2);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:#FFD166;flex-shrink:0">${inv.ticker.substring(0,3)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:13px">${inv.name}</div>
        <div style="font-size:10px;color:#555;margin-top:1px">${inv.ticker} · ${inv.quantity} unidades · <span id="price-${inv.id}" style="color:#FFD166">cargando...</span></div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-family:monospace;font-weight:800;font-size:14px;color:#FFD166" id="val-${inv.id}">${fmt(inv.valueEUR||0)}</div>
        <button onclick="deleteInvestment(${inv.id})" style="font-size:10px;color:#FF6B6B;background:none;border:none;cursor:pointer;font-family:inherit;margin-top:2px">eliminar</button>
      </div>
    </div>`).join("")
    :`<div style="text-align:center;padding:20px;color:#444;font-size:13px">Sin inversiones registradas</div>`;

  return`
  <!-- NET WORTH HERO -->
  <div class="hero" style="background:linear-gradient(145deg,#1a2035,#0f1825)">
    <div class="glow" style="background:radial-gradient(circle,rgba(56,189,248,.12),transparent 70%)"></div>
    <div style="font-size:10px;color:#666;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Patrimonio neto total</div>
    <div style="font-family:monospace;font-weight:900;font-size:32px;letter-spacing:-1px;color:${netWorth>=0?"#38BDF8":"#FF6B6B"};margin-bottom:16px">${fmt(netWorth)}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      ${[["BAWAG (último mes)","#2EE8A5",bawagBal],["Revolut","#38BDF8",revBal],["Inversiones","#FFD166",invTotal],["Deudas","#FF6B6B",-debtTotal]].map(([l,c,v])=>`
        <div style="background:rgba(255,255,255,.04);border-radius:10px;padding:10px 12px">
          <div style="font-size:9px;color:#555;text-transform:uppercase;letter-spacing:.6px;margin-bottom:3px">${l}</div>
          <div style="font-family:monospace;font-weight:800;font-size:14px;color:${v>=0?c:"#FF6B6B"}">${fmt(v)}</div>
        </div>`).join("")}
    </div>
  </div>

  <!-- REVOLUT SECTION -->
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
    <div class="sec" style="margin-bottom:0">💎 Revolut — ${fmt(revBal)}</div>
    <button onclick="$('rev-import-input').click()" style="font-size:11px;padding:5px 12px;border-radius:9px;border:1px solid rgba(56,189,248,.3);background:rgba(56,189,248,.08);color:#38BDF8;cursor:pointer;font-family:inherit">+ Importar CSV</button>
  </div>
  <input type="file" id="rev-import-input" accept=".csv" style="display:none" onchange="handleRevolutFile(this.files[0])"/>

  <!-- Revolut balance chart -->
  ${revSorted.length>1?`<div class="cwrap" style="margin-bottom:12px">
    <div class="ctitle">Evolución saldo Revolut</div>
    <canvas id="c-rev" height="110"></canvas>
  </div>`:""}

  ${revMonthsHTML||`<div style="text-align:center;padding:20px;color:#444;font-size:13px">Sin datos de Revolut. Importa un CSV.</div>`}

  <!-- INVESTMENTS SECTION -->
  <div style="display:flex;align-items:center;justify-content:space-between;margin:16px 0 10px">
    <div class="sec" style="margin-bottom:0">📈 Inversiones — ${fmt(invTotal)}</div>
    <button onclick="openAddInvestment()" style="font-size:11px;padding:5px 12px;border-radius:9px;border:1px solid rgba(255,213,102,.3);background:rgba(255,213,102,.08);color:#FFD166;cursor:pointer;font-family:inherit">+ Agregar</button>
  </div>
  ${invHTML}

  <!-- ADD INVESTMENT FORM (hidden by default) -->
  <div id="add-inv-form" style="display:none;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:16px;margin-top:10px">
    <div style="font-weight:700;font-size:13px;margin-bottom:12px">Nueva inversión</div>
    <div class="f" style="margin-bottom:6px">
      <label class="fl">Buscar acción / fondo / crypto</label>
      <div style="position:relative">
        <input id="inv-search" type="text" placeholder="Escribe nombre o símbolo: Fincantieri, BTC, JUP..."
          oninput="searchTicker(this.value)"
          style="width:100%;background:rgba(255,255,255,.05);border:1.5px solid rgba(255,255,255,.1);border-radius:10px;padding:11px 36px 11px 13px;color:#f0f0f0;font-size:15px;outline:none;font-family:inherit"/>
        <span id="inv-search-spin" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);font-size:14px;color:#555;display:none">⟳</span>
      </div>
      <div id="ticker-results" style="display:none;background:#1a2030;border:1px solid rgba(255,255,255,.12);border-radius:10px;margin-top:4px;overflow:hidden;max-height:220px;overflow-y:auto"></div>
    </div>
    <div id="inv-selected" style="display:none;background:rgba(255,213,102,.07);border:1px solid rgba(255,213,102,.25);border-radius:10px;padding:10px 13px;margin-bottom:12px;font-size:12px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <span style="font-weight:700;color:#FFD166" id="sel-name">—</span>
          <span style="color:#555;margin-left:6px" id="sel-ticker-display">—</span>
        </div>
        <button onclick="clearTickerSelection()" style="background:none;border:none;color:#555;cursor:pointer;font-size:14px;font-family:inherit">✕</button>
      </div>
      <div style="color:#666;font-size:10px;margin-top:2px" id="sel-exchange">—</div>
    </div>
    <input type="hidden" id="inv-ticker"/>
    <input type="hidden" id="inv-name"/>
    <div class="fg" style="margin-bottom:12px">
    <div class="fg" style="margin-bottom:12px">
      <div class="f" style="margin-bottom:0"><label class="fl">Cantidad / unidades</label><input id="inv-qty" type="number" placeholder="10" min="0" step="any"/></div>
      <div class="f" style="margin-bottom:0"><label class="fl">Tipo</label>
        <select id="inv-type" style="width:100%;background:rgba(255,255,255,.05);border:1.5px solid rgba(255,255,255,.1);border-radius:10px;padding:11px 13px;color:#f0f0f0;font-size:15px;outline:none;font-family:inherit">
          <option value="stock">Acción/ETF</option>
          <option value="crypto">Crypto</option>
          <option value="fund">Fondo</option>
        </select>
      </div>
    </div>
    <div class="f" style="margin-bottom:12px">
      <label class="fl">Precio manual (€) — opcional si no carga automático</label>
      <input id="inv-manual-price" type="number" placeholder="ej. 182.50 — déjalo vacío para buscar online" min="0" step="any"/>
    </div>
    <div class="fg">
      <button onclick="$('add-inv-form').style.display='none'" style="flex:1;padding:11px;border-radius:11px;border:1px solid rgba(255,255,255,.1);background:transparent;color:#666;cursor:pointer;font-family:inherit">Cancelar</button>
      <button onclick="saveInvestment()" style="flex:2;padding:11px;border-radius:11px;border:none;background:linear-gradient(135deg,#FFD166,#F97316);color:#000;font-weight:800;cursor:pointer;font-family:inherit">Guardar</button>
    </div>
  </div>


  <div style="height:20px"></div>`;
}

// Draw Revolut balance chart
function drawRevolutChart(){
  const c=$("c-rev");if(!c)return;
  c.width=c.parentElement.clientWidth-28;
  const ctx=c.getContext("2d"),w=c.width,h=c.height;
  ctx.clearRect(0,0,w,h);
  const sorted=[...revolut].sort((a,b)=>a.year!==b.year?a.year-b.year:a.month-b.month);
  if(sorted.length<2)return;
  const bals=sorted.map(r=>r.balance);
  const labels=sorted.map(r=>MO[r.month-1]);
  const minB=Math.min(...bals,0),maxB=Math.max(...bals,1),range=maxB-minB||1;
  const lpad=8,lpb=18,lch=h-lpb-6;
  const pts=bals.map((b,i)=>({x:lpad+i*(w-lpad*2)/(sorted.length-1),y:5+((maxB-b)/range)*lch}));
  const grad=ctx.createLinearGradient(0,0,0,h);
  grad.addColorStop(0,"rgba(56,189,248,.2)");grad.addColorStop(1,"rgba(56,189,248,0)");
  ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);pts.forEach(p=>ctx.lineTo(p.x,p.y));
  ctx.lineTo(pts[pts.length-1].x,h-lpb);ctx.lineTo(pts[0].x,h-lpb);
  ctx.closePath();ctx.fillStyle=grad;ctx.fill();
  ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);pts.forEach(p=>ctx.lineTo(p.x,p.y));
  ctx.strokeStyle="#38BDF8";ctx.lineWidth=2;ctx.stroke();
  pts.forEach((p,i)=>{
    ctx.beginPath();ctx.arc(p.x,p.y,3,0,Math.PI*2);ctx.fillStyle="#38BDF8";ctx.fill();
    ctx.fillStyle="#555";ctx.font="8px DM Sans";ctx.textAlign="center";ctx.fillText(labels[i],p.x,h-4);
  });
}

// Revolut file handler
function handleRevolutFile(file){
  if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    const results=importRevolutCSV(e.target.result);
    if(!results||!results.length){bnr("error","No se pudieron leer datos de Revolut.");return;}
    results.forEach(r=>{
      revolut=revolut.filter(x=>!(x.year===r.year&&x.month===r.month));
      revolut.push(r);
    });
    const total=results.reduce((a,b)=>a+b.transactions.length,0);
    bnr("success",`${total} movimientos Revolut importados ✓`);
    sc();rPatrimonio();drawRevolutChart();push();
  };
  reader.readAsText(file,"UTF-8");
}

function deleteRevolut(id){
  if(!confirm("¿Eliminar este mes de Revolut?"))return;
  revolut=revolut.filter(r=>r.id!==id);
  sc();rPatrimonio();push();
}

// Investment management
function openAddInvestment(){
  $("add-inv-form").style.display="block";
  $("inv-search").value="";
  $("ticker-results").style.display="none";
  $("inv-selected").style.display="none";
  $("inv-ticker").value="";
  $("inv-name").value="";
  $("inv-qty").value="";
  if($("inv-manual-price")) $("inv-manual-price").value="";
  _selectedTicker=null;
  $("add-inv-form").scrollIntoView({behavior:"smooth"});
  setTimeout(()=>$("inv-search").focus(),300);
}

async function saveInvestment(){
  const rawTicker=($("inv-ticker").value||"").trim().toUpperCase();
  const ticker=KNOWN_TICKERS[rawTicker]||rawTicker;
  const name=($("inv-name").value||"").trim()||ticker;
  const qty=parseFloat($("inv-qty").value)||0;
  if(!ticker){bnr("error","Selecciona una acción de los resultados de búsqueda");return;}
  const manualPrice=parseFloat($("inv-manual-price")&&$("inv-manual-price").value)||0;
  const type=$("inv-type").value||"stock";
  if(!ticker||!qty){bnr("error","Completa ticker y cantidad");return;}
  let price=manualPrice||0,currency="EUR",valueEUR=0;
  if(!manualPrice){
    bnr("loading","Buscando precio de "+ticker+"…");
    const result=await fetchPrice(ticker);
    price=result.price||0;
    currency=result.currency||"EUR";
  }
  if(price){
    const rate=currency==="EUR"?1:(await fetchEURRate(currency))||0.92;
    valueEUR=Math.round(price*qty*rate*100)/100;
  }
  const inv={id:Date.now(),ticker,name,quantity:qty,type,price,currency,valueEUR,manualPrice:!!manualPrice,updatedAt:new Date().toISOString()};
  investments=investments.filter(i=>i.ticker!==ticker);
  investments.push(inv);
  $("add-inv-form").style.display="none";
  sc();
  if(price){bnr("success",`${ticker}: ${fmt(valueEUR)} EUR ✓`);}
  else{bnr("error",`Precio no encontrado para ${ticker}. Usa el campo de precio manual.`);}
  rPatrimonio();setTimeout(drawRevolutChart,50);push();
}

function deleteInvestment(id){
  if(!confirm("¿Eliminar esta inversión?"))return;
  investments=investments.filter(i=>i.id!==id);
  sc();rPatrimonio();setTimeout(drawRevolutChart,50);push();
}

async function refreshInvestmentPrices(){
  setTimeout(drawRevolutChart,50);
  if(!investments.length)return;
  for(const inv of investments){
    const el=$(`price-${inv.id}`);
    const valEl=$(`val-${inv.id}`);
    if(!el)continue;
    // Skip if manually priced
    if(inv.manualPrice){
      el.textContent=`${(inv.price||0).toFixed(2)} ${inv.currency||"EUR"} (manual)`;
      continue;
    }
    el.innerHTML=`<span class="sp">⟳</span>`;
    const result=await fetchPrice(inv.ticker);
    if(result.price){
      const rate=result.currency==="EUR"?1:((await fetchEURRate(result.currency))||0.92);
      const valueEUR=Math.round(result.price*inv.quantity*rate*100)/100;
      inv.valueEUR=valueEUR;inv.price=result.price;inv.currency=result.currency;
      inv.updatedAt=new Date().toISOString();
      el.textContent=`${result.price.toFixed(2)} ${result.currency}`;
      if(valEl)valEl.textContent=fmt(valueEUR);
    } else {
      el.textContent="sin precio — edita para añadir manual";
      el.style.color="#FF6B6B";
    }
  }
  sc();
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
function projectSavings(currentBalance, dailyRate, months, monthlyDeposit=0){
  if(!dailyRate) return currentBalance;
  const days=Math.round(months*30.44);
  let bal=currentBalance;
  for(let d=0;d<days;d++){
    if(d>0&&d%30===0) bal+=monthlyDeposit;
    bal+=bal*dailyRate;
  }
  return Math.round(bal*100)/100;
}

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
  if(tab===5) rSavingsTab();
  else{const el=$("savings-summary-block");if(el)el.innerHTML=buildSavingsSummaryHTML();}
  setTimeout(drawSavingsChart,50);
  push();
  bnr("success","Movimiento guardado ✓");
}

function deleteSavingsEntry(id){
  if(!confirm("¿Eliminar este movimiento?"))return;
  savings_account=savings_account.filter(e=>e.id!==id);
  sc();
  if(tab===5) rSavingsTab();
  else{const el=$("savings-summary-block");if(el)el.innerHTML=buildSavingsSummaryHTML();}
  setTimeout(drawSavingsChart,50);
  push();
}


// ── SAVINGS TAB ───────────────────────────────────────────────
function rSavingsTab(){
  $("con").innerHTML=`
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
    <div>
      <div style="font-size:10px;color:#555;letter-spacing:.8px;text-transform:uppercase;margin-bottom:2px">Cuenta de ahorro</div>
      <div style="font-weight:900;font-size:20px;letter-spacing:-.5px;color:#2EE8A5">Revolut Savings</div>
    </div>
    <button onclick="openSavingsEntry()" style="padding:9px 16px;border-radius:12px;border:1px solid rgba(46,232,165,.3);background:rgba(46,232,165,.1);color:#2EE8A5;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit">+ Añadir</button>
  </div>

  <!-- ADD SAVINGS ENTRY FORM -->
  <div id="savings-form" style="display:none;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:16px;margin-bottom:14px">
    <div style="font-weight:700;font-size:14px;margin-bottom:14px;color:#f0f0f0">Nuevo movimiento</div>
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
  setTimeout(drawSavingsChart,50);
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
function calcDebtPreview(){
  const orig  = parseFloat($("fd-orig")&&$("fd-orig").value)||0;
  const total = parseFloat($("fd-total")&&$("fd-total").value)||0;
  const mo    = parseFloat($("fa2")&&$("fa2").value)||0;
  const qc    = parseFloat($("fq")&&$("fq").value)||0;
  const rem   = parseFloat($("fr")&&$("fr").value)||0;
  const terms = parseInt($("fd-terms")&&$("fd-terms").value)||0;
  const startDate = $("fd-date")&&$("fd-date").value||"";
  const fixedEnd  = $("fd-fixed-end")&&$("fd-fixed-end").value||"";

  const prev=$("debt-preview"), rows=$("debt-preview-rows");
  if(!prev||!rows) return;
  if(!mo&&!orig){prev.style.display="none";return;}

  const totalInterest = total>0&&orig>0 ? Math.round((total-orig)*100)/100 : null;
  const netMonthly    = qc>0 ? Math.round(((mo*3)-qc)/3*100)/100 : mo;

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
    totalInterest!==null           ? ["Total de intereses",      fmt(totalInterest),     "#F97316"] : null,
    qc>0                           ? ["Cargo trimestral",        fmt(qc),                "#F97316"] : null,
    qc>0&&mo>0                     ? ["Avance neto/mes",         fmt(netMonthly),        "#aaa"   ] : null,
    elapsedMonths>0                ? ["Meses transcurridos",     elapsedMonths+" m",     "#555"   ] : null,
    monthsLeft!==null              ? ["Meses restantes",         monthsLeft+" m",        "#ccc"   ] : null,
    endStr                         ? ["Fin estimado",            endStr,                 "#2EE8A5"] : null,
    fixedEnd                       ? ["Vencto. tipo fijo",       fixedEnd,               "#A78BFA"] : null,
    pctPaid!==null                 ? ["Amortizado",              pctPaid+"%",            "#2EE8A5"] : null,
  ].filter(Boolean);

  rows.innerHTML=items.map(([l,v,c])=>`
    <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:6px">
      <span style="color:#666">${l}</span>
      <span style="font-family:monospace;color:${c};font-weight:700">${v}</span>
    </div>`).join("");
  prev.style.display=items.length?"block":"none";
}
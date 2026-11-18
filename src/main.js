(function(){
"use strict";
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const store={get(k,d){try{const v=localStorage.getItem("grr."+k);return v?JSON.parse(v):d}catch(e){return d}},set(k,v){try{localStorage.setItem("grr."+k,JSON.stringify(v))}catch(e){}}};

/* ---------- settings ---------- */
const DEF={base:"ראשון לציון – גן הורדים",baseAddr:"",baseLa:null,baseLo:null,minPrice:249,includedKm:20,rate1:4.5,tier1Until:80,rate2:3.5,evening:50,offhours:100,heavy:50,complex:50,urgent:50,rounding:"9",vat:18,floorPct:8,fuelPerKm:1.1,traffic:20,handlingMin:25,monthlyGoal:100,phone:"054-9338228"};
let S=Object.assign({},DEF,store.get("settings",{}));
let LOG=store.get("log",[]);

/* ---------- places ---------- */
const norm=s=>(s||"").replace(/["'׳״`]/g,"").replace(/[\-–—,]/g," ").replace(/\s+/g," ").trim();
const P=PLACES.map(([n,la,lo,al])=>({n,la,lo,city:n.split(" – ")[0],key:norm(n+" "+(al||"")),prec:"lo"}));
const byName=Object.fromEntries(P.map(p=>[p.n,p]));
const CITIES=[...new Set(P.map(p=>p.city))].sort((a,b)=>b.length-a.length);
const ALIAS=[[/ראשל"?צ|רשל"?צ|ראשלצ|רשלצ/g,"ראשון לציון"],[/ת"א|תא(?=\s|$)/g,"תל אביב"],[/פ"ת|פת(?=\s|$)/g,"פתח תקווה"],[/ב"ש/g,"באר שבע"],[/נס-ציונה/g,"נס ציונה"]];
const expand=q=>ALIAS.reduce((s,[r,t])=>s.replace(r,t),q);
function base(){if(S.baseLa!=null)return{n:S.baseAddr||"הבסיס",la:+S.baseLa,lo:+S.baseLo};return byName[S.base]||P[0]}
function localFind(q){q=norm(expand(q));if(!q)return[];const w=q.split(" ");return P.map(p=>{let sc=0;if(norm(p.n)===q)sc=100;else if(p.key.startsWith(q))sc=60;else if(w.every(x=>p.key.includes(x)))sc=30;return{p,sc}}).filter(x=>x.sc).sort((a,b)=>b.sc-a.sc||a.p.n.length-b.p.n.length).slice(0,5).map(x=>x.p)}
function detectCity(q){const nq=" "+norm(q)+" ";for(const c of CITIES){if(nq.includes(" "+norm(c)+" "))return c}return null}
const sameCity=(a,b)=>{a=norm(a).replace(/ יפו$/,"");b=norm(b).replace(/ יפו$/,"");return!!a&&!!b&&(a===b||a.startsWith(b)||b.startsWith(a))};

/* ---------- distance ---------- */
function hav(a,b){const R=6371,t=Math.PI/180,dLa=(b.la-a.la)*t,dLo=(b.lo-a.lo)*t;const h=Math.sin(dLa/2)**2+Math.cos(a.la*t)*Math.cos(b.la*t)*Math.sin(dLo/2)**2;return 2*R*Math.asin(Math.sqrt(h))}
function estKm(a,b,floor){const d=hav(a,b);const f=d<10?1.35:d<40?1.25:1.18;return Math.max(d*f,floor)}
const estMin=km=>km/(km<15?28:km<40?45:70)*60;

/* ---------- online lookups (address search + road routing) ---------- */
let online=null; /* null = unknown, true/false after first try */
async function getJSON(url,ms,signal){const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);if(signal)signal.addEventListener("abort",()=>c.abort());try{const r=await fetch(url,{signal:c.signal});if(!r.ok)throw new Error(r.status);return await r.json()}finally{clearTimeout(t)}}
const BBOX="34.2,29.4,35.95,33.4";
function toItem(f){const p=f.properties,[lo,la]=f.geometry.coordinates;const city=p.city||p.locality||p.district||p.county||"";
  const addr=p.street?(p.street+(p.housenumber?" "+p.housenumber:"")):"";
  const isHouse=!!p.housenumber, isStreet=p.osm_key==="highway"||p.type==="street";
  const title=p.name&&p.name!==p.street?p.name:(addr||p.name||city);
  const sub=[p.name&&p.name!==p.street&&addr?addr:"",city].filter(Boolean).join(", ");
  return{n:[title,sub].filter(Boolean).join(", "),title,sub,la,lo,city,prec:isHouse||(p.name&&!isStreet)?"hi":isStreet?"mid":"lo"}}
async function photon(q,bias,signal){const u=`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=15&lat=${bias.la}&lon=${bias.lo}&zoom=14&location_bias_scale=0.1&bbox=${BBOX}`;
  const d=await getJSON(u,7000,signal);return d.features.map(toItem).filter(x=>x.title)}
async function remoteSearch(raw,signal){
  const m=raw.match(/(-?\d{1,2}\.\d{3,})\s*[, ]\s*(-?\d{1,3}\.\d{3,})/);
  if(m){const la=+m[1],lo=+m[2];return[{n:`נקודה במפה (${la.toFixed(4)}, ${lo.toFixed(4)})`,title:"נקודה ממיקום ששלח הלקוח",sub:`${la.toFixed(4)}, ${lo.toFixed(4)}`,la,lo,prec:"hi"}]}
  const q=expand(raw);const city=detectCity(q);
  const cityPlace=city?P.find(p=>p.city===city):null;const bias=cityPlace||base();
  const text=city?norm(q.replace(new RegExp(city.replace(/[-–]/g,".")),"")):norm(q);
  if(!text&&cityPlace)return[];
  let res=(await Promise.all([photon(text||q,bias,signal),city&&text?photon(q,bias,signal).catch(()=>[]):[]])).flat();
  if(city)res=res.filter(r=>sameCity(r.city,city));
  if(city&&!res.length&&/\d/.test(text)){const street=norm(text.replace(/\d+[א-ת]?/g,""));if(street){res=(await photon(street,bias,signal)).filter(r=>sameCity(r.city,city)&&r.prec!=="lo");res.forEach(r=>{r.prec="mid";r.note="המספר לא במפה, נבחר הרחוב"})}}
  const seen=new Set();res=res.filter(r=>{const k=r.n;if(seen.has(k))return false;seen.add(k);return true});
  const rank={hi:0,mid:1,lo:2};res.sort((a,b)=>rank[a.prec]-rank[b.prec]);
  return res.slice(0,6);
}
const routeCache=new Map();
async function roadRoute(pts){const key=pts.map(p=>p.la.toFixed(4)+","+p.lo.toFixed(4)).join(";");if(routeCache.has(key))return routeCache.get(key);
  const u=`https://router.project-osrm.org/route/v1/driving/${pts.map(p=>p.lo+","+p.la).join(";")}?overview=false`;
  const d=await getJSON(u,8000);if(d.code!=="Ok")throw new Error(d.code);
  const r=d.routes[0].legs.map(l=>({km:l.distance/1000,min:l.duration/60}));routeCache.set(key,r);return r}

/* ---------- time mode ---------- */
let modeManual=null, extras={heavy:false,complex:false,urgent:false};
function autoMode(d=new Date()){const day=d.getDay(),h=d.getHours()+d.getMinutes()/60;if(day===6)return"sat";if(day===5)return"off";if(h>=6&&h<18)return"day";if(h>=18&&h<21)return"eve";return"off"}
function mode(){const a=autoMode();return modeManual||(a==="sat"?"off":a)}

/* ---------- pricing ---------- */
function roundP(x){const r=S.rounding;if(r==="50")return Math.ceil(x/50)*50;if(r==="10")return Math.ceil(x/10)*10;return Math.ceil((x+1)/10)*10-1}
let manualKm=null, legs=null, legsSrc="est", routing=false;
function quote(pick,dest){
  const B=base();
  let L=legs||[[B,pick,2],[pick,dest,3],[dest,B,2]].map(([x,y,f])=>{const km=estKm(x,y,f);return{km,min:estMin(km)}});
  const a=L[0].km,l=manualKm!=null?manualKm:L[1].km,b=L[2].km;
  const cycle=a+l+b;
  const extraKm=Math.max(0,cycle-S.includedKm);
  const k1=Math.min(extraKm,Math.max(0,S.tier1Until-S.includedKm)), k2=Math.max(0,cycle-Math.max(S.tier1Until,S.includedKm));
  const m=mode(), sur=m==="eve"?+S.evening:m==="off"?+S.offhours:0;
  const ex=Object.keys(extras).filter(k=>extras[k]).reduce((s,k)=>s+ +S[k],0);
  const raw=+S.minPrice+k1*S.rate1+k2*S.rate2+sur+ex;
  const price=Math.max(+S.minPrice,roundP(raw));
  const floor=Math.max(+S.minPrice,roundP(price*(1-S.floorPct/100)-10));
  const net=price/(1+S.vat/100), fuel=cycle*S.fuelPerKm;
  const tf=1+S.traffic/100;
  const lMin=manualKm!=null?estMin(manualKm):L[1].min;
  const driveMin=(L[0].min+lMin+L[2].min)*tf;
  const hours=(driveMin+ +S.handlingMin)/60;
  const eta=Math.max(10,Math.round((L[0].min*tf+8)/5)*5);
  return{a,l,b,cycle,k1,k2,sur,ex,raw,price,floor,net,vatAmt:price-net,fuel,hours,perHour:(net-fuel)/hours,eta,m};
}

/* ---------- state ---------- */
let pick=null,dest=null,Q=null;
const fmt=n=>"₪"+Math.round(n).toLocaleString("he-IL");
const km=n=>(n<10?n.toFixed(1):Math.round(n))+" ק״מ";
const short=x=>(x.title||x.n).replace(" – "," ").replace(/\s*\(.*\)/,"");
const precTag=p=>p==="hi"?`<span class="prec hi">כתובת מדויקת</span>`:p==="mid"?`<span class="prec mid">רחוב</span>`:`<span class="prec lo">מרכז העיר</span>`;

function renderClock(){const d=new Date();$("#clk").textContent=d.toLocaleTimeString("he-IL",{hour:"2-digit",minute:"2-digit"});const a=autoMode(d);const pill=$("#modePill");const map={day:["שעות רגילות","day"],eve:["תעריף ערב","eve"],off:["מחוץ לשעות","off"],sat:["שבת · לא עובדים","off"]};pill.textContent=map[a][0];pill.className="pill "+map[a][1]}
function renderMode(){const m=mode();$$(".seg button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.t===m));const a=autoMode();
  $("#autoNote").innerHTML=modeManual?`נבחר ידנית. <button id="toAuto">חזור לאוטומטי</button>`:a==="sat"?"שבת: מתן לא עובד היום. המחיר מחושב בתעריף מיוחד.":"התעריף נקבע אוטומטית לפי השעה עכשיו.";
  const t=$("#toAuto");if(t)t.onclick=()=>{modeManual=null;update()}}
function renderExtras(){$$(".tog").forEach(b=>{b.setAttribute("aria-pressed",extras[b.dataset.x]);$("#xs-"+b.dataset.x).textContent="+"+fmt(S[b.dataset.x])})}

let RECENT=store.get("recent2",[]);
function remember(x){RECENT=[{n:x.n,title:x.title,sub:x.sub,la:x.la,lo:x.lo,city:x.city,prec:x.prec},...RECENT.filter(r=>r.n!==x.n)].slice(0,8);store.set("recent2",RECENT)}
function renderChips(){
  const quick=["ראשון לציון – מרכז","נס ציונה","רחובות","באר יעקב","חולון","תל אביב – מרכז"].map(n=>byName[n]);
  const items=[...RECENT.slice(0,5),...quick];const seen=new Set();
  CHIP=items.filter(x=>x&&!seen.has(x.n)&&seen.add(x.n)).slice(0,10);
  $("#chips").innerHTML=CHIP.map((x,i)=>`<button class="chip" data-i="${i}">${short(x).replace("ראשון לציון ","ראשל״צ ").replace("תל אביב ","ת״א ")}</button>`).join("");
}
let CHIP=[];

let animFrom=0;
function animate(el,to){const from=animFrom;animFrom=to;if(matchMedia("(prefers-reduced-motion: reduce)").matches||from===to){el.textContent=to;return}const t0=performance.now(),dur=450;(function step(t){const k=Math.min(1,(t-t0)/dur),e=1-Math.pow(1-k,3);el.textContent=Math.round(from+(to-from)*e);if(k<1)requestAnimationFrame(step)})(t0)}

/* fetch real road distances whenever the route changes */
let routeKey="";
function refreshRoute(){
  if(!pick||!dest){legs=null;return}
  const B=base(),key=[B,pick,dest].map(p=>p.la+","+p.lo).join("|");if(key===routeKey)return;routeKey=key;legs=null;legsSrc="est";
  routing=true;
  roadRoute([B,pick,dest,B]).then(r=>{if(key!==routeKey)return;legs=r;legsSrc="road";online=true}).catch(()=>{if(key!==routeKey)return;legsSrc="est"}).finally(()=>{if(key!==routeKey)return;routing=false;update()});
}

function update(){
  renderMode();renderExtras();refreshRoute();
  $$(".clear").forEach(b=>b.hidden=!$("#"+b.dataset.clear).value);
  const ready=pick&&dest;
  ["#map","#sayCard","#waCard","#outcome","#break"].forEach(s=>$(s).hidden=!ready);
  if(!ready){Q=null;animFrom=0;$("#ticket").innerHTML=`<div class="empty"><b>${!pick?"מאיפה אוספים?":"ולאן לוקחים?"}</b><p>${!pick?"מקלידים רחוב, מספר ועיר. אפשר גם להדביק מיקום שהלקוח שלח בוואטסאפ.":"כתובת היעד, שם המוסך או העיר. המחיר יופיע מיד."}</p></div>`;return}
  Q=quote(pick,dest);
  const tag={day:"תעריף רגיל",eve:"תעריף ערב",off:"תעריף מיוחד"}[Q.m];
  const srcTxt=routing?`<span class="spin"></span> מחשב מרחק בכביש…`:legsSrc==="road"?"מרחק נסיעה אמיתי בכביש":"מרחק משוער (אין חיבור למפות)";
  $("#ticket").innerHTML=`<div class="t-in">
    <div class="t-head"><span>${short(pick)} ← ${short(dest)}</span><span class="pill ${Q.m}">${tag}</span></div>
    <div class="price"><i>₪</i><b id="pnum">${Q.price}</b></div>
    <div class="vat">כולל מע״מ · לפני מע״מ ${fmt(Q.net)}</div>
    <div class="kpis">
      <div class="kpi floor"><span>לא לרדת מתחת</span><b>${fmt(Q.floor)}</b></div>
      <div class="kpi"><span>הגעה ללקוח</span><b>${Q.eta} דק׳</b></div>
      <div class="kpi"><span>נשאר לך לשעה</span><b>${fmt(Q.perHour)}</b></div>
    </div>
    <div class="src">${srcTxt}</div>
    ${pick.prec==="lo"||dest.prec==="lo"?'<div class="warnbar" style="color:var(--warn);background:#FFC23D1a">נבחר מרכז עיר. לכתובת מדויקת מקלידים רחוב ומספר.</div>':""}
    ${autoMode()==="sat"?'<div class="warnbar">היום שבת. בפרסום כתוב "ללא עבודה בשבת".</div>':""}
  </div>`;
  animate($("#pnum"),Q.price);
  renderMap();
  const when=Q.eta<=20?"תוך כרבע שעה":`תוך כ־${Q.eta} דקות`;
  $("#say").innerHTML=`״גרירה מ<em>${short(pick)}</em> ל<em>${short(dest)}</em> יוצאת <em>${Q.price} שקל</em>, כולל מע״מ. אני יכול להיות אצלך ${when}. לצאת אליך?״`;
  const ph=$("#cphone").value.replace(/\D/g,"");const intl=ph.startsWith("0")?"972"+ph.slice(1):ph;
  const msg=`שלום, כאן מתן מגררילה – גרירת אופנועים וקטנועים.\nהצעת מחיר לגרירה:\n• איסוף: ${pick.n}\n• יעד: ${dest.n}\n• מחיר: ₪${Q.price} כולל מע״מ\n• זמן הגעה משוער: כ־${Q.eta} דקות\nלאישור פשוט עונים "מאשר" ואני יוצא לדרך.\nמתן | ${S.phone}`;
  $("#waBtn").href=`https://wa.me/${intl.length>=11?intl:""}?text=${encodeURIComponent(msg)}`;
  $("#lines").innerHTML=`
    <div><span>בסיס ← איסוף</span><b>${km(Q.a)}</b></div>
    <div><span>איסוף ← יעד (עם האופנוע)</span><b>${km(Q.l)}</b></div>
    <div><span>יעד ← חזרה לבסיס</span><b>${km(Q.b)}</b></div>
    <div><span>סה״כ סבב</span><b>${km(Q.cycle)}</b></div>
    <div><span>מחיר בסיס (כולל ${S.includedKm} ק״מ)</span><b>${fmt(S.minPrice)}</b></div>
    ${Q.k1?`<div><span>${Math.round(Q.k1)} ק״מ × ₪${S.rate1}</span><b>+${fmt(Q.k1*S.rate1)}</b></div>`:""}
    ${Q.k2?`<div><span>${Math.round(Q.k2)} ק״מ ארוכים × ₪${S.rate2}</span><b>+${fmt(Q.k2*S.rate2)}</b></div>`:""}
    ${Q.sur?`<div><span>${Q.m==="eve"?"תוספת ערב":"תוספת מחוץ לשעות"}</span><b>+${fmt(Q.sur)}</b></div>`:""}
    ${Q.ex?`<div><span>תוספות</span><b>+${fmt(Q.ex)}</b></div>`:""}
    <div><span>עיגול</span><b>${Q.price-Q.raw>=0?"+":"−"}${fmt(Math.abs(Q.price-Q.raw))}</b></div>
    <div class="tot"><span>מחיר ללקוח (כולל ${S.vat}% מע״מ)</span><b>${fmt(Q.price)}</b></div>
    <div><span>מע״מ להעביר</span><b>${fmt(Q.vatAmt)}</b></div>
    <div><span>דלק ובלאי משוער</span><b>−${fmt(Q.fuel)}</b></div>
    <div><span>זמן עבודה משוער</span><b>${Math.floor(Q.hours)}:${String(Math.round(Q.hours%1*60)).padStart(2,"0")} שע׳</b></div>
    <label>מרחק גרירה ידני (ק״מ)<input id="manKm" inputmode="decimal" placeholder="אוטו׳" value="${manualKm??""}"></label>
    <div class="note">${legsSrc==="road"?"המרחקים מחושבים לפי מסלול נסיעה אמיתי.":"אין כרגע חיבור לשירות המפות, אז המרחקים משוערים."} אם ה־Waze מראה מרחק גרירה אחר, כותבים אותו כאן והמחיר מתעדכן.</div>`;
  $("#manKm").onchange=e=>{const v=parseFloat(e.target.value);manualKm=isFinite(v)&&v>0?v:null;update();$("#break").open=true};
}

/* ---------- map ---------- */
function renderMap(){
  const B=base(), pts=[B,pick,dest];
  const W=600,H=300,pad=46;
  let laMin=Math.min(...pts.map(p=>p.la)),laMax=Math.max(...pts.map(p=>p.la)),loMin=Math.min(...pts.map(p=>p.lo)),loMax=Math.max(...pts.map(p=>p.lo));
  const cosL=Math.cos((laMin+laMax)/2*Math.PI/180);
  let spanX=Math.max((loMax-loMin)*cosL,0.03),spanY=Math.max(laMax-laMin,0.02);
  const sc=Math.min((W-2*pad)/spanX,(H-2*pad)/spanY);
  const cx=(loMin+loMax)/2,cy=(laMin+laMax)/2;
  const X=lo=>W/2+(lo-cx)*cosL*sc, Y=la=>H/2-(la-cy)*sc;
  const coast=COAST.map(([la,lo])=>`${X(lo).toFixed(1)},${Y(la).toFixed(1)}`);
  const sea=`M${X(33.0)},${Y(COAST[0][0])} L${coast.join(" L")} L${X(33.0)},${Y(COAST[COAST.length-1][0])} Z`;
  const dots=P.map(p=>{const x=X(p.lo),y=Y(p.la);return x>-10&&x<W+10&&y>-10&&y<H+10?`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.2" fill="#4a443c"/>`:""}).join("");
  const [bx,by,px,py,dx,dy]=[X(B.lo),Y(B.la),X(pick.lo),Y(pick.la),X(dest.lo),Y(dest.la)];
  const same=Math.hypot(px-dx,py-dy)<8;
  const lbl=(x,y,t,c,up)=>{const tx=x>W-140?"end":x<140?"start":"middle";return `<text x="${x}" y="${y+(up?-14:24)}" text-anchor="${tx}" fill="${c}" font-size="15" font-weight="800" font-family="Rubik,system-ui,sans-serif" paint-order="stroke" stroke="#171614" stroke-width="5">${t}</text>`};
  const cut=t=>t.length>22?t.slice(0,21)+"…":t;
  $("#map").innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="מפת מסלול סכמטית">
    <rect width="${W}" height="${H}" fill="#171614"/>
    <path d="${sea}" fill="#0f1416"/>
    <path d="M${coast.join(" L")}" fill="none" stroke="#2d3a3e" stroke-width="2"/>
    ${dots}
    <path d="M${bx},${by} L${px},${py}" stroke="#8b8378" stroke-width="2.5" stroke-dasharray="6 6" fill="none"/>
    <path d="M${dx},${dy} L${bx},${by}" stroke="#5c564e" stroke-width="2" stroke-dasharray="3 6" fill="none"/>
    <path d="M${px},${py} L${dx},${dy}" stroke="#FE5702" stroke-width="6" stroke-linecap="round" fill="none"/>
    <rect x="${bx-9}" y="${by-9}" width="18" height="18" rx="5" fill="#0E0E0D" stroke="#FE5702" stroke-width="2.5"/>
    <path d="M${bx-4},${by+1} l4,-5 l4,5 v4 h-8z" fill="#FE5702"/>
    <circle cx="${px}" cy="${py}" r="11" fill="#FE5702" stroke="#0E0E0D" stroke-width="3"/>
    <rect x="${dx-8}" y="${dy-8}" width="16" height="16" rx="2" transform="rotate(45 ${dx} ${dy})" fill="#FCFBF7" stroke="#0E0E0D" stroke-width="3"/>
    ${lbl(bx,by,"בסיס","#A59D92",by>py)}
    ${lbl(px,py,cut(short(pick)),"#FE5702",true)}
    ${same?"":lbl(dx,dy,cut(short(dest)),"#FCFBF7",dy<py)}
  </svg>
  <div class="legs">
    <span class="leg"><i class="dash"></i>אליו <b>${km(Q.a)}</b></span>
    <span class="leg"><i></i>גרירה <b>${km(Q.l)}</b></span>
    <span class="leg"><i class="dash" style="opacity:.6"></i>חזרה <b>${km(Q.b)}</b></span>
  </div>`;
}

/* ---------- autocomplete ---------- */
let active=null,hi=-1,OPTS=[],searchCtl=null,searchTimer=null;
function drawSugg(local,remote,loading,q){
  const box=$("#sugg");OPTS=[...remote,...local];hi=-1;
  let h="";
  if(remote.length)h+=`<span class="hd">כתובות</span>`+remote.map((x,i)=>row(x,i)).join("");
  if(loading)h+=`<span class="hd"><span class="spin"></span> מחפש כתובת…</span>`;
  if(local.length)h+=`<span class="hd">${q?"ערים ואזורים":"אחרונים"}</span>`+local.map((x,i)=>row(x,i+remote.length)).join("");
  if(!h&&q&&online===false)h=`<span class="hd">אין חיבור למפות. בחר עיר מהרשימה.</span>`;
  else if(!h&&q)h=`<span class="hd">לא נמצא. נסה רחוב ועיר, למשל "הרצל 50 ראשון לציון"</span>`;
  box.innerHTML=h;box.hidden=!h;box.style.top=active&&active.id==="pick"?"58px":"calc(100% + 4px)";
  function row(x,i){const d=Math.round(estKm(base(),x,2));return `<button role="option" data-i="${i}"><span class="lbl">${x.title||x.n}${precTag(x.prec)}<i>${x.note||x.sub||""}</i></span><small>${d} ק״מ</small></button>`}
}
function openSugg(inp){
  active=inp;const q=inp.value.trim();
  if(!q){drawSugg(RECENT.slice(0,6),[],false,"");return}
  let local=localFind(q);const dc=detectCity(expand(q));if(!local.length&&dc)local=P.filter(p=>p.city===dc).slice(0,3);
  clearTimeout(searchTimer);if(searchCtl)searchCtl.abort();
  const wantRemote=q.length>=3;
  drawSugg(local,[],wantRemote,q);
  if(!wantRemote)return;
  searchTimer=setTimeout(()=>{const ctl=searchCtl=new AbortController();
    remoteSearch(q,ctl.signal).then(r=>{online=true;if(active===inp&&inp.value.trim()===q)drawSugg(local,r,false,q)})
      .catch(()=>{if(searchCtl!==ctl)return;online=false;if(active===inp&&inp.value.trim()===q)drawSugg(local,[],false,q)})},320);
}
function choose(x){if(!x||!active)return;active.value=x.title&&x.sub?`${x.title}, ${x.sub}`:x.n;if(active.id==="pick")pick=x;else dest=x;
  remember(x);$("#sugg").hidden=true;manualKm=null;const next=active.id==="pick"&&!dest?$("#dest"):null;active=null;renderChips();update();if(next){next.focus();openSugg(next)}else document.activeElement.blur()}
["pick","dest"].forEach(id=>{const inp=$("#"+id);
  inp.addEventListener("focus",()=>{inp.select();openSugg(inp)});
  inp.addEventListener("input",()=>{if(id==="pick")pick=null;else dest=null;openSugg(inp);update()});
  inp.addEventListener("keydown",e=>{const bs=$$("#sugg button[data-i]");if(!bs.length)return;
    if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();hi=(hi+(e.key==="ArrowDown"?1:-1)+bs.length)%bs.length;bs.forEach((b,i)=>b.classList.toggle("on",i===hi))}
    if(e.key==="Enter"){e.preventDefault();choose(OPTS[+(bs[hi]||bs[0]).dataset.i])}
    if(e.key==="Escape")$("#sugg").hidden=true});
});
$("#sugg").addEventListener("pointerdown",e=>{const b=e.target.closest("button[data-i]");if(b){e.preventDefault();choose(OPTS[+b.dataset.i])}});
document.addEventListener("pointerdown",e=>{if(!e.target.closest(".route"))$("#sugg").hidden=true});
$("#chips").addEventListener("click",e=>{const b=e.target.closest(".chip");if(!b)return;active=!pick?$("#pick"):$("#dest");choose(CHIP[+b.dataset.i])});
$$(".clear").forEach(b=>b.onclick=()=>{const id=b.dataset.clear;$("#"+id).value="";if(id==="pick")pick=null;else dest=null;update();$("#"+id).focus()});
$("#swap").onclick=()=>{[pick,dest]=[dest,pick];$("#pick").value=pick?pick.n:"";$("#dest").value=dest?dest.n:"";update()};

/* ---------- options ---------- */
$$(".seg button").forEach(b=>b.onclick=()=>{modeManual=b.dataset.t;update()});
$$(".tog").forEach(b=>b.onclick=()=>{extras[b.dataset.x]=!extras[b.dataset.x];update()});
$("#cphone").addEventListener("input",update);

/* ---------- copy + toast ---------- */
function toast(t){const el=$("#toast");el.textContent=t;el.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove("show"),1800)}
async function copy(text,ok){try{await navigator.clipboard.writeText(text);toast(ok)}catch(e){const ta=document.createElement("textarea");ta.value=text;document.body.appendChild(ta);ta.select();try{document.execCommand("copy");toast(ok)}catch(_){toast("לא הצלחתי להעתיק")}ta.remove()}}
$("#copySay").onclick=()=>copy($("#say").textContent,"הועתק");

/* ---------- outcome + log ---------- */
function record(status){if(!Q)return;LOG.unshift({t:Date.now(),from:pick.n,to:dest.n,price:Q.price,status,mode:Q.m,km:Math.round(Q.cycle)});store.set("log",LOG);
  toast(status==="won"?`נרשם: ${fmt(Q.price)}`:"נרשם כשיחה שלא נסגרה");
  pick=dest=null;manualKm=null;extras={heavy:false,complex:false,urgent:false};modeManual=null;$("#pick").value=$("#dest").value=$("#cphone").value="";update();renderLog()}
$("#won").onclick=()=>record("won");$("#lost").onclick=()=>record("lost");
function renderLog(){
  const d0=new Date();d0.setHours(0,0,0,0);const m0=new Date(d0.getFullYear(),d0.getMonth(),1);
  const today=LOG.filter(x=>x.t>=d0),month=LOG.filter(x=>x.t>=m0);
  const won=today.filter(x=>x.status==="won"),mWon=month.filter(x=>x.status==="won");
  $("#s-calls").textContent=today.length;$("#s-won").textContent=won.length;$("#s-rev").textContent=fmt(won.reduce((s,x)=>s+x.price,0));
  $("#g-txt").textContent=`${mWon.length} מתוך ${S.monthlyGoal} גרירות`;
  $("#g-conv").textContent=month.length?`המרה ${Math.round(mWon.length/month.length*100)}%`:"המרה —";
  $("#g-bar").style.width=Math.min(100,mWon.length/S.monthlyGoal*100)+"%";
  const sh=s=>s.split(",")[0];
  $("#list").innerHTML=LOG.slice(0,60).map(x=>{const d=new Date(x.t);return `<div class="item ${x.status}"><span class="st ${x.status}"></span><div style="min-width:0"><p>${sh(x.from)} ← ${sh(x.to)}</p><small>${d.toLocaleDateString("he-IL",{day:"numeric",month:"numeric"})} · ${d.toLocaleTimeString("he-IL",{hour:"2-digit",minute:"2-digit"})} · ${x.status==="won"?"נסגר":"לא נסגר"}</small></div><b>₪${x.price}</b></div>`}).join("")||`<p class="note">עוד אין שיחות ביומן. אחרי כל שיחה לוחצים "נסגר" או "לא נסגר" במחשבון.</p>`;
}
$("#copyLog").onclick=()=>{const won=LOG.filter(x=>x.status==="won");if(!won.length){toast("אין גרירות להעתקה");return}
  const rows=won.slice().reverse().map(x=>{const d=new Date(x.t);return[d.toLocaleDateString("en-GB"),x.from,x.to,"","בוצע",x.price,"","כן","מהמחשבון"].join("\t")});copy(rows.join("\n"),`הועתקו ${won.length} גרירות`)};

/* ---------- settings ---------- */
const FIELDS=[
 ["בסיס ומחיר",[["baseAddr","הכתובת של הבסיס","כתובת מדויקת: רחוב, מספר, עיר","addr"],["minPrice","מחיר מינימום ₪","כולל מע״מ"],["includedKm","ק״מ כלולים במינימום","סבב מלא: הלוך, גרירה, חזור"]]],
 ["מחיר לק״מ",[["rate1","₪ לק״מ","אחרי הק״מ הכלולים"],["tier1Until","עד כמה ק״מ","מכאן מתחיל התעריף הארוך"],["rate2","₪ לק״מ בנסיעה ארוכה",""]]],
 ["תוספות",[["evening","תוספת ערב ₪","א׳–ה׳ 18:00–21:00"],["offhours","תוספת מחוץ לשעות ₪","לילה, שישי, חג"],["heavy","אופנוע כבד ₪",""],["complex","חילוץ מורכב ₪","חניון תת־קרקעי, מדרגות, גלגל נעול"],["urgent","דחוף ₪",""]]],
 ["חישובים",[["rounding","עיגול","","round"],["floorPct","מרווח מיקוח %","כמה מותר לרדת"],["vat","מע״מ %",""],["fuelPerKm","דלק ובלאי ₪ לק״מ","גרר + טנדר"],["traffic","תוספת פקקים %","על זמני הנסיעה"],["handlingMin","דקות העמסה ופריקה",""],["monthlyGoal","יעד גרירות לחודש",""],["phone","הטלפון של מתן","מופיע בהודעת הוואטסאפ","txt"]]]
];
function renderSet(){
  $("#setForm").innerHTML=FIELDS.map(([h,fs])=>`<div class="grp"><h4>${h}</h4>${fs.map(([k,l,s,t])=>{
    if(t==="addr")return `<div class="s" style="flex-wrap:wrap"><label for="set-baseAddr">${l}<small>${S.baseLa!=null?"נשמר: "+S.baseAddr:"כרגע: גן הורדים, ראשון לציון (בקירוב)"}</small></label><div style="display:flex;gap:6px;width:100%"><input id="set-baseAddr" style="flex:1;width:auto;text-align:start" placeholder="למשל: הנרקיס 5 ראשון לציון"><button class="mini" id="baseFind">אתר</button></div><div id="baseRes" style="width:100%;display:grid;gap:6px"></div></div>`;
    const ctl=t==="round"?`<select id="set-${k}"><option value="9" ${S[k]==="9"?"selected":""}>…9</option><option value="10" ${S[k]==="10"?"selected":""}>10 ₪</option><option value="50" ${S[k]==="50"?"selected":""}>50 ₪</option></select>`
      :`<input id="set-${k}" ${t==="txt"?'inputmode="tel" style="direction:ltr"':'inputmode="decimal"'} value="${S[k]}">`;
    return `<div class="s"><label for="set-${k}">${l}${s?`<small>${s}</small>`:""}</label>${ctl}</div>`}).join("")}</div>`).join("");
  $$("#setForm .s > input,#setForm select").forEach(el=>el.onchange=()=>{const k=el.id.slice(4);let v=el.value;if(el.tagName==="INPUT"&&k!=="phone"){v=parseFloat(v);if(!isFinite(v)){el.value=S[k];return}}S[k]=v;store.set("settings",S);update();toast("נשמר")});
  $("#baseFind").onclick=async()=>{const q=$("#set-baseAddr").value.trim();if(!q)return;const out=$("#baseRes");out.innerHTML=`<span class="note"><span class="spin"></span> מחפש…</span>`;
    try{const r=await remoteSearch(q);out.innerHTML=r.length?r.map((x,i)=>`<button class="btn ghost" data-i="${i}" style="justify-content:space-between;font-weight:500">${x.title||x.n}, ${x.sub||""}${precTag(x.prec)}</button>`).join(""):`<span class="note">לא נמצא. נסה לכתוב אחרת.</span>`;
      out.querySelectorAll("button").forEach(b=>b.onclick=()=>{const x=r[+b.dataset.i];S.baseAddr=x.title+(x.sub?", "+x.sub:"");S.baseLa=x.la;S.baseLo=x.lo;store.set("settings",S);routeKey="";renderSet();update();toast("הבסיס עודכן")})}
    catch(e){out.innerHTML=`<span class="note">אין חיבור לשירות המפות כרגע.</span>`}};
}
$("#resetSet").onclick=()=>{S=Object.assign({},DEF);store.set("settings",S);routeKey="";renderSet();update();toast("חזרנו לברירת מחדל")};

/* ---------- nav ---------- */
function go(v){$$(".nav button").forEach(b=>{if(b.dataset.v===v)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current")});["quote","log","set"].forEach(x=>$("#v-"+x).hidden=x!==v);if(v==="log")renderLog();if(v==="set")renderSet();scrollTo(0,0)}
$$(".nav button").forEach(b=>b.onclick=()=>go(b.dataset.v));

/* ---------- boot ---------- */
let lastAuto=autoMode();renderClock();setInterval(()=>{renderClock();const a=autoMode();if(a!==lastAuto){lastAuto=a;if(!modeManual)update()}},30000);
renderChips();
if(!store.get("seen2",false)){pick=byName["נס ציונה"];dest=byName["תל אביב – מרכז"];$("#pick").value=pick.n;$("#dest").value=dest.n;store.set("seen2",true)}
update();
})();

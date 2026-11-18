(function(){
"use strict";
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const store={get(k,d){try{const v=localStorage.getItem("grr."+k);return v?JSON.parse(v):d}catch(e){return d}},set(k,v){try{localStorage.setItem("grr."+k,JSON.stringify(v))}catch(e){}}};
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

/* ---------- settings ---------- */
const DEF={base:"ראשון לציון – גן הורדים",baseAddr:"",baseLa:null,baseLo:null,gkey:"",minPrice:249,includedKm:20,rate1:4.5,tier1Until:80,rate2:3.5,evening:50,offhours:100,heavy:50,complex:50,urgent:50,rounding:"9",vat:18,floorPct:8,fuelPerKm:1.1,traffic:20,handlingMin:25,monthlyGoal:100,phone:"054-9338228"};
let S=Object.assign({},DEF,store.get("settings",{}));
const CFG=(typeof window!=="undefined"&&window.GRR_CONFIG)||{};
const gkey=()=>(S.gkey||CFG.gkey||"").trim();
let LOG=store.get("log",[]);

/* ---------- built-in places (offline fallback) ---------- */
const norm=s=>(s||"").replace(/["'׳״`]/g,"").replace(/[\-–—,]/g," ").replace(/\s+/g," ").trim();
const P=PLACES.map(([n,la,lo,al])=>({n,title:n,la,lo,city:n.split(" – ")[0],key:norm(n+" "+(al||"")),prec:"lo"}));
const byName=Object.fromEntries(P.map(p=>[p.n,p]));
const CITIES=[...new Set(P.map(p=>p.city))].sort((a,b)=>b.length-a.length);
const ALIAS=[[/ראשל"?צ|רשל"?צ|ראשלצ|רשלצ/g,"ראשון לציון"],[/ת"א|תא(?=\s|$)/g,"תל אביב"],[/פ"ת|פת(?=\s|$)/g,"פתח תקווה"],[/ב"ש/g,"באר שבע"]];
const expand=q=>ALIAS.reduce((s,[r,t])=>s.replace(r,t),q);
function base(){if(S.baseLa!=null)return{n:S.baseAddr||"הבסיס",title:S.baseAddr||"הבסיס",la:+S.baseLa,lo:+S.baseLo};return byName[S.base]||P[0]}
function localFind(q){q=norm(expand(q));if(!q)return[];const w=q.split(" ");return P.map(p=>{let sc=0;if(norm(p.n)===q)sc=100;else if(p.key.startsWith(q))sc=60;else if(w.every(x=>p.key.includes(x)))sc=30;return{p,sc}}).filter(x=>x.sc).sort((a,b)=>b.sc-a.sc||a.p.n.length-b.p.n.length).slice(0,4).map(x=>x.p)}
function detectCity(q){const nq=" "+norm(q)+" ";for(const c of CITIES){if(nq.includes(" "+norm(c)+" "))return c}return null}
const sameCity=(a,b)=>{a=norm(a).replace(/ יפו$/,"");b=norm(b).replace(/ יפו$/,"");return!!a&&!!b&&(a===b||a.startsWith(b)||b.startsWith(a))};

/* ---------- distance estimate ---------- */
function hav(a,b){const R=6371,t=Math.PI/180,dLa=(b.la-a.la)*t,dLo=(b.lo-a.lo)*t;const h=Math.sin(dLa/2)**2+Math.cos(a.la*t)*Math.cos(b.la*t)*Math.sin(dLo/2)**2;return 2*R*Math.asin(Math.sqrt(h))}
function estKm(a,b,floor){const d=hav(a,b);const f=d<10?1.35:d<40?1.25:1.18;return Math.max(d*f,floor)}
const estMin=km=>km/(km<15?28:km<40?45:70)*60;

/* ---------- network helpers ---------- */
async function req(url,opt={},ms=8000,signal){const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);if(signal)signal.addEventListener("abort",()=>c.abort());
  try{const r=await fetch(url,Object.assign({},opt,{signal:c.signal}));const j=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(j.error?.message||("HTTP "+r.status));e.status=r.status;throw e}return j}finally{clearTimeout(t)}}
const uuid=()=>(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2));

/* ---------- Google Maps Platform (Places API New + Routes API + Static Maps) ---------- */
let gToken=uuid(), gState="unknown"; /* unknown | ok | fail */
function gPrec(types){types=types||[];if(types.some(t=>["street_address","premise","subpremise","establishment","point_of_interest","car_repair","parking"].includes(t)))return"hi";if(types.includes("route"))return"mid";return"lo"}
async function gSuggest(q,signal){const B=base();
  const j=await req("https://places.googleapis.com/v1/places:autocomplete",{method:"POST",headers:{"Content-Type":"application/json","X-Goog-Api-Key":gkey()},
    body:JSON.stringify({input:q,languageCode:"he",regionCode:"IL",includedRegionCodes:["il"],sessionToken:gToken,locationBias:{circle:{center:{latitude:B.la,longitude:B.lo},radius:40000}},origin:{latitude:B.la,longitude:B.lo}})},7000,signal);
  return(j.suggestions||[]).filter(s=>s.placePrediction).slice(0,6).map(s=>{const p=s.placePrediction,sf=p.structuredFormat||{};
    return{placeId:p.placeId,title:sf.mainText?.text||p.text?.text,sub:(sf.secondaryText?.text||"").replace(/,?\s*ישראל$/,""),n:p.text?.text,prec:gPrec(p.types),km:p.distanceMeters!=null?p.distanceMeters/1000:null}})}
async function gResolve(x){const j=await req(`https://places.googleapis.com/v1/places/${encodeURIComponent(x.placeId)}?languageCode=he&regionCode=IL&sessionToken=${gToken}`,{headers:{"X-Goog-Api-Key":gkey(),"X-Goog-FieldMask":"location,formattedAddress"}},7000);
  gToken=uuid();return Object.assign({},x,{la:j.location.latitude,lo:j.location.longitude,n:(j.formattedAddress||x.n||"").replace(/,?\s*ישראל$/,""),placeId:undefined})}
async function gRoute(B,a,b){const wp=p=>({location:{latLng:{latitude:p.la,longitude:p.lo}}});
  const j=await req("https://routes.googleapis.com/directions/v2:computeRoutes",{method:"POST",headers:{"Content-Type":"application/json","X-Goog-Api-Key":gkey(),"X-Goog-FieldMask":"routes.legs.distanceMeters,routes.legs.duration,routes.legs.polyline.encodedPolyline"},
    body:JSON.stringify({origin:wp(B),destination:wp(B),intermediates:[wp(a),wp(b)],travelMode:"DRIVE",routingPreference:"TRAFFIC_AWARE",languageCode:"he",regionCode:"IL",units:"METRIC"})},9000);
  const L=j.routes?.[0]?.legs;if(!L||L.length!==3)throw new Error("no route");
  return L.map(l=>({km:(l.distanceMeters||0)/1000,min:parseFloat(l.duration)/60,poly:l.polyline?.encodedPolyline}))}
function gStatic(B,a,b,L){
  const st=["element:geometry|color:0x1b1916","element:labels.text.fill|color:0x8f877c","element:labels.text.stroke|color:0x0e0e0d","feature:road|element:geometry|color:0x34302b","feature:road.highway|element:geometry|color:0x4b453d","feature:road|element:labels.icon|visibility:off","feature:water|element:geometry|color:0x0d1316","feature:poi|visibility:off","feature:transit|visibility:off","feature:administrative.land_parcel|visibility:off","feature:landscape.man_made|element:geometry|color:0x1f1d1a"];
  const ll=p=>`${p.la.toFixed(5)},${p.lo.toFixed(5)}`;
  let parts=["size=640x320","scale=2","language=he","region=IL","key="+encodeURIComponent(gkey()),...st.map(s=>"style="+encodeURIComponent(s))];
  const paths=[L[0].poly&&`color:0x9a9184cc|weight:3|enc:${L[0].poly}`,L[2].poly&&`color:0x5f594fcc|weight:3|enc:${L[2].poly}`,L[1].poly?`color:0xFE5702ff|weight:7|enc:${L[1].poly}`:`color:0xFE5702ff|weight:7|${ll(a)}|${ll(b)}`].filter(Boolean);
  const marks=[`size:mid|color:0x0E0E0D|label:B|${ll(B)}`,`color:0xFE5702|label:1|${ll(a)}`,`color:0xFCFBF7|label:2|${ll(b)}`];
  let url="https://maps.googleapis.com/maps/api/staticmap?"+[...parts,...paths.map(p=>"path="+encodeURIComponent(p)),...marks.map(m=>"markers="+encodeURIComponent(m))].join("&");
  if(url.length>15500)url="https://maps.googleapis.com/maps/api/staticmap?"+[...parts,"path="+encodeURIComponent(paths[paths.length-1]),...marks.map(m=>"markers="+encodeURIComponent(m))].join("&");
  return url.length>16000?null:url}

/* ---------- free fallback: OpenStreetMap (Photon search + OSRM routing) ---------- */
const BBOX="34.2,29.4,35.95,33.4";
function oItem(f){const p=f.properties,[lo,la]=f.geometry.coordinates;const city=p.city||p.locality||p.district||p.county||"";
  const addr=p.street?(p.street+(p.housenumber?" "+p.housenumber:"")):"";
  const isHouse=!!p.housenumber,isStreet=p.osm_key==="highway"||p.type==="street";
  const title=p.name&&p.name!==p.street?p.name:(addr||p.name||city);
  const sub=[p.name&&p.name!==p.street&&addr?addr:"",city].filter(Boolean).join(", ");
  return{n:[title,sub].filter(Boolean).join(", "),title,sub,la,lo,city,prec:isHouse||(p.name&&!isStreet)?"hi":isStreet?"mid":"lo"}}
async function photon(q,bias,signal){const d=await req(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=15&lat=${bias.la}&lon=${bias.lo}&zoom=14&location_bias_scale=0.1&bbox=${BBOX}`,{},7000,signal);return d.features.map(oItem).filter(x=>x.title)}
async function oSuggest(raw,signal){
  const q=expand(raw),city=detectCity(q),cp=city?P.find(p=>p.city===city):null,bias=cp||base();
  const text=city?norm(q.replace(new RegExp(city.replace(/[-–]/g,".")),"")):norm(q);
  if(!text&&cp)return[];
  let res=(await Promise.all([photon(text||q,bias,signal),city&&text?photon(q,bias,signal).catch(()=>[]):[]])).flat();
  if(city)res=res.filter(r=>sameCity(r.city,city));
  if(city&&!res.length&&/\d/.test(text)){const street=norm(text.replace(/\d+[א-ת]?/g,""));if(street){res=(await photon(street,bias,signal)).filter(r=>sameCity(r.city,city)&&r.prec!=="lo");res.forEach(r=>{r.prec="mid";r.sub=(r.sub?r.sub+" · ":"")+"המספר לא במפה, נבחר הרחוב"})}}
  const seen=new Set();res=res.filter(r=>!seen.has(r.n)&&seen.add(r.n));
  const rank={hi:0,mid:1,lo:2};return res.sort((a,b)=>rank[a.prec]-rank[b.prec]).slice(0,6)}
async function oRoute(B,a,b){const d=await req(`https://router.project-osrm.org/route/v1/driving/${[B,a,b,B].map(p=>p.lo+","+p.la).join(";")}?overview=false`,{},8000);if(d.code!=="Ok")throw new Error(d.code);return d.routes[0].legs.map(l=>({km:l.distance/1000,min:l.duration/60}))}

/* ---------- unified search / route ---------- */
function coordItem(raw){const m=raw.match(/(-?\d{1,2}\.\d{3,})\s*[, ]\s*(-?\d{1,3}\.\d{3,})/);if(!m)return null;const la=+m[1],lo=+m[2];return{n:`מיקום מהלקוח (${la.toFixed(4)}, ${lo.toFixed(4)})`,title:"מיקום ששלח הלקוח",sub:`${la.toFixed(4)}, ${lo.toFixed(4)}`,la,lo,prec:"hi"}}
let provider="osm";
async function suggest(q,signal){const c=coordItem(q);if(c)return[c];
  if(gkey()){try{const r=await gSuggest(q,signal);gState="ok";provider="google";return r}catch(e){if(signal?.aborted)throw e;gState="fail";console.warn("Google search failed",e)}}
  provider="osm";return oSuggest(q,signal)}
async function resolve(x){if(x.placeId)return gResolve(x);return x}
const routeCache=new Map();
async function route(B,a,b){const key=[B,a,b].map(p=>p.la.toFixed(5)+","+p.lo.toFixed(5)).join(";");if(routeCache.has(key))return routeCache.get(key);
  let r=null;
  if(gkey()){try{r={legs:await gRoute(B,a,b),src:"google"};gState="ok"}catch(e){gState="fail";console.warn("Google route failed",e)}}
  if(!r)r={legs:await oRoute(B,a,b),src:"osm"};
  routeCache.set(key,r);return r}

/* ---------- time mode ---------- */
let modeManual=null, extras={heavy:false,complex:false,urgent:false};
function autoMode(d=new Date()){const day=d.getDay(),h=d.getHours()+d.getMinutes()/60;if(day===6)return"sat";if(day===5)return"off";if(h>=6&&h<18)return"day";if(h>=18&&h<21)return"eve";return"off"}
function mode(){const a=autoMode();return modeManual||(a==="sat"?"off":a)}

/* ---------- pricing ---------- */
function roundP(x){const r=S.rounding;if(r==="50")return Math.ceil(x/50)*50;if(r==="10")return Math.ceil(x/10)*10;return Math.ceil((x+1)/10)*10-1}
let manualKm=null, R=null /* {legs,src} */, routing=false;
function quote(pick,dest){
  const B=base();
  const L=R?R.legs:[[B,pick,2],[pick,dest,3],[dest,B,2]].map(([x,y,f])=>{const km=estKm(x,y,f);return{km,min:estMin(km)}});
  const a=L[0].km,l=manualKm!=null?manualKm:L[1].km,b=L[2].km,cycle=a+l+b;
  const extraKm=Math.max(0,cycle-S.includedKm);
  const k1=Math.min(extraKm,Math.max(0,S.tier1Until-S.includedKm)),k2=Math.max(0,cycle-Math.max(S.tier1Until,S.includedKm));
  const m=mode(),sur=m==="eve"?+S.evening:m==="off"?+S.offhours:0;
  const ex=Object.keys(extras).filter(k=>extras[k]).reduce((s,k)=>s+ +S[k],0);
  const raw=+S.minPrice+k1*S.rate1+k2*S.rate2+sur+ex;
  const price=Math.max(+S.minPrice,roundP(raw));
  const floor=Math.max(+S.minPrice,roundP(price*(1-S.floorPct/100)-10));
  const net=price/(1+S.vat/100),fuel=cycle*S.fuelPerKm;
  const tf=R&&R.src==="google"?1:1+S.traffic/100; /* Google times already include live traffic */
  const lMin=manualKm!=null?estMin(manualKm):L[1].min;
  const hours=((L[0].min+lMin+L[2].min)*tf+ +S.handlingMin)/60;
  const eta=Math.max(10,Math.round((L[0].min*tf+8)/5)*5);
  return{a,l,b,cycle,k1,k2,sur,ex,raw,price,floor,net,vatAmt:price-net,fuel,hours,perHour:(net-fuel)/hours,eta,m,L};
}

/* ---------- state ---------- */
let pick=null,dest=null,Q=null;
const fmt=n=>"₪"+Math.round(n).toLocaleString("he-IL");
const km=n=>(n<10?n.toFixed(1):Math.round(n))+" ק״מ";
const short=x=>(x.title||x.n||"").replace(" – "," ").replace(/\s*\(.*\)/,"");
const full=x=>x.title&&x.sub?`${x.title}, ${x.sub}`:(x.n||x.title);
const PREC={hi:["hi","כתובת מדויקת"],mid:["mid","רחוב"],lo:["lo","עיר / אזור"]};
const precTag=p=>`<span class="prec ${PREC[p||"lo"][0]}">${PREC[p||"lo"][1]}</span>`;

function renderClock(){const d=new Date();$("#clk").textContent=d.toLocaleTimeString("he-IL",{hour:"2-digit",minute:"2-digit"});const a=autoMode(d);const pill=$("#modePill");const map={day:["שעות רגילות","day"],eve:["תעריף ערב","eve"],off:["מחוץ לשעות","off"],sat:["שבת · סגור","off"]};pill.textContent=map[a][0];pill.className="pill "+map[a][1];const p2=$("#modePill2");p2.textContent=d.toLocaleTimeString("he-IL",{hour:"2-digit",minute:"2-digit"})+" · "+map[a][0];p2.className="pill "+map[a][1]}
function renderMode(){const m=mode();$$(".seg button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.t===m));const a=autoMode();
  $("#autoNote").innerHTML=modeManual?`נבחר ידנית · <button id="toAuto">אוטומטי</button>`:a==="sat"?"שבת: מחושב כתעריף מיוחד":"נקבע אוטומטית לפי השעה";
  const t=$("#toAuto");if(t)t.onclick=()=>{modeManual=null;update()}}
function renderExtras(){$$(".tog").forEach(b=>{b.setAttribute("aria-pressed",extras[b.dataset.x]);$("#xs-"+b.dataset.x).textContent="+"+fmt(S[b.dataset.x])})}

let RECENT=store.get("recent3",[]);
function remember(x){RECENT=[{n:x.n,title:x.title,sub:x.sub,la:x.la,lo:x.lo,city:x.city,prec:x.prec},...RECENT.filter(r=>r.n!==x.n)].slice(0,8);store.set("recent3",RECENT)}
let CHIP=[];
function renderChips(){
  const quick=["ראשון לציון – מרכז","נס ציונה","רחובות","באר יעקב","חולון","תל אביב – מרכז"].map(n=>byName[n]);
  const seen=new Set();CHIP=[...RECENT.slice(0,5),...quick].filter(x=>x&&!seen.has(x.n)&&seen.add(x.n)).slice(0,10);
  $("#chips").innerHTML=CHIP.map((x,i)=>`<button class="chip" data-i="${i}"><span>${esc(short(x).replace("ראשון לציון ","ראשל״צ ").replace("תל אביב ","ת״א "))}</span></button>`).join("");
}

let animFrom=0;
function animate(el,to){const from=animFrom;animFrom=to;if(matchMedia("(prefers-reduced-motion: reduce)").matches||from===to){el.textContent=to;return}const t0=performance.now(),dur=520;(function step(t){const k=Math.min(1,(t-t0)/dur),e=1-Math.pow(1-k,3);el.textContent=Math.round(from+(to-from)*e);if(k<1)requestAnimationFrame(step)})(t0)}

/* fetch the real driving route whenever the points change */
let routeKey="";
function refreshRoute(){
  if(!pick||!dest){R=null;routeKey="";return}
  const B=base(),key=[B,pick,dest].map(p=>p.la+","+p.lo).join("|")+gkey().length;if(key===routeKey)return;routeKey=key;R=null;routing=true;
  route(B,pick,dest).then(r=>{if(key===routeKey)R=r}).catch(()=>{}).finally(()=>{if(key!==routeKey)return;routing=false;update()});
}

let lastReceipt="",qNo=store.get("qno",230);
function update(){
  renderMode();renderExtras();refreshRoute();
  $$(".clear").forEach(b=>b.hidden=!$("#"+b.dataset.clear).value);
  const ready=pick&&dest;
  ["#map","#sayCard","#waCard","#outcome","#break"].forEach(s=>$(s).hidden=!ready);
  if(!ready){Q=null;animFrom=0;lastReceipt="";
    $("#out").innerHTML=`<div class="next"><div class="next-in"><div class="k">${!pick?"המהלך":"עוד צעד"}<br><span class="b">${!pick?"הבא.":"אחד."}</span></div><p>${!pick?"כותבים איפה האופנוע: עיר, או רחוב ומספר. אפשר גם להדביק מיקום שהלקוח שלח בוואטסאפ.":"לאן לוקחים? כתובת, שם של מוסך או עיר. המחיר מופיע מיד."}</p></div></div>`;return}
  Q=quote(pick,dest);
  const rk=pick.n+"|"+dest.n;const fresh=rk!==lastReceipt;if(fresh){lastReceipt=rk;qNo++;store.set("qno",qNo)}
  const tag={day:"תעריף רגיל",eve:"תעריף ערב",off:"תעריף מיוחד"}[Q.m];
  const now=new Date();
  const src=routing?`<span class="spin"></span>מחשב מסלול נסיעה…`:R?(R.src==="google"?`<i></i>מסלול אמיתי · Google Maps, כולל פקקים`:`<i></i>מסלול אמיתי בכביש`):`<i class="est"></i>מרחק משוער`;
  const warn=[];
  if(pick.prec==="lo"||dest.prec==="lo")warn.push(`<div class="r-warn">נבחרה עיר בלי רחוב${pick.prec==="lo"&&dest.prec==="lo"?" בשני הצדדים":pick.prec==="lo"?" באיסוף":" ביעד"}. המחיר בקירוב. לדיוק, מוסיפים רחוב.</div>`);
  if(autoMode()==="sat")warn.push(`<div class="r-warn bad">היום שבת. בפרסום כתוב "ללא עבודה בשבת".</div>`);
  if(gkey()&&gState==="fail")warn.push(`<div class="r-warn">Google Maps לא ענה, נעשה שימוש במפה החינמית. בודקים את המפתח במסך התעריפים.</div>`);
  $("#out").innerHTML=`<div class="receipt${fresh?" fresh":""}"><div class="paper">
    <div class="r-head"><div><h3>הצעת מחיר</h3><small>גררילה · ${now.toLocaleDateString("he-IL")} · ${now.toLocaleTimeString("he-IL",{hour:"2-digit",minute:"2-digit"})}</small></div><span class="stamp ${Q.m}">${tag}</span></div>
    <div class="r-route"><i></i><span>${esc(full(pick))}</span><i class="d"></i><span>${esc(full(dest))}</span></div>
    <div class="r-price"><i>₪</i><b id="pnum">${Q.price}</b></div>
    <div class="r-vat">כולל מע״מ · לפני מע״מ ${fmt(Q.net)}</div>
    <div class="r-rows">
      <div class="r-row floor"><span>לא לרדת מתחת</span><hr><b>${fmt(Q.floor)}</b></div>
      <div class="r-row"><span>הגעה ללקוח</span><hr><b>${Q.eta} דק׳</b></div>
      <div class="r-row"><span>גרירה בכביש</span><hr><b>${km(Q.l)}</b></div>
      <div class="r-row"><span>נשאר לך לשעה</span><hr><b>${fmt(Q.perHour)}</b></div>
    </div>
    ${warn.join("")}
    <div class="r-foot"><span class="src">${src}</span><span>מס׳ ${qNo}</span></div>
  </div></div>`;
  animate($("#pnum"),Q.price);
  renderMap();
  const when=Q.eta<=20?"תוך כרבע שעה":`תוך כ־${Q.eta} דקות`;
  $("#say").innerHTML=`״גרירה מ<em>${esc(short(pick))}</em> ל<em>${esc(short(dest))}</em> יוצאת <em>${Q.price} שקל</em>, כולל מע״מ. אני יכול להיות אצלך ${when}. לצאת אליך?״`;
  const ph=$("#cphone").value.replace(/\D/g,"");const intl=ph.startsWith("0")?"972"+ph.slice(1):ph;
  const msg=`שלום, כאן מתן מגררילה – גרירת אופנועים וקטנועים.\nהצעת מחיר לגרירה:\n• איסוף: ${full(pick)}\n• יעד: ${full(dest)}\n• מחיר: ₪${Q.price} כולל מע״מ\n• זמן הגעה משוער: כ־${Q.eta} דקות\nלאישור פשוט עונים "מאשר" ואני יוצא לדרך.\nמתן | ${S.phone}`;
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
    <div class="note">${R?"המרחקים מחושבים לפי מסלול נסיעה אמיתי.":"המרחקים כרגע משוערים."} אם ה־Waze מראה מרחק גרירה אחר, כותבים אותו כאן והמחיר מתעדכן.</div>`;
  $("#manKm").onchange=e=>{const v=parseFloat(e.target.value);manualKm=isFinite(v)&&v>0?v:null;update();$("#break").open=true};
}

/* ---------- map ---------- */
let mapKey="";
function renderMap(){
  const B=base();
  const legsHtml=`<div class="legs"><div class="leg">נסיעה אליו<b>${km(Q.a)}</b></div><div class="leg l">הגרירה<b>${km(Q.l)}</b></div><div class="leg">חזרה לבסיס<b>${km(Q.b)}</b></div></div>`;
  const url=R&&R.src==="google"?gStatic(B,pick,dest,R.legs):null;
  const k=(url||"svg")+pick.n+dest.n+Q.a+Q.l;if(k===mapKey){$("#map .legs").outerHTML=legsHtml;return}mapKey=k;
  if(url){$("#map").innerHTML=`<img src="${url}" alt="מפת המסלול" width="640" height="320" onerror="this.remove()">`+legsHtml;return}
  const pts=[B,pick,dest],W=600,H=290,pad=46;
  const laMin=Math.min(...pts.map(p=>p.la)),laMax=Math.max(...pts.map(p=>p.la)),loMin=Math.min(...pts.map(p=>p.lo)),loMax=Math.max(...pts.map(p=>p.lo));
  const cosL=Math.cos((laMin+laMax)/2*Math.PI/180);
  const sc=Math.min((W-2*pad)/Math.max((loMax-loMin)*cosL,0.03),(H-2*pad)/Math.max(laMax-laMin,0.02));
  const cx=(loMin+loMax)/2,cy=(laMin+laMax)/2,X=lo=>W/2+(lo-cx)*cosL*sc,Y=la=>H/2-(la-cy)*sc;
  const coast=COAST.map(([la,lo])=>`${X(lo).toFixed(1)},${Y(la).toFixed(1)}`);
  const sea=`M${X(33.0)},${Y(COAST[0][0])} L${coast.join(" L")} L${X(33.0)},${Y(COAST[COAST.length-1][0])} Z`;
  const dots=P.map(p=>{const x=X(p.lo),y=Y(p.la);return x>-10&&x<W+10&&y>-10&&y<H+10?`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.2" fill="#3d3832"/>`:""}).join("");
  const [bx,by,px,py,dx,dy]=[X(B.lo),Y(B.la),X(pick.lo),Y(pick.la),X(dest.lo),Y(dest.la)];
  const lbl=(x,y,t,c,up)=>{const ta=x>W-150?"end":x<150?"start":"middle";return `<text x="${x}" y="${y+(up?-16:28)}" text-anchor="${ta}" fill="${c}" font-size="17" font-weight="800" font-family="Rubik,system-ui,sans-serif" paint-order="stroke" stroke="#171614" stroke-width="6">${esc(t.length>20?t.slice(0,19)+"…":t)}</text>`};
  $("#map").innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="מפת מסלול סכמטית">
    <rect width="${W}" height="${H}" fill="#171614"/><path d="${sea}" fill="#0d1316"/><path d="M${coast.join(" L")}" fill="none" stroke="#26343a" stroke-width="2"/>${dots}
    <path d="M${bx},${by} L${px},${py}" stroke="#9a9184" stroke-width="2.5" stroke-dasharray="7 7" fill="none"/>
    <path d="M${dx},${dy} L${bx},${by}" stroke="#5f594f" stroke-width="2" stroke-dasharray="3 7" fill="none"/>
    <path d="M${px},${py} L${dx},${dy}" stroke="#FE5702" stroke-width="7" stroke-linecap="round" fill="none"/>
    <rect x="${bx-10}" y="${by-10}" width="20" height="20" rx="5" fill="#0E0E0D" stroke="#FE5702" stroke-width="2.5"/><text x="${bx}" y="${by+5}" text-anchor="middle" fill="#FE5702" font-size="13" font-weight="900" font-family="Rubik,sans-serif">B</text>
    <circle cx="${px}" cy="${py}" r="13" fill="#FE5702" stroke="#0E0E0D" stroke-width="3"/><text x="${px}" y="${py+5}" text-anchor="middle" fill="#0E0E0D" font-size="14" font-weight="900" font-family="Rubik,sans-serif">1</text>
    <circle cx="${dx}" cy="${dy}" r="13" fill="#FCFBF7" stroke="#0E0E0D" stroke-width="3"/><text x="${dx}" y="${dy+5}" text-anchor="middle" fill="#0E0E0D" font-size="14" font-weight="900" font-family="Rubik,sans-serif">2</text>
    ${lbl(px,py,short(pick),"#FE5702",true)}${Math.hypot(px-dx,py-dy)<10?"":lbl(dx,dy,short(dest),"#FCFBF7",dy<py)}
  </svg>`+legsHtml;
}

/* ---------- autocomplete ---------- */
let active=null,hi=-1,OPTS=[],ctl=null,timer=null;
function drawSugg(local,remote,loading,q){
  const box=$("#sugg");OPTS=[...remote,...local];hi=-1;let h="";
  const row=(x,i)=>{const d=x.km!=null?x.km:x.la!=null?estKm(base(),x,2):null;return `<button role="option" data-i="${i}"><span class="lbl"><span>${esc(x.title||x.n)}${precTag(x.prec)}</span><i>${esc(x.sub||"")}</i></span><small>${d!=null?Math.round(d)+" ק״מ":""}</small></button>`};
  if(remote.length)h+=`<span class="hd">כתובות ומקומות<span class="g">${provider==="google"?"Google Maps":"OpenStreetMap"}</span></span>`+remote.map((x,i)=>row(x,i)).join("");
  if(loading)h+=`<span class="hd"><span class="spin"></span> מחפש…</span>`;
  if(local.length)h+=`<span class="hd">${q?"ערים ואזורים":"אחרונים"}</span>`+local.map((x,i)=>row(x,i+remote.length)).join("");
  if(!h&&q)h=`<span class="hd">לא נמצא. נסו רחוב ועיר, למשל "הרצל 50 ראשון לציון"</span>`;
  box.innerHTML=h;box.hidden=!h;box.style.top=active&&active.id==="pick"?"72px":"calc(100% + 6px)";
}
function openSugg(inp){
  active=inp;const q=inp.value.trim();clearTimeout(timer);if(ctl)ctl.abort();
  if(!q){drawSugg(RECENT.slice(0,6),[],false,"");return}
  let local=localFind(q);const dc=detectCity(expand(q));if(!local.length&&dc)local=P.filter(p=>p.city===dc).slice(0,2);
  if(gkey())local=local.slice(0,2);
  const want=q.length>=2;drawSugg(local,[],want,q);if(!want)return;
  timer=setTimeout(()=>{const c=ctl=new AbortController();
    suggest(q,c.signal).then(r=>{if(active===inp&&inp.value.trim()===q)drawSugg(local,r,false,q)}).catch(()=>{if(ctl===c&&active===inp)drawSugg(local,[],false,q)})},gkey()?220:320);
}
async function choose(x){if(!x||!active)return;const inp=active,id=inp.id;$("#sugg").hidden=true;active=null;
  let item=x;
  if(x.la==null){inp.value="מאתר…";try{item=await resolve(x)}catch(e){inp.value="";toast("לא הצלחתי לאתר את הכתובת");return}}
  inp.value=full(item);if(id==="pick")pick=item;else dest=item;
  remember(item);manualKm=null;renderChips();update();
  if(id==="pick"&&!dest){const d=$("#dest");d.focus();openSugg(d)}else inp.blur()}
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
$("#swap").onclick=()=>{[pick,dest]=[dest,pick];$("#pick").value=pick?full(pick):"";$("#dest").value=dest?full(dest):"";update()};

/* ---------- options ---------- */
$$(".seg button").forEach(b=>b.onclick=()=>{modeManual=b.dataset.t;update()});
$$(".tog").forEach(b=>b.onclick=()=>{extras[b.dataset.x]=!extras[b.dataset.x];update()});
$("#cphone").addEventListener("input",update);

/* ---------- copy + toast ---------- */
function toast(t){const el=$("#toast");el.textContent=t;el.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove("show"),1900)}
async function copy(text,ok){try{await navigator.clipboard.writeText(text);toast(ok)}catch(e){const ta=document.createElement("textarea");ta.value=text;document.body.appendChild(ta);ta.select();try{document.execCommand("copy");toast(ok)}catch(_){toast("לא הצלחתי להעתיק")}ta.remove()}}
$("#copySay").onclick=()=>copy($("#say").textContent,"הועתק");

/* ---------- outcome + log ---------- */
function record(status){if(!Q)return;LOG.unshift({t:Date.now(),from:full(pick),to:full(dest),price:Q.price,status,mode:Q.m,km:Math.round(Q.cycle)});store.set("log",LOG);
  toast(status==="won"?`נרשם! ${fmt(Q.price)} בכיס`:"נרשם כשיחה שלא נסגרה");
  pick=dest=null;manualKm=null;extras={heavy:false,complex:false,urgent:false};modeManual=null;$("#pick").value=$("#dest").value=$("#cphone").value="";scrollTo({top:0,behavior:"smooth"});update();renderLog()}
$("#won").onclick=()=>record("won");$("#lost").onclick=()=>record("lost");
function renderLog(){
  const d0=new Date();d0.setHours(0,0,0,0);const m0=new Date(d0.getFullYear(),d0.getMonth(),1);
  const today=LOG.filter(x=>x.t>=d0),month=LOG.filter(x=>x.t>=m0);
  const won=today.filter(x=>x.status==="won"),mWon=month.filter(x=>x.status==="won");
  $("#s-calls").textContent=today.length;$("#s-won").textContent=won.length;$("#s-rev").textContent=fmt(won.reduce((s,x)=>s+x.price,0));
  $("#g-txt").textContent=`${mWon.length} מתוך ${S.monthlyGoal} גרירות החודש`;
  $("#g-conv").textContent=month.length?`המרה ${Math.round(mWon.length/month.length*100)}%`:"המרה —";
  $("#g-bar").style.width=Math.min(100,mWon.length/S.monthlyGoal*100)+"%";
  const sh=s=>String(s).split(",")[0];
  $("#list").innerHTML=LOG.slice(0,60).map(x=>{const d=new Date(x.t);return `<div class="item ${x.status}"><span class="st ${x.status}"></span><div style="min-width:0"><p>${esc(sh(x.from))} ← ${esc(sh(x.to))}</p><small>${d.toLocaleDateString("he-IL",{day:"numeric",month:"numeric"})} · ${d.toLocaleTimeString("he-IL",{hour:"2-digit",minute:"2-digit"})} · ${x.status==="won"?"נסגר":"לא נסגר"}</small></div><b>₪${x.price}</b></div>`}).join("")||`<p class="note">עוד אין שיחות ביומן. אחרי כל שיחה לוחצים "נסגר" או "לא נסגר" במחשבון.</p>`;
}
$("#copyLog").onclick=()=>{const won=LOG.filter(x=>x.status==="won");if(!won.length){toast("אין גרירות להעתקה");return}
  copy(won.slice().reverse().map(x=>[new Date(x.t).toLocaleDateString("en-GB"),x.from,x.to,"","בוצע",x.price,"","כן","מהמחשבון"].join("\t")).join("\n"),`הועתקו ${won.length} גרירות`)};

/* ---------- settings ---------- */
const FIELDS=[
 ["Google Maps",[["gkey","מפתח API","מדביקים פעם אחת, נשמר בטלפון","gkey"]]],
 ["הבסיס והמינימום",[["baseAddr","הכתובת של הבסיס","מכאן נספר כל סבב","addr"],["minPrice","מחיר מינימום ₪","כולל מע״מ"],["includedKm","ק״מ כלולים במינימום","סבב מלא: הלוך, גרירה, חזור"]]],
 ["מחיר לק״מ",[["rate1","₪ לק״מ","אחרי הק״מ הכלולים"],["tier1Until","עד כמה ק״מ","מכאן מתחיל התעריף הארוך"],["rate2","₪ לק״מ בנסיעה ארוכה",""]]],
 ["תוספות",[["evening","תוספת ערב ₪","א׳–ה׳ 18:00–21:00"],["offhours","תוספת מחוץ לשעות ₪","לילה, שישי, חג"],["heavy","אופנוע כבד ₪",""],["complex","חילוץ מורכב ₪","חניון תת־קרקעי, מדרגות, גלגל נעול"],["urgent","דחוף ₪",""]]],
 ["חישובים",[["rounding","עיגול","","round"],["floorPct","מרווח מיקוח %","כמה מותר לרדת"],["vat","מע״מ %",""],["fuelPerKm","דלק ובלאי ₪ לק״מ","גרר + טנדר"],["traffic","תוספת פקקים %","רק כשאין Google"],["handlingMin","דקות העמסה ופריקה",""],["monthlyGoal","יעד גרירות לחודש",""],["phone","הטלפון של מתן","מופיע בהודעת הוואטסאפ","txt"]]]
];
function renderSet(){
  $("#setForm").innerHTML=FIELDS.map(([h,fs])=>`<div class="grp"><h4>${h}</h4>${fs.map(([k,l,s,t])=>{
    if(t==="gkey")return `<div class="s col"><label for="set-gkey">${l}<small>${s}. בלי מפתח האפליקציה עובדת עם מפה חינמית פחות מדויקת.</small></label><div class="wide"><input id="set-gkey" placeholder="AIza…" value="${esc(S.gkey)}" autocomplete="off" spellcheck="false"><button class="mini o" id="gTest">בדיקה</button></div><div class="gstat ${gkey()?(gState==="ok"?"ok":gState==="fail"?"bad":""):""}" id="gStat">${gkey()?(gState==="ok"?"מחובר ועובד":gState==="fail"?"המפתח לא עובד. לוחצים בדיקה לפרטים":"מפתח שמור. לוחצים בדיקה"):"לא מחובר. משתמשים במפה החינמית"}</div></div>`;
    if(t==="addr")return `<div class="s col"><label for="set-baseAddr">${l}<small>${S.baseLa!=null?"נשמר: "+esc(S.baseAddr):"כרגע: גן הורדים, ראשון לציון (בקירוב)"}</small></label><div class="wide"><input id="set-baseAddr" style="direction:rtl" placeholder="רחוב, מספר, עיר"><button class="mini o" id="baseFind">אתר</button></div><div id="baseRes" style="display:grid;gap:6px"></div></div>`;
    const ctl=t==="round"?`<select id="set-${k}"><option value="9" ${S[k]==="9"?"selected":""}>…9</option><option value="10" ${S[k]==="10"?"selected":""}>10 ₪</option><option value="50" ${S[k]==="50"?"selected":""}>50 ₪</option></select>`
      :`<input id="set-${k}" ${t==="txt"?'inputmode="tel" style="direction:ltr"':'inputmode="decimal"'} value="${esc(S[k])}">`;
    return `<div class="s"><label for="set-${k}">${l}${s?`<small>${s}</small>`:""}</label>${ctl}</div>`}).join("")}</div>`).join("");
  $$("#setForm .s > input,#setForm select").forEach(el=>el.onchange=()=>{const k=el.id.slice(4);let v=el.value;if(el.tagName==="INPUT"&&k!=="phone"){v=parseFloat(v);if(!isFinite(v)){el.value=S[k];return}}S[k]=v;store.set("settings",S);update();toast("נשמר")});
  $("#set-gkey").onchange=e=>{S.gkey=e.target.value.trim();store.set("settings",S);gState="unknown";routeCache.clear();routeKey="";update();toast("המפתח נשמר")};
  $("#gTest").onclick=async()=>{S.gkey=$("#set-gkey").value.trim();store.set("settings",S);const st=$("#gStat");if(!gkey()){st.className="gstat";st.textContent="אין מפתח";return}
    st.className="gstat";st.innerHTML=`<span class="spin"></span> בודק חיפוש כתובות ומסלולים…`;
    const res=[];try{const r=await gSuggest("הרצל 50 ראשון לציון");res.push(r.length?"חיפוש כתובות ✓":"חיפוש כתובות: אין תוצאות")}catch(e){res.push("חיפוש כתובות ✗ "+e.message)}
    try{const B=base();await gRoute(B,byName["נס ציונה"],byName["רחובות"]);res.push("מסלולים ✓")}catch(e){res.push("מסלולים ✗ "+e.message)}
    const ok=res.every(x=>x.includes("✓"));gState=ok?"ok":"fail";st.className="gstat "+(ok?"ok":"bad");st.textContent=res.join(" · ");routeCache.clear();routeKey="";update()};
  $("#baseFind").onclick=async()=>{const q=$("#set-baseAddr").value.trim();if(!q)return;const out=$("#baseRes");out.innerHTML=`<span class="note"><span class="spin"></span> מחפש…</span>`;
    try{const r=await suggest(q);out.innerHTML=r.length?r.map((x,i)=>`<button class="btn ghost" data-i="${i}" style="justify-content:space-between;font-weight:500;text-align:start">${esc(full(x))}${precTag(x.prec)}</button>`).join(""):`<span class="note">לא נמצא. נסו לכתוב אחרת.</span>`;
      out.querySelectorAll("button").forEach(b=>b.onclick=async()=>{let x=r[+b.dataset.i];try{x=await resolve(x)}catch(e){toast("לא הצלחתי לאתר");return}S.baseAddr=full(x);S.baseLa=x.la;S.baseLo=x.lo;store.set("settings",S);routeCache.clear();routeKey="";renderSet();update();toast("הבסיס עודכן")})}
    catch(e){out.innerHTML=`<span class="note">אין חיבור לשירות המפות כרגע.</span>`}};
}
$("#resetSet").onclick=()=>{const keep={gkey:S.gkey,baseAddr:S.baseAddr,baseLa:S.baseLa,baseLo:S.baseLo};S=Object.assign({},DEF,keep);store.set("settings",S);routeKey="";renderSet();update();toast("התעריפים חזרו לברירת מחדל")};

/* ---------- nav ---------- */
function go(v){$$(".nav button").forEach(b=>{if(b.dataset.v===v)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current")});["quote","log","set"].forEach(x=>$("#v-"+x).hidden=x!==v);if(v==="log")renderLog();if(v==="set")renderSet();scrollTo(0,0)}
$$(".nav button").forEach(b=>b.onclick=()=>go(b.dataset.v));

/* ---------- boot ---------- */
let lastAuto=autoMode();renderClock();setInterval(()=>{renderClock();const a=autoMode();if(a!==lastAuto){lastAuto=a;if(!modeManual)update()}},30000);
renderChips();
if(!store.get("seen3",false)){pick=byName["נס ציונה"];dest=byName["תל אביב – מרכז"];$("#pick").value=pick.n;$("#dest").value=dest.n;store.set("seen3",true)}
update();
})();

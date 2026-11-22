import * as B from './backend.js';

/* ---------- constants ---------- */
var TYPES={core:{label:'Core'},mobility:{label:'Mobility'},lift:{label:'Lift'}};
var ORDER=['core','mobility','lift'];
var DROOP_DAYS=3;
var MAX_LOGS=800;
var MAX_BACK=14; /* how many days back a log can be dated */
var THANKSGIVING='2026-11-26';
var STAGES=[[0,'Seedling'],[3,'Sapling'],[10,'Young tree'],[25,'Grown tree'],[50,'Redwood'],[100,'Old growth']];
var G=262,X=100,VB_TOP=14,VB_H=266;

/* ---------- roster ---------- */
var PLANT_MS=new Date(2026,10,22).getTime();
var ROSTER=('Bohn, Juliet|Brook, Channing|Carney Skytt, Fiona|Carr, Lily|Diniz, Zadie|Dodge, Maddy|Ford, Maddie|Helfin, Anna|Hoof, Olivia|Hyde, Hope|Koester, Lauren|Krywosa, Francesca|Lin, Sophia|Marchese, Valentina|McClellan, Campbell|Metteauer, Kate|Padovano, Mia|Padula, Grace|Pruitt-Kennett, Helen|Requejo, Amelie|Rosenfeld, Elle|Steiner, Claire|Wu, Maddie').split('|').map(function(x){
  var p=x.split(', ');
  return {id:(p[1]+'-'+p[0]).toLowerCase().replace(/[^a-z0-9]+/g,'-'),name:p[1]+' '+p[0],tag:p[1]+' '+p[0].charAt(0)+'.'};
});
function emptyMembers(){
  var m=new Map();
  ROSTER.forEach(function(r){m.set(r.id,{name:r.name,tag:r.tag,joined:PLANT_MS,owner:'',logs:[]});});
  return m;
}

/* ---------- helpers ---------- */
function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function pad(n){return String(n).padStart(2,'0');}
function keyOf(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
function todayKey(){return keyOf(new Date());}
function dayNum(k){var p=k.split('-').map(Number);return Math.round(Date.UTC(p[0],p[1]-1,p[2])/864e5);}
function keyFromNum(n){var d=new Date(n*864e5);return d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1)+'-'+pad(d.getUTCDate());}
function daysAgoKey(n){return keyFromNum(dayNum(todayKey())-n);}
function diffDays(a,b){return dayNum(a)-dayNum(b);}
function hash(s){var h=2166136261;for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
function rng(seed){var a=seed>>>0;return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function stageOf(total){var n='Seedling';for(var i=0;i<STAGES.length;i++){if(total>=STAGES[i][0])n=STAGES[i][1];}return n;}

/* ---------- state ---------- */
var S={user:null,authReady:false,treeId:null,treeKnown:false,members:emptyMembers(),loaded:false,cached:false,slow:false,err:null,
  tab:'my-tree',centerSel:true,sel:null,busy:false,growUntil:0,fakeSeason:null,confirmRelease:false,
  form:{type:'core',min:20,date:''},lastHtml:'',dirty:false,layoutKey:''};

/* ---------- growth rules ---------- */
function season(){return S.fakeSeason||(todayKey()<=THANKSGIVING?'fall':'winter');}
function soft(n){return 1-Math.exp(-n/30);} /* never fully maxes out */

function statsOf(m){
  var logs=m.logs||[],c={core:0,mobility:0,lift:0},days={},last=null,i;
  for(i=0;i<logs.length;i++){
    var l=logs[i];
    if(c[l.t]!==undefined)c[l.t]++;
    days[l.d]=1;
    if(!last||l.d>last)last=l.d;
  }
  var total=logs.length,t=todayKey();
  var base=last||keyOf(new Date(m.joined||Date.now()));
  var since=Math.max(0,diffDays(t,base));
  var n=dayNum(t)-(days[t]?0:1),streak=0;
  while(days[keyFromNum(n)]){streak++;n--;}
  var week=0;
  for(i=0;i<logs.length;i++){var dd=diffDays(t,logs[i].d);if(dd>=0&&dd<7)week++;}
  var g=1-Math.exp(-total/55);
  var face=since>=DROOP_DAYS?'sad':since===2?'worried':(since===0&&total>0)?'joy':'happy';
  var lastType=null;
  for(i=0;i<logs.length;i++){if(logs[i].d===last&&(lastType===null||logs[i].ts>=0))lastType=logs[i].t;}
  return {c:c,total:total,last:last,since:since,streak:streak,week:week,g:g,
    ft:2+58*g,mood:since>=DROOP_DAYS?'sad':'happy',face:face,lastType:lastType,stage:stageOf(total)};
}
function statusOf(s){
  if(s.mood==='sad')return {cls:'sad',text:'Drooping, '+s.since+' days since last log'};
  var left=DROOP_DAYS-s.since;
  if(left===1)return {cls:'warn',text:'Droops tomorrow without a log today'};
  return {cls:'ok',text:left===DROOP_DAYS?'Thriving':'Happy, droops in '+left+' days'};
}
function lastText(s){
  if(!s.last)return 'No logs yet';
  if(s.since===0)return 'Logged today';
  if(s.since===1)return 'Logged yesterday';
  return 'Logged '+s.since+' days ago';
}

/* ---------- each tree's own character ---------- */
var traitCache={};
function traitsOf(id){
  if(traitCache[id])return traitCache[id];
  var R=rng(hash('trait:'+id));
  var mains=['glasses','round','shades','headband','bow','none','glasses','headband','round'];
  var t={
    main:mains[Math.floor(R()*mains.length)],
    lashes:R()<0.3,freckles:R()<0.3,
    eyeScale:0.92+R()*0.35,eyeGap:0.21+R()*0.09,lookX:(R()-0.5)*0.8,
    grin:R()<0.5,
    hwMul:0.86+R()*0.3,puff:R()*0.6,hue:Math.round((R()-0.5)*32),bark:0.88+R()*0.3,
    hat:Math.floor(R()*4),scarf:Math.floor(R()*5),voice:Math.floor(R()*4)
  };
  traitCache[id]=t;
  return t;
}
var HATS=['#D7263D','#2E8B57','#2F6FDE','#8E44AD'];
var SCARVES=[['#C0392B','#F1C40F'],['#2C6E9B','#F4D35E'],['#6B8E23','#FFFFFF'],['#8E44AD','#F5B7B1'],['#D35400','#2C3E50']];
var VOICES=[
  {name:'cheerful',new:"Hi! I'm just a seedling. Log a session and watch me grow!",core:"Core day! I feel so steady!",mobility:"So bendy! My branches feel amazing!",lift:"Lifting! I'm sprouting new boughs!",happy:"Good to see you! Log today and I'll keep smiling!",worried:"It's been 2 days. I'm getting a little droopy...",sad:"I'm drooping! It's been {n} days. Cheer me up with a log?"},
  {name:'chill',new:"hey. tiny seedling here. log something and i'll grow.",core:"nice. core work. feeling steady.",mobility:"ahh, loose branches. love that.",lift:"lifts, huh. i'll take a few more boughs.",happy:"all good over here. log today and we stay that way.",worried:"two days now. no pressure, but i'm wilting a bit.",sad:"{n} days... i'm kinda drooping. a quick log would help."},
  {name:'dramatic',new:"Behold, a seedling! My destiny awaits your first log!",core:"CORE! I am unshakable!",mobility:"I am a graceful willow now!",lift:"I feel the power of a thousand redwoods!",happy:"My loyal rower returns! Log again and I shall flourish!",worried:"Two days of silence... the leaves are trembling!",sad:"{n} days! I wither! Only a log can save me!"},
  {name:'coach',new:"Day one. Log your first session and let's build.",core:"Core in the books. Strong cores win races.",mobility:"Mobility logged. That's how you stay sharp.",lift:"Lift done. Boughs are coming in.",happy:"Keep the streak alive. Get a session in today.",worried:"Two days off. Get back on it before I droop.",sad:"{n} days without a log. Let's get back to work."}
];
function sayFor(s,id){
  var v=VOICES[traitsOf(id).voice];
  if(!s.total)return v.new;
  if(s.face==='sad')return v.sad.replace('{n}',s.since);
  if(s.face==='worried')return v.worried;
  if(s.face==='joy')return v[s.lastType]||v.happy;
  return v.happy;
}

/* ---------- tree drawing ---------- */
function geom(s,T){
  if(s.total<3){var r=15+s.total*3;return {sprout:true,r:r,topY:G-2*r-8};}
  var core=soft(s.c.core),mob=soft(s.c.mobility),lift=soft(s.c.lift);
  var H=Math.min(226,58+172*s.g);
  var tw=17+12*core+5*s.g,trunkH=Math.max(28,H*0.42),yTop=G-trunkH;
  var n=Math.max(2,Math.min(9,2+Math.floor(s.total/6)+Math.round(lift*2)));
  var hw=Math.min(96,(24+44*s.g)*(0.8+0.5*mob)*T.hwMul);
  return {sprout:false,H:H,tw:tw,trunkH:trunkH,yTop:yTop,n:n,hw:hw,cTop:G-H,cBot:yTop+trunkH*0.28,topY:G-H};
}
function hatH(s){return season()==='winter'?26*(s.total<3?0.7:0.8+0.5*s.g):0;}
function crownY(s,id){return geom(s,traitsOf(id)).topY-hatH(s);}

function face(fx,fy,fw,mood,T){
  var gap=fw*T.eyeGap,er=fw*0.17*T.eyeScale,ey=fy-fw*0.05,my=fy+fw*0.27,mh=fw*(T.grin?0.24:0.18),sw=Math.max(1.1,fw*0.06),o='',sd,cx;
  var lx=er*0.5*T.lookX,ly=mood==='sad'?er*0.3:0,pr=er*0.55;
  for(sd=-1;sd<=1;sd+=2){
    cx=fx+sd*gap;
    if(mood==='joy'){
      o+='<path d="M'+(cx-er)+' '+(ey+er*0.2)+' Q'+cx+' '+(ey-er*1.15)+' '+(cx+er)+' '+(ey+er*0.2)+'" stroke="var(--face)" stroke-width="'+(sw*1.2)+'" fill="none" stroke-linecap="round"/>';
    }else{
      o+='<circle cx="'+cx+'" cy="'+ey+'" r="'+er+'" fill="#fff" stroke="var(--face)" stroke-width="'+(sw*0.5)+'"/>';
      o+='<circle cx="'+(cx+lx)+'" cy="'+(ey+ly)+'" r="'+pr+'" fill="var(--face)"/><circle cx="'+(cx+lx+pr*0.35)+'" cy="'+(ey+ly-pr*0.35)+'" r="'+(pr*0.38)+'" fill="#fff"/>';
      if(T.lashes){o+='<path d="M'+(cx+sd*er*0.7)+' '+(ey-er*0.8)+' l'+(sd*er*0.7)+' '+(-er*0.55)+' M'+(cx+sd*er*0.3)+' '+(ey-er*1.05)+' l'+(sd*er*0.35)+' '+(-er*0.7)+' M'+(cx+sd*er*1.0)+' '+(ey-er*0.4)+' l'+(sd*er*0.75)+' '+(-er*0.3)+'" stroke="var(--face)" stroke-width="'+(sw*0.7)+'" fill="none" stroke-linecap="round"/>';}
    }
    if(mood==='worried'||mood==='sad'){
      var inner=mood==='sad'?er*2.7:er*2.1;
      o+='<path d="M'+(cx-sd*er*1.2)+' '+(ey-inner)+' L'+(cx+sd*er*1.2)+' '+(ey-er*1.5)+'" stroke="var(--face)" stroke-width="'+(sw*0.8)+'" fill="none" stroke-linecap="round"/>';
    }
    if(mood==='joy'||mood==='happy'){
      o+='<ellipse cx="'+(fx+sd*fw*0.43)+'" cy="'+(my-fw*0.02)+'" rx="'+(er*0.95)+'" ry="'+(er*0.6)+'" fill="var(--blush)" opacity=".6"/>';
    }
  }
  if(mood==='joy'){
    o+='<path d="M'+(fx-mh)+' '+my+' Q'+fx+' '+(my+mh*2.2)+' '+(fx+mh)+' '+my+' Z" fill="var(--face)"/><ellipse cx="'+fx+'" cy="'+(my+mh*0.8)+'" rx="'+(mh*0.45)+'" ry="'+(mh*0.28)+'" fill="#E96A6A"/>';
  }else if(mood==='happy'){
    o+='<path d="M'+(fx-mh)+' '+my+' Q'+fx+' '+(my+mh*(T.grin?1.7:1.2))+' '+(fx+mh)+' '+my+'" stroke="var(--face)" stroke-width="'+sw+'" fill="none" stroke-linecap="round"/>';
  }else if(mood==='worried'){
    o+='<path d="M'+(fx-mh)+' '+(my+mh*0.2)+' Q'+(fx-mh*0.5)+' '+(my-mh*0.5)+' '+fx+' '+(my+mh*0.2)+' T'+(fx+mh)+' '+(my+mh*0.2)+'" stroke="var(--face)" stroke-width="'+sw+'" fill="none" stroke-linecap="round"/>';
    o+='<path d="M'+(fx+fw*0.5)+' '+(ey-er*1.6)+' q'+(er*0.8)+' '+(er*1.4)+' 0 '+(er*2)+' q'+(-er*0.8)+' '+(-er*0.6)+' 0 '+(-er*2)+' Z" fill="var(--tear)"/>';
  }else{
    o+='<path d="M'+(fx-mh)+' '+(my+mh*0.6)+' Q'+fx+' '+(my-mh*0.9)+' '+(fx+mh)+' '+(my+mh*0.6)+'" stroke="var(--face)" stroke-width="'+sw+'" fill="none" stroke-linecap="round"/>';
    o+='<ellipse cx="'+(fx+gap+er*0.2)+'" cy="'+(ey+er*2.3)+'" rx="'+(er*0.45)+'" ry="'+(er*0.8)+'" fill="var(--tear)"/><path d="M'+(fx+gap+er*0.2)+' '+(ey+er)+' L'+(fx+gap+er*0.2)+' '+(ey+er*1.6)+'" stroke="var(--tear)" stroke-width="'+(sw*0.8)+'" stroke-linecap="round"/>';
  }
  /* accessories */
  var gr=er*1.55,m=T.main;
  if(m==='glasses'||m==='round'){
    for(sd=-1;sd<=1;sd+=2){
      cx=fx+sd*gap;
      o+=m==='round'?'<circle cx="'+cx+'" cy="'+ey+'" r="'+(gr*1.1)+'" fill="#fff" fill-opacity=".15" stroke="var(--face)" stroke-width="'+(sw*0.75)+'"/>':'<rect x="'+(cx-gr)+'" y="'+(ey-gr*0.8)+'" width="'+(gr*2)+'" height="'+(gr*1.6)+'" rx="'+(gr*0.35)+'" fill="#fff" fill-opacity=".15" stroke="var(--face)" stroke-width="'+(sw*0.75)+'"/>';
    }
    o+='<path d="M'+(fx-gap+gr)+' '+ey+' L'+(fx+gap-gr)+' '+ey+'" stroke="var(--face)" stroke-width="'+(sw*0.75)+'"/>';
  }else if(m==='shades'){
    for(sd=-1;sd<=1;sd+=2){
      cx=fx+sd*gap;
      o+='<rect x="'+(cx-gr)+'" y="'+(ey-gr*0.7)+'" width="'+(gr*2)+'" height="'+(gr*1.45)+'" rx="'+(gr*0.5)+'" fill="#12161A"/><path d="M'+(cx-gr*0.55)+' '+(ey-gr*0.3)+' l'+(gr*0.5)+' '+(-gr*0.15)+'" stroke="#fff" stroke-width="'+(sw*0.6)+'" opacity=".7" stroke-linecap="round"/>';
    }
    o+='<path d="M'+(fx-gap+gr)+' '+ey+' L'+(fx+gap-gr)+' '+ey+'" stroke="#12161A" stroke-width="'+sw+'"/>';
  }else if(m==='headband'){
    var by=ey-er*2.9,bw=fw*1.12;
    o+='<rect x="'+(fx-bw/2)+'" y="'+by+'" width="'+bw+'" height="'+(fw*0.13)+'" rx="'+(fw*0.04)+'" fill="#8C1515"/><rect x="'+(fx-bw/2)+'" y="'+(by+fw*0.045)+'" width="'+bw+'" height="'+(fw*0.04)+'" fill="#fff" opacity=".9"/>';
  }
  if(T.freckles){
    for(sd=-1;sd<=1;sd+=2){
      for(var q=0;q<3;q++){o+='<circle cx="'+(fx+sd*(fw*0.36+q*fw*0.05))+'" cy="'+(my-fw*0.08+(q%2)*fw*0.05)+'" r="'+(fw*0.018)+'" fill="#F2C9A0"/>';}
    }
  }
  return o;
}

function arms(ax,ay,half,mood,col,leafVar){
  var spec={joy:[15,-26],happy:[14,-9],worried:[13,3],sad:[7,17]}[mood]||[14,-9],dx=spec[0],dy=spec[1],o='',sd;
  for(sd=-1;sd<=1;sd+=2){
    var sx=ax+sd*half,ex=sx+sd*dx,ey=ay+dy;
    var g='<path d="M'+sx+' '+ay+' Q'+(sx+sd*dx*0.9)+' '+(ay+dy*0.15)+' '+ex+' '+ey+'" stroke="'+col+'" stroke-width="3.6" fill="none" stroke-linecap="round"/><ellipse cx="'+ex+'" cy="'+ey+'" rx="3.6" ry="2.4" fill="var('+leafVar+')" transform="rotate('+(sd*(mood==='joy'?-60:mood==='sad'?70:-20))+' '+ex+' '+ey+')"/>';
    o+=mood==='joy'?'<g class="'+(sd<0?'wvl':'wvr')+'" style="transform-origin:'+sx+'px '+ay+'px">'+g+'</g>':g;
  }
  return o;
}

function bow(x,y,k){
  return '<path d="M'+x+' '+y+' L'+(x-8*k)+' '+(y-5*k)+' L'+(x-8*k)+' '+(y+5*k)+' Z M'+x+' '+y+' L'+(x+8*k)+' '+(y-5*k)+' L'+(x+8*k)+' '+(y+5*k)+' Z" fill="#E85D9A"/><circle cx="'+x+'" cy="'+y+'" r="'+(2.3*k)+'" fill="#C2417A"/>';
}
function santaHat(x,y,k,sad,col){
  return '<g transform="rotate('+(sad?14:-6)+' '+x+' '+y+')"><path d="M'+(x-9*k)+' '+(y+7*k)+' Q'+(x-4*k)+' '+(y-12*k)+' '+(x+10*k)+' '+(y-16*k)+' Q'+(x+9*k)+' '+(y-2*k)+' '+(x+10*k)+' '+(y+7*k)+' Z" fill="'+col+'"/><ellipse cx="'+x+'" cy="'+(y+7*k)+'" rx="'+(11*k)+'" ry="'+(3.6*k)+'" fill="#fff"/><circle cx="'+(x+10*k)+'" cy="'+(y-16*k)+'" r="'+(3.6*k)+'" fill="#fff"/></g>';
}

function treeSVG(s,id,label,o){
  o=o||{};
  var T=traitsOf(id),gm=geom(s,T),sad=s.mood==='sad',R=rng(hash(String(id))),sea=season(),p='',i,k;
  var leaf=sad?['--sad-a','--sad-b','--sad-c']:['--leaf-a','--leaf-b','--leaf-c'];
  var bark=sad?'var(--bark-sad)':'var(--bark)';
  var delay='animation-delay:-'+(R()*4).toFixed(2)+'s';
  if(o.ground){p+='<rect x="-800" y="'+G+'" width="1800" height="80" fill="var(--ground)"/>';}
  p+='<ellipse cx="'+X+'" cy="'+G+'" rx="'+(o.ground?46:34)+'" ry="6" fill="var(--mound)"/>';
  if(sea==='fall'&&(o.ground||hash(String(id))%3===0)){
    var px=X+(R()<0.5?-1:1)*(o.ground?30:36);
    p+='<ellipse cx="'+px+'" cy="'+(G-1)+'" rx="8" ry="6" fill="#DE7A1E"/><path d="M'+(px-3)+' '+(G-6)+' Q'+(px-4)+' '+(G-1)+' '+(px-3)+' '+(G+4)+' M'+(px+3)+' '+(G-6)+' Q'+(px+4)+' '+(G-1)+' '+(px+3)+' '+(G+4)+'" stroke="#B85A10" fill="none" stroke-width="1.2"/><rect x="'+(px-1)+'" y="'+(G-10)+'" width="2" height="4" rx="1" fill="#5E7A2B"/>';
  }
  if(o.ground&&sea==='fall'&&!sad){
    for(i=0;i<3;i++){var fx=X+(R()-0.5)*140,fy=G+8+R()*10;p+='<ellipse cx="'+fx+'" cy="'+fy+'" rx="4.5" ry="2.2" fill="'+(i%2?'#D2692C':'#E8A33A')+'" transform="rotate('+Math.round(R()*90-45)+' '+fx+' '+fy+')"/>';}
  }
  p+='<g class="ch '+s.face+'" style="'+delay+'">';
  var cols=sea==='fall'?['#FFE9A8','#B3261E','#F6B26B']:['#D7263D','#F5C542','#4DA3FF'];
  var hatCol=HATS[T.hat],scarf=SCARVES[T.scarf];

  if(gm.sprout){
    var r=gm.r,cy=G-r;
    p+=arms(X,cy,r*0.92,s.face,bark,leaf[1]);
    p+='<circle cx="'+X+'" cy="'+cy+'" r="'+r+'" fill="'+bark+'"/>';
    var lr=r*0.9,ly=cy-r;
    p+='<ellipse cx="'+(X-lr*0.6)+'" cy="'+(ly-(sad?-6:2))+'" rx="'+lr+'" ry="'+(lr*0.45)+'" fill="var('+leaf[1]+')" transform="rotate('+(sad?-38:28)+' '+(X-lr*0.6)+' '+(ly-(sad?-6:2))+')"/>';
    p+='<ellipse cx="'+(X+lr*0.6)+'" cy="'+(ly-(sad?-6:2))+'" rx="'+lr+'" ry="'+(lr*0.45)+'" fill="var('+leaf[0]+')" transform="rotate('+(sad?38:-28)+' '+(X+lr*0.6)+' '+(ly-(sad?-6:2))+')"/>';
    p+=face(X,cy+r*0.08,r*1.55,s.face,T);
    if(T.main==='bow')p+=bow(X-lr*1.1,ly+2,0.9);
    if(sea==='winter')p+=santaHat(X,ly-4,0.7,sad,hatCol);
  }else{
    var n=gm.n,hw=gm.hw,tw=gm.tw,trunkH=gm.trunkH,yTop=gm.yTop,cTop=gm.cTop,cBot=gm.cBot;
    var top=tw*0.6,bl=X-tw/2,br=X+tw/2,tl=X-top/2,tr=X+top/2;
    p+=arms(X,G-trunkH*0.5,tw*0.46,s.face,bark,leaf[1]);
    p+='<g style="filter:brightness('+T.bark.toFixed(2)+')"><path d="M'+(bl-5)+' '+(G+3)+' Q'+bl+' '+G+' '+(bl+1)+' '+(G-10)+' C'+(bl+1)+' '+(G-trunkH*0.5)+' '+tl+' '+(yTop+trunkH*0.3)+' '+tl+' '+yTop+' L'+tr+' '+yTop+' C'+tr+' '+(yTop+trunkH*0.3)+' '+(br-1)+' '+(G-trunkH*0.5)+' '+(br-1)+' '+(G-10)+' Q'+br+' '+G+' '+(br+5)+' '+(G+3)+' Z" fill="'+bark+'"/></g>';
    var ch=cBot-cTop,th=ch/(1+(n-1)*0.55),d=sad?th*0.32:0,pf=T.puff;
    p+='<g style="filter:hue-rotate('+T.hue+'deg)">';
    for(i=0;i<n;i++){
      var apex=cTop+i*0.55*th,base=apex+th,w=hw*(0.45+0.55*(i+1)/n),cx=X+(R()-0.5)*4;
      p+='<path d="M'+cx+' '+apex+' C'+(cx+w*(0.2+0.35*pf))+' '+(apex+th*0.35)+' '+(cx+w*(0.7+0.2*pf))+' '+(base-th*0.2+d*0.5)+' '+(cx+w)+' '+(base+d)+' Q'+(cx+w*0.5)+' '+(base-th*0.12+d*0.3)+' '+cx+' '+(base-th*0.05)+' Q'+(cx-w*0.5)+' '+(base-th*0.12+d*0.3)+' '+(cx-w)+' '+(base+d)+' C'+(cx-w*(0.7+0.2*pf))+' '+(base-th*0.2+d*0.5)+' '+(cx-w*(0.2+0.35*pf))+' '+(apex+th*0.35)+' '+cx+' '+apex+' Z" fill="var('+leaf[i%3]+')"/>';
    }
    p+='</g>';
    /* scarf (fall) */
    if(sea==='fall'){
      var sy=G-trunkH*0.7;
      p+='<rect x="'+(X-tw*0.56)+'" y="'+sy+'" width="'+(tw*1.12)+'" height="6" rx="3" fill="'+scarf[0]+'"/><rect x="'+(X-tw*0.56)+'" y="'+(sy+2.2)+'" width="'+(tw*1.12)+'" height="1.6" fill="'+scarf[1]+'"/><path d="M'+(X+tw*0.2)+' '+(sy+4)+' l3 12 l6 -1 l-1 -11 Z" fill="'+scarf[0]+'"/>';
    }
    /* face on the trunk */
    var fw=Math.max(tw*0.9,16),fy=G-trunkH*0.36;
    p+=face(X,fy,fw,s.face,T);
    /* one ornament per log */
    var rd=rng(hash(String(id)+'d')),cnt=Math.min(s.total,120);
    for(k=0;k<cnt;k++){
      var v=0.1+0.85*Math.pow(rd(),0.85),u=rd()*2-1,wv=hw*(0.28+0.62*v);
      var dx=X+u*wv*0.82,dy=cTop+v*(cBot-cTop)*0.96;
      p+='<circle cx="'+dx.toFixed(1)+'" cy="'+dy.toFixed(1)+'" r="'+(2.7+(k%3)*0.35).toFixed(2)+'" fill="'+cols[k%3]+'" stroke="rgba(0,0,0,.25)" stroke-width=".6"/>';
      if(o.grew&&k===cnt-1){p+='<circle class="halo" cx="'+dx.toFixed(1)+'" cy="'+dy.toFixed(1)+'" r="7" fill="none" stroke="#F5C542" stroke-width="2" style="transform-origin:'+dx.toFixed(1)+'px '+dy.toFixed(1)+'px"/>';}
    }
    if(T.main==='bow')p+=bow(X-hw*0.45,cTop+(cBot-cTop)*0.3,1.1);
    if(sea==='winter')p+=santaHat(X,cTop+2,0.8+0.5*s.g,sad,hatCol);
    if(s.face==='joy'){
      var sp=[[X-hw*0.95,cTop+ch*0.35],[X+hw*0.9,cTop+ch*0.2],[X+hw*0.5,cTop-6]];
      for(i=0;i<3;i++){p+='<path class="spk" style="animation-delay:-'+(i*0.45)+'s" d="M'+(sp[i][0]-4)+' '+sp[i][1]+' H'+(sp[i][0]+4)+' M'+sp[i][0]+' '+(sp[i][1]-4)+' V'+(sp[i][1]+4)+'" stroke="#F5C542" stroke-width="2" stroke-linecap="round"/>';}
    }
    if(sad){
      for(i=0;i<3;i++){var lx=X+(R()-0.5)*2*Math.min(hw,70),lyy=G-2-R()*5;p+='<ellipse cx="'+lx+'" cy="'+lyy+'" rx="5" ry="2.4" fill="var(--sad-c)" transform="rotate('+Math.round(R()*80-40)+' '+lx+' '+lyy+')"/>';}
    }
  }
  p+='</g>';
  var vbH=VB_H;
  if(o.zoom){var tt=s.total;vbH=tt<3?130:tt<10?160:tt<25?200:tt<50?236:266;}
  var vbStr=o.vb||('0 '+(VB_TOP+VB_H-vbH)+' 200 '+vbH);
  return '<svg viewBox="'+vbStr+'" preserveAspectRatio="xMidYMax meet" role="img" aria-label="'+esc(label||'Tree')+'" xmlns="http://www.w3.org/2000/svg">'+p+'</svg>';
}

/* ---------- views ---------- */
function nextGrowth(s){
  for(var i=0;i<STAGES.length;i++){
    if(STAGES[i][0]>s.total){
      var prev=STAGES[i-1][0],need=STAGES[i][0]-s.total;
      return {text:need+(need===1?' more log':' more logs')+' to '+STAGES[i][1],pct:(s.total-prev)/(STAGES[i][0]-prev)*100};
    }
  }
  return {text:'Old growth. Keep me happy to stay on top.',pct:100};
}

function silhouettes(seed,n,hMin,hMax,fill,keepClear){
  var R=rng(seed),p='',i,t;
  for(i=0;i<n;i++){
    var x=(i+0.5)*1200/n+(R()-0.5)*1200/n*0.8,h=hMin+R()*(hMax-hMin),bw=h*0.34;
    if(keepClear&&Math.abs(x-600)<keepClear)continue;
    for(t=0;t<4;t++){
      var ay=400-h+t*h*0.2,by=ay+h*0.4,hw=bw*(0.42+0.2*t);
      p+='<polygon points="'+x.toFixed(0)+','+ay.toFixed(0)+' '+(x+hw).toFixed(0)+','+by.toFixed(0)+' '+(x-hw).toFixed(0)+','+by.toFixed(0)+'"/>';
    }
    p+='<rect x="'+(x-3).toFixed(0)+'" y="'+(400-h*0.2).toFixed(0)+'" width="6" height="'+(h*0.2).toFixed(0)+'"/>';
  }
  return '<svg class="layer" viewBox="0 0 1200 400" preserveAspectRatio="xMidYMax slice" aria-hidden="true" fill="'+fill+'">'+p+'</svg>';
}
var G_ICON='<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
function viewLanding(){
  var s=statsOf({logs:[],joined:Date.now()});
  s.face='joy';
  var seedling=treeSVG(s,'welcome','A little seedling waving hello',{vb:'30 196 140 86'});
  var R=rng(11),i,ff='',eyes='';
  for(i=0;i<18;i++){
    ff+='<i class="ff" style="left:'+(R()*100).toFixed(1)+'%;top:'+(30+R()*60).toFixed(1)+'%;--d:'+(6+R()*7).toFixed(1)+'s;--dx:'+Math.round((R()-0.5)*60)+'px;--dy:'+Math.round((R()-0.5)*50)+'px;animation-delay:-'+(R()*9).toFixed(1)+'s"></i>';
  }
  [[7,52],[17,63],[84,56],[93,66],[73,47]].forEach(function(e,k){
    eyes+='<span class="eyes" style="left:'+e[0]+'%;top:'+e[1]+'%;animation-delay:-'+(k*1.7).toFixed(1)+'s"><i></i><i></i></span>';
  });
  var action=S.authReady?'<button class="gbtn" data-a="signin" id="signinbtn">'+G_ICON+'Sign in with Google</button>':'<span class="loadtxt">Loading...</span>';
  return '<section class="front">'+
    '<div class="layers">'+silhouettes(3,24,150,250,'#0D1F17',0)+silhouettes(8,14,210,330,'#091510',150)+silhouettes(21,7,280,400,'#040B08',190)+'</div>'+
    '<div class="fog"></div>'+eyes+ff+'<div class="spot"></div><div class="pool"></div>'+
    '<div class="hero"><h2>Join the Forest</h2><p>Log core, mobility and lifting sessions.</p>'+action+
      (S.err&&S.err.signin?'<p class="errnote">'+esc(S.err.signin)+'</p>':'')+'</div>'+
    '<div class="seed">'+seedling+'</div>'+
    '<p class="corner">Log core, mobility, or strength to grow your tree and compete with the whole forest.</p>'+
  '</section>';
}
function viewClaim(){
  var h='<section class="card"><h2>Which one is you?</h2><p class="muted" style="margin:8px 0 14px">Pick your name. It links your tree to this Google account, so only you can log for it.</p><div class="names">',n=0;
  ROSTER.forEach(function(r){
    var m=S.members.get(r.id);
    if(m&&!m.owner){n++;h+='<button data-a="claim" data-id="'+r.id+'">'+esc(r.name)+'</button>';}
  });
  h+='</div>';
  if(!n)h+='<p class="muted">Every name is taken. Ask Lauren to check the roster.</p>';
  return h+'</section>';
}
function accountBar(){
  var me=S.members.get(S.treeId);
  return '<section class="card whobar"><span>Signed in as <b>'+esc(S.user.email||S.user.name||'you')+'</b></span>'+
    '<button class="linkbtn" data-a="release" id="releasebtn">'+(S.confirmRelease?'Click again to release '+esc(me.tag):'Not '+esc(me.tag)+'?')+'</button>'+
    '<button class="linkbtn" data-a="signout" id="signoutbtn">Sign out</button></section>';
}
function viewMy(){
  if(!S.user)return viewLanding();
  if(!S.treeKnown)return '<p class="note">Loading your tree...</p>';
  var me=S.treeId&&S.members.get(S.treeId);
  if(!me)return (S.err&&S.err.data?'<p class="note">'+esc(S.err.data)+'</p>':'')+viewClaim();
  var h=accountBar();
  var st=statsOf(me),status=statusOf(st),f=S.form,grew=Date.now()<S.growUntil,nx=nextGrowth(st);
  h+='<section class="my"><article class="card">'+
    '<div class="bubble">'+esc(sayFor(st,S.treeId))+'</div>'+
    '<div class="stage'+(grew?' grew':'')+'">'+treeSVG(st,S.treeId,me.name+"'s tree, "+st.ft.toFixed(1)+' feet, '+st.face,{ground:true,zoom:true,grew:grew})+'</div>'+
    '<div class="who"><h2>'+esc(me.name)+'</h2></div>'+
    '<div class="meta"><span class="pill '+status.cls+'">'+esc(status.text)+'</span><span>'+st.stage+' &middot; '+st.ft.toFixed(1)+' ft</span></div>'+
    '<dl class="figs"><div><dt>Day streak</dt><dd>'+st.streak+'</dd></div><div><dt>Last 7 days</dt><dd>'+st.week+'</dd></div><div><dt>Total logs</dt><dd>'+st.total+'</dd></div></dl>'+
    '<div class="next"><span>'+esc(nx.text)+'</span><div class="bar" aria-hidden="true"><i style="width:'+nx.pct.toFixed(0)+'%"></i></div></div>'+
    '<ul class="parts">';
  ORDER.forEach(function(k){
    var n=st.c[k];
    h+='<li><span class="nm">'+TYPES[k].label+'</span><div class="bar" aria-hidden="true"><i style="width:'+(soft(n)*100).toFixed(1)+'%"></i></div><span class="ct">'+n+'</span></li>';
  });
  h+='</ul></article>';

  h+='<article class="card"><form id="logform"><fieldset><legend>What did you do?</legend><div class="opts three">';
  ORDER.forEach(function(k){
    h+='<label class="opt"><input type="radio" name="type" id="t-'+k+'" value="'+k+'"'+(f.type===k?' checked':'')+'><span><b>'+TYPES[k].label+'</b></span></label>';
  });
  h+='</div></fieldset><fieldset><legend>How long?</legend><div class="chips">';
  [10,20,30,45,60].forEach(function(m){
    h+='<label class="opt"><input type="radio" name="min" id="m-'+m+'" value="'+m+'"'+(f.min===m?' checked':'')+'><span>'+m+' min</span></label>';
  });
  h+='</div></fieldset><fieldset><legend>Which day?</legend><input type="date" id="logdate" name="date" value="'+(f.date||todayKey())+'" min="'+daysAgoKey(MAX_BACK)+'" max="'+todayKey()+'">';
  h+='</div></fieldset><button class="primary" type="submit" id="logbtn"'+(S.busy?' disabled':'')+'>Log workout</button></form>';

  var recent=me.logs.slice().sort(function(a,b){return a.d<b.d?1:a.d>b.d?-1:b.ts-a.ts;}).slice(0,6);
  h+='<h3 class="sec">Recent logs</h3>';
  if(!recent.length){h+='<p class="muted">Nothing yet. Every log adds an ornament to your tree.</p>';}
  else{
    h+='<ul class="recent">';
    recent.forEach(function(l){
      var ago=diffDays(todayKey(),l.d),when=ago===0?'Today':ago===1?'Yesterday':ago+' days ago';
      h+='<li><span><b>'+TYPES[l.t].label+'</b>'+(l.m?' &middot; '+l.m+' min':'')+' &middot; <span class="muted">'+when+'</span></span><button data-a="undo" data-id="'+esc(l.id)+'" aria-label="Remove this '+TYPES[l.t].label+' log">Undo</button></li>';
    });
    h+='</ul>';
  }
  h+='</article></section>';
  return h;
}

function layoutFor(avail,n){
  var W=avail<560?88:100,minP=avail<560?44:36;
  var fit=(avail-44-W)/(n-1);
  var pitch=Math.max(minP,Math.min(W*0.6,fit));
  return {W:W,pitch:pitch,lanes:Math.min(4,Math.ceil(104/pitch)),scroll:(n-1)*pitch+W>avail-44+1};
}
function availWidth(){
  var v=document.getElementById('view');
  return Math.min(1008,(v&&v.clientWidth)||1000);
}

function viewGrove(){
  var list=[],week=0,droop=0,totalFt=0,weekLead=null,unclaimed=0;
  S.members.forEach(function(m,id){list.push({id:id,name:m.name,tag:m.tag,m:m,me:id===S.treeId,st:statsOf(m)});});
  list.sort(function(a,b){return b.st.ft-a.st.ft||b.st.week-a.st.week||a.name.localeCompare(b.name);});
  list.forEach(function(x,i){
    x.rank=i+1;week+=x.st.week;totalFt+=x.st.ft;
    if(x.st.mood==='sad')droop++;
    if(!x.m.owner)unclaimed++;
    if(!weekLead||x.st.week>weekLead.st.week)weekLead=x;
  });
  var sel=list.filter(function(x){return x.id===S.sel;})[0]||list.filter(function(x){return x.me;})[0]||list[0];

  var h='';
  if(S.err&&S.err.data){h+='<p class="note">'+esc(S.err.data)+'</p>';}
  else if(S.slow&&(!S.loaded||S.cached)){h+='<p class="note">Still reaching the team data. What you see may be out of date.</p>';}
  h+='<p class="sum"><span><b>'+Math.round(totalFt)+'</b> ft of forest</span><span><b>'+week+'</b> logs in the last 7 days</span>'+
    (unclaimed?'<span><b>'+unclaimed+'</b> names unclaimed</span>':'')+(weekLead&&weekLead.st.week>0?'<span>Most logs this week: <b>'+esc(weekLead.tag)+'</b> ('+weekLead.st.week+')</span>':'')+
    '<span><b>'+droop+'</b> drooping</span></p>';

  var L=layoutFor(availWidth(),list.length),W=L.W,pitch=L.pitch,lanes=L.lanes,sc=W/200,PAD=30+lanes*22;
  h+='<div class="forest" role="group" aria-label="The forest. Taller trees rank higher, tallest on the left." style="--w:'+W+'px;--pitch:'+pitch.toFixed(1)+'px;--pad:'+PAD+'px"><div class="frow">';
  list.forEach(function(x,pos){
    var s=x.st,lane=pos%lanes;
    var flagTop=PAD+(crownY(s,x.id)-VB_TOP)*sc-24-lane*22;
    h+='<button class="plot'+(x.me?' me':'')+'" data-a="pick" data-id="'+x.id+'" aria-pressed="'+(sel.id===x.id)+'" aria-label="Rank '+x.rank+', '+esc(x.name)+', '+s.ft.toFixed(1)+' feet'+(s.mood==='sad'?', drooping':'')+'">'+
      '<span class="flag" style="top:'+flagTop.toFixed(0)+'px"><i class="rk'+(x.rank<=3?' r'+x.rank:'')+'">'+x.rank+'</i>'+esc(x.tag)+'</span>'+
      treeSVG(s,x.id,x.name,{ground:false})+
      '<span class="gt">'+s.ft.toFixed(1)+' ft</span></button>';
  });
  h+='</div></div>';
  if(L.scroll)h+='<p class="tiny">Scroll sideways to see every tree.</p>';

  var ss=sel.st,stt=statusOf(ss);
  h+='<section class="card pick"><div><h2>#'+sel.rank+' '+esc(sel.name)+(sel.me?' (you)':'')+'</h2><p class="sub">'+ss.stage+' &middot; '+ss.ft.toFixed(1)+' ft &middot; '+lastText(ss)+'</p></div><span class="pill '+stt.cls+'">'+esc(stt.text)+'</span></section>';
  h+='<section class="card"><ol class="rank">';
  list.forEach(function(x){
    var s=x.st,stt2=statusOf(s);
    h+='<li><button data-a="pick" data-id="'+x.id+'" aria-pressed="'+(sel.id===x.id)+'"><span class="n">'+x.rank+'</span><span class="nm">'+esc(x.name)+(x.me?' (you)':'')+'</span><span class="ft">'+s.ft.toFixed(1)+' ft</span>'+
      '<span class="det"><span>Core '+s.c.core+'</span><span>Mobility '+s.c.mobility+'</span><span>Lift '+s.c.lift+'</span><span>Last 7 days: '+s.week+'</span><span class="pill '+stt2.cls+'">'+(s.mood==='sad'?'Drooping':s.since===DROOP_DAYS-1?'Needs a log':'Happy')+'</span></span></button></li>';
  });
  h+='</ol></section>';
  return h;
}

/* ---------- render ---------- */
function render(force){
  var ae=document.activeElement;
  if(!force&&ae&&ae.tagName==='INPUT'&&ae.type==='text'){S.dirty=true;return;}
  S.dirty=false;
  var hs=location.hash.replace('#','');
  S.tab=hs==='grove'?'grove':'my-tree';
  document.getElementById('tab-my').setAttribute('aria-selected',S.tab==='my-tree');
  document.getElementById('tab-grove').setAttribute('aria-selected',S.tab==='grove');
  var sea=season(),root=document.documentElement;
  if(root&&root.getAttribute&&root.getAttribute('data-season')!==sea)root.setAttribute('data-season',sea);
  var tag=document.getElementById('seasonTag');
  if(tag)tag.textContent=sea==='fall'?'Thanksgiving training':'Christmas break training';
  if(document.body&&document.body.classList)document.body.classList.toggle('dark-front',!S.user);
  var html=!S.user?viewLanding():S.tab==='grove'?viewGrove():viewMy();
  if(html===S.lastHtml)return;
  var fid=ae&&ae.id;
  var oldF=document.querySelector&&document.querySelector('.forest'),sl=oldF?oldF.scrollLeft:0;
  S.lastHtml=html;
  document.getElementById('view').innerHTML=html;
  var nf=document.querySelector&&document.querySelector('.forest');
  if(nf){
    var pl=nf.querySelector('.plot[aria-pressed="true"]');
    if(S.centerSel&&pl){nf.scrollLeft=pl.offsetLeft-nf.clientWidth/2+pl.offsetWidth/2;S.centerSel=false;}
    else nf.scrollLeft=sl;
  }
  if(fid){var el=document.getElementById(fid);if(el&&el!==document.activeElement)el.focus({preventScroll:true});}
}

var toastT;
function toast(msg){
  var t=document.getElementById('toast');
  t.textContent=msg;t.classList.add('on');
  clearTimeout(toastT);toastT=setTimeout(function(){t.classList.remove('on');},4200);
}

/* ---------- writes (one at a time) ---------- */
var chain=Promise.resolve();
function writeTree(id,logs){
  chain=chain.then(function(){return B.saveLogs(id,S.user.uid,logs);});
  chain.catch(function(){});
  return chain;
}
function cloneLogs(m){return m.logs.map(function(l){return {id:l.id,d:l.d,t:l.t,m:l.m,ts:l.ts};});}
function failToast(){toast('That did not save. Check your connection and try again.');}
function setMine(id,logs){
  var m=S.members.get(id);
  S.members.set(id,{name:m.name,tag:m.tag,joined:m.joined,owner:m.owner,logs:logs});
}
function doClaim(id){
  var m=S.members.get(id);
  if(!S.user||!m||m.owner||S.busy)return;
  S.busy=true;
  B.claim(S.user.uid,id,cloneLogs(m)).then(function(){toast('Welcome, '+m.name.split(' ')[0]+'. Your tree is planted.');}).catch(function(){toast('Could not claim that name. Someone may have just taken it. Pick again or try once more.');}).then(function(){S.busy=false;render(true);});
}
function doRelease(){
  var m=S.members.get(S.treeId);
  if(!S.user||!m)return;
  if(!S.confirmRelease){S.confirmRelease=true;render(true);setTimeout(function(){if(S.confirmRelease){S.confirmRelease=false;render();}},4000);return;}
  S.confirmRelease=false;
  B.release(S.user.uid,S.treeId,cloneLogs(m)).then(function(){toast('Name released. Pick the right one.');}).catch(failToast);
  render(true);
}
function logDate(){
  var d=S.form.date||todayKey(),t=todayKey();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||d>t)return t;
  return diffDays(t,d)>MAX_BACK?daysAgoKey(MAX_BACK):d;
}
function doLog(){
  var me=S.treeId&&S.members.get(S.treeId);
  if(!me||S.busy||!S.user)return;
  var before=statsOf(me),wasSad=before.mood==='sad',f=S.form,id=S.treeId,logs=cloneLogs(me);
  logs.push({id:Date.now().toString(36)+Math.floor(Math.random()*1296).toString(36),d:logDate(),t:f.type,m:f.min,ts:Date.now()});
  if(logs.length>MAX_LOGS)logs=logs.slice(-MAX_LOGS);
  S.form.date='';
  setMine(id,logs);
  var after=statsOf(S.members.get(id)),first=me.name.split(' ')[0];
  S.growUntil=Date.now()+1800;
  S.busy=true;
  writeTree(id,logs).catch(failToast).then(function(){S.busy=false;render(true);});
  var msg='+'+(after.ft-before.ft).toFixed(1)+' ft and a new ornament. '+first+'\'s tree is '+after.ft.toFixed(1)+' ft.';
  if(after.stage!==before.stage)msg=first+'\'s tree is now a '+after.stage.toLowerCase()+'. '+after.ft.toFixed(1)+' ft.';
  else if(wasSad&&after.mood==='happy')msg=first+'\'s tree perked up. '+after.ft.toFixed(1)+' ft.';
  toast(msg);
  render(true);
}
function doUndo(lid){
  var me=S.treeId&&S.members.get(S.treeId);
  if(!me||!S.user)return;
  var logs=cloneLogs(me).filter(function(l){return l.id!==lid;});
  if(logs.length===me.logs.length)return;
  setMine(S.treeId,logs);
  writeTree(S.treeId,logs).catch(failToast);
  render(true);
}

/* ---------- events ---------- */
document.addEventListener('click',function(e){
  var b=e.target.closest('[data-a]');
  if(!b)return;
  var a=b.dataset.a;
  if(a==='tab'){location.hash=b.dataset.tab;}
  else if(a==='pick'){S.sel=b.dataset.id;render(true);}
  else if(a==='undo'){doUndo(b.dataset.id);}
  else if(a==='signin'){B.signIn().catch(function(e){S.err={signin:'Sign-in did not finish. Try again.'};render(true);});}
  else if(a==='signout'){B.logOut();}
  else if(a==='claim'){doClaim(b.dataset.id);}
  else if(a==='release'){doRelease();}
});
document.addEventListener('change',function(e){
  var t=e.target;
  if(t.name==='type')S.form.type=t.value;
  else if(t.name==='min')S.form.min=Number(t.value);
  else if(t.name==='date')S.form.date=t.value;
});
document.addEventListener('submit',function(e){
  e.preventDefault();
  if(e.target.id==='logform')doLog();
});
document.addEventListener('focusout',function(){setTimeout(function(){if(S.dirty)render();},0);});
window.addEventListener('hashchange',function(){S.centerSel=true;render(true);});
document.addEventListener('visibilitychange',function(){if(!document.hidden)render(true);});
var rsT;
window.addEventListener('resize',function(){
  clearTimeout(rsT);
  rsT=setTimeout(function(){
    var L=layoutFor(availWidth(),ROSTER.length),key=L.W+':'+L.pitch.toFixed(1);
    if(key!==S.layoutKey&&S.tab==='grove'){S.layoutKey=key;S.lastHtml='';render(true);}
  },150);
});
var dayShown=todayKey();
setInterval(function(){var k=todayKey();if(k!==dayShown){dayShown=k;S.lastHtml='';render();}},60000);

/* ---------- data ---------- */
function cleanLogs(d){
  var logs=[];
  if(d&&Array.isArray(d.logs)){
    for(var i=0;i<d.logs.length;i++){
      var l=d.logs[i];
      if(l&&TYPES[l.t]&&typeof l.d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(l.d)){
        logs.push({id:String(l.id||''),d:l.d,t:l.t,m:Number(l.m)||0,ts:Number(l.ts)||0});
      }
    }
  }
  return logs.slice(-MAX_LOGS);
}
var unsubs=[];
function teardown(){unsubs.forEach(function(u){try{u();}catch(x){}});unsubs=[];}
var DATA_ERR='The team data could not be loaded. Reload the page. If it keeps failing, the Firestore rules may not be published yet.';
function listen(){
  var timer=setTimeout(function(){S.slow=true;render();},10000);
  unsubs.push(B.watchTrees(function(rows,fromCache){
    var map=emptyMembers();
    rows.forEach(function(r){
      var m=map.get(r.id);
      if(m){m.logs=cleanLogs(r.data);m.owner=typeof r.data.owner==='string'?r.data.owner:'';}
    });
    S.members=map;S.loaded=true;S.err=null;S.cached=!!fromCache;
    if(!fromCache){clearTimeout(timer);S.slow=false;}
    render();
  },function(){clearTimeout(timer);S.err={data:DATA_ERR};render();}));
  unsubs.push(B.watchMyTree(S.user.uid,function(t){
    S.treeId=t&&S.members.has(t)?t:null;S.treeKnown=true;
    if(S.treeId&&!S.sel)S.sel=S.treeId;
    render();
  },function(){S.treeKnown=true;S.err={data:DATA_ERR};render();}));
}
B.onUser(function(u){
  teardown();
  S.user=u;S.authReady=true;S.treeId=null;S.treeKnown=false;S.members=emptyMembers();S.sel=null;S.loaded=false;
  if(u)listen();
  S.centerSel=true;S.lastHtml='';
  render(true);
});
render(true);
if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('./sw.js').catch(function(){});});}


  import * as THREE from 'three';
  import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
  import {mergeVertices,mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

  // Island coordinates: x=u, z=v toward the bay. Residence design metres use DESIGN_SCALE.
  const $=id=>document.getElementById(id), TAU=Math.PI*2, clamp=THREE.MathUtils.clamp, mix=THREE.MathUtils.lerp;
  const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t)};
  let randomSeed=71827;const rand=()=>{randomSeed=(Math.imul(randomSeed,1664525)+1013904223)>>>0;return randomSeed/4294967296};
  const rnd=(a,b)=>mix(a,b,rand()), color=c=>new THREE.Color(c), reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mobile=matchMedia('(pointer: coarse)').matches||innerWidth<600;
  const config={time:.429,waves:.026,ripples:.6,clarity:.72,caustics:.55,azimuth:-35,tilt:0,particles:true,water:'#398d91'};
  const seasons=['春','夏','秋','冬'];
  const seasonal={current:0,target:0,snow:0};
  // The ONLY authoritative tide. Intro, reset, slider and dock all call setTide.
  const tide={current:reduced?0:-.55,target:0,from:reduced?0:-.55,high:0,bottom:-1.16,progress:reduced?1:0,elapsed:0,duration:reduced?0:4.2};
  function setTide(level,duration=2.8){tide.from=tide.current;tide.target=clamp(level,-.55,0);tide.progress=0;tide.elapsed=0;tide.duration=reduced?0:duration;syncTideUI()}
  function updateTide(dt){tide.elapsed+=dt;const progress=tide.duration===0?1:clamp(tide.elapsed/tide.duration,0,1);const t=progress*progress*(3-2*progress);let desired=mix(tide.from,tide.target,t);
    // Ebb can slow while a fish retreats, but never reverse or overtake a body.
    // The actual level remains the sole input to EVERY dependent system.
    if(desired<tide.current){let safeLevel=tide.target;for(const f of fishAgents)safeLevel=Math.max(safeLevel,terrainHeight(f.p.x,f.p.y)+fishClearance,fishBed(f.p.x,f.p.y)+.19);desired=Math.min(tide.current,Math.max(desired,safeLevel))}
    tide.current=desired;tide.progress=Math.abs(tide.target-tide.from)<1e-8?1:clamp((tide.current-tide.from)/(tide.target-tide.from),0,1);shared.uTide.value=tide.current;syncTideUI()}
  function syncTideUI(){const low=tide.target<-.275;$('tide-name').textContent=low?'退潮':'满潮';$('tide-toggle').setAttribute('aria-pressed',String(low));$('tide').value=String(tide.target);$('tide-value').value=tide.current.toFixed(2)+' m'}
  const SPRING_FLOW_RATE=.58;
  const shared={uSpringRate:{value:SPRING_FLOW_RATE},uTide:{value:tide.current},uHigh:{value:0},uSnow:{value:0},uTime:{value:0},uWave:{value:config.waves},uRipple:{value:null},uTerrain:{value:null},uCaustics:{value:config.caustics},uDaylight:{value:1},uWaterLight:{value:1}};
  const scene=new THREE.Scene(), particleScene=new THREE.Scene(), waterScene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(mobile?37:32,$('scene').clientWidth/$('scene').clientHeight,.1,100);
  const renderer=new THREE.WebGLRenderer({antialias:false,alpha:true,powerPreference:mobile?'low-power':'high-performance'});
  renderer.setClearColor(0,0);renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;renderer.setSize($('scene').clientWidth,$('scene').clientHeight);
  let pixelRatio=Math.min(mobile?1.5:1.75,Math.max(1,devicePixelRatio));renderer.setPixelRatio(pixelRatio);$('scene').appendChild(renderer.domElement);
  const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=!reduced;controls.dampingFactor=.055;controls.enablePan=false;controls.minDistance=3.2;controls.maxDistance=32;controls.minPolarAngle=.35;controls.maxPolarAngle=1.36;
  const homePosition=new THREE.Vector3(12.6,10.7,17.2), homeTarget=new THREE.Vector3(0,.35,0);
  function frameCamera(intro=false){camera.position.copy(homePosition).multiplyScalar(intro?1.16:1);controls.target.copy(homeTarget);controls.update()}
  frameCamera(!reduced);
  const hemi=new THREE.HemisphereLight('#dce9e4','#998266',2.25);scene.add(hemi);
  const sun=new THREE.DirectionalLight('#fff2d5',3.2);sun.position.set(-9,15,8);sun.castShadow=true;sun.shadow.mapSize.set(mobile?1536:3072,mobile?1536:3072);Object.assign(sun.shadow.camera,{left:-6.5,right:6.5,top:6.5,bottom:-6.5,near:1,far:50});sun.shadow.bias=-.00025;sun.shadow.normalBias=.018;sun.shadow.radius=3;scene.add(sun);scene.add(sun.target);
  const fill=new THREE.DirectionalLight('#c6e3e7',.55);fill.position.set(8,4,-5);scene.add(fill);
  const gateZ=3.45;
  // Keep warm light within its architectural setting, away from the rear mountain.
  const warmLights=[[-.95,1.12,-.5],[.95,.79,.34],[0,.45,gateZ]].map((p,i)=>{const l=new THREE.PointLight('#ffac58',0,[1.65,1.65,1.25][i],2);l.position.set(...p);scene.add(l);return l});

  // One baked height definition, bilinearly sampled by CPU AND every GPU system.
  const N=400,SIZE=10,RADIUS=.6,heights=new Float32Array((N+1)*(N+1));
  const inside=(x,z,pad=0)=>{const a=Math.max(Math.abs(x)-(5-RADIUS),0),b=Math.max(Math.abs(z)-(5-RADIUS),0);return Math.abs(x)<5-pad&&Math.abs(z)<5-pad&&Math.hypot(a,b)<RADIUS-pad};
  // Draft metres are converted uniformly at 0.21 scene units per design metre.
  // The supplied revised contour is already 39.5% larger than the early court.
  const DESIGN_SCALE=.21,COURT_LEVEL=.270,COURT_DEPTH=.06*DESIGN_SCALE;
  const courtWidth=1.30,courtDepth=.78,courtOutline=[[-.86,-.063],[.44,-.063],[.44,.717],[-.86,.717]];
  // Both paved routes share an early spatial definition with all planting.
  const courtWalkControls=[[-1.15,1.715],[-.92,1.60],[-.64,1.43],[-.04,1.46],[.60,1.40],[1.15,1.31],[1.37,1.20]];
  const coastWalkControls=[[2.42,.73],[2.60,.43],[2.65,.04],[2.76,-.43],[2.82,-.87]];
  const coastLoopControls=[[2.42,.73],[2.87,.99],[3.35,.85],[3.64,.40],[3.61,-.12],[3.29,-.58],[2.82,-.87]];
  const coastLinks=[[[2.145,.76],[2.27,.755],[2.42,.73]],[[2.82,-.87],[2.82,-.96],[2.82,-1.032]]];
  const walkingRoutes=[{controls:courtWalkControls,width:.205},{controls:coastWalkControls,width:.205},{controls:coastLoopControls,width:.19},...coastLinks.map(controls=>({controls,width:.205}))].map(r=>({...r,points:new THREE.CatmullRomCurve3(r.controls.map(([x,z])=>new THREE.Vector3(x,0,z))).getPoints(96)}));
  function walkingClearance(x,z){let best=Infinity;for(const route of walkingRoutes)for(let i=1;i<route.points.length;i++){
    const a=route.points[i-1],b=route.points[i],dx=b.x-a.x,dz=b.z-a.z,t=clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz),0,1);
    best=Math.min(best,Math.hypot(x-a.x-dx*t,z-a.z-dz*t)-route.width/2);
  }return Math.min(best,Math.max(Math.abs(x-2.82)-.155,Math.abs(z+1.91)-.98),Math.max(Math.abs(x+1.494)-.27,Math.abs(z-1.67)-.16));}
  const pavedCourts=[[-1.494,1.24,.90,.79],[1.70,.95,.99,.73],[1.476,.560,.65,.15],[-1.0215,.1975,.225,.783],[.8145,.391,.675,.36],[1.476,.3865,.657,.252]];
  function hardscapeClearance(x,z){return Math.min(walkingClearance(x,z),...pavedCourts.map(([cx,cz,w,d])=>Math.hypot(Math.max(Math.abs(x-cx)-w/2,0),Math.max(Math.abs(z-cz)-d/2,0))-(Math.abs(x-cx)<w/2&&Math.abs(z-cz)<d/2?.001:0)))}
  const plantClearance=(x,z,pad=.055)=>hardscapeClearance(x,z)>pad&&courtDistance(x,z)>.04;
  const readingSandOutline=[[-2.15,1.59],[-1.93,1.54],[-1.28,1.57],[-.83,1.51],[-.74,1.79],[-1.06,2.02],[-1.81,2.035],[-2.16,1.85]];
  function readingSandMask(x,z){const d=contourDistance(x,z,readingSandOutline);return (1-smooth(-.045,.055,d))*smooth(-.003,.018,hardscapeClearance(x,z));}
  function courtSandMask(x,z){
    if(x< -1.18||x>1.54||z<-.12||z>1.55)return readingSandMask(x,z);
    const outline=smooth(-1.18,-1.10,x)*smooth(1.54,1.46,x)*smooth(-.12,-.04,z)*smooth(1.55,1.43,z);
    return Math.max(readingSandMask(x,z),outline*smooth(-.004,.014,hardscapeClearance(x,z))*smooth(-.003,.014,courtDistance(x,z)));
  }
  // The house-side planting shoulder now reaches into the former lawn strip.
  // Keep a small service gap to the tea-room wall while leaving route clearance
  // to hardscapeClearance/plantClearance below.
  function coastalPlantZone(x,z){return x>2.03&&z> -1.12&&z<1.48&&Math.hypot((x-3.11)/1.25,(z-.16)/1.44)<.99}
  function coastalGroundMask(x,z){
    if(!coastalPlantZone(x,z))return 0;
    const q=Math.hypot((x-3.11)/1.25,(z-.16)/1.44);
    return smooth(.96,.83,q)*smooth(2.17,2.23,x)*smooth(-1.12,-1.04,z)*smooth(1.48,1.40,z)*smooth(.006,.033,hardscapeClearance(x,z))*smooth(.13,.21,terrainHeight(x,z));
  }
  const courtMossOutline=[[-1.12,1.74],[-.75,1.53],[-.30,1.57],[.16,1.60],[.66,1.50],[1.12,1.46],[1.53,1.59],[1.58,1.78],[1.30,1.88],[.70,1.93],[.06,1.91],[-.66,1.95]];
  const courtMossBoundary=new THREE.CatmullRomCurve3(courtMossOutline.map(([x,z])=>new THREE.Vector3(x,0,z)),true,'centripetal').getPoints(144);
  function contourDistance(x,z,points){
    let inPoly=false,best=Infinity;
    for(let i=0,j=points.length-1;i<points.length;j=i++){
      const a=points[j],b=points[i],ax=a.x??a[0],az=a.z??a[1],bx=b.x??b[0],bz=b.z??b[1];
      if((az>z)!==(bz>z)&&x<(bx-ax)*(z-az)/(bz-az)+ax)inPoly=!inPoly;
      const dx=bx-ax,dz=bz-az,t=clamp(((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz||1),0,1);best=Math.min(best,Math.hypot(x-ax-dx*t,z-az-dz*t));
    }return inPoly?-best:best;
  }
  function courtMossMask(x,z){
    if(x< -1.30||x>1.75||z<1.34||z>2.08)return 0;
    return smooth(.025,-.055,contourDistance(x,z,courtMossBoundary))*smooth(.012,.045,hardscapeClearance(x,z))*smooth(.13,.19,terrainHeight(x,z));
  }
  const polygonArea=points=>Math.abs(points.reduce((a,p,i)=>{const q=points[(i+1)%points.length];return a+p[0]*q[1]-q[0]*p[1]},0))/2;
  const courtArea=polygonArea(courtOutline),earlyCourtArea=courtArea/1.395;
  function courtDistance(x,z){let inside=false,best=Infinity;for(let i=0,j=courtOutline.length-1;i<courtOutline.length;j=i++){
    const a=courtOutline[j],b=courtOutline[i];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;
    const dx=b[0]-a[0],dz=b[1]-a[1],t=clamp(((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz),0,1);best=Math.min(best,Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t));
  }return inside?-best:best}
  // The mountain course remains natural. The residential garden has no moat.
  const springControls=[
    [[-.60,-3.15,2.900,.105],[-.70,-2.98,2.875,.145],[-.87,-2.78,2.615,.110],[-.94,-2.58,2.230,.185],[-.93,-2.40,1.800,.100],[-.88,-2.24,1.464,.145],[-.85,-2.08,1.113,.090],[-.91,-1.91,.690,.105],[-1.10,-1.76,.355,.120],[-1.54,-1.67,.310,.110],[-2.23,-1.49,.255,.120],[-2.38,-.95,.215,.145],[-2.40,-.34,.196,.110],[-2.52,.19,.09,.130],[-2.75,.55,-.005,.105],[-3.02,.90,-.035,.055]],
    [[-.71,-.091,.274,.025],[-.71,-.071,.272,.025],[-.71,-.041,.270,.025]],
    [[.39,.697,.270,.025],[.53,.79,.268,.025],[.65,.89,.262,.020]]
  ];
  // Subsurface paths are real buried geometry, shown as dashed traces only
  // when the user selects the hydrology inspection view.
  const MOUNTAIN_HEIGHT_FACTOR=1.25, PAGODA_X=2.00, PAGODA_Z=-2.95;
  // Source and cascade levels follow the raised mountain's natural downhill face.
  const gardenSupply=[[-1.54,-1.67,.310],[-1.80,-1.19,.300],[-1.62,-.58,.290],[-1.08,-.20,.280],[-.71,-.091,.274]];
  const gardenDrain=[[.65,.89,.251],[1.00,1.16,.19],[1.80,1.33,.10],[2.50,1.44,.065],[3.13,1.53,-.05],[3.62,1.56,-.35],[3.91,1.57,-.48]];
  const catmull=(a,b,c,d,t)=>.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t);
  const springCourses=springControls.map((controls,course)=>{const nodes=[];for(let i=0;i<controls.length-1;i++){
    const a=controls[Math.max(0,i-1)],b=controls[i],c=controls[i+1],d=controls[Math.min(controls.length-1,i+2)],steps=Math.max(3,Math.ceil(Math.hypot(c[0]-b[0],c[1]-b[1])/.045));
    for(let j=0;j<steps;j++){const t=j/steps,eased=course===0?mix(t,t*t*(3-2*t),b[2]-c[2]>.13?.82:.38):t;nodes.push([catmull(a[0],b[0],c[0],d[0],t),catmull(a[1],b[1],c[1],d[1],t),mix(b[2],c[2],eased),mix(b[3],c[3],t)])}
  }nodes.push([...controls.at(-1)]);let flow=0;nodes.forEach((p,i)=>{if(i)flow+=Math.hypot(p[0]-nodes[i-1][0],p[1]-nodes[i-1][1]);p[4]=flow});return {name:['Natural mountain spring','Short garden inlet','Planted overflow'][course],nodes}});
  function streamWidths(width,flow,course){return course===0?[width*(1+.21*Math.sin(flow*6.1+.7)+.055*Math.sin(flow*17.3)),width*(1+.26*Math.sin(flow*4.8+2.1)+.045*Math.sin(flow*15.7+1.2))]:[width,width]}
  const springNodes=springCourses.flatMap(c=>c.nodes);
  function sampleCourse(x,z,course=0){let best=Infinity,index=0,fraction=0;const nodes=springCourses[course].nodes;
    for(let i=0;i<nodes.length-1;i++){const a=nodes[i],b=nodes[i+1],dx=b[0]-a[0],dz=b[1]-a[1],len2=dx*dx+dz*dz,t=clamp(((x-a[0])*dx+(z-a[1])*dz)/len2,0,1),d2=(x-a[0]-dx*t)**2+(z-a[1]-dz*t)**2;if(d2<best){best=d2;index=i;fraction=t}}
    const a=nodes[index],b=nodes[index+1],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz),t=fraction,pastEnd=index===nodes.length-2&&t===1?Math.max(0,((x-b[0])*dx+(z-b[1])*dz)/len):0,px=mix(a[0],b[0],t),pz=mix(a[1],b[1],t),flow=mix(a[4],b[4],t),signed=(x-px)*(-dz/len)+(z-pz)*(dx/len),widths=streamWidths(mix(a[3],b[3],t),flow,course);return {x:px,z:pz,level:mix(a[2],b[2],t),width:widths[signed<0?0:1],leftWidth:widths[0],rightWidth:widths[1],distance:Math.sqrt(best),signed,flow,slope:(a[2]-b[2])/len,dx:dx/len,dz:dz/len,index,t,course,pastEnd};
  }
  function springSample(x,z){const samples=springCourses.map((_,i)=>sampleCourse(x,z,i)),wet=samples.filter(s=>s.distance<s.width);
    const s=(wet.length?wet:samples).reduce((a,b)=>a.distance<b.distance?a:b);
    if(courtDistance(x,z)<0)return {x,z,level:COURT_LEVEL,width:1,distance:0,dx:-.3,dz:.35,index:0,t:0,course:3};return s;
  }
  function springLevel(x,z){const s=springSample(x,z);return s.distance<s.width*.94?s.level:-9}
  function visibleWaterLevel(x,z){return Math.max(tide.current,springLevel(x,z))}
  const springField=new Float32Array((N+1)*(N+1)*4),springPrimaryField=new Float32Array((N+1)*(N+1));

  function baseSourceHeight(x,z,spring=springSample(x,z)){
    const edge=Math.max(Math.abs(x),Math.abs(z));
    const flat=-.055-.061*Math.max(z+.6,0)-.025*Math.abs(x);
    const island=2.48*MOUNTAIN_HEIGHT_FACTOR*Math.exp(-((x+.42)**2/6.9+(z+2.95)**2/2.85));
    const hillGate=smooth(1.0,3.15,-z);
    let h=flat+island*hillGate;
    const terrace=smooth(2.8,1.8,Math.abs(x))*smooth(1.0,-.25,z)*smooth(-1.85,-1.5,z);
    h=mix(h,.095,terrace*.9);
    const rockL=.67*Math.exp(-((x+3.05)**2/.58+(z+.18)**2/1.0));
    const rockR=.10*Math.exp(-((x-3.23)**2/.55+(z+.55)**2/1.15));
    h+=rockL+rockR;
    const clearing=1-smooth(1.,1.80,Math.max(Math.abs(x-PAGODA_X)/.86,Math.abs(z-PAGODA_Z)/.84));
    h=mix(h,.84,clearing);
    h+=.055*(Math.sin(x*3.1+z*1.3)*Math.sin(z*2.6)+.4*Math.sin(x*8.8-z*7.5))*smooth(.25,.8,h)*(1.-clearing);
    const drop=smooth(3.85,4.95,edge);h=mix(h,-1.025,drop);
    // The two shore approaches stay below their walkways; hillside height is
    // blended back outside the route instead of cutting through the decks.
    const approach=smooth(.52,.27,Math.abs(Math.abs(x)-2.14))*smooth(-2.35,-2.03,z)*smooth(-.25,-.55,z);
    h=mix(h,Math.min(h,.105),approach);
    h=mix(h,.84,clearing); // Keep the pagoda platform level after shore grading.
    const approachEast=smooth(.27,.16,Math.abs(x-2.82))*smooth(-2.91,-2.74,z)*smooth(-.88,-1.02,z);
    h=mix(h,.16+clamp(-z-1.03,0,1.75)*.385,approachEast);
    // Continuous planted court platform, with a graded mountain junction.
    const garden=smooth(2.43,2.12,Math.abs(x+.03))*smooth(1.93,1.57,z)*smooth(-1.76,-1.47,z);
    h=mix(h,.247,garden);
    const built=smooth(2.38,2.13,Math.abs(x-.02))*smooth(-1.60,-1.43,z)*smooth(.93,.74,z);
    h=mix(h,.245,built);
    // Grade the larger entrance footprint into the hillside with a planted shoulder.
    const entrancePad=1-smooth(0,.12,Math.max(Math.abs(x+.79)-.57,Math.abs(z+.99)-.51));
    h=mix(h,.245,entrancePad);
    const drift=(cx,cz,rx,rz,amp)=>amp*Math.exp(-((x-cx)**2/rx**2+(z-cz)**2/rz**2));
    h+=(drift(-1.22,1.34,.62,.35,.10)+drift(.56,1.44,.59,.32,.080)+drift(1.85,.86,.44,.57,.070))*(1-built);
    const entryGround=smooth(.38,.27,Math.abs(x+1.565))*smooth(.93,1.07,z)*smooth(1.37,1.29,z);h=mix(h,Math.min(h,.242),entryGround);
    // A real expanded headland supports the courts and planting, with a graded shore.
    // Overlapping lobes form one land mass; the garden no longer sits on isolated pads.
    const coastalLobe=(cx,cz,rx,rz)=>Math.hypot((x-cx)/rx,(z-cz)/rz);
    const coastQ=Math.min(coastalLobe(.10,1.10,2.42,1.08),coastalLobe(-1.53,1.34,1.03,.87),coastalLobe(1.70,1.10,1.07,.83),coastalLobe(2.82,-.06,1.18,1.91));
    const coastHeight=mix(.258,.012,smooth(.67,1.06,coastQ))+.006*Math.sin(x*3.7+z*2.4)*(1-smooth(.65,1.02,coastQ));
    const coastBlend=1-smooth(.90,1.13,coastQ);h=Math.max(h,mix(h,coastHeight,coastBlend));
    // A continuous dry planted shoulder joins the former pier shore to the temple stairs.
    // Its wide grading blends into the mountain instead of leaving a staircase over seawater.
    const dryApproach=smooth(.51,.19,Math.abs(x-2.82))*smooth(2.60,2.66,x)*smooth(-2.96,-2.77,z)*smooth(-.84,-1.025,z);
    const stairGround=.244+clamp(-z-1.03,0,1.69)*(.046/.13);
    h=mix(h,stairGround,dryApproach);
    // One graded headland supports the loop, low flower racks and island together.
    // It fades into the existing coastal shelf; the separate court outfall stays south.
    const flowerQ=Math.hypot((x-3.11)/1.30,(z-.17)/1.55),flowerBlend=1-smooth(.78,1.08,flowerQ);
    const flowerGround=.252-.225*smooth(.71,1.10,flowerQ);
    h=Math.max(h,mix(h,flowerGround,flowerBlend));
    const flowerRelief=.086*Math.exp(-((x-3.11)**2/.36**2+(z-.16)**2/.46**2))+.105*Math.exp(-((x-2.31)**2/.24**2+(z+.47)**2/.49**2))+.070*Math.exp(-((x-3.38)**2/.48**2+(z+.75)**2/.24**2));
    h+=flowerRelief*smooth(.13,.22,h)*smooth(.012,.10,walkingClearance(x,z));
    // Only architectural thresholds are level. Land beyond them keeps its natural slope.
    const westCourt=1-smooth(0,.12,Math.max(Math.abs(x+1.49)-.465,Math.abs(z-1.22)-.43));h=mix(h,.250,westCourt);
    const eastCourt=1-smooth(0,.12,Math.max(Math.abs(x-1.70)-.505,Math.abs(z-.95)-.38));h=mix(h,.250,eastCourt);
    for(const [cx,cz] of [[-1.08,1.68],[-.86,1.58],[-.67,1.43]]){const walk=1-smooth(0,.085,Math.max(Math.abs(x-cx)-.145,Math.abs(z-cz)-.105));h=mix(h,.253,walk)}
    // A level sand forecourt has a gently graded planted perimeter.
    const forecourtD=contourDistance(x,z,readingSandOutline),forecourtGrade=1-smooth(-.018,.105,forecourtD);h=mix(h,.253,forecourtGrade);
    // The stream stops at the shore. Its bed and banks gently lose relief as
    // they meet the natural shelf, rather than cutting a trench beneath the sea.
    // The buried branch is covered by a low planted shoulder or the terrace.
    // The intake runs beneath the bedroom floor and gallery; no surface trench.
    if(spring.course===0){
      const shore=smooth(-.045,.025,h)*(1-smooth(0,.055,spring.pastEnd)),q=spring.distance/spring.width;
      const depth=mix(.100,.090,clamp(spring.slope*.65,0,1)),shoulder=spring.width+(z< -1.78?.23:.060);
      const blend=1-smooth(spring.width*.96,shoulder,spring.distance),bedRough=.005*Math.sin(spring.flow*19+q*6)*Math.max(0,1-q);
      const bowl=q<=1?spring.level-depth*(1-q*q)+.010*Math.pow(q,4)+bedRough:spring.level+.010+.075*(q-1);
      h=mix(h,bowl,blend*shore);
    }else if(spring.course!==3){const bank=1-smooth(spring.width+.008,spring.width+.065,spring.distance),cut=1-smooth(spring.width-.006,spring.width+.006,spring.distance);h=mix(h,Math.max(h,spring.level+.006),bank*.70);h=mix(h,spring.level-.0105,cut)}
    const courtD=courtDistance(x,z),courtCut=1-smooth(-.018,.013,courtD);h=mix(h,COURT_LEVEL-COURT_DEPTH-.005,courtCut);
    // A sloping planted bank on the two open sides, retaining crisp west/north edges.
    if(courtD>0&&z>.35&&x>-.87&&x<.51&&!(spring.course===2&&spring.distance<spring.width+.013))h=mix(h,Math.max(h,COURT_LEVEL+.009),1-smooth(.008,.07,courtD));

    return Math.max(h,-1.07);
  }
  function sourceHeight(x,z,spring=springSample(x,z)){
    const h=baseSourceHeight(x,z,spring);
    if(x<=2.20||x>=2.85||z<=1.22||z>=2.17)return h;
    // Fill the local saddle using the two existing shores as height anchors.
    // Their seaward fall is retained; easing the uplift keeps the join smooth.
    const left=baseSourceHeight(2.20,z),right=baseSourceHeight(2.85,z);
    const joined=mix(left,right,(x-2.20)/.65),fill=Math.max(0,joined-h);
    const shoreJoin=smooth(1.22,1.42,z)*(1-smooth(1.87,2.17,z));
    return h+fill*smooth(0,.012,fill)*shoreJoin;
  }
  for(let j=0;j<=N;j++)for(let i=0;i<=N;i++){const x=i/N*10-5,z=j/N*10-5,k=j*(N+1)+i,s=springSample(x,z);heights[k]=sourceHeight(x,z,s);springField[k*4]=s.level;springField[k*4+1]=s.distance<s.width*.94?1:0;springField[k*4+2]=s.course+1;springField[k*4+3]=s.distance/s.width;const primary=sampleCourse(x,z,0);springPrimaryField[k]=1-smooth(.86,.98,primary.distance/primary.width)}
  function terrainHeight(x,z){const fx=clamp((x+5)*N/10,0,N-.0001),fz=clamp((z+5)*N/10,0,N-.0001),i=Math.floor(fx),j=Math.floor(fz),a=fx-i,b=fz-j,k=j*(N+1)+i;return mix(mix(heights[k],heights[k+1],a),mix(heights[k+N+1],heights[k+N+2],a),b)}
  function terrainSlope(x,z){const e=.05;return Math.hypot(terrainHeight(x+e,z)-terrainHeight(x-e,z),terrainHeight(x,z+e)-terrainHeight(x,z-e))/(e*2)}
  const heightTex=new THREE.DataTexture(heights,N+1,N+1,THREE.RedFormat,THREE.FloatType);heightTex.minFilter=heightTex.magFilter=THREE.LinearFilter;heightTex.needsUpdate=true;shared.uTerrain.value=heightTex;
  const springTex=new THREE.DataTexture(springField,N+1,N+1,THREE.RGBAFormat,THREE.FloatType);springTex.minFilter=springTex.magFilter=THREE.LinearFilter;springTex.needsUpdate=true;shared.uSpring={value:springTex};
  const primaryTex=new THREE.DataTexture(springPrimaryField,N+1,N+1,THREE.RedFormat,THREE.FloatType);primaryTex.minFilter=primaryTex.magFilter=THREE.LinearFilter;primaryTex.needsUpdate=true;shared.uPrimary={value:primaryTex};
  const heightGLSL=`uniform sampler2D uTerrain;uniform sampler2D uSpring;uniform float uTide;uniform float uHigh;
    float terrainAt(vec2 p){vec2 uv=(clamp(p/10.+.5,0.,1.)*400.+.5)/401.;return texture2D(uTerrain,uv).r;}
    float roundedMask(vec2 p){vec2 q=abs(p)-vec2(4.4);return 1.-step(.6,length(max(q,0.)));}
    float depthAt(vec2 p){return uTide-terrainAt(p);}
    float riverAt(vec2 p){vec2 uv=(clamp(p/10.+.5,0.,1.)*400.+.5)/401.;vec2 s=texture2D(uSpring,uv).rg;return s.g>.5?s.r:-9.;}
    float freshwaterKind(vec2 p){vec2 uv=(clamp(p/10.+.5,0.,1.)*400.+.5)/401.;return texture2D(uSpring,uv).b;}
    float visibleWaterAt(vec2 p){return max(uTide,riverAt(p));}`;
  const noiseGLSL=`uniform float uDaylight;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
    float detailVisibility(vec2 p){float footprint=max(length(dFdx(p)),length(dFdy(p)));return 1.-smoothstep(.32,1.12,footprint);}
    float filteredNoise(vec2 p){return mix(.5,noise(p),detailVisibility(p));}
    float filteredWave(float phase){float footprint=fwidth(phase);return .5+.5*sin(phase)*exp(-.36*footprint*footprint);}
    float filteredFlecks(vec2 p,float threshold){return mix(1.-threshold,step(threshold,hash(floor(p))),detailVisibility(p));}

    float oceanCaustics(vec2 p,float time,float depth){
      // Both seabed and submerged stone receive sunlight caustics, rather than emitting them at night.
      if(depth<=0.||uDaylight<=0.)return 0.;
      vec2 drift=vec2(time*.095,-time*.064);
      vec2 warp=vec2(noise(p*1.15+vec2(time*.055,0.)),noise(p*1.07+vec2(7.3,-time*.061)))-.5;
      vec2 fineWarp=vec2(noise(p*3.8+vec2(time*.081,5.3)),noise(p.yx*3.5+vec2(9.1,-time*.073)))-.5;
      vec2 q=mat2(.91,-.42,.42,.91)*(p*5.2)+drift+warp*.65+fineWarp*1.08,cell=floor(q),f=fract(q);
      float nearest=8.,second=8.;
      for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
        vec2 g=vec2(float(i),float(j)),id=cell+g;
        vec2 seed=vec2(hash(id),hash(id+vec2(31.7,19.3)));
        vec2 point=.5+.36*sin(seed*6.283185+time*vec2(.39,.31)+vec2(0.,1.6));
        float d=length(g+point-f);if(d<nearest){second=nearest;nearest=d;}else second=min(second,d);
      }
      float gap=second-nearest,aa=max(fwidth(gap)*1.2,.010);
      float width=.026+.018*noise(p*2.1+drift*.4);
      float filament=1.-smoothstep(width-aa,width+.037+aa,gap);
      filament*=smoothstep(.24,.58,filteredNoise(p*4.2+drift*.8));
      float intensity=.62+.38*filteredNoise(p*2.8+vec2(-time*.10,time*.04));
      return .77*filament*intensity*exp(-max(depth,0.)*.64)*detailVisibility(q*.30)*uDaylight;
    }
  `;
  const waveGLSL=`uniform float uSpringRate;uniform float uTime;uniform float uWave;uniform sampler2D uRipple;
    float rippleAt(vec2 p){return texture2D(uRipple,p/10.+.5).r;}
    float waterHeight(vec2 p){float d=max(depthAt(p),0.);float shore=smoothstep(0.,.12,d);return uTide+shore*(uWave*(.53*sin(p.x*2.3+p.y*1.1+uTime*1.15)+.25*sin(p.y*4.1-p.x*.7-uTime*1.4)) + rippleAt(p));}
    float freshwaterOffset(vec2 p,float kind){float ripple=rippleAt(p),mountain=1.-step(1.5,kind);float flowTime=uTime*mix(1.,uSpringRate,mountain);float flowing=mix(.00045,.0018,mountain)*(sin(p.x*7.+p.y*5.-flowTime*mix(.32,1.3,mountain))*.57+sin(p.x*4.-p.y*8.-flowTime*mix(.27,1.8,mountain))*.28)+ripple*mix(.045,.28,mountain);float quiet=.00035*sin(p.x*7.+p.y*9.-uTime*.35)+clamp(ripple*.055,-.001,.001);return mix(flowing,quiet,step(3.5,kind));}
    float freshwaterHeight(vec2 p){return riverAt(p)+freshwaterOffset(p,freshwaterKind(p));}`;
  const tp=[],ti=[],tao=[],cover=[],sandCover=[],gardenCover=[],courtMossCover=[];
  for(let j=0;j<=N;j++)for(let i=0;i<=N;i++){
    const x=i/N*10-5,z=j/N*10-5,h=heights[j*(N+1)+i];tp.push(x,h,z);
    let horizon=0;for(let d=0;d<6;d++){const a=d*TAU/6;let highest=0;for(const r of [.15,.4,.8,1.5])highest=Math.max(highest,(terrainHeight(x+Math.cos(a)*r,z+Math.sin(a)*r)-h)/r);horizon+=Math.atan(highest)}
    tao.push(clamp(1-horizon/(6*Math.PI*.62),.48,1));cover.push(smooth(.22,.85,h)*smooth(-1,-2,z)*.30);
    if(i<N&&j<N){const a=j*(N+1)+i,b=a+1,c=a+N+1,d=c+1;const x2=x+10/N,z2=z+10/N;if(inside(x,z)&&inside(x2,z)&&inside(x,z2))ti.push(a,c,b);if(inside(x2,z2)&&inside(x2,z)&&inside(x,z2))ti.push(b,c,d)}
  }
  for(let i=0;i<tp.length;i+=3){sandCover.push(courtSandMask(tp[i],tp[i+2]));gardenCover.push(coastalGroundMask(tp[i],tp[i+2]));courtMossCover.push(courtMossMask(tp[i],tp[i+2]));}
  const terrainGeo=new THREE.BufferGeometry();terrainGeo.setAttribute('position',new THREE.Float32BufferAttribute(tp,3));terrainGeo.setAttribute('aHorizon',new THREE.Float32BufferAttribute(tao,1));terrainGeo.setAttribute('aCover',new THREE.Float32BufferAttribute(cover,1));terrainGeo.setAttribute('aCourtSand',new THREE.Float32BufferAttribute(sandCover,1));terrainGeo.setIndex(ti);terrainGeo.computeVertexNormals();
  const terrainMat=new THREE.MeshStandardMaterial({color:'#b5af83',roughness:.91});
  terrainGeo.setAttribute('aGardenCover',new THREE.Float32BufferAttribute(gardenCover,1));
  terrainGeo.setAttribute('aCourtMoss',new THREE.Float32BufferAttribute(courtMossCover,1));
  terrainMat.onBeforeCompile=s=>{
    Object.assign(s.uniforms,shared);s.vertexShader='attribute float aHorizon;attribute float aCover;attribute float aCourtSand;varying float vCourtSand;varying vec3 vLand;varying vec3 vLandNormal;varying float vAO;\n'+s.vertexShader;
    s.vertexShader=s.vertexShader.replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nvCourtSand=aCourtSand;vLand=(modelMatrix*vec4(transformed,1.)).xyz;vLandNormal=normalize(mat3(modelMatrix)*objectNormal);vAO=aHorizon*(1.-aCover);');
    s.fragmentShader='varying float vCourtSand;varying vec3 vLand;varying vec3 vLandNormal;varying float vAO;uniform sampler2D uSpring;uniform float uTide;uniform float uHigh;uniform float uSnow;uniform float uTime;uniform float uCaustics;\n'+noiseGLSL+s.fragmentShader;
    s.vertexShader='attribute float aGardenCover;attribute float aCourtMoss;varying float vGardenCover;varying float vCourtMoss;\n'+s.vertexShader;
    s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvGardenCover=aGardenCover;vCourtMoss=aCourtMoss;');
    s.fragmentShader='varying float vGardenCover;varying float vCourtMoss;\n'+s.fragmentShader;
    s.fragmentShader=s.fragmentShader.replace('void main() {',`
      // Planar planting and sand detail belong to dry, nearly level ground.
      // The mountain retains its existing moss; the bay and flower headland
      // fade to exposed bank material as elevation or normal.y decreases.
      float coastRegion(){
        return max(smoothstep(.70,1.10,vLand.z),smoothstep(2.05,2.40,vLand.x)*(1.-smoothstep(1.65,1.90,abs(vLand.z))));
      }
      float coastGroundCoverage(){
        float levelGround=smoothstep(.86,.975,normalize(vLandNormal).y);
        // The dry terrace contains planted rolls as well as flat ground.
        // Preserve their colour above the bank crest, even on a local slope.
        float terrace=smoothstep(.215,.245,vLand.y);
        float dryPlatform=smoothstep(.17,.235,vLand.y);
        return mix(1.,mix(levelGround,1.,terrace)*dryPlatform,coastRegion());
      }
      float coastSandDetailCoverage(){
        // Sand normal detail still fades on slopes; restoring grass must not
        // restore the former stretched detail on the exposed bank face.
        float levelGround=smoothstep(.86,.975,normalize(vLandNormal).y);
        float dryPlatform=smoothstep(.17,.235,vLand.y);
        return mix(1.,levelGround*dryPlatform,coastRegion());
      }
      void main() {
    `);
    s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      float coastalGround=coastGroundCoverage();
      float bankFace=coastRegion()*(1.-coastalGround);
      float grain=filteredNoise(vLand.xz*120.)*.14+filteredNoise(vLand.xz*27.)*.07;
      // Blend all three surface projections so steep banks do not stretch
      // horizontal sand grain into vertical colour streaks.
      vec3 grainWeights=pow(abs(normalize(vLandNormal)),vec3(4.));
      grainWeights/=max(dot(grainWeights,vec3(1.)),.0001);
      float bankGrain=grain*grainWeights.y;
      bankGrain+=(filteredNoise(vLand.zy*120.)*.14+filteredNoise(vLand.zy*27.)*.07)*grainWeights.x;
      bankGrain+=(filteredNoise(vLand.xy*120.)*.14+filteredNoise(vLand.xy*27.)*.07)*grainWeights.z;
      grain=mix(grain,bankGrain,bankFace);
      float steep=1.-normalize(vLandNormal).y;float rock=smoothstep(.48,.75,steep);
      rock=max(rock,.88*smoothstep(2.45,2.88,abs(vLand.x))*(1.-smoothstep(.4,1.3,abs(vLand.z+.3)))*smoothstep(-.02,.22,vLand.y));
      float submerged=1.-smoothstep(uTide-.025,uTide+.018,vLand.y);
      float wet=(1.-smoothstep(uHigh+.03,uHigh+.15,vLand.y))*.48;
      float movingWet=1.-smoothstep(uTide+.025,uTide+.12,vLand.y);
      vec3 sand=mix(vec3(.68,.58,.40),vec3(.42,.38,.27),max(wet,movingWet*.8));sand+=grain*.27;
      vec3 granite=vec3(.42,.44,.39)+grain*.53;granite*=1.-movingWet*.25;granite=mix(granite,vec3(.16,.23,.19)+grain*.3,submerged*.7);
      vec3 bankSand=mix(vec3(.645,.601,.495),vec3(.448,.428,.367),max(wet,movingWet*.8))+grain*.27;
      vec3 bankGranite=(vec3(.450,.447,.412)+grain*.53)*(1.-movingWet*.25);
      bankGranite=mix(bankGranite,vec3(.26,.28,.27)+grain*.3,submerged*.7);
      sand=mix(sand,bankSand,bankFace);granite=mix(granite,bankGranite,bankFace);
      float moss=smoothstep(.16,.48,vLand.y)*(1.-rock);moss=max(moss,smoothstep(.73,.9,noise(vLand.xz*2.4))*smoothstep(.02,.16,vLand.y)*(1.-rock)*.6);moss*=coastalGround;
      vec3 ground=mix(sand,vec3(.27,.36,.18)+grain*.35,moss);ground=mix(ground,granite,rock);
      float plantedCourt=smoothstep(-1.0,-.65,vLand.z)*(1.-smoothstep(1.70,1.93,vLand.z))*(1.-smoothstep(2.04,2.29,abs(vLand.x)))*(1.-submerged);
      ground=mix(ground,vec3(.24,.33,.16)+grain*.28,plantedCourt*.90*coastalGround);
      vec4 stream=texture2D(uSpring,(clamp(vLand.xz/10.+.5,0.,1.)*400.+.5)/401.);
      float streamZone=step(.5,stream.b)*(1.-step(1.5,stream.b))*smoothstep(-.015,.08,stream.r);
      float dampBank=(1.-smoothstep(.9,2.6,stream.a))*streamZone;
      float streamBed=(1.-smoothstep(-.004,.020,vLand.y-stream.r))*streamZone*(1.-smoothstep(.9,1.2,stream.a));
      float cobble=filteredNoise(vLand.xz*53.);vec3 riverbed=mix(vec3(.30,.33,.27),vec3(.46,.46,.35),smoothstep(.30,.72,cobble));
      ground=mix(ground,vec3(.25,.34,.18)+grain*.32,dampBank*.60*(1.-streamBed)*coastalGround);ground=mix(ground,riverbed+grain*.18,streamBed*.90);
      vec2 sandP=vLand.xz;float sandGrain=filteredNoise(sandP*183.)*.65+filteredNoise(sandP*79.+8.)*.35;
      float sandCloud=filteredNoise(sandP*5.3);float sandRake=filteredWave((sandP.y+.047*sin(sandP.x*2.7)+.026*noise(sandP*3.1))*64.);
      float sandFleck=filteredFlecks(sandP*vec2(247.,213.),.81);float sandBlend=smoothstep(0.,.98,vCourtSand+.08*(filteredNoise(sandP*67.)-.5)*vCourtSand*(1.-vCourtSand))*(1.-submerged)*coastalGround;
      vec3 drySand=mix(vec3(.32,.30,.245),vec3(.47,.435,.355),sandCloud*.56+.16);drySand*=1.+(sandGrain-.5)*.31+(sandRake-.5)*.052-sandFleck*.09;
      ground=mix(ground,drySand,sandBlend);
      float foliageTone=filteredNoise(vLand.xz*16.);float rootedCover=vGardenCover*(1.-submerged)*coastalGround;
      vec3 gardenFloor=mix(vec3(.155,.215,.115),vec3(.235,.295,.165),foliageTone);gardenFloor*=1.+(filteredNoise(vLand.xz*95.)-.5)*.24;
      ground=mix(ground,gardenFloor,rootedCover);
      vec3 softMoss=mix(vec3(.235,.30,.145),vec3(.33,.385,.205),filteredNoise(vLand.xz*9.));softMoss*=1.+(filteredNoise(vLand.xz*95.)-.5)*.16;
      ground=mix(ground,softMoss,vCourtMoss*(1.-submerged)*coastalGround);
      float coastalDust=1.-.78*smoothstep(2.12,2.40,vLand.x)*(1.-smoothstep(1.35,1.60,vLand.z))*smoothstep(-1.16,-.94,vLand.z);float snow=uSnow*smoothstep(.45,.88,vLandNormal.y)*(1.-submerged)*coastalDust;ground=mix(ground,vec3(.88,.91,.88),snow);
      diffuseColor.rgb=ground*vAO;`);
    s.fragmentShader=s.fragmentShader.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
      float ca=oceanCaustics(vLand.xz,uTime,max(uTide-vLand.y,0.));
      totalEmissiveRadiance+=vec3(.17,.24,.18)*ca*uCaustics*(1.-smoothstep(uTide-.03,uTide+.01,vLand.y));`);
    s.fragmentShader=s.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
      float sandDetail=vCourtSand*coastSandDetailCoverage();
      if(sandDetail>.04){vec2 p=vLand.xz*183.;vec2 d=vec2(noise(p-vec2(.5,0.))-noise(p+vec2(.5,0.)),noise(p-vec2(0.,.5))-noise(p+vec2(0.,.5)));
      float visibility=exp(-dot(fwidth(p),fwidth(p))*.32);normal=normalize(normal+mat3(viewMatrix)*vec3(d.x,0.,d.y)*.29*sandDetail*visibility);}
    `);
  };
  await window.shiosaiStage('山林与海岸已就绪',1);
  const terrain=new THREE.Mesh(terrainGeo,terrainMat);terrain.receiveShadow=true;terrain.castShadow=true;scene.add(terrain);
  function roundedContour(inset=0,count=32){const r=Math.max(.01,RADIUS-inset),a=5-RADIUS,pts=[];for(let q=0;q<4;q++)for(let k=0;k<count;k++){const angle=-Math.PI/2+q*Math.PI/2+k/count*Math.PI/2;const cx=q===0||q===1?a:-a,cz=q===0||q===3?-a:a;pts.push(new THREE.Vector2(cx+Math.cos(angle)*r,cz+Math.sin(angle)*r))}return pts}
  const contour=roundedContour(),skirtP=[],skirtI=[];for(const p of contour)skirtP.push(p.x,terrainHeight(p.x,p.y),p.y,p.x,tide.bottom,p.y);for(let i=0;i<contour.length;i++){const a=i*2,b=((i+1)%contour.length)*2;skirtI.push(a,b,a+1,b,b+1,a+1)}
  const skirtG=new THREE.BufferGeometry();skirtG.setAttribute('position',new THREE.Float32BufferAttribute(skirtP,3));skirtG.setAttribute('aHorizon',new THREE.Float32BufferAttribute(new Array(skirtP.length/3).fill(.85),1));skirtG.setAttribute('aCover',new THREE.Float32BufferAttribute(new Array(skirtP.length/3).fill(0),1));skirtG.setAttribute('aCourtSand',new THREE.Float32BufferAttribute(new Array(skirtP.length/3).fill(0),1));skirtG.setIndex(skirtI);skirtG.computeVertexNormals();const skirt=new THREE.Mesh(skirtG,terrainMat);skirt.receiveShadow=true;scene.add(skirt);
  skirtG.setAttribute('aGardenCover',new THREE.Float32BufferAttribute(new Array(skirtP.length/3).fill(0),1));
  skirtG.setAttribute('aCourtMoss',new THREE.Float32BufferAttribute(new Array(skirtP.length/3).fill(0),1));
  const baseShape=new THREE.Shape();contour.forEach((p,i)=>i?baseShape.lineTo(p.x,p.y):baseShape.moveTo(p.x,p.y));baseShape.closePath();
  const baseGeo=new THREE.ExtrudeGeometry(baseShape,{depth:.13,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.04,bevelThickness:.035,curveSegments:12});baseGeo.rotateX(Math.PI/2);baseGeo.translate(0,tide.bottom-.055,0);
  const base=new THREE.Mesh(baseGeo,new THREE.MeshStandardMaterial({color:'#c3ae84',roughness:.87}));base.receiveShadow=true;base.castShadow=true;scene.add(base);
  // The receiving plane has a radial alpha falloff: dusk shadows cannot streak across the paper.
  const floorMat=new THREE.ShadowMaterial({opacity:.17,transparent:true,depthWrite:false});floorMat.onBeforeCompile=s=>{s.vertexShader='varying vec3 vFloor;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvFloor=(modelMatrix*vec4(position,1.)).xyz;');s.fragmentShader='varying vec3 vFloor;\n'+s.fragmentShader;s.fragmentShader=s.fragmentShader.replace('gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );','gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) * (1.-smoothstep(5.3,9.,length(vFloor.xz))) );')};
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(26,26),floorMat);floor.rotation.x=-Math.PI/2;floor.position.y=-1.38;floor.receiveShadow=true;scene.add(floor);

  // Builder attributes are FACE attributes. Welding includes every attribute,
  // so hard normals and surface/snow/color discontinuities stay intact.
  const SURFACE={ROOF:0,UNDERSIDE:1,DECK:2,PAINT:3,WOOD:4,PLASTER:5,STONE:6,METAL:7,VEGETATION:8,GRAVEL:9,PAVING:10,FLOWER:11,PAPER:12,FLOOR:13,CEILING:14,CEILING_LIGHT:15,MINERAL_SOFFIT:16,BALCONY_SOFFIT:17,UPPER_OAK:18,UPPER_FABRIC:19,UPPER_WALL:20,NORDIC_WOOL:21,NORDIC_STONE:22,NORDIC_OPAL:23,LUXE_MARBLE:24,LUXE_BRASS:25,LUXE_VELVET:26,LUXE_LACQUER:27};
  const PAINT='#a52b20',EDGE='#302d27',WOOD='#796048',PLASTER='#ddd8c4',ROOF='#46505a',STONE='#787e78',TIMBER='#4b4034';
  class Builder{
    constructor(){this.parts=[];this.glows=[];this.m=new THREE.Matrix4();this.q=new THREE.Quaternion();this.euler=new THREE.Euler();}
    add(geometry,c,position=[0,0,0],rotation=[0,0,0],scale=[1,1,1],type=SURFACE.PAINT,snow=0,glow=false){
      let g=geometry.index?geometry.toNonIndexed():geometry.clone();if(!g.getAttribute('normal'))g.computeVertexNormals();
      // Collapsed leaf tips, clipped stone facets and bevel ends can generate
      // zero-area triangles. Remove them before welding or transforming normals.
      const positions=g.attributes.position,normals=g.attributes.normal,keep=[],ab=new THREE.Vector3(),ac=new THREE.Vector3(),face=new THREE.Vector3();
      for(let i=0;i<positions.count;i+=3){ab.set(positions.getX(i+1)-positions.getX(i),positions.getY(i+1)-positions.getY(i),positions.getZ(i+1)-positions.getZ(i));ac.set(positions.getX(i+2)-positions.getX(i),positions.getY(i+2)-positions.getY(i),positions.getZ(i+2)-positions.getZ(i));face.crossVectors(ab,ac);if(face.lengthSq()<1e-18)continue;face.normalize();for(let j=i;j<i+3;j++){if(Math.hypot(normals.getX(j),normals.getY(j),normals.getZ(j))<.5)normals.setXYZ(j,face.x,face.y,face.z);keep.push(j)}}
      if(keep.length===0){g.dispose();return this}if(keep.length!==positions.count){const clean=new THREE.BufferGeometry();for(const [name,attribute] of Object.entries(g.attributes)){const array=new Float32Array(keep.length*attribute.itemSize);for(let i=0;i<keep.length;i++)for(let k=0;k<attribute.itemSize;k++)array[i*attribute.itemSize+k]=attribute.array[keep[i]*attribute.itemSize+k];clean.setAttribute(name,new THREE.BufferAttribute(array,attribute.itemSize))}g.dispose();g=clean}
      const localPosition=g.attributes.position.clone();g.computeBoundingBox();const span=g.boundingBox.getSize(new THREE.Vector3());const axis=span.y>span.x&&span.y>span.z?1:span.z>span.x?2:0;const seed=this.parts.length+this.glows.length;
      this.q.setFromEuler(this.euler.set(...rotation));this.m.compose(new THREE.Vector3(...position),this.q,new THREE.Vector3(...scale));g.applyMatrix4(this.m);
      g.deleteAttribute('uv');g.clearGroups();const n=g.attributes.position.count,col=color(c),cols=new Float32Array(n*3),types=new Float32Array(n),snows=new Float32Array(n);
      const sourceColor=g.getAttribute('color'),seeds=new Float32Array(n),axes=new Float32Array(n);
      for(let i=0;i<n;i++){cols.set([col.r*(sourceColor?sourceColor.getX(i):1),col.g*(sourceColor?sourceColor.getY(i):1),col.b*(sourceColor?sourceColor.getZ(i):1)],i*3);types[i]=type;snows[i]=typeof snow==='function'?snow(g.attributes.normal,i):snow;seeds[i]=seed;axes[i]=axis}
      g.setAttribute('color',new THREE.BufferAttribute(cols,3));g.setAttribute('surfaceType',new THREE.BufferAttribute(types,1));g.setAttribute('snowEligible',new THREE.BufferAttribute(snows,1));
      g.setAttribute('localPosition',localPosition);g.setAttribute('partSeed',new THREE.BufferAttribute(seeds,1));g.setAttribute('detailAxis',new THREE.BufferAttribute(axes,1));
      // mergeVertices hashes normals, vertex colors, surfaceType AND snowEligible.
      g=mergeVertices(g,1e-5);(glow?this.glows:this.parts).push(g);return this;
    }
    box(x,y,z,w,h,d,c,type=SURFACE.PAINT,snow=0){return this.add(new THREE.BoxGeometry(w,h,d),c,[x,y,z],[0,0,0],[1,1,1],type,snow)}
    cyl(x,y,z,rt,rb,h,c,type=SURFACE.PAINT,snow=0,segments=12){return this.add(new THREE.CylinderGeometry(rt,rb,h,segments),c,[x,y,z],[0,0,0],[1,1,1],type,snow)}
    sphere(x,y,z,r,c,type=SURFACE.STONE,snow=1){return this.add(new THREE.IcosahedronGeometry(r,1),c,[x,y,z],[0,0,0],[1,1,1],type,snow)}
    beam(a,b,r,c=WOOD,type=SURFACE.WOOD){const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),delta=end.clone().sub(start);const g=new THREE.CylinderGeometry(r*.8,r,delta.length(),7);const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());g.applyQuaternion(q);return this.add(g,c,start.add(end).multiplyScalar(.5).toArray(),[0,0,0],[1,1,1],type,0)}
  }
  const builder=new Builder();
  // Root collars taper into the soil instead of forming exposed straight braces.
  function treeRootCollar(x,z,r,bark){
    const y=terrainHeight(x,z),positions=[],indices=[],segments=12;
    for(let k=0;k<3;k++)for(let j=0;j<segments;j++){
      const a=j*TAU/segments,lobe=1+.09*Math.sin(a*3+x*7+z*4),rr=r*(k===0?1.70:k===1?1.30:1)*lobe;
      const px=x+Math.cos(a)*rr,pz=z+Math.sin(a)*rr,py=k===2?y+r*1.8:terrainHeight(px,pz)+(k===0?-.013:.002);
      positions.push(px,py,pz);
    }
    for(let k=0;k<2;k++)for(let j=0;j<segments;j++){const a=k*segments+j,b=k*segments+(j+1)%segments;indices.push(a,a+segments,b,b,a+segments,b+segments)}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();
    const part=builder.parts.length;builder.add(g,bark,[0,0,0],[0,0,0],[1,1,1],SURFACE.WOOD,0);return {x,z,r,part};
  }
  const topSnow=(normal,i)=>normal.getY(i)>.35?1:0;
  // Spatial envelopes reserve the complete roof, posts and circulation routes.
  const architectureBounds=[],rockPlacements=[];
  function reserve(x,z,hx,hz,low,high,label){architectureBounds.push({x,z,hx,hz,low,high,label})}
  function intersectsBuilding(x,z,r,low=-2,high=8){return architectureBounds.some(b=>Math.abs(x-b.x)<b.hx+r&&Math.abs(z-b.z)<b.hz+r&&high>b.low&&low<b.high)}
  function tube(points,r,c,type=SURFACE.WOOD,snow=0){const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));return builder.add(new THREE.TubeGeometry(curve,Math.max(8,points.length*3),r,5,false),c,[0,0,0],[0,0,0],[1,1,1],type,snow)}
  function roof(x,y,z,w,d,h,bark=false){
    reserve(x,z,w/2+.055,d/2+.055,y-.12,y+h+.10,'roof');
    const rings=14,pts=[],idx=[],lift=.065,boundary=[],ridgeWidth=Math.max(w*.18,w-d*.64);
    for(let i=0;i<10;i++)boundary.push([-1+i/5,-1]);for(let i=0;i<10;i++)boundary.push([1,-1+i/5]);for(let i=0;i<10;i++)boundary.push([1-i/5,1]);for(let i=0;i<10;i++)boundary.push([-1,1-i/5]);const count=boundary.length;
    const surface=(sx,sz,t)=>[sx*mix(w*.5,ridgeWidth*.5,t),h*(.27*t+.73*t*t)+lift*Math.pow(Math.abs(sx*sz),4)*Math.pow(1-t,3),sz*mix(d*.5,.025,t)];
    for(let j=0;j<=rings;j++)for(const [sx,sz] of boundary)pts.push(...surface(sx,sz,j/rings));
    for(let j=0;j<rings;j++)for(let q=0;q<count;q++){const a=j*count+q,b=j*count+(q+1)%count,c=a+count,e=b+count;idx.push(a,c,b,b,c,e)}
    const cap=pts.length/3;pts.push(0,h,0);for(let q=0;q<count;q++)idx.push(rings*count+q,cap,rings*count+(q+1)%count);
    const top=new THREE.BufferGeometry();top.setAttribute('position',new THREE.Float32BufferAttribute(pts,3));top.setIndex(idx);top.computeVertexNormals();builder.add(top,bark?'#514b3d':ROOF,[x,y,z],[0,0,0],[1,1,1],SURFACE.ROOF,1);
    const under=top.clone(),reverse=Array.from(under.index.array);for(let k=0;k<reverse.length;k+=3)[reverse[k+1],reverse[k+2]]=[reverse[k+2],reverse[k+1]];under.setIndex(reverse);under.translate(0,-.040,0);under.computeVertexNormals();builder.add(under,'#796044',[x,y,z],[0,0,0],[1,1,1],SURFACE.UNDERSIDE,0);
    // Actual raised tile rolls, rounded eave ends and an articulated ridge.
    for(let q=0;q<count;q+=2){
      const [sx,sz]=boundary[q],samples=[];for(let j=0;j<=9;j++){const p=surface(sx,sz,j/9);samples.push([x+p[0],y+p[1]+.021,z+p[2]])}
      tube(samples,bark?.009:.013,bark?'#635e4c':q%3===0?'#56616a':'#3d474f',SURFACE.ROOF,1);
      const p=surface(sx,sz,0);if(!bark)builder.sphere(x+p[0],y+p[1]+.012,z+p[2],.014,'#6b747a',SURFACE.ROOF,1);

      const a=boundary[q],b=boundary[(q+2)%count],p1=surface(...a,0),p2=surface(...b,0);builder.beam([x+p1[0],y+p1[1]-.016,z+p1[2]],[x+p2[0],y+p2[1]-.016,z+p2[2]],.014,'#a09073',SURFACE.WOOD);
    }
    builder.box(x,y+h+.015,z,ridgeWidth+.045,.032,.060,bark?'#3e4033':'#303b42',SURFACE.ROOF,topSnow);
    if(!bark)for(let u=-ridgeWidth/2;u<=ridgeWidth/2;u+=.080)builder.add(new THREE.CylinderGeometry(.026,.026,.043,8),'#535e66',[x+u,y+h+.034,z],[0,0,Math.PI/2],[1,1,1],SURFACE.ROOF,topSnow);
    for(const s of [-1,1]){builder.box(x+s*(ridgeWidth/2+.015),y+h+.047,z,.025,.075,.055,'#44515a',SURFACE.ROOF,topSnow);builder.sphere(x+s*(ridgeWidth/2+.016),y+h+.086,z,.023,'#59656d',SURFACE.ROOF,1)}
  }
  function deck(x,z,w,d,y=.26,rail=false){
    reserve(x,z,w/2+.035,d/2+.035,-1.2,y+(rail?.36:.07),'deck');
    for(let u=-w/2;u<w/2;u+=.095){const width=Math.min(.088,w/2-u);builder.box(x+u+width/2,y,z,width,.061,d,color(WOOD).offsetHSL(0,0,rnd(-.045,.045)),SURFACE.DECK,topSnow);if(u+.095<w/2)builder.box(x+u+.091,y+.018,z,.006,.012,d,EDGE,SURFACE.WOOD,0);
      for(const dz of [-d/2+.035,d/2-.035])builder.cyl(x+u+width/2,y+.032,z+dz,.004,.004,.003,'#45433c',SURFACE.METAL,0,6);
    }
    for(const dz of [-d/2,d/2])builder.box(x,y-.051,z+dz,w+.07,.10,.070,EDGE,SURFACE.WOOD);for(const dx of [-w/2,w/2])builder.box(x+dx,y-.046,z,.065,.10,d,EDGE,SURFACE.WOOD);
    const nx=Math.max(1,Math.ceil(w/.54)),nz=Math.max(1,Math.ceil(d/.55));
    for(let i=0;i<=nx;i++)for(let j=0;j<=nz;j++){const px=x-w/2+i*w/nx,pz=z-d/2+j*d/nz,bottom=terrainHeight(px,pz)-.07,top=y-.010;if(top>bottom){builder.cyl(px,(top+bottom)/2,pz,.029,.040,top-bottom,EDGE,SURFACE.WOOD);builder.cyl(px,bottom+.060,pz,.047,.050,.095,'#3d4138',SURFACE.WOOD)}if(i<nx&&y-bottom>.22&&j%2===0){const other=x-w/2+(i+1)*w/nx;builder.beam([px,bottom+.085,pz],[other,y-.072,pz],.013,TIMBER,SURFACE.WOOD)}}
    if(rail)for(const side of [-1,1]){const rz=z+side*d/2;builder.box(x,y+.255,rz,w,.033,.038,TIMBER,SURFACE.WOOD);builder.box(x,y+.095,rz,w,.027,.028,TIMBER,SURFACE.WOOD);for(let u=-w/2;u<=w/2+.001;u+=.19){builder.box(x+u,y+.13,rz,.025,.30,.025,WOOD,SURFACE.WOOD);builder.box(x+u,y+.29,rz,.038,.015,.042,'#544b3a',SURFACE.WOOD)}}
  }
  function shoji(x,y,z,w,h){builder.add(new THREE.BoxGeometry(w,h,.009),'#e5d5ae',[x,y,z],[0,0,0],[1,1,1],SURFACE.PLASTER,0,true);for(let u=-w/2;u<=w/2+.001;u+=w/3)builder.box(x+u,y,z+.012,.009,h,.009,TIMBER,SURFACE.WOOD);for(let v=-h/2;v<=h/2+.001;v+=h/3)builder.box(x,y+v,z+.013,w,.008,.009,TIMBER,SURFACE.WOOD);for(const s of [-1,1])builder.box(x+s*w/2,y,z+.014,.022,h+.04,.026,WOOD,SURFACE.WOOD)}
  function bracket(x,y,z){builder.box(x,y,z,.10,.029,.080,TIMBER,SURFACE.WOOD);builder.box(x,y+.031,z,.145,.025,.105,WOOD,SURFACE.WOOD);builder.box(x,y+.056,z,.17,.018,.13,TIMBER,SURFACE.WOOD)}
  // Shared stone/timber helpers used by the temple and residence.
  const MINERAL='#b5ad97',LIME='#d0cbbd',CEDAR='#53483b',BRONZE='#80755d';
  const designChecks={openEntrances:[],foundations:[],floorJunctions:[],lanterns:[],spring:{course:'Natural mountain spring; minor garden diversion; independent concealed garden outfall',nodes:springNodes.length,interactive:true},temple:'Kiyomizu Sanju-no-to three-storey pagoda'};
  function stonePlatform(x,z,w,d,top){
    reserve(x,z,w/2+.02,d/2+.02,-1.2,top+.055,'stone terrace');
    builder.box(x,top-.045,z,w,.09,d,'#9b947e',SURFACE.STONE,topSnow);
    const nx=Math.ceil(w/.42),nz=Math.ceil(d/.40),dx=w/nx,dz=d/nz;
    for(let i=0;i<nx;i++)for(let j=0;j<nz;j++)builder.box(x-w/2+dx*(i+.5),top+.014,z-d/2+dz*(j+.5),dx-.008,.028,dz-.008,color(MINERAL).offsetHSL(0,0,rnd(-.025,.025)),SURFACE.STONE,topSnow);
    for(let i=0;i<3;i++)for(const side of [-1,1]){const px=x+(i-1)*(w-.13)/2,pz=z+side*(d/2-.055),low=terrainHeight(px,pz)-.11,upper=top-.05;if(low<upper)builder.box(px,(upper+low)/2,pz,.070,upper-low,.070,'#45473f',SURFACE.STONE)}
  }
  function cedarFloor(x,z,w,d,y,snow=0){const n=Math.ceil(w/.14),dx=w/n;for(let i=0;i<n;i++)builder.box(x-w/2+(i+.5)*dx,y,z,dx-.004,.034,d,color('#807058').offsetHSL(0,0,rnd(-.025,.022)),SURFACE.DECK,snow)}
  function recessedPanel(x,y,z,w,h,side=false){const rot=side?[0,Math.PI/2,0]:[0,0,0];builder.add(new THREE.BoxGeometry(w,h,.014),'#b7a78a',[x,y,z],rot,[1,1,1],SURFACE.PLASTER,0,true);
    for(const s of [-1,0,1])builder.add(new THREE.BoxGeometry(.019,h+.03,.025),CEDAR,[x+(side?0:s*w/2),y,z+(side?s*w/2:.021)],rot,[1,1,1],SURFACE.WOOD);
    for(const s of [-1,1])builder.add(new THREE.BoxGeometry(w+.03,.022,.025),CEDAR,[x,y+s*h/2,z+(side?0:.021)],rot,[1,1,1],SURFACE.WOOD);
  }
  // A single connected stepped courtyard residence, with an actual upper room.
  // Keep the facade quiet: the plinth is a single warm grey-beige stone datum,
  // while lighter wall mouldings stay reserved for openings and eaves.
  const RES={wall:'#ddd7c7',wallShade:'#c9bfa9',relief:'#cec2aa',walnut:'#493827',roof:'#494b47',fascia:'#2d332f',bronze:'#6a5b40',paving:'#b8b1a0',linen:'#cec6b4',stone:'#949488',plinth:'#b3a995'};
  // Local mineral finishes; existing woodwork, furniture and exterior palette stay intact.
  const INTERIOR_FINISH={wall:'#ddd9cf',ceiling:'#dedfdd',ceilingTrim:'#d2d4d2',lampPanel:'#e5e5e2'};
  const glazingParts=[],roofAudit=[],gardenPlants=[],aquaticPlants=[],residenceDetails=[],residenceCourts=[],interiorFixtures=[];
  let hearthSpec=null;
  const residenceRooms=[
    {name:'挑高拱窗海景主厅',x:.53,z:-.94,w:1.50,d:1.04,f:.380,h:1.08,roof:true,rise:.36,ridge:-.22,leftOH:0,rightOH:.035,roofForm:'irimoya',roofAxis:'x',role:'salon'},
    {name:'石灰拱廊入口与楼梯厅',x:-.79,z:-.97,w:1.14,d:.98,f:.380,h:.909,roof:false,role:'entry'},
    {name:'卧室与静谧柱廊',x:-1.66,z:-.12,w:.76,d:1.64,f:.340,h:.79,roof:true,rise:.25,ridge:.06,leftOH:.14,rightOH:.06,roofForm:'hip',roofAxis:'z',role:'bedroom'},
    {name:'靠山书斋与服务间',x:-1.66,z:-1.20,w:.76,d:.52,f:.380,h:.955,roof:false,role:'backStudy'},
    {name:'错层茶室与东庭',x:1.64,z:-.53,w:.70,d:1.75,f:.410,h:.85,roof:true,rise:.28,ridge:.10,leftOH:.115,rightOH:.14,backOH:.16,roofForm:'hip',roofAxis:'z',role:'tea'},
    {name:'二层楼梯厅与藏书墙',x:-1.13,z:-1.06,w:1.82,d:.80,f:1.335,h:.57,roof:true,rise:.28,ridge:-.08,leftOH:.12,rightOH:.10,foreOH:.105,roofForm:'gable',roofAxis:'x',upper:true,role:'library'},
    {name:'左翼二层书房',x:-1.66,z:-.01,w:.76,d:1.30,f:1.335,h:.57,roof:true,rise:.28,ridge:.06,leftOH:.12,rightOH:.055,foreOH:.09,backOH:.02,roofForm:'hip',roofAxis:'z',upper:true,role:'upperGallery'},
    {name:'右翼二层海景客厅',x:.53,z:-1.06,w:1.50,d:.80,f:1.565,h:.57,roof:true,rise:.28,upper:true,role:'upperRight'}
  ];
  const BUILDING_SCALE=.90,TORII_WIDTH_SCALE=.90,PAGODA_VOLUME_RATIO=2/3;
  const PAGODA_PLAN_REDUCTION=Math.sqrt(PAGODA_VOLUME_RATIO),PAGODA_PLAN_SCALE=.90*PAGODA_PLAN_REDUCTION;
  designChecks.buildingScale={linear:BUILDING_SCALE,volumeRatio:BUILDING_SCALE**3,groups:[]};
  function beginBuildingScale(name,pivot){return {name,pivot,part:builder.parts.length,glow:builder.glows.length,bound:architectureBounds.length,glass:glazingParts.length,foundation:designChecks.foundations.length,entrance:designChecks.openEntrances.length,floor:designChecks.floorJunctions.length,lantern:designChecks.lanterns.length,roof:roofAudit.length,fixture:interiorFixtures.length}}
  function finishBuildingScale(mark,axes=[BUILDING_SCALE,BUILDING_SCALE,BUILDING_SCALE]){
    const [sx,sy,sz]=axes,[cx,cy,cz]=mark.pivot,m=new THREE.Matrix4().makeScale(sx,sy,sz);m.setPosition(cx*(1-sx),cy*(1-sy),cz*(1-sz));
    const px=x=>cx+(x-cx)*sx,py=y=>cy+(y-cy)*sy,pz=z=>cz+(z-cz)*sz;
    const before=new THREE.Box3(),after=new THREE.Box3();
    for(const [parts,start] of [[builder.parts,mark.part],[builder.glows,mark.glow]])for(let i=start;i<parts.length;i++){const g=parts[i];g.computeBoundingBox();before.union(g.boundingBox);g.applyMatrix4(m);g.computeBoundingBox();after.union(g.boundingBox)}
    for(const b of architectureBounds.slice(mark.bound)){b.x=px(b.x);b.z=pz(b.z);b.hx*=sx;b.hz*=sz;b.low=py(b.low);b.high=py(b.high)}
    for(const g of glazingParts.slice(mark.glass)){g.x=px(g.x);g.y=py(g.y);g.z=pz(g.z);g.w*=g.side?sz:sx;g.h*=sy;if(g.archRise)g.archRise*=sy}
    for(const f of designChecks.foundations.slice(mark.foundation)){
      f.bottom=py(f.bottom);f.top=py(f.top);if(f.x!==undefined){f.x=px(f.x);f.z=pz(f.z);f.width*=sx;f.depth*=sz;let high=-Infinity;for(let i=0;i<=10;i++)for(let j=0;j<=10;j++)high=Math.max(high,terrainHeight(f.x-f.width/2+i*f.width/10,f.z-f.depth/2+j*f.depth/10));f.maxGround=high}
    }
    for(const e of designChecks.openEntrances.slice(mark.entrance)){e.x=px(e.x);e.z=pz(e.z);e.bottom=py(e.bottom);e.top=py(e.top);e.width*=sx;e.recess*=sz}
    for(const f of designChecks.floorJunctions.slice(mark.floor)){f.x=px(f.x);f.z=pz(f.z);f.top=py(f.top);f.slab*=sy}
    for(const l of designChecks.lanterns.slice(mark.lantern)){l.x=px(l.x);l.z=pz(l.z);l.bottom=py(l.bottom);l.base=py(l.base);l.footprintScale=l.scale*sx;l.scale*=sy;l.minGround=Infinity;l.maxGround=-Infinity;for(let i=0;i<16;i++){const a=i*TAU/16,y=terrainHeight(l.x+Math.cos(a)*.20*l.footprintScale,l.z+Math.sin(a)*.20*l.footprintScale);l.minGround=Math.min(l.minGround,y);l.maxGround=Math.max(l.maxGround,y)}}
    for(const r of roofAudit.slice(mark.roof)){for(const k of ['eave','peak','wallTop'])r[k]=py(r[k]);r.width*=sx;r.depth*=sz;r.fascia*=sy;r.overhang*=sx}
    for(const l of interiorFixtures.slice(mark.fixture)){for(const k of ['mount','centre','washCentre'])if(l[k])l[k]=[px(l[k][0]),py(l[k][1]),pz(l[k][2])];if(l.normal)l.normal=new THREE.Vector3(...l.normal).transformDirection(m).toArray();if(l.spread)l.spread*=sx;if(l.height)l.height*=sy;if(l.projection)l.projection*=sx;if(l.radius)l.radius*=sx}
    const record={name:mark.name,scale:BUILDING_SCALE,axes,volumeRatio:sx*sy*sz,pivot:mark.pivot,before:before.getSize(new THREE.Vector3()).toArray(),after:after.getSize(new THREE.Vector3()).toArray()};designChecks.buildingScale.groups.push(record);
    return {px,py,pz,m};
  }
  function plasterBox(x,y,z,w,h,d,shade=false){builder.box(x,y,z,w,h,d,RES.wall,SURFACE.PLASTER,topSnow)}
  function foundation(name,x,z,w,d,top){let low=Infinity,max=-Infinity;
    for(let i=0;i<=10;i++)for(let j=0;j<=10;j++){const y=terrainHeight(x-w/2+i*w/10,z-d/2+j*d/10);low=Math.min(low,y-.06);max=Math.max(max,y)}
    if(max>=top-.02)throw new Error('Residence ground penetrates '+name+' '+x+','+z+' ground '+max+' floor '+top);
    builder.box(x,(low+top-.014)/2,z,w,top-.014-low,d,name==='grounded terrace'?RES.wallShade:RES.wall,SURFACE.PLASTER);
    if(name==='grounded terrace')builder.box(x,top-.025,z,w+.008,.016,d+.008,RES.stone,SURFACE.PAVING);
    designChecks.foundations.push({name,x,z,width:w,depth:d,bottom:low,top:top-.014,maxGround:max,embedded:true});
    reserve(x,z,w/2,d/2,low,top+.012,name+' foundation');
  }
  function paving(x,z,w,d,top,wood=false){if(top>.8){builder.box(x,top-.022,z,w,.034,d,RES.wallShade,SURFACE.PLASTER);designChecks.floorJunctions.push({name:'upper balcony supported on entrance walls',x,z,top,slab:.034})}else foundation('grounded terrace',x,z,w,d,top);
    const nx=Math.ceil(w/(wood?.11:.34)),nz=Math.ceil(d/(wood?2:.34));
    for(let i=0;i<nx;i++)for(let j=0;j<nz;j++){const dx=w/nx,dz=d/nz;builder.box(x-w/2+(i+.5)*dx,top,z-d/2+(j+.5)*dz,dx-.003,.020,dz-.003,color(wood?RES.walnut:RES.paving).offsetHSL(0,0,rnd(-.014,.014)),wood?SURFACE.WOOD:SURFACE.PAVING,topSnow)}
    builder.box(x,top-.017,z+d/2,w,.034,.018,RES.wallShade,SURFACE.PAVING);
    reserve(x,z,w/2+.005,d/2+.005,top-.02,top+.018,'walking terrace');
  }
  function glassOpening(x,z,width,bottom,height,side=false,panels=3){
    const rot=side?[0,Math.PI/2,0]:[0,0,0],point=(u,y,dep)=>[x+(side?dep:u),y,z+(side?u:dep)];
    // Two-step reveals, a deep stone sill, and separate sliding tracks.
    for(const s of [-1,1])builder.add(new THREE.BoxGeometry(.043,height+.065,.085),RES.wallShade,point(s*(width/2+.027),bottom+height/2,-.012),rot,[1,1,1],SURFACE.PLASTER);
    builder.add(new THREE.BoxGeometry(width+.105,.028,.106),RES.stone,point(0,bottom-.026,.005),rot,[1,1,1],SURFACE.PAVING);
    for(const dep of [.021,.039])builder.add(new THREE.BoxGeometry(width,.008,.009),RES.fascia,point(0,bottom-.008,dep),rot,[1,1,1],SURFACE.METAL);
    // Glass is physically recessed behind the front of the 10 cm miniature wall.
    for(const s of [-1,1]){
      builder.add(new THREE.BoxGeometry(.025,height+.032,.070),RES.walnut,point(s*width/2,bottom+height/2,0),rot,[1,1,1],SURFACE.WOOD);
      builder.add(new THREE.BoxGeometry(width+.026,.024,.070),RES.bronze,point(0,bottom+(s+1)*height/2,.004),rot,[1,1,1],SURFACE.METAL);
    }
    for(let i=1;i<panels;i++)builder.add(new THREE.BoxGeometry(.016,height,.029),RES.bronze,point(-width/2+i*width/panels,bottom+height/2,.010),rot,[1,1,1],SURFACE.METAL);
    for(let i=0;i<panels;i++)glazingParts.push({x:x+(side?-.009:-width/2+(i+.5)*width/panels),y:bottom+height/2,z:z+(side?-width/2+(i+.5)*width/panels:-.009),w:width/panels-.021,h:height-.020,side});
    // Bronze pull has enough thickness to stay stable at the overview distance.
    builder.add(new THREE.BoxGeometry(.010,.08,.018),RES.bronze,point(width*.23,bottom+height*.40,.025),rot,[1,1,1],SURFACE.METAL);
    residenceDetails.push({kind:'recessed glazing, stepped reveals and double tracks',width,height,side});
  }
  function frontFacade(r,width,center=r.x){const front=r.z+r.d/2,bottom=r.f+.055,high=r.h-.13,edge=(r.w-width)/2;
    for(const s of [-1,1])if(edge>0)plasterBox(r.x+s*(width+edge)/2,r.f+r.h/2,front-.045,edge,r.h,.09);
    plasterBox(center,r.f+r.h-.033,front-.045,width,.066,.09);
    plasterBox(center,r.f+.017,front-.045,width,.034,.09);
    glassOpening(center,front-.047,width,bottom,high,false,r.w>1.2?4:2);
    builder.box(r.x,r.f+r.h-.045,front+.014,r.w,.045,.028,RES.walnut,SURFACE.WOOD);
    for(const s of [-1,1])if(edge>.045){
      builder.box(r.x+s*(r.w/2-edge/2),r.f+.13,front+.008,edge-.012,.050,.025,RES.stone,SURFACE.STONE);
      builder.box(r.x+s*(r.w/2-.028),r.f+r.h*.53,front+.013,.024,r.h-.16,.036,RES.wallShade,SURFACE.PLASTER);
    }
    designChecks.openEntrances.push({name:r.name,x:center+width*(r.w>1.2?.125:.25),z:front,width:width*(r.w>1.2?.22:.42),bottom,top:bottom+high,recess:.047});
  }
  // Exact planar partitions preserve buildable roof pitches and hard arrises.
  function roofBreakpoints(a,b,lines){
    const ts=[0,1];for(const [A,B,C] of lines){const da=A*a[0]+B*a[1]+C,db=A*b[0]+B*b[1]+C;if(da*db< -1e-12)ts.push(da/(da-db));}
    return [...new Set(ts.map(t=>Math.round(t*1e9)/1e9))].sort((a,b)=>a-b).map(t=>[mix(a[0],b[0],t),mix(a[1],b[1],t)]);
  }
  function planeDifferences(planes){const lines=[];for(let i=0;i<planes.length;i++)for(let j=i+1;j<planes.length;j++)lines.push(planes[i].map((v,k)=>v-planes[j][k]));return lines;}
  function planarRoofGeometry(plans,lines,height){
    let polygons=plans;for(const [A,B,C] of lines){if(Math.hypot(A,B)<1e-9)continue;const next=[];
      for(const poly of polygons){const ds=poly.map(p=>A*p[0]+B*p[1]+C);if(Math.min(...ds)>-1e-8||Math.max(...ds)<1e-8){next.push(poly);continue;}
        for(const sign of [-1,1]){const clipped=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],da=ds[i]*sign,db=ds[(i+1)%poly.length]*sign;if(da>=-1e-9)clipped.push(a);if((da<0&&db>0)||(da>0&&db<0)){const t=da/(da-db);clipped.push([mix(a[0],b[0],t),mix(a[1],b[1],t)]);}}
          if(clipped.length>=3&&polygonArea(clipped)>1e-10)next.push(clipped);
        }
      }polygons=next;
    }
    const p=[];for(const poly of polygons)for(let i=1;i<poly.length-1;i++){const tri=[poly[0],poly[i+1],poly[i]],cross=(tri[1][1]-tri[0][1])*(tri[2][0]-tri[0][0])-(tri[1][0]-tri[0][0])*(tri[2][1]-tri[0][1]);if(cross<0)[tri[1],tri[2]]=[tri[2],tri[1]];for(const [x,z] of tri)p.push(x,height(x,z),z);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.computeVertexNormals();return g;
  }
  function roofTrace(a,b,height,lines,r,c,type=SURFACE.ROOF,offset=.005){const pts=roofBreakpoints(a,b,lines);for(let i=1;i<pts.length;i++)builder.beam([pts[i-1][0],height(...pts[i-1])+offset,pts[i-1][1]],[pts[i][0],height(...pts[i])+offset,pts[i][1]],r,c,type);}
  function roofShell(top,plan,lines,height,thickness){
    builder.add(top,RES.roof,[0,0,0],[0,0,0],[1,1,1],SURFACE.ROOF,topSnow);
    const under=top.clone();for(const key of ['position','normal']){const a=under.attributes[key];for(let i=0;i<a.count;i+=3)for(let k=0;k<3;k++){const q=a.array[(i+1)*3+k];a.array[(i+1)*3+k]=a.array[(i+2)*3+k];a.array[(i+2)*3+k]=q;}}under.translate(0,-thickness,0);under.computeVertexNormals();builder.add(under,'#b9c5c8',[0,0,0],[0,0,0],[1,1,1],SURFACE.MINERAL_SOFFIT,0);
    const p=[];for(let q=0;q<plan.length;q++){const pts=roofBreakpoints(plan[q],plan[(q+1)%plan.length],lines);for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],ay=height(...a),by=height(...b);p.push(a[0],ay,a[1],b[0],by,b[1],b[0],by-thickness,b[1],a[0],ay,a[1],b[0],by-thickness,b[1],a[0],ay-thickness,a[1]);}}
    const edge=new THREE.BufferGeometry();edge.setAttribute('position',new THREE.Float32BufferAttribute(p,3));edge.computeVertexNormals();builder.add(edge,RES.fascia,[0,0,0],[0,0,0],[1,1,1],SURFACE.ROOF,0);
  }
  function residenceRoof(r){
    const axis=r.roofAxis,left=r.leftOH??.14,right=r.rightOH??.14,fore=r.foreOH??.18,back=r.backOH??.13;
    const x0=r.x-r.w/2-left,x1=r.x+r.w/2+right,z0=r.z-r.d/2-back,z1=r.z+r.d/2+fore,Y=r.f+r.h+.073,t=.050;
    const RX=(x0+x1)/2,RZ=(z0+z1)/2,W=x1-x0,D=z1-z0,ridge=r.ridge??0;
    const along=axis==='z'?D:W,ac=axis==='z'?RZ:RX,bc=axis==='z'?RX:RZ,breadth=axis==='z'?W:D;
    const ridgeB=bc+ridge*breadth/2,cut=.46,a0=ac-along/2,a1=ac+along/2,b0=bc-breadth/2,b1=bc+breadth/2;
    const local=[[1/(ridgeB-b0),-b0/(ridgeB-b0)],[-1/(b1-ridgeB),b1/(b1-ridgeB)]];
    const planes=axis==='z'?[[local[0][0],0,local[0][1]],[local[1][0],0,local[1][1]],[0,1/(along*(1-cut)/2),-a0/(along*(1-cut)/2)],[0,-1/(along*(1-cut)/2),a1/(along*(1-cut)/2)]]:[[0,local[0][0],local[0][1]],[0,local[1][0],local[1][1]],[1/(along*(1-cut)/2),0,-a0/(along*(1-cut)/2)],[-1/(along*(1-cut)/2),0,a1/(along*(1-cut)/2)]];
    const height=(x,z)=>Y+r.rise*Math.min(1,...planes.map(([a,b,c])=>a*x+b*z+c)),lines=planeDifferences([...planes,[0,0,1]]),plan=[[x0,z0],[x1,z0],[x1,z1],[x0,z1]];
    const top=planarRoofGeometry([plan],lines,height);roofShell(top,plan,lines,height,t);
    const ends=axis==='z'?[[ridgeB,ac-along*cut/2],[ridgeB,ac+along*cut/2]]:[[ac-along*cut/2,ridgeB],[ac+along*cut/2,ridgeB]];
    roofTrace(...ends,height,lines,.013,RES.fascia);
    for(let i=0;i<4;i++){const tip=plan[i],end=axis==='z'?(tip[1]<ac?ends[0]:ends[1]):(tip[0]<ac?ends[0]:ends[1]);roofTrace(end,tip,height,lines,.0085,RES.fascia);}
    for(let z=z0+.105;z<z1-.025;z+=.105)roofTrace([x0,z],[x1,z],height,lines,.0038,color(RES.roof).offsetHSL(0,0,.025),SURFACE.ROOF,.0015);
    // Thick mineral infills terminate beneath the soffit rather than over the fascia.
    const walls=[[r.x-r.w/2,r.z-r.d/2,r.x+r.w/2,r.z-r.d/2],[r.x+r.w/2,r.z-r.d/2,r.x+r.w/2,r.z+r.d/2],[r.x+r.w/2,r.z+r.d/2,r.x-r.w/2,r.z+r.d/2],[r.x-r.w/2,r.z+r.d/2,r.x-r.w/2,r.z-r.d/2]];
    for(const [ax,az,bx,bz] of walls){const dx=bx-ax,dz=bz-az,len=Math.hypot(dx,dz),shape=new THREE.Shape();shape.moveTo(0,r.f+r.h-.008);shape.lineTo(len,r.f+r.h-.008);for(const [x,z] of roofBreakpoints([ax,az],[bx,bz],lines).reverse())shape.lineTo(Math.hypot(x-ax,z-az),height(x,z)-t+.002);shape.closePath();builder.add(new THREE.ExtrudeGeometry(shape,{depth:.075,steps:1,bevelEnabled:false}),RES.wall,[ax,0,az],[0,-Math.atan2(dz,dx),0],[1,1,1],SURFACE.PLASTER,0);}
    roofTrace([x0,z1],[x1,z1],height,lines,.007,RES.fascia,SURFACE.METAL,-.021);
    for(let x=r.x-r.w/2+.045;x<r.x+r.w/2;x+=.105)builder.beam([x,height(x,r.z+r.d/2)-.071,r.z+r.d/2],[x,height(x,z1-.023)-.071,z1-.023],.011,RES.walnut,SURFACE.UNDERSIDE);
    r.frontGutter={x:r.x+r.w/2-.027,z:z1,y:height(r.x+r.w/2-.027,z1)-.021};
    reserve(RX,RZ,W/2+.018,D/2+.018,Y-t-.025,Y+r.rise+.025,'layered Japanese residence roof');
    roofAudit.push({name:r.name,form:'planar hip',axis,eave:Y,peak:Y+r.rise,width:W,depth:D,wallTop:r.f+r.h,fascia:t,overhang:fore,upturn:0});
    residenceDetails.push({kind:'Japanese roof',room:r.name,form:'planar hip',straightEaves:true,closedSoffit:true,upturn:0});
  }
  // Only the two load-bearing balcony posts remain; applied fluted columns are gone.
  function column(x,z,bottom,height){
    builder.box(x,bottom+.018,z,.080,.036,.086,RES.stone,SURFACE.STONE,topSnow);
    builder.box(x,bottom+(height+.016)/2,z,.052,height-.048,.058,RES.walnut,SURFACE.WOOD,0);
    builder.box(x,bottom+height-.017,z,.086,.034,.092,RES.walnut,SURFACE.WOOD,0);
    reserve(x,z,.043,.046,bottom,bottom+height,'structural balcony timber post');
    residenceDetails.push({kind:'structural post',x,z,bottom,height});
  }
  // A closed annular solid owns every moulding, including concave corners.
  // Its inner edge is embedded in the wall, so no exposed strip ends remain.
  const perimeterBands=[];
  function offsetOrthogonalPlan(plan,d){
    return plan.map((p,i)=>{const a=plan[(i+plan.length-1)%plan.length],b=plan[(i+1)%plan.length],dx=p[0]-a[0],dz=p[1]-a[1],ex=b[0]-p[0],ez=b[1]-p[1],l=Math.hypot(dx,dz),m=Math.hypot(ex,ez);return [p[0]+d*(dz/l+ez/m),p[1]-d*(dx/l+ex/m)];});
  }
  function closedBand(name,plan,height,profiles,breaks=[]){
    for(const [dy,h,projection,c,type=SURFACE.PLASTER] of profiles){
      // Each edge owns a narrow mitred strip. Split its caps at every height
      // change: triangulating a warped annulus can bridge across window heads.
      const outer=offsetOrthogonalPlan(plan,projection),inner=offsetOrthogonalPlan(plan,-.006),lines=breaks.map(x=>[1,0,-x]);
      const level=(x,z)=>(typeof height==='function'?height(x,z):height)+dy;
      const strips=outer.map((a,i)=>[a,outer[(i+1)%outer.length],inner[(i+1)%inner.length],inner[i]]);
      const cap=planarRoofGeometry(strips,lines,(x,z)=>level(x,z)+h/2),p=cap.attributes.position,array=[];
      for(let i=0;i<p.count;i+=3){
        for(const j of [i,i+1,i+2])array.push(p.getX(j),p.getY(j),p.getZ(j));
        for(const j of [i,i+2,i+1])array.push(p.getX(j),p.getY(j)-h,p.getZ(j));
      }
      for(const loop of [outer,inner.slice().reverse()])for(let i=0;i<loop.length;i++){
        const pts=roofBreakpoints(loop[i],loop[(i+1)%loop.length],lines);
        for(let j=1;j<pts.length;j++){const a=pts[j-1],b=pts[j],ay=level(...a)+h/2,by=level(...b)+h/2;
          array.push(a[0],ay,a[1],b[0],by,b[1],b[0],by-h,b[1],a[0],ay,a[1],b[0],by-h,b[1],a[0],ay-h,a[1]);
        }
      }
      cap.dispose();const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(array,3));g.computeVertexNormals();
      builder.add(g,c,[0,0,0],[0,0,0],[1,1,1],type,0);
      perimeterBands.push({name,plan,dy,h,projection,heights:plan.map(([x,z])=>typeof height==='function'?height(x,z):height),closed:true,edgeStrips:true,heightBreaks:breaks});
    }
  }
  const upperBodyPlan=[[-2.04,-1.46],[1.28,-1.46],[1.28,-.66],[-1.28,-.66],[-1.28,.64],[-2.04,.64]];
  function cornice(){/* Closed envelopes are emitted once after the rooms. */}
  function completeResidenceBands(){
    // The eave remains a restrained, closed detail.  The former storey belt
    // was removed: it traced an interior level change across an unbroken wall.
    closedBand('二层连续檐下线',upperBodyPlan,x=>1.905+.230*clamp((x+.78)/.56,0,1),[[-.045,.020,.032,RES.wallShade],[-.012,.024,.046,RES.wall]],[-.78,-.22]);
    const basePlan=[[-2.04,-1.46],[1.28,-1.46],[1.28,-1.405],[1.99,-1.405],[1.99,.345],[1.29,.345],[1.29,-.42],[-.22,-.42],[-.22,-.48],[-1.28,-.48],[-1.28,.70],[-2.04,.70]];
    // One complete low plinth carries the whole footprint.  It is stone, with
    // a small reveal, and has no second white edge or mid-run step.
    closedBand('住宅完整低矮台基',basePlan,.277,[[0,.060,.018,RES.plinth,SURFACE.STONE]]);
    for(const r of residenceRooms.filter(r=>r.role==='tea')){const p=[[r.x-r.w/2,r.z-r.d/2],[r.x+r.w/2,r.z-r.d/2],[r.x+r.w/2,r.z+r.d/2],[r.x-r.w/2,r.z+r.d/2]];
      closedBand(r.name+'完整檐下线',p,r.f+r.h,[[-.037,.021,.037,RES.wall],[-.010,.025,.052,RES.wall]]);
    }
    residenceDetails.push({kind:'quiet rear facade',removed:['north continuous storey belt','connected side belt','stacked white base edge'],localizedDetails:['deep arched window reveals','individual stone sills','restrained eaves','capital and foot relief on structural columns'],plinth:{material:'warm grey-beige stone',height:.060,projection:.018,continuous:true}});
    residenceDetails.push({kind:'closed perimeter mouldings',bands:perimeterBands,freeEnds:0,mitredCorners:true,continuousWaistline:false});
  }
  function archFacade(r,{side=false,out=1,count=3,opening=.39,height=.94}={}){
    const length=side?r.d:r.w,center=side?r.z:r.x,face=side?r.x+out*r.w/2:r.z+r.d/2;
    const pitch=length/count,rad=opening/2,bottom=r.f+(r.role==='reading'?.023:.045),springY=bottom+height-rad,wallTop=r.f+r.h;
    const rotation=side?[0,out*Math.PI/2,0]:[0,0,0];
    const place=(u,y,dep)=>side?[face+out*dep,y,center+u]:[center+u,y,face+dep];
    // Every bay has a true open arch cut out of a thick wall, not a painted outline.
    for(let i=0;i<count;i++){
      const u=-length/2+(i+.5)*pitch;
      const cap=new THREE.Shape();cap.moveTo(-rad,springY);cap.lineTo(-rad,wallTop);cap.lineTo(rad,wallTop);cap.lineTo(rad,springY);
      for(let j=1;j<=28;j++){const a=j*Math.PI/28;cap.lineTo(rad*Math.cos(a),springY+rad*Math.sin(a))}cap.closePath();
      builder.add(new THREE.ExtrudeGeometry(cap,{depth:.11,steps:1,bevelEnabled:false}),RES.wall,place(u,0,-.11),rotation,[1,1,1],SURFACE.PLASTER);
      const ring=new THREE.Shape();ring.moveTo(-rad,bottom);ring.lineTo(-rad,springY);
      for(let j=0;j<=28;j++){const a=Math.PI-j*Math.PI/28;ring.lineTo(rad*Math.cos(a),springY+rad*Math.sin(a))}
      ring.lineTo(rad,bottom);ring.lineTo(rad+.030,bottom);ring.lineTo(rad+.030,springY);
      for(let j=0;j<=28;j++){const a=j*Math.PI/28;ring.lineTo((rad+.030)*Math.cos(a),springY+(rad+.030)*Math.sin(a))}
      ring.lineTo(-rad-.030,bottom);ring.closePath();
      builder.add(new THREE.ExtrudeGeometry(ring,{depth:.035,steps:1,bevelEnabled:false}),RES.wallShade,place(u,0,0),rotation,[1,1,1],SURFACE.PLASTER,0);
      const frame=new THREE.Shape();frame.moveTo(-rad+.013,bottom+.012);frame.lineTo(-rad+.013,springY);
      for(let j=0;j<=28;j++){const a=Math.PI-j*Math.PI/28;frame.lineTo((rad-.013)*Math.cos(a),springY+(rad-.013)*Math.sin(a))}
      frame.lineTo(rad-.013,bottom+.012);frame.lineTo(rad-.023,bottom+.012);frame.lineTo(rad-.023,springY);
      for(let j=0;j<=28;j++){const a=j*Math.PI/28;frame.lineTo((rad-.023)*Math.cos(a),springY+(rad-.023)*Math.sin(a))}
      frame.lineTo(-rad+.023,bottom+.012);frame.closePath();
      builder.add(new THREE.ExtrudeGeometry(frame,{depth:.023,steps:1,bevelEnabled:false}),RES.bronze,place(u,0,-.082),rotation,[1,1,1],SURFACE.METAL,0);
      const glass=place(u,bottom+height/2,-.089);
      glazingParts.push({x:glass[0],y:glass[1],z:glass[2],w:opening-.040,h:height-.025,side});
      // Rectangular glass is behind the opaque spandrel; its clipped corners stay hidden.
      const straight=springY-bottom;
      builder.add(new THREE.BoxGeometry(.012,height-rad+.008,.028),RES.bronze,place(u,bottom+straight/2,-.063),rotation,[1,1,1],SURFACE.METAL,0);
      builder.add(new THREE.BoxGeometry(opening-.038,.014,.030),RES.bronze,place(u,springY,-.064),rotation,[1,1,1],SURFACE.METAL,0);
      const sillThickness=r.role==='reading'?.016:.028,sillTop=r.role==='reading'?r.f+.024:bottom-.008,sillBottom=sillTop-sillThickness;
      builder.add(new THREE.BoxGeometry(opening+.030,sillThickness,.128),RES.paving,place(u,(sillTop+sillBottom)/2,-.012),rotation,[1,1,1],SURFACE.PAVING,topSnow);
      builder.add(new THREE.BoxGeometry(opening,Math.max(.006,sillBottom-r.f+.018),.110),RES.wall,place(u,(sillBottom+r.f-.018)/2,-.055),rotation,[1,1,1],SURFACE.PLASTER,0);
      for(const s of [-1,1])builder.add(new THREE.BoxGeometry(.009,.060,.018),RES.bronze,place(u+s*.034,bottom+straight*.45,-.044),rotation,[1,1,1],SURFACE.METAL,0);
      if(!side&&i===Math.floor(count/2))designChecks.openEntrances.push({name:r.name,x:center+u+opening*.20,z:face,width:opening*.42,bottom:bottom+.01,top:springY-.015,recess:.089});
    }
    for(let i=0;i<=count;i++){
      const u=-length/2+i*pitch,edge=i===0||i===count,span=edge?(pitch-opening)/2:pitch-opening;
      const shift=edge?(i===0?span/2:-span/2):0;
      builder.add(new THREE.BoxGeometry(span,r.h,.11),RES.wall,place(u+shift,r.f+r.h/2,-.055),rotation,[1,1,1],SURFACE.PLASTER);
      // Narrow raised fillets model a restrained bas-relief on existing piers.
      // Fillets end below the springing line and sit proud by just 8 mm in scene scale.
      if(span>.058){const heightRelief=Math.max(.22,springY-r.f-.12),shaftBottom=r.f+.085,cols=span>.13?3:2;
        for(let k=0;k<cols;k++){const du=(k-(cols-1)/2)*Math.min(.027,span/(cols+1));
          builder.add(new THREE.BoxGeometry(.012,heightRelief,.010),RES.wall,place(u+shift+du,shaftBottom+heightRelief/2,.009),rotation,[1,1,1],SURFACE.PLASTER,0);
        }
        builder.add(new THREE.BoxGeometry(span+.007,.022,.021),RES.wallShade,place(u+shift,r.f+.056,.006),rotation,[1,1,1],SURFACE.PLASTER,0);
        builder.add(new THREE.BoxGeometry(span+.006,.018,.021),RES.wall,place(u+shift,springY-.019,.006),rotation,[1,1,1],SURFACE.PLASTER,0);
      }
      residenceDetails.push({kind:'restrained pier relief',room:r.name,depth:.010,integrated:true});
    }
    cornice(r,side,out);
    residenceDetails.push({kind:'true limestone arcade',room:r.name,arches:count,opening,height,wallDepth:.11});
  }

  // One L-shaped roof envelope, with a continuous valley where the two ridges meet.
  // Both suites share its eave datum; there are no overlapping independent roof sheets.
  function joinedUpperRoof(){
    const y=1.978,t=.050,left=-2.16,right=1.40,back=-1.59,elbowZ=-.54,elbowX=-1.185,front=.73;
    const ridgeX=-1.68,ridgeZ=-1.10,rise=.28;
    const cross=(q,c,a,b)=>clamp(q<c?(q-a)/(c-a):(b-q)/(b-c),0,1);
    const roofLift=x=>.230*clamp((x+.78)/.56,0,1);
    const crossZ=z=>cross(z,ridgeZ,back,elbowZ),crossX=x=>cross(x,ridgeX,left,elbowX);
    const eastHip=x=>clamp((right-x)/.34,0,1),westHip=x=>clamp((x-left)/(ridgeX-left),0,1),backHip=z=>clamp((z-back)/(ridgeZ-back),0,1);
    const height=(x,z)=>y+roofLift(x)+rise*Math.max(Math.min(crossZ(z),eastHip(x),westHip(x)),Math.min(crossX(x),clamp((front-z)/.46,0,1),backHip(z)));
    const plan=[[left,back],[right,back],[right,elbowZ],[elbowX,elbowZ],[elbowX,front],[left,front]];
    const planes=[[0,1/(ridgeZ-back),-back/(ridgeZ-back)],[0,-1/(elbowZ-ridgeZ),elbowZ/(elbowZ-ridgeZ)],[-1/.34,0,right/.34],[1/(ridgeX-left),0,-left/(ridgeX-left)],[-1/(elbowX-ridgeX),0,elbowX/(elbowX-ridgeX)],[0,-1/.46,front/.46],[0,0,0],[0,0,1]];
    const lines=[...planeDifferences(planes),[1,0,.78],[1,0,.22]];
    const top=planarRoofGeometry([[[left,back],[right,back],[right,elbowZ],[left,elbowZ]],[[left,elbowZ],[elbowX,elbowZ],[elbowX,front],[left,front]]],lines,height);
    roofShell(top,plan,lines,height,t);
    for(let q=0;q<plan.length;q++)roofTrace(plan[q],plan[(q+1)%plan.length],height,lines,.0065,RES.fascia,SURFACE.METAL,-.019);
    // Fill only the six EXTERNAL wall edges of the L; no hidden shared-edge gables.
    const walls=[[-2.04,-1.46,-.22,-1.46],[-.22,-1.46,1.28,-1.46],[1.28,-1.46,1.28,-.66],[1.28,-.66,-.22,-.66],[-.22,-.66,-1.28,-.66],[-1.28,-.66,-1.28,.64],[-1.28,.64,-2.04,.64],[-2.04,.64,-2.04,-1.46]];
    for(const [ax,az,bx,bz]of walls){const dx=bx-ax,dz=bz-az,len=Math.hypot(dx,dz),shape=new THREE.Shape(),bottom=(ax+bx)/2>=-.22?2.125:1.895;shape.moveTo(0,bottom);shape.lineTo(len,bottom);
      for(const [x,z] of roofBreakpoints([ax,az],[bx,bz],lines).reverse())shape.lineTo(Math.hypot(x-ax,z-az),height(x,z)-t+.004);shape.closePath();
      builder.add(new THREE.ExtrudeGeometry(shape,{depth:.085,steps:1,bevelEnabled:false}),RES.wall,[ax,0,az],[0,-Math.atan2(dz,dx),0],[1,1,1],SURFACE.PLASTER,0);
    }
    const ridges=[[[ridgeX,ridgeZ],[right-.34,ridgeZ]],[[ridgeX,ridgeZ],[left,back]],[[right-.34,ridgeZ],[right,back]],[[right-.34,ridgeZ],[right,elbowZ]],[[ridgeX,ridgeZ],[ridgeX,front-.46]],[[ridgeX,front-.46],[left,front]],[[ridgeX,front-.46],[elbowX,front]]];
    for(const [a,b] of ridges)roofTrace(a,b,height,lines,.010,RES.fascia);
    roofTrace([elbowX,elbowZ],[ridgeX,ridgeZ],height,lines,.006,RES.bronze,SURFACE.METAL,.002);
    for(const x of [-.78,-.22])roofTrace([x,back],[x,elbowZ],height,lines,.0045,RES.bronze,SURFACE.METAL,.002);
    for(let z=back+.12;z<front;z+=.12)roofTrace([left,z],[z<=elbowZ?right:elbowX,z],height,lines,.0038,color(RES.roof).offsetHSL(0,0,.025),SURFACE.ROOF,.0015);
    // Continuous walnut eave soffit has visible rafter tails on the courtyard edges.
    for(const [ax,az,bx,bz]of [walls[3],walls[4],walls[5],walls[6]]){const len=Math.hypot(bx-ax,bz-az),n=Math.ceil(len/.105);for(let i=0;i<n;i++){
      const u=(i+.5)/n,x=mix(ax,bx,u),z=mix(az,bz,u),outX=(bz-az)/len,outZ=-(bx-ax)/len;
      builder.beam([x,height(x,z)-.073,z],[x+outX*.075,height(x+outX*.075,z+outZ*.075)-.073,z+outZ*.075],.014,RES.walnut,SURFACE.UNDERSIDE);
    }}
    reserve((left+right)/2,(back+elbowZ)/2,(right-left)/2+.02,(elbowZ-back)/2+.02,y-t-.04,y+rise+.30,'joined upper library roof');
    reserve((left+elbowX)/2,(elbowZ+front)/2,(elbowX-left)/2+.02,(front-elbowZ)/2+.02,y-t-.04,y+rise+.07,'joined upper wing roof');
    for(const r of residenceRooms.filter(r=>r.upper))roofAudit.push({name:r.name,form:'joined L-shaped roof',eave:y+roofLift(r.x),peak:y+roofLift(r.x)+rise,wallTop:r.f+r.h,width:r.w+.20,depth:r.d+.20,fascia:t,overhang:.10});
    residenceDetails.push({kind:'unified upper roof',plan:'L with raised east wing',ridges:2,continuousValley:true,continuousEastTransition:true,eastTransition:'straight pitched connector with two folded bronze flashings',curvedTransition:false,eastRise:.230,eastEnd:'hipped with closed return fascia',westSlope:'single continuous plane with a shared hip pitch',extraWestFacet:false,sharedEdgeEaves:0,wallPalette:RES.wall});
  }
  function timberScreen(name,x,z,w,h,bottom,side=false){
    const n=Math.ceil(w/.055),rot=side?[0,Math.PI/2,0]:[0,0,0],point=(u,y,dep)=>[x+(side?dep:u),y,z+(side?u:dep)];
    for(let i=0;i<n;i++)builder.add(new THREE.BoxGeometry(.023,h,.041),color(RES.walnut).offsetHSL(0,0,(i%3-1)*.014),point(-w/2+(i+.5)*w/n,bottom+h/2,0),rot,[1,1,1],SURFACE.WOOD);
    for(const y of [bottom+.012,bottom+h-.012])builder.add(new THREE.BoxGeometry(w,.023,.047),RES.walnut,point(0,y,-.006),rot,[1,1,1],SURFACE.WOOD);
    reserve(x,z,side?.029:w/2,side?w/2:.029,bottom,bottom+h,name);
    residenceDetails.push({kind:'walnut privacy screen',name,slats:n});
  }
  function softBlock(x,y,z,w,h,d,c=RES.linen){
    const shape=new THREE.Shape();shape.moveTo(0,0);shape.lineTo(w,0);shape.lineTo(w,h);shape.lineTo(0,h);shape.closePath();
    const g=new THREE.ExtrudeGeometry(shape,{depth:Math.max(.006,d-.012),steps:1,bevelEnabled:true,bevelSegments:2,bevelSize:.006,bevelThickness:.006});g.translate(-w/2,-h/2,-d/2+.006);
    builder.add(g,c,[x,y,z],[0,0,0],[1,1,1],SURFACE.PLASTER,0);
  }

  function vintageBench(x,z,f,w,d,angle=0){
    const rot=[0,angle,0],point=(u,y,v)=>[x+Math.cos(angle)*u+Math.sin(angle)*v,y,z-Math.sin(angle)*u+Math.cos(angle)*v];
    const box=(u,y,v,b,h,a,c=RES.walnut,type=SURFACE.WOOD)=>builder.add(new THREE.BoxGeometry(b,h,a),c,point(u,y,v),rot,[1,1,1],type,0);
    const seat=f+.090,back=z-d/2;
    for(const u of [-w/2+.025,w/2-.025])for(const v of [-d/2+.018,d/2-.018])box(u,f+.047,v,.019,.094,.019);
    for(const v of [-d/2+.014,d/2-.014])box(0,seat-.024,v,w-.015,.025,.018);
    for(let i=0;i<5;i++)box(0,seat,-d/2+.014+(d-.028)*i/4,w,.014,(d-.028)/5*.76);
    for(const u of [-w/2+.019,w/2-.019]){box(u,seat+.046,-d/2+.012,.020,.135,.021);box(u,seat+.045,0,.021,.016,d+.012)}
    for(let i=0;i<7;i++)box(-w/2+.035+(w-.07)*i/6,seat+.057,-d/2+.012,.012,.085,.016);
    box(0,seat+.106,-d/2+.009,w+.011,.020,.027);
    // A slender woven cushion leaves timber edges and mortise joints legible.
    box(0,seat+.010,.010,w-.047,.009,d-.047,'#b6aa8e',SURFACE.PLASTER);
    // Embed the bronze caps in the front stretcher so they remain attached after rotation.
    for(const u of [-w/2+.025,w/2-.025])box(u,seat-.025,d/2-.005,.006,.009,.004,RES.bronze,SURFACE.METAL);
    residenceDetails.push({kind:'Japanese vintage walnut bench',x,z,width:w,depth:d,thinWovenSeat:true,slattedBack:true,angle});
  }
  function anchoredRailPost(name,x,z,foot,top,angle=0,plateRun=.024,plateWidth=.024){
    // A small plate and collar bear on the tread, with the spindle embedded
    // below the finished surface and positively joined into the timber rail.
    builder.add(new THREE.BoxGeometry(plateRun,.006,plateWidth),RES.bronze,[x,foot-.001,z],[0,angle,0],[1,1,1],SURFACE.METAL,0);
    builder.cyl(x,foot+.008,z,.0065,.0065,.014,RES.bronze,SURFACE.METAL,0,12);
    builder.beam([x,foot-.006,z],[x,top+.002,z],.0045,RES.bronze,SURFACE.METAL);
    const post={kind:'anchored railing post',name,x,z,foot,top,plate:plateRun,plateWidth,angle,embedded:.006};residenceDetails.push(post);return post;
  }
  // A diagonal first flight turns once into the rear service bay. The top
  // arrives at a full-width west foyer, leaving the front upper gallery open.
  // The entrance arch and first tread share an axis. A tangent quarter-circle
  // turns toward the rear flight; all tread edges use the same analytic curve.
  const houseStair={width:.270,lower:.395,upper:1.350,steps:20,firstSteps:10,wellLeft:-1.720,wellRight:-.370,wellBack:-1.350,wellFront:-.975,platformLeft:-1.050,platformRight:-.870};
  houseStair.mid=houseStair.lower+(houseStair.upper-houseStair.lower)*houseStair.firstSteps/houseStair.steps;
  houseStair.curveSpec={startX:-.505,startZ:-.635,lead:.135,radius:.355,centerX:-.860,centerZ:-.770,tail:.055};
  const cs=houseStair.curveSpec;
  cs.arc=cs.radius*Math.PI/2;cs.run=cs.lead+cs.arc+cs.tail;
  function stairLowerAt(s){
    s=clamp(s,0,cs.run);let x,z,tx,tz;
    if(s<=cs.lead){x=cs.startX;z=cs.startZ-s;tx=0;tz=-1;}
    else if(s<=cs.lead+cs.arc){const a=(s-cs.lead)/cs.radius;x=cs.centerX+cs.radius*Math.cos(a);z=cs.centerZ-cs.radius*Math.sin(a);tx=-Math.sin(a);tz=-Math.cos(a);}
    else{x=cs.centerX-(s-cs.lead-cs.arc);z=cs.centerZ-cs.radius;tx=-1;tz=0;}
    return {x,z,tx,tz,nx:-tz,nz:tx,station:s};
  }
  // The straight flight begins exactly at the analytic curve endpoint.  The
  // former offset start (-1.050,-1.200) introduced a diagonal kink between
  // the last curved tread, the landing and both handrails.
  const turnEnd=stairLowerAt(cs.run);
  houseStair.flights=[{startX:cs.startX,startZ:cs.startZ,endX:turnEnd.x,endZ:turnEnd.z,base:houseStair.lower,top:houseStair.mid,steps:10,run:cs.run,curved:true},{startX:turnEnd.x,startZ:turnEnd.z,endX:-1.720,endZ:turnEnd.z,base:houseStair.mid,top:houseStair.upper,steps:10}];
  for(const f of houseStair.flights){if(!f.run)f.run=Math.hypot(f.endX-f.startX,f.endZ-f.startZ);f.ux=(f.endX-f.startX)/Math.hypot(f.endX-f.startX,f.endZ-f.startZ);f.uz=(f.endZ-f.startZ)/Math.hypot(f.endX-f.startX,f.endZ-f.startZ);f.nx=-f.uz;f.nz=f.ux;f.angle=-Math.atan2(f.uz,f.ux);}
  // The stairwell cut follows the actual stair envelope instead of the former
  // oversized rectangular well.  It is a narrow ribbon around the connected
  // lower curve, landing and upper flight, leaving the rest of the second-floor
  // slab continuous.
  const stairOpeningMargin=.015;
  const upper=houseStair.flights[1],openingHalf=houseStair.width/2+stairOpeningMargin;
  // The west partition clears the full tread width, including its front edge.
  houseStair.partitionOpening={back:-1.350,front:upper.startZ+houseStair.width/2+.015,clearance:.015};
  // Trim unused side and arrival allowances while preserving the upper flight
  // and the headroom above the final curved treads. A full infill to the
  // requested penultimate post would leave only .26325 clearance beneath the slab.
  const openingLeft=upper.endX-.015,openingRight=upper.startX+houseStair.width/2+.045;
  const openingBack=upper.startZ-openingHalf,openingFront=upper.startZ+openingHalf;
  houseStair.opening=[[openingLeft,openingBack],[openingRight,openingBack],[openingRight,openingFront],[openingLeft,openingFront]];
  houseStair.openingRefinement={originalArea:.4194,area:(openingRight-openingLeft)*(openingFront-openingBack),requestedPostX:-1.1075446638197042,fullInfillAtRequestedPost:false,reason:'preserve main-stair headroom',clearanceMinimum:.46};
  function stairHalfWidth(f,s){
    if(!f.curved)return houseStair.width/2;
    const turn=clamp((s-cs.lead)/cs.arc,0,1),softTurn=Math.sin(Math.PI*turn);
    // Heteromorphic timber treads narrow gently through the bend, then return
    // to the straight-flight width instead of forcing rectangular blocks around
    // a curved centerline.
    return houseStair.width/2*(1-.16*softTurn);
  }
  function stairPlanSample(f,s,offset=0){const p=f.curved?stairLowerAt(s):{x:f.startX+f.ux*s,z:f.startZ+f.uz*s,tx:f.ux,tz:f.uz,nx:f.nx,nz:f.nz};const baseHalf=houseStair.width/2,localHalf=stairHalfWidth(f,s),ratio=Math.min(1,Math.abs(offset)/baseHalf),localOffset=Math.sign(offset)*localHalf*ratio;return {...p,x:p.x+p.nx*localOffset,z:p.z+p.nz*localOffset};}
  function stairSurfaceAt(x,z){
    const upper=houseStair.flights[1],u=(x-upper.startX)*upper.ux+(z-upper.startZ)*upper.uz,v=(x-upper.startX)*upper.nx+(z-upper.startZ)*upper.nz;
    if(u>=-.0001&&u<=upper.run+.0001&&Math.abs(v)<=houseStair.width/2+.0001)return {foot:upper.base+(clamp(Math.floor(u/(upper.run/upper.steps)),0,upper.steps-1)+1)*(upper.top-upper.base)/upper.steps,angle:upper.angle,flight:1};
    let s,side,angle;
    if(z>=cs.centerZ&&Math.abs(x-cs.startX)<=houseStair.width/2+.0001){s=cs.startZ-z;side=x-cs.startX;angle=Math.PI/2;}
    else if(x>=cs.centerX){const dx=x-cs.centerX,dz=cs.centerZ-z,a=Math.atan2(dz,dx);s=cs.lead+clamp(a,0,Math.PI/2)*cs.radius;side=Math.hypot(dx,dz)-cs.radius;angle=Math.PI/2+a;}
    else{s=cs.lead+cs.arc+cs.centerX-x;side=-(z-(cs.centerZ-cs.radius));angle=Math.PI;}
    if(s<-.0001||s>cs.run+.0001)return null;
    const f=houseStair.flights[0],localHalf=stairHalfWidth(f,s);
    if(Math.abs(side)>localHalf+.0001)return null;
    const k=clamp(Math.floor(s/(f.run/f.steps)),0,f.steps-1);return {foot:f.base+(k+1)*(f.top-f.base)/f.steps,angle,flight:0,station:s};
  }
  function stairFlightSolid(f){
    const p=[],idx=[],half=houseStair.width/2,rise=(f.top-f.base)/f.steps;
    const tri=(a,b,c)=>idx.push(a,b,c),quad=(a,b,c,d)=>{tri(a,b,c);tri(a,c,d)};
    for(let k=0;k<f.steps;k++){
      const count=f.curved?10:1,first=p.length/3,top=f.base+(k+1)*rise;
      for(let j=0;j<=count;j++){
        const s=f.run*(k+j/count)/f.steps,under=f.base+(f.top-f.base)*s/f.run-.055;
        const a=stairPlanSample(f,s,half),b=stairPlanSample(f,s,-half);
        p.push(a.x,top,a.z,b.x,top,b.z,a.x,under,a.z,b.x,under,b.z);
        if(j){const a=first+(j-1)*4,b=a+4;quad(a,a+1,b+1,b);quad(a+2,b+2,b+3,a+3);quad(a,b,b+2,a+2);quad(a+1,a+3,b+3,b+1);}
      }
      // Only exposed risers are drawn. No duplicate full-depth shared end faces.
      const a=first,b=first+count*4,prev=f.base+k*rise;
      const left=stairPlanSample(f,f.run*k/f.steps,half),right=stairPlanSample(f,f.run*k/f.steps,-half);
      const low=k===0?f.base-.055:prev,c=p.length/3;p.push(left.x,low,left.z,right.x,low,right.z);quad(a,c,c+1,a+1);
      if(k===f.steps-1)quad(b,b+1,b+3,b+2);
    }
    for(let i=0;i<idx.length;i+=3)[idx[i+1],idx[i+2]]=[idx[i+2],idx[i+1]];
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex(idx);g.computeVertexNormals();
    builder.add(g,RES.walnut,[0,0,0],[0,0,0],[1,1,1],SURFACE.WOOD,0);
  }
  class CurvedStairRail extends THREE.Curve{
    constructor(f,side){super();this.f=f;this.side=side;this.arcLengthDivisions=360;}
    getPoint(t,target=new THREE.Vector3()){const f=this.f,p=stairPlanSample(f,f.run*t,(houseStair.width/2-.024)*this.side);return target.set(p.x,mix(f.base,f.top,t)+.170,p.z);}
  }
  function stairRails(){
    for(const side of [1,-1]){
      const path=new THREE.CurvePath(),lower=new CurvedStairRail(houseStair.flights[0],side),upper=new CurvedStairRail(houseStair.flights[1],side),a=lower.getPoint(1),b=upper.getPoint(0);
      path.add(lower);
      // Once both flights share the same analytic endpoint, a separate cubic
      // bridge becomes a zero-length loop and produces the visible kink in the
      // handrail.  Join the two tangent curves directly at that point.
      if(a.distanceTo(b)>.0001)path.add(new THREE.CubicBezierCurve3(a,new THREE.Vector3(a.x-.047,a.y,a.z),new THREE.Vector3(b.x+.047,b.y,b.z),b));
      path.add(upper);
      const length=path.getLength(),plateRun=.012,plateWidth=.018;
      function postAt(station){const p=path.getPoint(station/length),h=stairSurfaceAt(p.x,p.z);if(!h)return null;
        const c=Math.cos(h.angle),s=Math.sin(h.angle);let margin=0;
        for(const u of [-plateRun/2,plateRun/2])for(const v of [-plateWidth/2,plateWidth/2]){const q=stairSurfaceAt(p.x+u*c+v*s,p.z-u*s+v*c);if(!q||Math.abs(q.foot-h.foot)>.00001)return null;}
        if(p.y-h.foot<.118)return null;return {p,h};
      }
      let best=null;
      for(const count of [10,11,12])for(let start=.018;start<=.095;start+=.003)for(let end=.018;end<=.095;end+=.003){const pitch=(length-start-end)/(count-1),points=[];
        for(let i=0;i<count;i++){const station=start+i*pitch,q=postAt(station);if(!q)break;points.push({...q,station});}
        if(points.length===count){const score=Math.abs(pitch-.155)+.02*(start+end)+(count-10)*.002;if(!best||score<best.score)best={score,count,pitch,start,end,points};}
      }
      if(!best)throw new Error('No evenly spaced supported posts on curved rail');
      builder.add(new THREE.TubeGeometry(path,168,.0065,10,false),RES.walnut,[0,0,0],[0,0,0],[1,1,1],SURFACE.WOOD,0);
      for(const {p,h,station} of best.points){const post=anchoredRailPost('弧形入门主梯',p.x,p.z,h.foot,p.y,h.angle,plateRun,plateWidth);post.station=station;post.rail=side>0?'outer':'inner';}
      residenceDetails.push({kind:'uniform continuous stair railing',rail:side>0?'outer':'inner',postCount:best.count,pitch:best.pitch,length,startSetback:best.start,endSetback:best.end,curved:true,allPlatesSupported:true,join:'coincident tangent endpoint'});
    }
  }
  function stairwellGuard(){
    // The existing inclined handrail remains unchanged. Its upper endpoint
    // returns smoothly into a level guard on the supported slab edge.
    const f=houseStair.flights[1],join=new CurvedStairRail(f,-1).getPoint(1);
    const guardY=houseStair.upper+.170,guardZ=openingFront+.012,capX=openingRight+.015,r=.025;
    const path=new THREE.CurvePath(),turnEnd=new THREE.Vector3(f.endX,guardY,guardZ);
    const tangent=new CurvedStairRail(f,-1).getTangent(1);
    path.add(new THREE.CubicBezierCurve3(join,join.clone().addScaledVector(tangent,.022),turnEnd.clone().add(new THREE.Vector3(-.022,0,0)),turnEnd));
    const cornerStart=new THREE.Vector3(capX-r,guardY,guardZ);
    path.add(new THREE.LineCurve3(turnEnd,cornerStart));
    const centre=new THREE.Vector3(capX-r,guardY,guardZ-r),cornerEnd=new THREE.Vector3(capX,guardY,guardZ-r);
    class GuardCorner extends THREE.Curve{getPoint(t,v=new THREE.Vector3()){const a=t*Math.PI/2;return v.set(centre.x+r*Math.sin(a),guardY,centre.z+r*Math.cos(a));}}
    path.add(new GuardCorner());
    path.add(new THREE.LineCurve3(cornerEnd,new THREE.Vector3(capX,guardY,-1.358)));
    builder.add(new THREE.TubeGeometry(path,128,.0065,12,false),RES.walnut,[0,0,0],[0,0,0],[1,1,1],SURFACE.WOOD,0);
    // Bronze supports and close-spaced spindles close the fall-through gaps.
    const bottom=houseStair.upper+.028;
    builder.beam([f.endX,bottom,guardZ],[capX,bottom,guardZ],.0035,RES.bronze,SURFACE.METAL);
    builder.beam([capX,bottom,guardZ],[capX,bottom,-1.358],.0035,RES.bronze,SURFACE.METAL);
    let supports=0,spindles=0;
    for(const [axis,a,b,fixed] of [['x',f.endX+.018,capX-.020,guardZ],['z',-1.336,guardZ-.018,capX]]){
      const count=Math.ceil((b-a)/.135);
      for(let k=0;k<=count;k++){
        const q=mix(a,b,k/count),x=axis==='x'?q:fixed,z=axis==='z'?q:fixed;
        anchoredRailPost('二楼洞口防护栏',x,z,houseStair.upper,guardY,0,.018,.018);supports++;
      }
      const gaps=Math.ceil((b-a)/.024);
      for(let k=0;k<=gaps;k++){
        const q=mix(a,b,k/gaps),x=axis==='x'?q:fixed,z=axis==='z'?q:fixed;
        builder.beam([x,bottom-.001,z],[x,guardY+.001,z],.0025,RES.bronze,SURFACE.METAL);spindles++;
      }
    }
    anchoredRailPost('二楼洞口圆角支撑',capX,guardZ,houseStair.upper,guardY,0,.018,.018);
    residenceDetails.push({kind:'closed upper stairwell guard',join:join.toArray(),level:guardY,front:guardZ,capX,back:-1.358,tubeRadius:.0065,cornerRadius:r,supports:supports+1,spindles,maxSpindlePitch:.024,mainRailsPreserved:true,connected:true});
  }
  // Finish only downward interior faces; slab edges and walking faces retain their own materials.
  function finishCeilingUnderside(g,minimumDown=-.99){
    const n=g.attributes.normal,c=g.attributes.color,t=g.attributes.surfaceType,finish=color(INTERIOR_FINISH.ceiling);
    for(let i=0;i<n.count;i++)if(n.getY(i)<minimumDown){c.setXYZ(i,finish.r,finish.g,finish.b);t.setX(i,SURFACE.CEILING);}
  }
  // Match the exposed west, east and rear slab edges to the exterior plaster.
  // Interior cutout returns, walking faces and ceiling undersides keep their finishes.
  function finishExteriorSlabEdges(g){
    const p=g.attributes.position,n=g.attributes.normal,c=g.attributes.color,finish=color(RES.wall);
    const west=Math.min(...upperBodyPlan.map(v=>v[0])),east=Math.max(...upperBodyPlan.map(v=>v[0])),rear=Math.min(...upperBodyPlan.map(v=>v[1]));
    for(let i=0;i<p.count;i++)if(Math.abs(n.getY(i))<.01&&(
      n.getX(i)<-.99&&Math.abs(p.getX(i)-west)<.0001||
      n.getX(i)>.99&&Math.abs(p.getX(i)-east)<.0001||
      n.getZ(i)<-.99&&Math.abs(p.getZ(i)-rear)<.0001))c.setXYZ(i,finish.r,finish.g,finish.b);
  }
  function libraryFloor(){
    const shape=new THREE.Shape(),hole=new THREE.Path();
    // Extend a small solid landing apron around the upper end of the curve.
    // The previous rectangular shell stopped short of this return, leaving a
    // false ceiling-sized gap at the stair mouth.
    [[-2.04,-1.46],[-.22,-1.46],[-.22,-.66],[-.31,-.66],[-.31,-.43],[-.70,-.43],[-.77,-.56],[-.77,-.66],[-2.04,-.66]].forEach(([x,z],i)=>i?shape.lineTo(x,-z):shape.moveTo(x,-z));shape.closePath();
    houseStair.opening.slice().reverse().forEach(([x,z],i)=>i?hole.lineTo(x,-z):hole.moveTo(x,-z));hole.closePath();shape.holes.push(hole);
    const slab=new THREE.ExtrudeGeometry(shape,{depth:.071,steps:1,bevelEnabled:false});slab.rotateX(-Math.PI/2);
    // The stair hall is a mineral soffit as well as a mineral floor: keep the
    // underside neutral grey-white while preserving the existing walking surface.
    builder.add(slab,INTERIOR_FINISH.ceiling,[0,1.279,0],[0,0,0],[1,1,1],SURFACE.PLASTER,0);
    finishExteriorSlabEdges(builder.parts.at(-1));
    finishCeilingUnderside(builder.parts.at(-1));
    const g=builder.parts[builder.parts.length-1],n=g.attributes.normal,c=g.attributes.color,t=g.attributes.surfaceType,stone=new THREE.Color(UPPER.oak);
    for(let i=0;i<n.count;i++)if(n.getY(i)>.99){c.setXYZ(i,stone.r,stone.g,stone.b);t.setX(i,SURFACE.UPPER_OAK)}
  }
  function interiorFloor(geometry,position=[0,0,0],rotation=[0,0,0]){
    // The structural slab edge belongs to the mineral exterior shell. Only
    // its upper walking face carries the interior stone finish beneath walls.
    builder.add(geometry,RES.wall,position,rotation,[1,1,1],SURFACE.PLASTER,0);
    const g=builder.parts.at(-1),n=g.attributes.normal,c=g.attributes.color,t=g.attributes.surfaceType,upper=position[1]>.8,finish=new THREE.Color(upper?UPPER.oak:RES.paving);
    if(position[1]>.8)finishCeilingUnderside(g);
    for(let i=0;i<n.count;i++)if(n.getY(i)>.99){c.setXYZ(i,finish.r,finish.g,finish.b);t.setX(i,upper?SURFACE.UPPER_OAK:SURFACE.FLOOR);}
  }
  // Wall lanterns have a wall plate, a short concealed arm and an enclosed paper
  // sleeve. The walnut end caps terminate the shade instead of extending as a rod.
  function wallLantern(name,x,y,z,angle=0,size=1){
    const c=Math.cos(angle),s=Math.sin(angle),at=(u,v,w)=>[x+(u*c+w*s)*size,y+v*size,z+(-u*s+w*c)*size];
    const add=(g,colour,p,type=SURFACE.METAL,glow=false,scale=[1,1,1])=>builder.add(g,colour,at(...p),[0,angle,0],scale.map(v=>v*size),type,0,glow);
    const box=(u,v,w,dx,dy,dz,colour,type=SURFACE.METAL)=>add(new THREE.BoxGeometry(dx,dy,dz),colour,[u,v,w],type);
    box(0,0,.0045,.036,.092,.007,RES.bronze);
    box(0,0,.021,.012,.022,.026,RES.bronze);
    // An elliptical, softly rounded washi sleeve sits clear of the wall.
    const sleeve=[[-.065,.027],[-.061,.033],[-.054,.035],[.054,.035],[.061,.033],[.065,.027]].map(([v,r])=>new THREE.Vector2(r,v));
    add(new THREE.LatheGeometry(sleeve,40),'#eee5d2',[0,0,.044],SURFACE.PAPER,true,[1,1,.68]);
    for(const side of [-1,1]){
      add(new THREE.CylinderGeometry(side>0?.029:.033,side>0?.033:.029,.010,40),RES.walnut,[0,side*.069,.044],SURFACE.WOOD,false,[1,1,.68]);
      add(new THREE.CylinderGeometry(.034,.034,.003,40),RES.bronze,[0,side*.0615,.044],SURFACE.METAL,false,[1,1,.68]);
      // Restrained side ribs join the two end caps; no line crosses the diffuser.
      box(side*.033,0,.044,.004,.131,.006,RES.bronze);
    }
    interiorFixtures.push({type:'wall',name,mount:at(0,0,0),centre:at(0,0,.044),normal:[s,0,c],height:.148*size,projection:.069*size,spread:.103*size,wallPlate:true,shortArm:true,enclosedShade:true});
  }
  function pendant(name,x,z,y,ceiling,radius,ring=false){
    // The top disk is embedded one millimetre into its actual ceiling face.
    builder.cyl(x,ceiling-.008,z,.026,.023,.018,RES.bronze,SURFACE.METAL,0,32);
    builder.cyl(x,ceiling-.021,z,.007,.011,.009,RES.walnut,SURFACE.WOOD,0,24);
    if(ring){
      for(const [r,dy]of [[radius,0],[radius*.63,-.073]]){
        builder.add(new THREE.TorusGeometry(r,.008,12,64),RES.bronze,[x,y+dy,z],[Math.PI/2,0,0],[1,1,1],SURFACE.METAL,0);
        // A recessed annular lens emits downwards inside the bronze rim.
        builder.add(new THREE.RingGeometry(r-.0055,r+.0055,64),'#eee2c9',[x,y+dy-.0065,z],[Math.PI/2,0,0],[1,1,1],SURFACE.PLASTER,0,true);
        for(let i=0;i<3;i++){
          const a=i*TAU/3,lower=[x+Math.cos(a)*r,y+dy+.005,z+Math.sin(a)*r];
          const upper=dy===0?[x,ceiling-.025,z]:[x+Math.cos(a)*radius,y-.005,z+Math.sin(a)*radius];
          builder.beam(lower,upper,.0035,RES.bronze,SURFACE.METAL);
        }
      }
    }else{
      // A gently compressed paper-stone shade with closed ferrules at both ends.
      const outline=[[.18,-.72],[.48,-.67],[.83,-.43],[1,-.08],[.98,.22],[.69,.54],[.20,.68]].map(([r,h])=>new THREE.Vector2(r*radius,h*radius));
      builder.add(new THREE.LatheGeometry(outline,40),'#e9e1ce',[x,y,z],[0,0,0],[1,1,1],SURFACE.PAPER,0,true);
      const neck=y+radius*.68;
      builder.cyl(x,neck+.004,z,radius*.19,radius*.27,.010,RES.bronze,SURFACE.METAL,0,24);
      builder.cyl(x,y-radius*.715,z,radius*.185,radius*.185,.006,RES.bronze,SURFACE.METAL,0,24);
      builder.beam([x,neck+.009,z],[x,ceiling-.025,z],.0038,RES.bronze,SURFACE.METAL);
    }
    interiorFixtures.push({type:'pendant',name,mount:[x,ceiling,z],centre:[x,y,z],radius,ring,closedFerrules:true,ceilingCanopy:true});
    residenceDetails.push({kind:'bespoke pendant',name,x,z,y,ceiling,radius,ring});
  }

  function stairSupportCabinet(s,f,back,front){
    const left=s.platformLeft,right=s.platformRight,base=f+.042,top=s.mid-.018,head=top-.045,shelf=base+.170;
    const block=(a,b,lo,hi,z0,z1,c=RES.wall,type=SURFACE.PLASTER)=>builder.box((a+b)/2,(lo+hi)/2,(z0+z1)/2,b-a,hi-lo,z1-z0,c,type,0);
    // A compact bearing core at the west turn; the usable niche faces the hall
    // instead of the wall. All joinery remains inside the platform footprint.
    block(left,right,f,base,back,front);
    block(left,right,base,head,back,front-.140);
    block(left,left+.030,base,head,front-.140,front);
    block(right-.030,right,base,head,front-.140,front);
    block(left,right,head,top,back,front);
    const l=left+.034,r=right-.034,nicheBack=front-.122;
    block(l,r,base+.003,head-.003,nicheBack-.012,nicheBack,RES.walnut,SURFACE.WOOD);
    block(l,r,shelf-.009,shelf+.009,nicheBack,front-.008,RES.walnut,SURFACE.WOOD);
    for(let i=0;i<2;i++){
      const a=mix(l,r,i/2)+.002,b=mix(l,r,(i+1)/2)-.002;
      block(a,b,base+.009,shelf-.018,front-.020,front-.008,RES.walnut,SURFACE.WOOD);
      builder.box((a+b)/2,base+.077,front-.004,.027,.005,.007,RES.bronze,SURFACE.METAL,0);
    }
    for(let i=0;i<2;i++){
      const x=l+.008+i*.016,h=.064+(i%3)*.012;
      block(x-.006,x+.006,shelf+.009,shelf+.009+h,nicheBack+.013,front-.033,['#9d927b','#647062'][i],SURFACE.WOOD);
    }
    const vx=r-.020,vz=front-.049,vy=shelf+.009;
    builder.add(new THREE.LatheGeometry([[.012,0],[.020,.012],[.021,.030],[.011,.052],[.008,.061]].map(([x,y])=>new THREE.Vector2(x,y)),24),'#aaa18b',[vx,vy,vz],[0,0,0],[.72,1,.72],SURFACE.STONE,0);
    builder.cyl(vx,vy+.060,vz,.006,.006,.003,'#5a5548',SURFACE.STONE,0,20);
    builder.box((l+r)/2,head-.010,front-.067,r-l-.012,.010,.076,RES.walnut,SURFACE.WOOD,0);
    builder.add(new THREE.BoxGeometry(r-l-.026,.004,.013),INTERIOR_FINISH.lampPanel,[(l+r)/2,head-.017,front-.053],[0,0,0],[1,1,1],SURFACE.CEILING_LIGHT,0,true);
    interiorFixtures.push({type:'linear',name:'楼梯展示龛隐藏灯',mount:[(l+r)/2,head-.015,front-.053],centre:[(l+r)/2,head-.017,front-.053],closedHousing:true});
    residenceDetails.push({kind:'multifunctional stair support',left,right,back,front,base:f,top,structure:['bearing core','two mineral end piers'],functions:['closed linen storage','flush walnut doors','book and ceramic display','concealed warm shelf light'],displayFacing:'south hall',recess:.122,projectsIntoRoute:false});
  }

  function decorateStairHall(r){
    const floor=r.f+.015;
    const rug=null;
    // Quiet walnut skirting and a wall-mounted washi light establish a finished hall.
    builder.box(-.762,floor+.026,-1.344,.964,.044,.012,RES.walnut,SURFACE.WOOD,0);
    builder.box(-1.244,floor+.026,-.9965,.012,.044,.763,RES.walnut,SURFACE.WOOD,0);
    wallLantern('楼梯厅胡桃和纸壁灯',-1.250,1.070,-.684,Math.PI/2,.94);
    // One small west-wall mineral relief sits below the washi sconce, outside
    // both flights and the entrance route; nothing protrudes into the rear run.
    builder.add(new THREE.BoxGeometry(.162,.216,.015),'#b8ab91',[-1.239,.790,-.687],[0,Math.PI/2,0],[1,1,1],SURFACE.PLASTER,0);
    builder.add(new THREE.BoxGeometry(.136,.190,.006),'#cbbfa8',[-1.229,.790,-.687],[0,Math.PI/2,0],[1,1,1],SURFACE.PLASTER,0);
    residenceDetails.push({kind:'stair mineral artwork',wall:'west',outsideWalkingRoute:true});
    // A neutral mineral ceiling strip keeps the stair hall from reading as a
    // yellow timber box and stays clear of the stair opening.
    builder.box(-.791,1.274,-.741,.855,.017,.064,INTERIOR_FINISH.ceilingTrim,SURFACE.CEILING,0);
    builder.add(new THREE.BoxGeometry(.779,.005,.024),INTERIOR_FINISH.lampPanel,[-.791,1.263,-.741],[0,0,0],[1,1,1],SURFACE.CEILING_LIGHT,0,true);
    interiorFixtures.push({type:'linear',name:'楼梯厅木槽线灯',mount:[-.791,1.2655,-.741],centre:[-.791,1.263,-.741],closedHousing:true});
    residenceDetails.push({kind:'furnished stair hall',rug,raisedFootplate:false,wallLight:'bronze and washi',art:'mineral landscape relief',ceiling:'recessed linear warm light',storage:'integrated landing support'});
  }


  // Upper-floor furniture and finishes are independent of the accepted lower rooms.
  const UPPER={wall:'#e4e3de',oak:'#b9a68b',oakLight:'#c8b79c',fabric:'#d6d5cf',fabricDeep:'#a9aaa5',rug:'#c5c5bf',metal:'#53554f',lamp:'#eeeee9'};
  const upperConnection={start:-.500,end:-.020,z:-1.060,width:.580,base:1.350,top:1.580,steps:3};
  const upperFurniture=[];
  const upperRecord=(room,name,x,z,w,d,low,high)=>upperFurniture.push({room,name,left:x-w/2,right:x+w/2,back:z-d/2,front:z+d/2,low,high});
  function upperSoft(x,y,z,w,h,d,c=UPPER.fabric){
    softBlock(x,y,z,w,h,d,c);
    const t=builder.parts.at(-1).attributes.surfaceType;for(let i=0;i<t.count;i++)t.setX(i,SURFACE.UPPER_FABRIC);
  }
  function upperFloorShape(){
    const s=new THREE.Shape(),back=upperConnection.z-upperConnection.width/2;
    [[-.22,-1.46],[1.28,-1.46],[1.28,-.66],[upperConnection.end,-.66],[upperConnection.end,back],[-.22,back]].forEach(([x,z],i)=>i?s.lineTo(x,-z):s.moveTo(x,-z));s.closePath();return s;
  }
  function finishUpperWalls(start,end,r,roofClosure=false){
    const wallFinish=color(UPPER.wall),ceilingFinish=color(INTERIOR_FINISH.ceiling);
    const left=r.x-r.w/2,right=r.x+r.w/2,back=r.z-r.d/2,front=r.z+r.d/2;
    const top=r.f+r.h+(roofClosure?.45:.005),revealDepth=.055;
    for(let k=start;k<end;k++){
      const original=builder.parts[k],g=original.toNonIndexed(),p=g.attributes.position,n=g.attributes.normal,c=g.attributes.color,t=g.attributes.surfaceType;let changed=false;
      for(let i=0;i<p.count;i+=3)if(t.getX(i)===SURFACE.PLASTER){
        const nx=n.getX(i),ny=n.getY(i),nz=n.getZ(i);
        const cx=(p.getX(i)+p.getX(i+1)+p.getX(i+2))/3,cz=(p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))/3,y=(p.getY(i)+p.getY(i+1)+p.getY(i+2))/3;
        const x=cx+nx*.02,z=cz+nz*.02;
        const inside=x>left+.002&&x<right-.002&&z>back+.002&&z<front-.002;
        // Window intrados and inward bevels may lie just beyond a room's wall plane.
        // Keep outward-facing facade planes intact while finishing these visible returns.
        const acrossX=cx>left+.002&&cx<right-.002,acrossZ=cz>back+.002&&cz<front-.002;
        const reveal=acrossX&&((Math.abs(cz-front)<revealDepth&&nz<.25)||(Math.abs(cz-back)<revealDepth&&nz>-.25))
          ||acrossZ&&((Math.abs(cx-right)<revealDepth&&nx<.25)||(Math.abs(cx-left)<revealDepth&&nx>-.25));
        if((inside||reveal)&&y>r.f+.025&&y<top){
          const downward=ny<-.25,finish=downward?ceilingFinish:wallFinish,type=downward?SURFACE.CEILING:SURFACE.UPPER_WALL;
          for(let j=i;j<i+3;j++){c.setXYZ(j,finish.r,finish.g,finish.b);t.setX(j,type);}changed=true;
        }
      }
      if(changed){builder.parts[k]=mergeVertices(g,1e-5);original.dispose();}g.dispose();
    }
  }
  function upperPendant(name,x,z,f,ceiling,radius=.057){
    const y=f+.435,profile=[[1,0],[1,.05],[.96,.22],[.78,.48],[.45,.65],[.12,.70],[0,.70]].map(([r,h])=>new THREE.Vector2(r*radius,h*radius));
    builder.cyl(x,ceiling-.007,z,.018,.018,.014,UPPER.metal,SURFACE.METAL,0,24);
    builder.beam([x,y+radius*.71,z],[x,ceiling-.012,z],.0022,UPPER.metal,SURFACE.METAL);
    builder.add(new THREE.LatheGeometry(profile,32),UPPER.lamp,[x,y,z],[0,0,0],[1,1,1],SURFACE.UPPER_WALL,0);
    builder.add(new THREE.CylinderGeometry(radius*.94,radius*.94,.003,32),UPPER.lamp,[x,y-.001,z],[0,0,0],[1,1,1],SURFACE.CEILING_LIGHT,0,true);
    interiorFixtures.push({type:'pendant',name,mount:[x,ceiling,z],centre:[x,y,z],radius,ring:false,closedFerrules:true,ceilingCanopy:true});
  }
  function upperPlant(x,y,z,size=.035){
    builder.cyl(x,y+.022,z,size*.70,size*.54,.044,'#b9bab3',SURFACE.UPPER_WALL,0,20);
    builder.cyl(x,y+.043,z,size*.55,size*.55,.003,'#5b6050',SURFACE.PAINT,0,20);
    for(let i=0;i<5;i++){
      const a=i*TAU/5,cx=x+Math.cos(a)*size*.65,cz=z+Math.sin(a)*size*.65,cy=y+.065+(i%2)*.016;
      builder.beam([x,y+.042,z],[cx,cy,cz],.0015,'#66715b',SURFACE.PAINT);
      builder.add(new THREE.SphereGeometry(size*.42,10,6),'#7d8871',[cx,cy,cz],[0,a,.35],[1,.30,1.65],SURFACE.PAINT,0);
    }
  }
  function upperBook(x,y,z,w=.08,d=.06){
    builder.box(x,y,z,w,.013,d,'#92998e',SURFACE.UPPER_WALL,0);
    builder.box(x,y+.009,z,w-.007,.010,d-.005,'#ddded7',SURFACE.UPPER_WALL,0);
  }
  // Upper-floor textiles and furniture share the accepted building geometry.
  function upperSoftCloth(points,nu,nv,c){
    const ps=[],ix=[];
    for(let j=0;j<=nv;j++)for(let i=0;i<=nu;i++)ps.push(...points(i/nu,j/nv));
    for(let j=0;j<nv;j++)for(let i=0;i<nu;i++){
      const a=j*(nu+1)+i,b=a+1,e=a+nu+1,f=e+1;
      ix.push(a,e,b,b,e,f);
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(ps,3));g.setIndex(ix);g.computeVertexNormals();
    // Preserve the smooth front normals before constructing the reversed back.
    const ng=g.toNonIndexed(),p=ng.attributes.position,n=ng.attributes.normal,dp=[],dn=[];
    for(let i=0;i<p.count;i++){dp.push(p.getX(i),p.getY(i),p.getZ(i));dn.push(n.getX(i),n.getY(i),n.getZ(i));}
    for(let i=0;i<p.count;i+=3)for(const k of [0,2,1]){dp.push(p.getX(i+k),p.getY(i+k),p.getZ(i+k));dn.push(-n.getX(i+k),-n.getY(i+k),-n.getZ(i+k));}
    const both=new THREE.BufferGeometry();both.setAttribute('position',new THREE.Float32BufferAttribute(dp,3));both.setAttribute('normal',new THREE.Float32BufferAttribute(dn,3));
    builder.add(both,c,[0,0,0],[0,0,0],[1,1,1],SURFACE.UPPER_FABRIC,0);
  }
  function upperTailoredCurtain(x,z,f,height,width,side=false){
    upperSoftCloth((u,v)=>{
      const fold=.008*Math.cos(u*Math.PI*10),spread=width*(.55+.45*Math.pow(v,.7));
      return side?[x+fold,f+height-v*(height-.025),z+(u-.5)*spread]:[x+(u-.5)*spread,f+height-v*(height-.025),z+fold];
    },24,14,'#ddd4c6');
    if(side)lMetal(x+.009,f+.15,z,.004,.005,width*.68);
    else lMetal(x,f+.15,z-.009,width*.68,.005,.004);
  }
  function upperTeaMug(x,y,z,r=.011){
    const p=[[r*.7,0],[r*.94,.001],[r,.022],[r*.8,.022],[r*.74,.004]].map(a=>new THREE.Vector2(...a));
    builder.cyl(x,y-.002,z,r*1.7,r*1.7,.004,'#e1e2dc',SURFACE.UPPER_WALL,0,28);
    builder.add(new THREE.LatheGeometry(p,24),'#e5e6e1',[x,y,z],[0,0,0],[1,1,1],SURFACE.UPPER_WALL,0);
    builder.add(new THREE.TorusGeometry(r*.59,.0018,6,18),'#e5e6e1',[x+r*1.04,y+.012,z],[0,0,0],[1,1,1],SURFACE.UPPER_WALL,0);
    builder.cyl(x,y+.014,z,r*.74,r*.74,.002,'#6b6155',SURFACE.PAINT,0,24);
  }

  const NORDIC={oak:'#68503f',pale:'#b69d80',smoked:'#3f332c',wool:'#e4dfd3',woolDeep:'#b4a293',stone:'#e6e3db',metal:'#b59a69',opal:'#f0ece3',paper:'#e8e0d2'};
  const nordicGlassParts=[];
  // A closed rounded solid, with analytical normals through all eased edges.
  function nBox(x,y,z,w,h,d,r,c,type=SURFACE.UPPER_OAK,rot=[0,0,0]){
    const half=[w/2,h/2,d/2];r=Math.min(r,...half.map(v=>v*.94));
    const core=half.map(v=>v-r),ps=[],ns=[],ix=[];
    const coords=H=>{
      const q=[];for(let i=0;i<=5;i++)q.push(-H+r*(1-Math.cos(i*Math.PI/10)));
      q.push(0);for(let i=5;i>=0;i--)q.push(H-r*(1-Math.cos(i*Math.PI/10)));return q;
    };
    for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){
      const uv=[0,1,2].filter(i=>i!==axis),us=coords(half[uv[0]]),vs=coords(half[uv[1]]),start=ps.length/3;
      for(const v of vs)for(const u of us){
        const p=[0,0,0];p[axis]=sign*half[axis];p[uv[0]]=u;p[uv[1]]=v;
        const k=p.map((v,i)=>Math.max(-core[i],Math.min(core[i],v))),n=p.map((v,i)=>v-k[i]),len=Math.hypot(...n);
        for(let i=0;i<3;i++)n[i]/=len;ps.push(...k.map((v,i)=>v+n[i]*r));ns.push(...n);
      }
      for(let j=0;j<vs.length-1;j++)for(let i=0;i<us.length-1;i++){
        const a=start+j*us.length+i,b=a+1,c=a+us.length,e=c+1;
        const orientation=(axis===1?-1:1)*sign;
        if(orientation>0)ix.push(a,b,c,b,e,c);else ix.push(a,c,b,b,c,e);
      }
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(ps,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(ns,3));g.setIndex(ix);
    builder.add(g,c,[x,y,z],rot,[1,1,1],type,0);
  }
  function nLeg(a,b,rt=.0055,rb=.0034,c=NORDIC.smoked){
    const p=new THREE.Vector3(...a),q=new THREE.Vector3(...b),v=q.clone().sub(p),g=new THREE.CylinderGeometry(rt,rb,v.length(),18);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),v.clone().normalize()));
    builder.add(g,c,p.add(q).multiplyScalar(.5).toArray(),[0,0,0],[1,1,1],SURFACE.UPPER_OAK,0);
  }
  function nOutline(x,y,z,w,d,r,color,type=SURFACE.NORDIC_WOOL){
    const points=[];
    for(const [cx,cz,start] of [[w/2-r,d/2-r,0],[-w/2+r,d/2-r,Math.PI/2],[-w/2+r,-d/2+r,Math.PI],[w/2-r,-d/2+r,Math.PI*1.5]])
      for(let j=0;j<=5;j++){const a=start+j*Math.PI/10;points.push([x+cx+Math.cos(a)*r,y,z+cz+Math.sin(a)*r]);}
    points.push(points[0]);tube(points,.0006,color,type);
  }
  // Curved plywood shell has front, back and closed perimeter, rather than a flat back board.
  function nChairShell(x,f,z){
    const nu=24,nv=14,ps=[],ix=[];
    const curve=(u,v)=>[x+(u-.5)*.139,f+.089+v*.129,z-.054-.013*v+.011*Math.pow((u-.5)*2,2)];
    for(let side=0;side<2;side++)for(let j=0;j<=nv;j++)for(let i=0;i<=nu;i++){
      const u=i/nu,v=j/nv,p=curve(u,v),q=Math.min(u,1-u)*.139;
      p[1]-=Math.max(0,.006-q)*Math.pow(v,14);p[2]+=(side?1:-1)*.0022;ps.push(...p);
    }
    const count=(nu+1)*(nv+1);
    for(let side=0;side<2;side++)for(let j=0;j<nv;j++)for(let i=0;i<nu;i++){
      const a=side*count+j*(nu+1)+i,b=a+1,c=a+nu+1,d=c+1;
      if(side)ix.push(a,b,c,b,d,c);else ix.push(a,c,b,b,c,d);
    }
    const edge=[];for(let i=0;i<=nu;i++)edge.push(i);for(let j=1;j<=nv;j++)edge.push(j*(nu+1)+nu);for(let i=nu-1;i>=0;i--)edge.push(nv*(nu+1)+i);for(let j=nv-1;j>0;j--)edge.push(j*(nu+1));
    for(let i=0;i<edge.length;i++){const a=edge[i],b=edge[(i+1)%edge.length];ix.push(a,b,a+count,b,b+count,a+count);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(ps,3));g.setIndex(ix);g.computeVertexNormals();
    builder.add(g,NORDIC.oak,[0,0,0],[0,0,0],[1,1,1],SURFACE.UPPER_OAK,0);
    // A narrow welt delineates the bent shell and the upholstered insert.
    const top=[];for(let i=0;i<=24;i++){const p=curve(i/24,1);p[2]+=.0026;top.push(p);}tube(top,.00065,NORDIC.pale,SURFACE.UPPER_OAK);
  }
  function nFlutedGlass(x,y,z,w,h,side=false){
    const nu=Math.max(40,Math.ceil(w/.0035)),ps=[],ix=[];
    for(let face=0;face<2;face++)for(let j=0;j<=1;j++)for(let i=0;i<=nu;i++){
      const u=i/nu,zz=face?-.0015:.00065*Math.cos(u*w/.006*TAU);
      ps.push((u-.5)*w,(j-.5)*h,zz);
    }
    const count=(nu+1)*2;
    for(let face=0;face<2;face++)for(let i=0;i<nu;i++){
      const a=face*count+i,b=a+1,c=a+nu+1,d=c+1;
      if(face)ix.push(a,c,b,b,c,d);else ix.push(a,b,c,b,d,c);
    }
    for(let i=0;i<nu;i++)for(const j of [0,1]){const a=j*(nu+1)+i,b=a+1;ix.push(a,b,a+count,b,b+count,a+count);}
    for(const i of [0,nu]){const a=i,b=i+nu+1;ix.push(a,a+count,b,a+count,b+count,b);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(ps,3));g.setIndex(ix);g.computeVertexNormals();
    if(side)g.rotateY(Math.PI/2);g.translate(x,y,z);nordicGlassParts.push(g);
  }
  const LUXE={walnut:'#68503f',dark:'#3f332c',ivory:'#e4dfd3',taupe:'#b4a293',stone:'#e6e3db',brass:'#b59a69',bronze:'#796142',ink:'#51483e',opal:'#f0ece3'};
  function lBox(x,y,z,w,h,d,r,c,type=SURFACE.UPPER_OAK,rot=[0,0,0]){nBox(x,y,z,w,h,d,r,c,type,rot);}
  function lMetal(x,y,z,w,h,d,r=.0007){lBox(x,y,z,w,h,d,r,LUXE.brass,SURFACE.LUXE_BRASS);}
  function lFrame(x,y,z,w,h,side=false,color=LUXE.brass){
    const b=.0017;
    for(const dy of [-h/2,h/2])lBox(x,y+dy,z,side?.002:w,b,side?w:.002,.0005,color,SURFACE.LUXE_BRASS);
    for(const dx of [-w/2,w/2])lBox(side?x:x+dx,y,side?z+dx:z,side?.002:b,h,side?b:.002,.0005,color,SURFACE.LUXE_BRASS);
  }
  function lVase(x,y,z,r=.018,h=.063,color=LUXE.ivory,flowers=false){
    const profile=[[r*.60,0],[r*.94,h*.10],[r,h*.35],[r*.83,h*.60],[r*.48,h*.86],[r*.53,h]].map(a=>new THREE.Vector2(...a));
    builder.add(new THREE.LatheGeometry(profile,32),color,[x,y,z],[0,0,0],[1,1,1],SURFACE.NORDIC_OPAL,0);
    builder.cyl(x,y+h,z,r*.43,r*.43,.0015,LUXE.dark,SURFACE.UPPER_WALL,0,24);
    if(flowers)for(let i=0;i<7;i++){
      const a=i*2.4,hh=h+.036+(i%3)*.013,dx=Math.cos(a)*r*1.30,dz=Math.sin(a)*r*1.13;
      tube([[x,y+h-.012,z],[x+dx*.45,y+h+.024,z+dz*.45],[x+dx,y+hh,z+dz]],.0008,'#737763',SURFACE.UPPER_WALL);
      for(let j=0;j<5;j++){
        const aa=j*TAU/5;builder.add(new THREE.SphereGeometry(.0055,12,8),i%3===0?'#c3afa0':'#ede6d9',[x+dx+Math.cos(aa)*.0043,y+hh+.0015,z+dz+Math.sin(aa)*.0043],[.2,aa,.25],[1,.40,1.2],SURFACE.NORDIC_OPAL,0);
      }
      builder.add(new THREE.SphereGeometry(.009,12,8),'#7f856f',[x+dx*.5,y+h+.024,z+dz*.5],[.2,a,.45],[1,.15,.5],SURFACE.UPPER_WALL,0);
    }
  }
  function lBooks(x,y,z,w=.065,dep=.040,side=false){
    for(let i=0;i<3;i++){
      const yy=y+i*.009; lBox(x,yy+.0035,z,side?dep:w,.007,side?w:dep,.001,['#735d4b','#d8d0c1','#9d8e7c'][i],SURFACE.UPPER_WALL);
      lBox(side?x+.001:x,yy+.0035,side?z:z+.001,side?dep+.001:w-.006,.004,side?w-.006:dep+.001,.0005,'#e2dbce',SURFACE.UPPER_WALL);
    }
  }
  function lSculpture(x,y,z,scale=1,side=false){
    builder.cyl(x,y+.003,z,.016*scale,.016*scale,.006,LUXE.dark,SURFACE.UPPER_OAK,0,32);
    builder.add(new THREE.TorusGeometry(.022*scale,.003*scale,10,48),LUXE.brass,[x,y+.029*scale,z],[0,side?Math.PI/2:-.2,.23],[.82,1.28,1],SURFACE.LUXE_BRASS,0);
    builder.add(new THREE.TorusGeometry(.015*scale,.0024*scale,10,40),LUXE.bronze,[x,y+.028*scale,z],[0,side?Math.PI/2+.40:.45,-.3],[.86,1.12,1],SURFACE.LUXE_BRASS,0);
  }
  function lTeaCabinet(f){
    const x=.244,z=-1.274,w=.388,dep=.144;
    lBox(x,f+.116,z,w,.170,dep,.003,LUXE.walnut);
    lBox(x,f+.027,z,w-.026,.016,dep-.025,.0015,LUXE.dark);
    lMetal(x,f+.035,z+dep/2-.008,w-.012,.003,.002);
    for(const dx of [-.095,.095]){
      lBox(x+dx,f+.115,z+dep/2+.001,.185,.147,.007,.002,LUXE.ivory,SURFACE.LUXE_LACQUER);
      lFrame(x+dx,f+.115,z+dep/2+.005,.163,.127);
      lMetal(x+dx+(dx<0?.064:-.064),f+.118,z+dep/2+.010,.0024,.032,.004);
    }
    lBox(x,f+.208,z,w+.012,.013,dep+.006,.0022,LUXE.stone,SURFACE.LUXE_MARBLE);
    lBox(x,f+.304,-1.337,w-.010,.172,.006,.0015,LUXE.stone,SURFACE.LUXE_MARBLE);
    for(const dx of [-w/2+.0035,w/2-.0035])lBox(x+dx,f+.363,z,.007,.310,dep,.0015,LUXE.walnut);
    for(const yy of [.393,.517])lBox(x,f+yy,z,w,.007,dep,.0015,LUXE.walnut);
    for(const yy of [.393,.517])lMetal(x,f+yy,-1.199,w,.002,.003);
    nFlutedGlass(x+.096,f+.454,-1.199,.170,.102);lFrame(x+.096,f+.454,-1.197,.173,.106);
    lMetal(x+.025,f+.454,-1.193,.0024,.032,.004);
    homeBookRow(.079,f+.397,-1.289,3);lVase(.177,f+.397,-1.284,.014,.064,LUXE.ivory);
    lVase(.339,f+.397,-1.286,.021,.072,'#b3a18e');lVase(.398,f+.397,-1.287,.015,.050,LUXE.ivory);
    // Functional tea counter: stone backsplash and grouped porcelain, with no picture inside.
    lVase(.095,f+.219,-1.281,.018,.061,LUXE.ivory,true);
    builder.add(new THREE.CylinderGeometry(.047,.047,.004,40),LUXE.walnut,[.249,f+.219,-1.263],[0,0,0],[1.42,1,.65],SURFACE.UPPER_OAK,0);
    homeKettle(.232,f+.223,-1.266);upperTeaMug(.280,f+.223,-1.250,.0085);upperTeaMug(.304,f+.223,-1.279,.008);
    lVase(.404,f+.219,-1.278,.013,.045,'#b3a18e');
    builder.add(new THREE.BoxGeometry(.361,.002,.005),'#f2e9d9',[x,f+.389,-1.212],[0,0,0],[1,1,1],SURFACE.CEILING_LIGHT,0,true);
  }
  function lRug(x,f,z,w,dep){
    lBox(x,f+.018,z,w,.004,dep,.002,'#e0d8ca',SURFACE.UPPER_FABRIC);
    for(const pad of [.008,.020]){
      const ww=w-pad*2,dd=dep-pad*2;
      for(const dz of [-dd/2,dd/2])lBox(x,f+.0205,z+dz,ww,.001,.0014,.0003,pad<.01?'#9b8873':'#c4b39d',SURFACE.UPPER_FABRIC);
      for(const dx of [-ww/2,ww/2])lBox(x+dx,f+.0205,z,.0014,.001,dd,.0003,pad<.01?'#9b8873':'#c4b39d',SURFACE.UPPER_FABRIC);
    }
    for(let i=0;i<5;i++)for(let j=0;j<3;j++){
      const xx=x-w*.33+i*w*.165,zz=z-dep*.24+j*dep*.24;
      nOutline(xx,f+.021,zz,w*.10,dep*.13,.007,'#d1c3af',SURFACE.UPPER_FABRIC);
    }
  }
  function lSofa(f){
    const x=.763,z=-1.250;
    lRug(.765,f,-1.190,.556,.292);
    for(const dx of [-.19,.19])for(const dz of [-.068,.068])builder.cyl(x+dx,f+.042,z+dz,.005,.004,.049,LUXE.bronze,SURFACE.LUXE_BRASS,0,18);
    lBox(x,f+.064,z,.456,.026,.173,.006,LUXE.walnut);lMetal(x,f+.060,z+.087,.435,.003,.002);
    lBox(x,f+.085,z,.445,.033,.164,.013,LUXE.ivory,SURFACE.LUXE_VELVET);
    for(const dx of [-.108,.108]){
      lBox(x+dx,f+.109,z+.007,.205,.044,.149,.018,LUXE.ivory,SURFACE.LUXE_VELVET);
      nOutline(x+dx,f+.121,z+.007,.193,.137,.015,'#c5b9a7',SURFACE.LUXE_VELVET);
    }
    lBox(x,f+.161,z-.072,.432,.103,.047,.019,'#d6cbbc',SURFACE.LUXE_VELVET);
    for(const dx of [-.211,.211])lBox(x+dx,f+.129,z+.002,.043,.083,.172,.017,LUXE.ivory,SURFACE.LUXE_VELVET);
    for(const [dx,c,a] of [[-.137,'#b6a090',.11],[.115,'#d9cbb7',-.12]])lBox(x+dx,f+.184,z-.043,.067,.061,.033,.013,c,SURFACE.LUXE_VELVET,[-.12,0,a]);
    lBox(x,f+.155,z-.040,.108,.038,.029,.010,'#bca88d',SURFACE.LUXE_VELVET,[-.15,0,.03]);
    upperSoftCloth((u,v)=>{
      const a=v<.28?v/.28:v<.72?(v-.28)/.44:(v-.72)/.28;
      const yy=v<.28?f+.219-a*.048:v<.72?f+.171-a*.040:f+.131-a*.081;
      const zz=v<.28?-1.333+a*.058:v<.72?-1.275+a*.092:-1.183+a*.009;
      return [.916+(u-.5)*.094,yy+.0028*Math.cos(u*Math.PI*8),zz];
    },24,28,'#b9a18b');
    // Two nested stone tables share the previous coffee-table footprint.
    for(const [xx,zz,rx,rz,hh] of [[.703,-1.091,.085,.043,.119],[.794,-1.083,.047,.038,.087]]){
      builder.add(new THREE.CylinderGeometry(1,1,.010,64),LUXE.stone,[xx,f+hh,zz],[0,0,0],[rx,1,rz],SURFACE.LUXE_MARBLE,0);
      builder.add(new THREE.CylinderGeometry(1,1,.012,48),LUXE.bronze,[xx,f+hh-.011,zz],[0,0,0],[rx*.94,1,rz*.94],SURFACE.LUXE_BRASS,0);
      for(const dx of [-rx*.53,rx*.53])builder.cyl(xx+dx,f+hh*.50,zz,.0035,.0035,hh-.033,LUXE.brass,SURFACE.LUXE_BRASS,0,16);
    }
    lBooks(.710,f+.127,-1.092,.055,.037);lVase(.796,f+.094,-1.086,.012,.037,LUXE.ivory,true);
  }
  function lSconce(x,f,z,side=false){
    lBox(x,f+.362,z,side?.006:.023,.056,side?.023:.006,.003,LUXE.brass,SURFACE.LUXE_BRASS);
    builder.add(new THREE.CylinderGeometry(.010,.012,.059,28),LUXE.opal,[side?x+.012:x,f+.363,side?z:z+.012],[0,0,0],[1,1,1],SURFACE.CEILING_LIGHT,0,true);
    builder.cyl(side?x+.012:x,f+.333,side?z:z+.012,.012,.012,.003,LUXE.brass,SURFACE.LUXE_BRASS,0,28);
    interiorFixtures.push({type:'wall',name:'二层乳白玻璃壁灯',mount:[x,f+.363,z],centre:[side?x+.012:x,f+.363,side?z:z+.012],normal:side?[1,0,0]:[0,0,1],spread:.065});
  }
  function lLivingBackdrop(f){
    lBox(.763,f+.392,-1.344,.495,.235,.006,.002,'#d7cdbf',SURFACE.LUXE_LACQUER);
    lFrame(.763,f+.392,-1.339,.474,.212,false,'#bba487');
    lBox(.763,f+.392,-1.332,.314,.157,.007,.002,'#eee7db',SURFACE.UPPER_WALL);
    lFrame(.763,f+.392,-1.327,.321,.164);
    for(let k=0;k<4;k++){
      const p=[];for(let i=0;i<=28;i++){const u=i/28;p.push([.626+u*.274,f+.346+k*.024+Math.sin(u*6+k*.58)*.013,-1.321]);}
      tube(p,.0017,['#b8a48c','#d0c2af','#928272','#c1af96'][k],SURFACE.UPPER_WALL);
    }
    lSconce(.494,f,-1.335);lSconce(1.026,f,-1.335);
    // Small occasional table fits the gap beside the sofa; the front circulation band stays open.
    builder.cyl(.490,f+.110,-1.239,.030,.030,.010,LUXE.stone,SURFACE.LUXE_MARBLE,0,40);
    builder.cyl(.490,f+.064,-1.239,.014,.022,.082,LUXE.walnut,SURFACE.UPPER_OAK,0,32);
    lSculpture(.490,f+.116,-1.239,.64);
    // Slender floor lamp occupies the rear corner, below the existing ceiling.
    builder.cyl(1.030,f+.029,-1.280,.026,.026,.010,LUXE.bronze,SURFACE.LUXE_BRASS,0,32);
    builder.cyl(1.030,f+.243,-1.280,.0025,.0025,.418,LUXE.brass,SURFACE.LUXE_BRASS,0,18);
    builder.add(new THREE.CylinderGeometry(.027,.039,.058,40),LUXE.ivory,[1.030,f+.463,-1.280],[0,0,0],[1,1,1],SURFACE.PAPER,0,true);
    builder.cyl(1.030,f+.435,-1.280,.039,.039,.002,LUXE.brass,SURFACE.LUXE_BRASS,0,40);
    interiorFixtures.push({type:'floor',name:'二层客厅落地灯',centre:[1.030,f+.463,-1.280],mount:[1.030,f+.029,-1.280]});
  }
  function lStorageWall(f){
    const x=-1.859,z=-.418,w=.156,dep=.372;
    lBox(x-w/2+.003,f+.289,z,.006,.536,dep,.0015,LUXE.taupe,SURFACE.LUXE_LACQUER);
    for(const zz of [z-dep/2+.003,z+dep/2-.003])lBox(x,f+.289,zz,w,.536,.006,.0015,LUXE.walnut);
    for(const yy of [.024,.211,.339,.461,.557]){
      lBox(x,f+yy,z,w,.006,dep,.0014,LUXE.walnut);lMetal(x+w/2+.001,f+yy,z,.002,.002,dep);
    }
    for(const zz of [z-.093,z+.093]){
      lBox(x+w/2-.001,f+.117,zz,.006,.176,.180,.002,LUXE.ivory,SURFACE.LUXE_LACQUER);
      lFrame(x+w/2+.003,f+.117,zz,.159,.154,true);lMetal(x+w/2+.008,f+.144,zz,.004,.025,.002);
    }
    nFlutedGlass(x+w/2+.003,f+.508,z+.086,.180,.083,true);lFrame(x+w/2+.005,f+.508,z+.086,.182,.085,true);
    homeBookRow(-1.793,f+.214,-.550,5,true);lVase(-1.794,f+.214,-.306,.019,.085,LUXE.ivory);
    lSculpture(-1.789,f+.343,-.331,1.15,true);lBooks(-1.798,f+.343,-.530,.111,.069,true);
    lVase(-1.798,f+.465,-.343,.021,.074,'#b6a18a');lVase(-1.798,f+.465,-.506,.016,.056,LUXE.ivory);
    lMetal(x+w/2-.023,f+.455,z,.002,.002,dep-.020);
    builder.add(new THREE.BoxGeometry(.002,.0015,.335),'#f0e5d3',[x+w/2-.022,f+.454,z],[0,0,0],[1,1,1],SURFACE.CEILING_LIGHT,0,true);
  }
  function lDeskChair(f){
    const x=-1.635,z=.164;
    lRug(-1.641,f,.210,.398,.364);
    for(const dx of [-.052,.052])for(const dz of [-.047,.047]){
      nLeg([x+dx,f+.020,z+dz],[x+dx*.86,f+.092,z+dz*.78],.005,.0034,LUXE.walnut);
      builder.cyl(x+dx,f+.025,z+dz,.0038,.0038,.014,LUXE.brass,SURFACE.LUXE_BRASS,0,16);
    }
    lBox(x,f+.090,z,.140,.017,.126,.007,LUXE.walnut);
    lBox(x,f+.103,z+.002,.134,.026,.119,.011,LUXE.ivory,SURFACE.LUXE_VELVET);
    lBox(x,f+.166,z-.055,.139,.103,.027,.012,LUXE.taupe,SURFACE.LUXE_VELVET,[-.07,0,0]);
    lBox(x,f+.168,z-.038,.121,.085,.011,.005,LUXE.ivory,SURFACE.LUXE_VELVET,[-.07,0,0]);
    for(const dx of [-.050,.050])nLeg([x+dx,f+.088,z-.047],[x+dx,f+.170,z-.060],.0035,.0035,LUXE.walnut);
  }
  function lMusicCabinet(f){
    lBox(1.139,f+.110,-1.073,.077,.173,.462,.003,LUXE.walnut);
    lBox(1.139,f+.029,-1.073,.059,.015,.440,.0015,LUXE.dark);
    lBox(1.132,f+.201,-1.073,.091,.013,.474,.0022,LUXE.stone,SURFACE.LUXE_MARBLE);
    for(const zz of [-1.193,-.952]){
      lBox(1.094,f+.113,zz,.006,.145,.228,.002,LUXE.walnut);lFrame(1.090,f+.113,zz,.207,.123,true);
      lMetal(1.086,f+.158,zz,.004,.0025,.033);
    }
    lBox(1.130,f+.223,-1.212,.065,.022,.088,.002,LUXE.dark);
    builder.cyl(1.129,f+.236,-1.218,.026,.026,.003,'#33312d',SURFACE.METAL,0,48);
    builder.cyl(1.129,f+.238,-1.218,.008,.008,.001,LUXE.brass,SURFACE.LUXE_BRASS,0,24);
    tube([[1.153,f+.242,-1.181],[1.151,f+.246,-1.197],[1.139,f+.240,-1.212]],.0012,LUXE.brass,SURFACE.LUXE_BRASS);
    lBooks(1.132,f+.209,-1.077,.075,.060,true);lSculpture(1.132,f+.235,-1.078,.75,true);
    builder.cyl(1.131,f+.213,-.900,.020,.020,.008,LUXE.brass,SURFACE.LUXE_BRASS,0,32);
    builder.cyl(1.131,f+.247,-.900,.004,.008,.060,LUXE.walnut,SURFACE.UPPER_OAK,0,28);
    builder.cyl(1.131,f+.295,-.900,.025,.033,.053,LUXE.ivory,SURFACE.UPPER_FABRIC,0,40);
    builder.cyl(1.131,f+.270,-.900,.033,.033,.002,LUXE.brass,SURFACE.LUXE_BRASS,0,40);
    lFrame(1.163,f+.426,-1.062,.261,.176,true,'#bba487');
    lBox(1.160,f+.426,-1.062,.004,.141,.218,.001,LUXE.ivory,SURFACE.LUXE_LACQUER);
    lFrame(1.157,f+.426,-1.062,.213,.137,true);
  }
  function lPendant(name,x,z,f,ceiling,radius=.057){
    const y=f+.442,r=radius;
    builder.cyl(x,ceiling-.006,z,.017,.017,.012,LUXE.brass,SURFACE.LUXE_BRASS,0,32);
    builder.cyl(x,(y+ceiling-.010)/2,z,.0018,.0018,ceiling-.010-y,LUXE.brass,SURFACE.LUXE_BRASS,0,18);
    for(let i=0;i<5;i++){
      const a=i*TAU/5,xx=x+Math.cos(a)*r*.77,zz=z+Math.sin(a)*r*.77,yy=y+(i%2)*.019;
      tube([[x,y,z],[xx*.0+x+(xx-x)*.54,y+.015,z+(zz-z)*.54],[xx,yy+.016,zz]],.0015,LUXE.brass,SURFACE.LUXE_BRASS);
      builder.add(new THREE.SphereGeometry(r*.255,28,18),LUXE.opal,[xx,yy,zz],[0,0,0],[1,1.07,1],SURFACE.CEILING_LIGHT,0,true);
      builder.cyl(xx,yy+r*.245,zz,.005,.005,.004,LUXE.brass,SURFACE.LUXE_BRASS,0,20);
    }
    builder.add(new THREE.SphereGeometry(r*.21,24,16),LUXE.opal,[x,y-.015,z],[0,0,0],[1,1,1],SURFACE.CEILING_LIGHT,0,true);
    interiorFixtures.push({type:'pendant',name,mount:[x,ceiling,z],centre:[x,y,z],radius:r,closedFerrules:true,ceilingCanopy:true});
  }


  function homeBookRow(x,y,z,count=5,side=false){
    const tones=['#ae9580','#d9d0bf','#77604d','#ece3d4','#998875'];
    for(let i=0;i<count;i++){
      const h=.063+(i%3)*.012,t=.013+(i%2)*.003;
      if(side){
        builder.box(x,y+h/2,z+i*.019,.048,h,t,tones[i%5],SURFACE.UPPER_WALL,0);
        builder.box(x+.025,y+h*.34,z+i*.019,.001,.002,t*.64,'#e9eae1',SURFACE.UPPER_WALL,0);
      }else{
        builder.box(x+i*.019,y+h/2,z,t,h,.041,tones[i%5],SURFACE.UPPER_WALL,0);
        builder.box(x+i*.019,y+h*.34,z+.021,t*.64,.002,.001,'#e9eae1',SURFACE.UPPER_WALL,0);
      }
    }
  }
  function homeKettle(x,y,z){
    const p=[[.011,0],[.019,.004],[.021,.021],[.014,.038],[.010,.040]].map(a=>new THREE.Vector2(...a));
    builder.add(new THREE.LatheGeometry(p,28),'#d7dbd2',[x,y,z],[0,0,0],[1,1,1],SURFACE.UPPER_WALL,0);
    builder.cyl(x,y+.041,z,.012,.012,.004,UPPER.oak,SURFACE.UPPER_OAK,0,24);
    builder.cyl(x,y+.047,z,.003,.004,.006,UPPER.oak,SURFACE.UPPER_OAK,0,16);
    tube([[x-.018,y+.011,z],[x-.030,y+.022,z],[x-.037,y+.032,z]],.0035,'#d7dbd2',SURFACE.UPPER_WALL);
    builder.add(new THREE.TorusGeometry(.017,.0028,8,26),'#6d7668',[x,y+.059,z],[0,0,0],[1,1,1],SURFACE.PAINT,0);
  }
  function homeTree(x,f,z){
    builder.cyl(x,f+.045,z,.033,.026,.055,'#d2d6ce',SURFACE.UPPER_WALL,0,28);
    builder.cyl(x,f+.073,z,.027,.027,.002,'#626951',SURFACE.PAINT,0,28);
    tube([[x,f+.070,z],[x+.004,f+.169,z],[x-.008,f+.258,z-.012],[x+.003,f+.347,z-.011]],.0028,'#8a8974',SURFACE.UPPER_OAK);
    for(let i=0;i<9;i++){
      const a=i*2.4,yy=f+.145+i*.023,bx=x+Math.cos(a)*.036,bz=z+Math.sin(a)*.030;
      builder.beam([x,yy-.007,z],[bx,yy,bz],.0011,'#839174',SURFACE.PAINT);
      builder.add(new THREE.SphereGeometry(.018,14,8),i%2?'#8d9b82':'#7c8c71',[bx,yy+.004,bz],[0,a,.35],[.75,.24,1.85],SURFACE.PAINT,0);
    }
  }
  function homeCoastArt(x,y,z,w,h,side=false){
    nBox(x,y,z,side?.008:w,h,side?w:.008,.0015,NORDIC.oak);
    nBox(side?x-.006:x,y,side?z:z+.006,side?.002:w-.010,h-.010,side?w-.010:.002,.0007,NORDIC.paper,SURFACE.UPPER_WALL);
    for(let k=0;k<5;k++){
      const pts=[];for(let i=0;i<16;i++){
        const u=-w*.40+w*.80*i/15,v=-h*.24+k*h*.105+Math.sin(i*.41+k*.55)*h*.022;
        pts.push(side?[x-.008,y+v,z+u]:[x+u,y+v,z+.008]);
      }
      tube(pts,.0007,['#98a697','#aeb9a4','#85978f','#b5c0b2','#9ca99a'][k],SURFACE.UPPER_WALL);
    }
    builder.add(new THREE.CircleGeometry(h*.050,30),'#bdc4b5',side?[x-.008,y+h*.23,z+w*.18]:[x+w*.18,y+h*.23,z+.008],side?[0,-Math.PI/2,0]:[0,0,0],[1,1,1],SURFACE.UPPER_WALL,0);
  }
  function furnishUpperInterior(r){
    const f=r.f,oak=UPPER.oak;
    if(r.role==='library'){
      
      // A shallow book wall stays in the solid west landing; the gallery is empty.
      builder.box(-2.007,f+.224,-.859,.045,.418,.150,oak,SURFACE.UPPER_OAK,0);
      for(const yy of [.080,.205,.335])builder.box(-1.976,f+yy,-.859,.025,.012,.122,UPPER.oakLight,SURFACE.UPPER_OAK,0);
      for(let shelf=0;shelf<3;shelf++)for(let i=0;i<5;i++){
        const h=.058+(i%3)*.013,z=-.902+i*.022;
        builder.box(-1.960,f+.087+shelf*.127+h/2,z,.019,h,.017,['#92998e','#c4c2b8','#87867e'][i%3],SURFACE.UPPER_WALL,0);
      }
      upperRecord(r.role,'landing bookcase',-1.992,-.859,.084,.150,f+.015,f+.433);

      homeCoastArt(-1.440,f+.372,-1.342,.116,.197);
    }else if(r.role==='upperRight'){
      lTeaCabinet(f);
      upperRecord(r.role,'tea niche and closed storage',.244,-1.274,.406,.156,f+.020,f+.523);
      homeTree(.072,f,-1.075);
      upperRecord(r.role,'small indoor tree',.072,-1.075,.094,.090,f+.016,f+.374);

      lSofa(f);
      upperRecord(r.role,'single family sofa',.763,-1.250,.480,.200,f+.015,f+.207);
      upperRecord(r.role,'nested marble tables',.730,-1.088,.232,.106,f+.015,f+.153);
      upperRecord(r.role,'sofa side table',.490,-1.239,.060,.060,f+.015,f+.185);
      upperRecord(r.role,'slender rear floor lamp',1.030,-1.280,.078,.078,f+.015,f+.492);
      lLivingBackdrop(f);

      lMusicCabinet(f);
      upperRecord(r.role,'music and linen cabinet',1.133,-1.073,.093,.474,f+.020,f+.208);
      for(const xx of [-.040,.350,.715,1.100])upperTailoredCurtain(xx,-.789,f,.508,.040);
      builder.beam([-.065,f+.511,-.792],[1.125,f+.511,-.792],.002,UPPER.metal,SURFACE.METAL);
    }else if(r.role==='upperGallery'){
      lStorageWall(f);
      upperRecord(r.role,'full-height work and craft storage',-1.859,-.418,.168,.372,f+.015,f+.563);
      // Window-facing surface supports writing and drawing. Only one task chair.
      lBox(-1.655,f+.184,.405,.530,.018,.180,.003,LUXE.walnut);
      lBox(-1.646,f+.194,.405,.485,.0025,.148,.002,LUXE.stone,SURFACE.LUXE_MARBLE);
      lMetal(-1.655,f+.177,.316,.505,.002,.002);
      for(const xx of [-1.877,-1.433])for(const zz of [.338,.472])nLeg([xx,f+.017,zz],[xx,f+.176,zz],.0055,.0039,NORDIC.oak);
      lBox(-1.833,f+.123,.398,.119,.120,.144,.003,LUXE.walnut);
      for(const yy of [.111,.173])lMetal(-1.833,f+yy,.324,.081,.002,.003);
      lVase(-1.445,f+.196,.388,.014,.051,LUXE.ivory,true);
      upperRecord(r.role,'writing and drawing desk',-1.655,.405,.530,.180,f+.015,f+.1935);
      lDeskChair(f);
      upperRecord(r.role,'single desk chair',-1.635,.164,.150,.146,f+.015,f+.218);
      // The useful objects sit on one work surface rather than in isolated decorative islands.
      builder.add(new THREE.BoxGeometry(.117,.004,.080),'#e5e8dc',[-1.673,f+.197,.385],[0,.12,0],[1,1,1],SURFACE.UPPER_WALL,0);
      for(let i=0;i<7;i++)builder.box(-1.674,f+.1995,.359+i*.009,.073,.0007,.001,'#aebba7',SURFACE.UPPER_WALL,0);
      builder.add(new THREE.CylinderGeometry(.0011,.0011,.074,12),UPPER.oak,[-1.708,f+.202,.377],[Math.PI/2,0,.22],[1,1,1],SURFACE.UPPER_OAK,0);
      // Closed laptop and paper trays can be moved aside for hand work.
      builder.box(-1.523,f+.199,.400,.086,.007,.062,'#aab5a2',SURFACE.METAL,0);
      builder.box(-1.523,f+.203,.400,.079,.001,.058,'#bdc7b3',SURFACE.METAL,0);
      builder.box(-1.806,f+.206,.441,.069,.024,.068,UPPER.oak,SURFACE.UPPER_OAK,0);
      builder.box(-1.806,f+.219,.441,.057,.002,.055,'#e1e6d8',SURFACE.UPPER_WALL,0);
      builder.cyl(-1.757,f+.216,.461,.011,.011,.041,'#cbd3c2',SURFACE.UPPER_WALL,0,26);
      for(let i=0;i<4;i++)builder.beam([-1.764+i*.004,f+.224,.461],[-1.765+i*.005,f+.267+(i%2)*.004,.459],.001,UPPER.oak,SURFACE.UPPER_OAK);
      builder.cyl(-1.475,f+.201,.465,.018,.018,.008,UPPER.metal,SURFACE.METAL,0,26);
      builder.beam([-1.475,f+.205,.465],[-1.477,f+.277,.459],.002,UPPER.metal,SURFACE.METAL);
      builder.beam([-1.477,f+.277,.459],[-1.498,f+.298,.440],.002,UPPER.metal,SURFACE.METAL);
      const shade=[[0,.019],[.006,.019],[.018,.014],[.026,.002],[.024,-.005],[.012,-.010],[0,-.009]].map(a=>new THREE.Vector2(...a));
      builder.add(new THREE.LatheGeometry(shade,36),NORDIC.opal,[-1.498,f+.298,.440],[0,0,.20],[1,1,1],SURFACE.NORDIC_OPAL,0);
      for(const zz of [-.048,.468])upperTailoredCurtain(-1.904,zz,f,.539,.049,true);
      upperPlant(-1.850,f+.194,.481,.022);
      lSconce(-1.928,f,-.127,true);
    }
    residenceDetails.push({kind:'elegant luxury upper room',room:r.name,role:r.role,design:r.role==='library'?'clear stair foyer':r.role==='upperGallery'?'integrated craft library and window desk':'tea niche and single family lounge with music storage',tatami:false,floorSeating:false,style:'elegant luxury'});
  }
  function refinedUpperInterior(r){
    const ceiling=r.f+r.h;
    if(r.role==='library'){
      builder.box(-1.33,ceiling+.014,-1.06,1.22,.028,.58,INTERIOR_FINISH.ceiling,SURFACE.CEILING,0);
      builder.add(new THREE.BoxGeometry(.021,.004,.23),INTERIOR_FINISH.lampPanel,[-1.88,ceiling-.004,-1.09],[0,0,0],[1,1,1],SURFACE.CEILING_LIGHT,0,true);
    }else{
      builder.box(r.x,ceiling+.014,r.z,r.w-.19,.028,r.d-.19,INTERIOR_FINISH.ceiling,SURFACE.CEILING,0);
      lPendant(r.name+'香槟金乳白玻璃枝形灯',r.role==='upperRight'?.748:r.x,r.role==='upperRight'?-1.086:.196,r.f,ceiling,r.role==='upperRight'?.061:.047);
    }
  }

  function furnishResidence(r){
    if(r.upper){furnishUpperInterior(r);return;}
    const f=r.f,back=r.z-r.d/2+.12;
    const ceramic=(x,y,z,rad,h,c)=>{
      const points=[[rad*.60,0],[rad*.91,h*.15],[rad,h*.50],[rad*.70,h*.83],[rad*.38,h]].map(([a,b])=>new THREE.Vector2(a,b));
      builder.add(new THREE.LatheGeometry(points,16),c,[x,y,z],[0,0,0],[1,1,1],SURFACE.STONE,0);
      builder.cyl(x,y+h-.006,z,rad*.34,rad*.34,.008,'#595747',SURFACE.STONE,0,14);
    };
    const book=(x,y,z,w,d,colour)=>{builder.box(x,y,z,w,.032,d,colour,SURFACE.WOOD,0);builder.box(x,y+.001,z+.005,w-.009,.024,d-.006,'#d7cbbb',SURFACE.PLASTER,0)};
    if(r.role==='salon'){
      // A low hearth is framed within the existing mineral feature wall.
      const z=back+.059;
      builder.box(.50,f+.063,z+.035,.70,.045,.115,RES.stone,SURFACE.STONE,0);
      builder.box(.50,f+.240,z,.49,.22,.028,'#33352f',SURFACE.METAL,0);
      for(const x of [.242,.758])builder.box(x,f+.245,z+.008,.025,.256,.046,'#b1ab98',SURFACE.STONE,0);
      builder.box(.50,f+.366,z+.008,.55,.026,.046,'#b1ab98',SURFACE.STONE,0);
      builder.box(.50,f+.145,z+.020,.42,.011,.030,RES.bronze,SURFACE.METAL,0);
      // Deep firebox cheeks, soot-dark brickwork, charred logs and an ember grate.
      for(const s of [-1,1])builder.box(.50+s*.230,f+.239,z+.037,.018,.207,.082,'#3b3931',SURFACE.METAL,0);
      builder.box(.50,f+.344,z+.036,.473,.013,.079,'#37372f',SURFACE.METAL,0);
      for(let j=0;j<3;j++)for(let i=0;i<6;i++){const x=.50+(i-2.5)*.070+(j%2?.012:0);builder.box(x,f+.161+j*.051,z+.018,.064,.042,.006,['#4c4537','#544638','#433f34'][(i+j)%3],SURFACE.STONE,0)}
      for(let i=0;i<18;i++){const a=i*2.399,x=.50+.164*Math.sin(a),zz=z+.044+.025*Math.cos(a);builder.add(new THREE.IcosahedronGeometry(1,1),i%3?'#392d22':'#bd6938',[x,f+.180+(i%3)*.003,zz],[.2,a,.4],[.012,.006,.008],SURFACE.STONE,0)}
      for(let i=0;i<4;i++){
        const x=.50+(i%2?1:-1)*.059,zz=z+.041+(i<2?-.011:.015),yy=f+.190+(i<2?0:.019),len=.167+(i%3)*.020;
        builder.add(new THREE.CylinderGeometry(.011,.015,len,11),'#302b25',[x,yy,zz],[0,i%2?-.34:.36,Math.PI/2+(i<2?.015:-.048)],[1,1,1],SURFACE.WOOD,0);
        for(let k=0;k<4;k++)builder.add(new THREE.IcosahedronGeometry(1,1),k%3?'#29251f':'#9d4b29',[x+(k-1.5)*.034,yy+.011,zz+.009],[.2,k*.8,.1],[.009,.003,.005],SURFACE.STONE,0);
      }
      hearthSpec={x:.50,y:f+.196,z:z+.060,width:.35,height:.133,depth:.045};
      // The west edge now belongs to the open stair-to-salon circulation.
      // A tea service is modelled on the existing coffee table.
      builder.cyl(.61,f+.127,-.900,.057,.057,.006,RES.bronze,SURFACE.METAL,0,20);
      ceramic(.615,f+.132,-.905,.020,.029,'#ded4bb');
      for(const x of [.575,.657]){builder.cyl(x,f+.134,-.877,.011,.011,.012,'#d7cfba',SURFACE.STONE,0,12);builder.cyl(x,f+.141,-.877,.008,.008,.002,'#564b33',SURFACE.STONE,0,12)}
      book(.74,f+.148,-.920,.074,.057,'#7d8171');
      // Small stitching and folded textile edges establish scale in close views.
      for(const x of [.285,.55,.815])for(const z of [-.688,-.570])builder.box(x,f+.188,z,.220,.004,.004,'#a79f8b',SURFACE.PLASTER,0);
      residenceDetails.push({kind:'furnished salon',facilities:['mineral hearth','walnut sideboard','ceramic tea service','linen stitching'],clearCirculation:true});
    }else if(r.role==='bedroom'){
      softBlock(r.x,f+.208,-.075,.475,.022,.18,'#b8ad94');
      for(let i=0;i<6;i++)builder.box(r.x-.218+i*.087,f+.222,-.075,.007,.005,.174,'#928a75',SURFACE.PLASTER,0);
      ceramic(r.x+.27,f+.190,-.36,.024,.041,'#b3ad98');
      book(r.x+.27,f+.197,-.295,.068,.040,'#7f8377');
      // Wall sconce and a slim framed textile panel stay within the bedroom shell.
      wallLantern('卧室胡桃和纸阅读灯',r.x-r.w/2+.110,f+.50,-.55,Math.PI/2,.84);
      residenceDetails.push({kind:'furnished bedroom',facilities:['woven bed runner','bedside ceramics','reading sconce']});
    }else if(r.role==='tea'){
      ceramic(r.x,f+.139,-.54,.028,.048,'#a7a58b');
      for(const z of [-.585,-.49])builder.cyl(r.x-.05,f+.136,z,.016,.016,.015,'#c4bd9f',SURFACE.STONE,0,14);
      // Tokonoma-like alcove and asymmetrical ceramics enhance the quiet tea room.
      builder.box(r.x,f+.12,back+.08,.45,.022,.12,RES.stone,SURFACE.STONE,0);
      ceramic(r.x-.14,f+.133,back+.07,.028,.082,'#787b70');ceramic(r.x+.07,f+.133,back+.07,.040,.050,'#b6af99');
      builder.box(r.x+.10,f+.45,back+.053,.13,.26,.011,'#d0c5ac',SURFACE.PLASTER,0);
      builder.box(r.x+.10,f+.46,back+.061,.026,.143,.007,'#60665a',SURFACE.WOOD,0);
      residenceDetails.push({kind:'furnished tea room',facilities:['tea utensils','ceramic alcove','hanging textile']});
    }else if(r.role==='backStudy'){
      // Compact service cabinetry is entirely inside the closed rear room.
      builder.box(r.x,f+.139,back+.04,.51,.27,.15,RES.walnut,SURFACE.WOOD,0);
      builder.box(r.x,f+.287,back+.04,.53,.026,.17,RES.stone,SURFACE.STONE,0);
      builder.box(r.x+.12,f+.302,back+.045,.17,.011,.097,'#41483e',SURFACE.METAL,0);
      tube([[r.x+.12,f+.309,back-.003],[r.x+.12,f+.379,back-.003],[r.x+.12,f+.400,back+.037],[r.x+.12,f+.368,back+.061]],.005,RES.bronze,SURFACE.METAL,0);
      for(const x of [r.x-.16,r.x,r.x+.16])builder.box(x,f+.157,back+.119,.035,.008,.010,RES.bronze,SURFACE.METAL,0);
      residenceDetails.push({kind:'service cabinetry',facilities:['stone countertop','inset sink','bronze tap']});
    }
  }
  function refinedInterior(r){
    if(r.upper){refinedUpperInterior(r);return;}
    const ceiling=r.f+r.h+.014,back=r.z-r.d/2+.12;
    if(!['entry','library','backStudy'].includes(r.role)){
      builder.box(r.x,ceiling,r.z,r.w-.16,.028,r.d-.16,INTERIOR_FINISH.ceiling,SURFACE.CEILING,0);
      for(const dx of [-1,1])builder.box(r.x+dx*(r.w/2-.13),ceiling-.022,r.z,.018,.031,r.d-.21,RES.walnut,SURFACE.WOOD);
      for(const dz of [-1,1])builder.box(r.x,ceiling-.022,r.z+dz*(r.d/2-.13),r.w-.21,.031,.018,RES.walnut,SURFACE.WOOD);
      for(let i=1;i<3;i++)builder.box(r.x-r.w/2+.13+i*(r.w-.26)/3,ceiling-.018,r.z,.012,.025,r.d-.26,INTERIOR_FINISH.ceilingTrim,SURFACE.CEILING);
      builder.box(r.x,ceiling-.021,back+.031,r.w-.29,.016,.022,RES.walnut,SURFACE.WOOD,0);
      builder.add(new THREE.BoxGeometry(r.w-.32,.004,.012),INTERIOR_FINISH.lampPanel,[r.x,ceiling-.031,back+.031],[0,0,0],[1,1,1],SURFACE.CEILING_LIGHT,0,true);
      interiorFixtures.push({type:'linear',name:r.name+'隐藏檐槽灯',mount:[r.x,ceiling-.014,back+.031],centre:[r.x,ceiling-.031,back+.031],closedHousing:true});
    }
    if(r.role==='salon'){
      pendant('主厅双层古铜光环',.54,-.82,r.f+.77,ceiling-.014,.14,true);
      // A mineral feature panel, timber fillets and two wall sconces sit away from the wall face.
      builder.box(.50,r.f+.48,back+.016,.88,.55,.020,'#c2bcad',SURFACE.PLASTER);
      for(const x of [.052,.948])builder.box(x,r.f+.48,back+.030,.017,.57,.016,RES.walnut,SURFACE.WOOD);
      for(const x of [.15,.85])wallLantern('主厅胡桃和纸壁灯',x,r.f+.59,back+.026);
      builder.cyl(.75,r.f+.131,-.907,.035,.025,.049,RES.stone,SURFACE.STONE,0,20);
      builder.box(.49,r.f+.128,-.907,.12,.018,.078,'#cfc7b8',SURFACE.PLASTER,0);
      // Linen folds have physical depth rather than a transparent paper sheet.
      for(const x of [-.12,1.18])for(let i=0;i<3;i++)builder.cyl(x+i*.018,r.f+.49,r.z+r.d/2-.136,.014,.014,.83,RES.linen,SURFACE.PLASTER,0,10);
    }else if(r.role==='bedroom'){
      pendant('卧室和纸柔光吊灯',r.x+.24,-.35,r.f+.57,ceiling-.014,.046);
      softBlock(r.x,r.f+.255,-.48,.50,.25,.045,'#b2ac9d');
      builder.box(r.x+.27,r.f+.095,-.36,.12,.16,.17,RES.walnut,SURFACE.WOOD);
      builder.box(r.x+.27,r.f+.181,-.36,.13,.012,.18,RES.stone,SURFACE.STONE);
      builder.box(r.x+.27,r.f+.120,-.267,.043,.007,.008,RES.bronze,SURFACE.METAL);
      builder.box(r.x,r.f+.026,.27,.50,.010,.23,'#a8a99a',SURFACE.PLASTER);
    }else if(r.role==='tea'){
      pendant('茶室纸石吊灯',r.x,-.56,r.f+.58,ceiling-.014,.075);
      for(const z of [-.92,-.18]){builder.box(r.x,r.f+.052,z,.27,.053,.23,RES.walnut,SURFACE.WOOD);softBlock(r.x,r.f+.094,z,.25,.028,.21);softBlock(r.x,r.f+.175,z+(z<-.5?-.09:.09),.25,.14,.035);}
      builder.cyl(r.x+.034,r.f+.150,-.53,.025,.032,.035,RES.stone,SURFACE.STONE,0,18);
      builder.box(r.x,r.f+.40,back+.020,.37,.40,.025,'#b5ad9a',SURFACE.STONE);
      builder.box(r.x,r.f+.40,back+.037,.26,.025,.008,RES.walnut,SURFACE.WOOD);
    }else if(r.role==='backStudy'){
      wallLantern('后侧服务间和纸壁灯',-1.925,.86,-1.055,Math.PI/2,.72);
      residenceDetails.push({kind:'open under-stair service bay',ceilingRemoved:true,partyWallRemoved:true});
    }else if(r.role==='entry'){
      decorateStairHall(r);
    }
    residenceDetails.push({kind:'refined interior',room:r.name,features:['coffered mineral ceiling','bronze pendants','walnut built-ins','linen upholstery'],ceiling});
  }
  const residenceScaleMark=beginBuildingScale('courtyard residence and dry terraces',[0,.245,-.50]);
  // One continuous floor closes the former party-wall seam between equal-level
  // rooms. The stepped perimeter follows both existing exterior footprints.
  const sharedFloor=new THREE.Shape();
  [[-2.04,-1.46],[1.28,-1.46],[1.28,-.42],[-.22,-.42],[-.22,-.48],[-1.36,-.48],[-1.36,-.94],[-2.04,-.94]].forEach(([x,z],i)=>i?sharedFloor.lineTo(x,-z):sharedFloor.moveTo(x,-z));sharedFloor.closePath();
  interiorFloor(new THREE.ExtrudeGeometry(sharedFloor,{depth:.030,steps:1,bevelEnabled:false}),[0,.365,0],[-Math.PI/2,0,0]);
  for(const r of residenceRooms){const back=r.z-r.d/2,front=r.z+r.d/2,upperWallStart=builder.parts.length;
    if(!r.upper)foundation(r.name,r.x,r.z,r.w,r.d,r.f);
    if(r.role==='library')libraryFloor();else if(r.role==='upperRight')interiorFloor(new THREE.ExtrudeGeometry(upperFloorShape(),{depth:.030,steps:1,bevelEnabled:false}),[0,r.f-.015,0],[-Math.PI/2,0,0]);else if(!['entry','salon','backStudy'].includes(r.role))interiorFloor(new THREE.BoxGeometry(r.w,.030,r.d),[r.x,r.f,r.z]);
    if(r.role==='entry'){const top=houseStair.upper;plasterBox(r.x,(r.f+top)/2,-1.405,r.w,top-r.f,.11);residenceDetails.push({kind:'continuous stair rear wall',innerZ:-1.350,bottom:r.f,top:1.905,colour:RES.wall,openBands:false});}else if(r.role!=='upperGallery')plasterBox(r.x,r.f+r.h/2,back+.055,r.w,r.h,.11,true);
    if(r.role==='salon'){
      archFacade(r,{count:3,opening:.388,height:.945});
      // A broad open portal unites the stair hall and salon. Solid end returns
      // and a shallow curved head keep the upper-floor structure continuous.
       builder.box(r.x+r.w/2-.045,r.f+r.h/2,r.z,.09,r.h,r.d,INTERIOR_FINISH.wall,SURFACE.PLASTER,topSnow);
      const portal={x:r.x-r.w/2,back:-1.330,front:-.565,bottom:r.f+.015,spring:1.145,rise:.115,top:r.f+r.h,depth:.09};
       for(const [a,b] of [[back,portal.back],[portal.front,front]])builder.box(portal.x+portal.depth/2,r.f+r.h/2,(a+b)/2,portal.depth,r.h,b-a,INTERIOR_FINISH.wall,SURFACE.PLASTER,topSnow);
      const span=(portal.front-portal.back)/2,centre=(portal.front+portal.back)/2,head=new THREE.Shape();
      head.moveTo(-span,portal.spring);head.lineTo(-span,portal.top);head.lineTo(span,portal.top);head.lineTo(span,portal.spring);
      for(let i=1;i<=40;i++){const a=i*Math.PI/40;head.lineTo(span*Math.cos(a),portal.spring+portal.rise*Math.sin(a))}head.closePath();
       // The underside of this first-floor portal reads as the stair-hall
       // ceiling, so its mineral finish stays close to the adjoining neutral walls.
       builder.add(new THREE.ExtrudeGeometry(head,{depth:portal.depth,steps:1,bevelEnabled:false}),INTERIOR_FINISH.wall,[portal.x,0,centre],[0,Math.PI/2,0],[1,1,1],SURFACE.PLASTER,topSnow);
      finishCeilingUnderside(builder.parts.at(-1),-.1);
      residenceDetails.push({kind:'open stair-to-salon portal',...portal,width:portal.front-portal.back,glass:false,door:false,levelThreshold:true,clearFrontRoute:{back:-.790,front:-.590,left:-.510,right:.300}});
      // Seating faces the hearth, with a clear door-side aisle to the stair hall.
      plasterBox(.55,r.f+.09,-.618,.83,.135,.185);plasterBox(.55,r.f+.205,-.548,.83,.155,.035);
      for(const x of [.285,.55,.815])softBlock(x,r.f+.172,-.630,.250,.030,.145);
      for(const x of [.36,.76])softBlock(x,r.f+.245,-.562,.18,.07,.035,'#afb2a0');
      builder.box(.61,r.f+.100,-.908,.38,.037,.170,RES.walnut,SURFACE.WOOD);
      for(const x of [.46,.76])builder.box(x,r.f+.041,-.908,.025,.078,.115,RES.walnut,SURFACE.WOOD);
      builder.box(.62,r.f+.027,-.912,.91,.012,.37,'#b5b5a3',SURFACE.PLASTER,0);
      builder.box(1.189,r.f+.235,-1.05,.070,.410,.38,RES.walnut,SURFACE.WOOD);
      for(const y of [r.f+.11,r.f+.25,r.f+.40])builder.box(1.141,y,-1.05,.054,.013,.35,RES.paving,SURFACE.STONE,0);
      for(const z of [-1.12,-1.0])builder.cyl(1.11,r.f+.265,z,.019,.016,.038,RES.stone,SURFACE.STONE,0,20);
      residenceDetails.push({kind:'hearth-facing salon',sofa:{x:.55,z:-.618,width:.83,depth:.185,facing:[0,0,-1]},hearthZ:-1.186,table:{x:.61,z:-.908,width:.38,depth:.17},leftAisle:{left:-.12,right:.135},hearthClearance:.45,stairRouteClear:true});
    }else if(r.role==='entry'){
      archFacade(r,{count:2,opening:.38,height:.79});
      // The west partition opens into the rear bay only where the stair turns.
      // The bedroom-facing return remains a solid wall below the upper floor.
      const wallX=r.x-r.w/2+.055;
      for(const [z0,z1] of [[-1.46,houseStair.partitionOpening.back],[houseStair.partitionOpening.front,-.48]]){const top=z1<=-1.35?houseStair.upper:1.279;plasterBox(wallX,(r.f+top)/2,(z0+z1)/2,.11,top-r.f,z1-z0);}
      const s=houseStair;
      for(const f of s.flights)stairFlightSolid(f);
      // Keep the turning void completely clear.  The former support cabinet
      // projected into the first straight tread and read as a穿模 obstruction.
      residenceDetails.push({kind:'clear stair turning void',cabinetRemoved:true,headroomAboveLanding:.34});
      stairRails();
      stairwellGuard();
      residenceDetails.push({kind:'single-turn timber stair',...s,turn:90,totalRun:s.flights.reduce((n,f)=>n+f.run,0),slopes:s.flights.map(f=>Math.atan2(f.top-f.base,f.run)*180/Math.PI),turnConnection:{point:[turnEnd.x,turnEnd.z],top:s.mid},approach:'entrance arch axis',entryAxis:-.505,arrival:'wide west library foyer',landingWidth:.320,frontGalleryClearDepth:.265,continuousHandrail:true,analyticTreads:true,heteromorphicTurnTreads:true,turnWidthRange:[s.width*.84,s.width],turnJoin:'coincident tangent endpoint; no diagonal bridge'});

      // The rear plaster wall stays free of the former cabinet and cushion.
    }else if(r.role==='bedroom'){
      plasterBox(r.x-r.w/2+.055,r.f+r.h/2,r.z,.11,r.h,r.d,true);
      // A distinct bedroom ends in a glazed doorway, opening to a narrow link.
      archFacade(r,{count:1,opening:.39,height:.64});
      // A closed spandrel carries the new upper wing; no posts cover the windows.
      const upperLevel=1.335,bandBottom=r.f+r.h;
      for(const s of [-1,1])plasterBox(r.x+s*(r.w/2-.055),(upperLevel+bandBottom)/2,r.z,.11,upperLevel-bandBottom,r.d,true);
      for(const z of [r.z-r.d/2+.055,r.z+r.d/2-.055])plasterBox(r.x,(upperLevel+bandBottom)/2,z,r.w-.22,upperLevel-bandBottom,.11);
      // The rear section is shared with the entry;
      // The rear section is a shared solid wall with the entry; glazing starts
      // beyond the balcony return, so no hidden window sits inside the joint.
      archFacade({...r,z:.1925,d:1.015},{side:true,out:1,count:2,opening:.405,height:.65});
      builder.box(r.x,r.f+.085,-.13,.48,.14,.69,RES.walnut,SURFACE.WOOD);softBlock(r.x,r.f+.18,-.13,.46,.05,.67);
      for(const z of [-.33,-.13])softBlock(r.x-.10,r.f+.22,z,.20,.033,.15);
      builder.box(r.x-.27,r.f+.29,-.39,.060,.43,.26,RES.walnut,SURFACE.WOOD);
    }else if(r.role==='tea'){
      plasterBox(r.x+r.w/2-.055,r.f+r.h/2,r.z,.11,r.h,r.d,true);
      archFacade(r,{count:1,opening:.43,height:.69});
      archFacade(r,{side:true,out:-1,count:3,opening:.43,height:.68});
      builder.box(r.x,r.f+.026,r.z,.51,.010,1.13,'#a9ad99',SURFACE.PLASTER,0);
      builder.cyl(r.x,r.f+.115,-.54,.12,.12,.024,RES.walnut,SURFACE.WOOD,0,24);builder.cyl(r.x,r.f+.061,-.54,.028,.049,.080,RES.walnut,SURFACE.WOOD,0,16);
      for(const z of [-.84,-.26])softBlock(r.x,r.f+.048,z,.24,.025,.18,'#989f8b');
      builder.box(r.x,r.f+.33,-1.325,.47,.53,.075,RES.walnut,SURFACE.WOOD);
      for(const y of [r.f+.17,r.f+.37,r.f+.56])builder.box(r.x,y,-1.278,.44,.017,.048,RES.paving,SURFACE.STONE,0);
      for(let j=0;j<4;j++){const z=-1.10+j*.35;builder.box(r.x+r.w/2+.011,r.f+.37,z,.024,.55,.26,RES.wall,SURFACE.PLASTER)}
    }else if(r.role==='backStudy'){
      plasterBox(r.x-r.w/2+.055,r.f+r.h/2,r.z,.11,r.h,r.d,true);
      // This grounded rear bay supports the widened second storey.
      // Quiet continuous mineral rear wall; no applied false window.
    }else if(r.role==='upperGallery'){
      archFacade(r,{count:1,opening:.43,height:.43});
      archFacade(r,{side:true,out:1,count:2,opening:.40,height:.43});
      // A recessed segmental arch and three slender lights relate to the front arcade.
      const face=r.x-r.w/2,zc=.21,ww=.48,bottom=r.f+.095,top=r.f+.520,rise=.108,springY=top-rise,rad=ww/2;
      for(const [a,b] of [[back,zc-ww/2],[zc+ww/2,front]])plasterBox(face+.05,r.f+r.h/2,(a+b)/2,.10,r.h,b-a);
      plasterBox(face+.05,(r.f+bottom)/2,zc,.10,bottom-r.f,ww);
      const archHead=new THREE.Shape();archHead.moveTo(-rad,springY);archHead.lineTo(-rad,r.f+r.h);archHead.lineTo(rad,r.f+r.h);archHead.lineTo(rad,springY);
      for(let k=1;k<=40;k++){const a=k*Math.PI/40;archHead.lineTo(rad*Math.cos(a),springY+rise*Math.sin(a))}archHead.closePath();
      builder.add(new THREE.ExtrudeGeometry(archHead,{depth:.10,steps:1,bevelEnabled:false}),RES.wall,[face,0,zc],[0,Math.PI/2,0],[1,1,1],SURFACE.PLASTER,0);
      const archOutline=(shape,radius,base,spring,lift)=>{shape.moveTo(-radius,base);shape.lineTo(radius,base);shape.lineTo(radius,spring);for(let k=1;k<=40;k++){const a=k*Math.PI/40;shape.lineTo(radius*Math.cos(a),spring+lift*Math.sin(a))}shape.closePath();};
      const reveal=new THREE.Shape(),hole=new THREE.Path();archOutline(reveal,rad+.022,bottom-.016,springY,rise+.018);archOutline(hole,rad,bottom,springY,rise);reveal.holes.push(hole);
      builder.add(new THREE.ExtrudeGeometry(reveal,{depth:.019,steps:1,bevelEnabled:true,bevelSegments:2,bevelSize:.002,bevelThickness:.002}),RES.wallShade,[face-.008,0,zc],[0,Math.PI/2,0],[1,1,1],SURFACE.PLASTER,0);
      const frame=new THREE.Shape(),frameHole=new THREE.Path();archOutline(frame,rad-.007,bottom+.006,springY,rise-.007);archOutline(frameHole,rad-.015,bottom+.014,springY,rise-.015);frame.holes.push(frameHole);
      builder.add(new THREE.ExtrudeGeometry(frame,{depth:.018,steps:1,bevelEnabled:false}),RES.bronze,[face+.065,0,zc],[0,Math.PI/2,0],[1,1,1],SURFACE.METAL,0);
      builder.box(face+.056,bottom-.017,zc,.125,.019,ww+.060,RES.wallShade,SURFACE.PAVING,0);
      for(const s of [-1,1])builder.box(face+.075,(bottom+springY)/2,zc+s*ww/6,.017,springY-bottom,.007,RES.bronze,SURFACE.METAL,0);
      builder.box(face+.074,springY,zc,.018,.007,ww-.031,RES.bronze,SURFACE.METAL,0);
      glazingParts.push({x:face+.084,y:(bottom+top)/2,z:zc,w:ww-.028,h:top-bottom-.024,side:true,archRise:rise-.012});
      builder.box(face+.132,top+.019,zc,.023,.015,ww+.063,RES.walnut,SURFACE.WOOD);
      // Full-height tailored curtains are emitted with the upper-room furnishings.
      residenceDetails.push({kind:'west sea window',face,centerZ:zc,width:ww,bottom,top,wallThickness:.10,actualOpening:true,design:'segmental mineral arch with recessed bronze three-light frame',rise});
      // Study furniture is emitted as one coordinated layout below.
      residenceDetails.push({kind:'upper wing extension',rear:-.66,front:.64,connectedToLibrary:true,stopsBeforeReading:true});
    }else if(r.role==='upperRight'){
      // The seaward arches remain; the specified east side is one solid plaster wall.
      archFacade(r,{count:2,opening:.46,height:.44});
      plasterBox(r.x+r.w/2-.055,r.f+r.h/2,r.z,.11,r.h,r.d,true);cornice(r,true,1);
      residenceDetails.push({kind:'sealed east upper side',room:r.name,windowRemoved:true,continuousPlaster:true});
      builder.add(new THREE.ExtrudeGeometry(upperFloorShape(),{depth:.050,steps:1,bevelEnabled:false}),INTERIOR_FINISH.ceiling,[0,r.f-.065,0],[-Math.PI/2,0,0],[1,1,1],SURFACE.PLASTER,0);
      finishExteriorSlabEdges(builder.parts.at(-1));
      finishCeilingUnderside(builder.parts.at(-1));
      const low=1.460,high=r.f-.015;
      plasterBox(r.x,(low+high)/2,-1.405,r.w,high-low,.11);
      plasterBox((upperConnection.end+1.28)/2,(low+high)/2,-.715,1.28-upperConnection.end,high-low,.11);
      plasterBox(r.x+r.w/2-.055,(low+high)/2,r.z,.11,high-low,r.d);
      residenceDetails.push({kind:'east upper living room shell',footprint:{left:-.22,right:1.28,back:-1.46,front:-.66},level:r.f,lowerHallHeight:1.08,posts:0,solidRear:true,connected:true,stairNotch:{left:-.22,right:upperConnection.end,back:upperConnection.z-upperConnection.width/2,front:-.66}});
    }else{
      frontFacade({...r,x:-.79,w:1.14},.70);cornice({...r,x:-.79,w:1.14});
      plasterBox(r.x-r.w/2+.050,r.f+r.h/2,r.z,.10,r.h,r.d);
      // The single library slab already includes its closed mineral soffit.
      // The upper foyer is a circulation space, with no bench at the stair arrival.
      // The landing bookcase is coordinated with the new clear circulation strip.
      residenceDetails.push({kind:'clear upper foyer',landing:{left:-2.00,right:-1.72,back:-1.31,front:-.98},gallery:{left:-1.85,right:-.826,back:-.985,front:-.710},continuous:true});
      // Upper west wall uses the same mineral plaster as the lower wall.
    }
    // A shared corner return can face the adjacent upper room.
    if(r.upper)for(const room of residenceRooms.filter(room=>room.upper))finishUpperWalls(upperWallStart,builder.parts.length,room);
    refinedInterior(r);
    furnishResidence(r);
    if(r.roof&&r.role!=='bedroom'&&r.role!=='salon'&&!r.upper)residenceRoof(r);
    if(!r.upper&&r.role!=='entry'&&r.role!=='library')builder.add(new THREE.BoxGeometry(r.w*.59,.013,.013),INTERIOR_FINISH.lampPanel,[r.x,r.f+r.h-.090,front-.126],[0,0,0],[1,1,1],SURFACE.CEILING_LIGHT,0,true);

    reserve(r.x,r.z,r.w/2,r.d/2,r.f-.05,r.f+r.h+.03,r.name);
    // Narrow bronze rainwater leaders meet the ground against a solid corner.
    if(r.roof&&r.role!=='bedroom'&&r.role!=='salon'&&!r.upper){const x=r.x+r.w/2-.027,y=r.f+r.h-.06;
      builder.box(x,(y+r.f)/2,front+.035,.022,y-r.f,.027,RES.fascia,SURFACE.METAL);
      tube([[x,r.frontGutter.y,r.frontGutter.z],[x,r.frontGutter.y-.045,front+.12],[x,y,front+.035]],.010,RES.fascia,SURFACE.METAL);
      for(const h of [r.f+.10,y-.09])builder.box(x,h,front+.052,.035,.014,.012,RES.bronze,SURFACE.METAL);
    }
  }
  // Mouldings are emitted as closed envelopes after the complete shell.
  const upperRoofPartStart=builder.parts.length;
  joinedUpperRoof();
  for(const r of residenceRooms.filter(r=>r.upper))finishUpperWalls(upperRoofPartStart,builder.parts.length,r,true);
  {
  // Three wall-to-wall oak treads; the existing library slab is the level approach.
  const {start:linkStart,end:linkEnd,z:linkZ,width:linkWidth,base:linkBase,top:linkTop,steps:linkSteps}=upperConnection;
  const linkRun=(linkEnd-linkStart)/linkSteps,linkRise=(linkTop-linkBase)/linkSteps;
  const profile=new THREE.Shape();profile.moveTo(linkStart,linkBase);
  for(let k=0;k<linkSteps;k++){const x=linkStart+k*linkRun,top=linkBase+(k+1)*linkRise;profile.lineTo(x,top-.012);profile.lineTo(x+linkRun,top-.012);}
  profile.lineTo(linkEnd,1.550);profile.lineTo(-.220,1.460);profile.lineTo(-.220,linkBase);profile.closePath();
  // The stair bridge retains 1.350 over the existing stair cut; its east underside
  // rises above 1.460 to preserve the lower salon ceiling and walking headroom.
  builder.add(new THREE.ExtrudeGeometry(profile,{depth:linkWidth,steps:1,bevelEnabled:false}),UPPER.oak,[0,0,linkZ-linkWidth/2],[0,0,0],[1,1,1],SURFACE.UPPER_OAK,0);
  for(let k=0;k<linkSteps;k++){
    const x=linkStart+(k+.5)*linkRun,top=linkBase+(k+1)*linkRise;
    builder.box(x,top-.006,linkZ,linkRun,.012,linkWidth,UPPER.oakLight,SURFACE.UPPER_OAK,0);
    builder.box(x-linkRun/2+.004,top-.004,linkZ,.008,.008,linkWidth-.008,UPPER.oak,SURFACE.UPPER_OAK,0);
  }
  // Both short-flight sides meet existing walls; no short-flight handrail.
  const ceilingP=[];for(const [x,z] of [[linkStart,linkZ-linkWidth/2],[linkEnd,linkZ-linkWidth/2],[linkStart,linkZ+linkWidth/2],[linkEnd,linkZ+linkWidth/2]])ceilingP.push(x,1.905+.230*clamp((x-linkStart)/(linkEnd-linkStart),0,1),z);
  const ceilingG=new THREE.BufferGeometry();ceilingG.setAttribute('position',new THREE.Float32BufferAttribute(ceilingP,3));ceilingG.setIndex([0,1,2,1,3,2]);ceilingG.computeVertexNormals();builder.add(ceilingG,INTERIOR_FINISH.ceiling,[0,0,0],[0,0,0],[1,1,1],SURFACE.CEILING,0);
  residenceDetails.push({kind:'east upper internal connection',steps:linkSteps,start:linkStart,end:linkEnd,z:linkZ,width:linkWidth,base:linkBase,top:linkTop,continuous:true,material:'oak',rise:linkRise,run:linkRun,handrail:false,sideWalls:true,approach:{left:-.720,right:linkStart,back:linkZ-linkWidth/2,front:linkZ+linkWidth/2,top:linkBase},bridgeUnderside:linkBase,slabNotch:true,foyerRoute:[[-1.815,-1.200],[-1.815,-.865],[-.850,-.865],[.390,-.895],[.800,-.824]]});
  // The main hall keeps its full height under a closed, shallow sloped eave.
  const canopyLeft=-.22,canopyRight=1.315,canopyBack=-.660,canopyFront=-.235,canopyY=z=>1.580-.081*clamp((z-canopyBack)/(canopyFront-canopyBack),0,1);
  const canopyP=[],canopyI=[];for(let k=0;k<=24;k++){const z=mix(canopyBack,canopyFront,k/24);canopyP.push(canopyLeft,canopyY(z),z,canopyRight,canopyY(z),z);if(k){const i=(k-1)*2;canopyI.push(i,i+2,i+1,i+1,i+2,i+3)}}
  const canopyG=new THREE.BufferGeometry();canopyG.setAttribute('position',new THREE.Float32BufferAttribute(canopyP,3));canopyG.setIndex(canopyI);canopyG.computeVertexNormals();builder.add(canopyG,RES.roof,[0,0,0],[0,0,0],[1,1,1],SURFACE.ROOF,topSnow);
  const canopyUnder=canopyG.clone(),reverse=Array.from(canopyUnder.index.array);for(let k=0;k<reverse.length;k+=3)[reverse[k+1],reverse[k+2]]=[reverse[k+2],reverse[k+1]];canopyUnder.setIndex(reverse);canopyUnder.translate(0,-.042,0);canopyUnder.computeVertexNormals();builder.add(canopyUnder,'#aebdc0',[0,0,0],[0,0,0],[1,1,1],SURFACE.UNDERSIDE,0);
  for(const x of [canopyLeft+.060,canopyRight]){const shape=new THREE.Shape();shape.moveTo(canopyBack,1.450);shape.lineTo(canopyFront,1.450);for(let i=24;i>=0;i--){const z=mix(canopyBack,canopyFront,i/24);shape.lineTo(z,canopyY(z)-.035)}shape.closePath();builder.add(new THREE.ExtrudeGeometry(shape,{depth:.060,steps:1,bevelEnabled:false}),RES.wall,[x,0,0],[0,-Math.PI/2,0],[1,1,1],SURFACE.PLASTER,0)}
  plasterBox(.53,(1.460+canopyY(-.42)-.040)/2,-.465,1.50,canopyY(-.42)-.040-1.460,.09);
  builder.box((canopyLeft+canopyRight)/2,canopyY(canopyFront)-.021,canopyFront,canopyRight-canopyLeft,.042,.024,RES.fascia,SURFACE.ROOF,0);
  builder.box((canopyLeft+canopyRight)/2,canopyY(canopyFront)-.012,canopyFront+.016,canopyRight-canopyLeft+.014,.015,.019,RES.fascia,SURFACE.METAL,0);
  for(const z of [-.54,-.42,-.30])tube([[canopyLeft,canopyY(z)+.003,z],[canopyRight,canopyY(z)+.003,z]],.004,RES.fascia,SURFACE.ROOF,0);
  for(let x=canopyLeft+.065;x<canopyRight;x+=.105)builder.beam([x,canopyY(-.40)-.061,-.40],[x,canopyY(-.26)-.061,-.26],.010,RES.walnut,SURFACE.UNDERSIDE);
  reserve(.55,-.45,.79,.23,1.45,1.64,'closed main hall eave');
  roofAudit.push({name:'主厅前侧深檐',form:'shallow sloped eave',eave:1.499,peak:1.580,wallTop:1.460,width:1.535,depth:.425,fascia:.042,overhang:.185});
  }
  plasterBox(1.285,.795,-.94,.035,.83,.98,true);
  residenceDetails.push({kind:'sealed party-wall junction',gapClosed:.010});
  // Open-air loggias and three different court levels form a continuous route.
  paving(.06,-.255,2.60,.330,.376);
  // Two bank-side threshold strips leave the planted spring intake open.
  paving(-1.04,-.054,.40,.062,.376);
  paving(.355,-.054,2.01,.062,.376);
  paving(-1.135,.275,.25,.87,.339,true);
  paving(.905,.49,.75,.40,.345);
  // The west floor continues directly into the reading room.
  paving(1.64,.485,.73,.28,.406);
  // A shallow cantilevered terrace is carried by the entrance arcade spandrel,
  // library slab and solid end-wall returns. No posts stand in front of the glazing.
  // The main terrace retracts 25 percent in depth; its open side arm stays clear of glazing.
  const balcony={left:-1.28,right:-.22,back:-.715,turnZ:-.205,front:.60,turnX:-.955,level:1.335,slab:.090};
  const balconyDepth=balcony.turnZ-balcony.back,balconyCentreZ=(balcony.back+balcony.turnZ)/2;
  const balconyOutline=[[balcony.left,balcony.back],[balcony.right,balcony.back],[balcony.right,balcony.turnZ],[balcony.turnX,balcony.turnZ],[balcony.turnX,balcony.front],[balcony.left,balcony.front]];
  const balconyShape=new THREE.Shape();balconyOutline.forEach(([x,z],i)=>i?balconyShape.lineTo(x,-z):balconyShape.moveTo(x,-z));balconyShape.closePath();
  const balconySlab=new THREE.ExtrudeGeometry(balconyShape,{depth:balcony.slab,steps:1,bevelEnabled:false});balconySlab.rotateX(-Math.PI/2);
  builder.add(balconySlab,RES.wall,[0,balcony.level-balcony.slab,0],[0,0,0],[1,1,1],SURFACE.PLASTER,0);
  // Tag only the balcony's underside; the existing room mask limits its neutral finish to the interior.
  const balconySoffitPart=builder.parts.at(-1),balconySoffitNormals=balconySoffitPart.attributes.normal;
  for(let i=0;i<balconySoffitNormals.count;i++)if(balconySoffitNormals.getY(i)<-.99)balconySoffitPart.attributes.surfaceType.setX(i,SURFACE.BALCONY_SOFFIT);
  const balconyFinish=new THREE.ShapeGeometry(balconyShape);balconyFinish.rotateX(-Math.PI/2);
  builder.add(balconyFinish,RES.paving,[0,balcony.level+.006,0],[0,0,0],[1,1,1],SURFACE.PAVING,topSnow);
  // Substantial soffit and a recessed bronze drip line finish the full outer corner.
  const exposedEdges=[[[balcony.right,balcony.back],[balcony.right,balcony.turnZ]],[[balcony.right,balcony.turnZ],[balcony.turnX,balcony.turnZ]],[[balcony.turnX,balcony.turnZ],[balcony.turnX,balcony.front]],[[balcony.turnX,balcony.front],[balcony.left,balcony.front]]];
  for(const [a,b]of exposedEdges)builder.beam([a[0],balcony.level-.071,a[1]],[b[0],balcony.level-.071,b[1]],.010,RES.bronze,SURFACE.METAL,0);
  // Fine joints are shallow cuts; none sit coplanar with the walking surface.
  for(const x of [-1.07,-.78,-.49])builder.box(x,balcony.level+.007,balconyCentreZ,.004,.002,balconyDepth-.050,'#a09a8a',SURFACE.PAVING,0);
  for(const z of [.19,.415])builder.box(-1.12,balcony.level+.007,z,.285,.002,.004,'#a09a8a',SURFACE.PAVING,0);
  for(const x of [-1.3125,-.2675])plasterBox(x,.8415,-.3975,.085,.923,.165);
  const guardLow=balcony.level+.034,guardHigh=balcony.level+.190,balconyGuardSegments=[],balconyStiles=new Set();
  function balconyGuard(a,b){
    const len=Math.hypot(b[0]-a[0],b[1]-a[1]),count=Math.max(2,Math.ceil(len/.145));
    builder.beam([a[0],guardLow,a[1]],[b[0],guardLow,b[1]],.012,RES.bronze,SURFACE.METAL,0);
    builder.beam([a[0],guardHigh,a[1]],[b[0],guardHigh,b[1]],.0085,RES.bronze,SURFACE.METAL);
    for(let i=0;i<=count;i++){const x=mix(a[0],b[0],i/count),z=mix(a[1],b[1],i/count),key=x.toFixed(5)+','+z.toFixed(5);if(balconyStiles.has(key))continue;balconyStiles.add(key);const foot=balcony.level+.006;builder.box(x,(foot-.004+guardHigh)/2,z,.010,guardHigh-foot+.004,.010,RES.bronze,SURFACE.METAL,0);builder.box(x,foot-.001,z,.024,.006,.024,RES.bronze,SURFACE.METAL,0);residenceDetails.push({kind:'anchored railing post',name:'L型阳台',x,z,foot,top:guardHigh,plate:.024,embedded:.004});}
    balconyGuardSegments.push({a,b});
  }
  balconyGuard([-.243,-.67],[-.243,balcony.turnZ-.015]);
  balconyGuard([-.243,balcony.turnZ-.015],[balcony.turnX-.017,balcony.turnZ-.015]);
  balconyGuard([balcony.turnX-.017,balcony.turnZ-.015],[balcony.turnX-.017,balcony.front-.018]);
  balconyGuard([balcony.turnX-.017,balcony.front-.018],[balcony.left+.023,balcony.front-.018]);
  residenceDetails.push({kind:'open bronze balcony guard',solidPanel:false,openness:.91,clearWindowViews:true,handrail:RES.walnut,spindleWidth:.010,shape:'L',segments:balconyGuardSegments,turnBetweenSideWindows:false,sideWindowClearance:.325,railEndsAwayFromWindowWall:true});
  residenceDetails.push({kind:'L-shaped balcony',outline:balconyOutline,area:(balcony.right-balcony.left)*balconyDepth+(balcony.turnX-balcony.left)*(balcony.front-balcony.turnZ),mainDepth:balconyDepth,previousMainDepth:.68,retraction:.170,level:balcony.level,windowBayGap:[-.135,.115],turnZ:balcony.turnZ,sideEndBeyondWindow:.085,posts:0});
  // Existing end returns carry the balcony; shallow relief faces the court, away from glass.
  for(const x of [-1.3125,-.2675]){
    builder.box(x,.840,-.311,.072,.740,.012,RES.relief,SURFACE.PLASTER,0);
    for(const dx of [-.022,0,.022])builder.box(x+dx,.833,-.303,.008,.670,.007,RES.wall,SURFACE.PLASTER,0);
    builder.box(x,.419,-.305,.096,.035,.029,RES.relief,SURFACE.STONE,0);
    builder.box(x,1.245,-.305,.101,.027,.030,RES.relief,SURFACE.STONE,0);
    residenceDetails.push({kind:'balcony pier relief',x,depth:.007,flutes:3,colour:RES.relief,glazingClear:true});
  }
  // Open balcony: no seating in front of the upper-room windows.
  reserve(-.75,balconyCentreZ,.55,balconyDepth/2+.020,1.23,1.65,'open upper courtyard');
  reserve(-1.1175,(balcony.turnZ+balcony.front)/2,.18,(balcony.front-balcony.turnZ)/2+.020,1.23,1.65,'side balcony');
  designChecks.floorJunctions.push({name:'continuous cantilever balcony slab',x:-.75,z:balconyCentreZ,top:1.335,slab:.09,shape:'L'});
  residenceDetails.push({kind:'cantilever balcony',posts:0,clearGlazing:true,support:'entrance arcade spandrel and library slab',lateralSeal:true,slab:.09,shape:'L'});
  residenceCourts.push({name:'L型退台露庭',x:-.75,z:balconyCentreZ,width:1.06,depth:balconyDepth,level:1.335,supportedBy:'entrance arcade and library slab',plants:0});
  residenceCourts.push({name:'东侧茶庭',x:1.64,z:.485,width:.73,depth:.28,level:.406,supportedBy:'grounded foundation'});
  // Solid landing steps join the bedroom and tea terrace to the lower moss court.
  for(const [x,startZ,width,top] of [[1.64,.665,.50,.383]])for(let k=0;k<3;k++){
    const z=startZ+k*.071,y=top-k*.022,bed=terrainHeight(x,z)-.037;
    builder.box(x,(y+bed)/2,z,width,y-bed,.079,RES.paving,SURFACE.PAVING,topSnow);
  }
  // Walnut garden bench, exposed joinery and thin woven seat; it faces the sea.
  vintageBench(.943,.49,.345+.011,.31,.14);
  builder.cyl(.666,.410,.49,.071,.071,.024,RES.paving,SURFACE.STONE,0,24);builder.cyl(.666,.373,.49,.019,.031,.050,RES.walnut,SURFACE.WOOD,0,16);
  residenceDetails.push({kind:'terrace lounge',facing:'front sea',direction:[0,0,1]});
  residenceDetails.push({kind:'inhabited interiors',rooms:5,features:['mineral arcades and continuous stone walls','linen salon','tea salon','library','open upper court','aged bronze joinery']});
  const upperBandPartStart=builder.parts.length;
  completeResidenceBands();
  for(const r of residenceRooms.filter(r=>r.upper))finishUpperWalls(upperBandPartStart,builder.parts.length,r,true);
  designChecks.upperInterior={style:'elegant luxury',palette:{wall:UPPER.wall,...LUXE},roomFunctions:['clear stair foyer','craft library and window desk','tea niche and living music room'],cabinetInteriorArtwork:0,tatami:0,floorCushions:0,furniture:upperFurniture,connection:{...upperConnection,rise:(upperConnection.top-upperConnection.base)/upperConnection.steps,run:(upperConnection.end-upperConnection.start)/upperConnection.steps},coordinates:'unscaled residence',frontAisle:{left:.28,right:1.08,back:-.995,front:-.778},gallery:{left:-1.85,right:-.72,back:-.936,front:-.71},lowerRoomsPreserved:true};
  const residenceScale=finishBuildingScale(residenceScaleMark);
  const nordicGlassMaterial=new THREE.MeshPhysicalMaterial({color:'#dbd1bf',roughness:.25,metalness:.04,clearcoat:.40,clearcoatRoughness:.20,transparent:true,opacity:.33,depthWrite:false,side:THREE.DoubleSide});
  for(const g of nordicGlassParts){g.applyMatrix4(residenceScale.m);const pane=new THREE.Mesh(g,nordicGlassMaterial);pane.renderOrder=2;pane.name='furniture reeded glass';pane.frustumCulled=false;scene.add(pane);}

  if(hearthSpec){hearthSpec.x=residenceScale.px(hearthSpec.x);hearthSpec.y=residenceScale.py(hearthSpec.y);hearthSpec.z=residenceScale.pz(hearthSpec.z);for(const k of ['width','height','depth'])hearthSpec[k]*=BUILDING_SCALE;designChecks.hearth=hearthSpec;}
  for(const r of residenceRooms){r.x=residenceScale.px(r.x);r.z=residenceScale.pz(r.z);r.f=residenceScale.py(r.f);r.w*=BUILDING_SCALE;r.d*=BUILDING_SCALE;r.h*=BUILDING_SCALE;if(r.rise)r.rise*=BUILDING_SCALE}
  for(const c of residenceCourts){c.x=residenceScale.px(c.x);c.z=residenceScale.pz(c.z);c.level=residenceScale.py(c.level);c.width*=BUILDING_SCALE;c.depth*=BUILDING_SCALE}
  designChecks.stairwell={floor:residenceScale.py(houseStair.upper),lower:residenceScale.py(houseStair.lower),mid:residenceScale.py(houseStair.mid),width:houseStair.width*BUILDING_SCALE,run:houseStair.flights.reduce((n,f)=>n+f.run,0)*BUILDING_SCALE,open:true,steps:20,form:'entrance-facing curved single-turn',curveSpec:houseStair.curveSpec,turn:90,heteromorphicTurnTreads:true,turnWidthRange:[houseStair.width*.84*BUILDING_SCALE,houseStair.width*BUILDING_SCALE],flights:houseStair.flights.map(f=>({start:[residenceScale.px(f.startX),residenceScale.pz(f.startZ)],end:[residenceScale.px(f.endX),residenceScale.pz(f.endZ)],base:residenceScale.py(f.base),top:residenceScale.py(f.top),steps:f.steps,run:f.run*BUILDING_SCALE,slope:Math.atan2(f.top-f.base,f.run)*180/Math.PI})),opening:houseStair.opening.map(([x,z])=>[residenceScale.px(x),residenceScale.pz(z)]),openingStyle:'trimmed upper-flight envelope with headroom retained',refinement:houseStair.openingRefinement,guard:residenceDetails.find(p=>p.kind==='closed upper stairwell guard'),approach:'entrance arch axis',landing:{left:residenceScale.px(-2.00),right:residenceScale.px(-1.72),back:residenceScale.pz(-1.31),front:residenceScale.pz(-.98),top:residenceScale.py(1.35)},galleryClearDepth:.265*BUILDING_SCALE,continuousHandrail:true};
  {const p=residenceDetails.find(p=>p.kind==='open stair-to-salon portal');designChecks.stairToSalon={x:residenceScale.px(p.x),back:residenceScale.pz(p.back),front:residenceScale.pz(p.front),floor:residenceScale.py(p.bottom),spring:residenceScale.py(p.spring),crown:residenceScale.py(p.spring+p.rise),width:p.width*BUILDING_SCALE,depth:p.depth*BUILDING_SCALE,open:true,levelThreshold:true,cleanRearWall:true,removedFurniture:['stair cabinet and cushion','applied stair wall panels','salon west cabinet','salon west accent chair']};}
  designChecks.mountain={heightFactor:MOUNTAIN_HEIGHT_FACTOR,peak:heights.reduce((a,b)=>Math.max(a,b),-Infinity),springSourceLevel:springNodes[0][2],pagodaPlatformPreserved:true};
  if(typeof warmLights!=='undefined'){warmLights[0].position.set(-.79,1.09,-.68);warmLights[1].position.set(.53,1.09,-.55);for(const l of warmLights.slice(0,2))l.position.applyMatrix4(residenceScale.m)}
  // The house grows through useful outdoor rooms; every existing room keeps its size.
  const coreFootprints=designChecks.foundations.filter(f=>f.x!==undefined).map(f=>({x:f.x,z:f.z,width:f.width,depth:f.depth}));
  const annexStart=designChecks.foundations.length;
  // Two legible rooms: bedroom, narrow covered threshold, lower reading pavilion.
  const bedroom=residenceRooms.find(r=>r.role==='bedroom'),joinZ=bedroom.z+bedroom.d/2;
  const readingPavilion={name:'庭院阅亭',x:bedroom.x,z:1.20,w:.684,d:.64,f:bedroom.f,h:.61,roof:true,role:'reading',rise:.205,ridge:.06,leftOH:.10,rightOH:.075,foreOH:.11,backOH:.05,roofForm:'hip',roofAxis:'z'};
  paving(bedroom.x,1.24,.90,.79,.295);
  foundation(readingPavilion.name,readingPavilion.x,readingPavilion.z,readingPavilion.w,readingPavilion.d,readingPavilion.f);
  interiorFloor(new THREE.BoxGeometry(readingPavilion.w,.030,readingPavilion.d),[readingPavilion.x,readingPavilion.f,readingPavilion.z]);
  const linkBack=joinZ,linkFront=readingPavilion.z-readingPavilion.d/2,linkZ=(linkBack+linkFront)/2,linkW=.36;
  foundation('阅亭过渡廊',bedroom.x,linkZ,linkW,linkFront-linkBack,bedroom.f);
  interiorFloor(new THREE.BoxGeometry(linkW,.03,linkFront-linkBack+.014),[bedroom.x,bedroom.f,linkZ]);
  for(const s of [-1,1]){const x=bedroom.x+s*(linkW/2-.02);plasterBox(x,.633,linkZ,.04,.605,linkFront-linkBack);builder.box(x,.938,linkZ,.04,.025,linkFront-linkBack+.03,RES.walnut,SURFACE.WOOD)}
  builder.box(bedroom.x,.951,linkZ,linkW+.045,.04,linkFront-linkBack+.055,RES.fascia,SURFACE.ROOF,topSnow);
  builder.box(bedroom.x,.926,linkZ,linkW+.01,.01,linkFront-linkBack+.05,RES.walnut,SURFACE.UNDERSIDE,0);
  // A framed rear portal makes the spatial break readable without a floor gap.
  for(const s of [-1,1])plasterBox(bedroom.x+s*(readingPavilion.w+linkW)/4,readingPavilion.f+readingPavilion.h/2,linkFront+.022,(readingPavilion.w-linkW)/2,readingPavilion.h,.045);
  plasterBox(bedroom.x,readingPavilion.f+readingPavilion.h-.025,linkFront+.022,linkW,.05,.045);
  plasterBox(bedroom.x-bedroom.w/2+.0495,readingPavilion.f+readingPavilion.h/2,readingPavilion.z,.099,readingPavilion.h,readingPavilion.d,true);
  archFacade(readingPavilion,{count:1,opening:.49,height:.51});
  archFacade(readingPavilion,{side:true,out:1,count:2,opening:.25,height:.50});
  residenceRoof(readingPavilion);
  const readPlan=[[readingPavilion.x-readingPavilion.w/2,.88],[readingPavilion.x+readingPavilion.w/2,.88],[readingPavilion.x+readingPavilion.w/2,1.52],[readingPavilion.x-readingPavilion.w/2,1.52]];
  closedBand('阅庭完整檐下线',readPlan,readingPavilion.f+readingPavilion.h,[[-.037,.021,.037,RES.wall],[-.010,.025,.052,RES.wall]]);
  closedBand('阅庭完整基座线',readPlan,readingPavilion.f-.025,[[0,.016,.018,RES.paving,SURFACE.PAVING]]);
  const readFloor=readingPavilion.f,readWest=readingPavilion.x-readingPavilion.w/2+.099;
  const readingFurnitureStart=builder.parts.length;
  // Rear book alcove occupies the solid west wall, clear of the central rear portal.
  const readingBookcaseStart=builder.parts.length;
  const bookDepth=.150,bookBack=readingPavilion.z-readingPavilion.d/2+.045;
  const bookX=readWest+.043,bookZ=bookBack+bookDepth/2;
  builder.box(readWest+.012,readFloor+.253,bookZ,.018,.475,bookDepth-.010,RES.walnut,SURFACE.WOOD,0);
  for(const z of [bookZ-(bookDepth-.014)/2,bookZ+(bookDepth-.014)/2])builder.box(bookX,readFloor+.253,z,.071,.475,.014,RES.walnut,SURFACE.WOOD,0);
  for(const y of [.025,.112,.237,.362,.485])builder.box(bookX,readFloor+y,bookZ,.078,.012,bookDepth,RES.walnut,SURFACE.WOOD,0);
  builder.box(readWest+.080,readFloor+.070,bookZ,.012,.072,bookDepth-.017,RES.walnut,SURFACE.WOOD,0);
  builder.box(readWest+.089,readFloor+.073,bookZ,.005,.010,.045,RES.bronze,SURFACE.METAL,0);
  let readBooks=0;
  for(const shelf of [.243,.368])for(let i=0;i<5;i++){
    const z=bookZ-.048+i*.024,height=.063+(i%3)*.014;
    const cover=['#756e5c','#8c8b74','#aaa189'][i%3];
    builder.box(readWest+.052,readFloor+shelf+height/2,z,.049,height-.008,.015,'#d4c8b2',SURFACE.PLASTER,0);
    for(const dz of [-.010,.010])builder.box(readWest+.052,readFloor+shelf+height/2,z+dz,.057,height,.004,cover,SURFACE.WOOD,0);
    builder.box(readWest+.082,readFloor+shelf+height/2,z,.008,height,.024,cover,SURFACE.WOOD,0);
    builder.box(readWest+.087,readFloor+shelf+height*.68,z,.003,.004,.012,'#c0ac7a',SURFACE.METAL,0);readBooks++;
  }
  const readingBookcaseEnd=builder.parts.length;
  const readBookcaseBounds=new THREE.Box3();for(const g of builder.parts.slice(readingBookcaseStart,readingBookcaseEnd)){g.computeBoundingBox();readBookcaseBounds.union(g.boundingBox);}
  // Fit the seat between the real cabinet envelope and the thick front arcade.
  const readFrontInner=readingPavilion.z+readingPavilion.d/2-.11;
  const readSeatBack=readBookcaseBounds.max.z+.040,readSeatFront=readFrontInner-.024;
  const readBench={x:readingPavilion.x-.155,z:(readSeatBack+readSeatFront)/2,width:Math.min(.27,readSeatFront-readSeatBack-.011),depth:.145};
  const readingBenchStart=builder.parts.length;
  vintageBench(readBench.x,readBench.z,readFloor+.016,readBench.width,readBench.depth,Math.PI/2);
  // Woven upholstery and a framed ink landscape make the seating bay quiet and complete.
  softBlock(readBench.x+.008,readFloor+.123,readBench.z,.105,.013,readBench.width-.054,'#b8ac94');
  softBlock(readBench.x-.060,readFloor+.168,readBench.z,.015,.092,readBench.width-.086,'#b4b29b');
  const readingBenchEnd=builder.parts.length;
  const readBenchBounds=new THREE.Box3();for(const g of builder.parts.slice(readingBenchStart,readingBenchEnd)){g.computeBoundingBox();readBenchBounds.union(g.boundingBox);}
  // Fit the entire artwork between the bookcase and the thick front arcade.
  // Glass sits inside the wall reveal and is not the usable wall's boundary.
  const readingBookcaseFront=Math.max(...builder.parts.slice(readingBookcaseStart,readingBookcaseEnd).map(g=>{g.computeBoundingBox();return g.boundingBox.max.z}));
  const readArtMin=readingBookcaseFront+.022,readArtMax=readingPavilion.z+readingPavilion.d/2-.11-.022;
  const readArtZ=(readArtMin+readArtMax)/2,readArtCeiling=.949-.024/2-.026;
  const readArtScale=Math.min(1,(readArtMax-readArtMin)/.243,(readArtCeiling-readFloor-.476)/(.223/2));
  const readArtStart=builder.parts.length,readArtGlowStart=builder.glows.length;
  builder.box(readWest+.012,readFloor+.427,readArtZ,.017,.223*readArtScale,.243*readArtScale,RES.walnut,SURFACE.WOOD,0);
  builder.box(readWest+.024,readFloor+.427,readArtZ,.006,.199*readArtScale,.219*readArtScale,'#d1c6ad',SURFACE.PLASTER,0);
  for(const points of [[[1.222,.399],[1.269,.446],[1.316,.418],[1.353,.438],[1.407,.398]],[[1.228,.375],[1.294,.386],[1.346,.380],[1.402,.373]]]){
    const curve=new THREE.CatmullRomCurve3(points.map(([z,y])=>new THREE.Vector3(readWest+.029,readFloor+.427+(y-.427)*readArtScale,readArtZ+(z-1.315)*readArtScale))),p=[],idx=[];
    for(let i=0;i<=32;i++){const t=i/32,q=curve.getPoint(t),v=curve.getTangent(t),width=(.0011+.0007*Math.sin(t*Math.PI))*readArtScale;p.push(q.x,q.y-v.z*width,q.z+v.y*width,q.x,q.y+v.z*width,q.z-v.y*width);if(i<32){const a=i*2;idx.push(a,a+1,a+2,a+1,a+3,a+2);}}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex(idx);g.computeVertexNormals();builder.add(g,'#777e6a',[0,0,0],[0,0,0],[1,1,1],SURFACE.PLASTER,0);
  }
  const readPictureY=readFloor+.427+.223*readArtScale/2+.0275;
  builder.box(readWest+.037,readPictureY+.014,readArtZ,.035,.014,.170*readArtScale,RES.bronze,SURFACE.METAL,0);
  builder.add(new THREE.BoxGeometry(.016,.009,.15*readArtScale),INTERIOR_FINISH.lampPanel,[readWest+.049,readPictureY+.006,readArtZ],[0,0,0],[1,1,1],SURFACE.CEILING_LIGHT,0,true);
  // A proper wall plate and two short arms support the picture light.
  builder.box(readWest+.004,readPictureY,readArtZ,.008,.039,.045,RES.bronze,SURFACE.METAL,0);
  for(const dz of [-.05,.05])builder.box(readWest+.022,readPictureY+.007,readArtZ+dz*readArtScale,.032,.007,.008,RES.bronze,SURFACE.METAL,0);
  for(const dz of [-.09,.09])builder.box(readWest+.042,readPictureY+.013,readArtZ+dz*readArtScale,.032,.017,.010,RES.walnut,SURFACE.WOOD,0);
  interiorFixtures.push({type:'picture',name:'阅庭古铜画灯',mount:[readWest,readPictureY,readArtZ],washCentre:[readWest,readFloor+.427+.053*readArtScale,readArtZ],centre:[readWest+.049,readPictureY+.006,readArtZ],normal:[1,0,0],spread:.105*readArtScale,wallPlate:true,shortArm:true});
  const readArtBounds=new THREE.Box3();for(const g of [...builder.parts.slice(readArtStart),...builder.glows.slice(readArtGlowStart)]){g.computeBoundingBox();readArtBounds.union(g.boundingBox)}
  designChecks.readingArtwork={scale:readArtScale,centreZ:readArtZ,bounds:{min:readArtBounds.min.toArray(),max:readArtBounds.max.toArray()},bookcaseFront:readingBookcaseFront,frontWallInner:readArtMax+.022,clearance:{bookcase:readArtBounds.min.z-readingBookcaseFront,frontWall:readArtMax+.022-readArtBounds.max.z,picturePlateAboveFrame:.008},proportionsPreserved:true};
  residenceDetails.push({kind:'furnished reading pavilion',books:readBooks,features:['walnut book alcove','woven reading bench','framed ink textile','bronze wall wash','ceramic tea service'],rearPortalClear:true,floor:readFloor,westWall:readWest});
  const readTable={x:readBenchBounds.max.x+.040+.054,z:readBench.z,radius:.054,top:readFloor+.098,floor:readFloor+.018};
  const readingTableStart=builder.parts.length;
  builder.cyl(readTable.x,readTable.top-.010,readTable.z,readTable.radius,readTable.radius,.020,RES.paving,SURFACE.PAVING,0,20);
  const readPedestalTop=readTable.top-.018;
  builder.cyl(readTable.x,(readTable.floor+readPedestalTop)/2,readTable.z,.021,.030,readPedestalTop-readTable.floor,RES.walnut,SURFACE.WOOD,0);
  // All tea pieces are placed from their supporting surface, not independent world heights.
  const readTrayTop=readTable.top+.006;
  builder.cyl(readTable.x,readTable.top+.003,readTable.z,.037,.037,.006,RES.walnut,SURFACE.WOOD,0,20);
  builder.add(new THREE.SphereGeometry(.012,16,10),'#aaa58e',[readTable.x-.007,readTrayTop+.0102,readTable.z+.001],[0,0,0],[1,.85,1],SURFACE.STONE,0);
  builder.cyl(readTable.x-.007,readTrayTop+.022,readTable.z+.001,.005,.007,.004,RES.bronze,SURFACE.METAL,0,12);
  for(const dz of [-.025,.026]){builder.cyl(readTable.x+.012,readTrayTop+.006,readTable.z+dz,.007,.007,.012,'#ccc1a5',SURFACE.STONE,0,12);builder.cyl(readTable.x+.012,readTrayTop+.0125,readTable.z+dz,.0045,.0045,.001,'#695a3e',SURFACE.STONE,0,12);}
  const readingTableEnd=builder.parts.length;
  const readTableBounds=new THREE.Box3();for(const g of builder.parts.slice(readingTableStart,readingTableEnd)){g.computeBoundingBox();readTableBounds.union(g.boundingBox);}
  builder.box(readingPavilion.x+.080,readFloor+.0165,readBench.z,.20,.003,.19,'#b5b19b',SURFACE.PLASTER,0);
  const readFurnitureBounds=new THREE.Box3();for(const g of builder.parts.slice(readingFurnitureStart)){g.computeBoundingBox();readFurnitureBounds.union(g.boundingBox);}
  const readFurnitureClearance={bookcase:readBenchBounds.min.z-readBookcaseBounds.max.z,frontWall:readFrontInner-readBenchBounds.max.z,sideTable:readTableBounds.min.x-readBenchBounds.max.x,eastGlass:readingPavilion.x+readingPavilion.w/2-.089-readTableBounds.max.x};
  designChecks.readingFurniture={bench:{...readBench,bounds:{min:readBenchBounds.min.toArray(),max:readBenchBounds.max.toArray()}},bookcase:{depth:bookDepth,bounds:{min:readBookcaseBounds.min.toArray(),max:readBookcaseBounds.max.toArray()}},table:{...readTable,bounds:{min:readTableBounds.min.toArray(),max:readTableBounds.max.toArray()}},clearance:readFurnitureClearance};
  residenceDetails.push({kind:'reading furniture clearance',bounds:{min:readFurnitureBounds.min.toArray(),max:readFurnitureBounds.max.toArray()},frontGlass:1.431,eastGlass:readingPavilion.x+readingPavilion.w/2-.089,benchFront:readBenchBounds.max.z,tableEast:readTableBounds.max.x,clearance:readFurnitureClearance,minimumClearance:Math.min(...Object.values(readFurnitureClearance))});
  // Shallow coffer borders sit below, never through, the roof soffit.
  builder.box(bedroom.x,.949,readingPavilion.z,bedroom.w-.15,.024,readingPavilion.d-.12,INTERIOR_FINISH.ceiling,SURFACE.CEILING,0);
  for(const x of [readingPavilion.x-.225,readingPavilion.x+.225])builder.box(x,.929,1.20,.019,.017,.48,RES.walnut,SURFACE.WOOD,0);
  for(const z of [.96,1.44])builder.box(readingPavilion.x,.929,z,.45,.017,.019,RES.walnut,SURFACE.WOOD,0);
  pendant('阅亭柔光吊灯',-1.48,1.18,.79,.937,.053);
  const readingThresholdTop=readFloor+.024;
  for(let k=0;k<3;k++){const z=1.565+k*.068,top=[.310,.295,.280][k],low=terrainHeight(bedroom.x,z)-.032;builder.box(bedroom.x,(top+low)/2,z,.52,top-low,.072,RES.paving,SURFACE.PAVING,topSnow);}
  residenceDetails.push({kind:'closed reading threshold',floorTop:readFloor+.015,sillTop:readingThresholdTop,sillDepth:.128,plinthClosed:true,steps:3,uniformRisers:.015,flatApproach:true});
  reserve(bedroom.x,readingPavilion.z,bedroom.w/2,readingPavilion.d/2,bedroom.f-.05,1.19,'separate reading pavilion');
  reserve(bedroom.x,linkZ,linkW/2,(linkFront-linkBack)/2,bedroom.f-.04,.98,'narrow reading vestibule');
  residenceDetails.push({kind:'connected distinct reading pavilion',joinZ,linkFront,linkZ,linkWidth:linkW,x:bedroom.x,width:bedroom.w,floor:bedroom.f,front:1.52,sharedRoof:false,internalOpening:.32});
  designChecks.upperExtension={shape:'L with east upper lounge',right:residenceScale.px(1.28),rightLevel:residenceScale.py(1.565),addedArea:1.5*.8*BUILDING_SCALE**2,connected:true,level:residenceScale.py(1.335),west:residenceScale.px(-2.04),front:residenceScale.pz(.64),readingBack:linkFront,readRoofSeparate:true};
  // The eastern outdoor room extends the tea terrace, without an isolated timber fence.
  paving(1.70,.95,.99,.73,.304);
  paving(1.476,.560,.65,.15,.338);
  // Clear central circulation from the tea steps to the court and shore.
  // Low planted margins replace the fence-like wall; seating uses the outer corner.
  builder.box(2.162,.365,1.08,.045,.18,.43,RES.wallShade,SURFACE.PLASTER);
  builder.box(2.163,.462,1.08,.063,.024,.46,RES.paving,SURFACE.PAVING,topSnow);
  // The former trellis-side seat is removed, leaving an open garden threshold.
  residenceDetails.push({kind:'east court redesign',clearRoute:{left:1.31,right:1.78,back:.57,front:1.32},seats:{x:1.995,z:1.135,width:0,depth:0,removed:true},gate:false,openEntry:true});
  const readingApron={left:-1.90,right:-1.055,back:1.635,front:1.815,top:.280};
  builder.box((readingApron.left+readingApron.right)/2,.256,(readingApron.back+readingApron.front)/2,readingApron.right-readingApron.left,.044,readingApron.front-readingApron.back,RES.wall,SURFACE.PLASTER,0);
  for(let i=0;i<4;i++){const w=(readingApron.right-readingApron.left)/4;builder.box(readingApron.left+(i+.5)*w,.276,(readingApron.back+readingApron.front)/2,w-.002,.008,readingApron.front-readingApron.back,RES.paving,SURFACE.PAVING,0);}
  residenceDetails.push({kind:'planar reading entrance apron',...readingApron,rockRemoved:true,material:'honed warm limestone',jointWidth:.002});
  // One continuous curved paved ribbon connects both courts; no missing stepping gaps.
  const gardenWalk=[],walkControls=courtWalkControls,walkCurve=new THREE.CatmullRomCurve3(walkControls.map(([x,z])=>new THREE.Vector3(x,0,z)));
  const wp=[],wi=[],walkCount=92,walkWidth=.205;
  for(let i=0;i<=walkCount;i++){
    const t=i/walkCount,p=walkCurve.getPoint(t),v=walkCurve.getTangent(t),nx=-v.z,nz=v.x;
    const pair=[];for(const side of [-1,1]){const x=p.x+nx*side*walkWidth/2,z=p.z+nz*side*walkWidth/2,y=terrainHeight(x,z);pair.push({x,z,y})}
    const grade=Math.max(...pair.map(p=>p.y))+.026,thresholdBlend=1-smooth(.22,.52,Math.hypot(p.x+1.035,p.z-1.51));const pathTop=mix(grade,.280,thresholdBlend);
    for(const q of pair)wp.push(q.x,pathTop,q.z,q.x,q.y-.028,q.z);
    gardenWalk.push({x:p.x,z:p.z,width:walkWidth,top:pathTop});
    if(i){const a=(i-1)*4,b=i*4;wi.push(a,b,a+2,a+2,b,b+2,a+1,a+3,b+1,a+3,b+3,b+1,a,a+1,b,a+1,b+1,b,a+2,b+2,a+3,a+3,b+2,b+3)}
  }
  wi.push(0,2,1,1,2,3);const end=walkCount*4;wi.push(end,end+1,end+2,end+1,end+3,end+2);
  for(let i=0;i<wi.length;i+=3)[wi[i+1],wi[i+2]]=[wi[i+2],wi[i+1]];
  const wg=new THREE.BufferGeometry();wg.setAttribute('position',new THREE.Float32BufferAttribute(wp,3));wg.setIndex(wi);wg.computeVertexNormals();builder.add(wg,RES.paving,[0,0,0],[0,0,0],[1,1,1],SURFACE.PAVING,topSnow);
  for(const p of gardenWalk)reserve(p.x,p.z,walkWidth*.55,walkWidth*.55,p.top-.06,p.top+.02,'continuous court walking route');
  residenceDetails.push({kind:'continuous garden route',width:walkWidth,ends:walkControls.filter((_,i)=>i===0||i===walkControls.length-1),continuous:true});
  const addedFootprints=designChecks.foundations.slice(annexStart).filter(f=>f.x!==undefined).map(f=>({x:f.x,z:f.z,width:f.width,depth:f.depth}));
  function footprintUnion(rects){const xs=[...new Set(rects.flatMap(r=>[r.x-r.width/2,r.x+r.width/2]))].sort((a,b)=>a-b);let area=0;for(let i=0;i<xs.length-1;i++){const mid=(xs[i]+xs[i+1])/2,spans=rects.filter(r=>Math.abs(mid-r.x)<r.width/2).map(r=>[r.z-r.depth/2,r.z+r.depth/2]).sort((a,b)=>a[0]-b[0]);let length=0,end=-Infinity;for(const [a,b]of spans){length+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b)}area+=(xs[i+1]-xs[i])*length}return area}
  const residenceExtension={existingRoomsUnchanged:true,coherentHouseAxis:true,directJoinedWing:false,connectedDistinctRooms:true,detachedTimberFence:false,coreArea:footprintUnion(coreFootprints),totalArea:footprintUnion([...coreFootprints,...addedFootprints]),addedFootprints,gardenWalk,spaces:['独立阅亭与过渡廊','二层左翼静室','开放露庭与花池','苔庭、砂纹与矩形浅水']};
  residenceCourts.push({name:'阅廊前庭',x:-1.49,z:1.22,width:.93,depth:.86,level:.295,supportedBy:'grounded foundation'},{name:'东侧连续露台',x:1.70,z:.95,width:.99,depth:.73,level:.304,supportedBy:'grounded foundation'});
  residenceDetails.push({kind:'garden extension',spaces:residenceExtension.spaces,existingRoomScale:1,additionalPosts:0});
  // Rectangular water plane; two quiet notches provide inlet and planted overflow.
  for(const [a,b] of [[courtOutline[0],[-.75,-.063]],[[-.67,-.063],courtOutline[1]],[courtOutline[1],courtOutline[2]],[[.44,.717],[.415,.717]],[[.34,.717],courtOutline[3]],[courtOutline[3],courtOutline[0]]]){
    const len=Math.hypot(b[0]-a[0],b[1]-a[1]),g=new THREE.BoxGeometry(len+.004,.032,.018);g.rotateY(-Math.atan2(b[1]-a[1],b[0]-a[0]));
    builder.add(g,RES.paving,[(a[0]+b[0])/2,.275,(a[1]+b[1])/2],[0,0,0],[1,1,1],SURFACE.PAVING,topSnow);
  }
  const poolShape=new THREE.Shape();courtOutline.forEach(([x,z],i)=>i?poolShape.lineTo(x,-z):poolShape.moveTo(x,-z));poolShape.closePath();
  const poolBottom=new THREE.ShapeGeometry(poolShape,24);poolBottom.rotateX(-Math.PI/2);poolBottom.translate(0,COURT_LEVEL-COURT_DEPTH,0);
  builder.add(poolBottom,'#939a88',[0,0,0],[0,0,0],[1,1,1],SURFACE.STONE,0);
  // Ground-following curvilinear patches form a composed moss peninsula and
  // raked sand clearing. Dense radial tessellation preserves smooth topography.
  const landscapePatches=[];
  function houseSideKerbCorrection(x,z,originalTop){
    const route=walkingRoutes[1];let distance=Infinity,pathPoint;
    for(let i=1;i<route.points.length;i++){
      const a=route.points[i-1],b=route.points[i],dx=b.x-a.x,dz=b.z-a.z,t=clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz),0,1),px=a.x+dx*t,pz=a.z+dz*t,d=Math.hypot(x-px,z-pz);
      if(d<distance){distance=d;pathPoint=[px,pz];}
    }
    const gap=distance-route.width/2,pathTop=flowerRouteHeight(...pathPoint),target=.20*DESIGN_SCALE;
    const deficit=Math.max(0,pathTop+target-originalTop);
    // Only this bed's path-facing shoulder receives a modest lift. Fade both
    // the shoulder and tiny corrections into the existing terrain-following wall.
    const correction=deficit*smooth(0,.004,deficit)*(1-smooth(.050,.120,gap));
    return {correction,pathTop,pathGap:gap,target};
  }
  function landscapePatch(name,outline,lift,type,c,kerb=false,snowMask=topSnow){
    const center=outline.reduce((a,p)=>[a[0]+p[0]/outline.length,a[1]+p[1]/outline.length],[0,0]);
    const curve=new THREE.CatmullRomCurve3(outline.map(([x,z])=>new THREE.Vector3(x,0,z)),true,'centripetal'),boundary=curve.getPoints(96).slice(0,-1),n=boundary.length,rings=16,p=[],idx=[];
    for(let j=0;j<=rings;j++)for(let i=0;i<n;i++){const t=j/rings,b=boundary[i],x=mix(center[0],b.x,t),z=mix(center[1],b.z,t),y=terrainHeight(x,z)+.009+lift*Math.pow(Math.max(0,1-t*t),1.3);p.push(x,y,z)}
    const field=(x,z)=>{
      const paving=hardscapeClearance(x,z)-.045;
      let clear=paving;
      if(name==='松影低植栽'){
        const edge=-contourDistance(x,z,boundary),radius=.10,local=smooth(-.85,-1.0,x)*smooth(1.64,1.75,z);
        const rounded=Math.min(edge,paving)-Math.max(radius-Math.abs(edge-paving),0)**2/(4*radius);
        clear=mix(paving,rounded,local);
      }
      return Math.min(clear,courtDistance(x,z)-.04,type===SURFACE.VEGETATION?terrainHeight(x,z)-.13:1);
    };
    function clippedTri(tri){
      const poly=[];for(let k=0;k<3;k++){
        const a=tri[k],b=tri[(k+1)%3],ax=p[a*3],az=p[a*3+2],bx=p[b*3],bz=p[b*3+2],da=field(ax,az),db=field(bx,bz);
        if(da>=0)poly.push(a);
        if((da<0&&db>=0)||(da>=0&&db<0)){
          let lo=0,hi=1;for(let j=0;j<17;j++){const t=(lo+hi)/2,d=field(mix(ax,bx,t),mix(az,bz,t));if((d>=0)===(da>=0))lo=t;else hi=t;}
          const t=da>=0?lo:hi,x=mix(ax,bx,t),z=mix(az,bz,t),relief=mix(p[a*3+1]-terrainHeight(ax,az),p[b*3+1]-terrainHeight(bx,bz),t),id=p.length/3;
          p.push(x,terrainHeight(x,z)+relief,z);poly.push(id);
        }
      }for(let k=1;k<poly.length-1;k++)idx.push(poly[0],poly[k],poly[k+1]);
    }
    for(let j=0;j<rings;j++)for(let i=0;i<n;i++){const a=j*n+i,b=j*n+(i+1)%n,d=a+n,e=b+n;clippedTri([a,d,b]);clippedTri([b,d,e]);}
    // Orient every top face upward regardless of the contour's authored winding.
    for(let i=0;i<idx.length;i+=3){const a=idx[i]*3,b=idx[i+1]*3,d=idx[i+2]*3,up=(p[b+2]-p[a+2])*(p[d]-p[a])-(p[b]-p[a])*(p[d+2]-p[a+2]);if(up<0)[idx[i+1],idx[i+2]]=[idx[i+2],idx[i+1]]}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex(idx);g.computeVertexNormals();builder.add(g,c,[0,0,0],[0,0,0],[1,1,1],type,snowMask);
    const wallAudit=[];
    if(kerb)for(let i=0;i<n;i++){
      const a=boundary[i],b=boundary[(i+1)%n],mid=[(a.x+b.x)/2,(a.z+b.z)/2];
      // Keep every authored contour segment; plant clearance must never delete
      // a piece of the retaining edge. The planting surface is clipped against
      // paving separately, while the kerb remains one closed enclosure.
      const routeGuard=name==='海侧低花台'&&(hardscapeClearance(a.x,a.z)<.002||hardscapeClearance(b.x,b.z)<.002||hardscapeClearance(...mid)<.002);
      if(routeGuard||terrainHeight(a.x,a.z)<.13||terrainHeight(b.x,b.z)<.13)continue;
      const prev=boundary[(i+n-1)%n],next=boundary[(i+2)%n];
      const ground=(terrainHeight(prev.x,prev.z)+2*terrainHeight(...mid)+terrainHeight(next.x,next.z))/4;
      const originalTop=ground+.0545,adjustment=name==='靠山高花台'?houseSideKerbCorrection(...mid,originalTop):{correction:0};
      const len=Math.hypot(b.x-a.x,b.z-a.z),g=new THREE.BoxGeometry(len+.018,.061+adjustment.correction,.022);
      g.rotateY(-Math.atan2(b.z-a.z,b.x-a.x));builder.add(g,'#a6a496',[mid[0],ground+.024+adjustment.correction/2,mid[1]],[0,0,0],[1,1,1],SURFACE.PAVING,topSnow);
      wallAudit.push({segment:i,x:mid[0],z:mid[1],ground,low:ground-.0065,originalTop,top:originalTop+adjustment.correction,width:.022,...adjustment});
    }
    let minGround=Infinity;for(const id of idx)minGround=Math.min(minGround,terrainHeight(p[id*3],p[id*3+2]));
    landscapePatches.push({name,outline,lift,type,kerb,minGround,...(kerb?{wallAudit}:{})});return boundary;
  }
  const gravelY=.256;
  // Sand belongs to the terrain itself. Individual embedded grains give physical relief.
  const sandGrains=[];
  for(let i=0;i<1050;i++){
    const x=-2.15+3.65*((i*.61803398875)%1),z=.020+2.00*((i*.41421356237+.18)%1),mask=courtSandMask(x,z);
    if(mask<.60||hardscapeClearance(x,z)<.012)continue;const r=.0020+(i%7)*.00053,y=terrainHeight(x,z);
    builder.add(new THREE.IcosahedronGeometry(1,1),['#b0a68c','#958e79','#b9b29b','#aaa28b'][i%4],[x,y+r*.26,z],[.3,i*.67,.1],[r,r*.39,r*(.7+(i%3)*.15)],SURFACE.GRAVEL,0);
    sandGrains.push({x,z,r,ground:y});
  }
  designChecks.sandCourt={terrainIntegrated:true,grains:sandGrains,raisedMat:false,organicEdge:true,flatReadingForecourt:true,forecourtLevel:.253};
  let mossMinGround=Infinity;for(let z=1.36;z<2.06;z+=.02)for(let x=-1.25;x<1.72;x+=.02)if(courtMossMask(x,z)>.03)mossMinGround=Math.min(mossMinGround,terrainHeight(x,z));
  landscapePatches.push({name:'柔缘内扩海景苔带',outline:courtMossOutline,lift:0,type:SURFACE.VEGETATION,kerb:false,minGround:mossMinGround,terrainIntegrated:true,softEdge:true});
  function plantedDrift(x,z,rx,rz,height,seed){
    const outline=[];for(let i=0;i<9;i++){const a=i*TAU/9,lobe=1+.14*Math.sin(a*2+seed);outline.push([x+Math.cos(a)*rx*lobe,z+Math.sin(a)*rz*lobe])}
    landscapePatch('修剪杜鹃带 '+seed,outline,height,SURFACE.VEGETATION,seed%2?'#536b43':'#68794a');
    gardenPlants.push({x,z,rx,rz,height,walkClipped:true,kind:'connected azalea planting band'});reserve(x,z,rx*1.10,rz*1.10,terrainHeight(x,z)-.02,terrainHeight(x,z)+height+.03,'garden shrub band');
  }
  // The coastal forecourt uses connected low planting, not isolated green discs.
  const forecourtBeds=[
    {name:'松影低植栽',outline:[[-1.04,1.62],[-.83,1.52],[-.60,1.53],[-.35,1.59],[-.18,1.70],[-.20,1.81],[-.47,1.88],[-.74,1.86],[-1.02,1.80]],height:.019},
    {name:'庭端蕨与南天竹',outline:[[0.7,1.6],[0.97,1.5],[1.21,1.47],[1.43,1.46],[1.65,1.465],[1.81,1.505],[1.86,1.59],[1.79,1.68],[1.63,1.715],[1.45,1.684],[1.27,1.726],[1.07,1.79],[0.88,1.83],[0.76,1.74]],height:.014}
  ];
  for(const bed of forecourtBeds){bed.boundary=landscapePatch(bed.name,bed.outline,bed.height,SURFACE.VEGETATION,'#69764d',false,.25);}
  designChecks.forecourtPlanting={beds:forecourtBeds,removedReadingMoss:true,plants:[],clearPaving:true};
  // Sparse native ferns settle the moss-water junction without invading paths.
  for(const [x,z] of [[1.11,1.708]])for(let k=0;k<5;k++){
    const a=k*TAU/5,base=terrainHeight(x,z)+.025,points=[];
    for(let j=0;j<=6;j++){const t=j/6;points.push([x+Math.cos(a)*t*.055,base+.07*Math.sin(t*Math.PI*.9),z+Math.sin(a)*t*.055])}tube(points,.004,'#65764a',SURFACE.VEGETATION,0);
  }
  residenceDetails.push({kind:'composed wabi garden',landscapePatches,principles:['continuous moss peninsula','raked negative space','few stones','clear paving','layered native planting']});
  // Two shaped trees frame open views. Fine branches sit within substantial crowns.
  function gardenTree(x,z,size,maple=false){const y=terrainHeight(x,z);let minRootGround=Infinity;for(let i=0;i<24;i++){const a=i*TAU/24;minRootGround=Math.min(minRootGround,terrainHeight(x+Math.cos(a)*.16,z+Math.sin(a)*.16));}if(minRootGround<.10)throw new Error('Garden tree on wet ground');
    const trunk=[[x,y-.027,z],[x-.054,y+size*.29,z+.015],[x-.033,y+size*.62,z-.016],[x-.055,y+size*.83,z+.015]];
    treeRootCollar(x,z,.017,'#5a503c');
    for(let i=1;i<trunk.length;i++)builder.beam(trunk[i-1],trunk[i],.020-i*.003,'#5a503c',SURFACE.WOOD);
    const pads=[[-.16,.44,.075,.112,.042,.078],[.13,.62,-.033,.105,.039,.085],[-.055,.83,.015,.118,.046,.091]];
    for(let j=0;j<pads.length;j++){const [dx,t,dz,rx,ry,rz]=pads[j],end=[x+dx,y+size*t,z+dz];if(j<2)builder.beam(trunk[j+1],end,.0085,'#62533b',SURFACE.WOOD);
      for(let k=0;k<5;k++){const a=k*2.399+j,reach=rx*(.32+.19*(k%3)),cx=end[0]+Math.cos(a)*reach,cz=end[2]+Math.sin(a)*rz*.58,cy=end[1]+.009*Math.sin(a*2);builder.add(new THREE.IcosahedronGeometry(1,2),k%2?'#456249':'#5a7150',[cx,cy,cz],[.07,a,.13],[rx*.60,ry*(.69+.15*(k%2)),rz*.65],SURFACE.VEGETATION,.25);
        for(let f=0;f<3;f++){const aa=a+f*2.4;builder.beam([cx,cy-.008,cz],[cx+Math.cos(aa)*rx*.54,cy+.012,cz+Math.sin(aa)*rz*.54],.0029,'#557248',SURFACE.VEGETATION);}
      }
    }
    gardenPlants.push({x,z,base:y,minRootGround,kind:'asymmetric Japanese black pine',tieredPads:true});reserve(x,z,.33,.29,y-.02,y+size+.09,'garden feature tree');
  }
  gardenTree(-.62,1.72,.58);
  // Only two small aquatic clumps; most of the shallow court stays open.
  for(const [x,z,kind] of [[.33,.57,'Japanese iris'],[-.75,.59,'sweet flag']]){
    const bed=COURT_LEVEL-COURT_DEPTH,water=COURT_LEVEL;
    for(let i=0;i<7;i++){const a=i*2.4,h=.13+(i%3)*.025,dx=Math.cos(a)*.026,dz=Math.sin(a)*.026;
      const p=[x-.005,bed,z,x+.005,bed,z,x+dx+.006,water+h*.55,z+dz,x+dx*.70,water+h,z+dz*.7],g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex([0,1,2,0,2,3,2,1,0,3,2,0]);g.computeVertexNormals();builder.add(g,'#56784c',[0,0,0],[0,0,0],[1,1,1],SURFACE.VEGETATION,0);
      if(kind==='Japanese iris'&&i===2){builder.beam([x,bed,z],[x,water+.15,z],.0038,'#58784b',SURFACE.VEGETATION);for(let k=0;k<3;k++)builder.add(new THREE.SphereGeometry(1,8,6),'#80759a',[x+Math.cos(k*TAU/3)*.010,water+.15,z+Math.sin(k*TAU/3)*.010],[0,k*TAU/3,0],[.015,.009,.010],SURFACE.VEGETATION,0)}
    }aquaticPlants.push({x,z,kind,bed,water});reserve(x,z,.045,.045,bed,water+.20,'aquatic plants');
  }
  // Two modest garden accents, both embedded; plants remain the main expression.
  for(const [x,z,rx,ry,rz] of [[1.30,1.51,.080,.041,.055]])builder.add(new THREE.IcosahedronGeometry(1,2),'#74796c',[x,terrainHeight(x,z)+ry*.40,z],[0,.4,0],[rx,ry,rz],SURFACE.STONE,topSnow);
  designChecks.garden={style:'Japanese classical palette on a stepped wabi-sabi courtyard residence',courtyards:[{name:'浅水主庭',level:COURT_LEVEL,area:courtArea},...residenceCourts,{name:'海景枯山水下庭',level:.256,area:.92}],palette:RES,paletteRelationship:'Rice-white mineral walls, deep brown timber columns and joinery, charcoal-grey roofs and subdued bronze evoke classical Japanese residences',details:residenceDetails,rooms:residenceRooms.map(r=>({name:r.name,height:r.h,floor:r.f,upper:!!r.upper})),actualSecondStorey:true,roofAudit,
    court:{outline:courtOutline,area:courtArea,earlyArea:earlyCourtArea,areaRatio:1.395,shape:'rectangle',width:courtWidth,depth:courtDepth,aspect: courtWidth/courtDepth,level:COURT_LEVEL,depthScene:COURT_DEPTH,depthMetres:.06,scale:DESIGN_SCALE,openSides:2},aquaticPlants,plantedCourt:true,stoneAccents:1,continuousMoss:true,
    extension:residenceExtension,water:{perimeterRing:false,supply:gardenSupply,inlet:springControls[1],overflow:springControls[2],drain:gardenDrain,independentOutfall:true,visibleOverflowLength:.35}};
  // Supported hillside stairs remain separate from the garden waterways.
  for(let k=0;k<14;k++){const x=2.82,z=-1.03-k*.13,top=.28+k*.046,low=Math.min(terrainHeight(x,z)-.075,top-.038);builder.box(x,(top+low)/2,z,.30*BUILDING_SCALE,top-low,.135,'#aaa795',SURFACE.PAVING,topSnow);reserve(x,z,.18*BUILDING_SCALE,.080,low,top+.035,'temple approach')}
  // A short grounded landing bridges the retained hillside path to the narrower base.
  const pagodaLandingLeft=PAGODA_X+.98*BUILDING_SCALE*PAGODA_PLAN_SCALE-.030,pagodaLandingRight=2.82+.15*BUILDING_SCALE;
  const pagodaLandingX=(pagodaLandingLeft+pagodaLandingRight)/2,pagodaLandingWidth=pagodaLandingRight-pagodaLandingLeft;
  foundation('pagoda approach landing',pagodaLandingX,-2.72,pagodaLandingWidth,.16,.878);
  builder.box(pagodaLandingX,.878,-2.72,pagodaLandingWidth,.020,.16,'#aaa795',SURFACE.STONE,topSnow);

  // Broad, low Ryōbu torii. All tops stop below the kasagi.
  const gateScaleMark=beginBuildingScale('torii',[0,terrainHeight(0,gateZ),gateZ]),gateTop=1.28;
  reserve(0,gateZ,1.56,.41,-.6,1.7,'torii');
  for(const side of [-1,1]){
    const px=side*.85,gateBase=terrainHeight(px,gateZ)-.09;builder.cyl(px,(gateBase+gateTop)/2,gateZ,.072,.099,gateTop-gateBase,PAINT);builder.cyl(px,gateBase+.22,gateZ,.103,.112,.44,'#272b28',SURFACE.WOOD);
    for(const dz of [-.29,.29]){const pz=gateZ+dz,bottom=terrainHeight(px,pz)-.095;builder.cyl(px,(bottom+.68)/2,pz,.047,.060,.68-bottom,PAINT);builder.cyl(px,.68,pz,.065,.065,.065,'#2c302a',SURFACE.WOOD);for(const y of [.17,.50])builder.box(px,y,gateZ+dz/2,.067,.045,Math.abs(dz)+.065,PAINT)}
    for(const y of [.79,1.27]){builder.sphere(px,y,gateZ+.090,.012,'#5b4731',SURFACE.METAL,0);builder.sphere(px,y,gateZ-.090,.012,'#5b4731',SURFACE.METAL,0)}
  }
  builder.box(0,.81,gateZ,2.15,.092,.12,PAINT);builder.box(0,1.07,gateZ,.065,.46,.078,PAINT);builder.box(0,1.27,gateZ,2.45,.115,.19,PAINT);
  builder.box(0,1.05,gateZ+.078,.205,.286,.032,'#30312a',SURFACE.WOOD);builder.box(0,1.05,gateZ+.097,.159,.244,.010,'#77623c',SURFACE.METAL);
  builder.add(new THREE.TorusGeometry(.050,.009,6,16),'#a99666',[0,1.08,gateZ+.109],[0,0,0],[1,1,1],SURFACE.METAL,0);
  function kasagi(w,y,h,c,type){const shape=new THREE.Shape();const steps=40;for(let i=0;i<=steps;i++){const x=(i/steps-.5)*w,v=.105*Math.pow(Math.abs(x)/(w*.5),3);i?shape.lineTo(x,v):shape.moveTo(x,v)}for(let i=steps;i>=0;i--){const x=(i/steps-.5)*w;shape.lineTo(x,h+.105*Math.pow(Math.abs(x)/(w*.5),3))}shape.closePath();builder.add(new THREE.ExtrudeGeometry(shape,{depth:.245,steps:1,bevelEnabled:true,bevelSegments:2,bevelSize:.008,bevelThickness:.008}),c,[0,y,gateZ-.1225],[0,0,0],[1,1,1],type,topSnow)}
  kasagi(2.88,1.34,.105,PAINT,SURFACE.PAINT);kasagi(2.96,1.445,.044,'#292e2a',SURFACE.ROOF);
  tube([[-.82,.768,gateZ+.095],[-.42,.723,gateZ+.105],[0,.706,gateZ+.109],[.42,.723,gateZ+.105],[.82,.768,gateZ+.095]],.013,'#c1ad76',SURFACE.WOOD);
  for(const x of [-.55,-.18,.18,.55]){const gy=.706+.060*Math.abs(x),zig=new THREE.Shape();zig.moveTo(-.013,0);zig.lineTo(.014,0);zig.lineTo(.014,-.035);zig.lineTo(.033,-.035);zig.lineTo(.033,-.062);zig.lineTo(.010,-.062);zig.lineTo(.010,-.09);zig.lineTo(-.016,-.09);zig.lineTo(-.016,-.055);zig.lineTo(-.035,-.055);zig.lineTo(-.035,-.028);zig.lineTo(-.013,-.028);zig.closePath();builder.add(new THREE.ExtrudeGeometry(zig,{depth:.003,bevelEnabled:false}),PLASTER,[x,gy,gateZ+.113],[0,0,0],[1,1,1],SURFACE.PLASTER,0)}
  const gateScale=finishBuildingScale(gateScaleMark,[BUILDING_SCALE*TORII_WIDTH_SCALE,BUILDING_SCALE,BUILDING_SCALE]);designChecks.gate={width:2.96*BUILDING_SCALE*TORII_WIDTH_SCALE,top:gateScale.py(1.61),z:gateZ,additionalWidthScale:TORII_WIDTH_SCALE};
  if(typeof warmLights!=='undefined')warmLights[2].position.applyMatrix4(gateScale.m);

  // Kiyomizu-dera Sanju-no-to: three bays, three storeys, deep tile eaves,
  // san-tesaki brackets and the southeast dragon roof guardian.
  // Osaka Castle palette: white plaster, verdigris roofs, charcoal joinery, gold accents.
  const pagX=PAGODA_X,pagZ=PAGODA_Z,pagBase=terrainHeight(pagX,pagZ);let pagFloor=.99;
  const pagodaScaleMark=beginBuildingScale('pagoda, base, steps and terrace lanterns',[pagX,.84,pagZ]);
  const TOWER_WHITE='#edece4',TOWER_DEEP='#303a35',TOWER_GREEN='#5c927f',TOWER_GOLD='#c5a048',TOWER_CREAM='#dfdfd2',TOWER_ROOF='#4f8976',TOWER_TILE='#73a28e',TOWER_HIP='#315f51';
  const pagodaLevels=[{floor:pagFloor,w:.99,h:.46,roofW:2.31,roofY:1.77,rise:.36},{floor:2.13,w:.86,h:.26,roofW:2.15,roofY:2.62,rise:.34},{floor:2.96,w:.74,h:.24,roofW:1.98,roofY:3.43,rise:.48}];
  const pagTerraceTop=pagFloor-.15;
  stonePlatform(pagX,pagZ,1.98,1.84,pagTerraceTop);
  const plinthBottom=pagBase-.07,plinthTop=pagFloor-.018;
  builder.box(pagX,(plinthBottom+plinthTop)/2,pagZ,1.35,plinthTop-plinthBottom,1.35,'#939486',SURFACE.STONE,topSnow);
  cedarFloor(pagX,pagZ,1.31,1.31,pagFloor,topSnow);
  for(const s of [-1,1])builder.box(pagX+s*.653,pagFloor-.076,pagZ,.025,.045,1.31,'#aba995',SURFACE.STONE,topSnow);
  for(let k=0;k<3;k++){const z=pagZ+.91-k*.13,top=pagFloor-.13+k*.05,low=terrainHeight(pagX,z)-.08;builder.box(pagX,(top+low)/2,z,.48,top-low,.14,'#aaa894',SURFACE.STONE,topSnow);reserve(pagX,z,.26,.085,low,top+.04,'pagoda front stairs')}
  builder.box(pagX+.99,pagTerraceTop+.005,pagZ-.15,.46,.080,.33,'#a5a28d',SURFACE.STONE,topSnow);
  reserve(pagX,pagZ,1.04,1.00,pagBase-.09,4.94,'Kiyomizu three-storey pagoda');
  function paintedBay(x,y,z,w,h,axis=0){
    const rot=axis?[0,Math.PI/2,0]:[0,0,0],move=(u,v,out)=>[x+(axis?out:u),y+v,z+(axis?u:out)];
    builder.add(new THREE.BoxGeometry(w,h,.017),TOWER_DEEP,move(0,0,0),rot,[1,1,1],SURFACE.WOOD);
    for(const s of [-1,1]){builder.add(new THREE.BoxGeometry(.018,h+.025,.026),TOWER_GOLD,move(s*w/2,0,.012),rot,[1,1,1],SURFACE.WOOD);builder.add(new THREE.BoxGeometry(w+.035,.017,.027),TOWER_GOLD,move(0,s*h/2,.014),rot,[1,1,1],SURFACE.WOOD)}
  }
  function cloudBracket(x,y,z,axis,side,step){
    const span=.14+step*.055,sh=new THREE.Shape();sh.moveTo(-span/2,-.015);sh.quadraticCurveTo(-span*.27,-.020,-span*.25,.006);sh.lineTo(-span*.08,.006);sh.quadraticCurveTo(0,-.010,span*.10,.006);sh.lineTo(span*.27,.006);sh.quadraticCurveTo(span*.29,-.018,span/2,-.015);sh.lineTo(span/2,.025);sh.lineTo(-span/2,.025);sh.closePath();
    const out=side*step*.069;
    builder.add(new THREE.ExtrudeGeometry(sh,{depth:.042,bevelEnabled:false}),TOWER_WHITE,[x+(axis?out:0),y,z+(axis?0:out)],[0,axis?0:Math.PI/2,0],[1,1,1],SURFACE.PAINT);
    builder.box(x+(axis?out:0),y+.027,z+(axis?0:out),axis?.075:.085,.025,axis?.085:.075,TOWER_CREAM,SURFACE.WOOD);
    builder.box(x+(axis?out:0),y+.004,z+(axis?0:out),axis?.062:span,.030,axis?span:.062,TOWER_WHITE,SURFACE.PAINT);
  }
  const pagodaCornerAnchors=[];
  function pagodaRoof(level,next,k){
    const w=level.roofW,y=level.roofY,h=level.rise,neck=next?next.w/2-.012:0,half=w/2;
    const height=(x,z)=>{const r=Math.max(Math.abs(x),Math.abs(z)),t=clamp((half-r)/(half-neck),0,1);return h*(.24*t+.76*t*t)+.080*Math.pow(Math.min(Math.abs(x),Math.abs(z))/half,5)*Math.pow(1-t,3)};
    const boundary=[],pts=[],idx=[],rings=20;
    for(let i=0;i<24;i++)boundary.push([-1+i/12,-1]);for(let i=0;i<24;i++)boundary.push([1,-1+i/12]);for(let i=0;i<24;i++)boundary.push([1-i/12,1]);for(let i=0;i<24;i++)boundary.push([-1,1-i/12]);
    for(let j=0;j<=rings;j++)for(const [u,v] of boundary){const r=mix(half,neck,j/rings);pts.push(u*r,height(u*r,v*r),v*r)}
    const count=boundary.length;for(let j=0;j<rings;j++)for(let i=0;i<count;i++){const a=j*count+i,b=j*count+(i+1)%count,c=a+count,d=b+count;idx.push(a,c,b,b,c,d)}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pts,3));g.setIndex(idx);g.computeVertexNormals();builder.add(g,TOWER_ROOF,[pagX,y,pagZ],[0,0,0],[1,1,1],SURFACE.ROOF,1);
    const under=g.clone(),rev=Array.from(under.index.array);for(let i=0;i<rev.length;i+=3)[rev[i+1],rev[i+2]]=[rev[i+2],rev[i+1]];under.setIndex(rev);under.translate(0,-.055,0);under.computeVertexNormals();builder.add(under,TOWER_CREAM,[pagX,y,pagZ],[0,0,0],[1,1,1],SURFACE.UNDERSIDE,0);
    const rimP=[],rimI=[];for(let i=0;i<boundary.length;i++){
      const a=boundary[i],b=boundary[(i+1)%boundary.length],k=rimP.length/3;
      for(const [u,v,dy]of [[...a,0],[...b,0],[...b,-.055],[...a,-.055]])rimP.push(u*half,height(u*half,v*half)+dy,v*half);
      rimI.push(k,k+1,k+2,k,k+2,k+3);
    }
    const rim=new THREE.BufferGeometry();rim.setAttribute('position',new THREE.Float32BufferAttribute(rimP,3));rim.setIndex(rimI);rim.computeVertexNormals();builder.add(rim,TOWER_HIP,[pagX,y,pagZ],[0,0,0],[1,1,1],SURFACE.ROOF,0);
    // Tile rolls and two ranks of rafters run perpendicular to each eave.
    for(const axis of [0,1])for(const side of [-1,1]){
      const edge=[];for(let j=0;j<=24;j++){const u=(j/12-1)*half,x=axis?side*half:u,z=axis?u:side*half;edge.push([pagX+x,y+height(x,z)-.026,pagZ+z])}tube(edge,.024,TOWER_HIP,SURFACE.ROOF,0);
      for(let j=0;j<26;j++){
        const u=-half+(j+.5)*w/26,inner=Math.max(neck,Math.abs(u)),tile=[];
        for(let q=0;q<=10;q++){const r=mix(half,inner,q/10),x=axis?side*r:u,z=axis?u:side*r;tile.push([pagX+x,y+height(x,z)+.010,pagZ+z])}tube(tile,.0065,TOWER_TILE,SURFACE.ROOF,1);
        for(let rank=0;rank<2;rank++){const r0=half-.025-rank*.043,r1=Math.max(Math.abs(u),half-.36),x0=axis?side*r0:u,z0=axis?u:side*r0,x1=axis?side*r1:u,z1=axis?u:side*r1;
          if(r1<r0)builder.beam([pagX+x0,y+height(x0,z0)-.074-rank*.028,pagZ+z0],[pagX+x1,y+height(x1,z1)-.065-rank*.028,pagZ+z1],.011,rank?TOWER_CREAM:TOWER_WHITE,SURFACE.UNDERSIDE)}
      }
    }
    for(const sx of [-1,1])for(const sz of [-1,1]){
      const hip=[];for(let j=0;j<=12;j++){const r=mix(half,neck,j/12);hip.push([pagX+sx*r,y+height(sx*r,sz*r)+.015,pagZ+sz*r])}tube(hip,.017,TOWER_HIP,SURFACE.ROOF,1);
      const r=half-.026,cx=pagX+sx*r,cz=pagZ+sz*r,baseY=y+height(sx*r,sz*r);
      builder.cyl(cx,baseY+.008,cz,.021,.029,.030,TOWER_HIP,SURFACE.ROOF,0,14);
      builder.cyl(cx,baseY+.029,cz,.012,.022,.022,TOWER_GOLD,SURFACE.METAL,0,12);
      if(k===2&&sx===1&&sz===1){
        tube([[cx-sx*.055,baseY+.013,cz-sz*.055],[cx,baseY+.032,cz],[cx+sx*.019,baseY+.079,cz+sz*.019],[cx+sx*.033,baseY+.125,cz+sz*.033]],.012,TOWER_GOLD,SURFACE.METAL,0);
        builder.sphere(cx+sx*.028,baseY+.109,cz+sz*.028,.022,TOWER_GOLD,SURFACE.METAL,0);
        for(const side of [-1,1])builder.beam([cx+.028+side*.010,baseY+.121,cz+.026],[cx+.036+side*.017,baseY+.145,cz+.020],.004,TOWER_GOLD,SURFACE.METAL);
      }else{builder.add(new THREE.IcosahedronGeometry(1,2),TOWER_GOLD,[cx,baseY+.052,cz],[0,.7,0],[.019,.026,.019],SURFACE.METAL,0);builder.beam([cx,baseY+.061,cz],[cx+sx*.010,baseY+.092,cz+sz*.010],.005,TOWER_GOLD,SURFACE.METAL)}
      if(k===2)pagodaCornerAnchors.push({x:cx,y:baseY+.036,z:cz,sx,sz,roof:baseY});
    }
    if(next)builder.box(pagX,y+h-.013,pagZ,next.w+.015,.030,next.w+.015,TOWER_DEEP,SURFACE.WOOD);
  }
  for(let k=0;k<3;k++){
    const l=pagodaLevels[k];l.h=l.roofY-l.floor-.135;const {floor:f,w,h,roofY}=l,wallY=f+.02,bay=w/3,front=pagZ+w/2;
    if(k)cedarFloor(pagX,pagZ,w+.10,w+.10,f,0);
    // Continuous closed core behind the exposed bracket system. Each top edge
    // follows the underside of its own roof; daylight cannot cut through the tower.
    const coreHalf=w/2-.07,wallBottom=wallY+h-.07,half=l.roofW/2,neck=k<2?pagodaLevels[k+1].w/2-.012:0;
    const coreTop=(x,z)=>{const rr=Math.max(Math.abs(x),Math.abs(z)),t=clamp((half-rr)/(half-neck),0,1);return roofY+l.rise*(.24*t+.76*t*t)+.080*Math.pow(Math.min(Math.abs(x),Math.abs(z))/half,5)*Math.pow(1-t,3)-.040};
    for(const axis of [0,1])for(const side of [-1,1]){
      const profile=[[-coreHalf,wallBottom],[coreHalf,wallBottom]];
      for(let j=32;j>=0;j--){const u=-coreHalf+j/32*coreHalf*2;profile.push([u,coreTop(axis?side*coreHalf:u,axis?u:side*coreHalf)])}
      const shape=new THREE.Shape();profile.forEach(([x,y],i)=>i?shape.lineTo(x,y):shape.moveTo(x,y));shape.closePath();
      const rot=axis?(side>0?[0,-Math.PI/2,0]:[0,Math.PI/2,0]):(side>0?[0,Math.PI,0]:[0,0,0]);
      builder.add(new THREE.ExtrudeGeometry(shape,{depth:.055,steps:1,bevelEnabled:false}),TOWER_CREAM,[pagX+(axis?side*coreHalf:0),0,pagZ+(axis?0:side*coreHalf)],rot,[1,1,1],SURFACE.PLASTER,0);
    }
    builder.box(pagX,roofY-.085,pagZ,w-.10,.035,w-.10,TOWER_CREAM,SURFACE.UNDERSIDE,0);
    for(const axis of [0,1])for(const side of [-1,1]){
      for(let j=0;j<3;j++){
        const u=(j-1)*bay,x=pagX+(axis?side*(w/2-.024):u),z=pagZ+(axis?u:side*(w/2-.024));
        if(!k&&!axis&&side===1&&j===1)continue;
        builder.box(x,wallY+h/2,z,axis?.050:bay-.012,h,axis?bay-.012:.050,TOWER_WHITE,SURFACE.PLASTER);
        paintedBay(pagX+(axis?side*(w/2+.005):u),wallY+h*.55,pagZ+(axis?u:side*(w/2+.005)),bay*.68,h*.61,axis);
      }
      // Four columns divide each elevation into the temple's three bays.
      for(let j=0;j<4;j++){
        const u=-w/2+j*bay,x=pagX+(axis?side*w/2:u),z=pagZ+(axis?u:side*w/2);
        builder.box(x,wallY+h/2,z,.040,h+.045,.040,TOWER_WHITE,SURFACE.PAINT);
        const bracketBase=wallY+h+.022,stepRise=(roofY-.075-bracketBase)/3;
        for(let step=0;step<4;step++)cloudBracket(x,bracketBase+step*stepRise,z,axis,side,step);
        const out=side*.25;builder.box(x+(axis?out:0),roofY-.022,z+(axis?0:out),axis?.24:.071,.056,axis?.071:.24,TOWER_WHITE,SURFACE.PAINT);
      }
      for(let band=0;band<3;band++){const yy=wallY+h-.032+band*.028;builder.box(pagX+(axis?side*(w/2+.019):0),yy,pagZ+(axis?0:side*(w/2+.019)),axis?.046:w+.05,.025,axis?w+.05:.046,band===1?TOWER_DEEP:band===2?TOWER_GOLD:TOWER_CREAM,SURFACE.WOOD)}
      const rail=w+.24,railY=f+.151;
      if(k||side===-1||axis)builder.box(pagX+(axis?side*rail/2:0),railY,pagZ+(axis?0:side*rail/2),axis?.026:rail,.029,axis?rail:.026,TOWER_DEEP,SURFACE.PAINT);
      else for(const s of [-1,1])builder.box(pagX+s*(rail/4+.10),railY,pagZ+rail/2,rail/2-.20,.029,.026,TOWER_DEEP,SURFACE.PAINT);
      for(let j=0;j<=8;j++){const u=-rail/2+j*rail/8;if(!k&&!axis&&side===1&&Math.abs(u)<.20)continue;builder.box(pagX+(axis?side*rail/2:u),f+.086,pagZ+(axis?u:side*rail/2),.018,.172,.018,TOWER_DEEP,SURFACE.PAINT)}
      builder.box(pagX+(axis?side*rail/2:0),f-.01,pagZ+(axis?0:side*rail/2),axis?.060:rail+.02,.038,axis?rail+.02:.060,TOWER_DEEP,SURFACE.WOOD);
    }
    if(k===0){const door=bay-.015,openH=.39;
      builder.box(pagX,wallY+h-.028,front,door,.055,.07,TOWER_WHITE,SURFACE.PAINT);
      // An opaque plaster infill overlaps both the closed leaves and the existing lintel.
      const doorTop=wallY+openH,doorHeadBottom=wallY+h-.028-.055/2;
      builder.box(pagX,(doorTop+doorHeadBottom)/2,front-.024,door+.004,doorHeadBottom-doorTop+.008,.050,TOWER_WHITE,SURFACE.PLASTER,0);
      for(const s of [-1,1]){const leaf=door/2,angle=0,cx=pagX+s*door/2-s*Math.cos(angle)*leaf/2,cz=front+Math.sin(angle)*leaf/2;builder.add(new THREE.BoxGeometry(leaf,openH,.023),TOWER_DEEP,[cx,wallY+openH/2,cz],[0,angle,0],[1,1,1],SURFACE.PAINT);builder.add(new THREE.CylinderGeometry(.019,.019,.005,24),TOWER_GOLD,[cx,wallY+.18,cz+.014],[Math.PI/2,0,0],[1,1,1],SURFACE.METAL,0);builder.sphere(cx,wallY+.18,cz+.026,.015,TOWER_GOLD,SURFACE.METAL,0)}
      builder.box(pagX,wallY+.004,front+.105,.36,.025,.30,'#b4a488',SURFACE.STONE,topSnow);
      paintedBay(pagX,wallY+.23,pagZ-.22,.31,.30);
      // The closed tower entrance is excluded from open-passage checks.
    }
    pagodaRoof(l,pagodaLevels[k+1],k);
  }
  const sorinBase=pagodaLevels[2].roofY+pagodaLevels[2].rise;
  builder.cyl(pagX,sorinBase+.038,pagZ,.047,.081,.075,TOWER_GOLD,SURFACE.METAL,0,16);
  builder.cyl(pagX,sorinBase+.118,pagZ,.031,.053,.11,TOWER_GOLD,SURFACE.METAL,0,16);
  builder.cyl(pagX,sorinBase+.498,pagZ,.008,.012,.83,TOWER_GOLD,SURFACE.METAL,0,12);
  for(let i=0;i<9;i++)builder.add(new THREE.TorusGeometry(.061-i*.003,.006,6,28),TOWER_GOLD,[pagX,sorinBase+.245+i*.057,pagZ],[Math.PI/2,0,0],[1,1,1],SURFACE.METAL,0);
  builder.cyl(pagX,sorinBase+.777,pagZ,.031,.043,.065,TOWER_GOLD,SURFACE.METAL,0,14);builder.sphere(pagX,sorinBase+.839,pagZ,.029,TOWER_GOLD,SURFACE.METAL,0);builder.cyl(pagX,sorinBase+.900,pagZ,.003,.014,.080,TOWER_GOLD,SURFACE.METAL,0,12);
  const pagodaStayCables=[];
  designChecks.temple='Kiyomizu-dera Sanju-no-to';
  designChecks.pagoda={stayAnchor:null,stayCables:pagodaStayCables,groundedCornerOrnaments:true,closedRoofRims:true,colourReference:'Osaka Castle keep',palette:{wall:TOWER_WHITE,roof:TOWER_ROOF,tile:TOWER_TILE,joinery:TOWER_DEEP,gold:TOWER_GOLD},storeys:3,bays:3,closedCore:true,continuousWallToRoof:true,roofPlan:'square pyramidal tile roofs',roofWidths:pagodaLevels.map(l=>l.roofW),nineRingSorin:9,base:pagFloor,top:sorinBase+.94,door:true,doorState:'closed',brackets:'san-tesaki',rafterRanks:2,southeastDragon:true,reference:'https://www.discoverkyoto.com/places-go/kiyomizu-dera/'};
  designChecks.foundations.push({name:'Pagoda masonry plinth',bottom:plinthBottom,top:plinthTop,terrain:pagBase,embedded:true});

  function lantern(x,z,scale=1,support=null){
    const s=scale,r=.20*s;let minGround=Infinity,maxGround=-Infinity;
    for(let k=0;k<16;k++){const a=k*TAU/16,px=x+Math.cos(a)*r,pz=z+Math.sin(a)*r,ground=terrainHeight(px,pz);minGround=Math.min(minGround,ground);maxGround=Math.max(maxGround,ground);if(springLevel(px,pz)>ground-.025||ground<.10)throw new Error('Lantern is too close to water: '+x+','+z)}
    const y=support??maxGround+.014,padBottom=support?y-.022:minGround-.045;
    builder.cyl(x,(y+padBottom)/2,z,r*1.02,r*1.10,y-padBottom,STONE,SURFACE.STONE,topSnow,8);
    designChecks.lanterns.push({x,z,scale:s,bottom:padBottom,base:y,minGround,maxGround,support:support?'pagoda stone terrace':'ground',submerged:false});
    reserve(x,z,.18*s,.18*s,y,y+.79*s,'lantern');builder.cyl(x,y+.06*s,z,.17*s,.20*s,.12*s,STONE,SURFACE.STONE,topSnow,6);builder.cyl(x,y+.22*s,z,.051*s,.072*s,.25*s,STONE,SURFACE.STONE,topSnow,8);builder.cyl(x,y+.37*s,z,.14*s,.12*s,.065*s,STONE,SURFACE.STONE,topSnow,6);
    builder.cyl(x,y+.48*s,z,.13*s,.13*s,.18*s,'#51594f',SURFACE.STONE,0,6);
    for(let k=0;k<6;k++){const a=k*TAU/6;builder.add(new THREE.PlaneGeometry(.098*s,.108*s),'#ffcd82',[x+Math.sin(a)*.115*s,y+.48*s,z+Math.cos(a)*.115*s],[0,a,0],[1,1,1],SURFACE.PLASTER,0,true);builder.cyl(x+Math.sin(a)*.13*s,y+.48*s,z+Math.cos(a)*.13*s,.013*s,.013*s,.2*s,STONE,SURFACE.STONE)}
    builder.cyl(x,y+.62*s,z,.035*s,.21*s,.105*s,STONE,SURFACE.STONE,topSnow,6);builder.cyl(x,y+.689*s,z,.027*s,.04*s,.063*s,STONE,SURFACE.STONE,topSnow,6);builder.sphere(x,y+.735*s,z,.038*s,STONE,SURFACE.STONE,1);
  }
  for(const side of [-1,1])lantern(pagX+side*.72,pagZ+.71,.46,pagTerraceTop+.028);
  const pagodaScale=finishBuildingScale(pagodaScaleMark,[BUILDING_SCALE*PAGODA_PLAN_SCALE,BUILDING_SCALE,BUILDING_SCALE*PAGODA_PLAN_SCALE]);
  for(const l of pagodaLevels){l.floor=pagodaScale.py(l.floor);l.roofY=pagodaScale.py(l.roofY);for(const k of ['w','roofW'])l[k]*=BUILDING_SCALE*PAGODA_PLAN_SCALE;for(const k of ['h','rise'])l[k]*=BUILDING_SCALE}
  pagFloor=pagodaScale.py(pagFloor);designChecks.pagoda.base=pagFloor;designChecks.pagoda.top=pagodaScale.py(designChecks.pagoda.top);designChecks.pagoda.roofWidths=pagodaLevels.map(l=>l.roofW);
  designChecks.pagoda.additionalPlanScale=PAGODA_PLAN_SCALE;designChecks.pagoda.planScaleFromPrevious=PAGODA_PLAN_REDUCTION;designChecks.pagoda.volumeRatioFromPrevious=PAGODA_VOLUME_RATIO;designChecks.pagoda.heightPreserved=true;designChecks.pagoda.position={x:pagX,z:pagZ};designChecks.pagoda.eaveExpansion=1.18;
  lantern(2.09,1.51,.32*BUILDING_SCALE);

  function rockGeometry(seed,detail=3){
    let g=new THREE.IcosahedronGeometry(1,detail);const p=g.attributes.position,cols=[];
    for(let i=0;i<p.count;i++){let x=p.getX(i),y=p.getY(i),z=p.getZ(i);const n=.10*Math.sin(x*5.8+seed)*Math.sin(z*4.1-seed*.7)+.045*Math.sin(y*16.+x*9.+seed);const chip=Math.min(1.,.81/(Math.abs(x*.52+y*.76+z*.23)+.001));x=Math.sign(x)*Math.pow(Math.abs(x),.79)*(1+n)*chip;z=Math.sign(z)*Math.pow(Math.abs(z),.80)*(1+n*.8)*chip;y=Math.sign(y)*Math.pow(Math.abs(y),.89)*(1+n*.55);y=Math.min(y,.75+.11*Math.sin(x*3.+seed));p.setXYZ(i,x,y,z);const mineral=.80+.16*Math.sin(x*8.+z*11.+seed)+.06*Math.sin(y*21.-x*18.);cols.push(mineral*.95,mineral,mineral*.96)}
    g.setAttribute('color',new THREE.Float32BufferAttribute(cols,3));g=mergeVertices(g,1e-5);g.computeVertexNormals();return g;
  }
  function rock(x,z,sx,sy,sz,seed){const y=terrainHeight(x,z);if(intersectsBuilding(x,z,Math.max(sx,sz)+.04,y-sy,y+sy*1.3))return false;builder.add(rockGeometry(seed,mobile?2:3),'#8b928c',[x,y+sy*.23,z],[rnd(-.18,.18),seed*.17,rnd(-.12,.12)],[sx,sy,sz],SURFACE.STONE,1);rockPlacements.push({x,z,r:Math.max(sx,sz),y});return true}
  // Embedded, asymmetric granite ledges; small rubble gathers in their seams.
  for(const side of [-1])for(let i=0;i<11;i++){const x=side*rnd(2.80,3.78),z=rnd(-1.02,.62);if(terrainHeight(x,z)>-.06)rock(x,z,rnd(.12,.31),rnd(.08,.19),rnd(.12,.28),rnd(0,90))}
  for(const p of [[-3.38,.58,.32,.14,.28],[-3.64,.19,.28,.16,.37],[-2.89,.87,.24,.11,.25]])rock(...p,rnd(0,90));
  for(let i=0;i<18;i++){const side=-1,x=side*rnd(2.69,3.9),z=rnd(-1.25,1.0),r=rnd(.022,.065);if(terrainHeight(x,z)>-.10)rock(x,z,r,r*.55,r*rnd(.75,1.4),rnd(0,90))}
  // Four-season flower succession, wisteria terraces and a walk-around flower island.
  // Structure and roots are permanent. Four opaque foliage meshes share those roots.
  const coastalGarden={pier:false,reclaimed:true,design:'四季花序 · 藤廊叠台 · 回游花岛 · 靠房花台扩建 · 主步道前缘填充',houseSideBedExpanded:true,mainWalkFrontageFilled:true,formerLawnReclaimed:true,houseSideServiceGap:.04,path:[],stairs:[],plants:[],flowerbeds:[],racks:[],footings:[],flowers:[],seasonNames:['春','夏','秋','冬'],seasonCounts:[0,0,0,0],seats:0,lantern:{x:2.09,z:1.51}};
  const flowerBuilders=Array.from({length:4},()=>new Builder());
  const GF={wood:'#49362b',edge:'#b2afa0',path:'#aaa99f',soil:'#655f49',green:'#536e46',silver:'#8b9a81'};
  const flowerRoutes=[{name:'露台接道',controls:coastLinks[0],width:.205},{name:'内侧花径',controls:coastWalkControls,width:.205},{name:'滨海回游径',controls:coastLoopControls,width:.19},{name:'登塔接道',controls:coastLinks[1],width:.205}];
  function flowerRouteHeight(x,z){return .286+.018*(1-smooth(2.145,2.42,x))-.006*smooth(-.87,-1.032,z)}
  function pavedFlowerRoute(route){
    const curve=new THREE.CatmullRomCurve3(route.controls.map(([x,z])=>new THREE.Vector3(x,0,z))),points=[],indices=[],count=Math.max(12,Math.ceil(curve.getLength()/.037));
    for(let i=0;i<=count;i++){
      const p=curve.getPoint(i/count),v=curve.getTangent(i/count),nx=-v.z,nz=v.x,top=flowerRouteHeight(p.x,p.z),edges=[];
      for(const s of [-1,1]){const x=p.x+nx*s*route.width/2,z=p.z+nz*s*route.width/2,ground=terrainHeight(x,z);points.push(x,top,z,x,Math.min(ground-.022,top-.018),z);edges.push({x,z,ground})}
      coastalGarden.path.push({route:route.name,x:p.x,z:p.z,top,width:route.width,minGround:Math.min(...edges.map(e=>e.ground)),maxGround:Math.max(...edges.map(e=>e.ground))});
      reserve(p.x,p.z,route.width*.55,route.width*.55,top-.04,top+.02,'flower garden circulation');
      if(i){const a=(i-1)*4,b=i*4;indices.push(a,a+2,b,a+2,b+2,b,a,b,a+1,a+1,b,b+1,a+2,a+3,b+2,a+3,b+3,b+2)}
      // Small spaced joints across the paving give scale without coplanar overlays.
      if(i>1&&i<count-1&&i%5===0){const joint=new THREE.BoxGeometry(route.width-.018,.002,.003);joint.rotateY(-Math.atan2(v.z,v.x)+Math.PI/2);builder.add(joint,'#85867b',[p.x,top+.0012,p.z],[0,0,0],[1,1,1],SURFACE.PAVING,0)}
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points,3));g.setIndex(indices);g.computeVertexNormals();builder.add(g,GF.path,[0,0,0],[0,0,0],[1,1,1],SURFACE.PAVING,topSnow);
  }
  flowerRoutes.forEach(pavedFlowerRoute);
  coastalGarden.loop={inner:coastWalkControls,outer:coastLoopControls,connectedEnds:[coastWalkControls[0],coastWalkControls.at(-1)],widths:[.205,.19]};
  const islandInner=new THREE.CatmullRomCurve3(coastWalkControls.map(([x,z])=>new THREE.Vector3(x,0,z))),islandOuter=new THREE.CatmullRomCurve3(coastLoopControls.map(([x,z])=>new THREE.Vector3(x,0,z))),islandOutline=[];
  for(let i=0;i<=30;i++){const t=.115+i/30*.770,p=islandInner.getPoint(t),v=islandInner.getTangent(t);islandOutline.push([p.x-v.z*.129,p.z+v.x*.129]);}
  for(let i=30;i>=0;i--){const t=.085+i/30*.825,p=islandOuter.getPoint(t),v=islandOuter.getTangent(t);islandOutline.push([p.x+v.z*.122,p.z-v.x*.122]);}
  // Build the merged sea-side bed from one clipped surface. Its perimeter is
  // recovered from the surface triangles and is also the retaining-wall edge.
  function mergedSeaFlowerbed(outline){
    const step=.012,pavingGap=.002;
    const x0=Math.min(...outline.map(p=>p[0]))-step,z0=Math.min(...outline.map(p=>p[1]))-step;
    const nx=Math.ceil((Math.max(...outline.map(p=>p[0]))-x0)/step)+1,nz=Math.ceil((Math.max(...outline.map(p=>p[1]))-z0)/step)+1;
    const vertices=[],fields=[],triangles=[],cuts=new Map();
    for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++){
      const x=x0+i*step,z=z0+j*step;
      vertices.push([x,terrainHeight(x,z)+.014,z]);
      fields.push(Math.min(-contourDistance(x,z,outline),hardscapeClearance(x,z)-pavingGap));
    }
    function cut(a,b){
      const key=a<b?a+':'+b:b+':'+a;if(cuts.has(key))return cuts.get(key);
      const t=clamp(fields[a]/(fields[a]-fields[b]),0,1),x=mix(vertices[a][0],vertices[b][0],t),z=mix(vertices[a][2],vertices[b][2],t);
      const id=vertices.length;vertices.push([x,terrainHeight(x,z)+.014,z]);fields.push(0);cuts.set(key,id);return id;
    }
    function clipped(a,b,c){
      const ids=[a,b,c],poly=[];
      for(let k=0;k<3;k++){const u=ids[k],v=ids[(k+1)%3];if(fields[u]>=0)poly.push(u);if((fields[u]>=0)!==(fields[v]>=0))poly.push(cut(u,v));}
      for(let k=1;k<poly.length-1;k++){
        const ids=[poly[0],poly[k],poly[k+1]],a=vertices[ids[0]],b=vertices[ids[1]],c=vertices[ids[2]];
        if(Math.abs((b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]))>1e-12)triangles.push(...ids);
      }
    }
    for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){const a=j*(nx+1)+i,b=a+1,d=a+nx+1,e=d+1;clipped(a,d,b);clipped(b,d,e);}
    const edges=new Map();
    for(let i=0;i<triangles.length;i+=3)for(let k=0;k<3;k++){
      const a=triangles[i+k],b=triangles[i+(k+1)%3],key=a<b?a+':'+b:b+':'+a;
      if(edges.has(key))edges.delete(key);else edges.set(key,[a,b]);
    }
    const next=new Map([...edges.values()]),loops=[];
    while(next.size){
      const start=next.keys().next().value,loop=[];let id=start;
      do{loop.push(id);const n=next.get(id);next.delete(id);id=n;}while(id!==undefined&&id!==start&&loop.length<=edges.size+1);
      if(id!==start)throw new Error('Merged flowerbed has an open surface edge');
      loops.push(loop);
    }
    loops.sort((a,b)=>polygonArea(b.map(i=>[vertices[i][0],vertices[i][2]]))-polygonArea(a.map(i=>[vertices[i][0],vertices[i][2]])));
    if(loops.length!==1)throw new Error('Merged flowerbed must have one continuous perimeter, found '+loops.length);
    const boundary=loops[0].map(i=>new THREE.Vector3(vertices[i][0],0,vertices[i][2]));
    const used=[...new Set(triangles)],remap=new Map(used.map((id,i)=>[id,i]));
    const groundGeometry=new THREE.BufferGeometry();groundGeometry.setAttribute('position',new THREE.Float32BufferAttribute(used.flatMap(id=>vertices[id]),3));groundGeometry.setIndex(triangles.map(id=>remap.get(id)));groundGeometry.computeVertexNormals();
    builder.add(groundGeometry,'#647449',[0,0,0],[0,0,0],[1,1,1],SURFACE.VEGETATION,.18);
    const signedArea=boundary.reduce((s,a,i)=>{const b=boundary[(i+1)%boundary.length];return s+a.x*b.z-b.x*a.z;},0),side=signedArea<0?1:-1;
    const ring=[],ringIndices=[],width=.022,wallAudit=[];
    for(let i=0;i<boundary.length;i++){
      const a=boundary[(i+boundary.length-1)%boundary.length],p=boundary[i],b=boundary[(i+1)%boundary.length];
      const n0=new THREE.Vector2(p.z-a.z,a.x-p.x).normalize().multiplyScalar(side),n1=new THREE.Vector2(b.z-p.z,p.x-b.x).normalize().multiplyScalar(side);
      const n=n0.clone().add(n1).normalize(),miter=width/Math.max(.5,n.dot(n1)),x=p.x+n.x*miter,z=p.z+n.y*miter;
      const ground=terrainHeight(p.x,p.z),innerGround=terrainHeight(x,z),low=Math.min(ground,innerGround)-.010,top=Math.max(ground,innerGround)+.054;
      ring.push(p.x,low,p.z,p.x,top,p.z,x,top,z,x,low,z);
      wallAudit.push({outer:[p.x,p.z],inner:[x,z],low,top,ground,innerGround,clearance:hardscapeClearance(p.x,p.z)});
    }
    for(let i=0;i<boundary.length;i++){
      const a=i*4,b=((i+1)%boundary.length)*4;
      ringIndices.push(a,b,a+1,a+1,b,b+1,a+1,b+1,a+2,a+2,b+1,b+2,a+2,b+2,a+3,a+3,b+2,b+3,a+3,b+3,a,a,b+3,b);
    }
    const wallGeometry=new THREE.BufferGeometry();wallGeometry.setAttribute('position',new THREE.Float32BufferAttribute(ring,3));wallGeometry.setIndex(ringIndices);wallGeometry.computeVertexNormals();
    builder.add(wallGeometry,'#a6a496',[0,0,0],[0,0,0],[1,1,1],SURFACE.PAVING,topSnow);
    // Sparse joints sit on the continuous wall cap, without duplicate kerbs.
    let distance=0;
    for(let i=0;i<boundary.length;i++){
      const p=boundary[i],q=boundary[(i+1)%boundary.length];distance+=p.distanceTo(q);
      if(distance<.070)continue;distance=0;
      const a=wallAudit[i];builder.beam([a.outer[0],a.top+.0003,a.outer[1]],[a.inner[0],a.top+.0003,a.inner[1]],.00055,'#85877b',SURFACE.PAVING);
    }
    const area=polygonArea(boundary.map(p=>[p.x,p.z]));
    landscapePatches.push({name:'海侧低花台',outline:boundary.map(p=>[p.x,p.z]),lift:.005,type:SURFACE.VEGETATION,kerb:true,minGround:Math.min(...wallAudit.map(p=>p.ground)),sharedSurfaceBoundary:true});
    coastalGarden.seaExpansion={mergedFrom:['海侧低花台','露台衔接花带'],removedSmallBed:true,filledSeaTriangle:true,sourceOutline:outline,boundary:boundary.map(p=>[p.x,p.z]),area,previousCombinedArea:.84455,pavingGap,wallWidth:width,closedLoops:loops.length,surfaceTriangles:triangles.length/3,wallSegments:boundary.length,wallAudit};
    return boundary;
  }
  // Only the seaward perimeter is interpolated. The path-facing perimeter is
  // still clipped to the existing ribbon, with the reclaimed corner retained.
  const seaEndT=.675,seaEnd=islandOuter.getPoint(seaEndT),seaTangent=islandOuter.getTangent(seaEndT);
  const seaOuterControls=[[2.195,.74],[2.195,1.28],[2.62,1.52],[3.01,1.52],[3.58,1.30],[4.02,.76],[4.14,.25],[4.08,-.29],[seaEnd.x-seaTangent.z*.29,seaEnd.z+seaTangent.x*.29]];
  const seaOuterCurve=new THREE.CatmullRomCurve3(seaOuterControls.map(([x,z])=>new THREE.Vector3(x,0,z)),false,'centripetal');
  const mergedSeaSource=seaOuterCurve.getPoints(240).map(p=>[p.x,p.z]);
  for(let i=70;i>=0;i--){const p=islandOuter.getPoint(seaEndT*i/70);mergedSeaSource.push([p.x,p.z]);}
  const mergedSeaBoundary=mergedSeaFlowerbed(mergedSeaSource);
  coastalGarden.seaExpansion.smoothSeaEdge=true;

  const flowerBedPlans=[
    // Pull the east edge toward the main walk to reclaim the continuous
    // lawn strip; the stepped points stop short of the route's clearance band.
    {name:'靠山高花台',outline:[[2.07,-.98],[2.68,-.91],[2.67,-.70],[2.61,-.54],[2.59,-.30],[2.55,-.06],[2.52,.18],[2.34,.42],[2.16,.49],[2.05,.26],[2.03,-.08],[2.04,-.56]],layer:'high'},
    {name:'中央回游花岛',outline:islandOutline,layer:'island',use:'entire island is a perennial flower bed; no lawn ring'},
    {name:'海侧低花台',outline:mergedSeaBoundary.map(p=>[p.x,p.z]),layer:'low',merged:true},
    {name:'登塔背景花带',outline:[[2.95,-1.07],[3.29,-1.00],[3.63,-.80],[3.84,-.43],[3.76,-.31],[3.47,-.62],[3.19,-.79],[2.99,-.91]],layer:'high'}
  ];
  const flowerBedContours=flowerBedPlans.map(b=>({...b,points:b.merged?mergedSeaBoundary:new THREE.CatmullRomCurve3(b.outline.map(([x,z])=>new THREE.Vector3(x,0,z)),true,'centripetal').getPoints(192),bounds:[Math.min(...b.outline.map(p=>p[0])),Math.max(...b.outline.map(p=>p[0])),Math.min(...b.outline.map(p=>p[1])),Math.max(...b.outline.map(p=>p[1]))]}));
  function flowerBedAt(x,z,radius=0){return flowerBedContours.find(b=>x>b.bounds[0]+radius&&x<b.bounds[1]-radius&&z>b.bounds[2]+radius&&z<b.bounds[3]-radius&&contourDistance(x,z,b.points)<-radius-.009);}
  for(const bed of flowerBedPlans){
    const edge=bed.merged?mergedSeaBoundary:landscapePatch(bed.name,bed.outline,.005,SURFACE.VEGETATION,'#647449',true,.18);
    coastalGarden.flowerbeds.push({...bed,boundary:edge.map(p=>[p.x,p.z]),grounded:true,area:polygonArea(bed.outline)});
  }
  // Continuous rooted groundcover fills the remaining garden, clipped to all paving.
  const coastalGroundCover={points:[],triangles:0},coverP=[],coverI=[],coverStep=.038,coverX0=2.03,coverNX=55,coverNZ=69;
  for(let j=0;j<=coverNZ;j++)for(let i=0;i<=coverNX;i++){
    const x=coverX0+i*coverStep,z=-1.12+j*coverStep;coverP.push(x,terrainHeight(x,z)+.005,z);
  }
  const coverClear=id=>{const x=coverP[id*3],z=coverP[id*3+2];return coastalPlantZone(x,z)&&terrainHeight(x,z)>.145&&hardscapeClearance(x,z)>.015};
  for(let j=0;j<coverNZ;j++)for(let i=0;i<coverNX;i++){const a=j*(coverNX+1)+i,b=a+1,d=a+coverNX+1,e=d+1;for(const tri of [[a,d,b],[b,d,e]])if(tri.every(coverClear))coverI.push(...tri)}
  // This coverage audit samples planting ground; its appearance is integrated into
  // the terrain shader, with a soft shore transition and no raised grid boundary.
  coastalGroundCover.terrainIntegrated=true;
  coastalGroundCover.triangles=coverI.length/3;coastalGarden.groundCover=coastalGroundCover;
  function gardenFooting(x,z,w,d,top,label){
    const corners=[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]],ground=corners.map(([dx,dz])=>terrainHeight(x+dx,z+dz)),low=Math.min(...ground)-.022;top=Math.max(top,Math.max(...ground)+.010);
    builder.box(x,(top+low)/2,z,w,top-low,d,GF.edge,SURFACE.PAVING,topSnow);
    coastalGarden.footings.push({x,z,w,d,low,top,minGround:Math.min(...ground),maxGround:Math.max(...ground),label});return top;
  }
  // Wisteria frames the main coastal walk.  Its canopy follows the path, while
  // the posts are offset to either side so no support lands in the walking band.
  // Move the frame to the inner-path segment before the two garden routes
  // converge; this keeps every support clear of both the main and loop walks.
  const arbor={x:2.72,z:-.22,width:.56,depth:.64,top:.86,angle:1.34,posts:[],racemes:24,clearWalkOffset:0,walkClearance:.205};
  const arborPoint=(u,v,y)=>[arbor.x+Math.cos(arbor.angle)*u+Math.sin(arbor.angle)*v,y,arbor.z-Math.sin(arbor.angle)*u+Math.cos(arbor.angle)*v];
  // Keep each support clearly outside the 205 mm walking ribbon.  The extra
  // lateral offset absorbs the walk's bend instead of letting a near post
  // clip the paving at the tangent change.
  const arborRotation=[0,arbor.angle,0],postU=.235,postV=.285;
  for(const u of [-postU,postU])for(const v of [-postV,postV]){
    const [x,,z]=arborPoint(u,v,0),y=terrainHeight(x,z),base=gardenFooting(x,z,.052,.052,Math.max(y+.014,.292),'wisteria post');
    builder.add(new THREE.BoxGeometry(.024,arbor.top-base,.030),GF.wood,[x,(base+arbor.top)/2,z],arborRotation,[1,1,1],SURFACE.WOOD);
    builder.add(new THREE.BoxGeometry(.043,.036,.046),GF.wood,arborPoint(u,v,arbor.top-.032),arborRotation,[1,1,1],SURFACE.WOOD);
    for(const s of [-1,1]){const [cx,cy,cz]=arborPoint(u+s*.018,v,arbor.top-.027);builder.cyl(cx,cy,cz,.003,.003,.025,'#8b7654',SURFACE.METAL,0,6);}
    arbor.posts.push({x,z,base,ground:y,u,v});reserve(x,z,.035,.035,y-.025,arbor.top+.10,'wisteria structure');
  }
  for(const u of [-postU,postU])builder.add(new THREE.BoxGeometry(.032,.038,arbor.depth),GF.wood,arborPoint(u,0,arbor.top),arborRotation,[1,1,1],SURFACE.WOOD);
  for(let i=0;i<6;i++){const v=-arbor.depth/2+.05+i*(arbor.depth-.10)/5;builder.add(new THREE.BoxGeometry(arbor.width,.029,.022),GF.wood,arborPoint(0,v,arbor.top+.027),arborRotation,[1,1,1],SURFACE.WOOD);}
  coastalGarden.arbor=arbor;
  // The open lattice moves to the opposite, seaward edge of the flower island.
  const lattice={a:[2.97,.78],b:[3.34,.63],height:.38,open:true,side:'seaward island rim',edgewardShift:.13};
  const la=new THREE.Vector3(lattice.a[0],terrainHeight(...lattice.a)+.022,lattice.a[1]),lb=new THREE.Vector3(lattice.b[0],terrainHeight(...lattice.b)+.022,lattice.b[1]);
  for(const p of [la,lb]){p.y=gardenFooting(p.x,p.z,.050,.052,p.y,'island lattice');builder.box(p.x,p.y+lattice.height/2,p.z,.023,lattice.height,.026,GF.wood,SURFACE.WOOD);reserve(p.x,p.z,.034,.034,p.y,p.y+lattice.height+.05,'side lattice');}
  const lv=lb.clone().sub(la);lattice.bases=[la.toArray(),lb.toArray()];
  for(const h of [.07,.21,.365])builder.beam(la.clone().add(new THREE.Vector3(0,h,0)).toArray(),lb.clone().add(new THREE.Vector3(0,h,0)).toArray(),.009,GF.wood,SURFACE.WOOD);
  for(let i=1;i<7;i++){const p=la.clone().addScaledVector(lv,i/7);builder.beam([p.x,p.y+.035,p.z],[p.x,p.y+.361,p.z],.0045,GF.wood,SURFACE.WOOD)}
  coastalGarden.lattice=lattice;
  // Six low racks, two groups, each with real shallow planting boxes and joinery.
  const rackPlans=[
    {x:2.78,z:1.17,w:.25,d:.095,h:.105,tiers:1,angle:-.24},
    {x:3.10,z:1.22,w:.28,d:.112,h:.177,tiers:2,angle:.18},
    {x:3.43,z:1.08,w:.23,d:.105,h:.135,tiers:1,angle:.52},
    {x:3.77,z:.62,w:.25,d:.110,h:.157,tiers:2,angle:1.05},
    {x:3.89,z:.33,w:.28,d:.097,h:.095,tiers:1,angle:1.36},
    {x:3.87,z:.02,w:.22,d:.112,h:.192,tiers:2,angle:1.58}
  ];
  function localRack(p,u,y,v){return [p.x+Math.cos(p.angle)*u+Math.sin(p.angle)*v,y,p.z-Math.sin(p.angle)*u+Math.cos(p.angle)*v]}
  function rackBox(p,u,y,v,w,h,d,c,type=SURFACE.WOOD){return builder.add(new THREE.BoxGeometry(w,h,d),c,localRack(p,u,y,v),[0,p.angle,0],[1,1,1],type,0)}
  const rackPlants=[];
  for(let i=0;i<rackPlans.length;i++){
    const p=rackPlans[i],corners=[];for(const u of [-p.w*.42,p.w*.42])for(const v of [-p.d*.35,p.d*.35]){const [x,,z]=localRack(p,u,0,v);corners.push(terrainHeight(x,z))}
    const base=Math.max(...corners)+.012,soilTops=[];
    for(const u of [-p.w*.42,p.w*.42])for(const v of [-p.d*.35,p.d*.35]){const [x,,z]=localRack(p,u,0,v),g=terrainHeight(x,z);gardenFooting(x,z,.029,.030,g+.012,'low flower rack foot');rackBox(p,u,(g+base+p.h-.015)/2,v,.016,base+p.h-.015-g,.018,GF.wood)}
    for(const t of p.tiers===2?[.48,1]:[1]){
      const y=base+p.h*t;soilTops.push(y+.011);
      rackBox(p,0,y-.024,0,p.w-.029,.013,p.d-.029,GF.wood);
      for(const s of [-1,1]){rackBox(p,0,y-.009,s*(p.d/2-.007),p.w,.027,.014,GF.wood);rackBox(p,s*(p.w/2-.007),y-.009,0,.014,.027,p.d-.028,GF.wood)}
      rackBox(p,0,y-.002,0,p.w-.029,.006,p.d-.029,GF.soil,SURFACE.PLASTER);
      for(let k=0;k<3;k++){const [x,,z]=localRack(p,(k-1)*p.w*.27,0,0);rackPlants.push({x,z,base:y+.006,kind:['bergenia','phlox','hellebore'][k],scale:t<1?.26:.75,seed:70+i*7+k,container:true})}
    }
    // Cross-bracing lives below the boxes, not across flowers or the walking surface.
    builder.beam(localRack(p,-p.w*.41,base+.02,0),localRack(p,p.w*.41,base+p.h*.65,0),.0045,GF.wood,SURFACE.WOOD);
    coastalGarden.racks.push({...p,base,soilTops,group:i<3?0:1,heightMetres:p.h/DESIGN_SCALE});
    reserve(p.x,p.z,p.w*.54,p.w*.48,base-.03,base+p.h+.11,'low flower rack');
  }
  // Species retain identity and root position across all four seasons.
  const plantSpecs={
    pittosporum:{h:.16,r:.090,habit:'shrub',evergreen:true,bloom:[],leaf:'#5a734d'},
    azalea:{h:.18,r:.090,habit:'shrub',evergreen:true,bloom:[0],colors:['#d18793','#d18793','#d18793','#d18793']},
    spiraea:{h:.20,r:.09,habit:'shrub',bloom:[0,1],colors:['#ece3ca','#e3c9db','#ece3ca','#ece3ca']},
    nandina:{h:.24,r:.070,habit:'shrub',evergreen:true,bloom:[1],fruit:true,leaf:'#738855',colors:['#e4dac4','#e4dac4','#e4dac4','#e4dac4']},
    camellia:{h:.34,r:.100,habit:'shrub',evergreen:true,bloom:[3],colors:['#af5764','#af5764','#af5764','#ac5666']},
    sasanqua:{h:.27,r:.085,habit:'shrub',evergreen:true,bloom:[2,3],colors:['#e2daca','#e2daca','#d294a2','#e7dcc7']},
    hydrangea:{h:.27,r:.10,habit:'hydrangea',bloom:[1],colors:['#8ea4ce','#87a6cf','#9f8797','#ad9b82']},
    bergenia:{h:.115,r:.049,habit:'rosette',evergreen:true,bloom:[0],colors:['#d6a2b3','#d6a2b3','#d6a2b3','#d6a2b3']},
    iris:{h:.225,r:.04,habit:'sword',bloom:[0,1],colors:['#a68dbb','#9184bd','#a68dbb','#a68dbb']},
    narcissus:{h:.145,r:.030,habit:'sword',bloom:[0,3],colors:['#eee0a2','#eee0a2','#eee0a2','#e8dfc8']},
    muscari:{h:.085,r:.028,habit:'sword',bloom:[0],colors:['#8879b6','#8879b6','#8879b6','#8879b6']},
    mossphlox:{h:.050,r:.043,habit:'rosette',evergreen:true,bloom:[0],colors:['#c994b4','#c994b4','#c994b4','#c994b4']},
    phlox:{h:.19,r:.042,habit:'stem',bloom:[1],colors:['#e6dccd','#e6dccd','#e6dccd','#e6dccd']},
    kikyo:{h:.18,r:.038,habit:'stem',bloom:[1],colors:['#9e86c0','#9e86c0','#9e86c0','#9e86c0']},
    daylily:{h:.20,r:.044,habit:'sword',bloom:[1],colors:['#dbc28b','#dbc28b','#dbc28b','#dbc28b']},
    hosta:{h:.105,r:.065,habit:'rosette',bloom:[1],leaf:'#8a9a79',colors:['#d1c6df','#d1c6df','#d1c6df','#d1c6df']},
    anemone:{h:.215,r:.042,habit:'stem',bloom:[2],colors:['#d6a9b6','#d6a9b6','#d6a9b6','#d6a9b6']},
    chrysanthemum:{h:.135,r:.048,habit:'stem',bloom:[2],colors:['#cfb56f','#cfb56f','#cfb56f','#cfb56f']},
    sedum:{h:.13,r:.046,habit:'rosette',bloom:[2],leaf:'#829082',colors:['#b47f93','#b47f93','#b47f93','#b47f93']},
    hellebore:{h:.095,r:.049,habit:'rosette',evergreen:true,bloom:[3],colors:['#c8adb7','#c8adb7','#c8adb7','#d6c6cb']},
    fern:{h:.10,r:.060,habit:'fern',evergreen:true,bloom:[],leaf:'#6b8059'},
    grass:{h:.22,r:.050,habit:'grass',bloom:[],leaf:'#9b9f7d'},
    viola:{h:.085,r:.029,habit:'rosette',bloom:[0,1],leaf:'#687b55',colors:['#b6a0c8','#cbb9d7','#b6a0c8','#b6a0c8']},
    aster:{h:.19,r:.040,habit:'stem',bloom:[2],colors:['#bda3c8','#bda3c8','#bda3c8','#bda3c8']},
    liriope:{h:.13,r:.047,habit:'sword',evergreen:true,bloom:[1,2],leaf:'#567149',colors:['#ab96be','#ab96be','#ab96be','#ab96be']},
    cyclamen:{h:.115,r:.037,habit:'rosette',bloom:[3],leaf:'#6b806d',colors:['#d5adb9','#d5adb9','#d5adb9','#d5adb9']}
  };
  // Solid lens leaves and cupped petals avoid alpha sorting and subpixel sheet edges.
  const leafLens=new THREE.SphereGeometry(1,7,4);
  function gardenLeaf(b,x,y,z,w,len,a,c,tilt=.32){b.add(leafLens,c,[x,y,z],[tilt,a,.17*Math.sin(a*1.7)],[w,.0035,len],SURFACE.VEGETATION,0)}
  function gardenBlade(b,x,y,z,h,reach,a,c,width=.009){
    const p=[],idx=[],rings=7;for(let j=0;j<=rings;j++){const t=j/rings,d=reach*t,yy=h*Math.sin(t*Math.PI*.56),ww=width*Math.sin(Math.PI*t)**.7;
      const cx=x+Math.cos(a)*d,cz=z+Math.sin(a)*d;p.push(cx-Math.sin(a)*ww,y+yy,cz+Math.cos(a)*ww,cx,y+yy+.003*Math.sin(Math.PI*t),cz,cx+Math.sin(a)*ww,y+yy,cz-Math.cos(a)*ww)}
    for(let j=0;j<rings;j++){const k=j*3;idx.push(k,k+3,k+1,k+1,k+3,k+4,k+1,k+4,k+2,k+2,k+4,k+5)}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex(idx);g.computeVertexNormals();b.add(g,c,[0,0,0],[0,0,0],[1,1,1],SURFACE.VEGETATION,0);
  }
  function gardenFlower(b,x,y,z,r,c,petals=5,normal=[0,1,0],layers=1){
    const vertices=[],indices=[],N=20,R=3;
    for(let j=0;j<=R;j++)for(let k=0;k<=N;k++){const t=j/R,a=k/N*TAU,rr=r*t*(.72+.28*Math.cos(petals*a));vertices.push(Math.cos(a)*rr,r*(.14*t*t+.12*Math.sin(petals*a)*t*t),Math.sin(a)*rr)}
    for(let j=0;j<R;j++)for(let k=0;k<N;k++){const a=j*(N+1)+k,d=a+N+1;indices.push(a,d,a+1,a+1,d,d+1)}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();
    const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(...normal).normalize());g.applyQuaternion(q);
    for(let layer=0;layer<layers;layer++)b.add(g,color(c).offsetHSL(0,0,.035*layer),[x,y+layer*.004,z],[0,layer*.63,0],[1-layer*.17,1,1-layer*.17],SURFACE.FLOWER,0);
    b.add(new THREE.SphereGeometry(r*.19,7,4),'#cfba78',[x,y+.005,z],[0,0,0],[1,.7,1],SURFACE.FLOWER,0);
  }
  function gardenStem(b,a,end,r=.0018,c='#657751'){b.beam(a,end,r,c,SURFACE.VEGETATION)}
  function growGardenPlant(p){
    const spec=plantSpecs[p.kind],sc=p.scale||1,h=spec.h*sc,rr=spec.r*sc,base=p.base??terrainHeight(p.x,p.z)+(p.forecourt?.023:.013),seed=p.seed||0;
    const footprint=rr*(spec.habit==='shrub'||spec.habit==='hydrangea'?1.42:spec.habit==='grass'?1.76:1.22)+.004,bed=p.container?null:p.forecourt?forecourtBeds.find(b=>contourDistance(p.x,p.z,b.boundary)<-footprint-.012):flowerBedAt(p.x,p.z,footprint);
    if(!p.container&&(!bed||!plantClearance(p.x,p.z,footprint+.012)||terrainHeight(p.x,p.z)<.15))return false;
    const record={...p,base,height:h,rx:rr,rz:rr,footprint,bed:bed?.name,bloom:spec.bloom};(p.forecourt?designChecks.forecourtPlanting.plants:coastalGarden.plants).push(record);
    if(!p.container)reserve(p.x,p.z,rr,rr,base-.026,base+h+.08,'four-season '+p.kind);
    const twig=spec.habit==='shrub'||spec.habit==='hydrangea';
    if(twig)for(let j=0;j<5;j++){const a=j*2.4+seed;builder.beam([p.x,base-.02,p.z],[p.x+Math.cos(a)*rr*.65,base+h*(.72+.17*Math.sin(j+seed)**2),p.z+Math.sin(a)*rr*.65],.0032,GF.wood,SURFACE.WOOD)}
    for(let season=0;season<4;season++){
      const b=flowerBuilders[season],winter=season===3,autumn=season===2,flowering=spec.bloom.includes(season),leafColor=winter?(spec.evergreen?p.leafColor||spec.leaf||'#4c684d':'#afa18b'):autumn?(p.kind==='nandina'?'#a67350':p.kind==='bergenia'?'#876959':p.leafColor||spec.leaf||'#788159'):p.leafColor||spec.leaf||GF.green;
      const visibleLeaves=spec.evergreen?1:winter?.12:autumn?.72:1;
      if(twig){
        const leafCount=spec.habit==='hydrangea'?16:27;
        for(let j=0;j<Math.round(leafCount*visibleLeaves);j++){const a=j*2.39996+seed,t=.38+.62*((j%7)/6);gardenLeaf(b,p.x+Math.cos(a)*rr*t,base+h*(.36+.48*Math.sin(j*1.6+seed)**2),p.z+Math.sin(a)*rr*t,rr*(p.kind==='camellia'?.21:.24),rr*.36,a,leafColor)}
      }else if(spec.habit==='sword'||spec.habit==='grass'){
        const count=spec.habit==='grass'?9:6;for(let j=0;j<(winter&&spec.habit!=='grass'&&p.kind!=='narcissus'?2:count);j++){
          const a=j*2.4+seed;gardenBlade(b,p.x,base,p.z,h*(.62+.18*Math.sin(a)**2)*(winter&&p.kind!=='narcissus'?.56:1),rr*(spec.habit==='grass'?1.65:1.1),a,leafColor,spec.habit==='grass'?.0035:.006);
          if(spec.habit==='grass'&&(autumn||winter)){const top=[p.x+Math.cos(a)*rr,base+h*(.91+.1*Math.sin(a)),p.z+Math.sin(a)*rr];gardenStem(b,[p.x,base,p.z],top);b.add(new THREE.SphereGeometry(1,5,3),'#b8ad8c',top,[0,0,.3],[.004,.022,.004],SURFACE.FLOWER,0)}
        }
      }else if(spec.habit==='fern'){
        for(let j=0;j<5;j++){const a=j*2.4+seed;for(let k=1;k<6;k++){const t=k/6;for(const s of [-1,1])gardenLeaf(b,p.x+Math.cos(a)*rr*t+Math.sin(a)*s*.007,base+h*Math.sin(t*Math.PI*.85),p.z+Math.sin(a)*rr*t+Math.cos(a)*s*.007,.008*(1-t*.6),.013,a+s*.65,leafColor)}}
      }else{
        for(let j=0;j<Math.round((spec.habit==='rosette'?7:5)*visibleLeaves);j++){const a=j*2.4+seed;gardenLeaf(b,p.x+Math.cos(a)*rr*.43,base+h*(spec.habit==='rosette'?.30:.22+j*.10),p.z+Math.sin(a)*rr*.43,rr*(p.kind==='hosta'?.46:.32),rr*.68,a,leafColor,p.kind==='hosta'?.44:.31)}
      }
      if(flowering){
        // Bloom intensity differs within a colony; buds and foliage show succession.
        const flowers=p.kind==='hydrangea'?3:twig?4:p.kind==='mossphlox'?5:p.dense?3+(Math.floor(seed)%3):2+(Math.floor(seed)%2),c=p.flowerColors?.[season]||p.flowerColor||(p.kind==='anemone'&&p.colony===17?'#e5decc':spec.colors[season]);
        for(let j=0;j<flowers;j++){
          const a=j*2.4+seed,reach=rr*.59,x=p.x+Math.cos(a)*reach,z=p.z+Math.sin(a)*reach,y=base+h*(.79+.16*Math.sin(a)**2);
          if(winter&&p.kind==='narcissus'&&Math.floor(seed)%3!==0)continue;
          gardenStem(b,[p.x,base+h*.22,p.z],[x,y,z],twig?.0021:.0017);
          if(Math.floor(seed)%5===0&&j===flowers-1){b.add(leafLens,color(c).lerp(color('#799061'),.42),[x,y,z],[.3,a,0],[.005,.008,.005],SURFACE.FLOWER,0);continue}
          if(p.kind==='hydrangea'){
            for(let k=0;k<13;k++){const a=k*2.399,ny=1-(k+.5)/13*1.5,nr=Math.sqrt(1-ny*ny),r=.047*sc;gardenFlower(b,x+Math.cos(a)*nr*r,y+ny*r,z+Math.sin(a)*nr*r,.016*sc,color(c).offsetHSL(0,0,(k%3-1)*.045),4,[Math.cos(a)*nr,ny,Math.sin(a)*nr]);}
          }else if(p.kind==='muscari'){
            for(let k=0;k<8;k++){const a=k*2.4;b.add(new THREE.SphereGeometry(1,6,4),c,[x+Math.cos(a)*.007,y+k*.005,z+Math.sin(a)*.007],[0,0,0],[.006,.006,.006],SURFACE.FLOWER,0)}
          }else if(p.kind==='iris'){
            for(let k=0;k<3;k++){const aa=a+k*TAU/3;gardenLeaf(b,x+Math.cos(aa)*.013,y+.017,z+Math.sin(aa)*.013,.010,.021,aa,c,-.95);gardenLeaf(b,x+Math.cos(aa)*.023,y-.010,z+Math.sin(aa)*.023,.012,.024,aa,c,.72);gardenStem(b,[x,y+.005,z],[x+Math.cos(aa)*.020,y-.004,z+Math.sin(aa)*.020],.0016,'#d3bd75')}
          }else if(p.kind==='chrysanthemum'){
            for(let layer=0;layer<3;layer++)for(let k=0;k<11;k++){const aa=k*TAU/11+layer*.27,r=(.022-layer*.005)*sc;gardenLeaf(b,x+Math.cos(aa)*r*.63,y+layer*.004,z+Math.sin(aa)*r*.63,.0045,r*.68,Math.PI/2-aa,color(c).offsetHSL(0,0,layer*.045),-.25)}
            b.sphere(x,y+.015,z,.004,'#baa76c',SURFACE.FLOWER,0);
          }else if(p.kind==='sedum'||p.kind==='spiraea'){
            for(let k=0;k<7;k++){const aa=k*2.4;gardenFlower(b,x+Math.cos(aa)*.017,y+.004*(k%3),z+Math.sin(aa)*.017,.008,c,5)}
          }else if(p.kind==='narcissus'){
            gardenFlower(b,x,y,z,.018*sc,c,6,[.2,.86,.4]);b.cyl(x,y+.008,z,.005,.004,.010,'#d1b85f',SURFACE.FLOWER,0,8);
          }else if(p.kind==='camellia'||p.kind==='sasanqua')gardenFlower(b,x,y,z,.025*sc,c,7,[Math.cos(a)*.65,.76,Math.sin(a)*.65],3);
          else gardenFlower(b,x,y,z,(twig?.021:p.kind==='daylily'?.023:p.dense?.022:.017)*sc,c,p.kind==='daylily'?6:5,[Math.cos(a)*.35,.94,Math.sin(a)*.35],p.kind==='azalea'?2:1);
          coastalGarden.seasonCounts[season]++;coastalGarden.flowers.push({season,kind:p.kind,x,y,z});
        }
      }else if(spec.habit==='stem'||spec.habit==='hydrangea'){
        for(let j=0;j<(winter?2:1);j++){const x=p.x+rr*.32,z=p.z+rr*.24,y=base+h*(winter?.67:.59);gardenStem(b,[p.x,base,p.z],[x,y,z],.0016,winter?'#93876e':'#74805a');b.sphere(x,y,z,spec.habit==='hydrangea'?.018:.005,winter?'#b3a389':'#8a8d64',SURFACE.VEGETATION,0)}
      }
      if(spec.fruit&&(autumn||winter))for(let j=0;j<9;j++){const a=j*2.4;b.sphere(p.x+Math.cos(a)*.022,base+h*(.75+(j%3)*.035),p.z+Math.sin(a)*.022,.0055,'#ac493c',SURFACE.FLOWER,0)}
    }return true;
  }
  // Deliberate colour territories: shaded ivory/coral, central mauve/blue, low gold/white.
  const colonies=[
    // House-side expansion: a continuous low fringe and cool-season accents
    // occupy the former lawn strip without crossing the adjacent walk.
    [2.10,-.78,.045,.11,'viola',8],[2.09,-.46,.045,.10,'bergenia',8],
    [2.10,-.12,.045,.10,'mossphlox',8],[2.14,.21,.045,.09,'hellebore',7],
    // New walk-facing infill follows the bend of the main route.
    [2.62,-.84,.035,.07,'muscari',7],[2.58,-.63,.035,.07,'viola',7],
    [2.55,-.39,.035,.07,'mossphlox',7],[2.52,-.14,.030,.06,'cyclamen',6],
    [2.31,-.67,.10,.15,'bergenia',9],[2.31,-.31,.11,.15,'fern',8],[2.33,.08,.10,.12,'hellebore',8],
    [2.44,1.08,.11,.09,'narcissus',9],[2.55,1.12,.06,.11,'mossphlox',7],
    [2.94,.38,.10,.13,'hosta',6],[3.09,.43,.12,.10,'iris',8],[3.28,.29,.10,.12,'kikyo',9],
    [3.14,.11,.12,.12,'anemone',10],[2.91,.10,.08,.12,'bergenia',7],[3.09,-.17,.11,.07,'hellebore',7],
    [2.88,1.23,.14,.06,'mossphlox',9],[3.21,1.11,.13,.06,'daylily',7],[3.48,.94,.11,.07,'chrysanthemum',9],
    [3.76,.68,.06,.14,'phlox',8],[3.83,.24,.06,.11,'sedum',9],[3.82,-.05,.05,.09,'narcissus',6],
    [3.26,-.88,.14,.07,'anemone',8],[3.55,-.70,.13,.09,'iris',7],[3.73,-.47,.08,.09,'grass',4],
    [2.31,-.83,.07,.07,'muscari',7],[3.25,.51,.07,.07,'muscari',6],[3.44,1.12,.08,.06,'hellebore',6],
    [3.03,.57,.10,.06,'phlox',6],[3.68,.89,.07,.09,'bergenia',6]
  ];
  const acceptedRoots=[];
  for(let ci=0;ci<colonies.length;ci++){
    const [cx,cz,rx,rz,kind,target]=colonies[ci];let n=0;
    for(let k=0;k<280&&n<target;k++){
      const a=k*2.39996+ci*.79,t=Math.sqrt(((k*.618033+ci*.17)%1)),x=cx+Math.cos(a)*rx*t,z=cz+Math.sin(a)*rz*t,pad=plantSpecs[kind].r*.88;
      if(!plantClearance(x,z,pad+.030)||terrainHeight(x,z)<.13||acceptedRoots.some(p=>Math.hypot(x-p.x,z-p.z)<.052))continue;
      const p={x,z,kind,scale:.83+.25*((k*.4142)%1),seed:ci*3.1+k*.71,colony:ci};if(growGardenPlant(p)){acceptedRoots.push(p);n++;}
    }
  }
  const shrubPlans=[
    [2.14,-.78,'sasanqua',.48],[2.13,-.24,'azalea',.52],[2.16,.24,'camellia',.46],
    [2.31,-.48,'camellia',1],[2.31,-.08,'azalea',.85],[2.35,-.86,'sasanqua',.82],
    [3.15,.29,'hydrangea',1.0],[3.31,.07,'hydrangea',.88],[2.94,-.12,'nandina',.85],
    [3.12,-.30,'pittosporum',.87],[3.35,-.83,'sasanqua',1.0],[3.65,-.60,'nandina',.93],
    [2.70,1.15,'azalea',.72],[3.04,1.28,'pittosporum',.72],[3.61,.89,'spiraea',.78]
  ];
  for(let i=0;i<shrubPlans.length;i++){const [x,z,kind,scale]=shrubPlans[i];if(plantClearance(x,z,plantSpecs[kind].r*scale+.025))growGardenPlant({x,z,kind,scale,seed:90+i*2.19,flowerColor:kind==='hydrangea'?(i===4?'#b291bb':'#88a8cf'):undefined})}
  growGardenPlant({x:3.25,z:.42,kind:'hydrangea',scale:.70,seed:121.5,flowerColor:'#e1ded0'});
  const infillRoots=[];
  for(let j=0;j<37;j++)for(let i=0;i<30;i++){
    const seed=i*1.731+j*2.37,x=2.05+i*.070+.011*Math.sin(seed),z=-1.08+j*.070+.012*Math.cos(seed*1.21);
    if(!coastalPlantZone(x,z)||terrainHeight(x,z)<.155||!plantClearance(x,z,.057))continue;
    if(coastalGarden.footings.some(p=>Math.abs(x-p.x)<p.w/2+.027&&Math.abs(z-p.z)<p.d/2+.027))continue;
    const kind=x<2.60?(z<-.15?'fern':'hosta'):z>1.03?(x<3.13?'mossphlox':'chrysanthemum'):x>3.60?(z>.45?'phlox':z>.02?'sedum':'hellebore'):z<-.64?'anemone':'bergenia';
    const scale=kind==='chrysanthemum'?.75:kind==='hosta'?.86:kind==='anemone'?.73:.82,radius=plantSpecs[kind].r*scale;
    if(intersectsBuilding(x,z,radius+.009,terrainHeight(x,z)+.01,terrainHeight(x,z)+plantSpecs[kind].h*scale+.032))continue;
    if(infillRoots.some(p=>Math.hypot(x-p.x,z-p.z)<.061))continue;
    const p={x,z,kind,scale,seed:201+seed,colony:40+j};if(growGardenPlant(p))infillRoots.push(p);
  }
  coastalGarden.infillPlants=infillRoots.length;
  // A connected low flower matrix occupies the full island, including its former lawn rim.
  let islandMatrixPlants=0;
  for(let j=0;j<24;j++)for(let i=0;i<15;i++){
    const seed=311+i*2.37+j*1.71,x=2.72+i*.059+.009*Math.sin(seed),z=-.65+j*.060+.008*Math.cos(seed*1.3);
    const kinds=z>.39?['muscari','mossphlox','bergenia','hellebore']:x>3.22?['kikyo','chrysanthemum','hellebore','mossphlox']:['bergenia','iris','anemone','hellebore'];
    const kind=kinds[(i+Math.floor(j/3))%kinds.length],scale=kind==='iris'||kind==='anemone'?.70:.89;
    if(!flowerBedAt(x,z,plantSpecs[kind].r*scale*1.25+.010)||flowerBedAt(x,z)?.layer!=='island')continue;
    if(coastalGarden.plants.some(p=>!p.container&&Math.hypot(x-p.x,z-p.z)<.052))continue;
    if(coastalGarden.footings.some(p=>Math.abs(x-p.x)<p.w/2+.045&&Math.abs(z-p.z)<p.d/2+.045))continue;
    if(growGardenPlant({x,z,kind,scale,seed,colony:80+Math.floor(j/6)}))islandMatrixPlants++;
  }
  coastalGarden.islandMatrixPlants=islandMatrixPlants;coastalGarden.islandNoLawn=true;
  // A quiet Japanese forecourt: two asymmetrical drifts with breathing space.
  const forecourtRoots=[];
  const quietGroups=[[-.86,1.73,'azalea',.68],[-.40,1.73,'pittosporum',.57],[-.53,1.82,'nandina',.48],[.89,1.690,'pittosporum',.58],[1.12,1.630,'azalea',.64],[1.32,1.610,'nandina',.66],[1.64,1.580,'sasanqua',.52],[1.76,1.590,'fern',.70]];
  for(let i=0;i<quietGroups.length;i++){const [x,z,kind,scale]=quietGroups[i];const p={x,z,kind,scale,seed:601+i*2.19,forecourt:true,flowerColor:i%2?'#c9b7bb':'#d4c6b4'};if(growGardenPlant(p))forecourtRoots.push(p);}
  // Low evergreen groundcovers fill the enlarged round end without covering its edge.
  const forecourtRoundEndPlants=[
    [1.50,1.535,'hosta',.60],[1.53,1.625,'fern',.65],
    [1.59,1.645,'liriope',.60],[1.67,1.535,'bergenia',.60],
    [1.715,1.648,'bergenia',.56],[1.755,1.535,'liriope',.54]
  ];
  let forecourtRoundEndAdded=0;
  for(let i=0;i<forecourtRoundEndPlants.length;i++){
    const [x,z,kind,scale]=forecourtRoundEndPlants[i];
    if(forecourtRoots.some(p=>Math.hypot(x-p.x,z-p.z)<.052))continue;
    const p={x,z,kind,scale,seed:1301+i*2.19,forecourt:true,roundEnd:true,leafColor:i%2?'#63744e':'#77846c'};
    if(growGardenPlant(p)){forecourtRoots.push(p);forecourtRoundEndAdded++;}
  }
  designChecks.forecourtPlanting.roundEnd={requested:forecourtRoundEndPlants.length,added:forecourtRoundEndAdded,lowPlanting:true};
  for(let i=0;i<500;i++){
    const x=-1.08+2.75*((i*.61803398875)%1),z=1.48+.43*((i*.41421356237+.07)%1),seed=641+i*.731;
    const kind=i%8===0?'bergenia':i%5===0?'hosta':i%3===0?'liriope':'fern',scale=kind==='fern'?.70:kind==='hosta'?.64:.76;
    if(forecourtRoots.some(p=>Math.hypot(x-p.x,z-p.z)<(plantSpecs[p.kind].habit==='shrub'?plantSpecs[p.kind].r*(p.scale||1)*.80+.025:.052)))continue;
    const p={x,z,kind,scale,seed,forecourt:true,leafColor:i%3===0?'#77846c':'#63744e'};if(growGardenPlant(p))forecourtRoots.push(p);
    if(forecourtRoots.length>=44)break;
  }
  designChecks.forecourtPlanting.plantCount=forecourtRoots.length;
  // Dense but legible drifts, with low fringes and taller perennial spires behind.
  const denseRoots=[];const beforeDense=coastalGarden.plants.length;
  for(let k=0;k<5200;k++){
    const x=2.19+1.94*((k*.7548776662+.13)%1),z=-1.07+2.56*((k*.5698402963+.11)%1),bed=flowerBedAt(x,z,.040);if(!bed||!plantClearance(x,z,.046)||terrainHeight(x,z)<.155)continue;
    if(coastalGarden.footings.some(p=>Math.abs(x-p.x)<p.w/2+.040&&Math.abs(z-p.z)<p.d/2+.040))continue;
    const depth=-contourDistance(x,z,bed.points),phase=Math.floor((z+1.12)/.22)+Math.floor((x-2.2)/.27),inner=depth>.105;
    const group=bed.layer==='island'?(inner?['iris','kikyo','anemone','hellebore','bergenia','aster']:['viola','mossphlox','cyclamen','sedum']):bed.layer==='high'?(inner?['iris','phlox','anemone','aster','hellebore']:['bergenia','viola','narcissus','muscari']):inner?['daylily','narcissus','chrysanthemum','phlox','hellebore']:['mossphlox','viola','cyclamen','sedum'];
    const kind=group[(phase+Math.floor(k/11))%group.length],scale=inner?.88+.16*((k*.381966)%1):.70+.15*((k*.381966)%1),radius=plantSpecs[kind].r*scale;
    if(coastalGarden.plants.some(p=>!p.container&&Math.hypot(x-p.x,z-p.z)<(plantSpecs[p.kind].habit==='shrub'||plantSpecs[p.kind].habit==='hydrangea'?p.rx*.68+radius*.65:.047)))continue;
    const colorTerritory=bed.layer==='island'?['#b79bc7','#d0adc2','#a99bcc','#ded3dc']:bed.layer==='high'?['#d3a0a8','#dfc7b4','#eadfcb','#b8afcf']:x<3.18?['#e4d2aa','#e9dfc7','#cfb786','#d7bbbf']:['#c5b1d1','#e3d8c5','#d2afbf','#b6aec8'];
    const flowerColor=['viola','mossphlox','phlox','anemone','aster','cyclamen','hellebore'].includes(kind)?colorTerritory[phase%4]:undefined;
    const p={x,z,kind,scale,seed:901+k*.712,colony:120+phase,dense:true,flowerColor};if(growGardenPlant(p))denseRoots.push(p);
    if(denseRoots.length>=260)break;
  }
  // A handful of woody accents make the flower matrix spatially legible.
  let addedShrubs=0;for(const [x,z,kind,scale] of [[2.35,-.73,'azalea',.63],[3.02,.05,'sasanqua',.70],[3.41,.20,'nandina',.61],[3.88,.43,'pittosporum',.57],[3.63,-.69,'sasanqua',.60]]){
    if(growGardenPlant({x,z,kind,scale,seed:1101+x*8+z*11,dense:true}))addedShrubs++;
  }
  coastalGarden.densification={before:beforeDense,added:denseRoots.length,addedShrubs,territorialColours:true,lowSeaEdge:true,fixedLayout:true};
  const seaExpansionRoots=[];
  for(let j=0;j<17;j++)for(let i=0;i<12;i++){
    const x=2.22+i*.037,z=.87+j*.038,bed=flowerBedAt(x,z,.029);
    if(!bed?.merged||coastalGarden.plants.some(p=>!p.container&&Math.hypot(x-p.x,z-p.z)<.038))continue;
    const kind=['mossphlox','viola','sedum','cyclamen'][(i+Math.floor(j/3))%4],p={x,z,kind,scale:.57,seed:1501+i*1.73+j*2.19,seaExpansion:true,flowerColor:(i+j)%2?'#e9dfc7':'#d7bbbf'};
    if(growGardenPlant(p))seaExpansionRoots.push(p);
  }
  coastalGarden.seaExpansion.newLowPlants=seaExpansionRoots.length;
  rackPlants.forEach(growGardenPlant);
  // Small pendulous sprays root inside the upper boxes, remaining beneath rack height.
  for(let i=0;i<coastalGarden.racks.length;i++)if(i===1||i===3||i===5){const p=coastalGarden.racks[i],root=localRack(p,p.w*.28,p.soilTops.at(-1)-.01,p.d*.38);
    for(let s=0;s<4;s++)for(let season=0;season<4;season++){
      const b=flowerBuilders[season],end=[root[0]+.028*Math.sin(s*2.4),root[1]-.055-s*.007,root[2]+.033];gardenStem(b,root,end,.0017);
      for(let j=1;j<=4;j++){const t=j/4;gardenLeaf(b,mix(root[0],end[0],t),mix(root[1],end[1],t),mix(root[2],end[2],t),.006,.012,s*2.4,season===3?'#5e755b':'#819776')}
    }
  }
  // Climbing stems remain through winter; spring racemes and summer pods attach to them.
  for(const s of [-1,1]){
    const u=s*.235,v=-arbor.depth/2+.04,[x,,z]=arborPoint(u,v,0),base=terrainHeight(x,z),vine=[];
    for(let j=0;j<=14;j++){const t=j/14;vine.push(arborPoint(u+.018*Math.sin(t*TAU*1.7),v+.018*Math.cos(t*TAU*1.7),mix(base,arbor.top+.045,t)))}tube(vine,.0048,'#706046',SURFACE.WOOD);
    tube([arborPoint(u,v,arbor.top+.045),arborPoint(s*.14,0,arbor.top+.049),arborPoint(s*.20,arbor.depth/2-.04,arbor.top+.045)],.0045,'#706046',SURFACE.WOOD);
  }
  for(let j=0;j<24;j++){
    const side=j%2?1:-1,u=side*(.16+.020*Math.sin(j*1.7)),v=-arbor.depth/2+.04+Math.floor(j/2)*.044,top=arbor.top+.04,len=.155+(j%4)*.026;
    const anchorV=-arbor.depth/2+.04+Math.round((v+arbor.depth/2-.04)/.102)*.102,[x,,z]=arborPoint(u,v,top),anchor=arborPoint(side*.235,anchorV,arbor.top+.018);
    tube([anchor,arborPoint(u,v,top+.008),arborPoint(u+side*.038,v+.018,top+.023)],.0028,'#776b49',SURFACE.WOOD);
    for(let season=0;season<4;season++){
      const b=flowerBuilders[season];
      if(season!==3)for(let fan=0;fan<3;fan++){
        const a=j*.79+fan*1.70,reach=.108,tipLocal=[u+Math.cos(a)*reach,v+Math.sin(a)*reach],tip=arborPoint(tipLocal[0],tipLocal[1],top+.012+.026*Math.sin(j));gardenStem(b,[x,top,z],tip,.0016);
        for(let k=1;k<=4;k++)for(const s of [-1,1]){const t=k/5,px=mix(x,tip[0],t)-Math.sin(a)*s*.018,py=mix(top,tip[1],t),pz=mix(z,tip[2],t)+Math.cos(a)*s*.018;gardenLeaf(b,px,py,pz,.013,.030,a+s*.78,season===2?'#b2a05a':k%2?'#52754b':'#7d9760')}
        gardenLeaf(b,...tip,.014,.033,a,season===2?'#b7ad64':'#62834f');
      }
      if(season===0){const drop=arborPoint(u+.004,v+.006,top-len);gardenStem(b,[x,top,z],drop,.0023);for(let k=0;k<13;k++){const t=k/13,a=k*2.4,rr=.024*(1-t*.6);gardenFlower(b,drop[0]+Math.cos(a)*rr,top-.022-len*t,drop[2]+Math.sin(a)*rr,.025*(1-t*.66),j%4===0?'#d7c5df':'#a786c1',5,[Math.cos(a)*.75,-.38,Math.sin(a)*.75])}coastalGarden.seasonCounts[0]++}
      if(season===1&&j%3===0){const drop=arborPoint(u+.003,v,top-.07);gardenStem(b,[x,top,z],drop,.002);b.add(leafLens,'#8a9072',[drop[0],top-.054,drop[2]],[0,0,.1],[.005,.030,.005],SURFACE.VEGETATION,0)}
    }
  }
  // Airy side climber, not an opaque plant wall.
  for(let j=0;j<5;j++){
    const t=(j+.5)/5,p=la.clone().addScaledVector(lv,t),vine=[[p.x,p.y,p.z],[p.x+.012,p.y+.17,p.z-.008],[p.x-.01,p.y+.32,p.z+.016]];tube(vine,.0028,'#716b4e',SURFACE.WOOD);
    for(let season=0;season<3;season++)for(let k=0;k<5;k++){const a=j*2.4+k;gardenLeaf(flowerBuilders[season],p.x+.021*Math.sin(a),p.y+.08+k*.052,p.z+.018*Math.cos(a),.015,.023,a,season===2?'#9e9562':'#769260');if(season===1&&k===4)gardenFlower(flowerBuilders[season],p.x,p.y+.31,p.z,.018,'#c3b4d2',5)}
  }
  // Edge ferns soften beds while all paved thresholds remain entirely clear.
  coastalGarden.masterplan={fixedPlantPositions:true,flowerTerritories:['山侧象牙白与珊瑚粉','花岛蓝紫与柔粉','海侧杏黄奶白','登塔秋粉与茶红'],layers:flowerBedPlans.map(b=>b.name),loop:true,lowRacks:6,groups:2,openSeaView:true,perennialPlants:acceptedRoots.length};
  for(let k=0;k<14;k++){const x=2.82,z=-1.03-k*.13;let minGround=Infinity,maxGround=-Infinity;for(const dx of [-.135,0,.135])for(const dz of [-.0675,0,.0675]){const y=terrainHeight(x+dx,z+dz);minGround=Math.min(minGround,y);maxGround=Math.max(maxGround,y)}coastalGarden.stairs.push({x,z,top:.28+k*.046,minGround,maxGround});}

  designChecks.waterfront={east:'four-season loop garden on one graded headland',west:'granite coast',well:false,clearAccess:true,coastalGarden};

  // The spring emerges between embedded mountain stones, without a built grotto.
  const source=springNodes[0];
  for(const [dx,dz,rx,ry,rz] of [[-.17,-.035,.14,.11,.17],[.14,-.09,.12,.09,.15]]){
    const x=source[0]+dx,z=source[1]+dz,y=terrainHeight(x,z);
    builder.add(rockGeometry(48+dx*10,3),'#737f70',[x,y+ry*.20,z],[0,dx*2.,0],[rx,ry,rz],SURFACE.STONE,topSnow);
  }
  reserve(source[0],source[1],.30,.22,source[2]-.15,source[2]+.28,'spring source');
  const naturalStreamDetails={bankStones:[],mossPatches:[],crossSection:'asymmetric eroded bowl',uniformBankWall:false,poolRiffle:true};
  // Unequal clusters sit partly in the stream and partly under the moss bank.
  for(const [flow,side,size,count] of [[.42,-1,.077,2],[1.16,1,.068,1],[1.91,-1,.081,2],[2.50,1,.060,1],[3.17,1,.072,2],[4.09,-1,.070,1],[5.12,1,.059,2],[6.01,-1,.064,1]]){
    const nodes=springCourses[0].nodes,index=nodes.findIndex(n=>n[4]>=flow);if(index<1)continue;const a=nodes[index-1],b=nodes[index],s=sampleCourse(b[0],b[1],0);
    for(let j=0;j<count;j++){const lateral=side*(s.width*(j===0?.85:1.18)),x=s.x-s.dz*lateral+s.dx*j*.085,z=s.z+s.dx*lateral+s.dz*j*.085,y=terrainHeight(x,z),ry=size*.60;
      if(intersectsBuilding(x,z,size+.025,y-ry,y+ry))continue;
      builder.add(rockGeometry(73+flow*11+j,3),'#788272',[x,y+ry*.18,z],[Math.atan(s.slope)*.38,Math.atan2(s.dz,s.dx)+j*.8,0],[size,ry,size*(j?.78:1.30)],SURFACE.STONE,topSnow);
      naturalStreamDetails.bankStones.push({x,z,bottom:y-ry*.82,ground:y,side});
    }
    const lateral=side*(s.width+.075),x=s.x-s.dz*lateral,z=s.z+s.dx*lateral,y=terrainHeight(x,z);
    if(!intersectsBuilding(x,z,.13,y-.015,y+.05)){
      // Use the existing bank surface here, without an intersecting decorative patch.
      if(flow===4.09)continue;
      const pts=[],idx=[],rings=5,segments=24;
      for(let k=0;k<=rings;k++)for(let j=0;j<=segments;j++){const t=k/rings,a=j/segments*TAU,lobe=1+.14*Math.sin(a*3+flow),px=x+Math.cos(a)*.105*t*lobe,pz=z+Math.sin(a)*.080*t*lobe;pts.push(px,terrainHeight(px,pz)-.002+.022*(1-t*t),pz)}
      for(let k=0;k<rings;k++)for(let j=0;j<segments;j++){const i=k*(segments+1)+j;idx.push(i,i+segments+1,i+1,i+1,i+segments+1,i+segments+2)}
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pts,3));g.setIndex(idx);g.computeVertexNormals();builder.add(g,'#536b40',[0,0,0],[0,0,0],[1,1,1],SURFACE.VEGETATION,topSnow);naturalStreamDetails.mossPatches.push({x,z});
    }
  }
  Object.assign(designChecks.spring,naturalStreamDetails);
  // The source continues into a natural edge stream; no obsolete garden spouts.

  // Broadleaf, sakura, maple, black pine, hinoki/cedar, and evergreen azalea.
  // Every candidate is tested with its FULL crown and branch envelope.
  const trees=[],blobs=[],headlandSeeds=[],featureTrees=[],treeJunctions={tips:[],roots:[]};
  function treeSeed(x,z,size,kind,feature=false,lean=0){
    const spring=springSample(x,z);if(spring.distance<spring.width+.13+size*.18)return false;
    const y=terrainHeight(x,z),phase=rnd(0,TAU),top=y+size*(kind===4?1.0:.85),specs=[];
    const count=kind===1?7:kind===3?5:kind===4?4:5;
    for(let j=0;j<count;j++){
      const a=phase+j*2.39996,t=j/(count-1),r=size*(kind===3?.18:kind===4?.22*(1-t*.59):kind===1?.155+.032*Math.sin(j*2.1)**2:kind===2?.18:.19);
      const reach=size*(kind===4?.045:kind===3?.22:kind===1?.235:.19),bx=x+lean+Math.cos(a)*reach*(.60+.40*Math.sin(j*1.71)**2),bz=z+Math.sin(a)*reach*(.70+.22*Math.cos(j*1.2));
      const by=kind===4?y+size*(.36+t*.56):kind===3?y+size*(.46+t*.39):y+size*(.67+.26*Math.sin(j*1.43+phase)**2),sy=kind===3?.33:kind===4?1.00:kind===2?.56:kind===1?.63:kind===5?.54:.78;
      specs.push({x:bx,y:by,z:bz,r,kind,seed:rnd(0,1000),ao:1,sy});
    }
    const trunkR=Math.abs(lean)*.55+.03;if(intersectsBuilding(x+lean*.5,z,trunkR,y-.02,top+.025))return false;
    for(const b of specs)if(intersectsBuilding(b.x,b.z,b.r+.045,b.y-b.r*b.sy-.02,b.y+b.r*b.sy+.02))return false;
    const seed={x,y,z,size,kind,feature,lean,phase,crowns:specs};trees.push(seed);if(feature)featureTrees.push(seed);
    const stem=[x+lean*.46,y+size*.43,z+.024],leader=specs.reduce((a,b)=>b.y>a.y?b:a),trunkRadius=.017*Math.max(.65,size);
    treeJunctions.roots.push({...treeRootCollar(x,z,trunkRadius,'#514432'),tree:trees.length-1});
    builder.beam([x,y-.035,z],stem,trunkRadius,'#514432');
    // End grain must remain inside the actual crown, including winter contraction.
    const terminal=(start,end,r,c,crown)=>{const part=builder.parts.length;builder.beam(start,end,r,c);treeJunctions.tips.push({part,start,end,r,crown,tree:trees.length-1})};
    terminal(stem,[leader.x,leader.y-leader.r*leader.sy*.10,leader.z],.012*size,'#685340',leader);
    for(const [j,b] of specs.entries()){
      blobs.push(b);const joint=[mix(stem[0],b.x,.55),Math.min(y+size*(.50+.07*(j%3)),b.y-b.r*b.sy*.18),mix(stem[2],b.z,.47)];
      builder.beam(stem,joint,.0065*size,'#625039');
      terminal(joint,[b.x,b.y-b.r*b.sy*.10,b.z],.0044*size,'#716049',b);
      if(feature)terminal(joint,[b.x+b.r*.16,b.y-b.r*b.sy*.08,b.z+b.r*.10],.0048,'#72634a',b);
    }
    return true;
  }
  let attempts=0;while(trees.length<340&&attempts++<19000){const x=rnd(-3.57,3.38),z=rnd(-4.10,-1.30),h=terrainHeight(x,z);if(h<.24||terrainSlope(x,z)>3.5)continue;let kind;
    const roll=rand();if(h>1.50)kind=roll<.36?3:roll<.64?4:roll<.82?0:2;else kind=roll<.22?1:roll<.43?2:roll<.56?4:0;const size=rnd(.32,kind===4?.72:.60);if(trees.some(t=>Math.hypot(t.x-x,t.z-z)<.155+Math.min(size,t.size)*.12))continue;treeSeed(x,z,size,kind);
  }
  for(const p of [[-2.99,-1.33],[2.99,-1.32],[-1.49,-2.3],[-.20,-2.10],[-2.62,-2.67]])treeSeed(p[0],p[1],.75,1,true,p[0]<0?-.06:.06);
  for(const p of [[-3.28,-.30],[-3.58,-.61]]){if(treeSeed(p[0],p[1],rnd(.72,.94),3,true,Math.sign(p[0])*.19))headlandSeeds.push(trees.at(-1))}
  for(const p of [[2.85,-2.87],[-1.90,-3.23],[-.83,-2.84]])treeSeed(p[0],p[1],.73,2,true,rnd(-.04,.04));
  for(let i=0;i<24;i++){const x=rnd(-3.4,3.3),z=rnd(-2.7,-.95);if(terrainHeight(x,z)>.04&&terrainSlope(x,z)<1.7)treeSeed(x,z,rnd(.15,.25),5)}
  // Fern fans and sedge blades in the understory; geometry follows the ground.
  let rearCoverageTrees=0;
  for(let row=0;row<5;row++)for(let col=0;col<2;col++){
    const x=-1.61+(col-.5)*.38+rnd(-.055,.055),z=-2.22-row*.28+rnd(-.055,.055);
    if(treeSeed(x,z,rnd(.31,.48),row%3===0?4:row%3===1?2:0))rearCoverageTrees++;
  }
  let groundPlants=0;
  for(let i=0;i<610;i++){
    const x=rnd(-3.8,3.65),z=rnd(-3.65,-.50),y=terrainHeight(x,z);if(y<.025||terrainSlope(x,z)>2.5||!plantClearance(x,z,.18)||intersectsBuilding(x,z,.15,y,y+.23))continue;
    const fern=i%3===0,positions=[],indices=[];for(let f=0;f<(fern?7:5);f++){
      const a=f*TAU/(fern?7:5)+rnd(-.25,.25),len=rnd(.06,.16),start=positions.length/3;
      for(let k=0;k<=7;k++){const t=k/7,dist=len*t,hy=(fern?.10:.16)*Math.sin(Math.PI*t*.85),width=(fern?.019:.008)*Math.sin(Math.PI*t)*(fern?(.68+.32*Math.cos(t*45.)):1);const px=Math.cos(a)*dist,pz=Math.sin(a)*dist;positions.push(px-Math.sin(a)*width,hy,pz+Math.cos(a)*width,px+Math.sin(a)*width,hy,pz-Math.cos(a)*width)}
      for(let k=0;k<7;k++){const v=start+k*2;indices.push(v,v+2,v+1,v+1,v+2,v+3)}
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();builder.add(g,fern?'#4c6345':'#7d8853',[x,y+.007,z],[0,rnd(0,TAU),0],[1,1,1],SURFACE.VEGETATION,1);groundPlants++;
  }
  // Two restrained bamboo clusters, with segmented culms and paired leaves.
  for(const clump of [[-2.95,-2.01],[3.10,-2.20]])for(let i=0;i<7;i++){
    const x=clump[0]+rnd(-.09,.09),z=clump[1]+rnd(-.10,.10),y=terrainHeight(x,z),h=rnd(.31,.58);if(intersectsBuilding(x,z,.16,y,y+h+.08))continue;
    builder.cyl(x,y+h/2,z,.006,.010,h,'#66724b',SURFACE.VEGETATION,0,7);
    for(let j=1;j<5;j++){const yy=y+h*j/5;builder.cyl(x,yy,z,.011,.011,.009,'#9a9b68',SURFACE.VEGETATION,0,7);for(const side of [-1,1]){const a=i*.73+j,dx=Math.cos(a)*.075*side,dz=Math.sin(a)*.075*side;const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,dx*.45, .030,dz*.45+.012,dx,.016,dz,0,0,0,dx,.016,dz,dx*.45,.030,dz*.45-.012],3));g.computeVertexNormals();builder.add(g,'#61734a',[x,yy,z],[0,0,0],[1,1,1],SURFACE.VEGETATION,0)}}
  }
  const buckets=new Map(),key=(x,z)=>Math.floor(x/.45)+','+Math.floor(z/.45);for(const b of blobs){const k=key(b.x,b.z);if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(b)}
  for(const b of blobs){let nearby=0;const gx=Math.floor(b.x/.45),gz=Math.floor(b.z/.45);for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const o of buckets.get((gx+dx)+','+(gz+dz))||[])if(o!==b&&o.y>b.y-.04&&Math.hypot(o.x-b.x,o.z-b.z)<b.r+o.r)nearby++;b.ao=clamp(1-nearby*.031,.58,1)}
  let leafGeo=new THREE.IcosahedronGeometry(1,mobile?1:2);const leafPos=leafGeo.attributes.position;
  for(let i=0;i<leafPos.count;i++){const x=leafPos.getX(i),y=leafPos.getY(i),z=leafPos.getZ(i),n=1+.085*Math.sin(x*8.+z*5.)*Math.sin(y*7.-z*6.)+.028*Math.sin(x*17.+y*11.);leafPos.setXYZ(i,x*n,y*n,z*n)}
  // Weld only leaf topology before computing smooth normals; the old unindexed
  // normal recomputation had turned every canopy into a faceted polyhedron.
  leafGeo.deleteAttribute('uv');leafGeo.deleteAttribute('normal');leafGeo=mergeVertices(leafGeo,1e-5);leafGeo.computeVertexNormals();
  leafGeo.setAttribute('aKind',new THREE.InstancedBufferAttribute(new Float32Array(blobs.map(b=>b.kind)),1));leafGeo.setAttribute('aCanopyAO',new THREE.InstancedBufferAttribute(new Float32Array(blobs.map(b=>b.ao)),1));leafGeo.setAttribute('aSeed',new THREE.InstancedBufferAttribute(new Float32Array(blobs.map(b=>b.seed)),1));
  const paletteDark={value:[color('#526336'),color('#c38884'),color('#596b32'),color('#324d39'),color('#2b493a'),color('#865e75')]},paletteLight={value:[color('#a2b665'),color('#efc3b8'),color('#96ac50'),color('#718652'),color('#728c64'),color('#cba9b0')]};
  const groundPalette={value:color('#788158')};
  const canopyShape=`float deciduous=1.-step(2.5,aKind);transformed*=1.-.38*uSnow*deciduous;if(aKind>3.5&&aKind<4.5)transformed.xz*=.69+.30*(1.-position.y)*.5;transformed.x+=sin(uTime*.72+aSeed)*.005*(position.y+1.)*.5;`;
  const leavesMat=new THREE.MeshStandardMaterial({roughness:.91});leavesMat.onBeforeCompile=s=>{
    Object.assign(s.uniforms,shared,{uDark:paletteDark,uLight:paletteLight});s.vertexShader='attribute float aKind;attribute float aCanopyAO;attribute float aSeed;varying float vKind;varying float vCanopyAO;varying float vSeed;varying vec3 vLeafNormal;varying vec3 vLeafLocal;\nuniform float uSnow;uniform float uTime;\n'+s.vertexShader;
    s.vertexShader=s.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>\n${canopyShape}
      vKind=aKind;vCanopyAO=aCanopyAO;vSeed=aSeed;vLeafLocal=position;
      mat3 leafMatrix=mat3(instanceMatrix);vec3 inverseScale=vec3(dot(leafMatrix[0],leafMatrix[0]),dot(leafMatrix[1],leafMatrix[1]),dot(leafMatrix[2],leafMatrix[2]));vLeafNormal=normalize(mat3(modelMatrix)*leafMatrix*(objectNormal/inverseScale));`);
    s.fragmentShader='uniform vec3 uDark[6];uniform vec3 uLight[6];uniform float uSnow;varying float vKind;varying float vCanopyAO;varying float vSeed;varying vec3 vLeafNormal;varying vec3 vLeafLocal;\n'+noiseGLSL+s.fragmentShader;
    s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      int k=int(vKind+.1);float fleck=filteredNoise(vLeafLocal.xz*24.+vLeafLocal.y*9.+vSeed);float tinyLeaf=filteredNoise(vLeafLocal.xz*63.+vSeed);float top=smoothstep(-.65,.85,vLeafLocal.y);
      float needles=(vKind>2.5&&vKind<4.5)?filteredNoise(vLeafLocal.xz*vec2(80.,18.)+vSeed):tinyLeaf;
      diffuseColor.rgb=mix(uDark[k],uLight[k],top*.65+fleck*.24)*(vCanopyAO*(.89+needles*.16));
      float snow=uSnow*smoothstep(.34,.83,normalize(vLeafNormal).y)*smoothstep(-.03,.52,vLeafLocal.y);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.91,.93,.90),snow);`);
    // Smooth canopy geometry supplies normals; unscaled screen derivatives
    // would make highlight strength depend on resolution and camera motion.
  };
  const canopy=new THREE.InstancedMesh(leafGeo,leavesMat,blobs.length),dummy=new THREE.Object3D();blobs.forEach((b,i)=>{dummy.position.set(b.x,b.y,b.z);dummy.rotation.set(0,b.seed,0);dummy.scale.set(b.r,b.r*b.sy,b.r);dummy.updateMatrix();canopy.setMatrixAt(i,dummy.matrix)});canopy.castShadow=true;canopy.receiveShadow=true;canopy.frustumCulled=false;scene.add(canopy);
  canopy.customDepthMaterial=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});canopy.customDepthMaterial.onBeforeCompile=s=>{Object.assign(s.uniforms,shared);s.vertexShader='attribute float aKind;attribute float aSeed;uniform float uSnow;uniform float uTime;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>\n${canopyShape.replace(/transformed\.x\+=sin[^;]+;/,'')}`)};
  designChecks.treeJunctions=treeJunctions;

  // Every enclosed room receives its own fixture-bound light, in final world coordinates.
  const lightingRooms=[...residenceRooms,readingPavilion,{name:'阅亭过渡廊',role:'vestibule',x:bedroom.x,z:linkZ,w:linkW,d:linkFront-linkBack,f:bedroom.f,h:.926-bedroom.f}];
  const roomLights=lightingRooms.map(r=>{
    const candidates=interiorFixtures.filter(l=>{const p=l.centre||l.mount;return p&&Math.abs(p[0]-r.x)<r.w/2&&Math.abs(p[2]-r.z)<r.d/2&&p[1]>r.f+.012&&p[1]<r.f+r.h+.04});
    const priority={pendant:0,linear:1,floor:2,wall:3,picture:3};
    candidates.sort((a,b)=>(priority[a.type]??4)-(priority[b.type]??4)||Math.hypot(a.centre[0]-r.x,a.centre[2]-r.z)-Math.hypot(b.centre[0]-r.x,b.centre[2]-r.z));
    let fixture=candidates[0];
    if(!fixture){
      const p=[r.x,r.f+r.h-.014,r.z];
      builder.add(new THREE.BoxGeometry(Math.min(r.w*.45,.16),.004,.018),INTERIOR_FINISH.lampPanel,p,[0,0,0],[1,1,1],SURFACE.CEILING_LIGHT,0,true);
      fixture={type:'linear',name:r.name+'嵌入式柔光灯',centre:p,mount:[p[0],p[1]+.004,p[2]],closedHousing:true};interiorFixtures.push(fixture);
    }
    const bounds=[r.x-r.w/2+.012,r.x+r.w/2-.012,r.z-r.d/2+.012,r.z+r.d/2-.012],height=[r.f+.005,r.f+r.h+.008];
    const p=fixture.centre,source=[clamp(p[0],bounds[0]+.025,bounds[1]-.025),clamp(p[1],height[0]+.035,height[1]-.030),clamp(p[2],bounds[2]+.025,bounds[3]-.025)];
    return {name:r.name,role:r.role,bounds,height,source,fixture:fixture.name,radius:Math.max(.32,Math.hypot(r.w,r.d)*.5),gain:r.role==='vestibule'?.55:r.role==='bedroom'?.75:.90};
  });
  const roomLightUniforms={uRoomBounds:{value:roomLights.map(l=>new THREE.Vector4(...l.bounds))},uRoomHeight:{value:roomLights.map(l=>new THREE.Vector2(...l.height))},uRoomSource:{value:roomLights.map(l=>new THREE.Vector4(...l.source,l.radius))},uRoomGain:{value:roomLights.map(l=>l.gain)},uRoomLightLevel:{value:.24}};
  // Replace the two unbounded house lights; the third light still belongs to the outdoor torii.
  for(const light of warmLights.slice(0,2))scene.remove(light);
  const roomBoundsGLSL=`#define INTERIOR_ROOM_COUNT ${roomLights.length}
    uniform vec4 uRoomBounds[INTERIOR_ROOM_COUNT];uniform vec2 uRoomHeight[INTERIOR_ROOM_COUNT];uniform float uRoomLightLevel;
    float interiorRoomMask(vec3 p,int k,float feather){vec4 b=uRoomBounds[k];vec2 h=uRoomHeight[k];vec3 inset=min(p-vec3(b.x,h.x,b.z),vec3(b.y,h.y,b.w)-p);return smoothstep(0.,feather,min(min(inset.x,inset.y),inset.z));}`;
  const wallLighting=interiorFixtures.filter(l=>l.type==='wall'||l.type==='picture');
  const interiorLightUniforms={uCeilingBounds:{value:residenceRooms.map(r=>new THREE.Vector4(r.x-r.w/2+.008,r.x+r.w/2-.008,r.z-r.d/2+.008,r.z+r.d/2-.008))},uCeilingColor:{value:color(INTERIOR_FINISH.ceiling)},uInteriorLampPosition:{value:wallLighting.map(l=>new THREE.Vector3(...(l.washCentre||l.mount)))},uInteriorLampNormal:{value:wallLighting.map(l=>new THREE.Vector3(...l.normal))},uInteriorLampRadius:{value:wallLighting.map(l=>l.spread)},uInteriorLampLevel:{value:.09}};
  designChecks.interiorLighting={fixtures:interiorFixtures,rooms:roomLights,roomLightCount:roomLights.length,wallWashCount:wallLighting.length,paper:'filtered washi fibre',wallWash:'surface-bound soft warm wash; opaque depth-tested surfaces',roomLight:'fixture-bound diffuse and specular lighting contained by room and floor bounds',additionalShadowMaps:0};
  await window.shiosaiStage('庭居与四季已就绪',2);
  const architectureMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.78});architectureMat.onBeforeCompile=s=>{
    Object.assign(s.uniforms,shared,interiorLightUniforms,roomLightUniforms,{uGroundColor:groundPalette});s.vertexShader='attribute float surfaceType;attribute float snowEligible;attribute vec3 localPosition;attribute float partSeed;attribute float detailAxis;varying float vSurface;varying float vSnowMask;varying vec3 vArchWorld;varying vec3 vArchNormal;varying vec3 vArchLocal;varying float vPartSeed;varying float vDetailAxis;\n'+s.vertexShader;
    s.vertexShader=s.vertexShader.replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nvSurface=surfaceType;vSnowMask=snowEligible;vArchWorld=(modelMatrix*vec4(transformed,1.)).xyz;vArchNormal=normalize(mat3(modelMatrix)*objectNormal);vArchLocal=localPosition;vPartSeed=partSeed;vDetailAxis=detailAxis;');
    s.fragmentShader=`#define CEILING_ROOM_COUNT ${residenceRooms.length}\nuniform vec4 uCeilingBounds[CEILING_ROOM_COUNT];uniform vec3 uCeilingColor;\n#define INTERIOR_LAMP_COUNT ${wallLighting.length}\nuniform vec3 uInteriorLampPosition[INTERIOR_LAMP_COUNT];uniform vec3 uInteriorLampNormal[INTERIOR_LAMP_COUNT];uniform float uInteriorLampRadius[INTERIOR_LAMP_COUNT];uniform float uInteriorLampLevel;\n`+'varying float vSurface;varying float vSnowMask;varying vec3 vArchWorld;varying vec3 vArchNormal;varying vec3 vArchLocal;varying float vPartSeed;varying float vDetailAxis;uniform float uSnow;uniform float uTide;uniform float uHigh;uniform float uTime;uniform float uCaustics;uniform vec3 uGroundColor;\n'+noiseGLSL+s.fragmentShader;
    s.fragmentShader=roomBoundsGLSL+'\nuniform vec4 uRoomSource[INTERIOR_ROOM_COUNT];uniform float uRoomGain[INTERIOR_ROOM_COUNT];\n'+s.fragmentShader;
    s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      float ceilingMask=1.-step(.2,abs(vSurface-14.));
      if(abs(vSurface-16.)<.3||abs(vSurface-17.)<.3){
        // A fragment mask follows the interior walls exactly, retaining the exterior eaves' original finish.
        for(int k=0;k<CEILING_ROOM_COUNT;k++){
          vec4 b=uCeilingBounds[k];ceilingMask=max(ceilingMask,step(b.x,vArchWorld.x)*step(vArchWorld.x,b.y)*step(b.z,vArchWorld.z)*step(vArchWorld.z,b.w));
        }
        diffuseColor.rgb=mix(diffuseColor.rgb,uCeilingColor,ceilingMask);
      }
      float wood=1.-step(.2,min(abs(vSurface-2.),abs(vSurface-4.)));float roofTop=1.-step(.2,abs(vSurface));float stone=1.-step(.2,min(abs(vSurface-6.),abs(vSurface-10.)));
      if(wood>.5){
      vec2 crossGrain=vDetailAxis<.5?vArchLocal.yz:vDetailAxis<1.5?vArchLocal.xz:vArchLocal.xy;float lengthGrain=vDetailAxis<.5?vArchLocal.x:vDetailAxis<1.5?vArchLocal.y:vArchLocal.z;
      float rings=filteredWave(crossGrain.x*110.+noise(vec2(lengthGrain*2.3,crossGrain.y*10.)+vPartSeed)*6.);float fibers=filteredNoise(vec2(lengthGrain*3.,crossGrain.y*110.)+vPartSeed);
      float knots=pow(filteredWave(lengthGrain*13.+vPartSeed+crossGrain.y*60.),8.)*pow(filteredWave(crossGrain.x*70.+vPartSeed),3.);
      diffuseColor.rgb*=1.+wood*((rings-.5)*.15+(fibers-.5)*.12-knots*.16);
      }
      if(roofTop>.5){
      float grain=filteredNoise(vArchWorld.xz*100.+vArchWorld.y*13.);float tileRows=pow(filteredWave(vArchLocal.y*90.+1.5708),8.);diffuseColor.rgb*=1.+roofTop*((grain-.5)*.11-tileRows*.13);
      }
      if(stone>.5){
      float mineral=filteredNoise(vArchWorld.xz*120.+vArchWorld.y*65.)*.60+filteredNoise(vArchWorld.xy*49.)*.40;
      float fissurePhase=vArchWorld.y*21.+noise(vArchWorld.xz*4.)*2.3;float fissure=pow(1.-abs(sin(fissurePhase)),20.)*exp(-4.*fwidth(fissurePhase));float flecks=filteredFlecks(vArchWorld.xz*180.+vArchWorld.y*65.,.84);
      diffuseColor.rgb*=1.+stone*((mineral-.5)*.32-fissure*.22+flecks*.16);
      }
      float upperOak=1.-step(.2,abs(vSurface-18.)),upperFabric=1.-step(.2,abs(vSurface-19.)),upperWall=1.-step(.2,abs(vSurface-20.));
      if(upperOak>.5){
        vec2 crossP=vDetailAxis<.5?vArchLocal.yz:vDetailAxis<1.5?vArchLocal.xz:vArchLocal.xy;
        float longP=vDetailAxis<.5?vArchLocal.x:vDetailAxis<1.5?vArchLocal.y:vArchLocal.z;
        float veneer=filteredNoise(vec2(longP*3.0,crossP.y*178.)+vPartSeed);
        float fine=filteredWave(crossP.y*165.+filteredNoise(vec2(longP*4.,crossP.y*26.))*1.3);
        diffuseColor.rgb*=1.+(veneer-.5)*.068+(fine-.5)*.024;
      }
      if(upperFabric>.5){float weft=filteredWave(vArchLocal.x*420.)*filteredWave(vArchLocal.z*420.);diffuseColor.rgb*=1.+(weft-.25)*.039+(filteredNoise(vArchWorld.xy*135.)-.5)*.029;}
      float nordicWoolMask=1.-step(.2,abs(vSurface-21.)),nordicStoneMask=1.-step(.2,abs(vSurface-22.)),nordicOpalMask=1.-step(.2,abs(vSurface-23.));
      if(nordicWoolMask>.5){
        vec2 wP=abs(vArchNormal.y)>.6?vArchLocal.xz:abs(vArchNormal.x)>.6?vArchLocal.yz:vArchLocal.xy;
        float loops=filteredNoise(wP*vec2(470.,390.)+vPartSeed*7.3),soft=filteredNoise(wP*74.+vPartSeed);
        diffuseColor.rgb*=1.+(loops-.5)*.135+(soft-.5)*.035;
      }
      if(nordicStoneMask>.5){
        float mineral=filteredNoise(vArchLocal.xz*58.);
        diffuseColor.rgb*=1.+(mineral-.5)*.030;
      }
      float luxeMarble=1.-step(.2,abs(vSurface-24.)),luxeBrass=1.-step(.2,abs(vSurface-25.)),luxeVelvet=1.-step(.2,abs(vSurface-26.)),luxeLacquer=1.-step(.2,abs(vSurface-27.));
      if(luxeMarble>.5){
        vec2 mP=abs(vArchNormal.y)>.6?vArchLocal.xz:abs(vArchNormal.x)>.6?vArchLocal.zy:vArchLocal.xy;
        float phase=mP.x*24.+mP.y*37.+filteredNoise(mP*42.+vPartSeed)*1.7+filteredNoise(mP*113.)*.23;
        float vein=1.-smoothstep(.025,.085,abs(sin(phase)));
        float fineVein=1.-smoothstep(.015,.045,abs(sin(phase*1.31+.55)));
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.43,.39,.34),vein*.18+fineVein*.07);
        diffuseColor.rgb*=1.+(filteredNoise(mP*91.)-.5)*.025;
      }
      if(luxeBrass>.5)diffuseColor.rgb*=1.+(filteredNoise(vArchLocal.xy*vec2(200.,1200.))-.5)*.035;
      if(luxeVelvet>.5)diffuseColor.rgb*=1.+(filteredNoise(vArchLocal.xy*380.)-.5)*.065;
      if(upperWall>.5)diffuseColor.rgb*=1.+(filteredNoise(vArchWorld.xy*120.)-.5)*.022;
      float interiorFloor=1.-step(.2,abs(vSurface-13.));
      if(interiorFloor>.5){float powder=filteredNoise(vArchWorld.xz*137.),cloud=filteredNoise(vArchWorld.xz*3.7);diffuseColor.rgb*=1.+(powder-.5)*.018+(cloud-.5)*.012;}
      float underwater=1.-smoothstep(uTide-.015,uTide+.018,vArchWorld.y),damp=1.-smoothstep(uTide+.025,uTide+.11,vArchWorld.y);
      diffuseColor.rgb*=1.-(stone*.28+wood*.25)*damp;
      float saltBand=(1.-smoothstep(.03,.095,abs(vArchWorld.y-uHigh)))*stone;diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.38,.40,.32),saltBand*.22);
      float algae=stone*underwater;diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.18,.27,.22),algae*.32);
      if(stone>.5){
      float moss=(1.-step(.2,abs(vSurface-6.)))*smoothstep(.42,.92,vArchNormal.y)*smoothstep(2.55,2.95,abs(vArchWorld.x))*(1.-smoothstep(.45,1.10,vArchWorld.y))*smoothstep(.38,.74,noise(vArchWorld.xz*13.));diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.30,.38,.24),moss*.46);
      }
      if(vSurface>7.5&&vSurface<8.5)diffuseColor.rgb*=uGroundColor/vec3(.19,.22,.10);
      float gravel=1.-step(.2,abs(vSurface-9.));
      if(gravel>.5){
      vec2 rakeP=vArchWorld.xz;float rakePhase=(rakeP.y+.047*sin(rakeP.x*2.7)+.026*noise(rakeP*3.1))*64.;
      float rake=filteredWave(rakePhase),sandGrain=filteredNoise(rakeP*183.)*.65+filteredNoise(rakeP*79.+8.)*.35;
      diffuseColor.rgb*=1.+(rake-.5)*.052+(sandGrain-.5)*.31-filteredFlecks(rakeP*vec2(247.,213.),.81)*.09;
      }
      float plaster=max(1.-step(.2,min(abs(vSurface-5.),abs(vSurface-17.))),ceilingMask);if(plaster>.5){float plasterCloud=filteredNoise(vArchWorld.xz*4.3+vArchWorld.y*3.7);float plasterGrit=filteredNoise(vArchWorld.xy*150.+vArchWorld.z*67.);
      diffuseColor.rgb*=1.+plaster*((plasterCloud-.5)*.045+(plasterGrit-.5)*.055);}float bronze=1.-step(.2,abs(vSurface-7.));if(bronze>.5)diffuseColor.rgb*=1.+bronze*(filteredNoise(vArchWorld.xy*35.)-.5)*.09;
      float plants=1.-step(.2,abs(vSurface-8.));if(plants>.5)diffuseColor.rgb*=1.+plants*((filteredNoise(vArchWorld.xz*43.)-.5)*.22+(filteredNoise(vArchWorld.xy*130.)-.5)*.10);
      float snow=uSnow*vSnowMask*smoothstep(.45,.92,normalize(vArchNormal).y);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.9,.92,.88),snow);`);
    s.fragmentShader=s.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
      roughnessFactor=abs(vSurface-7.)<.3?.52:(abs(vSurface-3.)<.3?.60:(vSurface<.5?.80:.88));roughnessFactor=mix(roughnessFactor,.65,(wood+stone)*damp*.4);roughnessFactor=mix(roughnessFactor,.95,gravel);roughnessFactor=mix(roughnessFactor,.98,snow);if(interiorFloor>.5)roughnessFactor=.68;if(upperOak>.5)roughnessFactor=.72;if(upperFabric>.5)roughnessFactor=.96;if(upperWall>.5)roughnessFactor=.88;if(nordicWoolMask>.5)roughnessFactor=.99;if(nordicStoneMask>.5)roughnessFactor=.63;if(nordicOpalMask>.5)roughnessFactor=.28;if(luxeMarble>.5)roughnessFactor=.28;if(luxeBrass>.5)roughnessFactor=.33;if(luxeVelvet>.5)roughnessFactor=.92;if(luxeLacquer>.5)roughnessFactor=.43;`);
    s.fragmentShader=s.fragmentShader.replace('#include <metalnessmap_fragment>',`#include <metalnessmap_fragment>
      if(luxeBrass>.5)metalnessFactor=.48;`);
    // Suppress the yellow ground-light cast only on mineral ceilings, keeping light intensity and shadows.
    s.fragmentShader=s.fragmentShader.replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
      if(upperOak>.5||upperFabric>.5||upperWall>.5||nordicWoolMask>.5||nordicStoneMask>.5||nordicOpalMask>.5||luxeMarble>.5||luxeVelvet>.5||luxeLacquer>.5){
        vec3 nordicIndirect=reflectedLight.indirectDiffuse/max(diffuseColor.rgb,vec3(.001));
        vec3 nordicDirect=reflectedLight.directDiffuse/max(diffuseColor.rgb,vec3(.001));
        reflectedLight.indirectDiffuse=mix(vec3(dot(nordicIndirect,vec3(.2126,.7152,.0722))),nordicIndirect,.35)*diffuseColor.rgb;
        reflectedLight.directDiffuse=mix(vec3(dot(nordicDirect,vec3(.2126,.7152,.0722))),nordicDirect,.72)*diffuseColor.rgb;
      }
      if(ceilingMask>.5){
        reflectedLight.directDiffuse=mix(vec3(dot(reflectedLight.directDiffuse,vec3(.2126,.7152,.0722))),reflectedLight.directDiffuse,.12);
        reflectedLight.indirectDiffuse=mix(vec3(dot(reflectedLight.indirectDiffuse,vec3(.2126,.7152,.0722))),reflectedLight.indirectDiffuse,.12);
        totalEmissiveRadiance=mix(vec3(dot(totalEmissiveRadiance,vec3(.2126,.7152,.0722))),totalEmissiveRadiance,.12);
      }`);
    // Mineral and timber microstructure is carried in filtered albedo.
    s.fragmentShader=s.fragmentShader.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
      float ca=oceanCaustics(vArchWorld.xz,uTime,max(uTide-vArchWorld.y,0.));totalEmissiveRadiance+=vec3(.12,.18,.13)*ca*uCaustics*underwater*stone;
      // The glow belongs to the receiving wall; it cannot float over windows or
      // furniture, and adds no transparent halo polygons or shadow-map flicker.
      for(int k=0;k<INTERIOR_LAMP_COUNT;k++){
        vec3 delta=vArchWorld-uInteriorLampPosition[k],lampNormal=uInteriorLampNormal[k];float depth=dot(delta,lampNormal);
        vec3 tangent=delta-lampNormal*depth;vec3 ellipse=tangent/vec3(uInteriorLampRadius[k],uInteriorLampRadius[k]*1.45,uInteriorLampRadius[k]);
        float halo=exp(-dot(ellipse,ellipse)*2.0)*(1.-smoothstep(.007,.018,abs(depth)))*smoothstep(.78,.96,dot(normalize(vArchNormal),lampNormal));
        totalEmissiveRadiance+=vec3(1.,.71,.40)*halo*uInteriorLampLevel*min(1.,plaster+stone);
      }`);
    s.fragmentShader=s.fragmentShader.replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
      vec3 roomNormal=normalize(vArchNormal),roomView=normalize(cameraPosition-vArchWorld);
      for(int k=0;k<INTERIOR_ROOM_COUNT;k++){
        float roomMask=interiorRoomMask(vArchWorld,k,.010);if(roomMask<.001)continue;
        vec4 source=uRoomSource[k];vec3 toLamp=source.xyz-vArchWorld;float distanceSquared=max(dot(toLamp,toLamp),.0001);
        vec3 lightDirection=toLamp*inversesqrt(distanceSquared);float lambert=max(dot(roomNormal,lightDirection),0.);
        float falloff=1./(1.+distanceSquared/(source.w*source.w));
        vec3 irradiance=vec3(1.,.82,.64)*roomMask*uRoomLightLevel*uRoomGain[k]*falloff;
        // Bounced light keeps furniture readable without turning walls into emissive panels.
        reflectedLight.directDiffuse+=diffuseColor.rgb*irradiance*(.23+.95*lambert);
        float highlight=pow(max(dot(reflect(-lightDirection,roomNormal),roomView),0.),mix(96.,12.,roughnessFactor));
        reflectedLight.directSpecular+=mix(vec3(.04),diffuseColor.rgb,metalnessFactor)*irradiance*highlight*.45;
      }`);
  };
  // Resolve opaque axis-aligned overlaps geometrically, once at build time.
  // Convex triangle differences preserve reveals, openings and every vertex attribute.
  // This removes competing depth surfaces instead of hiding them with polygon offset.
  function uniquePlanarSurfaces(g){
    const attrs=g.attributes,p=attrs.position,index=g.index,planes=new Map(),out=[],extra=[];
    const stride=Object.values(attrs).reduce((n,a)=>n+a.itemSize,0),names=Object.keys(attrs);
    const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    const area=q=>Math.abs(q.reduce((n,a,i)=>{const b=q[(i+1)%q.length];return n+a[0]*b[1]-a[1]*b[0]},0))*.5;
    const bounds=q=>[Math.min(...q.map(v=>v[0])),Math.max(...q.map(v=>v[0])),Math.min(...q.map(v=>v[1])),Math.max(...q.map(v=>v[1]))];
    const overlaps=(a,b)=>Math.min(a[1],b[1])-Math.max(a[0],b[0])>1e-7&&Math.min(a[3],b[3])-Math.max(a[2],b[2])>1e-7;
    function split(poly,a,b,sign){
      const inside=[],outside=[];
      for(let i=0;i<poly.length;i++){
        const v=poly[i],w=poly[(i+1)%poly.length],d=cross(a,b,v)*sign,e=cross(a,b,w)*sign;
        if(d>=-1e-10)inside.push(v);if(d<=1e-10)outside.push(v);
        if((d>1e-10&&e< -1e-10)||(d< -1e-10&&e>1e-10)){const t=d/(d-e),q=[mix(v[0],w[0],t),mix(v[1],w[1],t)];inside.push(q);outside.push(q)}
      }
      return {inside,outside};
    }
    function difference(poly,tri){
      const sign=Math.sign(cross(...tri)),pieces=[];let inside=poly;
      for(let i=0;i<3&&inside.length>=3;i++){const s=split(inside,tri[i],tri[(i+1)%3],sign);if(s.outside.length>=3&&area(s.outside)>1e-11)pieces.push(s.outside);inside=s.inside}
      return pieces;
    }
    function intersection(poly,tri){let q=poly;const sign=Math.sign(cross(...tri));for(let i=0;i<3&&q.length>=3;i++)q=split(q,tri[i],tri[(i+1)%3],sign).inside;return q.length>=3?area(q):0}
    const cell=.18;
    const cells=b=>{const a=[];for(let i=Math.floor(b[0]/cell);i<=Math.floor(b[1]/cell);i++)for(let j=Math.floor(b[2]/cell);j<=Math.floor(b[3]/cell);j++)a.push(i+','+j);return a};
    let changed=0,removedArea=0;
    for(let n=0;n<index.count;n+=3){
      const ids=[index.getX(n),index.getX(n+1),index.getX(n+2)],surface=attrs.surfaceType.getX(ids[0]);
      if([SURFACE.VEGETATION,SURFACE.FLOWER,SURFACE.GRAVEL].includes(surface)){out.push(...ids);continue}
      const v=ids.map(i=>[p.getX(i),p.getY(i),p.getZ(i)]);
      const ab=v[1].map((x,k)=>x-v[0][k]),ac=v[2].map((x,k)=>x-v[0][k]);
      const normal=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]],length=Math.hypot(...normal),axis=normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs)));
      if(length<1e-12||Math.abs(normal[axis])/length<.9999999||surface===SURFACE.VEGETATION||surface===SURFACE.FLOWER){out.push(...ids);continue}
      const uv=[0,1,2].filter(k=>k!==axis),poly=v.map(q=>[q[uv[0]],q[uv[1]]]),b=bounds(poly),seed=attrs.partSeed.getX(ids[0]);
      const key=axis+':'+Math.sign(normal[axis])+':'+Math.round(v[0][axis]*1e5);
      if(!planes.has(key))planes.set(key,new Map());const plane=planes.get(key),keys=cells(b),candidates=new Set();
      for(const k of keys)for(const t of plane.get(k)||[])if(t.seed!==seed&&overlaps(b,t.bounds))candidates.add(t);
      let pieces=[poly];const originalArea=area(poly);
      for(const t of candidates){const next=[];for(const q of pieces){if(!overlaps(bounds(q),t.bounds)||intersection(q,t.poly)<1e-10){next.push(q);continue}next.push(...difference(q,t.poly))}pieces=next;if(!pieces.length)break}
      const finalArea=pieces.reduce((n,q)=>n+area(q),0);
      if(originalArea-finalArea>1e-9){
        changed++;removedArea+=originalArea-finalArea;
        const denominator=cross(poly[0],poly[1],poly[2]);
        for(const q of pieces){const verts=[];for(const point of q){
          const weights=[cross(poly[1],poly[2],point)/denominator,cross(poly[2],poly[0],point)/denominator,cross(poly[0],poly[1],point)/denominator];
          const id=p.count+extra.length/stride;verts.push(id);
          for(const name of names){const a=attrs[name];for(let k=0;k<a.itemSize;k++){let value=0;for(let j=0;j<3;j++)value+=a.array[ids[j]*a.itemSize+k]*weights[j];extra.push(value)}}
        }
        for(let i=1;i<verts.length-1;i++)if(Math.abs(cross(q[0],q[i],q[i+1]))>1e-11)out.push(verts[0],verts[i],verts[i+1]);
        }
      }else out.push(...ids);
      // Original triangles cover the union even when their shared portion was trimmed.
      const record={poly,bounds:b,seed};for(const k of keys){if(!plane.has(k))plane.set(k,[]);plane.get(k).push(record)}
    }
    let offset=0;const count=extra.length/stride;
    for(const name of names){const a=attrs[name],array=new Float32Array(a.array.length+count*a.itemSize);array.set(a.array);for(let i=0;i<count;i++)for(let k=0;k<a.itemSize;k++)array[a.array.length+i*a.itemSize+k]=extra[i*stride+offset+k];g.setAttribute(name,new THREE.BufferAttribute(array,a.itemSize));offset+=a.itemSize}
    // Interpolated cut-vertex normals must be unit length; preserve authored
    // hard edges rather than recomputing smooth normals over the joined mesh.
    g.normalizeNormals();g.setIndex(out);designChecks.planarSurfaces={trimmedTriangles:changed,removedDuplicateArea:removedArea,method:'convex surface difference',normalisedCutNormals:true,polygonOffset:false};
    return g;
  }

  const architectureG=uniquePlanarSurfaces(mergeGeometries(builder.parts,false));if(!architectureG)throw new Error('Architecture attributes did not merge.');architectureG.computeBoundingSphere();
  const architecture=new THREE.Mesh(architectureG,architectureMat);architecture.castShadow=true;architecture.receiveShadow=true;scene.add(architecture);
  // Interleaved low and tall flame tongues share an irregular coal-bed base.
  // Additive blending is order-independent; opaque room walls still occlude the fire.
  const fireP=[],fireI=[],firePhase=[],fireHeight=[];
  for(let tongue=0;tongue<13;tongue++){
    const phase=tongue*2.137,low=tongue>6,hh=hearthSpec.height*(low?.23+.18*Math.sin(phase)**2:.45+.50*Math.sin(phase+.7)**2),cx=hearthSpec.x+(low?(tongue-9.5)*hearthSpec.width/7:(tongue-3)*hearthSpec.width/9)+.006*Math.sin(phase),cz=hearthSpec.z+.008*Math.sin(phase),start=fireP.length/3;
    for(let j=0;j<=9;j++)for(let k=0;k<=10;k++){
      const t=j/9,a=k/10*TAU,rad=(low?.017:.010)*(1-t)+(low?.026:.020)*Math.sin(Math.PI*t*.87)*(1-t*.73),x=cx+Math.cos(a)*rad+.008*Math.sin(t*5.1+phase)*t,z=cz+Math.sin(a)*rad*.63;
      fireP.push(x,hearthSpec.y+t*hh,z);firePhase.push(phase);fireHeight.push(t);
    }
    for(let j=0;j<9;j++)for(let k=0;k<10;k++){const a=start+j*11+k,d=a+11;fireI.push(a,d,a+1,a+1,d,d+1)}
  }
  const fireG=new THREE.BufferGeometry();fireG.setAttribute('position',new THREE.Float32BufferAttribute(fireP,3));fireG.setAttribute('aFlamePhase',new THREE.Float32BufferAttribute(firePhase,1));fireG.setAttribute('aFlameHeight',new THREE.Float32BufferAttribute(fireHeight,1));fireG.setIndex(fireI);fireG.computeBoundingSphere();
  const fireMat=new THREE.ShaderMaterial({uniforms:{uTime:shared.uTime||{value:0}},transparent:true,depthWrite:false,depthTest:true,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
    vertexShader:`attribute float aFlamePhase;attribute float aFlameHeight;uniform float uTime;varying float vPhase;varying float vHeight;varying vec3 vFire;
      void main(){vec3 p=position;float t=aFlameHeight,breath=sin(uTime*1.47+aFlamePhase)+.36*sin(uTime*2.31+aFlamePhase*1.3);
      p.x+=.0065*t*t*breath;p.z+=.004*t*sin(uTime*1.09+aFlamePhase+t*5.);p.y+=.013*t*sin(uTime*1.31+aFlamePhase*2.);vFire=p;vHeight=t;vPhase=aFlamePhase;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
    fragmentShader:`uniform float uTime;varying float vPhase;varying float vHeight;varying vec3 vFire;
      void main(){float t=vHeight,unsteady=.77+.16*sin(t*18.-uTime*1.63+vPhase)+.07*sin(t*31.-uTime*2.17+vPhase*1.4);
      float alpha=smoothstep(0.,.065,t)*(1.-smoothstep(.48,1.,t))*unsteady*.29;
      vec3 flame=mix(vec3(1.30,.59,.13),vec3(.87,.15,.025),smoothstep(.15,.86,t));flame=mix(flame,vec3(.22,.23,.36),1.-smoothstep(.0,.09,t));gl_FragColor=vec4(flame,alpha);}`});
  const fireMesh=new THREE.Mesh(fireG,fireMat);fireMesh.name='contained living hearth';fireMesh.frustumCulled=false;scene.add(fireMesh);
  const hearthLight=new THREE.PointLight('#ffaf60',.055,.78,2);hearthLight.position.set(hearthSpec.x,hearthSpec.y+.050,hearthSpec.z+.040);scene.add(hearthLight);
  designChecks.hearth={...hearthSpec,tongues:13,depthTested:true,independentMotion:true,orderIndependent:true};
  function updateHearth(t){hearthLight.intensity=.055+.007*Math.sin(t*1.31)+.004*Math.sin(t*2.09+.7);}
  // Keep flowers in the opaque/depth passes; alpha hashing dissolves intersecting plants without transparent sorting artifacts.
  const flowerMeshes=flowerBuilders.map((b,i)=>{
    const g=mergeGeometries(b.parts,false);g.computeBoundingSphere();
    const incoming={value:0},material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.85,side:THREE.DoubleSide,alphaHash:true,opacity:i===0?1:0});
    const depthMaterial=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,alphaHash:true,opacity:material.opacity});
    const dissolveShader=s=>{
      s.uniforms.uFlowerIncoming=incoming;
      s.fragmentShader='uniform float uFlowerIncoming;\n'+s.fragmentShader;
      // Complementary masks keep coincident stems covered as the outgoing and incoming seasons exchange weight.
      s.fragmentShader=s.fragmentShader.replace('#include <alphahash_fragment>','float flowerThreshold=getAlphaHashThreshold(vPosition);\nif(diffuseColor.a<mix(flowerThreshold,1.-flowerThreshold,uFlowerIncoming))discard;');
    };
    material.onBeforeCompile=s=>{
      dissolveShader(s);
      s.vertexShader='varying vec3 vFlowerLocal;\n'+s.vertexShader;
      s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvFlowerLocal=position;');
      s.fragmentShader='varying vec3 vFlowerLocal;\n'+noiseGLSL+s.fragmentShader;
      s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb*=1.+(filteredNoise(vFlowerLocal.xz*180.+vFlowerLocal.y*31.)-.5)*.10;');
    };
    depthMaterial.onBeforeCompile=dissolveShader;
    const m=new THREE.Mesh(g,material);m.customDepthMaterial=depthMaterial;m.userData.flowerIncoming=incoming;
    m.name='coastal garden '+coastalGarden.seasonNames[i];m.castShadow=true;m.receiveShadow=true;m.visible=i===0;scene.add(m);for(const p of b.parts)p.dispose();return m;
  });
  let shownFlowerSeason=0;
  let flowerShadowSeason=0;
  function showFlowerSeason(current){
    const cyclic=((current%4)+4)%4,a=Math.floor(cyclic),b=(a+1)%4,f=cyclic-a;
    flowerMeshes.forEach((m,i)=>{
      const weight=i===a?1-f:i===b?f:0;
      m.visible=weight>0;m.material.opacity=weight;m.customDepthMaterial.opacity=weight;
      m.userData.flowerIncoming.value=i===b?1:0;
    });
    shownFlowerSeason=f<.5?a:b;
    // Bound costly shadow refreshes during the dissolve, then refresh once more at the exact endpoint.
    if(Math.abs(current-flowerShadowSeason)>.035||(current===seasonal.target&&current!==flowerShadowSeason)){
      renderer.shadowMap.needsUpdate=true;flowerShadowSeason=current;
    }
  }
  coastalGarden.meshes=flowerMeshes.map(m=>({name:m.name,vertices:m.geometry.attributes.position.count,triangles:m.geometry.index.count/3}));
  const glowMat=new THREE.MeshStandardMaterial({vertexColors:true,color:'#fff1d0',emissive:'#ffbe6f',emissiveIntensity:.05,roughness:.72,side:THREE.DoubleSide});
  glowMat.onBeforeCompile=s=>{
    Object.assign(s.uniforms,roomLightUniforms);
    s.vertexShader='attribute float surfaceType;attribute vec3 localPosition;varying float vLampPaper;varying float vCeilingLamp;varying vec3 vLampLocal;varying vec3 vLampWorld;\n'+s.vertexShader;
    s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvLampPaper=1.-step(.2,abs(surfaceType-12.));vCeilingLamp=1.-step(.2,abs(surfaceType-15.));vLampLocal=localPosition;vLampWorld=(modelMatrix*vec4(transformed,1.)).xyz;');
    s.fragmentShader=roomBoundsGLSL+'\nvarying float vLampPaper;varying float vCeilingLamp;varying vec3 vLampLocal;varying vec3 vLampWorld;\n'+noiseGLSL+s.fragmentShader;
    s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      float paperFibre=(filteredNoise(vLampLocal.xy*620.)-.5)*.055+(filteredNoise(vLampLocal.xz*280.)-.5)*.030;
      diffuseColor.rgb*=1.+paperFibre*vLampPaper;
      if(vCeilingLamp>.5)diffuseColor.rgb=mix(vec3(dot(diffuseColor.rgb,vec3(.2126,.7152,.0722))),diffuseColor.rgb,.15);`);
    // Ceiling strip panels retain neutral reflected light as well as neutral emission.
    s.fragmentShader=s.fragmentShader.replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
      if(vCeilingLamp>.5){
        reflectedLight.directDiffuse=mix(vec3(dot(reflectedLight.directDiffuse,vec3(.2126,.7152,.0722))),reflectedLight.directDiffuse,.12);
        reflectedLight.indirectDiffuse=mix(vec3(dot(reflectedLight.indirectDiffuse,vec3(.2126,.7152,.0722))),reflectedLight.indirectDiffuse,.12);
      }`);
    s.fragmentShader=s.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance*=1.+paperFibre*vLampPaper;totalEmissiveRadiance+=vec3(.08,.051,.026)*vLampPaper;\nif(vCeilingLamp>.5)totalEmissiveRadiance=mix(vec3(dot(totalEmissiveRadiance,vec3(.2126,.7152,.0722))),totalEmissiveRadiance,.15);');
    s.fragmentShader=s.fragmentShader.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
      float indoorLamp=0.;for(int k=0;k<INTERIOR_ROOM_COUNT;k++)indoorLamp=max(indoorLamp,interiorRoomMask(vLampWorld,k,.002));
      totalEmissiveRadiance=max(totalEmissiveRadiance,diffuseColor.rgb*uRoomLightLevel*1.2*indoorLamp);`);
  };
  const glow=new THREE.Mesh(mergeGeometries(builder.glows,false),glowMat);scene.add(glow);
  for(const p of builder.parts) p.dispose();for(const p of builder.glows)p.dispose();

  // Japanese coastal species: madai, kurodai, suzuki and maaji.
  // Shared topology, species-specific silhouettes, eyes, fins and scale patterns.
  const nativeFishTypes=[0,1,2,3,3,0,2,3,1],speciesNames=['Madai · red seabream','Kurodai · black seabream','Suzuki · Japanese seabass','Maaji · Japanese horse mackerel'];
  const fishParts=[],fishLathe=[];for(let j=0;j<=22;j++){const t=j/22,r=.046*Math.pow(Math.sin(Math.PI*t),.68)*(1.15-.38*t);fishLathe.push(new THREE.Vector2(r,t*.40-.20))}
  const body=new THREE.LatheGeometry(fishLathe,20);body.rotateZ(-Math.PI/2);body.scale(1,1.12,.90);
  function fishPart(g,part){const geom=g.index?g.toNonIndexed():g;geom.deleteAttribute('uv');if(!geom.attributes.normal)geom.computeVertexNormals();geom.setAttribute('aFishPart',new THREE.Float32BufferAttribute(new Array(geom.attributes.position.count).fill(part),1));fishParts.push(geom)}
  fishPart(body,0);
  function fin(points,part){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points.flat(),3));g.computeVertexNormals();fishPart(g,part)}
  fin([[-.19,0,0],[-.31,.063,.002],[-.266,.004,.001],[-.19,0,0],[-.266,.004,.001],[-.31,-.063,.002]],1);
  for(const side of [-1,1])fin([[.045,-.013,side*.028],[-.054,-.024,side*.081],[-.074,-.011,side*.037]],2);
  fin([[.086,.042,0],[-.062,.070,0],[-.144,.035,0]],3);fin([[.004,-.040,0],[-.098,-.055,0],[-.141,-.027,0]],3);
  for(const side of [-1,1]){const ring=new THREE.SphereGeometry(.0065,8,6);ring.translate(.121,.016,side*.034);fishPart(ring,5);const eye=new THREE.SphereGeometry(.0044,8,6);eye.translate(.122,.017,side*.039);fishPart(eye,4)}
  const mouthCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(.188,-.004,-.007),new THREE.Vector3(.201,-.006,0),new THREE.Vector3(.188,-.004,.007)]);fishPart(new THREE.TubeGeometry(mouthCurve,7,.0016,4,false),6);
  const fishG=mergeVertices(mergeGeometries(fishParts),1e-5);
  fishG.setAttribute('aFishType',new THREE.InstancedBufferAttribute(new Float32Array(nativeFishTypes),1));fishG.setAttribute('aFishPhase',new THREE.InstancedBufferAttribute(new Float32Array(nativeFishTypes.map(()=>rnd(0,TAU))),1));
  const fishMat=new THREE.MeshStandardMaterial({roughness:.36,metalness:.22,side:THREE.DoubleSide});fishMat.onBeforeCompile=s=>{
    Object.assign(s.uniforms,shared);s.vertexShader='attribute float aFishType;attribute float aFishPhase;attribute float aFishPart;uniform float uTime;varying vec3 vFish;varying float vFishType;varying float vFishPart;\n'+s.vertexShader;
    s.vertexShader=s.vertexShader.replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
      float fishStretch=aFishType>1.5?(aFishType>2.5?1.12:1.28):.96,fishTall=aFishType<.5?1.48:aFishType<1.5?1.36:aFishType<2.5?.86:.96,fishWidth=aFishType>1.5?.89:1.03;
      objectNormal/=vec3(fishStretch,fishTall,fishWidth);`);
    s.vertexShader=s.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      vFish=position;vFishType=aFishType;vFishPart=aFishPart;transformed.x*=fishStretch;transformed.y*=fishTall;
      transformed.z*=fishWidth;transformed.z+=sin(uTime*(aFishType>2.5?7.5:5.7)+aFishPhase-position.x*19.)*.014*smoothstep(.10,-.30,position.x);`);
    s.fragmentShader='varying vec3 vFish;varying float vFishType;varying float vFishPart;\n'+noiseGLSL+s.fragmentShader;
    s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      float dorsal=smoothstep(-.006,.041,vFish.y),scaleRows=vFish.x*170.+sin(vFish.y*270.)*.7,scales=.5+.5*(filteredWave(scaleRows)*2.-1.)*(filteredWave(vFish.y*290.)*2.-1.);vec3 silver=vec3(.71,.77,.73),skin;
      if(vFishType<.5){skin=mix(vec3(.81,.69,.62),vec3(.56,.20,.20),dorsal);float blueSpots=filteredFlecks(vFish.xy*vec2(90.,170.),.86)*smoothstep(.002,.027,vFish.y);skin=mix(skin,vec3(.23,.49,.63),blueSpots*.75);}
      else if(vFishType<1.5){skin=mix(silver,vec3(.20,.28,.28),dorsal);float bars=pow(.5+.5*sin(vFish.x*91.),5.);skin*=1.-bars*.30;}
      else if(vFishType<2.5){skin=mix(vec3(.78,.81,.73),vec3(.25,.40,.35),dorsal);float spots=filteredFlecks(vFish.xy*125.,.82)*smoothstep(.006,.038,vFish.y);skin*=1.-spots*.25;}
      else{skin=mix(vec3(.80,.83,.72),vec3(.16,.39,.43),dorsal);float gold=1.-smoothstep(.003,.007,abs(vFish.y-.008));skin=mix(skin,vec3(.67,.59,.33),gold*.6);float scutes=pow(abs(filteredWave(vFish.x*240.)*2.-1.),8.)*(1.-smoothstep(.004,.012,abs(vFish.y-.004)));skin*=1.-scutes*.20;}
      skin*=.94+scales*.10;float gill=1.-smoothstep(.0015,.0035,abs(vFish.x-.078));skin*=1.-gill*.35*(1.-smoothstep(.017,.041,abs(vFish.y)));
      if(vFishPart> .5&&vFishPart<3.5)skin=mix(skin,vec3(.50,.56,.48),.36);
      if(vFishPart>3.5&&vFishPart<4.5)skin=vec3(.021,.031,.026);if(vFishPart>4.5&&vFishPart<5.5)skin=vec3(.61,.64,.49);if(vFishPart>5.5)skin=vec3(.16,.20,.16);
      diffuseColor.rgb=skin;`);
    s.fragmentShader=s.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=vFishPart>3.5?.22:.31+scales*.10;');
  };
  const fishMesh=new THREE.InstancedMesh(fishG,fishMat,nativeFishTypes.length);fishMesh.frustumCulled=false;scene.add(fishMesh);

  const fishAgents=[];const fishClearance=.32;
  function fishBed(x,z){return Math.max(terrainHeight(x,z),terrainHeight(x+.21,z),terrainHeight(x-.21,z),terrainHeight(x,z+.21),terrainHeight(x,z-.21))}
  function navigable(x,z,level=tide.current){return inside(x,z,.28)&&level-terrainHeight(x,z)>fishClearance&&level-fishBed(x,z)>.19}
  function safeFishPoint(preferLevel=tide.current){for(let i=0;i<2500;i++){const x=rnd(-4.5,4.5),z=rnd(1.2,4.67);if(navigable(x,z,preferLevel)&&terrainSlope(x,z)<1.4)return new THREE.Vector2(x,z)}return new THREE.Vector2(0,4.67)}
  for(let i=0;i<nativeFishTypes.length;i++){const p=safeFishPoint(-.55);fishAgents.push({p,species:nativeFishTypes[i],angle:rnd(0,TAU),speed:nativeFishTypes[i]===3?rnd(.22,.29):rnd(.14,.22),goal:safeFishPoint(),timer:rnd(1,6),panic:0})}
  const cursor={active:false,p:new THREE.Vector2(99,99),previous:new THREE.Vector2(99,99),velocity:new THREE.Vector2(),age:10,down:new THREE.Vector2(),downTime:0},splash={p:new THREE.Vector2(99,99),age:10};
  function updateFish(dt,t){for(let i=0;i<fishAgents.length;i++){
    const f=fishAgents[i];f.timer-=dt;f.panic=Math.max(0,f.panic-dt);if(f.timer<0||!navigable(f.goal.x,f.goal.y,tide.target)){f.goal=safeFishPoint(Math.min(tide.current,tide.target));f.timer=rnd(4,10)}
    const steer=f.goal.clone().sub(f.p).normalize().multiplyScalar(.65);
    if(f.species===3){const school=fishAgents.filter(o=>o!==f&&o.species===3&&o.p.distanceTo(f.p)<1.35);if(school.length){const center=new THREE.Vector2(),alignment=new THREE.Vector2();for(const other of school){center.add(other.p);alignment.add(new THREE.Vector2(Math.cos(other.angle),Math.sin(other.angle)));const d=f.p.distanceTo(other.p);if(d<.20)steer.add(f.p.clone().sub(other.p).normalize().multiplyScalar((.20-d)*4))}center.multiplyScalar(1/school.length);steer.add(center.sub(f.p).multiplyScalar(.55)).add(alignment.normalize().multiplyScalar(.28))}}
    // Probe forward as well as sideways using the SAME height sampler and the
    // lower of current/target tides: begin retreat before the shore catches up.
    const planning=Math.min(tide.current,tide.target);const e=.26;const depth=planning-terrainHeight(f.p.x,f.p.y);
    const retreat=1-smooth(fishClearance+.015,fishClearance+.13,depth);
    if(retreat>0){const gx=(terrainHeight(f.p.x+e,f.p.y)-terrainHeight(f.p.x-e,f.p.y))/(e*2),gz=(terrainHeight(f.p.x,f.p.y+e)-terrainHeight(f.p.x,f.p.y-e))/(e*2);steer.add(new THREE.Vector2(-gx,-gz).normalize().multiplyScalar(retreat*4.2))}
    for(const [point,age,radius] of [[cursor.p,cursor.age,1.0],[splash.p,splash.age,1.75]])if(age<2){const away=f.p.clone().sub(point),distance=away.length();if(distance<radius){steer.add(away.normalize().multiplyScalar((radius-distance)*3));f.panic=Math.max(f.panic,1.2)}}
    for(const ax of ['x','y'])if(Math.abs(f.p[ax])>4.68)steer[ax]-=Math.sign(f.p[ax])*(Math.abs(f.p[ax])-4.68)*12;
    const desired=Math.atan2(steer.y,steer.x),delta=Math.atan2(Math.sin(desired-f.angle),Math.cos(desired-f.angle));const turn=dt*(2.5+retreat*2.5);f.angle+=clamp(delta,-turn,turn);
    const speed=f.speed*(1+f.panic*1.4)+retreat*.55,step=new THREE.Vector2(Math.cos(f.angle),Math.sin(f.angle)).multiplyScalar(speed*dt),candidate=f.p.clone().add(step);
    if(navigable(candidate.x,candidate.y)){f.p.copy(candidate)}else{f.angle+=dt*4.5;f.timer=0}
    const bottom=fishBed(f.p.x,f.p.y);const fy=clamp(tide.current-.18+Math.sin(t*.7+i)*.014,bottom+.080,tide.current-.105);
    dummy.position.set(f.p.x,fy,f.p.y);dummy.rotation.set(0,-f.angle,Math.sin(t*2+i)*.025);const size=.72+i%3*.055;dummy.scale.setScalar(size);dummy.updateMatrix();fishMesh.setMatrixAt(i,dummy.matrix);
  }fishMesh.instanceMatrix.needsUpdate=true}

  // Fixed 60 Hz 256² GPU wave equation. B stores the PREVIOUS wet mask.
  // Newly dry and newly submerged cells are zeroed, so shoreline changes cannot
  // preserve old energy or create artificial splashes.
  const simSize=256,simTargets=[0,1].map(()=>new THREE.WebGLRenderTarget(simSize,simSize,{type:THREE.HalfFloatType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:false}));
  const passScene=new THREE.Scene(),passCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,1),passQuad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.MeshBasicMaterial());passScene.add(passQuad);
  const passVertex='varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
  const drops=Array.from({length:8},()=>new THREE.Vector4()),dropEnds=Array.from({length:8},()=>new THREE.Vector2()),injections=[];
  const simMat=new THREE.ShaderMaterial({uniforms:{...shared,uPrevious:{value:simTargets[0].texture},uDrops:{value:drops},uEnds:{value:dropEnds},uDropCount:{value:0}},vertexShader:passVertex,fragmentShader:`varying vec2 vUv;uniform sampler2D uPrevious;uniform vec4 uDrops[8];uniform vec2 uEnds[8];uniform int uDropCount;${heightGLSL}
    float wet(vec2 uv){vec2 p=(uv-.5)*10.;return step(.012,visibleWaterAt(p)-terrainAt(p))*roundedMask(p);}
    float neighbor(vec2 uv,float own){vec4 other=texture2D(uPrevious,uv);return mix(own,other.r,wet(uv)*step(.5,other.b));}
    float capsule(vec2 p,vec2 a,vec2 b){vec2 ab=b-a;float t=clamp(dot(p-a,ab)/(dot(ab,ab)+.000001),0.,1.);return length(p-a-ab*t);}
    void main(){vec4 prev=texture2D(uPrevious,vUv);float w=wet(vUv);if(w<.5||prev.b<.5){gl_FragColor=vec4(0.,0.,w,1.);return;}vec2 e=vec2(1./256.,0.);
      float lap=neighbor(vUv+e,prev.r)+neighbor(vUv-e,prev.r)+neighbor(vUv+e.yx,prev.r)+neighbor(vUv-e.yx,prev.r)-4.*prev.r;
      float velocity=(prev.g+lap*.22)*.988;float height=(prev.r+velocity)*.999;
      for(int i=0;i<8;i++){if(i>=uDropCount)break;float d=capsule(vUv,uDrops[i].xy,uEnds[i]);float r=uDrops[i].z;height+=uDrops[i].w*exp(-d*d/(r*r));}
      gl_FragColor=vec4(clamp(height,-.15,.15),velocity,w,1.);
    }`});
  let simIndex=0,simAccumulator=0;
  function runPass(material,target,clear=true){renderer.setRenderTarget(target);if(clear)renderer.clear();passQuad.material=material;renderer.render(passScene,passCamera)}
  const initializeMat=new THREE.ShaderMaterial({uniforms:shared,vertexShader:passVertex,fragmentShader:`varying vec2 vUv;${heightGLSL}void main(){vec2 p=(vUv-.5)*10.;gl_FragColor=vec4(0.,0.,step(.012,visibleWaterAt(p)-terrainAt(p))*roundedMask(p),1.);}`});for(const target of simTargets)runPass(initializeMat,target);renderer.setRenderTarget(null);shared.uRipple.value=simTargets[simIndex].texture;
  function simulateRipples(dt){simAccumulator+=dt;let steps=0;while(simAccumulator>=1/60&&steps++<5){simAccumulator-=1/60;const count=Math.min(injections.length,8);simMat.uniforms.uDropCount.value=count;for(let i=0;i<count;i++){const d=injections.shift();drops[i].set(d.a.x/10+.5,d.a.y/10+.5,d.radius/10,d.power);dropEnds[i].set(d.b.x/10+.5,d.b.y/10+.5)}simMat.uniforms.uPrevious.value=simTargets[simIndex].texture;runPass(simMat,simTargets[1-simIndex]);simIndex=1-simIndex}simAccumulator=Math.min(simAccumulator,1/60);shared.uRipple.value=simTargets[simIndex].texture}

  // Rounded water volume: fixed bottom, moving surface, 0.26 m rolled top rim.
  // aLevel/aOffset let the exact same tide uniform move every ring and side.
  await window.shiosaiStage('正在准备水面与光影',3);
  const waterP=[],waterI=[],waterLevels=[],waterOffsets=[],waterTop=[];
  const ringCount=contour.length;
  const ringSpecs=[{inset:0,offset:0,level:0,top:0}];
  for(let j=0;j<=8;j++){const a=j/8*Math.PI/2;ringSpecs.push({inset:.26*(1-Math.cos(a)),offset:-.26*(1-Math.sin(a)),level:1,top:Math.sin(a)})}
  for(const r of ringSpecs){const ps=roundedContour(r.inset);for(const p of ps){waterP.push(p.x,0,p.y);waterLevels.push(r.level);waterOffsets.push(r.offset);waterTop.push(r.top)}}
  for(let j=0;j<ringSpecs.length-1;j++)for(let k=0;k<ringCount;k++){const a=j*ringCount+k,b=j*ringCount+(k+1)%ringCount,c=a+ringCount,d=b+ringCount;waterI.push(a,c,b,b,c,d)}
  // Top fan subdivision supports the geometric background waves. GPU ripples
  // also perturb fragment normals at full simulation resolution.
  const outer=roundedContour(.26),topStart=(ringSpecs.length-1)*ringCount;
  let previousRing=topStart;
  for(let r=1;r<=38;r++){const factor=1-r/39,newRing=waterP.length/3;for(const p of outer){waterP.push(p.x*factor,0,p.y*factor);waterLevels.push(1);waterOffsets.push(0);waterTop.push(1)}for(let k=0;k<ringCount;k++){const a=previousRing+k,b=previousRing+(k+1)%ringCount,c=newRing+k,d=newRing+(k+1)%ringCount;waterI.push(a,c,b,b,c,d)}previousRing=newRing}
  const center=waterP.length/3;waterP.push(0,0,0);waterLevels.push(1);waterOffsets.push(0);waterTop.push(1);for(let k=0;k<ringCount;k++)waterI.push(previousRing+k,center,previousRing+(k+1)%ringCount);
  const waterG=new THREE.BufferGeometry();waterG.setAttribute('position',new THREE.Float32BufferAttribute(waterP,3));waterG.setAttribute('aLevel',new THREE.Float32BufferAttribute(waterLevels,1));waterG.setAttribute('aOffset',new THREE.Float32BufferAttribute(waterOffsets,1));waterG.setAttribute('aTop',new THREE.Float32BufferAttribute(waterTop,1));waterG.setIndex(waterI);
  // Analytic rolled-rim normals avoid the bright crease that area-weighted
  // triangle normals created between the top and the rounded perimeter.
  const waterNormals=[];
  for(let i=0;i<waterG.attributes.position.count;i++){
    if(i>=ringSpecs.length*ringCount){waterNormals.push(0,1,0);continue}
    const px=waterP[i*3],pz=waterP[i*3+2],ny=waterTop[i],radial=new THREE.Vector2(px-clamp(px,-4.4,4.4),pz-clamp(pz,-4.4,4.4)).normalize(),horizontal=Math.sqrt(Math.max(0,1-ny*ny));
    waterNormals.push(radial.x*horizontal,ny,radial.y*horizontal);
  }
  waterG.setAttribute('normal',new THREE.Float32BufferAttribute(waterNormals,3));
  const resolution=new THREE.Vector2(),inverseProjection=new THREE.Matrix4(),inverseView=new THREE.Matrix4();
  function opaqueTarget(){const t=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:true,samples:mobile?2:4});t.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);t.depthTexture.format=THREE.DepthFormat;t.depthTexture.minFilter=t.depthTexture.magFilter=THREE.NearestFilter;return t}
  const opaqueRT=opaqueTarget(),compositeRT=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:true,samples:Math.min(renderer.capabilities.maxSamples,mobile?2:4)});
  // A bilinear colour footprint can include a foreground silhouette even when
  // its centre depth lies underwater. Guard the whole footprint in every water pass.
  const opticsGLSL=`
    float opticalForeground(vec2 p,float surfaceDepth){
      vec2 e=1.25/uResolution;float d=texture2D(uDepth,p).r;
      d=min(d,texture2D(uDepth,clamp(p+vec2(e.x,e.y),vec2(.001),vec2(.999))).r);
      d=min(d,texture2D(uDepth,clamp(p+vec2(-e.x,e.y),vec2(.001),vec2(.999))).r);
      d=min(d,texture2D(uDepth,clamp(p+vec2(e.x,-e.y),vec2(.001),vec2(.999))).r);
      d=min(d,texture2D(uDepth,clamp(p-e,vec2(.001),vec2(.999))).r);
      return step(d+.0000006,surfaceDepth);
    }
    vec2 guardedRefraction(vec2 original,vec2 candidate,float surfaceDepth){
      return mix(clamp(candidate,vec2(.001),vec2(.999)),original,max(opticalForeground(original,surfaceDepth),opticalForeground(candidate,surfaceDepth)));
    }
    float opticalHitConfidence(vec2 p){vec2 e=1./uResolution;float d=texture2D(uDepth,p).r;
      float spread=max(abs(d-texture2D(uDepth,p+vec2(e.x,0.)).r),abs(d-texture2D(uDepth,p+vec2(0.,e.y)).r));
      return 1.-smoothstep(.000045,.00030,spread);
    }`;
  designChecks.opticalEdges={bilinearForegroundGuard:true,reflectionRequiresDepthCrossing:true,depthTolerance:.0000006,sharedWithFreshwater:true};
  const waterUniforms={...shared,uOpaque:{value:opaqueRT.texture},uDepth:{value:opaqueRT.depthTexture},uResolution:{value:resolution},uInverseProjection:{value:inverseProjection},uInverseView:{value:inverseView},uProjection:{value:camera.projectionMatrix},uView:{value:camera.matrixWorldInverse},uBottom:{value:tide.bottom},uScatter:{value:color(config.water)},uSky:{value:color('#d0ded8')},uSunDirection:{value:new THREE.Vector3()},uSunColor:{value:color('#fff1d4')},uClarity:{value:config.clarity}};
  const waterMat=new THREE.ShaderMaterial({uniforms:waterUniforms,transparent:true,depthTest:false,depthWrite:false,side:THREE.FrontSide,vertexShader:`attribute float aLevel;attribute float aOffset;attribute float aTop;varying vec3 vWater;varying vec3 vWaterNormal;varying float vTop;uniform float uBottom;${heightGLSL}${waveGLSL}
    void main(){vec3 p=position;p.y=mix(uBottom,uTide,aLevel)+aOffset;if(aLevel>.5)p.y+=(waterHeight(p.xz)-uTide)*aTop;vWater=(modelMatrix*vec4(p,1.)).xyz;vWaterNormal=normalize(mat3(modelMatrix)*normal);vTop=aTop;gl_Position=projectionMatrix*viewMatrix*vec4(vWater,1.);}`,
    fragmentShader:`varying vec3 vWater;varying vec3 vWaterNormal;varying float vTop;uniform sampler2D uOpaque;uniform sampler2D uDepth;uniform vec2 uResolution;uniform mat4 uInverseProjection;uniform mat4 uInverseView;uniform mat4 uProjection;uniform mat4 uView;uniform vec3 uScatter;uniform vec3 uSky;uniform vec3 uSunDirection;uniform vec3 uSunColor;uniform float uClarity;uniform float uWaterLight;${heightGLSL}${waveGLSL}${noiseGLSL}${opticsGLSL}
    vec3 reconstruct(vec2 uv,float depth){vec4 p=uInverseProjection*vec4(uv*2.-1.,depth*2.-1.,1.);return p.xyz/p.w;}
    vec2 project(vec3 p){vec4 q=uProjection*vec4(p,1.);return q.xy/q.w*.5+.5;}
    vec4 reflection(vec3 origin,vec3 direction){vec3 p=origin+direction*.10;vec4 result=vec4(0.);float lastGap=0.;bool traced=false;
      for(int i=0;i<${mobile?10:18};i++){float stride=.11+float(i)*.037;p+=direction*stride;vec2 uv=project(p);if(any(lessThan(uv,vec2(.002)))||any(greaterThan(uv,vec2(.998))))break;float d=texture2D(uDepth,uv).r;if(d>=.99999)continue;vec3 behind=reconstruct(uv,d);float gap=behind.z-p.z;
        if(traced&&lastGap<-.001&&gap>.001&&gap<.20+stride&&i>1){vec4 sampleColor=texture2D(uOpaque,uv);float fade=smoothstep(0.,.10,min(min(uv.x,1.-uv.x),min(uv.y,1.-uv.y)));result=vec4(sampleColor.rgb,sampleColor.a*fade*opticalHitConfidence(uv)*(1.-float(i)/${mobile?'20.':'34.'}));break;}lastGap=gap;traced=true;
      }return result;}
    void main(){vec2 uv=gl_FragCoord.xy/uResolution;float sceneDepth=texture2D(uDepth,uv).r;if(gl_FragCoord.z>sceneDepth+.0000006)discard;
      vec3 n=normalize(vWaterNormal);float e=.027;
      vec2 slope=vec2(waterHeight(vWater.xz+vec2(e,0.))-waterHeight(vWater.xz-vec2(e,0.)),waterHeight(vWater.xz+vec2(0.,e))-waterHeight(vWater.xz-vec2(0.,e)))/(2.*e);
      vec2 detail=vec2(sin(vWater.x*36.+vWater.z*29.+uTime*1.6),cos(vWater.x*27.-vWater.z*42.+uTime*1.2))*.008*detailVisibility(vWater.xz*40.);
      n=normalize(n+vec3(-(slope.x+detail.x)*vTop,0.,-(slope.y+detail.y)*vTop));vec3 view=normalize(cameraPosition-vWater);float fresnel=.025+.975*pow(1.-max(dot(view,n),0.),5.);
      vec3 viewPos=(uView*vec4(vWater,1.)).xyz;vec3 viewNormal=normalize(mat3(uView)*n);
      float silhouetteSafe=1.-opticalForeground(uv,gl_FragCoord.z);
      vec2 refractedUv=guardedRefraction(uv,uv+viewNormal.xy*(.004+max(depthAt(vWater.xz),0.)*.008),gl_FragCoord.z);
      vec4 behindColor=texture2D(uOpaque,refractedUv);float behindDepth=texture2D(uDepth,refractedUv).r;
      vec3 behindView=reconstruct(refractedUv,behindDepth);vec3 behindWorld=(uInverseView*vec4(behindView,1.)).xyz;
      float thickness=behindDepth<.9999?length(behindWorld-vWater):max(depthAt(vWater.xz),.5);thickness=clamp(thickness,0.,5.);
      thickness+= (1.-vTop)*(.55+max(depthAt(vWater.xz),0.)*.52);
      vec3 absorption=vec3(1.20,.34,.21)*mix(1.7,.42,uClarity);vec3 transmission=exp(-absorption*thickness);
      vec3 scatter=mix(vec3(.055,.23,.24),uScatter,.75)*.65*uWaterLight;vec3 background=behindColor.a>.01?behindColor.rgb:scatter*1.35;
      vec3 waterColor=background*transmission+scatter*(1.-transmission);
      vec3 reflectionDirection=reflect(normalize(viewPos),viewNormal);vec4 ssr=vec4(0.);if(fresnel>.055&&silhouetteSafe>.5)ssr=reflection(viewPos,reflectionDirection);
      vec3 skyReflection=uSky*(.58+.3*n.y);vec3 reflectionColor=mix(skyReflection,ssr.rgb,ssr.a);
      waterColor=mix(waterColor,reflectionColor,clamp(fresnel*.7+ssr.a*.13*vTop,0.,.62));
      float specularBase=max(dot(reflect(-uSunDirection,n),view),0.);float specularWidth=fwidth(specularBase);float sunGlint=pow(specularBase,80.)/(1.+specularWidth*180.);waterColor+=uSunColor*sunGlint*.48*smoothstep(.88,1.,vTop);
      float h=terrainAt(vWater.xz);float slopeLand=length(vec2(terrainAt(vWater.xz+vec2(.06,0.))-terrainAt(vWater.xz-vec2(.06,0.)),terrainAt(vWater.xz+vec2(0.,.06))-terrainAt(vWater.xz-vec2(0.,.06))))/.12;
      float band=clamp(slopeLand*.085,.014,.045);float foam=(1.-smoothstep(.0,band,abs(h-uTide)))*(1.-smoothstep(.32,.65,slopeLand))*smoothstep(.40,.70,noise(vWater.xz*17.+uTime*.12));
      waterColor=mix(waterColor,vec3(.78,.85,.78)*uWaterLight,foam*.64*vTop);float alpha=mix(.82,1.,vTop);gl_FragColor=vec4(waterColor,alpha);
    }`});
  const water=new THREE.Mesh(waterG,waterMat);water.frustumCulled=false;waterScene.add(water);

  // Flowing freshwater uses the shared depth buffer and the same height-field
  // mask as particles and ripples. The garden overflow has its own concealed outfall.
  // Main course, short inlet and short overflow share one freshwater mesh.
  const riverP=[],riverUV=[],riverFlow=[],riverFall=[],riverCourse=[],riverTravel=[],riverTangents=[],riverI=[],stations=[];
  let along=0;
  for(let course=0;course<springCourses.length;course++){
    const nodes=springCourses[course].nodes;let courseAlong=0;
    for(let i=0;i<nodes.length-1;i++){
      const a=nodes[i],b=nodes[i+1],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz),steps=Math.ceil(len/.04);
      for(let j=0;j<steps;j++){const t=j/steps,previous=i>0?nodes[i-1]:a;let tx=dx/len,tz=dz/len;
        if(j===0&&i>0){const plen=Math.hypot(a[0]-previous[0],a[1]-previous[1]);tx+=(a[0]-previous[0])/plen;tz+=(a[1]-previous[1])/plen;const blendLen=Math.hypot(tx,tz);tx/=blendLen;tz/=blendLen}
        stations.push({x:mix(a[0],b[0],t),z:mix(a[1],b[1],t),y:mix(a[2],b[2],t),w:mix(a[3],b[3],t),nx:-tz,nz:tx,flow:courseAlong+len*t,fall:clamp((a[2]-b[2])/len*.45,0,.8),course});
      }courseAlong+=len;
    }
    const a=nodes.at(-2),b=nodes.at(-1),len=Math.hypot(b[0]-a[0],b[1]-a[1]);stations.push({x:b[0],z:b[1],y:b[2],w:b[3],nx:-(b[1]-a[1])/len,nz:(b[0]-a[0])/len,flow:courseAlong,fall:0,course});if(course===0)along=courseAlong;
  }
  for(const course of springCourses.keys()){
    let travel=0,previous=null;for(const s of stations.filter(s=>s.course===course)){
      s.speed=.22+1.12*Math.sqrt(s.fall)+.045*Math.sin(s.flow*1.9);
      if(previous)travel+=Math.hypot(s.x-previous.x,s.z-previous.z)/((s.speed+previous.speed)/2);
      s.travel=travel;previous=s;
    }
  }
  designChecks.spring.flowEffect={method:'travel-time advection',anisotropicTurbulence:true,impactSpray:true,repeatingCrossBands:false,speedRatio:SPRING_FLOW_RATE};
  designChecks.seabedLight={method:'deforming cellular light lattice',sharedAcrossStoneAndTerrain:true,depthAttenuation:true};
  const riverSlices=10;
  for(const s of stations){const widths=streamWidths(s.w,s.flow,s.course);for(let j=0;j<=riverSlices;j++){const u=j/(riverSlices/2)-1,w=widths[u<0?0:1],x=s.x+s.nx*w*u,z=s.z+s.nz*w*u,y=sampleCourse(x,z,s.course).level;riverP.push(x,y,z);riverUV.push(j/riverSlices,s.flow);riverFlow.push(s.flow);riverFall.push(s.fall);riverCourse.push(s.course);riverTravel.push(s.travel);riverTangents.push(s.nz,-s.fall/.45,-s.nx)}}
  for(let i=0;i<stations.length-1;i++){if(stations[i].course!==stations[i+1].course)continue;for(let j=0;j<riverSlices;j++){const a=i*(riverSlices+1)+j,b=a+1,c=a+riverSlices+1,d=c+1;riverI.push(a,b,c,b,d,c)}}

  const springG=new THREE.BufferGeometry();springG.setAttribute('position',new THREE.Float32BufferAttribute(riverP,3));springG.setAttribute('aRiverUV',new THREE.Float32BufferAttribute(riverUV,2));springG.setAttribute('aTravel',new THREE.Float32BufferAttribute(riverTravel,1));springG.setAttribute('aTangent',new THREE.Float32BufferAttribute(riverTangents,3));springG.setAttribute('aFlow',new THREE.Float32BufferAttribute(riverFlow,1));springG.setAttribute('aFall',new THREE.Float32BufferAttribute(riverFall,1));springG.setAttribute('aCourse',new THREE.Float32BufferAttribute(riverCourse,1));springG.setIndex(riverI);springG.computeVertexNormals();

  const springMat=new THREE.ShaderMaterial({uniforms:{...shared,uOpaque:{value:opaqueRT.texture},uDepth:{value:opaqueRT.depthTexture},uResolution:{value:resolution},uInverseProjection:{value:inverseProjection},uProjection:{value:camera.projectionMatrix},uView:{value:camera.matrixWorldInverse},uSky:waterUniforms.uSky,uRiverEnd:{value:along}},transparent:true,depthTest:false,depthWrite:false,side:THREE.DoubleSide,
    vertexShader:`attribute float aTravel;attribute vec3 aTangent;varying float vTravel;varying vec3 vTangent;attribute vec2 aRiverUV;attribute float aFlow;attribute float aFall;attribute float aCourse;varying float vCourse;varying vec2 vRiverUV;varying float vFlow;varying float vFall;varying vec3 vRiver;varying vec3 vRiverNormal;${heightGLSL}${waveGLSL}
      void main(){vec3 p=position;p.y+=freshwaterOffset(p.xz,aCourse+1.);vRiver=(modelMatrix*vec4(p,1.)).xyz;vRiverNormal=normalize(mat3(modelMatrix)*normal);vTravel=aTravel;vTangent=aTangent;vFlow=aFlow;vFall=aFall;vCourse=aCourse;vRiverUV=aRiverUV;gl_Position=projectionMatrix*viewMatrix*vec4(vRiver,1.);}`,
    fragmentShader:`varying float vTravel;varying vec3 vTangent;varying float vCourse;uniform sampler2D uPrimary;varying vec2 vRiverUV;varying float vFlow;varying float vFall;varying vec3 vRiver;varying vec3 vRiverNormal;uniform sampler2D uOpaque;uniform sampler2D uDepth;uniform vec2 uResolution;uniform mat4 uInverseProjection;uniform mat4 uProjection;uniform mat4 uView;uniform vec3 uSky;uniform float uRiverEnd;uniform float uWaterLight;${heightGLSL}${waveGLSL}${noiseGLSL}${opticsGLSL}
      vec3 reconstructRiver(vec2 uv,float d){vec4 p=uInverseProjection*vec4(uv*2.-1.,d*2.-1.,1.);return p.xyz/p.w;}
      vec2 projectRiver(vec3 p){vec4 q=uProjection*vec4(p,1.);return q.xy/q.w*.5+.5;}
      vec4 riverReflection(vec3 origin,vec3 dir){vec3 p=origin+dir*.075;float previousGap=0.;bool traced=false;for(int i=0;i<12;i++){p+=dir*(.075+float(i)*.022);vec2 uv=projectRiver(p);if(any(lessThan(uv,vec2(.003)))||any(greaterThan(uv,vec2(.997))))break;float d=texture2D(uDepth,uv).r;if(d>.9999)continue;float gap=reconstructRiver(uv,d).z-p.z;if(traced&&previousGap<-.001&&gap>.001&&gap<.16){vec4 c=texture2D(uOpaque,uv);return vec4(c.rgb,c.a*opticalHitConfidence(uv)*(1.-float(i)/17.));}previousGap=gap;traced=true;}return vec4(0.);}
      void main(){vec2 uv=gl_FragCoord.xy/uResolution;if(gl_FragCoord.z>texture2D(uDepth,uv).r+.0000006)discard;if(depthAt(vRiver.xz)>.009&&vRiver.y<waterHeight(vRiver.xz)+.008)discard;
        vec3 tangent=normalize(vTangent),across=normalize(vec3(-tangent.z,0.,tangent.x));
        // Use the hydraulic gradient, not transverse triangulation creases.
        vec3 n=normalize(cross(across,tangent));if(n.y<0.)n=-n;
        float advection=vTravel-uTime*uSpringRate,flowStrength=vCourse<.5?mix(.011,.047,vFall):.003;
        vec2 flowUv=vec2(vRiverUV.x*8.7,advection*5.2),warp=vec2(filteredNoise(flowUv*.41+3.7),filteredNoise(flowUv*.57-9.2))-.5;
        vec2 turbulence=vec2(filteredNoise(flowUv+warp*2.4),filteredNoise(flowUv*vec2(1.7,.61)+warp*1.8+12.8))-.5;
        n=normalize(n+across*turbulence.x*flowStrength+tangent*turbulence.y*flowStrength*.58);
        vec3 vn=normalize(mat3(uView)*n),vp=(uView*vec4(vRiver,1.)).xyz;
        float quietWater=1.-smoothstep(.025,.17,vFall);
        vec2 refractUV=guardedRefraction(uv,uv+vn.xy*.0009*quietWater,gl_FragCoord.z);
        float rawDepth=vRiver.y-terrainAt(vRiver.xz);if(rawDepth<.001)discard;vec4 bed=texture2D(uOpaque,refractUV);
        float aeration=smoothstep(.12,.58,vFall);
        // The rough, aerated cascade softens the projected bed; calm pools
        // retain their clear bottom and sharp reflected planting.
        if(aeration>.01){vec3 softened=vec3(0.);float weight=0.;for(int i=0;i<4;i++){vec2 offset=vec2(i<2?-1.:1.,mod(float(i),2.)<.5?-1.:1.)*.0022;vec2 tap=clamp(uv+offset,vec2(.001),vec2(.999));if(opticalForeground(tap,gl_FragCoord.z)<.5){softened+=texture2D(uOpaque,tap).rgb;weight+=1.;}}if(weight>0.)bed.rgb=mix(bed.rgb,softened/weight,aeration*.78);}
        float thickness=clamp(rawDepth,.008,.25);vec3 trans=exp(-vec3(1.55,.56,.42)*thickness);vec3 rgb=bed.rgb*trans+vec3(.20,.37,.31)*uWaterLight*(1.-trans);rgb=mix(rgb,vec3(.27,.40,.34)*uWaterLight,.045+aeration*.28);
        vec3 view=normalize(cameraPosition-vRiver);float fresnel=.025+.56*pow(1.-max(dot(view,n),0.),5.);
        // Ray-marched reflections are stable in pools; on steep water they
        // otherwise repeat the bright banks as long parallel ribbons.
        float stillPool=1.-smoothstep(.025,.17,vFall);
        if(stillPool>.01&&opticalForeground(uv,gl_FragCoord.z)<.5){vec4 reflected=riverReflection(vp,reflect(normalize(vp),vn));rgb=mix(rgb,mix(uSky*.61,reflected.rgb,reflected.a),clamp(fresnel,.025,.30)*stillPool);}
        float streaks=filteredNoise(flowUv*vec2(1.3,.93)+warp*3.1),breakup=filteredNoise(flowUv*.77+vec2(21.4,4.1));
        float bubbles=filteredNoise(flowUv*2.4+warp*2.8);
        float foam=smoothstep(.18,.58,vFall)*smoothstep(.49,.77,streaks)*smoothstep(.35,.65,breakup)*mix(.46,1.,smoothstep(.34,.67,bubbles));
        float edgeEddy=smoothstep(.29,.61,vFall)*(1.-smoothstep(.06,.21,min(vRiverUV.x,1.-vRiverUV.x)))*smoothstep(.63,.86,breakup);
        rgb=mix(rgb,vec3(.79,.85,.79)*uWaterLight,clamp(foam*.48+edgeEddy*.18,0.,.44));
        float glint=pow(max(dot(reflect(normalize(vp),vn),normalize(vec3(-.32,.83,.42))),0.),36.);rgb+=vec3(.052,.060,.054)*uWaterLight*glint*(.36+breakup*.64);
        float edge=smoothstep(0.,max(fwidth(vRiverUV.x)*1.3,.045),vRiverUV.x)*(1.-smoothstep(1.-max(fwidth(vRiverUV.x)*1.3,.045),1.,vRiverUV.x));edge*=smoothstep(.001,.014,rawDepth);float endFade=vCourse<.5?1.-smoothstep(uRiverEnd-.075,uRiverEnd-.006,vFlow):1.;vec2 primaryUV=(clamp(vRiver.xz/10.+.5,0.,1.)*400.+.5)/401.;float junction=vCourse>.5?1.-texture2D(uPrimary,primaryUV).r:1.;gl_FragColor=vec4(rgb,.94*edge*endFade*junction);
      }`});
  const springMesh=new THREE.Mesh(springG,springMat);springMesh.frustumCulled=false;springMesh.renderOrder=-1;waterScene.add(springMesh);

  // Sparse ballistic droplets rise from actual steep-channel impact pools.
  const impactSeeds=[[-.94,-2.58],[-.93,-2.40],[-.88,-2.24],[-.85,-2.08],[-.91,-1.91]],sprayBases=[],sprayData=[];
  for(let k=0;k<impactSeeds.length;k++){const [x,z]=impactSeeds[k],s=sampleCourse(x,z,0);for(let j=0;j<8;j++){
    const phase=(j*.618033+k*.197)%1,offset=Math.sin(j*2.4+k)*s.width*.45;
    sprayBases.push(x-s.dz*offset,s.level+.009,z+s.dx*offset);sprayData.push(phase,.53+(j%4)*.087,Math.cos(j*2.4),.12+(j%3)*.025);
  }}
  const sprayGeo=new THREE.InstancedBufferGeometry();sprayGeo.setAttribute('position',new THREE.Float32BufferAttribute([-.5,-.5,0,.5,-.5,0,-.5,.5,0,.5,.5,0],3));sprayGeo.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,0,1,1,1],2));sprayGeo.setIndex([0,1,2,1,3,2]);sprayGeo.setAttribute('aBase',new THREE.InstancedBufferAttribute(new Float32Array(sprayBases),3));sprayGeo.setAttribute('aSpray',new THREE.InstancedBufferAttribute(new Float32Array(sprayData),4));sprayGeo.instanceCount=sprayBases.length/3;
  const sprayMat=new THREE.ShaderMaterial({uniforms:{...shared,uDepth:{value:opaqueRT.depthTexture},uResolution:{value:resolution}},transparent:true,depthWrite:false,depthTest:false,
    vertexShader:'attribute vec3 aBase;attribute vec4 aSpray;varying vec2 vUv;varying float vFade;uniform float uSpringRate;uniform float uTime;void main(){float t=fract(aSpray.x+uTime*uSpringRate*aSpray.y);vec3 p=aBase;p.x+=aSpray.z*t*.035;p.z+=t*.036;p.y+=aSpray.w*4.*t*(1.-t);vec4 v=modelViewMatrix*vec4(p,1.);float size=.010+(1.-t)*.004;v.xy+=position.xy*vec2(size*.63,size);gl_Position=projectionMatrix*v;vUv=uv;vFade=sin(t*3.14159265);}',
    fragmentShader:'varying vec2 vUv;varying float vFade;uniform sampler2D uDepth;uniform vec2 uResolution;uniform float uWaterLight;void main(){if(gl_FragCoord.z>texture2D(uDepth,gl_FragCoord.xy/uResolution).r+.0000006)discard;float r=length((vUv-.5)*2.);float alpha=(1.-smoothstep(.1,1.,r))*vFade*.33;if(alpha<.01)discard;gl_FragColor=vec4(vec3(.82,.88,.84)*uWaterLight,alpha);}' });
  const impactSpray=new THREE.Mesh(sprayGeo,sprayMat);impactSpray.frustumCulled=false;impactSpray.renderOrder=0;waterScene.add(impactSpray);



  // Glazing is a transparent pass over the opaque scene, with depth writes off.
  // The opaque depth remains the true wall/interior depth used by both waters.
  const glassMat=new THREE.MeshPhysicalMaterial({color:'#a7bab2',roughness:.16,metalness:.08,transparent:true,opacity:.16,depthWrite:false,side:THREE.DoubleSide});
  const glassGroup=new THREE.Group();
  for(const p of glazingParts){
    let g;if(p.archRise){const s=new THREE.Shape(),r=p.w/2,base=-p.h/2,spring=p.h/2-p.archRise;s.moveTo(-r,base);s.lineTo(r,base);s.lineTo(r,spring);for(let k=1;k<=40;k++){const a=k*Math.PI/40;s.lineTo(r*Math.cos(a),spring+p.archRise*Math.sin(a))}s.closePath();g=new THREE.ShapeGeometry(s,40);}else g=new THREE.PlaneGeometry(p.w,p.h);
    const m=new THREE.Mesh(g,glassMat);m.position.set(p.x,p.y,p.z);if(p.side)m.rotation.y=Math.PI/2;m.renderOrder=2;glassGroup.add(m)
  }scene.add(glassGroup);
  // First-floor service bay: the approved cool-white, satin-silver sliding door.
  const serviceSlidingDoor=(()=>{
    const root=new THREE.Group(),leaf=new THREE.Group();
    root.name='service-sliding-door';leaf.name='service-sliding-door-leaf';
    root.scale.setScalar(.90);root.position.set(0,.0245,-.05);scene.add(root);root.add(leaf);
    const spec={x:-1.232,back:-1.356,front:-.965,bottom:.400,top:.920,travel:.393,head:.942};
    const finishCanvas=document.createElement('canvas');finishCanvas.width=256;finishCanvas.height=256;
    const ctx=finishCanvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,256,256);
    let seed=913;const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
    for(let i=0;i<16000;i++){const v=220+Math.floor(random()*25);ctx.fillStyle=`rgba(${v},${v},${v},.06)`;ctx.fillRect(random()*256,random()*256,1,1);}
    const finish=new THREE.CanvasTexture(finishCanvas);finish.colorSpace=THREE.SRGBColorSpace;
    const panelMat=new THREE.MeshStandardMaterial({color:'#E6E9E7',map:finish,roughness:.87});
    const silverMat=new THREE.MeshStandardMaterial({color:'#939DA1',roughness:.48,metalness:.62});
    const surroundMat=new THREE.MeshStandardMaterial({color:'#ddded7',roughness:.91});
    const recessMat=new THREE.MeshStandardMaterial({color:'#393c35',roughness:.80});
    const box=(parent,x,y,z,w,h,d,mat,name)=>{
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);mesh.position.set(x,y,z);
      mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
    };
    const mid=(spec.back+spec.front)/2,h=spec.top-spec.bottom,w=spec.front-spec.back;
    // A continuous core and perforated face skin form an actual recessed finger pull.
    box(leaf,spec.x-.002,(spec.top+spec.bottom)/2,mid,.021,h,w,panelMat,'door-core');
    const pull={y:.650,z:spec.front-.031,height:.075,width:.008,depth:.004};
    const shape=new THREE.Shape();shape.moveTo(-spec.front,spec.bottom);shape.lineTo(-spec.back,spec.bottom);
    shape.lineTo(-spec.back,spec.top);shape.lineTo(-spec.front,spec.top);shape.closePath();
    const hole=new THREE.Path(),u=-pull.z,low=pull.y-pull.height/2,high=pull.y+pull.height/2;
    hole.moveTo(u-pull.width/2,low);hole.lineTo(u-pull.width/2,high);
    hole.lineTo(u+pull.width/2,high);hole.lineTo(u+pull.width/2,low);hole.closePath();shape.holes.push(hole);
    const skin=new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:pull.depth,steps:1,bevelEnabled:false}),panelMat);
    skin.position.x=spec.x+.0085;skin.rotation.y=Math.PI/2;skin.name='door-face-with-recess';skin.castShadow=true;skin.receiveShadow=true;leaf.add(skin);
    box(leaf,spec.x+.0086,pull.y,pull.z,.0002,pull.height,pull.width,recessMat,'pull-recess-bottom');
    for(const z of [pull.z-pull.width/2,pull.z+pull.width/2])box(leaf,spec.x+.0105,pull.y,z,.004,pull.height,.0012,silverMat,'pull-silver-liner');
    for(const y of [low,high])box(leaf,spec.x+.0105,y,pull.z,.004,.0012,pull.width,silverMat,'pull-silver-liner');
    box(leaf,spec.x+.013,(spec.top+spec.bottom)/2,spec.front-.0016,.0015,h-.006,.0032,silverMat,'door-silver-edge');
    const railMid=(spec.back+spec.front+spec.travel)/2;
    box(root,spec.x,spec.head,railMid,.037,.033,w+spec.travel+.025,surroundMat,'concealed-rail-cover');
    box(root,spec.x+.018,spec.head-.017,railMid,.002,.003,w+spec.travel+.010,recessMat,'rail-shadow-reveal');
    for(const z of [-1.358,-.963])box(root,-1.260,.655,z,.012,.550,.009,surroundMat,'wall-return-jamb');
    let open=false;
    const button=document.getElementById('service-door-toggle'),host=document.getElementById('scene');
    const snapshot=()=>({scheme:'01',doorColour:'#E6E9E7',metalColour:'#939DA1',open,
      progress:leaf.position.z/spec.travel,phase:Math.abs(leaf.position.z-(open?spec.travel:0))<.0004?(open?'open':'closed'):'moving',
      spec:{...spec},recessDepth:pull.depth,floorClearance:spec.bottom-.395,raisedFloorTrack:false});
    const record=()=>{host.dataset.serviceDoor=JSON.stringify(snapshot());};
    function setOpen(value){open=Boolean(value);button.textContent=open?'关闭移门':'打开移门';button.setAttribute('aria-expanded',String(open));
      if(reduced){leaf.position.z=open?spec.travel:0;renderer.shadowMap.needsUpdate=true;}record();}
    button.addEventListener('click',()=>setOpen(!open));
    function update(dt){const target=open?spec.travel:0;
      if(leaf.position.z!==target){leaf.position.z=THREE.MathUtils.lerp(leaf.position.z,target,1-Math.exp(-dt*8));
        if(Math.abs(target-leaf.position.z)<.0004)leaf.position.z=target;renderer.shadowMap.needsUpdate=true;record();}}
    function handleClick(event,raycaster,pointer,camera,canvas,architecture){
      const rect=canvas.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
      root.updateMatrixWorld(true);raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObject(leaf,true)[0];
      if(!hit)return false;const obstacle=raycaster.intersectObject(architecture,false)[0];
      if(obstacle&&obstacle.distance<hit.distance-.002)return false;setOpen(!open);return true;
    }
    record();return {setOpen,update,handleClick,snapshot};
  })();

  // Buried supply and independent overflow drain have real 3D paths. They are
  // completely below their planted cover; no pipe appears at the sea edge.
  const buriedServices=new THREE.Group();
  for(const [index,path] of [gardenSupply,gardenDrain].entries()){let last=Infinity;const pts=[];
    for(let i=0;i<path.length-1;i++)for(let j=0;j<12;j++){const a=path[i],b=path[i+1],t=j/12,x=mix(a[0],b[0],t),z=mix(a[1],b[1],t);let y=mix(a[2],b[2],t)-.028;if(index)y=Math.min(y,terrainHeight(x,z)-.025,last-.0001);last=y;pts.push(new THREE.Vector3(x,y,z))}
    const end=path.at(-1);pts.push(new THREE.Vector3(end[0],index?Math.min(end[2]-.028,terrainHeight(end[0],end[1])-.025,last-.0001):end[2]-.028,end[1]));
    const m=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),100,.007,8,false),new THREE.MeshStandardMaterial({color:'#657664',roughness:.98}));buriedServices.add(m)}buriedServices.visible=false;scene.add(buriedServices);
  const courtReflectionRT=new THREE.WebGLRenderTarget(mobile?768:1280,mobile?512:896,{type:THREE.HalfFloatType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:true});
  const mirrorCamera=new THREE.PerspectiveCamera(),mirrorMatrix=new THREE.Matrix4(),mirrorDirection=new THREE.Vector3(),mirrorTarget=new THREE.Vector3();
  const courtGeometry=poolBottom.clone();courtGeometry.translate(0,COURT_DEPTH,0);
  const courtMat=new THREE.ShaderMaterial({uniforms:{...shared,uOpaque:{value:opaqueRT.texture},uDepth:{value:opaqueRT.depthTexture},uReflection:{value:courtReflectionRT.texture},uMirror:{value:mirrorMatrix},uResolution:{value:resolution},uSky:waterUniforms.uSky},transparent:true,depthWrite:false,depthTest:false,side:THREE.DoubleSide,
    vertexShader:`varying vec3 vCourt;varying vec4 vMirror;uniform mat4 uMirror;${heightGLSL}${waveGLSL}
      void main(){vec3 p=position;p.y+=freshwaterOffset(p.xz,4.);vCourt=(modelMatrix*vec4(p,1.)).xyz;vMirror=uMirror*vec4(vCourt,1.);gl_Position=projectionMatrix*viewMatrix*vec4(vCourt,1.);}`,
    fragmentShader:`varying vec3 vCourt;varying vec4 vMirror;uniform sampler2D uOpaque;uniform sampler2D uDepth;uniform sampler2D uReflection;uniform vec2 uResolution;uniform vec3 uSky;uniform float uWaterLight;${heightGLSL}${waveGLSL}${noiseGLSL}${opticsGLSL}
      void main(){vec2 uv=gl_FragCoord.xy/uResolution;if(gl_FragCoord.z>texture2D(uDepth,uv).r+.0000006)discard;
        vec2 ripple=vec2(filteredWave(vCourt.x*10.+vCourt.z*7.-uTime*.22)-.5,filteredWave(vCourt.z*11.-uTime*.18)-.5)*.0018;
        vec2 bUV=guardedRefraction(uv,uv+ripple*.35,gl_FragCoord.z);
        vec3 bed=texture2D(uOpaque,bUV).rgb;vec2 rUV=clamp(vMirror.xy/vMirror.w+ripple,vec2(.001),vec2(.999));vec4 refl=texture2D(uReflection,rUV);
        vec3 reflected=mix(uSky*.65,refl.rgb,refl.a);vec3 view=normalize(cameraPosition-vCourt),normal=normalize(vec3(ripple.x*2.,1.,ripple.y*2.));
        float fresnel=.12+.68*pow(1.-max(dot(normal,view),0.),4.);vec3 clean=bed*vec3(.91,.97,.94)+vec3(.055,.13,.12)*.05*uWaterLight;
        gl_FragColor=vec4(mix(clean,reflected,clamp(fresnel,.12,.65)),1.);
      }`});
  const courtMesh=new THREE.Mesh(courtGeometry,courtMat);courtMesh.renderOrder=3;courtMesh.frustumCulled=false;waterScene.add(courtMesh);
  let mirrorFrame=0;
  function reflectCourt(){if(camera.position.y<=COURT_LEVEL+.03)return;
    if(mirrorFrame++%12!==0&&!controls._viewChanged)return;controls._viewChanged=false;
    camera.getWorldDirection(mirrorDirection);mirrorCamera.position.copy(camera.position);mirrorCamera.position.y=2*COURT_LEVEL-camera.position.y;
    mirrorDirection.y*=-1;mirrorTarget.copy(mirrorCamera.position).add(mirrorDirection);mirrorCamera.up.copy(camera.up);mirrorCamera.up.y*=-1;mirrorCamera.lookAt(mirrorTarget);
    mirrorCamera.projectionMatrix.copy(camera.projectionMatrix);mirrorCamera.projectionMatrixInverse.copy(camera.projectionMatrixInverse);mirrorCamera.updateMatrixWorld();
    mirrorMatrix.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1).multiply(mirrorCamera.projectionMatrix).multiply(mirrorCamera.matrixWorldInverse);
    // Clip at the water level so below-ground geometry cannot enter the mirror.
    const prior=renderer.clippingPlanes;renderer.clippingPlanes=[new THREE.Plane(new THREE.Vector3(0,1,0),-COURT_LEVEL-.001)];
    renderer.setRenderTarget(courtReflectionRT);renderer.setClearColor(0,0);renderer.clear();renderer.render(scene,mirrorCamera);renderer.clippingPlanes=prior;
  }
  const hydroOverlay=new THREE.Group();hydroOverlay.visible=false;particleScene.add(hydroOverlay);
  function trace(path,hex){const pts=path.map(p=>new THREE.Vector3(p[0],Math.max(.035,p[2],terrainHeight(p[0],p[1]))+.065,p[1]));
    const mat=new THREE.MeshBasicMaterial({color:hex,depthTest:false,depthWrite:false});
    for(let i=0;i<pts.length-1;i++){const a=pts[i],b=pts[i+1],v=b.clone().sub(a),len=v.length();for(let t=0;t<len;t+=.12){const d=Math.min(.077,len-t),m=new THREE.Mesh(new THREE.CylinderGeometry(.011,.011,d,6),mat);m.position.copy(a).addScaledVector(v,(t+d/2)/len);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),v.clone().normalize());m.renderOrder=10;hydroOverlay.add(m)}}
    for(let i=1;i<pts.length;i++){const v=pts[i].clone().sub(pts[i-1]),len=v.length();if(len>.12){const center=pts[i-1].clone().lerp(pts[i],.62),cone=new THREE.Mesh(new THREE.ConeGeometry(.026,.075,8),new THREE.MeshBasicMaterial({color:hex,depthTest:false}));cone.position.copy(center);cone.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),v.normalize());cone.renderOrder=10;hydroOverlay.add(cone)}}}
  trace(springControls[0],'#2f6575');trace(gardenSupply,'#b7782f');trace(springControls[1],'#b7782f');trace(springControls[2],'#296f42');trace(gardenDrain,'#296f42');
  const traceBatches=new Map();for(const m of hydroOverlay.children){m.updateMatrix();const key=m.material.color.getHex(),batch=traceBatches.get(key)||[];batch.push(m.geometry.clone().applyMatrix4(m.matrix));traceBatches.set(key,batch);m.geometry.dispose()}hydroOverlay.clear();
  for(const [hex,parts] of traceBatches){const m=new THREE.Mesh(mergeGeometries(parts,false),new THREE.MeshBasicMaterial({color:hex,depthTest:false,depthWrite:false}));m.renderOrder=10;hydroOverlay.add(m);parts.forEach(g=>g.dispose())}
  controls.addEventListener('change',()=>{controls._viewChanged=true});
  const viewPresets={
    overall:{p:[10.4,9.25,14.0],t:[0,-.45,-.05],fov:38},
    garden:{p:[4.4,3.35,5.0],t:[-.10,1.00,-.38],fov:34},
    coastalGarden:{p:[5.55,2.42,3.20],t:[3.0,.45,.15],fov:42},
    interior:{p:[-.08,1.07,-.80],t:[.47,.63,-.91],fov:95},
    readingInterior:{p:[-1.28,.80,1.48],t:[-1.62,.56,1.22],fov:70},
    pagoda:{p:[6.2,3.65,1.65],t:[2.0,2.45,-2.95],fov:46}
  };
  function inspectionFov(view){
    const v=viewPresets[view],aspect=camera.aspect;
    const factor=aspect<1?Math.min(2.8,1/aspect):1;
    return THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(v.fov)*.5)*factor));
  }
  function setInspectionView(view){
    const v=viewPresets[view];if(!v)return;
    controls._interacted=true;controls._viewChanged=true;
    controls.minDistance=['interior','readingInterior'].includes(view)?.25:view==='overall'?6:1.5;
    controls.minPolarAngle=.01;
    controls.target.set(...v.t);camera.position.set(...v.p);camera.fov=inspectionFov(view);
    camera.clearViewOffset();camera.updateProjectionMatrix();inverseProjection.copy(camera.projectionMatrix).invert();controls.update();
    hydroOverlay.visible=false;document.body.dataset.view=view;
    document.querySelectorAll('[data-scene-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.sceneView===view)));
    $('water-legend').hidden=true;$('hydro-tags').hidden=true;
    window.dispatchEvent(new CustomEvent('shiosai:selected',{detail:view}));
  }

  window.addEventListener('shiosai:view',e=>setInspectionView(e.detail));

  // CPU particle state machine; GPU flotation shares the exact waterHeight().
  // Use the final world-space room bounds, including connected upper rooms and
  // the covered reading vestibule. Open balconies and gardens remain outdoors.
  const particleRoomNames=new Set([...residenceRooms.map(r=>r.name),'separate reading pavilion','narrow reading vestibule']);
  const particleShelters=architectureBounds.filter(b=>particleRoomNames.has(b.label)).map(b=>({name:b.label,left:b.x-b.hx,right:b.x+b.hx,back:b.z-b.hz,front:b.z+b.hz,bottom:b.low,top:b.high}));
  for(const [i,l] of pagodaLevels.entries())particleShelters.push({name:'pagoda interior '+(i+1),left:pagX-l.w/2,right:pagX+l.w/2,back:pagZ-l.w/2,front:pagZ+l.w/2,bottom:l.floor-.045,top:l.roofY});
  let shelteredParticleRecycles=0;
  function particleOverlapsShelter(x,y,z,size){
    // The radius encloses the complete rotating billboard, so petal edges
    // cannot poke through a window while its centre is still outdoors.
    const radius=size*Math.SQRT1_2+.006;
    for(const b of particleShelters)if(x+radius>b.left&&x-radius<b.right&&z+radius>b.back&&z-radius<b.front&&y+radius>b.bottom&&y-radius<b.top)return true;
    return false;
  }
  const PARTICLE={FALLING:0,FLOATING:1,STRANDED:2,RESTING:3,FADING:4},particleCount=mobile?450:700,petalBudget=mobile?135:220;
  const particleG=new THREE.PlaneGeometry(1,1),particleStates=new Float32Array(particleCount),particleKinds=new Float32Array(particleCount),particleOpacity=new Float32Array(particleCount),particlePhases=new Float32Array(particleCount);
  particleG.setAttribute('aState',new THREE.InstancedBufferAttribute(particleStates,1));particleG.setAttribute('aParticleKind',new THREE.InstancedBufferAttribute(particleKinds,1));particleG.setAttribute('aOpacity',new THREE.InstancedBufferAttribute(particleOpacity,1));particleG.setAttribute('aPhase',new THREE.InstancedBufferAttribute(particlePhases,1));
  const particleMat=new THREE.ShaderMaterial({uniforms:{...shared,uDepth:{value:opaqueRT.depthTexture},uResolution:{value:resolution}},transparent:true,depthTest:false,depthWrite:false,side:THREE.DoubleSide,vertexShader:`attribute float aState;attribute float aParticleKind;attribute float aOpacity;attribute float aPhase;varying vec2 vUv;varying float vKind;varying float vOpacity;varying vec3 vParticleWorld;${heightGLSL}${waveGLSL}
    void main(){vUv=uv;vKind=aParticleKind;vOpacity=aOpacity;vec4 p=modelMatrix*instanceMatrix*vec4(position,1.);if(aState>.5&&aState<1.5)p.y=max(waterHeight(p.xz),freshwaterHeight(p.xz))+.013;vParticleWorld=p.xyz;gl_Position=projectionMatrix*viewMatrix*p;}`,
    fragmentShader:`varying vec2 vUv;varying float vKind;varying float vOpacity;varying vec3 vParticleWorld;uniform sampler2D uDepth;uniform vec2 uResolution;${heightGLSL}${waveGLSL}
      void main(){if(gl_FragCoord.z>texture2D(uDepth,gl_FragCoord.xy/uResolution).r+.0000006)discard;if(vKind>1.5&&visibleWaterAt(vParticleWorld.xz)-terrainAt(vParticleWorld.xz)>.008&&roundedMask(vParticleWorld.xz)>.5&&vParticleWorld.y<=max(waterHeight(vParticleWorld.xz),freshwaterHeight(vParticleWorld.xz))+.009)discard;vec2 p=(vUv-.5)*2.;float alpha;vec3 col;
        if(vKind<.5){p.y+=.12;float petal=length(p*vec2(1.12,.82));alpha=1.-smoothstep(.78,1.,petal);float notch=smoothstep(.10,.0,abs(p.x))*smoothstep(.35,.92,p.y);alpha*=1.-notch;col=mix(vec3(.92,.48,.48),vec3(1.,.82,.75),vUv.y);}
        else if(vKind<1.5){float a=atan(p.y,p.x),r=length(p),outline=.64+.22*cos(a*5.);alpha=1.-smoothstep(outline-.06,outline,r);col=mix(vec3(.58,.11,.027),vec3(.95,.44,.07),vUv.y);float vein=pow(abs(cos(a*5.)),25.)*smoothstep(.8,0.,r);col*=1.-vein*.16;}
        else{alpha=1.-smoothstep(.25,.92,length(p));col=vec3(.95,.97,.96);}if(alpha*vOpacity<.01)discard;gl_FragColor=vec4(col,alpha*vOpacity);
      }`});
  const particleMesh=new THREE.InstancedMesh(particleG,particleMat,particleCount);particleMesh.frustumCulled=false;particleScene.add(particleMesh);
  const cherryBlobs=blobs.filter(b=>b.kind===1),deciduousBlobs=blobs.filter(b=>b.kind!==3),particles=[];
  function activeParticleKind(){const s=((seasonal.current%4)+4)%4;if(s<.68||s>3.68)return 0;if(s>1.65&&s<2.65)return 1;if(s>2.68&&s<3.65)return 2;return -1}
  function deferParticleSpawn(p){p.opacity=0;p.disabled=true;p.retryIn=rnd(.4,1.2);return false;}
  function respawnParticle(p,initial=false){const kind=activeParticleKind();p.kind=Math.max(0,kind);p.state=p.support=PARTICLE.FALLING;p.age=0;p.life=rnd(18,40);p.opacity=kind<0||!config.particles?0:1;p.disabled=kind<0||!config.particles;p.retryIn=0;p.sourceTop=null;p.phase=rnd(0,TAU);p.size=p.kind===2?rnd(.027,.050):rnd(.033,.061);p.rotation=rnd(0,TAU);p.restTime=0;p.flutterHz=rnd(.68,1.95);p.flutterPhase=rnd(0,TAU);p.windTimer=rnd(.25,2.6);p.windX=rnd(-.025,.035);p.windZ=rnd(-.035,.045);p.targetWindX=p.windX;p.targetWindZ=p.windZ;p.spin=rnd(-.55,.55);
    if(p.disabled)return false;
    let emitted=false;
    for(let attempt=0;attempt<12;attempt++){
      if(p.kind===2){p.x=rnd(-4.6,4.6);p.z=rnd(-4.5,4.7);p.y=rnd(3.8,6.5);if(initial)p.y+=rnd(0,3)}else{
        const source=p.kind===0?cherryBlobs:deciduousBlobs;if(!source.length)return deferParticleSpawn(p);
        const b=source[Math.floor(rand()*source.length)],angle=rnd(0,TAU),radius=Math.sqrt(rand())*.9;
        // Flower petals and leaves detach within the crown's actual envelope.
        p.x=b.x+Math.cos(angle)*b.r*radius;p.z=b.z+Math.sin(angle)*b.r*radius;
        p.y=b.y+rnd(-.85,.25)*b.r*b.sy*Math.sqrt(1-radius*radius);p.sourceTop=b.y+b.r*b.sy;
        if(initial){
          // Populate the existing fall path below its tree, including near the water.
          const landing=Math.max(terrainHeight(p.x,p.z)+.025,visibleWaterLevel(p.x,p.z)+.028);
          p.y-=rnd(0,Math.max(0,p.y-landing));
        }
      }
      if(!particleOverlapsShelter(p.x,p.y,p.z,p.size)){emitted=true;break;}
    }
    // Retry later when nearby roofs leave no safe point; never relocate petals into the sky.
    if(!emitted)return deferParticleSpawn(p);
    p.vx=rnd(-.055,.055);p.vz=rnd(-.018,.085);p.vy=p.kind===2?rnd(-.28,-.16):rnd(-.155,-.085);return true;
  }
  for(let i=0;i<particleCount;i++){const p={};respawnParticle(p,true);p.age=rnd(0,12);particles.push(p)}
  function updateParticles(dt,t){const kindNow=activeParticleKind();for(let i=0;i<particles.length;i++){
    // Clear the previous GPU instance before any early return or respawn;
    // otherwise an old indoor position can survive after its CPU state moves.
    const p=particles[i];particleOpacity[i]=0;if(kindNow===0&&i>=petalBudget)continue;p.age+=dt;if(p.disabled){if(kindNow>=0&&config.particles){p.retryIn=Math.max(0,(p.retryIn||0)-dt);if(p.retryIn>0||!respawnParticle(p))continue;}else continue}
    if(p.age>p.life||Math.abs(p.x)>5.15||Math.abs(p.z)>5.15||p.y<tide.bottom-.15){respawnParticle(p);continue}
    if(particleOverlapsShelter(p.x,p.y,p.z,p.size)){shelteredParticleRecycles++;respawnParticle(p);continue}
    let support=p.state===PARTICLE.FADING?p.support:p.state;
    const ground=terrainHeight(p.x,p.z),waterLevel=visibleWaterLevel(p.x,p.z),waterPresent=inside(p.x,p.z)&&ground<waterLevel-.008;
    if(support===PARTICLE.FALLING){
      p.windTimer-=dt;if(p.windTimer<=0){p.targetWindX=rnd(-.072,.074);p.targetWindZ=rnd(-.048,.080);p.windTimer=rnd(.65,2.85);}
      const blend=1-Math.exp(-dt*.88);p.windX=mix(p.windX,p.targetWindX,blend);p.windZ=mix(p.windZ,p.targetWindZ,blend);
      const flutter=p.age*p.flutterHz+p.flutterPhase,eddy=Math.sin(p.x*1.3+p.z*.7+t*.23+p.phase)*.016;
      p.x+=(p.vx+p.windX+Math.sin(flutter)*.040+eddy)*dt;p.z+=(p.vz+p.windZ+Math.cos(flutter*.73+p.phase)*.034)*dt;
      p.y+=p.vy*(1+.21*Math.sin(flutter*1.31))*dt;p.rotation+=(p.spin+Math.sin(flutter*.91)*.48)*dt;
      const landingHeight=waterPresent?waterLevel+.025:ground+.02;
      if(p.y<=landingHeight){if(waterPresent){if(p.kind===2){respawnParticle(p);continue}else{support=PARTICLE.FLOATING;p.y=waterLevel+.013}}else{support=PARTICLE.RESTING;p.y=ground+.019;p.restTime=0}}
    }else if(support===PARTICLE.FLOATING){if(!waterPresent){support=PARTICLE.STRANDED;p.y=ground+.02;p.restTime=0}else{
      p.y=waterLevel+.013;if(waterLevel>tide.current+.012){const stream=springSample(p.x,p.z);p.x+=stream.dx*.105*dt*SPRING_FLOW_RATE;p.z+=stream.dz*.105*dt*SPRING_FLOW_RATE}else{p.x+=(.019+Math.sin(t*.24+p.phase)*.014)*dt;p.z+=.031*dt;}p.rotation+=dt*.08;
      for(const [q,age,radius,power] of [[cursor.p,cursor.age,.60,.25],[splash.p,splash.age,1.6,1.2]])if(age<1.4){const dx=p.x-q.x,dz=p.z-q.y,d=Math.hypot(dx,dz);if(d<radius&&d>.001){const force=(1-d/radius)*power*(1-age/1.4);p.x+=dx/d*force*dt;p.z+=dz/d*force*dt}}
    }}else if(support===PARTICLE.STRANDED||support===PARTICLE.RESTING){p.y=ground+.021;p.restTime+=dt;
      // Snow never enters floating/stranded states. Leaves remain eligible to
      // refloat throughout their fade, preserving position as water returns.
      if(waterPresent){if(p.kind===2){respawnParticle(p);continue}support=PARTICLE.FLOATING;p.y=waterLevel+.013;p.restTime=0}
    }
    if(particleOverlapsShelter(p.x,p.y,p.z,p.size)){shelteredParticleRecycles++;respawnParticle(p);continue}
    const seasonFade=p.kind===kindNow&&config.particles?1:Math.max(0,1-p.age/4);const lifeFade=smooth(p.life,p.life-7,p.age);const restFade=support===PARTICLE.RESTING&&p.kind===2?Math.max(0,1-p.restTime/4):1;p.opacity=seasonFade*lifeFade*restFade;p.support=support;p.state=p.opacity<.999?PARTICLE.FADING:support;
    if(p.opacity<.01){respawnParticle(p);continue}
    dummy.position.set(p.x,p.y,p.z);if(support===PARTICLE.FALLING)dummy.rotation.set(Math.sin(p.age*p.flutterHz+p.flutterPhase)*.74,p.rotation,Math.cos(p.age*p.flutterHz*.83+p.phase)*.67);else dummy.rotation.set(-Math.PI/2,0,p.rotation);dummy.scale.setScalar(p.size);dummy.updateMatrix();particleMesh.setMatrixAt(i,dummy.matrix);particleStates[i]=support;particleKinds[i]=p.kind;particlePhases[i]=p.phase;particleOpacity[i]=p.opacity;
  }particleMesh.instanceMatrix.needsUpdate=true;for(const name of ['aState','aParticleKind','aOpacity','aPhase'])particleG.attributes[name].needsUpdate=true}

  const waterInteractions={springClicks:0,seaClicks:0};
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2(),tidePlane=new THREE.Plane(new THREE.Vector3(0,1,0),0),hit=new THREE.Vector3();
  function pointerWater(event){const rect=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);const streamHit=raycaster.intersectObject(springMesh,false)[0];if(streamHit&&streamHit.point.y>tide.current+.015){const obstacles=raycaster.intersectObject(architecture,false);if(!obstacles.length||obstacles[0].distance>streamHit.distance+.015)return new THREE.Vector2(streamHit.point.x,streamHit.point.z)}tidePlane.constant=-tide.current;if(!raycaster.ray.intersectPlane(tidePlane,hit))return null;if(!inside(hit.x,hit.z,.03)||terrainHeight(hit.x,hit.z)>=tide.current-.012)return null;return new THREE.Vector2(hit.x,hit.z)}
  renderer.domElement.addEventListener('pointermove',e=>{const p=pointerWater(e);if(!p){cursor.active=false;return}const prev=cursor.active?cursor.p.clone():p.clone();cursor.velocity.copy(p).sub(prev);cursor.previous.copy(prev);cursor.p.copy(p);cursor.active=true;cursor.age=0;if(!reduced&&prev.distanceTo(p)>.014){injections.push({a:prev,b:p,radius:.095,power:.014*config.ripples});if(injections.length>24)injections.splice(0,injections.length-24)}});
  renderer.domElement.addEventListener('pointerleave',()=>{cursor.active=false});
  // Event timestamps keep a queued click from becoming a long press on a busy GPU.
  renderer.domElement.addEventListener('pointerdown',e=>{cursor.down.set(e.clientX,e.clientY);cursor.downTime=e.timeStamp});
  renderer.domElement.addEventListener('pointerup',e=>{if(cursor.down.distanceTo(new THREE.Vector2(e.clientX,e.clientY))>8||e.timeStamp-cursor.downTime>500)return;if(serviceSlidingDoor.handleClick(e,raycaster,pointer,camera,renderer.domElement,architecture))return;const p=pointerWater(e);if(!p)return;if(springLevel(p.x,p.y)>tide.current+.015)waterInteractions.springClicks++;else waterInteractions.seaClicks++;splash.p.copy(p);splash.age=0;cursor.p.copy(p);cursor.age=0;if(!reduced)injections.push({a:p,b:p,radius:.16,power:.075*config.ripples});for(const f of fishAgents)if(f.p.distanceTo(p)<1.8)f.panic=1.8});

  // Explicit render order: MSAA HDR opaque+depth → copy → manual-depth water
  // → manual-depth floating particles → ACES/sRGB/tilt-shift on alpha canvas.
  const copyMat=new THREE.ShaderMaterial({uniforms:{uSource:{value:opaqueRT.texture}},depthTest:false,depthWrite:false,vertexShader:passVertex,fragmentShader:'varying vec2 vUv;uniform sampler2D uSource;void main(){gl_FragColor=texture2D(uSource,vUv);}'});
  const finalMat=new THREE.ShaderMaterial({uniforms:{uSource:{value:compositeRT.texture},uResolution:{value:resolution},uTilt:{value:config.tilt}},depthTest:false,depthWrite:false,vertexShader:passVertex,fragmentShader:`varying vec2 vUv;uniform sampler2D uSource;uniform vec2 uResolution;uniform float uTilt;
    vec3 ACES(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}
    vec3 srgb(vec3 x){return mix(x*12.92,1.055*pow(max(x,0.),vec3(1./2.4))-.055,step(vec3(.0031308),x));}
    void main(){vec4 sum;if(uTilt<.001){sum=texture2D(uSource,vUv);}else{float focus=abs(vUv.y-.47);float blur=smoothstep(.13,.47,focus)*uTilt*2.3;sum=texture2D(uSource,vUv)*.28;vec2 d=blur/uResolution;
      sum+=texture2D(uSource,vUv+vec2(d.x,0.))*.12;sum+=texture2D(uSource,vUv-vec2(d.x,0.))*.12;sum+=texture2D(uSource,vUv+vec2(0.,d.y))*.12;sum+=texture2D(uSource,vUv-vec2(0.,d.y))*.12;
      sum+=texture2D(uSource,vUv+d)*.06;sum+=texture2D(uSource,vUv-d)*.06;sum+=texture2D(uSource,vUv+vec2(d.x,-d.y))*.06;sum+=texture2D(uSource,vUv+vec2(-d.x,d.y))*.06;}
      gl_FragColor=vec4(srgb(ACES(sum.rgb/max(sum.a,.0001)))*sum.a,sum.a);
    }`});

  const palettes=[
    [['#506339','#a3b474'],['#b98887','#e9c1ba'],['#536d3c','#9db069'],['#344d3c','#718763'],['#2d4e40','#718e68'],['#886276','#c5a5b3']],
    [['#294e32','#7e9d59'],['#3e5d38','#89a36b'],['#335b32','#83a055'],['#294a3b','#668258'],['#254c3c','#678a64'],['#4c6440','#8e9d65']],
    [['#8b5934','#c9a957'],['#72593e','#b89d59'],['#8c3827','#cd7842'],['#344f3e','#798653'],['#325140','#7b8d66'],['#736246','#a7945c']],
    [['#60584a','#918674'],['#6a5b51','#9b8b81'],['#5c5348','#92836e'],['#3b5549','#7e9481'],['#365346','#789080'],['#595f47','#8c9378']]
  ];
  function chooseSeason(s){seasonal.target=Math.round(s);$('season-select').value=String(((seasonal.target%4)+4)%4);const name=seasons[((seasonal.target%4)+4)%4];$('season-name').textContent=name;$('particle-label').textContent=['飘落花瓣','季节微粒','飘落秋叶','飘落雪花'][((seasonal.target%4)+4)%4];document.querySelector('.season-dot').style.background=['#d79d9b','#7b995d','#c76b39','#adc1bf'][((seasonal.target%4)+4)%4]}
  function updateSeason(dt){if(reduced)seasonal.current=seasonal.target;else seasonal.current=mix(seasonal.current,seasonal.target,1-Math.exp(-dt*1.65));if(Math.abs(seasonal.current-seasonal.target)<.001)seasonal.current=seasonal.target;
    showFlowerSeason(seasonal.current);
    const cyclic=((seasonal.current%4)+4)%4,a=Math.floor(cyclic),b=(a+1)%4,f=cyclic-a;seasonal.snow=mix(a===3?1:0,b===3?1:0,smooth(0,1,f));shared.uSnow.value=seasonal.snow;
    for(let k=0;k<6;k++){paletteDark.value[k].copy(color(palettes[a][k][0])).lerp(color(palettes[b][k][0]),f);paletteLight.value[k].copy(color(palettes[a][k][1])).lerp(color(palettes[b][k][1]),f)}groundPalette.value.copy(color(['#7c895b','#647746','#a08b5a','#899181'][a])).lerp(color(['#7c895b','#647746','#a08b5a','#899181'][b]),f);
  }
  function clockText(){const minutes=11*60+Math.round(config.time*(8*60+10));return String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0')}
  let shadowTime=-1,shadowAzimuth=999,shadowSnow=-1;
  function updateLighting(){
    // Preserve the daytime solar path; sunset at 18:15 leads into night by 18:45.
    const sunset=(18*60+15-11*60)/(8*60+10),night=(18*60+45-11*60)/(8*60+10);
    const t=config.time,golden=smooth(.56,sunset,t),dusk=smooth(.68,night,t),daylight=1-smooth(.64,sunset,t),lampLevel=smooth(.76,night,t),az=config.azimuth*Math.PI/180;
    // Animation time drives waves independently; incident sunlight controls their visible optical effects.
    shared.uDaylight.value=daylight;shared.uWaterLight.value=mix(.12,1,daylight);
    const dayElevation=mix(1.17,.035,Math.pow(t,1.35)),sunsetElevation=mix(1.17,.035,Math.pow(sunset,1.35));
    const elevation=dayElevation-sunsetElevation*smooth(.56,sunset,t);
    if(Math.abs(config.time-shadowTime)>.001||config.azimuth!==shadowAzimuth||Math.abs(seasonal.snow-shadowSnow)>.035){renderer.shadowMap.needsUpdate=true;shadowTime=config.time;shadowAzimuth=config.azimuth;shadowSnow=seasonal.snow}
    sun.position.set(Math.sin(az)*Math.cos(elevation)*18,Math.sin(elevation)*18,Math.cos(az)*Math.cos(elevation)*18);sun.color.copy(color('#fff1d8')).lerp(color('#ff9953'),golden);sun.intensity=3.15*daylight;hemi.color.copy(color('#dae8e3')).lerp(color('#b6c2d1'),dusk);hemi.groundColor.copy(color('#a08d69')).lerp(color('#6a7580'),dusk);hemi.intensity=mix(2.15,.40,dusk);fill.intensity=.50*daylight;
    waterUniforms.uSky.value.copy(color('#d0dfda')).lerp(color('#eac79e'),golden*(1.-dusk)).lerp(color('#465866'),dusk);waterUniforms.uSunDirection.value.copy(sun.position).normalize();waterUniforms.uSunColor.value.copy(sun.color).multiplyScalar(sun.intensity*.4);glowMat.emissiveIntensity=mix(.035,2.8,lampLevel);interiorLightUniforms.uInteriorLampLevel.value=mix(.09,.48,lampLevel);roomLightUniforms.uRoomLightLevel.value=mix(.24,.95,lampLevel);for(let i=0;i<warmLights.length;i++)warmLights[i].intensity=[0,0,1.1][i]*lampLevel;
    $('time-value').value=clockText();$('readout').textContent=seasons[((seasonal.target%4)+4)%4]+' · '+clockText();
  }
  function panelOpen(open){$('settings').classList.toggle('open',open);$('settings').inert=!open;$('tune').setAttribute('aria-expanded',String(open));if(open){$('about').hidden=true;$('made').setAttribute('aria-expanded','false')}window.shiosaiPanelChanged(open);if(!open)$('tune').focus({preventScroll:true})}
  $('tune').onclick=()=>panelOpen(!$('settings').classList.contains('open'));$('close-panel').onclick=()=>panelOpen(false);
  $('season-cycle').onclick=()=>chooseSeason(seasonal.target+1);$('season-select').onchange=e=>{let target=Number(e.target.value),currentMod=((seasonal.target%4)+4)%4;chooseSeason(seasonal.target+((target-currentMod+4)%4))};
  $('tide-toggle').onclick=()=>setTide(tide.target<-.275?0:-.55);$('tide').oninput=e=>setTide(Number(e.target.value),1.2);
  $('time').oninput=e=>{config.time=Number(e.target.value);updateLighting()};$('particles').onchange=e=>{config.particles=e.target.checked};
  $('water-color').oninput=e=>{config.water=e.target.value;waterUniforms.uScatter.value.set(config.water)};
  $('waves').oninput=e=>{config.waves=Number(e.target.value);shared.uWave.value=config.waves;$('wave-value').value=config.waves<.016?'平静':config.waves<.04?'轻柔':'起伏'};
  $('ripples').oninput=e=>{config.ripples=Number(e.target.value);$('ripple-value').value=Math.round(config.ripples*100)+'%'};
  $('clarity').oninput=e=>{config.clarity=Number(e.target.value);waterUniforms.uClarity.value=config.clarity;$('clarity-value').value=Math.round(config.clarity*100)+'%'};
  $('caustics').oninput=e=>{config.caustics=Number(e.target.value);shared.uCaustics.value=config.caustics;$('caustics-value').value=Math.round(config.caustics*100)+'%'};
  $('sun').oninput=e=>{config.azimuth=Number(e.target.value);$('sun-value').value=config.azimuth+'°';updateLighting()};
  $('tilt').oninput=e=>{config.tilt=Number(e.target.value);finalMat.uniforms.uTilt.value=config.tilt;$('tilt-value').value=Math.round(config.tilt*100)+'%'};
  $('theme').onclick=()=>{document.body.classList.toggle('dark');$('theme').setAttribute('aria-label',document.body.classList.contains('dark')?'Switch to light theme':'Switch to dark theme')};
  $('made').onclick=()=>{const open=$('about').hidden;$('about').hidden=!open;$('made').setAttribute('aria-expanded',String(open));if(open)panelOpen(false);window.shiosaiAboutChanged(open)};$('close-about').onclick=()=>{$('about').hidden=true;$('made').setAttribute('aria-expanded','false');window.shiosaiAboutChanged(false);$('made').focus()};
  $('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen()}catch(e){$('fullscreen').title='Fullscreen is unavailable in this browser'}};
  document.addEventListener('fullscreenchange',()=>{$('fullscreen').setAttribute('aria-label',document.fullscreenElement?'Exit fullscreen':'Enter fullscreen')});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){if($('settings').classList.contains('open'))panelOpen(false);$('about').hidden=true;$('made').setAttribute('aria-expanded','false')}});
  function reset(){serviceSlidingDoor.setOpen(false);chooseSeason(0);setTide(0,2.8);frameCamera();config.time=.429;config.water='#398d91';config.waves=.026;config.ripples=.6;config.clarity=.72;config.caustics=.55;config.azimuth=-35;config.tilt=0;config.particles=true;
    for(const [id,value] of Object.entries({time:config.time,'water-color':config.water,waves:config.waves,ripples:config.ripples,clarity:config.clarity,caustics:config.caustics,sun:config.azimuth,tilt:config.tilt})){$(id).value=String(value);$(id).dispatchEvent(new Event('input'))}$('particles').checked=true;injections.length=0;for(const p of particles)respawnParticle(p,true);for(const rt of simTargets)runPass(initializeMat,rt);updateLighting();}
  $('reset').onclick=()=>setInspectionView(document.body.dataset.view||'overall');
  function resize(){const w=$('scene').clientWidth,h=$('scene').clientHeight;renderer.setSize(w,h);renderer.getDrawingBufferSize(resolution);opaqueRT.setSize(resolution.x,resolution.y);compositeRT.setSize(resolution.x,resolution.y);camera.aspect=w/h;camera.fov=w<600?THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(35)*.5)/camera.aspect)):32;
    if(document.body.dataset.view){const view=document.body.dataset.view;camera.fov=inspectionFov(view);camera.clearViewOffset();camera.updateProjectionMatrix();inverseProjection.copy(camera.projectionMatrix).invert();controls._viewChanged=true;return;}
    // Off-axis lens leaves the headline its own quiet strip of paper.
    const shiftX=w<600?0:.14,shiftY=w<600?.055:-.01;camera.setViewOffset(w,h,-w*shiftX,-h*shiftY,w,h);camera.updateProjectionMatrix();inverseProjection.copy(camera.projectionMatrix).invert();}
  addEventListener('resize',resize);resize();updateLighting();updateFish(0,0);updateParticles(0,0);
  let last=performance.now(),elapsed=0,frames=0,fpsTime=0,qualityTime=0,qualitySamples=0,qualityTotal=0,qualitySettled=false,introTime=0,visible=true;
  document.addEventListener('visibilitychange',()=>{visible=!document.hidden;last=performance.now()});
  const stats={architectureMeshes:1,flowerSeasonMeshes:4,visibleFlowerMeshes:1,glowMeshes:1,canopyBlobs:blobs.length,trees:trees.length,terrainVertices:terrainGCount(),rippleResolution:256,fish:nativeFishTypes.length,nativeSpecies:speciesNames,particles:particleCount};function terrainGCount(){return terrainGeo.attributes.position.count}
  // A read-only inspection hook makes contracts verifiable without extra files.
  window.__shiosai={stats,get layout(){return {crownIntersections:blobs.filter(b=>intersectsBuilding(b.x,b.z,b.r+.04,b.y-b.r*b.sy-.015,b.y+b.r*b.sy+.015)).length,vegetationTypes:[...new Set(blobs.map(b=>b.kind))],understoryClusters:groundPlants,rearCoverageTrees,design:designChecks,rockClusters:rockPlacements.length,gate:designChecks.gate,corridorRoofs:0,springNodes:springNodes.length,templeStyle:designChecks.temple}},get architecture(){const g=architecture.geometry,result={attributes:Object.keys(g.attributes),indexed:!!g.index,castsShadow:architecture.castShadow,receivesShadow:architecture.receiveShadow,surfaces:{},normalError:0};for(let i=0;i<g.attributes.position.count;i++){const type=g.attributes.surfaceType.getX(i),mask=g.attributes.snowEligible.getX(i),name=Object.keys(SURFACE)[type];const group=result.surfaces[name]||(result.surfaces[name]={count:0,maxSnow:0,minSnow:1});group.count++;group.maxSnow=Math.max(group.maxSnow,mask);group.minSnow=Math.min(group.minSnow,mask);result.normalError=Math.max(result.normalError,Math.abs(Math.hypot(g.attributes.normal.getX(i),g.attributes.normal.getY(i),g.attributes.normal.getZ(i))-1))}return result},get entrances(){architecture.updateMatrixWorld();const ray=new THREE.Raycaster();return designChecks.openEntrances.map(e=>{ray.set(new THREE.Vector3(e.x,e.bottom+(e.top-e.bottom)*.55,e.z+.025),new THREE.Vector3(0,0,-1));ray.near=0;ray.far=.075;return {name:e.name,width:e.width,frontBlocked:ray.intersectObject(architecture,false).length>0}})},get coastalFlowers(){return {shown:shownFlowerSeason,current:seasonal.current,target:seasonal.target,weights:flowerMeshes.map(m=>m.material.opacity),shadowWeights:flowerMeshes.map(m=>m.customDepthMaterial.opacity),counts:coastalGarden.seasonCounts,plants:coastalGarden.plants.length,visibleMeshes:flowerMeshes.filter(m=>m.visible).map(m=>m.name),triangles:flowerMeshes.filter(m=>m.visible).reduce((n,m)=>n+m.geometry.index.count/3,0)}},get particleSafety(){return {protectedRooms:particleShelters.length,indoorVisible:particles.reduce((n,p,i)=>n+(particleOpacity[i]>.01&&particleOverlapsShelter(p.x,p.y,p.z,p.size)?1:0),0),springBudget:petalBudget,petalsAboveSource:particles.reduce((n,p,i)=>n+(particleOpacity[i]>.01&&p.kind===0&&p.support===PARTICLE.FALLING&&p.y>p.sourceTop+.0001?1:0),0),highestPetal:particles.reduce((y,p,i)=>particleOpacity[i]>.01&&p.kind===0?Math.max(y,p.y):y,0),highestCherryCrown:cherryBlobs.reduce((y,b)=>Math.max(y,b.y+b.r*b.sy),0),deferred:particles.filter(p=>p.disabled&&p.retryIn>0).length,outdoorVisible:particleOpacity.reduce((n,a)=>n+(a>.01?1:0),0),recycled:shelteredParticleRecycles}},get lighting(){return {sun:sun.intensity,fill:fill.intensity,hemisphere:hemi.intensity,solarElevation:Math.asin(sun.position.y/sun.position.length())*180/Math.PI,sky:waterUniforms.uSky.value.getHexString(),warmLights:warmLights.map(l=>({position:l.position.toArray(),intensity:l.intensity,distance:l.distance})),lampEmission:glowMat.emissiveIntensity}},get rendering(){return {pixelRatio,buffer:[resolution.x,resolution.y],tilt:config.tilt,opaqueSamples:opaqueRT.samples,compositeSamples:compositeRT.samples,qualitySettled,shaderErrors:renderer.info.programs.filter(p=>p.diagnostics&&p.diagnostics.runnable===false).length,glassPanes:glazingParts.length,reflectionSize:[courtReflectionRT.width,courtReflectionRT.height]}},get state(){return {tide:{...tide},season:{...seasonal},config:{...config},fish:fishAgents.map(f=>({x:f.p.x,z:f.p.y,depth:tide.current-terrainHeight(f.p.x,f.p.y),bodyClearance:fishMesh.instanceMatrix.array[(fishAgents.indexOf(f))*16+13]-fishBed(f.p.x,f.p.y)-.065})),particles:particles.reduce((a,p)=>(a[p.state]=(a[p.state]||0)+1,a),{})}},terrainHeight,navigable};
  // DOM metadata supports read-only inspection of the rendered miniature.
  const staticAudit={stats,coreViews:Object.keys(viewPresets),readingArtwork:designChecks.readingArtwork,readingFurniture:designChecks.readingFurniture};
  $('scene').dataset.audit=JSON.stringify(staticAudit);
  function recordRenderState(){$('scene').dataset.interiorLighting=JSON.stringify({level:roomLightUniforms.uRoomLightLevel.value,count:roomLights.length,rooms:roomLights,exteriorGateIntensity:warmLights[2].intensity});stats.visibleFlowerMeshes=flowerMeshes.filter(m=>m.visible).length;const s=window.__shiosai.state;const rect=renderer.domElement.getBoundingClientRect(),springTargets=[[-.93,-2.4],[.0,.35],[-2.40,-.34]].map(([x,z])=>{const v=new THREE.Vector3(x,springLevel(x,z),z).project(camera);return {x:rect.left+(v.x*.5+.5)*rect.width,y:rect.top+(-v.y*.5+.5)*rect.height}});$('scene').dataset.render=JSON.stringify({rendering:window.__shiosai.rendering,flowers:window.__shiosai.coastalFlowers,waterLighting:{time:config.time,daylight:shared.uDaylight.value,ambient:shared.uWaterLight.value,causticsSetting:config.caustics,effectiveCaustics:shared.uCaustics.value*shared.uDaylight.value,sunIntensity:sun.intensity,sky:waterUniforms.uSky.value.toArray()},tide:s.tide,snow:s.season.snow,minFishDepth:Math.min(...s.fish.map(f=>f.depth)),minFishClearance:Math.min(...s.fish.map(f=>f.bodyClearance)),particles:s.particles,particleSafety:window.__shiosai.particleSafety,waterInteractions:{...waterInteractions},springTargets,freshFloating:particles.filter(p=>p.support===PARTICLE.FLOATING&&springLevel(p.x,p.z)>tide.current+.015).length,view:{x:camera.position.x,y:camera.position.y,z:camera.position.z}})}
  recordRenderState();
  function render(now){requestAnimationFrame(render);if(!visible||(document.body.dataset.state==='arrival'&&window.shiosaiFirstFrame)){last=now;return;}const frameDuration=Math.max(0,(now-last)/1000),dt=Math.min(frameDuration,.07);last=now;elapsed+=Math.min(frameDuration,.5);introTime+=dt;shared.uTime.value=reduced?0:elapsed;cursor.age+=dt;splash.age+=dt;
    serviceSlidingDoor.update(dt);updateTide(dt);updateSeason(dt);if(!reduced&&introTime<4.2&&!controls._interacted){const q=1-smooth(0,4.2,introTime);camera.position.copy(homePosition).multiplyScalar(1+.16*q)}controls.update();camera.updateMatrixWorld();inverseView.copy(camera.matrixWorld);
    if(hydroOverlay.visible)for(const tag of document.querySelectorAll('#hydro-tags span')){const p=tag.dataset.point.split(',').map(Number),v=new THREE.Vector3(...p).project(camera);tag.style.left=(v.x*.5+.5)*innerWidth+'px';tag.style.top=(-v.y*.5+.5)*innerHeight-9+'px'}
    simulateRipples(dt);updateFish(reduced?0:dt,shared.uTime.value);updateParticles(reduced?0:dt,shared.uTime.value);updateLighting();updateHearth(shared.uTime.value);
    renderer.autoClear=true;reflectCourt();renderer.setRenderTarget(opaqueRT);renderer.setClearColor(0,0);renderer.clear();renderer.render(scene,camera);
    runPass(copyMat,compositeRT);renderer.autoClear=false;renderer.setRenderTarget(compositeRT);renderer.render(waterScene,camera);renderer.render(particleScene,camera);
    renderer.setRenderTarget(null);renderer.setClearColor(0,0);renderer.clear();passQuad.material=finalMat;renderer.render(passScene,passCamera);renderer.autoClear=true;
    $('scene').dataset.renderedView=document.body.dataset.view;
    if(frames===0&&!window.shiosaiFirstFrame){window.shiosaiFirstFrame=true;window.dispatchEvent(new Event('shiosai:ready'));}
    frames++;fpsTime+=frameDuration;qualityTime+=frameDuration;if(fpsTime>1){const fps=Math.round(frames/fpsTime);$('fps').textContent=String(fps);recordRenderState();qualityTotal+=fps;qualitySamples++;frames=0;fpsTime=0}
    if(!qualitySettled&&qualityTime>12&&qualitySamples>=7){const average=qualityTotal/qualitySamples,next=average<18?Math.min(pixelRatio,mobile?1.5:1.75):pixelRatio;qualitySettled=true;if(next!==pixelRatio){pixelRatio=next;renderer.setPixelRatio(pixelRatio);resize()}}
  }
  controls.addEventListener('start',()=>{controls._interacted=true});const requestedView=window.shiosaiInitialView||'overall';setInspectionView(viewPresets[requestedView]?requestedView:'overall');await window.shiosaiStage('正在呈现第一束光',3);requestAnimationFrame(render);
  // Resource failures remain visible instead of leaving a blank scene.
  window.addEventListener('error',e=>{if(e.message){$('error').hidden=false;$('error').textContent='风景渲染中断，请刷新页面重试。'}});
  

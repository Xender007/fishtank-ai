// Records the existing simulator and actual shark activations; no invented motion.
const canvas = document.getElementById('reel'), c = canvas.getContext('2d');
const tank = document.createElement('canvas'); tank.width = 990; tank.height = 660;
const tc = tank.getContext('2d');
const ELEVENLABS = location.search.includes('elevenlabs');
const FPS = 30;
let SECONDS = 24;
const mint = '#79f1ca', white = '#eff8f7', muted = '#9cb8c5';
Profiles.v3();
CONFIG.seed = 20260922;
CONFIG.evolution.enabled = false;
CONFIG.life.continuous = false;
CONFIG.fish.count = 45;
CONFIG.sim.generationSeconds = 9000;
World.keepInnovation = true; Innovation.reset();
const world = new World();
world.seedFrom(Persist.fromJSON(window.CHAMPION), false);
const sharkEntry = window.SHARK_HISTORY.generations.at(-1);
world.setSharkBrain(SharkBrain.fromJSON(sharkEntry.brain));
// Let the packs settle, using the real physics and saved champions.
for (let i = 0; i < 180; i++) world.update(CONFIG.sim.dt);
const scenes = ELEVENLABS ? [
  {end:3.6,a:'I gave a shark',b:'a brain.',sub:'A neural network learned how to hunt.'},
  {end:7.15,a:'Then I taught fish',b:'to outsmart it.',sub:'45 fish. One learning predator.'},
  {end:10.65,a:'One question',b:'started all of this.',sub:'“Claude, can you teach me AI?”'},
  {end:14.75,a:'Make it a game.',b:'Make it JavaScript.',sub:'Neural networks from scratch. Zero libraries.'},
  {end:19.55,a:'Learn to escape.',b:'Learn to hunt.',sub:'Fish and sharks train against each other.'},
  {end:25.45,a:'Click a fish.',b:'Look inside its brain.',sub:'See the inputs, weights and calculations.'},
  {end:30,a:'That’s when',b:'AI finally clicked.',sub:'Your turn. Explore the underwater experiment.'}
] : [
  {end:4, a:'I asked AI', b:'to teach me AI.', sub:'So I built a fish tank in JavaScript.'},
  {end:8, a:'Then I gave', b:'the shark a brain.', sub:'45 fish. One predator that learned to hunt.'},
  {end:12, a:'These numbers', b:'become decisions.', sub:'Watch the shark’s real neural activity below.'},
  {end:16, a:'Fish learn to escape.', b:'Sharks learn to hunt.', sub:'Both sides train against each other.'},
  {end:20, a:'Every weight.', b:'Written in JavaScript.', sub:'Neural networks from scratch. Zero libraries.'},
  {end:24, a:'Want to see', b:'inside their brains?', sub:'Open the demo. Click a fish. Explore the math.'}
];
function text(s,x,y,size,color=white,weight=600){c.fillStyle=color;c.font=`${weight} ${size}px "Segoe UI", sans-serif`;c.fillText(s,x,y);}
function box(x,y,w,h,r,fill){c.fillStyle=fill;c.beginPath();c.roundRect(x,y,w,h,r);c.fill();}
function network(t,fish) {
  const shark = world.sharks.find(s=>s.brain);
  const showFish=ELEVENLABS && t>=19.55 && fish;
  const brain=showFish?fish.net:shark?.brain;
  box(45,1010,990,233,22,'#0d2532');
  text(showFish?'FOCUSED FISH’S LIVE BRAIN':'SHARK’S LIVE BRAIN',68,1045,22,mint,700);
  text(showFish?'23 senses  →  evolved network  →  2 actions':'8 senses  →  6 neurons  →  2 actions',showFish?514:548,1045,showFish?19:21,muted,500);
  if(!brain){text('Replacement shark arriving…',80,1140,28);return;}
  const graph=brain.graph(), pos=new Map();
  for(const [column,type] of [0,2,1].entries()){
    const ns=graph.nodes.filter(n=>n.type===type);
    ns.forEach((n,i)=>pos.set(n.id,{x:[278,562,837][column],y:1081+(i+.5)*144/ns.length,n}));
  }
  for(const edge of graph.conns){
    const a=pos.get(edge.from),b=pos.get(edge.to);if(!a||!b||!edge.enabled)continue;
    const strength=Math.min(1,Math.abs(a.n.value*edge.w)/3);
    c.strokeStyle=edge.w>0?`rgba(121,241,202,${.10+strength*.5})`:`rgba(255,133,129,${.1+strength*.4})`;
    c.lineWidth=.7+strength*1.5;c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();
    // Motion indicates signal flow; brightness comes from the actual activation.
    const p=(t*1.1+edge.from*.071)%1;c.fillStyle=`rgba(225,255,244,${strength*.8})`;
    c.beginPath();c.arc(a.x+(b.x-a.x)*p,a.y+(b.y-a.y)*p,2,0,7);c.fill();
  }
  const labels=['fish angle','fish distance','sideways drift','crowd angle','crowd size','wall ahead','hunger','speed'];
  for(const {x,y,n} of pos.values()){
    c.fillStyle=n.value>=0?`rgba(121,241,202,${.3+.7*Math.abs(n.value)})`:`rgba(255,133,129,${.3+.7*Math.abs(n.value)})`;
    c.beginPath();c.arc(x,y,n.type===0?(showFish?2.5:5):9,0,7);c.fill();
    if(n.type===0 && (!showFish||[0,5,9,13,17,21].includes(n.id)))text(showFish?n.name:labels[n.id],78,y+5,15,muted,500);
    if(n.type===1)text(`${n.name.toUpperCase()}  ${n.value.toFixed(2)}`,861,y+5,17,white,600);
  }
}
function draw(t){
  const scene=scenes.find(s=>t<s.end)||scenes.at(-1);
  c.fillStyle='#06131d';c.fillRect(0,0,1080,1350);
  text('FISHTANK / AI',46,53,23,mint,700);
  text('BUILT WITH CLAUDE + JAVASCRIPT',571,53,20,muted,600);
  const index=scenes.indexOf(scene),start=index?scenes[index-1].end:0, enter=Math.min(1,(t-start)*4);
  c.save();c.globalAlpha=.35+.65*enter;
  text(scene.a,45,140+(1-enter)*8,66,white,750);
  text(scene.b,45,219+(1-enter)*8,66,mint,750);c.restore();
  text(scene.sub,48,272,28,muted,500);
  tc.setTransform(1.1,0,0,1.1,0,0);
  const shark=world.sharks[0];
  const focus=world.fish.filter(f=>f.alive).sort((a,b)=>shark?Math.hypot(a.x-shark.x,a.y-shark.y)-Math.hypot(b.x-shark.x,b.y-shark.y):a.id-b.id)[0];
  Render.frame(tc,world,{focused:focus,subject:focus,showAllRays:false,showLineage:false});
  c.save();c.beginPath();c.roundRect(45,303,990,660,22);c.clip();c.drawImage(tank,45,303);c.restore();
  box(65,323,263,40,10,'#06131dea');text('ACTUAL SIMULATION · 1×',79,350,18,mint,650);
  const alive=world.fish.filter(f=>f.alive).length;
  box(812,323,203,40,10,'#06131dea');text(`${alive} FISH ALIVE`,834,350,20,white,700);
  text('Trained brains replayed · fish gen 432 / shark gen '+sharkEntry.generation,48,992,18,muted,500);
  network(t,focus);
  text('TRY IT → fishtank-ai.vercel.app',46,1296,30,mint,700);
  text('Sound optional. Curiosity required.',46,1327,18,muted,400);
  const spacing=300/scenes.length;
  for(let i=0;i<scenes.length;i++){
    box(734+i*spacing,1290,spacing-11,4,2,'#29414c');
    const from=i?scenes[i-1].end:0;
    const progress=Math.max(0,Math.min(1,(t-from)/(scenes[i].end-from)));
    if(progress)box(734+i*spacing,1290,(spacing-11)*progress,4,2,mint);
  }
}
function blobOf(cv){return new Promise(r=>cv.toBlob(r,'image/png'));}
async function upload(name,blob){const r=await fetch('/output/'+name,{method:'POST',body:blob});if(!r.ok)throw Error('Upload failed: '+name);}
async function record(){
  let ac,audioOut,narration;
  if(ELEVENLABS){
    ac=new AudioContext({sampleRate:48000});await ac.resume();
    narration=await ac.decodeAudioData(await(await fetch('elevenlabs-hope.mp3')).arrayBuffer());
    SECONDS=narration.duration+1;
    scenes.at(-1).end=SECONDS;
    audioOut=ac.createMediaStreamDestination();
  }
  const formats=ELEVENLABS?['video/mp4;codecs=avc1.420033,mp4a.40.2','video/mp4;codecs=avc1.42001f,mp4a.40.2']:['video/mp4;codecs=avc1.420033','video/mp4;codecs=avc1.42001f','video/mp4'];
  const mime=formats.find(m=>MediaRecorder.isTypeSupported(m));
  if(!mime)throw Error('This browser cannot record MP4/H.264');
  draw(.5); await upload(ELEVENLABS?'elevenlabs-cover.png':'linkedin-cover.png',await blobOf(canvas));
  const stream=canvas.captureStream(0),track=stream.getVideoTracks()[0];
  if(audioOut)stream.addTrack(audioOut.stream.getAudioTracks()[0]);
  const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:7000000,audioBitsPerSecond:192000});
  const chunks=[];recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  const stopped=new Promise(r=>recorder.onstop=r);
  recorder.start();
  if(narration){const source=ac.createBufferSource();source.buffer=narration;source.connect(audioOut);source.start(ac.currentTime+.15);}
  const begin=performance.now();
  let maxLate=0;
  for(let frame=0;frame<FPS*SECONDS;frame++){
    for(let tick=0;tick<2;tick++)world.update(CONFIG.sim.dt);
    draw(frame/FPS);track.requestFrame();
    if(frame===FPS*(ELEVENLABS?23:10))await upload(ELEVENLABS?'elevenlabs-preview.png':'linkedin-preview.png',await blobOf(canvas));
    const wait=begin+(frame+1)*1000/FPS-performance.now();
    maxLate=Math.max(maxLate,-wait);
    await new Promise(r=>setTimeout(r,Math.max(0,wait)));
  }
  recorder.stop();await stopped;stream.getTracks().forEach(t=>t.stop());
  if(ac)await ac.close();
  const video=new Blob(chunks,{type:mime});
  await upload(ELEVENLABS?'fishtank-ai-linkedin-elevenlabs.mp4':'fishtank-ai-linkedin.mp4',video);
  const v=document.createElement('video');v.src=URL.createObjectURL(video);
  v.muted=true;
  await new Promise((resolve,reject)=>{v.onloadeddata=resolve;v.onerror=reject;});
  const report={mime,bytes:video.size,width:v.videoWidth,height:v.videoHeight,duration:v.duration,frames:Math.ceil(FPS*SECONDS),maxLateMs:Math.round(maxLate),alive:world.fish.filter(f=>f.alive).length,fishGeneration:432,sharkGeneration:sharkEntry.generation};
  if(ELEVENLABS){
    report.voice='User supplied ElevenLabs Hope';report.sourceDuration=narration.duration;report.audioPlaybackRate=1;report.audioStart=.15;report.scenes=scenes;
    report.decodedFrameChecks=[];
    for(const time of [1,12,23,Math.min(28,v.duration-.2)]){
      await new Promise(r=>{v.onseeked=r;v.currentTime=time;});c.drawImage(v,0,0);
      const pixels=c.getImageData(0,0,1080,1350).data;let lit=0;for(let p=0;p<pixels.length;p+=400)if(pixels[p]+pixels[p+1]+pixels[p+2]>180)lit++;
      report.decodedFrameChecks.push({time,litSamples:lit});
    }
    report.audioBytesDecoded=v.webkitAudioDecodedByteCount;
  }
  await upload(ELEVENLABS?'elevenlabs-report.json':'render-report.json',new Blob([JSON.stringify(report,null,2)]));
  await fetch('/done',{method:'POST',body:JSON.stringify(report)});
}
if(location.search.includes('record')||ELEVENLABS)record().catch(e=>fetch('/error',{method:'POST',body:e.stack}));
else {let frame=0;setInterval(()=>{world.update(CONFIG.sim.dt);world.update(CONFIG.sim.dt);draw((frame++/FPS)%SECONDS);},1000/FPS);}

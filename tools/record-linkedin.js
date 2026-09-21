// node tools/record-linkedin.js [absolute Chrome path]
// Uses an isolated, hidden headless Chrome process, local HTTP and MediaRecorder.
const fs=require('fs'),path=require('path'),http=require('http'),os=require('os');
const {spawn}=require('child_process');
const root=path.resolve(__dirname,'..'),out=path.join(root,'assets','linkedin');
const voiceover=process.argv.includes('--voiceover');
const chrome=process.argv.slice(2).find(a=>!a.startsWith('--'))||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'fishtank-reel-'));
let browser, timer;
const server=http.createServer(async(req,res)=>{
  try{
    if(req.url.includes('reel.html'))console.log('Browser loaded the recording page');
    if(req.method==='POST'){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const body=Buffer.concat(chunks);
      if(req.url.startsWith('/output/')){
        const name=path.basename(req.url);
        if(!['linkedin-cover.png','linkedin-preview.png','fishtank-ai-linkedin.mp4','render-report.json','fishtank-ai-linkedin-voiceover.mp4','voiceover-report.json','elevenlabs-analysis.wav','elevenlabs-audio-info.json','fishtank-ai-linkedin-elevenlabs.mp4','elevenlabs-report.json','elevenlabs-cover.png','elevenlabs-preview.png'].includes(name))throw Error('Unknown output');
        fs.writeFileSync(path.join(out,name),body);res.end('saved');console.log(name,body.length+' bytes');
      }else if(req.url==='/done'||req.url==='/error'){
        console.log(req.url,body.toString());res.end('ok');
        setTimeout(()=>{clearTimeout(timer);browser.kill();server.close();process.exit(req.url==='/error'?1:0);},300);
      }else{res.writeHead(404);res.end();}
      return;
    }
    const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));
    if(!file.startsWith(root+path.sep))throw Error('Invalid path');
    const type={'.html':'text/html','.js':'text/javascript','.png':'image/png','.mp4':'video/mp4','.wav':'audio/wav','.mp3':'audio/mpeg'}[path.extname(file)]||'application/octet-stream';
    res.setHeader('Content-Type',type);res.end(fs.readFileSync(file));
  }catch(e){res.writeHead(500);res.end(String(e));console.error(e.message);}
});
server.listen(0,'127.0.0.1',()=>{
  const port=server.address().port;
  const page=process.argv.includes('--inspect-audio')?'audio-info.html':process.argv.includes('--elevenlabs')?'reel.html?elevenlabs':voiceover?'voiceover.html':'reel.html?record';
  browser=spawn(chrome,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--autoplay-policy=no-user-gesture-required','--user-data-dir='+profile,'--window-size=1080,1350',`http://127.0.0.1:${port}/assets/linkedin/${page}`],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  browser.stderr.on('data',data=>console.error(data.toString().slice(0,1000)));
  browser.on('error',e=>{console.error(e);server.close();process.exit(1);});
  timer=setTimeout(()=>{console.error('Recording timed out');browser.kill();server.close();process.exit(1);},120000);
  console.log(process.argv.includes('--inspect-audio')?'Inspecting supplied audio...':'Exporting portrait MP4...');
});

const chat=document.getElementById("chat"),form=document.getElementById("composer"),input=document.getElementById("message"),statusEl=document.getElementById("status"),clearBtn=document.getElementById("clear"),micBtn=document.getElementById("mic"),speakerBtn=document.getElementById("speaker");
const liveOpen=document.getElementById("liveOpen"),livePanel=document.getElementById("livePanel"),liveClose=document.getElementById("liveClose"),liveMain=document.getElementById("liveMain"),liveState=document.getElementById("liveState"),liveLast=document.getElementById("liveLast"),liveOrb=document.getElementById("liveOrb");

let messages=[],busy=false,voiceOn=true;
let liveActive=false,liveStream=null,liveRecorder=null,liveChunks=[],audioCtx=null,analyser=null,rafId=null,currentAudio=null;

function add(text,role){
  const w=document.getElementById("welcome");
  if(w)w.remove();
  const d=document.createElement("div");
  d.className="msg "+(role==="user"?"user":"ai");
  d.textContent=text;
  chat.appendChild(d);
  chat.scrollTop=chat.scrollHeight;
  return d;
}

function pickVoice(){
  if(!("speechSynthesis" in window))return null;
  const voices=speechSynthesis.getVoices();
  return voices.find(v=>/^ku(-|_)/i.test(v.lang))
      || voices.find(v=>/^ar(-|_)/i.test(v.lang))
      || voices.find(v=>/^en(-|_)/i.test(v.lang))
      || voices[0]||null;
}

function browserSpeak(text,onDone){
  if(!voiceOn||!("speechSynthesis" in window)||!text){onDone?.();return;}
  try{
    speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(text);
    const v=pickVoice();
    if(v){u.voice=v;u.lang=v.lang}
    u.rate=.95;u.pitch=1;
    let finished=false;
    const done=()=>{if(finished)return;finished=true;onDone?.()};
    u.onend=done;
    u.onerror=done;
    speechSynthesis.speak(u);
  }catch(e){onDone?.()}
}

async function serverSpeak(text,onDone){
  if(!voiceOn){onDone?.();return}
  try{
    const r=await fetch("/api/tts",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text})});
    if(!r.ok)throw new Error("tts");
    const blob=await r.blob();
    const url=URL.createObjectURL(blob);
    if(currentAudio){try{currentAudio.pause()}catch(e){}}
    const a=new Audio(url);
    currentAudio=a;
    a.playsInline=true;
    a.onended=()=>{URL.revokeObjectURL(url);currentAudio=null;onDone?.()};
    a.onerror=()=>{URL.revokeObjectURL(url);currentAudio=null;browserSpeak(text,onDone)};
    await a.play();
  }catch(e){browserSpeak(text,onDone)}
}

if("speechSynthesis" in window){
  speechSynthesis.getVoices();
  speechSynthesis.onvoiceschanged=()=>speechSynthesis.getVoices();
}else{voiceOn=false;speakerBtn.textContent="🔇"}

speakerBtn.onclick=()=>{
  voiceOn=!voiceOn;
  speakerBtn.textContent=voiceOn?"🔊":"🔇";
  if(!voiceOn){
    if("speechSynthesis" in window)speechSynthesis.cancel();
    if(currentAudio){try{currentAudio.pause()}catch(e){}currentAudio=null}
  }
  statusEl.textContent=voiceOn?"دەنگی JARVIS چالاکە":"دەنگی JARVIS ناچالاکە";
  setTimeout(()=>{if(!busy)statusEl.textContent="JARVIS ئامادەیە"},900);
};

async function send(text){
  text=(text||"").trim();
  if(!text||busy)return;
  busy=true;
  if("speechSynthesis" in window)speechSynthesis.cancel();
  add(text,"user");
  messages.push({role:"user",content:text});
  input.value="";
  statusEl.textContent="JARVIS بیر دەکاتەوە...";
  const bubble=add("...","assistant");
  try{
    const r=await fetch("/api/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({messages})});
    const data=await r.json();
    const answer=data.response||data.error||"وەڵامێک نەگەیشت.";
    bubble.textContent=answer;
    messages.push({role:"assistant",content:answer});
    statusEl.textContent="JARVIS ئامادەیە";
    if(data.response)browserSpeak(answer);
  }catch(e){
    bubble.textContent="کێشەی پەیوەندی بە AI هەیە.";
    statusEl.textContent="AI connection error";
  }finally{busy=false;input.focus()}
}

form.addEventListener("submit",e=>{e.preventDefault();send(input.value)});
document.querySelectorAll("[data-p]").forEach(b=>b.onclick=()=>send(b.dataset.p));
clearBtn.onclick=()=>{
  messages=[];
  if("speechSynthesis" in window)speechSynthesis.cancel();
  chat.innerHTML='<div class="welcome" id="welcome"><div class="orb bigorb"></div><h2>سڵاو، من JARVIS ـم.</h2><div>فەرمانەکەت بنووسە یان Live Voice بەکاربهێنە.</div></div>';
};

function setLiveState(state,text){
  liveOrb.classList.remove("thinking","speaking");
  if(state==="thinking")liveOrb.classList.add("thinking");
  if(state==="speaking")liveOrb.classList.add("speaking");
  liveState.textContent=text;
}

function stopAnalysis(){
  if(rafId){cancelAnimationFrame(rafId);rafId=null}
}

async function ensureMic(){
  if(liveStream)return liveStream;
  liveStream=await navigator.mediaDevices.getUserMedia({
    audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},
    video:false
  });
  audioCtx=new (window.AudioContext||window.webkitAudioContext)();
  await audioCtx.resume();
  const source=audioCtx.createMediaStreamSource(liveStream);
  analyser=audioCtx.createAnalyser();
  analyser.fftSize=1024;
  source.connect(analyser);
  return liveStream;
}

function chooseMime(){
  const types=["audio/mp4","audio/webm;codecs=opus","audio/webm"];
  for(const t of types){if(window.MediaRecorder&&MediaRecorder.isTypeSupported(t))return t}
  return "";
}

async function startListeningTurn(){
  if(!liveActive)return;
  try{
    await ensureMic();
    setLiveState("listening","گوێم لێتە — قسە بکە...");
    liveLast.textContent="قسە بکە؛ کاتێک وەستایت، JARVIS خۆکارانە وەڵام دەدات.";
    liveChunks=[];

    const mime=chooseMime();
    liveRecorder=mime?new MediaRecorder(liveStream,{mimeType:mime}):new MediaRecorder(liveStream);
    const started=Date.now();
    let heard=false,lastVoice=started;

    liveRecorder.ondataavailable=e=>{if(e.data&&e.data.size)liveChunks.push(e.data)};
    liveRecorder.onstop=async()=>{
      stopAnalysis();
      if(!liveActive)return;
      const blob=new Blob(liveChunks,{type:liveRecorder.mimeType||"audio/mp4"});
      if(blob.size<1200){setTimeout(startListeningTurn,250);return}
      await processVoiceTurn(blob);
    };
    liveRecorder.start(250);

    const data=new Uint8Array(analyser.fftSize);
    const monitor=()=>{
      if(!liveActive||!liveRecorder||liveRecorder.state!=="recording")return;
      analyser.getByteTimeDomainData(data);
      let sum=0;
      for(let i=0;i<data.length;i++){const x=(data[i]-128)/128;sum+=x*x}
      const rms=Math.sqrt(sum/data.length);
      liveOrb.style.transform="scale("+(1+Math.min(rms*2.5,.16))+")";
      const now=Date.now();
      if(rms>.028){heard=true;lastVoice=now}
      if(heard&&now-lastVoice>900&&now-started>1000){liveRecorder.stop();return}
      if(now-started>15000){liveRecorder.stop();return}
      rafId=requestAnimationFrame(monitor);
    };
    monitor();
  }catch(e){
    console.error(e);
    setLiveState("idle","Microphone مۆڵەتی پێ نەدرا");
    liveLast.textContent="لە Safari Settings ـدا Microphone بۆ ئەم site ـە Allow بکە.";
    liveActive=false;
    liveMain.textContent="دووبارە هەوڵدان";
    liveMain.classList.remove("end");
  }
}

async function processVoiceTurn(blob){
  setLiveState("thinking","JARVIS بیر دەکاتەوە...");
  liveOrb.style.transform="scale(1)";
  try{
    const fd=new FormData();
    fd.append("audio",blob,"voice-turn");
    fd.append("history",JSON.stringify(messages.slice(-12)));
    const r=await fetch("/api/voice-turn",{method:"POST",body:fd});
    const data=await r.json();
    if(!r.ok||!data.ok)throw new Error(data.error||"voice");
    const transcript=(data.transcript||"").trim();
    const answer=(data.response||"").trim();
    if(transcript)messages.push({role:"user",content:transcript});
    if(answer)messages.push({role:"assistant",content:answer});
    liveLast.textContent=answer||"وەڵامێک نەگەیشت.";
    setLiveState("speaking","JARVIS قسە دەکات...");
    serverSpeak(answer,()=>{
      if(!liveActive)return;
      setLiveState("listening","گوێم لێتە — قسە بکە...");
      setTimeout(startListeningTurn,250);
    });
  }catch(e){
    console.error(e);
    setLiveState("idle","هەڵەی Voice AI");
    liveLast.textContent="دووبارە قسە بکە، یان Live داخە و دووبارە بکەرەوە.";
    if(liveActive)setTimeout(startListeningTurn,1200);
  }
}

async function startLive(){
  if(liveActive)return;
  liveActive=true;
  liveMain.textContent="کۆتایی پێبهێنە";
  liveMain.classList.add("end");
  setLiveState("thinking","Microphone ئامادە دەکرێت...");
  try{
    await ensureMic();
    startListeningTurn();
  }catch(e){
    liveActive=false;
    liveMain.textContent="دەستپێکردن";
    liveMain.classList.remove("end");
    setLiveState("idle","Microphone مۆڵەتی پێ نەدرا");
  }
}

function endLive(){
  liveActive=false;
  stopAnalysis();
  if(liveRecorder&&liveRecorder.state==="recording"){try{liveRecorder.stop()}catch(e){}}
  liveRecorder=null;
  if(currentAudio){try{currentAudio.pause()}catch(e){}currentAudio=null}
  if("speechSynthesis" in window)speechSynthesis.cancel();
  if(liveStream){liveStream.getTracks().forEach(t=>t.stop());liveStream=null}
  if(audioCtx){try{audioCtx.close()}catch(e){}audioCtx=null}
  analyser=null;
  liveMain.textContent="دەستپێکردن";
  liveMain.classList.remove("end");
  setLiveState("idle","Live کۆتایی هات");
  liveLast.textContent="هەر کات دەتەوێت، دووبارە دەستپێبکە.";
}

function openLive(){
  livePanel.classList.add("show");
  livePanel.setAttribute("aria-hidden","false");
}
function closeLive(){
  endLive();
  livePanel.classList.remove("show");
  livePanel.setAttribute("aria-hidden","true");
}

liveOpen.onclick=openLive;
micBtn.onclick=openLive;
liveClose.onclick=closeLive;
liveMain.onclick=()=>liveActive?endLive():startLive();

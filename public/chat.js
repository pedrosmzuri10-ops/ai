const chat=document.getElementById("chat"),form=document.getElementById("composer"),input=document.getElementById("message"),statusEl=document.getElementById("status"),clearBtn=document.getElementById("clear"),micBtn=document.getElementById("mic"),speakerBtn=document.getElementById("speaker");
const liveOpen=document.getElementById("liveOpen"),livePanel=document.getElementById("livePanel"),liveClose=document.getElementById("liveClose"),liveMain=document.getElementById("liveMain"),liveState=document.getElementById("liveState"),liveLast=document.getElementById("liveLast"),liveOrb=document.getElementById("liveOrb");

let messages=[],busy=false,voiceOn=true;
let liveActive=false,liveStream=null,liveRecorder=null,liveChunks=[];
let audioCtx=null,analyser=null,rafId=null,currentSource=null,currentSourceEnded=null;
let bargeRaf=null,bargeSince=0,bargeLocked=false;

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
  return voices.find(v=>/^ku(-|_)?/i.test(v.lang))
      || voices.find(v=>/^fa(-|_)?/i.test(v.lang))
      || voices.find(v=>/^ar-IQ/i.test(v.lang))
      || voices.find(v=>/^ar(-|_)?/i.test(v.lang))
      || voices[0]
      || null;
}

async function ensureAudio(){
  if(!audioCtx)audioCtx=new (window.AudioContext||window.webkitAudioContext)();
  if(audioCtx.state!=="running"){
    try{await audioCtx.resume()}catch(e){}
  }
  try{
    const b=audioCtx.createBuffer(1,1,22050);
    const s=audioCtx.createBufferSource();
    s.buffer=b;s.connect(audioCtx.destination);s.start(0);
  }catch(e){}
  return audioCtx;
}

function browserSpeak(text,onDone){
  if(!voiceOn||!("speechSynthesis" in window)||!text){onDone?.();return}
  try{
    speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(text);
    const v=pickVoice();
    if(v){
      u.voice=v;
      u.lang=v.lang;
    }else{
      u.lang="ku";
    }
    u.rate=1.03;
    u.pitch=.96;
    u.volume=1;

    let finished=false;
    const done=()=>{if(finished)return;finished=true;onDone?.()};
    u.onend=done;
    u.onerror=done;

    speechSynthesis.speak(u);
  }catch(e){onDone?.()}
}

function stopBargeWatcher(){
  if(bargeRaf){cancelAnimationFrame(bargeRaf);bargeRaf=null}
  bargeSince=0;
}

function stopSpeaking(){
  stopBargeWatcher();
  if(currentSource){
    try{currentSource.onended=null;currentSource.stop(0)}catch(e){}
    currentSource=null;
  }
  if("speechSynthesis" in window){
    try{speechSynthesis.cancel()}catch(e){}
  }
  currentSourceEnded=null;
}

function rmsNow(){
  if(!analyser)return 0;
  const data=new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);
  let sum=0;
  for(let i=0;i<data.length;i++){
    const x=(data[i]-128)/128;
    sum+=x*x;
  }
  return Math.sqrt(sum/data.length);
}

function startBargeWatcher(){
  stopBargeWatcher();
  if(!liveActive||!analyser)return;

  const watch=()=>{
    if(!liveActive||bargeLocked)return;
    const rms=rmsNow();
    const now=performance.now();

    if(rms>.06){
      if(!bargeSince)bargeSince=now;
      if(now-bargeSince>130){
        bargeLocked=true;
        liveLast.textContent="باشە، گوێم لێتە...";
        setLiveState("listening","قسەت پێبڕی — گوێم لێتە...");
        stopSpeaking();
        setTimeout(()=>{
          bargeLocked=false;
          if(liveActive)startListeningTurn(true);
        },50);
        return;
      }
    }else{
      bargeSince=0;
    }
    bargeRaf=requestAnimationFrame(watch);
  };

  bargeRaf=requestAnimationFrame(watch);
}

async function speakLive(text,onDone){
  if(!voiceOn||!text){onDone?.();return}
  await ensureAudio();

  // For Sorani, using the iPhone's local system speech starts much faster
  // than waiting for a second network TTS request.
  browserSpeak(text,onDone);
  startBargeWatcher();
}

if("speechSynthesis" in window){
  speechSynthesis.getVoices();
  speechSynthesis.onvoiceschanged=()=>speechSynthesis.getVoices();
}else{
  voiceOn=false;
  speakerBtn.textContent="🔇";
}

speakerBtn.onclick=()=>{
  voiceOn=!voiceOn;
  speakerBtn.textContent=voiceOn?"🔊":"🔇";
  if(!voiceOn)stopSpeaking();
  statusEl.textContent=voiceOn?"دەنگی JARVIS چالاکە":"دەنگی JARVIS ناچالاکە";
  setTimeout(()=>{if(!busy)statusEl.textContent="JARVIS ئامادەیە"},700);
};

async function send(text){
  text=(text||"").trim();
  if(!text||busy)return;
  busy=true;
  stopSpeaking();

  add(text,"user");
  messages.push({role:"user",content:text});
  input.value="";
  statusEl.textContent="JARVIS بیر دەکاتەوە...";
  const bubble=add("...","assistant");

  try{
    const r=await fetch("/api/chat",{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({messages})
    });
    const data=await r.json();
    const answer=data.response||data.error||"وەڵامێک نەگەیشت.";
    bubble.textContent=answer;
    messages.push({role:"assistant",content:answer});
    statusEl.textContent="JARVIS ئامادەیە";
    if(data.response)browserSpeak(answer);
  }catch(e){
    bubble.textContent="کێشەی پەیوەندی بە AI هەیە.";
    statusEl.textContent="AI connection error";
  }finally{
    busy=false;
    input.focus();
  }
}

form.addEventListener("submit",e=>{e.preventDefault();send(input.value)});
document.querySelectorAll("[data-p]").forEach(b=>b.onclick=()=>send(b.dataset.p));

clearBtn.onclick=()=>{
  messages=[];
  stopSpeaking();
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
  await ensureAudio();
  if(liveStream)return liveStream;

  liveStream=await navigator.mediaDevices.getUserMedia({
    audio:{
      echoCancellation:true,
      noiseSuppression:true,
      autoGainControl:true,
      channelCount:1
    },
    video:false
  });

  const source=audioCtx.createMediaStreamSource(liveStream);
  analyser=audioCtx.createAnalyser();
  analyser.fftSize=1024;
  analyser.smoothingTimeConstant=.3;
  source.connect(analyser);

  return liveStream;
}

function chooseMime(){
  const types=[
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/webm;codecs=opus",
    "audio/webm"
  ];
  for(const t of types){
    try{
      if(window.MediaRecorder&&MediaRecorder.isTypeSupported(t))return t;
    }catch(e){}
  }
  return "";
}

async function startListeningTurn(fromInterrupt=false){
  if(!liveActive||bargeLocked)return;

  try{
    stopSpeaking();
    await ensureMic();

    setLiveState("listening",fromInterrupt?"گوێم لێتە — بەردەوام بە...":"گوێم لێتە — قسە بکە...");
    liveLast.textContent=fromInterrupt
      ?"قسەت پێبڕی. بەردەوام بە."
      :"قسە بکە؛ کاتێک وەستایت، زوو وەڵامت دەدەمەوە.";

    liveChunks=[];
    const mime=chooseMime();
    liveRecorder=mime
      ? new MediaRecorder(liveStream,{mimeType:mime,audioBitsPerSecond:48000})
      : new MediaRecorder(liveStream);

    const started=performance.now();
    let heard=false,lastVoice=started,voiceFrames=0;

    liveRecorder.ondataavailable=e=>{
      if(e.data&&e.data.size)liveChunks.push(e.data);
    };

    liveRecorder.onstop=async()=>{
      stopAnalysis();
      liveOrb.style.transform="scale(1)";
      if(!liveActive)return;

      const blob=new Blob(liveChunks,{type:liveRecorder.mimeType||"audio/mp4"});

      if(!heard||blob.size<700){
        setTimeout(()=>{if(liveActive)startListeningTurn(false)},100);
        return;
      }

      await processVoiceTurn(blob);
    };

    liveRecorder.start(120);

    const monitor=()=>{
      if(!liveActive||!liveRecorder||liveRecorder.state!=="recording")return;

      const rms=rmsNow();
      const now=performance.now();
      liveOrb.style.transform="scale("+(1+Math.min(rms*2.5,.16))+")";

      if(rms>.024){
        voiceFrames++;
        if(voiceFrames>=2){
          heard=true;
          lastVoice=now;
        }
      }else{
        voiceFrames=Math.max(0,voiceFrames-1);
      }

      // Faster turn end: about 0.45s of silence.
      if(heard&&now-lastVoice>450&&now-started>650){
        try{liveRecorder.stop()}catch(e){}
        return;
      }

      if(now-started>16000){
        try{liveRecorder.stop()}catch(e){}
        return;
      }

      rafId=requestAnimationFrame(monitor);
    };

    rafId=requestAnimationFrame(monitor);

  }catch(e){
    console.error("mic failed",e);
    setLiveState("idle","Microphone مۆڵەتی پێ نەدرا");
    liveLast.textContent="لە Safari ـدا Microphone بۆ ئەم site ـە Allow بکە.";
    liveActive=false;
    liveMain.textContent="دووبارە هەوڵدان";
    liveMain.classList.remove("end");
  }
}

async function processVoiceTurn(blob){
  setLiveState("thinking","JARVIS زوو وەڵام ئامادە دەکات...");
  liveOrb.style.transform="scale(1)";

  try{
    const fd=new FormData();
    fd.append("audio",blob,"voice-turn."+((blob.type||"").includes("webm")?"webm":"m4a"));
    fd.append("history",JSON.stringify(messages.slice(-8)));

    const r=await fetch("/api/voice-turn",{method:"POST",body:fd});
    const data=await r.json();

    if(!r.ok||!data.ok)throw new Error(data.detail||data.error||"voice");

    const transcript=(data.transcript||"").trim();
    const answer=(data.response||"").trim();

    if(transcript)messages.push({role:"user",content:transcript});
    if(answer)messages.push({role:"assistant",content:answer});

    liveLast.textContent=answer||"وەڵامێک نەگەیشت.";
    setLiveState("speaking","JARVIS بە کوردی وەڵام دەداتەوە...");

    await ensureAudio();
    speakLive(answer,()=>{
      if(!liveActive)return;
      setLiveState("listening","گوێم لێتە — قسە بکە...");
      setTimeout(()=>{if(liveActive)startListeningTurn(false)},60);
    });

  }catch(e){
    console.error("voice turn failed",e);
    setLiveState("idle","Voice AI هەڵەی دا");
    liveLast.textContent="دووبارە قسە بکە؛ JARVIS گوێ دەگرێت.";
    if(liveActive)setTimeout(()=>startListeningTurn(false),400);
  }
}

async function startLive(){
  if(liveActive)return;

  try{
    liveActive=true;
    liveMain.textContent="کۆتایی پێبهێنە";
    liveMain.classList.add("end");
    setLiveState("thinking","دەنگ و Microphone ئامادە دەکرێن...");

    await ensureAudio();
    await ensureMic();

    setLiveState("speaking","JARVIS ئامادەیە...");
    browserSpeak("سڵاو، گوێم لێتە.",()=>{
      if(liveActive)setTimeout(()=>startListeningTurn(false),60);
    });

  }catch(e){
    console.error(e);
    liveActive=false;
    liveMain.textContent="دەستپێکردن";
    liveMain.classList.remove("end");
    setLiveState("idle","Microphone یان دەنگ چالاک نەبوو");
    liveLast.textContent="Safari ـدا Microphone = Allow بکە و دووبارە هەوڵ بدە.";
  }
}

function endLive(){
  liveActive=false;
  bargeLocked=false;
  stopAnalysis();
  stopSpeaking();

  if(liveRecorder&&liveRecorder.state==="recording"){
    try{liveRecorder.onstop=null;liveRecorder.stop()}catch(e){}
  }
  liveRecorder=null;

  if(liveStream){
    liveStream.getTracks().forEach(t=>t.stop());
    liveStream=null;
  }

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

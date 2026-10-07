const chat=document.getElementById("chat"),form=document.getElementById("composer"),input=document.getElementById("message"),statusEl=document.getElementById("status"),clearBtn=document.getElementById("clear"),micBtn=document.getElementById("mic"),speakerBtn=document.getElementById("speaker");
const liveOpen=document.getElementById("liveOpen"),livePanel=document.getElementById("livePanel"),liveClose=document.getElementById("liveClose"),liveMain=document.getElementById("liveMain"),liveState=document.getElementById("liveState"),liveLast=document.getElementById("liveLast"),liveOrb=document.getElementById("liveOrb");

let messages=[],busy=false,voiceOn=true;
let liveActive=false,liveStream=null,audioCtx=null,micSource=null,analyser=null,rafId=null;
let processor=null,silentGain=null,pcmChunks=[],captureRate=48000;
let currentSource=null,speakingNow=false,bargeRaf=null,bargeSince=0,bargeLocked=false;

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
      || voices[0] || null;
}

function unlockSpeech(){
  if(!("speechSynthesis" in window))return;
  try{
    const u=new SpeechSynthesisUtterance(".");
    u.volume=0;
    u.rate=10;
    speechSynthesis.speak(u);
  }catch(e){}
}

async function ensureAudio(){
  if(!audioCtx)audioCtx=new (window.AudioContext||window.webkitAudioContext)();
  if(audioCtx.state!=="running"){
    try{await audioCtx.resume()}catch(e){}
  }
  try{
    const b=audioCtx.createBuffer(1,1,22050);
    const s=audioCtx.createBufferSource();
    s.buffer=b;
    s.connect(audioCtx.destination);
    s.start(0);
  }catch(e){}
  return audioCtx;
}

function stopBargeWatcher(){
  if(bargeRaf){cancelAnimationFrame(bargeRaf);bargeRaf=null}
  bargeSince=0;
}

function stopSpeaking(){
  speakingNow=false;
  stopBargeWatcher();
  if(currentSource){
    try{currentSource.onended=null;currentSource.stop(0)}catch(e){}
    currentSource=null;
  }
  if("speechSynthesis" in window){
    try{speechSynthesis.cancel()}catch(e){}
  }
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
  if(!liveActive||!analyser||!speakingNow)return;

  const watch=()=>{
    if(!liveActive||!speakingNow||bargeLocked)return;
    const rms=rmsNow();
    const now=performance.now();

    if(rms>.065){
      if(!bargeSince)bargeSince=now;
      if(now-bargeSince>150){
        bargeLocked=true;
        liveLast.textContent="باشە، گوێم لێتە...";
        setLiveState("listening","قسەت پێبڕی — گوێم لێتە...");
        stopSpeaking();
        setTimeout(()=>{
          bargeLocked=false;
          if(liveActive)startListeningTurn(true);
        },70);
        return;
      }
    }else{
      bargeSince=0;
    }
    bargeRaf=requestAnimationFrame(watch);
  };

  bargeRaf=requestAnimationFrame(watch);
}

function browserSpeak(text,onDone,onFail){
  if(!voiceOn||!("speechSynthesis" in window)||!text){
    onFail?.();
    return;
  }

  try{
    speechSynthesis.cancel();

    const u=new SpeechSynthesisUtterance(text);
    const v=pickVoice();

    if(v){
      u.voice=v;
      u.lang=v.lang;
    }else{
      u.lang="ar-IQ";
    }

    u.rate=.98;
    u.pitch=.95;
    u.volume=1;

    let started=false,finished=false;

    const startup=setTimeout(()=>{
      if(!started&&!finished){
        finished=true;
        try{speechSynthesis.cancel()}catch(e){}
        onFail?.();
      }
    },850);

    const done=()=>{
      if(finished)return;
      finished=true;
      clearTimeout(startup);
      speakingNow=false;
      stopBargeWatcher();
      onDone?.();
    };

    u.onstart=()=>{
      started=true;
      speakingNow=true;
      startBargeWatcher();
    };

    u.onend=done;

    u.onerror=()=>{
      if(finished)return;
      finished=true;
      clearTimeout(startup);
      speakingNow=false;
      stopBargeWatcher();
      onFail?.();
    };

    speechSynthesis.speak(u);

  }catch(e){
    onFail?.();
  }
}

async function serverSpeak(text,onDone){
  if(!voiceOn||!text){
    onDone?.();
    return;
  }

  await ensureAudio();

  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),5000);

  try{
    const r=await fetch("/api/tts",{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({text}),
      signal:controller.signal
    });

    clearTimeout(timeout);

    if(!r.ok)throw new Error("TTS "+r.status);

    const ab=await r.arrayBuffer();
    if(!ab.byteLength)throw new Error("Empty TTS");

    const decoded=await audioCtx.decodeAudioData(ab.slice(0));
    if(!liveActive){onDone?.();return}

    stopSpeaking();

    const source=audioCtx.createBufferSource();
    source.buffer=decoded;
    source.connect(audioCtx.destination);
    currentSource=source;
    speakingNow=true;

    source.onended=()=>{
      currentSource=null;
      speakingNow=false;
      stopBargeWatcher();
      onDone?.();
    };

    source.start(0);
    startBargeWatcher();

  }catch(e){
    clearTimeout(timeout);
    speakingNow=false;
    onDone?.();
  }
}

function speakLive(text,onDone){
  browserSpeak(
    text,
    onDone,
    ()=>serverSpeak(text,onDone)
  );
}

if("speechSynthesis" in window){
  speechSynthesis.getVoices();
  speechSynthesis.onvoiceschanged=()=>speechSynthesis.getVoices();
}else{
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

    if(data.response){
      browserSpeak(answer,()=>{},()=>{});
    }

  }catch(e){
    bubble.textContent="کێشەی پەیوەندی بە AI هەیە.";
    statusEl.textContent="AI connection error";
  }finally{
    busy=false;
    input.focus();
  }
}

form.addEventListener("submit",e=>{
  e.preventDefault();
  send(input.value);
});

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
  if(rafId){
    cancelAnimationFrame(rafId);
    rafId=null;
  }
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

  micSource=audioCtx.createMediaStreamSource(liveStream);
  analyser=audioCtx.createAnalyser();
  analyser.fftSize=1024;
  analyser.smoothingTimeConstant=.25;
  micSource.connect(analyser);
  captureRate=audioCtx.sampleRate;

  return liveStream;
}

function beginPcmCapture(){
  endPcmCapture(false);
  pcmChunks=[];

  processor=audioCtx.createScriptProcessor(2048,1,1);
  silentGain=audioCtx.createGain();
  silentGain.gain.value=0;

  processor.onaudioprocess=e=>{
    if(!liveActive)return;
    const inputData=e.inputBuffer.getChannelData(0);
    pcmChunks.push(new Float32Array(inputData));
  };

  micSource.connect(processor);
  processor.connect(silentGain);
  silentGain.connect(audioCtx.destination);
}

function endPcmCapture(returnSamples=true){
  if(processor){
    try{processor.onaudioprocess=null}catch(e){}
    try{micSource?.disconnect(processor)}catch(e){}
    try{processor.disconnect()}catch(e){}
    processor=null;
  }

  if(silentGain){
    try{silentGain.disconnect()}catch(e){}
    silentGain=null;
  }

  if(!returnSamples){
    pcmChunks=[];
    return null;
  }

  let total=0;
  for(const c of pcmChunks)total+=c.length;

  const merged=new Float32Array(total);
  let offset=0;

  for(const c of pcmChunks){
    merged.set(c,offset);
    offset+=c.length;
  }

  pcmChunks=[];
  return merged;
}

function downsample(input,inputRate,outputRate){
  if(outputRate>=inputRate)return input;

  const ratio=inputRate/outputRate;
  const outLength=Math.max(1,Math.round(input.length/ratio));
  const output=new Float32Array(outLength);

  let inPos=0;

  for(let i=0;i<outLength;i++){
    const nextPos=Math.min(input.length,Math.round((i+1)*ratio));
    let sum=0,count=0;

    for(let j=inPos;j<nextPos;j++){
      sum+=input[j];
      count++;
    }

    output[i]=count?sum/count:0;
    inPos=nextPos;
  }

  return output;
}

function wavBlob(samples,inputRate){
  const targetRate=16000;
  const pcm=downsample(samples,inputRate,targetRate);
  const buffer=new ArrayBuffer(44+pcm.length*2);
  const view=new DataView(buffer);

  function writeString(offset,str){
    for(let i=0;i<str.length;i++)view.setUint8(offset+i,str.charCodeAt(i));
  }

  writeString(0,"RIFF");
  view.setUint32(4,36+pcm.length*2,true);
  writeString(8,"WAVE");
  writeString(12,"fmt ");
  view.setUint32(16,16,true);
  view.setUint16(20,1,true);
  view.setUint16(22,1,true);
  view.setUint32(24,targetRate,true);
  view.setUint32(28,targetRate*2,true);
  view.setUint16(32,2,true);
  view.setUint16(34,16,true);
  writeString(36,"data");
  view.setUint32(40,pcm.length*2,true);

  let pos=44;

  for(let i=0;i<pcm.length;i++,pos+=2){
    const s=Math.max(-1,Math.min(1,pcm[i]));
    view.setInt16(pos,s<0?s*0x8000:s*0x7fff,true);
  }

  return new Blob([buffer],{type:"audio/wav"});
}

async function startListeningTurn(fromInterrupt=false){
  if(!liveActive||bargeLocked)return;

  try{
    stopSpeaking();
    await ensureMic();

    setLiveState(
      "listening",
      fromInterrupt?"گوێم لێتە — بەردەوام بە...":"گوێم لێتە — قسە بکە..."
    );

    liveLast.textContent=fromInterrupt
      ?"بەردەوام بە؛ JARVIS گوێ دەگرێت."
      :"قسە بکە؛ کاتێک وەستایت یەکسەر وەڵامت دەدەمەوە.";

    beginPcmCapture();

    const started=performance.now();
    let heard=false,lastVoice=started,voiceFrames=0;

    const monitor=()=>{
      if(!liveActive||!processor)return;

      const rms=rmsNow();
      const now=performance.now();

      liveOrb.style.transform="scale("+(1+Math.min(rms*2.5,.16))+")";

      if(rms>.023){
        voiceFrames++;
        if(voiceFrames>=2){
          heard=true;
          lastVoice=now;
        }
      }else{
        voiceFrames=Math.max(0,voiceFrames-1);
      }

      if(heard&&now-lastVoice>550&&now-started>700){
        stopAnalysis();
        liveOrb.style.transform="scale(1)";

        const samples=endPcmCapture(true);
        const blob=wavBlob(samples,captureRate);

        if(blob.size<900){
          setTimeout(()=>{if(liveActive)startListeningTurn(false)},120);
          return;
        }

        processVoiceTurn(blob);
        return;
      }

      if(now-started>16000){
        stopAnalysis();
        liveOrb.style.transform="scale(1)";

        const samples=endPcmCapture(true);

        if(!heard||!samples?.length){
          setTimeout(()=>{if(liveActive)startListeningTurn(false)},120);
          return;
        }

        processVoiceTurn(wavBlob(samples,captureRate));
        return;
      }

      rafId=requestAnimationFrame(monitor);
    };

    rafId=requestAnimationFrame(monitor);

  }catch(e){
    console.error("mic failed",e);
    endPcmCapture(false);

    setLiveState("idle","Microphone مۆڵەتی پێ نەدرا");
    liveLast.textContent="لە Safari ـدا Microphone بۆ ئەم site ـە Allow بکە.";

    liveActive=false;
    liveMain.textContent="دەستپێکردن";
    liveMain.classList.remove("end");
  }
}

async function processVoiceTurn(blob){
  setLiveState("thinking","JARVIS بیر دەکاتەوە...");
  liveLast.textContent="قسەکەت وەرگیرا؛ وەڵام ئامادە دەکرێت...";
  liveOrb.style.transform="scale(1)";

  try{
    const fd=new FormData();
    fd.append("audio",blob,"voice.wav");
    fd.append("history",JSON.stringify(messages.slice(-8)));

    const r=await fetch("/api/voice-turn",{
      method:"POST",
      body:fd
    });

    const data=await r.json();

    if(!r.ok||!data.ok){
      throw new Error(data.detail||data.error||"Voice request failed");
    }

    const transcript=(data.transcript||"").trim();
    const answer=(data.response||"").trim();

    if(transcript)messages.push({role:"user",content:transcript});
    if(answer)messages.push({role:"assistant",content:answer});

    liveLast.textContent=answer||"وەڵامێک نەگەیشت.";
    setLiveState("speaking","JARVIS وەڵام دەداتەوە...");

    speakLive(answer,()=>{
      if(!liveActive)return;

      setLiveState("listening","گوێم لێتە — قسە بکە...");

      setTimeout(()=>{
        if(liveActive)startListeningTurn(false);
      },80);
    });

  }catch(e){
    console.error("voice turn failed",e);

    setLiveState("idle","Voice AI هەڵەی دا");
    liveLast.textContent="کێشە: "+String(e?.message||e).slice(0,160);

    if(liveActive){
      setTimeout(()=>startListeningTurn(false),900);
    }
  }
}

async function startLive(){
  if(liveActive)return;

  try{
    liveActive=true;
    liveMain.textContent="کۆتایی پێبهێنە";
    liveMain.classList.add("end");

    setLiveState("thinking","JARVIS ئامادە دەکرێت...");
    liveLast.textContent="Microphone و دەنگ ئامادە دەکرێن...";

    unlockSpeech();
    await ensureAudio();
    await ensureMic();

    setLiveState("listening","گوێم لێتە — قسە بکە...");
    liveLast.textContent="قسە بکە؛ گوێم لێتە.";

    startListeningTurn(false);

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
  endPcmCapture(false);

  if(liveStream){
    liveStream.getTracks().forEach(t=>t.stop());
    liveStream=null;
  }

  if(micSource){
    try{micSource.disconnect()}catch(e){}
    micSource=null;
  }

  analyser=null;

  liveMain.textContent="دەستپێکردن";
  liveMain.classList.remove("end");

  setLiveState("idle","Live کۆتایی هات");
  liveLast.textContent="دوگمەی دەستپێکردن دابگرە بۆ گفتوگۆی نوێ.";
}

function openLive(){
  livePanel.classList.add("show");
  livePanel.setAttribute("aria-hidden","false");

  if(!liveActive){
    liveMain.textContent="دەستپێکردن";
    liveMain.classList.remove("end");
    setLiveState("idle","ئامادەیە بۆ گفتوگۆ");
    liveLast.textContent="دەستپێکردن دابگرە، پاشان ڕاستەوخۆ قسە بکە.";
  }
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

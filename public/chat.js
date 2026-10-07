const chat=document.getElementById("chat"),form=document.getElementById("composer"),input=document.getElementById("message"),statusEl=document.getElementById("status"),clearBtn=document.getElementById("clear"),micBtn=document.getElementById("mic"),speakerBtn=document.getElementById("speaker");
let messages=[],busy=false,voiceOn=true;

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
      || voices[0]
      || null;
}

function speak(text){
  if(!voiceOn||!("speechSynthesis" in window)||!text)return;
  try{
    speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(text);
    const v=pickVoice();
    if(v){u.voice=v;u.lang=v.lang}
    u.rate=0.95;
    u.pitch=1;
    u.onstart=()=>statusEl.textContent="JARVIS قسە دەکات...";
    u.onend=()=>{if(!busy)statusEl.textContent="JARVIS ئامادەیە"};
    speechSynthesis.speak(u);
  }catch(e){}
}

if("speechSynthesis" in window){
  speechSynthesis.getVoices();
  speechSynthesis.onvoiceschanged=()=>speechSynthesis.getVoices();
}else{
  voiceOn=false;
  if(speakerBtn)speakerBtn.textContent="🔇";
}

speakerBtn.onclick=()=>{
  voiceOn=!voiceOn;
  speakerBtn.textContent=voiceOn?"🔊":"🔇";
  if(!voiceOn&&"speechSynthesis" in window)speechSynthesis.cancel();
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
    if(data.response)speak(answer);
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
  if("speechSynthesis" in window)speechSynthesis.cancel();
  chat.innerHTML='<div class="welcome" id="welcome"><div class="orb bigorb"></div><h2>سڵاو، من JARVIS ـم.</h2><div>فەرمانەکەت بنووسە یان بە دەنگ بڵێ.</div></div>';
};

const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
if(SR){
  const rec=new SR();
  rec.lang="ku-IQ";
  rec.interimResults=false;
  rec.continuous=false;

  rec.onstart=()=>{
    if("speechSynthesis" in window)speechSynthesis.cancel();
    statusEl.textContent="گوێم لێتە...";
  };

  rec.onresult=e=>{
    const spoken=e.results?.[0]?.[0]?.transcript||"";
    if(spoken)send(spoken);
  };

  rec.onerror=e=>{
    statusEl.textContent="دەنگ نەخوێندرایەوە";
  };

  rec.onend=()=>{
    if(!busy)statusEl.textContent="JARVIS ئامادەیە";
  };

  micBtn.onclick=()=>{
    try{rec.start()}catch(e){}
  };
}else{
  micBtn.onclick=()=>statusEl.textContent="Voice input لەم Safari ـەدا پشتگیری ناکرێت";
}
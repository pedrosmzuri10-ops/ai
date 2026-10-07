const chat=document.getElementById("chat");
const form=document.getElementById("composer");
const input=document.getElementById("message");
const statusEl=document.getElementById("status");
const clearBtn=document.getElementById("clear");

let messages=[];
let busy=false;

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

async function send(text){
  text=(text||"").trim();
  if(!text||busy)return;

  busy=true;
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

    if(!r.ok){
      throw new Error(data?.detail||data?.error||("HTTP "+r.status));
    }

    const answer=String(data?.response||"").trim();

    if(!answer){
      throw new Error("Empty AI response");
    }

    bubble.textContent=answer;
    messages.push({role:"assistant",content:answer});
    statusEl.textContent="JARVIS ئامادەیە";

  }catch(e){
    console.error(e);
    bubble.textContent="کێشەیەک ڕوویدا. دووبارە هەوڵ بدە.";
    statusEl.textContent="کێشەی پەیوەندی";
  }finally{
    busy=false;
    input.focus();
  }
}

form.addEventListener("submit",e=>{
  e.preventDefault();
  send(input.value);
});

document.querySelectorAll("[data-p]").forEach(b=>{
  b.onclick=()=>send(b.dataset.p);
});

clearBtn.onclick=()=>{
  messages=[];
  chat.innerHTML='<div class="welcome" id="welcome"><div class="orb bigorb"></div><h2>سڵاو، من JARVIS ـم.</h2><div>فەرمانەکەت بنووسە.</div></div>';
  statusEl.textContent="JARVIS ئامادەیە";
};
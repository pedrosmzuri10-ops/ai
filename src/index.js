const MODEL="@cf/zai-org/glm-4.7-flash";

const BASE_PROMPT=`
You are JARVIS.
Always answer in Sorani Kurdish (Central Kurdish) using Kurdish Arabic script unless the user explicitly requests another language.
Never switch to Arabic, Persian, Turkish, or English on your own.
Use natural everyday Sorani Kurdish.
Be concise, practical, and conversational.
Never claim you executed code or changed a real system unless a tool actually did it.
`;

async function transcribe(buffer,env){
  const bytes=Array.from(new Uint8Array(buffer));
  let firstError="";

  try{
    const r=await env.AI.run("@cf/openai/whisper-large-v3-turbo",{
      audio:bytes,
      task:"transcribe",
      vad_filter:true,
      beam_size:1,
      condition_on_previous_text:false,
      initial_prompt:"کوردی سۆرانی. گفتوگۆی ڕۆژانە بە کوردی سۆرانی. ناوی یاریدەدەر JARVIS ـە. زمان بە خۆکارانە بناسەوە و دەقەکە وەک کوردی سۆرانی بنووسە."
    });

    const text=String(r?.text||"").trim();
    if(text)return text;

  }catch(e){
    firstError=String(e?.message||e);
  }

  try{
    const r=await env.AI.run("@cf/openai/whisper",{
      audio:bytes
    });

    const text=String(r?.text||"").trim();
    if(text)return text;

  }catch(e){
    throw new Error(
      "STT failed: "+
      (firstError||"primary failed")+
      " | fallback: "+
      String(e?.message||e)
    );
  }

  throw new Error("No speech detected");
}

export default{
  async fetch(request,env){
    const url=new URL(request.url);

    if(url.pathname==="/api/chat"&&request.method==="POST"){
      try{
        const body=await request.json();
        const incoming=Array.isArray(body.messages)?body.messages.slice(-14):[];

        const result=await env.AI.run(MODEL,{
          messages:[
            {role:"system",content:BASE_PROMPT},
            ...incoming
          ],
          max_completion_tokens:160,
          temperature:.2,
          top_p:.8
        });

        const response=
          result?.response??
          result?.choices?.[0]?.message?.content??
          "ببورە، وەڵامێک نەگەیشت.";

        return Response.json({ok:true,response});

      }catch(e){
        return Response.json({
          ok:false,
          error:"AI request failed",
          detail:String(e?.message||e||"").slice(0,260)
        },{status:500});
      }
    }

    if(url.pathname==="/api/voice-turn"&&request.method==="POST"){
      try{
        const form=await request.formData();
        const file=form.get("audio");
        const historyRaw=form.get("history");

        if(!file||typeof file==="string"||typeof file.arrayBuffer!=="function"){
          return Response.json(
            {ok:false,error:"Missing audio"},
            {status:400}
          );
        }

        const buffer=await file.arrayBuffer();

        if(!buffer.byteLength||buffer.byteLength>3_000_000){
          return Response.json(
            {ok:false,error:"Audio too large or empty"},
            {status:400}
          );
        }

        const transcript=await transcribe(buffer,env); // language is intentionally auto-detected; Cloudflare STT does not accept ku

        let history=[];

        try{
          const parsed=JSON.parse(
            typeof historyRaw==="string"?historyRaw:"[]"
          );
          if(Array.isArray(parsed))history=parsed.slice(-8);
        }catch{}

        const voicePrompt=`
${BASE_PROMPT}
This is a live voice conversation.
Reply immediately.
Usually answer with one short sentence, at most two short sentences.
No headings, no bullet lists, no markdown, no introduction.
The answer will be spoken aloud, so make it simple, natural, and easy to hear.
`;

        const llm=await env.AI.run(MODEL,{
          messages:[
            {role:"system",content:voicePrompt},
            ...history,
            {role:"user",content:transcript}
          ],
          max_completion_tokens:64,
          temperature:.15,
          top_p:.75
        });

        const response=
          llm?.response??
          llm?.choices?.[0]?.message?.content??
          "ببورە، وەڵامێک نەگەیشت.";

        return Response.json({
          ok:true,
          transcript,
          response
        });

      }catch(e){
        console.error("voice-turn failed",e);

        return Response.json({
          ok:false,
          error:"Voice processing failed",
          detail:String(e?.message||e||"Unknown error").slice(0,420)
        },{status:500});
      }
    }

    if(url.pathname==="/api/tts"&&request.method==="POST"){
      try{
        const body=await request.json();
        const text=String(body?.text||"").trim().slice(0,900);

        if(!text)return new Response("Missing text",{status:400});

        const resp=await env.AI.run(
          "@cf/deepgram/aura-1",
          {
            text,
            speaker:"orion",
            encoding:"mp3"
          },
          {
            returnRawResponse:true
          }
        );

        return new Response(resp.body,{
          status:resp.status||200,
          headers:{
            "content-type":resp.headers?.get("content-type")||"audio/mpeg",
            "cache-control":"no-store"
          }
        });

      }catch(e){
        return new Response(
          "TTS unavailable: "+String(e?.message||e),
          {status:503}
        );
      }
    }

    return env.ASSETS.fetch(request);
  }
};
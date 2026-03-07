import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // 处理 CORS 预检请求
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { lyricsData } = await req.json()

    // 从 Supabase Secrets 中读取 Cloudflare 凭证
    const CF_ACCOUNT_ID = Deno.env.get('CF_ACCOUNT_ID')
    const CF_API_TOKEN = Deno.env.get('CF_API_TOKEN')

    if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
      throw new Error('Missing Cloudflare credentials in Supabase Secrets')
    }

    const prompt = `
    You are a lyrics processing assistant. I will provide a JSON array of lyrics.
    For each object in the array:
    1. Keep "time" and "text" exactly as they are.
    2. If "text" is in a foreign language (like Japanese, Korean, etc.), add a "romaji" key with the Romaji/Pinyin pronunciation. If it's English or Chinese, you can leave "romaji" empty or provide Pinyin for Chinese.
    3. If "translation" is missing, add a "translation" key with the Chinese translation. If it already exists, keep it.
    
    Return ONLY a valid JSON array matching this schema:
    [{ "time": 12.5, "text": "...", "romaji": "...", "translation": "..." }]
    
    Input JSON:
    ${JSON.stringify(lyricsData)}
    `

    // 调用 Cloudflare Workers AI (使用 Qwen 1.5 7B Chat)
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/@cf/qwen/qwen1.5-7b-chat-awq`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CF_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: 'You are a helpful assistant that outputs ONLY valid JSON arrays.' },
            { role: 'user', content: prompt }
          ]
        })
      }
    )

    const result = await response.json()
    
    if (!result.success) {
      console.error('Cloudflare AI Error:', result.errors)
      throw new Error('Cloudflare AI request failed')
    }

    let content = result.result.response
    // 清理可能存在的 Markdown 代码块标记
    content = content.replace(/```json/g, '').replace(/```/g, '').trim()
    
    const enrichedLyrics = JSON.parse(content)

    return new Response(
      JSON.stringify({ enrichedLyrics }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})

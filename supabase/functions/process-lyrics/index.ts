import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// 辅助函数：提取 JSON 或 LRC，过滤掉 <think> 标签
function extractCleanContent(text) {
  if (!text) return '';
  // 移除 <think>...</think> 标签及其内容
  let cleanText = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  
  // 尝试匹配 markdown 代码块
  const jsonMatch = cleanText.match(/```(?:json)?\n([\s\S]*?)\n```/);
  if (jsonMatch) {
    return jsonMatch[1].trim();
  }
  
  // 如果是找 JSON 数组，尝试匹配最外层的 []
  const startArr = cleanText.indexOf('[');
  const endArr = cleanText.lastIndexOf(']');
  if (startArr !== -1 && endArr !== -1 && endArr > startArr) {
    // 简单判断一下是不是 LRC 格式（LRC 也有 []）
    // 如果包含 "time" 和 "text"，大概率是 JSON
    const substring = cleanText.substring(startArr, endArr + 1);
    if (substring.includes('"time"') || substring.includes('"text"')) {
        return substring;
    }
  }
  
  // 如果是找 JSON 对象，尝试匹配最外层的 {}
  const startObj = cleanText.indexOf('{');
  const endObj = cleanText.lastIndexOf('}');
  if (startObj !== -1 && endObj !== -1 && endObj > startObj) {
      const substring = cleanText.substring(startObj, endObj + 1);
      if (substring.includes('"title"') || substring.includes('"artist"')) {
          return substring;
      }
  }

  return cleanText;
}

// 辅助函数：调用 Cloudflare AI
async function callCloudflareAI(accountId, apiToken, systemPrompt, userPrompt) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/qwen/qwen3-30b-a3b-fp8`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    }
  )
  const result = await response.json()
  if (!result.success) {
    console.error('Cloudflare AI Error:', result.errors)
    throw new Error('Cloudflare AI request failed')
  }
  
  // 兼容不同模型的返回格式
  let responseText = result.result?.response || result.result;
  if (typeof responseText !== 'string') {
      try {
          responseText = JSON.stringify(responseText);
      } catch (e) {
          responseText = String(responseText);
      }
  }
  return responseText || '';
}

// 辅助函数：解析 LRC
function parseLRC(lrc) {
  if (!lrc) return [];
  const lines = lrc.split('\n');
  const result = [];
  const timeReg = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;
  for (const line of lines) {
      const match = timeReg.exec(line);
      if (match) {
          const min = parseInt(match[1]);
          const sec = parseInt(match[2]);
          const ms = parseInt(match[3].padEnd(3, '0'));
          const time = min * 60 + sec + ms / 1000;
          const text = line.replace(timeReg, '').trim();
          if (text) {
              result.push({ time, text });
          }
      }
  }
  return result;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { title: rawTitle = '', artist: rawArtist = '' } = await req.json()

    const CF_ACCOUNT_ID = Deno.env.get('CF_ACCOUNT_ID')
    const CF_API_TOKEN = Deno.env.get('CF_API_TOKEN')

    if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
      throw new Error('Missing Cloudflare credentials in Supabase Secrets')
    }

    console.log(`[Process Lyrics] Start processing for: ${rawTitle} - ${rawArtist}`)

    // 1. 文件名自动修正
    const cleanPrompt = `
    Please extract the clean song title and artist from the following raw string: "${rawTitle} ${rawArtist}".
    Fix any typos, remove unnecessary tags (like LIVE, MP3, Official, etc.).
    Return ONLY a JSON object: { "title": "Clean Title", "artist": "Clean Artist" }
    `
    let cleanTitle = rawTitle || 'Unknown Title'
    let cleanArtist = rawArtist || 'Unknown Artist'
    try {
      let cleanRes = await callCloudflareAI(CF_ACCOUNT_ID, CF_API_TOKEN, 'You are a music metadata cleaner. Return ONLY valid JSON.', cleanPrompt)
      if (cleanRes) {
        cleanRes = extractCleanContent(cleanRes)
        const cleanData = JSON.parse(cleanRes)
        if (cleanData.title) cleanTitle = cleanData.title
        if (cleanData.artist) cleanArtist = cleanData.artist
        console.log(`[Metadata Cleaned] ${cleanTitle} - ${cleanArtist}`)
      }
    } catch (e) {
      console.warn('[Metadata Clean Failed] Using raw inputs.', e)
    }

    let lyricsData = []
    let source = ''

    // 2. 尝试 LRCLIB 抓取
    try {
      const query = encodeURIComponent(`${cleanTitle} ${cleanArtist}`)
      const res = await fetch(`https://lrclib.net/api/search?q=${query}`)
      const data = await res.json()
      if (data && data.length > 0 && data[0].syncedLyrics) {
        lyricsData = parseLRC(data[0].syncedLyrics)
        source = '[API Source]'
        console.log(`${source} Found lyrics in LRCLIB`)
      }
    } catch (e) {
      console.warn('LRCLIB fetch failed:', e)
    }

    // 3. 如果 API 返回为空，调用大模型背诵
    if (lyricsData.length === 0) {
      console.log('API returned empty. Trying AI Memory fallback...')
      const recitePrompt = `你现在是一个严谨的音乐数据库。请根据歌名 "${cleanTitle}" 和歌手 "${cleanArtist}"，输出该歌曲的完整 LRC 格式歌词（带 [00:00.00] 时间戳）。\n\n⚠️ 警告：如果你不知道这首歌的准确歌词，或者记忆模糊，请直接回复 "UNKNOWN"，绝对不要自己瞎编或创作歌词！\n\n如果确信知道，请只输出 LRC 歌词内容，不要有任何开场白。`
      try {
        let aiLrc = await callCloudflareAI(CF_ACCOUNT_ID, CF_API_TOKEN, 'You are a strict music database. Never hallucinate.', recitePrompt)
        aiLrc = extractCleanContent(aiLrc)
        
        if (aiLrc.includes('UNKNOWN') || aiLrc.trim() === '') {
            console.log('AI does not know the lyrics. Skipping to avoid hallucination.')
        } else {
            lyricsData = parseLRC(aiLrc)
            if (lyricsData.length > 0) {
              source = '[AI Memory Source]'
              console.log(`${source} AI recited lyrics successfully`)
            }
        }
      } catch (e) {
        console.error('AI Memory fallback failed:', e)
      }
    }

    if (lyricsData.length === 0) {
      throw new Error('Could not find or generate lyrics for this track.')
    }

    // 4. 尝试网易云获取翻译 (仅当有歌词时)
    try {
      const wyQuery = encodeURIComponent(`${cleanTitle} ${cleanArtist}`)
      const wySearchUrl = `https://music.163.com/api/search/get/web?csrf_token=hlpretag=&hlposttag=&s=${wyQuery}&type=1&offset=0&total=true&limit=1`
      const wyRes = await fetch(wySearchUrl)
      const wyData = await wyRes.json()
      
      if (wyData.result && wyData.result.songs && wyData.result.songs.length > 0) {
          const songId = wyData.result.songs[0].id
          const wyLyricUrl = `https://music.163.com/api/song/lyric?id=${songId}&lv=1&kv=1&tv=-1`
          const wyLyricRes = await fetch(wyLyricUrl)
          const wyLyricData = await wyLyricRes.json()
          
          if (wyLyricData.tlyric && wyLyricData.tlyric.lyric) {
              const transLines = parseLRC(wyLyricData.tlyric.lyric)
              transLines.forEach(t => {
                  const match = lyricsData.find(l => Math.abs(l.time - t.time) < 1.0)
                  if (match) match.translation = t.text
              })
              console.log('NetEase translation merged.')
          }
      }
    } catch (wyErr) {
      console.warn('NetEase translation fetch failed:', wyErr)
    }

    // 5. 大模型补全 (读音/翻译)
    const needsTranslation = lyricsData.some(l => !l.translation)
    const sampleText = lyricsData.map(l => l.text).join(' ')
    const mightNeedRomaji = /[ぁ-んァ-ン一-龯가-힣]/.test(sampleText)

    if (needsTranslation || mightNeedRomaji) {
      console.log('Calling AI for translation/romaji completion...')
      const enrichPrompt = `
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
      try {
        let enrichRes = await callCloudflareAI(CF_ACCOUNT_ID, CF_API_TOKEN, 'You are a helpful assistant that outputs ONLY valid JSON arrays.', enrichPrompt)
        if (enrichRes) {
          enrichRes = extractCleanContent(enrichRes)
          const enrichedLyrics = JSON.parse(enrichRes)
          
          if (Array.isArray(enrichedLyrics) && enrichedLyrics.length > 0) {
            enrichedLyrics.forEach(e => {
                const match = lyricsData.find(l => l.time === e.time)
                if (match) {
                    if (e.romaji) match.romaji = e.romaji
                    if (e.translation) match.translation = e.translation
                }
            })
            console.log('AI completion merged.')
          }
        }
      } catch (e) {
        console.error('AI completion failed:', e)
      }
    }

    return new Response(
      JSON.stringify({ lyricsData, source, cleanTitle, cleanArtist }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Process Lyrics Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})

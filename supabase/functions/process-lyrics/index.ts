import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// 辅助函数：提取 JSON 或 LRC，过滤掉 <think> 标签
function extractCleanContent(text) {
  if (!text) return '';
  let cleanText = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  
  const jsonMatch = cleanText.match(/```(?:json)?\n([\s\S]*?)\n```/);
  if (jsonMatch) return jsonMatch[1].trim();
  
  const startArr = cleanText.indexOf('[');
  const endArr = cleanText.lastIndexOf(']');
  if (startArr !== -1 && endArr !== -1 && endArr > startArr) {
    const substring = cleanText.substring(startArr, endArr + 1);
    if (substring.includes('"time"') || substring.includes('"text"')) {
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

// 辅助函数：解析 LRC (Fallback)
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

// 辅助函数：清洗歌名和歌手
function cleanString(str) {
  if (!str) return '';
  return str.replace(/\.(mp3|flac|wav|m4a)$/i, '')
            .replace(/[\(\[\{](live|mv|official|lyric|audio|video|official video)[\)\]\}]/gi, '')
            .replace(/[-_]/g, ' ')
            .trim();
}

// 辅助函数：带 TextDecoder 的 Fetch，解决乱码
async function fetchWithDecoder(url) {
  console.log(`[API Request] ${url}`);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    if (!res.ok) {
      console.warn(`[API Request Failed] Status: ${res.status}`);
      return null;
    }
    const arrayBuffer = await res.arrayBuffer();
    const decoder = new TextDecoder("utf-8");
    const text = decoder.decode(arrayBuffer);
    return JSON.parse(text);
  } catch (e) {
    console.error(`[API Request Error] ${url}`, e.message);
    return null;
  }
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

    // 1. 更聪明的清洗
    const cleanedTitle = cleanString(rawTitle);
    const cleanedArtist = cleanString(rawArtist);
    const searchQuery = `${cleanedTitle} ${cleanedArtist}`.trim();
    console.log(`[Cleaned Search Query] ${searchQuery}`);

    let rawSyncedLyrics = null;
    let rawPlainLyrics = null;
    let source = '';

    // 2. 优化 LRCLIB 调用
    const lrclibUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(searchQuery)}`;
    const lrclibData = await fetchWithDecoder(lrclibUrl);
    
    if (lrclibData && Array.isArray(lrclibData)) {
      for (const item of lrclibData) {
        if (item.syncedLyrics) {
          rawSyncedLyrics = item.syncedLyrics;
          source = '[LRCLIB Synced]';
          console.log(`[LRCLIB] Found synced lyrics.`);
          break;
        } else if (item.plainLyrics && !rawPlainLyrics) {
          rawPlainLyrics = item.plainLyrics;
          source = '[LRCLIB Plain]';
        }
      }
    }

    // 3. 增加网易云兜底 (Netease)
    if (!rawSyncedLyrics && !rawPlainLyrics) {
      console.log(`[LRCLIB] No results. Trying NetEase...`);
      const wyQuery = encodeURIComponent(searchQuery);
      const wySearchUrl = `https://music.163.com/api/search/get/web?csrf_token=hlpretag=&hlposttag=&s=${wyQuery}&type=1&offset=0&total=true&limit=1`;
      const wyData = await fetchWithDecoder(wySearchUrl);
      
      if (wyData?.result?.songs && wyData.result.songs.length > 0) {
        const songId = wyData.result.songs[0].id;
        const wyLyricUrl = `https://music.163.com/api/song/lyric?id=${songId}&lv=1&kv=1&tv=-1`;
        const wyLyricData = await fetchWithDecoder(wyLyricUrl);
        
        if (wyLyricData?.lrc?.lyric) {
          rawSyncedLyrics = wyLyricData.lrc.lyric;
          source = '[NetEase Synced]';
          console.log(`[NetEase] Found synced lyrics.`);
        }
      }
    }

    let lyricsData = [];

    // 4. 多语言过滤逻辑 & 容错处理 (AI 处理 API 返回的歌词)
    if (rawSyncedLyrics || rawPlainLyrics) {
      const lyricsToProcess = rawSyncedLyrics || rawPlainLyrics;
      const isPlain = !rawSyncedLyrics;
      console.log(`[AI Processing] Sending ${isPlain ? 'plain' : 'synced'} lyrics to AI for translation and filtering...`);
      
      const aiPrompt = `你是一个专业的音乐翻译官。我会给你一段可能混杂了多国语言翻译的原始 ${isPlain ? '纯文本歌词 (plainLyrics)' : 'Lrc 文本 (syncedLyrics)'}：
      
${lyricsToProcess}
      
请执行以下操作：
1. 识别并提取出【歌手实际演唱的原语言】（如日文或英文）。
2. 丢弃文本中原有的其他外语翻译（如越南语、泰语等）。
3. 为每一行原语言歌词重新生成【精准中文翻译】和【标准罗马音】。
4. ${isPlain ? '由于原始歌词没有时间戳，请你根据歌曲一般节奏，估算并加上 [mm:ss.xx] 格式的时间戳。' : '严格保持原始时间戳 [mm:ss.xx] 不变。'}
5. 必须输出一个合法的 JSON 数组，格式如下：
[{"time": 12.5, "text": "原语言歌词", "romaji": "罗马音", "translation": "中文翻译"}]
注意：time 是秒数（如 01:12.50 就是 72.5）。不要输出任何其他解释！`;

      try {
        let aiRes = await callCloudflareAI(CF_ACCOUNT_ID, CF_API_TOKEN, 'You are a professional music translator. Output ONLY valid JSON array.', aiPrompt);
        aiRes = extractCleanContent(aiRes);
        lyricsData = JSON.parse(aiRes);
        console.log(`[AI Processing] Successfully processed lyrics.`);
      } catch (e) {
        console.error(`[AI Processing Failed]`, e);
        if (rawSyncedLyrics) {
          lyricsData = parseLRC(rawSyncedLyrics);
          console.log(`[Fallback] Used raw synced lyrics due to AI failure.`);
        }
      }
    } 
    // 5. 严禁瞎编 (AI Memory Fallback)
    else {
      console.log(`All APIs failed for: ${searchQuery}`);
      
      const recitePrompt = `你现在是一个严谨的音乐数据库。请根据歌名 "${cleanedTitle}" 和歌手 "${cleanedArtist}"，输出该歌曲的完整歌词数据。
      
⚠️ 警告：如果你不知道这首歌的真实歌词，请只回复 ERROR_NOT_FOUND，严禁自我创作。

如果确信知道，请输出一个合法的 JSON 数组，包含时间戳（秒）、原歌词、罗马音、中文翻译：
[{"time": 12.5, "text": "原语言歌词", "romaji": "罗马音", "translation": "中文翻译"}]
不要有任何开场白。`;

      try {
        let aiLrc = await callCloudflareAI(CF_ACCOUNT_ID, CF_API_TOKEN, 'You are a strict music database. Never hallucinate.', recitePrompt);
        aiLrc = extractCleanContent(aiLrc);
        
        if (aiLrc.includes('ERROR_NOT_FOUND') || aiLrc.trim() === '') {
          console.log('AI does not know the lyrics. Skipping to avoid hallucination.');
        } else {
          lyricsData = JSON.parse(aiLrc);
          source = '[AI Memory Source]';
          console.log(`${source} AI recited lyrics successfully`);
        }
      } catch (e) {
        console.error('AI Memory fallback failed:', e);
      }
    }

    if (!lyricsData || lyricsData.length === 0) {
      throw new Error('Could not find or generate lyrics for this track.');
    }

    return new Response(
      JSON.stringify({ lyricsData, source, cleanTitle: cleanedTitle, cleanArtist: cleanedArtist }),
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

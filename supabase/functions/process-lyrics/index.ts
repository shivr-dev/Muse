import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// --- 核心配置 ---
let CF_ACCOUNT_ID = "";
let CF_API_TOKEN = "";

// 辅助函数：提取 JSON，过滤掉 <think> 标签
function extractCleanContent(text) {
  if (!text) return '';
  let cleanText = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  
  // 尝试提取 lrc 代码块
  const lrcMatch = cleanText.match(/```lrc\n([\s\S]*?)\n```/i);
  if (lrcMatch) {
      return lrcMatch[1].trim();
  }

  const jsonMatch = cleanText.match(/```(?:json)?\n([\s\S]*?)\n```/i);
  if (jsonMatch) return jsonMatch[1].trim();
  
  const startArr = cleanText.indexOf('[');
  const endArr = cleanText.lastIndexOf(']');
  if (startArr !== -1 && endArr !== -1 && endArr > startArr) {
    const substring = cleanText.substring(startArr, endArr + 1);
    // 如果是 JSON 数组
    if (substring.includes('"time"') || substring.includes('"text"')) {
        return substring;
    }
  }
  
  // 如果是 LRC 格式，直接返回整个 cleanText
  if (cleanText.startsWith('[')) {
      return cleanText;
  }
  
  return cleanText;
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
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    const decoder = new TextDecoder("utf-8");
    const text = decoder.decode(arrayBuffer);
    return JSON.parse(text);
  } catch (e) {
    console.error(`[API Request Error] ${url}`, e.message);
    return null;
  }
}

/**
 * 通用 Cloudflare Fetch 函数 (Qwen 3)
 */
async function fetchCF(prompt) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/@cf/qwen/qwen3-30b-a3b-fp8`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${CF_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: prompt }]
      }),
    }
  );

  const result = await response.json();
  if (!result.success) throw new Error('Cloudflare AI request failed');
  
  const content = result.result?.response || result.result;
  return typeof content === 'string' ? content : JSON.stringify(content);
}

/**
 * 智子缝合：把三段歌词合并成标准的 JSON 数组
 */
async function callQwen3ToMerge(raw, trans, roma, title) {
  const prompt = `你是一个专业的音乐歌词编辑。我会给你歌曲《${title}》的三段歌词数据（原文、中文翻译、罗马音）。
请你按时间戳将它们完美缝合，并输出一个合法的 JSON 数组。

规则：
1. 必须输出 JSON 数组，格式如下：
[{"time": 12.5, "text": "原语言歌词", "romaji": "罗马音", "translation": "中文翻译"}]
2. time 是秒数（如 01:12.50 就是 72.5）。
3. 如果某部分（翻译或罗马音）缺失，则对应字段留空字符串 ""。
4. 纠正可能的乱码，保持原文语种。
5. 丢弃文本中原有的其他外语翻译（如越南语、泰语等）。
6. 不要输出任何解释，只输出 JSON 数组！

数据如下：
原文：
${raw.substring(0, 2000)}

翻译：
${trans ? trans.substring(0, 2000) : '无'}

罗马音：
${roma ? roma.substring(0, 2000) : '无'}`;

  const res = await fetchCF(prompt);
  return extractCleanContent(res);
}

/**
 * 严谨兜底：当 API 彻底失效时使用
 */
async function callQwen3Fallback(title, artist) {
  const prompt = `搜索并整理歌曲《${title}》（歌手：${artist}）的歌词。
要求：
1. 必须输出一个合法的 JSON 数组，格式如下：
[{"time": 12.5, "text": "原语言歌词", "romaji": "罗马音", "translation": "中文翻译"}]
2. time 是秒数（如 01:12.50 就是 72.5）。
3. 如果你不知道这首歌的真实歌词，请只回复 "ERROR_NOT_FOUND"，严禁编造。
4. 不要输出任何解释，只输出 JSON 数组！`;

  const res = await fetchCF(prompt);
  return extractCleanContent(res);
}

/**
 * 处理 SRT 转换后的 LRC 歌词
 */
async function processSrtWithQwen3(lrcContent) {
  const prompt = `这是一段精确的 SRT 歌词脚本。请保持原有的时间轴不动，仅将其中的日文/英文内容翻译成中文，并为每一句添加日文罗马音（若有），最后以标准 .lrc 格式输出。不要输出任何额外内容！只要翻译内容

${lrcContent}`;

  const res = await fetchCF(prompt);
  return extractCleanContent(res);
}

/**
 * 核心逻辑：网易云优先抓取 + AI 智能缝合
 */
async function getEnhancedLyrics(title, artist, srtContent) {
  if (srtContent) {
    console.log(`[Process SRT] 收到 SRT 转换后的 LRC 内容，交给 AI 处理...`);
    const processedLrc = await processSrtWithQwen3(srtContent);
    return { lyricsData: processedLrc, source: '[SRT + AI Translated]', cleanTitle: title, cleanArtist: artist };
  }

  // 1. 清洗搜索词：去掉 .mp3, (Live), [MV] 等干扰项
  const cleanTitle = title.replace(/\.(mp3|wav|flac|m4a)$/i, '').replace(/[\(\[\{](live|mv|official|lyric|audio|video|official video)[\)\]\}]/gi, '').replace(/[-_]/g, ' ').trim();
  const cleanArtist = artist.replace(/\.(mp3|wav|flac|m4a)$/i, '').trim();
  const searchQuery = `${cleanTitle} ${cleanArtist}`.trim();
  console.log(`[Search] 正在搜索: ${searchQuery}`);

  let source = '';
  let lyricsData = null;

  try {
    // 2. 请求网易云搜索接口
    const searchUrl = `https://music.163.com/api/search/get/web?csrf_token=hlpretag=&hlposttag=&s=${encodeURIComponent(searchQuery)}&type=1&offset=0&total=true&limit=3`;
    const searchRes = await fetchWithDecoder(searchUrl);
    const song = searchRes?.result?.songs?.[0];

    if (song?.id) {
      console.log(`[Netease] 命中歌曲 ID: ${song.id}`);
      
      // 3. 抓取完整歌词包 (原文 + 翻译 + 罗马音)
      const lyricUrl = `https://music.163.com/api/song/lyric?id=${song.id}&lv=1&kv=1&tv=-1`;
      const lyricRes = await fetchWithDecoder(lyricUrl);

      const rawLrc = lyricRes?.lrc?.lyric || "";
      const tLrc = lyricRes?.tlyric?.lyric || "";
      const romaLrc = lyricRes?.romalyr?.lyric || "";

      if (rawLrc) {
        console.log(`[Netease] 获取到歌词，交给 AI 缝合...`);
        // 4. 交给 Cloudflare AI (Qwen 3) 进行智能合并与格式化
        const aiMerged = await callQwen3ToMerge(rawLrc, tLrc, romaLrc, cleanTitle);
        lyricsData = JSON.parse(aiMerged);
        source = '[Netease + AI Merged]';
      }
    }
  } catch (err) {
    console.error("[Error] 插件抓取失败，进入 AI 兜底模式", err);
  }

  // 5. 兜底：如果 API 啥也没搜到，才允许 AI 凭记忆生成（严格限制）
  if (!lyricsData || lyricsData.length === 0) {
    console.log(`[Fallback] API 无结果，尝试 AI 记忆兜底...`);
    const fallbackRes = await callQwen3Fallback(cleanTitle, cleanArtist);
    if (fallbackRes.includes('ERROR_NOT_FOUND') || fallbackRes.trim() === '') {
      console.log('AI does not know the lyrics. Skipping to avoid hallucination.');
      throw new Error('Could not find or generate lyrics for this track.');
    } else {
      lyricsData = JSON.parse(fallbackRes);
      source = '[AI Memory Source]';
    }
  }

  return { lyricsData, source, cleanTitle, cleanArtist };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { title: rawTitle = '', artist: rawArtist = '', srtContent = '' } = await req.json()

    CF_ACCOUNT_ID = Deno.env.get('CF_ACCOUNT_ID') || '';
    CF_API_TOKEN = Deno.env.get('CF_API_TOKEN') || '';

    if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
      throw new Error('Missing Cloudflare credentials in Supabase Secrets')
    }

    const result = await getEnhancedLyrics(rawTitle, rawArtist, srtContent);

    return new Response(
      JSON.stringify(result),
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

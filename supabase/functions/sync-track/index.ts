import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.3/+esm'

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
    const { trackId, title, artist, sourceUrl } = await req.json()

    if (!trackId || !title) {
      throw new Error('Missing required fields: trackId or title')
    }

    // 直接从 Deno 环境获取，不需要手动设置
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!; // 这个也是系统内置的
    const supabase = createClient(supabaseUrl, supabaseKey)

    // 1. 获取音频文件流
    let targetAudioUrl = sourceUrl;
    
    // 如果没有提供直链，我们通过 YouTube 搜索并使用 Cobalt API 下载完整音频
    if (!targetAudioUrl) {
      console.log(`Searching YouTube for: ${title} - ${artist}`);
      const query = encodeURIComponent(`${title} ${artist} audio`);
      
      // 1.1 搜索 YouTube 获取 Video ID
      const ytRes = await fetch(`https://www.youtube.com/results?search_query=${query}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
        }
      });
      const ytHtml = await ytRes.text();
      // 匹配第一个视频 ID (长度为11的字符串)
      const videoIdMatch = ytHtml.match(/"videoId":"([^"]{11})"/);
      
      if (!videoIdMatch) {
        throw new Error('无法在 YouTube 上找到对应的歌曲');
      }
      
      const videoId = videoIdMatch[1];
      const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
      console.log(`Found YouTube Video: ${youtubeUrl}`);

      // 1.2 使用 Cobalt API (v10+) 提取完整音频流
      console.log(`Requesting Cobalt API for audio extraction...`);
      
      // Cobalt API v10+ 配置
      const cobaltPayload = {
        url: youtubeUrl,
        downloadMode: 'audio',
        audioFormat: 'mp3'
      };

      const cobaltRes = await fetch('https://api.cobalt.tools/', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
        },
        body: JSON.stringify(cobaltPayload)
      });

      if (!cobaltRes.ok) {
        const errText = await cobaltRes.text();
        console.error('Cobalt API Error:', errText);
        throw new Error('音频提取服务(Cobalt)暂时不可用，请稍后再试');
      }

      const cobaltData = await cobaltRes.json();
      if (cobaltData.status === 'error') {
        throw new Error(`Cobalt 提取失败: ${cobaltData.text || '未知错误'}`);
      }
      
      targetAudioUrl = cobaltData.url;
      console.log(`Successfully extracted audio URL: ${targetAudioUrl}`);
    }

    console.log(`Fetching audio from: ${targetAudioUrl}`)
    
    const audioResponse = await fetch(targetAudioUrl)
    if (!audioResponse.ok || !audioResponse.body) {
      throw new Error('Failed to fetch audio source')
    }

    // 2. 将 ReadableStream 直接上传到 Supabase Storage
    // 使用 UUID 作为文件名，避免中文字符导致 Supabase Storage 报错 (Invalid key)
    const fileId = crypto.randomUUID();
    const filePath = `${fileId}.mp3`
    
    console.log(`Uploading to Storage: ${filePath}`)
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('audio')
      .upload(filePath, audioResponse.body, {
        duplex: 'half', // Deno fetch body stream 需要设置 duplex: 'half'
        contentType: 'audio/mpeg'
      })

    if (uploadError) throw uploadError

    // 3. 更新数据库中的同步状态
    console.log(`Updating database record: ${trackId}`)
    const { error: dbError } = await supabase
      .from('tracks')
      .update({ 
        is_synced: true, 
        file_path: filePath 
      })
      .eq('id', trackId)

    if (dbError) throw dbError

    return new Response(
      JSON.stringify({ success: true, filePath }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Sync Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})

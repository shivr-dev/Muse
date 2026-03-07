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

      // 1.2 尝试长寿稳定的解析源 (Loader.to / ytdl-core-api)
      console.log(`Requesting stable APIs for audio extraction...`);
      
      const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36';

      // 方法 1: Loader.to API
      if (!targetAudioUrl) {
        try {
          console.log(`Trying Loader.to...`);
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 15000);
          const res = await fetch(`https://loader.to/api/json?url=${encodeURIComponent(youtubeUrl)}`, {
            headers: { 'User-Agent': userAgent },
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          if (res.ok) {
            const data = await res.json();
            targetAudioUrl = data.download_url || data.url;
            if (targetAudioUrl) console.log(`Success with Loader.to`);
          } else {
            console.warn(`Loader.to returned status: ${res.status}`);
          }
        } catch (err) {
          console.warn(`Loader.to failed: ${err.message}`);
        }
      }

      // 方法 2: ytdl-core-api
      if (!targetAudioUrl) {
        try {
          console.log(`Trying ytdl-core-api...`);
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 15000);
          const res = await fetch(`https://ytdl-core-api.vercel.app/api/info?url=${encodeURIComponent(youtubeUrl)}`, {
            headers: { 'User-Agent': userAgent },
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          if (res.ok) {
            const data = await res.json();
            if (data.formats) {
              const audioFormats = data.formats.filter((f: any) => f.hasAudio && !f.hasVideo);
              if (audioFormats.length > 0) {
                targetAudioUrl = audioFormats[0].url;
              } else {
                targetAudioUrl = data.formats.find((f: any) => f.hasAudio)?.url;
              }
            } else if (data.url || data.audioUrl) {
              targetAudioUrl = data.url || data.audioUrl || data.download_url;
            }
            if (targetAudioUrl) console.log(`Success with ytdl-core-api`);
          } else {
            console.warn(`ytdl-core-api returned status: ${res.status}`);
          }
        } catch (err) {
          console.warn(`ytdl-core-api failed: ${err.message}`);
        }
      }

      if (!targetAudioUrl) {
        throw new Error('所有音频解析节点均不可用');
      }
      
      console.log(`Successfully extracted audio URL: ${targetAudioUrl}`);
    }

    console.log(`Fetching audio from: ${targetAudioUrl}`)
    
    let audioBuffer: ArrayBuffer | null = null;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60秒下载超时

      let audioResponse = await fetch(targetAudioUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
          'Referer': 'https://www.youtube.com/',
          'Origin': 'https://www.youtube.com'
        },
        signal: controller.signal
      });

      // 如果直接下载失败 (403等)，强制使用 allorigins 代理
      if (!audioResponse.ok) {
        console.warn(`Direct fetch failed with ${audioResponse.status}. Forcing allorigins proxy...`);
        audioResponse = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(targetAudioUrl)}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
          signal: controller.signal
        });
      }
      
      if (!audioResponse.ok) {
        throw new Error(`Failed to fetch audio source: ${audioResponse.status} ${audioResponse.statusText}`)
      }

      audioBuffer = await audioResponse.arrayBuffer();
      clearTimeout(timeoutId);

    } catch (err) {
      throw new Error(`Audio download failed: ${err.message}`);
    }

    // 文件头/大小检查：小于 100KB (102400 bytes) 视为无效/错误页面
    if (!audioBuffer || audioBuffer.byteLength < 102400) {
      const sizeKB = audioBuffer ? Math.round(audioBuffer.byteLength / 1024) : 0;
      throw new Error(`Downloaded audio buffer is too small (${sizeKB}KB). Likely an error page or blocked request.`);
    }

    // 2. 将 ArrayBuffer 上传到 Supabase Storage
    // 使用 UUID 作为文件名，避免中文字符导致 Supabase Storage 报错 (Invalid key)
    const fileId = crypto.randomUUID();
    const filePath = `${fileId}.mp3`
    
    console.log(`Uploading to Storage: ${filePath}, size: ${audioBuffer.byteLength} bytes`)
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('audio')
      .upload(filePath, audioBuffer, {
        contentType: 'audio/mpeg', // 强制 .mp3 后缀和 MIME
        upsert: true
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

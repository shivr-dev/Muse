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

      // 1.2 尝试开源社区解析接口链 (Piped & Invidious)
      console.log(`Requesting open-source APIs for audio extraction...`);
      
      const PIPED_INSTANCES = [
        'https://pipedapi.kavin.rocks',
        'https://pipedapi.tokhmi.xyz',
        'https://api.piped.projectsegfau.lt'
      ];

      const INVIDIOUS_INSTANCES = [
        'https://invidious.nerdvpn.de',
        'https://inv.tux.pizza',
        'https://invidious.perennialte.ch'
      ];

      const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36';

      // 方法 1: Piped API 轮询
      if (!targetAudioUrl) {
        for (const node of PIPED_INSTANCES) {
          try {
            console.log(`Trying Piped node: ${node}`);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时

            const res = await fetch(`${node}/streams/${videoId}`, {
              headers: { 'User-Agent': userAgent },
              signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (res.ok) {
              const data = await res.json();
              if (data.audioStreams && data.audioStreams.length > 0) {
                // 优先选择 M4A 或最高比特率的音频流
                const stream = data.audioStreams.find(s => s.format === 'M4A') || data.audioStreams[0];
                targetAudioUrl = stream.url;
                console.log(`Success with Piped node: ${node}`);
                break;
              }
            } else {
              console.warn(`Piped node ${node} returned status: ${res.status}`);
            }
          } catch (err) {
            console.warn(`Piped node ${node} failed: ${err.message}`);
          }
        }
      }

      // 方法 2: Invidious API 轮询
      if (!targetAudioUrl) {
        for (const node of INVIDIOUS_INSTANCES) {
          try {
            console.log(`Trying Invidious node: ${node}`);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时

            const res = await fetch(`${node}/api/v1/videos/${videoId}`, {
              headers: { 'User-Agent': userAgent },
              signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (res.ok) {
              const data = await res.json();
              if (data.adaptiveFormats && data.adaptiveFormats.length > 0) {
                // 过滤出纯音频流
                const audioStreams = data.adaptiveFormats.filter(f => f.type && f.type.startsWith('audio/'));
                if (audioStreams.length > 0) {
                  // 优先选择 m4a/mp4 容器的音频
                  const stream = audioStreams.find(s => s.type.includes('mp4') || s.type.includes('m4a')) || audioStreams[0];
                  targetAudioUrl = stream.url;
                  console.log(`Success with Invidious node: ${node}`);
                  break;
                }
              }
            } else {
              console.warn(`Invidious node ${node} returned status: ${res.status}`);
            }
          } catch (err) {
            console.warn(`Invidious node ${node} failed: ${err.message}`);
          }
        }
      }

      if (!targetAudioUrl) {
        throw new Error('所有音频解析节点均不可用');
      }
      
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

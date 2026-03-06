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

    // 初始化 Supabase 客户端 (使用 Service Role Key 绕过 RLS 进行后台操作)
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabase = createClient(supabaseUrl, supabaseKey)

    // 1. 获取音频文件流 (模拟从第三方搜索并下载)
    // 实际项目中，这里可以调用第三方 API 获取真实的 MP3 直链
    // 这里使用一个公共的免版权测试音频作为 fallback 演示
    const targetAudioUrl = sourceUrl || 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3'
    console.log(`Fetching audio from: ${targetAudioUrl}`)
    
    const audioResponse = await fetch(targetAudioUrl)
    if (!audioResponse.ok || !audioResponse.body) {
      throw new Error('Failed to fetch audio source')
    }

    // 2. 将 ReadableStream 直接上传到 Supabase Storage
    // 过滤掉文件名中的非法字符
    const safeTitle = title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '')
    const filePath = `${artist}-${safeTitle}-${Date.now()}.mp3`
    
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

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { url } = await req.json()

    if (!url || !url.includes('spotify.com')) {
      throw new Error('请输入有效的 Spotify 链接')
    }

    // 解析 Spotify 链接类型和 ID
    const urlObj = new URL(url)
    const pathParts = urlObj.pathname.split('/')
    const typeIndex = pathParts.findIndex(p => ['track', 'playlist', 'album'].includes(p))
    
    if (typeIndex === -1) {
      throw new Error('不支持的 Spotify 链接类型 (仅支持 track, playlist, album)')
    }

    const type = pathParts[typeIndex]
    const id = pathParts[typeIndex + 1]

    // 请求 Spotify Embed 页面 (无需鉴权)
    const embedUrl = `https://open.spotify.com/embed/${type}/${id}`
    console.log(`Fetching Spotify Embed: ${embedUrl}`)
    
    const response = await fetch(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
      }
    })
    
    if (!response.ok) throw new Error('无法访问 Spotify 页面')
    
    const html = await response.text()

    // 提取页面中包含数据的 JSON 脚本块
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)
    if (!match) throw new Error('无法解析 Spotify 数据结构')

    const data = JSON.parse(match[1])
    const entity = data.props.pageProps.state.data.entity

    let tracks = []

    if (type === 'playlist' || type === 'album') {
      const items = entity.trackList || []
      tracks = items.map(item => ({
        title: item.title,
        artist: item.subtitle,
        album_cover_url: item.coverArt?.sources?.[0]?.url || entity.coverArt?.sources?.[0]?.url || 'https://picsum.photos/seed/music/400/400',
      }))
    } else if (type === 'track') {
      tracks = [{
        title: entity.title,
        artist: entity.subtitle,
        album_cover_url: entity.coverArt?.sources?.[0]?.url || 'https://picsum.photos/seed/music/400/400',
      }]
    }

    return new Response(
      JSON.stringify({ success: true, tracks }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Parse Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})

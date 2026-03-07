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
    const { title, artist } = await req.json()

    if (!title || !artist) {
      throw new Error('Missing title or artist')
    }

    const query = encodeURIComponent(`${title} ${artist} audio`);
    const ytRes = await fetch(`https://www.youtube.com/results?search_query=${query}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
      }
    });
    
    const ytHtml = await ytRes.text();
    const videoIdMatch = ytHtml.match(/"videoId":"([^"]{11})"/);
    
    if (!videoIdMatch) {
      throw new Error('无法在 YouTube 上找到对应的歌曲');
    }
    
    const videoId = videoIdMatch[1];
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

    return new Response(
      JSON.stringify({ success: true, url: youtubeUrl, videoId }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Search Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})

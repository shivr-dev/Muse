-- 1. 删除旧表（如果存在），以便重新创建包含新字段的表
DROP TABLE IF EXISTS public.tracks;

-- 2. 创建 tracks 表，新增 is_synced 字段
CREATE TABLE public.tracks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    album_cover_url TEXT,
    file_path TEXT, -- 同步前可能为空
    position INTEGER NOT NULL DEFAULT 0,
    is_synced BOOLEAN DEFAULT false, -- 标识是否已同步到 Supabase Storage
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 3. 开启 RLS (Row Level Security)
ALTER TABLE public.tracks ENABLE ROW LEVEL SECURITY;

-- 4. 创建 RLS 策略：允许所有人读取数据
CREATE POLICY "Allow public read access" ON public.tracks
    FOR SELECT USING (true);

-- 5. 创建 RLS 策略：允许更新数据（为了前端能触发同步状态更新，实际生产中建议只允许 Service Role 更新）
CREATE POLICY "Allow public update access" ON public.tracks
    FOR UPDATE USING (true);

-- 5.5 创建 RLS 策略：允许插入数据（为了前端能导入测试数据）
CREATE POLICY "Allow public insert access" ON public.tracks
    FOR INSERT WITH CHECK (true);

-- 6. 创建名为 'audio' 的公开存储桶 (如果不存在)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('audio', 'audio', true)
ON CONFLICT (id) DO NOTHING;

-- 7. 允许公开访问 audio 存储桶中的文件
CREATE POLICY "Public Access to Audio Files" ON storage.objects
    FOR SELECT USING (bucket_id = 'audio');

-- 8. 允许上传文件到 audio 存储桶
CREATE POLICY "Allow public uploads" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'audio');

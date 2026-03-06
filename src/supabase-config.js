// 使用 CDN 引入 Supabase
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.3/+esm';

// 请替换为您的 Supabase 项目 URL 和 Anon Key
// 提示：在 AI Studio 中，可以通过环境变量注入，但为了纯前端展示，这里留空供用户填入
const SUPABASE_URL = 'https://zvviucvsiupzyhaoeicj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp2dml1Y3ZzaXVwenloYW9laWNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3OTUyNjUsImV4cCI6MjA4ODM3MTI2NX0.OUuDiwtAsLiXy64a_DeTvksh7CvJYs4jsrMDa-fYVIc';

// 初始化 Supabase 客户端
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * 批量导入 Spotify 数据的说明：
 * 
 * 1. 导出 Spotify 数据：可以使用第三方工具（如 Exportify）将 Spotify 歌单导出为 CSV。
 * 2. 准备音频文件：由于版权原因，需自行准备音频文件（mp3/m4a）。
 * 3. 上传音频：在 Supabase Storage 中创建 'audio' 存储桶，将音频文件上传。
 * 4. 导入数据库：
 *    - 在 Supabase SQL Editor 中运行 init.sql 创建表。
 *    - 使用 Supabase 的 Table Editor 导入 CSV，或编写 Node.js 脚本批量插入。
 *    - 确保 file_path 字段与 Storage 中的文件名一致。
 */

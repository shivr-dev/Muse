import { supabase } from './supabase-config.js';

// 状态管理
let tracks = [];
let currentTrackIndex = -1;
let isPlaying = false;
let currentMode = 'standard'; // 'standard', 'full', 'mini'

// DOM 元素
const audio = new Audio();
const playBtn = document.getElementById('btn-play');
const prevBtn = document.getElementById('btn-prev');
const nextBtn = document.getElementById('btn-next');
const progressBar = document.getElementById('progress-bar');
const progress = document.getElementById('progress');
const timeCurrent = document.getElementById('time-current');
const timeTotal = document.getElementById('time-total');
const volumeSlider = document.getElementById('volume-slider');
const trackListEl = document.getElementById('track-list');
const pipBtn = document.getElementById('btn-pip');
const importBtn = document.getElementById('btn-import');

// 初始化
async function init() {
    lucide.createIcons(); // 初始化图标
    setupEventListeners();
    await fetchTracks();
}

// 从 Supabase 获取歌曲列表
async function fetchTracks() {
    try {
        if (supabase.supabaseUrl === 'YOUR_SUPABASE_URL') {
            showEmptyState();
            return;
        }

        const { data, error } = await supabase
            .from('tracks')
            .select('*')
            .order('position', { ascending: true });

        if (error) throw error;

        tracks = data || [];
        
        if (tracks.length === 0) {
            showEmptyState();
        } else {
            renderTrackList();
            // 默认加载第一首，但不播放
            if (tracks[0].is_synced) {
                loadTrack(0);
            }
        }
    } catch (err) {
        console.error('获取歌曲失败:', err);
        trackListEl.innerHTML = '<div class="loading">加载失败，请检查数据库配置。</div>';
    }
}

function showEmptyState() {
    trackListEl.innerHTML = `
        <div class="loading" style="text-align: center; padding: 40px; color: var(--text-secondary);">
            <i data-lucide="database" style="width: 48px; height: 48px; margin-bottom: 16px;"></i>
            <p>数据库为空或未配置。</p>
            <p style="font-size: 14px; margin-top: 8px;">请在 Supabase 中插入数据。</p>
        </div>
    `;
    lucide.createIcons();
}

// 渲染歌曲列表
function renderTrackList() {
    trackListEl.innerHTML = '<div style="padding: 10px 20px; color: #a0a0a0; font-size: 13px; text-align: center; background: rgba(255,255,255,0.05); border-radius: 8px; margin-bottom: 15px;">由于云端限制，请复制链接通过快捷指令下载后上传。</div>';
    tracks.forEach((track, index) => {
        const item = document.createElement('div');
        item.className = 'track-item';
        
        // 判断是否已同步
        const syncStatusHtml = track.is_synced 
            ? `<span class="status-synced"><i data-lucide="check-circle"></i> 已就绪</span>`
            : `<div style="display: flex; gap: 8px;">
                 <button class="btn-copy" data-id="${track.id}" data-index="${index}" style="display: flex; align-items: center; gap: 4px; background: #333; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">
                   <i data-lucide="link" style="width: 14px; height: 14px;"></i> 复制链接
                 </button>
                 <button class="btn-upload" data-id="${track.id}" data-index="${index}" style="display: flex; align-items: center; gap: 4px; background: #1DB954; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">
                   <i data-lucide="upload" style="width: 14px; height: 14px;"></i> 上传 MP3
                 </button>
                 <input type="file" id="file-upload-${index}" accept="audio/*, .mp3, .m4a, .wav, application/octet-stream" style="display: none;">
               </div>`;

        item.innerHTML = `
            <div class="index">${index + 1}</div>
            <div class="track-info-list" style="flex: 1;">
                <img src="${track.album_cover_url || 'https://picsum.photos/seed/music/40/40'}" alt="cover">
                <div>
                    <div class="title">${track.title}</div>
                    <div class="artist">${track.artist}</div>
                </div>
            </div>
            <div class="track-actions">
                ${syncStatusHtml}
                <button class="btn-delete" data-id="${track.id}" data-index="${index}" title="删除歌曲">
                    <i data-lucide="trash-2"></i>
                </button>
            </div>
        `;

        // 点击播放区域
        const infoArea = item.querySelector('.track-info-list');
        infoArea.addEventListener('click', () => {
            if (track.is_synced) {
                playTrack(index);
            } else {
                alert('请先上传本地音频！');
            }
        });

        // 绑定复制链接按钮事件
        const copyBtn = item.querySelector('.btn-copy');
        if (copyBtn) {
            copyBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                copyBtn.innerHTML = `<i data-lucide="loader" class="spin" style="width: 14px; height: 14px;"></i> 获取中...`;
                lucide.createIcons();
                
                try {
                    // 优先使用数据库中已有的 source_url
                    let urlToCopy = track.source_url;
                    
                    // 如果没有 source_url，或者不是 youtube 链接，则生成一个 YouTube 搜索链接
                    if (!urlToCopy || !urlToCopy.includes('youtube.com')) {
                        const query = encodeURIComponent(`${track.title} ${track.artist} audio`);
                        urlToCopy = `https://www.youtube.com/results?search_query=${query}`;
                    }
                    
                    await navigator.clipboard.writeText(urlToCopy);
                    copyBtn.innerHTML = `<i data-lucide="check" style="width: 14px; height: 14px;"></i> 已复制`;
                } catch (err) {
                    console.error('获取链接失败:', err);
                    alert('获取链接失败: ' + err.message);
                    copyBtn.innerHTML = `<i data-lucide="link" style="width: 14px; height: 14px;"></i> 复制链接`;
                }
                lucide.createIcons();
                
                // 2秒后恢复按钮状态
                setTimeout(() => {
                    if (copyBtn.innerHTML.includes('已复制')) {
                        copyBtn.innerHTML = `<i data-lucide="link" style="width: 14px; height: 14px;"></i> 复制链接`;
                        lucide.createIcons();
                    }
                }, 2000);
            });
        }

        // 绑定上传按钮事件
        const uploadBtn = item.querySelector('.btn-upload');
        const fileInput = item.querySelector(`#file-upload-${index}`);
        if (uploadBtn && fileInput) {
            uploadBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                fileInput.click();
            });

            fileInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                console.log('Selected file name:', file.name);
                console.log('Selected file type:', file.type);

                try {
                    uploadBtn.innerHTML = `<i data-lucide="loader" class="spin" style="width: 14px; height: 14px;"></i> 上传中...`;
                    uploadBtn.disabled = true;
                    lucide.createIcons();

                    // 生成唯一文件名
                    const fileExt = file.name.split('.').pop().toLowerCase();
                    const filePath = `${crypto.randomUUID()}.${fileExt}`;

                    let contentType = file.type;
                    if (!contentType && fileExt === 'mp3') {
                        contentType = 'audio/mpeg';
                    } else if (!contentType && fileExt === 'm4a') {
                        contentType = 'audio/mp4';
                    } else if (!contentType && fileExt === 'wav') {
                        contentType = 'audio/wav';
                    } else if (!contentType) {
                        contentType = 'application/octet-stream';
                    }

                    // 上传到 Supabase Storage (audio bucket)
                    const { error: uploadError } = await supabase.storage
                        .from('audio')
                        .upload(filePath, file, {
                            cacheControl: '3600',
                            contentType: contentType,
                            upsert: false
                        });

                    if (uploadError) throw uploadError;

                    // 更新数据库
                    const { error: dbError } = await supabase
                        .from('tracks')
                        .update({ is_synced: true, file_path: filePath })
                        .eq('id', track.id);

                    if (dbError) throw dbError;

                    // 更新本地状态并重新渲染
                    tracks[index].is_synced = true;
                    tracks[index].file_path = filePath;
                    renderTrackList();

                    // 自动获取歌词
                    fetchLyrics(track.id, track.title, track.artist, index);

                    // 如果当前没有播放歌曲，自动加载刚同步的这首
                    if (currentTrackIndex === -1) {
                        loadTrack(index);
                    }
                } catch (err) {
                    console.error('上传失败:', err);
                    alert('上传失败: ' + err.message);
                    uploadBtn.innerHTML = `<i data-lucide="upload" style="width: 14px; height: 14px;"></i> 上传 MP3`;
                    uploadBtn.disabled = false;
                    lucide.createIcons();
                }
            });
        }

        // 绑定删除按钮事件
        const deleteBtn = item.querySelector('.btn-delete');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteTrack(track.id, index, track.file_path);
            });
        }

        trackListEl.appendChild(item);
    });
    lucide.createIcons();
}

// 调用 Edge Function 同步音源
async function syncTrack(trackId, title, artist, btnElement, index) {
    try {
        // 更新 UI 为加载中
        btnElement.innerHTML = `<i data-lucide="loader" class="spin"></i> 同步中...`;
        btnElement.disabled = true;
        lucide.createIcons();

        // 调用 Supabase Edge Function
        const { data, error } = await supabase.functions.invoke('sync-track', {
            body: { trackId, title, artist, sourceUrl: tracks[index].source_url }
        });

        if (error) throw error;

        // 同步成功，更新本地状态并重新渲染
        tracks[index].is_synced = true;
        tracks[index].file_path = data.filePath;
        renderTrackList();
        
        // 如果当前没有播放歌曲，自动加载刚同步的这首
        if (currentTrackIndex === -1) {
            loadTrack(index);
        }

    } catch (err) {
        console.error('同步失败:', err);
        alert('同步失败: ' + err.message);
        btnElement.innerHTML = `<i data-lucide="cloud-download"></i> 重试同步`;
        btnElement.disabled = false;
        lucide.createIcons();
    }
}

// 删除歌曲
async function deleteTrack(id, index, filePath) {
    if (!confirm('确定要删除这首歌吗？')) return;
    
    try {
        // 1. 如果已同步，先删除 Storage 中的文件
        if (filePath) {
            await supabase.storage.from('audio').remove([filePath]);
        }
        
        // 2. 删除数据库记录
        const { error } = await supabase.from('tracks').delete().eq('id', id);
        if (error) throw error;
        
        // 3. 更新 UI 状态
        if (currentTrackIndex === index) {
            audio.pause();
            isPlaying = false;
            updatePlayButton();
            currentTrackIndex = -1;
            document.getElementById('track-title').textContent = '未播放';
            document.getElementById('track-artist').textContent = '-';
            document.getElementById('cover-img').src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        } else if (currentTrackIndex > index) {
            currentTrackIndex--;
        }
        
        await fetchTracks();
    } catch (err) {
        console.error('删除失败:', err);
        alert('删除失败: ' + err.message);
    }
}

// 加载歌曲信息
async function loadTrack(index) {
    if (index < 0 || index >= tracks.length) return;
    const track = tracks[index];
    if (!track.is_synced) return; // 未同步的歌曲不能加载

    currentTrackIndex = index;

    // 更新 UI
    document.getElementById('track-title').textContent = track.title;
    document.getElementById('track-artist').textContent = track.artist;
    
    const coverUrl = track.album_cover_url || 'https://picsum.photos/seed/music/400/400';
    document.getElementById('cover-img').src = coverUrl;
    
    // 全屏/歌词模式背景更新
    document.getElementById('bg-blur').style.backgroundImage = `url(${coverUrl})`;

    // 获取音频 URL (使用 createSignedUrl 确保私有 bucket 也能访问)
    const { data, error } = await supabase.storage.from('audio').createSignedUrl(track.file_path, 3600);
    if (error) {
        console.error('获取音频链接失败:', error);
        // 如果获取签名链接失败，尝试使用公开链接作为 fallback
        const publicData = supabase.storage.from('audio').getPublicUrl(track.file_path);
        audio.src = publicData.data.publicUrl;
    } else {
        audio.src = data.signedUrl;
    }

    // 更新列表高亮
    document.querySelectorAll('.track-item').forEach((el, i) => {
        el.classList.toggle('playing', i === index);
    });

    // 更新画中画 Canvas
    updatePiPCanvas(coverUrl, track.title, track.artist);

    // 渲染歌词
    renderLyrics();
}

// 播放指定歌曲
async function playTrack(index) {
    if (currentTrackIndex !== index) {
        await loadTrack(index);
    }
    try {
        await audio.play();
        isPlaying = true;
        updatePlayButton();
    } catch (err) {
        console.error('播放失败，尝试下一首:', err);
        playNext();
    }
}

function togglePlay() {
    if (currentTrackIndex === -1) {
        // 找第一首已同步的歌播放
        const firstSyncedIndex = tracks.findIndex(t => t.is_synced);
        if (firstSyncedIndex !== -1) {
            playTrack(firstSyncedIndex);
        } else {
            alert('没有可播放的歌曲，请先同步音源。');
        }
        return;
    }
    if (isPlaying) {
        audio.pause();
    } else {
        audio.play();
    }
    isPlaying = !isPlaying;
    updatePlayButton();
}

function playNext() {
    if (tracks.length === 0) return;
    let nextIndex = currentTrackIndex;
    // 寻找下一首已同步的歌
    for (let i = 1; i <= tracks.length; i++) {
        let checkIndex = (currentTrackIndex + i) % tracks.length;
        if (tracks[checkIndex].is_synced) {
            nextIndex = checkIndex;
            break;
        }
    }
    if (nextIndex !== currentTrackIndex) {
        playTrack(nextIndex);
    }
}

function playPrev() {
    if (tracks.length === 0) return;
    let prevIndex = currentTrackIndex;
    // 寻找上一首已同步的歌
    for (let i = 1; i <= tracks.length; i++) {
        let checkIndex = (currentTrackIndex - i + tracks.length) % tracks.length;
        if (tracks[checkIndex].is_synced) {
            prevIndex = checkIndex;
            break;
        }
    }
    if (prevIndex !== currentTrackIndex) {
        playTrack(prevIndex);
    }
}

function updatePlayButton() {
    playBtn.innerHTML = isPlaying ? '<i data-lucide="pause"></i>' : '<i data-lucide="play"></i>';
    lucide.createIcons();
}

// 事件监听
function setupEventListeners() {
    playBtn.addEventListener('click', togglePlay);
    nextBtn.addEventListener('click', playNext);
    prevBtn.addEventListener('click', playPrev);

    // 自动连播
    audio.addEventListener('ended', playNext);
    
    // 错误处理
    audio.addEventListener('error', () => {
        console.error('音频加载错误');
        if (tracks.length > 0) setTimeout(playNext, 2000);
    });

    // 进度条更新
    audio.addEventListener('timeupdate', () => {
        const percent = (audio.currentTime / audio.duration) * 100;
        progress.style.width = `${percent}%`;
        timeCurrent.textContent = formatTime(audio.currentTime);
        
        // 歌词同步滚动
        syncLyrics(audio.currentTime);
    });

    audio.addEventListener('loadedmetadata', () => {
        timeTotal.textContent = formatTime(audio.duration);
    });

    // 点击进度条跳转 (适配触摸)
    progressBar.addEventListener('pointerdown', (e) => {
        const rect = progressBar.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        audio.currentTime = percent * audio.duration;
    });

    // 音量控制
    volumeSlider.addEventListener('input', (e) => {
        audio.volume = e.target.value;
    });

    // 模式切换
    document.getElementById('btn-mode-standard').addEventListener('click', () => switchMode('standard'));
    document.getElementById('btn-mode-full').addEventListener('click', () => switchMode('full'));
    document.getElementById('btn-mode-lyrics').addEventListener('click', () => switchMode('lyrics'));
    document.getElementById('btn-mode-mini').addEventListener('click', () => switchMode('mini'));
    
    // 退出模式按钮
    document.getElementById('btn-exit-mode').addEventListener('click', () => switchMode('standard'));
    
    // 画中画悬浮窗
    pipBtn.addEventListener('click', togglePiP);

    // 导入数据
    if (importBtn) {
        importBtn.addEventListener('click', importData);
    }

    // 快捷键支持
    document.addEventListener('keydown', (e) => {
        // 忽略输入框内的快捷键
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        switch(e.key.toLowerCase()) {
            case ' ':
                e.preventDefault();
                togglePlay();
                break;
            case 'arrowleft':
                e.preventDefault();
                playPrev();
                break;
            case 'arrowright':
                e.preventDefault();
                playNext();
                break;
            case 'arrowup':
                e.preventDefault();
                const volUp = Math.min(1, audio.volume + 0.1);
                audio.volume = volUp;
                volumeSlider.value = volUp;
                break;
            case 'arrowdown':
                e.preventDefault();
                const volDown = Math.max(0, audio.volume - 0.1);
                audio.volume = volDown;
                volumeSlider.value = volDown;
                break;
            case 'enter':
                e.preventDefault();
                togglePlay();
                break;
            case 'escape':
                e.preventDefault();
                switchMode('standard');
                break;
            case 'f':
                e.preventDefault();
                switchMode('full');
                break;
            case 'm':
                e.preventDefault();
                switchMode('mini');
                break;
            case 's':
                e.preventDefault();
                switchMode('standard');
                break;
            case 'l':
                e.preventDefault();
                switchMode('lyrics');
                break;
            case 'i':
                e.preventDefault();
                importData();
                break;
        }
    });
}

// 导入数据 (支持 Spotify 链接、HTTPS MP3 链接或 JSON)
async function importData() {
    const input = prompt("请输入 Spotify 歌单/单曲链接，或 MP3 直链，或 JSON 数组：\n(例如: https://open.spotify.com/playlist/...)");
    if (!input) return;

    try {
        importBtn.innerHTML = `<i data-lucide="loader" class="spin"></i> 处理中...`;
        importBtn.disabled = true;
        lucide.createIcons();

        let dataToImport = [];

        // 1. 处理 Spotify 链接
        if (input.includes('spotify.com')) {
            importBtn.innerHTML = `<i data-lucide="loader" class="spin"></i> 解析 Spotify...`;
            lucide.createIcons();
            
            const { data, error } = await supabase.functions.invoke('parse-spotify', {
                body: { url: input }
            });
            
            if (error) throw new Error(data?.error || error.message);
            if (!data.tracks || data.tracks.length === 0) throw new Error('未找到歌曲');

            dataToImport = data.tracks.map((t, i) => ({
                title: t.title,
                artist: t.artist,
                album_cover_url: t.album_cover_url,
                position: tracks.length + i + 1
            }));
        } 
        // 2. 处理普通 MP3 HTTPS 链接
        else if (input.startsWith('http://') || input.startsWith('https://')) {
            const title = prompt("请输入歌曲名称：", "未知歌曲") || "未知歌曲";
            const artist = prompt("请输入歌手名称：", "未知歌手") || "未知歌手";
            dataToImport = [{
                title: title,
                artist: artist,
                source_url: input,
                album_cover_url: `https://picsum.photos/seed/${encodeURIComponent(title)}/400/400`,
                position: tracks.length + 1
            }];
        } 
        // 3. 处理 JSON 数组
        else {
            dataToImport = JSON.parse(input);
            if (!Array.isArray(dataToImport)) throw new Error("必须是 JSON 数组");
        }

        // 插入数据库
        importBtn.innerHTML = `<i data-lucide="loader" class="spin"></i> 写入数据库...`;
        lucide.createIcons();
        
        const { error: insertError } = await supabase.from('tracks').insert(dataToImport);
        if (insertError) throw insertError;

        alert(`成功导入 ${dataToImport.length} 首歌曲！`);
        await fetchTracks();
        
    } catch (err) {
        console.error('导入失败:', err);
        alert('导入失败: ' + err.message);
    } finally {
        importBtn.innerHTML = `<i data-lucide="import"></i> 导入数据`;
        importBtn.disabled = false;
        lucide.createIcons();
    }
}

// 格式化时间
function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// 模式切换逻辑
function switchMode(mode) {
    const app = document.getElementById('app');
    app.className = `mode-${mode}`;
    currentMode = mode;

    // 更新按钮高亮
    document.querySelectorAll('.actions button').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`btn-mode-${mode}`);
    if (activeBtn) activeBtn.classList.add('active');

    // 显示/隐藏返回按钮
    const exitBtn = document.getElementById('btn-exit-mode');
    if (mode === 'standard') {
        exitBtn.style.display = 'none';
    } else {
        exitBtn.style.display = 'flex';
    }

    // 显示/隐藏歌词面板
    const lyricsPanel = document.getElementById('lyrics-panel');
    if (mode === 'lyrics') {
        lyricsPanel.style.display = 'flex';
        // 切换到歌词模式时，滚动到当前歌词
        setTimeout(() => syncLyrics(audio.currentTime, true), 100);
    } else {
        lyricsPanel.style.display = 'none';
    }

    // 如果是小窗模式，点击空白处恢复标准模式 (已废弃，改用返回按钮)
    app.onclick = null;
}

// =========================================
// 歌词功能
// =========================================

// 自动获取歌词与翻译
async function fetchLyrics(trackId, title, artist, index) {
    try {
        console.log('开始获取歌词:', title, artist);
        const query = encodeURIComponent(`${title} ${artist}`);
        const res = await fetch(`https://lrclib.net/api/search?q=${query}`);
        const data = await res.json();
        
        if (data && data.length > 0) {
            const bestMatch = data[0];
            const syncedLyrics = bestMatch.syncedLyrics;
            const plainLyrics = bestMatch.plainLyrics;
            
            if (syncedLyrics) {
                const lyricsJson = parseLRC(syncedLyrics);
                let translation = null;
                
                // 尝试获取网易云翻译
                try {
                    const wyQuery = encodeURIComponent(`${title} ${artist}`);
                    const wySearchUrl = `https://music.163.com/api/search/get/web?csrf_token=hlpretag=&hlposttag=&s=${wyQuery}&type=1&offset=0&total=true&limit=1`;
                    const wyRes = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(wySearchUrl)}`);
                    const wyData = await wyRes.json();
                    
                    if (wyData.result && wyData.result.songs && wyData.result.songs.length > 0) {
                        const songId = wyData.result.songs[0].id;
                        const wyLyricUrl = `https://music.163.com/api/song/lyric?id=${songId}&lv=1&kv=1&tv=-1`;
                        const wyLyricRes = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(wyLyricUrl)}`);
                        const wyLyricData = await wyLyricRes.json();
                        
                        if (wyLyricData.tlyric && wyLyricData.tlyric.lyric) {
                            translation = wyLyricData.tlyric.lyric;
                        }
                    }
                } catch (wyErr) {
                    console.error('获取网易云翻译失败:', wyErr);
                }
                
                // 更新数据库
                const { error } = await supabase
                    .from('tracks')
                    .update({ 
                        lyrics: lyricsJson,
                        lyrics_translation: translation
                    })
                    .eq('id', trackId);
                    
                if (error) throw error;
                
                // 更新本地状态
                tracks[index].lyrics = lyricsJson;
                tracks[index].lyrics_translation = translation;
                
                console.log('歌词获取成功并已保存');
                
                // 如果当前正在播放这首歌，刷新歌词显示
                if (currentTrackIndex === index) {
                    renderLyrics();
                }
            }
        }
    } catch (err) {
        console.error('获取歌词失败:', err);
    }
}

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

// 渲染歌词
function renderLyrics() {
    const container = document.getElementById('lyrics-container');
    if (currentTrackIndex === -1) {
        container.innerHTML = '<div class="lyrics-placeholder">暂无播放</div>';
        return;
    }
    
    const track = tracks[currentTrackIndex];
    if (!track.lyrics || track.lyrics.length === 0) {
        container.innerHTML = '<div class="lyrics-placeholder">暂无歌词</div>';
        return;
    }
    
    // 解析翻译 (如果有)
    let transMap = {};
    if (track.lyrics_translation) {
        const transLines = parseLRC(track.lyrics_translation);
        transLines.forEach(t => {
            // 匹配时间戳，允许一定误差
            const key = Math.floor(t.time);
            transMap[key] = t.text;
        });
    }
    
    let html = '';
    track.lyrics.forEach((line, i) => {
        const key = Math.floor(line.time);
        const transText = transMap[key] || '';
        html += `
            <div class="lyric-line" id="lyric-${i}" data-time="${line.time}">
                <div class="lyric-text">${line.text}</div>
                ${transText ? `<div class="lyric-translation">${transText}</div>` : ''}
            </div>
        `;
    });
    
    container.innerHTML = html;
    
    // 点击歌词跳转进度
    container.querySelectorAll('.lyric-line').forEach((el, i) => {
        el.addEventListener('click', () => {
            const time = parseFloat(el.getAttribute('data-time'));
            audio.currentTime = time;
            if (!isPlaying) togglePlay();
        });
    });
}

// 同步歌词滚动
let lastActiveLyricIndex = -1;
function syncLyrics(currentTime, forceScroll = false) {
    if (currentMode !== 'lyrics' || currentTrackIndex === -1) return;
    
    const track = tracks[currentTrackIndex];
    if (!track.lyrics || track.lyrics.length === 0) return;
    
    // 找到当前时间对应的歌词
    let activeIndex = -1;
    for (let i = 0; i < track.lyrics.length; i++) {
        if (currentTime >= track.lyrics[i].time) {
            activeIndex = i;
        } else {
            break;
        }
    }
    
    if (activeIndex !== lastActiveLyricIndex || forceScroll) {
        lastActiveLyricIndex = activeIndex;
        
        // 移除所有高亮
        document.querySelectorAll('.lyric-line').forEach(el => el.classList.remove('active'));
        
        if (activeIndex !== -1) {
            const activeEl = document.getElementById(`lyric-${activeIndex}`);
            if (activeEl) {
                activeEl.classList.add('active');
                
                // 滚动到居中位置
                const container = document.getElementById('lyrics-container');
                const offsetTop = activeEl.offsetTop;
                const containerHeight = container.clientHeight;
                const scrollPos = offsetTop - (containerHeight / 2) + (activeEl.clientHeight / 2);
                
                container.scrollTo({
                    top: scrollPos,
                    behavior: 'smooth'
                });
            }
        }
    }
}

// ==========================================
// 黑科技：真正悬浮小窗 (Picture-in-Picture)
// ==========================================
const canvas = document.getElementById('pip-canvas');
const ctx = canvas.getContext('2d');
const video = document.getElementById('pip-video');
let pipImage = new Image();

// 更新 Canvas 内容
function updatePiPCanvas(imgUrl, title, artist) {
    pipImage.crossOrigin = "Anonymous";
    pipImage.src = imgUrl;
    pipImage.onload = () => {
        drawPiPFrame(title, artist);
    };
}

// 绘制一帧到 Canvas
function drawPiPFrame(title, artist) {
    ctx.fillStyle = '#181818';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.drawImage(pipImage, 0, 0, canvas.width, canvas.height);
    
    const gradient = ctx.createLinearGradient(0, canvas.height - 150, 0, canvas.height);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.8)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, canvas.height - 150, canvas.width, 150);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 32px sans-serif';
    ctx.fillText(title, 24, canvas.height - 60);
    
    ctx.fillStyle = '#b3b3b3';
    ctx.font = '24px sans-serif';
    ctx.fillText(artist, 24, canvas.height - 24);
}

// 开启/关闭画中画
async function togglePiP() {
    try {
        if (document.pictureInPictureElement) {
            await document.exitPictureInPicture();
        } else {
            const stream = canvas.captureStream(25);
            video.srcObject = stream;
            await video.play();
            await video.requestPictureInPicture();
        }
    } catch (error) {
        console.error('画中画模式启动失败:', error);
        alert('您的浏览器可能不支持画中画功能，或需要用户交互触发。');
    }
}

// 启动应用
init();

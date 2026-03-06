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
    trackListEl.innerHTML = '';
    tracks.forEach((track, index) => {
        const item = document.createElement('div');
        item.className = 'track-item';
        
        // 判断是否已同步
        const syncStatusHtml = track.is_synced 
            ? `<span class="status-synced"><i data-lucide="check-circle"></i> 已就绪</span>`
            : `<button class="btn-sync" data-id="${track.id}" data-index="${index}">
                 <i data-lucide="cloud-download"></i> 同步音源
               </button>`;

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
            </div>
        `;

        // 点击播放区域
        const infoArea = item.querySelector('.track-info-list');
        infoArea.addEventListener('click', () => {
            if (track.is_synced) {
                playTrack(index);
            } else {
                alert('请先点击同步音源！');
            }
        });

        // 绑定同步按钮事件
        const syncBtn = item.querySelector('.btn-sync');
        if (syncBtn) {
            syncBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                syncTrack(track.id, track.title, track.artist, syncBtn, index);
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
            body: { trackId, title, artist }
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

// 加载歌曲信息
function loadTrack(index) {
    if (index < 0 || index >= tracks.length) return;
    const track = tracks[index];
    if (!track.is_synced) return; // 未同步的歌曲不能加载

    currentTrackIndex = index;

    // 更新 UI
    document.getElementById('track-title').textContent = track.title;
    document.getElementById('track-artist').textContent = track.artist;
    
    const coverUrl = track.album_cover_url || 'https://picsum.photos/seed/music/400/400';
    document.getElementById('cover-img').src = coverUrl;
    
    // 全屏模式背景更新
    document.getElementById('bg-blur').style.backgroundImage = `url(${coverUrl})`;

    // 获取音频 URL
    const { data } = supabase.storage.from('audio').getPublicUrl(track.file_path);
    audio.src = data.publicUrl;

    // 更新列表高亮
    document.querySelectorAll('.track-item').forEach((el, i) => {
        el.classList.toggle('playing', i === index);
    });

    // 更新画中画 Canvas
    updatePiPCanvas(coverUrl, track.title, track.artist);
}

// 播放指定歌曲
async function playTrack(index) {
    if (currentTrackIndex !== index) {
        loadTrack(index);
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
    document.getElementById('btn-mode-mini').addEventListener('click', () => switchMode('mini'));
    
    // 画中画悬浮窗
    pipBtn.addEventListener('click', togglePiP);

    // 导入数据
    if (importBtn) {
        importBtn.addEventListener('click', importMockData);
    }
}

// 导入测试数据
async function importMockData() {
    const input = prompt("请输入包含 Spotify 数据的 JSON 数组（留空则导入默认测试数据）：");
    let dataToImport = [];
    
    if (input) {
        try {
            dataToImport = JSON.parse(input);
            if (!Array.isArray(dataToImport)) throw new Error("必须是 JSON 数组");
        } catch (e) {
            alert("JSON 格式错误：" + e.message);
            return;
        }
    } else {
        dataToImport = [
            { title: "Shape of You", artist: "Ed Sheeran", album_cover_url: "https://picsum.photos/seed/shape/400/400", position: 1 },
            { title: "Blinding Lights", artist: "The Weeknd", album_cover_url: "https://picsum.photos/seed/blinding/400/400", position: 2 },
            { title: "Dance Monkey", artist: "Tones and I", album_cover_url: "https://picsum.photos/seed/dance/400/400", position: 3 }
        ];
    }

    try {
        importBtn.innerHTML = `<i data-lucide="loader" class="spin"></i> 导入中...`;
        importBtn.disabled = true;
        lucide.createIcons();

        const { error } = await supabase.from('tracks').insert(dataToImport);
        if (error) throw error;

        alert('导入成功！');
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

    // 如果是小窗模式，点击空白处恢复标准模式
    if (mode === 'mini') {
        app.onclick = (e) => {
            if (e.target === app || e.target.tagName === 'STYLE') {
                switchMode('standard');
                app.onclick = null;
            }
        };
    } else {
        app.onclick = null;
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

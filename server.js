const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const VIDEO_DIR = path.join(UPLOAD_DIR, 'videos');
const COVER_DIR = path.join(UPLOAD_DIR, 'covers');
const DB_FILE = path.join(DATA_DIR, 'videos.json');
const MAX_UPLOAD_MB = Math.max(1, Number(process.env.MAX_UPLOAD_MB || 1024));

for (const dir of [DATA_DIR, VIDEO_DIR, COVER_DIR]) fs.mkdirSync(dir, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]\n');

function readVideos() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { throw new Error('Video data file is invalid. Back up and repair data/videos.json.'); }
}
function writeVideos(videos) {
  const temp = DB_FILE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(videos, null, 2));
  fs.renameSync(temp, DB_FILE);
}
function safeExt(name) {
  const ext = path.extname(name).toLowerCase();
  return /^\.(mp4|webm|mov|m4v|jpg|jpeg|png|webp|avif)$/i.test(ext) ? ext : '';
}
function isAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: '请先登录管理员账号。' });
}

app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

if (!process.env.SESSION_SECRET || !process.env.ADMIN_PASSWORD) {
  console.warn('安全提醒：请设置 SESSION_SECRET 和 ADMIN_PASSWORD 环境变量后再公开部署。');
}
app.use(session({
  name: 'wqj.sid',
  secret: process.env.SESSION_SECRET || 'development-only-change-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: 8 * 60 * 60 * 1000
  }
}));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, file.fieldname === 'cover' ? COVER_DIR : VIDEO_DIR),
  filename: (req, file, cb) => {
    const ext = safeExt(file.originalname);
    if (!ext) return cb(new Error('不支持的文件扩展名。'));
    cb(null, crypto.randomUUID() + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 2, fields: 12 },
  fileFilter: (req, file, cb) => {
    const ext = safeExt(file.originalname);
    const allowed = file.fieldname === 'video'
      ? ['.mp4', '.webm', '.mov', '.m4v']
      : ['.jpg', '.jpeg', '.png', '.webp', '.avif'];
    if (!ext || !allowed.includes(ext)) return cb(new Error('文件类型不支持：视频请使用 MP4/WebM/MOV/M4V，封面请使用 JPG/PNG/WebP/AVIF。'));
    cb(null, true);
  }
});

// Public frontend and media. Express static supports HTTP range requests for video seeking.
app.use(express.static(PUBLIC_DIR));
app.use('/media/videos', express.static(VIDEO_DIR, { fallthrough: false, maxAge: '1h' }));
app.use('/media/covers', express.static(COVER_DIR, { fallthrough: false, maxAge: '1d' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/videos', (req, res) => {
  const { category, q } = req.query;
  let list = readVideos().filter(v => v.published !== false);
  if (category && category !== 'all') list = list.filter(v => v.category === category);
  if (q) {
    const term = String(q).toLowerCase();
    list = list.filter(v => `${v.title} ${v.description} ${v.tags || ''}`.toLowerCase().includes(term));
  }
  res.json(list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
});
app.get('/api/videos/:id', (req, res) => {
  const video = readVideos().find(v => v.id === req.params.id && v.published !== false);
  if (!video) return res.status(404).json({ error: '找不到这个视频。' });
  res.json(video);
});

// Admin authentication. Configure credentials through environment variables.
app.post('/api/admin/login', (req, res) => {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD;
  if (!password || req.body.username !== username || req.body.password !== password) {
    return res.status(401).json({ error: '用户名或密码错误。' });
  }
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: '登录失败，请重试。' });
    req.session.isAdmin = true;
    res.json({ ok: true });
  });
});
app.post('/api/admin/logout', isAdmin, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});
app.get('/api/admin/me', (req, res) => res.json({ authenticated: !!(req.session && req.session.isAdmin) }));
app.get('/api/admin/videos', isAdmin, (req, res) => res.json(readVideos()));

app.post('/api/admin/videos', isAdmin, (req, res, next) => {
  upload.fields([{ name: 'video', maxCount: 1 }, { name: 'cover', maxCount: 1 }])(req, res, err => {
    if (err) return next(err);
    try {
      const videoFile = req.files && req.files.video && req.files.video[0];
      const coverFile = req.files && req.files.cover && req.files.cover[0];
      if (!videoFile) return res.status(400).json({ error: '请选择视频文件。' });
      const title = String(req.body.title || '').trim().slice(0, 160);
      if (!title) {
        fs.unlinkSync(videoFile.path);
        if (coverFile) fs.unlinkSync(coverFile.path);
        return res.status(400).json({ error: '请填写视频标题。' });
      }
      const item = {
        id: crypto.randomUUID(),
        title,
        description: String(req.body.description || '').trim().slice(0, 5000),
        category: ['movies', 'live', 'ai', 'shorts'].includes(req.body.category) ? req.body.category : 'movies',
        tags: String(req.body.tags || '').trim().slice(0, 300),
        videoUrl: `/media/videos/${path.basename(videoFile.filename)}`,
        coverUrl: coverFile ? `/media/covers/${path.basename(coverFile.filename)}` : '',
        originalName: path.basename(videoFile.originalname).slice(0, 200),
        size: videoFile.size,
        createdAt: new Date().toISOString(),
        published: true
      };
      const videos = readVideos();
      videos.push(item);
      writeVideos(videos);
      res.status(201).json(item);
    } catch (e) { next(e); }
  });
});

app.patch('/api/admin/videos/:id', isAdmin, (req, res) => {
  const videos = readVideos();
  const item = videos.find(v => v.id === req.params.id);
  if (!item) return res.status(404).json({ error: '视频不存在。' });
  if (typeof req.body.title === 'string') item.title = req.body.title.trim().slice(0, 160);
  if (typeof req.body.description === 'string') item.description = req.body.description.trim().slice(0, 5000);
  if (['movies', 'live', 'ai', 'shorts'].includes(req.body.category)) item.category = req.body.category;
  if (typeof req.body.published === 'boolean') item.published = req.body.published;
  writeVideos(videos);
  res.json(item);
});
app.delete('/api/admin/videos/:id', isAdmin, (req, res) => {
  const videos = readVideos();
  const index = videos.findIndex(v => v.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: '视频不存在。' });
  const [item] = videos.splice(index, 1);
  writeVideos(videos);
  for (const url of [item.videoUrl, item.coverUrl]) {
    if (url) {
      const folder = url.startsWith('/media/videos/') ? VIDEO_DIR : COVER_DIR;
      const filename = path.basename(url);
      const full = path.join(folder, filename);
      if (fs.existsSync(full)) fs.unlinkSync(full);
    }
  }
  res.json({ ok: true });
});

// Download endpoint redirects to the stored video URL. Browser can also play videoUrl directly.
app.get('/api/videos/:id/download', (req, res) => {
  const item = readVideos().find(v => v.id === req.params.id && v.published !== false);
  if (!item) return res.status(404).send('Video not found');
  const file = path.join(VIDEO_DIR, path.basename(item.videoUrl));
  if (!fs.existsSync(file)) return res.status(404).send('Video file missing');
  res.download(file, `${item.title.replace(/[\\/:*?"<>|]/g, '_')}${path.extname(file)}`);
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  const status = err instanceof multer.MulterError ? 400 : (err.status || 500);
  res.status(status).json({ error: err.message || '服务器错误。' });
});

app.listen(PORT, () => console.log(`WQJ Video Platform running at http://localhost:${PORT}`));

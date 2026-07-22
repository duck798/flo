# 🎭 AR Video Call

Ứng dụng gọi video thời gian thực với hiệu ứng AR, được xây dựng bằng HTML/CSS/JavaScript thuần.
Sử dụng **PeerJS** (WebRTC) và **MediaPipe** (AI nhận diện khuôn mặt & tay).

---

## 📂 Cấu trúc thư mục

```
ar-video-call/
├── index.html           ← Giao diện chính
├── css/
│   └── style.css        ← Toàn bộ styling
├── js/
│   ├── app.js           ← Entry point, điều phối
│   ├── peer.js          ← PeerJS connection & media
│   ├── mediapipe.js     ← MediaPipe AI (face + hand)
│   ├── ar-effects.js    ← Hiệu ứng AR menu công khai
│   ├── secret.js        ← Hệ thống bí mật (ẩn)
│   └── overlay.js       ← Canvas renderer
├── assets/
│   ├── effects/         ← Ảnh hiệu ứng AR (chưa dùng, vẽ vector)
│   └── memes/
│       ├── rose.png           ← Placeholder hoa hồng
│       ├── blue-dog.png       ← Placeholder meme chó xanh
│       └── screaming-man.png  ← Placeholder meme người hét
└── README.md
```

---

## 🚀 Deploy

### Option 1: Netlify Drop (dễ nhất)
1. Kéo thả toàn bộ thư mục `ar-video-call/` vào [netlify.com/drop](https://app.netlify.com/drop)
2. Xong! Nhận được URL HTTPS ngay lập tức.

### Option 2: GitHub Pages
1. Tạo repo mới trên GitHub
2. Upload toàn bộ file vào repo
3. Vào Settings → Pages → Branch: main → Save

### Option 3: Vercel
```bash
npm install -g vercel
cd ar-video-call
vercel
```

### Option 4: Test local với Python
```bash
# Python 3
python -m http.server 8080
# Truy cập: https://localhost:8080
```
> ⚠️ **Quan trọng**: Camera/Mic chỉ hoạt động qua **HTTPS** hoặc **localhost**.

---

## 🖼️ Thay ảnh meme cá nhân

### Cách đơn giản nhất: Thay file trong thư mục `assets/memes/`

| File | Hiệu ứng |
|------|----------|
| `assets/memes/rose.png` | Hoa hồng khi nắm tay |
| `assets/memes/blue-dog.png` | Chó xanh khi đưa ngón lên môi |
| `assets/memes/screaming-man.png` | Người hét khi há miệng to |

Chỉ cần **đặt đúng tên file** hoặc thay đường dẫn trong `js/overlay.js`:

```javascript
// Tìm hàm preloadMemes() trong overlay.js (~dòng 57):
preloadMemes({
  rose:          'assets/memes/rose.png',         // ← THAY TẠI ĐÂY
  blueDog:       'assets/memes/blue-dog.png',     // ← THAY TẠI ĐÂY
  screamingMan:  'assets/memes/screaming-man.png',// ← THAY TẠI ĐÂY
});
```

Có thể dùng **URL CDN online**:
```javascript
preloadMemes({
  rose:         'https://i.imgur.com/abc123.png',
  blueDog:      'https://cdn.example.com/dog.jpg',
  screamingMan: 'https://media.giphy.com/xyz.gif',
});
```

### Nếu muốn ảnh hoa hồng thật (thay emoji):
Trong `js/secret.js`, tìm hàm `triggerRoseBurst()`:
```javascript
// Thay type: 'text' bằng type: 'image'
Overlay.addParticleBurst({
  type: 'image',                    // ← thay 'text' thành 'image'
  src:  'assets/memes/rose.png',   // ← đường dẫn ảnh
  // text: '🌹',                   // ← comment dòng này lại
  ...
});
```

---

## 🎭 Hệ thống tính năng bí mật

> Không có bất kỳ nút nào trên giao diện. Hoàn toàn tự động.

| Cử chỉ | Hiệu ứng | Ghi chú |
|--------|----------|---------|
| ✊ Nắm tay | 🌹 Hoa hồng bay ra | Particle burst nhiều hướng |
| 🤫 Ngón trỏ lên môi | 🐕 Meme chó xanh + tắt mic | Mic tắt 3 giây |
| 😱 Há miệng hết cỡ | 😰 Meme người hét + tăng mic | Gain x2.5 trong 2.5s |
| 😁 Cười lớn | ✨ Sparkle + 💯 | Particle 2.5 giây |
| 🤔 Nhíu mày | ⬛ Đen trắng + ⏳ loading | Tự tắt sau 3.5s |

### Điều chỉnh ngưỡng kích hoạt
Trong `js/mediapipe.js`, tìm và chỉnh các giá trị:
```javascript
// Há miệng (mặc định > 0.55)
if (mouthOpenRatio > 0.55) { ... }

// Cười lớn (mặc định smile > 0.72)
if (smileRatio > 0.72 && mouthOpenRatio > 0.1) { ... }

// Nhíu mày (mặc định > 0.6)
if (browFurrowScore > 0.6) { ... }

// Nắm đấm (mặc định > 0.75)
if (fistScore > 0.75) { ... }
```

### Test không cần cử chỉ
Mở DevTools Console và gõ:
```javascript
// Bật chế độ debug
window.DEBUG_SECRET = true;
// Rồi nhấn phím 1-5 trên bàn phím:
// 1: Hoa hồng   2: Chó xanh   3: Người hét
// 4: Sparkle    5: Đen trắng
```
Hoặc gọi trực tiếp:
```javascript
SecretSystem._triggerRose();    // Hoa hồng
SecretSystem._triggerShh();     // Chó xanh + tắt mic
SecretSystem._triggerScream();  // Người hét
SecretSystem._triggerSmile();   // Sparkle
SecretSystem._triggerThink();   // Đen trắng
```

---

## 🔧 Cấu hình nâng cao

### Đổi PeerJS Server (self-host)
Trong `js/peer.js`, tìm `PEER_CONFIG`:
```javascript
const PEER_CONFIG = {
  host: 'your-peerserver.com',  // ← thêm dòng này
  port: 9000,                    // ← và dòng này
  path: '/peer',                 // ← và dòng này
  // ...
};
```

### Thêm TURN Server (khi STUN không đủ)
```javascript
const ICE_SERVERS = [
  // ...existing STUN servers...
  {
    urls: 'turn:your-turn-server.com:3478',
    username: 'username',
    credential: 'password',
  },
];
```

---

## 🌐 Trình duyệt hỗ trợ

| Trình duyệt | Hỗ trợ |
|-------------|--------|
| Chrome 88+  | ✅ Đầy đủ |
| Edge 88+    | ✅ Đầy đủ |
| Firefox 90+ | ✅ Đầy đủ |
| Safari 15+  | ⚠️ Hạn chế (WebRTC giới hạn) |
| Mobile      | ✅ Chrome for Android |

---

## 📝 License
MIT – Tự do sử dụng và chỉnh sửa.

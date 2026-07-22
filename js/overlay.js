/**
 * overlay.js
 * ============================================================
 * Module quản lý Canvas Overlay cho video local.
 *
 * Chức năng:
 *  - Duy trì vòng lặp requestAnimationFrame vẽ frame từ video thô
 *    lên canvas hiển thị (local-canvas).
 *  - Cung cấp API cho ar-effects.js và secret.js để vẽ
 *    các lớp overlay lên trên video.
 *  - Quản lý hệ thống Particle (các icon/ảnh bay lên).
 *  - Quản lý trạng thái grayscale (đen trắng).
 * ============================================================
 */

const Overlay = (() => {
  // ─── Tham chiếu DOM ───────────────────────────────────────
  let videoEl   = null;   // <video id="local-video-raw"> – nguồn camera thô
  let canvasEl  = null;   // <canvas id="local-canvas">   – canvas hiển thị
  let ctx       = null;   // CanvasRenderingContext2D của canvasEl

  // ─── Canvas bí mật (secret effects layer) ─────────────────
  let secretCanvas = null;
  let secretCtx    = null;

  // ─── Trạng thái ───────────────────────────────────────────
  let isRunning    = false;  // vòng lặp đang chạy hay không
  let isGrayscale  = false;  // hiệu ứng đen trắng đang bật
  let rafId        = null;   // ID của requestAnimationFrame

  // ─── Danh sách hàm vẽ AR overlay (từ ar-effects.js) ──────
  // Mỗi phần tử là function(ctx, landmarks, canvasW, canvasH)
  let arDrawFn = null;

  // ─── Danh sách hàm vẽ Secret overlay (từ secret.js) ──────
  // Mỗi phần tử là function(ctx, canvasW, canvasH, timestamp)
  const secretDrawFns = [];

  // ─── Hệ thống Particle ────────────────────────────────────
  // Mỗi particle: { img, x, y, vx, vy, scale, opacity, rot, rotSpeed, lifetime, age }
  const particles = [];

  // ─── Ảnh meme (preload để tránh lag khi hiển thị) ─────────
  const memeImages = {};

  // ===========================================================
  //  KHỞI TẠO
  // ===========================================================

  /**
   * Khởi tạo Overlay module.
   * Gọi sau khi DOM sẵn sàng.
   */
  function init(videoElement, canvasElement) {
    videoEl  = videoElement;
    canvasEl = canvasElement;
    ctx      = canvasEl.getContext('2d');

    // Tạo canvas bí mật nằm trên canvasEl (cùng container)
    secretCanvas        = document.createElement('canvas');
    secretCanvas.id     = 'secret-canvas';
    secretCanvas.style.cssText = `
      position: absolute; inset: 0;
      width: 100%; height: 100%;
      pointer-events: none; z-index: 15;
    `;
    canvasEl.parentElement.appendChild(secretCanvas);
    secretCtx = secretCanvas.getContext('2d');

    // Preload ảnh meme từ thư mục assets/memes/
    // ⚠️ THAY LINK ẢNH MEME CÁ NHÂN TẠI ĐÂY ⚠️
    preloadMemes({
      rose:          'assets/memes/rose.png',         // Hoa hồng – nắm tay
      blueDog:       'assets/memes/blue-dog.png',     // Chó xanh – suỵt
      screamingMan:  'assets/memes/screaming-man.png',// Người hét – há miệng
    });

    console.log('[Overlay] Đã khởi tạo canvas overlay');
  }

  /**
   * Preload nhiều ảnh cùng lúc.
   * @param {Object} map - { key: url }
   */
  function preloadMemes(map) {
    for (const [key, url] of Object.entries(map)) {
      const img = new Image();
      img.src = url;
      img.onload  = () => console.log(`[Overlay] Đã load ảnh meme: ${key}`);
      img.onerror = () => console.warn(`[Overlay] Không tải được ảnh meme: ${key} (${url})`);
      memeImages[key] = img;
    }
  }

  // ===========================================================
  //  VÒNG LẶP RENDER CHÍNH
  // ===========================================================

  /** Bắt đầu vòng lặp render. */
  function start() {
    if (isRunning) return;
    isRunning = true;
    renderLoop();
    console.log('[Overlay] Bắt đầu vòng lặp render');
  }

  /** Dừng vòng lặp render. */
  function stop() {
    isRunning = false;
    if (rafId) cancelAnimationFrame(rafId);
    console.log('[Overlay] Dừng vòng lặp render');
  }

  /**
   * Vòng lặp chính: chạy mỗi frame (~60fps).
   * Thứ tự vẽ:
   *   1. Đồng bộ kích thước canvas với video
   *   2. Vẽ frame video thô
   *   3. Áp filter grayscale nếu cần
   *   4. Vẽ AR effects (tai thỏ, kính…)
   *   5. Cập nhật và vẽ particles trên secretCanvas
   *   6. Vẽ secret draw functions
   */
  function renderLoop(timestamp = 0) {
    if (!isRunning) return;
    rafId = requestAnimationFrame(renderLoop);

    // 1. Đồng bộ kích thước
    syncSize();

    const W = canvasEl.width;
    const H = canvasEl.height;

    // Xóa canvas chính và canvas bí mật
    ctx.clearRect(0, 0, W, H);
    secretCtx.clearRect(0, 0, W, H);

    // 2. Vẽ frame video thô lên canvas chính
    if (videoEl && videoEl.readyState >= 2) {
      // Lật ngang (mirror) để cảm giác nhìn vào gương
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(videoEl, -W, 0, W, H);
      ctx.restore();
    }

    // 3. Áp filter grayscale (nhíu mày bí mật)
    if (isGrayscale) {
      applyGrayscaleFilter();
    }

    // 4. Vẽ hiệu ứng AR menu (tai thỏ, kính…)
    if (arDrawFn && window._faceLandmarks) {
      arDrawFn(ctx, window._faceLandmarks, W, H);
    }

    // 5. Vẽ secret draw functions
    for (const fn of secretDrawFns) {
      fn(secretCtx, W, H, timestamp);
    }

    // 6. Cập nhật và vẽ particles
    updateParticles(secretCtx, W, H, timestamp);
  }

  // ===========================================================
  //  TIỆN ÍCH
  // ===========================================================

  /** Đồng bộ kích thước canvas với element để tránh blur. */
  function syncSize() {
    const rect = canvasEl.getBoundingClientRect();
    const dpr  = window.devicePixelRatio || 1;
    const newW = Math.round(rect.width  * dpr);
    const newH = Math.round(rect.height * dpr);

    if (canvasEl.width !== newW || canvasEl.height !== newH) {
      canvasEl.width  = newW;
      canvasEl.height = newH;
      ctx.scale(dpr, dpr);
    }
    // Cũng sync cho secret canvas
    if (secretCanvas.width !== newW || secretCanvas.height !== newH) {
      secretCanvas.width  = newW;
      secretCanvas.height = newH;
    }
  }

  /**
   * Áp grayscale lên canvas bằng cách đọc pixel data.
   * Đây là cách thuần JS, không dùng CSS filter để tương thích với overlay.
   */
  function applyGrayscaleFilter() {
    const W = canvasEl.width;
    const H = canvasEl.height;
    try {
      const imageData = ctx.getImageData(0, 0, W, H);
      const data = imageData.data;
      // Duyệt từng pixel (4 byte: R, G, B, A)
      for (let i = 0; i < data.length; i += 4) {
        // Công thức luminosity cho cảm giác tự nhiên hơn
        const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        data[i]     = gray;  // R
        data[i + 1] = gray;  // G
        data[i + 2] = gray;  // B
        // data[i + 3] = Alpha – giữ nguyên
      }
      ctx.putImageData(imageData, 0, 0);
    } catch (e) {
      // CORS hoặc lỗi khác – bỏ qua
    }
  }

  // ===========================================================
  //  HỆ THỐNG PARTICLE
  // ===========================================================

  /**
   * Thêm một burst (nhiều particle cùng lúc) vào hệ thống.
   * @param {Object} opts - Tùy chọn
   *   - type:  'image' | 'text'
   *   - src:   URL ảnh (nếu type='image')
   *   - text:  ký tự (nếu type='text')
   *   - count: số lượng particle
   *   - x, y:  vị trí xuất phát (0..1 – tỉ lệ với canvas)
   *   - scale: kích thước
   *   - lifetime: thời gian sống (ms)
   */
  function addParticleBurst(opts = {}) {
    const {
      type     = 'text',
      src      = null,
      text     = '💯',
      count    = 6,
      cx       = 0.5,  // x tâm (tỉ lệ 0..1)
      cy       = 0.7,  // y tâm (tỉ lệ 0..1)
      scale    = 1,
      lifetime = 1800, // ms
    } = opts;

    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
      const speed = 0.8 + Math.random() * 1.5;
      const p = {
        type,
        text,
        img:       type === 'image' && src ? loadImg(src) : null,
        x:         cx,
        y:         cy,
        vx:        Math.cos(angle) * speed * 0.015,
        vy:        Math.sin(angle) * speed * 0.015 - 0.02, // hướng lên
        scale:     (0.6 + Math.random() * 0.8) * scale,
        opacity:   1,
        rot:       Math.random() * Math.PI * 2,
        rotSpeed:  (Math.random() - 0.5) * 0.1,
        lifetime,
        age:       0,
        startTime: performance.now(),
      };
      particles.push(p);
    }
  }

  /**
   * Vẽ và cập nhật tất cả particles.
   */
  function updateParticles(sCtx, W, H, timestamp) {
    const now    = performance.now();
    const toKeep = [];

    for (const p of particles) {
      p.age = now - p.startTime;
      const progress = p.age / p.lifetime; // 0..1

      if (progress >= 1) continue; // hết tuổi thọ

      // Cập nhật vị trí
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.0003; // trọng lực nhẹ
      p.rot += p.rotSpeed;
      p.opacity = 1 - Math.pow(progress, 1.5);

      // Vẽ
      sCtx.save();
      sCtx.globalAlpha = p.opacity;
      sCtx.translate(p.x * W, p.y * H);
      sCtx.rotate(p.rot);

      if (p.type === 'text') {
        const fontSize = Math.round(32 * p.scale);
        sCtx.font = `${fontSize}px serif`;
        sCtx.textAlign = 'center';
        sCtx.textBaseline = 'middle';
        sCtx.fillText(p.text, 0, 0);
      } else if (p.type === 'image' && p.img && p.img.complete) {
        const size = Math.round(60 * p.scale);
        sCtx.drawImage(p.img, -size / 2, -size / 2, size, size);
      }

      sCtx.restore();
      toKeep.push(p);
    }

    // Xóa particles đã hết
    particles.length = 0;
    particles.push(...toKeep);
  }

  /**
   * Cache ảnh đã load để không tải lại.
   */
  const imgCache = {};
  function loadImg(src) {
    if (imgCache[src]) return imgCache[src];
    const img = new Image();
    img.src = src;
    imgCache[src] = img;
    return img;
  }

  // ===========================================================
  //  HIỆU ỨNG MÀN HÌNH OVERLAY (vẽ ảnh meme toàn khung)
  // ===========================================================

  /** Các overlay tạm thời đang hiển thị trên secret canvas. */
  const overlayItems = [];

  /**
   * Thêm ảnh overlay tạm thời lên secret canvas.
   * @param {string} memeKey - Key trong memeImages
   * @param {number} duration - Thời gian hiển thị (ms)
   * @param {Object} opts - { alpha, x, y, w, h } (tỉ lệ 0..1)
   */
  function showMemeOverlay(memeKey, duration = 2000, opts = {}) {
    const img = memeImages[memeKey];
    if (!img || !img.complete) {
      // Ảnh chưa load – thử lại sau 200ms
      setTimeout(() => showMemeOverlay(memeKey, duration, opts), 200);
      return;
    }

    const item = {
      img,
      startTime: performance.now(),
      duration,
      alpha:     opts.alpha ?? 0.92,
      // Vị trí và kích thước (tỉ lệ 0..1 so với canvas)
      cx: opts.cx ?? 0.5,
      cy: opts.cy ?? 0.5,
      w:  opts.w  ?? 0.85,
      h:  opts.h  ?? 0.85,
    };
    overlayItems.push(item);

    // Đăng ký hàm vẽ overlay này vào danh sách secret draw functions
    const drawFn = (sCtx, W, H) => {
      const now      = performance.now();
      const age      = now - item.startTime;
      const progress = age / item.duration;
      if (progress >= 1) return;

      // Fade in 15%, hiển thị, fade out 20% cuối
      let alpha = item.alpha;
      if (progress < 0.15) alpha *= progress / 0.15;
      else if (progress > 0.80) alpha *= (1 - progress) / 0.20;

      const imgW = W * item.w;
      const imgH = H * item.h;
      const imgX = W * item.cx - imgW / 2;
      const imgY = H * item.cy - imgH / 2;

      sCtx.save();
      sCtx.globalAlpha = alpha;

      // Bo góc ảnh meme
      roundedImage(sCtx, item.img, imgX, imgY, imgW, imgH, 16);

      sCtx.restore();
    };
    addSecretDrawFn(drawFn);

    // Tự xóa sau duration
    setTimeout(() => removeSecretDrawFn(drawFn), duration + 100);
  }

  /** Vẽ ảnh với bo góc. */
  function roundedImage(sCtx, img, x, y, w, h, r) {
    sCtx.beginPath();
    sCtx.moveTo(x + r, y);
    sCtx.lineTo(x + w - r, y);
    sCtx.quadraticCurveTo(x + w, y, x + w, y + r);
    sCtx.lineTo(x + w, y + h - r);
    sCtx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    sCtx.lineTo(x + r, y + h);
    sCtx.quadraticCurveTo(x, y + h, x, y + h - r);
    sCtx.lineTo(x, y + r);
    sCtx.quadraticCurveTo(x, y, x + r, y);
    sCtx.closePath();
    sCtx.clip();
    sCtx.drawImage(img, x, y, w, h);
  }

  // ===========================================================
  //  HIỆU ỨNG SPARKLE (lấp lánh khi cười)
  // ===========================================================

  let sparkleTimer = null;

  /**
   * Bắt đầu hiệu ứng sparkle liên tục.
   * Mỗi 120ms thêm một burst particle ngẫu nhiên.
   */
  function startSparkle(duration = 2500) {
    if (sparkleTimer) clearInterval(sparkleTimer);
    const endTime = Date.now() + duration;

    sparkleTimer = setInterval(() => {
      if (Date.now() > endTime) {
        clearInterval(sparkleTimer);
        sparkleTimer = null;
        return;
      }
      // Thêm particle hình ngôi sao lấp lánh ở vị trí ngẫu nhiên
      addParticleBurst({
        type:     'text',
        text:     ['✨', '⭐', '💫', '🌟'][Math.floor(Math.random() * 4)],
        count:    2,
        cx:       0.1 + Math.random() * 0.8,  // x ngẫu nhiên
        cy:       0.1 + Math.random() * 0.6,  // y ngẫu nhiên
        scale:    0.8 + Math.random() * 0.6,
        lifetime: 900,
      });
    }, 120);
  }

  // ===========================================================
  //  PUBLIC API
  // ===========================================================

  /** Đặt hàm vẽ AR effect (từ ar-effects.js). */
  function setARDrawFn(fn) { arDrawFn = fn; }

  /** Thêm hàm vẽ secret effect. */
  function addSecretDrawFn(fn) { secretDrawFns.push(fn); }

  /** Xóa hàm vẽ secret effect. */
  function removeSecretDrawFn(fn) {
    const idx = secretDrawFns.indexOf(fn);
    if (idx !== -1) secretDrawFns.splice(idx, 1);
  }

  /** Bật/tắt grayscale. */
  function setGrayscale(val) { isGrayscale = val; }

  /** Lấy ảnh meme theo key (dùng cho ar-effects). */
  function getMemeImage(key) { return memeImages[key]; }

  return {
    init,
    start,
    stop,
    setARDrawFn,
    addSecretDrawFn,
    removeSecretDrawFn,
    addParticleBurst,
    showMemeOverlay,
    startSparkle,
    setGrayscale,
    getMemeImage,
    get ctx()       { return ctx; },
    get secretCtx() { return secretCtx; },
    get canvas()    { return canvasEl; },
    get secretCanvas() { return secretCanvas; },
  };
})();

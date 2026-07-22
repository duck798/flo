/**
 * secret.js
 * ============================================================
 * HỆ THỐNG TÍNH NĂNG BÍ MẬT – Hoàn toàn ẩn, không có UI.
 *
 * Module này lắng nghe events từ MediaPipeModule và kích hoạt
 * các hiệu ứng overlay tương ứng thông qua Overlay module.
 * Không có bất kỳ nút, label hay dấu hiệu nào trên giao diện.
 *
 * ┌─────────────────────────────────────────────────────────┐
 * │  CỬ CHỈ           │  HIỆU ỨNG                           │
 * ├─────────────────────────────────────────────────────────┤
 * │  Nắm tay          │  Bông hoa hồng bay ra               │
 * │  Ngón trỏ lên môi │  Ảnh meme chó xanh + tắt mic       │
 * │  Há miệng to      │  Ảnh meme người hét + tăng gain mic │
 * │  Cười lớn         │  Sparkle lấp lánh + icon 💯 bay ra  │
 * │  Nhíu mày         │  Video đen trắng + icon loading      │
 * └─────────────────────────────────────────────────────────┘
 *
 * ⚠️ THAY LINK ẢNH MEME CÁ NHÂN:
 *   Tìm các comment "THAY ẢNH TẠI ĐÂY" trong file overlay.js
 *   và thay đường dẫn trong object preloadMemes().
 *   Hoặc dùng URL online: 'https://example.com/my-meme.png'
 * ============================================================
 */

const SecretSystem = (() => {

  // ─── Tham chiếu GainNode để điều chỉnh volume mic ─────────
  // Được set từ peer.js sau khi có stream
  let micGainNode  = null;
  let normalGain   = 1.0;   // gain mặc định
  let isMicMuted   = false; // trạng thái mute bí mật (khác nút mic thông thường)

  // ─── Trạng thái grayscale đang bật ────────────────────────
  let grayscaleActive = false;
  let grayscaleTimer  = null;

  // ─── Trạng thái loading icon đang hiển thị ───────────────
  let loadingIconEl = null;

  // ─── Cooldown tránh kích hoạt liên tục ────────────────────
  const effectCooldowns = {};

  // ===========================================================
  //  KHỞI TẠO
  // ===========================================================

  /**
   * Đăng ký tất cả event listeners từ MediaPipeModule.
   * Gọi sau khi MediaPipeModule đã init.
   */
  function init() {
    console.log('[Secret] Hệ thống bí mật đang chạy ngầm...');

    // ─── Nắm tay → Bông hoa hồng ─────────────────────────
    MediaPipeModule.on('fist', (data) => {
      triggerRoseBurst();
    });

    // ─── Ngón trỏ lên môi → Chó xanh + tắt mic ──────────
    MediaPipeModule.on('finger-on-lips', (data) => {
      triggerShhEffect();
    });

    // ─── Há miệng to → Người hét + tăng mic ──────────────
    MediaPipeModule.on('mouth-wide-open', (data) => {
      triggerScreamEffect(data.ratio);
    });

    // ─── Cười lớn → Sparkle + 💯 ─────────────────────────
    MediaPipeModule.on('big-smile', (data) => {
      triggerSmileEffect();
    });

    // ─── Nhíu mày → Đen trắng + loading ─────────────────
    MediaPipeModule.on('brow-furrow', (data) => {
      triggerThinkEffect();
    });
  }

  // ===========================================================
  //  COOLDOWN HELPER
  // ===========================================================

  /**
   * Kiểm tra và đặt cooldown cho một effect.
   * @param {string} name – tên effect
   * @param {number} ms   – thời gian cooldown (ms)
   * @returns {boolean} true nếu được phép chạy
   */
  function canActivate(name, ms) {
    const now = Date.now();
    if (effectCooldowns[name] && now - effectCooldowns[name] < ms) return false;
    effectCooldowns[name] = now;
    return true;
  }

  // ===========================================================
  //  HIỆU ỨNG 1: Nắm tay → Bông hoa hồng
  // ===========================================================

  /**
   * Kích hoạt hiệu ứng bông hoa hồng bay ra từ tâm màn hình.
   *
   * Dùng hệ thống particle của Overlay để tạo hiệu ứng ảnh bay.
   *
   * ⚠️ THAY ẢNH MEME TẠI ĐÂY:
   *   Mặc định dùng emoji 🌹 (không cần ảnh file).
   *   Nếu muốn dùng ảnh PNG: thay type='image' và src='assets/memes/rose.png'
   *   (đảm bảo đã thêm ảnh vào thư mục assets/memes/)
   */
  function triggerRoseBurst() {
    if (!canActivate('rose', 2500)) return;
    console.log('[Secret] 🌹 Nắm tay → Hoa hồng!');

    // Thêm nhiều particle hoa hồng bay ra tứ phía
    Overlay.addParticleBurst({
      type:     'text',
      text:     '🌹',       // ← THAY BẰNG 'image' NẾU DÙNG ẢNH FILE
      // type: 'image',     // ← bỏ comment dòng này nếu dùng ảnh
      // src:  'assets/memes/rose.png',  // ← đường dẫn ảnh của bạn
      count:    10,
      cx:       0.5,        // x tâm (giữa màn hình)
      cy:       0.65,       // y tâm (hơi thấp)
      scale:    1.2,
      lifetime: 2200,
    });

    // Thêm lượt 2 sau 300ms để tạo cảm giác dồn dập
    setTimeout(() => {
      Overlay.addParticleBurst({
        type:     'text',
        text:     '🌹',
        count:    6,
        cx:       0.3 + Math.random() * 0.4,
        cy:       0.5 + Math.random() * 0.3,
        scale:    0.9,
        lifetime: 1800,
      });
    }, 300);
  }

  // ===========================================================
  //  HIỆU ỨNG 2: Ngón trỏ lên môi → Chó xanh + Tắt mic
  // ===========================================================

  /**
   * Kích hoạt hiệu ứng "suỵt": hiện ảnh meme chó xanh và tắt mic.
   *
   * ⚠️ THAY ẢNH MEME TẠI ĐÂY:
   *   Đường dẫn ảnh meme chó xanh trong overlay.js → preloadMemes():
   *     blueDog: 'assets/memes/blue-dog.png'
   *   Thay đường dẫn này hoặc dùng URL CDN của ảnh cá nhân:
   *     blueDog: 'https://your-cdn.com/my-dog-meme.png'
   */
  function triggerShhEffect() {
    if (!canActivate('shh', 4000)) return;
    console.log('[Secret] 🤫 Suỵt → Chó xanh + tắt mic!');

    // 1. Hiển thị ảnh meme chó xanh toàn màn hình trong 3 giây
    //    'blueDog' là key trong preloadMemes() của overlay.js
    Overlay.showMemeOverlay('blueDog', 3000, {
      cx: 0.5,   // giữa màn hình
      cy: 0.5,
      w:  0.9,   // chiếm 90% chiều rộng
      h:  0.9,
    });

    // 2. Tắt mic trong 3 giây
    muteMicTemporarily(3000);
  }

  // ===========================================================
  //  HIỆU ỨNG 3: Há miệng to → Người hét + Tăng mic
  // ===========================================================

  /**
   * Kích hoạt hiệu ứng "hét": hiện meme người hét và tăng volume mic.
   *
   * ⚠️ THAY ẢNH MEME TẠI ĐÂY:
   *   Đường dẫn ảnh meme người hét trong overlay.js → preloadMemes():
   *     screamingMan: 'assets/memes/screaming-man.png'
   *   Thay bằng URL CDN hoặc đường dẫn ảnh cá nhân.
   *
   * @param {number} mouthRatio – độ há miệng (0..1)
   */
  function triggerScreamEffect(mouthRatio) {
    if (!canActivate('scream', 3500)) return;
    console.log('[Secret] 😱 Há miệng → Người hét + tăng mic!');

    // 1. Hiển thị ảnh meme người hét, giật nảy lên từ dưới
    Overlay.showMemeOverlay('screamingMan', 2500, {
      cx: 0.5,
      cy: 0.4,   // hơi cao hơn giữa
      w:  0.88,
      h:  0.88,
    });

    // 2. Tăng gain mic lên gấp đôi trong 2 giây
    boostMicTemporarily(2.5, 2500);

    // 3. Thêm hiệu ứng flash màn hình (nhấp nháy trắng)
    flashScreen();
  }

  // ===========================================================
  //  HIỆU ỨNG 4: Cười lớn → Sparkle + 💯
  // ===========================================================

  /**
   * Kích hoạt hiệu ứng lấp lánh và các icon 💯 bay ra.
   */
  function triggerSmileEffect() {
    if (!canActivate('smile', 3000)) return;
    console.log('[Secret] 😁 Cười lớn → Sparkle + 💯!');

    // 1. Bắt đầu hiệu ứng sparkle liên tục trong 2.5 giây
    Overlay.startSparkle(2500);

    // 2. Bắn ra các icon 💯
    Overlay.addParticleBurst({
      type:     'text',
      text:     '💯',
      count:    8,
      cx:       0.5,
      cy:       0.7,
      scale:    1.3,
      lifetime: 2500,
    });

    // 3. Thêm heart và fire sau 400ms
    setTimeout(() => {
      Overlay.addParticleBurst({
        type:     'text',
        text:     '🔥',
        count:    5,
        cx:       0.3,
        cy:       0.6,
        scale:    1.0,
        lifetime: 2000,
      });
      Overlay.addParticleBurst({
        type:     'text',
        text:     '❤️',
        count:    5,
        cx:       0.7,
        cy:       0.6,
        scale:    1.0,
        lifetime: 2000,
      });
    }, 400);
  }

  // ===========================================================
  //  HIỆU ỨNG 5: Nhíu mày → Đen trắng + Loading icon
  // ===========================================================

  /**
   * Bật chế độ đen trắng và hiện icon loading xoay trên đầu.
   * Hiệu ứng kéo dài 3.5 giây rồi tự tắt.
   */
  function triggerThinkEffect() {
    if (!canActivate('think', 4000)) return;
    console.log('[Secret] 🤔 Nhíu mày → Đen trắng + loading!');

    // 1. Bật filter đen trắng
    Overlay.setGrayscale(true);
    grayscaleActive = true;

    // 2. Thêm loading icon lên DOM (nằm trên local-video-container)
    showLoadingIcon();

    // 3. Tắt sau 3.5 giây
    clearTimeout(grayscaleTimer);
    grayscaleTimer = setTimeout(() => {
      Overlay.setGrayscale(false);
      grayscaleActive = false;
      hideLoadingIcon();
      console.log('[Secret] Đã tắt hiệu ứng nhíu mày');
    }, 3500);
  }

  // ─── Loading icon helpers ────────────────────────────────

  function showLoadingIcon() {
    hideLoadingIcon(); // xóa cái cũ nếu có

    loadingIconEl = document.createElement('div');
    loadingIconEl.className = 'secret-loading-icon';
    loadingIconEl.textContent = '⏳';
    loadingIconEl.setAttribute('aria-hidden', 'true'); // ẩn khỏi screen reader

    const container = document.getElementById('local-video-container');
    if (container) container.appendChild(loadingIconEl);
  }

  function hideLoadingIcon() {
    if (loadingIconEl) {
      loadingIconEl.remove();
      loadingIconEl = null;
    }
  }

  // ===========================================================
  //  ĐIỀU KHIỂN MIC BÍ MẬT
  // ===========================================================

  /**
   * Đặt GainNode để secret system có thể điều chỉnh volume.
   * Được gọi từ peer.js khi đã có AudioContext.
   * @param {GainNode} gainNode
   * @param {number} defaultGain
   */
  function setMicGain(gainNode, defaultGain = 1.0) {
    micGainNode = gainNode;
    normalGain  = defaultGain;
  }

  /**
   * Tắt mic tạm thời trong một khoảng thời gian.
   * @param {number} durationMs
   */
  function muteMicTemporarily(durationMs) {
    if (!micGainNode) return;
    if (isMicMuted) return; // đang tắt rồi

    isMicMuted = true;
    micGainNode.gain.setTargetAtTime(0, micGainNode.context.currentTime, 0.1);
    console.log('[Secret] Mic bị tắt bí mật');

    setTimeout(() => {
      if (!micGainNode) return;
      isMicMuted = false;
      micGainNode.gain.setTargetAtTime(normalGain, micGainNode.context.currentTime, 0.1);
      console.log('[Secret] Mic đã bật lại');
    }, durationMs);
  }

  /**
   * Tăng gain mic tạm thời.
   * @param {number} multiplier – hệ số tăng (ví dụ: 2.5)
   * @param {number} durationMs
   */
  function boostMicTemporarily(multiplier, durationMs) {
    if (!micGainNode || isMicMuted) return;

    const boostGain = normalGain * multiplier;
    micGainNode.gain.setTargetAtTime(boostGain, micGainNode.context.currentTime, 0.05);
    console.log(`[Secret] Mic tăng gain x${multiplier}`);

    setTimeout(() => {
      if (!micGainNode) return;
      micGainNode.gain.setTargetAtTime(normalGain, micGainNode.context.currentTime, 0.15);
      console.log('[Secret] Mic gain đã về bình thường');
    }, durationMs);
  }

  // ===========================================================
  //  HIỆU ỨNG PHỤ: Flash màn hình
  // ===========================================================

  /**
   * Tạo hiệu ứng nhấp nháy trắng ngắn trên màn hình local.
   * Dùng hàm vẽ tạm thời trên secret canvas.
   */
  function flashScreen() {
    let flashOpacity = 0.85;
    const startTime  = performance.now();
    const duration   = 350; // ms

    const drawFn = (sCtx, W, H, timestamp) => {
      const progress = (performance.now() - startTime) / duration;
      if (progress >= 1) {
        Overlay.removeSecretDrawFn(drawFn);
        return;
      }
      // Fade out nhanh
      const alpha = flashOpacity * (1 - progress);
      sCtx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      sCtx.fillRect(0, 0, W, H);
    };

    Overlay.addSecretDrawFn(drawFn);
  }

  // ===========================================================
  //  PUBLIC API
  // ===========================================================

  return {
    init,
    setMicGain,
    // Expose một số hàm cho debug (không hiển thị trong UI)
    _triggerRose:    () => triggerRoseBurst(),
    _triggerShh:     () => triggerShhEffect(),
    _triggerScream:  () => triggerScreamEffect(0.7),
    _triggerSmile:   () => triggerSmileEffect(),
    _triggerThink:   () => triggerThinkEffect(),
  };

})();

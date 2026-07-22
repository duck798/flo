/**
 * ar-effects.js
 * ============================================================
 * Module vẽ hiệu ứng AR menu công khai lên canvas local video.
 *
 * Các hiệu ứng:
 *  - none       : Không có
 *  - bunny-ears : Tai thỏ
 *  - sunglasses : Kính mát
 *  - mask       : Mặt nạ y tế
 *  - cat-ears   : Tai mèo
 *  - crown      : Vương miện
 *
 * Mỗi hiệu ứng nhận (ctx, faceLandmarks, canvasW, canvasH)
 * và vẽ lên ctx bằng Canvas 2D API.
 *
 * Ghi chú về tọa độ:
 *  - MediaPipe trả về tọa độ chuẩn hóa 0..1
 *  - Cần nhân với canvasW/canvasH để chuyển sang pixel
 *  - Video đã lật ngang (mirror), nên x phải được xử lý:
 *      pixelX = (1 - lm.x) * canvasW  (vì đã flip trong overlay.js)
 *    Nếu vẽ trực tiếp lên ctx đã flip, dùng lm.x * canvasW.
 *    Trong module này, ta vẽ AFTER ctx.scale(-1,1) đã được restore,
 *    nên dùng: pixelX = (1 - lm.x) * canvasW
 * ============================================================
 */

const AREffects = (() => {

  // ─── Hiệu ứng hiện tại ────────────────────────────────────
  let currentEffect = 'none';

  // ─── Cache ảnh hiệu ứng (preload để tránh lag) ────────────
  // Các ảnh được vẽ bằng Canvas Path (vector) nên không cần file ảnh.
  // Tuy nhiên nếu muốn dùng ảnh PNG thực:
  // ⚠️ THAY LINK ẢNH HIỆU ỨNG TẠI ĐÂY ⚠️
  const effectImages = {};

  // ===========================================================
  //  KHỞI TẠO
  // ===========================================================

  function init() {
    // Preload ảnh hiệu ứng nếu dùng ảnh file
    // Ví dụ: preloadImage('bunny-ears', 'assets/effects/bunny-ears.png');
    console.log('[AREffects] Đã khởi tạo');

    // Đăng ký hàm vẽ vào Overlay module
    Overlay.setARDrawFn(draw);
  }

  // ===========================================================
  //  HÀM VẼ CHÍNH (được gọi mỗi frame bởi Overlay)
  // ===========================================================

  /**
   * Vẽ hiệu ứng AR hiện tại lên canvas.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Array} landmarks – 468 face landmarks
   * @param {number} W – canvas width (pixel)
   * @param {number} H – canvas height (pixel)
   */
  function draw(ctx, landmarks, W, H) {
    if (!landmarks || currentEffect === 'none') return;

    // Hàm helper chuyển landmark sang pixel (có xử lý mirror)
    const px = (lm) => (1 - lm.x) * W;  // x đã lật ngang
    const py = (lm) => lm.y * H;

    switch (currentEffect) {
      case 'bunny-ears': drawBunnyEars(ctx, landmarks, px, py, W, H); break;
      case 'sunglasses': drawSunglasses(ctx, landmarks, px, py, W, H); break;
      case 'mask':       drawMask(ctx, landmarks, px, py, W, H); break;
      case 'cat-ears':   drawCatEars(ctx, landmarks, px, py, W, H); break;
      case 'crown':      drawCrown(ctx, landmarks, px, py, W, H); break;
    }
  }

  // ===========================================================
  //  HIỆU ỨNG: TAI THỎ
  // ===========================================================

  /**
   * Vẽ tai thỏ phía trên đầu.
   *
   * Landmarks tham chiếu:
   *  - 10:  đỉnh trán (giữa)
   *  - 234: thái dương trái
   *  - 454: thái dương phải
   */
  function drawBunnyEars(ctx, lm, px, py, W, H) {
    const topHead    = lm[10];
    const leftTemple = lm[234];
    const rightTemple= lm[454];
    if (!topHead || !leftTemple || !rightTemple) return;

    // Tâm đầu theo X
    const headCenterX = px(topHead);
    const headTopY    = py(topHead);

    // Khoảng cách giữa 2 thái dương → xác định kích thước tai
    const faceW = Math.abs(px(rightTemple) - px(leftTemple));
    const earW  = faceW * 0.18;  // độ rộng tai
    const earH  = faceW * 0.55;  // độ cao tai

    // Offset tai trái và phải so với tâm đầu
    const offsetX = faceW * 0.22;

    ctx.save();

    // ─── Vẽ tai trái ────────────────────────────────────────
    drawSingleBunnyEar(ctx, headCenterX - offsetX, headTopY, earW, earH, 'left');

    // ─── Vẽ tai phải ────────────────────────────────────────
    drawSingleBunnyEar(ctx, headCenterX + offsetX, headTopY, earW, earH, 'right');

    ctx.restore();
  }

  function drawSingleBunnyEar(ctx, tipX, baseY, earW, earH, side) {
    // Tai thỏ: hình elip dài đứng với màu hồng
    const tiltDir = side === 'left' ? -1 : 1;

    ctx.save();
    ctx.translate(tipX, baseY - earH * 0.3); // dịch lên trên đầu
    ctx.rotate(tiltDir * 0.15);              // nghiêng nhẹ ra ngoài

    // Phần ngoài tai (trắng)
    ctx.beginPath();
    ctx.ellipse(0, 0, earW * 0.5, earH * 0.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Phần trong tai (hồng nhạt)
    ctx.beginPath();
    ctx.ellipse(0, 0, earW * 0.28, earH * 0.38, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 182, 193, 0.88)';
    ctx.fill();

    ctx.restore();
  }

  // ===========================================================
  //  HIỆU ỨNG: KÍNH MÁT
  // ===========================================================

  /**
   * Vẽ kính mát theo đường lông mày và mắt.
   *
   * Landmarks tham chiếu:
   *  - 33:  khóe mắt trái (gần mũi)
   *  - 133: khóe mắt trái (ngoài)
   *  - 362: khóe mắt phải (gần mũi)
   *  - 263: khóe mắt phải (ngoài)
   *  - 168: điểm giữa 2 mắt (mũi)
   */
  function drawSunglasses(ctx, lm, px, py, W, H) {
    // Landmark mắt trái (từ góc nhìn người xem, đã mirror nên trái ↔ phải)
    const llInner = lm[133]; // mắt trái, khóe trong
    const llOuter = lm[33];  // mắt trái, khóe ngoài
    const rlInner = lm[362]; // mắt phải, khóe trong
    const rlOuter = lm[263]; // mắt phải, khóe ngoài
    const noseBridge = lm[168];

    if (!llInner || !llOuter || !rlInner || !rlOuter) return;

    // Tọa độ pixel
    const llIx = px(llInner), llIy = py(llInner);
    const llOx = px(llOuter), llOy = py(llOuter);
    const rlIx = px(rlInner), rlIy = py(rlInner);
    const rlOx = px(rlOuter), rlOy = py(rlOuter);

    // Kích thước lens
    const lensW = Math.abs(llIx - llOx) * 1.2;
    const lensH = lensW * 0.65;

    const lCenterX = (llIx + llOx) / 2;
    const lCenterY = (llIy + llOy) / 2;
    const rCenterX = (rlIx + rlOx) / 2;
    const rCenterY = (rlIy + rlOy) / 2;

    ctx.save();

    // Kiểu kính mát: tối với viền vàng
    const lensColor = 'rgba(10, 10, 30, 0.82)';
    const frameColor = '#FFD700';

    // ─── Lens trái ─────────────────────────────────────────
    drawLens(ctx, lCenterX, lCenterY, lensW, lensH, lensColor, frameColor, 4);

    // ─── Lens phải ─────────────────────────────────────────
    drawLens(ctx, rCenterX, rCenterY, lensW, lensH, lensColor, frameColor, 4);

    // ─── Gọng nối giữa 2 lens ──────────────────────────────
    ctx.beginPath();
    ctx.moveTo(lCenterX + lensW / 2, lCenterY);
    ctx.lineTo(rCenterX - lensW / 2, rCenterY);
    ctx.strokeStyle = frameColor;
    ctx.lineWidth = 3;
    ctx.stroke();

    // ─── Gọng 2 bên (đến thái dương) ──────────────────────
    const leftTemple = lm[234];
    const rightTemple= lm[454];
    if (leftTemple && rightTemple) {
      ctx.beginPath();
      ctx.moveTo(lCenterX - lensW / 2, lCenterY);
      ctx.lineTo(px(leftTemple), py(leftTemple));
      ctx.strokeStyle = frameColor;
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(rCenterX + lensW / 2, rCenterY);
      ctx.lineTo(px(rightTemple), py(rightTemple));
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawLens(ctx, cx, cy, w, h, fillColor, strokeColor, lineW) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineW;
    ctx.stroke();
  }

  // ===========================================================
  //  HIỆU ỨNG: MẶT NẠ
  // ===========================================================

  /**
   * Vẽ mặt nạ y tế che vùng miệng và mũi.
   *
   * Landmarks tham chiếu:
   *  - 234: thái dương trái
   *  - 454: thái dương phải
   *  - 6:   sống mũi (điểm đầu mũi)
   *  - 152: cằm
   */
  function drawMask(ctx, lm, px, py, W, H) {
    const leftCheek  = lm[234];
    const rightCheek = lm[454];
    const noseTip    = lm[4];    // đầu mũi
    const chin       = lm[152];

    if (!leftCheek || !rightCheek || !noseTip || !chin) return;

    const x1 = px(leftCheek);
    const x2 = px(rightCheek);
    const y1 = py(noseTip) - (py(chin) - py(noseTip)) * 0.15;
    const y2 = py(chin) + (py(chin) - py(noseTip)) * 0.1;

    ctx.save();

    // Nền mặt nạ (trắng)
    ctx.beginPath();
    ctx.roundRect(
      Math.min(x1, x2),
      y1,
      Math.abs(x2 - x1),
      y2 - y1,
      [8, 8, 16, 16]
    );
    ctx.fillStyle = 'rgba(240, 245, 255, 0.93)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(180, 190, 210, 0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Các đường nếp gấp ngang mặt nạ
    const maskX     = Math.min(x1, x2);
    const maskW     = Math.abs(x2 - x1);
    const maskMidY  = (y1 + y2) / 2;
    for (const yOffset of [-0.15, 0, 0.15]) {
      const lineY = maskMidY + (y2 - y1) * yOffset;
      ctx.beginPath();
      ctx.moveTo(maskX + 4, lineY);
      ctx.lineTo(maskX + maskW - 4, lineY);
      ctx.strokeStyle = 'rgba(160, 175, 200, 0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Logo hình chữ thập nhỏ
    const crossX = maskX + maskW / 2;
    const crossY = (y1 + maskMidY) / 2;
    const crossSize = Math.min(maskW, y2 - y1) * 0.08;
    ctx.fillStyle = 'rgba(220, 80, 80, 0.7)';
    ctx.fillRect(crossX - crossSize / 4, crossY - crossSize / 2, crossSize / 2, crossSize);
    ctx.fillRect(crossX - crossSize / 2, crossY - crossSize / 4, crossSize, crossSize / 2);

    ctx.restore();
  }

  // ===========================================================
  //  HIỆU ỨNG: TAI MÈO
  // ===========================================================

  /**
   * Vẽ tai mèo tam giác phía trên đầu.
   */
  function drawCatEars(ctx, lm, px, py, W, H) {
    const topHead    = lm[10];
    const leftTemple = lm[234];
    const rightTemple= lm[454];
    if (!topHead || !leftTemple || !rightTemple) return;

    const faceW     = Math.abs(px(rightTemple) - px(leftTemple));
    const headTopY  = py(topHead);
    const headCenterX = px(topHead);
    const earH      = faceW * 0.38;
    const earBaseW  = faceW * 0.2;
    const offsetX   = faceW * 0.2;

    ctx.save();

    // ─── Tai trái ───────────────────────────────────────────
    drawTriangleEar(ctx,
      headCenterX - offsetX - earBaseW / 2, headTopY,      // đáy trái
      headCenterX - offsetX + earBaseW / 2, headTopY,      // đáy phải
      headCenterX - offsetX, headTopY - earH,               // đỉnh
      '#2a2a2a', 'rgba(255, 120, 160, 0.8)'
    );

    // ─── Tai phải ───────────────────────────────────────────
    drawTriangleEar(ctx,
      headCenterX + offsetX - earBaseW / 2, headTopY,
      headCenterX + offsetX + earBaseW / 2, headTopY,
      headCenterX + offsetX, headTopY - earH,
      '#2a2a2a', 'rgba(255, 120, 160, 0.8)'
    );

    ctx.restore();
  }

  function drawTriangleEar(ctx, x1, y1, x2, y2, x3, y3, outerColor, innerColor) {
    // Tai ngoài
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.closePath();
    ctx.fillStyle = outerColor;
    ctx.fill();

    // Tai trong (hồng nhỏ hơn)
    const cx = (x1 + x2 + x3) / 3;
    const cy = (y1 + y2 + y3) / 3;
    const scale = 0.5;
    ctx.beginPath();
    ctx.moveTo(cx + (x1 - cx) * scale, cy + (y1 - cy) * scale);
    ctx.lineTo(cx + (x2 - cx) * scale, cy + (y2 - cy) * scale);
    ctx.lineTo(cx + (x3 - cx) * scale, cy + (y3 - cy) * scale);
    ctx.closePath();
    ctx.fillStyle = innerColor;
    ctx.fill();
  }

  // ===========================================================
  //  HIỆU ỨNG: VƯƠNG MIỆN
  // ===========================================================

  /**
   * Vẽ vương miện vàng lấp lánh phía trên đầu.
   */
  function drawCrown(ctx, lm, px, py, W, H) {
    const topHead    = lm[10];
    const leftTemple = lm[234];
    const rightTemple= lm[454];
    if (!topHead || !leftTemple || !rightTemple) return;

    const faceW     = Math.abs(px(rightTemple) - px(leftTemple));
    const headTopY  = py(topHead);
    const headCenterX = px(topHead);
    const crownW    = faceW * 1.1;
    const crownH    = faceW * 0.4;
    const startX    = headCenterX - crownW / 2;

    ctx.save();

    // Gradient vàng
    const grad = ctx.createLinearGradient(startX, headTopY - crownH, startX, headTopY);
    grad.addColorStop(0, '#FFE566');
    grad.addColorStop(0.5, '#FFD700');
    grad.addColorStop(1, '#B8860B');

    // Hình dạng vương miện: hình chữ nhật với 3 đỉnh nhọn
    ctx.beginPath();
    // Đáy trái
    ctx.moveTo(startX, headTopY);
    // Đỉnh nhọn trái
    ctx.lineTo(startX + crownW * 0.05, headTopY - crownH * 0.5);
    ctx.lineTo(startX + crownW * 0.2, headTopY - crownH * 0.8);
    ctx.lineTo(startX + crownW * 0.35, headTopY - crownH * 0.3);
    // Đỉnh nhọn giữa (cao nhất)
    ctx.lineTo(startX + crownW * 0.5, headTopY - crownH);
    ctx.lineTo(startX + crownW * 0.65, headTopY - crownH * 0.3);
    // Đỉnh nhọn phải
    ctx.lineTo(startX + crownW * 0.80, headTopY - crownH * 0.8);
    ctx.lineTo(startX + crownW * 0.95, headTopY - crownH * 0.5);
    // Đáy phải
    ctx.lineTo(startX + crownW, headTopY);
    ctx.closePath();

    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = '#B8860B';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Thêm đá quý (tròn đỏ)
    const gemPositions = [0.2, 0.5, 0.8];
    for (const xRatio of gemPositions) {
      const gemX = startX + crownW * xRatio;
      const gemY = headTopY - crownH * 0.15;
      ctx.beginPath();
      ctx.arc(gemX, gemY, crownH * 0.1, 0, Math.PI * 2);
      ctx.fillStyle = xRatio === 0.5 ? '#FF3366' : '#00CCFF';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    ctx.restore();
  }

  // ===========================================================
  //  PUBLIC API
  // ===========================================================

  /**
   * Đặt hiệu ứng hiện tại.
   * @param {string} effectName – 'none' | 'bunny-ears' | 'sunglasses' | 'mask' | 'cat-ears' | 'crown'
   */
  function setEffect(effectName) {
    currentEffect = effectName;
    console.log(`[AREffects] Đã đặt hiệu ứng: ${effectName}`);
  }

  function getCurrentEffect() { return currentEffect; }

  return {
    init,
    draw,
    setEffect,
    getCurrentEffect,
  };

})();

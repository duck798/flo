/**
 * mediapipe.js
 * ============================================================
 * Module khởi tạo và xử lý MediaPipe FaceMesh + Hands.
 *
 * Chức năng:
 *  - Chạy FaceMesh để lấy 468 facial landmarks
 *  - Chạy Hands để lấy 21 hand landmarks
 *  - Tính toán các chỉ số biểu cảm khuôn mặt:
 *      • mouthOpenRatio  – độ há miệng (0..1)
 *      • smileRatio      – độ cười (0..1)
 *      • browFurrowScore – mức nhíu mày (0..1)
 *  - Tính toán các chỉ số cử chỉ tay:
 *      • isFist           – nắm đấm
 *      • isFingerOnLips   – ngón trỏ chạm môi (suỵt)
 *  - Phát events qua EventEmitter đơn giản cho secret.js
 *  - Lưu landmarks vào window._faceLandmarks để ar-effects.js dùng
 * ============================================================
 */

const MediaPipeModule = (() => {

  // ─── Tham chiếu đến video nguồn ───────────────────────────
  let sourceVideo = null;

  // ─── MediaPipe instances ───────────────────────────────────
  let faceMesh = null;
  let hands    = null;
  let camera   = null;

  // ─── Camera Utils instance ────────────────────────────────
  // Dùng để feed frame từ video vào MediaPipe

  // ─── Kết quả xử lý mới nhất ───────────────────────────────
  let latestFaceLandmarks = null;
  let latestHandLandmarks = null;
  let latestHandedness    = null;

  // ─── EventEmitter nội bộ ──────────────────────────────────
  const listeners = {};

  function on(event, callback) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(callback);
  }

  function emit(event, data) {
    if (listeners[event]) {
      listeners[event].forEach(cb => cb(data));
    }
  }

  // ─── Throttle để không phát event quá nhiều ───────────────
  const eventCooldowns = {};
  function emitThrottled(event, data, cooldownMs = 500) {
    const now = Date.now();
    if (!eventCooldowns[event] || now - eventCooldowns[event] > cooldownMs) {
      eventCooldowns[event] = now;
      emit(event, data);
    }
  }

  // ===========================================================
  //  KHỞI TẠO MEDIAPIPE
  // ===========================================================

  /**
   * Khởi tạo FaceMesh và Hands, sau đó bắt đầu xử lý camera.
   * @param {HTMLVideoElement} videoElement – video nguồn camera thô
   */
  async function init(videoElement) {
    sourceVideo = videoElement;
    console.log('[MediaPipe] Bắt đầu khởi tạo...');

    await initFaceMesh();
    await initHands();
    startCamera();

    console.log('[MediaPipe] Khởi tạo hoàn tất');
  }

  // ─── Khởi tạo FaceMesh ───────────────────────────────────

  function initFaceMesh() {
    return new Promise((resolve) => {
      faceMesh = new FaceMesh({
        locateFile: (file) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
      });

      faceMesh.setOptions({
        maxNumFaces:              1,      // Chỉ cần 1 khuôn mặt
        refineLandmarks:          true,   // Bật refinement cho mắt và môi
        minDetectionConfidence:   0.6,
        minTrackingConfidence:    0.5,
      });

      faceMesh.onResults((results) => {
        onFaceMeshResults(results);
        resolve(); // resolve lần đầu tiên có kết quả
      });

      // Gọi send một lần rỗng để trigger load model
      faceMesh.send({ image: document.createElement('canvas') })
        .then(resolve)
        .catch(resolve); // bỏ qua lỗi frame rỗng
    });
  }

  // ─── Khởi tạo Hands ──────────────────────────────────────

  function initHands() {
    return new Promise((resolve) => {
      hands = new Hands({
        locateFile: (file) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
      });

      hands.setOptions({
        maxNumHands:              1,      // Chỉ cần 1 tay
        modelComplexity:          1,
        minDetectionConfidence:   0.7,
        minTrackingConfidence:    0.6,
      });

      hands.onResults((results) => {
        onHandResults(results);
        resolve();
      });

      hands.send({ image: document.createElement('canvas') })
        .then(resolve)
        .catch(resolve);
    });
  }

  // ─── Bắt đầu Camera Utils ────────────────────────────────

  function startCamera() {
    camera = new Camera(sourceVideo, {
      onFrame: async () => {
        // Feed frame từ camera vào cả hai model
        // Dùng Promise.allSettled để không bị dừng nếu một model lỗi
        await Promise.allSettled([
          faceMesh?.send({ image: sourceVideo }),
          hands?.send({ image: sourceVideo }),
        ]);
      },
      width:  640,
      height: 480,
    });
    camera.start();
    console.log('[MediaPipe] Camera Utils đã bắt đầu');
  }

  // ===========================================================
  //  XỬ LÝ KẾT QUẢ FACEMESH
  // ===========================================================

  /**
   * Callback khi FaceMesh có kết quả mới.
   * Tính toán các chỉ số biểu cảm và phát events.
   */
  function onFaceMeshResults(results) {
    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      latestFaceLandmarks = null;
      window._faceLandmarks = null;
      return;
    }

    // Lấy landmarks của khuôn mặt đầu tiên (mảng 468 điểm)
    const landmarks = results.multiFaceLandmarks[0];
    latestFaceLandmarks = landmarks;
    // Lưu ra global để ar-effects.js có thể đọc
    window._faceLandmarks = landmarks;

    // ─── Tính toán các chỉ số ───────────────────────────────

    // 1. Độ há miệng (mouthOpenRatio)
    //    Dùng landmark: 13 (môi trên giữa), 14 (môi dưới giữa)
    //    So sánh với khoảng cách ngang mặt để chuẩn hóa
    const mouthOpenRatio  = calcMouthOpenRatio(landmarks);

    // 2. Độ cười (smileRatio)
    //    Dùng góc mép môi so với chiều rộng mặt
    const smileRatio      = calcSmileRatio(landmarks);

    // 3. Nhíu mày (browFurrowScore)
    //    Dùng khoảng cách lông mày so với mắt
    const browFurrowScore = calcBrowFurrowScore(landmarks);

    // ─── Phát events ────────────────────────────────────────

    // Há miệng hết cỡ (ngưỡng > 0.55)
    if (mouthOpenRatio > 0.55) {
      emitThrottled('mouth-wide-open', { ratio: mouthOpenRatio }, 2000);
    }

    // Cười lớn (smileRatio cao + mouthOpenRatio vừa phải)
    if (smileRatio > 0.72 && mouthOpenRatio > 0.1) {
      emitThrottled('big-smile', { smile: smileRatio, mouth: mouthOpenRatio }, 3000);
    }

    // Nhíu mày suy tư (browFurrowScore > 0.6)
    if (browFurrowScore > 0.6) {
      emitThrottled('brow-furrow', { score: browFurrowScore }, 2000);
    }

    // Emit raw data để debug hoặc extension sau này
    emit('face-data', { mouthOpenRatio, smileRatio, browFurrowScore, landmarks });

    // Kiểm tra cử chỉ "ngón trỏ lên môi" (suỵt) cần kết hợp face + hand
    checkFingerOnLips(landmarks);
  }

  // ─── Tính toán Mouth Open Ratio ──────────────────────────
  /**
   * Tính độ há miệng bằng cách so sánh khoảng cách dọc giữa 2 môi
   * với khoảng cách ngang giữa 2 khóe miệng.
   *
   * Landmarks (FaceMesh 468 + refine):
   *   - 13: môi trên giữa (trong)
   *   - 14: môi dưới giữa (trong)
   *   - 78: góc trái miệng
   *   - 308: góc phải miệng
   */
  function calcMouthOpenRatio(lm) {
    const upperLip  = lm[13];
    const lowerLip  = lm[14];
    const leftMouth = lm[78];
    const rightMouth= lm[308];

    if (!upperLip || !lowerLip || !leftMouth || !rightMouth) return 0;

    // Khoảng cách dọc giữa 2 môi (theo trục Y)
    const vertDist = Math.abs(lowerLip.y - upperLip.y);

    // Khoảng cách ngang miệng (chuẩn hóa)
    const horizDist = Math.abs(rightMouth.x - leftMouth.x);
    if (horizDist < 0.001) return 0;

    return Math.min(vertDist / horizDist, 1);
  }

  // ─── Tính toán Smile Ratio ───────────────────────────────
  /**
   * Tính độ cười dựa trên độ "cong lên" của khóe miệng so với trung điểm môi.
   *
   * Landmarks:
   *   - 61:  khóe miệng trái
   *   - 291: khóe miệng phải
   *   - 0:   điểm giữa môi trên (ngoài)
   *   - 17:  điểm giữa môi dưới (ngoài)
   *   - 13:  môi trên (trong)
   */
  function calcSmileRatio(lm) {
    const leftCorner  = lm[61];
    const rightCorner = lm[291];
    const upperMid    = lm[0];
    const lowerMid    = lm[17];

    if (!leftCorner || !rightCorner || !upperMid || !lowerMid) return 0;

    // Tính trung điểm của miệng theo Y
    const mouthMidY = (upperMid.y + lowerMid.y) / 2;

    // Khi cười, khóe miệng nâng lên (Y giảm trong tọa độ ảnh)
    // SmileRatio = mức độ 2 khóe miệng cao hơn trung tâm miệng
    const leftLift  = mouthMidY - leftCorner.y;
    const rightLift = mouthMidY - rightCorner.y;
    const avgLift   = (leftLift + rightLift) / 2;

    // Chuẩn hóa theo chiều rộng mặt
    const faceWidth = Math.abs(rightCorner.x - leftCorner.x);
    if (faceWidth < 0.001) return 0;

    // Chuẩn hóa: avgLift / faceWidth * normFactor
    return Math.min(Math.max(avgLift / faceWidth * 4, 0), 1);
  }

  // ─── Tính toán Brow Furrow Score ─────────────────────────
  /**
   * Tính mức nhíu mày bằng cách đo khoảng cách giữa 2 cung lông mày
   * tại điểm giữa (điểm gần nhau nhất khi nhíu).
   *
   * Landmarks (vùng lông mày):
   *   - 107: lông mày trái, điểm trong
   *   - 336: lông mày phải, điểm trong
   *   - 70:  lông mày trái, điểm ngoài
   *   - 300: lông mày phải, điểm ngoài
   */
  function calcBrowFurrowScore(lm) {
    const leftBrowInner  = lm[107];
    const rightBrowInner = lm[336];
    const leftBrowOuter  = lm[70];
    const rightBrowOuter = lm[300];

    if (!leftBrowInner || !rightBrowInner) return 0;

    // Khoảng cách ngang giữa 2 điểm lông mày phía trong
    const innerDist = Math.abs(rightBrowInner.x - leftBrowInner.x);

    // Khoảng cách ngang giữa 2 điểm lông mày phía ngoài (để chuẩn hóa)
    const outerDist = leftBrowOuter && rightBrowOuter
      ? Math.abs(rightBrowOuter.x - leftBrowOuter.x)
      : 0.2;

    if (outerDist < 0.001) return 0;

    // Khi nhíu mày, innerDist giảm so với outerDist
    // furrow = 1 - (innerDist / outerDist), chuẩn hóa
    const ratio = innerDist / outerDist;
    // Nếu ratio < 0.4 → nhíu mày mạnh, ratio > 0.7 → bình thường
    const score = Math.min(Math.max((0.7 - ratio) / 0.3, 0), 1);
    return score;
  }

  // ===========================================================
  //  XỬ LÝ KẾT QUẢ HANDS
  // ===========================================================

  /**
   * Callback khi Hands có kết quả mới.
   * Tính toán: nắm đấm, ngón tay đưa lên.
   */
  function onHandResults(results) {
    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      latestHandLandmarks = null;
      latestHandedness    = null;
      return;
    }

    latestHandLandmarks = results.multiHandLandmarks[0];
    latestHandedness    = results.multiHandedness?.[0]?.label ?? 'Right';

    // ─── Tính toán cử chỉ ───────────────────────────────────

    // 1. Nắm đấm (isFist)
    const fistScore = calcFistScore(latestHandLandmarks);
    if (fistScore > 0.75) {
      emitThrottled('fist', { score: fistScore }, 2500);
    }

    // Emit raw hand data
    emit('hand-data', { landmarks: latestHandLandmarks, handedness: latestHandedness, fistScore });
  }

  // ─── Tính toán Fist Score ────────────────────────────────
  /**
   * Tính mức độ "nắm đấm" bằng cách kiểm tra xem các ngón tay
   * có bị gập vào lòng bàn tay hay không.
   *
   * Tất cả các ngón (trừ ngón cái) nếu đầu ngón (tip) thấp hơn
   * khớp giữa (pip) → ngón đó bị gập.
   *
   * Landmarks (Hands 21 điểm):
   *   Ngón trỏ:  5(mcp), 6(pip), 7(dip), 8(tip)
   *   Ngón giữa: 9(mcp), 10(pip), 11(dip), 12(tip)
   *   Ngón áp út:13(mcp), 14(pip), 15(dip), 16(tip)
   *   Ngón út:   17(mcp), 18(pip), 19(dip), 20(tip)
   */
  function calcFistScore(lm) {
    if (!lm || lm.length < 21) return 0;

    // Các cặp [pip, tip] của 4 ngón (không tính ngón cái)
    const fingerPairs = [
      [6, 8],   // ngón trỏ:  pip → tip
      [10, 12], // ngón giữa
      [14, 16], // ngón áp út
      [18, 20], // ngón út
    ];

    let foldedCount = 0;
    for (const [pip, tip] of fingerPairs) {
      // Trong tọa độ chuẩn hóa của MediaPipe:
      // Y tăng từ trên xuống dưới
      // Khi ngón tay gập: tip.y > pip.y (tip ở dưới pip)
      if (lm[tip].y > lm[pip].y) foldedCount++;
    }

    return foldedCount / 4; // 0..1
  }

  // ===========================================================
  //  KIỂM TRA CỬ CHỈ KẾT HỢP: Ngón trỏ lên môi (suỵt)
  // ===========================================================

  /**
   * Kiểm tra xem ngón trỏ có đang đưa lên trước môi không.
   * Cần cả face landmarks (vị trí môi) và hand landmarks (ngón trỏ).
   *
   * Điều kiện:
   *  1. Ngón trỏ đang thẳng (không gập) → tip.y < pip.y
   *  2. Các ngón khác gập lại (nắm nhẹ)
   *  3. Đầu ngón trỏ (tip) gần vùng miệng trên khuôn mặt
   *
   * @param {Array} faceLM – Face landmarks
   */
  function checkFingerOnLips(faceLM) {
    if (!latestHandLandmarks) return;
    const handLM = latestHandLandmarks;

    // 1. Ngón trỏ có thẳng không? (tip.y < pip.y)
    const indexTip  = handLM[8];
    const indexPip  = handLM[6];
    const isIndexUp = indexTip.y < indexPip.y;

    // 2. Các ngón còn lại có gập không?
    const otherFolded = [
      handLM[12].y > handLM[10].y, // ngón giữa
      handLM[16].y > handLM[14].y, // ngón áp út
      handLM[20].y > handLM[18].y, // ngón út
    ].filter(Boolean).length >= 2; // ít nhất 2 ngón gập

    // 3. Đầu ngón trỏ có gần môi không?
    //    Môi dùng landmark 13 (môi trên giữa)
    const upperLip = faceLM[13];
    if (!upperLip) return;

    // Khoảng cách giữa đầu ngón trỏ và điểm môi trên
    // Tọa độ đã chuẩn hóa 0..1
    const dx = Math.abs(indexTip.x - (1 - upperLip.x)); // hand mirror vs face
    const dy = Math.abs(indexTip.y - upperLip.y);
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Ngưỡng gần miệng: < 0.15 (15% chiều rộng/cao frame)
    const isNearLips = dist < 0.18;

    if (isIndexUp && otherFolded && isNearLips) {
      emitThrottled('finger-on-lips', { dist }, 3000);
    }
  }

  // ===========================================================
  //  PUBLIC API
  // ===========================================================

  return {
    init,
    on,
    get faceLandmarks() { return latestFaceLandmarks; },
    get handLandmarks() { return latestHandLandmarks; },
  };

})();

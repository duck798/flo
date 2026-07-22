/**
 * AuraMeet AR - Module AI & Xử lý Hình ảnh (AR Effects & Gestures Engine)
 * 
 * Module này chịu trách nhiệm:
 * 1. Khởi tạo MediaPipe Face Mesh và Hands để nhận diện khuôn mặt & tay.
 * 2. Theo dõi các tọa độ landmarks và tính toán góc quay, tỷ lệ khuôn mặt/tay.
 * 3. Phân tích cử chỉ để kích hoạt các bộ lọc ngụy trang (được chọn từ menu) 
 *    và các hiệu ứng kích hoạt bí mật chạy ngầm.
 * 4. Vẽ đè lên canvas cục bộ các hình ảnh meme, icon hoặc hiệu ứng động.
 */

// ==========================================
// 1. ĐỊNH NGHĨA LIÊN KẾT TÀI NGUYÊN (MEME & AR)
// Bạn có thể thay thế các URL dưới đây bằng link ảnh cá nhân của bạn.
// Nên sử dụng ảnh định dạng PNG có nền trong suốt (transparent).
// ==========================================
const MEME_ASSETS = {
  // --- Hiệu ứng AR Ngụy trang (Menu) ---
  rabbitEars: 'https://cdn-icons-png.flaticon.com/512/2613/2613768.png',  // Ảnh Tai thỏ hoạt hình
  catMask: 'https://cdn-icons-png.flaticon.com/512/3429/3429813.png',     // Ảnh Mặt nạ mèo (râu & mũi)
  sunglasses: 'https://cdn-icons-png.flaticon.com/512/263/263054.png',    // Ảnh Kính râm cực ngầu

  // --- Hiệu ứng Kích hoạt Bí mật (Secret Actions) ---
  roseFlower: './cat_rose.jpg',  // Hiện khi Nắm tay (Fist) -> Ảnh mèo cầm hoa hồng
  greenDog: './dog_shh.jpg',     // Meme Chó xanh hiện khi Suỵt (Finger on lips)
  screamingMan: './screaming_man.jpg', // Meme Người hét khi Mở miệng to + hét lớn
};

// Khởi tạo các đối tượng Image để tải trước tài nguyên (Preload)
const images = {};
Object.entries(MEME_ASSETS).forEach(([key, url]) => {
  images[key] = new Image();
  images[key].src = url;
  images[key].crossOrigin = 'anonymous'; // Tránh lỗi bảo mật CORS khi vẽ lên Canvas
  images[key].onload = () => console.log(`[AI-AR] Đã tải xong tài nguyên: ${key}`);
  images[key].onerror = () => console.warn(`[AI-AR] Lỗi tải tài nguyên: ${key}. Sẽ dùng Emoji thay thế.`);
});

// ==========================================
// 2. BIẾN CẤU HÌNH & TRẠNG THÁI HỆ THỐNG
// ==========================================
const AR_STATE = {
  activeCamouflageEffect: 'none', // 'none' | 'rabbit' | 'cat' | 'glasses'
  backgroundBlurAmount: 0,        // 0 - 20px
  
  // Trạng thái cử chỉ bí mật đang được kích hoạt hay không
  gestures: {
    fistDetected: false,         // Nắm tay -> Hoa hồng
    shhDetected: false,          // Suỵt tay lên môi -> Chó xanh + Mute mic
    screamingDetected: false,    // Mở miệng to + Thét lớn -> Người hét
    smileDetected: false,        // Cười lớn -> Lấp lánh + 100
    thoughtDetected: false       // Nhíu mày -> Đen trắng + Loading
  },
  
  // Lưu tọa độ landmarks mới nhất để vẽ
  faceLandmarks: null,
  handLandmarks: null
};

// Biến quản lý các hạt hiệu ứng động (Sparkles & Emojis bay ra)
let particles = [];

// ==========================================
// 3. KHỞI TẠO MEDIAPIPE FACE MESH & HANDS
// ==========================================
let faceMeshInstance = null;
let handsInstance = null;

function initMediaPipe(onResultsCallback) {
  // Khởi tạo Face Mesh
  faceMeshInstance = new FaceMesh({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
  });
  
  faceMeshInstance.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true, // Tăng độ chính xác môi, mắt và lông mày
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  });
  
  faceMeshInstance.onResults((results) => {
    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
      AR_STATE.faceLandmarks = results.multiFaceLandmarks[0];
    } else {
      AR_STATE.faceLandmarks = null;
    }
    analyzeFaceGestures();
  });

  // Khởi tạo Hands
  handsInstance = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
  });
  
  handsInstance.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  });
  
  handsInstance.onResults((results) => {
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      AR_STATE.handLandmarks = results.multiHandLandmarks;
    } else {
      AR_STATE.handLandmarks = null;
    }
    analyzeHandGestures();
  });
}

// ==========================================
// 4. PHÂN TÍCH CỬ CHỈ GƯƠNG MẶT & ĐỒNG BỘ ÂM THANH
// ==========================================
function analyzeFaceGestures() {
  if (!AR_STATE.faceLandmarks) {
    AR_STATE.gestures.smileDetected = false;
    AR_STATE.gestures.screamingDetected = false;
    AR_STATE.gestures.thoughtDetected = false;
    return;
  }
  
  const landmarks = AR_STATE.faceLandmarks;
  
  // -- TÍNH TOÁN CÁC THÔNG SỐ KHUÔN MẶT CƠ BẢN --
  
  // 1. Khoảng cách hai mắt ngoài (dùng để chuẩn hóa khoảng cách xa/gần camera)
  const leftEyeOuter = landmarks[263];
  const rightEyeOuter = landmarks[33];
  const faceScale = Math.hypot(leftEyeOuter.x - rightEyeOuter.x, leftEyeOuter.y - rightEyeOuter.y);

  // 2. Miệng cười lớn (Smile Detection)
  // Góc miệng trái (61) và phải (291)
  const leftMouthCorner = landmarks[61];
  const rightMouthCorner = landmarks[291];
  const mouthWidth = Math.hypot(leftMouthCorner.x - rightMouthCorner.x, leftMouthCorner.y - rightMouthCorner.y);
  const smileRatio = mouthWidth / faceScale;
  
  // Ngưỡng phát hiện cười lớn (Smile Ratio lớn hơn ~0.78)
  AR_STATE.gestures.smileDetected = (smileRatio > 0.78);

  // 3. Há miệng to & Hét lớn (Screaming Man Detection)
  // Môi trên (13) và môi dưới (14)
  const upperLip = landmarks[13];
  const lowerLip = landmarks[14];
  const mouthHeight = Math.hypot(upperLip.x - lowerLip.x, upperLip.y - lowerLip.y);
  const gapeRatio = mouthHeight / faceScale;
  
  // Đọc mức âm lượng hiện tại từ Audio Analyzer (biến toàn cục được thiết lập từ app.js)
  const currentVolume = window.currentAudioVolume || 0;
  
  // Điều kiện kích hoạt tiếng hét: miệng mở rộng (gapeRatio > 0.35) và âm thanh mic lớn (volume > 0.35)
  if (gapeRatio > 0.35 && currentVolume > 0.35) {
    AR_STATE.gestures.screamingDetected = true;
  } else {
    // Duy trì hiệu ứng thêm một chút (khoảng 1 giây) để tránh hiện tượng nhấp nháy giật cục
    if (AR_STATE.gestures.screamingDetected && gapeRatio < 0.2) {
      AR_STATE.gestures.screamingDetected = false;
    }
  }

  // 4. Nhíu mày suy tư (Furrowed Brows / Thought Detection)
  // Đầu lông mày trái (55 hoặc 107) và đầu lông mày phải (285 hoặc 336)
  const leftEyebrowInner = landmarks[55];
  const rightEyebrowInner = landmarks[285];
  const eyebrowDistance = Math.hypot(leftEyebrowInner.x - rightEyebrowInner.x, leftEyebrowInner.y - rightEyebrowInner.y);
  const eyebrowRatio = eyebrowDistance / faceScale;

  // Khi nhíu mày, khoảng cách giữa hai đầu chân mày sẽ co hẹp lại đáng kể (tỉ lệ thường < 0.22)
  AR_STATE.gestures.thoughtDetected = (eyebrowRatio < 0.22);
}

// ==========================================
// 5. PHÂN TÍCH CỬ CHỈ CỦA TAY
// ==========================================
function analyzeHandGestures() {
  if (!AR_STATE.handLandmarks) {
    AR_STATE.gestures.fistDetected = false;
    AR_STATE.gestures.shhDetected = false;
    return;
  }

  let fistFound = false;
  let shhFound = false;

  // Lặp qua tất cả bàn tay phát hiện được (tối đa 2 tay)
  for (const hand of AR_STATE.handLandmarks) {
    const wrist = hand[0]; // Cổ tay
    
    // Khớp ngón trỏ (5), đầu ngón trỏ (8)
    const indexMCP = hand[5];
    const indexTip = hand[8];
    
    // Các đầu ngón tay khác
    const middleTip = hand[12];
    const ringTip = hand[16];
    const pinkyTip = hand[20];
    const thumbTip = hand[4];

    // -- PHÁT HIỆN CỬ CHỈ NẮM TAY (FIST DETECTION) --
    // Tính khoảng cách trung bình từ các đầu ngón tay đến cổ tay
    const distIndex = Math.hypot(indexTip.x - wrist.x, indexTip.y - wrist.y);
    const distMiddle = Math.hypot(middleTip.x - wrist.x, middleTip.y - wrist.y);
    const distRing = Math.hypot(ringTip.x - wrist.x, ringTip.y - wrist.y);
    const distPinky = Math.hypot(pinkyTip.x - wrist.x, pinkyTip.y - wrist.y);
    
    // Chiều dài bàn tay chuẩn (tính từ khớp ngón trỏ MCP tới cổ tay)
    const handScale = Math.hypot(indexMCP.x - wrist.x, indexMCP.y - wrist.y);
    
    // Nếu tất cả các đầu ngón tay co lại rất gần cổ tay (gần hơn 1.25 lần chiều dài bàn tay chuẩn)
    const isFist = (distIndex < handScale * 1.25 && 
                    distMiddle < handScale * 1.25 && 
                    distRing < handScale * 1.25 && 
                    distPinky < handScale * 1.25);
    
    if (isFist) fistFound = true;

    // -- PHÁT HIỆN CỬ CHỈ ĐƯA TAY LÊN MÔI SUỴT (SHH GESTURE) --
    // Cử chỉ này yêu cầu ngón trỏ dựng thẳng đứng hướng lên, các ngón khác co lại,
    // và đầu ngón trỏ phải ở rất gần vị trí môi trên khuôn mặt.
    if (AR_STATE.faceLandmarks) {
      const lipsCenter = AR_STATE.faceLandmarks[13]; // Điểm giữa môi trên
      
      // Khoảng cách từ đầu ngón trỏ tới môi
      const distTipToLips = Math.hypot(indexTip.x - lipsCenter.x, indexTip.y - lipsCenter.y);
      
      // Kiểm tra ngón trỏ có chỉ thẳng đứng lên không (y của đầu ngón trỏ nhỏ hơn y của khớp MCP ngón trỏ)
      const isIndexExtended = indexTip.y < indexMCP.y;
      
      // Các ngón khác cụp lại (khoảng cách đầu ngón tới cổ tay ngắn hơn MCP)
      const isOtherFingersCurled = (Math.hypot(middleTip.x - wrist.x, middleTip.y - wrist.y) < handScale * 1.3 &&
                                    Math.hypot(ringTip.x - wrist.x, ringTip.y - wrist.y) < handScale * 1.3 &&
                                    Math.hypot(pinkyTip.x - wrist.x, pinkyTip.y - wrist.y) < handScale * 1.3);
      
      // Ngưỡng khoảng cách đầu ngón trỏ đến môi (khoảng cách chuẩn hóa)
      if (distTipToLips < 0.12 && isIndexExtended && isOtherFingersCurled) {
        shhFound = true;
      }
    }
  }

  AR_STATE.gestures.fistDetected = fistFound;
  
  // Xử lý ngầm tự động MUTE mic khi phát hiện hành động Suỵt tay lên môi
  if (shhFound) {
    if (!AR_STATE.gestures.shhDetected) {
      AR_STATE.gestures.shhDetected = true;
      // Kích hoạt sự kiện tắt mic tự động trong app.js
      window.dispatchEvent(new CustomEvent('shh-mute', { detail: true }));
    }
  } else {
    if (AR_STATE.gestures.shhDetected) {
      AR_STATE.gestures.shhDetected = false;
      // Khôi phục trạng thái mic khi hạ tay xuống
      window.dispatchEvent(new CustomEvent('shh-mute', { detail: false }));
    }
  }
}

// ==========================================
// 6. ENGINE VẼ HIỆU ỨNG LÊN CANVAS (RENDERING ENGINE)
// ==========================================
function renderCanvasOverlay(videoElement, canvasElement) {
  const ctx = canvasElement.getContext('2d');
  
  // Đồng bộ kích thước canvas với video camera đầu vào
  if (canvasElement.width !== videoElement.videoWidth || canvasElement.height !== videoElement.videoHeight) {
    canvasElement.width = videoElement.videoWidth;
    canvasElement.height = videoElement.videoHeight;
  }

  const w = canvasElement.width;
  const h = canvasElement.height;

  // --- Xử lý 1: Áp dụng hiệu ứng bộ lọc đen trắng khi "Nhíu mày suy tư" ---
  if (AR_STATE.gestures.thoughtDetected) {
    ctx.filter = 'grayscale(100%) contrast(1.1)'; // Chuyển luồng vẽ video sang màu đen trắng nghệ thuật
  } else {
    ctx.filter = 'none';
  }

  // --- Xử lý 2: Áp dụng xóa nền/làm mờ nền ngụy trang (Virtual Background) ---
  if (AR_STATE.backgroundBlurAmount > 0 && !AR_STATE.gestures.thoughtDetected) {
    ctx.filter = `blur(${AR_STATE.backgroundBlurAmount}px)`;
  }

  // --- Xử lý 3: Vẽ khung hình Video gốc (đã được lật ngược dạng gương để trực quan) ---
  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1); // Lật ngang video
  ctx.drawImage(videoElement, 0, 0, w, h);
  ctx.restore();
  
  // Tắt bộ lọc cho các nét vẽ đè tiếp theo để giữ nguyên màu sắc rực rỡ của meme & AR
  ctx.filter = 'none';

  // --- Xử lý 4: Vẽ các hiệu ứng AR thông thường (Menu Ngụy Trang) ---
  drawCamouflageAR(ctx, w, h);

  // --- Xử lý 5: Vẽ các hiệu ứng bí mật chạy ngầm ---
  drawSecretAR(ctx, w, h);

  // --- Xử lý 6: Quản lý và vẽ hệ thống Hạt động (Particles) ---
  updateAndDrawParticles(ctx);
}

// ==========================================
// 7. VẼ HIỆU ỨNG AR NGỤY TRANG (RABBIT, CAT, GLASSES)
// ==========================================
function drawCamouflageAR(ctx, canvasWidth, canvasHeight) {
  if (AR_STATE.activeCamouflageEffect === 'none' || !AR_STATE.faceLandmarks) return;

  const landmarks = AR_STATE.faceLandmarks;
  
  // Điểm mắt trái (33), mắt phải (263), trán (10), mũi (4)
  const leftEye = landmarks[33];
  const rightEye = landmarks[263];
  const nose = landmarks[4];
  const forehead = landmarks[10];

  // Tính khoảng cách mắt để làm tỉ lệ co giãn ảnh AR
  const eyeDistance = Math.hypot(leftEye.x - rightEye.x, leftEye.y - rightEye.y) * canvasWidth;
  
  // Tính góc nghiêng của khuôn mặt
  const angle = Math.atan2(leftEye.y - rightEye.y, leftEye.x - rightEye.x);

  ctx.save();

  if (AR_STATE.activeCamouflageEffect === 'rabbit') {
    // --- VẼ TAI THỎ (Rabbit Ears) ---
    // Tai thỏ nằm trên đỉnh đầu (forehead landmark 10)
    const rx = (1 - forehead.x) * canvasWidth; // Vì video lật gương nên tọa độ x vẽ = (1 - x)
    const ry = forehead.y * canvasHeight;
    const imgSize = eyeDistance * 2.5;

    ctx.translate(rx, ry);
    ctx.rotate(-angle); // Xoay theo độ nghiêng đầu
    
    if (images.rabbitEars.complete && images.rabbitEars.naturalWidth !== 0) {
      ctx.drawImage(images.rabbitEars, -imgSize / 2, -imgSize * 0.9, imgSize, imgSize);
    } else {
      // Fallback: Vẽ bằng Emoji nếu ảnh lỗi
      ctx.font = `${imgSize * 0.5}px Arial`;
      ctx.textAlign = 'center';
      ctx.fillText('🐰', 0, -imgSize * 0.1);
    }
  } 
  else if (AR_STATE.activeCamouflageEffect === 'cat') {
    // --- VẼ MẶT NẠ MÈO (Cat Nose & Whiskers) ---
    // Mặt nạ mèo sẽ lấy mốc trung tâm là mũi (landmark 4)
    const rx = (1 - nose.x) * canvasWidth;
    const ry = nose.y * canvasHeight;
    const imgSize = eyeDistance * 2.2;

    ctx.translate(rx, ry);
    ctx.rotate(-angle);
    
    if (images.catMask.complete && images.catMask.naturalWidth !== 0) {
      ctx.drawImage(images.catMask, -imgSize / 2, -imgSize * 0.5, imgSize, imgSize);
    } else {
      // Fallback bằng nét vẽ râu mèo canvas cơ bản
      ctx.strokeStyle = '#ff69b4';
      ctx.lineWidth = 3;
      // Vẽ râu trái
      ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(-60, -10); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-10, 5); ctx.lineTo(-65, 5); ctx.stroke();
      // Vẽ râu phải
      ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(60, -10); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(10, 5); ctx.lineTo(65, 5); ctx.stroke();
      // Mũi hồng
      ctx.fillStyle = '#ff69b4';
      ctx.beginPath(); ctx.arc(0, -5, 8, 0, Math.PI * 2); ctx.fill();
    }
  } 
  else if (AR_STATE.activeCamouflageEffect === 'glasses') {
    // --- VẼ KÍNH RÂM (Sunglasses) ---
    // Trung điểm giữa hai mắt
    const centerX = (1 - (leftEye.x + rightEye.x) / 2) * canvasWidth;
    const centerY = ((leftEye.y + rightEye.y) / 2) * canvasHeight;
    const imgWidth = eyeDistance * 1.8;
    const imgHeight = imgWidth * 0.4;

    ctx.translate(centerX, centerY);
    ctx.rotate(-angle);
    
    if (images.sunglasses.complete && images.sunglasses.naturalWidth !== 0) {
      ctx.drawImage(images.sunglasses, -imgWidth / 2, -imgHeight / 2, imgWidth, imgHeight);
    } else {
      // Fallback vẽ hộp kính đen cơ bản
      ctx.fillStyle = 'black';
      ctx.fillRect(-imgWidth / 2, -imgHeight / 4, imgWidth, imgHeight / 2);
    }
  }

  ctx.restore();
}

// ==========================================
// 8. VẼ CÁC HIỆU ỨNG KÍCH HOẠT BÍ MẬT
// ==========================================
function drawSecretAR(ctx, canvasWidth, canvasHeight) {
  // --- 1. HIỆU ỨNG NẮM TAY -> HOA HỒNG (Fist Gesture) ---
  if (AR_STATE.gestures.fistDetected && AR_STATE.handLandmarks) {
    for (const hand of AR_STATE.handLandmarks) {
      const indexMCP = hand[5];
      // Tọa độ vẽ tâm bàn tay (đã lật gương)
      const hx = (1 - indexMCP.x) * canvasWidth;
      const hy = indexMCP.y * canvasHeight;
      const size = 110;

      // Vẽ đóa hồng nằm trên tay nắm
      ctx.save();
      ctx.translate(hx, hy);
      if (images.roseFlower.complete && images.roseFlower.naturalWidth !== 0) {
        ctx.drawImage(images.roseFlower, -size / 2, -size / 2, size, size);
      } else {
        ctx.font = '60px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🌹', 0, 0);
      }
      ctx.restore();

      // Sinh hạt đóa hồng bay lên theo chu kỳ thời gian
      if (Math.random() < 0.15) {
        particles.push({
          x: hx + (Math.random() - 0.5) * 40,
          y: hy,
          type: 'text',
          content: '🌹',
          size: 20 + Math.random() * 20,
          vx: (Math.random() - 0.5) * 2,
          vy: -3 - Math.random() * 3,
          alpha: 1,
          decay: 0.015
        });
      }
    }
  }

  // --- 2. HIỆU ỨNG SUṴT IM LẶNG -> MEME CHÓ XANH (Shh Gesture) ---
  if (AR_STATE.gestures.shhDetected) {
    const sizeW = canvasWidth * 0.45; // Chiếm khoảng 45% chiều rộng màn hình
    const sizeH = sizeW * 0.75;
    const px = 20; // Đặt ở góc dưới cùng bên trái màn hình
    const py = canvasHeight - sizeH - 20;

    ctx.save();
    // Vẽ viền đỏ nổi bật cảnh báo trạng thái Mute ngầm
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 4;
    ctx.strokeRect(px - 2, py - 2, sizeW + 4, sizeH + 4);

    if (images.greenDog.complete && images.greenDog.naturalWidth !== 0) {
      ctx.drawImage(images.greenDog, px, py, sizeW, sizeH);
    } else {
      // Fallback khi không tải được ảnh chó xanh
      ctx.fillStyle = 'rgba(16, 185, 129, 0.9)';
      ctx.fillRect(px, py, sizeW, sizeH);
      ctx.fillStyle = 'white';
      ctx.font = 'bold 20px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('🤫 SHH! MIC ĐÃ KHÓA', px + sizeW / 2, py + sizeH / 2);
    }
    
    // Thêm nhãn text "MICROPHONE MUTED!" nhấp nháy góc meme
    if (Math.floor(Date.now() / 400) % 2 === 0) {
      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 16px Arial';
      ctx.fillText('⚠️ AUTO-MUTED', px + 15, py + 25);
    }
    ctx.restore();
  }

  // --- 3. HIỆU ỨNG THÉT LỚN -> MEME NGƯỜI ĐÀN ÔNG HÉT GIẬT MÌNH (Screaming Man) ---
  if (AR_STATE.gestures.screamingDetected && AR_STATE.faceLandmarks) {
    // Tạo hiệu ứng rung giật màn hình (Camera Shake) cực chất
    const shakeX = (Math.random() - 0.5) * 20;
    const shakeY = (Math.random() - 0.5) * 20;

    const sizeW = canvasWidth * 0.55;
    const sizeH = sizeW * 0.9;
    const px = (canvasWidth - sizeW) / 2 + shakeX;
    const py = (canvasHeight - sizeH) / 2 + shakeY;

    ctx.save();
    // Vẽ overlay viền đỏ nhấp nháy tràn màn hình tăng cảm giác kinh dị, giật mình
    ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    if (images.screamingMan.complete && images.screamingMan.naturalWidth !== 0) {
      ctx.drawImage(images.screamingMan, px, py, sizeW, sizeH);
    } else {
      // Fallback
      ctx.fillStyle = 'rgba(239, 68, 68, 0.85)';
      ctx.fillRect(px, py, sizeW, sizeH);
      ctx.fillStyle = 'white';
      ctx.font = 'bold 32px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('😱 SCREAM!!!', px + sizeW / 2, py + sizeH / 2);
    }
    ctx.restore();
  }

  // --- 4. HIỆU ỨNG CƯỜI LỚN -> LẤP LÁNH & ICON 100 BAY RA (Smile Gesture) ---
  if (AR_STATE.gestures.smileDetected && AR_STATE.faceLandmarks) {
    const mouthCenter = AR_STATE.faceLandmarks[13];
    const mx = (1 - mouthCenter.x) * canvasWidth;
    const my = mouthCenter.y * canvasHeight;

    // Sinh các hạt "100" và lấp lánh (Sparkles) bay ra liên tục từ miệng
    if (Math.random() < 0.25) {
      // Hạt số "100" bay lên
      particles.push({
        x: mx,
        y: my,
        type: 'text',
        content: '💯',
        size: 25 + Math.random() * 25,
        vx: (Math.random() - 0.5) * 4,
        vy: -2 - Math.random() * 4,
        alpha: 1,
        decay: 0.015
      });
    }

    if (Math.random() < 0.4) {
      // Hạt lấp lánh (Sparkle lấp lánh ngũ sắc)
      particles.push({
        x: mx,
        y: my,
        type: 'sparkle',
        color: `hsl(${Math.random() * 360}, 100%, 70%)`,
        size: 6 + Math.random() * 10,
        vx: (Math.random() - 0.5) * 6,
        vy: -3 - Math.random() * 3,
        alpha: 1,
        decay: 0.02
      });
    }
  }

  // --- 5. HIỆU ỨNG NHÍU MÀY -> BIỂU TƯỢNG LOADING XOAY TRÊN ĐẦU (Thought Gesture) ---
  if (AR_STATE.gestures.thoughtDetected && AR_STATE.faceLandmarks) {
    const forehead = AR_STATE.faceLandmarks[10];
    const fx = (1 - forehead.x) * canvasWidth;
    const fy = forehead.y * canvasHeight - 65; // Đặt cách trên đỉnh đầu 65px

    ctx.save();
    ctx.translate(fx, fy);
    
    // Vẽ vòng tròn xoay loading bằng Canvas nét vẽ mịn màng
    const angleRotation = (Date.now() / 150) % (Math.PI * 2);
    ctx.rotate(angleRotation);
    
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 0, 25, 0, Math.PI * 1.5); // Vẽ 3/4 vòng tròn để tạo khoảng trống xoay
    ctx.stroke();

    ctx.restore();

    // Thêm chữ biểu thị đang suy nghĩ dưới vòng xoay
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Thinking...', fx, fy + 45);
    ctx.restore();
  }
}

// ==========================================
// 9. QUẢN LÝ VÀ CẬP NHẬT HỆ THỐNG HẠT ĐỘNG (PARTICLES SYSTEM)
// ==========================================
function updateAndDrawParticles(ctx) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    
    // Cập nhật tọa độ
    p.x += p.vx;
    p.y += p.vy;
    
    // Lực cản nhẹ và lực hút rơi chậm nếu cần
    p.vy += 0.05; // Rơi xuống nhẹ (trừ hạt 100/rose bay ngược lên)
    
    // Giảm độ hiển thị dần dần
    p.alpha -= p.decay;

    if (p.alpha <= 0) {
      particles.splice(i, 1);
      continue;
    }

    ctx.save();
    ctx.globalAlpha = p.alpha;

    if (p.type === 'text') {
      ctx.font = `${p.size}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.content, p.x, p.y);
    } 
    else if (p.type === 'sparkle') {
      // Vẽ hình sao 4 cánh lấp lánh
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - p.size);
      ctx.quadraticCurveTo(p.x, p.y, p.x + p.size, p.y);
      ctx.quadraticCurveTo(p.x, p.y, p.x, p.y + p.size);
      ctx.quadraticCurveTo(p.x, p.y, p.x - p.size, p.y);
      ctx.quadraticCurveTo(p.x, p.y, p.x, p.y - p.size);
      ctx.fill();
    }

    ctx.restore();
  }
}

// Xuất các hàm và biến trạng thái ra toàn cục
window.AR_STATE = AR_STATE;
window.initMediaPipe = initMediaPipe;
window.renderCanvasOverlay = renderCanvasOverlay;
window.faceMeshInstance = () => faceMeshInstance;
window.handsInstance = () => handsInstance;

/**
 * app.js
 * ============================================================
 * Entry point – Điều phối toàn bộ ứng dụng AR Video Call.
 *
 * Thứ tự khởi tạo:
 *  1. Background canvas animation
 *  2. DOM event listeners (lobby, toolbar, AR menu)
 *  3. PeerModule (media stream + WebRTC)
 *  4. Overlay module (canvas render loop)
 *  5. AREffects (hiệu ứng menu công khai)
 *  6. MediaPipeModule (nhận diện khuôn mặt + tay)
 *  7. SecretSystem (kích hoạt khi phát hiện cử chỉ)
 *
 * Luồng chính:
 *  Lobby → [Tạo phòng | Tham gia phòng] → Call Screen
 * ============================================================
 */

// ===========================================================
//  BACKGROUND CANVAS ANIMATION (hạt lấp lánh nền)
// ===========================================================

(function initBgCanvas() {
  const canvas = document.getElementById('bg-canvas');
  const ctx    = canvas.getContext('2d');
  const W      = () => canvas.width;
  const H      = () => canvas.height;

  // Cập nhật kích thước canvas khi cửa sổ thay đổi
  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  // Tạo mảng hạt lấp lánh
  const NUM_PARTICLES = 80;
  const particles = Array.from({ length: NUM_PARTICLES }, () => createBgParticle());

  function createBgParticle() {
    return {
      x:    Math.random(),
      y:    Math.random(),
      r:    1 + Math.random() * 2,
      vx:   (Math.random() - 0.5) * 0.0003,
      vy:   (Math.random() - 0.5) * 0.0003,
      hue:  Math.random() * 60 + 240, // xanh tím
      alpha:Math.random() * 0.6 + 0.1,
      dAlpha: (Math.random() - 0.5) * 0.005,
    };
  }

  function animateBg() {
    ctx.clearRect(0, 0, W(), H());
    for (const p of particles) {
      // Di chuyển hạt
      p.x += p.vx;
      p.y += p.vy;
      p.alpha += p.dAlpha;

      // Wrap around biên
      if (p.x < 0) p.x = 1;
      if (p.x > 1) p.x = 0;
      if (p.y < 0) p.y = 1;
      if (p.y > 1) p.y = 0;
      if (p.alpha < 0.05) p.dAlpha = Math.abs(p.dAlpha);
      if (p.alpha > 0.75) p.dAlpha = -Math.abs(p.dAlpha);

      // Vẽ hạt
      ctx.beginPath();
      ctx.arc(p.x * W(), p.y * H(), p.r, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${p.hue}, 80%, 70%, ${p.alpha})`;
      ctx.fill();
    }
    requestAnimationFrame(animateBg);
  }
  animateBg();
})();

// ===========================================================
//  THAM CHIẾU DOM
// ===========================================================

const DOM = {
  // Screens
  lobbyScreen: document.getElementById('lobby-screen'),
  callScreen:  document.getElementById('call-screen'),

  // Lobby
  btnCreateRoom:  document.getElementById('btn-create-room'),
  inputRoomId:    document.getElementById('input-room-id'),
  btnJoinRoom:    document.getElementById('btn-join-room'),
  roomIdDisplay:  document.getElementById('room-id-display'),
  roomIdText:     document.getElementById('room-id-text'),
  btnCopyRoomId:  document.getElementById('btn-copy-room-id'),
  lobbyStatus:    document.getElementById('lobby-status'),

  // Call screen
  remoteVideo:     document.getElementById('remote-video'),
  localVideoRaw:   document.getElementById('local-video-raw'),
  localCanvas:     document.getElementById('local-canvas'),
  waitingOverlay:  document.getElementById('waiting-overlay'),
  effectBadge:     document.getElementById('effect-badge'),

  // Toolbar
  btnToggleMic: document.getElementById('btn-toggle-mic'),
  btnToggleCam: document.getElementById('btn-toggle-cam'),
  btnEndCall:   document.getElementById('btn-end-call'),
  btnArMenu:    document.getElementById('btn-ar-menu'),
  btnRoomInfo:  document.getElementById('btn-room-info'),
  micIcon:      document.getElementById('mic-icon'),
  camIcon:      document.getElementById('cam-icon'),

  // AR Menu
  arMenuPanel:    document.getElementById('ar-menu-panel'),
  btnCloseArMenu: document.getElementById('btn-close-ar-menu'),
  arEffectCards:  document.querySelectorAll('.ar-effect-card'),

  // Room Info Popup
  roomInfoPopup:       document.getElementById('room-info-popup'),
  btnCloseRoomInfo:    document.getElementById('btn-close-room-info'),
  popupRoomIdText:     document.getElementById('popup-room-id-text'),
  btnCopyPopupRoomId:  document.getElementById('btn-copy-popup-room-id'),

  // Toast
  toastContainer: document.getElementById('toast-container'),
};

// ===========================================================
//  TRẠNG THÁI ỨNG DỤNG
// ===========================================================

const AppState = {
  isHost:      false,   // có phải người tạo phòng không
  currentRoom: null,    // Room ID hiện tại
  micEnabled:  true,
  camEnabled:  true,
  arEffect:    'none',
};

// ===========================================================
//  CHUYỂN MÀN HÌNH
// ===========================================================

/**
 * Chuyển sang màn hình cuộc gọi.
 * Ẩn lobby, hiện call screen.
 */
function showCallScreen() {
  DOM.lobbyScreen.classList.remove('active');
  DOM.callScreen.classList.add('active');

  // Cập nhật popup Room ID
  if (AppState.currentRoom) {
    DOM.popupRoomIdText.textContent = AppState.currentRoom;
  }

  console.log('[App] Đã chuyển sang màn hình cuộc gọi');
}

/**
 * Quay về màn hình lobby.
 */
function showLobby() {
  DOM.callScreen.classList.remove('active');
  DOM.lobbyScreen.classList.add('active');
  resetLobbyUI();
}

function resetLobbyUI() {
  DOM.roomIdDisplay.classList.add('hidden');
  DOM.roomIdText.textContent = '';
  DOM.lobbyStatus.textContent = '';
  DOM.inputRoomId.value = '';
}

// ===========================================================
//  TOAST NOTIFICATION
// ===========================================================

/**
 * Hiển thị thông báo toast ngắn.
 * @param {string} message – Nội dung thông báo
 * @param {number} duration – Thời gian hiển thị (ms)
 */
function showToast(message, duration = 2500) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  DOM.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('out');
    setTimeout(() => toast.remove(), 350);
  }, duration);
}

// ===========================================================
//  COPY TO CLIPBOARD
// ===========================================================

async function copyToClipboard(text, successMsg = '✅ Đã sao chép!') {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMsg);
  } catch (err) {
    // Fallback cho trình duyệt không hỗ trợ Clipboard API
    const input = document.createElement('input');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
    showToast(successMsg);
  }
}

// ===========================================================
//  KHỞI ĐỘNG ỨNG DỤNG
// ===========================================================

/**
 * Hàm khởi tạo chính – chạy khi trang load xong.
 */
async function initApp() {
  console.log('[App] Khởi động AR Video Call...');

  // 1. Đăng ký event listeners lobby
  setupLobbyListeners();

  // 2. Khởi tạo PeerModule
  //    - Lấy media stream (camera + mic)
  //    - Thiết lập audio processing (GainNode)
  //    - Tạo Peer instance
  await PeerModule.init({
    onReady: (roomId) => {
      // Peer đã sẵn sàng, hiện Room ID trong lobby
      AppState.currentRoom = roomId;
      DOM.roomIdText.textContent    = roomId;
      DOM.popupRoomIdText.textContent = roomId;
      DOM.lobbyStatus.textContent = '✅ Sẵn sàng kết nối!';
      console.log(`[App] Peer sẵn sàng với Room ID: ${roomId}`);
    },

    onConnected: () => {
      // Kết nối thành công
      DOM.waitingOverlay.classList.add('hidden');
      showToast('🎉 Đã kết nối thành công!');
      console.log('[App] Kết nối thành công với peer');
    },

    onRemoteStream: (stream) => {
      // Hiển thị video từ xa
      DOM.remoteVideo.srcObject = stream;
      DOM.remoteVideo.play().catch(console.warn);
      console.log('[App] Đang hiển thị remote stream');
    },

    onDisconnected: () => {
      // Peer ngắt kết nối
      showToast('📵 Cuộc gọi đã kết thúc');
      DOM.waitingOverlay.classList.remove('hidden');
      DOM.remoteVideo.srcObject = null;
      console.log('[App] Peer đã ngắt kết nối');
    },

    onError: (err) => {
      const msg = getErrorMessage(err);
      showToast(`❌ Lỗi: ${msg}`, 4000);
      DOM.lobbyStatus.textContent = `❌ ${msg}`;
      console.error('[App] Lỗi peer:', err);
    },
  });

  // 3. Gắn video thô của local vào video element (cho MediaPipe)
  //    localStream đã sẵn sàng sau PeerModule.init()
  const localStream = PeerModule.localStream;
  if (localStream) {
    DOM.localVideoRaw.srcObject = localStream;
    await DOM.localVideoRaw.play().catch(console.warn);
  }

  // 4. Khởi tạo Overlay (canvas render loop)
  Overlay.init(DOM.localVideoRaw, DOM.localCanvas);
  Overlay.start();
  console.log('[App] Overlay đã khởi động');

  // 5. Khởi tạo AR Effects
  AREffects.init();
  console.log('[App] AREffects đã khởi động');

  // 6. Khởi tạo MediaPipe (nhận diện khuôn mặt + tay)
  //    Chạy sau khi video đã sẵn sàng
  if (localStream) {
    try {
      await MediaPipeModule.init(DOM.localVideoRaw);
      console.log('[App] MediaPipe đã khởi động');
    } catch (err) {
      console.error('[App] Lỗi khởi tạo MediaPipe:', err);
      showToast('⚠️ Không thể khởi động nhận diện AR. Kiểm tra camera.', 4000);
    }
  }

  // 7. Khởi tạo Secret System (phải sau MediaPipe)
  SecretSystem.init();
  console.log('[App] Secret System đang chạy ngầm');

  // 8. Đăng ký event listeners cho call screen
  setupCallListeners();

  // 9. Làm cho PIP (local video) có thể kéo thả
  setupDraggablePIP();

  console.log('[App] Khởi động hoàn tất ✅');
}

// ===========================================================
//  LOBBY EVENT LISTENERS
// ===========================================================

function setupLobbyListeners() {

  // Nút tạo phòng
  DOM.btnCreateRoom.addEventListener('click', () => {
    AppState.isHost = true;
    DOM.roomIdDisplay.classList.remove('hidden');

    if (AppState.currentRoom) {
      DOM.roomIdText.textContent = AppState.currentRoom;
      DOM.lobbyStatus.textContent = '⏳ Đang chờ người khác tham gia...';
    } else {
      DOM.lobbyStatus.textContent = '⏳ Đang khởi tạo kết nối...';
    }

    PeerModule.createRoom();
    showCallScreen();
    console.log('[App] Đã tạo phòng');
  });

  // Nút tham gia phòng
  DOM.btnJoinRoom.addEventListener('click', handleJoinRoom);

  // Enter key trong input Room ID
  DOM.inputRoomId.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleJoinRoom();
  });

  // Nút copy Room ID (lobby)
  DOM.btnCopyRoomId.addEventListener('click', () => {
    if (AppState.currentRoom) {
      copyToClipboard(AppState.currentRoom);
    }
  });
}

function handleJoinRoom() {
  const roomId = DOM.inputRoomId.value.trim();
  if (!roomId) {
    showToast('⚠️ Vui lòng nhập Room ID!');
    DOM.inputRoomId.focus();
    return;
  }

  if (roomId === AppState.currentRoom) {
    showToast('⚠️ Không thể gọi cho chính mình!');
    return;
  }

  AppState.isHost = false;
  AppState.currentRoom = roomId; // cập nhật để hiển thị trong popup
  DOM.popupRoomIdText.textContent = roomId;

  showCallScreen();
  showToast('📡 Đang kết nối...', 3000);
  PeerModule.joinRoom(roomId);
  console.log(`[App] Đang tham gia phòng: ${roomId}`);
}

// ===========================================================
//  CALL SCREEN EVENT LISTENERS
// ===========================================================

function setupCallListeners() {

  // ─── Nút Mic ────────────────────────────────────────────
  DOM.btnToggleMic.addEventListener('click', () => {
    const enabled = PeerModule.toggleMic();
    DOM.btnToggleMic.classList.toggle('muted', !enabled);
    DOM.micIcon.textContent = enabled ? '🎤' : '🔇';
    showToast(enabled ? '🎤 Mic đã bật' : '🔇 Mic đã tắt');
  });

  // ─── Nút Camera ─────────────────────────────────────────
  DOM.btnToggleCam.addEventListener('click', () => {
    const enabled = PeerModule.toggleCamera();
    DOM.btnToggleCam.classList.toggle('muted', !enabled);
    DOM.camIcon.textContent = enabled ? '📷' : '🚫';
    showToast(enabled ? '📷 Camera đã bật' : '🚫 Camera đã tắt');
  });

  // ─── Nút Kết thúc ───────────────────────────────────────
  DOM.btnEndCall.addEventListener('click', () => {
    PeerModule.hangup();
    Overlay.stop();
    showLobby();
  });

  // ─── Nút AR Menu ────────────────────────────────────────
  DOM.btnArMenu.addEventListener('click', () => {
    DOM.arMenuPanel.classList.toggle('hidden');
  });

  // ─── Nút đóng AR Menu ───────────────────────────────────
  DOM.btnCloseArMenu.addEventListener('click', () => {
    DOM.arMenuPanel.classList.add('hidden');
  });

  // ─── Click ngoài AR menu để đóng ───────────────────────
  document.addEventListener('click', (e) => {
    if (!DOM.arMenuPanel.classList.contains('hidden') &&
        !DOM.arMenuPanel.contains(e.target) &&
        e.target !== DOM.btnArMenu) {
      DOM.arMenuPanel.classList.add('hidden');
    }
  });

  // ─── AR Effect Cards ────────────────────────────────────
  DOM.arEffectCards.forEach(card => {
    card.addEventListener('click', () => {
      const effect = card.dataset.effect;

      // Cập nhật UI
      DOM.arEffectCards.forEach(c => c.classList.remove('active'));
      card.classList.add('active');

      // Áp dụng hiệu ứng
      AREffects.setEffect(effect);
      AppState.arEffect = effect;

      // Hiện/ẩn badge tên hiệu ứng
      if (effect !== 'none') {
        DOM.effectBadge.textContent = card.querySelector('span:last-child').textContent;
        DOM.effectBadge.classList.remove('hidden');
      } else {
        DOM.effectBadge.classList.add('hidden');
      }

      // Đóng menu
      DOM.arMenuPanel.classList.add('hidden');
      console.log(`[App] AR Effect đã chọn: ${effect}`);
    });
  });

  // ─── Nút Room Info ──────────────────────────────────────
  DOM.btnRoomInfo.addEventListener('click', () => {
    DOM.roomInfoPopup.classList.remove('hidden');
    DOM.roomInfoPopup.style.display = 'flex';
  });

  DOM.btnCloseRoomInfo.addEventListener('click', () => {
    DOM.roomInfoPopup.classList.add('hidden');
  });

  // ─── Copy Room ID trong popup ───────────────────────────
  DOM.btnCopyPopupRoomId.addEventListener('click', () => {
    const id = DOM.popupRoomIdText.textContent;
    if (id) copyToClipboard(id);
  });
}

// ===========================================================
//  DRAGGABLE PIP (kéo thả local video)
// ===========================================================

function setupDraggablePIP() {
  const pip = document.getElementById('local-video-container');
  if (!pip) return;

  let isDragging = false;
  let startX, startY, initLeft, initTop;

  pip.addEventListener('pointerdown', (e) => {
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;

    const rect = pip.getBoundingClientRect();
    initLeft = rect.left;
    initTop  = rect.top;

    pip.setPointerCapture(e.pointerId);
    pip.style.transition = 'none';
  });

  pip.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    // Giới hạn trong viewport
    const maxLeft = window.innerWidth  - pip.offsetWidth;
    const maxTop  = window.innerHeight - pip.offsetHeight;
    const newLeft = Math.max(0, Math.min(initLeft + dx, maxLeft));
    const newTop  = Math.max(0, Math.min(initTop  + dy, maxTop));

    pip.style.left   = `${newLeft}px`;
    pip.style.top    = `${newTop}px`;
    pip.style.bottom = 'auto';
    pip.style.right  = 'auto';
  });

  pip.addEventListener('pointerup', () => {
    isDragging = false;
    pip.style.transition = '';
  });
}

// ===========================================================
//  XỬ LÝ LỖI – Chuyển mã lỗi thành thông báo thân thiện
// ===========================================================

function getErrorMessage(err) {
  if (!err) return 'Lỗi không xác định';
  const type = err.type || err.name || '';
  const messages = {
    'browser-incompatible': 'Trình duyệt không hỗ trợ WebRTC. Vui lòng dùng Chrome/Firefox.',
    'disconnected':         'Mất kết nối đến server. Đang thử lại...',
    'invalid-id':           'Room ID không hợp lệ.',
    'unavailable-id':       'Room ID đã được dùng.',
    'ssl-unavailable':      'Cần HTTPS để dùng camera và mic.',
    'server-error':         'Lỗi kết nối đến server trung gian.',
    'peer-unavailable':     'Không tìm thấy phòng với Room ID này.',
    'NotAllowedError':      'Không có quyền truy cập camera/mic. Vui lòng cho phép.',
    'NotFoundError':        'Không tìm thấy camera hoặc microphone.',
    'OverconstrainedError': 'Camera không hỗ trợ độ phân giải yêu cầu.',
  };
  return messages[type] || err.message || 'Lỗi không xác định';
}

// ===========================================================
//  KHỞI CHẠY KHI TRANG ĐÃ LOAD
// ===========================================================

window.addEventListener('DOMContentLoaded', () => {
  initApp().catch(err => {
    console.error('[App] Lỗi nghiêm trọng khi khởi động:', err);
    alert(`Không thể khởi động ứng dụng:\n${err.message}\n\nVui lòng kiểm tra camera/mic và thử lại.`);
  });
});

// ─── Phím tắt debug (chỉ dùng trong development) ──────────
// Mở console và gọi: SecretSystem._triggerRose() để test
// Hoặc: window.DEBUG_SECRET = true; rồi nhấn phím 1-5
if (window.DEBUG_SECRET) {
  window.addEventListener('keydown', (e) => {
    const map = {
      '1': () => SecretSystem._triggerRose(),
      '2': () => SecretSystem._triggerShh(),
      '3': () => SecretSystem._triggerScream(),
      '4': () => SecretSystem._triggerSmile(),
      '5': () => SecretSystem._triggerThink(),
    };
    map[e.key]?.();
  });
}

/**
 * AuraMeet AR - Core App & Connection Management
 * 
 * Module này quản lý:
 * 1. Thu thập Media Stream từ Camera/Mic với tối ưu lọc tiếng ồn, gió.
 * 2. Thiết lập Web Audio API để giám sát cường độ âm thanh đầu vào (Microphone volume).
 * 3. Chạy vòng lặp Camera tích hợp song song mô hình Face Mesh và Hands của MediaPipe.
 * 4. Khởi tạo kết nối PeerJS WebRTC thông qua mã Room ID, truyền tải luồng canvas AR kèm audio gốc đã lọc tạp âm.
 * 5. Điều khiển hành vi giao diện người dùng (Mute, Camera, Giao diện ngụy trang).
 */

// ==========================================
// 1. CẤU HÌNH & KHAI BÁO BIẾN TOÀN CỤC
// ==========================================
const localVideo = document.getElementById('localVideo');
const arCanvas = document.getElementById('arCanvas');
const remoteVideo = document.getElementById('remoteVideo');

// Các bảng điều khiển và Placeholder UI
const localPlaceholder = document.getElementById('localPlaceholder');
const remotePlaceholder = document.getElementById('remotePlaceholder');
const connectionStatus = document.getElementById('connectionStatus');
const displayPeerId = document.getElementById('displayPeerId');
const inputTargetPeerId = document.getElementById('inputTargetPeerId');

// Nút điều khiển
const btnMute = document.getElementById('btnMute');
const btnCamera = document.getElementById('btnCamera');
const btnEndCall = document.getElementById('btnEndCall');
const btnConnect = document.getElementById('btnConnect');
const btnCopyId = document.getElementById('btnCopyId');
const btnToggleSettings = document.getElementById('btnToggleSettings');
const btnCloseSettings = document.getElementById('btnCloseSettings');
const camouflagePanel = document.getElementById('camouflagePanel');

// Trạng thái phần cứng và cuộc gọi
let localStream = null;          // Chứa stream camera/mic gốc
let processedStream = null;     // Chứa stream Canvas AR + Mic để gửi qua WebRTC
let peer = null;                // Thực thể PeerJS
let currentCall = null;         // Cuộc gọi hiện tại
let audioContext = null;        // Phục vụ phân tích âm thanh
let audioAnalyser = null;
let micSourceNode = null;

let isMicEnabled = true;
let isCamEnabled = true;
let isMutedByGesture = false;   // Đánh dấu tắt mic do hành động Suỵt tay lên môi
let manualMicState = true;      // Trạng thái mic người dùng tự click chọn trước khi bị auto-mute

// ==========================================
// 2. KHỞI CHẠY KHỞI ĐỘNG HỆ THỐNG
// ==========================================
window.addEventListener('DOMContentLoaded', async () => {
  // Bước 1: Khởi động camera và lọc âm
  const streamStarted = await startLocalVideoAndAudio();
  
  if (streamStarted) {
    // Bước 2: Khởi tạo mô hình AI MediaPipe
    initMediaPipe();
    
    // Bước 3: Khởi chạy vòng lặp đưa luồng camera vào mô hình AI và vẽ lên canvas
    startAiLoop();
    
    // Bước 4: Khởi tạo máy chủ PeerJS kết nối WebRTC
    initPeerConnection();
  } else {
    localPlaceholder.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color: #ef4444;"></i><p>Không thể truy cập Camera/Microphone. Vui lòng cấp quyền và tải lại trang.</p>';
  }

  // Khởi tạo các sự kiện nút bấm trên giao diện
  setupUIEvents();
});

// ==========================================
// 3. KHỞI TẠO CAMERA & MICRO VỚI AI LỌC TIẾNG ỒN GIÓ
// ==========================================
async function startLocalVideoAndAudio() {
  try {
    // Cấu hình âm thanh tối ưu bắt buộc bật Echo, Noise và Gain
    const mediaConstraints = {
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30 },
        facingMode: 'user'
      },
      audio: {
        echoCancellation: true,      // Bắt buộc khử tiếng vang
        noiseSuppression: true,      // Bắt buộc lọc tiếng ồn (tiếng gió rít, tiếng quạt)
        autoGainControl: true        // Bắt buộc cân bằng âm lượng tự động
      }
    };

    localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
    
    // Đổ stream gốc vào hidden video element để cấp nguồn hình ảnh cho AI
    localVideo.srcObject = localStream;
    
    // Khởi tạo bộ đo phân tích âm lượng Micro (Web Audio API)
    setupAudioAnalysis(localStream);

    return true;
  } catch (error) {
    console.error('[App] Lỗi kết nối thiết bị Media:', error);
    return false;
  }
}

// Thiết lập Web Audio API để đo volume
function setupAudioAnalysis(stream) {
  try {
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) return;

    window.AudioContext = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioContext();
    
    // Tạo nguồn âm thanh từ stream microphone
    micSourceNode = audioContext.createMediaStreamSource(stream);
    audioAnalyser = audioContext.createAnalyser();
    audioAnalyser.fftSize = 256;
    
    micSourceNode.connect(audioAnalyser);
    
    // Khởi chạy đo cường độ âm lượng định kỳ
    const bufferLength = audioAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    const localVolumeBar = document.getElementById('localVolumeBar');

    function updateVolumeMeter() {
      if (!isMicEnabled || isMutedByGesture) {
        window.currentAudioVolume = 0;
        localVolumeBar.style.setProperty('--volume-level', '0%');
        requestAnimationFrame(updateVolumeMeter);
        return;
      }

      audioAnalyser.getByteFrequencyData(dataArray);
      
      // Tính toán giá trị trung bình cường độ âm thanh (RMS - Root Mean Square)
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / bufferLength);
      
      // Chuẩn hóa về thang đo từ 0 -> 1
      const normalizedVolume = Math.min(rms / 120, 1);
      window.currentAudioVolume = normalizedVolume; // Gán toàn cục để ar-ai.js đọc

      // Cập nhật thanh hiển thị volume meter trên UI
      localVolumeBar.style.setProperty('--volume-level', `${normalizedVolume * 100}%`);

      requestAnimationFrame(updateVolumeMeter);
    }
    
    updateVolumeMeter();
  } catch (e) {
    console.warn('[Audio Analyser] Trình duyệt không hỗ trợ Web Audio:', e);
  }
}

// ==========================================
// 4. CHẠY VÒNG LẶP AI MEDIAPIPE & CANVAS AR
// ==========================================
function startAiLoop() {
  // Ẩn placeholder đang tải camera khi nhận được luồng hình ảnh đầu tiên
  localVideo.onloadedmetadata = () => {
    localPlaceholder.style.display = 'none';
    arCanvas.style.display = 'block';
  };

  const canvasCtx = arCanvas.getContext('2d');

  async function processVideoFrame() {
    if (!localVideo.paused && !localVideo.ended && isCamEnabled) {
      const faceMesh = window.faceMeshInstance();
      const hands = window.handsInstance();

      // Đẩy khung hình video vào mô hình nhận diện khuôn mặt và tay song song (Parallel Processing)
      const tasks = [];
      if (faceMesh) {
        tasks.push(faceMesh.send({ image: localVideo }));
      }
      if (hands) {
        tasks.push(hands.send({ image: localVideo }));
      }

      try {
        await Promise.all(tasks);
      } catch (err) {
        console.error('[AI Loop] Lỗi xử lý frame:', err);
      }
    }
    
    // Vẽ đè hiệu ứng AR & vẽ khung hình đã xử lý lên Canvas
    renderCanvasOverlay(localVideo, arCanvas);
    
    requestAnimationFrame(processVideoFrame);
  }

  requestAnimationFrame(processVideoFrame);
}

// ==========================================
// 5. KHỞI TẠO MÁY CHỦ PEERJS & WEBRTC CALLS
// ==========================================
function initPeerConnection() {
  // Tạo PeerJS client mới kết nối tới server public miễn phí
  peer = new Peer({
    debug: 2
  });

  // Khi kết nối thành công, nhận mã Peer ID ngẫu nhiên từ server
  peer.on('open', (id) => {
    console.log('[WebRTC] Đã kết nối với PeerJS Server. ID: ' + id);
    displayPeerId.innerText = id;
    
    connectionStatus.querySelector('.status-dot').className = 'status-dot online';
    connectionStatus.querySelector('.status-text').innerText = 'Sẵn sàng kết nối';
  });

  // Nhận cuộc gọi đến (Incoming Call)
  peer.on('call', (incomingCall) => {
    console.log('[WebRTC] Phát hiện cuộc gọi đến từ: ' + incomingCall.peer);
    
    if (confirm(`Cuộc gọi đến từ phòng ${incomingCall.peer}. Nhấn OK để nhận cuộc gọi.`)) {
      // Khởi tạo luồng xử lý gửi đi (Canvas AR + Mic gốc đã lọc âm)
      prepareProcessedStream();
      
      incomingCall.answer(processedStream);
      handleCallStream(incomingCall);
    } else {
      incomingCall.close();
    }
  });

  peer.on('error', (err) => {
    console.error('[WebRTC] Lỗi kết nối Peer:', err);
    alert('Lỗi máy chủ kết nối PeerJS: ' + err.type);
    
    connectionStatus.querySelector('.status-dot').className = 'status-dot offline';
    connectionStatus.querySelector('.status-text').innerText = 'Lỗi kết nối';
  });
}

// Chuẩn bị luồng xử lý gồm Video từ Canvas AR/AI và Âm thanh gốc từ Mic
function prepareProcessedStream() {
  if (processedStream) return;

  // Lấy luồng video chất lượng cao từ canvas với tốc độ 30 FPS
  const canvasVideoStream = arCanvas.captureStream(30);
  const videoTrack = canvasVideoStream.getVideoTracks()[0];

  // Lấy luồng âm thanh gốc đã lọc gió/tiếng ồn từ microphone ban đầu
  const audioTracks = localStream.getAudioTracks();
  
  if (audioTracks.length > 0) {
    const audioTrack = audioTracks[0];
    // Kết hợp track video canvas và track audio mic thành 1 stream duy nhất
    processedStream = new MediaStream([videoTrack, audioTrack]);
  } else {
    // Không có micro, chỉ gửi luồng hình canvas
    processedStream = new MediaStream([videoTrack]);
  }
}

// Gọi kết nối tới một Peer ID mục tiêu
function callPeer(targetPeerId) {
  if (!targetPeerId) {
    alert('Vui lòng nhập mã phòng của đối tác cần gọi!');
    return;
  }
  
  if (targetPeerId === peer.id) {
    alert('Bạn không thể gọi cho chính mã phòng của mình!');
    return;
  }

  console.log('[WebRTC] Đang gọi điện tới: ' + targetPeerId);
  
  prepareProcessedStream();

  // Bắt đầu gọi
  const call = peer.call(targetPeerId, processedStream);
  handleCallStream(call);
}

// Xử lý luồng âm thanh/video truyền tải trong cuộc gọi đang diễn ra
function handleCallStream(call) {
  currentCall = call;
  
  // Cập nhật trạng thái nút bấm
  btnEndCall.disabled = false;
  btnConnect.disabled = true;
  btnConnect.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Đang gọi...';
  
  connectionStatus.querySelector('.status-text').innerText = 'Đang gọi: ' + call.peer;

  call.on('stream', (remoteStream) => {
    console.log('[WebRTC] Đã nhận được luồng Media của đối tác');
    
    // Ẩn placeholder của remote box
    remotePlaceholder.style.display = 'none';
    
    // Gán luồng nhận được vào thẻ video đối tác
    remoteVideo.srcObject = remoteStream;
  });

  call.on('close', () => {
    resetCallUI();
  });

  call.on('error', (err) => {
    console.error('[WebRTC] Lỗi xảy ra trong cuộc gọi:', err);
    resetCallUI();
  });
}

// Cúp máy, dọn dẹp các luồng và đưa UI về trạng thái mặc định
function endCall() {
  if (currentCall) {
    currentCall.close();
    resetCallUI();
  }
}

function resetCallUI() {
  console.log('[WebRTC] Cuộc gọi đã kết thúc');
  
  currentCall = null;
  remoteVideo.srcObject = null;
  
  // Hiện lại placeholder chờ kết nối
  remotePlaceholder.style.display = 'flex';
  
  // Khôi phục nút
  btnEndCall.disabled = true;
  btnConnect.disabled = false;
  btnConnect.innerHTML = '<i class="fa-solid fa-phone"></i> Gọi';
  
  if (peer && peer.id) {
    connectionStatus.querySelector('.status-text').innerText = 'Sẵn sàng kết nối';
  } else {
    connectionStatus.querySelector('.status-text').innerText = 'Mất kết nối máy chủ';
  }
}

// ==========================================
// 6. ĐIỀU KHIỂN THIẾT BỊ (MUTE/UNMUTE & CAMERA)
// ==========================================
function toggleMute() {
  if (!localStream) return;
  
  isMicEnabled = !isMicEnabled;
  manualMicState = isMicEnabled; // Ghi nhớ lựa chọn chủ động của người dùng

  applyMicHardwareState(isMicEnabled);
  updateMuteUI();
}

// Thực tế bật/tắt luồng thiết bị phần cứng
function applyMicHardwareState(isEnabled) {
  localStream.getAudioTracks().forEach(track => {
    track.enabled = isEnabled;
  });
}

function updateMuteUI() {
  if (isMicEnabled && !isMutedByGesture) {
    btnMute.classList.remove('active');
    btnMute.innerHTML = '<i class="fa-solid fa-microphone"></i>';
    btnMute.title = "Tắt tiếng";
  } else {
    btnMute.classList.add('active');
    btnMute.innerHTML = '<i class="fa-solid fa-microphone-slash" style="color: #ef4444;"></i>';
    btnMute.title = isMutedByGesture ? "Đã khóa tiếng ngầm (Cử chỉ Suỵt)" : "Bật tiếng";
  }
}

function toggleCamera() {
  if (!localStream) return;

  isCamEnabled = !isCamEnabled;
  
  localStream.getVideoTracks().forEach(track => {
    track.enabled = isCamEnabled;
  });

  if (isCamEnabled) {
    btnCamera.classList.remove('active');
    btnCamera.innerHTML = '<i class="fa-solid fa-video"></i>';
    btnCamera.title = "Tắt Camera";
    localPlaceholder.style.display = 'none';
  } else {
    btnCamera.classList.add('active');
    btnCamera.innerHTML = '<i class="fa-solid fa-video-slash" style="color: #ef4444;"></i>';
    btnCamera.title = "Bật Camera";
    localPlaceholder.style.display = 'flex';
    localPlaceholder.innerHTML = '<i class="fa-solid fa-video-slash"></i><p>Camera của bạn đã tắt</p>';
  }
}

// Lắng nghe sự kiện "shh-mute" từ ar-ai.js để kích hoạt tính năng tắt mic ngầm tự động
window.addEventListener('shh-mute', (event) => {
  const shouldMute = event.detail;

  if (shouldMute) {
    // Chỉ kích hoạt khóa tiếng nếu mic đang bật
    if (isMicEnabled) {
      isMutedByGesture = true;
      applyMicHardwareState(false);
      updateMuteUI();
      console.log('[AI Mic Control] Đã khóa tiếng tự động bằng cử chỉ Suỵt.');
    }
  } else {
    // Trả lại trạng thái ban đầu của mic khi bỏ ngón tay ra khỏi môi
    if (isMutedByGesture) {
      isMutedByGesture = false;
      isMicEnabled = manualMicState; // Khôi phục về lựa chọn thủ công của người dùng trước đó
      applyMicHardwareState(isMicEnabled);
      updateMuteUI();
      console.log('[AI Mic Control] Đã mở khóa tiếng.');
    }
  }
});

// ==========================================
// 7. XỬ LÝ SỰ KIỆN GIAO DIỆN & MENU NGỤY TRANG
// ==========================================
function setupUIEvents() {
  // Bật/Tắt Mic & Camera
  btnMute.addEventListener('click', toggleMute);
  btnCamera.addEventListener('click', toggleCamera);
  
  // Gọi & Cúp máy
  btnConnect.addEventListener('click', () => {
    const id = inputTargetPeerId.value.trim();
    callPeer(id);
  });
  
  btnEndCall.addEventListener('click', endCall);

  // Sao chép Peer ID vào bộ nhớ tạm (Clipboard)
  btnCopyId.addEventListener('click', () => {
    const idText = displayPeerId.innerText;
    if (idText && idText !== 'Đang tạo mã...') {
      navigator.clipboard.writeText(idText)
        .then(() => {
          const originalHTML = btnCopyId.innerHTML;
          btnCopyId.innerHTML = '<i class="fa-solid fa-check" style="color: var(--success-color);"></i>';
          setTimeout(() => btnCopyId.innerHTML = originalHTML, 2000);
        })
        .catch(err => console.error('Lỗi sao chép mã:', err));
    }
  });

  // Mở/Đóng bảng điều khiển ngụy trang AR
  btnToggleSettings.addEventListener('click', () => {
    camouflagePanel.classList.toggle('open');
  });

  btnCloseSettings.addEventListener('click', () => {
    camouflagePanel.classList.remove('open');
  });

  // Xử lý chọn các hiệu ứng AR ngụy trang trên menu
  const effectButtons = document.querySelectorAll('.effect-btn');
  effectButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      // Bỏ kích hoạt ở các nút khác
      effectButtons.forEach(b => b.classList.remove('active'));
      // Kích hoạt nút hiện tại
      btn.classList.add('active');
      // Thiết lập hiệu ứng AR tương ứng trong ar-ai.js
      const effectName = btn.getAttribute('data-effect');
      window.AR_STATE.activeCamouflageEffect = effectName;
      
      console.log('[Camouflage Menu] Đã áp dụng hiệu ứng: ' + effectName);
    });
  });

  // Điều khiển thanh trượt Làm mờ nền ảo ngụy trang (Virtual Background Blur)
  const sliderBlur = document.getElementById('sliderBlur');
  const lblBlurValue = document.getElementById('lblBlurValue');
  
  sliderBlur.addEventListener('input', (event) => {
    const val = parseInt(event.target.value);
    // Lưu độ mờ nền vào AR State
    window.AR_STATE.backgroundBlurAmount = val;
    // Cập nhật text giá trị phần trăm tượng trưng hiển thị trên giao diện
    lblBlurValue.innerText = `${val * 5}%`;
  });
}

/**
 * peer.js
 * ============================================================
 * Module quản lý kết nối WebRTC qua PeerJS.
 *
 * Chức năng:
 *  - Tạo Peer instance với STUN/TURN servers tối ưu
 *  - Lấy media stream với audio constraints chống tiếng ồn gió
 *  - Quản lý luồng tạo phòng (host) và tham gia phòng (join)
 *  - Xử lý kết nối, ngắt kết nối và hangup
 *  - Tạo GainNode để SecretSystem điều chỉnh volume mic
 *  - Cung cấp API để app.js điều khiển mic/camera
 * ============================================================
 */

const PeerModule = (() => {

  // ─── PeerJS instance ───────────────────────────────────────
  let peer = null;
  let conn = null;         // DataConnection (không dùng, nhưng giữ sẵn)
  let mediaConn = null;    // MediaConnection (cuộc gọi video)

  // ─── Media streams ─────────────────────────────────────────
  let localStream  = null; // Stream từ camera/mic local
  let remoteStream = null; // Stream từ peer bên kia

  // ─── Audio processing ──────────────────────────────────────
  let audioContext   = null;
  let gainNode       = null;
  let sourceNode     = null;
  let destinationNode= null;
  let processedStream= null; // Stream sau khi đã qua GainNode

  // ─── Room info ─────────────────────────────────────────────
  let myRoomId  = null;  // ID của peer này (= Room ID)
  let targetId  = null;  // ID của peer muốn gọi

  // ─── Trạng thái track ──────────────────────────────────────
  let micEnabled = true;
  let camEnabled = true;

  // ─── Callback để app.js xử lý sự kiện ────────────────────
  const callbacks = {
    onConnected:     null,  // khi có người join
    onDisconnected:  null,  // khi người kia ngắt
    onRemoteStream:  null,  // khi có stream từ xa
    onError:         null,  // khi có lỗi
    onReady:         null,  // khi peer đã sẵn sàng (có myRoomId)
  };

  // ===========================================================
  //  CẤU HÌNH ICE SERVERS (STUN/TURN)
  // ===========================================================

  /**
   * Danh sách ICE servers tối ưu cho kết nối WebRTC.
   * Dùng nhiều STUN server để tăng khả năng NAT traversal.
   * TURN server là fallback khi STUN không vượt qua được NAT.
   */
  const ICE_SERVERS = [
    // STUN servers miễn phí
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    // STUN từ Twilio (miễn phí)
    { urls: 'stun:global.stun.twilio.com:3478' },
    // ⚠️ NẾU CẦN TURN SERVER:
    // Bỏ comment và thay bằng thông tin TURN server của bạn:
    // {
    //   urls: 'turn:your-turn-server.com:3478',
    //   username: 'your-username',
    //   credential: 'your-password',
    // },
  ];

  /**
   * Cấu hình PeerJS.
   * Dùng PeerJS cloud broker (peerjs.com) mặc định.
   * Để self-host PeerServer:
   *   host: 'your-server.com', port: 9000, path: '/peer'
   */
  const PEER_CONFIG = {
    debug: 1, // 0: không log, 1: lỗi, 2: warn, 3: all
    config: {
      iceServers: ICE_SERVERS,
      iceTransportPolicy: 'all', // 'relay' để bắt buộc dùng TURN
      sdpSemantics: 'unified-plan',
      bundlePolicy: 'max-bundle',
    },
  };

  // ===========================================================
  //  LẤY MEDIA STREAM VỚI AUDIO CONSTRAINTS TỐI ƯU
  // ===========================================================

  /**
   * Lấy camera và microphone với cấu hình audio xử lý tiếng ồn.
   *
   * Các constraint audio bắt buộc:
   *  - noiseSuppression: Lọc tiếng ồn nền (gió, phòng)
   *  - echoCancellation: Triệt tiếng echo từ loa
   *  - autoGainControl:  Tự động cân bằng âm lượng
   *  - sampleRate:       44100 Hz – chất lượng cao
   *
   * @returns {MediaStream}
   */
  async function getLocalMedia() {
    const constraints = {
      video: {
        width:      { ideal: 1280, max: 1920 },
        height:     { ideal: 720,  max: 1080 },
        frameRate:  { ideal: 30,   max: 60 },
        facingMode: 'user', // camera trước
      },
      audio: {
        // ─── BẮT BUỘC bật lọc tiếng ồn ──────────────────
        noiseSuppression:   { exact: true },  // lọc tiếng gió, ồn nền
        echoCancellation:   { exact: true },  // triệt echo
        autoGainControl:    { exact: true },  // cân bằng âm lượng
        // ─── Tối ưu chất lượng âm thanh ──────────────────
        sampleRate:         44100,
        channelCount:       { ideal: 1 },  // mono – ít băng thông hơn
        latency:            { ideal: 0.02 }, // 20ms latency
        // ─── Không gian xử lý ────────────────────────────
        googNoiseSuppression:     true,  // Chrome-specific
        googEchoCancellation:     true,
        googAutoGainControl:      true,
        googHighpassFilter:       true,  // lọc tần số thấp không cần thiết
        googAudioMirroring:       false,
      },
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('[Peer] Đã lấy media stream với audio constraints tối ưu');
      return stream;
    } catch (err) {
      console.error('[Peer] Lỗi getUserMedia:', err);
      // Thử fallback với constraints đơn giản hơn
      const fallbackConstraints = {
        video: true,
        audio: {
          noiseSuppression: true,
          echoCancellation: true,
          autoGainControl:  true,
        },
      };
      console.warn('[Peer] Thử fallback constraints...');
      return navigator.mediaDevices.getUserMedia(fallbackConstraints);
    }
  }

  // ===========================================================
  //  XỬ LÝ AUDIO QUA WEB AUDIO API
  // ===========================================================

  /**
   * Tạo pipeline xử lý audio:
   *   MediaStream → MediaStreamSource → GainNode → MediaStreamDestination
   *
   * GainNode cho phép secret.js điều chỉnh volume mic theo thời gian thực.
   *
   * @param {MediaStream} stream – stream thô từ getUserMedia
   * @returns {MediaStream} – stream đã qua GainNode
   */
  function setupAudioProcessing(stream) {
    audioContext    = new (window.AudioContext || window.webkitAudioContext)();
    sourceNode      = audioContext.createMediaStreamSource(stream);
    gainNode        = audioContext.createGain();
    destinationNode = audioContext.createMediaStreamDestination();

    // Gain mặc định = 1 (không thay đổi)
    gainNode.gain.value = 1.0;

    // Pipeline: source → gain → destination
    sourceNode.connect(gainNode);
    gainNode.connect(destinationNode);

    // Tạo stream mới kết hợp: audio đã xử lý + video gốc
    const processedAudioTrack = destinationNode.stream.getAudioTracks()[0];
    const videoTracks         = stream.getVideoTracks();

    processedStream = new MediaStream([...videoTracks, processedAudioTrack]);

    // Thông báo cho SecretSystem để điều khiển gain
    SecretSystem.setMicGain(gainNode, 1.0);

    console.log('[Peer] Audio pipeline đã thiết lập');
    return processedStream;
  }

  // ===========================================================
  //  KHỞI TẠO PEER
  // ===========================================================

  /**
   * Khởi tạo toàn bộ module:
   *  1. Lấy media stream
   *  2. Thiết lập audio processing
   *  3. Tạo Peer instance
   *
   * @param {Object} cbs – callbacks { onReady, onConnected, onDisconnected, onRemoteStream, onError }
   */
  async function init(cbs = {}) {
    Object.assign(callbacks, cbs);

    try {
      // 1. Lấy media stream
      localStream = await getLocalMedia();
      console.log('[Peer] Đã lấy local stream');

      // 2. Thiết lập audio processing
      processedStream = setupAudioProcessing(localStream);

      // 3. Tạo Peer với ID ngẫu nhiên (= Room ID)
      peer = new Peer(undefined, PEER_CONFIG);

      peer.on('open', (id) => {
        myRoomId = id;
        console.log(`[Peer] Peer đã sẵn sàng. Room ID: ${id}`);
        callbacks.onReady?.(id);
      });

      peer.on('call', handleIncomingCall);

      peer.on('error', (err) => {
        console.error('[Peer] Lỗi Peer:', err.type, err);
        callbacks.onError?.(err);
      });

      peer.on('disconnected', () => {
        console.warn('[Peer] Mất kết nối đến PeerServer. Đang thử kết nối lại...');
        peer.reconnect();
      });

    } catch (err) {
      console.error('[Peer] Lỗi khởi tạo:', err);
      callbacks.onError?.(err);
    }
  }

  // ===========================================================
  //  TẠO PHÒNG (HOST)
  // ===========================================================

  /**
   * Peer này sẽ là host. Chờ người khác gọi vào.
   * Room ID = myRoomId (đã được set khi peer 'open')
   */
  function createRoom() {
    if (!peer || !myRoomId) {
      console.error('[Peer] Peer chưa sẵn sàng để tạo phòng');
      return;
    }
    console.log(`[Peer] Đang chờ người dùng join vào phòng: ${myRoomId}`);
    // Host chỉ cần chờ – handleIncomingCall sẽ được gọi tự động
  }

  // ===========================================================
  //  THAM GIA PHÒNG (JOIN)
  // ===========================================================

  /**
   * Gọi đến peer khác bằng Room ID của họ.
   * @param {string} roomId – Room ID của người muốn gọi
   */
  function joinRoom(roomId) {
    if (!peer) {
      console.error('[Peer] Peer chưa khởi tạo');
      return;
    }

    targetId = roomId.trim();
    console.log(`[Peer] Đang gọi đến: ${targetId}`);

    // Gọi video với stream đã qua audio processing
    const call = peer.call(targetId, processedStream, {
      metadata: { name: 'AR Video Call User' },
    });

    if (!call) {
      console.error('[Peer] Không thể tạo cuộc gọi – kiểm tra Room ID');
      callbacks.onError?.({ type: 'invalid-id', message: 'Room ID không hợp lệ' });
      return;
    }

    handleCallEvents(call);
  }

  // ===========================================================
  //  XỬ LÝ CUỘC GỌI ĐẾN (HOST SIDE)
  // ===========================================================

  /**
   * Xử lý khi có người gọi vào.
   * @param {MediaConnection} call
   */
  function handleIncomingCall(call) {
    console.log(`[Peer] Có cuộc gọi đến từ: ${call.peer}`);
    targetId = call.peer;

    // Trả lời bằng stream của mình
    call.answer(processedStream);
    handleCallEvents(call);
  }

  // ===========================================================
  //  XỬ LÝ EVENTS CỦA CUỘC GỌI
  // ===========================================================

  /**
   * Đăng ký event listeners cho MediaConnection.
   * @param {MediaConnection} call
   */
  function handleCallEvents(call) {
    mediaConn = call;

    call.on('stream', (stream) => {
      remoteStream = stream;
      console.log('[Peer] Đã nhận stream từ remote');
      callbacks.onRemoteStream?.(stream);
      callbacks.onConnected?.();
    });

    call.on('close', () => {
      console.log('[Peer] Cuộc gọi đã đóng');
      remoteStream = null;
      mediaConn    = null;
      callbacks.onDisconnected?.();
    });

    call.on('error', (err) => {
      console.error('[Peer] Lỗi cuộc gọi:', err);
      callbacks.onError?.(err);
    });

    // Ping keepalive mỗi 10 giây để giữ kết nối không bị timeout
    const keepAliveInterval = setInterval(() => {
      if (!mediaConn || !mediaConn.open) {
        clearInterval(keepAliveInterval);
        return;
      }
      // Gửi DTMF hoặc data channel keepalive (PeerJS tự xử lý)
    }, 10000);
  }

  // ===========================================================
  //  ĐIỀU KHIỂN MIC & CAMERA
  // ===========================================================

  /** Bật/tắt microphone. */
  function toggleMic() {
    if (!localStream) return micEnabled;
    micEnabled = !micEnabled;
    localStream.getAudioTracks().forEach(track => {
      track.enabled = micEnabled;
    });
    console.log(`[Peer] Mic: ${micEnabled ? 'BẬT' : 'TẮT'}`);
    return micEnabled;
  }

  /** Bật/tắt camera. */
  function toggleCamera() {
    if (!localStream) return camEnabled;
    camEnabled = !camEnabled;
    localStream.getVideoTracks().forEach(track => {
      track.enabled = camEnabled;
    });
    console.log(`[Peer] Camera: ${camEnabled ? 'BẬT' : 'TẮT'}`);
    return camEnabled;
  }

  // ===========================================================
  //  KẾT THÚC CUỘC GỌI
  // ===========================================================

  /** Kết thúc cuộc gọi và dọn dẹp tài nguyên. */
  function hangup() {
    console.log('[Peer] Kết thúc cuộc gọi...');

    // Đóng MediaConnection
    if (mediaConn) {
      mediaConn.close();
      mediaConn = null;
    }

    // Dừng tất cả tracks của local stream
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
    }

    // Đóng AudioContext
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }

    // Đóng Peer
    if (peer) {
      peer.destroy();
      peer = null;
    }

    console.log('[Peer] Đã dọn dẹp tài nguyên');
    callbacks.onDisconnected?.();
  }

  // ===========================================================
  //  PUBLIC API
  // ===========================================================

  return {
    init,
    createRoom,
    joinRoom,
    hangup,
    toggleMic,
    toggleCamera,
    get localStream()   { return localStream; },
    get myRoomId()      { return myRoomId; },
    get micEnabled()    { return micEnabled; },
    get camEnabled()    { return camEnabled; },
    get isConnected()   { return !!mediaConn && mediaConn.open; },
  };

})();

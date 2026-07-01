const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('gameCanvas');
const canvasCtx = canvasElement.getContext('2d');

// DOM Elements
const lobbyScreen = document.getElementById('lobby-screen');
const hudContainer = document.getElementById('hud-container');
const gameOverScreen = document.getElementById('game-over-screen');
const networkStatus = document.getElementById('network-status');
const hostBtn = document.getElementById('host-btn');
const joinBtn = document.getElementById('join-btn');
const roomInput = document.getElementById('room-input');
const vsBanner = document.getElementById('vs-banner');
const timerEl = document.getElementById('match-timer');

let scoreP1 = 0, scoreP2 = 0;
let timeLeft = 60;
let gameActive = false;
let isHost = false;
let conn = null;
let peer = null;

let aliens = [];
let lasers = [];
let explosions = [];

let localPlayer = { x: 0.5, y: 0.5, fist: false, cooldown: false, active: false };
let remotePlayer = { x: 0.5, y: 0.5, fist: false, active: false };

// Audio System
let audioCtx = null;
function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}
function playSound(type) {
    if (!audioCtx) return;
    let osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    if (type === 'laser') {
        osc.type = 'sawtooth'; osc.frequency.setValueAtTime(600, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(80, audioCtx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime); osc.start(); osc.stop(audioCtx.currentTime + 0.15);
    } else if (type === 'hit') {
        osc.type = 'triangle'; osc.frequency.setValueAtTime(150, audioCtx.currentTime);
        osc.frequency.linearRampToValueAtTime(30, audioCtx.currentTime + 0.25);
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime); osc.start(); osc.stop(audioCtx.currentTime + 0.25);
    }
}

// Generate unique 4-character room code
function generateRoomCode() {
    const chars = '0123456789ABCDEF';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

function setupNetwork() {
    networkStatus.innerText = "READY TO HOST OR JOIN.";
    hostBtn.disabled = false;
    joinBtn.disabled = false;
}

// HOST A NEW GAME
hostBtn.addEventListener('click', () => {
    initAudio();
    isHost = true;
    const roomCode = generateRoomCode();
    vsBanner.innerText = `ROOM: ${roomCode}`;
    networkStatus.innerText = "CREATING LOBBY...";

    // Direct ID mapping fix for PeerJS cloud stability
    peer = new Peer(`ar-space-${roomCode}`);

    peer.on('open', () => {
        networkStatus.innerText = `ROOM CREATED! CODE: ${roomCode}. AWAITING PLAYER 2...`;
        hostBtn.disabled = true;
        joinBtn.disabled = true;
    });

    peer.on('connection', (incomingConn) => {
        if (conn) return; 
        conn = incomingConn;
        setupChatLink();
    });

    peer.on('error', (err) => {
        console.error(err);
        networkStatus.innerText = "LOBBY ERROR. PLEASE TRY AGAIN.";
    });
});

// JOIN AN EXISTING GAME
joinBtn.addEventListener('click', () => {
    initAudio();
    const targetCode = roomInput.value.trim().toUpperCase();
    if (targetCode.length < 4) return;
    
    networkStatus.innerText = "WARPING INTO LOBBY PANEL...";
    isHost = false;
    vsBanner.innerText = `ROOM: ${targetCode}`;

    peer = new Peer();

    peer.on('open', () => {
        // Direct route connection straight to the host node
        conn = peer.connect(`ar-space-${targetCode}`);
        setupChatLink();
    });

    peer.on('error', (err) => {
        console.error(err);
        networkStatus.innerText = "CONNECTION FAILED. CHECK CODE.";
    });
});

function setupChatLink() {
    conn.on('open', () => {
        lobbyScreen.classList.add('hidden');
        hudContainer.classList.remove('hidden');
        gameActive = true;
        
        if (isHost) {
            startMatchEngine();
        }
    });

    conn.on('data', (data) => {
        if (data.type === 'sync') {
            aliens = data.aliens;
            scoreP1 = data.scoreP1;
            scoreP2 = data.scoreP2;
            timeLeft = data.timeLeft;
            timerEl.innerText = timeLeft;
        }
        if (data.type === 'input') {
            remotePlayer.x = data.x;
            remotePlayer.y = data.y;
            remotePlayer.fist = data.fist;
            remotePlayer.active = true;
        }
        if (data.type === 'laser') {
            lasers.push(data.laser);
            playSound('laser');
        }
        if (data.type === 'hit') {
            explosions.push(data.exp);
            playSound('hit');
        }
        if (data.type === 'gameover') {
            endMatchDisplay(data.s1, data.s2);
        }
    });
}

function startMatchEngine() {
    setInterval(() => {
        if (!gameActive) return;
        if (aliens.length < 5) {
            aliens.push({
                id: Math.random().toString(36).substring(2, 7),
                x: 0.1 + Math.random() * 0.8,
                y: -0.05,
                speed: 0.003 + Math.random() * 0.004
            });
        }
        
        timeLeft--;
        if (timeLeft <= 0) {
            gameActive = false;
            conn.send({ type: 'gameover', s1: scoreP1, s2: scoreP2 });
            endMatchDisplay(scoreP1, scoreP2);
        }
    }, 1000);
}

function fireLocalLaser() {
    let myColor = isHost ? "#00ffff" : "#ff0055";
    let startX = isHost ? 0.1 : 0.9;
    
    let laserObj = { startX, startY: 1.0, curX: startX, curY: 1.0, targetX: localPlayer.x, targetY: localPlayer.y, progress: 0, color: myColor };
    lasers.push(laserObj);
    playSound('laser');
    
    conn.send({ type: 'laser', laser: laserObj });
}

function onResults(results) {
    canvasElement.width = window.innerWidth;
    canvasElement.height = window.innerHeight;
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    localPlayer.active = false;

    if (gameActive && results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        const wrist = landmarks[0];
        const middleBase = landmarks[9];
        
        localPlayer.x = 1.0 - ((wrist.x + middleBase.x) / 2);
        localPlayer.y = (wrist.y + middleBase.y) / 2;
        localPlayer.active = true;

        let handSize = Math.sqrt(Math.pow(landmarks[5].x - wrist.x, 2) + Math.pow(landmarks[5].y - wrist.y, 2));
        let tipToWrist = Math.sqrt(Math.pow(landmarks[8].x - wrist.x, 2) + Math.pow(landmarks[8].y - wrist.y, 2));
        let isFist = tipToWrist < handSize * 1.25;

        if (isFist && !localPlayer.cooldown) {
            localPlayer.cooldown = true;
            fireLocalLaser();
            setTimeout(() => { localPlayer.cooldown = false; }, 350);
        }
        
        conn.send({ type: 'input', x: localPlayer.x, y: localPlayer.y, fist: isFist });
    }

    renderGraphicsFrame();
}

function renderGraphicsFrame() {
    const w = canvasElement.width;
    const h = canvasElement.height;

    for (let i = aliens.length - 1; i >= 0; i--) {
        let a = aliens[i];
        if (isHost && gameActive) a.y += a.speed;

        canvasCtx.beginPath();
        canvasCtx.ellipse(a.x * w, a.y * h, 30, 13, 0, 0, Math.PI * 2);
        canvasCtx.fillStyle = "rgba(10,10,20,0.8)"; canvasCtx.fill();
        canvasCtx.strokeStyle = "#00ff88"; canvasCtx.lineWidth = 3; canvasCtx.stroke();

        if (isHost && a.y > 1.05) aliens.splice(i, 1);
    }

    for (let i = lasers.length - 1; i >= 0; i--) {
        let l = lasers[i];
        l.progress += 0.15;
        l.curX = l.startX + (l.targetX - l.startX) * l.progress;
        l.curY = l.startY + (l.targetY - l.startY) * l.progress;

        canvasCtx.beginPath();
        canvasCtx.moveTo(l.startX * w, l.startY * h);
        canvasCtx.lineTo(l.curX * w, l.curY * h);
        canvasCtx.strokeStyle = l.color; canvasCtx.lineWidth = 5; canvasCtx.stroke();

        if (l.progress >= 1) {
            if (isHost && gameActive) {
                for (let j = aliens.length - 1; j >= 0; j--) {
                    let a = aliens[j];
                    let hitDist = Math.sqrt(Math.pow((l.curX - a.x) * w, 2) + Math.pow((l.curY - a.y) * h, 2));
                    if (hitDist < 45) {
                        let expObj = { x: a.x, y: a.y, r: 10 };
                        explosions.push(expObj); playSound('hit');
                        conn.send({ type: 'hit', exp: expObj });
                        
                        aliens.splice(j, 1);
                        if (l.color === "#00ffff") scoreP1 += 10; else scoreP2 += 10;
                        break;
                    }
                }
            }
            lasers.splice(i, 1);
        }
    }

    for (let i = explosions.length - 1; i >= 0; i--) {
        let e = explosions[i]; e.r += 4;
        canvasCtx.beginPath(); canvasCtx.arc(e.x * w, e.y * h, e.r, 0, Math.PI * 2);
        canvasCtx.fillStyle = `rgba(255,100,0,${1 - e.r/50})`; canvasCtx.fill();
        if (e.r >= 50) explosions.splice(i, 1);
    }

    let p1Data = isHost ? localPlayer : remotePlayer;
    let p2Data = isHost ? remotePlayer : localPlayer;

    if (p1Data.active) {
        canvasCtx.beginPath(); canvasCtx.arc(p1Data.x * w, p1Data.y * h, 25, 0, Math.PI * 2);
        canvasCtx.strokeStyle = "#00ffff"; canvasCtx.lineWidth = 3; canvasCtx.stroke();
    }
    if (p2Data.active) {
        canvasCtx.beginPath(); canvasCtx.arc(p2Data.x * w, p2Data.y * h, 25, 0, Math.PI * 2);
        canvasCtx.strokeStyle = "#ff0055"; canvasCtx.lineWidth = 3; canvasCtx.stroke();
    }

    document.getElementById('p1-score').innerText = scoreP1;
    document.getElementById('p2-score').innerText = scoreP2;
    timerEl.innerText = timeLeft;

    if (isHost && gameActive) {
        conn.send({ type: 'sync', aliens, scoreP1, scoreP2, timeLeft });
    }
}

function endMatchDisplay(s1, s2) {
    gameActive = false;
    document.getElementById('final-p1').innerText = s1;
    document.getElementById('final-p2').innerText = s2;
    
    const winEl = document.getElementById('winner-announcement');
    if (s1 > s2) {
        winEl.innerText = "HOST WINS MATCH!"; winEl.style.color = "#00ffff";
    } else if (s2 > s1) {
        winEl.innerText = "GUEST WINS MATCH!"; winEl.style.color = "#ff0055";
    } else {
        winEl.innerText = "DEADHEAT TIE MATCH!"; winEl.style.color = "#fff";
    }
    gameOverScreen.classList.remove('hidden');
}

document.getElementById('restart-btn').addEventListener('click', () => {
    location.reload();
});

setupNetwork();
const hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
hands.onResults(onResults);

const camera = new Camera(videoElement, {
    onFrame: async () => { await hands.send({ image: videoElement }); },
    width: 1280, height: 720
});
camera.start();

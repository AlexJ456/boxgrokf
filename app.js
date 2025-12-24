document.addEventListener('DOMContentLoaded', () => {
    const app = document.getElementById('app-content');
    const canvas = document.getElementById('box-canvas');
    const container = document.querySelector('.container');
    
    function resizeCanvas() {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    const state = {
        isPlaying: false,
        count: 0,
        countdown: 4,
        totalTime: 0,
        soundEnabled: localStorage.getItem('soundEnabled') === 'true',
        hapticsEnabled: localStorage.getItem('hapticsEnabled') === 'true' && 'vibrate' in navigator,
        mode: localStorage.getItem('mode') || 'dark',
        timeLimit: localStorage.getItem('timeLimit') || '',
        sessionComplete: false,
        timeLimitReached: false,
        phaseTime: parseInt(localStorage.getItem('phaseTime')) || 4,
        currentPattern: localStorage.getItem('currentPattern') || 'box',
        phasesCompleted: 0,
        pulseStartTime: null,
        audioContext: new (window.AudioContext || window.webkitAudioContext)(),
        backgroundAudio: null,
        backgroundEnabled: localStorage.getItem('backgroundEnabled') === 'true'
    };
    
    document.body.classList.toggle('light', state.mode === 'light');
    
    const patterns = {
        box: { inh: 4, hold: 4, exh: 4, holdOut: 4, desc: 'Equal phases for focus.' },
        '4-7-8': { inh: 4, hold: 7, exh: 8, holdOut: 0, desc: 'Inhale quickly, hold, exhale slowly.' },
        diaphragm: { inh: 6, hold: 2, exh: 6, holdOut: 0, desc: 'Slow deep breaths.' },
        custom: { inh: 4, hold: 4, exh: 4, holdOut: 4, desc: 'Customize bellow.' }
    };
    
    let wakeLock = null;
    let interval;
    let animationFrameId;
    let lastStateUpdate = 0;
    
    const icons = {
        play: `<svg class="icon" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`,
        pause: `<svg class="icon" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`,
        volume2: `<svg class="icon" viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`,
        volumeX: `<svg class="icon" viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`,
        rotateCcw: `<svg class="icon" viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>`,
        clock: `<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
        sun: `<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="4.22" x2="19.78" y2="5.56"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="19.78" x2="19.78" y2="18.36"></line></svg>`
    };
    
    function getInstruction(count) {
        const instr = ['Inhale', 'Hold', 'Exhale', 'Wait'];
        return instr[count] || '';
    }
    
    function formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    
    function playTone(duration, frequency = 440) {
        if (state.soundEnabled && state.audioContext) {
            try {
                state.audioContext.resume().then(() => {
                    const oscillator = state.audioContext.createOscillator();
                    oscillator.type = 'sine';
                    oscillator.frequency.setValueAtTime(frequency, state.audioContext.currentTime);
                    oscillator.connect(state.audioContext.destination);
                    oscillator.start();
                    oscillator.stop(state.audioContext.currentTime + duration);
                });
            } catch (e) {
                console.error('Error playing tone:', e);
            }
        }
    }
    
    function vibrate(pattern) {
        if (state.hapticsEnabled && navigator.vibrate) {
            navigator.vibrate(pattern || 100);
        }
    }
    
    async function requestWakeLock() {
        if ('wakeLock' in navigator) {
            try {
                wakeLock = await navigator.wakeLock.request('screen');
                console.log('Wake lock active');
            } catch (err) {
                console.error('Wake lock failed:', err);
            }
        }
    }
    
    function releaseWakeLock() {
        if (wakeLock) {
            wakeLock.release().then(() => {
                wakeLock = null;
                console.log('Wake lock released');
            }).catch(err => console.error('Release wake lock failed:', err));
        }
    }
    
    function togglePlay() {
        state.isPlaying = !state.isPlaying;
        if (state.isPlaying) {
            const pat = patterns[state.currentPattern];
            state.countdown = pat[state.count === 0 ? 'inh' : (state.count === 1 ? 'hold' : state.count === 2 ? 'exh' : 'holdOut')];
            state.totalTime = 0;
            state.phasesCompleted = 0;
            state.sessionComplete = false;
            state.timeLimitReached = false;
            playTone(0.1);
            vibrate();
            if (state.backgroundEnabled) startBackgroundAudio();
            startInterval();
            animate();
            requestWakeLock();
        } else {
            clearInterval(interval);
            cancelAnimationFrame(animationFrameId);
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            releaseWakeLock();
            stopBackgroundAudio();
        }
        render();
    }
    
    function resetToStart() {
        state.isPlaying = false;
        state.totalTime = 0;
        state.countdown = state.phaseTime;
        state.count = 0;
        state.phasesCompleted = 0;
        state.sessionComplete = false;
        state.timeLimit = '';
        state.timeLimitReached = false;
        clearInterval(interval);
        cancelAnimationFrame(animationFrameId);
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        releaseWakeLock();
        stopBackgroundAudio();
        render();
    }
    
    function toggleSound() {
        state.soundEnabled = !state.soundEnabled;
        localStorage.setItem('soundEnabled', state.soundEnabled);
        render();
    }
    
    function toggleHaptics() {
        state.hapticsEnabled = !state.hapticsEnabled;
        localStorage.setItem('hapticsEnabled', state.hapticsEnabled);
        render();
    }
    
    function toggleMode() {
        state.mode = state.mode === 'dark' ? 'light' : 'dark';
        localStorage.setItem('mode', state.mode);
        document.body.classList.toggle('light', state.mode === 'light');
        render();
    }
    
    function toggleBackground() {
        state.backgroundEnabled = !state.backgroundEnabled;
        localStorage.setItem('backgroundEnabled', state.backgroundEnabled);
        if (state.isPlaying) {
            state.backgroundEnabled ? startBackgroundAudio() : stopBackgroundAudio();
        }
        render();
    }
    
    function startBackgroundAudio() {
        // Placeholder: Load a short ambient sound; replace with actual URL if available
        if (!state.backgroundAudio && state.backgroundEnabled) {
            state.backgroundAudio = new Audio('https://example.com/ambient.mp3'); // Replace with real URL or embed
            state.backgroundAudio.loop = true;
            state.backgroundAudio.volume = 0.5;
            state.backgroundAudio.play().catch(console.error);
        }
    }
    
    function stopBackgroundAudio() {
        if (state.backgroundAudio) {
            state.backgroundAudio.pause();
            state.backgroundAudio.currentTime = 0;
        }
    }
    
    function handleTimeLimitChange(e) {
        state.timeLimit = e.target.value.replace(/[^0-9]/g, '');
        localStorage.setItem('timeLimit', state.timeLimit);
    }
    
    function startWithPreset(minutes) {
        state.timeLimit = minutes.toString();
        localStorage.setItem('timeLimit', state.timeLimit);
        togglePlay();
    }
    
    function changePattern(pat) {
        state.currentPattern = pat;
        localStorage.setItem('currentPattern', pat);
        state.phaseTime = Object.values(patterns[pat]).filter(v => typeof v === 'number')[0]; // Auto-adjust
        localStorage.setItem('phaseTime', state.phaseTime);
        render();
    }
    
    function startInterval() {
        clearInterval(interval);
        lastStateUpdate = performance.now();
        interval = setInterval(() => {
            state.totalTime += 1;
            if (state.timeLimit && !state.timeLimitReached) {
                const timeLimitSeconds = parseInt(state.timeLimit) * 60;
                if (state.totalTime >= timeLimitSeconds) {
                    state.timeLimitReached = true;
                }
            }
            if (state.countdown === 1) {
                state.count = (state.count + 1) % 4;
                state.pulseStartTime = performance.now();
                state.phasesCompleted++;
                playTone(0.2, state.count === 0 ? 440 : state.count === 1 ? 523 : state.count === 2 ? 659 : 784);
                vibrate(state.count === 0 ? [100] : [200]);
                const pat = patterns[state.currentPattern];
                state.countdown = pat[state.count === 0 ? 'inh' : (state.count === 1 ? 'hold' : state.count === 2 ? 'exh' : (pat.holdOut ? 'holdOut' : 'inh'))];
                if (state.count === 3 && state.timeLimitReached) {
                    state.sessionComplete = true;
                    state.isPlaying = false;
                    clearInterval(interval);
                    cancelAnimationFrame(animationFrameId);
                    releaseWakeLock();
                    stopBackgroundAudio();
                }
            } else {
                state.countdown -= 1;
            }
            lastStateUpdate = performance.now();
            render();
        }, 1000);
    }
    
    function animate() {
        if (!state.isPlaying) return;
        const ctx = canvas.getContext('2d');
        const elapsed = (performance.now() - lastStateUpdate) / 1000;
        const pat = patterns[state.currentPattern];
        const phaseDur = pat[state.count === 0 ? 'inh' : (state.count === 1 ? 'hold' : state.count === 2 ? 'exh' : 'holdOut')] || pat.inh;
        let progress = (phaseDur - state.countdown + elapsed) / phaseDur;
        progress = Math.max(0, Math.min(1, progress));
        const points = [
            {x: 40, y: canvas.height - 40},
            {x: 40, y: 40},
            {x: canvas.width - 40, y: 40},
            {x: canvas.width - 40, y: canvas.height - 40}
        ];
        const startPoint = points[state.count];
        const endPoint = points[(state.count + 1) % 4];
        const x = startPoint.x + progress * (endPoint.x - startPoint.x);
        const y = startPoint.y + progress * (endPoint.y - startPoint.y);
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#d97706';
        ctx.lineWidth = 4;
        ctx.strokeRect(40, 40, canvas.width - 80, canvas.height - 80);
        
        let radius = 5;
        if (state.pulseStartTime !== null) {
            const pulseElapsed = (performance.now() - state.pulseStartTime) / 1000;
            if (pulseElapsed < 0.5) {
                const factor = Math.sin(Math.PI * pulseElapsed / 0.5);
                radius = 5 + 10 * factor;
            }
        }
        
        // Gradient background for circle
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, '#ff0000');
        gradient.addColorStop(1, '#ff6666');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.fill();
        
        animationFrameId = requestAnimationFrame(animate);
    }
    
    function render() {
        let html = `<h1>Box Breathing</h1>`;
        if (state.isPlaying) {
            html += `
                <div class="timer">Total: ${formatTime(state.totalTime)}</div>
                <div class="progress">Phases: ${state.phasesCompleted}</div>
                <div class="instruction">${getInstruction(state.count)}</div>
                <div class="countdown">${state.countdown}</div>
                <p style="font-size:0.8rem; color:#aaa;">${patterns[state.currentPattern].desc}</p>
            `;
        }
        if (!state.isPlaying && !state.sessionComplete) {
            html += `
                <div class="settings">
                    <div class="form-group">
                        <label>Pattern</label>
                        <select id="pattern-select">
                            ${Object.keys(patterns).map(p => `<option value="${p}" ${p === state.currentPattern ? 'selected' : ''}>${p.charAt(0).toUpperCase() + p.slice(1)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group switch-group">
                        <label><input type="checkbox" id="sound-toggle" ${state.soundEnabled ? 'checked' : ''}> ${state.soundEnabled ? icons.volume2 : icons.volumeX} Sound</label>
                    </div>
                    <div class="form-group switch-group">
                        <label><input type="checkbox" id="haptics-toggle" ${state.hapticsEnabled ? 'checked' : ''} ${'vibrate' in navigator ? '' : 'disabled'}> Haptics</label>
                    </div>
                    <div class="form-group switch-group">
                        <label><input type="checkbox" id="background-toggle" ${state.backgroundEnabled ? 'checked' : ''}> Background Audio</label>
                    </div>
                    <div class="form-group switch-group">
                        <button id="mode-toggle">${icons.sun} ${state.mode === 'dark' ? 'Light' : 'Dark'} Mode</button>
                    </div>
                    <div class="form-group">
                        <input type="text" inputmode="numeric" placeholder="Time limit (min)" value="${state.timeLimit}" id="time-limit">
                        <label for="time-limit">Optional</label>
                    </div>
                </div>
                <div class="prompt">Select options and start</div>
            `;
        }
        if (state.sessionComplete) {
            html += `<div class="complete">Complete! Total phases: ${state.phasesCompleted}</div>`;
        }
        if (!state.sessionComplete) {
            html += `<button id="toggle-play">${state.isPlaying ? icons.pause : icons.play} ${state.isPlaying ? 'Pause' : 'Start'}</button>`;
        }
        if (state.currentPattern === 'custom' && !state.isPlaying) {
            html += `
                <div class="slider-container">
                    <label for="phase-slider">Phase Time (s): <span id="phase-value">${state.phaseTime}</span></label>
                    <input type="range" min="3" max="10" step="1" value="${state.phaseTime}" id="phase-slider">
                </div>
            `;
        }
        if (state.sessionComplete) {
            html += `<button id="reset">${icons.rotateCcw} Reset</button>`;
        }
        if (!state.isPlaying && !state.sessionComplete) {
            html += `
                <div class="shortcut-buttons">
                    <button id="preset-2" class="preset-button">${icons.clock} 2 min</button>
                    <button id="preset-5" class="preset-button">${icons.clock} 5 min</button>
                    <button id="preset-10" class="preset-button">${icons.clock} 10 min</button>
                </div>
            `;
        }
        app.innerHTML = html;
        
        // Event listeners
        if (!state.sessionComplete) {
            document.getElementById('toggle-play').addEventListener('click', togglePlay);
        }
        if (state.sessionComplete) {
            document.getElementById('reset').addEventListener('click', resetToStart);
        }
        if (!state.isPlaying && !state.sessionComplete) {
            document.getElementById('sound-toggle').addEventListener('change', toggleSound);
            if ('vibrate' in navigator) document.getElementById('haptics-toggle').addEventListener('change', toggleHaptics);
            document.getElementById('background-toggle').addEventListener('change', toggleBackground);
            document.getElementById('mode-toggle').addEventListener('click', toggleMode);
            const timeLimitInput = document.getElementById('time-limit');
            timeLimitInput.addEventListener('input', handleTimeLimitChange);
            document.getElementById('pattern-select').addEventListener('change', (e) => changePattern(e.target.value));
            document.getElementById('preset-2').addEventListener('click', () => startWithPreset(2));
            document.getElementById('preset-5').addEventListener('click', () => startWithPreset(5));
            document.getElementById('preset-10').addEventListener('click', () => startWithPreset(10));
            if (state.currentPattern === 'custom') {
                const phaseSlider = document.getElementById('phase-slider');
                phaseSlider.addEventListener('input', function() {
                    state.phaseTime = parseInt(this.value);
                    localStorage.setItem('phaseTime', state.phaseTime);
                    document.getElementById('phase-value').textContent = state.phaseTime;
                });
            }
        }
    }
    
    render();
});

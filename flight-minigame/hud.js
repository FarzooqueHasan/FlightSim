/**
 * HUD - Manages the glassmorphism DOM overlay gauges, compass tape, stall warning,
 * real-time 2D radar minimap, and mission results celebration modal.
 */
export class HUD {
  constructor() {
    this.initDOM();
    this.instructionTimer = 0;
  }

  initDOM() {
    this.modeEl = document.getElementById('hud-mode-display');
    this.exitBtn = document.getElementById('btn-exit-sim');

    // Left Panel
    this.speedValEl = document.getElementById('hud-speed-val');
    this.speedBarEl = document.getElementById('hud-speed-bar');
    this.throttleValEl = document.getElementById('hud-throttle-val');
    this.throttleBarEl = document.getElementById('hud-throttle-bar');

    // Right Panel
    this.altValEl = document.getElementById('hud-alt-val');
    this.altBarEl = document.getElementById('hud-alt-bar');
    this.boostValEl = document.getElementById('hud-boost-val');
    this.boostBarEl = document.getElementById('hud-boost-bar');

    // Bottom Bar
    this.checkpointsEl = document.getElementById('hud-checkpoints');
    this.timerEl = document.getElementById('hud-timer');
    this.scoreEl = document.getElementById('hud-score');
    this.comboEl = document.getElementById('hud-combo');
    this.compassStripEl = document.getElementById('hud-compass-strip');
    this.warningEl = document.getElementById('hud-warning-msg');
    this.instructionsEl = document.getElementById('hud-instructions');

    // Minimap Radar
    this.minimapCanvas = document.getElementById('minimap-canvas');
    this.minimapCtx = this.minimapCanvas ? this.minimapCanvas.getContext('2d') : null;

    // Results Modal
    this.resultsModalEl = document.getElementById('minigame-results-modal');
    this.resModeEl = document.getElementById('res-mode');
    this.resTimeEl = document.getElementById('res-time');
    this.resCheckpointsEl = document.getElementById('res-checkpoints');
    this.resScoreEl = document.getElementById('res-score');
    this.resRewardEl = document.getElementById('res-reward');
    this.btnReturn = document.getElementById('btn-results-return');
    this.btnRetry = document.getElementById('btn-results-retry');
  }

  reset(mode = 'checkpoint_race', onExitCallback) {
    if (this.resultsModalEl) this.resultsModalEl.classList.add('hidden');
    if (this.warningEl) this.warningEl.classList.add('hidden');

    const modeNames = {
      checkpoint_race: '🏁 CHECKPOINT RACE',
      free_flight: '🕊️ FREE FLIGHT (PRACTICE)',
      obstacle_survival: '⚡ OBSTACLE SURVIVAL'
    };
    if (this.modeEl) {
      this.modeEl.textContent = modeNames[mode] || mode.toUpperCase();
    }

    // Attach abort button
    if (this.exitBtn && onExitCallback) {
      this.exitBtn.onclick = () => onExitCallback();
    }

    // Show control instructions for 4.5 seconds
    if (this.instructionsEl) {
      this.instructionsEl.classList.remove('hidden');
      this.instructionsEl.style.opacity = '1';
      this.instructionTimer = 4.5;
    }
  }

  /**
   * Updates all HUD gauges and 2D radar per frame.
   */
  update(dt, physics, checkpointMgr, elapsedMs) {
    // 1. Auto-dismiss instructions
    if (this.instructionTimer > 0) {
      this.instructionTimer -= dt;
      if (this.instructionTimer <= 0 && this.instructionsEl) {
        this.instructionsEl.style.opacity = '0';
        setTimeout(() => { if (this.instructionsEl) this.instructionsEl.classList.add('hidden'); }, 500);
      }
    }

    // 2. Airspeed & Throttle
    const speed = Math.round(physics.speed);
    if (this.speedValEl) this.speedValEl.textContent = speed;
    if (this.speedBarEl) {
      const pct = Math.min(100, Math.max(0, ((speed - 40) / 180) * 100));
      this.speedBarEl.style.height = `${pct}%`;
    }

    const throttlePct = Math.round(physics.throttle * 100);
    if (this.throttleValEl) this.throttleValEl.textContent = `${throttlePct}%`;
    if (this.throttleBarEl) this.throttleBarEl.style.width = `${throttlePct}%`;

    // 3. Altitude & Boost
    const alt = Math.round(physics.position.y);
    if (this.altValEl) this.altValEl.textContent = alt;
    if (this.altBarEl) {
      const altPct = Math.min(100, Math.max(0, (alt / 350) * 100));
      this.altBarEl.style.height = `${altPct}%`;
    }

    if (this.boostValEl && this.boostBarEl) {
      if (physics.isBoosting) {
        this.boostValEl.textContent = '⚡ BOOSTING ⚡';
        this.boostValEl.className = 'gauge-value neon-cyan';
        const boostPct = (physics.boostTimer / 3.0) * 100;
        this.boostBarEl.style.width = `${boostPct}%`;
        this.boostBarEl.className = 'bar-fill cyan-fill';
      } else if (physics.boostCooldown > 0) {
        this.boostValEl.textContent = 'RECHARGING...';
        this.boostValEl.className = 'gauge-value';
        const rechargePct = ((7.0 - physics.boostCooldown) / 7.0) * 100;
        this.boostBarEl.style.width = `${rechargePct}%`;
        this.boostBarEl.className = 'bar-fill';
      } else {
        this.boostValEl.textContent = 'READY [SPACE]';
        this.boostValEl.className = 'gauge-value neon-magenta';
        this.boostBarEl.style.width = '100%';
        this.boostBarEl.className = 'bar-fill magenta-fill';
      }
    }

    // 4. Compass Heading Tape
    if (this.compassStripEl) {
      // Convert Euler Y (radians) to degrees 0..360
      let headingDeg = (360 - (physics.euler.y * (180 / Math.PI))) % 360;
      if (headingDeg < 0) headingDeg += 360;
      // Map 0..360 to translateX offset
      const offset = (headingDeg / 360) * 360;
      this.compassStripEl.style.transform = `translateX(-${offset}px)`;
    }

    // 5. Stall Warning Banner
    if (this.warningEl) {
      if (physics.isStalling) {
        this.warningEl.classList.remove('hidden');
      } else {
        this.warningEl.classList.add('hidden');
      }
    }

    // 6. Checkpoints, Timer, Score & Combo
    if (this.checkpointsEl) {
      if (checkpointMgr.totalCheckpoints > 0) {
        this.checkpointsEl.textContent = `${checkpointMgr.checkpointsHit} / ${checkpointMgr.totalCheckpoints}`;
      } else {
        this.checkpointsEl.textContent = `${checkpointMgr.checkpointsHit} (ENDLESS)`;
      }
    }

    if (this.timerEl) {
      const totalSec = elapsedMs / 1000;
      const min = Math.floor(totalSec / 60).toString().padStart(2, '0');
      const sec = (totalSec % 60).toFixed(1).padStart(4, '0');
      this.timerEl.textContent = `${min}:${sec}`;
    }

    if (this.scoreEl && this.comboEl) {
      this.scoreEl.firstChild.textContent = `${checkpointMgr.score.toLocaleString()} `;
      this.comboEl.textContent = `x${checkpointMgr.combo}`;
      this.comboEl.style.display = checkpointMgr.combo > 1 ? 'inline-block' : 'none';
    }

    // 7. Update 2D Radar Minimap
    this.renderMinimap(physics, checkpointMgr);
  }

  renderMinimap(physics, checkpointMgr) {
    if (!this.minimapCtx || !this.minimapCanvas) return;
    const ctx = this.minimapCtx;
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;
    const center = w / 2;

    // Clear background
    ctx.fillStyle = 'rgba(6, 10, 24, 0.85)';
    ctx.fillRect(0, 0, w, h);

    // Radar grid lines
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(center, center, center * 0.4, 0, Math.PI * 2);
    ctx.arc(center, center, center * 0.8, 0, Math.PI * 2);
    ctx.moveTo(center, 0); ctx.lineTo(center, h);
    ctx.moveTo(0, center); ctx.lineTo(w, center);
    ctx.stroke();

    // Calculate rotation angle (aircraft heading)
    const heading = physics.euler.y; // Rotate radar relative to aircraft forward
    const cos = Math.cos(heading);
    const sin = Math.sin(heading);
    const scale = 0.055; // 1000 world units = 55 pixels

    // Draw Checkpoint Rings
    if (checkpointMgr.rings) {
      checkpointMgr.rings.forEach((ring, idx) => {
        if (ring.userData.collected) return;
        
        const dx = ring.position.x - physics.position.x;
        const dz = ring.position.z - physics.position.z;

        // Rotate relative to aircraft heading
        const rx = (dx * cos - dz * sin) * scale;
        const ry = (dx * sin + dz * cos) * scale;

        const plotX = center + rx;
        const plotY = center - ry; // Inverted Y for screen coordinates

        if (plotX >= 4 && plotX <= w - 4 && plotY >= 4 && plotY <= h - 4) {
          ctx.beginPath();
          ctx.arc(plotX, plotY, idx === checkpointMgr.currentIndex ? 5 : 3, 0, Math.PI * 2);
          ctx.fillStyle = idx === checkpointMgr.currentIndex ? '#00ff88' : '#3d64ff';
          ctx.fill();
          if (idx === checkpointMgr.currentIndex) {
            ctx.strokeStyle = '#fff';
            ctx.stroke();
          }
        }
      });
    }

    // Draw Survival Obstacles
    if (checkpointMgr.obstacles) {
      ctx.fillStyle = '#ff007b';
      checkpointMgr.obstacles.forEach(obs => {
        const dx = obs.position.x - physics.position.x;
        const dz = obs.position.z - physics.position.z;
        const rx = (dx * cos - dz * sin) * scale;
        const ry = (dx * sin + dz * cos) * scale;
        const plotX = center + rx;
        const plotY = center - ry;

        if (plotX >= 2 && plotX <= w - 2 && plotY >= 2 && plotY <= h - 2) {
          ctx.fillRect(plotX - 2, plotY - 2, 4, 4);
        }
      });
    }

    // Draw Center Aircraft Icon (Cyan Triangle pointing Up)
    ctx.save();
    ctx.translate(center, center);
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fillStyle = '#00f0ff';
    ctx.fill();
    ctx.restore();
  }

  showResultsModal(payload, onReturn, onRetry) {
    if (!this.resultsModalEl) return;
    
    const modeNames = {
      checkpoint_race: '🏁 Checkpoint Race',
      free_flight: '🕊️ Free Flight',
      obstacle_survival: '⚡ Obstacle Survival'
    };

    if (this.resModeEl) this.resModeEl.textContent = modeNames[payload.mode] || payload.mode;
    if (this.resTimeEl) this.resTimeEl.textContent = `${(payload.completionTimeMs / 1000).toFixed(2)}s`;
    if (this.resCheckpointsEl) this.resCheckpointsEl.textContent = `${payload.checkpointsHit} / ${payload.checkpointsTotal}`;
    if (this.resScoreEl) this.resScoreEl.textContent = `${payload.score.toLocaleString()} PTS`;
    
    let rewardCr = Math.floor(payload.score);
    if (payload.checkpointsHit === payload.checkpointsTotal && payload.checkpointsTotal > 0) {
      rewardCr += 500;
    }
    if (this.resRewardEl) this.resRewardEl.textContent = `+${rewardCr.toLocaleString()} CR`;

    if (this.btnReturn) {
      this.btnReturn.onclick = () => {
        this.resultsModalEl.classList.add('hidden');
        if (onReturn) onReturn(payload);
      };
    }

    if (this.btnRetry) {
      this.btnRetry.onclick = () => {
        this.resultsModalEl.classList.add('hidden');
        if (onRetry) onRetry();
      };
    }

    this.resultsModalEl.classList.remove('hidden');
  }
}

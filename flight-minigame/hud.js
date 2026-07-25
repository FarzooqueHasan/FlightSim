/**
 * HUD - Manages the glassmorphism DOM overlay gauges, compass tape, stall warning,
 * real-time 2D radar minimap, and mission results celebration modal.
 */
export class HUD {
  constructor() {
    this.initDOM();
    this.instructionTimer = 0;
    // Cache of last-written values to avoid redundant DOM writes every frame
    this._cache = {};
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

    // Status Indicators, Crosshair & Pitch Ladder
    this.gearIndEl = document.getElementById('ind-gear');
    this.flapsIndEl = document.getElementById('ind-flaps');
    this.airbrakeIndEl = document.getElementById('ind-brk');
    this.crosshairEl = document.getElementById('hud-mouse-crosshair');
    this.pitchLadderEl = document.getElementById('hud-pitch-ladder');

    // Crash Modal
    this.crashModalEl = document.getElementById('minigame-crash-modal');
    this.crashReasonEl = document.getElementById('crash-reason');
    this.crashSpeedEl = document.getElementById('crash-speed');
    this.crashGEl = document.getElementById('crash-g');
    this.crashTimeEl = document.getElementById('crash-time');
    this.btnCrashRetry = document.getElementById('btn-crash-retry');
    this.btnCrashExit = document.getElementById('btn-crash-return');

    // Landing Quality Banner
    this.landingBannerEl = document.getElementById('hud-landing-banner');
    this._landingBannerTimer = null;
  }

  reset(mode = 'checkpoint_race', onExitCallback) {
    if (this.resultsModalEl) this.resultsModalEl.classList.add('hidden');
    if (this.crashModalEl) this.crashModalEl.classList.add('hidden');
    if (this.warningEl) this.warningEl.classList.add('hidden');
    if (this.landingBannerEl) this.landingBannerEl.classList.add('hidden');
    if (this._landingBannerTimer) { clearTimeout(this._landingBannerTimer); this._landingBannerTimer = null; }
    this._cache = {}; // Clear DOM cache on reset

    const modeNames = {
      checkpoint_race: '🏁 CHECKPOINT RACE',
      runway_takeoff: '🛬 RUNWAY TAKEOFF & LANDING',
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
   * DOM writes are throttled via a value cache — only actually written when changed.
   */
  update(dt, physics, checkpointMgr, elapsedMs, inputState = null) {
    const C = this._cache; // Alias for brevity

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
    if (C.speed !== speed) {
      C.speed = speed;
      if (this.speedValEl) this.speedValEl.textContent = speed;
      if (this.speedBarEl) {
        const pct = Math.min(100, Math.max(0, ((speed - 40) / 180) * 100));
        this.speedBarEl.style.height = `${pct}%`;
      }
    }

    const throttlePct = Math.round(physics.throttle * 100);
    if (C.throttle !== throttlePct) {
      C.throttle = throttlePct;
      if (this.throttleValEl) this.throttleValEl.textContent = `${throttlePct}%`;
      if (this.throttleBarEl) this.throttleBarEl.style.width = `${throttlePct}%`;
    }

    // 3. Altitude & Boost
    const alt = Math.round(physics.position.y);
    if (C.alt !== alt) {
      C.alt = alt;
      if (this.altValEl) this.altValEl.textContent = alt;
      if (this.altBarEl) {
        const altPct = Math.min(100, Math.max(0, (alt / 350) * 100));
        this.altBarEl.style.height = `${altPct}%`;
      }
    }

    if (this.boostValEl && this.boostBarEl) {
      const boostState = physics.isBoosting ? 1 : physics.boostCooldown > 0 ? 2 : 0;
      if (C.boostState !== boostState) {
        C.boostState = boostState;
        if (boostState === 1) {
          this.boostValEl.textContent = '⚡ BOOSTING ⚡';
          this.boostValEl.className = 'gauge-value neon-cyan';
          this.boostBarEl.className = 'bar-fill cyan-fill';
        } else if (boostState === 2) {
          this.boostValEl.textContent = 'RECHARGING...';
          this.boostValEl.className = 'gauge-value';
          this.boostBarEl.className = 'bar-fill';
        } else {
          this.boostValEl.textContent = 'READY [SPACE]';
          this.boostValEl.className = 'gauge-value neon-magenta';
          this.boostBarEl.className = 'bar-fill magenta-fill';
        }
      }
      // Boost bar progress still updates continuously
      if (physics.isBoosting) {
        this.boostBarEl.style.width = `${(physics.boostTimer / 3.0) * 100}%`;
      } else if (physics.boostCooldown > 0) {
        this.boostBarEl.style.width = `${((7.0 - physics.boostCooldown) / 7.0) * 100}%`;
      } else {
        if (C.boostFull !== true) { C.boostFull = true; this.boostBarEl.style.width = '100%'; }
      }
      if (boostState !== 0) C.boostFull = false;
    }

    // 4. Compass Heading Tape
    if (this.compassStripEl) {
      const headingDeg = ((360 - (physics.euler.y * (180 / Math.PI))) % 360 + 360) % 360;
      const offset = Math.round((headingDeg / 360) * 360);
      if (C.compassOffset !== offset) {
        C.compassOffset = offset;
        this.compassStripEl.style.transform = `translateX(-${offset}px)`;
      }
    }

    // 5. Stall Warning Banner
    if (this.warningEl) {
      if (C.isStalling !== physics.isStalling) {
        C.isStalling = physics.isStalling;
        if (physics.isStalling) this.warningEl.classList.remove('hidden');
        else this.warningEl.classList.add('hidden');
      }
    }

    // 6. Checkpoints, Timer, Score & Combo
    const cpText = checkpointMgr.totalCheckpoints > 0
      ? `${checkpointMgr.checkpointsHit} / ${checkpointMgr.totalCheckpoints}`
      : `${checkpointMgr.checkpointsHit} (ENDLESS)`;
    if (this.checkpointsEl && C.cpText !== cpText) {
      C.cpText = cpText;
      this.checkpointsEl.textContent = cpText;
    }

    if (this.timerEl) {
      const totalSec = elapsedMs / 1000;
      const min = Math.floor(totalSec / 60).toString().padStart(2, '0');
      const sec = (totalSec % 60).toFixed(1).padStart(4, '0');
      const timerText = `${min}:${sec}`;
      if (C.timerText !== timerText) { C.timerText = timerText; this.timerEl.textContent = timerText; }
    }

    if (this.scoreEl && this.comboEl) {
      const scoreVal = checkpointMgr.score;
      const comboVal = checkpointMgr.combo;
      if (C.score !== scoreVal) { C.score = scoreVal; this.scoreEl.firstChild.textContent = `${scoreVal.toLocaleString()} `; }
      if (C.combo !== comboVal) {
        C.combo = comboVal;
        this.comboEl.textContent = `x${comboVal}`;
        this.comboEl.style.display = comboVal > 1 ? 'inline-block' : 'none';
      }
    }

    // 7. Status Indicators (Gear, Flaps, Airbrakes) — update only on state change
    if (this.gearIndEl) {
      const gearDown = physics.gearDown;
      if (C.gearDown !== gearDown) {
        C.gearDown = gearDown;
        this.gearIndEl.textContent = `GEAR: ${gearDown ? 'DOWN' : 'UP'}`;
        this.gearIndEl.className = gearDown ? 'hud-ind active-green' : 'hud-ind';
      }
    }
    if (this.flapsIndEl) {
      if (C.flapsLevel !== physics.flapsLevel) {
        C.flapsLevel = physics.flapsLevel;
        const flapLabels = ['FLAPS: UP (0%)', 'FLAPS: TO (20%)', 'FLAPS: LDG (40%)'];
        this.flapsIndEl.textContent = flapLabels[physics.flapsLevel] || flapLabels[0];
        this.flapsIndEl.className = physics.flapsLevel > 0 ? 'hud-ind active-blue' : 'hud-ind';
      }
    }
    if (this.airbrakeIndEl) {
      if (C.airbrake !== physics.airbrakeActive) {
        C.airbrake = physics.airbrakeActive;
        this.airbrakeIndEl.textContent = `BRK: ${physics.airbrakeActive ? 'ON' : 'OFF'}`;
        this.airbrakeIndEl.className = physics.airbrakeActive ? 'hud-ind active-red blink' : 'hud-ind';
      }
    }

    // 8. Virtual Mouse Aim Crosshair
    if (this.crosshairEl && inputState) {
      if (inputState.mouseAim) {
        this.crosshairEl.classList.remove('hidden');
        const xPx = inputState.mouseX * 180;
        const yPx = inputState.mouseY * 180;
        this.crosshairEl.style.transform = `translate(${xPx}px, ${yPx}px)`;
      } else {
        this.crosshairEl.classList.add('hidden');
      }
    }

    // 9. Pitch Ladder / Artificial Horizon
    if (this.pitchLadderEl) {
      const pitchDeg = -(physics.euler.x * (180 / Math.PI));
      const rollDeg = -(physics.euler.z * (180 / Math.PI));
      const yOffset = pitchDeg * 3.5;
      this.pitchLadderEl.style.transform = `translate(-50%, -50%) rotate(${rollDeg}deg) translateY(${yOffset}px)`;
    }

    // 10. Update 2D Radar Minimap
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
      runway_takeoff: '🛬 Runway Takeoff & Landing',
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

  showCrashModal(payload, onRetry, onExit) {
    if (this.crashModalEl) {
      if (this.crashReasonEl) this.crashReasonEl.textContent = payload.reason || "DESTROYED";
      if (this.crashSpeedEl) this.crashSpeedEl.textContent = `${payload.speed} KTS`;
      if (this.crashGEl) this.crashGEl.textContent = `${payload.maxG} G`;
      if (this.crashTimeEl) this.crashTimeEl.textContent = `${payload.timeSec}s`;

      if (this.btnCrashRetry && onRetry) {
        this.btnCrashRetry.onclick = () => {
          this.crashModalEl.classList.add('hidden');
          onRetry();
        };
      }
      if (this.btnCrashExit && onExit) {
        this.btnCrashExit.onclick = () => {
          this.crashModalEl.classList.add('hidden');
          onExit();
        };
      }

      this.crashModalEl.classList.remove('hidden');
    }
  }

  /**
   * Displays a temporary centered landing quality banner for 2.5 seconds.
   * @param {string} text - Banner text e.g. '✅ SMOOTH LANDING'
   * @param {string} color - CSS color string
   */
  showLandingBanner(text, color) {
    if (!this.landingBannerEl) return;
    if (this._landingBannerTimer) clearTimeout(this._landingBannerTimer);

    this.landingBannerEl.textContent = text;
    this.landingBannerEl.style.color = color;
    this.landingBannerEl.style.borderColor = color;
    this.landingBannerEl.style.opacity = '1';
    this.landingBannerEl.style.transform = 'translate(-50%, -50%) scale(1)';
    this.landingBannerEl.classList.remove('hidden');

    this._landingBannerTimer = setTimeout(() => {
      if (this.landingBannerEl) {
        this.landingBannerEl.style.opacity = '0';
        this.landingBannerEl.style.transform = 'translate(-50%, -50%) scale(0.85)';
        setTimeout(() => {
          if (this.landingBannerEl) this.landingBannerEl.classList.add('hidden');
        }, 450);
      }
      this._landingBannerTimer = null;
    }, 2500);
  }
}

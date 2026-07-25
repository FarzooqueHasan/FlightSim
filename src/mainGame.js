import { flightMinigame } from '../flight-minigame/flightMinigame.js';

/**
 * MainGameHub - Simulates the primary game ("AeroNexus Hangar Command Hub").
 * Manages currency, high scores, mission launch triggers, and reward payouts.
 */
export class MainGameHub {
  constructor() {
    this.state = {
      credits: 2450,
      trophies: 12,
      highScores: [
        { name: 'CDR. VANTAGE (YOU)', score: 3420, topClass: 'top-1' },
        { name: 'LT. KRAKEN', score: 2890, topClass: 'top-2' },
        { name: 'ENSIGN ROOK', score: 2150, topClass: 'top-3' },
        { name: 'AI BOT "ICEMAN"', score: 1800, topClass: '' }
      ],
      recentRuns: []
    };

    this.initDOM();
  }

  initDOM() {
    this.hubEl = document.getElementById('main-game-hub');
    this.overlayEl = document.getElementById('minigame-overlay');
    this.creditsEl = document.getElementById('player-credits');
    this.trophiesEl = document.getElementById('player-trophies');
    this.leaderboardEl = document.getElementById('leaderboard-list');
    this.recentRunsEl = document.getElementById('recent-runs-list');
    this.modeSelectEl = document.getElementById('sim-mode-select');
    
    // Launch Button
    const launchBtn = document.getElementById('btn-launch-sim');
    if (launchBtn) {
      launchBtn.addEventListener('click', () => {
        const selectedMode = this.modeSelectEl ? this.modeSelectEl.value : 'checkpoint_race';
        this.launchSimulator(selectedMode);
      });
    }

    this.updateUI();
  }

  updateUI() {
    if (this.creditsEl) {
      this.creditsEl.textContent = `${this.state.credits.toLocaleString()} CR`;
    }
    if (this.trophiesEl) {
      this.trophiesEl.textContent = `${this.state.trophies} / 15`;
    }

    // Render Leaderboard
    if (this.leaderboardEl) {
      this.leaderboardEl.innerHTML = this.state.highScores.map((item, idx) => `
        <div class="lb-item ${item.topClass || ''}">
          <span class="lb-rank">${idx + 1}</span>
          <span class="lb-name">${item.name}</span>
          <span class="lb-score ${idx === 0 ? 'neon-cyan' : ''}">${item.score.toLocaleString()} PTS</span>
        </div>
      `).join('');
    }

    // Render Recent Telemetry
    if (this.recentRunsEl) {
      if (this.state.recentRuns.length === 0) {
        this.recentRunsEl.innerHTML = `<p class="empty-state">No recent simulations recorded today.</p>`;
      } else {
        this.recentRunsEl.innerHTML = this.state.recentRuns.slice(0, 5).map(run => `
          <div class="recent-run-item">
            <div>
              <strong>${run.modeName}</strong>
              <div style="color: var(--text-muted); font-size: 11px;">Time: ${(run.timeMs / 1000).toFixed(1)}s | Ckpts: ${run.checkpointsHit}/${run.checkpointsTotal}</div>
            </div>
            <div style="text-align: right;">
              <div class="neon-gold font-mono">${run.score} PTS</div>
              <div class="neon-green" style="font-size: 11px;">+${run.reward} CR</div>
            </div>
          </div>
        `).join('');
      }
    }
  }

  /**
   * Mounts and launches the 3D Flight Simulator Minigame overlay.
   */
  launchSimulator(mode = 'checkpoint_race') {
    console.log(`[MainGameHub] Launching simulator in mode: ${mode}`);
    this.hubEl.classList.add('paused');
    this.overlayEl.classList.remove('hidden');

    const viewportContainer = document.getElementById('minigame-viewport');
    
    // Initialize minigame with result callback
    flightMinigame.init(viewportContainer, mode, {
      onComplete: (resultPayload) => this.onMinigameComplete(resultPayload),
      onExit: () => this.exitSimulator()
    });

    // Read selected livery
    const liverySelect = document.getElementById('livery-select');
    const liveryVal = liverySelect ? liverySelect.value : 'titanium';
    const liveries = {
      titanium: { body: 0xdcdec, accent: 0x0044aa },
      stealth: { body: 0x1e222a, accent: 0xff007b },
      navy: { body: 0x0a1a3a, accent: 0xffaa00 },
      cyber: { body: 0x440066, accent: 0x00ff44 }
    };
    const selectedLivery = liveries[liveryVal] || liveries.titanium;
    flightMinigame.sceneSetup.setLivery(selectedLivery.body, selectedLivery.accent);

    flightMinigame.start();
  }

  /**
   * Exits simulator back to Hangar without completing mission
   */
  exitSimulator() {
    console.log('[MainGameHub] Aborting simulator...');
    flightMinigame.teardown();
    this.overlayEl.classList.add('hidden');
    this.hubEl.classList.remove('paused');
  }

  /**
   * Consumes result payload from minigame upon run completion or exit
   * Result Payload format:
   * {
   *   "mode": "checkpoint_race",
   *   "completionTimeMs": 47230,
   *   "checkpointsHit": 8,
   *   "checkpointsTotal": 8,
   *   "score": 1420
   * }
   */
  onMinigameComplete(payload) {
    console.log('[MainGameHub] Received Minigame Result Payload:', payload);
    flightMinigame.teardown();
    this.overlayEl.classList.add('hidden');
    this.hubEl.classList.remove('paused');

    // Calculate Reward credits
    let rewardCr = Math.floor(payload.score);
    if (payload.checkpointsHit === payload.checkpointsTotal && payload.checkpointsTotal > 0) {
      rewardCr += 500; // Perfect run bonus
    }

    this.state.credits += rewardCr;

    // Record Telemetry
    const modeNames = {
      checkpoint_race: '🏁 Checkpoint Race',
      free_flight: '🕊️ Free Flight',
      obstacle_survival: '⚡ Obstacle Survival'
    };

    this.state.recentRuns.unshift({
      modeName: modeNames[payload.mode] || payload.mode,
      timeMs: payload.completionTimeMs,
      checkpointsHit: payload.checkpointsHit,
      checkpointsTotal: payload.checkpointsTotal,
      score: payload.score,
      reward: rewardCr
    });

    // Check if high score beat top score
    if (payload.score > this.state.highScores[0].score) {
      this.state.highScores[0].score = payload.score;
    }

    this.updateUI();
    this.showRewardToast(rewardCr, payload.score);
  }

  showRewardToast(reward, score) {
    const toast = document.getElementById('reward-notification');
    const toastText = document.getElementById('toast-text');
    if (toast && toastText) {
      toastText.textContent = `Earned +${reward.toLocaleString()} CR from ${score} PTS simulation performance!`;
      toast.classList.remove('hidden');
      
      // Animate credit badge
      const badge = document.getElementById('credits-badge');
      if (badge) {
        badge.style.transform = 'scale(1.15)';
        badge.style.transition = 'transform 0.3s ease';
        setTimeout(() => { badge.style.transform = 'scale(1)'; }, 300);
      }

      setTimeout(() => {
        toast.classList.add('hidden');
      }, 5000);
    }
  }
}

export const mainGameHub = new MainGameHub();

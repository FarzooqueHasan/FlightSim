import * as THREE from 'three';
import { SceneSetup } from './sceneSetup.js';
import { FlightPhysics } from './flightPhysics.js';
import { InputController } from './inputController.js';
import { CheckpointManager } from './checkpointManager.js';
import { HUD } from './hud.js';
import { audioSynth } from './assets/sfx/audioSynth.js';

/**
 * FlightMinigame - Primary orchestrator for the arcade flight simulator.
 * Manages the game loop, component coordination, telemetry callbacks, and clean teardown.
 */
export class FlightMinigame {
  constructor() {
    this.sceneSetup = new SceneSetup();
    this.physics = new FlightPhysics();
    this.input = new InputController();
    this.checkpointMgr = new CheckpointManager();
    this.hud = new HUD();

    this.container = null;
    this.mode = 'checkpoint_race';
    this.onCompleteCallback = null;
    this.onExitCallback = null;

    this.isRunning = false;
    this.animFrameId = null;
    this.lastTime = 0;
    this.startTime = 0;
    this.elapsedMs = 0;

    this.loop = this.loop.bind(this);
    this.handleInteraction = this.handleInteraction.bind(this);
  }

  /**
   * Initializes minigame components inside the provided DOM container.
   * @param {HTMLElement} containerDOM - Viewport container
   * @param {string} mode - 'checkpoint_race' | 'free_flight' | 'obstacle_survival'
   * @param {object} options - { onComplete, onExit }
   */
  init(containerDOM, mode = 'checkpoint_race', options = {}) {
    console.log(`[FlightMinigame] Initializing module in mode: ${mode}`);
    this.container = containerDOM;
    this.mode = mode;
    this.onCompleteCallback = options.onComplete || null;
    this.onExitCallback = options.onExit || null;

    // 1. Setup Three.js Scene
    this.sceneSetup.init(this.container);

    // 2. Setup Checkpoints & Obstacles inside the scene
    this.checkpointMgr.init(this.sceneSetup.scene, this.mode);

    // 3. Reset HUD
    this.hud.reset(this.mode, () => this.handleManualExit());

    // 4. Listen for first interaction to unlock audio synthesizer
    window.addEventListener('keydown', this.handleInteraction, { once: true });
    window.addEventListener('mousedown', this.handleInteraction, { once: true });
  }

  handleInteraction() {
    audioSynth.init();
  }

  /**
   * Starts or restarts the simulation loop.
   */
  start() {
    if (this.isRunning) this.stopLoop();

    this.physics.reset(new THREE.Vector3(0, 150, 0), 0);
    this.checkpointMgr.reset();
    this.input.attachListeners();

    this.isRunning = true;
    this.startTime = performance.now();
    this.lastTime = this.startTime;
    this.elapsedMs = 0;

    this.animFrameId = requestAnimationFrame(this.loop);
    console.log('[FlightMinigame] Simulation loop started.');
  }

  stopLoop() {
    this.isRunning = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    audioSynth.stopAll();
  }

  /**
   * Main simulation loop executed per frame.
   */
  loop(timestamp) {
    if (!this.isRunning) return;

    // Delta time calculation (clamped to max 0.1s to prevent physics explosions on tab switch)
    const dtMs = timestamp - this.lastTime;
    const dt = Math.min(0.1, dtMs / 1000);
    this.lastTime = timestamp;
    this.elapsedMs = timestamp - this.startTime;

    // 1. Sample Input
    const inputState = this.input.sampleInput();

    // Check for abort request (ESC)
    if (inputState.exit) {
      this.handleManualExit();
      return;
    }

    // Check for camera toggle (C)
    if (inputState.cameraToggle) {
      this.sceneSetup.toggleCameraMode();
    }

    // 2. Update Flight Physics
    this.physics.update(dt, inputState, this.sceneSetup);

    // 3. Update Checkpoint / Obstacle collisions
    const event = this.checkpointMgr.update(dt, this.physics);
    if (event && event.type === 'COURSE_COMPLETE') {
      this.handleCourseCompletion();
      return;
    }

    // 4. Update Audio Synthesizer
    audioSynth.updateEngine(this.physics.speed, this.physics.isBoosting);

    // 5. Update Scene & Render
    this.sceneSetup.update(dt, this.physics);

    // 6. Update HUD Overlay
    this.hud.update(dt, this.physics, this.checkpointMgr, this.elapsedMs);

    // Continue loop
    this.animFrameId = requestAnimationFrame(this.loop);
  }

  handleCourseCompletion() {
    console.log('[FlightMinigame] Course complete! Displaying results.');
    this.stopLoop();

    const payload = {
      mode: this.mode,
      completionTimeMs: Math.round(this.elapsedMs),
      checkpointsHit: this.checkpointMgr.checkpointsHit,
      checkpointsTotal: this.checkpointMgr.totalCheckpoints,
      score: this.checkpointMgr.score
    };

    // Show celebratory results modal
    this.hud.showResultsModal(
      payload,
      (result) => {
        // On click return to Hangar
        if (this.onCompleteCallback) this.onCompleteCallback(result);
      },
      () => {
        // On click retry
        this.start();
      }
    );
  }

  handleManualExit() {
    console.log('[FlightMinigame] Manual abort triggered.');
    this.stopLoop();
    if (this.onExitCallback) {
      this.onExitCallback();
    }
  }

  /**
   * Cleans up Three.js resources (geometries, materials, textures, listeners)
   * to guarantee no memory leaks upon exiting back to the main game.
   */
  teardown() {
    console.log('[FlightMinigame] Tearing down minigame and disposing 3D resources...');
    this.stopLoop();
    this.input.detachListeners();
    audioSynth.dispose();
    this.sceneSetup.dispose();
    this.checkpointMgr.clearAll();

    window.removeEventListener('keydown', this.handleInteraction);
    window.removeEventListener('mousedown', this.handleInteraction);
  }
}

export const flightMinigame = new FlightMinigame();

/**
 * InputController - Unified handler for Keyboard, Mouse, and HTML5 Gamepad inputs.
 */
export class InputController {
  constructor() {
    this.keys = {};
    this.mouseState = { x: 0, y: 0, isDown: false };
    this.useMouseControl = false;
    
    // One-shot triggers
    this.cameraToggleRequested = false;
    this.exitRequested = false;

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onWheel = this.onWheel.bind(this);

    this.attachListeners();
  }

  attachListeners() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('wheel', this.onWheel, { passive: false });
  }

  detachListeners() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('wheel', this.onWheel);
    this.keys = {};
  }

  onKeyDown(e) {
    this.keys[e.code] = true;
    this.keys[e.key.toLowerCase()] = true;

    // One-shot actions
    if (e.code === 'KeyC' || e.key.toLowerCase() === 'c') {
      this.cameraToggleRequested = true;
    }
    if (e.code === 'Escape') {
      this.exitRequested = true;
    }
  }

  onKeyUp(e) {
    this.keys[e.code] = false;
    this.keys[e.key.toLowerCase()] = false;
  }

  onMouseMove(e) {
    if (!this.useMouseControl) return;
    // Normalize mouse position from center of screen (-1 to +1)
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    this.mouseState.x = Math.max(-1, Math.min(1, (e.clientX - centerX) / (centerX * 0.8)));
    this.mouseState.y = Math.max(-1, Math.min(1, (e.clientY - centerY) / (centerY * 0.8)));
  }

  onWheel(e) {
    // Optional wheel throttle adjust if needed
    if (this.useMouseControl) {
      e.preventDefault();
    }
  }

  /**
   * Samples current unified input state for the current frame.
   * @returns {object} { pitch, roll, yaw, throttleDelta, boost, cameraToggle, exit }
   */
  sampleInput() {
    let pitch = 0;
    let roll = 0;
    let yaw = 0;
    let throttleDelta = 0;
    let boost = false;

    // --- KEYBOARD INPUTS ---
    // Pitch: W or ArrowDown (nose down / dive = -1), S or ArrowUp (nose up / climb = +1)
    if (this.keys['KeyW'] || this.keys['ArrowDown'] || this.keys['w']) pitch -= 1.0;
    if (this.keys['KeyS'] || this.keys['ArrowUp'] || this.keys['s']) pitch += 1.0;

    // Roll: A or ArrowLeft (roll left = -1), D or ArrowRight (roll right = +1)
    if (this.keys['KeyA'] || this.keys['ArrowLeft'] || this.keys['a']) roll -= 1.0;
    if (this.keys['KeyD'] || this.keys['ArrowRight'] || this.keys['d']) roll += 1.0;

    // Yaw: Q (yaw left = -1), E (yaw right = +1)
    if (this.keys['KeyQ'] || this.keys['q']) yaw -= 1.0;
    if (this.keys['KeyE'] || this.keys['e']) yaw += 1.0;

    // Throttle: Shift (+1), Control (-1)
    if (this.keys['ShiftLeft'] || this.keys['ShiftRight'] || this.keys['Shift']) throttleDelta += 1.0;
    if (this.keys['ControlLeft'] || this.keys['ControlRight'] || this.keys['Control']) throttleDelta -= 1.0;

    // Boost: Space
    if (this.keys['Space']) boost = true;

    // --- MOUSE FLIGHT-STICK MODE OPTION ---
    if (this.useMouseControl) {
      roll += this.mouseState.x;
      pitch -= this.mouseState.y; // Mouse up = climb
    }

    // --- GAMEPAD INPUTS (HTML5 API Polling) ---
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let i = 0; i < gamepads.length; i++) {
      const gp = gamepads[i];
      if (gp && gp.connected) {
        // Left stick axes for roll and pitch (with deadzone of 0.15)
        const axisRoll = Math.abs(gp.axes[0]) > 0.15 ? gp.axes[0] : 0;
        const axisPitch = Math.abs(gp.axes[1]) > 0.15 ? gp.axes[1] : 0;
        const axisYaw = Math.abs(gp.axes[2]) > 0.15 ? gp.axes[2] : 0;

        roll += axisRoll;
        pitch -= axisPitch; // Gamepad stick down = climb
        yaw += axisYaw;

        // Triggers for throttle (buttons 6 and 7)
        if (gp.buttons[7] && gp.buttons[7].pressed) throttleDelta += gp.buttons[7].value || 1.0;
        if (gp.buttons[6] && gp.buttons[6].pressed) throttleDelta -= gp.buttons[6].value || 1.0;

        // Boost (South button / A / Cross)
        if (gp.buttons[0] && gp.buttons[0].pressed) boost = true;

        // Camera toggle (North button / Y / Triangle)
        if (gp.buttons[3] && gp.buttons[3].pressed) {
          if (!this._gpCamDebounce) {
            this.cameraToggleRequested = true;
            this._gpCamDebounce = true;
            setTimeout(() => { this._gpCamDebounce = false; }, 400);
          }
        }
        break;
      }
    }

    // Clamp values between -1 and 1
    pitch = Math.max(-1, Math.min(1, pitch));
    roll = Math.max(-1, Math.min(1, roll));
    yaw = Math.max(-1, Math.min(1, yaw));
    throttleDelta = Math.max(-1, Math.min(1, throttleDelta));

    const cameraToggle = this.cameraToggleRequested;
    const exit = this.exitRequested;
    
    // Reset one-shot flags
    this.cameraToggleRequested = false;
    this.exitRequested = false;

    return {
      pitch,
      roll,
      yaw,
      throttleDelta,
      boost,
      cameraToggle,
      exit
    };
  }
}

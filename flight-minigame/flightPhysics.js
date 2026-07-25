import * as THREE from 'three';

/**
 * Tunable flight physics configuration constants.
 * This exported config object is the primary lever for tuning arcade flight feel.
 */
export const FLIGHT_CONFIG = {
  // Speed metrics (units per second)
  MAX_SPEED: 220,
  MIN_SPEED: 40,
  ACCEL: 35,
  DECEL: 45,

  // Angular turn rates in degrees per second (converted to radians in logic)
  PITCH_RATE_DEG: 55,
  ROLL_RATE_DEG: 110,
  YAW_RATE_DEG: 35,

  // Aerodynamic coupling and smoothing
  BANK_TURN_COUPLING: 0.6, // How much rolling left/right automatically turns (yaws) the aircraft
  PITCH_DAMPING: 4.0,      // How quickly pitch rotation stops when input released
  ROLL_DAMPING: 5.0,       // How quickly roll rotation stops when input released
  YAW_DAMPING: 4.0,        // How quickly yaw rotation stops when input released
  AUTO_LEVEL_RATE: 0.7,    // Gentle roll self-leveling toward 0 degrees when hands off controls

  // Stall characteristics
  STALL_SPEED: 65,
  STALL_DRIFT: 28,         // Downward gravity drift acceleration when stalled

  // Hyper-Boost resource
  BOOST_MULTIPLIER: 1.65,  // Speed multiplier during boost
  BOOST_DURATION: 3.0,     // Seconds of active boost
  BOOST_COOLDOWN: 7.0      // Seconds required to recharge boost
};

const DEG2RAD = Math.PI / 180;

export class FlightPhysics {
  constructor() {
    this.reset(new THREE.Vector3(0, 150, 0));
  }

  reset(startPosition = new THREE.Vector3(0, 150, 0), startHeading = 0) {
    this.position = startPosition.clone();
    this.quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), startHeading);
    this.euler = new THREE.Euler(0, startHeading, 0, 'YXZ');

    // Velocity & Speed
    this.speed = 110; // Initial cruise speed
    this.throttle = (this.speed - FLIGHT_CONFIG.MIN_SPEED) / (FLIGHT_CONFIG.MAX_SPEED - FLIGHT_CONFIG.MIN_SPEED);
    this.velocity = new THREE.Vector3();
    this.forwardVector = new THREE.Vector3(0, 0, -1);

    // Angular velocities
    this.pitchRate = 0;
    this.rollRate = 0;
    this.yawRate = 0;

    // Boost & Stall states
    this.isBoosting = false;
    this.boostTimer = 0;
    this.boostCooldown = 0;
    this.isStalling = false;
  }

  /**
   * Updates flight physics simulation per frame.
   * @param {number} dt - Delta time in seconds
   * @param {object} input - Input state from InputController { pitch, roll, yaw, throttleDelta, boost }
   * @param {object} [sceneSetup] - Optional reference to sceneSetup for terrain height querying
   */
  update(dt, input, sceneSetup = null) {
    // 1. Update Throttle and Boost
    this.updateThrottleAndBoost(dt, input);

    // 2. Calculate target angular velocities from input
    const targetPitchRate = input.pitch * (FLIGHT_CONFIG.PITCH_RATE_DEG * DEG2RAD);
    const targetRollRate = input.roll * (FLIGHT_CONFIG.ROLL_RATE_DEG * DEG2RAD);
    const targetYawRate = input.yaw * (FLIGHT_CONFIG.YAW_RATE_DEG * DEG2RAD);

    // Smoothly lerp angular velocities toward targets (damping)
    this.pitchRate += (targetPitchRate - this.pitchRate) * Math.min(1.0, FLIGHT_CONFIG.PITCH_DAMPING * dt);
    this.rollRate += (targetRollRate - this.rollRate) * Math.min(1.0, FLIGHT_CONFIG.ROLL_DAMPING * dt);
    this.yawRate += (targetYawRate - this.yawRate) * Math.min(1.0, FLIGHT_CONFIG.YAW_DAMPING * dt);

    // 3. Update Euler angles
    this.euler.setFromQuaternion(this.quaternion, 'YXZ');

    this.euler.x += this.pitchRate * dt;
    this.euler.z += this.rollRate * dt;
    
    // Bank turn coupling: rolling banks the plane into a natural yaw turn
    const bankTurnYaw = -Math.sin(this.euler.z) * FLIGHT_CONFIG.BANK_TURN_COUPLING * dt;
    this.euler.y += (this.yawRate * dt) + bankTurnYaw;

    // Clamp pitch to avoid looping overhead upside down in arcade mode (-85 deg to +85 deg)
    const maxPitch = 85 * DEG2RAD;
    this.euler.x = Math.max(-maxPitch, Math.min(maxPitch, this.euler.x));

    // Optional auto-leveling of roll when no roll input is given
    if (Math.abs(input.roll) < 0.05) {
      this.euler.z -= this.euler.z * Math.min(1.0, FLIGHT_CONFIG.AUTO_LEVEL_RATE * dt);
    }

    // Convert updated Euler back to Quaternion
    this.quaternion.setFromEuler(this.euler);

    // 4. Calculate Velocity Vector
    this.forwardVector.set(0, 0, -1).applyQuaternion(this.quaternion);
    this.velocity.copy(this.forwardVector).multiplyScalar(this.speed);

    // 5. Stall Physics (When speed drops below threshold)
    if (this.speed < FLIGHT_CONFIG.STALL_SPEED) {
      this.isStalling = true;
      // Sink downward
      this.velocity.y -= FLIGHT_CONFIG.STALL_DRIFT * (1 - (this.speed / FLIGHT_CONFIG.STALL_SPEED));
      // Force pitch nose down slightly during stall
      this.euler.x -= 0.3 * dt;
      this.quaternion.setFromEuler(this.euler);
    } else {
      this.isStalling = false;
    }

    // 6. Update Position
    this.position.addScaledVector(this.velocity, dt);
    
    // Prevent clipping below terrain ground level or runway surface
    let minAltitude = 5;
    if (sceneSetup && typeof sceneSetup.getTerrainHeightAt === 'function') {
      const terrainHeight = sceneSetup.getTerrainHeightAt(this.position.x, this.position.z);
      minAltitude = Math.max(5, terrainHeight + 2.8); // Add aircraft clearance
    }

    if (this.position.y < minAltitude) {
      this.position.y = minAltitude;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.speed = Math.max(FLIGHT_CONFIG.MIN_SPEED, this.speed * 0.75); // Ground scrape / runway landing drag
    }
  }

  updateThrottleAndBoost(dt, input) {
    // Handle Boost Activation & Cooldown
    if (this.boostCooldown > 0) {
      this.boostCooldown = Math.max(0, this.boostCooldown - dt);
    }

    if (input.boost && this.boostCooldown === 0 && !this.isBoosting) {
      this.isBoosting = true;
      this.boostTimer = FLIGHT_CONFIG.BOOST_DURATION;
    }

    if (this.isBoosting) {
      this.boostTimer -= dt;
      if (this.boostTimer <= 0) {
        this.isBoosting = false;
        this.boostCooldown = FLIGHT_CONFIG.BOOST_COOLDOWN;
      }
    }

    // Adjust throttle based on user input (Shift/Ctrl or scroll)
    if (input.throttleDelta !== 0) {
      this.throttle = Math.max(0, Math.min(1, this.throttle + input.throttleDelta * dt * 0.8));
    }

    // Calculate target speed
    let targetSpeed = FLIGHT_CONFIG.MIN_SPEED + this.throttle * (FLIGHT_CONFIG.MAX_SPEED - FLIGHT_CONFIG.MIN_SPEED);
    if (this.isBoosting) {
      targetSpeed = FLIGHT_CONFIG.MAX_SPEED * FLIGHT_CONFIG.BOOST_MULTIPLIER;
    }

    // Accelerate / Decelerate toward target speed
    if (this.speed < targetSpeed) {
      const accelRate = this.isBoosting ? FLIGHT_CONFIG.ACCEL * 2.5 : FLIGHT_CONFIG.ACCEL;
      this.speed = Math.min(targetSpeed, this.speed + accelRate * dt);
    } else if (this.speed > targetSpeed) {
      this.speed = Math.max(targetSpeed, this.speed - FLIGHT_CONFIG.DECEL * dt);
    }
  }
}

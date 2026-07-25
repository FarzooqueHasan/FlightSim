import * as THREE from 'three';

/**
 * Tunable flight physics configuration constants for advanced aerodynamic feel.
 */
export const FLIGHT_CONFIG = {
  // Speed metrics (units per second)
  MAX_SPEED: 260,
  MIN_SPEED: 35,
  ACCEL: 40,
  DECEL: 50,
  AIRBRAKE_DECEL: 110,

  // Angular turn rates in degrees per second (converted to radians in logic)
  PITCH_RATE_DEG: 65,
  ROLL_RATE_DEG: 125,
  YAW_RATE_DEG: 40,

  // Aerodynamic coupling and smoothing
  BANK_TURN_COUPLING: 0.7, // Natural rudder coordination during banked turns
  PITCH_DAMPING: 5.0,      // Aerodynamic rotational damping
  ROLL_DAMPING: 6.0,       
  YAW_DAMPING: 4.5,        
  AUTO_LEVEL_RATE: 0.5,    // Gentle self-leveling when stick released

  // Stall & Aerodynamics
  STALL_SPEED_CLEAN: 65,
  STALL_SPEED_FLAPS: 45,   // Flaps lower stall speed significantly
  STALL_DRIFT: 35,         // Downward gravity sink rate during stall
  CRITICAL_AOA: 18 * (Math.PI / 180), // 18 degrees critical Angle of Attack

  // Hyper-Boost resource
  BOOST_MULTIPLIER: 1.7,   // Afterburner / Supercruise speed boost
  BOOST_DURATION: 3.5,     // Seconds of afterburner
  BOOST_COOLDOWN: 6.5      // Recharge duration
};

const DEG2RAD = Math.PI / 180;

export class FlightPhysics {
  constructor() {
    this.reset(new THREE.Vector3(0, 150, 0));
  }

  reset(startPosition = new THREE.Vector3(0, 150, 0), startHeading = 0, startOnRunway = false) {
    this.position = startPosition.clone();
    this.quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), startHeading);
    this.euler = new THREE.Euler(0, startHeading, 0, 'YXZ');

    // Velocity & Speed
    if (startOnRunway) {
      this.speed = 0;
      this.throttle = 0;
      this.gearDown = true;
      this.flapsLevel = 1; // 20% Takeoff flaps
    } else {
      this.speed = 120; // Initial cruise speed
      this.throttle = 0.5;
      this.gearDown = false;
      this.flapsLevel = 0; // Clean configuration
    }

    this.velocity = new THREE.Vector3();
    this.forwardVector = new THREE.Vector3(0, 0, -1);

    // Angular velocities
    this.pitchRate = 0;
    this.rollRate = 0;
    this.yawRate = 0;

    // Advanced Aerodynamic States
    this.aoa = 0; // Angle of Attack in radians
    this.gForce = 1.0; // Vertical G-load
    this.isBuffeting = false; // Aerodynamic buffeting near stall
    this.isGBlackout = false; // Pulling > 7 Gs
    this.airbrakeActive = false;

    // Boost & Stall states
    this.isBoosting = false;
    this.boostTimer = 0;
    this.boostCooldown = 0;
    this.isStalling = false;
    this.isOnGround = startOnRunway;

    // Crash State
    this.isCrashed = false;
    this.crashReason = null;
  }

  /**
   * Updates flight physics simulation per frame.
   * @param {number} dt - Delta time in seconds
   * @param {object} input - Input state from InputController
   * @param {object} [sceneSetup] - Optional reference to sceneSetup for terrain height querying
   */
  update(dt, input, sceneSetup = null) {
    if (this.isCrashed) return;

    // 0. Handle Flaps & Gear Toggles
    if (input.gearToggle) {
      this.gearDown = !this.gearDown;
    }
    if (input.flapsToggle) {
      this.flapsLevel = (this.flapsLevel + 1) % 3; // Cycle 0 -> 1 (20%) -> 2 (40%) -> 0
    }
    this.airbrakeActive = input.airbrake;

    // 1. Update Throttle and Boost
    this.updateThrottleAndBoost(dt, input);

    // 2. Calculate target angular velocities from input
    const controlAuthority = Math.min(1.2, Math.max(0.4, (this.speed / 100)));
    // When on the ground, prevent rolling into tarmac and only allow pitch up (climb rotation) for takeoff!
    const targetPitchRate = this.isOnGround ? Math.max(0, input.pitch * (FLIGHT_CONFIG.PITCH_RATE_DEG * DEG2RAD) * controlAuthority) : input.pitch * (FLIGHT_CONFIG.PITCH_RATE_DEG * DEG2RAD) * controlAuthority;
    const targetRollRate = this.isOnGround ? 0 : input.roll * (FLIGHT_CONFIG.ROLL_RATE_DEG * DEG2RAD) * controlAuthority;
    const targetYawRate = input.yaw * (FLIGHT_CONFIG.YAW_RATE_DEG * DEG2RAD) * controlAuthority;

    // Smoothly lerp angular velocities toward targets (damping)
    this.pitchRate += (targetPitchRate - this.pitchRate) * Math.min(1.0, FLIGHT_CONFIG.PITCH_DAMPING * dt);
    this.rollRate += (targetRollRate - this.rollRate) * Math.min(1.0, FLIGHT_CONFIG.ROLL_DAMPING * dt);
    this.yawRate += (targetYawRate - this.yawRate) * Math.min(1.0, FLIGHT_CONFIG.YAW_DAMPING * dt);

    // Calculate Angle of Attack (AoA) approximation based on pitch rate and climb angle
    this.aoa = Math.abs(this.pitchRate * 0.4);

    // Calculate G-Force load (1 G rest + centripetal acceleration during pitch/bank)
    const centripetalG = Math.abs(this.pitchRate * (this.speed / 9.8));
    this.gForce = 1.0 + (this.pitchRate > 0 ? centripetalG : -centripetalG * 0.5);
    this.isGBlackout = this.gForce > 7.5;

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

    // Optional auto-leveling of roll when no roll input is given and airspeed is stable
    if (Math.abs(input.roll) < 0.05 && !this.isStalling) {
      this.euler.z -= this.euler.z * Math.min(1.0, FLIGHT_CONFIG.AUTO_LEVEL_RATE * dt);
    }

    // 4. Stall Physics & Buffet (Only in air! Never stall while taxiing on ground!)
    const currentStallSpeed = this.flapsLevel > 0 ? FLIGHT_CONFIG.STALL_SPEED_FLAPS : FLIGHT_CONFIG.STALL_SPEED_CLEAN;
    if (!this.isOnGround && (this.speed < currentStallSpeed || this.aoa > FLIGHT_CONFIG.CRITICAL_AOA)) {
      this.isStalling = true;
      this.isBuffeting = true;
      this.velocity.y -= FLIGHT_CONFIG.STALL_DRIFT * (1 - (this.speed / currentStallSpeed)) * dt * 10;
      this.euler.x -= 0.4 * dt;
      this.euler.z += (Math.random() - 0.5) * 0.05;
    } else {
      this.isStalling = false;
      this.isBuffeting = !this.isOnGround && (this.aoa > FLIGHT_CONFIG.CRITICAL_AOA * 0.8);
    }

    // Convert updated Euler back to Quaternion
    this.quaternion.setFromEuler(this.euler);

    // 5. Calculate Velocity Vector
    this.forwardVector.set(0, 0, -1).applyQuaternion(this.quaternion);
    this.velocity.copy(this.forwardVector).multiplyScalar(this.speed);

    // Add stall sink rate if stalled
    if (this.isStalling) {
      this.velocity.y -= FLIGHT_CONFIG.STALL_DRIFT;
    }

    // 6. Update Position & Terrain / Runway Collision
    const prevY = this.position.y;
    this.position.addScaledVector(this.velocity, dt);
    
    let minAltitude = 5;
    let isOnRunwayTarmac = false;
    if (sceneSetup && typeof sceneSetup.getTerrainHeightAt === 'function') {
      const terrainHeight = sceneSetup.getTerrainHeightAt(this.position.x, this.position.z);
      minAltitude = Math.max(5, terrainHeight + 2.8); // Add aircraft clearance
      
      if (Math.abs(this.position.x) <= 60 && this.position.z >= -1400 && this.position.z <= 800) {
        isOnRunwayTarmac = true;
      }
    }
    this.isOnGround = this.position.y <= minAltitude + 0.6;

    // Ground & Runway Contact Handling
    if (this.position.y <= minAltitude) {
      const verticalImpactSpeed = (prevY - this.position.y) / Math.max(0.001, dt);
      
      // Crash Detection: High speed impact without gear, or steep vertical smash into terrain
      if (verticalImpactSpeed > 20 || (!this.gearDown && this.speed > 80 && !isOnRunwayTarmac)) {
        this.isCrashed = true;
        this.crashReason = isOnRunwayTarmac ? "HIGH SPEED BELLY LANDING IMPACT" : "TERRAIN / MOUNTAIN COLLISION";
        return;
      }

      // Safe Touchdown / Ground Taxiing
      this.position.y = minAltitude;
      if (this.velocity.y < 0) this.velocity.y = 0;

      // Ground friction: Gear down rolls smoothly on runway, clean or grass causes drag
      if (this.gearDown && isOnRunwayTarmac) {
        // Smooth runway taxi friction
        this.speed *= Math.pow(0.995, dt * 60);
      } else {
        // Rough grass scrape / belly skid drag
        this.speed = Math.max(0, this.speed - 40 * dt);
      }
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

    // Calculate target speed with aerodynamic modifiers (Flaps, Gear, Airbrakes)
    let maxEffectiveSpeed = FLIGHT_CONFIG.MAX_SPEED;
    if (this.flapsLevel === 1) maxEffectiveSpeed *= 0.85;
    if (this.flapsLevel === 2) maxEffectiveSpeed *= 0.70;
    if (this.gearDown) maxEffectiveSpeed *= 0.88;
    if (this.airbrakeActive) maxEffectiveSpeed *= 0.55;

    let minSpeed = this.isOnGround ? 0 : FLIGHT_CONFIG.MIN_SPEED;
    let targetSpeed = minSpeed + this.throttle * (maxEffectiveSpeed - minSpeed);
    if (this.isBoosting) {
      targetSpeed = FLIGHT_CONFIG.MAX_SPEED * FLIGHT_CONFIG.BOOST_MULTIPLIER;
    }

    // Accelerate / Decelerate toward target speed
    if (this.speed < targetSpeed) {
      const accelRate = this.isBoosting ? FLIGHT_CONFIG.ACCEL * 2.5 : FLIGHT_CONFIG.ACCEL;
      this.speed = Math.min(targetSpeed, this.speed + accelRate * dt);
    } else if (this.speed > targetSpeed) {
      const decelRate = this.airbrakeActive ? FLIGHT_CONFIG.AIRBRAKE_DECEL : FLIGHT_CONFIG.DECEL;
      this.speed = Math.max(targetSpeed, this.speed - decelRate * dt);
    }
  }
}

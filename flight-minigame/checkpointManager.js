import * as THREE from 'three';
import { audioSynth } from './assets/sfx/audioSynth.js';

/**
 * CheckpointManager - Spawns and manages checkpoint rings and survival obstacles,
 * handles bounding collision detection, combo streaks, and visual ring state distinctions.
 */
export class CheckpointManager {
  constructor() {
    this.scene = null;
    this.mode = 'checkpoint_race';
    this.rings = [];
    this.obstacles = [];
    this.ringGroup = new THREE.Group();
    this.obstacleGroup = new THREE.Group();

    this.currentIndex = 0;
    this.checkpointsHit = 0;
    this.totalCheckpoints = 8;
    this.score = 0;
    this.combo = 1;
    this.comboTimer = 0;

    // Obstacle survival spawn timer
    this.obstacleSpawnTimer = 0;
  }

  init(scene, mode = 'checkpoint_race') {
    this.scene = scene;
    this.mode = mode;
    this.scene.add(this.ringGroup);
    this.scene.add(this.obstacleGroup);

    this.reset();
  }

  reset() {
    this.clearAll();
    this.currentIndex = 0;
    this.checkpointsHit = 0;
    this.score = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this.obstacleSpawnTimer = 0;
    this._runwayLanded = false;

    if (this.mode === 'checkpoint_race') {
      this.totalCheckpoints = 10;
      this.spawnRaceCourse();
    } else if (this.mode === 'runway_takeoff') {
      this.totalCheckpoints = 6;
      this.spawnRunwayCourse();
    } else if (this.mode === 'free_flight') {
      this.totalCheckpoints = 0; // Infinite exploration practice rings
      this.spawnFreeFlightRings();
    } else if (this.mode === 'obstacle_survival') {
      this.totalCheckpoints = 0;
      this.spawnInitialObstacles();
    }

    this.updateRingVisuals();
  }

  clearAll() {
    while (this.ringGroup.children.length > 0) {
      const obj = this.ringGroup.children[0];
      this.ringGroup.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    }
    this.rings = [];

    while (this.obstacleGroup.children.length > 0) {
      const obj = this.obstacleGroup.children[0];
      this.obstacleGroup.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    }
    this.obstacles = [];
  }

  spawnRaceCourse() {
    // 10 coordinate waypoints creating a high-speed mountain canyon & coastal loop
    const waypoints = [
      { pos: new THREE.Vector3(0, 140, -350), rotY: 0 },
      { pos: new THREE.Vector3(220, 160, -750), rotY: -0.5 },
      { pos: new THREE.Vector3(650, 190, -1150), rotY: -1.2 },
      { pos: new THREE.Vector3(1200, 140, -1000), rotY: -2.3 },
      { pos: new THREE.Vector3(1400, 95, -400), rotY: -3.0 },
      { pos: new THREE.Vector3(1100, 120, 200), rotY: -3.8 },
      { pos: new THREE.Vector3(600, 170, 600), rotY: -4.5 },
      { pos: new THREE.Vector3(100, 210, 800), rotY: -5.2 },
      { pos: new THREE.Vector3(-350, 150, 450), rotY: -5.8 },
      { pos: new THREE.Vector3(-250, 130, -50), rotY: -6.2 }
    ];

    const torusGeo = new THREE.TorusGeometry(40, 3.8, 12, 32);

    waypoints.forEach((wp, idx) => {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x3d64ff,
        emissive: 0x3d64ff,
        emissiveIntensity: 0.5,
        roughness: 0.3,
        metalness: 0.8
      });

      const ring = new THREE.Mesh(torusGeo, mat);
      ring.position.copy(wp.pos);
      ring.rotation.y = wp.rotY;
      ring.userData = { index: idx, collected: false };

      this.ringGroup.add(ring);
      this.rings.push(ring);
    });
  }

  spawnRunwayCourse() {
    // 6 traffic pattern waypoints for runway takeoff, circuit, and precision landing
    const waypoints = [
      { pos: new THREE.Vector3(0, 45, 100), rotY: 0, label: "Takeoff Climb Out" },
      { pos: new THREE.Vector3(0, 120, -500), rotY: 0, label: "Upwind Leg" },
      { pos: new THREE.Vector3(-450, 150, -600), rotY: -Math.PI/2, label: "Crosswind Turn" },
      { pos: new THREE.Vector3(-550, 150, 100), rotY: -Math.PI, label: "Downwind Leg" },
      { pos: new THREE.Vector3(-350, 120, 750), rotY: -Math.PI*1.5, label: "Base Turn" },
      { pos: new THREE.Vector3(0, 35, 900), rotY: 0, label: "Final Runway Approach" }
    ];

    const torusGeo = new THREE.TorusGeometry(36, 3.6, 12, 32);

    waypoints.forEach((wp, idx) => {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x3d64ff,
        emissive: 0x3d64ff,
        emissiveIntensity: 0.5,
        roughness: 0.3,
        metalness: 0.8
      });
      const ring = new THREE.Mesh(torusGeo, mat);
      ring.position.copy(wp.pos);
      ring.rotation.y = wp.rotY;
      ring.userData = { index: idx, collected: false, label: wp.label };
      this.ringGroup.add(ring);
      this.rings.push(ring);
    });
  }

  spawnFreeFlightRings() {
    const torusGeo = new THREE.TorusGeometry(45, 4.0, 12, 32);
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x00f0ff,
        emissive: 0x00f0ff,
        emissiveIntensity: 1.2
      });
      const ring = new THREE.Mesh(torusGeo, mat);
      ring.position.set(
        (Math.random() - 0.5) * 2000,
        100 + Math.random() * 250,
        (Math.random() - 0.5) * 2000
      );
      ring.rotation.y = Math.random() * Math.PI * 2;
      ring.userData = { index: i, collected: false };
      this.ringGroup.add(ring);
      this.rings.push(ring);
    }
  }

  spawnInitialObstacles() {
    for (let i = 0; i < 15; i++) {
      this.spawnSingleObstacle(new THREE.Vector3(
        (Math.random() - 0.5) * 1200,
        50 + Math.random() * 150,
        -400 - (i * 250)
      ));
    }
  }

  spawnSingleObstacle(pos) {
    const isTower = Math.random() > 0.5;
    const geo = isTower 
      ? new THREE.BoxGeometry(30, 200, 30)
      : new THREE.ConeGeometry(35, 180, 5);

    const mat = new THREE.MeshStandardMaterial({
      color: isTower ? 0x1f2e55 : 0x332244,
      emissive: isTower ? 0x00f0ff : 0xff007b,
      emissiveIntensity: 0.3,
      roughness: 0.7
    });

    const obs = new THREE.Mesh(geo, mat);
    obs.position.copy(pos);
    if (!isTower) obs.position.y = 90;
    
    this.obstacleGroup.add(obs);
    this.obstacles.push(obs);
  }

  /**
   * Updates ring animations, combo decay, and collision detection per frame.
   * @param {number} dt - Delta time
   * @param {object} physics - Current flight physics state
   * @returns {object|null} Event payload if checkpoint hit or course completed
   */
  update(dt, physics) {
    // 1. Combo decay timer
    if (this.combo > 1) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.combo = 1;
      }
    }

    // 2. Animate target ring pulsing
    if ((this.mode === 'checkpoint_race' || this.mode === 'runway_takeoff') && this.currentIndex < this.rings.length) {
      const activeRing = this.rings[this.currentIndex];
      if (activeRing && !activeRing.userData.collected) {
        const pulse = 1.0 + Math.sin(Date.now() * 0.006) * 0.12;
        activeRing.scale.set(pulse, pulse, pulse);
      }
    }

    // 3. Checkpoint Ring Collision Detection
    if (this.mode === 'checkpoint_race' || this.mode === 'runway_takeoff') {
      if (this.currentIndex < this.rings.length) {
        const targetRing = this.rings[this.currentIndex];
        const dist = physics.position.distanceTo(targetRing.position);
        
        if (dist < 46 && !targetRing.userData.collected) {
          return this.collectCheckpoint(targetRing);
        }
      } else if (this.mode === 'runway_takeoff' && !this._runwayLanded) {
        // All rings collected in runway trial, verify runway touchdown
        if (physics.position.y <= 6.5 && Math.abs(physics.position.x) <= 60 && physics.position.z >= -1400 && physics.position.z <= 800 && physics.speed < 75) {
          this._runwayLanded = true;
          audioSynth.playMissionComplete();
          return {
            type: 'COURSE_COMPLETE',
            checkpointsHit: this.checkpointsHit,
            totalCheckpoints: this.totalCheckpoints,
            score: this.score + 1000,
            combo: this.combo
          };
        }
      }
    } else if (this.mode === 'free_flight') {
      for (let i = 0; i < this.rings.length; i++) {
        const ring = this.rings[i];
        if (!ring.userData.collected && physics.position.distanceTo(ring.position) < 50) {
          this.collectFreeFlightRing(ring);
          break;
        }
      }
    } else if (this.mode === 'obstacle_survival') {
      this.updateSurvivalObstacles(dt, physics);
    }

    return null;
  }

  collectCheckpoint(ring) {
    ring.userData.collected = true;
    this.checkpointsHit++;
    this.score += 150 * this.combo;
    
    this.combo = Math.min(10, this.combo + 1);
    this.comboTimer = 6.0;

    audioSynth.playCheckpointChime(this.combo);

    ring.material.color.setHex(0x00ff88);
    ring.material.emissive.setHex(0x00ff88);
    ring.material.emissiveIntensity = 3.0;
    ring.scale.set(1.4, 1.4, 1.4);

    this.currentIndex++;
    this.updateRingVisuals();

    const isComplete = this.currentIndex >= this.totalCheckpoints && this.mode !== 'runway_takeoff';
    if (isComplete) {
      audioSynth.playMissionComplete();
    }

    return {
      type: isComplete ? 'COURSE_COMPLETE' : 'CHECKPOINT_HIT',
      checkpointsHit: this.checkpointsHit,
      totalCheckpoints: this.totalCheckpoints,
      score: this.score,
      combo: this.combo
    };
  }

  collectFreeFlightRing(ring) {
    this.checkpointsHit++;
    this.score += 100;
    audioSynth.playCheckpointChime(1);

    // Respawn ring in a new location
    ring.position.set(
      (Math.random() - 0.5) * 2000,
      120 + Math.random() * 200,
      (Math.random() - 0.5) * 2000
    );
    ring.rotation.y = Math.random() * Math.PI * 2;
  }

  updateSurvivalObstacles(dt, physics) {
    // Add survival score over time based on speed
    this.score += Math.floor(physics.speed * dt * 0.5);

    // Check obstacle collisions
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const obs = this.obstacles[i];
      const dist = physics.position.distanceTo(obs.position);
      
      if (dist < 45) {
        // Collision penalty!
        physics.speed = Math.max(40, physics.speed * 0.6);
        this.combo = 1;
        audioSynth.playBoostWhoosh(); // Crash sound feedback
        
        // Move obstacle far ahead
        obs.position.z = physics.position.z - 1500;
        obs.position.x = physics.position.x + (Math.random() - 0.5) * 800;
      }

      // Recycle obstacles behind aircraft to ahead of aircraft
      if (obs.position.z > physics.position.z + 200) {
        obs.position.z = physics.position.z - 1600 - Math.random() * 600;
        obs.position.x = physics.position.x + (Math.random() - 0.5) * 1000;
      }
    }
  }

  updateRingVisuals() {
    if (this.mode !== 'checkpoint_race') return;

    this.rings.forEach((ring, idx) => {
      if (idx === this.currentIndex) {
        // NEXT TARGET RING: Blazing Neon Green/Cyan for daytime contrast
        ring.material.color.setHex(0x00ff88);
        ring.material.emissive.setHex(0x00ff88);
        ring.material.emissiveIntensity = 3.5;
        ring.material.roughness = 0.1;
        ring.material.wireframe = false;
      } else if (idx > this.currentIndex) {
        // FUTURE RINGS: Vibrant Royal Blue for clear sky contrast
        ring.material.color.setHex(0x0088ff);
        ring.material.emissive.setHex(0x0066cc);
        ring.material.emissiveIntensity = 1.2;
        ring.material.roughness = 0.3;
      }
    });
  }
}

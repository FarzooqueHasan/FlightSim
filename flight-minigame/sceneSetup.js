import * as THREE from 'three';

/**
 * SceneSetup - Manages Three.js WebGLRenderer, Scene, Lighting, Procedural Aircraft,
 * Multi-Biome Island Terrain with elevation querying, Volumetric Clouds, Airport Infrastructure,
 * Environmental Landmarks (Wind Turbines, Radio Towers, Trees), and Dual Camera Rigs.
 */
export class SceneSetup {
  constructor() {
    this.container = null;
    this.renderer = null;
    this.scene = null;
    this.chaseCamera = null;
    this.cockpitCamera = null;
    this.activeCameraMode = 'chase'; // 'chase' | 'cockpit'

    this.aircraftGroup = null;
    this.thrusterFlames = [];
    this.strobeLight = null;
    this.strobeTimer = 0;
    this._lastFlameColorHex = -1; // Cache to skip redundant setHex calls

    this.terrainMesh = null;
    this.terrainHeights = null;
    this.terrainSize = 6000;
    this.terrainSegs = 120;

    this.cloudGroup = null;
    this.windTurbineRotors = [];
    this.radarDishes = [];
    this.warningBeacons = [];

    // Smoothed camera tracking
    this.camWorldPos = new THREE.Vector3();
    this.camWorldLookAt = new THREE.Vector3();

    // --- Pre-allocated temporaries (zero per-frame heap allocations!) ---
    this._tmpOffset = new THREE.Vector3();
    this._tmpTargetPos = new THREE.Vector3();
    this._tmpLookAhead = new THREE.Vector3();
    this._tmpCockpitOffset = new THREE.Vector3();
    this._tmpCockpitLook = new THREE.Vector3();
    this._tmpCrashCenter = new THREE.Vector3();

    // Livery Materials & Crash Effects
    this.bodyMat = null;
    this.accentMat = null;
    this.explosionFireball = null;
    this.explosionLight = null;
    this.debrisParticles = [];
    this.smokeParticles = [];
  }

  init(containerDOM) {
    this.container = containerDOM;
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;

    // 1. Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // Limit to 1.5x for buttery smooth 60 FPS!
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    // Clear previous canvases if any
    while (this.container.firstChild) {
      this.container.removeChild(this.container.firstChild);
    }
    this.container.appendChild(this.renderer.domElement);

    // 2. Scene & Sky Atmosphere (Vibrant Day / Sunset Aviation World)
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8cb8ff); // Atmospheric horizon blue
    this.scene.fog = new THREE.FogExp2(0x8cb8ff, 0.00028); // Gentle atmospheric haze

    // 3. Cameras
    this.chaseCamera = new THREE.PerspectiveCamera(65, width / height, 0.5, 8000);
    this.cockpitCamera = new THREE.PerspectiveCamera(75, width / height, 0.1, 8000);

    // 4. Lighting
    this.setupLighting();

    // 5. Procedural Environment & Aircraft
    this.createSkyDome();
    this.createProceduralTerrain();
    this.createOceanWater();
    this.createAirportInfrastructure();
    this.createLandmarks();
    this.createVolumetricClouds();
    this.createProceduralAircraft();

    // Resize handler
    this.onWindowResize = this.onWindowResize.bind(this);
    window.addEventListener('resize', this.onWindowResize);
  }

  setupLighting() {
    // Ambient daylight
    const ambient = new THREE.AmbientLight(0x6e88a8, 1.4);
    this.scene.add(ambient);

    // Main directional golden sun
    const sunLight = new THREE.DirectionalLight(0xfffaed, 2.4);
    sunLight.position.set(1200, 1800, -1000);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 1024;  // 1024 is plenty for arcade quality at 2x the GPU cost of 512
    sunLight.shadow.mapSize.height = 1024;
    sunLight.shadow.camera.near = 100;
    sunLight.shadow.camera.far = 4000;
    const d = 1500;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.bias = -0.0005;
    this.scene.add(sunLight);

    // Warm horizon / ground bounce light
    const groundLight = new THREE.DirectionalLight(0xd4a373, 0.8);
    groundLight.position.set(-500, -300, 500);
    this.scene.add(groundLight);
  }

  createSkyDome() {
    // Large sphere with gradient shader for golden hour / crisp daylight horizon
    const skyGeo = new THREE.SphereGeometry(6000, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(0x1a4b8c) },    // Deep zenith blue
        bottomColor: { value: new THREE.Color(0xffcf99) }, // Golden sunset horizon glow
        offset: { value: 100 },
        exponent: { value: 0.6 }
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float offset;
        uniform float exponent;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition + offset).y;
          gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
        }
      `,
      side: THREE.BackSide
    });

    const skyDome = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(skyDome);
  }

  createProceduralTerrain() {
    const size = this.terrainSize;
    const segs = this.terrainSegs;
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);

    const posAttr = geo.attributes.position;
    const vertex = new THREE.Vector3();
    const colors = [];
    const color = new THREE.Color();

    this.terrainHeights = new Float32Array((segs + 1) * (segs + 1));

    // Generate realistic multi-biome island elevation
    for (let i = 0; i < posAttr.count; i++) {
      vertex.fromBufferAttribute(posAttr, i);
      
      const x = vertex.x;
      const z = vertex.z;
      
      // Distance from runway origin valley (flat airfield zone around X: -250..250, Z: -1500..800)
      const isRunwayZone = Math.abs(x) < 320 && z > -1600 && z < 900;
      let valleyFactor = 1.0;
      if (isRunwayZone) {
        const edgeX = Math.max(0, Math.abs(x) - 180) / 140;
        const edgeZ0 = Math.max(0, z - 700) / 200;
        const edgeZ1 = Math.max(0, -1400 - z) / 200;
        valleyFactor = Math.min(1.0, edgeX * edgeX + edgeZ0 * edgeZ0 + edgeZ1 * edgeZ1);
      }

      // Multi-octave terrain features
      let y = Math.sin(x * 0.0012) * Math.cos(z * 0.0012) * 220
            + Math.sin(x * 0.0035 + z * 0.0028) * 80
            + Math.cos(x * 0.008 - z * 0.007) * 35
            + Math.sin(x * 0.02) * Math.cos(z * 0.02) * 10;

      // Island coast falloff near boundaries
      const distFromCenter = Math.sqrt(x * x + z * z);
      const islandFade = Math.max(0, 1.0 - Math.pow(distFromCenter / 2800, 3));
      
      y *= valleyFactor * islandFade;
      if (y < 0) y = 0; // Sea floor / coastal beach level

      posAttr.setY(i, y);
      this.terrainHeights[i] = y;

      // Biome coloring based on altitude
      if (y === 0) {
        color.setHex(0x133858); // Shallow seabed
      } else if (y < 16) {
        color.setHex(0xd2b887); // Sandy coastal beach
      } else if (y < 75) {
        // Emerald green grass & plains
        const shade = (Math.sin(x * 0.05) + Math.cos(z * 0.05)) * 0.05;
        color.setRGB(0.2 + shade, 0.45 + shade, 0.22 + shade);
      } else if (y < 140) {
        color.setHex(0x265223); // Dark forest slopes
      } else if (y < 200) {
        color.setHex(0x636870); // Granite mountain rock
      } else {
        color.setHex(0xf0f4f8); // Snow-capped alpine peaks
      }
      colors.push(color.r, color.g, color.b);
    }

    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.1,
      flatShading: true
    });

    this.terrainMesh = new THREE.Mesh(geo, mat);
    this.terrainMesh.receiveShadow = true;
    this.scene.add(this.terrainMesh);
  }

  createOceanWater() {
    // Large shimmering ocean plane surrounding the island at sea level (y = 0.5)
    // NOTE: MeshPhysicalMaterial with transmission is extremely expensive (doubles render passes).
    // Using MeshStandardMaterial with simple alpha transparency instead — visually similar, 2x faster.
    const waterGeo = new THREE.PlaneGeometry(8000, 8000);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x0b3d66,
      roughness: 0.2,
      metalness: 0.15,
      opacity: 0.82,
      transparent: true
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.position.y = 0.5;
    water.receiveShadow = false; // Ocean doesn't need shadow reception
    this.scene.add(water);
  }

  createAirportInfrastructure() {
    const airportGroup = new THREE.Group();

    // 1. Main Asphalt Runway (Length 2200, Width 120, centered along Z from Z=800 to Z=-1400)
    const runwayGeo = new THREE.BoxGeometry(120, 1.2, 2200);
    const runwayMat = new THREE.MeshStandardMaterial({
      color: 0x22252a,
      roughness: 0.9,
      metalness: 0.05
    });
    const runway = new THREE.Mesh(runwayGeo, runwayMat);
    runway.position.set(0, 1.0, -300);
    runway.receiveShadow = true;
    airportGroup.add(runway);

    // 2. Runway Centerline Dashed Stripes & Threshold Markings using InstancedMesh (2 draw calls instead of 42!)
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const stripeGeo = new THREE.PlaneGeometry(3.5, 35);
    stripeGeo.rotateX(-Math.PI / 2);
    const stripeCount = Math.floor((720 - (-1320)) / 80) + 1;
    const stripeInstanced = new THREE.InstancedMesh(stripeGeo, stripeMat, stripeCount);
    let sIdx = 0;
    const dummy = new THREE.Object3D();
    for (let z = 720; z >= -1320; z -= 80) {
      dummy.position.set(0, 1.65, z);
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      stripeInstanced.setMatrixAt(sIdx++, dummy.matrix);
    }
    airportGroup.add(stripeInstanced);

    // Threshold piano keys (white bars at runway ends)
    const keyGeo = new THREE.PlaneGeometry(6, 40);
    keyGeo.rotateX(-Math.PI / 2);
    const keyPositions = [];
    [-1380, 780].forEach(zPos => {
      for (let x = -45; x <= 45; x += 12) {
        keyPositions.push({ x, z: zPos });
      }
    });
    const keyInstanced = new THREE.InstancedMesh(keyGeo, stripeMat, keyPositions.length);
    keyPositions.forEach((pos, i) => {
      dummy.position.set(pos.x, 1.66, pos.z);
      dummy.updateMatrix();
      keyInstanced.setMatrixAt(i, dummy.matrix);
    });
    airportGroup.add(keyInstanced);

    // 3. Runway & Approach Lighting System using InstancedMesh (3 draw calls instead of 66!)
    const greenLightMat = new THREE.MeshBasicMaterial({ color: 0x00ff44 });
    const whiteLightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const redLightMat = new THREE.MeshBasicMaterial({ color: 0xff1122 });
    const lightBox = new THREE.BoxGeometry(2, 2, 2);

    // Green threshold approach lights (11 lights)
    const greenInstanced = new THREE.InstancedMesh(lightBox, greenLightMat, 11);
    let gIdx = 0;
    for (let x = -55; x <= 55; x += 11) {
      dummy.position.set(x, 2.5, 795);
      dummy.updateMatrix();
      greenInstanced.setMatrixAt(gIdx++, dummy.matrix);
    }
    airportGroup.add(greenInstanced);

    // Red departure end lights (11 lights)
    const redInstanced = new THREE.InstancedMesh(lightBox, redLightMat, 11);
    let rIdx = 0;
    for (let x = -55; x <= 55; x += 11) {
      dummy.position.set(x, 2.5, -1395);
      dummy.updateMatrix();
      redInstanced.setMatrixAt(rIdx++, dummy.matrix);
    }
    airportGroup.add(redInstanced);

    // White side edge lights along runway (44 lights)
    const whiteCount = Math.floor((750 - (-1350)) / 100) + 1;
    const whiteInstanced = new THREE.InstancedMesh(lightBox, whiteLightMat, whiteCount * 2);
    let wIdx = 0;
    for (let z = 750; z >= -1350; z -= 100) {
      dummy.position.set(-58, 2.2, z);
      dummy.updateMatrix();
      whiteInstanced.setMatrixAt(wIdx++, dummy.matrix);
      dummy.position.set(58, 2.2, z);
      dummy.updateMatrix();
      whiteInstanced.setMatrixAt(wIdx++, dummy.matrix);
    }
    airportGroup.add(whiteInstanced);

    // 4. Control Tower & Terminal Facility (located at X: 140, Z: 100)
    const towerShaftGeo = new THREE.CylinderGeometry(8, 12, 65, 12);
    const concreteMat = new THREE.MeshStandardMaterial({ color: 0x80858c, roughness: 0.8 });
    const shaft = new THREE.Mesh(towerShaftGeo, concreteMat);
    shaft.position.set(150, 32.5, 150);
    shaft.castShadow = true;
    airportGroup.add(shaft);

    // Observation Cab
    const cabGeo = new THREE.CylinderGeometry(16, 12, 14, 12);
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x1a3350,
      roughness: 0.1,
      transmission: 0.5,
      opacity: 0.9,
      transparent: true
    });
    const cab = new THREE.Mesh(cabGeo, glassMat);
    cab.position.set(150, 72, 150);
    cab.castShadow = true;
    airportGroup.add(cab);

    // Radar Dish (rotating)
    const dishGroup = new THREE.Group();
    dishGroup.position.set(150, 83, 150);
    const dishGeo = new THREE.SphereGeometry(6, 12, 8, 0, Math.PI);
    const dish = new THREE.Mesh(dishGeo, concreteMat);
    dish.rotation.x = -Math.PI / 4;
    dishGroup.add(dish);
    airportGroup.add(dishGroup);
    this.radarDishes.push(dishGroup);

    // Blinking Red Aviation Beacon on Tower Roof
    const beaconGeo = new THREE.SphereGeometry(2, 8, 8);
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff0022 });
    const beacon = new THREE.Mesh(beaconGeo, beaconMat);
    beacon.position.set(150, 86, 150);
    airportGroup.add(beacon);
    this.warningBeacons.push(beacon);

    // 5. Aircraft Hangars alongside taxiway
    const hangarGeo = new THREE.CylinderGeometry(25, 25, 70, 16, 1, false, 0, Math.PI);
    hangarGeo.rotateZ(Math.PI / 2);
    hangarGeo.rotateY(Math.PI / 2);
    const hangarMat = new THREE.MeshStandardMaterial({ color: 0x555a64, roughness: 0.6, metalness: 0.4 });
    
    [-40, -160, -280].forEach(zPos => {
      const hangar = new THREE.Mesh(hangarGeo, hangarMat);
      hangar.position.set(150, 12.5, zPos);
      hangar.castShadow = true;
      airportGroup.add(hangar);
    });

    this.scene.add(airportGroup);
  }

  createLandmarks() {
    const landmarkGroup = new THREE.Group();

    // 1. Spinning Wind Turbines on coastal ridges
    const turbinePositions = [
      new THREE.Vector3(-450, 85, -250),
      new THREE.Vector3(-550, 110, -500),
      new THREE.Vector3(-620, 125, -780),
      new THREE.Vector3(520, 95, -400),
      new THREE.Vector3(650, 130, -680),
      new THREE.Vector3(750, 150, -950)
    ];

    const mastGeo = new THREE.CylinderGeometry(1.5, 3.5, 75, 8);
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf5f7fa, roughness: 0.4 });
    const bladeGeo = new THREE.BoxGeometry(1.2, 36, 0.4);
    bladeGeo.translate(0, 18, 0);

    turbinePositions.forEach(pos => {
      const mast = new THREE.Mesh(mastGeo, whiteMat);
      mast.position.copy(pos);
      mast.position.y = pos.y - 10;
      mast.castShadow = true;
      landmarkGroup.add(mast);

      const rotorHub = new THREE.Group();
      rotorHub.position.set(pos.x, pos.y + 28, pos.z + 2);

      for (let b = 0; b < 3; b++) {
        const blade = new THREE.Mesh(bladeGeo, whiteMat);
        blade.rotation.z = (b * Math.PI * 2) / 3;
        rotorHub.add(blade);
      }
      landmarkGroup.add(rotorHub);
      this.windTurbineRotors.push(rotorHub);
    });

    // 2. Mountain Radio Communication Towers
    const towerPositions = [
      new THREE.Vector3(950, 180, -1050),
      new THREE.Vector3(-850, 160, -1150)
    ];
    const commGeo = new THREE.ConeGeometry(8, 110, 4);
    const commMat = new THREE.MeshStandardMaterial({ color: 0xbb2233, roughness: 0.7 });
    
    towerPositions.forEach(pos => {
      const commTower = new THREE.Mesh(commGeo, commMat);
      commTower.position.set(pos.x, pos.y + 30, pos.z);
      commTower.castShadow = true;
      landmarkGroup.add(commTower);

      const bcon = new THREE.Mesh(new THREE.SphereGeometry(2.5, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff0022 }));
      bcon.position.set(pos.x, pos.y + 86, pos.z);
      landmarkGroup.add(bcon);
      this.warningBeacons.push(bcon);
    });

    // 3. Evergreen Trees Scattered Across Valleys using InstancedMesh (2 draw calls instead of 180!)
    const trunkGeo = new THREE.CylinderGeometry(0.8, 1.2, 8, 5);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3525, roughness: 0.9 });
    const foliageGeo = new THREE.ConeGeometry(5, 14, 6);
    const foliageMat = new THREE.MeshStandardMaterial({ color: 0x1e4a20, roughness: 0.8, flatShading: true });

    const treePositions = [];
    for (let i = 0; i < 90; i++) {
      const tx = (Math.random() - 0.5) * 2600;
      const tz = (Math.random() - 0.5) * 2600;
      if (Math.abs(tx) < 220 && tz > -1600 && tz < 900) continue;
      const ty = this.getTerrainHeightAt(tx, tz);
      if (ty < 18 || ty > 110) continue;
      const scale = 0.7 + Math.random() * 0.6;
      treePositions.push({ x: tx, y: ty, z: tz, scale });
    }

    const numTrees = treePositions.length;
    if (numTrees > 0) {
      const trunkInstanced = new THREE.InstancedMesh(trunkGeo, trunkMat, numTrees);
      const foliageInstanced = new THREE.InstancedMesh(foliageGeo, foliageMat, numTrees);
      const dummy = new THREE.Object3D();

      treePositions.forEach((pos, idx) => {
        dummy.position.set(pos.x, pos.y + 4 * pos.scale, pos.z);
        dummy.scale.set(pos.scale, pos.scale, pos.scale);
        dummy.rotation.set(0, Math.random() * Math.PI, 0);
        dummy.updateMatrix();
        trunkInstanced.setMatrixAt(idx, dummy.matrix);

        dummy.position.set(pos.x, pos.y + 13 * pos.scale, pos.z);
        dummy.updateMatrix();
        foliageInstanced.setMatrixAt(idx, dummy.matrix);
      });

      landmarkGroup.add(trunkInstanced, foliageInstanced);
    }

    this.scene.add(landmarkGroup);
  }

  createVolumetricClouds() {
    this.cloudGroup = new THREE.Group();
    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.8,
      transparent: true,
      opacity: 0.8,
      flatShading: true
    });
    // Use low-poly DodecahedronGeometry (0 subdivisions = 12 faces instead of 80 faces!) and 1 InstancedMesh for all 120 puffs!
    const puffGeo = new THREE.DodecahedronGeometry(45, 0);
    const cloudInstanced = new THREE.InstancedMesh(puffGeo, cloudMat, 120);
    const dummy = new THREE.Object3D();
    let idx = 0;
    
    for (let i = 0; i < 30; i++) {
      const angle = (i / 30) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const dist = 600 + Math.random() * 2400;
      const cx = Math.cos(angle) * dist;
      const cy = 200 + Math.random() * 250;
      const cz = Math.sin(angle) * dist;
      
      for (let j = 0; j < 4; j++) {
        dummy.position.set(
          cx + (Math.random() - 0.5) * 120,
          cy + (Math.random() - 0.5) * 35,
          cz + (Math.random() - 0.5) * 120
        );
        const s = 0.6 + Math.random() * 0.8;
        dummy.scale.set(s, s * 0.7, s);
        dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
        dummy.updateMatrix();
        cloudInstanced.setMatrixAt(idx++, dummy.matrix);
      }
    }
    this.cloudGroup.add(cloudInstanced);
    this.scene.add(this.cloudGroup);
  }

  createProceduralAircraft() {
    this.aircraftGroup = new THREE.Group();

    // Main body material (Sleek civilian/military silver-white with high gloss)
    this.bodyMat = new THREE.MeshStandardMaterial({
      color: 0xdcdec,
      roughness: 0.25,
      metalness: 0.65,
      flatShading: true
    });

    // Royal blue accent wing stripes
    this.accentMat = new THREE.MeshStandardMaterial({
      color: 0x0044aa,
      roughness: 0.3,
      metalness: 0.5
    });

    const bodyMat = this.bodyMat;
    const accentMat = this.accentMat;

    // 1. Fuselage
    const noseGeo = new THREE.ConeGeometry(1.8, 8, 6);
    noseGeo.rotateX(Math.PI / 2);
    noseGeo.rotateY(Math.PI / 6);
    const nose = new THREE.Mesh(noseGeo, bodyMat);
    nose.position.z = -3.5;
    nose.castShadow = true;
    this.aircraftGroup.add(nose);

    const bodyGeo = new THREE.BoxGeometry(2.6, 1.8, 6);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.z = 1.0;
    body.castShadow = true;
    this.aircraftGroup.add(body);

    // 2. Swept-back Wings
    const wingGeo = new THREE.BoxGeometry(14, 0.3, 4);
    const wings = new THREE.Mesh(wingGeo, bodyMat);
    wings.position.set(0, -0.2, 1.5);
    wings.castShadow = true;
    this.aircraftGroup.add(wings);

    // Wing accent stripes
    const stripeGeo = new THREE.BoxGeometry(10, 0.35, 1.2);
    const stripe = new THREE.Mesh(stripeGeo, accentMat);
    stripe.position.set(0, -0.15, 1.2);
    this.aircraftGroup.add(stripe);

    // 3. Navigation Lights on Wingtips
    const navLightGeo = new THREE.SphereGeometry(0.35, 8, 8);
    const leftNavMat = new THREE.MeshBasicMaterial({ color: 0xff1122 });
    const rightNavMat = new THREE.MeshBasicMaterial({ color: 0x00ff44 });
    
    const leftNav = new THREE.Mesh(navLightGeo, leftNavMat);
    leftNav.position.set(-6.9, -0.2, 1.5);
    const rightNav = new THREE.Mesh(navLightGeo, rightNavMat);
    rightNav.position.set(6.9, -0.2, 1.5);
    this.aircraftGroup.add(leftNav, rightNav);

    // 4. Tail Fins (Vertical stabilizers)
    const finGeo = new THREE.BoxGeometry(0.3, 2.6, 2.5);
    const leftFin = new THREE.Mesh(finGeo, accentMat);
    leftFin.position.set(-1.2, 1.4, 3.5);
    leftFin.rotation.z = 0.22;
    const rightFin = new THREE.Mesh(finGeo, accentMat);
    rightFin.position.set(1.2, 1.4, 3.5);
    rightFin.rotation.z = -0.22;
    this.aircraftGroup.add(leftFin, rightFin);

    // Blinking white strobe light on tail
    const strobeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.strobeLight = new THREE.Mesh(navLightGeo, strobeMat);
    this.strobeLight.position.set(0, 2.6, 3.5);
    this.aircraftGroup.add(this.strobeLight);

    // 5. Cockpit Canopy (Tinted gold-blue aviation glass)
    const canopyGeo = new THREE.BoxGeometry(1.6, 1.2, 3.5);
    const canopyMat = new THREE.MeshPhysicalMaterial({
      color: 0x113355,
      transmission: 0.75,
      opacity: 0.9,
      transparent: true,
      roughness: 0.05
    });
    const canopy = new THREE.Mesh(canopyGeo, canopyMat);
    canopy.position.set(0, 0.8, -0.8);
    this.aircraftGroup.add(canopy);

    // 6. Thrusters & Flame Plumes
    const thrusterGeo = new THREE.CylinderGeometry(0.6, 0.7, 1.5, 12);
    thrusterGeo.rotateX(Math.PI / 2);
    const thrusterMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.9 });
    
    const leftEngine = new THREE.Mesh(thrusterGeo, thrusterMat);
    leftEngine.position.set(-0.9, -0.2, 4.5);
    const rightEngine = new THREE.Mesh(thrusterGeo, thrusterMat);
    rightEngine.position.set(0.9, -0.2, 4.5);
    this.aircraftGroup.add(leftEngine, rightEngine);

    const flameGeo = new THREE.ConeGeometry(0.5, 3.5, 8);
    flameGeo.rotateX(-Math.PI / 2);
    const flameMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending
    });

    const leftFlame = new THREE.Mesh(flameGeo, flameMat);
    leftFlame.position.set(-0.9, -0.2, 6.8);
    const rightFlame = new THREE.Mesh(flameGeo, flameMat);
    rightFlame.position.set(0.9, -0.2, 6.8);
    this.aircraftGroup.add(leftFlame, rightFlame);
    this.thrusterFlames.push(leftFlame, rightFlame);

    this.scene.add(this.aircraftGroup);
  }

  setLivery(bodyHex, accentHex) {
    if (this.bodyMat) this.bodyMat.color.setHex(bodyHex);
    if (this.accentMat) this.accentMat.color.setHex(accentHex);
  }

  spawnCrashExplosion(position, velocity) {
    if (!this.scene) return;
    if (this.aircraftGroup) this.aircraftGroup.visible = false;

    // 1. Fiery Fireball Sphere
    if (!this.explosionFireball) {
      const geo = new THREE.SphereGeometry(1.5, 16, 16);
      const mat = new THREE.MeshBasicMaterial({ color: 0xff3300, transparent: true, opacity: 1.0 });
      this.explosionFireball = new THREE.Mesh(geo, mat);
      this.scene.add(this.explosionFireball);
    }
    this.explosionFireball.position.copy(position);
    this.explosionFireball.scale.set(1, 1, 1);
    this.explosionFireball.material.opacity = 1.0;
    this.explosionFireball.visible = true;

    // 2. Explosion Point Light
    if (!this.explosionLight) {
      this.explosionLight = new THREE.PointLight(0xff5500, 35, 250);
      this.scene.add(this.explosionLight);
    }
    this.explosionLight.position.copy(position);
    this.explosionLight.intensity = 40;
    this.explosionLight.visible = true;

    // 3. Debris Chunks (Fuselage and Wing fragments)
    this.clearCrashDebris();
    const debrisCount = 12;
    const debrisGeo = new THREE.BoxGeometry(1.4, 0.8, 2.0);
    for (let i = 0; i < debrisCount; i++) {
      const mat = new THREE.MeshStandardMaterial({ color: i % 2 === 0 ? 0x333333 : 0xb00020, roughness: 0.5 });
      const chunk = new THREE.Mesh(debrisGeo, mat);
      chunk.position.copy(position).add(new THREE.Vector3((Math.random()-0.5)*4, (Math.random()-0.5)*4, (Math.random()-0.5)*4));
      chunk.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
      
      const vx = (Math.random() - 0.5) * 60 + (velocity ? velocity.x * 0.4 : 0);
      const vy = Math.random() * 45 + 20;
      const vz = (Math.random() - 0.5) * 60 + (velocity ? velocity.z * 0.4 : 0);
      
      chunk.userData = { vx, vy, vz, rx: (Math.random()-0.5)*12, ry: (Math.random()-0.5)*12 };
      this.scene.add(chunk);
      this.debrisParticles.push(chunk);
    }

    // 4. Rising Smoke Plumes
    const smokeGeo = new THREE.SphereGeometry(2.8, 8, 8);
    for (let i = 0; i < 18; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.85 });
      const smoke = new THREE.Mesh(smokeGeo, mat);
      smoke.position.copy(position).add(new THREE.Vector3((Math.random()-0.5)*8, Math.random()*5, (Math.random()-0.5)*8));
      const vx = (Math.random() - 0.5) * 12;
      const vy = Math.random() * 25 + 12;
      const vz = (Math.random() - 0.5) * 12;
      smoke.userData = { vx, vy, vz, scaleRate: Math.random() * 3 + 2.5, life: 1.0 };
      this.scene.add(smoke);
      this.smokeParticles.push(smoke);
    }
  }

  clearCrashDebris() {
    this.debrisParticles.forEach(c => { this.scene.remove(c); c.geometry.dispose(); c.material.dispose(); });
    this.debrisParticles = [];
    this.smokeParticles.forEach(s => { this.scene.remove(s); s.geometry.dispose(); s.material.dispose(); });
    this.smokeParticles = [];
  }

  resetAircraftVisuals() {
    if (this.aircraftGroup) this.aircraftGroup.visible = true;
    if (this.explosionFireball) this.explosionFireball.visible = false;
    if (this.explosionLight) this.explosionLight.visible = false;
    this.clearCrashDebris();
  }

  updateCrashEffects(dt) {
    if (this.explosionFireball && this.explosionFireball.visible) {
      this.explosionFireball.scale.addScalar(28 * dt);
      this.explosionFireball.material.opacity -= 1.3 * dt;
      if (this.explosionFireball.material.opacity <= 0) {
        this.explosionFireball.visible = false;
      }
    }

    if (this.explosionLight && this.explosionLight.visible) {
      this.explosionLight.intensity = Math.max(0, this.explosionLight.intensity - 35 * dt);
      if (this.explosionLight.intensity <= 0) this.explosionLight.visible = false;
    }

    this.debrisParticles.forEach(chunk => {
      chunk.userData.vy -= 48 * dt; // gravity
      chunk.position.x += chunk.userData.vx * dt;
      chunk.position.y += chunk.userData.vy * dt;
      chunk.position.z += chunk.userData.vz * dt;
      chunk.rotation.x += chunk.userData.rx * dt;
      chunk.rotation.y += chunk.userData.ry * dt;

      const groundY = this.getTerrainHeightAt(chunk.position.x, chunk.position.z);
      if (chunk.position.y <= groundY + 0.6) {
        chunk.position.y = groundY + 0.6;
        chunk.userData.vy = -chunk.userData.vy * 0.35;
        chunk.userData.vx *= 0.8;
        chunk.userData.vz *= 0.8;
      }
    });

    for (let i = this.smokeParticles.length - 1; i >= 0; i--) {
      const s = this.smokeParticles[i];
      s.position.x += s.userData.vx * dt;
      s.position.y += s.userData.vy * dt;
      s.position.z += s.userData.vz * dt;
      s.scale.addScalar(s.userData.scaleRate * dt);
      s.userData.life -= 0.65 * dt;
      s.material.opacity = Math.max(0, s.userData.life * 0.75);
      if (s.userData.life <= 0) {
        this.scene.remove(s);
        s.geometry.dispose();
        s.material.dispose();
        this.smokeParticles.splice(i, 1);
      }
    }
  }

  /**
   * Fast elevation query for flight physics and ground collision avoidance.
   * @param {number} x - World X coordinate
   * @param {number} z - World Z coordinate
   * @returns {number} Terrain altitude Y at (x, z)
   */
  getTerrainHeightAt(x, z) {
    // 1. Runway strip check (flat airfield tarmac at y = 1.6)
    if (Math.abs(x) < 65 && z > -1410 && z < 810) {
      return 1.6;
    }
    if (!this.terrainHeights) return 0;

    const halfSize = this.terrainSize / 2;
    const cell = this.terrainSize / this.terrainSegs;
    const gx = Math.floor((x + halfSize) / cell);
    const gz = Math.floor((z + halfSize) / cell);

    if (gx < 0 || gx >= this.terrainSegs || gz < 0 || gz >= this.terrainSegs) {
      return 0; // Ocean water level
    }

    const idx = gz * (this.terrainSegs + 1) + gx;
    return this.terrainHeights[idx] || 0;
  }

  /**
   * Updates camera positioning, animations, and thruster plumes per frame.
   * @param {number} dt - Delta time
   * @param {FlightPhysics} physics - Current physics instance
   */
  update(dt, physics) {
    // 0. Update Crash Effects if active
    this.updateCrashEffects(dt);
    if (physics.isCrashed) {
      // Wreckage camera orbit — reuse pre-allocated _tmpCrashCenter
      this._tmpCrashCenter.copy(physics.position);
      const timeSec = performance.now() * 0.001;
      this.camWorldPos.set(
        this._tmpCrashCenter.x + Math.cos(timeSec * 0.4) * 45,
        this._tmpCrashCenter.y + 22 + Math.sin(timeSec * 8) * 1.5,
        this._tmpCrashCenter.z + Math.sin(timeSec * 0.4) * 45
      );
      if (this.activeCameraMode === 'chase') {
        this.chaseCamera.position.copy(this.camWorldPos);
        this.chaseCamera.lookAt(this._tmpCrashCenter);
      } else {
        this.cockpitCamera.position.copy(this.camWorldPos);
        this.cockpitCamera.lookAt(this._tmpCrashCenter);
      }
      return;
    }

    // 1. Sync aircraft group transform to physics state
    this.aircraftGroup.position.copy(physics.position);
    this.aircraftGroup.quaternion.copy(physics.quaternion);

    // 2. Animate Thruster Flames (use pre-allocated flicker; only update color when it changes)
    const boostScale = physics.isBoosting ? 2.4 : 1.0 + (physics.throttle * 0.5);
    const flameColorHex = physics.isBoosting ? 0xff007b : 0x00f0ff;
    const flameZ = boostScale * (0.9 + Math.random() * 0.2);
    if (flameColorHex !== this._lastFlameColorHex) {
      this.thrusterFlames.forEach(flame => flame.material.color.setHex(flameColorHex));
      this._lastFlameColorHex = flameColorHex;
    }
    this.thrusterFlames.forEach(flame => flame.scale.z = flameZ);

    // 3. Animate Strobe Light & Beacons
    this.strobeTimer += dt;
    const strobeVisible = (Math.floor(this.strobeTimer * 6) % 2) === 0;
    if (this.strobeLight) this.strobeLight.visible = strobeVisible;
    this.warningBeacons.forEach(b => { b.visible = strobeVisible; });

    // 4. Animate Wind Turbine Blades & Radar Dishes
    this.windTurbineRotors.forEach(rotor => {
      rotor.rotation.z += dt * 2.2;
    });
    this.radarDishes.forEach(dish => {
      dish.rotation.y += dt * 1.5;
    });

    // 5. Update Active Camera Rig (all Vector3 ops use pre-allocated temporaries — zero allocations!)
    if (this.activeCameraMode === 'chase') {
      // Compute target camera position: aircraft + local offset rotated by aircraft quaternion
      this._tmpOffset.set(0, 7.5, 26).applyQuaternion(physics.quaternion);
      this._tmpTargetPos.copy(physics.position).add(this._tmpOffset);

      // Ensure camera stays above terrain ground floor
      const camTerrainY = this.getTerrainHeightAt(this._tmpTargetPos.x, this._tmpTargetPos.z);
      if (this._tmpTargetPos.y < camTerrainY + 4) {
        this._tmpTargetPos.y = camTerrainY + 4;
      }

      const lerpSpeed = Math.min(1.0, 10.0 * dt);
      this.camWorldPos.lerp(this._tmpTargetPos, lerpSpeed);
      this.chaseCamera.position.copy(this.camWorldPos);

      this._tmpLookAhead.copy(physics.position).addScaledVector(physics.forwardVector, 20);
      this.camWorldLookAt.lerp(this._tmpLookAhead, lerpSpeed);
      this.chaseCamera.lookAt(this.camWorldLookAt);

      const rollBank = Math.max(-0.4, Math.min(0.4, physics.euler.z * 0.35));
      this.chaseCamera.rotation.z += rollBank;

    } else if (this.activeCameraMode === 'cockpit') {
      this._tmpCockpitOffset.set(0, 1.2, -0.5).applyQuaternion(physics.quaternion);
      this._tmpCockpitOffset.add(physics.position);
      this.cockpitCamera.position.copy(this._tmpCockpitOffset);

      this._tmpCockpitLook.copy(this._tmpCockpitOffset).addScaledVector(physics.forwardVector, 100);
      this.cockpitCamera.lookAt(this._tmpCockpitLook);
      this.cockpitCamera.quaternion.copy(physics.quaternion);
    }

    // 6. Render Scene
    const cam = this.activeCameraMode === 'chase' ? this.chaseCamera : this.cockpitCamera;
    this.renderer.render(this.scene, cam);
  }

  toggleCameraMode() {
    this.activeCameraMode = this.activeCameraMode === 'chase' ? 'cockpit' : 'chase';
    console.log(`[SceneSetup] Camera toggled to: ${this.activeCameraMode}`);
    return this.activeCameraMode;
  }

  onWindowResize() {
    if (!this.container || !this.renderer) return;
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;

    this.renderer.setSize(width, height);
    this.chaseCamera.aspect = width / height;
    this.chaseCamera.updateProjectionMatrix();
    this.cockpitCamera.aspect = width / height;
    this.cockpitCamera.updateProjectionMatrix();
  }

  dispose() {
    window.removeEventListener('resize', this.onWindowResize);
    if (this.renderer && this.renderer.domElement) {
      this.renderer.dispose();
      if (this.container && this.container.contains(this.renderer.domElement)) {
        this.container.removeChild(this.renderer.domElement);
      }
    }
  }
}

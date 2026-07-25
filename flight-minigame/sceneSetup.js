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
  }

  init(containerDOM) {
    this.container = containerDOM;
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;

    // 1. Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
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
    const waterGeo = new THREE.PlaneGeometry(8000, 8000);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshPhysicalMaterial({
      color: 0x0b3d66,
      roughness: 0.15,
      metalness: 0.1,
      transmission: 0.4,
      opacity: 0.88,
      transparent: true
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.position.y = 0.5;
    water.receiveShadow = true;
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

    // 2. Runway Centerline Dashed Stripes & Threshold Markings
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (let z = 720; z >= -1320; z -= 80) {
      const stripeGeo = new THREE.PlaneGeometry(3.5, 35);
      stripeGeo.rotateX(-Math.PI / 2);
      const stripe = new THREE.Mesh(stripeGeo, stripeMat);
      stripe.position.set(0, 1.65, z);
      airportGroup.add(stripe);
    }

    // Threshold piano keys (white bars at runway ends)
    [-1380, 780].forEach(zPos => {
      for (let x = -45; x <= 45; x += 12) {
        const keyGeo = new THREE.PlaneGeometry(6, 40);
        keyGeo.rotateX(-Math.PI / 2);
        const key = new THREE.Mesh(keyGeo, stripeMat);
        key.position.set(x, 1.66, zPos);
        airportGroup.add(key);
      }
    });

    // 3. Runway & Approach Lighting System
    const greenLightMat = new THREE.MeshBasicMaterial({ color: 0x00ff44 });
    const whiteLightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const redLightMat = new THREE.MeshBasicMaterial({ color: 0xff1122 });
    const lightSphere = new THREE.SphereGeometry(1.5, 8, 8);

    // Green threshold approach lights
    for (let x = -55; x <= 55; x += 11) {
      const gLight = new THREE.Mesh(lightSphere, greenLightMat);
      gLight.position.set(x, 2.5, 795);
      airportGroup.add(gLight);
    }
    // Red departure end lights
    for (let x = -55; x <= 55; x += 11) {
      const rLight = new THREE.Mesh(lightSphere, redLightMat);
      rLight.position.set(x, 2.5, -1395);
      airportGroup.add(rLight);
    }
    // White side edge lights along runway
    for (let z = 750; z >= -1350; z -= 100) {
      const leftLight = new THREE.Mesh(lightSphere, whiteLightMat);
      leftLight.position.set(-58, 2.2, z);
      const rightLight = new THREE.Mesh(lightSphere, whiteLightMat);
      rightLight.position.set(58, 2.2, z);
      airportGroup.add(leftLight, rightLight);
    }

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

    // 3. Evergreen Trees Scattered Across Valleys
    const trunkGeo = new THREE.CylinderGeometry(0.8, 1.2, 8, 5);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3525, roughness: 0.9 });
    const foliageGeo = new THREE.ConeGeometry(5, 14, 6);
    const foliageMat = new THREE.MeshStandardMaterial({ color: 0x1e4a20, roughness: 0.8, flatShading: true });

    for (let i = 0; i < 90; i++) {
      const tx = (Math.random() - 0.5) * 2600;
      const tz = (Math.random() - 0.5) * 2600;
      // Keep away from runway strip
      if (Math.abs(tx) < 220 && tz > -1600 && tz < 900) continue;

      const ty = this.getTerrainHeightAt(tx, tz);
      if (ty < 18 || ty > 110) continue; // Only plant trees on green hillsides

      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 4;
      const foliage = new THREE.Mesh(foliageGeo, foliageMat);
      foliage.position.y = 13;
      tree.add(trunk, foliage);
      tree.position.set(tx, ty, tz);
      const scale = 0.7 + Math.random() * 0.6;
      tree.scale.set(scale, scale, scale);
      landmarkGroup.add(tree);
    }

    this.scene.add(landmarkGroup);
  }

  createVolumetricClouds() {
    this.cloudGroup = new THREE.Group();
    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.8,
      transparent: true,
      opacity: 0.75,
      flatShading: true
    });

    // Spawn 60 fluffy cloud clusters
    for (let i = 0; i < 60; i++) {
      const cluster = new THREE.Group();
      const numPuffs = 5 + Math.floor(Math.random() * 6);
      
      for (let j = 0; j < numPuffs; j++) {
        const radius = 30 + Math.random() * 40;
        const puffGeo = new THREE.DodecahedronGeometry(radius, 1);
        const puff = new THREE.Mesh(puffGeo, cloudMat);
        puff.position.set(
          (Math.random() - 0.5) * 90,
          (Math.random() - 0.5) * 25,
          (Math.random() - 0.5) * 90
        );
        cluster.add(puff);
      }

      const angle = Math.random() * Math.PI * 2;
      const dist = 400 + Math.random() * 2600;
      cluster.position.set(
        Math.cos(angle) * dist,
        180 + Math.random() * 280,
        Math.sin(angle) * dist
      );
      this.cloudGroup.add(cluster);
    }

    this.scene.add(this.cloudGroup);
  }

  createProceduralAircraft() {
    this.aircraftGroup = new THREE.Group();

    // Main body material (Sleek civilian/military silver-white with high gloss)
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xdcdec,
      roughness: 0.25,
      metalness: 0.65,
      flatShading: true
    });

    // Royal blue accent wing stripes
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0x0044aa,
      roughness: 0.3,
      metalness: 0.5
    });

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
    // 1. Sync aircraft group transform to physics state
    this.aircraftGroup.position.copy(physics.position);
    this.aircraftGroup.quaternion.copy(physics.quaternion);

    // 2. Animate Thruster Flames
    const boostScale = physics.isBoosting ? 2.4 : 1.0 + (physics.throttle * 0.5);
    const flameColorHex = physics.isBoosting ? 0xff007b : 0x00f0ff;
    
    this.thrusterFlames.forEach(flame => {
      flame.scale.set(1, 1, boostScale * (0.9 + Math.random() * 0.2));
      flame.material.color.setHex(flameColorHex);
    });

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

    // 5. Update Active Camera Rig
    if (this.activeCameraMode === 'chase') {
      const localOffset = new THREE.Vector3(0, 7.5, 26);
      const targetPos = physics.position.clone().add(localOffset.clone().applyQuaternion(physics.quaternion));
      
      // Ensure camera stays above terrain ground floor
      const camTerrainY = this.getTerrainHeightAt(targetPos.x, targetPos.z);
      if (targetPos.y < camTerrainY + 4) {
        targetPos.y = camTerrainY + 4;
      }

      const lerpSpeed = Math.min(1.0, 10.0 * dt);
      this.camWorldPos.lerp(targetPos, lerpSpeed);
      this.chaseCamera.position.copy(this.camWorldPos);

      const lookAhead = physics.position.clone().addScaledVector(physics.forwardVector, 20);
      this.camWorldLookAt.lerp(lookAhead, lerpSpeed);
      this.chaseCamera.lookAt(this.camWorldLookAt);

      const rollBank = Math.max(-0.4, Math.min(0.4, physics.euler.z * 0.35));
      this.chaseCamera.rotation.z += rollBank;

    } else if (this.activeCameraMode === 'cockpit') {
      const cockpitOffset = new THREE.Vector3(0, 1.2, -0.5);
      const camPos = physics.position.clone().add(cockpitOffset.applyQuaternion(physics.quaternion));
      this.cockpitCamera.position.copy(camPos);
      
      const lookTarget = camPos.clone().addScaledVector(physics.forwardVector, 100);
      this.cockpitCamera.lookAt(lookTarget);
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

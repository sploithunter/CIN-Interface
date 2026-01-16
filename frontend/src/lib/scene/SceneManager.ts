/**
 * Main Three.js scene manager
 * Handles renderer, camera, lighting, and animation loop
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { ManagedSession, VibecraftEvent } from '../../types';
import { SessionZone } from './SessionZone';
import { ParticleSystem } from './ParticleSystem';
import { hexToWorld, findNextAvailableHex, getOccupiedHexes, HEX_SIZE } from './HexGrid';

export class SceneManager {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private clock: THREE.Clock;
  private animationId: number | null = null;

  // Scene objects
  private sessionZones: Map<string, SessionZone> = new Map();
  private particleSystem: ParticleSystem;
  private gridHelper: THREE.Group;
  private ambientLight: THREE.AmbientLight;
  private directionalLight: THREE.DirectionalLight;

  // Interaction
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  private hoveredZone: SessionZone | null = null;
  private selectedZoneId: string | null = null;
  private hasInitialFocus = false;

  // Callbacks
  private onZoneSelect?: (sessionId: string | null) => void;

  constructor(container: HTMLElement) {
    this.container = container;
    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // Create scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0f1a);
    this.scene.fog = new THREE.Fog(0x0a0f1a, 50, 150);

    // Create camera
    const aspect = container.clientWidth / container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 500);
    this.camera.position.set(0, 15, 12);
    this.camera.lookAt(0, 0, 0);

    // Create renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
    });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // Create controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 150;
    this.controls.maxPolarAngle = Math.PI / 2.2; // Limit vertical rotation
    this.controls.target.set(0, 0, 0);

    // Add lighting
    this.ambientLight = new THREE.AmbientLight(0x404060, 0.6);
    this.scene.add(this.ambientLight);

    this.directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    this.directionalLight.position.set(10, 20, 10);
    this.directionalLight.castShadow = true;
    this.directionalLight.shadow.mapSize.width = 2048;
    this.directionalLight.shadow.mapSize.height = 2048;
    this.directionalLight.shadow.camera.near = 1;
    this.directionalLight.shadow.camera.far = 50;
    this.directionalLight.shadow.camera.left = -20;
    this.directionalLight.shadow.camera.right = 20;
    this.directionalLight.shadow.camera.top = 20;
    this.directionalLight.shadow.camera.bottom = -20;
    this.scene.add(this.directionalLight);

    // Add subtle rim light
    const rimLight = new THREE.DirectionalLight(0x3b82f6, 0.3);
    rimLight.position.set(-10, 5, -10);
    this.scene.add(rimLight);

    // Create ground grid
    this.gridHelper = this.createGroundGrid();
    this.scene.add(this.gridHelper);

    // Create particle system
    this.particleSystem = new ParticleSystem(this.scene);

    // Event listeners
    this.setupEventListeners();

    // Handle resize
    window.addEventListener('resize', this.handleResize);
  }

  private createGroundGrid(): THREE.Group {
    const group = new THREE.Group();

    // Ground plane
    const groundGeometry = new THREE.CircleGeometry(80, 64);
    const groundMaterial = new THREE.MeshStandardMaterial({
      color: 0x0a0f1a,
      metalness: 0.1,
      roughness: 0.9,
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.25;
    ground.receiveShadow = true;
    group.add(ground);

    // Create hexagonal grid pattern
    const hexGrid = this.createHexGridLines(15, HEX_SIZE * 1.1);
    group.add(hexGrid);

    return group;
  }

  private createHexGridLines(rings: number, hexSize: number): THREE.Group {
    const group = new THREE.Group();
    const material = new THREE.LineBasicMaterial({
      color: 0x1e3a5f,
      transparent: true,
      opacity: 0.4,
    });

    // Generate hex positions in a spiral pattern
    const hexPositions: Array<{ q: number; r: number }> = [];
    hexPositions.push({ q: 0, r: 0 });

    for (let ring = 1; ring <= rings; ring++) {
      const directions = [
        { q: 1, r: 0 },
        { q: 0, r: 1 },
        { q: -1, r: 1 },
        { q: -1, r: 0 },
        { q: 0, r: -1 },
        { q: 1, r: -1 },
      ];

      let hex = { q: ring * directions[4].q, r: ring * directions[4].r };

      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < ring; j++) {
          hexPositions.push({ ...hex });
          hex = { q: hex.q + directions[i].q, r: hex.r + directions[i].r };
        }
      }
    }

    // Create hex outlines at each position
    for (const pos of hexPositions) {
      const worldPos = hexToWorld(pos);
      const hexOutline = this.createSingleHexOutline(hexSize, material);
      hexOutline.position.set(worldPos.x, -0.2, worldPos.z);
      group.add(hexOutline);
    }

    return group;
  }

  private createSingleHexOutline(size: number, material: THREE.LineBasicMaterial): THREE.LineLoop {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 - Math.PI / 2;
      points.push(new THREE.Vector3(
        Math.cos(angle) * size,
        0,
        Math.sin(angle) * size
      ));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    return new THREE.LineLoop(geometry, material);
  }

  private setupEventListeners(): void {
    this.renderer.domElement.addEventListener('mousemove', this.handleMouseMove);
    this.renderer.domElement.addEventListener('click', this.handleClick);
  }

  private handleMouseMove = (event: MouseEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Raycast to find hovered zone
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(
      Array.from(this.sessionZones.values()).map((z) => z.getMesh()),
      false
    );

    const newHovered = intersects.length > 0
      ? this.findZoneByMesh(intersects[0].object as THREE.Mesh)
      : null;

    if (newHovered !== this.hoveredZone) {
      if (this.hoveredZone) this.hoveredZone.setHovered(false);
      if (newHovered) newHovered.setHovered(true);
      this.hoveredZone = newHovered;
      this.renderer.domElement.style.cursor = newHovered ? 'pointer' : 'default';
    }
  };

  private handleClick = (): void => {
    if (this.hoveredZone) {
      const sessionId = this.hoveredZone.getSessionId();
      this.selectZone(sessionId);
      this.onZoneSelect?.(sessionId);
    }
  };

  private findZoneByMesh(mesh: THREE.Mesh): SessionZone | null {
    for (const zone of this.sessionZones.values()) {
      if (zone.getMesh() === mesh) {
        return zone;
      }
    }
    return null;
  }

  private handleResize = (): void => {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  // Public API

  start(): void {
    if (this.animationId !== null) return;
    this.animate();
  }

  stop(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  private animate = (): void => {
    this.animationId = requestAnimationFrame(this.animate);
    const delta = this.clock.getDelta();
    const elapsed = this.clock.getElapsedTime();

    // Update controls
    this.controls.update();

    // Update all session zones
    for (const zone of this.sessionZones.values()) {
      zone.update(delta, elapsed);
    }

    // Update particle system
    this.particleSystem.update(delta);

    // Render
    this.renderer.render(this.scene, this.camera);
  };

  updateSessions(sessions: ManagedSession[]): void {
    const currentIds = new Set(sessions.map((s) => s.id));
    const occupied = getOccupiedHexes(sessions);

    // Remove zones for deleted sessions
    for (const [id, zone] of this.sessionZones) {
      if (!currentIds.has(id)) {
        zone.dispose();
        this.scene.remove(zone.getGroup());
        this.sessionZones.delete(id);
      }
    }

    // Update or create zones
    for (let i = 0; i < sessions.length; i++) {
      const session = sessions[i];
      let zone = this.sessionZones.get(session.id);

      if (!zone) {
        // Assign position if not set
        const position = session.zonePosition || findNextAvailableHex(occupied);
        if (!session.zonePosition) {
          occupied.add(`${position.q},${position.r}`);
        }

        const worldPos = hexToWorld(position);
        zone = new SessionZone(session, worldPos, i);
        this.sessionZones.set(session.id, zone);
        this.scene.add(zone.getGroup());
      }

      zone.setSessionIndex(i);
      zone.updateSession(session);

      // Update selection state
      if (session.id === this.selectedZoneId) {
        zone.setSelected(true);
      }
    }

    // Auto-focus camera on sessions on first load
    if (!this.hasInitialFocus && sessions.length > 0) {
      this.focusOnSessions();
      this.hasInitialFocus = true;
    }
  }

  private focusOnSessions(): void {
    if (this.sessionZones.size === 0) return;

    // Calculate centroid of all zones
    const centroid = new THREE.Vector3();
    for (const zone of this.sessionZones.values()) {
      centroid.add(zone.getPosition());
    }
    centroid.divideScalar(this.sessionZones.size);

    // Set camera target to centroid
    this.controls.target.copy(centroid);

    // Position camera above and behind the centroid
    const cameraOffset = new THREE.Vector3(0, 20, 25);
    this.camera.position.copy(centroid).add(cameraOffset);
  }

  handleEvent(event: VibecraftEvent): void {
    // Find the zone for this event
    for (const zone of this.sessionZones.values()) {
      if (zone.matchesEvent(event)) {
        if (event.type === 'pre_tool_use' && event.tool) {
          zone.activateTool(event.tool);
          // Spawn particles at zone position
          const pos = zone.getPosition();
          this.particleSystem.burst(pos, event.tool);

          // Extract file path from tool input
          const filePath = this.extractFilePath(event.toolInput);
          if (filePath) {
            zone.addFile(filePath);
          }
        } else if (event.type === 'post_tool_use') {
          zone.deactivateTool();
        }
        break;
      }
    }
  }

  private extractFilePath(toolInput: unknown): string | null {
    if (!toolInput || typeof toolInput !== 'object') return null;
    const input = toolInput as Record<string, unknown>;
    // Common file path field names
    const pathFields = ['file_path', 'path', 'notebook_path', 'filePath'];
    for (const field of pathFields) {
      if (typeof input[field] === 'string') {
        return input[field] as string;
      }
    }
    return null;
  }

  selectZone(sessionId: string | null): void {
    // Deselect previous
    if (this.selectedZoneId) {
      const prevZone = this.sessionZones.get(this.selectedZoneId);
      prevZone?.setSelected(false);
    }

    this.selectedZoneId = sessionId;

    // Select new
    if (sessionId) {
      const zone = this.sessionZones.get(sessionId);
      zone?.setSelected(true);

      // Optionally focus camera on selected zone
      if (zone) {
        const pos = zone.getPosition();
        this.controls.target.lerp(pos, 0.3);
      }
    }
  }

  setOnZoneSelect(callback: (sessionId: string | null) => void): void {
    this.onZoneSelect = callback;
  }

  focusOnCenter(): void {
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(0, 15, 12);
  }

  dispose(): void {
    this.stop();

    // Remove event listeners
    window.removeEventListener('resize', this.handleResize);
    this.renderer.domElement.removeEventListener('mousemove', this.handleMouseMove);
    this.renderer.domElement.removeEventListener('click', this.handleClick);

    // Dispose zones
    for (const zone of this.sessionZones.values()) {
      zone.dispose();
    }
    this.sessionZones.clear();

    // Dispose particle system
    this.particleSystem.dispose();

    // Dispose Three.js resources
    this.controls.dispose();
    this.renderer.dispose();

    // Remove canvas
    this.container.removeChild(this.renderer.domElement);
  }
}

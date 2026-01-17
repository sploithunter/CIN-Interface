/**
 * SessionZone - Visual representation of a single Claude session
 * Vibecraft-style hex platform with glowing edge, stations, and labels
 */

import * as THREE from 'three';
import type { ManagedSession, VibecraftEvent } from '../../types';
import { HEX_SIZE, HEX_HEIGHT } from './HexGrid';

// Tool to station mapping
const TOOL_STATION_MAP: Record<string, string> = {
  Read: 'bookshelf',
  Write: 'desk',
  Edit: 'workbench',
  Bash: 'terminal',
  Grep: 'scanner',
  Glob: 'scanner',
  WebFetch: 'antenna',
  WebSearch: 'antenna',
  Task: 'portal',
  TodoWrite: 'taskboard',
  AskUserQuestion: 'center',
  NotebookEdit: 'desk',
};

// Station colors (vibrant)
const STATION_COLORS: Record<string, number> = {
  bookshelf: 0x8b5cf6,
  desk: 0x3b82f6,
  workbench: 0xf59e0b,
  terminal: 0x22c55e,
  scanner: 0x06b6d4,
  antenna: 0xec4899,
  portal: 0xa855f7,
  taskboard: 0xeab308,
  center: 0x64748b,
};

// Status colors (bright, obvious)
const STATUS_COLORS: Record<string, number> = {
  idle: 0x22d3ee,    // Bright cyan
  working: 0x22c55e, // Bright green
  waiting: 0xe07b39, // Rusty red/orange - NEEDS ATTENTION!
  offline: 0x475569, // Muted gray
};

// Edge glow intensity by status
const STATUS_GLOW: Record<string, number> = {
  idle: 0.6,
  working: 1.0,
  waiting: 1.2,
  offline: 0.2,
};

export class SessionZone {
  private session: ManagedSession;
  private sessionIndex: number;
  private group: THREE.Group;
  private hexMesh: THREE.Mesh;
  private hexSurface: THREE.Mesh; // Top surface for better visibility
  private edgeTube: THREE.Mesh;
  private edgeGlow: THREE.Mesh;
  private sessionLabel: THREE.Sprite;
  private gitLabel: THREE.Sprite | null = null;
  private toolLabel: THREE.Sprite | null = null;
  private fileLabels: THREE.Sprite[] = [];
  private recentFiles: string[] = [];
  private stations: Map<string, THREE.Object3D> = new Map();
  private activeStation: string | null = null;

  // Animation
  private pulsePhase = Math.random() * Math.PI * 2;
  private isHovered = false;
  private isSelected = false;
  private targetScale = 1.0;
  private currentScale = 1.0;

  // Disposables
  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];

  constructor(session: ManagedSession, position: THREE.Vector3, sessionIndex: number = 0) {
    this.session = session;
    this.sessionIndex = sessionIndex;
    this.group = new THREE.Group();
    this.group.position.copy(position);

    // Build components
    this.hexMesh = this.createHexPlatform();
    this.group.add(this.hexMesh);

    this.hexSurface = this.createHexSurface();
    this.group.add(this.hexSurface);

    this.edgeTube = this.createEdgeTube();
    this.group.add(this.edgeTube);

    this.edgeGlow = this.createEdgeGlow();
    this.group.add(this.edgeGlow);

    this.createStations();

    this.sessionLabel = this.createSessionLabel();
    this.group.add(this.sessionLabel);

    if (session.gitStatus?.isRepo) {
      this.gitLabel = this.createGitLabel();
      this.group.add(this.gitLabel);
    }

    this.updateStatus(session.status);
  }

  // === PLATFORM ===

  private createHexPlatform(): THREE.Mesh {
    const shape = new THREE.Shape();
    const points = this.getHexPoints(HEX_SIZE);

    shape.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      shape.lineTo(points[i].x, points[i].y);
    }
    shape.closePath();

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: HEX_HEIGHT,
      bevelEnabled: false,
    });
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, 0, 0);
    this.geometries.push(geometry);

    const material = new THREE.MeshStandardMaterial({
      color: 0x1a2744,
      metalness: 0.3,
      roughness: 0.7,
      transparent: true,
      opacity: 0.85,
    });
    this.materials.push(material);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = -HEX_HEIGHT / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    return mesh;
  }

  private createHexSurface(): THREE.Mesh {
    // Top surface for better visibility with subtle grid pattern
    const shape = new THREE.Shape();
    const points = this.getHexPoints(HEX_SIZE - 0.15);

    shape.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      shape.lineTo(points[i].x, points[i].y);
    }
    shape.closePath();

    const geometry = new THREE.ShapeGeometry(shape);
    geometry.rotateX(-Math.PI / 2);
    this.geometries.push(geometry);

    const material = new THREE.MeshBasicMaterial({
      color: 0x1e3a5f,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
    });
    this.materials.push(material);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = HEX_HEIGHT / 2 + 0.01;

    return mesh;
  }

  // === GLOWING EDGE ===

  private createEdgeTube(): THREE.Mesh {
    // Create a tube along the hex edge for thick visible line
    const points = this.getHexPoints3D(HEX_SIZE, HEX_HEIGHT / 2 + 0.02);
    points.push(points[0].clone()); // Close the loop

    const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0);
    const geometry = new THREE.TubeGeometry(curve, 64, 0.08, 8, false);
    this.geometries.push(geometry);

    const material = new THREE.MeshBasicMaterial({
      color: STATUS_COLORS.idle,
      transparent: true,
      opacity: 1.0,
    });
    this.materials.push(material);

    return new THREE.Mesh(geometry, material);
  }

  private createEdgeGlow(): THREE.Mesh {
    // Wider glow behind the edge
    const points = this.getHexPoints3D(HEX_SIZE, HEX_HEIGHT / 2 + 0.01);
    points.push(points[0].clone());

    const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0);
    const geometry = new THREE.TubeGeometry(curve, 64, 0.25, 8, false);
    this.geometries.push(geometry);

    const material = new THREE.MeshBasicMaterial({
      color: STATUS_COLORS.idle,
      transparent: true,
      opacity: 0.3,
    });
    this.materials.push(material);

    return new THREE.Mesh(geometry, material);
  }

  // === STATIONS ===

  private createStations(): void {
    const stationTypes = [...new Set(Object.values(TOOL_STATION_MAP))];
    const radius = HEX_SIZE * 0.65;

    stationTypes.forEach((type, index) => {
      const angle = (index / stationTypes.length) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;

      const station = this.createStation(type);
      station.position.set(x, HEX_HEIGHT / 2, z);
      this.stations.set(type, station);
      this.group.add(station);
    });
  }

  private createStationMaterial(type: string): THREE.MeshStandardMaterial {
    const color = STATION_COLORS[type] || STATION_COLORS.center;
    const material = new THREE.MeshStandardMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 0.3,
      metalness: 0.5,
      roughness: 0.5,
    });
    this.materials.push(material);
    return material;
  }

  private createStation(type: string): THREE.Object3D {
    const color = STATION_COLORS[type] || STATION_COLORS.center;
    const material = this.createStationMaterial(type);

    switch (type) {
      case 'terminal':
        return this.createTerminalStation(material);
      case 'bookshelf':
        return this.createBookshelfStation(material);
      case 'desk':
        return this.createDeskStation(material);
      case 'workbench':
        return this.createWorkbenchStation(material);
      case 'scanner':
        return this.createScannerStation(material);
      case 'antenna':
        return this.createAntennaStation(material);
      case 'portal':
        return this.createPortalStation(material);
      case 'taskboard':
        return this.createTaskboardStation(material);
      default:
        return this.createDefaultStation(material);
    }
  }

  // Terminal: Computer monitor on a stand (Bash)
  private createTerminalStation(material: THREE.MeshStandardMaterial): THREE.Group {
    const group = new THREE.Group();

    // Monitor screen (main box)
    const screenGeo = new THREE.BoxGeometry(0.4, 0.3, 0.05);
    this.geometries.push(screenGeo);
    const screen = new THREE.Mesh(screenGeo, material);
    screen.position.y = 0.35;
    screen.castShadow = true;
    group.add(screen);

    // Monitor bezel (darker frame)
    const bezelMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a2e,
      metalness: 0.7,
      roughness: 0.3,
    });
    this.materials.push(bezelMat);
    const bezelGeo = new THREE.BoxGeometry(0.44, 0.34, 0.03);
    this.geometries.push(bezelGeo);
    const bezel = new THREE.Mesh(bezelGeo, bezelMat);
    bezel.position.set(0, 0.35, -0.02);
    bezel.castShadow = true;
    group.add(bezel);

    // Stand neck
    const neckGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.15, 8);
    this.geometries.push(neckGeo);
    const neck = new THREE.Mesh(neckGeo, bezelMat);
    neck.position.y = 0.1;
    group.add(neck);

    // Stand base
    const baseGeo = new THREE.CylinderGeometry(0.12, 0.14, 0.03, 12);
    this.geometries.push(baseGeo);
    const base = new THREE.Mesh(baseGeo, bezelMat);
    base.position.y = 0.015;
    group.add(base);

    return group;
  }

  // Bookshelf: Shelf with books (Read)
  private createBookshelfStation(_material: THREE.MeshStandardMaterial): THREE.Group {
    const group = new THREE.Group();

    // Shelf frame (dark wood color)
    const woodMat = new THREE.MeshStandardMaterial({
      color: 0x3d2817,
      metalness: 0.1,
      roughness: 0.8,
    });
    this.materials.push(woodMat);

    // Side panels
    const sideGeo = new THREE.BoxGeometry(0.04, 0.55, 0.2);
    this.geometries.push(sideGeo);
    const leftSide = new THREE.Mesh(sideGeo, woodMat);
    leftSide.position.set(-0.18, 0.275, 0);
    leftSide.castShadow = true;
    group.add(leftSide);

    const rightSide = new THREE.Mesh(sideGeo, woodMat);
    rightSide.position.set(0.18, 0.275, 0);
    rightSide.castShadow = true;
    group.add(rightSide);

    // Shelves
    const shelfGeo = new THREE.BoxGeometry(0.32, 0.02, 0.18);
    this.geometries.push(shelfGeo);
    [0.02, 0.2, 0.38, 0.54].forEach((y) => {
      const shelf = new THREE.Mesh(shelfGeo, woodMat);
      shelf.position.set(0, y, 0);
      group.add(shelf);
    });

    // Books (colored rectangles on shelves)
    const bookColors = [0x8b5cf6, 0x6366f1, 0xa855f7, 0x7c3aed];
    [0.1, 0.29, 0.47].forEach((shelfY, si) => {
      for (let i = 0; i < 4; i++) {
        const bookGeo = new THREE.BoxGeometry(0.06, 0.14 + Math.random() * 0.03, 0.12);
        this.geometries.push(bookGeo);
        const bookMat = new THREE.MeshStandardMaterial({
          color: bookColors[(i + si) % bookColors.length],
          emissive: bookColors[(i + si) % bookColors.length],
          emissiveIntensity: 0.2,
        });
        this.materials.push(bookMat);
        const book = new THREE.Mesh(bookGeo, bookMat);
        book.position.set(-0.1 + i * 0.065, shelfY, 0);
        book.castShadow = true;
        group.add(book);
      }
    });

    return group;
  }

  // Desk: Table with paper (Write/NotebookEdit)
  private createDeskStation(material: THREE.MeshStandardMaterial): THREE.Group {
    const group = new THREE.Group();

    // Desk top
    const topGeo = new THREE.BoxGeometry(0.5, 0.04, 0.35);
    this.geometries.push(topGeo);
    const top = new THREE.Mesh(topGeo, material);
    top.position.y = 0.28;
    top.castShadow = true;
    group.add(top);

    // Desk legs
    const legMat = new THREE.MeshStandardMaterial({
      color: 0x2d3748,
      metalness: 0.6,
      roughness: 0.4,
    });
    this.materials.push(legMat);
    const legGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.26, 6);
    this.geometries.push(legGeo);

    [[-0.2, -0.13], [0.2, -0.13], [-0.2, 0.13], [0.2, 0.13]].forEach(([x, z]) => {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(x, 0.13, z);
      group.add(leg);
    });

    // Paper on desk
    const paperGeo = new THREE.BoxGeometry(0.2, 0.005, 0.28);
    this.geometries.push(paperGeo);
    const paperMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      emissive: 0xf8fafc,
      emissiveIntensity: 0.1,
    });
    this.materials.push(paperMat);
    const paper = new THREE.Mesh(paperGeo, paperMat);
    paper.position.set(0.05, 0.305, 0);
    group.add(paper);

    return group;
  }

  // Workbench: Work table with tool (Edit)
  private createWorkbenchStation(material: THREE.MeshStandardMaterial): THREE.Group {
    const group = new THREE.Group();

    // Workbench top (thicker)
    const topGeo = new THREE.BoxGeometry(0.5, 0.06, 0.4);
    this.geometries.push(topGeo);
    const top = new THREE.Mesh(topGeo, material);
    top.position.y = 0.23;
    top.castShadow = true;
    group.add(top);

    // Sturdy legs
    const legMat = new THREE.MeshStandardMaterial({
      color: 0x374151,
      metalness: 0.7,
      roughness: 0.3,
    });
    this.materials.push(legMat);
    const legGeo = new THREE.BoxGeometry(0.04, 0.2, 0.04);
    this.geometries.push(legGeo);

    [[-0.2, -0.15], [0.2, -0.15], [-0.2, 0.15], [0.2, 0.15]].forEach(([x, z]) => {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(x, 0.1, z);
      group.add(leg);
    });

    // Wrench/tool on top
    const toolMat = new THREE.MeshStandardMaterial({
      color: 0x9ca3af,
      metalness: 0.9,
      roughness: 0.2,
    });
    this.materials.push(toolMat);

    // Tool handle
    const handleGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.2, 6);
    this.geometries.push(handleGeo);
    const handle = new THREE.Mesh(handleGeo, toolMat);
    handle.rotation.z = Math.PI / 2;
    handle.position.set(0, 0.28, 0.05);
    group.add(handle);

    // Tool head
    const headGeo = new THREE.BoxGeometry(0.06, 0.02, 0.08);
    this.geometries.push(headGeo);
    const head = new THREE.Mesh(headGeo, toolMat);
    head.position.set(0.12, 0.28, 0.05);
    group.add(head);

    return group;
  }

  // Scanner: Radar dish (Grep/Glob)
  private createScannerStation(material: THREE.MeshStandardMaterial): THREE.Group {
    const group = new THREE.Group();

    // Base
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.6,
      roughness: 0.4,
    });
    this.materials.push(baseMat);
    const baseGeo = new THREE.CylinderGeometry(0.12, 0.15, 0.08, 12);
    this.geometries.push(baseGeo);
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.04;
    group.add(base);

    // Neck/stem
    const neckGeo = new THREE.CylinderGeometry(0.025, 0.03, 0.2, 8);
    this.geometries.push(neckGeo);
    const neck = new THREE.Mesh(neckGeo, baseMat);
    neck.position.y = 0.18;
    group.add(neck);

    // Dish (half sphere/parabolic shape)
    const dishGeo = new THREE.SphereGeometry(0.15, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    this.geometries.push(dishGeo);
    const dish = new THREE.Mesh(dishGeo, material);
    dish.rotation.x = Math.PI;
    dish.position.y = 0.35;
    dish.castShadow = true;
    group.add(dish);

    // Antenna in center of dish
    const antennaGeo = new THREE.ConeGeometry(0.02, 0.1, 6);
    this.geometries.push(antennaGeo);
    const antenna = new THREE.Mesh(antennaGeo, material);
    antenna.position.y = 0.32;
    group.add(antenna);

    return group;
  }

  // Antenna: Satellite dish with pole (WebFetch/WebSearch)
  private createAntennaStation(material: THREE.MeshStandardMaterial): THREE.Group {
    const group = new THREE.Group();

    // Base
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x374151,
      metalness: 0.7,
      roughness: 0.3,
    });
    this.materials.push(baseMat);
    const baseGeo = new THREE.BoxGeometry(0.15, 0.04, 0.15);
    this.geometries.push(baseGeo);
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.02;
    group.add(base);

    // Main pole
    const poleGeo = new THREE.CylinderGeometry(0.02, 0.025, 0.4, 8);
    this.geometries.push(poleGeo);
    const pole = new THREE.Mesh(poleGeo, baseMat);
    pole.position.y = 0.24;
    group.add(pole);

    // Dish
    const dishGeo = new THREE.CircleGeometry(0.12, 16);
    this.geometries.push(dishGeo);
    const dish = new THREE.Mesh(dishGeo, material);
    dish.rotation.x = -Math.PI / 4;
    dish.position.set(0, 0.4, 0.06);
    dish.castShadow = true;
    group.add(dish);

    // LNB arm
    const armGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.12, 6);
    this.geometries.push(armGeo);
    const arm = new THREE.Mesh(armGeo, baseMat);
    arm.rotation.x = Math.PI / 4;
    arm.position.set(0, 0.44, 0.1);
    group.add(arm);

    // LNB head
    const lnbGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.04, 8);
    this.geometries.push(lnbGeo);
    const lnb = new THREE.Mesh(lnbGeo, material);
    lnb.position.set(0, 0.48, 0.14);
    group.add(lnb);

    return group;
  }

  // Portal: Glowing ring gateway (Task)
  private createPortalStation(material: THREE.MeshStandardMaterial): THREE.Group {
    const group = new THREE.Group();

    // Base platform
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x1e1b4b,
      metalness: 0.5,
      roughness: 0.5,
    });
    this.materials.push(baseMat);
    const baseGeo = new THREE.CylinderGeometry(0.18, 0.2, 0.04, 16);
    this.geometries.push(baseGeo);
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.02;
    group.add(base);

    // Portal ring (main)
    const ringGeo = new THREE.TorusGeometry(0.2, 0.025, 8, 24);
    this.geometries.push(ringGeo);
    const ring = new THREE.Mesh(ringGeo, material);
    ring.position.y = 0.28;
    ring.castShadow = true;
    group.add(ring);

    // Inner glow (semi-transparent)
    const glowMat = new THREE.MeshStandardMaterial({
      color: material.color,
      emissive: material.color,
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 0.3,
    });
    this.materials.push(glowMat);
    const glowGeo = new THREE.CircleGeometry(0.17, 24);
    this.geometries.push(glowGeo);
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.y = 0.28;
    group.add(glow);

    // Small pillars around base
    const pillarGeo = new THREE.CylinderGeometry(0.015, 0.02, 0.15, 6);
    this.geometries.push(pillarGeo);
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      const pillar = new THREE.Mesh(pillarGeo, baseMat);
      pillar.position.set(Math.cos(angle) * 0.14, 0.1, Math.sin(angle) * 0.14);
      group.add(pillar);
    }

    return group;
  }

  // Taskboard: Bulletin board with pins (TodoWrite)
  private createTaskboardStation(_material: THREE.MeshStandardMaterial): THREE.Group {
    const group = new THREE.Group();

    // Board backing
    const boardMat = new THREE.MeshStandardMaterial({
      color: 0x78350f,
      metalness: 0.1,
      roughness: 0.9,
    });
    this.materials.push(boardMat);
    const boardGeo = new THREE.BoxGeometry(0.4, 0.45, 0.03);
    this.geometries.push(boardGeo);
    const board = new THREE.Mesh(boardGeo, boardMat);
    board.position.y = 0.28;
    board.castShadow = true;
    group.add(board);

    // Frame
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x44403c,
      metalness: 0.3,
      roughness: 0.7,
    });
    this.materials.push(frameMat);

    // Frame pieces
    const topFrameGeo = new THREE.BoxGeometry(0.44, 0.03, 0.04);
    this.geometries.push(topFrameGeo);
    const topFrame = new THREE.Mesh(topFrameGeo, frameMat);
    topFrame.position.set(0, 0.52, 0.01);
    group.add(topFrame);

    const bottomFrame = new THREE.Mesh(topFrameGeo, frameMat);
    bottomFrame.position.set(0, 0.04, 0.01);
    group.add(bottomFrame);

    const sideFrameGeo = new THREE.BoxGeometry(0.03, 0.45, 0.04);
    this.geometries.push(sideFrameGeo);
    const leftFrame = new THREE.Mesh(sideFrameGeo, frameMat);
    leftFrame.position.set(-0.22, 0.28, 0.01);
    group.add(leftFrame);

    const rightFrame = new THREE.Mesh(sideFrameGeo, frameMat);
    rightFrame.position.set(0.22, 0.28, 0.01);
    group.add(rightFrame);

    // Sticky notes / cards
    const noteColors = [0xfef08a, 0xfde047, 0xfbbf24, 0xf59e0b];
    const noteGeo = new THREE.BoxGeometry(0.1, 0.1, 0.005);
    this.geometries.push(noteGeo);

    const notePositions = [
      [-0.1, 0.38], [0.05, 0.4], [-0.05, 0.2], [0.1, 0.18]
    ];
    notePositions.forEach(([x, y], i) => {
      const noteMat = new THREE.MeshStandardMaterial({
        color: noteColors[i % noteColors.length],
        emissive: noteColors[i % noteColors.length],
        emissiveIntensity: 0.1,
      });
      this.materials.push(noteMat);
      const note = new THREE.Mesh(noteGeo, noteMat);
      note.position.set(x, y, 0.02);
      note.rotation.z = (Math.random() - 0.5) * 0.2;
      group.add(note);
    });

    // Stand
    const standGeo = new THREE.BoxGeometry(0.04, 0.2, 0.15);
    this.geometries.push(standGeo);
    const stand = new THREE.Mesh(standGeo, frameMat);
    stand.position.set(0, -0.05, -0.06);
    stand.rotation.x = -0.2;
    group.add(stand);

    return group;
  }

  // Default: Simple sphere
  private createDefaultStation(material: THREE.MeshStandardMaterial): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(0.15, 12, 12);
    this.geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = 0.15;
    mesh.castShadow = true;
    return mesh;
  }

  // === LABELS ===

  private createSessionLabel(): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    this.drawSessionLabel(canvas);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;

    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    this.materials.push(material);

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(5, 1.25, 1);
    // Position centered above hex platform
    sprite.position.set(0, HEX_HEIGHT + 2.5, 0);

    return sprite;
  }

  private drawSessionLabel(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const status = this.session.status;
    const color = STATUS_COLORS[status] || STATUS_COLORS.idle;
    const colorHex = '#' + color.toString(16).padStart(6, '0');

    // Number badge
    ctx.beginPath();
    ctx.arc(55, canvas.height / 2, 40, 0, Math.PI * 2);
    ctx.fillStyle = colorHex;
    ctx.fill();

    // Number
    ctx.font = 'bold 48px system-ui, sans-serif';
    ctx.fillStyle = '#0f172a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(this.sessionIndex + 1), 55, canvas.height / 2);

    // Session name
    ctx.font = 'bold 42px system-ui, sans-serif';
    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'left';
    ctx.fillText(this.session.name.slice(0, 16), 110, canvas.height / 2);
  }

  private createGitLabel(): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 384;
    canvas.height = 64;
    this.drawGitLabel(canvas);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;

    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    this.materials.push(material);

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(3.5, 0.6, 1);
    // Position bottom-left of hex
    sprite.position.set(-HEX_SIZE * 0.4, HEX_HEIGHT / 2 + 0.3, HEX_SIZE * 0.6);

    return sprite;
  }

  private drawGitLabel(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const git = this.session.gitStatus;
    if (!git?.isRepo) return;

    // Background pill
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.roundRect(4, 8, canvas.width - 8, canvas.height - 16, 6);
    ctx.fill();

    const branch = git.branch || 'main';
    const added = git.linesAdded || 0;
    const removed = git.linesRemoved || 0;

    ctx.font = 'bold 28px monospace';
    ctx.textBaseline = 'middle';

    // Branch
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'left';
    ctx.fillText(branch.slice(0, 10), 15, canvas.height / 2);

    // Changes
    const branchWidth = ctx.measureText(branch.slice(0, 10)).width;
    let x = 25 + branchWidth;

    if (added > 0) {
      ctx.fillStyle = '#22c55e';
      ctx.fillText(`+${added}`, x, canvas.height / 2);
      x += ctx.measureText(`+${added}`).width + 5;
    }
    if (removed > 0) {
      ctx.fillStyle = '#ef4444';
      ctx.fillText(`/-${removed}`, x, canvas.height / 2);
    }
  }

  private createToolLabel(): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 56;
    this.drawToolLabel(canvas);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;

    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    this.materials.push(material);

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(5, 0.55, 1);
    // Position center of hex, above platform
    sprite.position.set(0, HEX_HEIGHT / 2 + 1.2, 0);

    return sprite;
  }

  private drawToolLabel(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const tool = this.session.currentTool;
    if (!tool) return;

    const stationType = TOOL_STATION_MAP[tool] || 'center';
    const color = STATION_COLORS[stationType];
    const colorHex = '#' + color.toString(16).padStart(6, '0');

    // Background
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.roundRect(10, 6, canvas.width - 20, canvas.height - 12, 6);
    ctx.fill();

    // Tool name
    ctx.font = 'bold 28px monospace';
    ctx.fillStyle = colorHex;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Truncate long tool names
    const displayTool = tool.length > 35 ? tool.slice(0, 32) + '...' : tool;
    ctx.fillText(displayTool, canvas.width / 2, canvas.height / 2);
  }

  // === FILE LABELS ===

  addFile(filePath: string): void {
    // Extract filename from path
    const parts = filePath.split('/');
    const filename = parts[parts.length - 1];

    if (!filename || this.recentFiles.includes(filename)) return;

    // Keep only last 3 files
    if (this.recentFiles.length >= 3) {
      this.recentFiles.shift();
      const oldLabel = this.fileLabels.shift();
      if (oldLabel) {
        this.group.remove(oldLabel);
        const mat = oldLabel.material as THREE.SpriteMaterial;
        if (mat.map) mat.map.dispose();
        mat.dispose();
      }
    }

    this.recentFiles.push(filename);
    const label = this.createFileLabel(filename, this.recentFiles.length - 1);
    this.fileLabels.push(label);
    this.group.add(label);
    this.repositionFileLabels();
  }

  private createFileLabel(filename: string, _index: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 384;
    canvas.height = 48;

    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background
    ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
    ctx.roundRect(4, 4, canvas.width - 8, canvas.height - 8, 4);
    ctx.fill();

    // Filename
    ctx.font = '22px monospace';
    ctx.fillStyle = '#e2e8f0';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const displayName = filename.length > 28 ? filename.slice(0, 25) + '...' : filename;
    ctx.fillText(displayName, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;

    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    this.materials.push(material);

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(3.2, 0.4, 1);

    return sprite;
  }

  private repositionFileLabels(): void {
    // Position files on the platform surface
    const startY = HEX_HEIGHT / 2 + 0.6;
    const spacing = 0.5;
    const offsetZ = HEX_SIZE * 0.2;

    this.fileLabels.forEach((label, i) => {
      label.position.set(
        0,
        startY + (this.fileLabels.length - 1 - i) * spacing,
        offsetZ + i * 0.15
      );
    });
  }

  // === UTILITIES ===

  private getHexPoints(radius: number): THREE.Vector2[] {
    const points: THREE.Vector2[] = [];
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 - Math.PI / 2;
      points.push(new THREE.Vector2(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius
      ));
    }
    return points;
  }

  private getHexPoints3D(radius: number, y: number): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 - Math.PI / 2;
      points.push(new THREE.Vector3(
        Math.cos(angle) * radius,
        y,
        Math.sin(angle) * radius
      ));
    }
    return points;
  }

  // === STATUS ===

  private updateStatus(status: string): void {
    const color = STATUS_COLORS[status] || STATUS_COLORS.idle;
    const glow = STATUS_GLOW[status] || 0.5;

    // Edge tube
    const tubeMat = this.edgeTube.material as THREE.MeshBasicMaterial;
    tubeMat.color.setHex(color);

    // Edge glow
    const glowMat = this.edgeGlow.material as THREE.MeshBasicMaterial;
    glowMat.color.setHex(color);
    glowMat.opacity = glow * 0.4;
  }

  // === PUBLIC API ===

  setSessionIndex(index: number): void {
    if (this.sessionIndex !== index) {
      this.sessionIndex = index;
      this.updateSessionLabel();
    }
  }

  private updateSessionLabel(): void {
    const mat = this.sessionLabel.material as THREE.SpriteMaterial;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    this.drawSessionLabel(canvas);

    if (mat.map) mat.map.dispose();
    mat.map = new THREE.CanvasTexture(canvas);
    mat.map.minFilter = THREE.LinearFilter;
    mat.needsUpdate = true;
  }

  private updateGitLabel(): void {
    if (!this.gitLabel) {
      if (this.session.gitStatus?.isRepo) {
        this.gitLabel = this.createGitLabel();
        this.group.add(this.gitLabel);
      }
      return;
    }

    const mat = this.gitLabel.material as THREE.SpriteMaterial;
    const canvas = document.createElement('canvas');
    canvas.width = 384;
    canvas.height = 64;
    this.drawGitLabel(canvas);

    if (mat.map) mat.map.dispose();
    mat.map = new THREE.CanvasTexture(canvas);
    mat.map.minFilter = THREE.LinearFilter;
    mat.needsUpdate = true;
  }

  private updateToolLabel(): void {
    if (!this.session.currentTool) {
      if (this.toolLabel) {
        this.toolLabel.visible = false;
      }
      return;
    }

    if (!this.toolLabel) {
      this.toolLabel = this.createToolLabel();
      this.group.add(this.toolLabel);
      return;
    }

    this.toolLabel.visible = true;
    const mat = this.toolLabel.material as THREE.SpriteMaterial;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 56;
    this.drawToolLabel(canvas);

    if (mat.map) mat.map.dispose();
    mat.map = new THREE.CanvasTexture(canvas);
    mat.map.minFilter = THREE.LinearFilter;
    mat.needsUpdate = true;
  }

  getGroup(): THREE.Group {
    return this.group;
  }

  getMesh(): THREE.Mesh {
    return this.hexMesh;
  }

  getSessionId(): string {
    return this.session.id;
  }

  getPosition(): THREE.Vector3 {
    return this.group.position.clone();
  }

  matchesEvent(event: VibecraftEvent): boolean {
    return (
      event.sessionId === this.session.claudeSessionId ||
      (event.cwd !== undefined && event.cwd === this.session.cwd)
    );
  }

  updateSession(session: ManagedSession): void {
    const statusChanged = this.session.status !== session.status;
    const nameChanged = this.session.name !== session.name;
    const gitChanged = JSON.stringify(this.session.gitStatus) !== JSON.stringify(session.gitStatus);
    const toolChanged = this.session.currentTool !== session.currentTool;

    this.session = session;

    if (statusChanged) {
      this.updateStatus(session.status);
      this.updateSessionLabel();
    }

    if (nameChanged) {
      this.updateSessionLabel();
    }

    if (gitChanged) {
      this.updateGitLabel();
    }

    if (toolChanged) {
      this.updateToolLabel();
      if (session.currentTool) {
        this.activateTool(session.currentTool);
      } else if (this.activeStation) {
        this.deactivateTool();
      }
    }
  }

  activateTool(tool: string): void {
    const stationType = TOOL_STATION_MAP[tool] || 'center';

    if (this.activeStation && this.activeStation !== stationType) {
      this.deactivateStation(this.activeStation);
    }

    this.activeStation = stationType;

    const station = this.stations.get(stationType);
    if (station) {
      this.setStationEmissive(station, 1.0);
      station.scale.setScalar(1.3);
    }
  }

  deactivateTool(): void {
    if (this.activeStation) {
      this.deactivateStation(this.activeStation);
      this.activeStation = null;
    }
  }

  private deactivateStation(type: string): void {
    const station = this.stations.get(type);
    if (station) {
      this.setStationEmissive(station, 0.3);
      station.scale.setScalar(1.0);
    }
  }

  private setStationEmissive(obj: THREE.Object3D, intensity: number): void {
    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh;
      if (mesh.material && (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity !== undefined) {
        (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = intensity;
      }
    }
    // Recursively apply to children (for Groups)
    obj.children.forEach(child => this.setStationEmissive(child, intensity));
  }

  setHovered(hovered: boolean): void {
    this.isHovered = hovered;
    this.targetScale = hovered ? 1.04 : this.isSelected ? 1.02 : 1.0;

    const mat = this.hexMesh.material as THREE.MeshStandardMaterial;
    mat.color.setHex(hovered ? 0x243754 : 0x1a2744);
  }

  setSelected(selected: boolean): void {
    this.isSelected = selected;
    this.targetScale = selected ? 1.02 : this.isHovered ? 1.04 : 1.0;

    // Update edge glow for selection state
    const glowMat = this.edgeGlow.material as THREE.MeshBasicMaterial;
    const tubeMat = this.edgeTube.material as THREE.MeshBasicMaterial;

    if (selected) {
      // Brighten selected zone significantly
      glowMat.opacity = 0.85;
      tubeMat.opacity = 1.0;
    } else {
      // Reset to status-based glow
      const glow = STATUS_GLOW[this.session.status] || STATUS_GLOW.idle;
      glowMat.opacity = glow * 0.4;
      tubeMat.opacity = 0.8;
    }
  }

  // Dim non-selected zones when another zone is selected
  setDimmed(dimmed: boolean): void {
    if (this.isSelected) return; // Never dim selected zone

    const glowMat = this.edgeGlow.material as THREE.MeshBasicMaterial;
    const tubeMat = this.edgeTube.material as THREE.MeshBasicMaterial;
    const hexMat = this.hexMesh.material as THREE.MeshStandardMaterial;

    if (dimmed) {
      // Very dim - make non-selected zones fade into background
      glowMat.opacity = 0.08;
      tubeMat.opacity = 0.25;
      hexMat.opacity = 0.5;
    } else {
      // Reset to status-based glow
      const glow = STATUS_GLOW[this.session.status] || STATUS_GLOW.idle;
      glowMat.opacity = glow * 0.4;
      tubeMat.opacity = 0.8;
      hexMat.opacity = 1.0;
    }
  }

  update(delta: number, elapsed: number): void {
    // Scale animation
    this.currentScale = THREE.MathUtils.lerp(this.currentScale, this.targetScale, delta * 8);
    this.group.scale.setScalar(this.currentScale);

    // Status pulse animation
    const status = this.session.status;
    this.pulsePhase += delta * (status === 'working' ? 4 : status === 'waiting' ? 8 : 2);

    const basePulse = Math.sin(this.pulsePhase) * 0.15 + 0.85;
    const glowMat = this.edgeGlow.material as THREE.MeshBasicMaterial;
    const tubeMat = this.edgeTube.material as THREE.MeshBasicMaterial;

    if (status === 'working') {
      glowMat.opacity = STATUS_GLOW.working * 0.4 * basePulse;
    } else if (status === 'waiting') {
      // Very aggressive pulse for waiting - NEEDS ATTENTION!
      const waitPulse = Math.sin(this.pulsePhase) * 0.4 + 0.6;
      glowMat.opacity = STATUS_GLOW.waiting * 0.6 * waitPulse;
      // Also pulse the main edge tube brightness
      tubeMat.opacity = 0.7 + waitPulse * 0.3;
    } else {
      glowMat.opacity = STATUS_GLOW[status] * 0.3;
      tubeMat.opacity = 1.0;
    }

    // Active station animation
    if (this.activeStation) {
      const station = this.stations.get(this.activeStation);
      if (station) {
        station.position.y = HEX_HEIGHT / 2 + 0.25 + Math.sin(elapsed * 3) * 0.08;
        station.rotation.y += delta * 1.5;
      }
    }

    // Label hover animation
    this.sessionLabel.position.y = HEX_HEIGHT + 2.5 + Math.sin(elapsed * 0.7) * 0.03;
  }

  dispose(): void {
    for (const geo of this.geometries) {
      geo.dispose();
    }
    for (const mat of this.materials) {
      if ('map' in mat && mat.map) {
        (mat.map as THREE.Texture).dispose();
      }
      mat.dispose();
    }
    // Clean up file labels
    for (const label of this.fileLabels) {
      this.group.remove(label);
      const mat = label.material as THREE.SpriteMaterial;
      if (mat.map) mat.map.dispose();
      mat.dispose();
    }
    this.fileLabels.length = 0;
    this.recentFiles.length = 0;
    this.stations.clear();
    this.geometries.length = 0;
    this.materials.length = 0;
  }
}

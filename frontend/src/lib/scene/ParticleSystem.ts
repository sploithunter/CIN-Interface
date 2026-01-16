/**
 * ParticleSystem - Visual effects for tool activity
 * Creates burst effects when tools are activated
 */

import * as THREE from 'three';

// Tool-specific colors for particles
const TOOL_COLORS: Record<string, number> = {
  Read: 0x8b5cf6, // Purple
  Write: 0x3b82f6, // Blue
  Edit: 0xf59e0b, // Amber
  Bash: 0x22c55e, // Green
  Grep: 0x06b6d4, // Cyan
  Glob: 0x06b6d4, // Cyan
  WebFetch: 0xec4899, // Pink
  WebSearch: 0xec4899, // Pink
  Task: 0xa855f7, // Purple
  TodoWrite: 0xeab308, // Yellow
  AskUserQuestion: 0x64748b, // Gray
};

interface Particle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  color: THREE.Color;
}

export class ParticleSystem {
  private scene: THREE.Scene;
  private particles: Particle[] = [];
  private geometry: THREE.BufferGeometry;
  private material: THREE.PointsMaterial;
  private points: THREE.Points;

  private maxParticles = 500;
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Initialize buffers
    this.positions = new Float32Array(this.maxParticles * 3);
    this.colors = new Float32Array(this.maxParticles * 3);
    this.sizes = new Float32Array(this.maxParticles);

    // Create geometry
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));

    // Create shader material for size attenuation
    this.material = new THREE.PointsMaterial({
      size: 0.2,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    // Create points mesh
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  burst(position: THREE.Vector3, tool: string, count: number = 20): void {
    const color = new THREE.Color(TOOL_COLORS[tool] || 0x3b82f6);

    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.maxParticles) {
        // Remove oldest particle
        this.particles.shift();
      }

      // Random velocity in a sphere
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = 1 + Math.random() * 2;

      const velocity = new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta) * speed,
        Math.abs(Math.sin(phi) * Math.sin(theta)) * speed + 1, // Bias upward
        Math.cos(phi) * speed
      );

      this.particles.push({
        position: position.clone().add(new THREE.Vector3(
          (Math.random() - 0.5) * 0.5,
          0.5,
          (Math.random() - 0.5) * 0.5
        )),
        velocity,
        life: 1.0,
        maxLife: 0.8 + Math.random() * 0.4,
        size: 0.1 + Math.random() * 0.15,
        color: color.clone(),
      });
    }
  }

  trail(start: THREE.Vector3, end: THREE.Vector3, tool: string, count: number = 10): void {
    const color = new THREE.Color(TOOL_COLORS[tool] || 0x3b82f6);
    const direction = end.clone().sub(start);
    const length = direction.length();
    direction.normalize();

    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.maxParticles) {
        this.particles.shift();
      }

      const t = i / count;
      const position = start.clone().add(direction.clone().multiplyScalar(length * t));

      // Add some randomness perpendicular to direction
      const perpendicular = new THREE.Vector3(
        (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 0.3
      );
      position.add(perpendicular);

      this.particles.push({
        position,
        velocity: direction.clone().multiplyScalar(0.5),
        life: 1.0,
        maxLife: 0.5 + Math.random() * 0.3,
        size: 0.08 + Math.random() * 0.08,
        color: color.clone(),
      });
    }
  }

  update(delta: number): void {
    const gravity = -2;

    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i];

      // Apply physics
      particle.velocity.y += gravity * delta;
      particle.position.add(particle.velocity.clone().multiplyScalar(delta));

      // Decay
      particle.life -= delta / particle.maxLife;

      // Remove dead particles
      if (particle.life <= 0) {
        this.particles.splice(i, 1);
      }
    }

    // Update buffers
    for (let i = 0; i < this.maxParticles; i++) {
      if (i < this.particles.length) {
        const particle = this.particles[i];
        const alpha = Math.max(0, particle.life);

        this.positions[i * 3] = particle.position.x;
        this.positions[i * 3 + 1] = particle.position.y;
        this.positions[i * 3 + 2] = particle.position.z;

        this.colors[i * 3] = particle.color.r * alpha;
        this.colors[i * 3 + 1] = particle.color.g * alpha;
        this.colors[i * 3 + 2] = particle.color.b * alpha;

        this.sizes[i] = particle.size * (0.5 + alpha * 0.5);
      } else {
        // Hide unused particles
        this.positions[i * 3] = 0;
        this.positions[i * 3 + 1] = -1000;
        this.positions[i * 3 + 2] = 0;
        this.sizes[i] = 0;
      }
    }

    // Mark attributes as needing update
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.attributes.size.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
    this.particles.length = 0;
  }
}

import * as pc from 'playcanvas';
import { engine } from '../state/store';
import type { CamMode } from '../state/store';
import type { ScoutId } from '../sim/types';

const damp = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);
const dirOf = (heading: number): pc.Vec3 => new pc.Vec3(Math.sin(heading), 0, -Math.cos(heading));

export class CameraRig {
  readonly entity: pc.Entity;
  private readonly canvas: HTMLCanvasElement;

  private curPos = new pc.Vec3(0, 2100, 1500);
  private curTarget = new pc.Vec3(0, 0, -120);
  private desiredPos = new pc.Vec3();
  private desiredTarget = new pc.Vec3();
  private zoom = 1;
  private orbitAngle = 0.8;
  private lastMode: CamMode | null = null;
  private snapNext = false;

  // free camera
  private freeYaw = 0;
  private freePitch = -30;
  private freeDragging = false;
  private freeSpeed = 120;
  private keys = new Set<string>();

  /** interactions layer sets this so entity drags never rotate the camera */
  isBlocked: () => boolean = () => false;

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (this.lastMode === 4 && !this.isBlocked()) {
      this.freeDragging = true;
      event.preventDefault();
    }
  };

  private readonly onMouseUp = (): void => {
    this.freeDragging = false;
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (this.freeDragging && this.lastMode === 4) {
      this.freeYaw -= event.movementX * 0.22;
      this.freePitch = Math.max(-89, Math.min(89, this.freePitch - event.movementY * 0.18));
    }
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (this.lastMode === 4) {
      this.freeSpeed = Math.max(10, Math.min(700, this.freeSpeed * Math.pow(1.15, -event.deltaY / 100)));
    } else {
      this.zoom = Math.max(0.3, Math.min(2.6, this.zoom * Math.pow(1.12, event.deltaY / 100)));
    }
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    this.keys.add(event.key.toLowerCase());
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.key.toLowerCase());
  };

  constructor(app: pc.Application, canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.entity = new pc.Entity('camera');
    this.entity.addComponent('camera', {
      clearColor: new pc.Color(0.61, 0.74, 0.85),
      fov: 48,
      nearClip: 1,
      farClip: 14000,
    });
    app.root.addChild(this.entity);
    this.entity.setPosition(this.curPos);
    this.entity.lookAt(this.curTarget);

    canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  get cameraComponent(): pc.CameraComponent {
    return this.entity.camera!;
  }

  snap(): void {
    this.snapNext = true;
  }

  dispose(): void {
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.keys.clear();
  }

  update(dt: number, mode: CamMode, selectedScout: ScoutId): void {
    if (mode !== this.lastMode) {
      if (mode === 4) {
        const fwd = this.entity.forward;
        this.freeYaw = (Math.atan2(-fwd.x, -fwd.z) * 180) / Math.PI;
        this.freePitch = (Math.asin(fwd.y) * 180) / Math.PI;
        this.curPos.copy(this.entity.getPosition());
      }
      this.lastMode = mode;
    }
    if (mode === 4) {
      this.updateFree(dt);
      return;
    }

    if (mode === 1) {
      const z = this.zoom;
      this.desiredPos.set(0, 1760 * z, 1260 * z);
      this.desiredTarget.set(0, 0, -100);
    } else if (mode === 2) {
      const s = engine.getEntity(selectedScout);
      const f = dirOf(Math.PI - s.heading);
      const back = 78 * this.zoom;
      this.desiredPos.set(
        s.pos.x - f.x * back + f.z * 10,
        s.pos.alt + 36 * this.zoom,
        -s.pos.y - f.z * back - f.x * 10,
      );
      this.desiredTarget.set(s.pos.x + f.x * 45, s.pos.alt + 4, -s.pos.y + f.z * 45);
    } else if (mode === 5) {
      // scout first-person: eye slightly ahead of the rig so the body model
      // stays out of frame, gaze a touch below the horizon
      const s = engine.getEntity(selectedScout);
      const f = dirOf(Math.PI - s.heading);
      this.desiredPos.set(s.pos.x + f.x * 3, s.pos.alt + 4.1, -s.pos.y + f.z * 3);
      this.desiredTarget.set(s.pos.x + f.x * 70, s.pos.alt + 2.4, -s.pos.y + f.z * 70);
    } else {
      // dt is already simulation-clock time during video capture
      this.orbitAngle += dt * 0.1;
      const d = engine.drone;
      const r = 230 * this.zoom;
      this.desiredPos.set(
        d.pos.x + Math.cos(this.orbitAngle) * r,
        d.pos.alt + 75 * this.zoom,
        -d.pos.y + Math.sin(this.orbitAngle) * r,
      );
      this.desiredTarget.set(d.pos.x, Math.max(6, d.pos.alt - 10), -d.pos.y);
    }

    if (this.snapNext) {
      this.curPos.copy(this.desiredPos);
      this.curTarget.copy(this.desiredTarget);
      this.snapNext = false;
    } else {
      const k = damp(mode === 1 ? 2.6 : mode === 5 ? 8 : 4, dt);
      this.curPos.lerp(this.curPos, this.desiredPos, k);
      this.curTarget.lerp(this.curTarget, this.desiredTarget, k);
    }
    this.entity.setPosition(this.curPos);
    this.entity.lookAt(this.curTarget);
  }

  private updateFree(dt: number): void {
    this.entity.setEulerAngles(this.freePitch, this.freeYaw, 0);
    const move = new pc.Vec3();
    if (this.keys.has('w')) move.add(this.entity.forward);
    if (this.keys.has('s')) move.sub(this.entity.forward);
    if (this.keys.has('d')) move.add(this.entity.right);
    if (this.keys.has('a')) move.sub(this.entity.right);
    if (this.keys.has('e')) move.add(pc.Vec3.UP);
    if (this.keys.has('q')) move.sub(pc.Vec3.UP);
    if (move.lengthSq() > 0) {
      move.normalize().mulScalar(this.freeSpeed * dt);
      this.curPos.add(move);
    }
    this.curPos.y = Math.max(2.5, this.curPos.y);
    this.entity.setPosition(this.curPos);
    this.curTarget.copy(this.curPos).add(this.entity.forward.clone().mulScalar(60));
  }
}

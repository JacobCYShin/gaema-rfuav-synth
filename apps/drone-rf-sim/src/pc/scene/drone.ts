import * as pc from 'playcanvas';
import { mat, uniqueMat } from './materials';
import { prim } from './builders';

export interface DroneRig {
  root: pc.Entity;
  update(dt: number, pose: { x: number; y: number; z: number; headingRad: number }, time: number): void;
}

/** stylized quadcopter, scaled up slightly for readability */
export function buildDrone(_app: pc.Application): DroneRig {
  const root = new pc.Entity('drone');
  const frame = new pc.Entity('frame');
  frame.setLocalScale(1.7, 1.7, 1.7);
  root.addChild(frame);

  const shell = mat('#33383f', { gloss: 0.5 });
  const accent = mat('#ff6b3d', { emissive: '#ff6b3d', emissiveIntensity: 0.5 });
  const darkMat = mat('#22262b');

  // body
  prim('box', { parent: frame, material: shell, scale: [0.95, 0.28, 1.35], name: 'hull' });
  prim('box', { parent: frame, material: accent, pos: [0, 0.16, 0.1], scale: [0.55, 0.08, 0.9], castShadows: false });
  prim('sphere', { parent: frame, material: darkMat, pos: [0, 0.22, -0.25], scale: [0.42, 0.3, 0.42] });
  // camera gimbal
  prim('sphere', { parent: frame, material: darkMat, pos: [0, -0.24, 0.5], scale: [0.3, 0.3, 0.3] });
  prim('box', { parent: frame, material: mat('#141719', { gloss: 0.9 }), pos: [0, -0.26, 0.66], scale: [0.16, 0.16, 0.04], castShadows: false });
  // front direction wedge
  prim('cone', { parent: frame, material: accent, pos: [0, 0.05, 0.82], rot: [90, 0, 0], scale: [0.22, 0.35, 0.22], castShadows: false });

  // arms (two crossed beams)
  for (const a of [45, -45]) {
    prim('box', { parent: frame, material: darkMat, pos: [0, 0, 0], rot: [0, a, 0], scale: [0.13, 0.09, 2.75] });
  }

  // motors, rotors, arm lights, landing legs
  const rotors: pc.Entity[] = [];
  const rotorMat = uniqueMat('#1c2024', { opacity: 0.4, gloss: 0.2, twoSided: true });
  const tipLight = mat('#ffb347', { emissive: '#ffb347', emissiveIntensity: 1.4 });
  const positions: [number, number][] = [
    [0.97, 0.97],
    [-0.97, 0.97],
    [0.97, -0.97],
    [-0.97, -0.97],
  ];
  positions.forEach(([px, pz], i) => {
    prim('cylinder', { parent: frame, material: shell, pos: [px, 0.06, pz], scale: [0.24, 0.22, 0.24] });
    prim('sphere', { parent: frame, material: tipLight, pos: [px, -0.04, pz], scale: [0.12, 0.12, 0.12], castShadows: false });
    const rot = new pc.Entity('rotor');
    rot.setLocalPosition(px, 0.2, pz);
    frame.addChild(rot);
    prim('cylinder', { parent: rot, material: rotorMat, scale: [1.15, 0.025, 1.15], castShadows: false });
    prim('box', { parent: rot, material: darkMat, pos: [0, 0.02, 0], scale: [1.1, 0.03, 0.09], castShadows: false });
    rot.setLocalEulerAngles(0, i * 37, 0);
    rotors.push(rot);
    // landing legs
    prim('cylinder', { parent: frame, material: darkMat, pos: [px * 0.6, -0.3, pz * 0.6], rot: [px > 0 ? 14 : -14, 0, pz > 0 ? -14 : 14], scale: [0.06, 0.5, 0.06] });
  });

  // strobe
  const strobeMat = uniqueMat('#ff4a3d', { emissive: '#ff4a3d', emissiveIntensity: 2 });
  prim('sphere', { parent: frame, material: strobeMat, pos: [0, 0.34, -0.55], scale: [0.14, 0.14, 0.14], castShadows: false });

  let smoothedYaw: number | null = null;
  let prevYaw = 0;

  const update: DroneRig['update'] = (dt, pose, time) => {
    root.setPosition(pose.x, pose.y, pose.z);
    const target = (pose.headingRad * 180) / Math.PI;
    if (smoothedYaw === null) {
      smoothedYaw = target;
      prevYaw = target;
    }
    let diff = target - smoothedYaw;
    while (diff > 180) diff -= 360;
    while (diff < -180) diff += 360;
    smoothedYaw += diff * Math.min(1, dt * 5);
    const yawRate = dt > 0 ? (smoothedYaw - prevYaw) / dt : 0;
    prevYaw = smoothedYaw;
    const bank = Math.max(-18, Math.min(18, -yawRate * 0.35));
    root.setEulerAngles(-6, smoothedYaw, bank);

    for (let i = 0; i < rotors.length; i++) {
      rotors[i].rotateLocal(0, (i % 2 === 0 ? 1 : -1) * 1600 * dt, 0);
    }
    const blink = (Math.sin(time * 9) + 1) * 0.5;
    strobeMat.emissiveIntensity = 0.4 + blink * blink * 2.6;
    strobeMat.update();
  };

  return { root, update };
}

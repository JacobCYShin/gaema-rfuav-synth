import * as pc from 'playcanvas';
import { mat, uniqueMat, color } from './materials';
import { prim, torus } from './builders';
import type { ScoutId } from '../../sim/types';

export interface ScoutPose {
  x: number;
  y: number;
  z: number;
  headingRad: number;
  walkPhase: number;
  moving: boolean;
  detecting: boolean;
  selected: boolean;
}

export interface ScoutRig {
  id: ScoutId;
  root: pc.Entity;
  colorHex: string;
  setPose(pose: ScoutPose, dt: number): void;
}

/**
 * Stylized humanoid operator carrying a handheld RF receiver:
 * head + helmet, torso + team vest, swinging legs, arms fixed forward
 * holding the device at chest height, backpack, selection ring.
 */
export function buildScout(app: pc.Application, id: ScoutId, colorHex: string): ScoutRig {
  const root = new pc.Entity(`scout-${id}`);

  const body = new pc.Entity('body');
  root.addChild(body);

  const skin = mat('#d9b38c');
  const fatigues = mat('#5a6351');
  const dark = mat('#3a4046');
  const teamMat = mat(colorHex, { emissive: colorHex, emissiveIntensity: 0.25 });
  const teamDark = uniqueMat(colorHex);
  teamDark.diffuse.mulScalar(0.55);
  teamDark.update();

  // legs (pivot at hip so they swing)
  const legPivots: pc.Entity[] = [];
  for (const sx of [-1, 1]) {
    const pivot = new pc.Entity('legPivot');
    pivot.setLocalPosition(sx * 0.17, 1.0, 0);
    body.addChild(pivot);
    prim('box', { parent: pivot, material: fatigues, pos: [0, -0.48, 0], scale: [0.24, 0.92, 0.26] });
    prim('box', { parent: pivot, material: dark, pos: [0, -0.97, 0.06], scale: [0.26, 0.14, 0.4] });
    legPivots.push(pivot);
  }

  // torso + team vest
  prim('box', { parent: body, material: fatigues, pos: [0, 1.45, 0], scale: [0.62, 0.8, 0.36] });
  prim('box', { parent: body, material: teamMat, pos: [0, 1.5, 0], scale: [0.68, 0.5, 0.44] });
  prim('box', { parent: body, material: dark, pos: [0, 1.08, 0], scale: [0.6, 0.12, 0.38] });

  // backpack
  prim('box', { parent: body, material: teamDark, pos: [0, 1.5, -0.3], scale: [0.42, 0.5, 0.18] });

  // head + helmet
  prim('sphere', { parent: body, material: skin, pos: [0, 2.0, 0], scale: [0.42, 0.44, 0.42] });
  prim('sphere', { parent: body, material: teamDark, pos: [0, 2.12, -0.02], scale: [0.52, 0.36, 0.52] });
  prim('box', { parent: body, material: dark, pos: [0, 2.0, 0.2], scale: [0.34, 0.09, 0.1], castShadows: false });

  // arms: both angled forward, holding the receiver
  for (const sx of [-1, 1]) {
    const armPivot = new pc.Entity('armPivot');
    armPivot.setLocalPosition(sx * 0.4, 1.78, 0.02);
    armPivot.setLocalEulerAngles(-52, sx * -12, 0);
    body.addChild(armPivot);
    prim('box', { parent: armPivot, material: fatigues, pos: [0, -0.34, 0], scale: [0.17, 0.68, 0.19] });
    prim('sphere', { parent: armPivot, material: skin, pos: [0, -0.7, 0], scale: [0.16, 0.16, 0.16] });
  }

  // handheld RF receiver at chest height, clearly visible from follow cam
  const device = new pc.Entity('device');
  device.setLocalPosition(0, 1.42, 0.5);
  device.setLocalEulerAngles(-32, 0, 0);
  body.addChild(device);
  prim('box', { parent: device, material: dark, scale: [0.46, 0.3, 0.1] });
  const screenMat = uniqueMat('#20262c', { emissive: '#3b4854', emissiveIntensity: 0.5, gloss: 0.8 });
  prim('box', { parent: device, material: screenMat, pos: [0, 0.02, 0.06], scale: [0.34, 0.18, 0.02], castShadows: false });
  const ledMat = uniqueMat('#333a41', { emissive: '#333a41', emissiveIntensity: 0.4 });
  prim('sphere', { parent: device, material: ledMat, pos: [0.17, -0.1, 0.06], scale: [0.05, 0.05, 0.05], castShadows: false });
  // antenna, tall enough to peek over the shoulder from the follow camera
  prim('cylinder', { parent: device, material: dark, pos: [-0.18, 0.42, -0.05], rot: [10, 0, 7], scale: [0.035, 0.85, 0.035] });
  const antTip = uniqueMat(colorHex, { emissive: colorHex, emissiveIntensity: 1.3 });
  prim('sphere', { parent: device, material: antTip, pos: [-0.24, 0.83, -0.12], scale: [0.09, 0.09, 0.09], castShadows: false });

  // selection ring on the ground
  const ringMat = uniqueMat(colorHex, { emissive: colorHex, emissiveIntensity: 1.2, opacity: 0.85 });
  const ring = torus(app, {
    parent: root,
    material: ringMat,
    pos: [0, 0.12, 0],
    scale: [1.25, 1.25, 1.25],
    ringRadius: 1,
    tubeRadius: 0.05,
  });
  ring.enabled = false;

  const teamCol = color(colorHex);
  const detectGlow = new pc.Color(0.35 * teamCol.r + 0.2, 0.9, 0.45);

  let smoothedYaw: number | null = null;

  const setPose = (pose: ScoutPose, dt: number): void => {
    root.setPosition(pose.x, pose.y, pose.z);

    // shortest-arc smoothed heading so turns are never snappy
    const target = (pose.headingRad * 180) / Math.PI;
    if (smoothedYaw === null) smoothedYaw = target;
    let diff = target - smoothedYaw;
    while (diff > 180) diff -= 360;
    while (diff < -180) diff += 360;
    smoothedYaw += diff * Math.min(1, dt * 7);
    root.setEulerAngles(0, smoothedYaw, 0);

    // walk cycle
    const swing = pose.moving ? Math.sin(pose.walkPhase) * 27 : 0;
    legPivots[0].setLocalEulerAngles(swing, 0, 0);
    legPivots[1].setLocalEulerAngles(-swing, 0, 0);
    const bob = pose.moving ? Math.abs(Math.sin(pose.walkPhase)) * 0.06 : 0;
    body.setLocalPosition(0, bob, 0);
    body.setLocalEulerAngles(pose.moving ? 3.5 : 0, 0, pose.moving ? Math.sin(pose.walkPhase) * 1.5 : 0);

    // device state
    if (pose.detecting) {
      screenMat.emissive.set(detectGlow.r, detectGlow.g, detectGlow.b);
      screenMat.emissiveIntensity = 1.6;
      ledMat.emissive.set(0.24, 0.9, 0.45);
      ledMat.emissiveIntensity = 2.2;
    } else {
      screenMat.emissive.set(0.23, 0.28, 0.33);
      screenMat.emissiveIntensity = 0.5;
      ledMat.emissive.set(0.2, 0.23, 0.26);
      ledMat.emissiveIntensity = 0.4;
    }
    screenMat.update();
    ledMat.update();

    ring.enabled = pose.selected;
    if (pose.selected) {
      const pulse = 1.15 + Math.sin(pose.walkPhase * 0.5) * 0.08;
      ring.setLocalScale(pulse, 1, pulse);
    }
  };

  return { id, root, colorHex, setPose };
}

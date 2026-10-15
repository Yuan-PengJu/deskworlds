// Your own pictures in place of a world's creatures. The world's simulation keeps moving
// its creatures exactly as before, schooling, shying from the cursor and coming for food;
// this draws a picture where each one is, turned the way it is going, with a swimming
// wave through it. The host passes the pictures as ?skins=["/skins/…", …]; with none, the
// world draws its own creatures and none of this runs.
//
// A picture should face right: its head, or front, on the right-hand side. Several
// pictures are dealt out in turn, so a school can be a mix of them.

import * as THREE from 'three';

/** The pictures the host passed, if any. Only the host's own /skins/ addresses count. */
export function skinPictures() {
  try {
    const list = JSON.parse(new URLSearchParams(globalThis.location?.search ?? '').get('skins') || '[]');
    return Array.isArray(list) ? list.filter((url) => typeof url === 'string' && url.startsWith('/skins/')).slice(0, 12) : [];
  } catch {
    return [];
  }
}

const VERTEX = `
attribute float aPhase;
attribute float aWave;
uniform float uTime;
varying vec2 vUv;
varying float vBelow;
void main() {
  vUv = uv;
  vec3 p = position;
  // The body runs along x, head at +0.5. The wave grows toward the tail and travels back.
  float tail = clamp(0.5 - p.x, 0.0, 1.0);
  p.y += sin(uTime * 7.0 + aPhase - p.x * 5.0) * aWave * tail * tail;
  vec4 world = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vBelow = max(0.0, -world.y);
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const FRAGMENT = `
uniform sampler2D uMap;
uniform float uLight;
varying vec2 vUv;
varying float vBelow;
void main() {
  vec4 colour = texture2D(uMap, vUv);
  if (colour.a < 0.35) discard;
  #ifdef DEPTH_ALPHA
    // For a world that keeps each pixel's depth below the water in alpha (the koi pond).
    gl_FragColor = vec4(colour.rgb * uLight, vBelow);
  #else
    gl_FragColor = vec4(colour.rgb * uLight, 1.0);
  #endif
  #include <colorspace_fragment>
}`;

/**
 * depthAlpha: for a world that stores each pixel's depth below the water in alpha.
 * view: 'side' for a world seen through the glass, where a picture faces the camera and
 * turns to face its way; 'top' for a pond seen from above, where it lies flat on the water;
 * 'still' for a single object that only ever faces the camera.
 */
export function createSkins(parent, { count, view = 'side', light = 1, wave = 0.05, depthAlpha = false }) {
  const pictures = skinPictures();
  if (!pictures.length || !count) return null;
  const loader = new THREE.TextureLoader();
  const time = { value: 0 };
  const groups = pictures.map((url, index) => {
    const members = [];
    for (let i = index; i < count; i += pictures.length) members.push(i);
    const texture = loader.load(url, () => { group.aspect = texture.image.width / texture.image.height || 1; });
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const geometry = new THREE.PlaneGeometry(1, 1, 16, 1);
    const phase = new Float32Array(members.length).map(() => Math.random() * Math.PI * 2);
    geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    geometry.setAttribute('aWave', new THREE.InstancedBufferAttribute(new Float32Array(members.length).fill(view === 'still' ? 0 : wave), 1));
    const material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: texture }, uTime: time, uLight: { value: light } },
      vertexShader: VERTEX, fragmentShader: FRAGMENT, side: THREE.DoubleSide,
      defines: depthAlpha ? { DEPTH_ALPHA: 1 } : {},
    });
    const mesh = new THREE.InstancedMesh(geometry, material, members.length);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.name = 'Your pictures';
    parent.add(mesh);
    const group = { mesh, members, aspect: 1 };
    return group;
  });

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const turn = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const right = new THREE.Vector3();
  const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  const up = new THREE.Vector3(0, 1, 0);
  const forward = new THREE.Vector3(0, 0, 1);

  return {
    /**
     * Places every picture. `read(i)` gives creature i as { position, direction, length },
     * with direction a THREE.Vector3 for 'side' and an angle in radians for 'top'.
     */
    update(read, camera, seconds) {
      time.value = seconds;
      right.setFromMatrixColumn(camera.matrixWorld, 0);
      for (const group of groups) {
        group.members.forEach((index, slot) => {
          const { position, direction, length } = read(index);
          const height = length / group.aspect;
          if (view === 'top') {
            // Lying flat, its right-hand side (the head) pointing along the heading.
            turn.setFromAxisAngle(up, -direction);
            quaternion.multiplyQuaternions(turn, flat);
            scale.set(length, height, 1);
          } else if (view === 'still') {
            quaternion.copy(camera.quaternion);
            scale.set(length, height, 1);
          } else {
            // Facing the camera, mirrored when going left, tipped up or down with its way.
            const across = direction.dot(right);
            const flip = across < 0 ? -1 : 1;
            const tilt = Math.max(-0.6, Math.min(0.6, Math.atan2(direction.y, Math.abs(across) + 1e-4))) * flip;
            turn.setFromAxisAngle(forward, tilt);
            quaternion.multiplyQuaternions(camera.quaternion, turn);
            scale.set(length * flip, height, 1);
          }
          matrix.compose(position, quaternion, scale);
          group.mesh.setMatrixAt(slot, matrix);
        });
        group.mesh.instanceMatrix.needsUpdate = true;
      }
    },
    dispose() {
      for (const group of groups) {
        group.mesh.removeFromParent();
        group.mesh.geometry.dispose();
        group.mesh.material.dispose();
        group.mesh.material.uniforms.uMap.value.dispose();
      }
    },
  };
}

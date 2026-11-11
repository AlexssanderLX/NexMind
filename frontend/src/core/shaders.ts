/**
 * Shaders do núcleo. Toda a animação (respiração, órbita, gravidade do cursor, ondas de áudio, clique, sucesso,
 * erro, padrão de ferramenta) roda na GPU, a partir de poucos uniforms: a CPU só atualiza números a cada quadro.
 * Partículas e conexões usam a MESMA função `displace`, então as pontas das linhas acompanham os nós.
 */

export const COMMON = /* glsl */ `
uniform float uTime;
uniform float uSwirl;
uniform float uBreath;
uniform float uOrganize;
uniform float uBurst;
uniform float uError;
uniform float uAudio;
uniform float uRippleT;
uniform vec3 uRippleDir;
uniform vec3 uMouse;
uniform float uMouseStrength;

vec3 rotY(vec3 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

vec3 displace(vec3 base, vec3 target, float seed) {
  vec3 dir = normalize(base + vec3(1e-5));
  vec3 p = base;

  // respiração orgânica
  float n = sin(base.x * 2.3 + uTime * 0.7 + seed * 6.28) * sin(base.y * 2.1 - uTime * 0.6) * sin(base.z * 2.7 + uTime * 0.5 + seed * 3.0);
  p += dir * n * (0.03 + 0.05 * uBreath);

  // ondas de áudio correndo ao longo da latitude
  p += dir * uAudio * 0.16 * (0.5 + 0.5 * sin(base.y * 9.0 - uTime * 9.0 + seed * 6.28));

  // órbita (pensando): torção que varia com a latitude
  p = rotY(p, uSwirl * (0.55 + 0.45 * sin(base.y * 4.0 + seed * 2.0)));

  // padrão organizado (execução de ferramenta): anéis de latitude girando
  p = mix(p, rotY(target, uTime * 0.45), uOrganize);

  // gravidade do cursor
  vec3 d = uMouse - p;
  float f = smoothstep(0.75, 0.0, length(d));
  p += d * f * uMouseStrength * (0.4 + seed * 0.6);

  // onda do clique, partindo do ponto clicado
  float ang = acos(clamp(dot(dir, uRippleDir), -1.0, 1.0));
  float front = uRippleT * 2.4;
  float w = sin((ang - front) * 10.0) * exp(-abs(ang - front) * 3.5) * exp(-uRippleT * 1.1);
  p += dir * w * 0.14;

  // sucesso: expansão luminosa
  p += dir * uBurst * 0.28;

  // erro: tremor discreto
  p.x += sin(uTime * 38.0 + seed * 20.0) * 0.014 * uError;

  return p;
}
`;

const VIEW = /* glsl */ `
uniform float uCamZ;
float frontness(float vz) {
  return clamp(1.0 - (vz - (uCamZ - 1.2)) / 2.4, 0.0, 1.0);
}
`;

export const POINT_VERT = /* glsl */ `
${VIEW}
attribute float aSeed;
attribute float aSize;
attribute vec3 aTarget;
uniform float uPointScale;
uniform float uProx;
varying float vFront;
varying float vSeed;

void main() {
  vec3 p = displace(position, aTarget, aSeed);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float vz = -mv.z;
  vFront = frontness(vz);
  vSeed = aSeed;
  gl_PointSize = aSize * uPointScale * (uCamZ / vz) * (1.0 + uProx * 0.35 + uAudio * 0.6);
  gl_Position = projectionMatrix * mv;
}
`;

export const POINT_FRAG = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform float uError;
uniform vec3 uNear;
uniform vec3 uFar;
varying float vFront;
varying float vSeed;

void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = pow(1.0 - d * 2.0, 1.6);
  float tw = 0.78 + 0.22 * sin(uTime * 2.2 + vSeed * 40.0);
  vec3 col = mix(uFar, uNear, vFront);
  col = mix(col, vec3(1.0, 0.32, 0.32), uError * 0.7);
  gl_FragColor = vec4(col * tw * uIntensity, a * (0.2 + 0.8 * vFront));
}
`;

export const LINE_VERT = /* glsl */ `
${VIEW}
attribute float aSeed;
attribute float aT;
attribute float aPhase;
attribute vec3 aTarget;
varying float vT;
varying float vPhase;
varying float vFront;

void main() {
  vec3 p = displace(position, aTarget, aSeed);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vFront = frontness(-mv.z);
  vT = aT;
  vPhase = aPhase;
  gl_Position = projectionMatrix * mv;
}
`;

export const LINE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform float uError;
uniform float uAudio;
uniform float uPulseSpeed;
uniform vec3 uNear;
uniform vec3 uFar;
varying float vT;
varying float vPhase;
varying float vFront;

void main() {
  float pulse = fract(uTime * uPulseSpeed + vPhase);
  float packet = exp(-abs(vT - pulse) * 9.0);
  float a = 0.10 + 0.14 * vFront + packet * (0.55 + uAudio * 0.5) * vFront;
  vec3 col = mix(uFar, uNear, 0.35 + packet * 0.65);
  col = mix(col, vec3(1.0, 0.32, 0.32), uError * 0.7);
  gl_FragColor = vec4(col * uIntensity, a);
}
`;

export const RING_VERT = /* glsl */ `
attribute float aA;
varying float vA;
void main() {
  vA = aA;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const RING_FRAG = /* glsl */ `
uniform float uDash;
uniform float uPhase;
uniform float uIntensity;
uniform float uError;
uniform float uAlpha;
varying float vA;
void main() {
  float m = step(0.45, fract(vA * uDash + uPhase));
  vec3 col = mix(vec3(0.2, 0.85, 1.0), vec3(1.0, 0.32, 0.32), uError * 0.7);
  gl_FragColor = vec4(col * uIntensity, uAlpha * (0.25 + 0.75 * m));
}
`;

export const GLOW_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const GLOW_FRAG = /* glsl */ `
uniform float uGlow;
uniform float uError;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float core = exp(-d * d * 6.0);
  float halo = exp(-d * 2.6) * 0.28;
  float a = (core * 0.55 + halo) * uGlow;
  vec3 col = mix(vec3(0.08, 0.55, 0.95), vec3(0.45, 0.95, 1.0), core);
  col = mix(col, vec3(1.0, 0.3, 0.3), uError * 0.6);
  gl_FragColor = vec4(col * a, a);
}
`;

export const HALO_VERT = /* glsl */ `
${VIEW}
attribute float aSeed;
attribute float aSize;
uniform float uPointScale;
varying float vSeed;
varying float vFront;
mat3 rotYm(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
}
void main() {
  vec3 p = rotYm(uTime * 0.06 * (0.4 + aSeed)) * position;
  p.y += sin(uTime * 0.3 + aSeed * 6.28) * 0.05;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float vz = -mv.z;
  vFront = frontness(vz);
  vSeed = aSeed;
  gl_PointSize = aSize * uPointScale * (uCamZ / vz) * (1.0 + uAudio * 0.5);
  gl_Position = projectionMatrix * mv;
}
`;

export const HALO_FRAG = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform float uError;
varying float vSeed;
varying float vFront;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = pow(1.0 - d * 2.0, 2.0);
  float tw = 0.6 + 0.4 * sin(uTime * 1.6 + vSeed * 50.0);
  vec3 col = mix(vec3(0.1, 0.5, 0.95), vec3(0.6, 0.95, 1.0), vFront);
  col = mix(col, vec3(1.0, 0.32, 0.32), uError * 0.6);
  gl_FragColor = vec4(col * tw * uIntensity, a * 0.35 * (0.3 + 0.7 * vFront));
}
`;

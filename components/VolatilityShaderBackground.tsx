'use client';

import { useEffect, useRef } from 'react';

type Props = {
  kineticSpeed: number;
  turbulence: number;
  volatilityNormalized: number;
  isDefcon1: boolean;
};

const VS = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FS = `
precision highp float;
uniform float u_time;
uniform float u_speed;
uniform float u_turb;
uniform float u_calm;
uniform vec2 u_res;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_accent;

float n2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res.xy;
  float t = u_time * u_speed;
  float wave = sin(uv.x * 6.28318 + t * 1.15) * 0.5 + 0.5;
  wave += sin(uv.y * 5.2 - t * 0.88) * 0.35;
  wave += sin((uv.x + uv.y * 0.7) * 4.1 + t * 1.9) * u_turb * 0.55;
  vec2 g = uv * 140.0 + t * 0.3;
  wave += (n2(g) - 0.5) * u_turb * 0.45;
  wave += (n2(g * 1.7 + 13.1) - 0.5) * u_turb * 0.25;
  float pulse = sin(t * (2.0 + u_turb * 3.0)) * 0.5 + 0.5;
  float v = mix(wave, pulse, u_turb * 0.22);
  vec3 base = mix(u_c1, u_c2, clamp(v, 0.0, 1.0));
  vec3 col = mix(vec3(0.02, 0.02, 0.03), base, 0.55 + u_calm * 0.35);
  col += u_accent * (0.08 + u_turb * 0.12) * sin(uv.x * 3.14159 + t);
  float alpha = 0.42 + u_calm * 0.2;
  gl_FragColor = vec4(col, alpha);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function link(gl: WebGLRenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram | null {
  const p = gl.createProgram();
  if (!p) return null;
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    gl.deleteProgram(p);
    return null;
  }
  return p;
}

export default function VolatilityShaderBackground({
  kineticSpeed,
  turbulence,
  volatilityNormalized,
  isDefcon1,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);
  const prefs = useRef({ kineticSpeed, turbulence, volatilityNormalized, isDefcon1 });
  prefs.current = { kineticSpeed, turbulence, volatilityNormalized, isDefcon1 };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: false });
    if (!gl) return;

    const vs = compile(gl, gl.VERTEX_SHADER, VS);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return;
    const prog = link(gl, vs, fs);
    if (!prog) return;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

    const aPos = gl.getAttribLocation(prog, 'a_pos');
    const uTime = gl.getUniformLocation(prog, 'u_time');
    const uSpeed = gl.getUniformLocation(prog, 'u_speed');
    const uTurb = gl.getUniformLocation(prog, 'u_turb');
    const uCalm = gl.getUniformLocation(prog, 'u_calm');
    const uRes = gl.getUniformLocation(prog, 'u_res');
    const uC1 = gl.getUniformLocation(prog, 'u_c1');
    const uC2 = gl.getUniformLocation(prog, 'u_c2');
    const uAcc = gl.getUniformLocation(prog, 'u_accent');

    const resize = () => {
      const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(document.documentElement);

    const draw = (t: number) => {
      if (!startRef.current) startRef.current = t;
      const elapsed = (t - startRef.current) / 1000;
      const { kineticSpeed: ks, turbulence: tb, volatilityNormalized: vn, isDefcon1: d1 } = prefs.current;

      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

      gl.uniform1f(uTime, elapsed);
      gl.uniform1f(uSpeed, ks);
      gl.uniform1f(uTurb, tb);
      gl.uniform1f(uCalm, 1.0 - vn * 0.85);
      gl.uniform2f(uRes, canvas.width, canvas.height);

      if (d1) {
        gl.uniform3f(uC1, 0.12, 0.0, 0.02);
        gl.uniform3f(uC2, 0.55, 0.04, 0.08);
        gl.uniform3f(uAcc, 0.9, 0.05, 0.12);
      } else {
        gl.uniform3f(uC1, 0.02, 0.08, 0.12);
        gl.uniform3f(uC2, 0.06, 0.22, 0.28);
        gl.uniform3f(uAcc, 0.05, 0.75, 0.85);
      }

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buf);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-0 h-[100dvh] w-full"
      aria-hidden
      style={{ mixBlendMode: 'normal' }}
    />
  );
}

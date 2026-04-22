// Client-only component — imported via React.lazy to skip SSR
import { useEffect, useRef } from "react";
import * as THREE from "three";

export default function ParticleBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
    camera.position.z = 30;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const particleCount = 80;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const indigoBase = new THREE.Color("hsl(245, 58%, 51%)");
    const violetBase = new THREE.Color("hsl(270, 60%, 55%)");

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 50;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 35;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 20;
      const color = Math.random() > 0.5 ? indigoBase : violetBase;
      colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.4, vertexColors: true, transparent: true, opacity: 0.35,
      blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });

    const particles = new THREE.Points(geometry, material);
    scene.add(particles);

    let animationId: number;
    const clock = new THREE.Clock();

    const animate = () => {
      animationId = requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime();
      particles.rotation.y = elapsed * 0.02;
      particles.rotation.x = Math.sin(elapsed * 0.01) * 0.1;
      const pos = geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < particleCount; i++) pos[i * 3 + 1] += Math.sin(elapsed + i * 0.1) * 0.003;
      geometry.attributes.position.needsUpdate = true;
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!canvas.parentElement) return;
      camera.aspect = canvas.parentElement.clientWidth / canvas.parentElement.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(canvas.parentElement.clientWidth, canvas.parentElement.clientHeight);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", handleResize);
      geometry.dispose(); material.dispose(); renderer.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />;
}

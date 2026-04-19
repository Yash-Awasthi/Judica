import { useRef, useMemo, useState, useEffect } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

// Generate node positions and connections
function generateConstellation(nodeCount: number, connectionRadius: number) {
  const positions: [number, number, number][] = [];
  const connections: [number, number][] = [];

  for (let i = 0; i < nodeCount; i++) {
    positions.push([
      (Math.random() - 0.5) * 4,
      (Math.random() - 0.5) * 3,
      (Math.random() - 0.5) * 2,
    ]);
  }

  for (let i = 0; i < nodeCount; i++) {
    for (let j = i + 1; j < nodeCount; j++) {
      const dx = positions[i][0] - positions[j][0];
      const dy = positions[i][1] - positions[j][1];
      const dz = positions[i][2] - positions[j][2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < connectionRadius) {
        connections.push([i, j]);
      }
    }
  }

  return { positions, connections };
}

function Nodes({ positions }: { positions: [number, number, number][] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    if (!meshRef.current) return;
    positions.forEach(([x, y, z], i) => {
      dummy.position.set(x, y, z);
      const scale = 0.02 + Math.random() * 0.03;
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [positions, dummy]);

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, positions.length]}>
      <sphereGeometry args={[1, 12, 12]} />
      <meshBasicMaterial color="#6EE7B7" transparent opacity={0.8} />
    </instancedMesh>
  );
}

function Lines({ positions, connections }: { positions: [number, number, number][]; connections: [number, number][] }) {
  const linePositions = useMemo(() => {
    const arr: number[] = [];
    connections.forEach(([a, b]) => {
      arr.push(...positions[a], ...positions[b]);
    });
    return new Float32Array(arr);
  }, [positions, connections]);

  return (
    <lineSegments>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[linePositions, 3]}
        />
      </bufferGeometry>
      <lineBasicMaterial color="#ffffff" transparent opacity={0.06} />
    </lineSegments>
  );
}

function ConstellationGroup({ positions, connections }: { positions: [number, number, number][]; connections: [number, number][] }) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    if (groupRef.current) {
      groupRef.current.rotation.y += 0.001;
      groupRef.current.rotation.x += 0.0003;
    }
  });

  return (
    <group ref={groupRef}>
      <Nodes positions={positions} />
      <Lines positions={positions} connections={connections} />
    </group>
  );
}

function MouseFollowCamera() {
  const { camera } = useThree();
  const targetX = useRef(0);
  const targetY = useRef(0);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      targetX.current = (e.clientX / window.innerWidth - 0.5) * 0.5;
      targetY.current = (e.clientY / window.innerHeight - 0.5) * 0.3;
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  /* eslint-disable react-hooks/immutability -- useFrame requires direct camera mutation (standard Three.js pattern) */
  useFrame(() => {
    camera.position.x += (targetX.current - camera.position.x) * 0.02;
    camera.position.y += (-targetY.current - camera.position.y) * 0.02;
    camera.lookAt(0, 0, 0);
  });
  /* eslint-enable react-hooks/immutability */

  return null;
}

export function HeroScene({ className = "" }: { className?: string }) {
  const [webGLAvailable, setWebGLAvailable] = useState(true);
  const { positions, connections } = useMemo(() => generateConstellation(40, 1.5), []);

  useEffect(() => {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (!gl) setWebGLAvailable(false);
    } catch {
       
      setWebGLAvailable(false);
    }
  }, []);

  if (!webGLAvailable) {
    // CSS fallback: gradient orb
    return (
      <div className={`relative ${className}`}>
        <div className="w-full h-full flex items-center justify-center">
          <div className="w-48 h-48 rounded-full bg-gradient-to-br from-[var(--accent-mint)] to-[var(--accent-blue)] opacity-20 blur-3xl animate-glow-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <Canvas
        camera={{ position: [0, 0, 5], fov: 50 }}
        style={{ background: "transparent" }}
        gl={{ alpha: true, antialias: true }}
      >
        <ambientLight intensity={0.3} />
        <pointLight position={[5, 5, 5]} intensity={0.5} color="#6EE7B7" />
        <pointLight position={[-5, -3, 3]} intensity={0.3} color="#93C5FD" />
        <ConstellationGroup positions={positions} connections={connections} />
        <MouseFollowCamera />
      </Canvas>
    </div>
  );
}

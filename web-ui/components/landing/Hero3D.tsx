"use client"

import React, { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Cylinder, Box, Torus, Edges, Float, Environment } from '@react-three/drei'
import * as THREE from 'three'
import { useTheme } from 'next-themes'

function CadAssembly() {
  const groupRef = useRef<THREE.Group>(null!)
  const { resolvedTheme } = useTheme()
  
  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = state.clock.getElapsedTime() * 0.4
      groupRef.current.rotation.x = Math.sin(state.clock.getElapsedTime() * 0.3) * 0.2
      groupRef.current.rotation.z = Math.cos(state.clock.getElapsedTime() * 0.2) * 0.1
    }
  })

  // Adjust edge colors based on theme for better visibility
  const isDark = resolvedTheme === 'dark' || !resolvedTheme
  const edgeColor = isDark ? "#475569" : "#cbd5e1"
  const bodyColor = isDark ? "#1e293b" : "#f1f5f9"
  
  const materialProps = {
    color: bodyColor,
    metalness: 0.5,
    roughness: 0.4,
    clearcoat: 0.2,
  }

  const accentMaterialProps = {
    color: "#3b82f6",
    metalness: 0.8,
    roughness: 0.2,
  }

  return (
    <Float speed={2} rotationIntensity={0.5} floatIntensity={1}>
      <group ref={groupRef} scale={1.2}>
        {/* Central Hub */}
        <Cylinder args={[0.6, 0.6, 1.2, 32]} rotation={[Math.PI / 2, 0, 0]}>
          <meshStandardMaterial {...materialProps} />
          <Edges scale={1.001} color={edgeColor} />
        </Cylinder>

        {/* Inner Shaft */}
        <Cylinder args={[0.2, 0.2, 2.8, 32]} rotation={[Math.PI / 2, 0, 0]}>
          <meshStandardMaterial {...accentMaterialProps} />
        </Cylinder>

        {/* Spoke 1 */}
        <Box args={[2.2, 0.3, 0.3]}>
          <meshStandardMaterial {...materialProps} />
          <Edges scale={1.001} color={edgeColor} />
        </Box>

        {/* Spoke 2 */}
        <Box args={[0.3, 2.2, 0.3]}>
          <meshStandardMaterial {...materialProps} />
          <Edges scale={1.001} color={edgeColor} />
        </Box>

        {/* Outer Ring */}
        <Torus args={[1.1, 0.15, 16, 64]} rotation={[Math.PI / 2, 0, 0]}>
          <meshStandardMaterial {...materialProps} />
          <Edges scale={1.001} color={edgeColor} />
        </Torus>
        
        {/* Secondary Ring */}
        <Torus args={[1.4, 0.05, 16, 64]} rotation={[Math.PI / 2, 0, 0]}>
          <meshStandardMaterial {...materialProps} />
        </Torus>
        
        {/* Accent Caps */}
        <Cylinder args={[0.3, 0.3, 0.2, 32]} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.65]}>
          <meshStandardMaterial {...accentMaterialProps} />
        </Cylinder>
        <Cylinder args={[0.3, 0.3, 0.2, 32]} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.65]}>
          <meshStandardMaterial {...accentMaterialProps} />
        </Cylinder>
      </group>
    </Float>
  )
}

export function Hero3D() {
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return <div className="w-full h-full min-h-[400px] flex items-center justify-center" />
  }

  return (
    <div className="w-full h-full min-h-[400px] flex items-center justify-center">
      <Canvas camera={{ position: [2.5, 1.8, 4.2], fov: 42 }}>
        <ambientLight intensity={1.2} />
        <directionalLight position={[10, 10, 10]} intensity={2.5} castShadow />
        <directionalLight position={[-10, -10, -10]} intensity={1.5} color="#06b6d4" />
        <Environment files="/potsdamer_platz_1k.hdr" />
        <CadAssembly />
        <OrbitControls enableZoom={false} autoRotate autoRotateSpeed={0.5} />
      </Canvas>
    </div>
  )
}

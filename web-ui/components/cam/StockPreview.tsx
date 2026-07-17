import React from 'react';
import type { OriginPosition, StockType } from '@/types/cam';
import { Box, Cylinder, Layers } from 'lucide-react';

interface StockPreviewProps {
    stockType?: StockType;
    dimensions: [number, number, number]; // X, Y, Z
    units: 'mm' | 'in';
    origin: OriginPosition;
}

export function StockPreview({ stockType = 'box', dimensions, units, origin }: StockPreviewProps) {
    const [x, y, z] = dimensions;
    
    // For cylinder, X and Y are both the diameter. Use X as diameter.
    const isCyl = stockType === 'cylinder';
    
    // Normalize dimensions for display (max size ~150px)
    const maxDim = Math.max(x, y, z) || 1;
    const scale = 150 / maxDim;
    
    const drawX = (x * scale) || 100;
    const drawY = isCyl ? drawX : ((y * scale) || 100);
    const drawZ = (z * scale) || 50;
    
    // Isometric projection angles
    const angleX = Math.PI / 6; // 30 degrees
    
    const getIsoPoint = (px: number, py: number, pz: number) => {
        const isoX = (px - py) * Math.cos(angleX);
        const isoY = (px + py) * Math.sin(angleX) - pz;
        return { x: isoX, y: isoY };
    };

    // Calculate all 8 corners of the box (used for bounding box and drawing box)
    const p0 = getIsoPoint(drawX/2, drawY/2, 0);
    const p1 = getIsoPoint(drawX/2, -drawY/2, 0);
    const p2 = getIsoPoint(-drawX/2, -drawY/2, 0);
    const p3 = getIsoPoint(-drawX/2, drawY/2, 0);
    
    const p4 = getIsoPoint(drawX/2, drawY/2, drawZ);
    const p5 = getIsoPoint(drawX/2, -drawY/2, drawZ);
    const p6 = getIsoPoint(-drawX/2, -drawY/2, drawZ);
    const p7 = getIsoPoint(-drawX/2, drawY/2, drawZ);

    // Calculate origin indicator point based on the selected position
    let originIso = p4; 
    
    if (origin === 'top_center') {
        originIso = getIsoPoint(0, 0, drawZ);
    } else if (origin === 'bottom_center') {
        originIso = getIsoPoint(0, 0, 0);
    } else if (origin === 'model_center') {
        originIso = getIsoPoint(0, 0, drawZ/2);
    } else if (origin === 'front_left_top') {
        // Front Left Top corner
        originIso = isCyl ? { x: -(drawX/2)*Math.cos(angleX), y: (drawX/2)*Math.sin(angleX) - drawZ } : p7; 
    }
    
    // Determine the bounding box to center the SVG
    // For cylinder, the width is 2 * (drawX/2 * cos(30) + drawX/2 * cos(30)) -> actually rx is drawX * cos(30)
    const rx = (drawX / 2) * Math.cos(angleX) * 2;
    const ry = (drawX / 2) * Math.sin(angleX) * 2;

    const allX = isCyl ? [-rx, rx] : [p0.x, p1.x, p2.x, p3.x, p4.x, p5.x, p6.x, p7.x];
    const allY = isCyl ? [-drawZ - ry, ry] : [p0.y, p1.y, p2.y, p3.y, p4.y, p5.y, p6.y, p7.y];
    
    const minX = Math.min(...allX) - 50; 
    const maxX = Math.max(...allX) + 50;
    const minY = Math.min(...allY) - 50;
    const maxY = Math.max(...allY) + 50;
    
    const width = maxX - minX;
    const height = maxY - minY;
    
    return (
        <div className="flex flex-col items-center bg-background/30 rounded-xl border border-border/40 p-4 relative overflow-hidden group">
            <div className="absolute top-3 left-3 flex items-center gap-2">
                {isCyl ? <Cylinder className="size-3.5 text-primary/70" /> : <Box className="size-3.5 text-primary/70" />}
                <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70">Stock Preview</span>
            </div>
            
            <div className="w-full flex justify-center py-4">
                <svg width="100%" height="200" viewBox={`${minX} ${minY} ${width} ${height}`} className="overflow-visible">
                    <g className="transition-all duration-500 ease-in-out">
                        {isCyl ? (
                            // CYLINDER DRAWING
                            <g>
                                {/* Bottom ellipse (back half invisible, but we just draw the whole thing and cover it) */}
                                <ellipse cx="0" cy="0" rx={rx} ry={ry} fill="rgba(59, 130, 246, 0.05)" stroke="rgba(59, 130, 246, 0.2)" strokeWidth="1" strokeDasharray="4 4" />
                                
                                {/* Cylinder body */}
                                <path 
                                    d={`M ${-rx} 0 L ${-rx} ${-drawZ} L ${rx} ${-drawZ} L ${rx} 0 A ${rx} ${ry} 0 0 1 ${-rx} 0 Z`} 
                                    fill="rgba(59, 130, 246, 0.15)" 
                                    stroke="rgba(59, 130, 246, 0.7)" 
                                    strokeWidth="1.5" 
                                    strokeLinejoin="round" 
                                />
                                
                                {/* Top ellipse */}
                                <ellipse 
                                    cx="0" cy={-drawZ} 
                                    rx={rx} ry={ry} 
                                    fill="rgba(59, 130, 246, 0.25)" 
                                    stroke="rgba(59, 130, 246, 0.7)" 
                                    strokeWidth="1.5" 
                                />
                            </g>
                        ) : (
                            // BOX DRAWING
                            <g>
                                {/* Back faces */}
                                <polygon points={`${p2.x},${p2.y} ${p3.x},${p3.y} ${p7.x},${p7.y} ${p6.x},${p6.y}`} fill="rgba(59, 130, 246, 0.05)" stroke="none" />
                                <polygon points={`${p1.x},${p1.y} ${p2.x},${p2.y} ${p6.x},${p6.y} ${p5.x},${p5.y}`} fill="rgba(59, 130, 246, 0.05)" stroke="none" />
                                
                                {/* Back wireframes */}
                                <line x1={p2.x} y1={p2.y} x2={p3.x} y2={p3.y} stroke="rgba(59, 130, 246, 0.2)" strokeWidth="1" strokeDasharray="4 4" />
                                <line x1={p2.x} y1={p2.y} x2={p1.x} y2={p1.y} stroke="rgba(59, 130, 246, 0.2)" strokeWidth="1" strokeDasharray="4 4" />
                                <line x1={p2.x} y1={p2.y} x2={p6.x} y2={p6.y} stroke="rgba(59, 130, 246, 0.2)" strokeWidth="1" strokeDasharray="4 4" />
                                
                                {/* Front faces */}
                                <polygon points={`${p0.x},${p0.y} ${p1.x},${p1.y} ${p5.x},${p5.y} ${p4.x},${p4.y}`} fill="rgba(59, 130, 246, 0.15)" stroke="rgba(59, 130, 246, 0.5)" strokeWidth="1.5" strokeLinejoin="round" />
                                <polygon points={`${p0.x},${p0.y} ${p3.x},${p3.y} ${p7.x},${p7.y} ${p4.x},${p4.y}`} fill="rgba(59, 130, 246, 0.25)" stroke="rgba(59, 130, 246, 0.5)" strokeWidth="1.5" strokeLinejoin="round" />
                                <polygon points={`${p4.x},${p4.y} ${p5.x},${p5.y} ${p6.x},${p6.y} ${p7.x},${p7.y}`} fill="rgba(59, 130, 246, 0.35)" stroke="rgba(59, 130, 246, 0.5)" strokeWidth="1.5" strokeLinejoin="round" />
                                
                                {/* Outline strokes */}
                                <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke="rgba(59, 130, 246, 0.7)" strokeWidth="1.5" />
                                <line x1={p0.x} y1={p0.y} x2={p3.x} y2={p3.y} stroke="rgba(59, 130, 246, 0.7)" strokeWidth="1.5" />
                                <line x1={p0.x} y1={p0.y} x2={p4.x} y2={p4.y} stroke="rgba(59, 130, 246, 0.7)" strokeWidth="1.5" />
                            </g>
                        )}
                        
                        {/* Origin indicator */}
                        <g transform={`translate(${originIso.x}, ${originIso.y})`}>
                            <line x1="0" y1="0" x2="-25" y2="14.4" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" /> 
                            <line x1="0" y1="0" x2="25" y2="14.4" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" /> 
                            <line x1="0" y1="0" x2="0" y2="-25" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" /> 
                            
                            <circle cx="0" cy="0" r="4" fill="white" stroke="#000" strokeWidth="1" />
                            <circle cx="0" cy="0" r="2" fill="#ef4444" />
                            
                            <text x="0" y="-32" textAnchor="middle" fill="currentColor" className="text-[10px] font-bold fill-foreground" style={{ filter: 'drop-shadow(0px 2px 2px rgba(0,0,0,0.8))' }}>
                                ZERO
                            </text>
                        </g>

                        {/* Dimension Labels */}
                        {isCyl ? (
                            <>
                                {/* Diameter Label */}
                                <g transform={`translate(${rx + 15}, ${-drawZ/2})`}>
                                    <text textAnchor="start" fill="currentColor" className="text-[10px] font-mono fill-muted-foreground">DIA: {x.toFixed(1)}{units}</text>
                                </g>
                                {/* Height Label */}
                                <g transform={`translate(${-rx - 15}, ${-drawZ/2})`}>
                                    <text textAnchor="end" fill="currentColor" className="text-[10px] font-mono fill-muted-foreground">Z: {z.toFixed(1)}{units}</text>
                                </g>
                            </>
                        ) : (
                            <>
                                {/* X Dimension (Width) */}
                                <g transform={`translate(${(p0.x + p3.x) / 2 - 15}, ${(p0.y + p3.y) / 2 + 15})`}>
                                    <text textAnchor="end" fill="currentColor" className="text-[10px] font-mono fill-muted-foreground">X: {x.toFixed(1)}{units}</text>
                                </g>
                                
                                {/* Y Dimension (Length) */}
                                <g transform={`translate(${(p0.x + p1.x) / 2 + 15}, ${(p0.y + p1.y) / 2 + 15})`}>
                                    <text textAnchor="start" fill="currentColor" className="text-[10px] font-mono fill-muted-foreground">Y: {y.toFixed(1)}{units}</text>
                                </g>

                                {/* Z Dimension (Height) */}
                                <g transform={`translate(${p5.x + 15}, ${(p1.y + p5.y) / 2})`}>
                                    <text textAnchor="start" fill="currentColor" className="text-[10px] font-mono fill-muted-foreground">Z: {z.toFixed(1)}{units}</text>
                                </g>
                            </>
                        )}
                    </g>
                </svg>
            </div>
            
            <div className="absolute bottom-3 right-3 flex items-center gap-2 bg-background/80 backdrop-blur-sm border border-border/50 px-2 py-1 rounded text-[9px] font-bold uppercase tracking-wider text-muted-foreground shadow-sm">
                <span className="text-red-500">X</span>
                <span className="text-green-500">Y</span>
                <span className="text-blue-500">Z</span>
            </div>
        </div>
    );
}

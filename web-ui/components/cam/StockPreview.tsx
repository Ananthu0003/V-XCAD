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
    const isCyl = stockType === 'cylinder' || stockType === 'relative_cylinder' || stockType === 'fixed_cylinder';
    
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

    // Calculate all 8 corners of the box
    const p0 = getIsoPoint(drawX/2, drawY/2, 0);
    const p1 = getIsoPoint(drawX/2, -drawY/2, 0);
    const p2 = getIsoPoint(-drawX/2, -drawY/2, 0);
    const p3 = getIsoPoint(-drawX/2, drawY/2, 0);
    
    const p4 = getIsoPoint(drawX/2, drawY/2, drawZ);
    const p5 = getIsoPoint(drawX/2, -drawY/2, drawZ);
    const p6 = getIsoPoint(-drawX/2, -drawY/2, drawZ);
    const p7 = getIsoPoint(-drawX/2, drawY/2, drawZ);

    let originIso = p4; 
    if (origin === 'top_center') {
        originIso = getIsoPoint(0, 0, drawZ);
    } else if (origin === 'bottom_center') {
        originIso = getIsoPoint(0, 0, 0);
    } else if (origin === 'model_center') {
        originIso = getIsoPoint(0, 0, drawZ/2);
    } else if (origin === 'front_left_top') {
        originIso = isCyl ? { x: -(drawX/2)*Math.cos(angleX), y: (drawX/2)*Math.sin(angleX) - drawZ } : p7; 
    }
    
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
        <div className="flex flex-col items-center bg-gradient-to-b from-background/80 to-muted/20 rounded-xl border border-cyan-500/30 p-4 relative overflow-hidden group shadow-lg shadow-cyan-950/20">
            {/* Header Stock Identification Chip */}
            <div className="w-full flex items-center justify-between border-b border-border/40 pb-2.5 mb-2">
                <div className="flex items-center gap-2">
                    {isCyl ? (
                        <div className="p-1.5 rounded-lg bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                            <Cylinder className="size-4" />
                        </div>
                    ) : (
                        <div className="p-1.5 rounded-lg bg-blue-500/20 text-blue-400 border border-blue-500/30">
                            <Box className="size-4" />
                        </div>
                    )}
                    <div className="flex flex-col">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-cyan-400">
                            {isCyl ? 'Cylindrical Bar Stock' : 'Rectangular Block Stock'}
                        </span>
                        <span className="text-[9px] text-muted-foreground font-mono">
                            {isCyl ? `ø${x.toFixed(1)}${units} × ${z.toFixed(1)}${units} H` : `${x.toFixed(1)} × ${y.toFixed(1)} × ${z.toFixed(1)} ${units}`}
                        </span>
                    </div>
                </div>

                <div className="px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-[9px] font-mono font-bold text-cyan-300">
                    RAW WORKPIECE
                </div>
            </div>
            
            <div className="w-full flex justify-center py-2">
                <svg width="100%" height="180" viewBox={`${minX} ${minY} ${width} ${height}`} className="overflow-visible">
                    <defs>
                        <linearGradient id="cylGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.35" />
                            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.1" />
                        </linearGradient>
                        <linearGradient id="boxFrontGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.4" />
                            <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0.15" />
                        </linearGradient>
                        <linearGradient id="boxTopGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.5" />
                            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.3" />
                        </linearGradient>
                    </defs>
                    <g className="transition-all duration-500 ease-in-out">
                        {(() => {
                            const originIndicator = (
                                <g transform={`translate(${originIso.x}, ${originIso.y})`}>
                                    <line x1="0" y1="0" x2="-25" y2="14.4" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" /> 
                                    <line x1="0" y1="0" x2="25" y2="14.4" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" /> 
                                    <line x1="0" y1="0" x2="0" y2="-25" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" /> 
                                    
                                    <circle cx="0" cy="0" r="3" fill="#ef4444" stroke="#ffffff" strokeWidth="1" />
                                    
                                    <text x="0" y="-32" textAnchor="middle" fill="#ffffff" className="text-[11px] font-black tracking-widest" style={{ filter: 'drop-shadow(0px 2px 4px rgba(0,0,0,0.9))' }}>
                                        WCS ZERO
                                    </text>
                                </g>
                            );

                            return isCyl ? (
                                // CYLINDER DRAWING
                                <g>
                                    <ellipse cx="0" cy="0" rx={rx} ry={ry} fill="rgba(6, 182, 212, 0.08)" stroke="rgba(6, 182, 212, 0.3)" strokeWidth="1" strokeDasharray="4 4" />
                                    
                                    <path 
                                        d={`M ${-rx} 0 L ${-rx} ${-drawZ} L ${rx} ${-drawZ} L ${rx} 0 A ${rx} ${ry} 0 0 1 ${-rx} 0 Z`} 
                                        fill="url(#cylGrad)" 
                                        stroke="#06b6d4" 
                                        strokeWidth="2" 
                                        strokeLinejoin="round" 
                                    />
                                    
                                    {originIndicator}

                                    <ellipse 
                                        cx="0" cy={-drawZ} 
                                        rx={rx} ry={ry} 
                                        fill="rgba(6, 182, 212, 0.35)" 
                                        stroke="#22d3ee" 
                                        strokeWidth="2" 
                                    />
                                </g>
                            ) : (
                                // BOX DRAWING
                                <g>
                                    <polygon points={`${p2.x},${p2.y} ${p3.x},${p3.y} ${p7.x},${p7.y} ${p6.x},${p6.y}`} fill="rgba(59, 130, 246, 0.08)" stroke="none" />
                                    <polygon points={`${p1.x},${p1.y} ${p2.x},${p2.y} ${p6.x},${p6.y} ${p5.x},${p5.y}`} fill="rgba(59, 130, 246, 0.08)" stroke="none" />
                                    
                                    <line x1={p2.x} y1={p2.y} x2={p3.x} y2={p3.y} stroke="rgba(59, 130, 246, 0.3)" strokeWidth="1" strokeDasharray="4 4" />
                                    <line x1={p2.x} y1={p2.y} x2={p1.x} y2={p1.y} stroke="rgba(59, 130, 246, 0.3)" strokeWidth="1" strokeDasharray="4 4" />
                                    <line x1={p2.x} y1={p2.y} x2={p6.x} y2={p6.y} stroke="rgba(59, 130, 246, 0.3)" strokeWidth="1" strokeDasharray="4 4" />
                                    
                                    {originIndicator}
                                    
                                    <polygon points={`${p0.x},${p0.y} ${p1.x},${p1.y} ${p5.x},${p5.y} ${p4.x},${p4.y}`} fill="url(#boxFrontGrad)" stroke="#3b82f6" strokeWidth="1.5" strokeLinejoin="round" />
                                    <polygon points={`${p0.x},${p0.y} ${p3.x},${p3.y} ${p7.x},${p7.y} ${p4.x},${p4.y}`} fill="url(#boxFrontGrad)" stroke="#3b82f6" strokeWidth="1.5" strokeLinejoin="round" />
                                    <polygon points={`${p4.x},${p4.y} ${p5.x},${p5.y} ${p6.x},${p6.y} ${p7.x},${p7.y}`} fill="url(#boxTopGrad)" stroke="#60a5fa" strokeWidth="2" strokeLinejoin="round" />
                                    
                                    <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke="#60a5fa" strokeWidth="1.5" />
                                    <line x1={p0.x} y1={p0.y} x2={p3.x} y2={p3.y} stroke="#60a5fa" strokeWidth="1.5" />
                                    <line x1={p0.x} y1={p0.y} x2={p4.x} y2={p4.y} stroke="#60a5fa" strokeWidth="1.5" />
                                </g>
                            );
                        })()}

                        {/* Dimension Callout Pills */}
                        {isCyl ? (
                            <>
                                {/* Diameter Label */}
                                <g transform={`translate(${rx + 15}, ${-drawZ/2})`}>
                                    <rect x="0" y="-12" width="75" height="20" rx="4" fill="rgba(6, 182, 212, 0.2)" stroke="rgba(6, 182, 212, 0.5)" strokeWidth="1" />
                                    <text x="37" y="1" textAnchor="middle" fill="#22d3ee" className="text-[10px] font-mono font-bold">ø {x.toFixed(1)}{units}</text>
                                </g>
                                {/* Height Label */}
                                <g transform={`translate(${-rx - 85}, ${-drawZ/2})`}>
                                    <rect x="0" y="-12" width="75" height="20" rx="4" fill="rgba(6, 182, 212, 0.2)" stroke="rgba(6, 182, 212, 0.5)" strokeWidth="1" />
                                    <text x="37" y="1" textAnchor="middle" fill="#22d3ee" className="text-[10px] font-mono font-bold">L: {z.toFixed(1)}{units}</text>
                                </g>
                            </>
                        ) : (
                            <>
                                {/* X Dimension */}
                                <g transform={`translate(${(p0.x + p3.x) / 2 - 35}, ${(p0.y + p3.y) / 2 + 20})`}>
                                    <rect x="0" y="-12" width="60" height="20" rx="4" fill="rgba(59, 130, 246, 0.2)" stroke="rgba(59, 130, 246, 0.5)" strokeWidth="1" />
                                    <text x="30" y="1" textAnchor="middle" fill="#60a5fa" className="text-[10px] font-mono font-bold">X:{x.toFixed(1)}{units}</text>
                                </g>
                                
                                {/* Y Dimension */}
                                <g transform={`translate(${(p0.x + p1.x) / 2 + 10}, ${(p0.y + p1.y) / 2 + 20})`}>
                                    <rect x="0" y="-12" width="60" height="20" rx="4" fill="rgba(59, 130, 246, 0.2)" stroke="rgba(59, 130, 246, 0.5)" strokeWidth="1" />
                                    <text x="30" y="1" textAnchor="middle" fill="#60a5fa" className="text-[10px] font-mono font-bold">Y:{y.toFixed(1)}{units}</text>
                                </g>

                                {/* Z Dimension */}
                                <g transform={`translate(${p5.x + 10}, ${(p1.y + p5.y) / 2 - 10})`}>
                                    <rect x="0" y="-12" width="60" height="20" rx="4" fill="rgba(59, 130, 246, 0.2)" stroke="rgba(59, 130, 246, 0.5)" strokeWidth="1" />
                                    <text x="30" y="1" textAnchor="middle" fill="#60a5fa" className="text-[10px] font-mono font-bold">Z:{z.toFixed(1)}{units}</text>
                                </g>
                            </>
                        )}
                    </g>
                </svg>
            </div>
            
            <div className="w-full flex items-center justify-between pt-2 border-t border-border/30 text-[9px] font-mono text-muted-foreground">
                <span>STOCK TYPE: <strong className="text-cyan-400 font-bold">{stockType.toUpperCase()}</strong></span>
                <div className="flex items-center gap-1.5">
                    <span className="text-red-400 font-bold">X</span>
                    <span className="text-green-400 font-bold">Y</span>
                    <span className="text-blue-400 font-bold">Z</span>
                </div>
            </div>
        </div>
    );
}

import React from 'react';
import { Ruler } from 'lucide-react';

interface HolderData {
  name?: string;
  type?: string;
  taperType?: string;
  gaugeLength?: number;
  diameter?: number;
  shankSize?: number | null;
}

export function HolderPreview({ holderData }: { holderData: Partial<HolderData> }) {
  const GL = holderData.gaugeLength || 60;
  const D = holderData.diameter || 50;
  const ID = holderData.shankSize || 0; // Inner diameter
  
  // Taper visual params
  const flangeH = 15;
  const flangeD = Math.max(D * 1.2, 60); 
  const taperTopD = flangeD * 0.4;
  const taperBottomD = flangeD * 0.7;
  const taperH = 50;

  // Unified SVG Canvas calculations
  const maxW = Math.max(flangeD, D);
  
  // We need enough width for TWO views side-by-side plus padding
  // Let's allocate 2.5x maxW for each view
  const viewWidth = Math.max(maxW * 5, 200); 
  
  const topPadding = taperH + flangeH + 40; 
  const bottomPadding = Math.max(40, viewWidth * 0.1); 
  const viewHeight = topPadding + GL + bottomPadding;
  const fontSize = Math.max(viewWidth * 0.025, 4);

  // X offsets for the two views
  const frontViewX = -(viewWidth * 0.25);
  const bottomViewX = (viewWidth * 0.25);

  return (
    <div className="w-full h-full relative bg-[#0B1121] flex items-center justify-center p-4">
      
      {/* Background Grid */}
      <div 
        className="absolute inset-0 opacity-10 pointer-events-none"
        style={{
          backgroundImage: 'linear-gradient(#334155 1px, transparent 1px), linear-gradient(90deg, #334155 1px, transparent 1px)',
          backgroundSize: '20px 20px',
          backgroundPosition: 'center center'
        }}
      />

      {/* Overlay data */}
      <div className="absolute top-4 left-4 text-xs font-mono text-slate-300 bg-slate-950/90 px-3 py-2 rounded border border-slate-700 shadow-xl backdrop-blur-md z-20">
        <div className="font-semibold text-white mb-1 flex items-center gap-2">
          <Ruler className="w-3 h-3 text-emerald-400" />
          Dimensions
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <span className="text-slate-500">Gauge Length:</span>
          <span className="text-right text-emerald-400">{GL} mm</span>
          <span className="text-slate-500">Outer Dia:</span>
          <span className="text-right text-emerald-400">{D} mm</span>
          <span className="text-slate-500">Inner Dia:</span>
          <span className="text-right text-emerald-400">{ID || '-'} mm</span>
        </div>
      </div>

      <svg 
        viewBox={`${-viewWidth/2} ${-topPadding} ${viewWidth} ${viewHeight}`}
        className="w-full h-full drop-shadow-2xl z-10"
        style={{ transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)' }}
      >
        <defs>
          <linearGradient id="holderGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#94a3b8" />
            <stop offset="30%" stopColor="#cbd5e1" />
            <stop offset="50%" stopColor="#f8fafc" />
            <stop offset="70%" stopColor="#cbd5e1" />
            <stop offset="100%" stopColor="#64748b" />
          </linearGradient>

          <linearGradient id="vGrooveGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#475569" />
            <stop offset="50%" stopColor="#94a3b8" />
            <stop offset="100%" stopColor="#334155" />
          </linearGradient>
        </defs>

        {/* --- FRONT VIEW --- */}
        <g transform={`translate(${frontViewX}, 0)`}>
          {/* Label */}
          <text x={0} y={-topPadding + 20} fontSize={fontSize * 1.2} textAnchor="middle" fill="#64748b" className="font-mono tracking-[0.2em] font-semibold">FRONT VIEW</text>
          
          {/* Centerline */}
          <line x1="0" y1={-topPadding + 30} x2="0" y2={GL + bottomPadding - 10} stroke="#334155" strokeWidth={viewWidth * 0.002} strokeDasharray="4 4" />

          <g style={{ transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)' }}>
            <polygon 
              points={`${-taperBottomD/2},${-flangeH} ${-taperTopD/2},${-(flangeH + taperH)} ${taperTopD/2},${-(flangeH + taperH)} ${taperBottomD/2},${-flangeH}`}
              fill="url(#holderGrad)" stroke="#475569" strokeWidth={viewWidth * 0.001}
            />
            <rect x={-taperTopD/4} y={-(flangeH + taperH + 5)} width={taperTopD/2} height={5} fill="#475569" />
            <rect x={-flangeD/2} y={-flangeH} width={flangeD} height={flangeH} fill="url(#holderGrad)" stroke="#475569" strokeWidth={viewWidth * 0.001} rx={2} />
            <rect x={-flangeD/2} y={-(flangeH * 0.65)} width={flangeD} height={flangeH * 0.3} fill="url(#vGrooveGrad)" />
            <rect x={-D/2} y="0" width={D} height={GL} fill="url(#holderGrad)" stroke="#475569" strokeWidth={viewWidth * 0.001} />
            <polygon points={`${-D/2},${GL - 2} ${-D/2 + 2},${GL} ${D/2 - 2},${GL} ${D/2},${GL - 2}`} fill="url(#holderGrad)" />
          </g>

          <g className="text-slate-400 font-mono" stroke="#475569" strokeWidth={viewWidth * 0.0015} fill="currentColor">
            {/* Gauge Length */}
            <line x1={D/2 + 10} y1={0} x2={D/2 + 30} y2={0} />
            <line x1={D/2 + 10} y1={GL} x2={D/2 + 30} y2={GL} />
            <line x1={D/2 + 20} y1={0} x2={D/2 + 20} y2={GL} />
            <polygon points={`${D/2+20},0 ${D/2+17},4 ${D/2+23},4`} fill="#475569" stroke="none"/>
            <polygon points={`${D/2+20},${GL} ${D/2+17},${GL-4} ${D/2+23},${GL-4}`} fill="#475569" stroke="none"/>
            <text x={D/2 + 28} y={GL / 2} fontSize={fontSize} dominantBaseline="middle" fill="#34d399" stroke="none">GL: {GL}</text>

            {/* Diameter */}
            <line x1={-D/2} y1={GL + 10} x2={-D/2} y2={GL + 25} />
            <line x1={D/2} y1={GL + 10} x2={D/2} y2={GL + 25} />
            <line x1={-D/2} y1={GL + 18} x2={D/2} y2={GL + 18} />
            <polygon points={`${-D/2},${GL+18} ${-D/2+4},${GL+15} ${-D/2+4},${GL+21}`} fill="#475569" stroke="none"/>
            <polygon points={`${D/2},${GL+18} ${D/2-4},${GL+15} ${D/2-4},${GL+21}`} fill="#475569" stroke="none"/>
            <text x={0} y={GL + 22 + fontSize} fontSize={fontSize} textAnchor="middle" fill="#34d399" stroke="none">Ø{D}</text>

            {/* Taper Text */}
            <text x={-(flangeD/2 + 10)} y={-(flangeH/2)} fontSize={fontSize * 0.8} textAnchor="end" dominantBaseline="middle" stroke="none">
              {holderData.taperType?.toUpperCase() || 'TAPER'}
            </text>
          </g>
        </g>

        {/* --- BOTTOM VIEW --- */}
        <g transform={`translate(${bottomViewX}, ${GL/2})`}>
          {/* Label */}
          <text x={0} y={-(GL/2) - topPadding + 20} fontSize={fontSize * 1.2} textAnchor="middle" fill="#64748b" className="font-mono tracking-[0.2em] font-semibold">BOTTOM VIEW</text>
          
          {/* Crosshairs */}
          <line x1={-(viewWidth * 0.15)} y1="0" x2={(viewWidth * 0.15)} y2="0" stroke="#334155" strokeWidth={viewWidth * 0.002} strokeDasharray="4 4" />
          <line x1="0" y1={-(viewWidth * 0.15)} x2="0" y2={(viewWidth * 0.15)} stroke="#334155" strokeWidth={viewWidth * 0.002} strokeDasharray="4 4" />

          <g style={{ transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)' }}>
            {/* Outer Body */}
            <circle cx="0" cy="0" r={D/2} fill="url(#holderGrad)" stroke="#475569" strokeWidth={viewWidth * 0.001} />
            
            {/* Inner Bore (Shank Size) */}
            {ID > 0 ? (
              <circle cx="0" cy="0" r={ID/2} fill="#0B1121" stroke="#334155" strokeWidth={viewWidth * 0.002} />
            ) : (
              <circle cx="0" cy="0" r={D/4} fill="none" stroke="#64748b" strokeWidth={viewWidth * 0.001} strokeDasharray="2 2" opacity="0.3" />
            )}
          </g>

          {/* Bottom View Dimensions */}
          <g className="text-slate-400 font-mono" stroke="#475569" strokeWidth={viewWidth * 0.0015} fill="currentColor">
            {/* Outer Dia Dim (Top) */}
            <line x1={-(D/2)} y1={-(D/2) - 10} x2={-(D/2)} y2={-(D/2) - 25} />
            <line x1={D/2} y1={-(D/2) - 10} x2={D/2} y2={-(D/2) - 25} />
            <line x1={-(D/2)} y1={-(D/2) - 18} x2={D/2} y2={-(D/2) - 18} />
            <polygon points={`${-(D/2)},${-(D/2)-18} ${-(D/2)+4},${-(D/2)-15} ${-(D/2)+4},${-(D/2)-21}`} fill="#475569" stroke="none"/>
            <polygon points={`${D/2},${-(D/2)-18} ${D/2-4},${-(D/2)-15} ${D/2-4},${-(D/2)-21}`} fill="#475569" stroke="none"/>
            <text x={0} y={-(D/2) - 22} fontSize={fontSize} textAnchor="middle" fill="#34d399" stroke="none">Ø{D}</text>

            {/* Inner Dia Dim (Bottom) */}
            {ID > 0 && (
              <>
                <line x1={-(ID/2)} y1={ID/2 + 10} x2={-(ID/2)} y2={D/2 + 25} />
                <line x1={ID/2} y1={ID/2 + 10} x2={ID/2} y2={D/2 + 25} />
                <line x1={-(ID/2)} y1={D/2 + 15} x2={ID/2} y2={D/2 + 15} />
                <polygon points={`${-(ID/2)},${D/2+15} ${-(ID/2)+4},${D/2+12} ${-(ID/2)+4},${D/2+18}`} fill="#475569" stroke="none"/>
                <polygon points={`${ID/2},${D/2+15} ${ID/2-4},${D/2+12} ${ID/2-4},${D/2+18}`} fill="#475569" stroke="none"/>
                <text x={0} y={D/2 + 15 + fontSize} fontSize={fontSize} textAnchor="middle" dominantBaseline="hanging" fill="#38bdf8" stroke="none">Ø{ID}</text>
              </>
            )}
          </g>
        </g>
      </svg>
    </div>
  );
}

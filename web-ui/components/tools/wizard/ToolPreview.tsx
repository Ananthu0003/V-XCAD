'use client';

import { useToolWizardStore } from '@/store/toolWizardStore';
import { useMemo } from 'react';

interface ToolPreviewProps {
  toolData?: any;
}

export function ToolPreview({ toolData: propToolData }: ToolPreviewProps = {}) {
  const store = useToolWizardStore();
  const toolData = propToolData || store.toolData;
  const { type, geometry, assembly } = toolData;

  // Check if we have the minimum required data to draw a tool
  const hasRequiredGeo = geometry?.diameter && geometry?.fluteLength;

  if (!hasRequiredGeo) {
    return (
      <div className="w-full h-full min-h-[350px] bg-slate-900 flex flex-col items-center justify-center p-4 relative text-center">
        <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'linear-gradient(#475569 1px, transparent 1px), linear-gradient(90deg, #475569 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>
        <p className="text-slate-500 font-medium z-10">Waiting for geometry data...</p>
        <p className="text-slate-600 text-xs mt-2 z-10 max-w-[200px]">Enter at least the diameter and flute length to view the live tool preview.</p>
      </div>
    );
  }

  const D = geometry.diameter;
  const FL = geometry.fluteLength;
  const OAL = geometry?.overallLength || Math.max(FL * 2.5, 50);
  const stickout = assembly?.stickoutLength || Math.max(FL * 1.5, OAL * 0.7);

  // View calculations
  const holderW = Math.max(D * 2.5, 25);
  const colletNutW = holderW * 0.8;
  const holderH = Math.max(D * 4, 40); // Realistic fixed holder height

  const viewWidth = Math.max(D * 6, 80); 
  
  // Calculate how much of the tool is hidden inside the holder
  const hiddenShankLength = Math.max(0, OAL - stickout);
  
  // topPadding must be large enough to show either the holder OR the hidden part of the tool
  const topPadding = Math.max(holderH, hiddenShankLength) * 1.2;

  // Dynamic font size based on view width so it scales gracefully
  const fontSize = Math.max(viewWidth * 0.05, 3);
  const bottomPadding = Math.max(40, fontSize * 4); // Extra space for the bottom diameter dimension
  const viewHeight = topPadding + stickout + bottomPadding;

  // Define realistic metallic gradients
  const gradients = (
    <defs>
      {/* Metallic Shank Gradient */}
      <linearGradient id="metal-shank" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#8c92a0" />
        <stop offset="20%" stopColor="#d1d5db" />
        <stop offset="50%" stopColor="#f3f4f6" />
        <stop offset="80%" stopColor="#9ca3af" />
        <stop offset="100%" stopColor="#6b7280" />
      </linearGradient>

      {/* Flute Base Gradient (darker metal) */}
      <linearGradient id="metal-flute" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#4b5563" />
        <stop offset="30%" stopColor="#9ca3af" />
        <stop offset="70%" stopColor="#6b7280" />
        <stop offset="100%" stopColor="#374151" />
      </linearGradient>

      {/* Holder Base (dark oxide) */}
      <linearGradient id="holder-base" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#1f2937" />
        <stop offset="50%" stopColor="#4b5563" />
        <stop offset="100%" stopColor="#111827" />
      </linearGradient>

      {/* Flute Helical Pattern (approximated with diagonal lines) */}
      <pattern id="helical-pattern" width={D} height={D * 1.5} patternUnits="userSpaceOnUse" patternTransform="rotate(30)">
        <rect width={D} height={D * 1.5} fill="url(#metal-flute)" />
        <path d={`M 0 0 L 0 ${D * 1.5}`} stroke="#374151" strokeWidth={D * 0.2} opacity="0.6" />
        <path d={`M ${D/2} 0 L ${D/2} ${D * 1.5}`} stroke="#9ca3af" strokeWidth={D * 0.1} opacity="0.4" />
      </pattern>
    </defs>
  );

  let tipPath = "";
  let bodyLength = FL;

  if (type === 'ball_nose' || type === 'ball_end_mill') {
    const r = D / 2;
    bodyLength = Math.max(0, FL - r);
    tipPath = `
      M ${-r} ${stickout - r}
      A ${r} ${r} 0 0 0 ${r} ${stickout - r}
      Z
    `;
  } else if ((type === 'bull_nose' || type === 'bull_nose_end_mill') && geometry?.cornerRadius) {
    const r = Math.min(geometry.cornerRadius, D / 2);
    bodyLength = Math.max(0, FL - r);
    tipPath = `
      M ${-D/2} ${stickout - r}
      A ${r} ${r} 0 0 0 ${-D/2 + r} ${stickout}
      L ${D/2 - r} ${stickout}
      A ${r} ${r} 0 0 0 ${D/2} ${stickout - r}
      Z
    `;
  } else if ((type === 'drill' || type === 'twist_drill' || type === 'spot_drill') && geometry?.pointAngle) {
    const angleRad = (geometry.pointAngle / 2) * (Math.PI / 180);
    const tipHeight = (D / 2) / Math.tan(angleRad);
    bodyLength = Math.max(0, FL - tipHeight);
    tipPath = `
      M ${-D/2} ${stickout - tipHeight}
      L 0 ${stickout}
      L ${D/2} ${stickout - tipHeight}
      Z
    `;
  } else if (type === 'chamfer_mill' && geometry?.includedAngle) {
    const angleRad = (geometry.includedAngle / 2) * (Math.PI / 180);
    const tipHeight = (D / 2) / Math.tan(angleRad);
    bodyLength = Math.max(0, FL - tipHeight);
    tipPath = `
      M ${-D/2} ${stickout - tipHeight}
      L 0 ${stickout}
      L ${D/2} ${stickout - tipHeight}
      Z
    `;
  } else {
    // Flat End Mill
    tipPath = `
      M ${-D/2} ${stickout - FL}
      L ${-D/2} ${stickout}
      L ${D/2} ${stickout}
      L ${D/2} ${stickout - FL}
      Z
    `;
    bodyLength = FL;
  }

  const fluteBodyPath = bodyLength > 0 ? `
    M ${-D/2} ${stickout - FL}
    L ${-D/2} ${stickout - (FL - bodyLength)}
    L ${D/2} ${stickout - (FL - bodyLength)}
    L ${D/2} ${stickout - FL}
    Z
  ` : "";

  const shankLength = Math.max(0, stickout - FL);
  const shankPath = `
    M ${-D/2} 0
    L ${-D/2} ${shankLength}
    L ${D/2} ${shankLength}
    L ${D/2} 0
    Z
  `;

  // Realistic Collet/Holder Visualization
  const colletNutPath = `
    M ${-colletNutW/2} 0
    L ${-colletNutW/2} ${-holderH * 0.2}
    L ${-holderW/2} ${-holderH * 0.3}
    L ${-holderW/2} ${-holderH}
    L ${holderW/2} ${-holderH}
    L ${holderW/2} ${-holderH * 0.3}
    L ${colletNutW/2} ${-holderH * 0.2}
    L ${colletNutW/2} 0
    Z
  `;

  return (
    <div className="w-full h-full min-h-[350px] bg-slate-900 flex items-center justify-center p-4 pt-[120px] relative">
      {/* Grid background for technical feel */}
      <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'linear-gradient(#475569 1px, transparent 1px), linear-gradient(90deg, #475569 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>
      
      <svg 
        viewBox={`${-viewWidth/2} ${-topPadding} ${viewWidth} ${viewHeight}`}
        className="w-full h-full drop-shadow-2xl z-10"
        style={{ transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)' }}
      >
        {gradients}
        <g style={{ transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)' }}>
          {/* Shank */}
          <path d={shankPath} fill="url(#metal-shank)" className="transition-all duration-400" />
          
          {/* Flute Body (Uses helical pattern) */}
          {bodyLength > 0 && (
             <path d={fluteBodyPath} fill="url(#helical-pattern)" className="transition-all duration-400" />
          )}

          {/* Tip */}
          {(type !== 'flat_end_mill' && type !== 'face_mill' && type !== 't_slot_cutter') && (
            <path d={tipPath} fill="url(#metal-flute)" className="transition-all duration-400" />
          )}

          {/* Holder / Collet Nut (Drawn LAST so it overlaps tool) */}
          <path d={colletNutPath} fill="url(#holder-base)" stroke="#374151" strokeWidth="1" className="transition-all duration-400" />
          {/* Collet Nut Details (Lines) */}
          <line x1={-holderW/2 + 4} y1={-topPadding * 1.3} x2={-holderW/2 + 4} y2={-topPadding * 0.7} stroke="#4b5563" strokeWidth="2" />
          <line x1={holderW/2 - 4} y1={-topPadding * 1.3} x2={holderW/2 - 4} y2={-topPadding * 0.7} stroke="#111827" strokeWidth="2" />
          {/* Dimension Annotations */}
          <g className="opacity-80" stroke="#94a3b8" strokeWidth={fontSize * 0.1} fontSize={fontSize} fontFamily="monospace" fill="#94a3b8">
            {/* Diameter dimension */}
            <line x1={-D/2} y1={stickout + (fontSize * 2.5)} x2={D/2} y2={stickout + (fontSize * 2.5)} />
            <line x1={-D/2} y1={stickout + (fontSize * 1)} x2={-D/2} y2={stickout + (fontSize * 3)} />
            <line x1={D/2} y1={stickout + (fontSize * 1)} x2={D/2} y2={stickout + (fontSize * 3)} />
            <text x={0} y={stickout + (fontSize * 2)} textAnchor="middle" fill="#cbd5e1">Ø{D.toFixed(1)}</text>

            {/* Stickout dimension line (Right Side) */}
            <line x1={D/2 + (fontSize * 1.5)} y1="0" x2={D/2 + (fontSize * 4)} y2="0" />
            <line x1={D/2 + (fontSize * 1.5)} y1={stickout} x2={D/2 + (fontSize * 4)} y2={stickout} />
            <line x1={D/2 + (fontSize * 2.5)} y1="0" x2={D/2 + (fontSize * 2.5)} y2={stickout} strokeDasharray={`${fontSize*0.5},${fontSize*0.5}`} />
            <text x={D/2 + (fontSize * 3.5)} y={stickout/2} transform={`rotate(-90 ${D/2 + (fontSize * 3.5)} ${stickout/2})`} textAnchor="middle" fill="#cbd5e1">S: {stickout.toFixed(1)}</text>

            {/* Flute length dimension */}
            {FL > 0 && (
              <>
                <line x1={-D/2 - (fontSize * 1.5)} y1={stickout - FL} x2={-D/2 - (fontSize * 4)} y2={stickout - FL} />
                <line x1={-D/2 - (fontSize * 1.5)} y1={stickout} x2={-D/2 - (fontSize * 4)} y2={stickout} />
                <line x1={-D/2 - (fontSize * 2.5)} y1={stickout - FL} x2={-D/2 - (fontSize * 2.5)} y2={stickout} strokeDasharray={`${fontSize*0.5},${fontSize*0.5}`} />
                <text x={-D/2 - (fontSize * 3.5)} y={stickout - (FL/2)} textAnchor="middle" transform={`rotate(-90 ${-D/2 - (fontSize * 3.5)} ${stickout - (FL/2)})`} fill="#cbd5e1">FL: {FL.toFixed(1)}</text>
              </>
            )}

            {/* OAL dimension */}
            {OAL > stickout && (
              <>
                {/* Hidden part of tool inside holder */}
                <path d={`M ${-D/2} 0 L ${-D/2} -${OAL - stickout} L ${D/2} -${OAL - stickout} L ${D/2} 0 Z`} fill="none" stroke="#64748b" strokeWidth={Math.max(0.5, D*0.05)} strokeDasharray="4,4" />
                
                {/* OAL Dimension lines */}
                <line x1={-D/2 - (fontSize * 6.5)} y1={stickout} x2={-D/2 - (fontSize * 9)} y2={stickout} />
                <line x1={-D/2 - (fontSize * 6.5)} y1={-(OAL - stickout)} x2={-D/2 - (fontSize * 9)} y2={-(OAL - stickout)} />
                <line x1={-D/2 - (fontSize * 7.5)} y1={-(OAL - stickout)} x2={-D/2 - (fontSize * 7.5)} y2={stickout} strokeDasharray={`${fontSize*0.5},${fontSize*0.5}`} />
                <text x={-D/2 - (fontSize * 8.5)} y={stickout - (OAL/2)} textAnchor="middle" transform={`rotate(-90 ${-D/2 - (fontSize * 8.5)} ${stickout - (OAL/2)})`} fill="#94a3b8">OAL: {OAL.toFixed(1)}</text>
              </>
            )}
          </g>
        </g>
      </svg>
      
      {/* Overlay data */}
      <div className="absolute top-4 left-4 text-xs font-mono text-slate-300 bg-slate-950/90 px-3 py-2 rounded border border-slate-700 shadow-xl backdrop-blur-md z-20">
        <div className="font-semibold text-white mb-1">Dimensions</div>
        <div>Dia: {D.toFixed(2)} {toolData.unit}</div>
        <div>Flute: {FL.toFixed(2)} {toolData.unit}</div>
        <div>OAL: {OAL.toFixed(2)} {toolData.unit}</div>
        <div>Stickout: {stickout.toFixed(2)} {toolData.unit}</div>
      </div>
    </div>
  );
}

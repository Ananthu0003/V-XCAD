'use client';

import { useToolWizardStore } from '@/store/toolWizardStore';

export function DepthCutsPreview() {
  const { toolData } = useToolWizardStore();
  const data = toolData.cuttingData || {} as any;
  
  const depthCutsEnabled = data.depthCutsEnabled !== false;
  const stepdown = parseFloat(data.stepdown) || 0;
  const finishCuts = parseInt(data.finishCuts) || 0;
  const finishStepdown = parseFloat(data.finishStepdown) || 0;
  const isStepup = data.depthCutDirection === 'stepup';

  // Render variables
  const slotW = 100;
  const slotD = 60; // Represents total depth of cut for visualization
  const pxPerMm = 6;
  const visualStep = stepdown > 0 ? stepdown * pxPerMm : 0;
  const visualFinishStep = finishStepdown > 0 ? finishStepdown * pxPerMm : 0;
  
  const roughLines: number[] = [];
  const finishLines: number[] = [];

  if (depthCutsEnabled) {
    let remainingD = slotD;
    
    // Calculate finish cuts
    if (finishCuts > 0 && visualFinishStep > 0) {
      const totalFinishD = finishCuts * visualFinishStep;
      remainingD = Math.max(0, slotD - totalFinishD);
      
      for (let i = 0; i < finishCuts; i++) {
        // If stepdown, finish cuts are at the bottom. If stepup, they are at the top (roof).
        if (isStepup) {
           finishLines.push((i) * visualFinishStep);
        } else {
           finishLines.push(remainingD + (i + 1) * visualFinishStep);
        }
      }
      
      if (isStepup) {
        remainingD = Math.max(0, slotD - totalFinishD); // Roughing happens below
      }
    }

    // Calculate rough cuts
    if (visualStep > 0 && remainingD > 0) {
       let currentY = visualStep;
       while (currentY < remainingD) {
         if (isStepup) {
           roughLines.push((finishCuts > 0 ? finishCuts * visualFinishStep : 0) + currentY);
         } else {
           roughLines.push(currentY);
         }
         currentY += visualStep;
       }
    }
  }

  const totalLines = roughLines.length + finishLines.length;

  return (
    <div className="w-full h-full min-h-[350px] bg-[#e5e5e5] flex flex-col items-center justify-center p-4 relative">
      <div className="absolute top-4 left-4 text-xs font-medium text-slate-500 uppercase tracking-wider">
        Depth Cuts Preview
      </div>
      
      <svg width="240" height="200" viewBox="0 0 240 200" className="drop-shadow-lg">
        {/* Main Block (Gray) */}
        <path 
          d={`
            M 20 20 
            L 220 20 
            L 220 160 
            L 20 160 
            Z
          `} 
          fill="#a3a3a3" 
          stroke="#525252" 
          strokeWidth="2"
        />
        
        {/* Cut Slot */}
        <path 
          d={`
            M ${120 - slotW/2} 20
            L ${120 - slotW/2} ${20 + slotD}
            L ${120 + slotW/2} ${20 + slotD}
            L ${120 + slotW/2} 20
            Z
          `}
          fill="#e5e5e5"
          stroke="#525252"
          strokeWidth="2"
        />

        {/* Rough Lines */}
        {roughLines.map((yOffset, i) => (
          <line 
            key={`r-${i}`}
            x1={120 - slotW/2} 
            y1={20 + yOffset} 
            x2={120 + slotW/2} 
            y2={20 + yOffset} 
            stroke="#3b82f6" 
            strokeWidth="3"
            opacity={0.8}
          />
        ))}

        {/* Finish Lines */}
        {finishLines.map((yOffset, i) => (
          <line 
            key={`f-${i}`}
            x1={120 - slotW/2} 
            y1={20 + yOffset} 
            x2={120 + slotW/2} 
            y2={20 + yOffset} 
            stroke="#06b6d4" // slightly different blue/cyan for finish
            strokeWidth="1.5"
            opacity={0.9}
          />
        ))}

        {/* Dimension Callout for Stepdown */}
        {depthCutsEnabled && roughLines.length > 0 && visualStep < slotD && (
          <g>
            <line x1={120 + slotW/2 + 5} y1={20 + (isStepup ? (finishCuts*visualFinishStep) : 0)} x2={120 + slotW/2 + 25} y2={20 + (isStepup ? (finishCuts*visualFinishStep) : 0)} stroke="#525252" strokeWidth="1" />
            <line x1={120 + slotW/2 + 5} y1={20 + (isStepup ? (finishCuts*visualFinishStep) : 0) + visualStep} x2={120 + slotW/2 + 25} y2={20 + (isStepup ? (finishCuts*visualFinishStep) : 0) + visualStep} stroke="#525252" strokeWidth="1" />
            
            {/* Arrows */}
            {isStepup ? (
              // Stepup Arrows pointing up
              <>
                <path d={`M ${120 + slotW/2 + 15} ${20 + (finishCuts*visualFinishStep)} L ${120 + slotW/2 + 12} ${30 + (finishCuts*visualFinishStep)} L ${120 + slotW/2 + 18} ${30 + (finishCuts*visualFinishStep)} Z`} fill="#525252" />
                <path d={`M ${120 + slotW/2 + 15} ${20 + (finishCuts*visualFinishStep) + visualStep} L ${120 + slotW/2 + 12} ${10 + (finishCuts*visualFinishStep) + visualStep} L ${120 + slotW/2 + 18} ${10 + (finishCuts*visualFinishStep) + visualStep} Z`} fill="#525252" />
              </>
            ) : (
              // Stepdown Arrows pointing down
              <>
                <path d={`M ${120 + slotW/2 + 15} 20 L ${120 + slotW/2 + 12} 10 L ${120 + slotW/2 + 18} 10 Z`} fill="#525252" />
                <path d={`M ${120 + slotW/2 + 15} ${20 + visualStep} L ${120 + slotW/2 + 12} ${30 + visualStep} L ${120 + slotW/2 + 18} ${30 + visualStep} Z`} fill="#525252" />
              </>
            )}
            
            {/* Connecting line */}
            <line x1={120 + slotW/2 + 15} y1={10 + (isStepup ? (finishCuts*visualFinishStep) : 0)} x2={120 + slotW/2 + 15} y2={30 + (isStepup ? (finishCuts*visualFinishStep) : 0) + visualStep} stroke="#525252" strokeWidth="1" />
          </g>
        )}
      </svg>
      
      <div className="absolute bottom-4 left-0 right-0 text-center text-sm text-slate-500 font-medium">
        {!depthCutsEnabled ? 'Depth Cuts Disabled' : `${totalLines} Total Cut(s)`}
      </div>
    </div>
  );
}

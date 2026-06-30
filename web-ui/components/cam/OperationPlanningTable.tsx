import React from 'react';
import { CamOperation } from '../../types/cam';

interface OperationPlanningTableProps {
    operations: CamOperation[];
    camValidation?: any;
}

export const OperationPlanningTable: React.FC<OperationPlanningTableProps> = ({ operations, camValidation }) => {
    return (
        <div className="overflow-x-auto w-full flex flex-col gap-4">
            {camValidation && !camValidation.featureCoveragePassed && (
                <div className="bg-red-500/10 border border-red-500/50 p-4 rounded-lg">
                    <h4 className="text-red-400 font-bold mb-2">Feature Coverage Failed</h4>
                    <p className="text-sm text-red-300">
                        {camValidation.missingDecisionFeatures?.length || 0} features have no manufacturing decision.
                        G-Code generation is blocked until all features are addressed.
                    </p>
                </div>
            )}
            <table className="min-w-full bg-gray-900 border border-gray-700 text-sm text-left">
                <thead className="bg-gray-800 text-gray-300">
                    <tr>
                        <th className="py-2 px-4 border-b border-gray-700 font-semibold">Feature</th>
                        <th className="py-2 px-4 border-b border-gray-700 font-semibold">Operation</th>
                        <th className="py-2 px-4 border-b border-gray-700 font-semibold">Selected Tool</th>
                        <th className="py-2 px-4 border-b border-gray-700 font-semibold">Status</th>
                        <th className="py-2 px-4 border-b border-gray-700 font-semibold">Reason</th>
                        <th className="py-2 px-4 border-b border-gray-700 font-semibold">Recommendation</th>
                    </tr>
                </thead>
                <tbody className="text-gray-300 divide-y divide-gray-800">
                    {operations.map(op => {
                        const statusColor = 
                            op.status === 'ready' ? 'text-green-400 bg-green-400/10' :
                            op.status === 'warning' ? 'text-yellow-400 bg-yellow-400/10' :
                            (op.status === 'blocked' || op.status === 'unsupported' || op.status === 'error') ? 'text-red-400 bg-red-400/10' :
                            'text-gray-400 bg-gray-400/10';

                        const displayStatus = op.status === 'unsupported' && op.type === 'turning_required' ? 'REQUIRES TURNING' : op.status;

                        return (
                            <tr key={op.id} className="hover:bg-gray-800/50 transition-colors">
                                <td className="py-2 px-4 align-top">
                                    {op.feature_id || 'Unknown Feature'}
                                </td>
                                <td className="py-2 px-4 align-top font-mono">
                                    {op.name || op.type}
                                </td>
                                <td className="py-2 px-4 align-top text-xs">
                                    {op.toolId}
                                    {op.parameters.tool_selection_reason && (
                                        <div className="text-gray-500 mt-1">{op.parameters.tool_selection_reason}</div>
                                    )}
                                </td>
                                <td className="py-2 px-4 align-top">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium uppercase tracking-wider ${statusColor}`}>
                                        {displayStatus}
                                    </span>
                                </td>
                                <td className="py-2 px-4 align-top text-xs max-w-xs text-gray-400">
                                    {op.parameters.errorReason || op.parameters.error || '-'}
                                </td>
                                <td className="py-2 px-4 align-top text-xs text-blue-400">
                                    {op.parameters.recommended_machine || '-'}
                                </td>
                            </tr>
                        );
                    })}
                    {operations.length === 0 && (
                        <tr>
                            <td colSpan={6} className="py-8 text-center text-gray-500">
                                No operations generated. Click "Auto Generate Operations".
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
            
            {camValidation && (
                <div className="flex justify-end text-xs text-gray-400 gap-4 pb-2">
                    <span>{camValidation.readyOperations || 0} Ready</span>
                    <span>·</span>
                    <span>{camValidation.warningOperations || 0} Warning</span>
                    <span>·</span>
                    <span>{(camValidation.blockedOperations || 0) + (camValidation.errorOperations || 0)} Blocked/Error</span>
                    <span>·</span>
                    <span>{camValidation.unsupportedFeatures?.length || 0} Unsupported</span>
                </div>
            )}
        </div>
    );
};

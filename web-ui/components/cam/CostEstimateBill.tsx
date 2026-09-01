'use client';

import React, { useState, useMemo } from 'react';
import { Copy, Check, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import type { CostEstimateResult, Tool, SetupSettings } from '@/types/cam';
import { getMaterialLabel } from '@/lib/cam/materialProfiles';

interface CostEstimateBillProps {
    costEstimate: CostEstimateResult;
    setup?: SetupSettings;
    tools?: Tool[];
    profitMargin?: number;
    onProfitMarginChange?: (margin: number) => void;
}

export function fmtCurrency(currency: string, value?: number): string {
    if (value == null || isNaN(value)) return '—';
    try {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currency || 'INR',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(value);
    } catch {
        return `${currency || '₹'} ${value.toFixed(2)}`;
    }
}

export function fmtMass(massKg?: number): string {
    if (massKg == null || isNaN(massKg) || massKg <= 0) return '';
    if (massKg < 0.01) {
        const g = massKg * 1000;
        return `${g < 0.1 ? g.toFixed(3) : g < 1 ? g.toFixed(2) : g.toFixed(1)} g`;
    }
    if (massKg < 1) {
        return `${massKg.toFixed(3)} kg`;
    }
    return `${massKg.toFixed(2)} kg`;
}

export function CostEstimateBill({ costEstimate, setup, profitMargin, onProfitMarginChange }: CostEstimateBillProps) {
    const [copied, setCopied] = useState(false);
    
    // Default profit margin is 15% (or backend recommended margin)
    const initialMargin = (costEstimate.selling_price?.margin_pct != null)
        ? Math.round(costEstimate.selling_price.margin_pct * 100)
        : 15;
    const [internalMargin, setInternalMargin] = useState<number>(initialMargin);
    
    const marginPercent = profitMargin !== undefined ? profitMargin : internalMargin;
    const updateMarginPercent = (val: number | ((prev: number) => number)) => {
        const nextVal = typeof val === 'function' ? val(marginPercent) : val;
        if (onProfitMarginChange) {
            onProfitMarginChange(nextVal);
        } else {
            setInternalMargin(nextVal);
        }
    };

    const currency = costEstimate.currency || 'INR';
    const mfgCost = costEstimate.manufacturing_cost?.per_part || 0;

    // Resolve accurate material display name
    const materialName = useMemo(() => {
        const rawId = setup?.workpieceMaterialId || setup?.material || (costEstimate.material as any)?.name || (costEstimate.material as any)?.material_name || (costEstimate.material as any)?.alloy || (costEstimate.material as any)?.material_id;
        if (rawId) {
            return getMaterialLabel(rawId);
        }
        return 'Tool Steel H13';
    }, [setup?.workpieceMaterialId, setup?.material, costEstimate.material]);

    // Real-time calculation based on user-selected profit margin
    const { profit, sellingPrice } = useMemo(() => {
        const validMargin = Math.max(0, Math.min(95, isNaN(marginPercent) ? 0 : marginPercent));
        const decimal = validMargin / 100;
        
        const calculatedSellingPrice = decimal < 1 && mfgCost > 0
            ? mfgCost / (1 - decimal)
            : mfgCost * (1 + decimal);
            
        const calculatedProfit = Math.max(0, calculatedSellingPrice - mfgCost);

        return {
            profit: calculatedProfit,
            sellingPrice: calculatedSellingPrice,
        };
    }, [marginPercent, mfgCost]);

    const handleCopy = () => {
        const massStr = fmtMass(costEstimate.material?.mass_kg);
        const text = `
VEXCAD Cost Estimation
-----------------------
Material (${materialName}${massStr ? ` · ${massStr}` : ''}): ${fmtCurrency(currency, costEstimate.material?.cost)}
Machining: ${fmtCurrency(currency, costEstimate.machining?.cost)}
Setup / Fixturing: ${fmtCurrency(currency, costEstimate.manufacturing_cost?.setup_cost)}
Tooling: ${fmtCurrency(currency, costEstimate.tooling?.total)}
Energy: ${fmtCurrency(currency, costEstimate.energy?.cost)}
-----------------------
Manufacturing Cost: ${fmtCurrency(currency, mfgCost)}
Profit Margin (${marginPercent}%): ${fmtCurrency(currency, profit)}
TOTAL QUOTE: ${fmtCurrency(currency, sellingPrice)}
`.trim();

        navigator.clipboard.writeText(text);
        setCopied(true);
        toast.success('Quote copied to clipboard');
        setTimeout(() => setCopied(false), 2000);
    };

    if (costEstimate.status === 'incomplete') {
        return (
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-500 text-xs flex items-center gap-2">
                <AlertTriangle className="size-4 shrink-0" />
                <span>Cost estimation unavailable for current configuration.</span>
            </div>
        );
    }

    return (
        <div className="rounded-xl border border-slate-200/90 dark:border-white/10 bg-white/70 dark:bg-white/[0.02] p-4 flex flex-col gap-3 shadow-xs">
            {/* Header: Clean title & dynamically recalculated price */}
            <div className="flex items-start justify-between">
                <div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-muted-foreground block">
                        Estimated Cost
                    </span>
                    <div className="text-2xl font-black tracking-tight text-slate-900 dark:text-white font-mono mt-0.5">
                        {fmtCurrency(currency, sellingPrice)}
                    </div>
                </div>

                <button
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-gray-300 text-[10px] font-semibold transition-all cursor-pointer shadow-2xs"
                    title="Copy Quote"
                >
                    {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
            </div>

            {/* Simple Clean Line Items */}
            <div className="flex flex-col gap-2 pt-2 border-t border-slate-200/80 dark:border-white/5 text-[11px]">
                {/* Material */}
                <div className="flex justify-between items-start text-slate-600 dark:text-gray-300">
                    <div className="flex items-start gap-1.5 min-w-0 pr-2">
                        <span className="size-1.5 rounded-full bg-emerald-500 shrink-0 mt-1" />
                        <div className="flex flex-col min-w-0">
                            <span className="font-medium text-slate-800 dark:text-slate-200">Raw Material</span>
                            <span className="text-[10px] text-muted-foreground font-mono leading-tight">
                                {materialName}{fmtMass(costEstimate.material?.mass_kg) ? ` · ${fmtMass(costEstimate.material?.mass_kg)}` : ''}
                            </span>
                        </div>
                    </div>
                    <span className="font-mono font-medium text-slate-900 dark:text-foreground shrink-0">
                        {fmtCurrency(currency, costEstimate.material?.cost)}
                    </span>
                </div>

                {/* Machining */}
                <div className="flex justify-between items-start text-slate-600 dark:text-gray-300">
                    <div className="flex items-start gap-1.5 min-w-0 pr-2">
                        <span className="size-1.5 rounded-full bg-blue-500 shrink-0 mt-1" />
                        <div className="flex flex-col min-w-0">
                            <span className="font-medium text-slate-800 dark:text-slate-200">Machining</span>
                            {costEstimate.machining?.total_time_s ? (
                                <span className="text-[10px] text-muted-foreground font-mono leading-tight">
                                    Cycle Time: {(costEstimate.machining.total_time_s / 60).toFixed(1)} min
                                </span>
                            ) : null}
                        </div>
                    </div>
                    <span className="font-mono font-medium text-slate-900 dark:text-foreground shrink-0">
                        {fmtCurrency(currency, costEstimate.machining?.cost)}
                    </span>
                </div>

                {/* Setup */}
                <div className="flex justify-between items-start text-slate-600 dark:text-gray-300">
                    <div className="flex items-start gap-1.5 min-w-0 pr-2">
                        <span className="size-1.5 rounded-full bg-amber-500 shrink-0 mt-1" />
                        <div className="flex flex-col min-w-0">
                            <span className="font-medium text-slate-800 dark:text-slate-200">Setup & Fixturing</span>
                            <span className="text-[10px] text-muted-foreground font-mono leading-tight">
                                1-off batch setup
                            </span>
                        </div>
                    </div>
                    <span className="font-mono font-medium text-slate-900 dark:text-foreground shrink-0">
                        {fmtCurrency(currency, costEstimate.manufacturing_cost?.setup_cost)}
                    </span>
                </div>

                {/* Tooling */}
                {costEstimate.tooling && costEstimate.tooling.total > 0 && (
                    <div className="flex justify-between items-start text-slate-600 dark:text-gray-300">
                        <div className="flex items-start gap-1.5 min-w-0 pr-2">
                            <span className="size-1.5 rounded-full bg-purple-500 shrink-0 mt-1" />
                            <div className="flex flex-col min-w-0">
                                <span className="font-medium text-slate-800 dark:text-slate-200">Tooling Wear</span>
                                <span className="text-[10px] text-muted-foreground font-mono leading-tight">
                                    {costEstimate.tooling.items?.length || 0} active tools
                                </span>
                            </div>
                        </div>
                        <span className="font-mono font-medium text-slate-900 dark:text-foreground shrink-0">
                            {fmtCurrency(currency, costEstimate.tooling.total)}
                        </span>
                    </div>
                )}

                {/* Energy */}
                {costEstimate.energy && costEstimate.energy.cost > 0 && (
                    <div className="flex justify-between items-start text-slate-600 dark:text-gray-300">
                        <div className="flex items-start gap-1.5 min-w-0 pr-2">
                            <span className="size-1.5 rounded-full bg-cyan-500 shrink-0 mt-1" />
                            <div className="flex flex-col min-w-0">
                                <span className="font-medium text-slate-800 dark:text-slate-200">Energy</span>
                                <span className="text-[10px] text-muted-foreground font-mono leading-tight">
                                    {costEstimate.energy.avg_power_kw} kW power draw
                                </span>
                            </div>
                        </div>
                        <span className="font-mono font-medium text-slate-900 dark:text-foreground shrink-0">
                            {fmtCurrency(currency, costEstimate.energy.cost)}
                        </span>
                    </div>
                )}
            </div>

            {/* Total Summary Footer with Seamless Inline Margin Input */}
            <div className="pt-2 border-t border-slate-200/80 dark:border-white/5 flex flex-col gap-1.5 text-[11px]">
                <div className="flex justify-between items-center text-slate-500 dark:text-muted-foreground text-[10px]">
                    <span>Manufacturing Subtotal</span>
                    <span className="font-mono font-medium text-slate-700 dark:text-gray-300">{fmtCurrency(currency, mfgCost)}</span>
                </div>

                {/* Inline Editable Margin Row */}
                <div className="flex justify-between items-center text-emerald-600 dark:text-emerald-400">
                    <div className="flex items-center gap-1.5">
                        <span className="font-medium text-[10px]">Profit Margin</span>
                        <div className="flex items-center gap-0.5 bg-emerald-500/10 dark:bg-emerald-500/15 border border-emerald-500/30 rounded px-1.5 py-0.5">
                            <input
                                type="number"
                                min={0}
                                max={95}
                                value={marginPercent}
                                onChange={(e) => {
                                    const val = parseInt(e.target.value, 10);
                                    updateMarginPercent(isNaN(val) ? 0 : Math.max(0, Math.min(95, val)));
                                }}
                                className="w-7 text-center font-mono font-bold text-[11px] bg-transparent text-emerald-700 dark:text-emerald-300 focus:outline-none p-0 appearance-none"
                            />
                            <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300">%</span>
                        </div>
                    </div>
                    <span className="font-mono font-semibold text-[11px]">
                        +{fmtCurrency(currency, profit)}
                    </span>
                </div>

                {/* Final Total Per Unit */}
                <div className="flex justify-between items-baseline pt-1.5 border-t border-dashed border-slate-200 dark:border-white/10 font-bold">
                    <span className="text-slate-900 dark:text-white text-xs">Total / Unit</span>
                    <span className="text-base font-mono text-emerald-600 dark:text-emerald-400">{fmtCurrency(currency, sellingPrice)}</span>
                </div>
            </div>
        </div>
    );
}

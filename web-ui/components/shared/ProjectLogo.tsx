'use client';

import React from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';

export interface ProjectLogoProps {
	size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number;
	className?: string;
	imageClassName?: string;
	showGlow?: boolean;
	priority?: boolean;
}

const SIZE_MAP = {
	xs: 18,
	sm: 24,
	md: 32,
	lg: 44,
	xl: 56,
};

export function ProjectLogo({
	size = 'md',
	className,
	imageClassName,
	showGlow = false,
	priority = false,
}: ProjectLogoProps) {
	const pixelSize = typeof size === 'number' ? size : SIZE_MAP[size] || 32;

	return (
		<div
			className={cn(
				'relative inline-flex items-center justify-center shrink-0 select-none',
				className
			)}
			style={{ width: pixelSize, height: pixelSize }}
		>
			{showGlow && (
				<div
					className="absolute inset-0 rounded-lg bg-cyan-500/30 blur-md pointer-events-none transform scale-110"
					aria-hidden="true"
				/>
			)}
			<Image
				src="/logo.png"
				alt="VΞXCAD Logo"
				width={pixelSize * 2}
				height={pixelSize * 2}
				priority={priority}
				className={cn(
					'object-contain rounded-[6px] drop-shadow-[0_2px_10px_rgba(14,165,233,0.3)] transition-transform duration-200 group-hover:scale-105',
					imageClassName
				)}
				style={{ width: pixelSize, height: pixelSize }}
			/>
		</div>
	);
}

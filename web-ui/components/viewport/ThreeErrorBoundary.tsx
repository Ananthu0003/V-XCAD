'use client';

import React, { Component, ReactNode, ErrorInfo } from 'react';

export interface ThreeErrorBoundaryProps {
	children: ReactNode;
	fallback?: ReactNode;
	onError?: (error: Error) => void;
	resetKey?: any;
}

interface State {
	hasError: boolean;
	error: Error | null;
}

/**
 * An ErrorBoundary designed specifically for use INSIDE @react-three/fiber Canvas.
 * Because standard HTML (<div>, <p>, etc.) cannot be rendered inside the Three.js reconciler,
 * fallback MUST be a valid Three.js element (or null / <group />).
 */
export class ThreeErrorBoundary extends Component<ThreeErrorBoundaryProps, State> {
	constructor(props: ThreeErrorBoundaryProps) {
		super(props);
		this.state = { hasError: false, error: null };
	}

	static getDerivedStateFromError(error: Error): State {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, errorInfo: ErrorInfo) {
		console.warn('[ThreeErrorBoundary] Caught 3D render/loader error:', error?.message || error);
		this.props.onError?.(error);
	}

	componentDidUpdate(prevProps: ThreeErrorBoundaryProps) {
		if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
			this.setState({ hasError: false, error: null });
		}
	}

	render() {
		if (this.state.hasError) {
			return this.props.fallback ?? null;
		}
		return this.props.children;
	}
}

export interface CanvasRootErrorBoundaryProps {
	children: ReactNode;
	fallback?: ReactNode;
}

/**
 * Standard HTML Error Boundary to wrap around the entire <Canvas> element
 * to prevent uncaught WebGL / Fiber exceptions from crashing the parent page.
 */
export class CanvasRootErrorBoundary extends Component<CanvasRootErrorBoundaryProps, State> {
	constructor(props: CanvasRootErrorBoundaryProps) {
		super(props);
		this.state = { hasError: false, error: null };
	}

	static getDerivedStateFromError(error: Error): State {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, errorInfo: ErrorInfo) {
		console.error('[CanvasRootErrorBoundary] Canvas crashed:', error, errorInfo);
	}

	render() {
		if (this.state.hasError) {
			return this.props.fallback ?? (
				<div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 backdrop-blur text-slate-400 text-xs p-4 text-center">
					Failed to render 3D Viewport. Please refresh or load another session.
				</div>
			);
		}
		return this.props.children;
	}
}

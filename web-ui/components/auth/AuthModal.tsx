import { useState } from 'react';

type AuthModalProps = {
	isOpen: boolean;
	onClose: () => void;
	developerUsername: string;
	developerPassword: string;
	developerAuthError: string | null;
	onDeveloperUsernameChange: (val: string) => void;
	onDeveloperPasswordChange: (val: string) => void;
	onDeveloperLogin: () => void;
};

export function AuthModal({
	isOpen,
	onClose,
	developerUsername,
	developerPassword,
	developerAuthError,
	onDeveloperUsernameChange,
	onDeveloperPasswordChange,
	onDeveloperLogin,
}: AuthModalProps) {
	if (!isOpen) return null;

	return (
		<div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm">
			<div className="w-full max-w-sm rounded-3xl border border-border bg-background p-8 shadow-2xl relative">
				<button 
					onClick={onClose}
					className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
				>
					<svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
				<div className="mb-6 flex items-center justify-center gap-3">
					<div className="size-2 rounded-full bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.5)]" />
					<div>
						<h2 className="text-sm font-black uppercase tracking-[0.35em] text-foreground">Admin Login</h2>
						<p className="mt-2 text-[11px] leading-6 text-muted-foreground">Enter credentials to unlock CAD engine.</p>
					</div>
				</div>
				<input
					value={developerUsername}
					onChange={(e) => onDeveloperUsernameChange(e.target.value)}
					placeholder="Admin username"
					className="mb-4 w-full rounded-2xl border border-border bg-accent px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
				/>
				<input
					value={developerPassword}
					onChange={(e) => onDeveloperPasswordChange(e.target.value)}
					placeholder="Admin password"
					type="password"
					className="mb-4 w-full rounded-2xl border border-border bg-accent px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
					onKeyDown={(e) => {
						if (e.key === 'Enter') onDeveloperLogin();
					}}
				/>
				<button
					onClick={onDeveloperLogin}
					className="w-full rounded-2xl bg-blue-600 px-4 py-3 text-sm font-bold uppercase tracking-[0.2em] text-white hover:bg-blue-500 transition-colors"
				>
					Unlock Code
				</button>
				{developerAuthError ? (
					<p className="mt-4 text-center text-xs font-bold uppercase tracking-[0.2em] text-rose-500">{developerAuthError}</p>
				) : null}
			</div>
		</div>
	);
}

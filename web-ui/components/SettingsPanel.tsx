'use client';

import { X, Sun, Moon, Monitor, LogOut, Loader2, User, Palette, KeyRound, Check, ChevronRight, Shield } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

type SettingsPanelProps = {
	isOpen: boolean;
	onClose: () => void;
	user: { name?: string; email?: string } | null;
};

export function SettingsPanel({ isOpen, onClose, user }: SettingsPanelProps) {
	const { theme, setTheme } = useTheme();
	const router = useRouter();
	const [isLoggingOut, setIsLoggingOut] = useState(false);
	const [displayName, setDisplayName] = useState(user?.name ?? '');
	const [isSaving, setIsSaving] = useState(false);
	const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
	const [mounted, setMounted] = useState(false);

	useEffect(() => { setMounted(true); }, []);
	useEffect(() => { setDisplayName(user?.name ?? ''); }, [user]);

	const handleLogout = async () => {
		setIsLoggingOut(true);
		try {
			await fetch('/api/auth/logout', { method: 'POST' });
			router.push('/');
			router.refresh();
		} finally {
			setIsLoggingOut(false);
		}
	};

	const handleSaveName = async () => {
		if (!displayName.trim() || displayName.trim() === user?.name) return;
		setIsSaving(true);
		setSaveState('idle');
		try {
			const res = await fetch('/api/auth/profile', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: displayName.trim() }),
			});
			setSaveState(res.ok ? 'saved' : 'error');
			setTimeout(() => setSaveState('idle'), 2500);
		} catch {
			setSaveState('error');
		} finally {
			setIsSaving(false);
		}
	};

	const initials = user?.name
		? user.name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
		: '??';

	const themes = [
		{ value: 'light',  label: 'Light',  icon: Sun },
		{ value: 'dark',   label: 'Dark',   icon: Moon },
		{ value: 'system', label: 'System', icon: Monitor },
	] as const;

	return (
		<>
			{/* Backdrop */}
			<div
				className={`fixed inset-0 z-50 transition-all duration-300 ${
					isOpen
						? 'bg-black/50 backdrop-blur-[2px] pointer-events-auto'
						: 'bg-transparent backdrop-blur-none pointer-events-none'
				}`}
				onClick={onClose}
			/>

			{/* Slide-over */}
			<div
				className={`fixed top-0 left-0 h-full z-[60] w-[360px] flex flex-col transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
					bg-white dark:bg-[#0d0f14]
					border-r border-zinc-200 dark:border-white/[0.07]
					shadow-[24px_0_80px_rgba(0,0,0,0.125)]
					${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
			>
				{/* ── Top gradient accent bar ── */}
				<div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-blue-500 via-cyan-400 to-violet-500" />

				{/* ── Header ── */}
				<div className="flex items-center justify-between px-6 pt-7 pb-5">
					<div>
						<h2 className="text-base font-bold text-zinc-900 dark:text-white tracking-tight">Settings</h2>
						<p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">Manage your workspace preferences</p>
					</div>
					<button
						onClick={onClose}
						className="flex items-center justify-center size-8 rounded-full bg-zinc-100 dark:bg-white/[0.06] hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-white transition-all duration-150 cursor-pointer"
					>
						<X className="size-3.5" />
					</button>
				</div>

				{/* ── Scrollable body ── */}
				<div className="flex-1 overflow-y-auto px-6 pb-6 space-y-7 custom-scrollbar">

					{/* ──────── PROFILE ──────── */}
					<section>
						<div className="flex items-center gap-2 mb-4">
							<div className="size-1.5 rounded-full bg-blue-500" />
							<span className="text-[10px] font-bold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Profile</span>
						</div>

						{/* User card */}
						<div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-zinc-100 to-zinc-50 dark:from-white/[0.05] dark:to-white/[0.02] border border-zinc-200 dark:border-white/[0.08] p-4">
							{/* Subtle glow behind avatar */}
							<div className="absolute top-0 left-0 w-24 h-24 bg-blue-500/10 rounded-full blur-2xl -translate-x-1/2 -translate-y-1/2 pointer-events-none" />
							<div className="relative flex items-center gap-4">
								{/* Avatar */}
								<div className="relative shrink-0">
									<div className="size-12 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white font-black text-sm shadow-[0_0_20px_rgba(59,130,246,0.2)]">
										{initials}
									</div>
									<div className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full bg-emerald-500 border-2 border-white dark:border-[#0d0f14] shadow-sm" />
								</div>
								{/* Info */}
								<div className="min-w-0 flex-1">
									<div className="text-sm font-bold text-zinc-900 dark:text-white truncate">
										{user?.name || 'Anonymous User'}
									</div>
									{user?.email && (
										<div className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate font-mono mt-0.5">
											{user.email}
										</div>
									)}
								</div>
								<div className="shrink-0 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[9px] font-bold text-emerald-500 uppercase tracking-wider">
									Active
								</div>
							</div>
						</div>

						{/* Display name input */}
						<div className="mt-4 space-y-2">
							<label className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
								<User className="size-3" />
								Display Name
							</label>
							<div className="flex gap-2">
								<div className="relative flex-1">
									<input
										type="text"
										value={displayName}
										onChange={e => setDisplayName(e.target.value)}
										onKeyDown={e => e.key === 'Enter' && handleSaveName()}
										placeholder="Your name"
										className="w-full px-3.5 py-2.5 text-sm rounded-xl
											bg-zinc-100 dark:bg-white/[0.05]
											border border-zinc-200 dark:border-white/[0.08]
											text-zinc-900 dark:text-white
											placeholder:text-zinc-400 dark:placeholder:text-zinc-600
											focus:outline-none focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/15
											transition-all duration-150"
									/>
								</div>
								<button
									onClick={handleSaveName}
									disabled={isSaving || !displayName.trim() || displayName.trim() === user?.name}
									className={`px-4 py-2.5 text-xs font-bold rounded-xl transition-all duration-200 flex items-center gap-1.5 shrink-0 cursor-pointer
										${saveState === 'saved'
											? 'bg-emerald-500 text-white shadow-[0_0_16px_rgba(16,185,129,0.2)]'
											: saveState === 'error'
											? 'bg-red-500 text-white'
											: 'bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_16px_rgba(59,130,246,0.175)] hover:shadow-[0_0_20px_rgba(59,130,246,0.25)]'
										}
										disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none`}
								>
									{isSaving
										? <Loader2 className="size-3.5 animate-spin" />
										: saveState === 'saved'
										? <><Check className="size-3.5" /> Saved</>
										: 'Save'}
								</button>
							</div>
						</div>
					</section>

					{/* ──────── APPEARANCE ──────── */}
					<section>
						<div className="flex items-center gap-2 mb-4">
							<div className="size-1.5 rounded-full bg-violet-500" />
							<span className="text-[10px] font-bold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Appearance</span>
						</div>

						{mounted && (
							<div className="grid grid-cols-3 gap-2 p-1.5 rounded-2xl bg-zinc-100 dark:bg-white/[0.04] border border-zinc-200 dark:border-white/[0.06]">
								{themes.map(({ value, label, icon: Icon }) => {
									const active = theme === value;
									return (
										<button
											key={value}
											onClick={() => setTheme(value)}
											className={`relative flex flex-col items-center gap-2 py-3.5 px-2 rounded-xl transition-all duration-200 cursor-pointer
												${active
													? 'bg-white dark:bg-white/10 shadow-[0_2px_12px_rgba(0,0,0,0.05)] dark:shadow-[0_2px_12px_rgba(0,0,0,0.2)] text-blue-500 dark:text-blue-400'
													: 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300'
												}`}
										>
											<Icon className={`size-4 transition-all duration-200 ${active ? 'scale-110' : ''}`} />
											<span className={`text-[10px] font-bold tracking-wide transition-colors ${active ? 'text-zinc-900 dark:text-white' : ''}`}>
												{label}
											</span>
											{active && (
												<div className="absolute top-2 right-2 size-1.5 rounded-full bg-blue-500" />
											)}
										</button>
									);
								})}
							</div>
						)}
					</section>

					{/* ──────── ACCOUNT ──────── */}
					<section>
						<div className="flex items-center gap-2 mb-4">
							<div className="size-1.5 rounded-full bg-amber-500" />
							<span className="text-[10px] font-bold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Account</span>
						</div>

						<div className="space-y-2">
							{/* Security info row */}
							<div className="flex items-center justify-between px-4 py-3 rounded-xl bg-zinc-100 dark:bg-white/[0.03] border border-zinc-200 dark:border-white/[0.06]">
								<div className="flex items-center gap-3">
									<div className="size-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
										<Shield className="size-3.5 text-emerald-500" />
									</div>
									<div>
										<div className="text-[12px] font-semibold text-zinc-700 dark:text-zinc-300">Authenticated Session</div>
										<div className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono mt-0.5">JWT · Secure</div>
									</div>
								</div>
								<div className="size-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.3)]" />
							</div>

							{/* Sign out */}
							<button
								onClick={handleLogout}
								disabled={isLoggingOut}
								className="group w-full flex items-center justify-between px-4 py-3.5 rounded-xl
									bg-red-500/5 dark:bg-red-500/[0.06]
									border border-red-200 dark:border-red-500/20
									hover:bg-red-500/10 hover:border-red-400 dark:hover:border-red-500/40
									transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
							>
								<div className="flex items-center gap-3">
									<div className="size-8 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center group-hover:bg-red-500/20 transition-all">
										{isLoggingOut
											? <Loader2 className="size-3.5 text-red-400 animate-spin" />
											: <LogOut className="size-3.5 text-red-400" />
										}
									</div>
									<span className="text-sm font-semibold text-red-500 dark:text-red-400">
										{isLoggingOut ? 'Signing out…' : 'Sign Out'}
									</span>
								</div>
								{!isLoggingOut && (
									<ChevronRight className="size-3.5 text-red-400/50 group-hover:text-red-400 group-hover:translate-x-0.5 transition-all" />
								)}
							</button>
						</div>
					</section>
				</div>

				{/* ── Footer ── */}
				<div className="px-6 py-4 border-t border-zinc-100 dark:border-white/[0.06] flex items-center justify-between">
					<div className="flex items-center gap-2">
						<div className="size-1.5 rounded-full bg-blue-500 animate-pulse" />
						<span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-600">VΞXCAD Workspace</span>
					</div>
					<span className="text-[10px] font-mono text-zinc-300 dark:text-zinc-700">v0.1.0</span>
				</div>
			</div>
		</>
	);
}

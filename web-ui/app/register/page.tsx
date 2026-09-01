'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2 } from 'lucide-react';
import { Logo } from '@/components/shared/Logo';

export default function RegisterPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formData.name, email: formData.email, password: formData.password }),
      });
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Registration failed');
      }
      
      router.push('/workspace');
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100/90 dark:bg-[#070b14] text-foreground flex flex-col items-center justify-center p-6 relative overflow-hidden font-sans">
      {/* Ambient Depth Background Glow */}
      <div className="absolute inset-0 z-0 bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.1)_0%,transparent_70%)] pointer-events-none" />

      <div className="relative z-10 w-full max-w-md my-8">
        <div className="flex flex-col items-center mb-8">
          <Link href="/" className="flex items-center gap-3 group mb-6 hover:opacity-90 transition-opacity">
            <Logo size={48} showGlow />
            <span className="text-3xl font-bold tracking-widest text-slate-900 dark:text-white font-sans">
              VΞXCAD
            </span>
          </Link>
          
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-1.5">Create an Account</h1>
          <p className="text-sm text-slate-500 dark:text-muted-foreground text-center">Join VΞXCAD and start designing in intelligent 3D.</p>
        </div>

        <div className="bg-white dark:bg-[#0c1222]/90 border border-slate-200/90 dark:border-white/10 rounded-3xl p-8 backdrop-blur-xl shadow-xl shadow-slate-200/70 dark:shadow-[0_12px_40px_rgba(0,0,0,0.6)]">
          <form className="space-y-4" onSubmit={handleSubmit}>
            {error && (
              <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/50 text-rose-700 dark:text-rose-400 px-4 py-3 rounded-xl text-sm">
                {error}
              </div>
            )}
            
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-muted-foreground mb-2">Full Name</label>
              <input 
                type="text" 
                placeholder="John Doe"
                className="w-full px-4 py-3 bg-slate-50 dark:bg-[#111a2e] border border-slate-200 dark:border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white dark:focus:bg-[#111a2e] transition-all text-slate-900 dark:text-foreground placeholder:text-slate-400 dark:placeholder:text-muted-foreground font-medium text-sm"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-muted-foreground mb-2">Email Address</label>
              <input 
                type="email" 
                placeholder="you@example.com"
                className="w-full px-4 py-3 bg-slate-50 dark:bg-[#111a2e] border border-slate-200 dark:border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white dark:focus:bg-[#111a2e] transition-all text-slate-900 dark:text-foreground placeholder:text-slate-400 dark:placeholder:text-muted-foreground font-medium text-sm"
                required
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>
            
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-muted-foreground mb-2">Password</label>
              <input 
                type="password" 
                placeholder="Create a strong password"
                className="w-full px-4 py-3 bg-slate-50 dark:bg-[#111a2e] border border-slate-200 dark:border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white dark:focus:bg-[#111a2e] transition-all text-slate-900 dark:text-foreground placeholder:text-slate-400 dark:placeholder:text-muted-foreground font-medium text-sm"
                required
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Confirm Password</label>
              <input 
                type="password" 
                placeholder="Confirm your password"
                className="w-full px-4 py-3 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-foreground placeholder:text-muted-foreground"
                required
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
              />
            </div>

            <button 
              type="submit" 
              disabled={loading}
              className="w-full group relative inline-flex items-center justify-center px-6 py-3.5 text-sm font-bold text-white transition-all duration-200 bg-blue-600 rounded-xl hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-600 focus:ring-offset-black shadow-[0_0_20px_rgba(37,99,235,0.3)] mt-4 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  Sign Up
                  <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </form>

          <div className="mt-8 text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link href="/login" className="text-blue-400 hover:text-blue-300 font-medium transition-colors">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

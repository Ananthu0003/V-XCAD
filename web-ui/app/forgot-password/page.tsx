'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Cuboid, Loader2 } from 'lucide-react';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({ email: '', newPassword: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    if (formData.newPassword !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Failed to reset password');
      }
      
      setSuccess(true);
      setTimeout(() => {
        router.push('/login');
      }, 2000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-6 relative overflow-hidden font-sans">
      <div className="absolute inset-0 z-0"></div>

      <div className="relative z-10 w-full max-w-md">
        <div className="flex flex-col items-center mb-10">
          <Link href="/" className="flex items-center gap-2 group mb-8">
            <div className="relative w-12 h-12 flex items-center justify-center">
              <div className="absolute inset-0 bg-blue-500 rounded-xl transform rotate-45 opacity-20 group-hover:opacity-30 transition-opacity"></div>
              <Cuboid className="w-7 h-7 text-blue-400 relative z-10" />
            </div>
            <span className="text-3xl font-bold tracking-widest bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-500 dark:from-gray-100 dark:to-gray-500">
              VΞXCAD
            </span>
          </Link>
          
          <h1 className="text-2xl font-semibold mb-2">Reset Password</h1>
          <p className="text-muted-foreground text-center">Enter your email and a new password.</p>
        </div>

        <div className="bg-card border border-border rounded-3xl p-8 backdrop-blur-xl shadow-2xl">
          {success ? (
            <div className="text-center py-6">
              <div className="w-16 h-16 bg-green-500/10 text-green-500 rounded-full flex items-center justify-center mx-auto mb-4 border border-green-500/20">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-xl font-medium mb-2">Password Reset</h3>
              <p className="text-muted-foreground mb-6">Your password has been successfully updated.</p>
              <p className="text-sm text-muted-foreground">Redirecting to login...</p>
            </div>
          ) : (
            <form className="space-y-6" onSubmit={handleSubmit}>
              {error && (
                <div className="bg-red-500/10 border border-red-500/50 text-red-400 px-4 py-3 rounded-xl text-sm">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">Email Address</label>
                <input 
                  type="email" 
                  placeholder="you@example.com"
                  className="w-full px-4 py-3 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-foreground placeholder:text-muted-foreground"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">New Password</label>
                <input 
                  type="password" 
                  placeholder="••••••••"
                  className="w-full px-4 py-3 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-foreground placeholder:text-muted-foreground"
                  required
                  minLength={6}
                  value={formData.newPassword}
                  onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">Confirm Password</label>
                <input 
                  type="password" 
                  placeholder="••••••••"
                  className="w-full px-4 py-3 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-foreground placeholder:text-muted-foreground"
                  required
                  minLength={6}
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                />
              </div>

              <button 
                type="submit" 
                disabled={loading}
                className="w-full group relative inline-flex items-center justify-center px-6 py-3.5 text-sm font-bold text-white transition-all duration-200 bg-blue-600 rounded-xl hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-600 focus:ring-offset-black shadow-[0_0_20px_rgba(37,99,235,0.3)] mt-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    Reset Password
                    <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </button>
            </form>
          )}

          <div className="mt-8 text-center text-sm text-muted-foreground">
            Remembered your password?{' '}
            <Link href="/login" className="text-blue-400 hover:text-blue-300 font-medium transition-colors">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

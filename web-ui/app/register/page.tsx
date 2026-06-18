'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Cuboid, Loader2 } from 'lucide-react';

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
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-6 relative overflow-hidden font-sans">
      {/* Background Effects */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-blue-600/10 rounded-full blur-[120px] pointer-events-none" />
      </div>

      <div className="relative z-10 w-full max-w-md mt-10 mb-10">
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
          
          <h1 className="text-2xl font-semibold mb-2">Create an Account</h1>
          <p className="text-muted-foreground text-center">Join VΞXCAD and start designing in intelligent 3D.</p>
        </div>

        <div className="bg-card border border-border rounded-3xl p-8 backdrop-blur-xl shadow-2xl">
          <form className="space-y-5" onSubmit={handleSubmit}>
            {error && (
              <div className="bg-red-500/10 border border-red-500/50 text-red-400 px-4 py-3 rounded-xl text-sm">
                {error}
              </div>
            )}
            
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Full Name</label>
              <input 
                type="text" 
                placeholder="John Doe"
                className="w-full px-4 py-3 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-foreground placeholder:text-muted-foreground"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            
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
              <label className="block text-sm font-medium text-muted-foreground mb-2">Password</label>
              <input 
                type="password" 
                placeholder="Create a strong password"
                className="w-full px-4 py-3 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-foreground placeholder:text-muted-foreground"
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

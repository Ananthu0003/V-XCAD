import Image from 'next/image';
import { cn } from '@/lib/utils';

interface LogoProps {
  className?: string;
  size?: number;
  showGlow?: boolean;
}

export function Logo({ className, size = 32, showGlow = false }: LogoProps) {
  return (
    <div className={cn("relative flex items-center justify-center shrink-0", className)}>
      {showGlow && (
        <div 
          className="absolute inset-0 bg-blue-500/30 rounded-xl blur-md -z-10 animate-pulse" 
          style={{ width: size, height: size }}
        />
      )}
      <Image
        src="/logo.png"
        alt="VΞXCAD Logo"
        width={size}
        height={size}
        className="rounded-lg object-contain drop-shadow-[0_2px_10px_rgba(59,130,246,0.35)]"
        priority
      />
    </div>
  );
}

import { Plus } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { UserCircle } from 'lucide-react';
import Link from 'next/link';

export function Header() {
  return (
    <header className="h-14 border-b px-6 flex items-center justify-between bg-card text-card-foreground">
      <div className="font-semibold text-lg">CAM Tool Manager</div>
      <div>
        <Link href="#" className={cn(buttonVariants({ variant: "ghost", size: "icon" }))}>
          <UserCircle className="h-5 w-5" />
          <span className="sr-only">User Menu</span>
        </Link>
      </div>
    </header>
  );
}

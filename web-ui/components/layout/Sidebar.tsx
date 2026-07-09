import Link from 'next/link';
import { LayoutDashboard, Wrench, Package, Import, Download } from 'lucide-react';

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Tool Library', href: '/tools', icon: Wrench },
  { name: 'Holder Library', href: '/holders', icon: Package },
  { name: 'Import / Export', href: '/import-export', icon: Import },
];

export function Sidebar() {
  return (
    <div className="flex h-full w-64 flex-col bg-card border-r">
      <div className="flex h-16 shrink-0 items-center px-6 border-b">
        <span className="text-lg font-bold tracking-tight text-foreground">CAM Tool Manager</span>
      </div>
      <nav className="flex flex-1 flex-col px-4 py-6 space-y-2">
        {navigation.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.name}
              href={item.href}
              className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <Icon className="h-5 w-5" />
              {item.name}
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t text-xs text-muted-foreground">
        Version 0.1.0
      </div>
    </div>
  );
}

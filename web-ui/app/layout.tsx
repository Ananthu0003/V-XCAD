import { Toaster } from '@/components/ui/sonner';
import type { Metadata } from 'next';
import { IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/shared/theme-provider';
import { ThemeToggle } from '@/components/shared/theme-toggle';

const ibmPlexMono = IBM_Plex_Mono({
	weight: ['400', '500', '600', '700'],
	variable: '--font-ibm-plex-mono',
	subsets: ['latin'],
});

export const metadata: Metadata = {
	title: 'VΞXCAD Tactical Workspace',
	description: 'Generate and refine CAD from documents with HITL controls.',
};

// Finding 2 (P3): nonce-based CSP requires dynamic rendering (see proxy.ts) —
// a nonce is generated fresh per request and cannot be baked into a
// statically-generated page. Applies to the whole app since this is the
// root layout.
export const dynamic = 'force-dynamic';

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en" className={`${ibmPlexMono.variable} h-full antialiased`} suppressHydrationWarning>
			<body className={`${ibmPlexMono.className} min-h-full flex flex-col`}>
				<ThemeProvider
					attribute="class"
					defaultTheme="dark"
					enableSystem
					disableTransitionOnChange
				>
					{children}
					<Toaster richColors position="top-right" />
				</ThemeProvider>
			</body>
		</html>
	);
}

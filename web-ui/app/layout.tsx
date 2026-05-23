import { Toaster } from '@/components/ui/sonner';
import type { Metadata } from 'next';
import { IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { ThemeToggle } from '@/components/theme-toggle';

const ibmPlexMono = IBM_Plex_Mono({
	weight: ['400', '500', '600', '700'],
	variable: '--font-ibm-plex-mono',
	subsets: ['latin'],
});

export const metadata: Metadata = {
	title: 'CADVΞX Tactical Workspace',
	description: 'Generate and refine CAD from documents with HITL controls.',
};

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
					<div className="fixed bottom-6 right-6 z-50">
						<ThemeToggle />
					</div>
				</ThemeProvider>
			</body>
		</html>
	);
}

import '@testing-library/jest-dom'

// Server-side config that route handlers now require (BFF -> ai-engine service auth). Fixtures
// written before Finding 2 never set it; suites that assert fail-closed behaviour delete it
// explicitly. This is a test placeholder, not a credential.
process.env.SERVICE_API_KEY ??= 'jest-service-key-placeholder'

// Mock matchMedia if needed for some components (e.g., shadcn/ui/radix primitives).
// Guarded so suites that opt into `@jest-environment node` (server-only code such as
// lib/auth.ts, which needs Node's WebCrypto) can share this setup file.
if (typeof window !== 'undefined') Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(), // Deprecated
    removeListener: jest.fn(), // Deprecated
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
})

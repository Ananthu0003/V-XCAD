import '@testing-library/jest-dom'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'vexcad-test-secret-key-32-chars-long-minimum';

// Mock matchMedia if needed for some components (e.g., shadcn/ui/radix primitives)
Object.defineProperty(window, 'matchMedia', {
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

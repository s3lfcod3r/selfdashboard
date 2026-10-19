import '@testing-library/jest-dom/vitest'

// Vitest + jsdom: `server-only`-Modul-Importe und `fetch`-Mocks.
// `server-only` ist ein leeres Modul (Next.js), das im Test-Environment
// einfach ignoriert werden kann.
import { vi } from 'vitest'

// `server-only` ist ein leeres Modul (Next.js), das im Test-Environment
// einfach ignoriert werden kann.
vi.mock('server-only', () => ({ __vite_ignored: true }))

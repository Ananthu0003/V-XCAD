import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

describe('Sample Test', () => {
  it('renders a simple element', () => {
    render(<div>Hello World</div>)
    expect(screen.getByText('Hello World')).toBeInTheDocument()
  })
})

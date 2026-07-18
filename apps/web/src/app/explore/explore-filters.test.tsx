import { render, screen } from '@testing-library/react';
import { ExploreFilters } from './explore-filters';

describe('ExploreFilters', () => {
  it('submits filters as a shareable GET query and preserves an active tag', () => {
    render(<ExploreFilters q="rover" status="ONLINE" sort="name" tag="mars" />);

    const form = screen.getByRole('button', { name: 'Apply filters' }).closest('form');
    expect(form).toHaveAttribute('action', '/explore/search');
    expect(form).toHaveAttribute('method', 'get');
    expect(screen.getByRole('textbox')).toHaveValue('rover');
    const [status, sort] = screen.getAllByRole('combobox');
    expect(status).toHaveValue('ONLINE');
    expect(sort).toHaveValue('name');
    expect(form?.querySelector('input[name="tag"]')).toHaveValue('mars');
    expect(screen.getByRole('link', { name: 'Clear' })).toHaveAttribute('href', '/explore');
  });

  it('omits clear and tag controls when no filters are active', () => {
    const { container } = render(<ExploreFilters />);
    expect(screen.queryByRole('link', { name: 'Clear' })).not.toBeInTheDocument();
    expect(container.querySelector('input[name="tag"]')).toBeNull();
  });
});

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as schemas from '@botparty/shared/schemas/auth';
import LoginPage from './page';

const mocks = vi.hoisted(() => ({
  load: vi.fn(), login: vi.fn(), register: vi.fn(), setToken: vi.fn(), storeLogin: vi.fn(), push: vi.fn(),
}));
vi.mock('./auth-schemas', () => ({ loadAuthSchemas: mocks.load }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/store', () => ({ useAuth: () => ({ login: mocks.storeLogin }) }));
vi.mock('@/lib/api', () => ({
  api: { auth: { login: mocks.login, register: mocks.register }, setToken: mocks.setToken },
  ApiError: class extends Error {},
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue(schemas);
  mocks.login.mockResolvedValue({ accessToken: 'token', user: {
    id: 'user', username: 'viewer', displayName: 'Viewer', role: 'USER',
  } });
});

function fillLogin(email = 'viewer@example.com') {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'valid-password' } });
}

function submit() {
  fireEvent.submit(screen.getByLabelText('Email').closest('form')!);
}

test('loads no validation on mount; keyboard focus loads the original schemas', async () => {
  render(<LoginPage />);
  expect(mocks.load).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  fireEvent.focus(screen.getByLabelText('Email'));
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1));
  fillLogin();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
});

test('autofill changes trigger loading; concurrent submits wait and send only one validated request', async () => {
  let ready!: (value: typeof schemas) => void;
  mocks.load.mockReturnValue(new Promise<typeof schemas>((resolve) => { ready = resolve; }));
  render(<LoginPage />);
  fillLogin();
  submit();
  submit();
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  expect(mocks.load).toHaveBeenCalledTimes(1);
  expect(mocks.login).not.toHaveBeenCalled();
  await act(async () => { ready(schemas); });
  await waitFor(() => expect(mocks.login).toHaveBeenCalledTimes(1));
  expect(mocks.login).toHaveBeenCalledWith({ email: 'viewer@example.com', password: 'valid-password' });
  expect(mocks.push).toHaveBeenCalledWith('/explore');
});

test('loading failure sends nothing, displays a retry, and recovers without dropping validation', async () => {
  mocks.load.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(schemas);
  render(<LoginPage />);
  fillLogin('invalid');
  submit();
  expect(await screen.findByRole('alert')).toHaveTextContent('validation could not be loaded');
  expect(mocks.login).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry validation' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry validation' })).not.toBeInTheDocument());
  submit();
  await waitFor(() => expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true'));
  expect(mocks.login).not.toHaveBeenCalled();
  fillLogin();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
  submit();
  await waitFor(() => expect(mocks.login).toHaveBeenCalledTimes(1));
});

test('registration cannot submit without valid username, password and legal consent', async () => {
  render(<LoginPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  fillLogin();
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: '!' } });
  submit();
  await waitFor(() => expect(screen.getByLabelText('Username')).toHaveAttribute('aria-invalid', 'true'));
  expect(mocks.register).not.toHaveBeenCalled();
  expect(mocks.login).not.toHaveBeenCalled();
});

test('valid registration fields still cannot bypass missing legal consent by submitting the form', async () => {
  render(<LoginPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  fillLogin();
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'viewer' } });
  await waitFor(() => expect(mocks.load).toHaveBeenCalled());
  submit();
  await act(async () => { await Promise.resolve(); });
  expect(mocks.register).not.toHaveBeenCalled();
  expect(mocks.login).not.toHaveBeenCalled();
});

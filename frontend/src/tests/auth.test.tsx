import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loginWithGoogle, loginWithEmail, signupWithEmail } = vi.hoisted(() => ({
  loginWithGoogle: vi.fn(),
  loginWithEmail: vi.fn(),
  signupWithEmail: vi.fn(),
}));

vi.mock('../features/auth/AuthContext', () => ({
  useAuth: () => ({
    loginWithGoogle,
    loginWithEmail,
    signupWithEmail,
    googleConfigured: true,
    isLoading: false,
    user: null,
  }),
}));

import { LoginPage } from '../features/auth/LoginPage';

describe('Google login page', () => {
  beforeEach(() => {
    loginWithGoogle.mockClear();
    loginWithEmail.mockReset();
    signupWithEmail.mockReset();
  });

  it('supports password login, account signup and Google OAuth', async () => {
    loginWithEmail.mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'alex@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secure-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(loginWithEmail).toHaveBeenCalledWith('alex@example.com', 'secure-password');

    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Google' }));
    expect(loginWithGoogle).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByLabelText('Full name')).toBeInTheDocument();
    expect(screen.getByText('Already have an account?')).toBeInTheDocument();
  });
});

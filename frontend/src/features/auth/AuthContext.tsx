import React, { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { User } from '../../types';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  googleConfigured: boolean;
  loginWithGoogle: () => void;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  signupWithEmail: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refetchUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [googleConfigured, setGoogleConfigured] = useState(false);

  const fetchCurrentUser = async () => {
    try {
      setIsLoading(true);
      const res = await api.get('/auth/me');
      setUser(res.data.data.user);
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCurrentUser();
    api
      .get('/auth/config')
      .then((res) => setGoogleConfigured(res.data.data.googleConfigured))
      .catch(() => setGoogleConfigured(false));
  }, []);

  const loginWithGoogle = () => {
    window.location.href = '/api/auth/google';
  };

  const loginWithEmail = async (email: string, password: string) => {
    const res = await api.post('/auth/login', { email, password });
    setUser(res.data.data.user);
  };

  const signupWithEmail = async (name: string, email: string, password: string) => {
    const res = await api.post('/auth/signup', { name, email, password });
    setUser(res.data.data.user);
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setUser(null);
      window.location.href = '/login';
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        googleConfigured,
        loginWithGoogle,
        loginWithEmail,
        signupWithEmail,
        logout,
        refetchUser: fetchCurrentUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import {
  getSession,
  clearSession,
  validatePasskey,
  setSession,
  seedDefaultUser,
  getCurrentUser,
  UserAccount,
} from "@/lib/auth";

interface AuthContextType {
  isAuthenticated: boolean;
  username: string | null;
  userId: string | null;
  userData: UserAccount | null;
  login: (
    username: string,
    passkey: string
  ) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  refreshUser: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userData, setUserData] = useState<UserAccount | null>(null);

  const refreshUser = useCallback(() => {
    const session = getSession();
    if (session) {
      const user = getCurrentUser();
      setIsAuthenticated(true);
      setUsername(session.username);
      setUserId(session.userId);
      setUserData(user);
    } else {
      setIsAuthenticated(false);
      setUsername(null);
      setUserId(null);
      setUserData(null);
    }
  }, []);

  useEffect(() => {
    seedDefaultUser();
    refreshUser();
  }, [refreshUser]);

  const login = useCallback(
    async (username: string, passkey: string) => {
      const user = validatePasskey(username, passkey);
      if (!user) {
        return {
          success: false,
          error:
            "Invalid username or passkey. Contact @realsonnet to register your account.",
        };
      }

      const session = {
        userId: user.id,
        username: user.username,
        token: `mock-token-${Date.now()}`,
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      };

      setSession(session);
      refreshUser();
      return { success: true };
    },
    [refreshUser]
  );

  const logout = useCallback(() => {
    clearSession();
    setIsAuthenticated(false);
    setUsername(null);
    setUserId(null);
    setUserData(null);
    window.location.href = "/";
  }, []);

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        username,
        userId,
        userData,
        login,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

"use client";

import React, { createContext, useContext, useReducer, useEffect } from "react";
import { useAuth } from "./useAuthContext";
import { getCurrentUser } from "@/lib/auth";
import type { Signal, BotState, BalanceInfo, WSEvent } from "@/lib/types";

interface TradingContextType {
  state: BotState;
  balance: BalanceInfo;
  latestTheme: "profit" | "loss" | "neutral";
  dispatch: React.Dispatch<Action>;
}

type Action =
  | { type: "SET_STATE"; payload: Partial<BotState> }
  | { type: "SET_BALANCE"; payload: BalanceInfo }
  | { type: "ADD_SIGNAL"; payload: Signal }
  | { type: "UPDATE_SIGNAL"; payload: Signal }
  | { type: "CLOSE_SIGNAL"; payload: Signal }
  | { type: "SET_THEME"; payload: "profit" | "loss" | "neutral" };

const initialState: BotState = {
  status: "IDLE",
  signals: [],
  trade_count: 0,
  win_count: 0,
  loss_count: 0,
  no_trade_count: 0,
  total_pnl_pct: 0,
  total_pnl_usdt: 0,
  symbols_scanned: 0,
  active_signal_count: 0,
  max_active_signals: 20,
  winrate: 0,
  balance: 1000,
};

const initialBalance: BalanceInfo = {
  balance: 1000,
  initial_balance: 1000,
  leverage: 10,
  entry_usdt: 100,
};

function reducer(state: BotState, action: Action): BotState {
  switch (action.type) {
    case "SET_STATE":
      return { ...state, ...action.payload };
    case "ADD_SIGNAL":
      return {
        ...state,
        signals: [action.payload, ...state.signals].slice(0, 500),
        active_signal_count: state.active_signal_count + 1,
      };
    case "UPDATE_SIGNAL": {
      const idx = state.signals.findIndex((s) => s.id === action.payload.id);
      if (idx === -1) return state;
      const next = [...state.signals];
      next[idx] = { ...next[idx], ...action.payload };
      return { ...state, signals: next };
    }
    case "CLOSE_SIGNAL": {
      const filtered = state.signals.filter((s) => s.id !== action.payload.id);
      const pnl = action.payload.pnl_pct || 0;
      return {
        ...state,
        signals: filtered,
        trade_count: state.trade_count + 1,
        win_count: pnl >= 0 ? state.win_count + 1 : state.win_count,
        loss_count: pnl < 0 ? state.loss_count + 1 : state.loss_count,
        total_pnl_pct: state.total_pnl_pct + pnl,
        total_pnl_usdt: state.total_pnl_usdt + (action.payload.pnl_usdt || 0),
        active_signal_count: Math.max(0, state.active_signal_count - 1),
      };
    }
    case "SET_THEME":
      return state;
    default:
      return state;
  }
}

const TradingContext = createContext<TradingContextType | null>(null);

export function TradingProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, userId } = useAuth();
  const [state, dispatch] = useReducer(reducer, initialState);
  const [balance, setBalance] = React.useState<BalanceInfo>(initialBalance);
  const [latestTheme, setLatestTheme] = React.useState<"profit" | "loss" | "neutral">("neutral");

  // Override balance & leverage dari user data kalau login
  useEffect(() => {
    if (isAuthenticated && userId) {
      const user = getCurrentUser();
      if (user) {
        setBalance({
          balance: user.balance,
          initial_balance: user.initialBalance,
          leverage: user.leverage,
          entry_usdt: user.margin,
        });
      }
    } else {
      // Reset ke global default
      setBalance(initialBalance);
    }
  }, [isAuthenticated, userId]);

  // WebSocket connection
  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${proto}//${window.location.host}/api/bot/ws`;
    let ws: WebSocket | null = null;
    let reconnectTimer: NodeJS.Timeout;

    const connect = () => {
      ws = new WebSocket(wsUrl);

      ws.onmessage = (evt) => {
        try {
          const msg: WSEvent = JSON.parse(evt.data);
          handleEvent(msg);
        } catch {
          /* ignore malformed */
        }
      };

      ws.onclose = () => {
        reconnectTimer = setTimeout(connect, 3000);
      };
    };

    const handleEvent = (msg: WSEvent) => {
      switch (msg.event) {
        case "signal":
          dispatch({ type: "ADD_SIGNAL", payload: msg.data });
          break;
        case "signal_closed":
          dispatch({ type: "CLOSE_SIGNAL", payload: msg.data });
          setLatestTheme(getThemeFromPnl(msg.data.pnl_pct));
          break;
        case "signal_invalidated":
          dispatch({
            type: "UPDATE_SIGNAL",
            payload: {
              id: msg.data.id,
              status: "INVALIDATED",
              result: "INVALIDATED",
            } as Signal,
          });
          break;
        case "price_tick": {
          dispatch({
            type: "UPDATE_SIGNAL",
            payload: {
              id: msg.data.id,
              current_price: msg.data.price,
              entry_hit: msg.data.entry_hit,
            } as Signal,
          });
          break;
        }
        case "balance_update":
          setBalance(msg.data);
          break;
        case "reset_all":
          dispatch({ type: "SET_STATE", payload: initialState });
          break;
      }
    };

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  // Initial REST fetch — tambah query user kalau login
  useEffect(() => {
    const user = isAuthenticated ? getCurrentUser() : null;
    const userParam = user ? `?user=${user.id}` : "";

    fetch(`/api/bot/state${userParam}`)
      .then((r) => r.json())
      .then((data) => dispatch({ type: "SET_STATE", payload: data }))
      .catch(() => {});

    fetch(`/api/trading/balance${userParam}`)
      .then((r) => r.json())
      .then((data) => setBalance(data.data))
      .catch(() => {});
  }, [isAuthenticated]);

  // Update DOM theme attribute for global CSS variables
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", latestTheme);
  }, [latestTheme]);

  return (
    <TradingContext.Provider value={{ state, balance, latestTheme, dispatch }}>
      {children}
    </TradingContext.Provider>
  );
}

export function useTrading() {
  const ctx = useContext(TradingContext);
  if (!ctx) throw new Error("useTrading must be used within TradingProvider");
  return ctx;
}

function getThemeFromPnl(pnl?: number | null): "profit" | "loss" | "neutral" {
  if (pnl == null) return "neutral";
  return pnl >= 0 ? "profit" : "loss";
}

import { createContext, useContext, useMemo, useReducer, type Dispatch, type ReactNode } from "react";
import { INITIAL_STATE, reducer, type AppAction, type AppState } from "./state";

/**
 * The one place `useReducer` lives.
 *
 * Every feature reads state through `useApp()` and signals intent through `useDispatch()`. No
 * feature keeps its own copy of the phase, the batch or the simulation: two components disagreeing
 * about whether a simulation is current is exactly the failure mode this state machine exists to
 * prevent.
 *
 * Effects — wallet prompts, RPC calls, bundler submission — live in feature hooks. They dispatch
 * results back in. Nothing in `state/` performs I/O, so the whole machine stays unit-testable.
 */

const StateContext = createContext<AppState | null>(null);
const DispatchContext = createContext<Dispatch<AppAction> | null>(null);

export function AppProvider({ children }: { readonly children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const value = useMemo(() => state, [state]);
  return (
    <StateContext.Provider value={value}>
      <DispatchContext.Provider value={dispatch}>{children}</DispatchContext.Provider>
    </StateContext.Provider>
  );
}

export function useApp(): AppState {
  const state = useContext(StateContext);
  if (state === null) {
    throw new Error("useApp must be used inside <AppProvider>");
  }
  return state;
}

export function useDispatch(): Dispatch<AppAction> {
  const dispatch = useContext(DispatchContext);
  if (dispatch === null) {
    throw new Error("useDispatch must be used inside <AppProvider>");
  }
  return dispatch;
}

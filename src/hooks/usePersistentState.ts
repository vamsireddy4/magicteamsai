import { Dispatch, SetStateAction, useEffect, useRef, useState } from "react";

type InitialValue<T> = T | (() => T);

const resolveInitialValue = <T,>(initialValue: InitialValue<T>) =>
  typeof initialValue === "function" ? (initialValue as () => T)() : initialValue;

export function usePersistentState<T>(
  key: string,
  initialValue: InitialValue<T>,
): [T, Dispatch<SetStateAction<T>>] {
  const initialRef = useRef(resolveInitialValue(initialValue));
  const [state, setState] = useState<T>(() => {
    if (typeof window === "undefined") {
      return initialRef.current;
    }

    try {
      const stored = window.localStorage.getItem(key);
      if (stored !== null) {
        return JSON.parse(stored) as T;
      }
    } catch {
      // Ignore malformed persisted state and fall back to the provided default.
    }

    return initialRef.current;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // Ignore storage write failures.
    }
  }, [key, state]);

  return [state, setState];
}

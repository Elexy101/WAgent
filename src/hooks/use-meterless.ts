import { useCallback, useEffect, useRef, useState } from "react";
import {
  getStoredToken,
  getStoredUrl,
  getUseForReplies,
  probe,
  publishMeterlessState,
  readMeterlessState,
  setUseForReplies,
  subscribeMeterlessState,
  type MeterlessState,
} from "@/lib/meterless";

export function useMeterless() {
  const [state, setState] = useState<MeterlessState>(readMeterlessState);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => subscribeMeterlessState(setState), []);

  const refresh = useCallback(async () => {
    const url = getStoredUrl();
    const token = getStoredToken();
    const enabled = getUseForReplies();
    if (!url || !token) {
      const next: MeterlessState = { status: "unset", modelCount: 0, enabled };
      publishMeterlessState(next);
      return next;
    }
    publishMeterlessState({ status: "checking", modelCount: stateRef.current.modelCount, enabled });
    const out = await probe(url, token);
    const next: MeterlessState = { status: out.status, modelCount: out.modelCount, enabled };
    publishMeterlessState(next);
    return next;
  }, []);

  const setEnabled = useCallback((enabled: boolean) => {
    setUseForReplies(enabled);
    publishMeterlessState({ ...stateRef.current, enabled });
  }, []);

  return { state, refresh, setEnabled };
}

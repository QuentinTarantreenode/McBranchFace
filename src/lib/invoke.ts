// Every command to the backend goes through here: the dev, audit and e2e builds count the ones in flight, so
// a test can wait until the app is quiet, and keep the last ones for the report of a failed test.
import { invoke as send, type InvokeArgs } from "@tauri-apps/api/core";
import { probe, PROBED } from "./probe";

export function invoke<T>(command: string, args?: InvokeArgs): Promise<T> {
  const answer = send<T>(command, args);
  return PROBED ? probe.track(command, answer, args) : answer;
}

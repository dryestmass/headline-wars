import type { AutonomousSource } from "./autonomous";
import { houseSource } from "./house";
import { senateSource } from "./senate";

export function congressSource(fetchSource: typeof fetch = fetch): AutonomousSource {
  const senate = senateSource(fetchSource);
  const house = houseSource(fetchSource);
  return {
    async discover(now) {
      const results = await Promise.allSettled([senate.discover(now), house.discover(now)]);
      const candidates = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
      const failed = results.filter((result) => result.status === "rejected");
      if (failed.length === results.length) throw new Error("Both congressional schedule sources failed");
      if (failed.length) console.warn("A congressional schedule source failed");
      return candidates;
    },
    verify(candidate) {
      if (candidate.id.startsWith("senate-")) return senate.verify(candidate);
      if (candidate.id.startsWith("house-")) return house.verify(candidate);
      return Promise.resolve(null);
    },
  };
}

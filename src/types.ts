import type { AppEnv, CloudflareBindings } from "./config/env";

export type AppContext = {
  Bindings: CloudflareBindings;
  Variables: {
    env: AppEnv;
    userAddress?: string;
  };
};

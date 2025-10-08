import "dotenv/config";

export interface AppConfig {
  apiBase: string;
  keychainService: string;
  keychainAccount: string;
}

export const config: AppConfig = {
  apiBase: process.env.GHOSTABLE_API ?? "https://ghostable.dev/api/v2",
  keychainService: "ghostable-cli",
  keychainAccount: "session",
};
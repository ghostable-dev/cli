export interface Session {
  accessToken: string;
  organizationId?: string;
  expiresAt?: string; // ISO8601
}

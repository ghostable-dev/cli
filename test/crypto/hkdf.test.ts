import { describe, expect, it } from 'vitest';

import {
        deriveEnvKEK,
        deriveHKDF,
        deriveOrgKEK,
        deriveProjKEK,
        deriveVarDEK,
} from '../../src/crypto/derive/hkdf.js';

const ROOT = Uint8Array.from(Array.from({ length: 32 }, (_, i) => i));
const SALT = new Uint8Array(32).fill(1);

const toHex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

describe('HKDF utilities', () => {
        it('derives deterministic output for given inputs', () => {
                const derived = deriveHKDF(ROOT, 'ghostable:test', SALT, 32);
                expect(toHex(derived)).toBe('b0e4680633855c8a1a61c97a0c758ceb1317f69ae82bcc2b298239297b367cd8');
        });

        it('enforces input validation rules', () => {
                expect(() => deriveHKDF(ROOT, '', SALT)).toThrow(TypeError);
                expect(() => deriveHKDF(ROOT, 'info', SALT, 0)).toThrow(RangeError);
        });

        it('uses context strings to domain-separate derived keys', () => {
                const org = deriveOrgKEK(ROOT, 'org-123');
                const proj = deriveProjKEK(org, 'proj-456');
                const env = deriveEnvKEK(proj, 'production');
                const dekV1 = deriveVarDEK(env, 'API_KEY', 1);
                const dekV2 = deriveVarDEK(env, 'API_KEY', 2);

                expect(toHex(org)).toBe('aa69c02ba044136ac5b4e3bbec26dcda1287e51fdfe5480959cc3b6c78281bf4');
                expect(toHex(proj)).toBe('7a58d432f259c900d84503274b312424acdd7b014c6756660bf7190f0cf2a338');
                expect(toHex(env)).toBe('20bfa2bb725d91864b4bb4da4a7afcdddc2688cdc44f32a3f81e2d913069ad1d');
                expect(toHex(dekV2)).toBe('5c56d4c430926fb3762c69280e16e09dd0344f9927472a775219052707a750fc');
                expect(toHex(dekV1)).not.toBe(toHex(dekV2));
        });
});

import { EnvironmentSecretBundle } from './dist/entities/environment/EnvironmentSecretBundle.js';

const json = {
    env: 'production',
    chain: ['production'],
    secrets: [],
    environment_key: {
        data: {
            type: 'environment-keys',
            id: 'key-id',
            attributes: {
                version: 1,
                fingerprint: 'abc',
                created_at: null,
                rotated_at: null,
                created_by_device_id: null,
            },
            relationships: {
                envelope: {
                    data: {
                        type: 'encrypted-envelopes',
                        id: 'env-id',
                        attributes: {
                            ciphertext_b64: 'cipher',
                            nonce_b64: 'nonce',
                            alg: 'xchacha20-poly1305',
                            created_at: null,
                            updated_at: null,
                            revoked_at: null,
                            recipients: [
                                {
                                    type: 'deployment',
                                    id: 'token',
                                    edek_b64: 'b64:payload',
                                },
                            ],
                            from_ephemeral_public_key: 'b64:ephemeral',
                        },
                    },
                },
            },
        },
    },
};

const bundle = EnvironmentSecretBundle.fromJSON(json);
console.log(bundle.environmentKey?.envelope);

/**
 * CryptoJS compatibility layer
 *
 * Single Responsibility: Provide a CryptoJS-compatible API surface for the
 * script sandbox (hashes, HMACs, AES/DES/TripleDES ciphers, encodings, PBKDF2).
 *
 * Uses Node's crypto module underneath, with a WordArray representation that
 * behaves like CryptoJS's intermediate data type.
 */

import * as crypto from 'crypto';

/**
 * CryptoJS-compatible WordArray representation.
 *
 * CryptoJS uses a custom WordArray type as intermediate data representation.
 * We represent it as a tagged Buffer wrapper so all encrypt/decrypt flows work.
 */
class CryptoWordArray {
    private _buffer: Buffer;
    constructor(data: string | Buffer) {
        this._buffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    }
    toString(encoder?: { stringify: (wa: CryptoWordArray) => string }): string {
        if (encoder) return encoder.stringify(this);
        // Default: hex output (CryptoJS default)
        return this._buffer.toString('hex');
    }
    toBuffer(): Buffer { return this._buffer; }

    /** Create from hex string */
    static fromHex(hex: string): CryptoWordArray { return new CryptoWordArray(Buffer.from(hex, 'hex')); }
    /** Create from base64 string */
    static fromBase64(b64: string): CryptoWordArray { return new CryptoWordArray(Buffer.from(b64, 'base64')); }
    /** Create from utf8 string */
    static fromUtf8(str: string): CryptoWordArray { return new CryptoWordArray(Buffer.from(str, 'utf8')); }
}

/**
 * Derive key and IV from passphrase using EVP_BytesToKey (OpenSSL-compatible).
 * This is how CryptoJS derives keys from string passphrases.
 */
function evpBytesToKey(password: string, keyLen: number, ivLen: number, salt?: Buffer): { key: Buffer; iv: Buffer } {
    const data = Buffer.concat([Buffer.from(password, 'utf8'), salt || Buffer.alloc(0)]);
    const bufs: Buffer[] = [];
    let last = Buffer.alloc(0);
    while (Buffer.concat(bufs).length < keyLen + ivLen) {
        last = crypto.createHash('md5').update(Buffer.concat([last, data])).digest();
        bufs.push(last);
    }
    const derived = Buffer.concat(bufs);
    return { key: derived.subarray(0, keyLen), iv: derived.subarray(keyLen, keyLen + ivLen) };
}

/**
 * Create a CryptoJS-compatible cipher factory for AES/DES/TripleDES.
 * Supports both passphrase (string key) and raw key (WordArray) modes.
 */
function createCipherFactory(algorithm: string, keySize: number, ivSize: number) {
    const getNodeAlgo = (keyLen: number): string => {
        if (algorithm === 'aes') return `aes-${keyLen * 8}-cbc`;
        if (algorithm === 'des') return 'des-cbc';
        if (algorithm === 'des-ede3') return 'des-ede3-cbc';
        return algorithm;
    };

    return {
        encrypt(message: string | CryptoWordArray, key: string | CryptoWordArray, options?: any): any {
            const msgBuf = message instanceof CryptoWordArray ? message.toBuffer() : Buffer.from(String(message), 'utf8');

            if (typeof key === 'string') {
                // Passphrase mode — OpenSSL-compatible with salt
                const salt = crypto.randomBytes(8);
                const { key: derivedKey, iv } = evpBytesToKey(key, keySize, ivSize, salt);
                const cipher = crypto.createCipheriv(getNodeAlgo(keySize), derivedKey, iv);
                const encrypted = Buffer.concat([cipher.update(msgBuf), cipher.final()]);
                // Output: "Salted__" + salt + ciphertext (OpenSSL format)
                const result = Buffer.concat([Buffer.from('Salted__'), salt, encrypted]);
                return {
                    ciphertext: new CryptoWordArray(encrypted),
                    salt: new CryptoWordArray(salt),
                    toString: (encoder?: any) => {
                        if (encoder) return encoder.stringify(new CryptoWordArray(result));
                        return result.toString('base64');
                    }
                };
            } else {
                // Raw key mode
                const keyBuf = key.toBuffer();
                const ivBuf = options?.iv ? (options.iv instanceof CryptoWordArray ? options.iv.toBuffer() : Buffer.alloc(ivSize)) : Buffer.alloc(ivSize);
                const cipher = crypto.createCipheriv(getNodeAlgo(keyBuf.length), keyBuf, ivBuf);
                if (options?.padding === false) cipher.setAutoPadding(false);
                const encrypted = Buffer.concat([cipher.update(msgBuf), cipher.final()]);
                return {
                    ciphertext: new CryptoWordArray(encrypted),
                    toString: (encoder?: any) => {
                        if (encoder) return encoder.stringify(new CryptoWordArray(encrypted));
                        return encrypted.toString('base64');
                    }
                };
            }
        },
        decrypt(ciphertext: string | any, key: string | CryptoWordArray, options?: any): CryptoWordArray {
            if (typeof key === 'string') {
                // Passphrase mode — parse OpenSSL format
                const raw = typeof ciphertext === 'string' ? Buffer.from(ciphertext, 'base64') : ciphertext.ciphertext.toBuffer();
                let encrypted: Buffer;
                let salt: Buffer;
                if (raw.subarray(0, 8).toString() === 'Salted__') {
                    salt = raw.subarray(8, 16);
                    encrypted = raw.subarray(16);
                } else {
                    salt = Buffer.alloc(0);
                    encrypted = raw;
                }
                const { key: derivedKey, iv } = evpBytesToKey(key, keySize, ivSize, salt);
                const decipher = crypto.createDecipheriv(getNodeAlgo(keySize), derivedKey, iv);
                return new CryptoWordArray(Buffer.concat([decipher.update(encrypted), decipher.final()]));
            } else {
                // Raw key mode
                const keyBuf = key.toBuffer();
                const ivBuf = options?.iv ? (options.iv instanceof CryptoWordArray ? options.iv.toBuffer() : Buffer.alloc(ivSize)) : Buffer.alloc(ivSize);
                const encrypted = typeof ciphertext === 'string'
                    ? Buffer.from(ciphertext, 'base64')
                    : (ciphertext.ciphertext ? ciphertext.ciphertext.toBuffer() : Buffer.from(ciphertext));
                const decipher = crypto.createDecipheriv(getNodeAlgo(keyBuf.length), keyBuf, ivBuf);
                if (options?.padding === false) decipher.setAutoPadding(false);
                return new CryptoWordArray(Buffer.concat([decipher.update(encrypted), decipher.final()]));
            }
        }
    };
}

/**
 * CryptoJS Factory - Creates CryptoJS-compatible object
 *
 * Supports:
 * - Hash: MD5, SHA1, SHA224, SHA256, SHA384, SHA512, SHA3, RIPEMD160
 * - HMAC: HmacMD5, HmacSHA1, HmacSHA256, HmacSHA512
 * - Encryption: AES, DES, TripleDES (passphrase and raw key modes)
 * - Encoding: Base64, Hex, Utf8, Utf16, Latin1
 * - Key derivation: PBKDF2
 * - WordArray creation from lib.WordArray.create / lib.WordArray.random
 */
export function createCryptoJS() {
    const hashFn = (algo: string) => (message: string | CryptoWordArray) => {
        const buf = message instanceof CryptoWordArray ? message.toBuffer() : Buffer.from(String(message), 'utf8');
        return new CryptoWordArray(crypto.createHash(algo).update(buf).digest());
    };
    const hmacFn = (algo: string) => (message: string | CryptoWordArray, key: string | CryptoWordArray) => {
        const msgBuf = message instanceof CryptoWordArray ? message.toBuffer() : Buffer.from(String(message), 'utf8');
        const keyBuf = key instanceof CryptoWordArray ? key.toBuffer() : Buffer.from(String(key), 'utf8');
        return new CryptoWordArray(crypto.createHmac(algo, keyBuf).update(msgBuf).digest());
    };

    return {
        // Hash functions
        MD5: hashFn('md5'),
        SHA1: hashFn('sha1'),
        SHA224: hashFn('sha224'),
        SHA256: hashFn('sha256'),
        SHA384: hashFn('sha384'),
        SHA512: hashFn('sha512'),
        SHA3: hashFn('sha3-256'),
        RIPEMD160: hashFn('ripemd160'),

        // HMAC functions
        HmacMD5: hmacFn('md5'),
        HmacSHA1: hmacFn('sha1'),
        HmacSHA256: hmacFn('sha256'),
        HmacSHA512: hmacFn('sha512'),

        // Encryption ciphers
        AES: createCipherFactory('aes', 32, 16),
        DES: createCipherFactory('des', 8, 8),
        TripleDES: createCipherFactory('des-ede3', 24, 8),

        // PBKDF2 key derivation
        PBKDF2(password: string | CryptoWordArray, salt: string | CryptoWordArray, cfg?: { keySize?: number; iterations?: number; hasher?: any }): CryptoWordArray {
            const passBuf = password instanceof CryptoWordArray ? password.toBuffer() : Buffer.from(String(password), 'utf8');
            const saltBuf = salt instanceof CryptoWordArray ? salt.toBuffer() : Buffer.from(String(salt), 'utf8');
            const keySize = (cfg?.keySize || 4) * 4; // CryptoJS keySize is in 32-bit words
            const iterations = cfg?.iterations || 1;
            return new CryptoWordArray(crypto.pbkdf2Sync(passBuf, saltBuf, iterations, keySize, 'sha1'));
        },

        // Encoding helpers
        enc: {
            Base64: {
                stringify: (wa: CryptoWordArray) => (wa instanceof CryptoWordArray ? wa.toBuffer() : Buffer.from(String(wa))).toString('base64'),
                parse: (str: string) => CryptoWordArray.fromBase64(str)
            },
            Utf8: {
                stringify: (wa: CryptoWordArray) => (wa instanceof CryptoWordArray ? wa.toBuffer() : Buffer.from(String(wa))).toString('utf8'),
                parse: (str: string) => CryptoWordArray.fromUtf8(str)
            },
            Hex: {
                stringify: (wa: CryptoWordArray) => (wa instanceof CryptoWordArray ? wa.toBuffer() : Buffer.from(String(wa))).toString('hex'),
                parse: (str: string) => CryptoWordArray.fromHex(str)
            },
            Latin1: {
                stringify: (wa: CryptoWordArray) => (wa instanceof CryptoWordArray ? wa.toBuffer() : Buffer.from(String(wa))).toString('latin1'),
                parse: (str: string) => new CryptoWordArray(Buffer.from(str, 'latin1'))
            },
            Utf16: {
                stringify: (wa: CryptoWordArray) => (wa instanceof CryptoWordArray ? wa.toBuffer() : Buffer.from(String(wa))).toString('utf16le'),
                parse: (str: string) => new CryptoWordArray(Buffer.from(str, 'utf16le'))
            },
            Utf16BE: {
                stringify: (wa: CryptoWordArray) => (wa instanceof CryptoWordArray ? wa.toBuffer() : Buffer.from(String(wa))).swap16().toString('utf16le'),
                parse: (str: string) => new CryptoWordArray(Buffer.from(str, 'utf16le').swap16())
            }
        },

        // lib namespace for WordArray creation
        lib: {
            WordArray: {
                create: (data?: any) => {
                    if (!data) return new CryptoWordArray(Buffer.alloc(0));
                    if (typeof data === 'string') return new CryptoWordArray(Buffer.from(data, 'utf8'));
                    if (Buffer.isBuffer(data)) return new CryptoWordArray(data);
                    return new CryptoWordArray(Buffer.from(String(data)));
                },
                random: (nBytes: number) => new CryptoWordArray(crypto.randomBytes(nBytes))
            }
        },

        // Padding schemes (for advanced use)
        pad: {
            Pkcs7: { _name: 'pkcs7' },
            NoPadding: { _name: 'nopadding' },
            ZeroPadding: { _name: 'zeropadding' }
        },

        // Mode schemes
        mode: {
            CBC: { _name: 'cbc' },
            ECB: { _name: 'ecb' }
        }
    };
}

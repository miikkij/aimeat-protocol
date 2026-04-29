import * as ed from '@noble/ed25519';

export interface KeyPair {
  publicKey: string;   // base64
  privateKey: string;  // base64
}

export async function generateKeyPair(): Promise<KeyPair> {
  const privateKeyBytes = ed.utils.randomSecretKey();
  const publicKeyBytes = await ed.getPublicKeyAsync(privateKeyBytes);
  return {
    publicKey: Buffer.from(publicKeyBytes).toString('base64'),
    privateKey: Buffer.from(privateKeyBytes).toString('base64'),
  };
}

export async function sign(privateKeyBase64: string, message: string): Promise<string> {
  const privateKey = Buffer.from(privateKeyBase64, 'base64');
  const msgBytes = new TextEncoder().encode(message);
  const signature = await ed.signAsync(msgBytes, privateKey);
  return Buffer.from(signature).toString('base64');
}

export async function verify(publicKeyBase64: string, message: string, signatureBase64: string): Promise<boolean> {
  try {
    const publicKey = Buffer.from(publicKeyBase64, 'base64');
    const msgBytes = new TextEncoder().encode(message);
    const signature = Buffer.from(signatureBase64, 'base64');
    return await ed.verifyAsync(signature, msgBytes, publicKey);
  } catch {
    return false;
  }
}

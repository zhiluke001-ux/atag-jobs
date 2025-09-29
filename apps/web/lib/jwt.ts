import { SignJWT, jwtVerify, importPKCS8, importSPKI } from "jose";

let privateKeyPromise: Promise<CryptoKey> | null = null;
let publicKeyPromise: Promise<CryptoKey> | null = null;

export async function getPrivateKey() {
  if (!privateKeyPromise) {
    const pk = (process.env.JWT_PRIVATE_KEY || "").trim();
    if (!pk.includes("BEGIN")) throw new Error("JWT_PRIVATE_KEY missing/invalid");
    privateKeyPromise = importPKCS8(pk, "EdDSA");
  }
  return privateKeyPromise;
}

export async function getPublicKey() {
  if (!publicKeyPromise) {
    const spki = (process.env.JWT_PUBLIC_KEY || "").trim();
    if (!spki.includes("BEGIN")) throw new Error("JWT_PUBLIC_KEY missing/invalid");
    publicKeyPromise = importSPKI(spki, "EdDSA");
  }
  return publicKeyPromise;
}

export async function signQR(payload: Record<string, any>, seconds: number) {
  const key = await getPrivateKey();
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "EdDSA" })
    .setIssuedAt()
    .setExpirationTime(`${seconds}s`)
    .sign(key);
}

export async function verifyQR(token: string) {
  const key = await getPublicKey();
  return await jwtVerify(token, key, { clockTolerance: "10s" });
}

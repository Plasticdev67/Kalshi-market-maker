/**
 * Kalshi API authentication.
 *
 * Signs requests using RSA-PSS with SHA-256.
 * Signature = sign(timestamp_ms + method + path)
 */

import crypto from "node:crypto";
import fs from "node:fs";
import { config } from "./config.js";

let _privateKey: crypto.KeyObject | null = null;

function getPrivateKey(): crypto.KeyObject | null {
  if (_privateKey) return _privateKey;

  if (!config.privateKeyPath || !fs.existsSync(config.privateKeyPath)) {
    return null;
  }

  const pem = fs.readFileSync(config.privateKeyPath, "utf-8");
  _privateKey = crypto.createPrivateKey(pem);
  return _privateKey;
}

export function signRequest(
  method: string,
  path: string,
  timestampMs: number,
): string | null {
  const key = getPrivateKey();
  if (!key) return null;

  const message = `${timestampMs}${method.toUpperCase()}${path}`;
  const signature = crypto.sign("sha256", Buffer.from(message), {
    key,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  });

  return signature.toString("base64");
}

export function authHeaders(
  method: string,
  path: string,
): Record<string, string> {
  if (!config.apiKey) return {};

  const timestampMs = Date.now();
  const signature = signRequest(method, path, timestampMs);

  if (!signature) return {};

  return {
    "KALSHI-ACCESS-KEY": config.apiKey,
    "KALSHI-ACCESS-TIMESTAMP": String(timestampMs),
    "KALSHI-ACCESS-SIGNATURE": signature,
    "Content-Type": "application/json",
  };
}

export function hasCredentials(): boolean {
  return Boolean(config.apiKey && getPrivateKey());
}

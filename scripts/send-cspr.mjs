import { readFileSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
require('reflect-metadata');
const {
  PrivateKey,
  KeyAlgorithm,
  RpcClient,
  HttpHandler,
  NativeTransferBuilder,
  AccountHash,
  Timestamp,
  DEFAULT_DEPLOY_TTL,
} = require('casper-js-sdk');

const RPC_URL        = 'https://node.testnet.casper.network/rpc';
const RECIPIENT_HASH = 'account-hash-fd5650d31c33ab1a9bfce31b5c18928d8d730ef01a0196583f982599733f57b3';
const AMOUNT         = '3000000000'; // 3 CSPR in motes
const CHAIN          = 'casper-test';
const KEY_PATH       = 'C:/Users/charl/secret_key.pem.txt';

const raw = readFileSync(KEY_PATH, 'utf8');
const pem = raw.slice(raw.indexOf('-----BEGIN'));
const privateKey = PrivateKey.fromPem(pem, KeyAlgorithm.SECP256K1);
const senderPublicKeyHex = privateKey.publicKey.toHex();

console.log('Sender :', senderPublicKeyHex);
console.log('To     :', RECIPIENT_HASH);
console.log('Amount : 3 CSPR (3000000000 motes)');
console.log('Chain  :', CHAIN);

const accountHash = AccountHash.fromString(RECIPIENT_HASH);

// Timestamp 15s in the past to avoid clock-skew rejection
const timestamp = Timestamp.fromJSON(new Date(Date.now() - 15_000).toISOString());

const tx = new NativeTransferBuilder()
  .from(privateKey.publicKey)
  .targetAccountHash(accountHash)
  .amount(AMOUNT)
  .chainName(CHAIN)
  .payment(2_500_000_000, 1)  // PaymentLimited — 2.5 CSPR gas, tolerance 1
  .ttl(DEFAULT_DEPLOY_TTL)
  .timestamp(timestamp)
  .build();

tx.sign(privateKey);

const client = new RpcClient(new HttpHandler(RPC_URL));

try {
  const result = await client.putTransaction(tx);
  const hash = result.rawJSON?.transaction_hash?.Version1;
  console.log('\nTransaction hash:', hash);
  console.log('Explorer        : https://testnet.cspr.live/transaction/' + hash);
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}

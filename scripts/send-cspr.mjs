import { readFileSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
require('reflect-metadata');
const {
  PrivateKey,
  KeyAlgorithm,
  RpcClient,
  HttpHandler,
  makeCsprTransferDeploy,
} = require('casper-js-sdk');

const RPC_URL   = 'https://node.testnet.casper.network/rpc';
const RECIPIENT = '0116ef6d6c6e8e11611b2c0019cb11fc937808842153313079c61a741a99918b9e';
const AMOUNT    = '3000000000'; // 3 CSPR in motes
const CHAIN     = 'casper-test';
const KEY_PATH  = 'C:/Users/charl/secret_key.pem.txt';

const raw = readFileSync(KEY_PATH, 'utf8');
const pem = raw.slice(raw.indexOf('-----BEGIN'));
const privateKey = PrivateKey.fromPem(pem, KeyAlgorithm.SECP256K1);
const senderPublicKeyHex = privateKey.publicKey.toHex();

console.log('Sender :', senderPublicKeyHex);
console.log('To     :', RECIPIENT);
console.log('Amount : 3 CSPR (3000000000 motes)');
console.log('Chain  :', CHAIN);

const deploy = makeCsprTransferDeploy({
  senderPublicKeyHex,
  recipientPublicKeyHex: RECIPIENT,
  transferAmount: AMOUNT,
  chainName: CHAIN,
  paymentAmount: '100000000',
});

deploy.sign(privateKey);

const client = new RpcClient(new HttpHandler(RPC_URL));

try {
  const result = await client.putDeploy(deploy);
  const hash = result.rawJSON.deploy_hash;
  console.log('\nDeploy hash:', hash);
  console.log('Explorer   : https://testnet.cspr.live/deploy/' + hash);
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}

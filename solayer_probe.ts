// TEMPORARY DEBUG SCRIPT – delete after use
// Usage:
//   npx tsx solayer_probe.ts
// Requires env vars: SOLANA_PRIVATE_KEY, RPC_URL
// Optional: AMOUNT (defaults 0.01), SIGN_ONLY ("1" to avoid sending)
//           SOLAYER_DEBUG=1 to get detailed timings

import { stakeWithSolayer } from "./packages/plugin-defi/src/solayer/tools/stake_with_solayer.ts";
import { Keypair, Connection } from "@solana/web3.js";
import { KeypairWallet } from "./packages/core/src/utils/keypairWallet.ts";
import { SolanaAgentKit } from "solana-agent-kit";
import bs58 from "bs58";
import { VersionedTransaction } from "@solana/web3.js";

const PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY;
const RPC_URL = process.env.RPC_URL;
const AMOUNT = parseFloat(process.env.AMOUNT || "0.01");
const SIGN_ONLY_FLAG = process.env.SIGN_ONLY === "1";

if (!PRIVATE_KEY || !RPC_URL) {
  console.error("Missing env vars SOLANA_PRIVATE_KEY or RPC_URL");
  process.exit(1);
}

(async () => {
  try {
    const kp = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
    const wallet = new KeypairWallet(kp, RPC_URL);
    const agent = new SolanaAgentKit(wallet, RPC_URL, { signOnly: SIGN_ONLY_FLAG });
    const connection = new Connection(RPC_URL);

    console.log(`Running stakeWithSolayer for ${AMOUNT} SOL (signOnly=${SIGN_ONLY_FLAG})`);
    
    // Manual fetch and sign
    const response = await fetch(
      `https://app.solayer.org/api/action/restake/ssol?amount=${AMOUNT}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: kp.publicKey.toBase58() }),
      }
    );

    if (!response.ok) throw new Error(await response.text());

    const data = await response.json();
    const txn = VersionedTransaction.deserialize(Buffer.from(data.transaction, "base64"));
    
    txn.sign([kp]);

    console.log("Transaction signed. Sending...");
    const signature = await connection.sendRawTransaction(txn.serialize());
    console.log("Transaction sent. Signature:", signature);

    console.log("Confirming transaction...");
    const confirmation = await connection.confirmTransaction(signature, "confirmed");
    console.log("Transaction confirmed.", confirmation);

  } catch (err: any) {
    console.error("ERROR\n", err?.message || err, err?.stack);
  }
})(); 
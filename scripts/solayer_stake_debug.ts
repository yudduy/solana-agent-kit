import { config } from "dotenv";
config({ path: "test/.env" });

process.env.SOLAYER_DEBUG = "1";

import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { KeypairWallet } from "solana-agent-kit";
import { SolanaAgentKit } from "solana-agent-kit";
import { stakeWithSolayer } from "../packages/plugin-defi/src/solayer/tools/stake_with_solayer.ts";

(async () => {
  try {
    const priv = process.env.SOLANA_PRIVATE_KEY;
    const rpc = process.env.RPC_URL;
    if (!priv || !rpc) throw new Error("Set SOLANA_PRIVATE_KEY and RPC_URL in test/.env");

    const kp = Keypair.fromSecretKey(bs58.decode(priv));
    const wallet = new KeypairWallet(kp, rpc);
    const agent = new SolanaAgentKit(wallet, rpc, {});

    const sig = await stakeWithSolayer(agent, 0.01);
    console.log("Returned signature:", sig);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
})(); 
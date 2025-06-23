import { VersionedTransaction } from "@solana/web3.js";
import { type SolanaAgentKit } from "solana-agent-kit";

/**
 * Stake SOL with Solayer
 * @param agent SolanaAgentKit instance
 * @param amount Amount of SOL to stake
 * @returns Transaction signature
 */
export async function stakeWithSolayer(agent: SolanaAgentKit, amount: number) {
  try {
    const response = await fetch(
      `https://app.solayer.org/api/action/restake/ssol?amount=${amount}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          account: agent.wallet.publicKey.toBase58(),
        }),
      },
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || "Staking request failed");
    }

    const data = await response.json();

    // Deserialize and prepare transaction
    const txn = VersionedTransaction.deserialize(
      Buffer.from(data.transaction, "base64"),
    );

    // ==================== DEBUG INSTRUMENTATION ====================
    const DEBUG = process.env.SOLAYER_DEBUG === "1" || process.env.SOLAYER_DEBUG === "true";

    if (DEBUG) {
      console.error("[SOLAYER_DEBUG] --- Transaction deserialized ---");
      console.error("[SOLAYER_DEBUG] Required signers:", txn.message.header.numRequiredSignatures);
      console.error(
        "[SOLAYER_DEBUG] Signatures pre-sign:",
        txn.signatures.map((s, i) => ({ index: i, present: s !== null })),
      );
    }

    // ==================== SIGN-ONLY PATH ====================
    // Use wallet methods directly to avoid signOrSendTX issues
    if (agent.config?.signOnly) {
      if (DEBUG) console.error("[SOLAYER_DEBUG] signOnly flag true – signing transaction only");
      return await agent.wallet.signTransaction(txn);
    }

    // ==================== DEBUG SIGN & SEND ====================
    if (DEBUG) {
      // Sign without sending to inspect signatures array
      await agent.wallet.signTransaction(txn);

      console.error(
        "[SOLAYER_DEBUG] Signatures post-sign:",
        txn.signatures.map((s, i) => ({ index: i, present: s !== null })),
      );

      // Simulate with sig verification to ensure validator view
      try {
        const sim = await agent.connection.simulateTransaction(txn, {
          sigVerify: true,
        });
        console.error("[SOLAYER_DEBUG] Simulation result:", JSON.stringify(sim.value.err));
      } catch (err: any) {
        console.error("[SOLAYER_DEBUG] Simulation error:", err?.message || err);
      }

      // Send raw transaction (skipPreflight false to surface sig errors)
      const rawSig = await agent.connection.sendRawTransaction(txn.serialize(), {
        skipPreflight: false,
      });

      console.error("[SOLAYER_DEBUG] Broadcast signature:", rawSig);
      return rawSig;
    }

    // Use signAndSendTransaction directly since we know KeypairWallet has it
    if (agent.wallet.signAndSendTransaction) {
      const result = await agent.wallet.signAndSendTransaction(txn);
      return result.signature;
    }

    throw new Error("Wallet does not support signAndSendTransaction");
  } catch (error: any) {
    console.error(error);
    throw new Error(`Solayer sSOL staking failed: ${error.message}`);
  }
}
